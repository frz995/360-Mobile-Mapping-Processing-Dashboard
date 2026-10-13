import { verifyAssetToken } from './_lib/signing';
import { resolveCallerOrganizations, selectOrganization, TenantWorkerError } from './_lib/tenantWorker';

const PRIVATE_API_PATHS = ['/api/nas-scan', '/api/nas-image', '/api/nas-image-token', '/api/station-agent', '/api/road-extraction', '/api/worker'];

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!PRIVATE_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return context.next();
  }

  const authorization = request.headers.get('Authorization') || '';
  const hasBearer = authorization.startsWith('Bearer ');

  // <img src> and tile-config requests cannot set headers, so the NAS image
  // route also accepts a short-lived HMAC token minted by /api/nas-image-token.
  // That token carries the caller's organisation as a SIGNED claim, so the
  // tenant is fixed at mint time and cannot be swapped by editing the URL.
  const isImageRoute = pathname === '/api/nas-image' || pathname.startsWith('/api/nas-image/');
  if (!hasBearer && isImageRoute) {
    const secret = env.NAS_IMAGE_TOKEN_SECRET || env.NAS_WORKER_TOKEN || '';
    const organizationId = await verifyAssetToken(secret, url.searchParams.get('t') || '', Math.floor(Date.now() / 1000));
    if (organizationId !== null) {
      // Downstream handlers read this instead of re-deriving a tenant from a
      // client parameter.
      context.data = { ...(context.data || {}), organizationId };
      return context.next();
    }
  }

  if (!hasBearer) {
    return json({ error: 'Sign in to access Production Pipeline services.' }, 401);
  }
  const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseKey = env.SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: 'Configure SUPABASE_URL and SUPABASE_ANON_KEY in Cloudflare Pages.' }, 503);
  }

  try {
    const check = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: authorization }
    });
    if (!check.ok) return json({ error: 'Session is invalid or expired.' }, 401);
  } catch {
    return json({ error: 'Authentication service is unreachable.' }, 502);
  }

  // Resolve the caller's company once, here, where the bearer is verified. A
  // NAS route without a tenant is the defect migration 0043 exists to close, so
  // these three refuse to continue rather than falling back to the
  // install-wide worker.
  const isNasRoute =
    pathname === '/api/nas-scan' || pathname === '/api/nas-image' || pathname.startsWith('/api/nas-image/');
  if (isNasRoute) {
    try {
      const ids = await resolveCallerOrganizations(env, authorization);
      const organizationId = selectOrganization(ids, url.searchParams.get('org'));
      context.data = { ...(context.data || {}), organizationId };
    } catch (err) {
      if (err instanceof TenantWorkerError) {
        return json({ error: err.message }, err.status);
      }
      return json({ error: 'Could not verify company access.' }, 502);
    }
  }

  return context.next();
}
