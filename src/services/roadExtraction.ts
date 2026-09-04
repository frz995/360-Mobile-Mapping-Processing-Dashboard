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
      coords.push([lng, lat]);
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
    const query = [
      '[out:json][timeout:30];',
      `(way["highway"](${bboxToString(bbox)}););`,
      'out geom;'
    ].join('');

    const directUrl = import.meta.env.VITE_ROAD_EXTRACTION_URL || 'https://overpass-api.de/api/interpreter';
    const proxyEndpoint = import.meta.env.VITE_ROAD_EXTRACTION_PROXY || '/api/road-extraction';
    const forceDirect = import.meta.env.VITE_ROAD_EXTRACTION_DIRECT === '1';

    // 1) Serverless proxy (production path; CORS-safe).
    let payload: any = null;
    if (!forceDirect) {
      payload = await fetchViaProxy(proxyEndpoint, query);
    }

    // 2) Direct fallback (local dev without the proxy).
    if (payload === null) {
      payload = await fetchOverpassDirect(directUrl, query);
    }

    return {
      source: this.name,
      timestamp: new Date().toISOString(),
      lines: decodeOverpassPayload(payload)
    };
  }
};

async function fetchViaProxy(endpoint: string, query: string): Promise<any | null> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

async function fetchOverpassDirect(url: string, query: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });
  } catch (err) {
    throw new Error(`Road extraction unreachable (${url}): ${String(err)}`);
  }
  if (!res.ok) {
    throw new Error(`Road extraction failed (${res.status} ${res.statusText}).`);
  }
  return await res.json().catch(() => null);
}

/** Resolve the active adapter from env; default is Overpass. */
export function getRoadExtractionAdapter(): RoadExtractionAdapter {
  const route = (import.meta.env.VITE_ROAD_EXTRACTION_ROUTE || 'overpass').toLowerCase();
  if (route === 'overpass') return overpassAdapter;
  // Future: register custom adapters here keyed by route name.
  return overpassAdapter;
}
