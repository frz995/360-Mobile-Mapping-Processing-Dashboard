/**
 * Pure storage-URL formatting & resolution helpers, extracted verbatim from
 * src/services/supabase.ts (Phase 1 of the monolith split — see
 * implementation_plan_v12.md).
 *
 * These functions are stateless and side-effect free: they only read their
 * arguments and `import.meta.env`. They do NOT touch the Supabase client,
 * localStorage, or network.
 *
 * The public surface (function names & return values) is IDENTICAL to the
 * previous barrel exports, so callers can import them from either
 * './services/supabase' (re-export) or './services/storageUrls' directly.
 */
import { extractSubgridName } from '../utils/subgrid';

/** Supported object-storage providers for 360 imagery resolution. */
export type StorageProviderType =
  | 'supabase'
  | 'aws_s3'
  | 'gcs'
  | 'azure_blob'
  | 'cloudflare_r2'
  | 'wasabi'
  | 'nas_local'
  | 'custom_cdn';

export interface ResolveUrlOptions {
  asConfigUrl?: boolean;
  asFallback?: boolean;
  subgrid?: string;
}

/**
 * Settings fields consumed by the URL resolvers. Every field is optional and
 * typed as `string`, so any existing caller object (ProjectSettings, custom
 * test fixtures, overrides) remains structurally assignable — this adds type
 * safety without requiring callers to change anything.
 */
export interface StorageResolveSettings {
  storageProvider?: string;
  imageStorageStrategy?: string;
  r2Domain?: string;
  r2PublicUrl?: string;
  r2PublicDomain?: string;
  customCdnUrl?: string;
  customStorageUrl?: string;
  cloudStorageBaseUrl?: string;
  supabaseUrl?: string;
  supabaseBucket?: string;
  multiResTilePattern?: string;
  tilePathPattern?: string;
  multiResFallbackPattern?: string;
  singleImagePathPattern?: string;
  imageFormatPattern?: string;
  imageStoragePath?: string;
  s3Bucket?: string;
  s3Region?: string;
  gcsBucket?: string;
  azureAccount?: string;
  azureContainer?: string;
  wasabiBucket?: string;
  wasabiRegion?: string;
  nasServerUrl?: string;
}

export function formatCloudflareUrl(domainOrUrl: string): string {
  let d = (domainOrUrl || '').trim();
  if (!d) return '';
  if (!d.startsWith('http://') && !d.startsWith('https://')) {
    d = `https://${d}`;
  }
  return d.replace(/\/+$/, '');
}

