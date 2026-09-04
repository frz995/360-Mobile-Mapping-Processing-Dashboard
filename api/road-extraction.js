// =====================================================================
// Vercel serverless proxy for road extraction (Overpass).
//
// The browser cannot call Overpass directly on a deployed origin because
// public Overpass instances do not reliably send CORS headers, so the
// browser blocks the cross-origin response ("NetworkError when attempting
// to fetch resource"). This function performs the Overpass request
// server-side (server-to-server, no CORS involved) and returns the JSON to
// the client.
//
// Client contract (see src/services/roadExtraction.ts): POST JSON
//   { query: "<OverpassQL>" }
// Response: the raw Overpass JSON body.
//
// The upstream URL is read from VITE_ROAD_EXTRACTION_URL (server env) so it
// can be overridden per environment without reconfiguring the client.
// =====================================================================

const DEFAULT_UPSTREAM = 'https://overpass-api.de/api/interpreter';

function readQuery(req) {
  const contentType = (req.headers['content-type'] || '').toLowerCase();

  // JSON body: { "query": "..." }
  if (contentType.includes('application/json')) {
    try {
      const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
      return typeof body?.query === 'string' ? body.query : '';
    } catch {
      return '';
    }
  }

  // Form-urlencoded body: data=<urlencoded query>
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = typeof req.body === 'string' ? req.body : '';
    try {
      const params = new URLSearchParams(raw);
      return params.get('data') || '';
    } catch {
      return '';
    }
  }

  return '';
}

function writeJson(res, status, body, headers = {}) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  const query = readQuery(req);
  if (!query || !query.trim()) {
    writeJson(res, 400, { error: 'Missing "query" field.' });
    return;
  }

  const upstream = process.env.VITE_ROAD_EXTRACTION_URL || DEFAULT_UPSTREAM;

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query)
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => '');
      writeJson(res, upstreamRes.status, {
        error: `Upstream Overpass request failed (${upstreamRes.status} ${upstreamRes.statusText}).`,
        detail: String(text).slice(0, 2000)
      });
      return;
    }

    const text = await upstreamRes.text();
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
  } catch (err) {
    writeJson(res, 502, {
      error: `Road extraction unreachable (${upstream}): ${String(err)}`
    });
  }
}
