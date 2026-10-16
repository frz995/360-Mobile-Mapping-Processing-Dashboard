/**
 * Pure storage-URL formatting & resolution helpers, extracted verbatim from
 * src/services/supabase.ts (Phase 1 of the monolith split — see
 * implementation_plan_v12.md).
 *
 * These functions are stateless and side-effect free: they only read their
 * arguments and `import.meta.env`. They do NOT touch the Supabase client,
 * localStorage, or network. (The NAS proxy branch additionally reads the
 * in-memory, already-fetched NAS image token cached in nasImageToken.ts.)
 *
 * The public surface (function names & return values) is IDENTICAL to the
 * previous barrel exports, so callers can import them from either
 * './services/supabase' (re-export) or './services/storageUrls' directly.
 */
import { extractSubgridName } from '../utils/subgrid';
import { STORAGE_BUCKET_DEFAULT, REGION_DEFAULTS } from '../config/defaults';
import { isNasImageProxyEnabled, nasImageUrl } from './nasImageToken';
import { getCachedSignedPanoramaUrl } from './signedPanoramaUrls';

/** Supported object-storage providers for 360 imagery resolution. */
export type StorageProviderType =
  | 'supabase'
  | 'supabase_self_hosted'
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
  selfHostedStorageUrl?: string;
  selfHostedBucket?: string;
  isPrivateBucket?: boolean;
  useSignedUrls?: boolean;
  signedUrlTtlSeconds?: number;
  multiResTilePattern?: string;
  tilePathPattern?: string;
  multiResFallbackPattern?: string;
  singleImagePathPattern?: string;
  imageFormatPattern?: string;
  imageStoragePath?: string;
  manifestEnabled?: boolean;
  manifestPath?: string;
  s3Bucket?: string;
  s3Region?: string;
  gcsBucket?: string;
  azureAccount?: string;
  azureContainer?: string;
  wasabiBucket?: string;
  wasabiRegion?: string;
  nasServerUrl?: string;
  productionApiUrl?: string;
  /**
   * Owning company, used to namespace Supabase object keys under
   * `orgs/{id}/`. Supplied on the settings object rather than as a per-call
   * option because this function is called from ~40 sites across App.tsx,
   * QAQCWorkbench, mapShares and the production hub; threading an argument
   * through all of them would be a large, risky diff for no benefit, since the
   * settings object is already the second parameter at every one.
   *
   * Absent means the legacy flat key layout, which is what the bootstrap
   * organization still uses. That is deliberate: existing objects are not
   * moved, so nothing becomes unreachable by turning this on.
   */
  tenantOrganizationId?: string;
  /**
   * Human-readable client code assigned to the organization (e.g. 'DevTest', 'TNB-LV').
   * Used as the primary folder namespace in storage buckets: `MMS_PIC/{clientCode}/{filename}`.
   */
  clientCode?: string;
  /** Organization slug (e.g. 'geosphere-devtest'). Fallback if clientCode is not set. */
  organizationSlug?: string;
  companyCode?: string;
  /**
   * Dynamic BYOS (Bring Your Own Storage) configuration for the active tenant.
   * Overrides platform defaults when a company configures external Cloudflare R2,
   * S3, Wasabi or custom CDN hosting in the Seller Console.
   */
  tenantStorage?: {
    provider?: string;
    bucketName?: string;
    cdnUrl?: string;
    region?: string;
    isPrivateBucket?: boolean;
    folderPrefix?: string;
    clientCode?: string;
  } | null;
}

export function formatCloudflareUrl(domainOrUrl: string): string {
  let d = (domainOrUrl || '').trim();
  if (!d) return '';
  if (!d.startsWith('http://') && !d.startsWith('https://')) {
    d = `https://${d}`;
  }
  return d.replace(/\/+$/, '');
}

export function sanitizeBucketName(raw?: string): string {
  const b = (raw || import.meta.env.VITE_SUPABASE_BUCKET || STORAGE_BUCKET_DEFAULT).trim();
  return b.replace(/\s+/g, '_') || STORAGE_BUCKET_DEFAULT;
}

