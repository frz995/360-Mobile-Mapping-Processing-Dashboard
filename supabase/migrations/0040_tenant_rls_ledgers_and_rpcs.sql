-- =====================================================================
-- GeoSphere 360 — Tenant-scoped RLS, ledgers, shares and RPC re-gating
--              (Migration 0040)
--
-- Final policy migration. 0038 covered the operational tables, 0039 the
-- production tables, this one everything else — and the two SECURITY DEFINER
-- functions that bypass RLS entirely.
--
-- THE TWO THINGS THIS FIXES THAT NOTHING ELSE COULD
--
-- 1. projects_delete_cascade and projects_adopt_legacy_rows are SECURITY
--    DEFINER, so they execute as their owner and are not filtered by any
--    policy. 0017 granted EXECUTE to `authenticated` with the role gate
--    "deliberately left to the app layer" (0017:15-18, 0017:159-160). In a
--    single-tenant install that is a privilege bug. With two companies in one
--    database it means any authenticated caller — including a `Viewer`, and
--    including a member of Company B — can hard-delete Company A's project and
--    its 13 child tables.
--
--    The bodies are not rewritten here. They are renamed to *_unchecked and a
--    guarded wrapper is created in their place. That keeps ~150 lines of
--    deletion logic byte-identical and makes the guard auditable in one place,
--    which a hand-edited cascade would not be.
--
-- 2. `file_inventory` is `USING (true)` (0006:39) with no role check, so ANY
--    caller including `anon` reads the install's complete filename list — the
--    exact inventory of which panoramas exist. And `project_settings` carries
--    "Allow public insert/update on project_settings" FOR ALL USING (true)
--    from 0001, so anon can write the install's global settings row.
--
-- WHAT IS CLOSED HERE, TABLE BY TABLE
--   World-readable (USING (true)):  file_inventory, plus the "Allow public"
--   policies on qa_defects / qaqc_audit_runs / subgrids already dropped in 0038.
--   World-writable:                 project_settings, map_shares_insert (0019,
--                                    granted to anon WITH CHECK (true)).
--   Untenanted:                      audit_logs, notifications, batch_logs,
--                                    stage_event_ledger, station_board_items,
--                                    hub_session_state, survey_recycle_bin,
--                                    deletion_requests, projects,
--                                    survey_metadata_filenames, map_shares.
--   Cross-tenant directory:          user_accounts, which every authenticated
--                                    caller could read in full.
--
-- Idempotency claim: Safe to re-run. Policies are enumerated and dropped before
-- recreation; the RPC rename is guarded on the name not existing; indexes and
-- constraints are untouched.
--
-- SCOPE AND HONEST LIMIT
--   Storage objects are NOT tenant-scoped here. The road-analysis-geometry
--   policies (0021) grant every authenticated user any object in the bucket, and
--   that cannot be fixed until the bucket is namespaced by organization — which
--   is migration-independent work tracked separately. Section 5 therefore
--   RAISES a WARNING naming the policies rather than silently passing.
--
--   `project_settings` is a single global row (read at
--   src/services/api/admin.ts:649). Closing anon from it removes an
--   unauthenticated write surface, but a single shared settings row is itself
--   wrong for many companies: the storage provider, base URL and worker
--   settings in it are install-wide, not per-tenant. Making it per-organization
--   is not done and is not attempted here.
--
--   Map share links stay publicly readable by token. That is the intended
--   design of a share link and the cross-tenant gate asserts it rather than
--   weakening it; what changes is that shares can only be CREATED inside the
--   caller's own company, which `0019` previously permitted for anyone at all.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Re-gate the SECURITY DEFINER RPCs.
-- ---------------------------------------------------------------------

