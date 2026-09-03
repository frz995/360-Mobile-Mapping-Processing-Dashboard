-- =====================================================================
-- Migration Script: Foundation Processing Center (Handoff & QA columns)
-- Run this AFTER foundation_production_migration.sql in Supabase SQL Editor.
-- Additive ALTERs on processing_jobs — existing rows/columns untouched.
-- No image bytes are stored here. Only metadata referencing NAS paths.
-- =====================================================================

-- 1. External-PC handoff columns (STITCH / BLUR / REPORT / EXPORT / QAQC)
--    assigned_to    : operator assigned to run the external software job
--    external_status: none | awaiting_submit | running_external | done
--    launch_command : human-readable external tool + arguments (hint only)
ALTER TABLE public.processing_jobs
    ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(100),
    ADD COLUMN IF NOT EXISTS external_status VARCHAR(30) NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS launch_command TEXT DEFAULT '';

-- 2. QA/QC decision columns (QA_PENDING / REVIEW_REQUIRED disposition)
ALTER TABLE public.processing_jobs
    ADD COLUMN IF NOT EXISTS qa_decision VARCHAR(30),   -- APPROVED | REJECTED
    ADD COLUMN IF NOT EXISTS qa_notes TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS qa_by VARCHAR(100),
    ADD COLUMN IF NOT EXISTS qa_at TIMESTAMPTZ;

-- 3. Support indexes for the Processing Center board
CREATE INDEX IF NOT EXISTS idx_processing_jobs_external_status ON public.processing_jobs(external_status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_assigned ON public.processing_jobs(assigned_to);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_qa_decision ON public.processing_jobs(qa_decision);

-- NOTE: idx_processing_jobs_status / idx_processing_jobs_type were already
-- created by foundation_production_migration.sql — no need to re-create.
-- =====================================================================
-- ROLLBACK / SUPPORTED VERSIONS
--   Down (rollback) � this migration is additive (ADD COLUMN / CREATE
--   INDEX only; no data rewrite). To revert:
--     ALTER TABLE public.processing_jobs DROP COLUMN IF EXISTS external_status;
--     ALTER TABLE public.processing_jobs DROP COLUMN IF EXISTS assigned_to;
--     ALTER TABLE public.processing_jobs DROP COLUMN IF EXISTS qa_decision;
--     DROP INDEX IF EXISTS idx_processing_jobs_external_status;
--     DROP INDEX IF EXISTS idx_processing_jobs_assigned;
--     DROP INDEX IF EXISTS idx_processing_jobs_qa_decision;
--   Supported versions: Supabase (Postgres 15), schema 'public'. Applies
--   on top of foundation_production_migration.sql. Safe to re-run.
-- =====================================================================
