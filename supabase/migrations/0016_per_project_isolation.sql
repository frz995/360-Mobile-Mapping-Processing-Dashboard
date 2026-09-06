-- =====================================================================
-- GeoSphere 360 — Full Per-Project Isolation (Migration 0016)
--
-- Gives every operational table a `project_id` column (FK -> projects),
-- rebuilds each unique constraint to lead with `project_id`, creates the
-- missing `batch_logs` baseline, adds scoped indexes, refreshes
-- `panoramas_view` with the new column, and ships a SECURITY DEFINER RPC
-- that adopts legacy (`project_id IS NULL`) rows onto the carried-forward
-- production project at seed time.
--
-- Design notes (v15):
--   * Columns are nullable + added with ALTER ADD COLUMN -> no table scan.
--   * Legacy rows stay NULL until `projects_adopt_legacy_rows` is invoked
--     by the client once per seeded project; the RPC is idempotent.
--   * Uniqueness is enforced per project: a filename / (subgrid, point_id)
--     / (subgrid, run_id) / subgrid_code / (project_id, subgrid) can repeat
--     across projects but never within one.
--   * Real-time channels + all client reads/writes are scoped in the app
--     layer (v15); RLS policy posture is unchanged here (role-guarded).
--
-- Resilience:
--   This migration hardens against partial/older schemas. Every reference
--   to an existing table is guarded with to_regclass(...) so an instance
--   that is missing one of the earlier baseline tables (e.g. 0007's
--   `survey_recycle_bin`) is granted project isolation only on the tables
--   that actually exist, instead of failing outright. PREREQUISITES that
--   must be applied first, in order, so the app has its full table set:
--     0001-0006 baseline, 0007 (survey_recycle_bin, hardening), 0009-0014,
--     and 0015 (projects table + pg_trgm). This script itself is safe to
--   run repeatedly in the Supabase SQL Editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Add project_id to every operational table (guarded per-table:
--    on a partial schema, tables that exist get the column; missing ones
--    are skipped rather than aborting the whole script).
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_tbl text;
    v_tables text[] := ARRAY[
        'panoramas',
        'staging_panoramas',
        'qa_defects',
        'qaqc_audit_runs',
        'subgrids',
        'datasets',
        'processing_jobs',
        'audit_logs',
        'notifications',
        'deletion_requests',
        'survey_recycle_bin',
        'file_inventory'
    ];
BEGIN
    FOREACH v_tbl IN ARRAY v_tables LOOP
        IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id)',
                v_tbl
            );
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Create missing baseline for the `batch_logs` overrides table
--    (pre-v15 this table had NO DDL anywhere — the client wrote it via
--    PostgREST onConflict 'subgrid'. Now it is a first-class table.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.batch_logs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id             UUID REFERENCES public.projects(id),
    subgrid                VARCHAR(50) NOT NULL,
    status                 VARCHAR(50) DEFAULT 'Ongoing',
    pic                    VARCHAR(100) DEFAULT '',
    publish_to_webgis      VARCHAR(30) DEFAULT 'no',
    is_synced_with_supabase BOOLEAN DEFAULT FALSE,
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.batch_logs ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);
ALTER TABLE public.batch_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 3. Rebuild uniqueness with project as the leading key (guarded).
--    Legacy duplicates never collide: NULLs compare as distinct in
--    Postgres unique constraints, and adoption happens via the RPC later.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.qa_defects') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_subgrid_point_id') THEN
            ALTER TABLE public.qa_defects DROP CONSTRAINT unique_subgrid_point_id;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_defects_project_subgrid_point_unique') THEN
            ALTER TABLE public.qa_defects ADD CONSTRAINT qa_defects_project_subgrid_point_unique UNIQUE (project_id, subgrid, point_id);
        END IF;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.qaqc_audit_runs') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_subgrid_run') THEN
            ALTER TABLE public.qaqc_audit_runs DROP CONSTRAINT unique_subgrid_run;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qaqc_audit_runs_project_subgrid_run_unique') THEN
            ALTER TABLE public.qaqc_audit_runs ADD CONSTRAINT qaqc_audit_runs_project_subgrid_run_unique UNIQUE (project_id, subgrid, run_id);
        END IF;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.panoramas') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'panoramas_filename_unique') THEN
            ALTER TABLE public.panoramas DROP CONSTRAINT panoramas_filename_unique;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'panoramas_project_filename_unique') THEN
            ALTER TABLE public.panoramas ADD CONSTRAINT panoramas_project_filename_unique UNIQUE (project_id, filename);
        END IF;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.staging_panoramas') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staging_panoramas_filename_unique') THEN
            ALTER TABLE public.staging_panoramas DROP CONSTRAINT staging_panoramas_filename_unique;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staging_panoramas_project_filename_unique') THEN
            ALTER TABLE public.staging_panoramas ADD CONSTRAINT staging_panoramas_project_filename_unique UNIQUE (project_id, filename);
        END IF;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.subgrids') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subgrids_subgrid_code_key') THEN
            ALTER TABLE public.subgrids DROP CONSTRAINT subgrids_subgrid_code_key;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subgrids_project_code_unique') THEN
            ALTER TABLE public.subgrids ADD CONSTRAINT subgrids_project_code_unique UNIQUE (project_id, subgrid_code);
        END IF;
    END IF;
