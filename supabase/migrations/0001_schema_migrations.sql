-- =====================================================================
-- Migration Script: Dynamic Dashboard Tables & PostGIS Summary Views
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- =====================================================================

-- 1. Create Subgrids Metadata Table
CREATE TABLE IF NOT EXISTS public.subgrids (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subgrid_code VARCHAR(50) UNIQUE NOT NULL,
    grid_id VARCHAR(20) DEFAULT '1',
    pic VARCHAR(100) DEFAULT 'Fariz',
    equipment VARCHAR(50) DEFAULT 'MMS',
    status VARCHAR(50) DEFAULT 'Ongoing',
    latitude NUMERIC(10, 6),
    longitude NUMERIC(10, 6),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Audit Logs Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'CREATE' | 'EDIT' | 'DELETE' | 'PUBLISH' | 'ERROR' | 'SYNC'
    title VARCHAR(255) NOT NULL,
    details TEXT,
    user_name VARCHAR(100) DEFAULT 'System',
    status VARCHAR(50) DEFAULT 'info', -- 'success' | 'warning' | 'error' | 'info'
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create System Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    timestamp VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'PUBLISH' | 'PENDING' | 'SYSTEM' | 'ERROR'
    read BOOLEAN DEFAULT FALSE,
    total_items INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed baseline notifications
INSERT INTO public.notifications (timestamp, title, message, category, read, total_items)
VALUES 
    (TO_CHAR(NOW(), 'DD Mon YYYY, HH12:MI AM'), 'Data Published to Database', 'Successfully published panoramas to Supabase production database.', 'PUBLISH', FALSE, 4),
    (TO_CHAR(NOW() - INTERVAL '30 minutes', 'DD Mon YYYY, HH12:MI AM'), 'System Health Audit', 'All subgrid batch runs reconciled.', 'SYSTEM', TRUE, 0)
ON CONFLICT DO NOTHING;

-- 4. Create QA/QC Defects Table
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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_subgrid_point_id'
    ) THEN
        ALTER TABLE public.qa_defects ADD CONSTRAINT unique_subgrid_point_id UNIQUE (subgrid, point_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
END $$;

CREATE INDEX IF NOT EXISTS idx_qa_defects_subgrid ON public.qa_defects(subgrid);
CREATE INDEX IF NOT EXISTS idx_qa_defects_point_id ON public.qa_defects(point_id);
CREATE INDEX IF NOT EXISTS idx_qa_defects_created_at ON public.qa_defects(created_at DESC);

-- 5. Create QA/QC Audit Runs Table
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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_subgrid_run'
    ) THEN
        ALTER TABLE public.qaqc_audit_runs ADD CONSTRAINT unique_subgrid_run UNIQUE (subgrid, run_id);
    END IF;
EXCEPTION WHEN OTHERS THEN
END $$;

CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_subgrid ON public.qaqc_audit_runs(subgrid);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_run_id ON public.qaqc_audit_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_user_id ON public.qaqc_audit_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_completed_at ON public.qaqc_audit_runs(completed_at DESC);

-- 6. Create Project Settings Table
CREATE TABLE IF NOT EXISTS public.project_settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.project_settings ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.project_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 7. Enable Row Level Security (RLS) & Public Read/Write Access Policies
ALTER TABLE public.subgrids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qaqc_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on subgrids" ON public.subgrids FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on subgrids" ON public.subgrids FOR ALL USING (true);

CREATE POLICY "Allow public read on audit_logs" ON public.audit_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert on audit_logs" ON public.audit_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read on notifications" ON public.notifications FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on notifications" ON public.notifications FOR ALL USING (true);

CREATE POLICY "Allow public read on qa_defects" ON public.qa_defects FOR SELECT USING (true);
CREATE POLICY "Allow public insert on qa_defects" ON public.qa_defects FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on qa_defects" ON public.qa_defects FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete on qa_defects" ON public.qa_defects FOR DELETE USING (true);
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT false;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE POLICY "Allow public read on qaqc_audit_runs" ON public.qaqc_audit_runs FOR SELECT USING (true);
CREATE POLICY "Allow public insert on qaqc_audit_runs" ON public.qaqc_audit_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update on qaqc_audit_runs" ON public.qaqc_audit_runs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow public delete on qaqc_audit_runs" ON public.qaqc_audit_runs FOR DELETE USING (true);

CREATE POLICY "Allow public read on project_settings" ON public.project_settings FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on project_settings" ON public.project_settings FOR ALL USING (true);

-- 8. Enable Realtime Publications
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.qaqc_audit_runs;
    EXCEPTION WHEN duplicate_object THEN
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.qa_defects;
    EXCEPTION WHEN duplicate_object THEN
    END;

    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.project_settings;
    EXCEPTION WHEN duplicate_object THEN
    END;
END $$;

-- 9. Optional PostGIS Dynamic Subgrid View (if PostGIS extension is enabled)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        EXECUTE '
        CREATE OR REPLACE VIEW public.panoramas_subgrid_summary AS
        SELECT 
            UPPER(SUBSTRING(filename FROM ''^(N[0-9]+E[0-9]+)'')) AS subgrid,
            COUNT(*) AS total_images,
            ST_Y(ST_Centroid(ST_Collect(geom::geometry))) AS centroid_lat,
            ST_X(ST_Centroid(ST_Collect(geom::geometry))) AS centroid_lon
        FROM public.panoramas
        WHERE geom IS NOT NULL
        GROUP BY UPPER(SUBSTRING(filename FROM ''^(N[0-9]+E[0-9]+)''));
        ';
    END IF;
END $$;


-- =====================================================================
-- ROLLBACK / SUPPORTED VERSIONS
--   Down (rollback): all tables are CREATE TABLE IF NOT EXISTS / ADD
--   COLUMN IF NOT EXISTS with guarded DO $$ constraints, so reverting
--   means manually dropping only what you added; nothing here rewrites
--   existing rows. To drop a table you newly created:
--     DROP TABLE IF EXISTS public.qa_defects;
--     DROP TABLE IF EXISTS public.qaqc_audit_runs;
--   Supported versions: Supabase (Postgres 15), schema 'public'. Safe to re-run.
-- =====================================================================
