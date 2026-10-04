-- =====================================================================
-- Migration 0030: the user_accounts row is authoritative for role + status
-- =====================================================================
-- WHY
--
-- 0009 defined sec.get_app_role() with the JWT claim FIRST:
--
--     jwt_role := normalize_role(coalesce(auth.jwt() ->> 'role', ''));
--     if jwt_role in ('Administrator','Survey Operator','QA Inspector') then
--       return jwt_role;              <-- returns immediately
--     end if;
--     -- only then is user_accounts consulted, and only when status = 'active'
--
-- Supabase sources the JWT `role` claim from a user's APP METADATA. Every
-- account provisioned per the setup guide therefore carried an app role that
-- short-circuited the directory lookup, which made two things quietly untrue:
--
--   * Setting status = 'Disabled' in Administration -> Users did NOT revoke
--     anything. sec.get_app_role() never reached the status check.
--   * Deleting the row made it worse: with no row left, resolution fell through
--     to the JWT claim again, so the deleted user kept their elevated role.
--
-- The dashboard's Disable control read as revocation but was not.
--
-- WHAT CHANGES
--
-- The directory row now wins whenever one exists:
--
--     1. row for this email, status 'active'  -> return the row's role
--     2. row for this email, any other status -> return 'Viewer'  (revoked)
--     3. no row at all                        -> fall back to the JWT claim
--     4. otherwise                            -> 'Viewer'
--
-- Step 3 is deliberate and preserves the bootstrap: the very first
-- Administrator is created in Supabase with App Metadata and has NO directory
-- row until they first sign in, so the claim must still be honoured for them.
--
-- sec.can(), sec.is_role() and all RLS policies call sec.get_app_role(), so
-- they inherit the correction with no policy edits.
--
-- DATA REPAIR (why this is safe to apply to a live install)
--
-- After this change the row governs. An existing account could hold an elevated
-- App Metadata role while its directory row said something weaker, which would
-- silently DOWNGRADE them on the next request. Step 1 below reconciles every
-- such row from what the claim implied, so applying this migration cannot lock
-- anyone out. Run the verification query at the end to confirm nothing drifted.
--
-- Idempotent: safe to re-run any number of times.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0a. One shared definition of "what role does this claim confer?".
--
--     0009 only honoured three claims:
--         if jwt_role in ('Administrator','Survey Operator','QA Inspector')
--     so Viewer / guest / absent claims conferred NOTHING. Returning NULL for
--     them encodes that precisely: such an account places no expectation on its
--     directory row, and neither the repair below nor the verification query
--     should judge it.
--
--     This function exists so the repair and the verification query cannot
--     drift apart — an earlier draft duplicated the CASE in both places, and
--     the verification copy mapped unknown claims to 'Survey Operator', which
--     reported false drift for every Viewer.
--
--     Idempotent.
-- ---------------------------------------------------------------------
create or replace function sec.app_metadata_effective_role(p_app_metadata jsonb)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_app_metadata ->> 'role', ''))
    when 'administrator'   then 'Administrator'
    when 'admin'           then 'Administrator'
    when 'survey operator' then 'Survey Operator'
    when 'survey_operator' then 'Survey Operator'
    when 'operator'        then 'Survey Operator'
    when 'qa inspector'    then 'QA Inspector'
    when 'qa_inspector'    then 'QA Inspector'
    when 'qa officer'      then 'QA Inspector'
    when 'inspector'       then 'QA Inspector'
    else null   -- viewer / guest / absent: not an effective authority under 0009
  end;
$$;

revoke all on function sec.app_metadata_effective_role(jsonb) from public;
grant  execute on function sec.app_metadata_effective_role(jsonb) to authenticated;
grant  execute on function sec.app_metadata_effective_role(jsonb) to service_role;


