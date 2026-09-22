// =====================================================================
// Public map shares — token links for read-only viewing of the WebGIS
// survey map and the Road Analysis lines. A share stores a compact,
// simplified snapshot of the published state at creation time plus an
// optional password (SHA-256 digest only). The viewer lives on the
// /share/<token> route and requires a signed-in user (auth-only RLS).
// =====================================================================

import { supabase } from '../services/api/client';
import { resolvePanoramaUrl, resolvePanoramaConfigUrl, type StorageResolveSettings } from '../services/storageUrls';
import { getActiveProjectId } from '../services/projectContext';
import { getPOICount, getImagesProcessedCount } from './dashboardData';
import { extractSubgridName } from './subgrid';

export type ShareKind = 'webgis' | 'road';

export interface SharePoint {
  lat: number;
  lng: number;
  subgrid?: string;
  status?: 'published' | 'staging' | 'in-process' | 'defect';
  color?: string;
}

export interface ShareTrack {
  subgrid: string;
  coords: Array<[number, number]>;
}

export interface ShareSegment {
  subgrid: string;
  km: number;
  poi: number;
  frames: number;
  defects: number;
  date?: string;
  pic?: string;
  status: 'published' | 'in-process';
  /** Flat equirectangular 360° panorama URL for this subgrid (for the corner PiP viewer). */
  panoramaUrl?: string;
  /** Multi-res cubemap tiles config URL (only when the storage strategy is tiled). */
  configUrl?: string;
  /**
   * Source reference for the representative panorama. Kept alongside the baked
   * URL so the viewer can re-resolve imagery at view time through a single seam
   * (`resolveSegmentPanorama`) — the hook a deployment can point at a signed,
   * expiring storage endpoint without changing the share page.
   */
  panoramaRef?: { filename: string; subgrid?: string };
}

export interface ShareLine {
  coords: Array<[number, number]>;
  name?: string;
}

export interface ShareCatalogLayer {
  id: string;
  name: string;
  color: string;
  fillColor?: string;
  fillOpacity?: number;
  opacity: number;
  strokeWidth: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  pointRadius?: number;
  pointStrokeColor?: string;
  geometryType: 'LineString' | 'Polygon' | 'Point' | 'Mixed';
  featureCount: number;
  geojson: any;
}

export interface ShareSnapshot {
  center: [number, number];
  zoom: number;
  bbox?: [number, number, number, number];
  points?: SharePoint[];
  tracks?: ShareTrack[];
  segments?: ShareSegment[];
  lines?: ShareLine[];
  catalogLayers?: ShareCatalogLayer[];
  /**
   * Frozen storage-resolution prefs captured at share creation. Allows the
   * viewer to resolve panorama URLs (and later signed/tokenized media) from the
   * source filename at view time instead of trusting a baked, potentially stale
   * absolute URL.
   */
  storage?: StorageResolveSettings;
  stats: {
    subgrids: number;
    km: number;
    poi: number;
    frames: number;
    defects: number;
    passRate: number;
    lines?: number;
  };
  projectName?: string;
  contractCode?: string;
  planName?: string;
}

export interface MapShare {
  id: string;
  token: string;
  kind: ShareKind;
  title: string;
  project_id: string | null;
  snapshot: ShareSnapshot;
  basemap: string;
  password_hash: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
}

const SHARE_POINTS_CAP = 25000;
const SHARE_CATALOG_FEATURE_CAP = 150000;
const SHARE_COORD_PRECISION = 6;

/** Subset of project settings the URL resolvers need; nothing else leaks into a share. */
const STORAGE_SETTINGS_KEYS: Array<keyof StorageResolveSettings> = [
  'storageProvider', 'imageStorageStrategy',
  'r2Domain', 'r2PublicUrl', 'r2PublicDomain', 'customCdnUrl', 'customStorageUrl', 'cloudStorageBaseUrl',
  'supabaseUrl', 'supabaseBucket', 'multiResTilePattern', 'tilePathPattern', 'multiResFallbackPattern',
  'singleImagePathPattern', 'imageFormatPattern', 'imageStoragePath', 'manifestEnabled', 'manifestPath',
  's3Bucket', 's3Region', 'gcsBucket', 'azureAccount', 'azureContainer', 'wasabiBucket', 'wasabiRegion',
  'nasServerUrl', 'productionApiUrl'
];

