import { upstreamSignal, classifyUpstreamError } from '../_lib/upstream';
import { resolveTenantWorker, TenantWorkerError } from '../_lib/tenantWorker';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/** A recursive NAS walk is the slowest thing the worker does; keep the ceiling
 *  above the browser's 10s budget so the client is the usual one to give up. */
const SCAN_TIMEOUT_MS = 60_000;

export async function onRequestGet({ request, env, data }) {
  // Resolved by the middleware from the caller's verified company membership.
  // Before migration 0043 this route used env.NAS_API_URL / env.NAS_WORKER_TOKEN
  // directly, which meant any signed-in user of the install could scan any
  // company's survey filesystem.
  const organizationId = data?.organizationId;
  if (!organizationId) {
    return json({ error: 'No company context on this request.' }, 401);
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
    const target = new URL(`${base}/api/nas-scan`);
    // Forwarded verbatim to the tenant's own worker. The caller cannot redirect
    // this elsewhere: `base` came from the database, not the query string.
    target.search = new URL(request.url).search;
    const headers = new Headers({ Authorization: `Bearer ${token}`, Accept: 'application/json' });
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
      headers.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    }
    const { signal, state, dispose } = upstreamSignal(request, SCAN_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(target, { headers, signal });
    } catch (err) {
      const { status, message } = classifyUpstreamError(err, state);
      return json(
        { error: message || 'NAS worker is unreachable through the configured Cloudflare Tunnel.' },
        status
      );
    } finally {
      dispose();
    }
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
