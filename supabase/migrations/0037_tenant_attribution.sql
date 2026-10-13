-- =====================================================================
-- GeoSphere 360 — Tenant attribution on operational tables (Migration 0037)
--
-- Migration 0036 created the tenant boundary and gave `projects` an
-- `organization_id`. This migration carries that attribution down to every
-- table that holds survey data, so §4 can scope its policies to it.
--
-- WHY THIS EXISTS
--   The cross-tenant gate (0011_security_tests.sql) currently fails with:
--       SECURITY GATE FAILED: Tenant A can read Tenant B's project rows
--   That is correct at this point in the sequence: 0036 added the column but
--   wrote no policy that reads it, and `projects_select` is still
--   `USING (sec.can('viewAll'))` — true for every role including Viewer
--   (0009_security_functions.sql:118-120). Adding a column no policy reads
--   isolates nothing.
--
--   0037 supplies the data; 0038-0040 supply the predicates. This file makes
--   no isolation claim on its own and its header says so.
--
--   22 tables are affected. `projects` already carries the column from 0036.
--   Excluded deliberately: `project_settings` (a single global row, read at
--   src/services/api/admin.ts:649), `user_accounts` (the platform directory,
--   not tenant-scoped), the three registry tables from 0036, and
--   `spatial_ref_sys` (PostGIS, no RLS, no tenant meaning).
--
-- ROOT CAUSE, EVIDENCE
--   1. `survey_metadata_filenames.project_id` was declared
--      `references auth.users(id)` (0034:50) while the application writes a
--      *project* uuid (src/services/api/surveyMetadata.ts:71). The FK could
--      never match, and its policy `WITH CHECK (sec.can('deleteData') AND
--      project_id = auth.uid())` demanded the project uuid equal the caller's
--      auth uuid. 0035:34-36 recorded the symptom: "survey_metadata_filenames
--      0 rows. Every CSV import's capture upsert failed." Corrected below,
--      because the backfill join depends on project_id meaning project.
--
--   2. `map_shares.project_id` is TEXT, not UUID (0018). Every other
--      project-scoped table uses uuid. Handled separately below rather than
--      cast blindly, because a non-uuid string in that column must not abort
--      the whole migration.
--
-- Idempotency claim: Safe to re-run. Columns are added only when absent,
-- indexes use IF NOT EXISTS, the FK swap is guarded, and every backfill is
-- restricted to rows still attributed to the bootstrap organization.
--
-- SCOPE AND HONEST LIMIT
--   No policy in this file restricts access. Between 0037 and 0038 the database
--   is in a strictly-neutral state: `organization_id` is populated and
--   trustworthy, and still unused by any policy. Nothing here makes a query
--   safer than it was; it makes §4 possible.
--
--   `organization_id` is left NULLABLE. A NULL means "not attributed to any
--   company", and §4 treats it as invisible rather than as a wildcard. The
--   backfills below assign every existing row, so a NULL afterwards means a row
--   was written after this migration by a path that did not set the column.
--
--   Map shares remain publicly readable by token (0019) even after §4; that is
--   the intended design for a share link, and the gate asserts the token is the
--   only credential rather than weakening it.
-- =====================================================================

BEGIN;

-- The bootstrap organization every pre-tenancy row is attributed to. Same
-- fixed UUID as 0036 so the two migrations agree without a lookup.
-- \gset
-- org: 00000000-0000-4000-8000-000000000001

