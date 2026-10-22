/**
 * Console storage and parent cluster service layer.
 *
 * THE NULL RULE
 *   Failed reads report error strings and return null values rather than confident
 *   zeroes. An unmeasured cluster metric renders an em dash (—) so an operator
 *   never mistakes an outage or RLS refusal for empty storage.
 *
 * REAL METRICS ONLY
 *   Queries real PostgreSQL disk sizes and public.file_inventory entries.
 *   Zero mock values.
 *
 * WHAT A FAILED READ MAY NOT DO
 *   Two things used to happen here, and both turned an outage into a clean
 *   bill of health:
 *
 *   1. The `file_inventory` read discarded its error. `const { data: files } =
 *      …` throws the error away, so a failed inventory query became an empty
 *      array, and an empty array became "every company has stored 0 bytes and
 *      0 files" — reported with `error: null`, so nothing on the screen said
 *      anything was wrong.
 *   2. The parent-stats fallback invented a database size. It returned
 *      `47185920` bytes, rendered as "45 MB (Catalog baseline)", together with
 *      a PostgreSQL version and a PostGIS version, as though it had measured
 *      them. Only `pg_database_size()` can measure the first; only the
 *      database can answer the other two.
 *
 *   The fallback now measures what it can reach and reports `null` for
 *   everything it cannot.
 */

import { supabase } from './supabase';

export interface ParentDatabaseStats {
  /** null = not measured. Only `pg_database_size()` can measure this. */
  databaseSizeBytes: number | null;
  databaseSizePretty: string | null;
  storageBytes: number | null;
  storageBytesPretty: string | null;
  storageFiles: number | null;
  totalAllocatedStorageGb: number | null;
  totalAllocatedSeats: number | null;
  totalCompanies: number | null;
  activeCompanies: number | null;
  /** null = not measured. */
  postgresVersion: string | null;
  /** null = not measured. "Not Installed" is a measured answer and is kept. */
  postgisVersion: string | null;
  /** 'unknown' = the tier was not reported. The plan tier is a deployment setting, not a live billing read. */
  planTier: string;
  /** null = not reported by the catalog. */
  planDbLimitBytes: number | null;
  /** null = not reported by the catalog. */
  planStorageLimitBytes: number | null;
}

export interface ParentDatabaseResult {
  stats: ParentDatabaseStats | null;
  error: string | null;
}

export interface CompanyStorageBreakdown {
  organizationId: string;
  organizationName: string;
  clientCode: string;
  databaseType: string;
  licenseType: string;
  licenseExpiresAt: string | null;
  status: string;
  allocatedStorageGb: number | null;
  consumedStorageBytes: number;
  consumedFilesCount: number;
  mmsPicBytes: number;
  mmsPicFiles: number;
  panoramasBytes: number;
  panoramasFiles: number;
  geometryBytes: number;
  geometryFiles: number;
  otherBytes: number;
  otherFiles: number;
  consumedStorageGb: number;
  percentUsed: number | null;
}

export interface CompanyStorageResult {
  breakdown: CompanyStorageBreakdown[];
  error: string | null;
}

/** A number, or null when the value was not a number. Never a fabricated 0. */
function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A non-empty string, or null. */
function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * `version()` returns the whole build string — "PostgreSQL 17.6 (Debian
 * 17.6-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc…". The console
 * shows an engine version, not a compiler banner.
 */
function shortPostgresVersion(raw: unknown): string | null {
  const text = textOrNull(raw);
  if (!text) return null;
  const match = /^PostgreSQL\s+([0-9][0-9.]*)/i.exec(text);
  return match ? `PostgreSQL ${match[1]}` : text;
}

/** The organizations columns the fallbacks read. */
interface OrgFallbackRow {
  id: string;
  name: string;
  client_code: string | null;
  database_type: string | null;
  license_type: string | null;
  license_expires_at: string | null;
  status: string | null;
  settings: {
    storageQuotaGb?: number;
    allowedUserSeats?: number;
  } | null;
}

/** The file_inventory columns the fallbacks read. */
interface InventoryFallbackRow {
  organization_id: string | null;
  bucket: string | null;
  size_bytes: number | null;
}

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);

  return `${parseFloat((bytes / Math.pow(k, safeI)).toFixed(dm))} ${sizes[safeI]}`;
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Fetch real PostgreSQL disk and storage cluster stats for the Seller Console.
 * Restricted to platform administrators by sec.require_platform_admin().
 */