-- ---------------------------------------------------------------------
-- 0b. Reconcile directory roles against what the token claim implied.
--     Only rows whose role disagrees are touched. App Metadata is the source
--     of truth here precisely because it was the effective authority before
--     this migration.
--
--     WHY raw_app_meta_data and NOT app_metadata
--
--     `app_metadata` is NOT a database column. It is the friendly property name
--     the Supabase JS client exposes on the session object. In SQL, GoTrue
--     writes `auth.users.raw_app_meta_data`, and that is the column to read.
--     Verified against supabase/postgres:17.6, where auth.users carries only
--     raw_app_meta_data and raw_user_meta_data.
--
--     Reading app_metadata therefore fails outright with
--
--         ERROR 42703: column u2.app_metadata does not exist
--
--     Some deployments also expose a physical app_metadata column, but relying
--     on it is a portability trap: raw_app_meta_data is the column GoTrue has
--     always written, so it is present on every version.
--
--     The "is not null" guard below is REQUIRED, not redundant. IS DISTINCT FROM
--     is the null-safe comparison: `u.role is distinct from NULL` evaluates TRUE,
--     not NULL, whenever u.role has any value. Without the guard an account
--     whose claim was Viewer / guest / absent would match the predicate and be
--     "repaired" to role = NULL -- silently erasing the directory role of
--     every Viewer on the install. Only an effective claim may rewrite a row.
-- ---------------------------------------------------------------------
update public.user_accounts u
   set role = sec.app_metadata_effective_role(a.raw_app_meta_data)
  from auth.users a
 where a.email is not null
   and lower(a.email) = lower(u.email)
   and sec.app_metadata_effective_role(a.raw_app_meta_data) is not null
   and u.role is distinct from sec.app_metadata_effective_role(a.raw_app_meta_data);


-- ---------------------------------------------------------------------
-- 1. get_app_role(): directory row authoritative, claim as bootstrap fallback.
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
  db_status text;
begin
  -- 1) A directory row governs, including its status. This is the authoritative
  --    source: a Disabled or Pending row is an explicit revocation, so it must
  --    NOT be overtaken by a stale token claim.
  jwt_email := nullif(auth.jwt() ->> 'email', '');
  if jwt_email is not null then
    select sec.normalize_role(u.role), lower(coalesce(u.status, ''))
      into db_role, db_status
      from public.user_accounts u
     where lower(u.email) = lower(jwt_email)
     limit 1;

    if db_role is not null then
      if db_status = 'active' then
        return db_role;
      end if;
      -- Row exists but is not Active -> revoked. Narrowest possible grant.
      return 'Viewer';
    end if;
  end if;

  -- 2) No directory row yet: honour an explicit token claim. This is the
  --    bootstrap path for the first Administrator, who cannot have a row until
  --    they first sign in.
  jwt_role := sec.normalize_role(coalesce(auth.jwt() ->> 'role', ''));
  if jwt_role in ('Administrator', 'Survey Operator', 'QA Inspector') then
    return jwt_role;
  end if;

  -- 3) Unauthenticated or unknown -> Viewer (narrowest read-only default).
  return 'Viewer';
end;
$$;

revoke all on function sec.get_app_role() from public;
grant  execute on function sec.get_app_role() to authenticated;
grant  execute on function sec.get_app_role() to anon;


-- ---------------------------------------------------------------------
-- VERIFICATION (run after applying)
--
-- These read raw_app_meta_data for the same portability reason as the repair
-- above: on a project without the generated `app_metadata` column, querying
-- it would fail with 42703 and you would never learn whether the fix landed.
--
--   -- 1. No row may disagree with an effective App Metadata role. Uses the
--   --    SAME function as the repair, so it cannot report drift the repair
--   --    would not have fixed. Expect ZERO rows.
--   select u.email, u.role, u.status,
--          a.raw_app_meta_data ->> 'role'                          as metadata_role,
--          sec.app_metadata_effective_role(a.raw_app_meta_data)    as effective_role
--     from public.user_accounts u
--     join auth.users a on lower(a.email) = lower(u.email)
--    where sec.app_metadata_effective_role(a.raw_app_meta_data) is not null
--      and u.role is distinct from sec.app_metadata_effective_role(a.raw_app_meta_data);
--
--   -- 2. Full picture, including the accounts check 1 deliberately ignores
--   --    (Viewer / guest / absent claims impose no expectation on the row).
--   --    'resolved' is what sec.get_app_role() will now return.
--   select u.email,
--          u.status,
--          u.role                                                 as directory_role,
--          coalesce(a.raw_app_meta_data ->> 'role', '(none)')     as metadata_role,
--          case when lower(coalesce(u.status, '')) = 'active'
--               then sec.normalize_role(u.role)
--               else 'Viewer' end                                 as resolved
--     from public.user_accounts u
--     left join auth.users a on lower(a.email) = lower(u.email)
--    order by resolved, u.email;
--
--   -- 3. A Disabled user must now resolve to Viewer, not their claim.
--   --    Sign in AS that user and run:
--   --      select sec.get_app_role();   -- expect 'Viewer'
-- =====================================================================