-- =====================================================================
-- Migration 0012: Core PostGIS Tables, Views & Role-Guarded RLS (Phase 3)
--
-- 1. Create missing core tables: `panoramas`, `staging_panoramas`
-- 2. Create `panoramas_view` with SECURITY INVOKER
-- 3. Add `is_fallback_coord` tracking for GPS centroid fallbacks
-- 4. Drop orphaned `recycle_bin` table (superseded by `survey_recycle_bin`)
-- 5. Extend role-guarded RLS (backed by `sec.can()`) across all core tables:
--    `panoramas`, `staging_panoramas`, `qa_defects`, `qaqc_audit_runs`,
--    `audit_logs`, and `notifications`
--
-- Idempotent: safe to run repeatedly in Supabase SQL Editor.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- 1. Core Table: public.panoramas (Published WebGIS Panoramas)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.panoramas (
    id BIGSERIAL PRIMARY KEY,
    subgrid VARCHAR(50) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    image_url TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION DEFAULT 0,
    pitch DOUBLE PRECISION DEFAULT 0,
    roll DOUBLE PRECISION DEFAULT 0,
    is_fallback_coord BOOLEAN DEFAULT false,
    geom GEOMETRY(Point, 4326),
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'yes',
    qa_status VARCHAR(50) DEFAULT 'published',
    defect_flags JSONB DEFAULT '{}'::jsonb,
    defect_count INT DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS is_fallback_coord BOOLEAN DEFAULT false;
ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS defect_flags JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS defect_count INT DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'panoramas_filename_unique'
    ) THEN
        ALTER TABLE public.panoramas ADD CONSTRAINT panoramas_filename_unique UNIQUE (filename);
    END IF;
EXCEPTION WHEN OTHERS THEN
END $$;

CREATE INDEX IF NOT EXISTS idx_panoramas_geom ON public.panoramas USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_panoramas_subgrid ON public.panoramas (subgrid);
CREATE INDEX IF NOT EXISTS idx_panoramas_filename ON public.panoramas (filename);

-- ---------------------------------------------------------------------
-- 2. Core Table: public.staging_panoramas (Private Operator Staging)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staging_panoramas (
    id BIGSERIAL PRIMARY KEY,
    subgrid VARCHAR(50) NOT NULL,
    grid VARCHAR(50) DEFAULT '1',
    filename VARCHAR(255) NOT NULL,
    image_url TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION DEFAULT 0,
    pitch DOUBLE PRECISION DEFAULT 0,
    roll DOUBLE PRECISION DEFAULT 0,
    km_processed NUMERIC DEFAULT 0,
    poi_count INT DEFAULT 0,
    images_processed INT DEFAULT 0,
    defect_count INT DEFAULT 0,
    capture_equipment VARCHAR(50) DEFAULT 'MMS',
    status VARCHAR(50) DEFAULT 'in process',
    is_fallback_coord BOOLEAN DEFAULT false,
    geom GEOMETRY(Point, 4326),
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS is_fallback_coord BOOLEAN DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'staging_panoramas_filename_unique'
    ) THEN
        ALTER TABLE public.staging_panoramas ADD CONSTRAINT staging_panoramas_filename_unique UNIQUE (filename);
    END IF;
EXCEPTION WHEN OTHERS THEN
END $$;

CREATE INDEX IF NOT EXISTS idx_staging_panoramas_geom ON public.staging_panoramas USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_staging_panoramas_subgrid ON public.staging_panoramas (subgrid);
CREATE INDEX IF NOT EXISTS idx_staging_panoramas_filename ON public.staging_panoramas (filename);

-- ---------------------------------------------------------------------
-- 3. WebGIS Summary View: public.panoramas_view
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.panoramas_view WITH (security_invoker = true) AS
SELECT 
    p.id,
    p.subgrid,
    p.filename,
    p.image_url,
    p.latitude,
    p.longitude,
    p.latitude AS lat,
    p.longitude AS lon,
    p.heading,
    p.pitch,
    p.roll,
    p.is_fallback_coord,
    p.geom,
    p.captured_at,
    p.status,
    p.qa_status,
    p.defect_flags,
    p.defect_count,
    p.description,
    p.created_at,
    p.updated_at
FROM public.panoramas p
WHERE p.status = 'yes' OR p.qa_status = 'published';

-- ---------------------------------------------------------------------
-- 4. Cleanup: Drop Orphaned recycle_bin Table
--    (The active application uses survey_recycle_bin)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS public.recycle_bin;

-- ---------------------------------------------------------------------
-- 5. Role-Guarded RLS Policies on Core Tables
-- ---------------------------------------------------------------------

-- A. public.panoramas
ALTER TABLE public.panoramas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated access on panoramas" ON public.panoramas;
DROP POLICY IF EXISTS "Allow public read on panoramas" ON public.panoramas;
DROP POLICY IF EXISTS "panoramas_select" ON public.panoramas;
DROP POLICY IF EXISTS "panoramas_insert" ON public.panoramas;
DROP POLICY IF EXISTS "panoramas_update" ON public.panoramas;
DROP POLICY IF EXISTS "panoramas_delete" ON public.panoramas;

