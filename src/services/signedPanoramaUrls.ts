/**
 * Signed Panorama URL Resolver and Cache for Private Storage Buckets.
 *
 * Provides in-memory TTL token caching and batch pre-signing so that
 * viewing and navigating private panorama imagery (MMS_PIC or S3/R2 private buckets)
 * is responsive (0ms for cached tokens) and avoids redundant network roundtrips.
 */
import { supabase } from './api/client';
import type { StorageResolveSettings } from './storageUrls';

export interface CachedSignedUrl {
  url: string;
  expiresAt: number;
}

const signedCache = new Map<string, CachedSignedUrl>();

/** Default signing TTL: 3600 seconds (1 hour). */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;

/** Refresh token buffer: 5 minutes before actual expiration. */
export const TTL_SAFETY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Synchronously retrieves a valid, non-expired signed URL from cache.
 * Returns null if the item is missing or past its safe TTL.
 */
export function getCachedSignedPanoramaUrl(cacheKey: string): string | null {
  if (!cacheKey) return null;
  const item = signedCache.get(cacheKey);
  if (!item) return null;
  if (Date.now() >= item.expiresAt) {
    signedCache.delete(cacheKey);
    return null;
  }
  return item.url;
}

/**
 * Stores a signed URL in memory with computed expiration.
 */
export function setCachedSignedPanoramaUrl(
  cacheKey: string,
  url: string,
  ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS
): void {
  if (!cacheKey || !url) return;
  const safeTtlMs = Math.max(60, ttlSeconds) * 1000;
  signedCache.set(cacheKey, {
    url,
    expiresAt: Date.now() + safeTtlMs - TTL_SAFETY_BUFFER_MS,
  });
}

/**
 * Clears the in-memory signed URL cache (e.g. on logout or project switch).
 */
export function clearSignedPanoramaUrlCache(): void {
  signedCache.clear();
}

/**
 * Returns the current count of cached signed URLs (for testing and diagnostics).
 */
export function getSignedPanoramaUrlCacheSize(): number {
  return signedCache.size;
}

/**
 * Resolves or fetches a signed URL for a single panorama file.
 */
export async function ensureSignedPanoramaUrl(
  filename: string,
  settings?: StorageResolveSettings,
  ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<string> {
  if (!filename) return '';
  const cleanFn = filename.trim().split('?')[0].replace(/^\/+/, '');
  
  const cached = getCachedSignedPanoramaUrl(cleanFn);
  if (cached) return cached;

  const provider = (settings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2').toLowerCase();

  if (provider === 'supabase') {
    const bucket = (settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC').trim();
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(cleanFn, ttlSeconds);
      if (!error && data?.signedUrl) {
        setCachedSignedPanoramaUrl(cleanFn, data.signedUrl, ttlSeconds);
        return data.signedUrl;
      }
    } catch {
      // Best-effort fallback
    }
  }

  return cleanFn;
}

/**
 * Pre-signs multiple panorama filenames concurrently (e.g. when loading a survey subgrid into WebGIS).
 */
export async function batchPreloadSignedPanoramaUrls(
  filenames: string[],
  settings?: StorageResolveSettings,
  ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toFetch: string[] = [];

  for (const fn of filenames) {
    if (!fn) continue;
    const cleanFn = fn.trim().split('?')[0].replace(/^\/+/, '');
    const cached = getCachedSignedPanoramaUrl(cleanFn);
    if (cached) {
      result.set(cleanFn, cached);
    } else {
      toFetch.push(cleanFn);
    }
  }

  if (toFetch.length === 0) return result;

  const provider = (settings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2').toLowerCase();

  if (provider === 'supabase') {
    const bucket = (settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC').trim();
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(toFetch, ttlSeconds);
      if (!error && Array.isArray(data)) {
        for (const item of data) {
          if (item?.path && item?.signedUrl) {
            setCachedSignedPanoramaUrl(item.path, item.signedUrl, ttlSeconds);
            result.set(item.path, item.signedUrl);
          }
        }
      }
    } catch {
      // Best-effort fallback
    }
  }

  return result;
}
