import { supabase } from './client';
import { STORAGE_BUCKET_DEFAULT, MANIFEST_PATH_DEFAULT } from '../../config/defaults';
import type { ExtendedProjectSettings } from '../../types/admin';
import {
  formatCloudflareUrl,
  resolvePanoramaUrl,
  resolvePanoramaConfigUrl,
  StorageProviderType,
  ResolveUrlOptions
} from '../storageUrls';
import {
  buildManifestUrl,
  countFramesFromManifest,
  fetchFrameManifest,
  resolveProviderBaseUrl,
  resolveStorageProvider,
  type StorageSettingsForManifest
} from '../storageInventory';
import { fetchProjectSettingsFromSupabase } from './admin';

export {
  formatCloudflareUrl,
  resolvePanoramaUrl,
  resolvePanoramaConfigUrl
};
export type { StorageProviderType, ResolveUrlOptions };

export interface FileInventoryResult {
  /** `true` when the server-side `file_inventory` table was queried successfully (bucket enumeration avoided). */
  fromInventory: boolean;
  /** `true` when the frame count came from a public provider manifest (non-Supabase storage). */
  fromManifest?: boolean;
  fileSet: Set<string>;
  countsBySubgrid: Map<string, number>;
  /** Total number of distinct uploaded image files (multi-res: distinct station folders) found. */
  totalFiles: number;
}

export const FILE_INVENTORY_TABLE = 'file_inventory';

function extractSubgrid(filename: string): string {
  if (!filename) return '';
  const clean = filename.split('/').pop() || filename;
  const match = clean.match(/(N\d+E\d+)/i);
  if (match) return match[1].toUpperCase();
  const base = clean.replace(/\.[^/.]+$/, '').trim();
  return base || '';
}

/**
 * Resolve uploaded 360 image filenames for a storage bucket/path.
 * Prefers the server-side `file_inventory` table (no client-side bucket enumeration),
 * and falls back to direct storage `.list()` only if that table is unavailable.
 *
 * For non-Supabase providers (Cloudflare R2, S3, GCS, Azure, NAS, custom CDN), the
 * frame count is resolved from the public `manifest.json` first, then degrades to
 * the legacy Supabase path (file_inventory -> storage.list()) so counts never break.
 */
let storageInventoryCache: { result: FileInventoryResult; timestamp: number; key: string } | null = null;

export function getStorageInventoryCacheTotalFiles(): number {
  return storageInventoryCache?.result?.totalFiles || 0;
}

