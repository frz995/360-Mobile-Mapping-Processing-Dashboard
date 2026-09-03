-- =====================================================================
-- Migration Script: Realtime QA/QC Pipeline & Project Settings (Idempotent)
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- Safe to run on fresh databases or databases with pre-existing tables.
-- =====================================================================

-- 1. Create QA/QC Audit Runs Table (Subgrid-level audit results & stats)
CREATE TABLE IF NOT EXISTS public.qaqc_audit_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subgrid VARCHAR(50),
    run_id VARCHAR(100),
    total_stations INT DEFAULT 0,
    defect_count INT DEFAULT 0,
    pass_rate NUMERIC DEFAULT 100,
    mean_tenengrad_score NUMERIC DEFAULT 0,
    defects_list JSONB DEFAULT '[]'::jsonb,
    history JSONB DEFAULT '[]'::jsonb,
    pic VARCHAR(100),
    user_id UUID,
    user_email VARCHAR(255),
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist on qaqc_audit_runs (handles pre-existing tables)
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS subgrid VARCHAR(50);
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS run_id VARCHAR(100);
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS total_stations INT DEFAULT 0;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS defect_count INT DEFAULT 0;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS pass_rate NUMERIC DEFAULT 100;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS mean_tenengrad_score NUMERIC DEFAULT 0;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS defects_list JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS pic VARCHAR(100);
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Safely add unique constraint on (subgrid, run_id) if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_subgrid_run'
    ) THEN
        ALTER TABLE public.qaqc_audit_runs ADD CONSTRAINT unique_subgrid_run UNIQUE (subgrid, run_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- handled gracefully if duplicates exist
END $$;

CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_subgrid ON public.qaqc_audit_runs(subgrid);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_run_id ON public.qaqc_audit_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_user_id ON public.qaqc_audit_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_completed_at ON public.qaqc_audit_runs(completed_at DESC);


-- 2. Create QA Defects Table (Point-level defect anomalies)
CREATE TABLE IF NOT EXISTS public.qa_defects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subgrid VARCHAR(50),
    point_id VARCHAR(100),
    frame_index INT DEFAULT 0,
    defect_flags JSONB DEFAULT '{}'::jsonb,
    defect_type VARCHAR(100) DEFAULT 'Defect',
    pic VARCHAR(100) DEFAULT 'Inspector',
    image_url TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    bearing NUMERIC,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,
    user_id UUID,
    user_email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all columns exist on qa_defects (fixes column "point_id" does not exist if table was created earlier)
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS subgrid VARCHAR(50);
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS point_id VARCHAR(100);
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS frame_index INT DEFAULT 0;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS defect_flags JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS defect_type VARCHAR(100) DEFAULT 'Defect';
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS pic VARCHAR(100) DEFAULT 'Inspector';
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS bearing NUMERIC;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT false;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill point_id from filename or id if existing records have NULL point_id
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'qa_defects' AND column_name = 'filename'
    ) THEN
        UPDATE public.qa_defects SET point_id = filename WHERE point_id IS NULL;
    END IF;
    UPDATE public.qa_defects SET point_id = id::text WHERE point_id IS NULL;
END $$;

