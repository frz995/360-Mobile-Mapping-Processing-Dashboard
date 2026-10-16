import { supabase } from './client';
import { STORAGE_BUCKET_DEFAULT, MANIFEST_PATH_DEFAULT } from '../../config/defaults';
import type { ExtendedProjectSettings } from '../../types/admin';
import {
  formatCloudflareUrl,
  resolvePanoramaUrl,
  resolvePanoramaConfigUrl,
  applyTenantObjectPrefix,
  StorageProviderType,
  ResolveUrlOptions,
  type StorageResolveSettings
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
import { getActiveOrganizationId } from '../tenantContext';

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
  /**
   * `false` when storage could not be reached at all (network/permission/
   * misconfigured worker proxy), as opposed to a reachable-but-empty bucket.
   * This distinction matters: an unreachable store must NOT be reported as
   * "zero uploaded frames", it means the count is simply unverified.
   */
  listingOk?: boolean;
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
  // The active company, when the settings carry one. Absent on the bootstrap
  // organization and on every pre-tenant caller, which is what keeps the
  // legacy flat object layout working unchanged.
  const tenantOrganizationId =
    (storageSettings as { tenantOrganizationId?: string } | undefined)?.tenantOrganizationId ||
    getActiveOrganizationId() ||
    '';
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
  // The tenant is part of the cache key. Without it, switching company inside
  // the 45s window would serve the previous company's file set — a cross-tenant
  // read produced entirely by the cache.
  const tenantKey = tenantOrganizationId ? `|org=${tenantOrganizationId}` : '|org=';
  const cacheKey = `${cacheKeyBase}${providerExt}${tenantKey}`;
  const now = Date.now();
  if (storageInventoryCache && storageInventoryCache.key === cacheKey && (now - storageInventoryCache.timestamp) < 45000) {
    return {
      fromInventory: storageInventoryCache.result.fromInventory,
      fromManifest: storageInventoryCache.result.fromManifest,
      listingOk: storageInventoryCache.result.listingOk,
      fileSet: new Set(storageInventoryCache.result.fileSet),
      countsBySubgrid: new Map(storageInventoryCache.result.countsBySubgrid),
      totalFiles: storageInventoryCache.result.totalFiles
    };
  }

  const result: FileInventoryResult = {
    fromInventory: false,
    fileSet: new Set<string>(),
    countsBySubgrid: new Map<string, number>(),
    totalFiles: 0,
    listingOk: false
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
          result.listingOk = true;
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
      // Migration 0040 already scopes `file_inventory` by organization_id
      // through RLS, so this read only ever returns the caller's own rows.
      // The explicit `.eq` below is defence in depth, not the boundary: it keeps
      // the intent legible and survives an RLS regression by narrowing rather
      // than by failing, which is the right bias for a count.
      let query = supabase
        .from(FILE_INVENTORY_TABLE)
        .select('filename, subgrid')
        .eq('bucket', bucket)
        .limit(10000);
      if (tenantOrganizationId) {
        query = query.eq('organization_id', tenantOrganizationId);
      }
      let { data, error } = await query;
      if (error && tenantOrganizationId) {
        // Fallback for pre-tenancy database schemas where organization_id column does not exist
        const fallbackRes = await supabase
          .from(FILE_INVENTORY_TABLE)
          .select('filename, subgrid')
          .eq('bucket', bucket)
          .limit(10000);
        if (!fallbackRes.error && Array.isArray(fallbackRes.data)) {
          data = fallbackRes.data;
          error = null;
        }
      } else if (!error && (!data || data.length === 0) && tenantOrganizationId) {
        // If tenant-specific rows are not found, check for legacy unassigned rows (organization_id is null)
        const unassignedRes = await supabase
          .from(FILE_INVENTORY_TABLE)
          .select('filename, subgrid')
          .eq('bucket', bucket)
          .is('organization_id', null)
          .limit(10000);
        if (!unassignedRes.error && Array.isArray(unassignedRes.data) && unassignedRes.data.length > 0) {
          data = unassignedRes.data;
        }
      }
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
      result.listingOk = true;
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
      // List inside the tenant namespace. `storage.objects` RLS compares the
      // key's own `orgs/{id}/` segment against the caller's verified
      // membership, so this narrows what can be enumerated even where the
      // policy is missing — and a forged id here can only produce an empty
      // listing, never another company's objects.
      const listPath = applyTenantObjectPrefix(loc.path, tenantOrganizationId);
      while (hasMore && totalFetched < 10000) {
        const { data, error } = await supabase.storage.from(loc.bucket).list(listPath, { limit, offset });
        if (error) break;
        // A successful listing — even an empty one — proves storage is reachable.
        // That is materially different from storage being unreachable, and only
        // the latter means frame counts are unverified.
        result.listingOk = true;
        if (!data || data.length === 0) break;
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

/**
 * Verify a run's recorded filenames against the storage inventory.
 *
 * `verified` is the whole point of this returning a third field: an empty
 * `verifiedFilenames` is ambiguous on its own. It means either "the bucket was
 * read and holds none of these" or "the bucket was never reached". Collapsing
 * the second into the first is how a storage outage gets reported as a complete
 * zero, which is the failure migration 0032 documented. Callers need
 * `resolveStorageFiles().listingOk` and were throwing it away.
 */
export async function verifyCsvImageFilenamesInStorage(
  filenames: string[],
  settings?: any
): Promise<{ availableCount: number; verifiedFilenames: string[]; verified: boolean; fileSet: Set<string> }> {
  if (!filenames || filenames.length === 0) {
    // Nothing to check is not the same as "checked and found none". With no
    // filenames there is nothing to verify, so report unverified rather than
    // claiming a clean result.
    return { availableCount: 0, verifiedFilenames: [], verified: false, fileSet: new Set<string>() };
  }

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
  const verified = storageResolved.listingOk === true;

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
    return { availableCount, verifiedFilenames, verified, fileSet };
  }

  return { availableCount: 0, verifiedFilenames: [], verified, fileSet };
}

/**
 * The bucket files that belong to one subgrid, as bare file names.
 *
 * This is what turns the "Unlinked images" row from permanently unknown into a
 * real figure: an orphan is a file in the subgrid's folder that no POI claims,
 * and you cannot see one without knowing which files the folder holds.
 *
 * `addFile` puts BOTH the path-prefixed key and the bare basename into
 * `fileSet`, so the same physical file is present twice. Only the basename is
 * returned, which collapses that pair — otherwise one orphan would be counted
 * and listed twice.
 *
 * Returns `null` — NOT `[]` — when the inventory cannot be attributed to
 * subgrids. A public provider manifest (R2, S3, CDN) yields a flat frame list
 * with no folder structure, so `[]` there would be a fabricated "this subgrid
 * has no orphans".
 */
export function listSubgridFilenamesFromInventory(
  resolved: FileInventoryResult | null | undefined,
  subgrid: string
): string[] | null {
  if (!resolved || !resolved.listingOk) return null;
  if (resolved.fromManifest) return null;
  const target = (subgrid ?? '').trim().toUpperCase();
  if (!target || target === 'N/A') return null;

  const out = new Set<string>();
  for (const token of resolved.fileSet) {
    // Match on the subgrid code embedded in the name. `extractSubgrid` reads the
    // basename first, so a path-prefixed bucket key and a bare basename resolve
    // to the same code.
    if (extractSubgrid(token) === target) out.add(token.split('/').pop() ?? token);
  }
  return Array.from(out);
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
      error: 'A verified frame filename is required to probe storage. Nothing is probed, because a made-up name would return 404 for a healthy bucket.'
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

/**
 * Result of probing ONE real object URL.
 *
 * `objectFound` is deliberately `boolean | null`. The previous diagnostics
 * panel reported a synthesised `HTTP 200` and a `CORS OK` badge for Supabase
 * and NAS providers without issuing a single request, so an operator was told
 * storage was healthy while every panorama 400'd. `null` is the only honest
 * value for "the probe never got far enough to know".
 */
export interface StorageObjectProbe {
  /** The probed object was served (2xx). */
  ok: boolean;
  /** The endpoint answered at all. Distinct from the object existing. */
  reachable: boolean;
  /** Whether the probed key exists. null when that was never established. */
  objectFound: boolean | null;
  status: number;
  statusText: string;
  /** Round-trip for the object request. Never a database or bucket-list time. */
  latencyMs: number;
  imageUrl: string;
  configUrl?: string;
  /** True only when a CORS-mode response actually arrived. */
  corsOk: boolean;
  contentType?: string;
  error?: string;
}

/**
 * Supabase Storage's public object endpoint answers a missing key with
 * **HTTP 400** and an `InvalidRequest / Object not found` body, not 404. A probe
 * that only recognises 404 renders every missing panorama as a connection
 * failure, which is the opposite of the operator's next action.
 */
function isMissingObjectResponse(status: number, contentType: string, body: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  // A 400 carrying an image body is a genuine bad request, not a lookup miss.
  if (contentType.toLowerCase().startsWith('image/')) return false;
  return /object not found|not_found|invalidrequest|no such file|does not exist/i.test(body);
}

/**
 * Fetch the exact URL the 360 viewer will fetch.
 *
 * WHY THIS IS SEPARATE FROM `testCloudflareStorageHealth`
 *   That function pins `storageProvider: 'cloudflare_r2'` and overrides the
 *   domain, because its caller is probing an R2/Custom-CDN endpoint. Probing
 *   Supabase or NAS through it would measure a URL the app never uses. This one
 *   resolves with the caller's REAL settings and no provider override, so the
 *   panel and the viewer cannot drift apart again.
 */
export async function testStorageObjectHealth(
  sampleFilename: string | undefined,
  settings?: StorageResolveSettings
): Promise<StorageObjectProbe> {
  const fn = (sampleFilename || '').trim();
  if (!fn) {
    return {
      ok: false,
      reachable: false,
      objectFound: null,
      status: 0,
      statusText: 'Not Probed',
      latencyMs: 0,
      imageUrl: '',
      corsOk: false,
      error: 'No filename supplied, so nothing was probed. A made-up name would report a healthy bucket as broken.'
    };
  }

  const imageUrl = resolvePanoramaUrl(fn, settings);
  if (!imageUrl) {
    return {
      ok: false,
      reachable: false,
      objectFound: null,
      status: 0,
      statusText: 'Not Probed',
      latencyMs: 0,
      imageUrl: '',
      corsOk: false,
      error: `"${fn}" did not resolve to a URL. The storage provider or base URL is not configured.`
    };
  }

  // A multi-res deployment is viewed through a tile config, and a single
  // equirectangular panorama is the image itself. Probing the wrong artifact
  // reports a healthy deployment as broken, so the strategy decides which.
  const isMulti = settings?.imageStorageStrategy !== 'single_equirectangular';
  const configUrl = isMulti ? resolvePanoramaConfigUrl(fn, settings) || '' : '';
  const targetUrl = configUrl || imageUrl;
  const startTime = performance.now();

  try {
    const response = await fetch(targetUrl, { method: 'GET', mode: 'cors', cache: 'no-cache' });
    const latencyMs = Math.round(performance.now() - startTime);
    const contentType = response.headers.get('content-type') || '';

    // Only error responses are read, and those bodies are small JSON. An image
    // body is deliberately never consumed: a panorama is tens of megabytes.
    let body = '';
    if (!response.ok && !contentType.toLowerCase().startsWith('image/')) {
      body = await response.text().catch(() => '');
    }

    if (response.ok) {
      return {
        ok: true,
        reachable: true,
        objectFound: true,
        status: response.status,
        statusText: response.statusText || 'OK',
        latencyMs,
        imageUrl,
        configUrl: configUrl || undefined,
        corsOk: true,
        contentType
      };
    }

    // Reaching a response at all proves CORS permitted it: `mode: 'cors'`
    // makes the browser block the response outright otherwise.
    const corsOk = true;
    const missing = isMissingObjectResponse(response.status, contentType, body);
    const detail = body.slice(0, 300);

    if (missing) {
      return {
        ok: false,
        reachable: true,
        objectFound: false,
        status: response.status,
        statusText: `Object Not Found (HTTP ${response.status})`,
        latencyMs,
        imageUrl,
        configUrl: configUrl || undefined,
        corsOk,
        contentType: contentType || undefined,
        error: `Storage answered, but no object exists at this key. The filename "${fn}" may be wrong, or the object may sit under a different tenant folder than the URL resolves to.${detail ? ` Server said: ${detail}` : ''}`
      };
    }

    return {
      ok: false,
      reachable: true,
      objectFound: false,
      status: response.status,
      statusText: response.statusText || `HTTP ${response.status}`,
      latencyMs,
      imageUrl,
      configUrl: configUrl || undefined,
      corsOk,
      contentType: contentType || undefined,
      error: `Storage rejected the request (HTTP ${response.status}).${detail ? ` Server said: ${detail}` : ''}`
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const name = (err as { name?: unknown } | null)?.name;
    const message = (err as { message?: unknown } | null)?.message;
    const isBlocked =
      name === 'TypeError' || (typeof message === 'string' && /failed to fetch|failed to load/i.test(message));
    return {
      ok: false,
      reachable: false,
      objectFound: null,
      status: 0,
      statusText: isBlocked ? 'Blocked Before Response' : 'Connection Failed',
      latencyMs,
      imageUrl,
      configUrl: configUrl || undefined,
      corsOk: false,
      error: isBlocked
        ? 'No response arrived. This is a CORS rejection, a network/DNS failure, or a mixed-content block — the request was stopped before a status could be read, so whether the file exists is still unknown.'
        : (typeof message === 'string' && message ? message : 'Network request failed')
    };
  }
}
