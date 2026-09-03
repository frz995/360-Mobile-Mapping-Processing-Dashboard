-- =====================================================================
-- C5 — Application Table RLS Policies (Security Hardening)
-- GeoSphere 360 Processing Dashboard
-- Run this script in your Supabase SQL Editor ONCE.
-- Safe to re-run: all statements use IF NOT EXISTS / DO $$ guards.
-- =====================================================================
--
-- Tables covered:
--   panoramas              — main published panorama records
--   staging_panoramas      — pre-publish staging area
--   subgrids               — survey subgrid metadata
--   qa_defects             — per-frame QA/QC defect records
--   qaqc_audit_runs        — per-subgrid QA audit run summaries
--   audit_logs             — system audit trail
--   notifications          — in-app notification feed
--   project_settings       — project/admin configuration (single row)
--   deletion_requests      — admin deletion approval workflow
--   user_accounts          — operator/inspector accounts
--   datasets               — production pipeline dataset registry
--   processing_jobs        — NAS GPU Worker & workstation job records
--   recycle_bin            — soft-deleted panorama records
--
-- Current posture: All existing policies use USING (true) — open anon access.
-- This script REPLACES those open policies with authenticated-user policies
-- while keeping public SELECT open where required for the WebGIS viewer.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: Safe DROP POLICY (ignores error if policy doesn't exist)
-- ─────────────────────────────────────────────────────────────────────────────

-- NOTE: Drop and recreate policies so this script is idempotent on re-run.
-- Postgres 15+ has "CREATE POLICY IF NOT EXISTS" but Supabase runs 15 — we
-- use DO blocks with exception handling for maximum compatibility.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. panoramas — published survey data (public read / auth write)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.panoramas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on panoramas" ON public.panoramas; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated insert on panoramas" ON public.panoramas; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated update on panoramas" ON public.panoramas; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated delete on panoramas" ON public.panoramas; EXCEPTION WHEN OTHERS THEN END $$;

-- Public read: WebGIS viewer and anonymous users can view published data
CREATE POLICY "Allow public read on panoramas"
  ON public.panoramas FOR SELECT USING (true);

-- Authenticated write: only signed-in users can insert/update/delete
CREATE POLICY "Allow authenticated insert on panoramas"
  ON public.panoramas FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Allow authenticated update on panoramas"
  ON public.panoramas FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Allow authenticated delete on panoramas"
  ON public.panoramas FOR DELETE
  USING (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. staging_panoramas — pre-publish staging (authenticated only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.staging_panoramas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on staging_panoramas" ON public.staging_panoramas; EXCEPTION WHEN OTHERS THEN END $$;

-- Only authenticated users can see and manage staging data
CREATE POLICY "Allow authenticated access on staging_panoramas"
  ON public.staging_panoramas FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. subgrids — survey subgrid metadata (public read / auth write)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.subgrids ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on subgrids" ON public.subgrids; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public insert/update on subgrids" ON public.subgrids; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated write on subgrids" ON public.subgrids; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow public read on subgrids"
  ON public.subgrids FOR SELECT USING (true);

CREATE POLICY "Allow authenticated write on subgrids"
  ON public.subgrids FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. qa_defects — per-frame QA/QC defect records (public read / auth write)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.qa_defects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on qa_defects" ON public.qa_defects; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public insert on qa_defects" ON public.qa_defects; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public update on qa_defects" ON public.qa_defects; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public delete on qa_defects" ON public.qa_defects; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated write on qa_defects" ON public.qa_defects; EXCEPTION WHEN OTHERS THEN END $$;

-- Public read so WebGIS map overlay can display defect markers
CREATE POLICY "Allow public read on qa_defects"
  ON public.qa_defects FOR SELECT USING (true);

-- Authenticated write for QAQC operators inserting/updating defect records
CREATE POLICY "Allow authenticated write on qa_defects"
  ON public.qa_defects FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. qaqc_audit_runs — per-subgrid QA audit run summaries (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.qaqc_audit_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on qaqc_audit_runs" ON public.qaqc_audit_runs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public insert on qaqc_audit_runs" ON public.qaqc_audit_runs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public update on qaqc_audit_runs" ON public.qaqc_audit_runs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public delete on qaqc_audit_runs" ON public.qaqc_audit_runs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on qaqc_audit_runs" ON public.qaqc_audit_runs; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow authenticated access on qaqc_audit_runs"
  ON public.qaqc_audit_runs FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. audit_logs — system audit trail (auth read / auth insert / no update/delete)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on audit_logs" ON public.audit_logs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public insert on audit_logs" ON public.audit_logs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated read on audit_logs" ON public.audit_logs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated insert on audit_logs" ON public.audit_logs; EXCEPTION WHEN OTHERS THEN END $$;

-- Audit logs: authenticated read + insert only (logs must never be edited/deleted)
CREATE POLICY "Allow authenticated read on audit_logs"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Allow authenticated insert on audit_logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. notifications — in-app notification feed (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on notifications" ON public.notifications; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public insert/update on notifications" ON public.notifications; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on notifications" ON public.notifications; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow authenticated access on notifications"
  ON public.notifications FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. project_settings — admin configuration (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.project_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on project_settings" ON public.project_settings; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public insert/update on project_settings" ON public.project_settings; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on project_settings" ON public.project_settings; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow authenticated access on project_settings"
  ON public.project_settings FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. deletion_requests — admin deletion approval workflow (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
-- Create table if it doesn't exist yet (may not be in older migrations)
CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  requested_by VARCHAR(100),
  user_email VARCHAR(255),
  reason TEXT,
  poi_count INT DEFAULT 0,
  km_processed NUMERIC DEFAULT 0,
  date_requested TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'Pending', -- Pending | Approved | Rejected
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  filenames JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON public.deletion_requests(status);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_subgrid ON public.deletion_requests(subgrid);

ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on deletion_requests" ON public.deletion_requests; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow authenticated access on deletion_requests"
  ON public.deletion_requests FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. user_accounts — operator/inspector accounts (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(255) UNIQUE,
  role VARCHAR(50) DEFAULT 'Survey Operator', -- Administrator | Survey Operator | QA Inspector | Viewer
  status VARCHAR(20) DEFAULT 'Active',        -- Active | Disabled | Pending
  last_login TIMESTAMPTZ,
  avatar TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON public.user_accounts(email);
CREATE INDEX IF NOT EXISTS idx_user_accounts_role ON public.user_accounts(role);

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated read on user_accounts" ON public.user_accounts; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated write on user_accounts" ON public.user_accounts; EXCEPTION WHEN OTHERS THEN END $$;

-- All authenticated users can see the user list (needed for PIC assignment)
CREATE POLICY "Allow authenticated read on user_accounts"
  ON public.user_accounts FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only authenticated users can insert/update user records
CREATE POLICY "Allow authenticated write on user_accounts"
  ON public.user_accounts FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. datasets — production pipeline dataset registry (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on datasets" ON public.datasets; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public write on datasets" ON public.datasets; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on datasets" ON public.datasets; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow authenticated access on datasets"
  ON public.datasets FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. processing_jobs — NAS GPU Worker job records (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow public read on processing_jobs" ON public.processing_jobs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow public write on processing_jobs" ON public.processing_jobs; EXCEPTION WHEN OTHERS THEN END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on processing_jobs" ON public.processing_jobs; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow authenticated access on processing_jobs"
  ON public.processing_jobs FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- 13. recycle_bin — soft-deleted panorama records (auth only)
-- ─────────────────────────────────────────────────────────────────────────────
-- Table name is stored as a constant in supabase.ts (RECYCLE_BIN_TABLE)
-- Default: 'recycle_bin'
CREATE TABLE IF NOT EXISTS public.recycle_bin (
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

CREATE INDEX IF NOT EXISTS idx_recycle_bin_subgrid ON public.recycle_bin(subgrid);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_at ON public.recycle_bin(deleted_at DESC);

ALTER TABLE public.recycle_bin ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated access on recycle_bin" ON public.recycle_bin; EXCEPTION WHEN OTHERS THEN END $$;

CREATE POLICY "Allow authenticated access on recycle_bin"
  ON public.recycle_bin FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ─────────────────────────────────────────────────────────────────────────────
-- SUMMARY
-- ─────────────────────────────────────────────────────────────────────────────
-- After running this script:
--
-- PUBLIC READ (anon + authenticated):
--   panoramas, subgrids, qa_defects
--   (needed by WebGIS iframe viewer for live map overlays)
--
-- AUTHENTICATED ONLY (read + write):
--   staging_panoramas, qaqc_audit_runs, audit_logs, notifications,
--   project_settings, deletion_requests, user_accounts,
--   datasets, processing_jobs, recycle_bin
--
-- NOTE: If your dashboard uses guest mode (non-authenticated users who should
-- still read data), change auth.uid() IS NOT NULL to `true` for SELECT policies
-- on any table that should be visible to guests.
-- ─────────────────────────────────────────────────────────────────────────────
-- =====================================================================
-- ROLLBACK / SUPPORTED VERSIONS
--   Down (rollback): policies are DROP + CREATE (idempotent). To revert
--   to open anon access for a table, drop the auth-scoped policy and
--   re-create a USING (true) one, e.g.:
--     DROP POLICY "Allow authenticated access on qa_defects" ON public.qa_defects;
--     CREATE POLICY "Allow public read on qa_defects" ON public.qa_defects FOR SELECT USING (true);
--   Supported versions: Supabase (Postgres 15), schema 'public'. Safe to re-run.
-- =====================================================================