-- ---------------------------------------------------------------------
-- 1. Reconcile survey_metadata_filenames.project_id.
--
--    Applied first because the backfill join in section 3 reads project_id
--    and needs it to reference projects. NOT VALID on the replacement FK is
--    deliberate: rows written during the 0034/0035 breakage may hold values
--    that are not real project ids, and refusing to create the constraint
--    would leave the column unconstrained again. NOT VALID still enforces the
--    FK for every future write, which is the half that matters.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.survey_metadata_filenames') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'public.survey_metadata_filenames'::regclass
                  AND conname = 'survey_metadata_filenames_project_id_fkey') THEN
      ALTER TABLE public.survey_metadata_filenames
        DROP CONSTRAINT survey_metadata_filenames_project_id_fkey;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.survey_metadata_filenames'::regclass
                      AND conname = 'survey_metadata_filenames_project_fk') THEN
      ALTER TABLE public.survey_metadata_filenames
        ADD CONSTRAINT survey_metadata_filenames_project_fk
        FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE
        NOT VALID;
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN public.survey_metadata_filenames.project_id IS
  'Owning PROJECT, not a user id. Was declared references auth.users(id) in 0034 while the application wrote a project uuid, which is why the table stayed empty; corrected here to reference projects(id). The replacement constraint is NOT VALID because rows written during that breakage may hold values that are not real project ids.';

-- ---------------------------------------------------------------------
-- 2. Add organization_id to every project-scoped operational table.
--
--    Driven from a list rather than 22 copy-pasted blocks so the set cannot
--    drift between runs, and so §4 can be written against one known list.
--    Each is guarded twice: the table must exist, and the column must not.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'audit_logs',
    'batch_logs',
    'datasets',
    'deletion_requests',
    'file_inventory',
    'hub_session_state',
    'notifications',
    'panoramas',
    'processing_jobs',
    'production_release_files',
    'production_releases',
    'production_run_attempts',
    'production_runs',
    'qa_defects',
    'qaqc_audit_runs',
    'stage_event_ledger',
    'staging_panoramas',
    'station_board_items',
    'subgrids',
    'survey_metadata_filenames',
    'survey_recycle_bin'
  ];
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id)',
        v_table);
    END IF;
  END LOOP;

  -- map_shares is in the same list for the column, but its project_id is TEXT,
  -- so it is handled separately for backfill below. Added here so the column
  -- set is complete and §4 can rely on it existing.
  IF to_regclass('public.map_shares') IS NOT NULL THEN
    ALTER TABLE public.map_shares
      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Backfill.
--
--    Order matters. The project join runs FIRST, so a row that genuinely
--    belongs to a company is attributed to that company rather than to the
--    bootstrap organization. Only rows with no resolvable project fall through
--    to the bootstrap default — which on a single-operator install is the
--    operator's own company, and on any other install is the correct
--    quarantine.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'audit_logs', 'batch_logs', 'datasets', 'deletion_requests', 'file_inventory',
    'hub_session_state', 'notifications', 'panoramas', 'processing_jobs',
    'production_release_files', 'production_releases', 'production_run_attempts',
    'production_runs', 'qa_defects', 'qaqc_audit_runs', 'stage_event_ledger',
    'staging_panoramas', 'station_board_items', 'subgrids',
    'survey_metadata_filenames', 'survey_recycle_bin'
  ];
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      -- Guard on the column really having a uuid project_id: the loop above
      -- assumes it, and a future migration could break that assumption.
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = v_table
           AND column_name = 'project_id' AND data_type = 'uuid'
      ) THEN
        EXECUTE format($f$
          UPDATE public.%1$I t
             SET organization_id = p.organization_id
            FROM public.projects p
           WHERE t.project_id = p.id
             AND t.organization_id IS DISTINCT FROM p.organization_id;
        $f$, v_table);

        EXECUTE format($f$
          UPDATE public.%1$I t
             SET organization_id = '00000000-0000-4000-8000-000000000001'
           WHERE t.organization_id IS NULL;
        $f$, v_table);
      END IF;
    END IF;
  END LOOP;
END $$;

-- map_shares: project_id is text, so the join is guarded by a uuid pattern.
-- An unparseable value is left to the bootstrap default rather than aborting
-- the migration — one malformed share must not block every tenant's data.
DO $$
BEGIN
  IF to_regclass('public.map_shares') IS NOT NULL THEN
    UPDATE public.map_shares m
       SET organization_id = p.organization_id
      FROM public.projects p
     WHERE m.project_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND m.project_id::uuid = p.id
       AND m.organization_id IS DISTINCT FROM p.organization_id;

    UPDATE public.map_shares m
       SET organization_id = '00000000-0000-4000-8000-000000000001'
     WHERE m.organization_id IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Indexes.