export function resolvePanoramaUrl(
  filename?: string,
  settings?: StorageResolveSettings,
  options?: ResolveUrlOptions
): string {
  if (!filename) return '';
  let cleanFn = filename.trim();
  if (cleanFn.startsWith('http://') || cleanFn.startsWith('https://')) {
    const provider = (settings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2').toLowerCase();
    // If a full Supabase storage URL was passed in, but the active provider is NOT Supabase,
    // extract the underlying filename so it can be resolved against Cloudflare R2 / S3 / CDN.
    if (provider !== 'supabase' && cleanFn.includes('/storage/v1/object/public/')) {
      const parts = cleanFn.split('?')[0].split('/');
      cleanFn = parts[parts.length - 1] || cleanFn;
    } else {
      return cleanFn;
    }
  }
  cleanFn = cleanFn.replace(/^\/+/, '');
  cleanFn = cleanFn.replace(/^storage\/v1\/object\/public\/[^/]+\//i, '');
  cleanFn = cleanFn.replace(/^(?:MMS_PIC|mms_pic|panoramas)\//i, '');
  cleanFn = cleanFn.replace(/^\/+/, '').trim();
  if (!cleanFn) return '';

  const provider: StorageProviderType =
    (settings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2') as StorageProviderType;
  const isMultiRes = settings?.imageStorageStrategy !== 'single_equirectangular';
  const nameWithoutExt = cleanFn.replace(/\.[^/.]+$/, '');

  // Extract subgrid dynamically: options.subgrid > extracted prefix > basename
  const targetSubgrid = (
    options?.subgrid ||
    extractSubgridName(cleanFn) ||
    cleanFn.match(/^([A-Za-z0-9_]+)-/)?.[1] ||
    nameWithoutExt
  ).toUpperCase().trim();

  switch (provider) {
    case 'cloudflare_r2':
    case 'custom_cdn': {
      const rawDomain =
        settings?.r2Domain ||
        settings?.r2PublicUrl ||
        settings?.r2PublicDomain ||
        settings?.customCdnUrl ||
        settings?.cloudStorageBaseUrl ||
        import.meta.env.VITE_R2_DOMAIN ||
        import.meta.env.VITE_IMAGE_CDN_URL ||
        '';

      const baseUrl = formatCloudflareUrl(rawDomain);
      if (!baseUrl) {
        const rawSbUrl = (settings?.supabaseUrl || '').trim();
        const defaultSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tqqybumedywzylujjkqa.supabase.co';
        const baseSupabaseUrl = (
          rawSbUrl && !rawSbUrl.includes('frz995-360-processing') && !rawSbUrl.includes('xyzcompany')
            ? rawSbUrl
            : defaultSupabaseUrl
        ).replace(/\/+$/, '');
        const bucket = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC';
        return `${baseSupabaseUrl}/storage/v1/object/public/${bucket}/${cleanFn}`;
      }

      // Multi-res configuration JSON request
      if (options?.asConfigUrl || cleanFn.endsWith('.json')) {
        const pattern = settings?.multiResTilePattern || settings?.tilePathPattern;
        if (pattern) {
          const path = pattern
            .replace('{pointFolder}', nameWithoutExt)
            .replace('{filename}', nameWithoutExt)
            .replace('{subgrid}', targetSubgrid || nameWithoutExt)
            .replace(/^\/+/, '');
          return baseUrl ? `${baseUrl}/${path}` : `/${path}`;
        }

        return targetSubgrid
          ? `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`
          : `${baseUrl}/tiles/${nameWithoutExt}/config.json`;
      }

      // Preview Thumbnail / Fallback Cube Face request (only when explicitly requested)
      if (options?.asFallback && isMultiRes) {
        const fallbackPattern = settings?.multiResFallbackPattern;
        if (fallbackPattern) {
          const path = fallbackPattern
            .replace('{pointFolder}', nameWithoutExt)
            .replace('{filename}', nameWithoutExt)
            .replace('{subgrid}', targetSubgrid || nameWithoutExt)
            .replace(/^\/+/, '');
          return baseUrl ? `${baseUrl}/${path}` : `/${path}`;
        }

        return targetSubgrid
          ? `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/fallback/f.jpg`
          : `${baseUrl}/tiles/${nameWithoutExt}/fallback/f.jpg`;
      }

      // Standard Flat Equirectangular Single Image fallback
      const singlePattern = settings?.singleImagePathPattern;
      if (singlePattern && (singlePattern.includes('{subgrid}') || singlePattern.includes('{filename}') || singlePattern.includes('{pointFolder}'))) {
        const path = singlePattern
          .replace('{pointFolder}', nameWithoutExt)
          .replace('{filename}', cleanFn)
          .replace('{subgrid}', targetSubgrid || nameWithoutExt)
          .replace(/^\/+/, '');
        return baseUrl ? `${baseUrl}/${path}` : `/${path}`;
      }

      const prefix = (settings?.imageStoragePath || '').replace(/^\/+/, '').replace(/\/+$/, '');
      if (prefix && prefix !== 'MMS_PIC') {
        return baseUrl ? `${baseUrl}/${prefix}/${cleanFn}` : `/${prefix}/${cleanFn}`;
      }
      return baseUrl ? `${baseUrl}/${cleanFn}` : `/${cleanFn}`;
    }

    case 'aws_s3': {
      const bucket = settings?.s3Bucket || import.meta.env.VITE_S3_BUCKET || '';
      const region = settings?.s3Region || import.meta.env.VITE_S3_REGION || 'ap-southeast-1';
      const baseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'gcs': {
      const bucket = settings?.gcsBucket || import.meta.env.VITE_GCS_BUCKET || '';
      const baseUrl = `https://storage.googleapis.com/${bucket}`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'azure_blob': {
      const account = settings?.azureAccount || import.meta.env.VITE_AZURE_ACCOUNT || '';
      const container = settings?.azureContainer || import.meta.env.VITE_AZURE_CONTAINER || '';
      const baseUrl = `https://${account}.blob.core.windows.net/${container}`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'wasabi': {
      const bucket = settings?.wasabiBucket || import.meta.env.VITE_WASABI_BUCKET || '';
      const region = settings?.wasabiRegion || import.meta.env.VITE_WASABI_REGION || 'us-east-1';
      const baseUrl = `https://s3.${region}.wasabisys.com/${bucket}`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'nas_local': {
      const nasUrl = (settings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL || '').replace(/\/+$/, '');
      if (options?.asConfigUrl) return `${nasUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${nasUrl}/${cleanFn}`;
    }

    case 'supabase':
    default: {
      const rawSbUrl = (settings?.supabaseUrl || '').trim();
      const defaultSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tqqybumedywzylujjkqa.supabase.co';
      const baseSupabaseUrl = (
        rawSbUrl && !rawSbUrl.includes('frz995-360-processing') && !rawSbUrl.includes('xyzcompany')
          ? rawSbUrl
          : defaultSupabaseUrl
      ).replace(/\/+$/, '');
      const bucket = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC';

      const pattern = settings?.singleImagePathPattern;
      if (pattern && (pattern.includes('{filename}') || pattern.includes('{pointFolder}'))) {
        const path = pattern
          .replace('{subgrid}', targetSubgrid || '')
          .replace('{pointFolder}', nameWithoutExt)
          .replace('{filename}', cleanFn)
          .replace(/^\/+/, '');
        return `${baseSupabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
      }

      // If cleanFn already includes a folder or if files are at root
      return `${baseSupabaseUrl}/storage/v1/object/public/${bucket}/${cleanFn}`;
    }
  }
}

export function resolvePanoramaConfigUrl(
  filename?: string,
  settings?: StorageResolveSettings,
  subgrid?: string
): string {
  if (!filename) return '';

  // 1. Resolve base domain dynamically from user settings
  const provider = (settings?.storageProvider || '').toLowerCase().trim();
  let baseUrl = '';

  if (provider === 'cloudflare_r2' || provider === 'r2') {
    baseUrl = (settings?.r2Domain || settings?.r2PublicDomain || settings?.cloudStorageBaseUrl || '').trim();
  } else if (provider === 'supabase') {
    const rawSbUrl = (settings?.supabaseUrl || '').trim();
    const defaultSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tqqybumedywzylujjkqa.supabase.co';
    const sbUrl = (
      rawSbUrl && !rawSbUrl.includes('frz995-360-processing') && !rawSbUrl.includes('xyzcompany')
        ? rawSbUrl
        : defaultSupabaseUrl
    ).replace(/\/+$/, '');
    const bucket = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC';
    baseUrl = sbUrl ? `${sbUrl}/storage/v1/object/public/${bucket}` : '';
  } else {
    baseUrl = (settings?.customCdnUrl || settings?.customStorageUrl || settings?.cloudStorageBaseUrl || '').trim();
  }

  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!baseUrl) {
    return '';
  }
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  // 2. Extract clean identifiers
  const cleanFilename = filename.split('/').pop()?.trim() || '';
  const pointFolder = cleanFilename.replace(/\.[a-zA-Z0-9]+$/i, ''); // e.g. "N93E70-0001"
  const sg = (subgrid || cleanFilename.split('-')[0] || '').toUpperCase().trim(); // e.g. "N93E70"

  // 3. Dynamic template pattern with pointFolder nested path
  const pattern = settings?.multiResTilePattern || settings?.tilePathPattern || 'tiles/{subgrid}/{pointFolder}/config.json';

  const relativePath = pattern
    .replace('{subgrid}', sg)
    .replace('{pointFolder}', pointFolder)
    .replace('{filename}', cleanFilename)
    .replace(/^\/+/, '');

  return `${baseUrl}/${relativePath}`;
}