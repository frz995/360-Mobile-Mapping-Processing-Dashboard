import { nasImageProxyEnabled as resolveNasImageProxy } from '../config/transport';
import { fetchDashboardApi } from './cloudflareApi';

/** Short-lived signed token used for NAS image / tile-config URLs.
 *
 * The Cloudflare Pages Function that serves NAS images requires authentication,
 * but `<img src>` and tile-config loaders cannot send the Supabase
 * Authorization header. After the signed-in user fetches a token here, the URL
 * builders append it as `?t=` and the Pages middleware accepts either the
 * bearer session or that HMAC token. */
const TOKEN_REFRESH_MS = 50 * 60 * 1000;

let cachedToken = '';
let cachedAt = 0;
let inFlight: Promise<string> | null = null;

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
  inFlight = null;
}

/** Same-origin NAS image URL, carrying the signed token when one is available. */
export function nasImageUrl(relPath: string): string {
  const base = `/api/nas-image?path=${encodeURIComponent(relPath)}`;
  return cachedToken ? `${base}&t=${encodeURIComponent(cachedToken)}` : base;
}

export async function ensureNasImageToken(): Promise<string> {
  if (!isNasImageProxyEnabled()) return '';
  if (cachedToken && Date.now() - cachedAt < TOKEN_REFRESH_MS) return cachedToken;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetchDashboardApi('/api/nas-image-token');
      if (!res.ok) return cachedToken;
      const body = await res.json().catch(() => ({}));
      if (typeof body?.token === 'string' && body.token) {
        cachedToken = body.token;
        cachedAt = Date.now();
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
