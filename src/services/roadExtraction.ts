// =====================================================================
// Road-line extraction service (Option A: client + cropper).
//
// The dashboard acts as a client for an external road-data / extraction
// service. It sends the selected district's bounding box, receives real
// road polylines (OSM/Overpass by default), and returns them for the
// workspace to clip to the exact district geometry and render.
//
// Providers are behind a small adapter interface so a hosted ML road
// extractor can be plugged in later with a one-file swap + an env change:
//   VITE_ROAD_EXTRACTION_ROUTE : 'overpass' (default) | 'custom'
//   VITE_ROAD_EXTRACTION_URL   : Overpass endpoint (default overpass-api.de)
//   VITE_ROAD_EXTRACTION_KEY   : optional API key for non-default providers
// =====================================================================

export interface RoadExtractionBBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** A road line as a list of [lng, lat] coordinates plus optional tags. */
export interface ExtractedRoadLine {
  id?: string;
  coordinates: Array<[number, number]>;
  highway?: string;
  name?: string;
}

export interface RoadExtractionResult {
  /** Provider human-readable name, e.g. "OSM / Overpass". */
  source: string;
  /** ISO timestamp of the extraction, or null when none. */
  timestamp: string | null;
  lines: ExtractedRoadLine[];
}

export interface RoadExtractionAdapter {
  name: string;
  extract(bbox: RoadExtractionBBox): Promise<RoadExtractionResult>;
}

interface OverpassElement {
  type: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

function bboxToString(b: RoadExtractionBBox): string {
  return `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`;
}

function buildOptimizedOverpassQuery(b: RoadExtractionBBox): string {
  const bboxStr = bboxToString(b);
  return [
    '[out:json][timeout:20];(',
    `way["highway"="motorway"](${bboxStr});`,
    `way["highway"="trunk"](${bboxStr});`,
    `way["highway"="primary"](${bboxStr});`,
    `way["highway"="secondary"](${bboxStr});`,
    `way["highway"="tertiary"](${bboxStr});`,
    `way["highway"="unclassified"](${bboxStr});`,
    `way["highway"="residential"](${bboxStr});`,
    `way["highway"="service"](${bboxStr});`,
    ');out geom qt;'
  ].join('');
}

/** Highway values that represent drivable/street roads (exclude paths, etc.). */
const DRIVABLE_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'living_street', 'road'
]);

function isDrivable(tags?: Record<string, string>): boolean {
  if (!tags) return true;
  const h = (tags.highway || '').toLowerCase();
  if (!h) return false;
  return DRIVABLE_HIGHWAY.has(h);
}

/**
 * Decode an Overpass JSON payload into drivable road lines.
 */
function decodeOverpassPayload(payload: any): ExtractedRoadLine[] {
  // If the server proxy already decoded and compacted the lines, return directly
  if (payload && Array.isArray(payload.lines)) {
    return payload.lines;
  }

  const elements: OverpassElement[] =
    payload && Array.isArray(payload.elements) ? payload.elements : [];

  const lines: ExtractedRoadLine[] = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    if (!isDrivable(el.tags)) continue;
    const coords: Array<[number, number]> = [];
    for (const g of el.geometry) {
      const lng = Number(g?.lon);
      const lat = Number(g?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      coords.push([Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
    }
    if (coords.length < 2) continue;
    lines.push({
      id: el.id != null ? `overpass-${el.id}` : undefined,
      coordinates: coords,
      highway: el.tags?.highway,
      name: el.tags?.name
    });
  }
  return lines;
}

/**
 * OSM / Overpass provider. Free, no credentials, returns the real road
 * network for the requested bounding box.
 *
 * The request is routed through the Vercel serverless proxy
 * (`/api/road-extraction`) so the browser never talks to Overpass
 * cross-origin (public Overpass instances don't send CORS headers, which
 * blocks browser fetches on deployed origins). When the proxy is
 * unavailable (e.g. raw `vite dev` without the Vercel CLI) it falls back to
 * a direct Overpass POST for local development.
 *
 * Env overrides:
 *   VITE_ROAD_EXTRACTION_PROXY  : client-side proxy endpoint (default /api/road-extraction)
 *   VITE_ROAD_EXTRACTION_URL    : direct Overpass URL (local fallback only;
 *                                 upstream of the proxy uses its own server env)
 *   VITE_ROAD_EXTRACTION_DIRECT : set to '1' to skip the proxy entirely
 */
const overpassAdapter: RoadExtractionAdapter = {
  name: 'OSM / Overpass',
  async extract(bbox): Promise<RoadExtractionResult> {
    const query = buildOptimizedOverpassQuery(bbox);
    const directUrl = import.meta.env.VITE_ROAD_EXTRACTION_URL || 'https://overpass-api.de/api/interpreter';
    const proxyEndpoint = import.meta.env.VITE_ROAD_EXTRACTION_PROXY || '/api/road-extraction';
    const forceDirect = import.meta.env.VITE_ROAD_EXTRACTION_DIRECT === '1';

    // 1) Serverless proxy (production path; CORS-safe).
    let payload: any = null;
    if (!forceDirect) {
      payload = await fetchViaProxy(proxyEndpoint, bbox, query);
    }

    // 2) Direct fallback (local dev or when proxy endpoint is 404).
    if (payload === null) {
      payload = await fetchOverpassDirect(directUrl, query);
    }

    return {
      source: payload?.source || this.name,
      timestamp: payload?.timestamp || new Date().toISOString(),
      lines: decodeOverpassPayload(payload)
    };
  }
};

async function fetchViaProxy(endpoint: string, bbox: RoadExtractionBBox, query: string): Promise<any | null> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox, query })
    });
  } catch (networkErr: any) {
    // Complete network failure reaching the proxy itself (e.g. no internet)
    // Return null so we can try the direct fallback in local dev
    return null;
  }

  // 404 means the proxy route doesn't exist → local dev without the vite middleware
  if (res.status === 404) return null;

  if (!res.ok) {
    // Proxy returned a proper error (5xx, 400, etc.) — surface it directly so
    // the user gets a meaningful message, not a misleading Overpass URL.
    const errJson = await res.json().catch(() => null);
    const mirror_details = Array.isArray(errJson?.details) ? '\n' + errJson.details.join('\n') : '';
    const msg = errJson?.error
      ? `Road extraction failed: ${errJson.error}${mirror_details}`
      : `Road extraction service returned HTTP ${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  return await res.json().catch(() => null);
}

const DIRECT_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

async function fetchOverpassDirect(initialUrl: string, query: string): Promise<any> {
  const mirrors = Array.from(new Set([initialUrl, ...DIRECT_MIRRORS]));
  let lastError: any = null;

  for (const url of mirrors) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (res.ok) return await res.json().catch(() => null);
      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err: any) {
      lastError = err;
    }
  }

  // TypeError = CORS block (browser can't reach Overpass cross-origin on production)
  if (lastError?.name === 'TypeError') {
    throw new Error(
      'Road extraction failed: the browser cannot reach Overpass directly (CORS). ' +
      'Make sure the /api/road-extraction serverless function is deployed correctly on Vercel.'
    );
  }

  throw new Error(`Road extraction unreachable: ${String(lastError?.message || lastError)}`);
}

/** Resolve the active adapter from env; default is Overpass. */
export function getRoadExtractionAdapter(): RoadExtractionAdapter {
  const route = (import.meta.env.VITE_ROAD_EXTRACTION_ROUTE || 'overpass').toLowerCase();
  if (route === 'overpass') return overpassAdapter;
  // Future: register custom adapters here keyed by route name.
  return overpassAdapter;
}