export async function resolveStorageFiles(
  candidates: Array<{ bucket: string; path: string }>,
  storageSettings?: StorageSettingsForManifest
): Promise<FileInventoryResult> {
  const provider = resolveStorageProvider(storageSettings);
  const manifestEnabled = storageSettings?.manifestEnabled !== false;
  // 0) Deduplicate candidate locations case-insensitively
  const seenLoc = new Set<string>();
  const deduplicatedCandidates = candidates.filter(c => {
    const k = `${(c.bucket || '').trim().toLowerCase()}::${(c.path || '').trim().toLowerCase()}`;
    if (!k || seenLoc.has(k)) return false;
    seenLoc.add(k);
    return true;
  });

  const cacheKeyBase = deduplicatedCandidates.map(c => `${c.bucket}:${c.path}`).sort().join('|');
  // Non-Supabase providers cache per provider/domain/strategy so switching buckets or
  // manifest paths invalidates correctly without perturbing the Supabase default path.
  const providerExt = provider !== 'supabase'
    ? `|provider=${provider}|base=${resolveProviderBaseUrl(storageSettings)}|manifest=${String(storageSettings?.manifestPath || MANIFEST_PATH_DEFAULT)}|strategy=${String(storageSettings?.imageStorageStrategy || '')}`
    : '';
  const cacheKey = `${cacheKeyBase}${providerExt}`;
  const now = Date.now();
  if (storageInventoryCache && storageInventoryCache.key === cacheKey && (now - storageInventoryCache.timestamp) < 45000) {
    return {
      fromInventory: storageInventoryCache.result.fromInventory,
      fromManifest: storageInventoryCache.result.fromManifest,
      fileSet: new Set(storageInventoryCache.result.fileSet),
      countsBySubgrid: new Map(storageInventoryCache.result.countsBySubgrid),
      totalFiles: storageInventoryCache.result.totalFiles
    };
  }

  const result: FileInventoryResult = {
    fromInventory: false,
    fileSet: new Set<string>(),
    countsBySubgrid: new Map<string, number>(),
    totalFiles: 0
  };

  // 1a) Non-Supabase provider: resolve frames from the public manifest first.
  // On ANY failure fall through to the legacy path so counts never break.
  if (provider !== 'supabase' && manifestEnabled) {
    try {
      const manifestUrl = buildManifestUrl(storageSettings);
      if (manifestUrl) {
        const manifest = await fetchFrameManifest(manifestUrl);
        if (manifest && Array.isArray(manifest.frames) && manifest.frames.length > 0) {
          const counted = countFramesFromManifest(manifest, storageSettings);
          result.fileSet = counted.fileSet;
          result.countsBySubgrid = counted.countsBySubgrid;
          result.totalFiles = counted.totalFiles;
          result.fromManifest = true;
          storageInventoryCache = { result, timestamp: Date.now(), key: cacheKey };
          return result;
        }
      }
    } catch (_) { /* manifest unavailable -> legacy fallback */ }
  }

  const addFile = (name: string) => {
    if (name && name.includes('.') && !name.startsWith('.')) {
      const fullClean = name.toLowerCase().trim();
      const baseName = name.split('/').pop()?.toLowerCase().trim();
      if (!result.fileSet.has(fullClean)) {
        result.totalFiles++;
      }
      result.fileSet.add(fullClean);
      if (baseName) result.fileSet.add(baseName);
      const sg = extractSubgrid(name);
      if (sg && sg !== 'N/A') {
        const normSg = sg.toUpperCase().trim();
        result.countsBySubgrid.set(normSg, (result.countsBySubgrid.get(normSg) || 0) + 1);
      }
    }
  };

  // 1) Try server-side file_inventory table first (avoids client bucket enumeration)
  try {
    const uniqueBuckets = Array.from(new Set(deduplicatedCandidates.map(c => c.bucket)));
    let inventoryRows: any[] = [];
    for (const bucket of uniqueBuckets) {
      const { data, error } = await supabase
        .from(FILE_INVENTORY_TABLE)
        .select('filename, subgrid')
        .eq('bucket', bucket)
        .limit(10000);
      if (!error && Array.isArray(data)) {
        inventoryRows = inventoryRows.concat(data);
      }
    }
    if (inventoryRows.length > 0) {
      inventoryRows.forEach((row: any) => {
        const name = row?.filename || row?.name || row?.file_name || '';
        if (name) addFile(name);
      });
      result.fromInventory = true;
      storageInventoryCache = { result, timestamp: Date.now(), key: cacheKey };
      return result;
    }
  } catch (_) { /* table or query unavailable -> fall back to storage listing */ }

  // 2) Fallback: enumerate files directly from the storage bucket(s)
  for (const loc of deduplicatedCandidates) {
    try {
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      let totalFetched = 0;
      while (hasMore && totalFetched < 10000) {
        const { data, error } = await supabase.storage.from(loc.bucket).list(loc.path, { limit, offset });
        if (error || !data || data.length === 0) break;
        totalFetched += data.length;
        data.forEach(item => addFile(item.name));
        if (data.length < limit) hasMore = false;
        else offset += limit;
      }
      // If we found files in the primary/candidate location, stop probing fallback buckets
      if (result.totalFiles > 0) break;
    } catch (_) { /* skip inaccessible bucket */ }
  }

  storageInventoryCache = { result, timestamp: Date.now(), key: cacheKey };
  return result;
}

