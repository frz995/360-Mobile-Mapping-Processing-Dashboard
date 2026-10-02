-- =====================================================================
-- GeoSphere 360 — Promote the raw CSV file name to a real column
--             (Migration 0029)
--
-- Root cause this fixes: the operator's raw CSV file name was only ever
-- smuggled inside the free-text `description` column as a `[csv:...]` tag,
-- built by string concatenation in `saveToStagingSupabase`:
--
--   description: `Staged Batch (${subgrid}) [id:${batchId}] [csv:${csvFileName}] ...`
--
-- That has three problems:
--
--   1. Parsing it back out on every read is fragile. `datasets.ts` chains six
--      fallbacks (`r.csv_file_name || r.source_file || /\[csv:(.*?)\]/ ||
--      /\[id:(.*?)\]/ || ...`) purely because there is no column to read.
--   2. Early rows were written before `csvFileName` was populated, so the tag
--      holds a synthetic `daily-csv-<timestamp>-…` id instead of a real file
--      name. That synthetic value then became the record name in the Dataset
--      Registry, which is what the operator sees.
--   3. `description` is user-facing free text. Anyone editing it in Supabase,
--      or any future writer that drops the tag, silently loses the file name.
--
-- This migration adds `csv_file_name`, backfills it from the existing `[csv:…]`
-- tag, and strips synthetic `daily-csv-*` values back to NULL so the client
-- falls back to a clean derived label instead of showing a timestamp.
--
-- Every statement is IF NOT EXISTS / idempotent, so it is safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------
ALTER TABLE public.staging_panoramas
    ADD COLUMN IF NOT EXISTS csv_file_name TEXT;

COMMENT ON COLUMN public.staging_panoramas.csv_file_name IS
    'Raw survey CSV file name this panorama batch was imported from. Authoritative source for the Dataset Registry record name; replaces the [csv:...] tag previously embedded in description.';

-- ---------------------------------------------------------------------
-- 2. Backfill from the [csv:...] tag
--
-- Only rows that are still missing the column are touched, so re-running is a
-- no-op. `substring(... FROM '\[csv:(.*?)\]')` is non-greedy, so it stops at
-- the first `]` and does not swallow the rest of the description.
-- ---------------------------------------------------------------------
UPDATE public.staging_panoramas
   SET csv_file_name = BTRIM(substring(description FROM '\[csv:(.*?)\]'))
 WHERE csv_file_name IS NULL
   AND description IS NOT NULL
   AND description ~ '\[csv:[^\]]*\]';

-- ---------------------------------------------------------------------
-- 3. Null out synthetic placeholder values
--
-- Rows staged before `csvFileName` was passed through carry a
-- `daily-csv-<timestamp>-…` id. Those are not file names: leaving them in place
-- means the Dataset Registry keeps showing an internal synthetic id as the
-- record name. Clearing them lets the client fall back to deriving a label
-- from the panorama filename / subgrid, which is what an operator recognises.
-- ---------------------------------------------------------------------
UPDATE public.staging_panoramas
   SET csv_file_name = NULL
 WHERE csv_file_name IS NOT NULL
   AND (
     csv_file_name ~* '^daily-csv-'
     OR csv_file_name ~* '^staging-[0-9a-f-]{8,}$'
     OR BTRIM(csv_file_name) = ''
   );

-- ---------------------------------------------------------------------
-- 4. Index
--
-- The read path filters by project and groups by csv_file_name, so a partial
-- index over the populated rows keeps the registry query off a sequential scan
-- while staying small (the NULL synthetic rows are not indexed).
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_staging_panoramas_csv_file_name
    ON public.staging_panoramas (project_id, csv_file_name)
    WHERE csv_file_name IS NOT NULL;

COMMIT;

-- NOTE: PostgREST caches the schema. After running this, reload it with
--   NOTIFY pgrst, 'reload schema';
-- or restart the PostgREST container, otherwise writes that include the new
-- `csv_file_name` key keep failing with PGRST204 "Could not find the
-- 'csv_file_name' column" even though the column now exists.