/** Copies only the storage-resolution settings into a share snapshot (frozen at creation time). */
export function pickStorageResolveSettings(ps?: Record<string, unknown> | null): StorageResolveSettings | undefined {
  if (!ps) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of STORAGE_SETTINGS_KEYS) {
    const v = ps[key];
    if (v !== undefined && v !== null && v !== '') out[key] = v;
  }
  return Object.keys(out).length > 0 ? (out as StorageResolveSettings) : undefined;
}

function roundCoord(v: number): number {
  return Math.round(v * 10 ** SHARE_COORD_PRECISION) / 10 ** SHARE_COORD_PRECISION;
}

export function generateShareToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------
// Password digests — SHA-256 hex. Web Crypto where available (https /
// localhost); compact pure-JS fallback for plain-http on-prem origins.
// ---------------------------------------------------------------------

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256Fallback(message: string): string {
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const withPad = new Uint8Array((((bytes.length + 9) + 63) & ~63));
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0, false);
  view.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const w = new Uint32Array(64);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (let i = 0; i < 8; i++) h[i] = (h[i] + [a, b, c, d, e, f, g, hh][i]) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

export async function hashSharePassword(password: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    try {
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through to the pure-JS digest
    }
  }
  return sha256Fallback(password);
}

export async function verifySharePassword(share: Pick<MapShare, 'password_hash'>, password: string): Promise<boolean> {
  if (!share.password_hash) return true;
  const digest = await hashSharePassword(password);
  return digest.toLowerCase() === share.password_hash.toLowerCase();
}

// ---------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------

export function lineDistanceKm(coords: Array<[number, number]>): number {
  let total = 0;
  const R = 6371.0088;
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  return total;
}

function boundsOf(allCoords: Array<[number, number]>): { center: [number, number]; bbox: [number, number, number, number] } | null {
  if (allCoords.length === 0) return null;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lat, lng] of allCoords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2], bbox: [minLat, minLng, maxLat, maxLng] };
}

function zoomForBbox(bbox: [number, number, number, number]): number {
  const latSpan = Math.max(0.002, bbox[2] - bbox[0]);
  const lngSpan = Math.max(0.002, bbox[3] - bbox[1]);
  const span = Math.max(latSpan, lngSpan);
  if (span > 4) return 8;
  if (span > 2) return 9;
  if (span > 1) return 10;
  if (span > 0.5) return 11;
  if (span > 0.2) return 12;
  if (span > 0.08) return 13;
  return 14;
}

// ---------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------

const FALLBACK_CENTER: [number, number] = [3.139, 101.6869];

/** Builds per-subgrid survey detail rows from the shared daily survey ledger. */
export function buildShareSegments(dailyData: any[], projectSettings?: StorageResolveSettings): ShareSegment[] {
  const segments: ShareSegment[] = [];
  for (const item of dailyData || []) {
    const rawSg = item.subgrid || item.imageFilename || '';
    const sg = (extractSubgridName(rawSg) || rawSg || '').toUpperCase().trim();
    const isPublished = item.publishToWebGIS === 'yes' || item.publishToWebGIS === 'Yes'
      || item.publishToUSVPRO === 'yes' || Boolean(item.isSyncedWithSupabase) || item.status === 'Complete' || item.isFromSupabase === true;
    const km = Number(item.kmProcessed) || 0;

    // Resolve a representative 360° panorama for this subgrid so the shared
    // viewer's corner PiP can render imagery without needing storage config.
    const firstPan = (item.panoramas && item.panoramas[0]) || (item.points && item.points[0]) || {};
    const rawFn = firstPan.filename || firstPan.image_url || firstPan.point_id || '';
    const cleanFn = String(rawFn || '').split('/').pop() || rawFn;
    let panoramaUrl: string | undefined;
    let configUrl: string | undefined;
    if (cleanFn) {
      const url = resolvePanoramaUrl(cleanFn, projectSettings, { subgrid: sg || cleanFn });
      if (url) {
        panoramaUrl = url;
        // Only meaningful when the storage strategy is tiled (multi-res).
        if ((projectSettings?.imageStorageStrategy || '') !== 'single_equirectangular') {
          configUrl = resolvePanoramaConfigUrl(cleanFn, projectSettings, sg || cleanFn) || undefined;
        }
      }
    }

    segments.push({
      subgrid: sg || '—',
      km: Math.round(km * 100) / 100,
      poi: getPOICount(item),
      frames: getImagesProcessedCount(item),
      defects: Number(item.defects) || 0,
      date: typeof item.date === 'string' ? item.date.slice(0, 10) : undefined,
      pic: item.pic || undefined,
      status: isPublished ? 'published' : 'in-process',
      ...(cleanFn ? { panoramaRef: { filename: cleanFn, subgrid: sg || cleanFn } } : {}),
      ...(panoramaUrl ? { panoramaUrl, ...(configUrl ? { configUrl } : {}) } : {})
    });
  }
  return segments;
}

