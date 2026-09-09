/**
 * Provider-agnostic 360° frame inventory & counting.
 *
 * Phase-2 of the monolith split (see implementation_plan_v19.md). These helpers
 * reproduce — for EVERY object-storage provider — the exact frame-availability
 * contract the Supabase default logic establishes in
 * src/services/supabase.ts `resolveStorageFiles()`:
 *   - a `fileSet` of known filenames (lowercase full token + basename),
 *   - `countsBySubgrid` (per-subgrid frame counts),
 *   - `totalFiles` (distinct frames total).
 *
 * For providers the browser cannot enumerate anonymously (Cloudflare R2, private
 * S3, GCS/Azure/Wasabi private buckets, NAS, custom CDN) the source of truth is a
 * public `manifest.json` written by the upload pipeline next to the images. The
 * manifest is fetched over the SAME public URL the app already builds for panorama
 * resolution (`resolvePanoramaUrl`), so no secrets / S3 ListObjects calls exist.
 *
 * Multi-res tile pyramids are folded to DISTINCT STATION FOLDERS (1 station = 1
 * frame) so tile faces/levels are never miscounted as frames. Functions are pure
 * and side-effect free (they only read arguments and `import.meta.env`).
 */
import { extractSubgridName } from '../utils/subgrid';
import { MANIFEST_PATH_DEFAULT, REGION_DEFAULTS, S3_BUCKET_DEFAULT } from '../config/defaults';
import { formatCloudflareUrl } from './storageUrls';

/** Settings fields consumed by the manifest inventory helpers. */
export interface StorageSettingsForManifest {
  storageProvider?: string;
  imageStorageStrategy?: string;
  panoramaMode?: string;
  r2Domain?: string;
  r2PublicUrl?: string;
  r2PublicDomain?: string;
  customCdnUrl?: string;
  customStorageUrl?: string;
  cloudStorageBaseUrl?: string;
  supabaseUrl?: string;
  supabaseBucket?: string;
  s3Bucket?: string;
  s3Region?: string;
  gcsBucket?: string;
  azureAccount?: string;
  azureContainer?: string;
  wasabiBucket?: string;
  wasabiRegion?: string;
  nasServerUrl?: string;
  manifestEnabled?: boolean;
  manifestPath?: string;
  [key: string]: any;
}

export interface FrameManifestEntry {
  subgrid?: string;
  pointFolder?: string;
  filename?: string;
  path?: string;
  [key: string]: any;
}

export interface FrameManifest {
  version?: number | string;
  layout?: string;
  frames?: FrameManifestEntry[];
  [key: string]: any;
}

export interface FrameCountResult {
  fileSet: Set<string>;
  countsBySubgrid: Map<string, number>;
  totalFiles: number;
}

/** Resolve the active storage provider, defaulting exactly like resolvePanoramaUrl. */
export function resolveStorageProvider(settings?: StorageSettingsForManifest): string {
  return String(
    settings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2'
  ).toLowerCase().trim();
}

/** Provider-aware object base URL, mirroring resolvePanoramaUrl's per-provider bases. */
export function resolveProviderBaseUrl(settings?: StorageSettingsForManifest): string {
  const provider = resolveStorageProvider(settings);
  let raw = '';

  switch (provider) {
    case 'cloudflare_r2':
    case 'r2':
    case 'custom_cdn': {
      raw =
        settings?.r2Domain ||
        settings?.r2PublicUrl ||
        settings?.r2PublicDomain ||
        settings?.customCdnUrl ||
        settings?.customStorageUrl ||
        settings?.cloudStorageBaseUrl ||
        import.meta.env.VITE_R2_DOMAIN ||
        import.meta.env.VITE_IMAGE_CDN_URL ||
        '';
      break;
    }
    case 'aws_s3': {
      const bucket = settings?.s3Bucket || import.meta.env.VITE_S3_BUCKET || S3_BUCKET_DEFAULT;
      const region = settings?.s3Region || import.meta.env.VITE_S3_REGION || REGION_DEFAULTS.s3Region;
      raw = `https://${bucket}.s3.${region}.amazonaws.com`;
      break;
    }
    case 'gcs': {
      const bucket = settings?.gcsBucket || import.meta.env.VITE_GCS_BUCKET || '';
      raw = bucket ? `https://storage.googleapis.com/${bucket}` : '';
      break;
    }
    case 'azure_blob': {
      const account = settings?.azureAccount || import.meta.env.VITE_AZURE_ACCOUNT || '';
      const container = settings?.azureContainer || import.meta.env.VITE_AZURE_CONTAINER || '';
      raw = account && container ? `https://${account}.blob.core.windows.net/${container}` : '';
      break;
    }
    case 'wasabi': {
      const bucket = settings?.wasabiBucket || import.meta.env.VITE_WASABI_BUCKET || '';
      const region = settings?.wasabiRegion || import.meta.env.VITE_WASABI_REGION || REGION_DEFAULTS.wasabiRegion;
      raw = bucket ? `https://s3.${region}.wasabisys.com/${bucket}` : '';
      break;
    }
    case 'nas_local': {
      raw = settings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL || '';
      break;
    }
    case 'supabase':
    default:
      // Supabase frame counting never uses a manifest (file_inventory / storage.list).
      raw = '';
      break;
  }

  return formatCloudflareUrl(raw);
}

