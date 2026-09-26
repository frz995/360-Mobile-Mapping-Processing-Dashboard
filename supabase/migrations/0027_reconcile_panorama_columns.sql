-- =====================================================================
-- GeoSphere 360 — Reconcile panorama columns (Migration 0027)
--
-- Root cause this fixes: some databases (including local dev) were created
-- from an earlier hand-built schema that stored coordinates ONLY in PostGIS
-- `geom` and orientation in `bearing`. Migration 0012 declares `latitude`,
-- `longitude` and `heading`, but it creates its tables with
-- CREATE TABLE IF NOT EXISTS — so pre-existing tables were silently skipped
-- and never received those columns.
--
-- Consequence: every write from the dashboard failed at PostgREST with
--   PGRST204: Could not find the 'latitude' column of 'staging_panoramas'
-- `saveToStagingSupabase` and `publishToSupabase` both wrote latitude,
-- longitude, heading and is_fallback_coord, so BOTH the manual CSV import and
-- the Production Hub "Publish to WebGIS" path persisted nothing. The rows were
-- added to client state first, so the import looked successful and the data
-- then disappeared on refresh, with every frame count reading 0.
--
-- This migration adds the missing columns, backfills latitude/longitude from
-- the existing `geom` values, derives `panoramas.subgrid` from the filename
-- where possible, and keeps `heading` and `bearing` in sync so either name
-- works. Every statement is IF NOT EXISTS, so it is safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- staging_panoramas
-- ---------------------------------------------------------------------
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS heading   DOUBLE PRECISION;
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS is_fallback_coord BOOLEAN DEFAULT false;
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS production_run_id     TEXT;
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS production_attempt_id TEXT;

-- Backfill coordinates from the geometry that already holds them.
UPDATE public.staging_panoramas
   SET latitude  = ST_Y(geom),
       longitude = ST_X(geom)
 WHERE geom IS NOT NULL
   AND (latitude IS NULL OR longitude IS NULL);

-- ---------------------------------------------------------------------
-- panoramas
-- ---------------------------------------------------------------------
ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS subgrid VARCHAR(50);
ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS heading   DOUBLE PRECISION;
ALTER TABLE public.panoramas ADD COLUMN IF NOT EXISTS is_fallback_coord BOOLEAN DEFAULT false;

UPDATE public.panoramas
   SET latitude  = ST_Y(geom),
       longitude = ST_X(geom)
 WHERE geom IS NOT NULL
   AND (latitude IS NULL OR longitude IS NULL);

-- The read path already falls back to deriving the subgrid from the filename
-- (`r.subgrid || extractSubgrid(filename) || extractSubgrid(description)`), so
-- deriving it here only makes the column trustworthy for filtering/grouping.
UPDATE public.panoramas
   SET subgrid = UPPER(SPLIT_PART(SPLIT_PART(COALESCE(filename, ''), '/', 1), '-', 1))
 WHERE (subgrid IS NULL OR subgrid = '')
   AND COALESCE(filename, '') <> '';

-- ---------------------------------------------------------------------
-- Keep `heading` and `bearing` interchangeable.
--
-- The app writes `heading`; older local schemas and the read path prefer
-- `bearing`, which carries a 0 default. `heading` is therefore authoritative
-- whenever it is supplied, and `bearing` only fills in when left unset.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_panorama_orientation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.heading IS NULL THEN
        NEW.heading := COALESCE(NEW.bearing, 0);
    ELSIF NEW.bearing IS NULL OR NEW.bearing = 0 THEN
        NEW.bearing := NEW.heading;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_panoramas_orientation ON public.panoramas;
CREATE TRIGGER trg_panoramas_orientation
    BEFORE INSERT OR UPDATE ON public.panoramas
    FOR EACH ROW EXECUTE FUNCTION public.sync_panorama_orientation();

DROP TRIGGER IF EXISTS trg_staging_panoramas_orientation ON public.staging_panoramas;
CREATE TRIGGER trg_staging_panoramas_orientation
    BEFORE INSERT OR UPDATE ON public.staging_panoramas
    FOR EACH ROW EXECUTE FUNCTION public.sync_panorama_orientation();

COMMIT;

-- NOTE: PostgREST caches the schema. After running this, reload it with
--   NOTIFY pgrst, 'reload schema';
-- or restart the PostgREST container, otherwise writes keep failing with
-- PGRST204 even though the columns now exist.
