-- =====================================================================
-- Migration 0021: Road Analysis catalog-geometry Storage bucket
--
-- Oversized catalog-layer geometry (heavy GeoJSON, e.g. a 21k-feature road
-- plan at ~35 MB) can never live inside the lean `project_settings` snapshot
-- (row-size limit + UI freeze). It is uploaded to this private bucket as a
-- serialized `.geojson` object; the layer keeps only a `geometryStoragePath`
-- pointer. Authenticated readers can pull the bytes back on any browser,
-- so a cloud restore on another device renders the layer instead of losing it.
--
-- The object path is deterministic per layer id (`catalog/<layerId>.geojson`);
-- re-saves upsert the same object, so repeated saves never accumulate files.
--
-- Guests (anon) are intentionally NOT granted access -- they stay local-only,
-- exactly like migration 0014's RPC grant.
--
-- Idempotent: safe to re-run any number of times in the Supabase SQL Editor.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('road-analysis-geometry', 'road-analysis-geometry', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- storage.objects policies: any signed-in role may read/write/destroy
-- objects inside the road-analysis-geometry bucket (the geometry is shared
-- project data, just like the roadAnalysisState snapshot itself).
-- ---------------------------------------------------------------------
drop policy if exists "road_analysis_geometry_auth_read" on storage.objects;
create policy "road_analysis_geometry_auth_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'road-analysis-geometry');

drop policy if exists "road_analysis_geometry_auth_insert" on storage.objects;
create policy "road_analysis_geometry_auth_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'road-analysis-geometry');

drop policy if exists "road_analysis_geometry_auth_update" on storage.objects;
create policy "road_analysis_geometry_auth_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'road-analysis-geometry')
  with check (bucket_id = 'road-analysis-geometry');

drop policy if exists "road_analysis_geometry_auth_delete" on storage.objects;
create policy "road_analysis_geometry_auth_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'road-analysis-geometry');