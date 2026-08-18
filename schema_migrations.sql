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

-- 4. Enable Row Level Security (RLS) & Public Read/Write Access Policies
ALTER TABLE public.subgrids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on subgrids" ON public.subgrids FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on subgrids" ON public.subgrids FOR ALL USING (true);

CREATE POLICY "Allow public read on audit_logs" ON public.audit_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert on audit_logs" ON public.audit_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read on notifications" ON public.notifications FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on notifications" ON public.notifications FOR ALL USING (true);

-- 5. Optional PostGIS Dynamic Subgrid View (if PostGIS extension is enabled)
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
