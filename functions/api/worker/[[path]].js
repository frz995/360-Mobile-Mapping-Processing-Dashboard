function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/** Raw, un-normalized pathname. `new URL()` collapses `.` and `%2e%2e`
 * segments, which would silently rewrite the upstream path, so slice the
 * original string instead and validate before building the target URL. */
function rawPathname(url) {
  const afterScheme = url.indexOf('://');
  const start = url.indexOf('/', afterScheme + 3);
  const path = start === -1 ? '/' : url.slice(start);
  return path.split('?')[0].split('#')[0];
}

/** Same-origin, authenticated proxy for the full NAS worker API. The NAS
 * worker token stays in Cloudflare Pages secrets instead of the browser. */
export async function onRequest(context) {
  const { request, env } = context;
  const base = (env.NAS_API_URL || '').replace(/\/+$/, '');
  const token = env.NAS_WORKER_TOKEN || '';
  if (!base || !token) return json({ error: 'Configure NAS_API_URL and NAS_WORKER_TOKEN in Cloudflare Pages.' }, 503);
  const incoming = new URL(request.url);
  let suffix = rawPathname(request.url).slice('/api/worker'.length);
  if (!suffix.startsWith('/')) suffix = `/${suffix}`;
  // Decode before validating: `%2e%2e` and friends survive URL normalization
  // and would otherwise collapse into another upstream route.
  let segments;
  try {
    segments = suffix.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    return json({ error: 'Invalid worker API route.' }, 400);
  }
  if (!segments.length || segments.some((part) => part === '.' || part === '..' || part.includes('/') || part.includes('\\') || part.includes('\0'))) {
    return json({ error: 'Invalid worker API route.' }, 400);
  }
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) {
    return json({ error: 'Method not allowed.' }, 405);
  }
  try {
    const target = new URL(`${base}/${segments.map(encodeURIComponent).join('/')}`);
    target.search = incoming.search;
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
      headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    const upstream = await fetch(target, { method: request.method, headers, body });
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
