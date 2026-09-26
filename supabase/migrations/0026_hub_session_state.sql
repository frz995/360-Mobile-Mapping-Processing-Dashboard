-- =====================================================================
-- GeoSphere 360 — Production Hub working session (Migration 0026)
--
-- One row per project storing the operator's last Production Hub activity
-- so the Survey Source inputs, paired records and active tab restore after
-- a refresh or when switching workspaces/tabs:
--   { activeStation, subgrid, surveyDate, totalFrames, pairedRecords,
--     selectedFolderId, csvFileName, customFolderName }
--
-- The browser upserts this session as the operator works; localStorage
-- mirrors it for guest/offline sessions. Safe to re-run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.hub_session_state (
    project_id  UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
    state       JSONB NOT NULL DEFAULT '{}',
    updated_by  VARCHAR(120) NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.hub_session_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated manage on hub_session_state" ON public.hub_session_state; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Allow authenticated manage on hub_session_state"
    ON public.hub_session_state FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
