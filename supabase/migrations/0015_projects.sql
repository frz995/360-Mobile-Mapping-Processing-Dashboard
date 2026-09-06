-- =====================================================================
-- GeoSphere 360 — Project Registry (Migration 0015)
--
-- Introduces the first-class `projects` table backing the v14 Project
-- Workspace + sign-in onboarding gate. Each project carries a GIS `scope`
-- (crs / region bbox / basemap / targets / equipment / deadline) that is
-- applied to `project_settings` while the project is active — giving
-- "different area per project" behaviour WITHOUT repartitioning the
-- operational tables (subgrids / qa_defects / panoramas stay global;
-- hard `project_id` partitioning is a later phase).
--
-- SECURITY MODEL (role-guarded, consistent with 0010/0012):
--   * SELECT   — every authenticated role (sec.can('viewAll')): the picker
--                and Project panel must render team projects read-only for
--                Viewers/guests.
--   * INSERT   — operations staff only (Administrator / Survey Operator /
--                QA Inspector) via the same capability union used for
--                datasets & processing_jobs.
--   * UPDATE   — same operations union (soft archive via status='archived').
--   * DELETE   — intentionally NO DELETE policy: projects are soft-archived
--                only, preserving history and audit references.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + guarded index/policy creation,
-- safe to run repeatedly in the Supabase SQL Editor.
-- =====================================================================

-- The project-name search index uses a trigram GIN operator class.
-- `pg_trgm` is on Supabase's extension allowlist and is resolved on the
-- default search_path, so a plain CREATE EXTENSION always works here.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    contract_code   TEXT NOT NULL DEFAULT '',
    client_name     TEXT NOT NULL DEFAULT '',
    region          TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning', 'active', 'paused', 'completed', 'archived')),
    scope           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_opened_at  TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_projects_status        ON public.projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_last_opened   ON public.projects (last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_created_by    ON public.projects (created_by);
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm     ON public.projects USING GIN (name gin_trgm_ops);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select" ON public.projects;
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_update" ON public.projects;

CREATE POLICY "projects_select"
    ON public.projects FOR SELECT
    USING (sec.can('viewAll'));

CREATE POLICY "projects_insert"
    ON public.projects FOR INSERT
    WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc') OR sec.can('manageSettings'));

CREATE POLICY "projects_update"
    ON public.projects FOR UPDATE
    USING (sec.can('manageDatasets') OR sec.can('runQaqc') OR sec.can('manageSettings'))
    WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc') OR sec.can('manageSettings'));

-- NOTE: `updated_at` is maintained by the client service (projects.ts)
-- rather than a DB trigger, matching the existing operational tables.