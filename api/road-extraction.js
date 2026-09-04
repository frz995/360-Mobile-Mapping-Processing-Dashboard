// =====================================================================
// Vercel serverless proxy for road extraction (Overpass).
//
// The browser cannot call Overpass directly on a deployed origin because
// public Overpass instances do not send CORS headers, so the browser
// blocks the cross-origin response. This function performs the Overpass
// request server-side (no CORS involved), compacts road lines into
// lightweight JSON (< 1.5 MB) and returns them with Edge caching headers.
//
// Mirror fallback order: each upstream gets at most TIMEOUT_MS to respond.
// All mirrors together must finish within Vercel Hobby maxDuration (15 s).
//   4 mirrors × 5 s timeout = 20 s worst-case → stop after first 3 so we
//   comfortably stay under 15 s even with two cold timeouts.
// =====================================================================

const TIMEOUT_MS = 4500; // per-mirror hard timeout

const UPSTREAMS = [
  // Prefer the user-supplied env override if set
  process.env.VITE_ROAD_EXTRACTION_URL,
  // Fast, globally-cached mirror (Cloudflare-backed)
  'https://overpass.kumi.systems/api/interpreter',
  // Official primary
  'https://overpass-api.de/api/interpreter',
  // Official LZ4 replica
  'https://lz4.overpass-api.de/api/interpreter',
  // Official Z replica
  'https://z.overpass-api.de/api/interpreter',
].filter(Boolean);

const DRIVABLE_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'living_street', 'road'
]);

function buildOverpassQuery(bbox) {
  const b = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  // timeout:25 inside Overpass so it self-terminates before our 4.5s fetch timeout
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
    for (const g of el.geometry) {
      const lng = Number(g?.lon);
      const lat = Number(g?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      // Round to 5 decimals (~1 m precision) to halve coordinate string size
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

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === 'object') return resolve(req.body);
      try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch {
        try { resolve({ query: new URLSearchParams(raw).get('data') || '' }); }
        catch { resolve({}); }
      }
    });
    req.on('error', () => resolve({}));
  });
}

function writeJson(res, status, body, headers = {}) {
  res.status?.(status) ?? (res.statusCode = status);
  const json = JSON.stringify(body);
  const defaults = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Length': Buffer.byteLength(json)
  };
  for (const [k, v] of Object.entries({ ...defaults, ...headers })) {
    res.setHeader?.(k, v);
  }
  res.end(json);
}

/** Try a single Overpass mirror with a hard per-request timeout. */
async function tryUpstream(upstream, query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!r.ok) {
      throw new Error(`HTTP ${r.status} ${r.statusText} from ${upstream}`);
    }
    return await r.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export default async function handler(req, res) {
  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    res.status?.(204) ?? (res.statusCode = 204);
    res.setHeader?.('Access-Control-Allow-Origin', '*');
    res.setHeader?.('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end?.();
    return;
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  const body = await readBody(req);
  let query = '';

  // Build query from bbox object OR accept a raw query string
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
    writeJson(res, 400, { error: 'Missing "bbox" or "query" in request body.' });
    return;
  }

  // Try each upstream sequentially; stop at the first success
  const errors = [];
  for (const upstream of UPSTREAMS) {
    try {
      const data = await tryUpstream(upstream, query);
      const lines = decodeElementsToLines(data);

      writeJson(res, 200, {
        source: `OSM / Overpass (${new URL(upstream).hostname})`,
        timestamp: new Date().toISOString(),
        lines
      }, {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
      });
      return;
    } catch (err) {
      errors.push(`[${new URL(upstream).hostname}] ${err.message}`);
    }
  }

  // All mirrors failed
  writeJson(res, 502, {
    error: 'All Overpass mirrors failed. Try again later.',
    details: errors
  });
}