export function buildWebgisSnapshot(dailyData: any[], projectSettings?: any): ShareSnapshot {
  const points: SharePoint[] = [];
  const tracks: ShareTrack[] = [];
  const segments = buildShareSegments(dailyData, projectSettings);
  const allCoords: Array<[number, number]> = [];
  const uniqueSubgrids = new Set<string>();

  let totalKm = 0;
  let totalPoi = 0;
  let totalFrames = 0;
  let totalDefects = 0;

  for (const item of dailyData || []) {
    const rawSg = item.subgrid || item.imageFilename || '';
    const sg = (extractSubgridName(rawSg) || rawSg || '').toUpperCase().trim();
    if (sg) uniqueSubgrids.add(sg);

    const isPublished = item.publishToWebGIS === 'yes' || item.publishToWebGIS === 'Yes'
      || item.publishToUSVPRO === 'yes' || Boolean(item.isSyncedWithSupabase) || item.status === 'Complete' || item.isFromSupabase === true;

    const poi = getPOICount(item);
    const frames = getImagesProcessedCount(item);
    const km = Number(item.kmProcessed) || 0;
    const defects = Number(item.defects) || 0;
    totalKm += km;
    totalPoi += poi;
    totalFrames += frames;
    totalDefects += defects;

    const pans: any[] = item.panoramas || item.points || [];
    const trackCoords: Array<[number, number]> = [];
    for (const p of pans) {
      const lat = Number(p.latitude ?? p.lat);
      const lng = Number(p.longitude ?? p.lon ?? p.lng);
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;
      if (points.length >= SHARE_POINTS_CAP) break;
      const rLat = roundCoord(lat);
      const rLng = roundCoord(lng);
      points.push({ lat: rLat, lng: rLng, subgrid: sg || undefined, status: isPublished ? 'published' : 'in-process' });
      trackCoords.push([rLat, rLng]);
      allCoords.push([rLat, rLng]);
    }
    if (trackCoords.length > 1) tracks.push({ subgrid: sg || '—', coords: trackCoords });
  }

  const b = boundsOf(allCoords);
  const stats = {
    subgrids: uniqueSubgrids.size || segments.length,
    km: Math.round(totalKm * 100) / 100,
    poi: totalPoi,
    frames: totalFrames,
    defects: totalDefects,
    passRate: totalPoi > 0 ? Math.max(0, ((totalPoi - totalDefects) / totalPoi) * 100) : 100
  };

  const snap = {
    center: b ? b.center : (Array.isArray(projectSettings?.defaultCenter) ? [Number(projectSettings.defaultCenter[0]), Number(projectSettings.defaultCenter[1])] : FALLBACK_CENTER),
    zoom: b ? zoomForBbox(b.bbox) : 11,
    bbox: b?.bbox,
    points,
    tracks,
    segments,
    stats,
    storage: pickStorageResolveSettings(projectSettings),
    projectName: projectSettings?.projectName || undefined,
    contractCode: projectSettings?.contractCode || undefined
  } as ShareSnapshot;
  return snap;
}

export interface ShareCatalogLayerInput {
  id?: string;
  name?: string;
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
  opacity?: number;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  pointRadius?: number;
  pointStrokeColor?: string;
  geometryType?: string;
  visible?: boolean;
  geojson?: any;
  geojsonJson?: string;
}

/** Rounds every coordinate pair and caps feature count so huge imports stay portable. */
export function serializeCatalogGeometry(layer?: ShareCatalogLayerInput | null): any | null {
  if (!layer) return null;
  if (layer.visible === false) return null;
  let geo = layer.geojson;
  if (!geo && layer.geojsonJson) {
    try { geo = JSON.parse(layer.geojsonJson); } catch { geo = null; }
  }
  if (!geo || !Array.isArray(geo.features) || geo.features.length === 0) return null;
  const capped = geo.features.slice(0, SHARE_CATALOG_FEATURE_CAP);
  const clone = { type: 'FeatureCollection', features: capped };
  for (const f of clone.features) {
    if (f?.geometry?.coordinates) {
      f.geometry = { ...f.geometry, coordinates: roundGeometryCoords(f.geometry.coordinates) };
    }
  }
  return clone;
}

