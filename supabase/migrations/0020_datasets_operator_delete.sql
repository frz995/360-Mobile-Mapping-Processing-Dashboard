-- =====================================================================
-- GeoSphere 360 — Operator Dataset Delete (Migration 0020)
--
-- Lets Survey Operators delete catalog rows from `public.datasets`
-- (the dataset registry / Index Directory). Operators may already
-- INSERT and UPDATE these metadata rows (via `sec.can('runQaqc')`);
-- DELETE is the missing leg.
--
-- Notes:
--   * Dataset rows are catalog metadata only — this never touches NAS
--     files, so Operator delete risk is limited to removing an index
--     entry (idempotent re-register in Browser restores it).
--   * Handle with care — `processing_jobs` may reference datasets via
--     `source_dataset_id` / `output_dataset_id` (ON DELETE SET NULL), so
--     deleting a dataset nulls those link columns rather than cascading.
--   * Safe to re-run (DROP POLICY ... IF EXISTS).
-- =====================================================================

ALTER TABLE public.datasets DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "datasets_delete" ON public.datasets;
CREATE POLICY "datasets_delete" ON public.datasets
  FOR DELETE
  USING (sec.can('manageDatasets') OR sec.can('runQaqc'));

ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;