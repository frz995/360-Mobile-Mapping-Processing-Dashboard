/**
 * Supabase Storage backup for oversized Road Analysis catalog-layer geometry.
 *
 * The cloud Road Analysis snapshot (project_settings.roadAnalysisState) must stay
 * lean (its shared row has a hard size limit and a column boundary), so heavy
 * layer GeoJSON — e.g. a 21k-feature road plan at ~35 MB — is never embedded.
 * Instead the serialized `geojsonJson` bytes are written to a private Storage
 * bucket and the layer keeps only a `geometryStoragePath` pointer. On a cloud
 * restore (especially on another browser/device) those bytes are pulled back and
 * rehydrated onto the layer, replacing the old "geometry is lost forever" trade-off.
 *
 * All helpers are best-effort and NEVER throw: if the bucket/policies are missing
 * (migration 0021 not applied), uploads return null and callers fall back to the
 * legacy device-local (IndexedDB) persistence exactly as before.
 */

import { supabase } from './api/client';
import { ROAD_GEOMETRY_BUCKET_DEFAULT } from '../config/defaults';
import type { CatalogVectorLayer } from '../utils/gisImportParser';

const ROAD_GEOMETRY_FOLDER = 'catalog';

export function getRoadGeometryBucket(): string {
  return import.meta.env.VITE_ROAD_GEOMETRY_BUCKET || ROAD_GEOMETRY_BUCKET_DEFAULT;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function sanitizeForStoragePath(value: string): string {
  const clean = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return clean || `layer-${Date.now()}`;
}

/** Paths already uploaded this session (layer ids are globally unique). */
const uploadedLayerPaths = new Map<string, string>();

export type CatalogLayerGeometrySource = Pick<
  CatalogVectorLayer,
  'id' | 'geojson' | 'geojsonJson' | 'geometryBytes' | 'geometryStoragePath'
>;

/**
 * Upload a heavy layer's serialized geometry to Storage and return its object
 * path. Re-uses an existing path (already on the layer or uploaded this session)
 * instead of re-uploading unchanged bytes, and upserts onto a deterministic path
 * so repeated saves never accumulate orphan files. Returns null when the bytes
 * are unavailable or the upload fails (bucket missing / permission denied).
 */
export async function uploadCatalogLayerGeometry(
  layer: CatalogLayerGeometrySource
): Promise<string | null> {
  const existing = layer.geometryStoragePath;
  if (existing) return existing;
  const cached = uploadedLayerPaths.get(layer.id);
  if (cached) return cached;

  const geojsonJson =
    layer.geojsonJson || (layer.geojson ? safeStringify(layer.geojson) : undefined);
  if (!geojsonJson || geojsonJson.length === 0) return null;

  const bucket = getRoadGeometryBucket();
  if (!bucket) return null;

  const path = `${ROAD_GEOMETRY_FOLDER}/${sanitizeForStoragePath(layer.id)}.geojson`;
  try {
    const { data, error } = await supabase.storage.from(bucket).upload(
      path,
      new Blob([geojsonJson], { type: 'application/json' }),
      { contentType: 'application/json', upsert: true }
    );
    if (error || !data?.path) {
      console.warn(
        '[RoadAnalysis] catalog geometry upload skipped:',
        error?.message || 'no object path returned'
      );
      return null;
    }
    uploadedLayerPaths.set(layer.id, data.path);
    return data.path;
  } catch (err) {
    console.warn('[RoadAnalysis] catalog geometry upload failed:', err);
    return null;
  }
}

/**
 * Download a layer's serialized geometry string back from Storage. Returns the
 * raw GeoJSON string (ready for `geojsonJson` / MapLibre blob URL), or null.
 */
export async function downloadCatalogLayerGeometry(path: string): Promise<string | null> {
  if (!path) return null;
  const bucket = getRoadGeometryBucket();
  if (!bucket) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).download?.(path);
    if (error || !data) return null;
    return await data.text();
  } catch (err) {
    console.warn('[RoadAnalysis] catalog geometry download failed:', err);
    return null;
  }
}

/** Best-effort removal of a stored geometry object (used on layer deletion). */
export function forgetUploadedLayerPath(layerId: string): void {
  uploadedLayerPaths.delete(layerId);
}