-- Safely add unique constraint on (subgrid, point_id) if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_subgrid_point_id'
    ) THEN
        ALTER TABLE public.qa_defects ADD CONSTRAINT unique_subgrid_point_id UNIQUE (subgrid, point_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- handled gracefully if duplicate points exist
END $$;

CREATE INDEX IF NOT EXISTS idx_qa_defects_subgrid ON public.qa_defects(subgrid);
CREATE INDEX IF NOT EXISTS idx_qa_defects_point_id ON public.qa_defects(point_id);
CREATE INDEX IF NOT EXISTS idx_qa_defects_created_at ON public.qa_defects(created_at DESC);


-- 3. Create Project Settings Table (Cloud-persisted configuration & thresholds)
CREATE TABLE IF NOT EXISTS public.project_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.project_settings ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.project_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();


-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.qaqc_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_settings ENABLE ROW LEVEL SECURITY;


-- 5. RLS Policies for qaqc_audit_runs
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qaqc_audit_runs' AND policyname = 'Allow public read on qaqc_audit_runs') THEN
        CREATE POLICY "Allow public read on qaqc_audit_runs" ON public.qaqc_audit_runs FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qaqc_audit_runs' AND policyname = 'Allow public insert on qaqc_audit_runs') THEN
        CREATE POLICY "Allow public insert on qaqc_audit_runs" ON public.qaqc_audit_runs FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qaqc_audit_runs' AND policyname = 'Allow public update on qaqc_audit_runs') THEN
        CREATE POLICY "Allow public update on qaqc_audit_runs" ON public.qaqc_audit_runs FOR UPDATE USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qaqc_audit_runs' AND policyname = 'Allow public delete on qaqc_audit_runs') THEN
        CREATE POLICY "Allow public delete on qaqc_audit_runs" ON public.qaqc_audit_runs FOR DELETE USING (true);
    END IF;
END $$;


-- 6. RLS Policies for qa_defects
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qa_defects' AND policyname = 'Allow public read on qa_defects') THEN
        CREATE POLICY "Allow public read on qa_defects" ON public.qa_defects FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qa_defects' AND policyname = 'Allow public insert on qa_defects') THEN
        CREATE POLICY "Allow public insert on qa_defects" ON public.qa_defects FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qa_defects' AND policyname = 'Allow public update on qa_defects') THEN
        CREATE POLICY "Allow public update on qa_defects" ON public.qa_defects FOR UPDATE USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'qa_defects' AND policyname = 'Allow public delete on qa_defects') THEN
        CREATE POLICY "Allow public delete on qa_defects" ON public.qa_defects FOR DELETE USING (true);
    END IF;
END $$;


-- 7. RLS Policies for project_settings
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_settings' AND policyname = 'Allow public read on project_settings') THEN
        CREATE POLICY "Allow public read on project_settings" ON public.project_settings FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_settings' AND policyname = 'Allow public insert/update on project_settings') THEN
        CREATE POLICY "Allow public insert/update on project_settings" ON public.project_settings FOR ALL USING (true);
    END IF;
END $$;


-- 8. Enable Realtime Publications
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.qaqc_audit_runs;
    EXCEPTION WHEN duplicate_object THEN
        -- already added
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.qa_defects;
    EXCEPTION WHEN duplicate_object THEN
        -- already added
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.project_settings;
    EXCEPTION WHEN duplicate_object THEN
        -- already added
    END;
END $$;


-- 9. Resolve Supabase Security Advisor Issues
-- A. Set security_invoker = true on views to fix "Security Definer View" warnings
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'panoramas_subgrid_summary') THEN
        ALTER VIEW public.panoramas_subgrid_summary SET (security_invoker = true);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'panoramas_view') THEN
        ALTER VIEW public.panoramas_view SET (security_invoker = true);
    END IF;
EXCEPTION WHEN OTHERS THEN
END $$;

-- B. PostGIS spatial_ref_sys (Safe check)
DO $$
BEGIN
    EXECUTE 'ALTER TABLE IF EXISTS public.spatial_ref_sys ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY "Allow public read on spatial_ref_sys" ON public.spatial_ref_sys FOR SELECT USING (true)';
EXCEPTION WHEN OTHERS THEN
END $$;
-- =====================================================================
-- ROLLBACK / SUPPORTED VERSIONS
--   Down (rollback): realtime publications/policies added here can be
--   removed with:
--     DROP POLICY IF EXISTS "Allow public read on spatial_ref_sys" ON public.spatial_ref_sys;
--   Supported versions: Supabase (Postgres 15), schema 'public'. Safe to re-run.
-- =====================================================================