export function sanitizeFolderSegment(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Tenant object-key namespacing
//
// A single storage bucket holding several companies' panoramas is only safe
// if object keys carry the owning company.
// Priority:
// 1. Explicit folderPrefix on settings.tenantStorage
// 2. settings.clientCode (e.g. 'DevTest', 'TNB-LV')
// 3. settings.organizationSlug (e.g. 'geosphere-devtest')
// 4. settings.tenantOrganizationId (UUID -> 'orgs/{uuid}')
// ---------------------------------------------------------------------------

/** Root segment of the legacy tenant namespace. */
export const TENANT_OBJECT_ROOT = 'orgs';

export function resolveTenantFolderPrefix(settings?: StorageResolveSettings): string {
  if (!settings) return '';
  if (settings.tenantStorage?.folderPrefix) {
    const clean = sanitizeFolderSegment(settings.tenantStorage.folderPrefix);
    if (clean) return clean;
  }
  if (settings.tenantStorage?.clientCode) {
    const clean = sanitizeFolderSegment(settings.tenantStorage.clientCode);
    if (clean) return clean;
  }
  if (settings.clientCode) {
    const clean = sanitizeFolderSegment(settings.clientCode);
    if (clean) return clean;
  }
  if (settings.companyCode) {
    const clean = sanitizeFolderSegment(settings.companyCode);
    if (clean) return clean;
  }
  if (settings.organizationSlug) {
    const clean = sanitizeFolderSegment(settings.organizationSlug);
    if (clean) return clean;
  }
  if (settings.tenantOrganizationId) {
    return buildTenantObjectPrefix(settings.tenantOrganizationId);
  }
  return '';
}

export function buildTenantObjectPrefix(organizationId?: string | null): string {
  const id = (organizationId || '').trim();
  if (!id) return '';
  // Only a real uuid earns an orgs/ prefix. Anything else is handled as a plain folder segment.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return '';
  return `${TENANT_OBJECT_ROOT}/${id}`;
}

/**
 * Prepend the tenant prefix or company clientCode folder to an object key, unless it already carries one.
 * Idempotent on purpose: paths already starting with the folder or `orgs/{uuid}/` are returned untouched.
 */
export function applyTenantObjectPrefix(path: string, organizationIdOrFolder?: string | null): string {
  const raw = (path || '').replace(/^\/+/, '');
  if (!raw || !organizationIdOrFolder) return raw;

  let prefix = '';
  const trimmed = organizationIdOrFolder.trim();
  if (trimmed.startsWith(`${TENANT_OBJECT_ROOT}/`)) {
    prefix = trimmed;
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    prefix = buildTenantObjectPrefix(trimmed);
  } else {
    prefix = sanitizeFolderSegment(trimmed);
  }

  if (!prefix) return raw;
  if (new RegExp(`^${TENANT_OBJECT_ROOT}/[0-9a-f-]{36}/`, 'i').test(raw)) return raw;
  if (raw.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) return raw;

  return `${prefix}/${raw}`;
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
    if (provider !== 'supabase' && provider !== 'supabase_self_hosted' && cleanFn.includes('/storage/v1/object/public/')) {
      const parts = cleanFn.split('?')[0].split('/');
      cleanFn = parts[parts.length - 1] || cleanFn;
    } else {
      return cleanFn;
    }
  }
  cleanFn = cleanFn.replace(/^\/+/, '');
  cleanFn = cleanFn.replace(/^storage\/v1\/object\/public\/[^/]+\//i, '');
  cleanFn = cleanFn.replace(/^(?:MMS_PIC|mms_pic|MMS\s+PIC|mms\s+pic|panoramas)\//i, '');
  cleanFn = cleanFn.replace(/^\/+/, '').trim();
  if (!cleanFn) return '';

  const cachedSigned = getCachedSignedPanoramaUrl(cleanFn);
  if (cachedSigned) {
    return cachedSigned;
  }

  const tenantStorage = settings?.tenantStorage;
  const provider: StorageProviderType = (
    tenantStorage?.provider ||
    settings?.storageProvider ||
    import.meta.env.VITE_STORAGE_PROVIDER ||
    'cloudflare_r2'
  ) as StorageProviderType;
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
        tenantStorage?.cdnUrl ||
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
        const defaultSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
        const baseSupabaseUrl = (
          rawSbUrl && !rawSbUrl.includes('frz995-360-processing') && !rawSbUrl.includes('xyzcompany')
            ? rawSbUrl
            : defaultSupabaseUrl
        ).replace(/\/+$/, '');
        const bucket = sanitizeBucketName(tenantStorage?.bucketName || settings?.supabaseBucket);
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
      if (
        singlePattern &&
        !singlePattern.includes('{index') &&
        (singlePattern.includes('{subgrid}') || singlePattern.includes('{filename}') || singlePattern.includes('{pointFolder}'))
      ) {
        const path = singlePattern
          .replace('{pointFolder}', nameWithoutExt)
          .replace('{filename}', cleanFn)
          .replace('{subgrid}', targetSubgrid || nameWithoutExt)
          .replace(/^\/+/, '');
        return baseUrl ? `${baseUrl}/${path}` : `/${path}`;
      }

      const prefix = (settings?.imageStoragePath || '').replace(/^\/+/, '').replace(/\/+$/, '');
      if (prefix && prefix !== STORAGE_BUCKET_DEFAULT && prefix !== 'MMS PIC') {
        return baseUrl ? `${baseUrl}/${prefix}/${cleanFn}` : `/${prefix}/${cleanFn}`;
      }
      return baseUrl ? `${baseUrl}/${cleanFn}` : `/${cleanFn}`;
    }

    case 'aws_s3': {
      const bucket = tenantStorage?.bucketName || settings?.s3Bucket || import.meta.env.VITE_S3_BUCKET || '';
      const region = tenantStorage?.region || settings?.s3Region || import.meta.env.VITE_S3_REGION || REGION_DEFAULTS.s3Region;
      const baseUrl = `https://${bucket}.s3.${region}.amazonaws.com`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'gcs': {
      const bucket = tenantStorage?.bucketName || settings?.gcsBucket || import.meta.env.VITE_GCS_BUCKET || '';
      const baseUrl = `https://storage.googleapis.com/${bucket}`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'azure_blob': {
      const account = settings?.azureAccount || import.meta.env.VITE_AZURE_ACCOUNT || '';
      const container = tenantStorage?.bucketName || settings?.azureContainer || import.meta.env.VITE_AZURE_CONTAINER || '';
      const baseUrl = `https://${account}.blob.core.windows.net/${container}`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'wasabi': {
      const bucket = tenantStorage?.bucketName || settings?.wasabiBucket || import.meta.env.VITE_WASABI_BUCKET || '';
      const region = tenantStorage?.region || settings?.wasabiRegion || import.meta.env.VITE_WASABI_REGION || REGION_DEFAULTS.wasabiRegion;
      const baseUrl = `https://s3.${region}.wasabisys.com/${bucket}`;
      if (options?.asConfigUrl) return `${baseUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${baseUrl}/${cleanFn}`;
    }

    case 'nas_local': {
      if (isNasImageProxyEnabled()) {
        return options?.asConfigUrl
          ? nasImageUrl(`tiles/${targetSubgrid}/${nameWithoutExt}/config.json`)
          : nasImageUrl(cleanFn);
      }
      const nasUrl = (
        settings?.nasServerUrl ||
        settings?.productionApiUrl ||
        import.meta.env.VITE_NAS_SERVER_URL ||
        import.meta.env.VITE_PRODUCTION_API_URL ||
        ''
      ).replace(/\/+$/, '');
      if (!nasUrl) return '';
      if (options?.asConfigUrl) return `${nasUrl}/tiles/${targetSubgrid}/${nameWithoutExt}/config.json`;
      return `${nasUrl}/${cleanFn}`;
    }

    case 'supabase_self_hosted': {
      const rawSbUrl = (
        settings?.selfHostedStorageUrl ||
        settings?.supabaseUrl ||
        'http://localhost:8000'
      ).trim();
      const baseSupabaseUrl = rawSbUrl.replace(/\/+$/, '');
      const bucket = sanitizeBucketName(
        tenantStorage?.bucketName ||
        settings?.selfHostedBucket ||
        settings?.supabaseBucket ||
        'MMS_PIC'
      );
      const isPrivate = Boolean(tenantStorage?.isPrivateBucket ?? (settings?.isPrivateBucket || settings?.useSignedUrls));
      const objectEndpoint = isPrivate ? 'authenticated' : 'public';
      const folder = resolveTenantFolderPrefix(settings) || settings?.tenantOrganizationId;

      const pattern = settings?.singleImagePathPattern;
      if (
        pattern &&
        !pattern.includes('{index') &&
        (pattern.includes('{filename}') || pattern.includes('{pointFolder}'))
      ) {
        const path = applyTenantObjectPrefix(
          pattern
            .replace('{subgrid}', targetSubgrid || '')
            .replace('{pointFolder}', nameWithoutExt)
            .replace('{filename}', cleanFn)
            .replace(/^\/+/, ''),
          folder
        );
        return `${baseSupabaseUrl}/storage/v1/object/${objectEndpoint}/${bucket}/${path}`;
      }

      // If cleanFn already includes a folder or if files are at root
      return `${baseSupabaseUrl}/storage/v1/object/${objectEndpoint}/${bucket}/${applyTenantObjectPrefix(
        cleanFn,
        folder
      )}`;
    }

    case 'supabase':
    default: {
      const rawSbUrl = (settings?.supabaseUrl || '').trim();
      const defaultSupabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const baseSupabaseUrl = (
        rawSbUrl && !rawSbUrl.includes('frz995-360-processing') && !rawSbUrl.includes('xyzcompany')
          ? rawSbUrl
          : defaultSupabaseUrl
      ).replace(/\/+$/, '');
      const bucket = sanitizeBucketName(
        tenantStorage?.bucketName ||
        settings?.supabaseBucket ||
        settings?.selfHostedBucket ||
        'MMS_PIC'
      );
      const isPrivate = Boolean(tenantStorage?.isPrivateBucket ?? (settings?.isPrivateBucket || settings?.useSignedUrls));
      const objectEndpoint = isPrivate ? 'authenticated' : 'public';
      const folder = resolveTenantFolderPrefix(settings) || settings?.tenantOrganizationId;

      const pattern = settings?.singleImagePathPattern;
      if (
        pattern &&
        !pattern.includes('{index') &&
        (pattern.includes('{filename}') || pattern.includes('{pointFolder}'))
      ) {
        const path = applyTenantObjectPrefix(
          pattern
            .replace('{subgrid}', targetSubgrid || '')
            .replace('{pointFolder}', nameWithoutExt)
            .replace('{filename}', cleanFn)
            .replace(/^\/+/, ''),
          folder
        );
        return `${baseSupabaseUrl}/storage/v1/object/${objectEndpoint}/${bucket}/${path}`;
      }

      // If cleanFn already includes a folder or if files are at root
      return `${baseSupabaseUrl}/storage/v1/object/${objectEndpoint}/${bucket}/${applyTenantObjectPrefix(
        cleanFn,
        folder
      )}`;
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
  const tenantStorage = settings?.tenantStorage;
  const provider = (tenantStorage?.provider || settings?.storageProvider || '').toLowerCase().trim();
  let baseUrl = '';

  if (provider === 'cloudflare_r2' || provider === 'r2' || provider === 'custom_cdn') {
    baseUrl = (tenantStorage?.cdnUrl || settings?.r2Domain || settings?.r2PublicDomain || settings?.cloudStorageBaseUrl || settings?.customCdnUrl || '').trim();
  } else if (provider === 'supabase' || provider === 'supabase_self_hosted') {
    const rawSbUrl = provider === 'supabase_self_hosted'
      ? (settings?.selfHostedStorageUrl || settings?.supabaseUrl || 'http://localhost:8000').trim()
      : (settings?.supabaseUrl || '').trim();
    const defaultSupabaseUrl = provider === 'supabase_self_hosted' ? 'http://localhost:8000' : (import.meta.env.VITE_SUPABASE_URL || '');
    const sbUrl = (
      rawSbUrl && !rawSbUrl.includes('frz995-360-processing') && !rawSbUrl.includes('xyzcompany')
        ? rawSbUrl
        : defaultSupabaseUrl
    ).replace(/\/+$/, '');
    const bucket = sanitizeBucketName(
      tenantStorage?.bucketName || (
        provider === 'supabase_self_hosted'
          ? (settings?.selfHostedBucket || settings?.supabaseBucket)
          : settings?.supabaseBucket
      )
    );
    const isPrivate = Boolean(tenantStorage?.isPrivateBucket ?? (settings?.isPrivateBucket || settings?.useSignedUrls));
    const objectEndpoint = isPrivate ? 'authenticated' : 'public';
    baseUrl = sbUrl ? `${sbUrl}/storage/v1/object/${objectEndpoint}/${bucket}` : '';
  } else {
    baseUrl = (tenantStorage?.cdnUrl || settings?.customCdnUrl || settings?.customStorageUrl || settings?.cloudStorageBaseUrl || '').trim();
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

  const rawTilePath = pattern
    .replace('{subgrid}', sg)
    .replace('{pointFolder}', pointFolder)
    .replace('{filename}', cleanFilename)
    .replace(/^\/+/, '');

  // For external dedicated CDN/R2/S3 storage without an explicit custom folder prefix,
  // multi-res tiles are stored directly under tiles/{subgrid}/... (standard pyramid layout).
  // In shared multi-tenant buckets (e.g. Supabase storage), the tenant folder prefix is applied.
  const isDedicatedExternalBucket = provider === 'cloudflare_r2' || provider === 'r2' || provider === 'custom_cdn' || Boolean(tenantStorage?.cdnUrl);
  const explicitFolderPrefix = tenantStorage?.folderPrefix?.trim();

  const prefix = explicitFolderPrefix
    ? explicitFolderPrefix
    : (isDedicatedExternalBucket ? '' : (resolveTenantFolderPrefix(settings) || settings?.tenantOrganizationId));

  const relativePath = prefix ? applyTenantObjectPrefix(rawTilePath, prefix) : rawTilePath;

  const cachedSigned = getCachedSignedPanoramaUrl(relativePath);
  if (cachedSigned) {
    return cachedSigned;
  }

  return `${baseUrl}/${relativePath}`;
}
