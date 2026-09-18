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
  /** OSM node id of the first vertex (way node refs), when known. */
  startNode?: number;
  /** OSM node id of the last vertex (way node refs), when known. */
  endNode?: number;
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
  nodes?: number[];
}

function bboxToString(b: RoadExtractionBBox): string {
  return `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`;
}

function buildOptimizedOverpassQuery(b: RoadExtractionBBox): string {
  const bboxStr = bboxToString(b);
  return [
    '[out:json][timeout:25];(',
    `way["highway"="motorway"](${bboxStr});`,
    `way["highway"="trunk"](${bboxStr});`,
    `way["highway"="primary"](${bboxStr});`,
    `way["highway"="secondary"](${bboxStr});`,
    `way["highway"="tertiary"](${bboxStr});`,
    `way["highway"="unclassified"](${bboxStr});`,
    `way["highway"="residential"](${bboxStr});`,
    `way["highway"="service"](${bboxStr});`,
    `way["highway"="motorway_link"](${bboxStr});`,
    `way["highway"="trunk_link"](${bboxStr});`,
    `way["highway"="primary_link"](${bboxStr});`,
    `way["highway"="secondary_link"](${bboxStr});`,
    `way["highway"="tertiary_link"](${bboxStr});`,
    `way["highway"="living_street"](${bboxStr});`,
    `way["highway"="road"](${bboxStr});`,
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
 * Merges road lines that share OSM endpoint node refs into single continuous
 * runs. Two ways meeting at a node that no other way uses (degree 2) are the
 * same physical street split by editors; joining them by node identity is
 * exact — no coordinate tolerance involved. Junction nodes (degree >= 3) are
 * left as separate runs that already share the exact junction coordinate.
 */
export function mergeRoadLinesBySharedNodes(lines: ExtractedRoadLine[]): ExtractedRoadLine[] {
  if (!lines || lines.length === 0) return [];
  if (lines.length === 1) return lines.slice();

  const atNode = new Map<number, Array<{ li: number; end: 0 | 1 }>>();
  lines.forEach((l, li) => {
    ([0, 1] as const).forEach((end) => {
      const n = end === 0 ? l.startNode : l.endNode;
      if (typeof n !== 'number' || !Number.isFinite(n)) return;
      const list = atNode.get(n);
      if (list) list.push({ li, end });
      else atNode.set(n, [{ li, end }]);
    });
  });

  // node -> the two (line, end) halves it joins; only degree-2 nodes link.
  const partner = new Map<string, { li: number; end: 0 | 1 }>();
  const parent = lines.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  atNode.forEach((list) => {
    if (list.length !== 2 || list[0].li === list[1].li) return;
    partner.set(`${list[0].li}|${list[0].end}`, { li: list[1].li, end: list[1].end });
    partner.set(`${list[1].li}|${list[1].end}`, { li: list[0].li, end: list[0].end });
    const a = find(list[0].li);
    const b = find(list[1].li);
    if (a !== b) parent[a] = b;
  });

  const groups = new Map<number, number[]>();
  lines.forEach((_, li) => {
    const root = find(li);
    const g = groups.get(root);
    if (g) g.push(li);
    else groups.set(root, [li]);
  });

  const out: ExtractedRoadLine[] = [];
  groups.forEach((members) => {
    if (members.length === 1) {
      out.push(lines[members[0]]);
      return;
    }

    let startLi = members[0];
    let startEnd: 0 | 1 = 0;
    let cyclic = true;
    for (const li of members) {
      let open: 0 | 1 | -1 = -1;
      if (!partner.has(`${li}|0`)) open = 0;
      else if (!partner.has(`${li}|1`)) open = 1;
      if (open !== -1) {
        startLi = li;
        startEnd = open;
        cyclic = false;
        break;
      }
    }

    const coords: Array<[number, number]> = [];
    const used = new Set<number>();
    let cur: number = startLi;
    let enterEnd: 0 | 1 = startEnd;
    while (!used.has(cur)) {
      used.add(cur);
      const seq =
        enterEnd === 0
          ? lines[cur].coordinates
          : lines[cur].coordinates.slice().reverse();
      if (coords.length === 0) {
        coords.push(...seq);
      } else {
        const tail = coords[coords.length - 1];
        if (tail[0] !== seq[0][0] || tail[1] !== seq[0][1]) coords.push(seq[0]);
        for (let i = 1; i < seq.length; i++) coords.push(seq[i]);
      }
      const nx = partner.get(`${cur}|${enterEnd === 0 ? 1 : 0}`);
      if (!nx) break;
      cur = nx.li;
      enterEnd = nx.end;
    }
    if (cyclic && coords.length > 1) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
    }
    out.push({ ...lines[startLi], coordinates: coords });
  });
  return out;
}

/**
 * Decode an Overpass JSON payload into drivable road lines.
 */
function decodeOverpassPayload(payload: any): ExtractedRoadLine[] {
  // If the server proxy already decoded and compacted the lines, return directly
  if (payload && Array.isArray(payload.lines)) {
    return mergeRoadLinesBySharedNodes(payload.lines);
  }

  const elements: OverpassElement[] =
    payload && Array.isArray(payload.elements) ? payload.elements : [];

  const lines: ExtractedRoadLine[] = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    if (!isDrivable(el.tags)) continue;
    const coords: Array<[number, number]> = [];
    let aligned = Array.isArray(el.nodes) && el.nodes.length === el.geometry.length;
    for (const g of el.geometry) {
      const lng = Number(g?.lon);
      const lat = Number(g?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        aligned = false;
        continue;
      }
      coords.push([Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
    }
    if (coords.length < 2) continue;
    lines.push({
      id: el.id != null ? `overpass-${el.id}` : undefined,
      coordinates: coords,
      highway: el.tags?.highway,
      name: el.tags?.name,
      startNode: aligned ? el.nodes?.[0] : undefined,
      endNode: aligned ? el.nodes?.[el.nodes.length - 1] : undefined
    });
  }
  return mergeRoadLinesBySharedNodes(lines);
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

const OVERPASS_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': 'application/json',
  'User-Agent': 'RoadExtractionDashboard/1.0'
};

async function fetchOverpassDirect(initialUrl: string, query: string): Promise<any> {
  const mirrors = Array.from(new Set([initialUrl, ...DIRECT_MIRRORS]));
  let lastError: any = null;

  for (const url of mirrors) {
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const res = await fetch(url, {
          method: 'POST',
          headers: OVERPASS_HEADERS,
          body: 'data=' + encodeURIComponent(query),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (res.ok) return await res.json().catch(() => null);
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        
        // Don't retry on 406, 429 - try next mirror
        if (res.status === 406 || res.status === 429) break;
      } catch (err: any) {
        lastError = err;
      }
      
      if (attempt < 1) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
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