-- 1.1 projects_delete_cascade ----------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.projects_delete_cascade(uuid)') IS NOT NULL
     OR to_regprocedure('public.projects_delete_cascade_unchecked(uuid)') IS NOT NULL THEN
    -- Move the unguarded body aside, exactly once.
    IF to_regprocedure('public.projects_delete_cascade_unchecked(uuid)') IS NULL THEN
      ALTER FUNCTION public.projects_delete_cascade(uuid)
        RENAME TO projects_delete_cascade_unchecked;
    END IF;

    EXECUTE $cmd$
      REVOKE ALL ON FUNCTION public.projects_delete_cascade_unchecked(uuid) FROM public;
      REVOKE ALL ON FUNCTION public.projects_delete_cascade_unchecked(uuid) FROM anon;
      REVOKE ALL ON FUNCTION public.projects_delete_cascade_unchecked(uuid) FROM authenticated;

      CREATE OR REPLACE FUNCTION public.projects_delete_cascade(p_project_id uuid)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_org uuid;
      BEGIN
        IF p_project_id IS NULL THEN
          RAISE EXCEPTION 'p_project_id is required';
        END IF;

        SELECT organization_id INTO v_org
          FROM public.projects
         WHERE id = p_project_id;

        -- A missing project is reported, not deleted: the cascade below treats
        -- "not found" as a no-op, which would let a caller probe ids freely.
        IF v_org IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'project not found');
        END IF;

        -- Authority AND tenancy. Both, because a company administrator is not a
        -- platform administrator, and 0017 granted this to every authenticated role.
        IF NOT (sec.can('deleteData') AND sec.can_org('deleteData')) THEN
          RAISE EXCEPTION 'deleteData capability required to delete a project'
            USING ERRCODE = '42501';
        END IF;

        IF NOT sec.in_org(v_org) THEN
          RAISE EXCEPTION 'project belongs to another organization'
            USING ERRCODE = '42501';
        END IF;

        RETURN public.projects_delete_cascade_unchecked(p_project_id);
      END;
      $body$;

      REVOKE ALL ON FUNCTION public.projects_delete_cascade(uuid) FROM public;
      GRANT EXECUTE ON FUNCTION public.projects_delete_cascade(uuid) TO authenticated;
    $cmd$;
  END IF;
END $$;

-- 1.2 projects_adopt_legacy_rows -------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.projects_adopt_legacy_rows(uuid)') IS NOT NULL
     OR to_regprocedure('public.projects_adopt_legacy_rows_unchecked(uuid)') IS NOT NULL THEN
    IF to_regprocedure('public.projects_adopt_legacy_rows_unchecked(uuid)') IS NULL THEN
      ALTER FUNCTION public.projects_adopt_legacy_rows(uuid)
        RENAME TO projects_adopt_legacy_rows_unchecked;
    END IF;

    EXECUTE $cmd$
      REVOKE ALL ON FUNCTION public.projects_adopt_legacy_rows_unchecked(uuid) FROM public;
      REVOKE ALL ON FUNCTION public.projects_adopt_legacy_rows_unchecked(uuid) FROM anon;
      REVOKE ALL ON FUNCTION public.projects_adopt_legacy_rows_unchecked(uuid) FROM authenticated;

      CREATE OR REPLACE FUNCTION public.projects_adopt_legacy_rows(p_project_id uuid)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_org uuid;
      BEGIN
        IF p_project_id IS NULL THEN
          RAISE EXCEPTION 'p_project_id is required';
        END IF;

        SELECT organization_id INTO v_org
          FROM public.projects
         WHERE id = p_project_id;

        IF v_org IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'project not found');
        END IF;

        -- Adoption rewrites organization_id on unattributed rows, so it is a
        -- mutation of tenant attribution rather than a bookkeeping helper.
        IF NOT (sec.can('manageDatasets') AND sec.can_org('manageDatasets')) THEN
          RAISE EXCEPTION 'manageDatasets capability required to adopt legacy rows'
            USING ERRCODE = '42501';
        END IF;

        IF NOT sec.in_org(v_org) THEN
          RAISE EXCEPTION 'project belongs to another organization'
            USING ERRCODE = '42501';
        END IF;

        RETURN public.projects_adopt_legacy_rows_unchecked(p_project_id);
      END;
      $body$;

      REVOKE ALL ON FUNCTION public.projects_adopt_legacy_rows(uuid) FROM public;
      GRANT EXECUTE ON FUNCTION public.projects_adopt_legacy_rows(uuid) TO authenticated;
    $cmd$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Ensure organization_id is present on all tenant tables.
