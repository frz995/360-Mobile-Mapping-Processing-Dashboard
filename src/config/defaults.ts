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

/** Default basemap id used when no basemap is configured. */
export const DEFAULT_BASEMAP = 'ofm-positron';