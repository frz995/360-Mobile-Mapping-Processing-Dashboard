/**
 * Centralized default values for SDK/storage/database configuration.
 *
 * Single source of truth for the *generic functional defaults* the app falls
 * back to when neither per-project settings nor env vars provide a value.
 * Precedence is always: per-project settings (DB)  >  VITE_* env  >  these.
 *
 * Keep these environment-agnostic: environment-specific values (Supabase
 * project URL, WebGIS base URL, CDN domains) must NOT live here — they belong
 * in env vars only, so a missing env config surfaces instead of silently
 * pointing at a fixed environment. See implementation_plan_v13.md.
 */

/** Default Supabase storage bucket that holds 360° panorama images. */
export const STORAGE_BUCKET_DEFAULT = 'MMS_PIC';

/** Default storage path prefix used when building image paths. */
export const STORAGE_PATH_PREFIX_DEFAULT = '/MMS_PIC/';

/** Default manifest filename used for provider-agnostic dynamic frame counting. */
export const MANIFEST_PATH_DEFAULT = 'manifest.json';

/** Default Postgres/Supabase table & view names. */
export const DATABASE_TABLE_DEFAULTS = {
  panoramasTable: 'panoramas',
  panoramasSummaryView: 'panoramas_subgrid_summary',
  batchLogsTable: 'batch_logs',
  qaDefectsTable: 'qa_defects',
  auditLogsTable: 'audit_logs',
  stagingPanoramasTable: 'staging_panoramas',
  notificationsTable: 'notifications',
  qaqcRunsTable: 'qaqc_audit_runs'
} as const;

/** Default cloud-provider region settings. */
export const REGION_DEFAULTS = {
  s3Region: 'ap-southeast-1',
  wasabiRegion: 'us-east-1'
} as const;

/** Default S3 bucket used for panorama objects. */
export const S3_BUCKET_DEFAULT = 'tnb-mobilemapping-panoramas';

/** Default Azure Blob container name. */
export const AZURE_CONTAINER_DEFAULT = 'panoramas';

/** Default Postgres/Supabase host shown in connection settings. */
export const DATABASE_HOST_DEFAULT = 'db.aws-0-ap-southeast-1.supabase.co';

/**
 * Per-database-host connection defaults. Every provider has its OWN connection
 * character: different endpoint, credentials policy, pooler port and SSL
 * expectation. Values are derived dynamically (window hostname, env vars) —
 * never baked-in machine IPs. Env overrides: VITE_ONPREM_URL, VITE_NAS_URL.
 */
export interface ProviderConnectionDefaults {
  supabaseUrl?: string;
  supabaseKey?: string;
  databaseHost?: string;
  databasePort?: number;
  databaseName?: string;
  databaseSchema?: string;
  connectionMode?: 'postgrest' | 'direct_tcp' | 'realtime_ws';
  sslMode?: 'require' | 'verify-ca' | 'verify-full' | 'disable';
}

export function getProviderConnectionDefaults(provider: string): ProviderConnectionDefaults {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

  switch (provider) {
    case 'standalone_server':
      return {
        // The on-premise gateway normally lives on the same machine serving the
        // dashboard, so derive it from the current host rather than hardcoding.
        supabaseUrl: import.meta.env.VITE_ONPREM_URL || `http://${hostname}:8000`,
        supabaseKey: '',
        databaseHost: hostname,
        databasePort: 5432,
        databaseName: 'postgres',
        databaseSchema: 'public',
        connectionMode: 'postgrest',
        sslMode: 'disable'
      };
    case 'nas':
      return {
        supabaseUrl: import.meta.env.VITE_NAS_URL || '',
        supabaseKey: '',
        databaseHost: hostname,
        databasePort: 5432,
        databaseName: 'postgres',
        databaseSchema: 'public',
        connectionMode: 'postgrest',
        sslMode: 'disable'
      };
    case 'custom':
      // A raw PostgREST / custom endpoint: REST URL + key only, no direct DB.
      return {
        supabaseUrl: '',
        supabaseKey: '',
        databasePort: 5432,
        databaseName: 'postgres',
        databaseSchema: 'public',
        connectionMode: 'postgrest',
        sslMode: 'disable'
      };
    case 'supabase_cloud':
    default:
      return {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
        supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
        databaseHost: DATABASE_HOST_DEFAULT,
        databasePort: 5432,
        databaseName: 'postgres',
        databaseSchema: 'public',
        connectionMode: 'postgrest',
        sslMode: 'require'
      };
  }
}

/** Default basemap id used when no basemap is configured. */
export const DEFAULT_BASEMAP = 'ofm-positron';

/**
 * Current application version. The sign-in welcome gate replays when this
 * value changes (stored in localStorage as `geosphere360_welcome_version`),
 * so shipping a new version re-engages first-run onboarding for existing users.
 */
export const APP_VERSION = 'v14.0.0';