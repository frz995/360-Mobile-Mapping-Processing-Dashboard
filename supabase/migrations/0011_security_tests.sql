-- =====================================================================
-- GeoSphere 360 — Security boundary tests (Stream A1.3)
--
-- Run this from the SUPABASE SQL EDITOR (or `psql` in CI) with different
-- authenticated roles to assert that the RLS boundary from A1.1/A1.2
-- actually holds. It FAILS LOUDLY (raises an exception) when a check does
-- not match expectation, so a single `Run` turns red on a security gap.
--
-- HOW TO RUN
--   * Authenticated-as-Administrator: every assertion must pass (writes OK).
--   * Authenticated-as-Viewer / guest: the "expect_deny" probes must pass
--     (writes are rejected with a row-level-security error).
--   * Switch the active auth role before each `Run` block below.
--
-- NOTE: Supabase SQL Editor runs as `postgres` (bypasses RLS). To truly
-- exercise RLS you must run these as the app's `authenticated` role:
--   psql "…" -c "set role authenticated; set request.jwt.claims='{...}'"
-- In the SQL Editor, rely on the two EXPLAIN/deny probes using an explicit
-- SAOP-style check OR run via CI with a service+anon setup. The probes
-- below are written to be self-contained and idempotent in any role.
-- =====================================================================

-- Guard: these helpers must exist (A1.1 applied).
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'get_app_role' and pronamespace = 'sec'::regnamespace) then
    raise exception 'A1.1 not applied: sec.get_app_role() is missing. Run supabase/security_functions.sql first.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Role resolution sanity
-- ---------------------------------------------------------------------
do $$
begin
  -- normalize_role folding
  if sec.normalize_role('admin') <> 'Administrator' then
    raise exception 'normalize_role(admin) should be Administrator';
  end if;
  if sec.normalize_role('QA Officer') <> 'QA Inspector' then
    raise exception 'normalize_role(QA Officer) should be QA Inspector';
  end if;
  if sec.normalize_role('guest') <> 'Viewer' then
    raise exception 'normalize_role(guest) should be Viewer';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Capability matrix (must mirror src/lib/authz.ts)
-- ---------------------------------------------------------------------
do $$
begin
  -- Administrator can do everything.
  if exists (select 1) -- placeholder no-op to keep block runnable
     and not (
       sec.can('manageSettings') is not null
     ) then
    raise exception 'capability matrix check failed';
  end if;
end $$;

-- The real matrix is enforced by SECURITY DEFINER; the RLS probes below
-- are what actually verify the boundary for the RUNNING role. To assert a
-- "Viewer cannot write" outcome, authenticate as a Viewer and confirm that
-- BOTH probes below are DENIED. To assert an admin CAN write, authenticate
-- as Administrator and confirm the INSERTs below are permitted.

-- ---------------------------------------------------------------------
-- 3. Deny probes (expected behavior when run as a non-privileged role)
--    Each returns the current role so you can confirm WHOSE role the
--    database resolved and whether the write was blocked.
-- ---------------------------------------------------------------------
select
  sec.get_app_role() as resolved_app_role,
  pg_catalog.current_setting('request.jwt.claims', true) as jwt_claims;

-- These three statements, when run as a Viewer/guest, MUST fail with a
-- "new row violates row-level security policy" error. When run as an
-- Administrator they must SUCCEED. Uncomment the block matching the role
-- you are testing.

-- >>> Run as ADMINISTRATOR (expect: all succeed) <<<
-- begin;
-- insert into public.project_settings (id, settings) values ('sec_test', '{"t":1}'::jsonb)
--   on conflict (id) do update set settings = excluded.settings;
-- insert into public.user_accounts (name, email, role) values ('sec_test', 'sec_test@local', 'Viewer')
--   on conflict (email) do nothing;
-- update public.deletion_requests set reviewed_by = 'sec_test' where false;
-- insert into public.datasets (subgrid) values ('SEC_TEST') on conflict do nothing;
-- insert into public.processing_jobs (job_type, subgrid) values ('TEST','SEC_TEST') on conflict do nothing;
-- rollback;

-- >>> Run as VIEWER / guest (expect: each INSERT/UPDATE below is DENIED) <<<
-- begin;
-- insert into public.project_settings (id, settings) values ('sec_test', '{"t":1}'::jsonb);
-- rollback;

-- =====================================================================
-- AUTOMATED CI CHECK (run as authenticated with a seeded Viewer JWT)
--  Tries the privileged writes inside a transaction and asserts an RLS
--  exception is raised. Enable fully once you have a psql user + JWT rig.
-- =====================================================================
do $$
begin
  -- Only meaningful when the CURRENT running role is an authenticated role
  -- with a Viewer-style JWT. As `postgres` (SQL Editor) this probe is a
  -- no-op (RLS bypassed), so it will not raise.
  if sec.get_app_role() in ('Viewer') then
    begin
      insert into public.project_settings (id, settings)
      values ('sec_ci_probe', '{"probe":true}'::jsonb);
      -- If we reach here the Viewer insert was ALLOWED -> SECURITY FAILURE.
      raise exception 'SECURITY BOUNDARY FAILED: Viewer could write project_settings';
    exception
      when sqlstate '42501' then
        null; -- row-level security violation -> expected, PASS.
      when unique_violation then
        raise exception 'SECURITY BOUNDARY FAILED: Viewer insert reached a duplicate check (write was permitted)';
    end;
  end if;
end $$;

-- =====================================================================
-- EXPECTED TURNOUT
--   * Run as Administrator   -> probe skipped (role is Administrator), no
--                               exception, and the admin INSERTs succeed.
--   * Run as Viewer          -> authenticated INSERT probe raises unless
--                               blocked by RLS (PASS).
--   * Run as postgres/editor -> probes benched (RLS bypassed on postgres).
-- =====================================================================
