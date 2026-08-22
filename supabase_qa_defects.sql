-- =====================================================================
-- Migration Script: QA/QC Defects Table & Row-Level Security (RLS)
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- =====================================================================

-- 1. Create QA Defects Table
CREATE TABLE IF NOT EXISTS public.qa_defects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subgrid VARCHAR(50) NOT NULL,
    point_id VARCHAR(100) NOT NULL,
    frame_index INT NOT NULL,
    defect_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
    defect_type VARCHAR(100) NOT NULL,
    pic VARCHAR(100) NOT NULL,
    image_url TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    bearing NUMERIC,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_subgrid_point_id UNIQUE (subgrid, point_id)
);

ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT false;
ALTER TABLE public.qa_defects ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_qa_defects_subgrid ON public.qa_defects(subgrid);
CREATE INDEX IF NOT EXISTS idx_qa_defects_point_id ON public.qa_defects(point_id);
CREATE INDEX IF NOT EXISTS idx_qa_defects_created_at ON public.qa_defects(created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.qa_defects ENABLE ROW LEVEL SECURITY;

-- 4. RLS Access Policies for Authenticated & Public Users
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'qa_defects' AND policyname = 'Allow public read on qa_defects'
    ) THEN
        CREATE POLICY "Allow public read on qa_defects" 
        ON public.qa_defects FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'qa_defects' AND policyname = 'Allow public insert on qa_defects'
    ) THEN
        CREATE POLICY "Allow public insert on qa_defects" 
        ON public.qa_defects FOR INSERT WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'qa_defects' AND policyname = 'Allow public update on qa_defects'
    ) THEN
        CREATE POLICY "Allow public update on qa_defects" 
        ON public.qa_defects FOR UPDATE USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'qa_defects' AND policyname = 'Allow public delete on qa_defects'
    ) THEN
        CREATE POLICY "Allow public delete on qa_defects" 
        ON public.qa_defects FOR DELETE USING (true);
    END IF;
END $$;
