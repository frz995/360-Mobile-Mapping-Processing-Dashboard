import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchParentDatabaseStats,
  fetchCompanyStorageBreakdown,
  formatBytes,
  formatPercent
} from '../consoleStorage';
import { supabase } from '../supabase';

/**
 * The service layer's half of the null rule.
 *
 * Two reads here used to make an outage look like an empty system:
 *
 *   1. The `file_inventory` error was discarded. `const { data: files } = …`
 *      throws the error away, so a refused inventory query became an empty
 *      array, and an empty array became "every company has stored 0 bytes and
 *      0 files" — reported with `error: null`, so nothing on the screen said
 *      anything was wrong.
 *   2. The parent-stats fallback invented a database size. It returned
 *      47185920 bytes, rendered as "45 MB (Catalog baseline)", together with
 *      a PostgreSQL version and a PostGIS version, as though it had measured
 *      them. Only `pg_database_size()` can measure the first; only the server
 *      can answer the other two.
 *
 * A fallback may report what it can reach, and nothing else.
 */

vi.mock('../supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn()
  }
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;

interface ReadResult {
  data: unknown;
  error: { message: string } | null;
}

/** A stand-in for `supabase.from(table).select(cols)`. */
const tableRead = (result: ReadResult) => ({ select: () => Promise.resolve(result) });

const ORG_ROW = {
  id: 'org-1',
  name: 'Apex Geospatial',
  client_code: 'APEX-01',
  database_type: 'cloud_shared',
  license_type: 'cloud_saas',
  license_expires_at: null,
  status: 'active',
  settings: { storageQuotaGb: 100, allowedUserSeats: 5 }
};

describe('consoleStorage — formatting an unmeasured quantity', () => {
  it('renders null as unknown and keeps a measured zero a zero', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');

    // A measured zero is a real answer. It must not be blurred into "unknown".
    expect(formatBytes(0)).toBe('0 B');
    expect(formatPercent(0)).toBe('0.0%');
  });
});

describe('consoleStorage — company storage breakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a failed inventory read instead of an empty, error-free breakdown', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function console_company_storage_breakdown' }
    });
    from.mockImplementation((table: string) =>
      table === 'organizations'
        ? tableRead({ data: [ORG_ROW], error: null })
        : tableRead({ data: null, error: { message: 'permission denied for table file_inventory' } })
    );

    const result = await fetchCompanyStorageBreakdown();

    // The old code discarded the inventory error, so this returned
    // `{ breakdown: [], error: null }` — a clean bill of health for an outage.
    expect(result.breakdown).toEqual([]);
    expect(result.error).toMatch(/file_inventory/);
  });

  it('measures the breakdown when the inventory read succeeds', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          organization_id: 'org-1',
          organization_name: 'Apex Geospatial',
          client_code: 'APEX-01',
          database_type: 'cloud_shared',
          license_type: 'cloud_saas',
          license_expires_at: null,
          status: 'active',
          allocated_storage_gb: 100,
          consumed_storage_bytes: 2048,
          consumed_files_count: 2,
          mms_pic_bytes: 1024,
          mms_pic_files: 1,
          panoramas_bytes: 1024,
          panoramas_files: 1,
          geometry_bytes: 0,
          geometry_files: 0,
          other_bytes: 0,
          other_files: 0
        }
      ],
      error: null
    });

    const result = await fetchCompanyStorageBreakdown();

    expect(result.error).toBeNull();
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].consumedStorageBytes).toBe(2048);
    expect(result.breakdown[0].allocatedStorageGb).toBe(100);
  });
});

describe('consoleStorage — parent database stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a failed inventory read as unknown storage rather than zero', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rpc unavailable' } });
    from.mockImplementation((table: string) =>
      table === 'organizations'
        ? tableRead({ data: [ORG_ROW], error: null })
        : tableRead({ data: null, error: { message: 'permission denied for table file_inventory' } })
    );

    const result = await fetchParentDatabaseStats();

    expect(result.stats?.storageBytes).toBeNull();
    expect(result.stats?.storageFiles).toBeNull();
    expect(result.error).toMatch(/file_inventory/);
  });

  it('does not invent a cluster size or an engine version when the catalog query is unavailable', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function console_parent_database_stats' }
    });
    from.mockImplementation((table: string) =>
      table === 'organizations'
        ? tableRead({ data: [ORG_ROW], error: null })
        : tableRead({ data: [{ size_bytes: 2048 }], error: null })
    );

    const result = await fetchParentDatabaseStats();

    // The fallback reaches neither `pg_database_size()` nor the server, so it
    // says nothing about them. The old fallback answered 47185920 bytes,
    // "PostgreSQL 17.6 (Cluster)" and "3.5.2 (PostGIS)".
    expect(result.stats?.databaseSizeBytes).toBeNull();
    expect(result.stats?.databaseSizePretty).toBeNull();
    expect(result.stats?.postgresVersion).toBeNull();
    expect(result.stats?.postgisVersion).toBeNull();
    expect(result.stats?.planTier).toBe('unknown');
    expect(result.stats?.planDbLimitBytes).toBeNull();
    expect(result.stats?.planStorageLimitBytes).toBeNull();

    // What the fallback CAN reach, it measures.
    expect(result.stats?.storageBytes).toBe(2048);
    expect(result.stats?.storageFiles).toBe(1);
    expect(result.stats?.totalCompanies).toBe(1);
    expect(result.stats?.activeCompanies).toBe(1);
    expect(result.stats?.totalAllocatedStorageGb).toBe(100);
    expect(result.stats?.totalAllocatedSeats).toBe(5);
  });

  it('shortens the engine version instead of printing the whole build banner', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          database_size_bytes: 25165824,
          database_size_pretty: '24 MB',
          storage_bytes: 15728640,
          storage_bytes_pretty: '15 MB',
          storage_files: 120,
          total_allocated_storage_gb: 500,
          total_allocated_seats: 15,
          total_companies: 1,
          active_companies: 1,
          postgres_version:
            'PostgreSQL 17.6 (Debian 17.6-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit',
          postgis_version: '3.5.2',
          plan_tier: 'free',
          plan_db_limit_bytes: 524288000,
          plan_storage_limit_bytes: 1073741824
        }
      ],
      error: null
    });

    const result = await fetchParentDatabaseStats();

    expect(result.error).toBeNull();
    expect(result.stats?.postgresVersion).toBe('PostgreSQL 17.6');
    expect(result.stats?.postgisVersion).toBe('3.5.2');
    expect(result.stats?.planTier).toBe('free');
    expect(result.stats?.databaseSizePretty).toBe('24 MB');
  });

  it('reports a missing plan tier as unknown rather than as the free tier', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          database_size_bytes: 25165824,
          storage_bytes: 15728640,
          storage_files: 120,
          total_allocated_storage_gb: 500,
          total_allocated_seats: 15,
          total_companies: 1,
          active_companies: 1,
          postgres_version: null,
          postgis_version: null,
          plan_tier: null,
          plan_db_limit_bytes: null,
          plan_storage_limit_bytes: null
        }
      ],
      error: null
    });

    const result = await fetchParentDatabaseStats();

    // The catalog hard-codes `plan_tier='free'` today. If it ever stops
    // reporting a tier, the console must not keep saying "Free".
    expect(result.stats?.planTier).toBe('unknown');
    expect(result.stats?.planDbLimitBytes).toBeNull();
    expect(result.stats?.planStorageLimitBytes).toBeNull();
    expect(result.stats?.postgresVersion).toBeNull();
    expect(result.stats?.postgisVersion).toBeNull();
  });
});
