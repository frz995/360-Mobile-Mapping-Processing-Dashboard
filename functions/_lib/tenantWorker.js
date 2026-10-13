// Per-organisation NAS worker resolution for the Cloudflare Pages Functions.
//
// THE DEFECT THIS EXISTS TO CLOSE
//   The NAS request path used to be:
//
//     browser (any signed-in user of the install)
//       -> /api/nas-scan or /api/nas-image
//         -> _middleware.js        verified the Supabase bearer
//         -> nas-image.js          attached env.NAS_WORKER_TOKEN to env.NAS_API_URL
//           -> worker/app.py       served from ONE NAS_BASE_PATH
//
//   The middleware checked that the caller was a user of the *installation*. It
//   never asked which company they belonged to, and the handler then presented
//   the single install-wide worker token. worker/app.py:53-54 holds one
//   `NAS_BASE_PATH` and one `API_TOKEN`, so every signed-in user could walk
//   every other company's raw survey filesystem.
//
// THE RULE
//   The organisation is derived from the CALLER'S VERIFIED MEMBERSHIP, never
//   from a request parameter. A `?org=` hint is honoured only when it matches
//   an organisation the caller demonstrably belongs to, so a forged value can
//   produce an error or fall back to the caller's own tenant, and can never
//   select somebody else's worker.
//
// HOW THE TWO STEPS USE DIFFERENT CREDENTIALS
//   1. Membership is read with the CALLER'S OWN bearer, so PostgREST evaluates
//      RLS on organization_members and returns only that user's rows. No
//      privileged credential is involved in deciding who they are.
//   2. The worker token is read with service_role, because the browser must
//      never hold it — migration 0043 restricts the table to platform
//      administrators and the edge needs to read it after authenticating the
//      caller by other means.
//
// LEGACY FALLBACK
//   A single-tenant install has no organization_workers rows and configures
//   NAS_API_URL / NAS_WORKER_TOKEN in the Pages environment. That keeps working
//   with no configuration change.
//
//   The fallback is all-or-nothing ON PURPOSE: it applies only while
//   organization_workers is entirely empty. The moment a second company's worker
//   is registered, every organisation must have its own row, because falling
//   back per-organisation would send an unconfigured tenant to the install-wide
//   worker — which is precisely the leak being closed.

/** Error carrying an HTTP status, thrown rather than returned so callers cannot
 *  forget to check. */
export class TenantWorkerError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TenantWorkerError';
    this.status = status;
  }
}

const BOOTSTRAP_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const MEMBERSHIP_QUERY_TIMEOUT_MS = 5_000;

function requireConfig(env) {
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_ANON_KEY || '';
  if (!url || !key) {
    throw new TenantWorkerError(503, 'Configure SUPABASE_URL and SUPABASE_ANON_KEY in Cloudflare Pages.');
  }
  return { url, key };
}

async function timedFetch(target, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The organisation ids the caller is an ACTIVE member of.
 *
 * Uses the caller's bearer so `organization_members` RLS does the filtering:
 * a tenant user sees their own rows and nothing else. A suspended membership is
 * excluded here as well as in `sec.current_org()`, so the two cannot disagree.
 */
export async function resolveCallerOrganizations(env, authorization) {
  const { url, key } = requireConfig(env);
  const target =
    `${url}/rest/v1/organization_members` +
    `?select=organization_id&status=eq.active&order=organization_id.asc`;

  let res;
  try {
    res = await timedFetch(
      target,
      { headers: { apikey: key, Authorization: authorization, Accept: 'application/json' } },
      MEMBERSHIP_QUERY_TIMEOUT_MS
    );
  } catch (err) {
    throw new TenantWorkerError(502, `Cannot verify organization membership: ${err?.message || 'unreachable'}`);
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new TenantWorkerError(401, 'Session is invalid or has no company access.');
    }
    throw new TenantWorkerError(502, `Membership lookup failed with HTTP ${res.status}.`);
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => String(r.organization_id || '')).filter(Boolean);
}

/**
 * Pick the organisation to act as.
 *
 * Fail-closed at every branch: no membership means no access, and an ambiguous
 * membership with no hint means the caller must say which — rather than the
 * code picking the first row, which is how a contractor ends up inside another
 * company's survey.
 */
