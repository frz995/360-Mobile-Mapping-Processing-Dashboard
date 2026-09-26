-- =====================================================================
-- GeoSphere 360 — Station board metric unit (Migration 0025)
--
-- Tile-rig stations (PC 1 blur) count progress in capture POINTS
-- (rig folders of camera tiles), not stitched images. Persist the unit
-- alongside the counters so a restored snapshot keeps honest labels.
-- =====================================================================

DO $$
BEGIN
    IF to_regclass('public.station_board_items') IS NOT NULL THEN
        ALTER TABLE public.station_board_items
            ADD COLUMN IF NOT EXISTS metric_unit VARCHAR(10) NOT NULL DEFAULT 'frames'
            CHECK (metric_unit IN ('frames', 'points'));
    ELSE
        RAISE NOTICE 'station_board_items missing — run 0023 first.';
    END IF;
END $$;