export async function fetchParentDatabaseStats(): Promise<ParentDatabaseResult> {
  const runFallback = async (originalErrorMsg: string): Promise<ParentDatabaseResult> => {
    try {
      const { data: orgsRaw, error: orgsErr } = await supabase
        .from('organizations')
        .select('id, name, client_code, database_type, license_type, license_expires_at, status, settings');

      if (orgsErr || !orgsRaw) {
        return { stats: null, error: originalErrorMsg };
      }

      const orgs: OrgFallbackRow[] = orgsRaw;

      // The inventory read's error is read, not discarded. A failed read means
      // the bucket totals are unknown — not that the buckets are empty.
      const { data: filesRaw, error: filesErr } = await supabase
        .from('file_inventory')
        .select('size_bytes');

      let totalStorageBytes: number | null = null;
      let totalStorageFiles: number | null = null;
      let inventoryError: string | null = null;

      if (filesErr || !filesRaw) {
        inventoryError = filesErr
          ? `Storage inventory read failed: ${filesErr.message}`
          : 'Storage inventory read returned no payload.';
      } else {
        const files: { size_bytes: number | null }[] = filesRaw;
        totalStorageBytes = files.reduce(
          (acc: number, f) => acc + (Number(f.size_bytes) || 0),
          0
        );
        totalStorageFiles = files.length;
      }

      let totalAllocatedGb = 0;
      let totalAllocatedSeats = 0;
      let activeCompanies = 0;

      for (const o of orgs) {
        if (o.status === 'active') activeCompanies++;
        if (o.settings && typeof o.settings.storageQuotaGb === 'number') {
          totalAllocatedGb += o.settings.storageQuotaGb;
        }
        if (o.settings && typeof o.settings.allowedUserSeats === 'number') {
          totalAllocatedSeats += o.settings.allowedUserSeats;
        }
      }

      // The cluster figures are NOT measured here. `pg_database_size()` and the
      // extension versions are only reachable through the RPC, so they are
      // reported as unknown rather than guessed.
      const fallbackStats: ParentDatabaseStats = {
        databaseSizeBytes: null,
        databaseSizePretty: null,
        storageBytes: totalStorageBytes,
        storageBytesPretty: formatBytes(totalStorageBytes),
        storageFiles: totalStorageFiles,
        totalAllocatedStorageGb: totalAllocatedGb,
        totalAllocatedSeats: totalAllocatedSeats,
        totalCompanies: orgs.length,
        activeCompanies: activeCompanies,
        postgresVersion: null,
        postgisVersion: null,
        planTier: 'unknown',
        planDbLimitBytes: null,
        planStorageLimitBytes: null
      };

      return {
        stats: fallbackStats,
        error: inventoryError ?? originalErrorMsg
      };
    } catch {
      return { stats: null, error: originalErrorMsg };
    }
  };

  try {
    const { data, error } = await supabase.rpc('console_parent_database_stats');

    if (error) {
      console.warn('Parent database stats RPC unavailable, falling back to direct table aggregation:', error.message);
      return await runFallback(error.message);
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      return await runFallback('No parent database stats returned from catalog query.');
    }

    const row = data[0];
    const dbBytes = numberOrNull(row.database_size_bytes);
    const storageBytes = numberOrNull(row.storage_bytes);

    const stats: ParentDatabaseStats = {
      databaseSizeBytes: dbBytes,
      databaseSizePretty: textOrNull(row.database_size_pretty) ?? (dbBytes === null ? null : formatBytes(dbBytes)),
      storageBytes: storageBytes,
      storageBytesPretty: textOrNull(row.storage_bytes_pretty) ?? formatBytes(storageBytes),
      storageFiles: numberOrNull(row.storage_files),
      totalAllocatedStorageGb: numberOrNull(row.total_allocated_storage_gb),
      totalAllocatedSeats: numberOrNull(row.total_allocated_seats),
      totalCompanies: numberOrNull(row.total_companies),
      activeCompanies: numberOrNull(row.active_companies),
      postgresVersion: shortPostgresVersion(row.postgres_version),
      postgisVersion: textOrNull(row.postgis_version),
      planTier: textOrNull(row.plan_tier) ?? 'unknown',
      planDbLimitBytes: numberOrNull(row.plan_db_limit_bytes),
      planStorageLimitBytes: numberOrNull(row.plan_storage_limit_bytes)
    };

    return { stats, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error && err.message ? err.message : 'Could not reach database stats RPC.';
    console.warn('Parent database stats threw, falling back to direct table aggregation:', msg);
    return await runFallback(msg);
  }
}

/**
 * Fetch storage consumption per company and bucket breakdown.
 * Restricted to platform administrators by sec.require_platform_admin().
 */
export async function fetchCompanyStorageBreakdown(): Promise<CompanyStorageResult> {
  try {
    const { data, error } = await supabase.rpc('console_company_storage_breakdown');

    if (error) {
      console.warn('Company storage breakdown RPC unavailable, falling back to direct table aggregation:', error.message);
      try {
        const { data: orgsRaw, error: orgsErr } = await supabase
          .from('organizations')
          .select('id, name, client_code, database_type, license_type, license_expires_at, status, settings');

        if (orgsErr || !orgsRaw) {
          return { breakdown: [], error: error.message };
        }

        const orgs: OrgFallbackRow[] = orgsRaw;

        // The inventory read's error is read, not discarded. Discarding it made
        // a failed inventory query report every company as storing nothing.
        const { data: filesRaw, error: filesErr } = await supabase
          .from('file_inventory')
          .select('organization_id, bucket, size_bytes');

        if (filesErr || !filesRaw) {
          return {
            breakdown: [],
            error: filesErr
              ? `Storage inventory read failed: ${filesErr.message}`
              : 'Storage inventory read returned no payload.'
          };
        }

        const files: InventoryFallbackRow[] = filesRaw;
        const breakdown: CompanyStorageBreakdown[] = orgs.map((o) => {
          const orgFiles = files.filter((f) => f.organization_id === o.id);
          const consumedBytes = orgFiles.reduce((acc: number, f) => acc + (Number(f.size_bytes) || 0), 0);
          const consumedGb = consumedBytes / (1024 * 1024 * 1024);
          const allocatedGb = o.settings && typeof o.settings.storageQuotaGb === 'number' ? o.settings.storageQuotaGb : null;
          const percentUsed = allocatedGb && allocatedGb > 0 ? (consumedGb / allocatedGb) * 100 : null;

          const mmsFiles = orgFiles.filter((f) => f.bucket === 'MMS_PIC');
          const panoFiles = orgFiles.filter((f) => f.bucket === 'panoramas');
          const geomFiles = orgFiles.filter((f) => f.bucket === 'road-analysis-geometry');
          const otherFiles = orgFiles.filter((f) => !['MMS_PIC', 'panoramas', 'road-analysis-geometry'].includes(f.bucket || ''));

          return {
            organizationId: o.id,
            organizationName: o.name,
            clientCode: o.client_code || '—',
            databaseType: o.database_type || 'cloud_shared',
            licenseType: o.license_type || 'cloud_saas',
            licenseExpiresAt: o.license_expires_at || null,
            status: o.status || 'active',
            allocatedStorageGb: allocatedGb,
            consumedStorageBytes: consumedBytes,
            consumedFilesCount: orgFiles.length,
            mmsPicBytes: mmsFiles.reduce((acc: number, f) => acc + (Number(f.size_bytes) || 0), 0),
            mmsPicFiles: mmsFiles.length,
            panoramasBytes: panoFiles.reduce((acc: number, f) => acc + (Number(f.size_bytes) || 0), 0),
            panoramasFiles: panoFiles.length,
            geometryBytes: geomFiles.reduce((acc: number, f) => acc + (Number(f.size_bytes) || 0), 0),
            geometryFiles: geomFiles.length,
            otherBytes: otherFiles.reduce((acc: number, f) => acc + (Number(f.size_bytes) || 0), 0),
            otherFiles: otherFiles.length,
            consumedStorageGb: consumedGb,
            percentUsed
          };
        });

        return { breakdown, error: null };
      } catch {
        return { breakdown: [], error: error.message };
      }
    }

    if (!data || !Array.isArray(data)) {
      return { breakdown: [], error: 'No breakdown records returned.' };
    }

    const breakdown: CompanyStorageBreakdown[] = data.map((r: Record<string, unknown>) => {
      const consumedBytes = typeof r.consumed_storage_bytes === 'number' ? r.consumed_storage_bytes : Number(r.consumed_storage_bytes) || 0;
      const consumedGb = consumedBytes / (1024 * 1024 * 1024);
      const allocatedGb = r.allocated_storage_gb !== null && r.allocated_storage_gb !== undefined ? Number(r.allocated_storage_gb) : null;
      const percentUsed = allocatedGb && allocatedGb > 0 ? (consumedGb / allocatedGb) * 100 : null;

      return {
        organizationId: String(r.organization_id || ''),
        organizationName: String(r.organization_name || 'Unnamed Company'),
        clientCode: String(r.client_code || '—'),
        databaseType: String(r.database_type || 'cloud_shared'),
        licenseType: String(r.license_type || 'cloud_saas'),
        licenseExpiresAt: r.license_expires_at ? String(r.license_expires_at) : null,
        status: String(r.status || 'active'),
        allocatedStorageGb: allocatedGb,
        consumedStorageBytes: consumedBytes,
        consumedFilesCount: typeof r.consumed_files_count === 'number' ? r.consumed_files_count : Number(r.consumed_files_count) || 0,
        mmsPicBytes: typeof r.mms_pic_bytes === 'number' ? r.mms_pic_bytes : Number(r.mms_pic_bytes) || 0,
        mmsPicFiles: typeof r.mms_pic_files === 'number' ? r.mms_pic_files : Number(r.mms_pic_files) || 0,
        panoramasBytes: typeof r.panoramas_bytes === 'number' ? r.panoramas_bytes : Number(r.panoramas_bytes) || 0,
        panoramasFiles: typeof r.panoramas_files === 'number' ? r.panoramas_files : Number(r.panoramas_files) || 0,
        geometryBytes: typeof r.geometry_bytes === 'number' ? r.geometry_bytes : Number(r.geometry_bytes) || 0,
        geometryFiles: typeof r.geometry_files === 'number' ? r.geometry_files : Number(r.geometry_files) || 0,
        otherBytes: typeof r.other_bytes === 'number' ? r.other_bytes : Number(r.other_bytes) || 0,
        otherFiles: typeof r.other_files === 'number' ? r.other_files : Number(r.other_files) || 0,
        consumedStorageGb: consumedGb,
        percentUsed
      };
    });

    return { breakdown, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error && err.message ? err.message : 'Could not reach company storage RPC.';
    console.warn('Company storage breakdown threw', msg);
    return { breakdown: [], error: msg };
  }
}
