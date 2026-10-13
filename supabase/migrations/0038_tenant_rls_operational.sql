-- =====================================================================
-- GeoSphere 360 — Tenant-scoped RLS, operational tables (Migration 0038)
--
-- First of three policy migrations. 0037 gave every operational table an
-- `organization_id`; this makes the database enforce it.
--
-- WHY THE WHOLE POLICY SET IS REPLACED, NOT APPENDED
--   PostgreSQL ORs permissive policies together. `qa_defects` and
--   `qaqc_audit_runs` each carry four policies from 0001 named
--   "Allow public read/insert/update/delete" whose predicates are literally
--   `true`, and `subgrids` carries "Allow public read" USING (true). Those
--   grant anon the right to read, write and delete every row.
--
--   Adding `AND organization_id = sec.current_org()` beside them would change
--   nothing, because `true OR anything` is `true`. The permissive grants have
--   to be dropped, not shadowed. Measured on the applied schema before this
--   migration:
--
--     qa_defects        Allow public read    USING (true)
--     qa_defects        Allow public insert WITH CHECK (true)
--     qa_defects        Allow public update USING (true) WITH CHECK (true)
--     qa_defects        Allow public delete USING (true)
--     qaqc_audit_runs   (the same four)
--     subgrids          Allow public read    USING (true)
--
--   So each table below has its policies dropped wholesale — by enumeration
--   from pg_policies, so a policy this plan never knew about cannot survive —
--   and a canonical set created in its place.
--
--   Capability predicates are carried over unchanged from the role-guarded
--   policies being replaced, so this migration narrows tenancy and not
--   authority: a Survey Operator loses the ability to read another company's
--   rows, and nothing else.
--
-- Idempotency claim: Safe to re-run. Policies are enumerated and dropped before
-- recreation; sec.in_org() is CREATE OR REPLACE; indexes and constraints are
-- untouched here.
--
-- SCOPE AND HONEST LIMIT
--   Operational tables only. Production runs are 0039; ledgers, settings,
--   map_shares, user_accounts, project_settings, the SECURITY DEFINER RPCs and
--   storage.objects are 0040.
--
--   Until 0039 and 0040 land, this migration narrows the blast radius but does
--   not close it, and the cross-tenant gate in 0011_security_tests.sql will
--   still fail on those tables. That is the intended sequence.
--
--   One deliberate behaviour change: `subgrids` and the panorama tables were
--   readable by any authenticated caller regardless of role. They now require
--   the caller's active tenant, so a user with no membership sees nothing. An
--   unassigned user is a real state, and the console renders it as such.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. sec.in_org(): the single tenant predicate.
--
--    Kept as a function so the 100-odd policies below cannot drift from one
--    another, and so the fail-closed rule lives in exactly one place:
--
--      NULL row organization  -> FALSE   (unattributed is invisible)
--      platform administrator -> TRUE    (Seller support across tenants)
--      otherwise               -> row organization == the caller's active tenant
--
--    Not SECURITY DEFINER by design: it composes `sec.is_platform_admin()` and
--    `sec.current_org()`, which are, and delegates to them rather than reading
--    organization_members itself. That keeps the elevated-privilege surface
--    minimal and confined to the two functions that need it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sec.in_org(row_organization UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT sec.is_platform_admin()
      OR (row_organization IS NOT NULL AND row_organization = sec.current_org());
$$;

REVOKE ALL ON FUNCTION sec.in_org(UUID) FROM public;
GRANT EXECUTE ON FUNCTION sec.in_org(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sec.in_org(UUID) TO anon;

COMMENT ON FUNCTION sec.in_org(UUID) IS
  'Tenant predicate used by every org-scoped policy. NULL is invisible, never a wildcard. Returns TRUE for platform administrators, who administer across tenants by design.';

-- ---------------------------------------------------------------------
-- 2. Drop every existing policy on the operational tables.
--
--    Enumerated rather than listed by name: 0001, 0004, 0010, 0012, 0031 and
--    0035 have all added policies to these tables, and a hand-written list
--    would eventually miss one — which is exactly how a `USING (true)` grant
--    survives a hardening pass.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'panoramas', 'staging_panoramas', 'subgrids',
    'qa_defects', 'qaqc_audit_runs', 'datasets', 'processing_jobs'
  ];
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      FOR v_policy IN
        SELECT policyname FROM pg_policies
         WHERE schemaname = 'public' AND tablename = v_table
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. Canonical org-scoped policies.
--
--    Written as four statements per table rather than generated, because the
--    capability differs per table and a generated set would flatten a
--    distinction the QA workflow depends on (who may run QA/QC versus who may
--    review it).
-- ---------------------------------------------------------------------

-- 3.1 panoramas -------------------------------------------------------------
DROP POLICY IF EXISTS "panoramas_select" ON public.panoramas;
DROP POLICY IF EXISTS "panoramas_insert" ON public.panoramas;
DROP POLICY IF EXISTS "panoramas_update" ON public.panoramas;
DROP POLICY IF EXISTS "panoramas_delete" ON public.panoramas;

CREATE POLICY "panoramas_select" ON public.panoramas FOR SELECT TO authenticated
  USING (sec.can('viewAll') AND sec.in_org(organization_id));

CREATE POLICY "panoramas_insert" ON public.panoramas FOR INSERT TO authenticated
  WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));