END $$;

DO $$
BEGIN
    -- batch_logs already created above in this script.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_logs_project_subgrid_unique') THEN
        ALTER TABLE public.batch_logs ADD CONSTRAINT batch_logs_project_subgrid_unique UNIQUE (project_id, subgrid);
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Per-project indexes for every scoped table (guarded).
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_tab text;
    v_sql text;
    v_item text;
    v_items text[] := ARRAY[
        'panoramas|CREATE INDEX IF NOT EXISTS idx_panoramas_project_id          ON public.panoramas (project_id)',
        'staging_panoramas|CREATE INDEX IF NOT EXISTS idx_staging_panoramas_project_id  ON public.staging_panoramas (project_id)',
        'qa_defects|CREATE INDEX IF NOT EXISTS idx_qa_defects_project_id         ON public.qa_defects (project_id)',
        'qa_defects|CREATE INDEX IF NOT EXISTS idx_qa_defects_project_subgrid    ON public.qa_defects (project_id, subgrid)',
        'qaqc_audit_runs|CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_project_id    ON public.qaqc_audit_runs (project_id)',
        'subgrids|CREATE INDEX IF NOT EXISTS idx_subgrids_project_id           ON public.subgrids (project_id)',
        'datasets|CREATE INDEX IF NOT EXISTS idx_datasets_project_id           ON public.datasets (project_id)',
        'processing_jobs|CREATE INDEX IF NOT EXISTS idx_processing_jobs_project_id    ON public.processing_jobs (project_id)',
        'audit_logs|CREATE INDEX IF NOT EXISTS idx_audit_logs_project_id         ON public.audit_logs (project_id)',
        'notifications|CREATE INDEX IF NOT EXISTS idx_notifications_project_id      ON public.notifications (project_id)',
        'deletion_requests|CREATE INDEX IF NOT EXISTS idx_deletion_requests_project_id  ON public.deletion_requests (project_id)',
        'survey_recycle_bin|CREATE INDEX IF NOT EXISTS idx_recycle_bin_project_id        ON public.survey_recycle_bin (project_id)',
        'file_inventory|CREATE INDEX IF NOT EXISTS idx_file_inventory_project_id     ON public.file_inventory (project_id)',
        'file_inventory|CREATE INDEX IF NOT EXISTS idx_file_inventory_project_bucket ON public.file_inventory (project_id, bucket, filename)',
        'batch_logs|CREATE INDEX IF NOT EXISTS idx_batch_logs_project_id         ON public.batch_logs (project_id)',
        'batch_logs|CREATE INDEX IF NOT EXISTS idx_batch_logs_project_subgrid    ON public.batch_logs (project_id, subgrid)'
    ];
BEGIN
    FOREACH v_item IN ARRAY v_items LOOP
        v_tab := split_part(v_item, '|', 1);
        v_sql := split_part(v_item, '|', 2);
        IF to_regclass('public.' || v_tab) IS NOT NULL THEN
            EXECUTE v_sql;
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. Refresh panoramas_view so per-project filters can run against it.
--    Built DYNAMICALLY from the columns that actually exist on `panoramas`:
--    legacy/partial instances may lack e.g. `subgrid` (a static definition
--    would abort with 42703). The v15 requirement is that `project_id` is
--    exposed so the client's scoped read (project_id=eq.<id>) works — it
--    is, since every existing column is carried through. `lat`/`lon`
--    alias `latitude`/`longitude` only when those base columns exist.
--
--    NOTE on 42P16: the existing view may be stale — created over an
--    earlier incarnation of `panoramas` that had MORE columns than the
--    current table. CREATE OR REPLACE VIEW cannot DROP columns (42P16),
--    so the view is DROPPED first and recreated from the CURRENT columns.
-- ---------------------------------------------------------------------
DO $view$
DECLARE
    v_cols  text;
    v_where text;