/**
 * Ensure the storage settings used for manifest resolution reflect the
 * authoritative DB settings (project_settings id='default') even when the
 * caller passes none or the boot-time defaults — which default to
 * storageProvider 'supabase' with no provider domain (useAppData hydrates the
 * real settings in PARALLEL with the first fetchSupabaseData). Without this,
 * boot + no-arg call sites silently skip the manifest branch and frame counts
 * collapse to 0 (implementation_plan_v19.md). Supabase providers are left
 * untouched so the default counting logic never changes.
 */
export async function ensureManifestSettings(settings?: ExtendedProjectSettings): Promise<StorageSettingsForManifest> {
  const candidate = settings || {};
  // When the effective provider can't build a manifest base URL yet — which
  // happens at boot (defaults default to provider 'supabase' with no domain)
  // and right after a database-host switch — the authoritative project_settings
  // on the ACTIVE backend may carry the real provider/domain. Merge them in so
  // the manifest branch is reached. A genuinely Supabase-backed host keeps the
  // legacy counting path unchanged (the manifest branch is skipped for provider
  // 'supabase'), so switching local <-> cloud can never alter Supabase logic.
  if (!!resolveProviderBaseUrl(candidate)) return candidate;
  try {
    const dbSettings = await fetchProjectSettingsFromSupabase();
    if (dbSettings) return { ...candidate, ...dbSettings };
  } catch (_) { /* fall back to the passed settings */ }
  return candidate;
}

export async function verifyCsvImageFilenamesInStorage(filenames: string[], settings?: any): Promise<{ availableCount: number; verifiedFilenames: string[] }> {
  if (!filenames || filenames.length === 0) return { availableCount: 0, verifiedFilenames: [] };

  const primaryBucket = settings?.supabaseBucket || (settings as any)?.storageBucket || import.meta.env.VITE_SUPABASE_BUCKET || import.meta.env.VITE_STORAGE_BUCKET || STORAGE_BUCKET_DEFAULT;
  const candidateLocations: Array<{ bucket: string; path: string }> = [
    { bucket: primaryBucket, path: '' },
    { bucket: primaryBucket, path: 'MMS_PIC' },
    { bucket: 'MMS_PIC', path: '' },
    { bucket: 'panoramas', path: '' },
    { bucket: 'panoramas', path: 'MMS_PIC' }
  ];

  const uniqueLocations = candidateLocations.filter((loc, idx, self) =>
    idx === self.findIndex(t => t.bucket === loc.bucket && t.path === loc.path)
  );

  const storageResolved = await resolveStorageFiles(uniqueLocations);
  const fileSet = storageResolved.fileSet;

  if (fileSet.size > 0) {
    const verifiedFilenames: string[] = [];
    let availableCount = 0;
    filenames.forEach(fn => {
      const cleanFn = fn.split('/').pop()?.toLowerCase().trim() || fn.toLowerCase().trim();
      if (fileSet.has(cleanFn) || fileSet.has(fn.toLowerCase().trim())) {
        availableCount++;
        verifiedFilenames.push(fn);
      }
    });
    return { availableCount, verifiedFilenames };
  }

  return { availableCount: 0, verifiedFilenames: [] };
}

/**
 * Health probe for Cloudflare R2 and Custom CDN storage endpoints.
 *
 * A real sample filename is required. Probing an invented name such as
 * "<SUBGRID>-0001.jpg" returns 404 for a perfectly healthy bucket, which the
 * UI would then report as a failed connection. `reachable` separates "the
 * endpoint answered" from "that object exists", so a 404 reports as reachable
 * with the object missing instead of a false storage failure.
 */
