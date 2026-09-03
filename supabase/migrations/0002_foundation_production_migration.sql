-- =====================================================================
-- Migration Script: Foundation Production Pipeline (Datasets & Processing Jobs)
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- Part of the Image Production Workspace / NAS GPU Worker implementation.
-- NOTE: No image bytes are stored here. Only metadata referencing NAS paths.
-- =====================================================================

-- 1. Create Datasets Metadata Table
-- Tracks every imagery dataset (RAW -> PROCESSED -> DELIVERABLE) registered
-- against NAS storage. Image content itself always lives on the NAS.
CREATE TABLE IF NOT EXISTS public.datasets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dataset_type VARCHAR(30) NOT NULL DEFAULT 'PROCESSED',   -- RAW | PROCESSED | DELIVERABLE
    pipeline_stage VARCHAR(30) NOT NULL DEFAULT 'STITCH',    -- STITCH | BLUR | ENHANCE | MASK | QAQC
    name VARCHAR(255) NOT NULL,
    subgrid VARCHAR(50),
    provider VARCHAR(100) DEFAULT 'Local PC',
    software_version VARCHAR(100) DEFAULT '',
    source_folder TEXT,                                      -- NAS input folder (user-set before run)
    output_folder TEXT,                                      -- NAS output folder (user-set before run)
    storage_provider VARCHAR(30) DEFAULT 'nas_local',
    file_count INT DEFAULT 0,
    size_bytes BIGINT DEFAULT 0,
    status VARCHAR(30) DEFAULT 'REGISTERED',                 -- REGISTERED | READY | IN_PROGRESS | COMPLETED | FAILED | IMPORTED | ARCHIVED
    version INT DEFAULT 1,
    parent_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
    superseded_by UUID REFERENCES public.datasets(id) ON DELETE SET NULL,  -- set when a newer version replaces this one
    metadata JSONB DEFAULT '{}'::jsonb,
    created_by VARCHAR(100) DEFAULT 'System',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_datasets_subgrid ON public.datasets(subgrid);
CREATE INDEX IF NOT EXISTS idx_datasets_type ON public.datasets(dataset_type);
CREATE INDEX IF NOT EXISTS idx_datasets_status ON public.datasets(status);
CREATE INDEX IF NOT EXISTS idx_datasets_parent ON public.datasets(parent_dataset_id);
CREATE INDEX IF NOT EXISTS idx_datasets_superseded_by ON public.datasets(superseded_by);

-- 2. Create Processing Jobs Table
-- Central job registry for external + NAS GPU Worker processing.
-- Worker writes status back here so the dashboard stays live.
CREATE TABLE IF NOT EXISTS public.processing_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    job_type VARCHAR(30) NOT NULL DEFAULT 'ENHANCE',          -- ENHANCE | MASK | STITCH | BLUR | QAQC | REPORT | EXPORT | AI_DETECT
    name VARCHAR(255) DEFAULT '',
    source_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
    output_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
    source_folder TEXT,
    output_folder TEXT,
    subgrid VARCHAR(50),
    provider VARCHAR(100) DEFAULT 'NAS GPU Worker',
    software_version VARCHAR(100) DEFAULT '',
    status VARCHAR(30) DEFAULT 'PENDING',
    -- PENDING | QUEUED | IN_PROGRESS | COMPLETED | FAILED | IMPORTED
    -- | QA_PENDING | APPROVED | REJECTED | REVIEW_REQUIRED | CANCELLED
    progress INT DEFAULT 0,
    total_items INT DEFAULT 0,
    completed_items INT DEFAULT 0,
    current_item VARCHAR(255) DEFAULT '',
    error_count INT DEFAULT 0,
    operator VARCHAR(100) DEFAULT 'System',
    notes TEXT DEFAULT '',
    settings JSONB DEFAULT '{}'::jsonb,                       -- enhancement params, mask ann, api mode, concurrency...
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON public.processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_type ON public.processing_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_subgrid ON public.processing_jobs(subgrid);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created ON public.processing_jobs(created_at DESC);

-- 3. Row Level Security (RLS) & Public Read/Write Policies (current posture)
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on datasets" ON public.datasets FOR SELECT USING (true);
CREATE POLICY "Allow public write on datasets" ON public.datasets FOR ALL USING (true);

CREATE POLICY "Allow public read on processing_jobs" ON public.processing_jobs FOR SELECT USING (true);
CREATE POLICY "Allow public write on processing_jobs" ON public.processing_jobs FOR ALL USING (true);

-- 4. Enable Realtime Publications
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.datasets;
    EXCEPTION WHEN duplicate_object THEN
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.processing_jobs;
    EXCEPTION WHEN duplicate_object THEN
    END;
END $$;-- =====================================================================
-- ROLLBACK / SUPPORTED VERSIONS
--   Down (rollback) for this migration. Tables are CREATE TABLE IF NOT
--   EXISTS so nothing is dropped unless you do so manually. To fully
--   remove the production pipeline:
--     ALTER TABLE public.processing_jobs DISABLE ROW LEVEL SECURITY;
--     ALTER TABLE public.datasets DISABLE ROW LEVEL SECURITY;
--     DROP TABLE IF EXISTS public.processing_jobs CASCADE;
--     DROP TABLE IF EXISTS public.datasets CASCADE;
--   (CASCADE removes dependent FKs from child tables). RLS policies are
--   re-created by supabase_rls_application_tables.sql.
--   Supported versions: Supabase (Postgres 15), schema 'public'. Safe to re-run.
-- =====================================================================
