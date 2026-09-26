-- =====================================================================
-- GeoSphere 360 — Station Flight Board persistence (Migration 0023)
--
-- New table `station_board_items`: one persisted state row per
-- (project, subgrid, station) on the 4-PC Multi-Station Flight Board.
--
-- Why: the board is now auto-driven by the per-PC station agents
-- (station-agent/ — see station-agent/README.md). The dashboard browser
-- derives live state from agent probes (process running + output folder
-- counts) and upserts snapshots here, so the board:
--   * survives refresh / tab switches,
--   * shows one state across all operator browsers,
--   * degrades gracefully to the last known state when an agent goes
--     offline mid-batch.
--
-- Live agent observations always win over a stale snapshot; snapshots are
-- only a restore source. Safe to re-run (IF NOT EXISTS throughout).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.station_board_items (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID REFERENCES public.projects(id),
    subgrid            VARCHAR(50) NOT NULL,
    station_id         VARCHAR(20) NOT NULL CHECK (station_id IN ('blur', 'stitch', 'lightroom', 'photoshop')),
    status             VARCHAR(30) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'FLAGGED')),
    total_frames       INTEGER NOT NULL DEFAULT 0,
    completed_frames   INTEGER NOT NULL DEFAULT 0,
    started_at         TIMESTAMPTZ NULL,
    completed_at       TIMESTAMPTZ NULL,
    source             VARCHAR(20) NOT NULL DEFAULT 'agent',
    note               TEXT NULL,
    last_agent_pulse   TIMESTAMPTZ NULL,
    updated_by         VARCHAR(120) NULL,
    created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS station_board_items_scope_uniq
    ON public.station_board_items (project_id, subgrid, station_id);

CREATE INDEX IF NOT EXISTS station_board_items_subgrid_idx
    ON public.station_board_items (subgrid);

ALTER TABLE public.station_board_items ENABLE ROW LEVEL SECURITY;

-- Internal operations table: authenticated users only, no anon/public access.
DO $$ BEGIN DROP POLICY IF EXISTS "Allow authenticated manage on station_board_items" ON public.station_board_items; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Allow authenticated manage on station_board_items"
    ON public.station_board_items FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);
