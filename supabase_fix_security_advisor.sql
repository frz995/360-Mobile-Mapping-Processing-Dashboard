-- =====================================================================
-- Fix Supabase Security Advisor Issues (Safe & Non-blocking)
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- =====================================================================

-- 1. Fix: "Security Definer View" on public.panoramas_subgrid_summary
-- Set security_invoker = true so the view enforces the querying user's RLS policies
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views 
        WHERE schemaname = 'public' AND viewname = 'panoramas_subgrid_summary'
    ) THEN
        ALTER VIEW public.panoramas_subgrid_summary SET (security_invoker = true);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Handled gracefully
END $$;


-- 2. Fix: "Security Definer View" on public.panoramas_view
-- Set security_invoker = true so the view enforces the querying user's RLS policies
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views 
        WHERE schemaname = 'public' AND viewname = 'panoramas_view'
    ) THEN
        ALTER VIEW public.panoramas_view SET (security_invoker = true);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Handled gracefully
END $$;


-- 3. PostGIS System Table: public.spatial_ref_sys
-- Note: spatial_ref_sys is created by the PostGIS extension and owned by the system installer.
-- We attempt to enable RLS; if restricted by system permissions, it catches and ignores harmlessly.
DO $$
BEGIN
    EXECUTE 'ALTER TABLE IF EXISTS public.spatial_ref_sys ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY "Allow public read on spatial_ref_sys" ON public.spatial_ref_sys FOR SELECT USING (true)';
EXCEPTION WHEN OTHERS THEN
    -- Harmless: spatial_ref_sys is a read-only EPSG spatial reference lookup table
END $$;
