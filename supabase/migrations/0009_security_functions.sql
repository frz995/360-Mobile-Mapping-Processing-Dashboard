-- =====================================================================
-- GeoSphere 360 — Server-enforced Authorization Helpers (Stream A1.1)
-- SECURITY DEFINER functions that resolve the caller's application role
-- and check role capabilities AT THE DATABASE LAYER. This moves the
-- authorization boundary out of the browser (where the older `authz.ts`
-- map was only a UI facade) and into PostgreSQL, so no authenticated
-- client can escalate past its role by calling PostgREST directly.
--
-- Idempotent: safe to re-run any number of times in the Supabase SQL
-- Editor. Every function uses CREATE OR REPLACE / IF NOT EXISTS guards.
-- Supported versions: Supabase (Postgres 15), schema 'public'.
--
-- Roles are resolved in this order:
--   1. auth.jwt() ->> 'role'  (if it maps to a known app role)
--   2. user_accounts.role     (lookup by auth email, status = 'Active')
-- =====================================================================

-- Helper schema for our security functions (kept separate from public).
create schema if not exists sec;

-- ---------------------------------------------------------------------
-- 1. Role normalization: fold the many raw strings into one canonical set.
-- ---------------------------------------------------------------------
create or replace function sec.normalize_role(raw text)
returns text
language sql
immutable
as $$
  select case lower(coalesce(btrim(raw), ''))
    when 'administrator' then 'Administrator'
    when 'admin'         then 'Administrator'
    when 'survey operator' then 'Survey Operator'
    when 'operator'      then 'Survey Operator'
    when 'qa inspector'  then 'QA Inspector'
    when 'inspector'     then 'QA Inspector'
    when 'qa officer'    then 'QA Inspector'
    when 'viewer'        then 'Viewer'
    when 'guest'         then 'Viewer'
    else 'Viewer'
  end;
$$;

-- ---------------------------------------------------------------------
-- 2. get_app_role(): canonical role of the current authenticated caller.
--    SECURITY DEFINER so it can read user_accounts without the caller
--    needing direct SELECT on it.
-- ---------------------------------------------------------------------
create or replace function sec.get_app_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  jwt_role text;
  jwt_email text;
  db_role  text;
begin
  -- 1) Prefer an explicit, JWT-carried app role claim when it is a known role.
  jwt_role := sec.normalize_role(coalesce(auth.jwt() ->> 'role', ''));
  if jwt_role in ('Administrator', 'Survey Operator', 'QA Inspector') then
    return jwt_role;
  end if;

  -- 2) Otherwise fall back to the app's user_accounts table by email.
  jwt_email := nullif(auth.jwt() ->> 'email', '');
  if jwt_email is not null then
    select sec.normalize_role(u.role)
      into db_role
      from public.user_accounts u
     where lower(u.email) = lower(jwt_email)
       and lower(coalesce(u.status, '')) = 'active'
     limit 1;
    if db_role is not null then
      return db_role;
    end if;
  end if;

  -- Unauthenticated or unknown -> Viewer (narrowest read-only default).
  return 'Viewer';
end;
$$;

revoke all on function sec.get_app_role() from public;
grant  execute on function sec.get_app_role() to authenticated;
grant  execute on function sec.get_app_role() to anon;

-- ---------------------------------------------------------------------
-- 3. can(capability): does the caller's role carry this capability?
--    Mirrors src/lib/authz.ts ROLE_CAPABILITIES. Add/remove rows here and
--    in authz.ts together (kept in sync by A1.4).
-- ---------------------------------------------------------------------
create or replace function sec.can(required text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, sec
as $$
declare
  app_role text := sec.get_app_role();
begin
  case app_role
    -- Administrator: everything.
    when 'Administrator' then
      return true;
    -- Survey Operator: data deletion, run QA/QC, read everything.
    when 'Survey Operator' then
      return required in (
        'deleteData', 'runQaqc', 'viewAll'
      );
    -- QA Inspector: run + review QA/QC, read everything.
    when 'QA Inspector' then
      return required in (
        'runQaqc', 'reviewQaqc', 'viewAll'
      );
    -- Viewer / guest: read-only.
    else
      return required = 'viewAll';
  end case;
end;
$$;

revoke all on function sec.can(text) from public;
grant  execute on function sec.can(text) to authenticated;
grant  execute on function sec.can(text) to anon;

-- Convenience helpers used directly inside RLS policy bodies.
create or replace function sec.is_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public, sec
as $$ select sec.get_app_role() = sec.normalize_role(required_role); $$;

revoke all on function sec.is_role(text) from public;
grant  execute on function sec.is_role(text) to authenticated;
grant  execute on function sec.is_role(text) to anon;

-- =====================================================================
-- USAGE IN RLS (applied by A1.2): e.g.
--   using (sec.can('viewAll'))
--   with check (sec.can('manageSettings'))
-- =====================================================================