function roundGeometryCoords(coords: any): any {
  if (typeof coords?.[0] === 'number') {
    return [roundCoord(coords[0]), roundCoord(coords[1])];
  }
  return Array.isArray(coords) ? coords.map(roundGeometryCoords) : coords;
}

export interface BuildRoadSnapshotOptions {
  planName?: string;
  projectSettings?: any;
  capturedPoints?: Array<{
    lat?: number;
    lng?: number;
    subgrid?: string;
    status?: string;
    isPublished?: boolean;
    color?: string;
  }>;
  capturedTracks?: Array<Array<[number, number]> | { coords: Array<[number, number]>; subgrid?: string }>;
  catalogLayers?: ShareCatalogLayerInput[];
  segments?: ShareSegment[];
  stats?: Partial<ShareSnapshot['stats']>;
  bbox?: [number, number, number, number] | null;
}

export function buildRoadSnapshot(
  extractedLines: Array<{ coordinates: Array<[number, number]>; highway?: string; name?: string; id?: string }>,
  opts?: BuildRoadSnapshotOptions
): ShareSnapshot {
  const lines: ShareLine[] = [];
  const points: SharePoint[] = [];
  const tracks: ShareTrack[] = [];
  const allCoords: Array<[number, number]> = [];
  let totalKm = 0;

  // 1. Extracted road lines
  for (const l of extractedLines || []) {
    const coords = (l.coordinates || [])
      .map(([lat, lng]) => [roundCoord(lat), roundCoord(lng)] as [number, number])
      .filter(([lat, lng]) => isFinite(lat) && isFinite(lng));
    if (coords.length < 2) continue;
    lines.push({ coords, name: l.highway || l.name || undefined });
    allCoords.push(...coords);
    totalKm += lineDistanceKm(coords);
  }

  // 2. Captured survey tracks/runs
  if (Array.isArray(opts?.capturedTracks)) {
    opts.capturedTracks.forEach((trk, idx) => {
      const rawCoords = Array.isArray(trk) ? trk : trk?.coords;
      const sg = !Array.isArray(trk) && trk?.subgrid ? trk.subgrid : `Run ${idx + 1}`;
      if (!Array.isArray(rawCoords) || rawCoords.length < 2) return;
      const coords: Array<[number, number]> = rawCoords
        .map(([c0, c1]) => {
          const lat = c0 >= -90 && c0 <= 90 && c1 > 90 ? c0 : c1;
          const lng = c0 > 90 ? c0 : c1;
          return [roundCoord(lat), roundCoord(lng)] as [number, number];
        })
        .filter(([lat, lng]) => isFinite(lat) && isFinite(lng));

      if (coords.length > 1) {
        tracks.push({ subgrid: sg, coords });
        allCoords.push(...coords);
        if (lines.length === 0) {
          totalKm += lineDistanceKm(coords);
        }
      }
    });
  }

  // 3. Captured panotrack survey points
  if (Array.isArray(opts?.capturedPoints)) {
    for (const p of opts.capturedPoints) {
      const rawLat = Number(p.lat);
      const rawLng = Number(p.lng);
      if (!isFinite(rawLat) || !isFinite(rawLng) || (rawLat === 0 && rawLng === 0)) continue;
      const rLat = roundCoord(rawLat);
      const rLng = roundCoord(rawLng);

      let status: 'published' | 'staging' | 'defect' = 'staging';
      if (p.color === '#ef4444' || p.status === 'defect') {
        status = 'defect';
      } else if (p.color === '#10b981' || p.isPublished || p.status === 'published') {
        status = 'published';
      }

      points.push({
        lat: rLat,
        lng: rLng,
        subgrid: p.subgrid || undefined,
        status,
        color: p.color
      });
      allCoords.push([rLat, rLng]);
    }
  }

  // 4. User-imported catalog GIS layers (serialized, size-capped/rounded)
  const catalogLayers: ShareCatalogLayer[] = [];
  if (Array.isArray(opts?.catalogLayers)) {
    for (const layer of opts.catalogLayers) {
      const geo = serializeCatalogGeometry(layer);
      if (!geo) continue;
      catalogLayers.push({
        id: String(layer?.id ?? `import-${catalogLayers.length + 1}`),
        name: String(layer?.name || 'Imported layer'),
        color: layer?.color || '#38bdf8',
        fillColor: layer?.fillColor,
        fillOpacity: layer?.fillOpacity,
        opacity: typeof layer?.opacity === 'number' ? Math.max(0, Math.min(1, layer.opacity)) : 0.8,
        strokeWidth: typeof layer?.strokeWidth === 'number' ? Math.max(1, Math.min(10, layer.strokeWidth)) : 3,
        strokeStyle: layer?.strokeStyle,
        pointRadius: layer?.pointRadius,
        pointStrokeColor: layer?.pointStrokeColor,
        geometryType: (layer?.geometryType as ShareCatalogLayer['geometryType']) || 'Mixed',
        featureCount: geo.features.length,
        geojson: geo
      });
    }
  }

  const b = boundsOf(allCoords);

  // Normalize bbox if passed from district boundary
  let bbox = b?.bbox;
  if (opts?.bbox && Array.isArray(opts.bbox) && opts.bbox.length === 4) {
    const [c0, c1, c2, c3] = opts.bbox;
    if (c0 > c1) {
      // Input is [minLng, minLat, maxLng, maxLat] -> normalize to [minLat, minLng, maxLat, maxLng]
      bbox = [c1, c0, c3, c2];
    } else {
      bbox = [c0, c1, c2, c3];
    }
  }

  const effectiveKm = typeof opts?.stats?.km === 'number'
    ? opts.stats.km
    : Math.round(totalKm * 100) / 100;

  const effectivePoi = typeof opts?.stats?.poi === 'number'
    ? opts.stats.poi
    : points.length;

  const effectiveSubgrids = typeof opts?.stats?.subgrids === 'number'
    ? opts.stats.subgrids
    : (points.length > 0 ? new Set(points.map((p) => p.subgrid).filter(Boolean)).size : 0);

  const effectiveDefects = typeof opts?.stats?.defects === 'number'
    ? opts.stats.defects
    : points.filter((p) => p.status === 'defect').length;

  const effectivePassRate = typeof opts?.stats?.passRate === 'number'
    ? opts.stats.passRate
    : (effectivePoi > 0 ? Math.max(0, Math.round(((effectivePoi - effectiveDefects) / effectivePoi) * 100)) : 100);

  return {
    center: b ? b.center : (bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : FALLBACK_CENTER),
    zoom: bbox ? zoomForBbox(bbox) : (b ? zoomForBbox(b.bbox) : 11),
    bbox,
    lines,
    points: points.length > 0 ? points : undefined,
    tracks: tracks.length > 0 ? tracks : undefined,
    segments: opts?.segments?.length ? opts.segments : undefined,
    catalogLayers: catalogLayers.length > 0 ? catalogLayers : undefined,
    stats: {
      subgrids: effectiveSubgrids,
      km: effectiveKm,
      poi: effectivePoi,
      frames: opts?.stats?.frames ?? 0,
      defects: effectiveDefects,
      passRate: effectivePassRate,
      lines: lines.length
    },
    projectName: opts?.projectSettings?.projectName || undefined,
    contractCode: opts?.projectSettings?.contractCode || undefined,
    planName: opts?.planName || undefined,
    storage: pickStorageResolveSettings(opts?.projectSettings)
  };
}