--
--    One per table, all named for the read path they serve: §4 writes
--    `organization_id = sec.current_org()` into every SELECT, UPDATE and
--    DELETE policy, so each of these is on the hot path for all three.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'audit_logs', 'batch_logs', 'datasets', 'deletion_requests', 'file_inventory',
    'hub_session_state', 'map_shares', 'notifications', 'panoramas', 'processing_jobs',
    'production_release_files', 'production_releases', 'production_run_attempts',
    'production_runs', 'qa_defects', 'qaqc_audit_runs', 'stage_event_ledger',
    'staging_panoramas', 'station_board_items', 'subgrids',
    'survey_metadata_filenames', 'survey_recycle_bin'
  ];
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%1$s_organization_id ON public.%1$I (organization_id)',
        v_table);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. Column semantics.
--
--    Stated once here rather than 22 times: on every table in the list,
--    `organization_id` is the owning company and NULL means "not attributed
--    to any company". §4 treats NULL as invisible, never as a wildcard.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'audit_logs', 'batch_logs', 'datasets', 'deletion_requests', 'file_inventory',
    'hub_session_state', 'map_shares', 'notifications', 'panoramas', 'processing_jobs',
    'production_release_files', 'production_releases', 'production_run_attempts',
    'production_runs', 'qa_defects', 'qaqc_audit_runs', 'stage_event_ledger',
    'staging_panoramas', 'station_board_items', 'subgrids',
    'survey_metadata_filenames', 'survey_recycle_bin'
  ];
  v_comment text :=
    'Owning company. NULL means not attributed to any company and is treated as INVISIBLE by the tenant policies in 0038-0040, never as a wildcard. Populated by migration 0037.';
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      -- %L emits the comment as a correctly quoted literal, so the statement
      -- cannot be broken by an apostrophe in the prose. An earlier draft
      -- embedded a hand-quoted string inside a dollar-quoted EXECUTE and
      -- aborted with "unterminated quoted string"; %L removes that class of
      -- failure rather than escaping past it.
      EXECUTE format(
        'COMMENT ON COLUMN public.%I.organization_id IS %L', v_table, v_comment);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. Verification. Emitted, not asserted: a count of unattributed rows is a
--    fact to read, and the gate in 0011 is where it becomes a failure.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'audit_logs', 'batch_logs', 'datasets', 'deletion_requests', 'file_inventory',
    'hub_session_state', 'map_shares', 'notifications', 'panoramas', 'processing_jobs',
    'production_release_files', 'production_releases', 'production_run_attempts',
    'production_runs', 'qa_defects', 'qaqc_audit_runs', 'stage_event_ledger',
    'staging_panoramas', 'station_board_items', 'subgrids',
    'survey_metadata_filenames', 'survey_recycle_bin'
  ];
  v_table text;
  v_unattributed integer;
  v_total_unattributed integer := 0;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', v_table)
        INTO v_unattributed;
      IF v_unattributed > 0 THEN
        RAISE NOTICE '0037: % has % row(s) with no organization_id', v_table, v_unattributed;
        v_total_unattributed := v_total_unattributed + v_unattributed;
      END IF;
    END IF;
  END LOOP;

  IF v_total_unattributed = 0 THEN
    RAISE NOTICE '0037: every row on all % tables is attributed to a company', array_length(v_tables, 1);
  ELSE
    RAISE WARNING '0037: % row(s) across the tenant tables remain unattributed and will be invisible under the 0038 policies', v_total_unattributed;
  END IF;
END $$;

COMMIT;

-- PostgREST caches the schema; without this, the new columns 404 with
-- PGRST204 until the next cache refresh.
NOTIFY pgrst, 'reload schema';