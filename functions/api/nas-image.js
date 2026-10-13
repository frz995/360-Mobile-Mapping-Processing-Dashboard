import { upstreamSignal, classifyUpstreamError } from '../_lib/upstream';
import { resolveTenantWorker, TenantWorkerError } from '../_lib/tenantWorker';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/** A panorama tile is local NAS I/O, so this is generous; the browser's own
 *  60s budget (BucketPublicationGate) is what normally ends the wait. */
const IMAGE_TIMEOUT_MS = 60_000;

export async function onRequestGet({ request, env, data }) {
  // The organisation comes from the middleware, which derived it from the
  // caller's verified membership (bearer) or from the signed claim inside an
  // asset token. It is never taken from this request.
  const organizationId = data?.organizationId;
  if (!organizationId) {
    return json({ error: 'No company context on this request.' }, 401);
  }

  const rel = new URL(request.url).searchParams.get('path') || '';
  // searchParams already decodes, so `%2e%2e` arrives as `..`; also reject
  // separators smuggled inside a single segment (the worker runs on Windows).
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length || segments.some((s) => s === '.' || s === '..' || s.includes('\\') || s.includes('\0'))) {
    return json({ error: 'Invalid NAS image path.' }, 400);
  }

  let worker;
  try {
    worker = await resolveTenantWorker(env, organizationId);
  } catch (err) {
    if (err instanceof TenantWorkerError) return json({ error: err.message }, err.status);
    return json({ error: 'NAS worker is not configured for your company.' }, 502);
  }
  const { base, token } = worker;

  try {
    const target = `${base}/api/images/${segments.map(encodeURIComponent).join('/')}`;
    const reqHeaders = new Headers({ Authorization: `Bearer ${token}` });
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      reqHeaders.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
      reqHeaders.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    }
    // Without these the worker cannot answer 304 and the whole point is lost.
    for (const name of ['If-None-Match', 'If-Modified-Since']) {
      const value = request.headers.get(name);
      if (value) reqHeaders.set(name, value);
    }
    const { signal, state, dispose } = upstreamSignal(request, IMAGE_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(target, { headers: reqHeaders, signal });
    } catch (err) {
      const { status, message } = classifyUpstreamError(err, state);
      return json({ error: message || 'NAS image service is unreachable.' }, status);
    } finally {
      dispose();
    }

    // Revalidate rather than hard-cache: the route is authenticated, so the
    // response must stay `private`, and a revoked session should not keep
    // serving bytes. `no-cache` still stores the body, it just requires a
    // conditional request first -- and the worker already emits an ETag, so
    // that revalidation is a bodiless 304 instead of a full NAS re-read.
    const resHeaders = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'private, no-cache'
    });
    for (const name of ['ETag', 'Last-Modified', 'Vary']) {
      const value = upstream.headers.get(name);
      if (value) resHeaders.set(name, value);
    }
    if (upstream.status === 304) {
      resHeaders.delete('Content-Type');
      return new Response(null, { status: 304, headers: resHeaders });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: resHeaders
    });
  } catch {
    return json({ error: 'NAS image service is unreachable.' }, 502);
  }
}