// ---------------------------------------------------------------------
// Imagery resolution seam
// ---------------------------------------------------------------------
// Forward-looking, single place that turns a share segment's representative
// panorama into URLs consumed by the corner 360 viewer. Today it prefers the
// source reference + frozen storage prefs (so URLs are never baked-and-stale).
// A deployment that wants truly signed, expiring, revocable media should swap
// the `storage` resolution below for a call to a backend endpoint
// (e.g. `GET /api/share-media/:token/:filename?subgrid=`) returning a short-lived
// presigned URL — the share page and viewer never need to change.

export interface ResolvedPanoramaMedia {
  panoramaUrl?: string;
  configUrl?: string;
}

export function resolveSegmentPanorama(
  segment?: ShareSegment | null,
  storage?: StorageResolveSettings
): ResolvedPanoramaMedia {
  if (!segment) return {};
  const ref = segment.panoramaRef;
  if (ref?.filename && storage) {
    const panoramaUrl = resolvePanoramaUrl(ref.filename, storage, { subgrid: ref.subgrid || undefined });
    if (panoramaUrl) {
      const multiRes = (storage.imageStorageStrategy || '') !== 'single_equirectangular';
      const configUrl = multiRes
        ? resolvePanoramaConfigUrl(ref.filename, storage, ref.subgrid || ref.filename) || undefined
        : undefined;
      return { panoramaUrl, configUrl };
    }
  }
  return { panoramaUrl: segment.panoramaUrl, configUrl: segment.configUrl };
}

