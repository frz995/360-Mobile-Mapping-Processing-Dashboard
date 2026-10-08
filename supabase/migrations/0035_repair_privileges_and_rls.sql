-- =====================================================================
-- GeoSphere 360 — Repair table privileges and the metadata write policy (Migration 0035)
--
-- WHY THIS MIGRATION IS NEEDED
--
-- Three tables created by migrations 0023, 0026 and 0034 are granted to
-- `postgres` ONLY. Every other application table carries the full Supabase
-- default grant set (anon, authenticated, service_role, supabase_admin), so
-- these three are the only exceptions in `public` — and none of them works:
--
--   station_board_items        0023   MultiPC station snapshots
--   hub_session_state          0026   Production hub last-activity snapshot
--   survey_metadata_filenames  0034   survey metadata filename set
--
-- The error an application user actually receives is:
--
--   ERROR:  permission denied for table survey_metadata_filenames
--   HINT:  GRANT the required privileges to the current role with:
--          GRANT SELECT ON public.survey_metadata_filenames TO authenticated;
--
-- WHY RLS DOES NOT SAVE IT
--
-- 0034 creates a correct `to authenticated` SELECT policy, which is what makes
-- this counter-intuitive: RLS POLICIES FILTER ROWS, THEY DO NOT GRANT ACCESS.
-- Access needs a table GRANT as well as a policy. 0034 only revoked:
--
--   revoke all on table public.survey_metadata_filenames from anon;
--
-- ...with no matching grant to `authenticated`. The policy is therefore
-- unreachable and the table is invisible to every application user.
--
-- Consequences that were silent rather than loud:
--
--   - survey_metadata_filenames  0 rows. Every CSV import's capture upsert
--     failed with the same permission error, so the "Metadata mismatch"
--     integrity check could never be evaluated for any run.
--   - hub_session_state          read and write both fail; the caller's empty
--     catch falls back to localStorage.
--   - station_board_items        likewise.
--
-- WHAT ELSE THIS MIGRATION FIXES
--
-- 0034's INSERT policy is gated on `sec.can('editData')`. That capability exists
-- in NEITHER `src/lib/authz.ts` (20 capabilities) nor `sec.can`'s SQL CASE, so it
-- is unsatisfiable for everyone except an Administrator:
--
--   Survey Operator -> sec.can('editData')   = false
--   Survey Operator -> sec.can('deleteData') = true
--
-- A Survey Operator could therefore never capture metadata even with the grant
-- in place. The policy is re-gated on `deleteData`, the only data-mutating
-- capability `sec.can` grants an operator.
--
-- This is deliberately NOT widened to `importDatasets`. Doing so would enlarge
-- `ENFORCED_CAPABILITIES` in `src/lib/authz.ts` and force a change to
-- `authz_matches_rls.test.ts`, which asserts the narrower overlap on purpose.
--
-- THE RULE THIS MIGRATION ENFORCES
--
-- A migration that creates a table in `public` MUST grant it to `authenticated`.
-- Enabling RLS is not a substitute. The verification block at the end reports any
-- table missing either.
--
-- NOTE ON DEFAULT PRIVILEGES
--
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ... TO authenticated` is
-- deliberately NOT used here. `pg_default_acl` is currently empty, so a blanket
-- grant would apply to every future table — and a migration that forgot
-- `enable row level security` would then be auto-exposed to all authenticated
-- users. Explicit per-table grants keep that decision visible in review.
--
-- NOTE ON survey_recycle_bin
--
-- That table's missing RLS is addressed by 0031, which already contains the
-- fix. It is NOT duplicated here, so that there is one authority for the
-- recycle-bin policy rather than two that can drift.
--
-- Idempotent: grants and the policy replacement may be re-run any number of
-- times. REQUIRES 0022 and 0024 to have been applied first (see section 1).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Table grants
--
-- Least privilege per table. `survey_metadata_filenames` is append-only on
-- purpose: the Duplicate check measures how often a filename was recorded, so
-- granting DELETE or UPDATE would let an operator erase the evidence that
-- check reads.
--
-- Written as plain statements rather than a dynamic `execute format(...)` loop
-- so that `grant ... to authenticated` stays greppable. That is what lets
-- `bootstrap-migrations.test.ts` assert that every table created from 0022
-- onward is granted, which is the check that would have caught all three of the
-- omissions this migration repairs.
--
-- REQUIRES 0022 AND 0024 FIRST. The four production_* tables are created by
-- 0022 and stage_event_ledger by 0024; a grant against a missing table is an
-- error, which aborts the transaction. That is deliberate — silently skipping
-- a privilege grant is how this defect happened in the first place.
-- ---------------------------------------------------------------------
grant select, insert
  on table public.survey_metadata_filenames to authenticated, service_role;

-- The caller deletes superseded snapshots (hubSession.ts purge).
grant select, insert, update, delete
  on table public.hub_session_state to authenticated, service_role;

grant select, insert, update, delete
  on table public.station_board_items to authenticated, service_role;

-- Appended by six Production Hub components (StageHistoryLedger,
-- BucketPublicationGate, IntakePairingStation, QAAuditStation,
-- WebGISPublishGate, MultiPCStationBoard). Its 0024 policy is FOR ALL, so the
-- grant has to be too.
grant select, insert, update, delete
  on table public.stage_event_ledger to authenticated, service_role;

-- Policies in 0022 cover select/insert/update/delete.
grant select, insert, update, delete
  on table public.production_runs to authenticated, service_role;

grant select, insert, update, delete
  on table public.production_run_attempts to authenticated, service_role;

grant select, insert, update, delete
  on table public.production_releases to authenticated, service_role;

grant select, insert, update, delete
  on table public.production_release_files to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Metadata capture policy
--
-- Re-gated from the non-existent `editData` to `deleteData`. Postgres has no
-- CREATE OR REPLACE POLICY, so the drop is required and is why the replacement
-- cannot be conditional in the same way 0034's creation guard is.
--
-- The read policy is deliberately left alone: `sec.can('viewAll') or
-- project_id = auth.uid()` is correct.
-- ---------------------------------------------------------------------
do $$
begin
  drop policy if exists survey_metadata_filenames_insert
    on public.survey_metadata_filenames;
end $$;

do $$
begin
  if to_regclass('public.survey_metadata_filenames') is null then
    raise notice 'SKIP survey_metadata_filenames policy: table absent';
    return;
  end if;

  create policy survey_metadata_filenames_insert
      on public.survey_metadata_filenames
      for insert
      to authenticated
      -- `deleteData` is the only data-mutating capability sec.can grants a
      -- Survey Operator. A Viewer can read a run's completeness but cannot
      -- assert one.
      with check (sec.can('deleteData') and project_id = auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- 3. Verification sweep
--
-- Report-only, following 0031's precedent: a notice, never a raise. This is
-- what makes the class visible at migration time rather than discovered as a
-- "permission denied" during an incident. Excludes `spatial_ref_sys`, which is
-- owned by the PostGIS extension.
--
-- Both lists should be empty once 0031 and this migration have been applied.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> 'spatial_ref_sys'
      and not exists (
        select 1 from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name   = c.relname
          and g.grantee      = 'authenticated'
      )
  loop
    raise notice 'MISSING authenticated grant: public.% -- unusable by the application', r.relname;
  end loop;

  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> 'spatial_ref_sys'
      and not c.relrowsecurity
  loop
    raise notice 'RLS NOT enabled: public.%', r.relname;
  end loop;
end $$;

COMMIT;

-- VERIFICATION — run these after applying; both should return no rows.
--
--   -- no table lacks the grant
--   select c.relname
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r'
--     and c.relname <> 'spatial_ref_sys'
--     and not exists (select 1 from information_schema.role_table_grants g
--                     where g.table_schema = 'public' and g.table_name = c.relname
--                       and g.grantee = 'authenticated');
--
--   -- no table lacks RLS
--   select c.relname
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r'
--     and c.relname <> 'spatial_ref_sys' and not c.relrowsecurity;
--
--   -- the capture policy now names a capability sec.can understands
--   select policyname, with_check from pg_policies
--   where tablename = 'survey_metadata_filenames' and policyname like '%insert%';