CREATE POLICY "panoramas_select" ON public.panoramas FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY "panoramas_insert" ON public.panoramas FOR INSERT WITH CHECK (sec.can('manageDatasets'));
CREATE POLICY "panoramas_update" ON public.panoramas FOR UPDATE USING (sec.can('manageDatasets')) WITH CHECK (sec.can('manageDatasets'));
CREATE POLICY "panoramas_delete" ON public.panoramas FOR DELETE USING (sec.can('deleteData'));

-- B. public.staging_panoramas
ALTER TABLE public.staging_panoramas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated access on staging_panoramas" ON public.staging_panoramas;
DROP POLICY IF EXISTS "Allow public read on staging_panoramas" ON public.staging_panoramas;
DROP POLICY IF EXISTS "staging_panoramas_select" ON public.staging_panoramas;
DROP POLICY IF EXISTS "staging_panoramas_insert" ON public.staging_panoramas;
DROP POLICY IF EXISTS "staging_panoramas_update" ON public.staging_panoramas;
DROP POLICY IF EXISTS "staging_panoramas_delete" ON public.staging_panoramas;

CREATE POLICY "staging_panoramas_select" ON public.staging_panoramas FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY "staging_panoramas_insert" ON public.staging_panoramas FOR INSERT WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY "staging_panoramas_update" ON public.staging_panoramas FOR UPDATE USING (sec.can('manageDatasets') OR sec.can('runQaqc')) WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY "staging_panoramas_delete" ON public.staging_panoramas FOR DELETE USING (sec.can('deleteData') OR sec.can('manageDatasets'));

-- C. public.qa_defects
ALTER TABLE public.qa_defects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated access on qa_defects" ON public.qa_defects;
DROP POLICY IF EXISTS "qa_defects_select" ON public.qa_defects;
DROP POLICY IF EXISTS "qa_defects_insert" ON public.qa_defects;
DROP POLICY IF EXISTS "qa_defects_update" ON public.qa_defects;
DROP POLICY IF EXISTS "qa_defects_delete" ON public.qa_defects;

CREATE POLICY "qa_defects_select" ON public.qa_defects FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY "qa_defects_insert" ON public.qa_defects FOR INSERT WITH CHECK (sec.can('runQaqc'));
CREATE POLICY "qa_defects_update" ON public.qa_defects FOR UPDATE USING (sec.can('reviewQaqc') OR sec.can('runQaqc')) WITH CHECK (sec.can('reviewQaqc') OR sec.can('runQaqc'));
CREATE POLICY "qa_defects_delete" ON public.qa_defects FOR DELETE USING (sec.can('deleteData') OR sec.can('reviewQaqc'));

-- D. public.qaqc_audit_runs
ALTER TABLE public.qaqc_audit_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated access on qaqc_audit_runs" ON public.qaqc_audit_runs;
DROP POLICY IF EXISTS "qaqc_audit_runs_select" ON public.qaqc_audit_runs;
DROP POLICY IF EXISTS "qaqc_audit_runs_insert" ON public.qaqc_audit_runs;
DROP POLICY IF EXISTS "qaqc_audit_runs_update" ON public.qaqc_audit_runs;
DROP POLICY IF EXISTS "qaqc_audit_runs_delete" ON public.qaqc_audit_runs;

CREATE POLICY "qaqc_audit_runs_select" ON public.qaqc_audit_runs FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY "qaqc_audit_runs_insert" ON public.qaqc_audit_runs FOR INSERT WITH CHECK (sec.can('runQaqc'));
CREATE POLICY "qaqc_audit_runs_update" ON public.qaqc_audit_runs FOR UPDATE USING (sec.can('runQaqc')) WITH CHECK (sec.can('runQaqc'));
CREATE POLICY "qaqc_audit_runs_delete" ON public.qaqc_audit_runs FOR DELETE USING (sec.can('deleteData'));

-- E. public.audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated access on audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_update" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete" ON public.audit_logs;

CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT WITH CHECK (sec.can('viewAll'));
CREATE POLICY "audit_logs_update" ON public.audit_logs FOR UPDATE USING (sec.can('manageSettings')) WITH CHECK (sec.can('manageSettings'));
CREATE POLICY "audit_logs_delete" ON public.audit_logs FOR DELETE USING (sec.can('manageSettings'));

-- F. public.notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated access on notifications" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;

CREATE POLICY "notifications_select" ON public.notifications FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT WITH CHECK (sec.can('viewAll'));
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE USING (sec.can('viewAll')) WITH CHECK (sec.can('viewAll'));
CREATE POLICY "notifications_delete" ON public.notifications FOR DELETE USING (sec.can('manageSettings'));
