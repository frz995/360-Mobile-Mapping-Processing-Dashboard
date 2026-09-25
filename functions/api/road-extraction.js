// =====================================================================
// Cloudflare Pages Function — road extraction proxy (Overpass).
//
// Drop-in replacement for the Vercel `api/road-extraction.js` function so
// the Road Analysis workspace keeps working unchanged at `/api/road-extraction`
// (client default `VITE_ROAD_EXTRACTION_PROXY`). Runs on the Web-standard
// Request/Response model used by Pages Functions (no Node req/res APIs).
//
// Upstream override, when set: VITE_ROAD_EXTRACTION_URL in the Pages
// environment variables.
// =====================================================================

const TIMEOUT_MS = 8000;

const UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
].filter(Boolean);

const OVERPASS_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept': '*/*',
  'User-Agent': 'RoadExtractionDashboard/1.0 (https://github.com/your-repo; contact@your-domain.com)'
};

const DRIVABLE_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'living_street', 'road'
]);

function buildOverpassQuery(bbox) {
  const b = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  return [
    '[out:json][timeout:25];(',
    `way["highway"="motorway"](${b});`,
    `way["highway"="trunk"](${b});`,
    `way["highway"="primary"](${b});`,
    `way["highway"="secondary"](${b});`,
    `way["highway"="tertiary"](${b});`,
    `way["highway"="unclassified"](${b});`,
    `way["highway"="residential"](${b});`,
    `way["highway"="service"](${b});`,
    `way["highway"="motorway_link"](${b});`,
    `way["highway"="trunk_link"](${b});`,
    `way["highway"="primary_link"](${b});`,
    `way["highway"="secondary_link"](${b});`,
    `way["highway"="tertiary_link"](${b});`,
    `way["highway"="living_street"](${b});`,
    `way["highway"="road"](${b});`,
    ');out geom qt;'
  ].join('');
}

function decodeElementsToLines(payload) {
  const elements = payload && Array.isArray(payload.elements) ? payload.elements : [];
  const lines = [];
  for (const el of elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const h = (el.tags?.highway || '').toLowerCase();
    if (h && !DRIVABLE_HIGHWAY.has(h)) continue;
    const coords = [];
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
      startNode: aligned ? el.nodes[0] : undefined,
      endNode: aligned ? el.nodes[el.nodes.length - 1] : undefined
    });
  }
  return lines;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch { /* fall through */ }
  try {
    const text = await request.clone().text();
    try {
      return JSON.parse(text || '{}');
    } catch { /* query-string payload */ }
    const data = new URLSearchParams(text).get('data');
    if (data) return { query: data };
  } catch { /* ignore */ }
  return {};
}

function jsonResponse(data, status, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...headers
    }
  });
}

/** Try a single Overpass mirror with a hard per-request timeout and retries. */
async function tryUpstream(upstream, query) {
  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(upstream, {
        method: 'POST',
        headers: OVERPASS_HEADERS,
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!r.ok) {
        throw new Error(`HTTP ${r.status} ${r.statusText} from ${upstream}`);
      }
      return await r.json();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function onRequestPost(context) {
  const upstreamOverride = context.env?.VITE_ROAD_EXTRACTION_URL;
  const upstreams = upstreamOverride
    ? [upstreamOverride, ...UPSTREAMS]
    : UPSTREAMS;

  const body = await readBody(context.request);
  let query = '';

  if (body.bbox && typeof body.bbox === 'object') {
    const { minLng, minLat, maxLng, maxLat } = body.bbox;
    if (
      Number.isFinite(minLng) && Number.isFinite(minLat) &&
      Number.isFinite(maxLng) && Number.isFinite(maxLat)
    ) {
      query = buildOverpassQuery(body.bbox);
    }
  }
  if (!query && typeof body.query === 'string' && body.query.trim()) {
    query = body.query.trim();
  }
  if (!query) {
    return jsonResponse({ error: 'Missing "bbox" or "query" in request body.' }, 400);
  }

  const errors = [];
  for (const upstream of upstreams) {
    try {
      const data = await tryUpstream(upstream, query);
      const lines = decodeElementsToLines(data);
      return jsonResponse({
        source: `OSM / Overpass (${new URL(upstream).hostname})`,
        timestamp: new Date().toISOString(),
        lines
      }, 200, {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
      });
    } catch (err) {
      errors.push(`[${new URL(upstream).hostname}] ${err.message}`);
    }
  }

  return jsonResponse({
    error: 'All Overpass mirrors failed. Try again later.',
    details: errors
  }, 502);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}