// ---------------------------------------------------------------------
// Share CRUD
// ---------------------------------------------------------------------

export interface CreateShareInput {
  kind: ShareKind;
  title: string;
  snapshot: ShareSnapshot;
  basemap?: string;
  password?: string | null;
  expiresDays?: number | null;
  createdBy?: string | null;
}

export function sharePublicUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

const LOCAL_SHARE_PREFIX = 'gs-share:';

export async function createShare(input: CreateShareInput): Promise<{ share: MapShare; url: string }> {
  const token = generateShareToken();
  const passwordHash = input.password ? await hashSharePassword(input.password) : null;
  const expiresAt = input.expiresDays && input.expiresDays > 0
    ? new Date(Date.now() + input.expiresDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const fallbackShare: MapShare = {
    id: `local-${token}`,
    token,
    kind: input.kind,
    title: input.title || 'Shared Map',
    project_id: getActiveProjectId(),
    snapshot: input.snapshot,
    basemap: input.basemap || 'ofm-positron',
    password_hash: passwordHash,
    created_by: input.createdBy || null,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    revoked_at: null,
    view_count: 0
  };

  try {
    localStorage.setItem(LOCAL_SHARE_PREFIX + token, JSON.stringify(fallbackShare));
  } catch { /* storage quota exceeded or disabled */ }

  try {
    const { data, error } = await supabase
      .from('map_shares')
      .insert({
        token,
        kind: input.kind,
        title: input.title || 'Shared Map',
        project_id: getActiveProjectId(),
        snapshot: input.snapshot,
        basemap: input.basemap || 'ofm-positron',
        password_hash: passwordHash,
        created_by: input.createdBy || null,
        expires_at: expiresAt
      })
      .select()
      .single();

    if (!error && data) {
      const share = data as MapShare;
      try {
        localStorage.setItem(LOCAL_SHARE_PREFIX + token, JSON.stringify(share));
      } catch { /* ignore */ }
      return { share, url: sharePublicUrl(share.token) };
    }
  } catch (err) {
    console.warn('[mapShares] Supabase cloud insert failed, using local mirror:', err);
  }

  return { share: fallbackShare, url: sharePublicUrl(fallbackShare.token) };
}

export async function fetchShareByToken(token: string): Promise<MapShare | null> {
  try {
    const { data, error } = await supabase
      .from('map_shares')
      .select('id, token, kind, title, project_id, snapshot, basemap, password_hash, created_by, created_at, expires_at, revoked_at, view_count')
      .eq('token', token)
      .maybeSingle();
    if (!error && data) {
      const s = data as MapShare;
      try { localStorage.setItem(LOCAL_SHARE_PREFIX + token, JSON.stringify(s)); } catch { /* ignore */ }
      return s;
    }
  } catch {
    // Supabase network / offline fallback
  }

  // Fallback to local storage mirror
  try {
    const raw = localStorage.getItem(LOCAL_SHARE_PREFIX + token);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.token === token) {
        if (parsed.expires_at && new Date(parsed.expires_at).getTime() < Date.now()) {
          return null; // Expired
        }
        if (parsed.revoked_at) return null; // Revoked
        return parsed as MapShare;
      }
    }
  } catch { /* parse error */ }

  return null;
}

export async function touchShare(token: string): Promise<void> {
  try {
    await supabase.rpc('map_share_touch', { p_token: token });
  } catch {
    // view counting is best-effort
  }
}

// Remember an unlocked password for the tab session so a refresh does not
// re-prompt on a page that already verified the digest.
const UNLOCK_PREFIX = 'gs-share-unlock:';

export function rememberShareUnlock(token: string, password: string): void {
  try { sessionStorage.setItem(UNLOCK_PREFIX + token, password); } catch { /* ignore */ }
}

export function recallShareUnlock(token: string): string | null {
  try { return sessionStorage.getItem(UNLOCK_PREFIX + token); } catch { return null; }
}

export function parseShareToken(pathOrHash: string): string | null {
  if (!pathOrHash) return null;
  const clean = pathOrHash.replace(/^#\/?/, '').trim();
  const m = clean.match(/^(?:share\/|\/share\/)([A-Za-z0-9_-]{6,80})/i);
  return m ? m[1] : null;
}
