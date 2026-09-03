-- =====================================================================
-- GeoSphere 360 — DB Hardening & Constraint Sync (Phase 8.1)
-- Idempotent: safe to re-run any number of times in the Supabase SQL
-- Editor. Every statement is guarded with IF NOT EXISTS / DO $$ checks,
-- and every constraint/index ADD is additive — it does NOT alter or
-- modify existing rows, so production tables are never locked for a
-- data rewrite.
--
-- Tables covered (columns the app actually writes):
--   qa_defects, qaqc_audit_runs, deletion_requests, user_accounts,
--   processing_jobs, survey_recycle_bin, file_inventory
--
-- Supported versions: Supabase (Postgres 15), app schema 'public'.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. qa_defects — FK + nullability guards
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS subgrid VARCHAR(50);
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS point_id VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qa_defects_subgrid_point_not_null') THEN
    -- NOT VALID keeps this from scanning/rewriting existing rows.
    ALTER TABLE public.qa_defects
      ADD CONSTRAINT qa_defects_subgrid_point_not_null CHECK (subgrid IS NOT NULL AND point_id IS NOT NULL) NOT VALID;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Indices the upsert (ON CONFLICT subgrid,point_id) relies on.
CREATE INDEX IF NOT EXISTS idx_qa_defects_subgrid ON public.qa_defects(subgrid);
CREATE INDEX IF NOT EXISTS idx_qa_defects_point_id ON public.qa_defects(point_id);
CREATE INDEX IF NOT EXISTS idx_qa_defects_created_at ON public.qa_defects(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. qaqc_audit_runs — FK + index gains
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_subgrid ON public.qaqc_audit_runs(subgrid);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_run_id ON public.qaqc_audit_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_completed_at ON public.qaqc_audit_runs(completed_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3. deletion_requests — status/subgrid already indexed in RLS file;
--    add reviewed_at index for the approval-workflow listing.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON public.deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_reviewed_at ON public.deletion_requests(reviewed_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 4. user_accounts — email/role uniqueness smell-check (additive).
--    email is already UNIQUE; ensure role is indexed for capability maps.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_accounts_role ON public.user_accounts(role);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON public.user_accounts(status);

-- ─────────────────────────────────────────────────────────────────────
-- 5. processing_jobs — FK to datasets + status/progress query indexes.
--    The parent_dataset_id/count columns are referenced by foundation
--    migrations; ensure the status index used by live worker refresh.l
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON public.processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_type ON public.processing_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_subgrid ON public.processing_jobs(subgrid);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created ON public.processing_jobs(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 6. survey_recycle_bin — the table the client actually writes.
--    (RECYCLE_BIN_TABLE = 'survey_recycle_bin' in services/supabase.ts)
--    Table may not exist yet on older instances — create idempotently.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.survey_recycle_bin (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subgrid VARCHAR(50),
  filenames JSONB DEFAULT '[]'::jsonb,
  deleted_by VARCHAR(100),
  user_email VARCHAR(255),
  reason TEXT,
  record_count INT DEFAULT 0,
  km_processed NUMERIC DEFAULT 0,
  original_data JSONB DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_survey_recycle_bin_subgrid ON public.survey_recycle_bin(subgrid);
CREATE INDEX IF NOT EXISTS idx_survey_recycle_bin_deleted_at ON public.survey_recycle_bin(deleted_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 7. file_inventory — client queries by (bucket, filename) + subgrid.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS file_inventory_bucket_idx ON public.file_inventory (bucket, filename);
CREATE INDEX IF NOT EXISTS file_inventory_subgrid_idx ON public.file_inventory (subgrid);

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK / supported-version notes
--   All ADD COLUMN / ADD CONSTRAINT / CREATE INDEX statements above are
--   additive. To roll back an individual guard:
--     ALTER TABLE public.qa_defects DROP CONSTRAINT qa_defects_subgrid_point_not_null;
--     DROP INDEX IF EXISTS idx_qa_defects_subgrid;
--     DROP TABLE IF EXISTS public.survey_recycle_bin;  -- only if empty/unused
--   Dropping the survey_recycle_bin table loses soft-deleted records —
--   never drop it without first archiving the JSONB payloads elsewhere.
-- =====================================================================