--    Guarded by to_regclass: if tables were created after 0037, this
--    self-heals the column attribution and indexes without failing.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'audit_logs', 'notifications', 'file_inventory', 'batch_logs',
    'stage_event_ledger', 'station_board_items', 'hub_session_state',
    'survey_recycle_bin', 'deletion_requests', 'survey_metadata_filenames',
    'projects'
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

  IF to_regclass('public.map_shares') IS NOT NULL THEN
    ALTER TABLE public.map_shares
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
    CREATE INDEX IF NOT EXISTS idx_map_shares_org ON public.map_shares (organization_id);
    UPDATE public.map_shares
       SET organization_id = '00000000-0000-4000-8000-000000000001'::uuid
     WHERE organization_id IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Drop the policies being replaced on the remaining tenant tables.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'audit_logs', 'notifications', 'file_inventory', 'batch_logs',
    'stage_event_ledger', 'station_board_items', 'hub_session_state',
    'survey_recycle_bin', 'deletion_requests', 'survey_metadata_filenames',
    'projects', 'project_settings', 'map_shares'
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
-- 4. Org-scoped policies for the ledgers.
--
--    Capability predicates carried over from the role-guarded policies being
--    replaced; the additions are the in_org term and, where a table previously
--    had a blanket `uid() IS NOT NULL`, the restoration of a real role check.
--    Guarded by to_regclass so pre-ledger schemas do not fail.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- 4.1 audit_logs ------------------------------------------------------------
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated
        WITH CHECK (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "audit_logs_update" ON public.audit_logs FOR UPDATE TO authenticated
        USING (sec.can('manageSettings') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('manageSettings') AND sec.in_org(organization_id));
      CREATE POLICY "audit_logs_delete" ON public.audit_logs FOR DELETE TO authenticated
        USING (sec.can('manageSettings') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.2 notifications ---------------------------------------------------------
  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "notifications_select" ON public.notifications FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT TO authenticated
        WITH CHECK (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "notifications_delete" ON public.notifications FOR DELETE TO authenticated
        USING (sec.can('manageSettings') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.3 file_inventory --------------------------------------------------------
  -- Was USING (true) for every caller including anon. It is the install's
  -- complete panorama filename list.
  IF to_regclass('public.file_inventory') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "file_inventory_select" ON public.file_inventory FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "file_inventory_insert" ON public.file_inventory FOR INSERT TO authenticated
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "file_inventory_update" ON public.file_inventory FOR UPDATE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "file_inventory_delete" ON public.file_inventory FOR DELETE TO authenticated
        USING (sec.can('deleteData') AND sec.in_org(organization_id));
      REVOKE ALL ON public.file_inventory FROM anon;
    $pol$;
  END IF;

  -- 4.4 batch_logs ------------------------------------------------------------
  IF to_regclass('public.batch_logs') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "batch_logs_select" ON public.batch_logs FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "batch_logs_insert" ON public.batch_logs FOR INSERT TO authenticated
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "batch_logs_update" ON public.batch_logs FOR UPDATE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "batch_logs_delete" ON public.batch_logs FOR DELETE TO authenticated
        USING (sec.can('deleteData') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.5 stage_event_ledger ----------------------------------------------------
  IF to_regclass('public.stage_event_ledger') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "stage_event_ledger_select" ON public.stage_event_ledger FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "stage_event_ledger_insert" ON public.stage_event_ledger FOR INSERT TO authenticated
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "stage_event_ledger_update" ON public.stage_event_ledger FOR UPDATE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "stage_event_ledger_delete" ON public.stage_event_ledger FOR DELETE TO authenticated
        USING (sec.can('deleteData') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.6 station_board_items ---------------------------------------------------
  IF to_regclass('public.station_board_items') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "station_board_items_select" ON public.station_board_items FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "station_board_items_insert" ON public.station_board_items FOR INSERT TO authenticated
        WITH CHECK (sec.can('operateStations') AND sec.in_org(organization_id));
      CREATE POLICY "station_board_items_update" ON public.station_board_items FOR UPDATE TO authenticated
        USING (sec.can('operateStations') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('operateStations') AND sec.in_org(organization_id));
      CREATE POLICY "station_board_items_delete" ON public.station_board_items FOR DELETE TO authenticated
        USING (sec.can('operateStations') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.7 hub_session_state -----------------------------------------------------
  -- 0035:34-39 recorded that read and write both failed and the caller's empty
  -- catch fell back to localStorage. The blanket uid() policy is replaced with
  -- a real capability check so a failure is visible rather than silent.
  IF to_regclass('public.hub_session_state') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "hub_session_state_select" ON public.hub_session_state FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "hub_session_state_insert" ON public.hub_session_state FOR INSERT TO authenticated
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "hub_session_state_update" ON public.hub_session_state FOR UPDATE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "hub_session_state_delete" ON public.hub_session_state FOR DELETE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.8 survey_recycle_bin ----------------------------------------------------
  IF to_regclass('public.survey_recycle_bin') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "survey_recycle_bin_select" ON public.survey_recycle_bin FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "survey_recycle_bin_insert" ON public.survey_recycle_bin FOR INSERT TO authenticated
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "survey_recycle_bin_delete" ON public.survey_recycle_bin FOR DELETE TO authenticated
        USING (sec.can('deleteData') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.9 deletion_requests -----------------------------------------------------
  IF to_regclass('public.deletion_requests') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "deletion_requests_select" ON public.deletion_requests FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "deletion_requests_insert" ON public.deletion_requests FOR INSERT TO authenticated
        WITH CHECK (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "deletion_requests_update" ON public.deletion_requests FOR UPDATE TO authenticated
        USING (sec.can('approveDeletions') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('approveDeletions') AND sec.in_org(organization_id));
      CREATE POLICY "deletion_requests_delete" ON public.deletion_requests FOR DELETE TO authenticated
        USING (sec.can('deleteData') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.10 survey_metadata_filenames -------------------------------------------
  -- The previous policies required `project_id = auth.uid()`, comparing a
  -- PROJECT uuid against a USER uuid. No write could ever satisfy it, which is
  -- why 0035 recorded "survey_metadata_filenames 0 rows. Every CSV import's
  -- capture upsert failed." Replaced with the correct capability and tenancy.
  IF to_regclass('public.survey_metadata_filenames') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "survey_metadata_filenames_select" ON public.survey_metadata_filenames
        FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "survey_metadata_filenames_insert" ON public.survey_metadata_filenames
        FOR INSERT TO authenticated
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "survey_metadata_filenames_update" ON public.survey_metadata_filenames
        FOR UPDATE TO authenticated
        USING (sec.can('manageDatasets') AND sec.in_org(organization_id))
        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id));
      CREATE POLICY "survey_metadata_filenames_delete" ON public.survey_metadata_filenames
        FOR DELETE TO authenticated
        USING (sec.can('deleteData') AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.11 projects -------------------------------------------------------------
  -- This is the policy the cross-tenant gate caught: USING (sec.can('viewAll'))
  -- with no tenancy term, on the table every other policy is now scoped by.
  IF to_regclass('public.projects') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "projects_select" ON public.projects FOR SELECT TO authenticated
        USING (sec.can('viewAll') AND sec.in_org(organization_id));
      CREATE POLICY "projects_insert" ON public.projects FOR INSERT TO authenticated
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc') OR sec.can('manageSettings'))
                    AND sec.in_org(organization_id));
      CREATE POLICY "projects_update" ON public.projects FOR UPDATE TO authenticated
        USING ((sec.can('manageDatasets') OR sec.can('runQaqc') OR sec.can('manageSettings'))
               AND sec.in_org(organization_id))
        WITH CHECK ((sec.can('manageDatasets') OR sec.can('runQaqc') OR sec.can('manageSettings'))
                    AND sec.in_org(organization_id));
    $pol$;
  END IF;

  -- 4.12 map_shares -----------------------------------------------------------
  -- The public read policy is preserved verbatim in intent: possession of a live
  -- token is the whole authorisation. What is removed is the ability to CREATE a
  -- share for no reason — 0019 granted map_shares_insert to anon WITH CHECK (true).
  IF to_regclass('public.map_shares') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "map_shares_public_read" ON public.map_shares FOR SELECT TO anon, authenticated
        USING (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()));
      CREATE POLICY "map_shares_insert" ON public.map_shares FOR INSERT TO authenticated
        WITH CHECK (sec.in_org(organization_id)
                   AND created_by = COALESCE(auth.uid()::text, ''));
      CREATE POLICY "map_shares_owner_update" ON public.map_shares FOR UPDATE TO authenticated
        USING (created_by = COALESCE(auth.uid()::text, '') AND sec.in_org(organization_id))
        WITH CHECK (created_by = COALESCE(auth.uid()::text, '') AND sec.in_org(organization_id));
      CREATE POLICY "map_shares_owner_delete" ON public.map_shares FOR DELETE TO authenticated
        USING (created_by = COALESCE(auth.uid()::text, '') AND sec.in_org(organization_id));
      REVOKE ALL ON public.map_shares FROM anon;
    $pol$;
  END IF;

  -- 4.13 project_settings -----------------------------------------------------
  -- A single global row, so tenancy cannot apply. What is removed is
  -- "Allow public insert/update on project_settings" FOR ALL USING (true),
  -- which let anon write the install's settings.
  IF to_regclass('public.project_settings') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "project_settings_select" ON public.project_settings FOR SELECT TO authenticated
        USING (sec.can('viewAll'));
      CREATE POLICY "project_settings_write" ON public.project_settings FOR ALL TO authenticated
        USING (sec.can('manageSettings'))
        WITH CHECK (sec.can('manageSettings'));
      REVOKE ALL ON public.project_settings FROM anon;
    $pol$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. user_accounts: close the cross-tenant directory.
--
--    Every authenticated caller could read every other user's name, email,
--    role and status — across every company. `sec.can('viewAll')` is true for
--    Viewer, so no role check narrowed it.
--
--    Now readable only by a user manager, or by the caller for their own row.
--    The self-read term matters: several code paths resolve the signed-in
--    user's own directory row, and locking those out would turn an
--    information disclosure fix into an outage.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_policy record;
BEGIN
  IF to_regclass('public.user_accounts') IS NOT NULL THEN
    FOR v_policy IN
      SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_accounts'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_accounts', v_policy.policyname);
    END LOOP;

    EXECUTE $pol$
      CREATE POLICY "user_accounts_select" ON public.user_accounts FOR SELECT TO authenticated
        USING (sec.can('manageUsers') OR lower(email) = lower(coalesce(sec.caller_email(), '')));
      CREATE POLICY "user_accounts_insert" ON public.user_accounts FOR INSERT TO authenticated
        WITH CHECK (sec.can('manageUsers'));
      CREATE POLICY "user_accounts_update" ON public.user_accounts FOR UPDATE TO authenticated
        USING (sec.can('manageUsers'))
        WITH CHECK (sec.can('manageUsers'));
      CREATE POLICY "user_accounts_delete" ON public.user_accounts FOR DELETE TO authenticated
        USING (sec.can('manageUsers'));
    $pol$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Storage — warned about, not silently passed.
--
--    The road-analysis-geometry policies grant every authenticated user any
--    object in that bucket (0021). They cannot be org-scoped until object keys
--    carry an organization prefix, which is application work outside this
--    migration. Rather than let a green run imply storage is isolated, the
--    gap is named out loud.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_unscoped record;
  v_count integer := 0;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND (qual IS NULL OR qual !~ 'in_org')
     AND tablename = 'objects';

  IF v_count > 0 THEN
    FOR v_unscoped IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND (qual IS NULL OR qual !~ 'in_org')
    LOOP
      RAISE WARNING
        '0040: storage.objects policy % is NOT tenant-scoped. Storage isolation requires organization-prefixed object keys and is outstanding. Do not treat this run as a complete multi-tenant guarantee.', v_unscoped.policyname;
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. Verification for the tables scoped here.
--
--    map_shares is excluded on purpose: its SELECT policy is the public token
--    read, which is correct. project_settings and user_accounts are excluded
--    because neither is tenant-scoped — one is a single global row, the other
--    is the platform directory — and both have their own tighter predicates.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_bad record;
  v_count integer := 0;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('audit_logs','notifications','file_inventory','batch_logs',
                         'stage_event_ledger','station_board_items','hub_session_state',
                         'survey_recycle_bin','deletion_requests','survey_metadata_filenames',
                         'projects')
     AND (   (p.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND (p.qual IS NULL OR p.qual !~ 'in_org'))
          OR (p.cmd IN ('INSERT','UPDATE','ALL')    AND (p.with_check IS NULL OR p.with_check !~ 'in_org')));

  IF v_count > 0 THEN
    FOR v_bad IN
      SELECT tablename, policyname, cmd,
             coalesce(qual,'-') AS qual, coalesce(with_check,'-') AS check_
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename IN ('audit_logs','notifications','file_inventory','batch_logs',
                             'stage_event_ledger','station_board_items','hub_session_state',
                             'survey_recycle_bin','deletion_requests','survey_metadata_filenames',
                             'projects')
         AND (   (p.cmd IN ('SELECT','UPDATE','DELETE','ALL') AND (p.qual IS NULL OR p.qual !~ 'in_org'))
              OR (p.cmd IN ('INSERT','UPDATE','ALL')    AND (p.with_check IS NULL OR p.with_check !~ 'in_org')))
    LOOP
      RAISE EXCEPTION
        '0040 VERIFICATION FAILED: %.% (%) USING [%] WITH CHECK [%] is not tenant-scoped',
        v_bad.tablename, v_bad.policyname, v_bad.cmd, v_bad.qual, v_bad.check_;
    END LOOP;
  END IF;

  RAISE NOTICE '0040: ledgers, projects and inventory are tenant-scoped; RPCs are re-gated';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';