CREATE POLICY "panoramas_update" ON public.panoramas FOR UPDATE TO authenticated
  USING (sec.can('manageDatasets') AND sec.in_org(organization_id))
  WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));

CREATE POLICY "panoramas_delete" ON public.panoramas FOR DELETE TO authenticated
  USING (sec.can('deleteData') AND sec.in_org(organization_id));

-- 3.2 staging_panoramas -----------------------------------------------------
DROP POLICY IF EXISTS "staging_panoramas_select"  ON public.staging_panoramas;
DROP POLICY IF EXISTS "staging_panoramas_insert"  ON public.staging_panoramas;
DROP POLICY IF EXISTS "staging_panoramas_update"  ON public.staging_panoramas;
DROP POLICY IF EXISTS "staging_panoramas_delete"  ON public.staging_panoramas;

CREATE POLICY "staging_panoramas_select" ON public.staging_panoramas FOR SELECT TO authenticated
  USING (sec.can('viewAll') AND sec.in_org(organization_id));

CREATE POLICY "staging_panoramas_insert" ON public.staging_panoramas FOR INSERT TO authenticated
  WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

CREATE POLICY "staging_panoramas_update" ON public.staging_panoramas FOR UPDATE TO authenticated
  USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
  WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

CREATE POLICY "staging_panoramas_delete" ON public.staging_panoramas FOR DELETE TO authenticated
  USING ((sec.can('deleteData') OR sec.can('manageDatasets')) AND sec.in_org(organization_id));

-- 3.3 subgrids -------------------------------------------------------------
-- Previously: "Allow authenticated write on subgrids" FOR ALL USING
-- (auth.uid() IS NOT NULL) plus "Allow public read" USING (true). Both gone.
DROP POLICY IF EXISTS "subgrids_select" ON public.subgrids;
DROP POLICY IF EXISTS "subgrids_insert" ON public.subgrids;
DROP POLICY IF EXISTS "subgrids_update" ON public.subgrids;
DROP POLICY IF EXISTS "subgrids_delete" ON public.subgrids;

CREATE POLICY "subgrids_select" ON public.subgrids FOR SELECT TO authenticated
  USING (sec.can('viewAll') AND sec.in_org(organization_id));

CREATE POLICY "subgrids_insert" ON public.subgrids FOR INSERT TO authenticated
  WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));

CREATE POLICY "subgrids_update" ON public.subgrids FOR UPDATE TO authenticated
  USING (sec.can('manageDatasets') AND sec.in_org(organization_id))
  WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));

CREATE POLICY "subgrids_delete" ON public.subgrids FOR DELETE TO authenticated
  USING (sec.can('deleteData') AND sec.in_org(organization_id));

-- 3.4 qa_defects -----------------------------------------------------------
-- Previously carried four anon grants with a literal `true` predicate. This is
-- the table whose defect records are the product's audit evidence, so losing
-- them is worse than losing any other table.
DROP POLICY IF EXISTS "qa_defects_select" ON public.qa_defects;
DROP POLICY IF EXISTS "qa_defects_insert" ON public.qa_defects;
DROP POLICY IF EXISTS "qa_defects_update" ON public.qa_defects;
DROP POLICY IF EXISTS "qa_defects_delete" ON public.qa_defects;

CREATE POLICY "qa_defects_select" ON public.qa_defects FOR SELECT TO authenticated
  USING (sec.can('viewAll') AND sec.in_org(organization_id));

CREATE POLICY "qa_defects_insert" ON public.qa_defects FOR INSERT TO authenticated
  WITH CHECK (sec.can('runQaqc') AND sec.in_org(organization_id));

