import { nasImageProxyEnabled as resolveNasImageProxy } from '../config/transport';
import { fetchDashboardApi } from './cloudflareApi';
import { getActiveOrganizationId } from './tenantContext';

/** Short-lived signed token used for NAS image / tile-config URLs.
 *
 *  The Cloudflare Pages Function that serves NAS images requires authentication,
 *  but `<img src>` and tile-config loaders cannot send the Supabase
 *  Authorization header. After the signed-in user fetches a token here, the URL
 *  builders append it as `?t=` and the Pages middleware accepts either the
 *  bearer session or that HMAC token.
 *
 *  The token also carries the caller's company as a signed claim (migration
 *  0043), so an `<img src>` cannot select another company's worker. */
const TOKEN_REFRESH_MS = 50 * 60 * 1000;

let cachedToken = '';
let cachedAt = 0;
let cachedOrgId = '';
let inFlight: Promise<string> | null = null;

/**
 * Append the active company to a NAS API path.
 *
 * The edge resolves the company from the verified bearer and only needs this
 * hint when a user belongs to more than one — without it such a caller gets a
 * 409 rather than a wrong company. Centralised so the six `/api/nas-scan` call
 * sites cannot each forget it, and so the parameter name matches the edge's
 * `?org=` exactly.
 */
export function tenantApiUrl(path: string): string {
  const org = getActiveOrganizationId();
  if (!org) return path;
  return path.includes('?') ? `${path}&org=${encodeURIComponent(org)}` : `${path}?org=${encodeURIComponent(org)}`;
}

/** Re-exported so image URL builders have a single import for "use the proxy". */
export function isNasImageProxyEnabled(): boolean {
  return resolveNasImageProxy();
}

export function nasImageToken(): string {
  return cachedToken;
}

/** Cache a freshly minted token (also used to reset the cache in tests). */
export function setNasImageToken(token: string): void {
  cachedToken = token || '';
  cachedAt = token ? Date.now() : 0;
  cachedOrgId = token ? getActiveOrganizationId() || '' : '';
  inFlight = null;
}

/** Same-origin NAS image URL, carrying the signed token when one is available. */
export function nasImageUrl(relPath: string): string {
  const base = `/api/nas-image?path=${encodeURIComponent(relPath)}`;
  return cachedToken ? `${base}&t=${encodeURIComponent(cachedToken)}` : base;
}

export async function ensureNasImageToken(): Promise<string> {
  if (!isNasImageProxyEnabled()) return '';
  // The token is bound to a company, so the cache is keyed by it. Without this,
  // switching company inside the refresh window would keep serving `<img src>`
  // requests carrying the previous company's claim — the image path would
  // resolve against the wrong worker.
  const orgId = getActiveOrganizationId() || '';
  if (cachedToken && cachedOrgId === orgId && Date.now() - cachedAt < TOKEN_REFRESH_MS) return cachedToken;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetchDashboardApi(tenantApiUrl('/api/nas-image-token'));
      if (!res.ok) return cachedToken;
      const body = await res.json().catch(() => ({}));
      if (typeof body?.token === 'string' && body.token) {
        cachedToken = body.token;
        cachedAt = Date.now();
        cachedOrgId = getActiveOrganizationId() || '';
      }
      return cachedToken;
    } catch {
      return cachedToken;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test-only reset hook. */
export function __resetNasImageTokenCache(): void {
  setNasImageToken('');
}
