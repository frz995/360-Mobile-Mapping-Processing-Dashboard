function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet({ request, env }) {
  const base = (env.NAS_API_URL || '').replace(/\/+$/, '');
  const token = env.NAS_WORKER_TOKEN || '';
  if (!base || !token) {
    return json({ error: 'Configure NAS_API_URL and NAS_WORKER_TOKEN in Cloudflare Pages.' }, 503);
  }
  try {
    const target = new URL(`${base}/api/nas-scan`);
    target.search = new URL(request.url).search;
    const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: 'application/json' });
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
      headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    }
    const upstream = await fetch(target, { headers });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch {
    return json({ error: 'NAS worker is unreachable through the configured Cloudflare Tunnel.' }, 502);
  }
}
