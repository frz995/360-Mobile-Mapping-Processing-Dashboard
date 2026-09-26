function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet({ request, env }) {
  const base = (env.NAS_API_URL || '').replace(/\/+$/, '');
  const token = env.NAS_WORKER_TOKEN || '';
  const rel = new URL(request.url).searchParams.get('path') || '';
  // searchParams already decodes, so `%2e%2e` arrives as `..`; also reject
  // separators smuggled inside a single segment (the worker runs on Windows).
  const segments = rel.split('/').filter(Boolean);
  if (!base || !token) return json({ error: 'Configure NAS_API_URL and NAS_WORKER_TOKEN in Cloudflare Pages.' }, 503);
  if (
    !segments.length ||
    segments.some((s) => s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))
  ) {
    return json({ error: 'Invalid NAS image path.' }, 400);
  }
  try {
    const target = `${base}/api/images/${segments.map(encodeURIComponent).join('/')}`;
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
      headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    }
    const upstream = await fetch(target, { headers });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control': 'private, no-store'
      }
    });
  } catch {
    return json({ error: 'NAS image service is unreachable.' }, 502);
  }
}
