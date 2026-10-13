-- =====================================================================
-- GeoSphere 360 — Tenant-scoped RLS, production tables (Migration 0039)
--
-- Second of three policy migrations. 0038 covered the seven operational
-- tables; this covers the four `production_*` tables, which hold run
-- provenance — who processed which subgrid, on which station, when.
--
-- WHY IT MATTERS SPECIFICALLY
--   That provenance is the product's core claim: the Pitch-One-Pager sells
--   "permanent provenance per subgrid ... exportable as evidence". If a
--   competitor's contractor can read another company's run history, the
--   evidence trail is worthless as evidence, because it cannot be shown to
--   have been produced for this client alone.
--
--   All four tables previously had identical role-only policies with no
--   tenancy term:
--     SELECT  USING (sec.can('viewAll'))
--     INSERT  WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'))
--     UPDATE  the same, both slots
--     DELETE  USING (sec.can('manageDatasets'))
--
--   There is no `Allow public` grant on these four, so unlike 0038 the change
--   is purely additive: no permissive policy has to be dropped for the org
--   predicate to bite. They are still dropped and recreated wholesale so this
--   migration cannot leave a half-scoped set behind if one CREATE fails.
--
-- Idempotency claim: Safe to re-run. Policies are enumerated and dropped before
-- recreation; capabilities are unchanged from the policies being replaced.
--
-- SCOPE AND HONEST LIMIT
--   These four tables only. The ledgers, file_inventory, map_shares,
--   user_accounts, project_settings, the SECURITY DEFINER RPCs and
--   storage.objects are 0040. Until 0039 and 0040 both land the cross-tenant
--   gate still fails, correctly, on the tables they cover.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Ensure organization_id is present on all production tables.
--    Guarded by to_regclass: if tables were created after 0037, this
--    self-heals the column attribution and indexes without failing.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'production_runs', 'production_run_attempts',
    'production_releases', 'production_release_files'
  ];
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id)',
        v_table
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%I_org ON public.%I (organization_id)',
        v_table, v_table
      );
      EXECUTE format(
        'UPDATE public.%I SET organization_id = ''00000000-0000-4000-8000-000000000001''::uuid WHERE organization_id IS NULL',
        v_table
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Drop the existing policies, enumerated rather than named.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'production_runs', 'production_run_attempts',
    'production_releases', 'production_release_files'
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
--    Capability predicates carried over verbatim from 0022. The single
--    addition is `AND sec.in_org(organization_id)` in both slots.
--    Guarded by to_regclass so pre-production schemas do not fail.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- 2.1 production_runs -------------------------------------------------------
  IF to_regclass('public.production_runs') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "production_runs_select" ON public.production_runs FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "production_runs_insert" ON public.production_runs FOR INSERT TO authenticated
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_runs_update" ON public.production_runs FOR UPDATE TO authenticated
        USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_runs_delete" ON public.production_runs FOR DELETE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 2.2 production_run_attempts ----------------------------------------------
  IF to_regclass('public.production_run_attempts') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "production_run_attempts_select" ON public.production_run_attempts FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "production_run_attempts_insert" ON public.production_run_attempts FOR INSERT TO authenticated
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_run_attempts_update" ON public.production_run_attempts FOR UPDATE TO authenticated
        USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_run_attempts_delete" ON public.production_run_attempts FOR DELETE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 2.3 production_releases ---------------------------------------------------
  IF to_regclass('public.production_releases') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "production_releases_select" ON public.production_releases FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "production_releases_insert" ON public.production_releases FOR INSERT TO authenticated
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_releases_update" ON public.production_releases FOR UPDATE TO authenticated
        USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_releases_delete" ON public.production_releases FOR DELETE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 2.4 production_release_files ---------------------------------------------
  IF to_regclass('public.production_release_files') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "production_release_files_select" ON public.production_release_files FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "production_release_files_insert" ON public.production_release_files FOR INSERT TO authenticated
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_release_files_update" ON public.production_release_files FOR UPDATE TO authenticated
        USING ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id))
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc')) AND sec.in_org(organization_id));
      CREATE POLICY "production_release_files_delete" ON public.production_release_files FOR DELETE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id));
    $pol$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Verification. Same command-aware rule as 0038: USING must carry the
--    tenant predicate for SELECT/UPDATE/DELETE/ALL, WITH CHECK for
--    INSERT/UPDATE/ALL.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_bad record;
  v_count integer := 0;
  v_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('production_runs','production_run_attempts',
                         'production_releases','production_release_files')
  ) INTO v_exists;

  IF NOT v_exists THEN
    RAISE NOTICE '0039: production tables not present in schema; skipping RLS check';
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('production_runs','production_run_attempts',
                         'production_releases','production_release_files')
     AND (   (p.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND (p.qual IS NULL OR p.qual !~ 'in_org'))
          OR (p.cmd IN ('INSERT','UPDATE','ALL')    AND (p.with_check IS NULL OR p.with_check !~ 'in_org')));

  IF v_count > 0 THEN
    FOR v_bad IN
      SELECT tablename, policyname, cmd,
             coalesce(qual,'-') AS qual, coalesce(with_check,'-') AS check_
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename IN ('production_runs','production_run_attempts',
                             'production_releases','production_release_files')
         AND (   (p.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND (p.qual IS NULL OR p.qual !~ 'in_org'))
              OR (p.cmd IN ('INSERT','UPDATE','ALL')    AND (p.with_check IS NULL OR p.with_check !~ 'in_org')))
    LOOP
      RAISE EXCEPTION
        '0039 VERIFICATION FAILED: %.% (%) USING [%] WITH CHECK [%] is not tenant-scoped',
        v_bad.tablename, v_bad.policyname, v_bad.cmd, v_bad.qual, v_bad.check_;
    END LOOP;
  END IF;

  RAISE NOTICE '0039: all policies on the 4 production tables are tenant-scoped';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';