/** Default manifest URL for the active provider (empty when impossible). */
export function buildManifestUrl(settings?: StorageSettingsForManifest): string {
  const base = resolveProviderBaseUrl(settings);
  if (!base) return '';
  const path = String(settings?.manifestPath || MANIFEST_PATH_DEFAULT).replace(/^\/+/, '');
  return `${base}/${path}`;
}

/**
 * Fetch + validate the public frame manifest. Never throws — returns `null` on
 * 404, invalid JSON, network failure, or timeout.
 */
export async function fetchFrameManifest(url: string, timeoutMs = 5000): Promise<FrameManifest | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object' || !Array.isArray(json.frames)) return null;
    return json as FrameManifest;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Count frames from a manifest with the same semantics as the Supabase default
 * counter:
 *   - fileSet: lowercase full token + basename for every counted frame,
 *   - countsBySubgrid / totalFiles: DISTINCT STATIONS for multi-res tile layouts
 *     (so tile faces/levels never inflate counts), frame files otherwise.
 */
export function countFramesFromManifest(
  manifest: FrameManifest | null | undefined,
  settings?: StorageSettingsForManifest
): FrameCountResult {
  const result: FrameCountResult = {
    fileSet: new Set<string>(),
    countsBySubgrid: new Map<string, number>(),
    totalFiles: 0
  };

  const frames = Array.isArray(manifest?.frames) ? manifest.frames : [];
  if (frames.length === 0) return result;

  const layout = String(manifest?.layout || '').toLowerCase();
  const strategy = String(settings?.imageStorageStrategy || '').toLowerCase().trim();
  const isMultiRes =
    layout === 'multires_tiles' ? true
      : layout === 'single_equirectangular' ? false
        : strategy !== 'single_equirectangular';

  const seenStations = new Set<string>();
  const sgStations = new Map<string, Set<string>>();

  for (const frame of frames) {
    const filename = String(
      frame.filename || (frame.pointFolder ? `${frame.pointFolder}.jpg` : '')
    ).trim();
    if (!filename || !filename.includes('.') || filename.startsWith('.')) continue;

    const basename = filename.split('/').pop() || filename;
    const pointFolder = (
      frame.pointFolder || basename.replace(/\.[^./]+$/, '') || filename
    ).trim();
    const rawSg = String(
      frame.subgrid || extractSubgridName(filename) || 'N/A'
    ).toUpperCase().trim();
    const sg = rawSg !== 'N/A' ? rawSg : 'UNKNOWN';

    const fullClean = filename.toLowerCase();
    const baseClean = basename.toLowerCase();

    // Multi-res: collapse to distinct stations first, then count only once per station.
    if (isMultiRes) {
      const stationKey = `${sg}:${pointFolder}`.toLowerCase();
      if (seenStations.has(stationKey)) continue;
      seenStations.add(stationKey);
    }

    if (!result.fileSet.has(fullClean)) result.totalFiles++;
    result.fileSet.add(fullClean);
    if (baseClean) result.fileSet.add(baseClean);

    let stationSet = sgStations.get(sg);
    if (!stationSet) {
      stationSet = new Set<string>();
      sgStations.set(sg, stationSet);
    }
    stationSet.add(isMultiRes ? pointFolder.toLowerCase() : fullClean);
  }

  for (const [sg, stationSet] of sgStations) {
    result.countsBySubgrid.set(sg, stationSet.size);
  }

  return result;
}

export default {
  resolveStorageProvider,
  resolveProviderBaseUrl,
  buildManifestUrl,
  fetchFrameManifest,
  countFramesFromManifest
};