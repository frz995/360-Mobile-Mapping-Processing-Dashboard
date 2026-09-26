-- =====================================================================
-- GeoSphere 360 — Stage Event Ledger (Migration 0024)
--
-- Append-only history for the Production Hub pipeline:
--   intake → blur → stitch → lightroom → photoshop → qa → bucket → publish
--
-- Every real stage transition appends one row (no upsert, no delete):
--   STARTED / PROGRESS / COMPLETED / FLAGGED / PUBLISHED and agent
--   AGENT_ONLINE / AGENT_OFFLINE observations from the 4-PC station board.
--
-- `occurrence` is business time (agent process start / file mtime /
-- operator action time); `recorded_at` is insert time. `counts` carries
-- the frame snapshot (done/total) so the Stage History tab can chart the
-- batch without recomputation. Safe to re-run (IF NOT EXISTS throughout).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.stage_event_ledger (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID REFERENCES public.projects(id),
    subgrid      VARCHAR(50) NOT NULL,
    stage        VARCHAR(30) NOT NULL CHECK (stage IN ('intake', 'blur', 'stitch', 'lightroom', 'photoshop', 'qa', 'bucket', 'publish')),
    event        VARCHAR(30) NOT NULL CHECK (event IN ('STARTED', 'PROGRESS', 'COMPLETED', 'FLAGGED', 'PUBLISHED', 'AGENT_ONLINE', 'AGENT_OFFLINE')),
    occurrence   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    via          VARCHAR(20) NOT NULL DEFAULT 'system' CHECK (via IN ('agent', 'operator', 'system')),
    detail       TEXT NULL,
    counts       JSONB NULL,
    updated_by   VARCHAR(120) NULL
);

CREATE INDEX IF NOT EXISTS stage_event_ledger_scope_idx
    ON public.stage_event_ledger (project_id, subgrid, stage, occurrence);

CREATE INDEX IF NOT EXISTS stage_event_ledger_subgrid_idx
    ON public.stage_event_ledger (subgrid);

ALTER TABLE public.stage_event_ledger ENABLE ROW LEVEL SECURITY;

-- Internal operations table: authenticated users only, no anon/public access.
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated append on stage_event_ledger" ON public.stage_event_ledger; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Allow authenticated append on stage_event_ledger"
    ON public.stage_event_ledger FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
