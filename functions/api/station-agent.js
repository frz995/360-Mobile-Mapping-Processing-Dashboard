function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function parseMap(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const stationId = (params.get('stationId') || '').toLowerCase();
  const resource = (params.get('resource') || '').toLowerCase();
  const jobId = params.get('jobId') || '';
  const urls = parseMap(env.STATION_AGENT_URLS);
  const tokens = parseMap(env.STATION_AGENT_TOKENS);
  const origin = String(urls[stationId] || '').replace(/\/+$/, '');
  if (!['blur', 'stitch', 'lightroom', 'photoshop'].includes(stationId) || !origin) {
    return json({ error: `No HTTPS tunnel configured for station '${stationId || 'unknown'}'.` }, 503);
  }
  try {
    if (new URL(origin).protocol !== 'https:') return json({ error: 'Station-agent tunnel URLs must use HTTPS.' }, 503);
  } catch {
    return json({ error: `Invalid station-agent URL for '${stationId}'.` }, 503);
  }

  const routes = {
    health: { method: 'GET', path: '/health' },
    report: { method: 'GET', path: '/api/station' },
    rename: { method: 'POST', path: '/api/rename' },
    'sync-start': { method: 'POST', path: '/api/sync-bucket' }
  };
  let route = routes[resource];
  if (resource === 'sync-poll' && /^[a-f0-9]{8,32}$/i.test(jobId)) {
    route = { method: 'GET', path: `/api/sync-bucket/${encodeURIComponent(jobId)}` };
  }
  if (!route) return json({ error: 'Unsupported station-agent resource.' }, 400);
  if (request.method !== route.method) return json({ error: 'Method not allowed.' }, 405);

  const headers = new Headers();
  const token = String(tokens[stationId] || env.STATION_AGENT_TOKEN || '');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (route.method === 'POST') headers.set('Content-Type', 'application/json');
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
    headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
  }

  try {
    const body = route.method === 'POST' ? await request.arrayBuffer() : undefined;
    const upstream = await fetch(`${origin}${route.path}`, { method: route.method, headers, body });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return json({ error: `Station agent '${stationId}' is unreachable through its Cloudflare Tunnel.` }, 502);
  }
}