BEGIN
    IF to_regclass('public.panoramas') IS NULL THEN
        RAISE NOTICE 'panoramas_view skipped: public.panoramas does not exist';
        RETURN;
    END IF;

    DROP VIEW IF EXISTS public.panoramas_view;

    SELECT string_agg('p.' || quote_ident(column_name) || ' AS ' || quote_ident(column_name), E',\n' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'panoramas'
      AND column_name NOT IN ('lat', 'lon');

    IF v_cols IS NULL OR v_cols = '' THEN
        RAISE NOTICE 'panoramas_view skipped: panoramas has no columns';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'latitude') THEN
        v_cols := v_cols || E',\n' || 'p.latitude AS lat';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'longitude') THEN
        v_cols := v_cols || E',\n' || 'p.longitude AS lon';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'status')
       AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'qa_status') THEN
        v_where := 'p.status = ''yes'' OR p.qa_status = ''published''';
    ELSE
        v_where := 'true';
    END IF;

    EXECUTE 'CREATE VIEW public.panoramas_view WITH (security_invoker = true) AS '
            || 'SELECT ' || v_cols || ' FROM public.panoramas p WHERE ' || v_where;
END;
$view$;

-- ---------------------------------------------------------------------
-- 6. SECURITY DEFINER RPC: adopt legacy NULL rows onto a project.
--    Every table's UPDATE is guarded so a partial schema is still served
--    a stable JSON result (missing tables report an adopted count of 0).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projects_adopt_legacy_rows(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_locked       boolean;
    v_result       jsonb;
    v_adopted      bigint;
BEGIN
    IF p_project_id IS NULL THEN
        RAISE EXCEPTION 'p_project_id is required';
    END IF;

    -- Only ever run once per project: the seeded (carried-forward) project.
    -- A project that was created fresh (post-v15) must NOT inherit anyone's
    -- legacy rows, so refuse when any project_id IS NULL row has already been
    -- claimed by another project (i.e. re-running after a different project
    -- adopted would otherwise re-home rows already stamped by mistake).
    SELECT EXISTS (
        SELECT 1
        FROM public.panoramas
        WHERE project_id IS NOT NULL
          AND project_id <> p_project_id
        LIMIT 1
    ) INTO v_locked;

    IF v_locked THEN
        RETURN jsonb_build_object(
            'ok', false,
            'reason', 'legacy rows already adopted by another project'
        );
    END IF;

    v_result := '{}'::jsonb;

    -- One UPDATE per table; NULL project_id can only match original legacy rows.
    IF to_regclass('public.panoramas') IS NOT NULL THEN
        UPDATE public.panoramas            SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('panoramas', v_adopted);

    IF to_regclass('public.staging_panoramas') IS NOT NULL THEN
        UPDATE public.staging_panoramas    SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('staging_panoramas', v_adopted);

    IF to_regclass('public.qa_defects') IS NOT NULL THEN
        UPDATE public.qa_defects           SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('qa_defects', v_adopted);

    IF to_regclass('public.qaqc_audit_runs') IS NOT NULL THEN
        UPDATE public.qaqc_audit_runs      SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('qaqc_audit_runs', v_adopted);

    IF to_regclass('public.subgrids') IS NOT NULL THEN
        UPDATE public.subgrids             SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('subgrids', v_adopted);

    IF to_regclass('public.datasets') IS NOT NULL THEN
        UPDATE public.datasets             SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('datasets', v_adopted);

    IF to_regclass('public.processing_jobs') IS NOT NULL THEN
        UPDATE public.processing_jobs      SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('processing_jobs', v_adopted);

    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        UPDATE public.audit_logs           SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('audit_logs', v_adopted);

    IF to_regclass('public.notifications') IS NOT NULL THEN
        UPDATE public.notifications        SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('notifications', v_adopted);

    IF to_regclass('public.deletion_requests') IS NOT NULL THEN
        UPDATE public.deletion_requests    SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('deletion_requests', v_adopted);

    IF to_regclass('public.survey_recycle_bin') IS NOT NULL THEN
        UPDATE public.survey_recycle_bin   SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('survey_recycle_bin', v_adopted);

    IF to_regclass('public.file_inventory') IS NOT NULL THEN
        UPDATE public.file_inventory       SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('file_inventory', v_adopted);

    IF to_regclass('public.batch_logs') IS NOT NULL THEN
        UPDATE public.batch_logs           SET project_id = p_project_id WHERE project_id IS NULL;
        GET DIAGNOSTICS v_adopted = ROW_COUNT;
    ELSE
        v_adopted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('batch_logs', v_adopted);

    RETURN jsonb_build_object('ok', true, 'adopted', v_result);
END;
$$;

-- Guests (anon) never run adoption; authenticated roles may.
REVOKE ALL ON FUNCTION public.projects_adopt_legacy_rows(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.projects_adopt_legacy_rows(uuid) TO authenticated;

-- =====================================================================
-- ROLLBACK / SUPPORTED VERSIONS
--   All statements are additive / guarded. To revert:
--     DROP FUNCTION public.projects_adopt_legacy_rows(uuid);
--     DROP TABLE IF EXISTS public.batch_logs;
--     -- per table:
--     ALTER TABLE public.<t> DROP COLUMN project_id;
--     -- restore old uniqueness dropping the new constraints first.
--   Supported versions: Supabase (Postgres 15), schema 'public'.
--   Safe to re-run.
-- =====================================================================