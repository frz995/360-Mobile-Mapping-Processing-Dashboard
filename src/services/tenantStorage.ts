export interface OrganizationStorageConfig {
  provider?: 'supabase' | 'supabase_self_hosted' | 'cloudflare_r2' | 'aws_s3' | 'wasabi' | 'gcs' | 'azure_blob' | 'nas_local' | 'custom_cdn';
  bucketName?: string;
  cdnUrl?: string;
  region?: string;
  isPrivateBucket?: boolean;
  folderPrefix?: string;
  clientCode?: string;
  imageStorageStrategy?: 'multires_tiles' | 'single_equirectangular';
  /** Optional Cloudflare Account ID for BYOS metrics query */
  accountId?: string;
  /** Optional Read-Only Token for Cloudflare R2 Usage / AWS S3 metrics */
  readMetricsToken?: string;
  /** Contractual BYOS storage quota limit in GB */
  byosQuotaGb?: number;
  /** Cached consumed bytes from last metrics sync */
  byosConsumedBytes?: number;
  /** Cached object count from last metrics sync */
  byosObjectCount?: number;
  /** Timestamp of last metrics check */
  byosLastCheckedAt?: string;
}

export const ACTIVE_ORGANIZATION_KEY = 'geosphere360_active_org_id';
export const ACTIVE_ORGANIZATION_STORAGE_KEY = 'geosphere360_active_org_storage';
export const ACTIVE_ORGANIZATION_WEBGIS_KEY = 'geosphere360_active_org_webgis';
export const ACTIVE_ORGANIZATION_CLIENT_CODE_KEY = 'geosphere360_active_org_client_code';

let memoryActiveOrgId: string | null = null;
let memoryActiveOrgStorage: OrganizationStorageConfig | null = null;
let memoryActiveOrgWebgis: string | null = null;
let memoryActiveOrgClientCode: string | null = null;

export function getActiveOrganizationId(): string | null {
  if (memoryActiveOrgId) return memoryActiveOrgId;
  try {
    const session = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(ACTIVE_ORGANIZATION_KEY) : null;
    if (session) return session;
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_ORGANIZATION_KEY) : null;
  } catch {
    return null;
  }
}

export function setActiveOrganizationId(orgId: string | null): void {
  memoryActiveOrgId = orgId;
  try {
    if (orgId) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(ACTIVE_ORGANIZATION_KEY, orgId);
      if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_ORGANIZATION_KEY, orgId);
    } else {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(ACTIVE_ORGANIZATION_KEY);
        sessionStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
        sessionStorage.removeItem(ACTIVE_ORGANIZATION_WEBGIS_KEY);
        sessionStorage.removeItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(ACTIVE_ORGANIZATION_KEY);
        localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
        localStorage.removeItem(ACTIVE_ORGANIZATION_WEBGIS_KEY);
        localStorage.removeItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY);
      }
      memoryActiveOrgStorage = null;
      memoryActiveOrgWebgis = null;
      memoryActiveOrgClientCode = null;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('geosphere360-active-org-changed', {
          detail: { organizationId: orgId }
        })
      );
    }
  } catch (err) {
    console.debug('Storage sync ignored:', err);
  }
}

export function getActiveOrganizationStorage(): OrganizationStorageConfig | null {
  if (memoryActiveOrgStorage) return memoryActiveOrgStorage;
  try {
    const raw =
      (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY) : null) ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY) : null);
    if (!raw) return null;
    return JSON.parse(raw) as OrganizationStorageConfig;
  } catch {
    return null;
  }
}

export function setActiveOrganizationStorage(storage: OrganizationStorageConfig | null): void {
  memoryActiveOrgStorage = storage;
  try {
    if (storage) {
      const serialized = JSON.stringify(storage);
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, serialized);
      if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, serialized);
    } else {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
      if (typeof localStorage !== 'undefined') localStorage.removeItem(ACTIVE_ORGANIZATION_STORAGE_KEY);
    }
  } catch (err) {
    console.debug('Storage sync ignored:', err);
  }
}

export function getActiveOrganizationWebgis(): string | null {
  if (memoryActiveOrgWebgis) return memoryActiveOrgWebgis;
  try {
    const raw =
      (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(ACTIVE_ORGANIZATION_WEBGIS_KEY) : null) ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_ORGANIZATION_WEBGIS_KEY) : null);
    return raw || null;
  } catch {
    return null;
  }
}

export function setActiveOrganizationWebgis(url: string | null): void {
  memoryActiveOrgWebgis = url;
  try {
    if (url) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(ACTIVE_ORGANIZATION_WEBGIS_KEY, url);
      if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_ORGANIZATION_WEBGIS_KEY, url);
    } else {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(ACTIVE_ORGANIZATION_WEBGIS_KEY);
      if (typeof localStorage !== 'undefined') localStorage.removeItem(ACTIVE_ORGANIZATION_WEBGIS_KEY);
    }
  } catch (err) {
    console.debug('Webgis sync ignored:', err);
  }
}

export function getActiveOrganizationClientCode(): string | null {
  if (memoryActiveOrgClientCode) return memoryActiveOrgClientCode;
  try {
    const raw =
      (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY) : null) ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY) : null);
    return raw || null;
  } catch {
    return null;
  }
}

export function setActiveOrganizationClientCode(code: string | null): void {
  memoryActiveOrgClientCode = code;
  try {
    if (code) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY, code);
      if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY, code);
    } else {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY);
      if (typeof localStorage !== 'undefined') localStorage.removeItem(ACTIVE_ORGANIZATION_CLIENT_CODE_KEY);
    }
  } catch (err) {
    console.debug('Client code sync ignored:', err);
  }
}

export interface R2BucketUsageResult {
  storageSizeBytes: number;
  objectCount: number;
  success: boolean;
  error?: string;
}

/**
 * Queries Cloudflare R2 Bucket Usage endpoint via a read-only token.
 * GET https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/{bucket_name}/usage
 */
export async function fetchR2BucketUsage(
  accountId: string,
  bucketName: string,
  apiToken: string
): Promise<R2BucketUsageResult> {
  const cleanAccountId = (accountId || '').trim();
  const cleanBucketName = (bucketName || '').trim();
  const cleanToken = (apiToken || '').trim();

  if (!cleanAccountId || !cleanBucketName || !cleanToken) {
    return {
      storageSizeBytes: 0,
      objectCount: 0,
      success: false,
      error: 'Missing account ID, bucket name, or API token'
    };
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cleanAccountId}/r2/buckets/${cleanBucketName}/usage`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        storageSizeBytes: 0,
        objectCount: 0,
        success: false,
        error: `Cloudflare R2 API returned HTTP ${res.status}: ${errText || res.statusText}`
      };
    }

    const data = await res.json();
    if (data.success && data.result) {
      const sizeBytes = Number(data.result.storageSize ?? data.result.payloadSize ?? 0);
      const objects = Number(data.result.objectCount ?? data.result.objects ?? 0);
      return {
        storageSizeBytes: sizeBytes,
        objectCount: objects,
        success: true
      };
    }

    return {
      storageSizeBytes: 0,
      objectCount: 0,
      success: false,
      error: data.errors?.[0]?.message || 'Failed to parse R2 bucket metrics response'
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      storageSizeBytes: 0,
      objectCount: 0,
      success: false,
      error: errMsg || 'Network error querying Cloudflare R2 (Check CORS or token permissions)'
    };
  }
}