CREATE POLICY "qa_defects_update" ON public.qa_defects FOR UPDATE TO authenticated
  USING ((sec.can('reviewQaqc') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
  WITH CHECK ((sec.can('reviewQaqc') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

CREATE POLICY "qa_defects_delete" ON public.qa_defects FOR DELETE TO authenticated
  USING ((sec.can('deleteData') OR sec.can('reviewQaqc')) AND sec.in_org(organization_id));

-- 3.5 qaqc_audit_runs ------------------------------------------------------
DROP POLICY IF EXISTS "qaqc_audit_runs_select" ON public.qaqc_audit_runs;
DROP POLICY IF EXISTS "qaqc_audit_runs_insert" ON public.qaqc_audit_runs;
DROP POLICY IF EXISTS "qaqc_audit_runs_update" ON public.qaqc_audit_runs;
DROP POLICY IF EXISTS "qaqc_audit_runs_delete" ON public.qaqc_audit_runs;

CREATE POLICY "qaqc_audit_runs_select" ON public.qaqc_audit_runs FOR SELECT TO authenticated
  USING (sec.can('viewAll') AND sec.in_org(organization_id));

CREATE POLICY "qaqc_audit_runs_insert" ON public.qaqc_audit_runs FOR INSERT TO authenticated
  WITH CHECK (sec.can('runQaqc') AND sec.in_org(organization_id));

CREATE POLICY "qaqc_audit_runs_update" ON public.qaqc_audit_runs FOR UPDATE TO authenticated
  USING (sec.can('runQaqc') AND sec.in_org(organization_id))
  WITH CHECK (sec.can('runQaqc') AND sec.in_org(organization_id));

CREATE POLICY "qaqc_audit_runs_delete" ON public.qaqc_audit_runs FOR DELETE TO authenticated
  USING (sec.can('deleteData') AND sec.in_org(organization_id));

-- 3.6 datasets -------------------------------------------------------------
DROP POLICY IF EXISTS "datasets_select" ON public.datasets;
DROP POLICY IF EXISTS "datasets_insert" ON public.datasets;
DROP POLICY IF EXISTS "datasets_update" ON public.datasets;
DROP POLICY IF EXISTS "datasets_delete" ON public.datasets;

CREATE POLICY "datasets_select" ON public.datasets FOR SELECT TO authenticated
  USING (sec.can('viewAll') AND sec.in_org(organization_id));

CREATE POLICY "datasets_insert" ON public.datasets FOR INSERT TO authenticated
  WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

CREATE POLICY "datasets_update" ON public.datasets FOR UPDATE TO authenticated
  USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
  WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

CREATE POLICY "datasets_delete" ON public.datasets FOR DELETE TO authenticated
  USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

-- 3.7 processing_jobs ------------------------------------------------------
DROP POLICY IF EXISTS "processing_jobs_select" ON public.processing_jobs;
DROP POLICY IF EXISTS "processing_jobs_insert" ON public.processing_jobs;
DROP POLICY IF EXISTS "processing_jobs_update" ON public.processing_jobs;
DROP POLICY IF EXISTS "processing_jobs_delete" ON public.processing_jobs;

CREATE POLICY "processing_jobs_select" ON public.processing_jobs FOR SELECT TO authenticated
  USING (sec.can('viewAll') AND sec.in_org(organization_id));

CREATE POLICY "processing_jobs_insert" ON public.processing_jobs FOR INSERT TO authenticated
  WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

CREATE POLICY "processing_jobs_update" ON public.processing_jobs FOR UPDATE TO authenticated
  USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
  WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));

CREATE POLICY "processing_jobs_delete" ON public.processing_jobs FOR DELETE TO authenticated
  USING (sec.can('manageDatasets') AND sec.in_org(organization_id));

-- ---------------------------------------------------------------------
-- 4. Verification.
--
--    Asserts the property that motivated the migration: no permissive policy
--    on these tables may have a predicate that ignores tenancy. Read from
--    pg_policies rather than re-listed, so it detects a policy added by a later
--    migration rather than checking only the ones created above.
--
--    Command-aware, because the two predicate slots do not apply to every
--    command. PostgreSQL records USING as NULL for INSERT, and WITH CHECK as
--    NULL for SELECT and DELETE:
--      SELECT / DELETE  -> USING must carry sec.in_org()
--      INSERT          -> WITH CHECK must carry sec.in_org()
--      UPDATE / ALL    -> both must
--    An earlier draft of this check demanded both slots unconditionally and
--    therefore failed its own correct policies.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_bad record;
  v_count integer := 0;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('panoramas','staging_panoramas','subgrids','qa_defects',
                         'qaqc_audit_runs','datasets','processing_jobs')
     AND (   (p.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND (p.qual IS NULL OR p.qual !~ 'in_org'))
          OR (p.cmd IN ('INSERT','UPDATE','ALL')    AND (p.with_check IS NULL OR p.with_check !~ 'in_org')));

  IF v_count > 0 THEN
    FOR v_bad IN
      SELECT tablename, policyname, cmd,
             coalesce(qual,'-') AS qual,
             coalesce(with_check,'-') AS check_
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename IN ('panoramas','staging_panoramas','subgrids','qa_defects',
                             'qaqc_audit_runs','datasets','processing_jobs')
         AND (   (p.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND (p.qual IS NULL OR p.qual !~ 'in_org'))
              OR (p.cmd IN ('INSERT','UPDATE','ALL')    AND (p.with_check IS NULL OR p.with_check !~ 'in_org')))
    LOOP
      RAISE EXCEPTION
        '0038 VERIFICATION FAILED: %.% (%) USING [%] WITH CHECK [%] is not tenant-scoped',
        v_bad.tablename, v_bad.policyname, v_bad.cmd, v_bad.qual, v_bad.check_;
    END LOOP;
  END IF;

  RAISE NOTICE '0038: all policies on the 7 operational tables are tenant-scoped';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';