export function selectOrganization(organizationIds, requestedOrgId) {
  // Deduplicate as well as filter blanks. `organization_members` has
  // UNIQUE (organization_id, user_id) so PostgREST should not repeat a row, but
  // a duplicate would turn a single-company user into a 409 and leave them
  // locked out of their own tenant — a confusing failure for a condition that
  // costs nothing to tolerate.
  const ids = Array.from(new Set((organizationIds || []).filter(Boolean)));
  if (ids.length === 0) {
    throw new TenantWorkerError(
      403,
      'Your account is not an active member of any company. Awaiting workspace assignment.'
    );
  }
  const requested = String(requestedOrgId || '').trim();
  if (requested) {
    if (!ids.includes(requested)) {
      // Not an error about the request being malformed: the caller asked for
      // something they are not a member of. Say so precisely.
      throw new TenantWorkerError(403, 'You are not a member of that company.');
    }
    return requested;
  }
  if (ids.length > 1) {
    throw new TenantWorkerError(
      409,
      'You belong to more than one company. Add ?org=<company-id> to choose which one.'
    );
  }
  return ids[0];
}

async function fetchWorkerRow(env, organizationId) {
  const { url } = requireConfig(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return { row: null, unavailable: true };

  const target =
    `${url}/rest/v1/organization_workers` +
    `?organization_id=eq.${encodeURIComponent(organizationId)}&select=nas_api_url,worker_token`;

  let res;
  try {
    res = await timedFetch(
      target,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' } },
      MEMBERSHIP_QUERY_TIMEOUT_MS
    );
  } catch {
    return { row: null, unavailable: true };
  }
  if (!res.ok) return { row: null, unavailable: true };

  const rows = await res.json();
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  return { row, unavailable: false };
}

async function countConfiguredWorkers(env) {
  const { url } = requireConfig(env);
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return 0;
  try {
    const res = await timedFetch(
      `${url}/rest/v1/organization_workers?select=organization_id&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: 'count=exact', Range: '0-0' } },
      MEMBERSHIP_QUERY_TIMEOUT_MS
    );
    const header = res.headers.get('content-range');
    if (header) return Number(header.split('/')[1] || '0') || 0;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Resolve the worker endpoint and bearer token for `organizationId`.
 *
 * Returns `{ base, token, source }`. `source` is 'organization' or 'legacy' so
 * the caller can report which credential path was used when diagnosing an
 * install, without ever logging the token itself.
 */
export async function resolveTenantWorker(env, organizationId) {
  const { row, unavailable } = await fetchWorkerRow(env, organizationId);

  if (row && row.nas_api_url && row.worker_token) {
    return { base: String(row.nas_api_url).replace(/\/+$/, ''), token: String(row.worker_token), source: 'organization' };
  }

  if (!unavailable) {
    const configured = await countConfiguredWorkers(env);
    if (configured > 0) {
      // At least one company has a worker registered, so this installation has
      // been cut over to per-organisation credentials. Refusing here is the
      // point: the alternative is silently routing an unconfigured tenant to
      // the install-wide worker.
      throw new TenantWorkerError(
        409,
        'No NAS worker is configured for your company. Contact your administrator.'
      );
    }
  }

  // Legacy single-tenant install: nothing has been registered, so the
  // environment variables remain authoritative.
  const base = (env.NAS_API_URL || '').replace(/\/+$/, '');
  const token = env.NAS_WORKER_TOKEN || '';
  if (!base || !token) {
    if (!unavailable) {
      throw new TenantWorkerError(
        409,
        'No NAS worker is configured for your company. Contact your administrator.'
      );
    }
    throw new TenantWorkerError(
      503,
      'Configure SUPABASE_SERVICE_ROLE_KEY with organization_workers, or NAS_API_URL and NAS_WORKER_TOKEN for a single-tenant install.'
    );
  }
  return { base, token, source: 'legacy' };
}

/** Convenience: bearer + optional `?org=` hint -> `{ organizationId, base, token, source }`. */
export async function authorizeTenantWorker(env, authorization, requestedOrgId) {
  const ids = await resolveCallerOrganizations(env, authorization);
  const organizationId = selectOrganization(ids, requestedOrgId);
  const worker = await resolveTenantWorker(env, organizationId);
  return { organizationId, ...worker };
}

export { BOOTSTRAP_ORGANIZATION_ID };