export async function testCloudflareStorageHealth(
  domainOrUrl: string,
  sampleFilename?: string,
  settings?: any
): Promise<{
  ok: boolean;
  reachable: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  imageUrl: string;
  configUrl?: string;
  corsOk: boolean;
  contentType?: string;
  error?: string;
}> {
  let cleanDomain = (domainOrUrl || '').trim().replace(/\/+$/, '');
  if (cleanDomain && !cleanDomain.startsWith('http://') && !cleanDomain.startsWith('https://')) {
    cleanDomain = `https://${cleanDomain}`;
  }

  if (!cleanDomain) {
    return {
      ok: false,
      reachable: false,
      status: 0,
      statusText: 'No Domain Provided',
      latencyMs: 0,
      imageUrl: '',
      corsOk: false,
      error: 'Please enter a valid Cloudflare R2 domain or URL.'
    };
  }

  const fn = (sampleFilename || '').trim();
  if (!fn) {
    return {
      ok: false,
      reachable: false,
      status: 0,
      statusText: 'No Sample Filename',
      latencyMs: 0,
      imageUrl: '',
      corsOk: false,
      error: 'A real frame filename is required to probe storage. Nothing is probed, because a made-up name would return 404 for a healthy bucket.'
    };
  }
  const testSettings = {
    ...settings,
    storageProvider: 'cloudflare_r2',
    r2Domain: cleanDomain,
    r2PublicDomain: cleanDomain
  };

  const isMulti = testSettings.imageStorageStrategy !== 'single_equirectangular';
  const configUrl = isMulti ? resolvePanoramaConfigUrl(fn, testSettings) : undefined;
  const imageUrl = resolvePanoramaUrl(fn, testSettings);

  const targetUrl = configUrl || imageUrl;
  const startTime = performance.now();

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache'
    });

    const latencyMs = Math.round(performance.now() - startTime);
    const contentType = response.headers.get('content-type') || '';
    // Any HTTP answer means the endpoint is reachable and CORS-permitting,
    // including 404 for a frame that is genuinely not published.
    const notFound = response.status === 404;

    return {
      ok: response.ok,
      reachable: true,
      status: response.status,
      statusText: notFound
        ? `Reachable (${response.status} - "${fn}" not published)`
        : (response.statusText || (response.ok ? 'OK' : 'Error')),
      latencyMs,
      imageUrl,
      configUrl,
      corsOk: true,
      contentType,
      error: notFound
        ? `Storage answered, but no object named "${fn}" exists. Verify the filename or the publish step.`
        : undefined
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    const isCors = err?.message?.toLowerCase().includes('failed to fetch') || err?.name === 'TypeError';
    return {
      ok: false,
      reachable: false,
      status: 0,
      statusText: isCors ? 'CORS / Network Blocked' : 'Connection Failed',
      latencyMs,
      imageUrl,
      configUrl,
      corsOk: false,
      error: isCors
        ? 'Cross-Origin (CORS) check failed. Please ensure CORS headers (Access-Control-Allow-Origin: *) are configured in your Cloudflare R2 bucket.'
        : (err?.message || 'Network request failed')
    };
  }
}

let storageCountsCache: { data: Record<string, number>; timestamp: number } | null = null;

/**
 * Count actual uploaded images in storage bucket grouped by subgrid.
 * Caches results for 10 seconds to prevent unnecessary duplicate network calls.
 */
export async function getStorageImageCountsFromSupabase(forceRefresh: boolean = false, settings?: any): Promise<Record<string, number>> {
  const now = Date.now();
  if (!forceRefresh && storageCountsCache && (now - storageCountsCache.timestamp < 10000)) {
    return storageCountsCache.data;
  }

  const bucketName = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || STORAGE_BUCKET_DEFAULT;
  const storageCounts: Record<string, number> = {};

  try {
    const storageResolved = await resolveStorageFiles([
      { bucket: bucketName, path: '' },
      { bucket: bucketName.toLowerCase(), path: '' },
      { bucket: bucketName.toUpperCase(), path: '' },
      { bucket: 'MMS_PIC', path: '' },
      { bucket: 'panoramas', path: '' }
    ]);
    storageResolved.countsBySubgrid.forEach((count, sg) => {
      storageCounts[sg] = count;
    });
  } catch (err) {
    console.warn('Storage file inventory exception:', err);
  }

  storageCountsCache = { data: storageCounts, timestamp: now };
  return storageCounts;
}
