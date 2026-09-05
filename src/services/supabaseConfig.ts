/**
 * Pure Supabase/Postgres database configuration mapping helper.
 * Extracted verbatim from src/services/supabase.ts (Phase 2 of the monolith
 * split — see implementation_plan_v12.md). Stateless and side-effect free:
 * derives table names from settings and `import.meta.env` only.
 */
export interface DatabaseTableMapping {
  panoramasTable: string;
  panoramasSummaryView: string;
  batchLogsTable: string;
  qaDefectsTable: string;
  auditLogsTable: string;
  stagingPanoramasTable: string;
  notificationsTable: string;
}

/**
 * Get active database table names with smart defaults.
 * Allows seamless overrides when connecting to enterprise PostGIS databases with custom table names.
 */
export function getDatabaseTableMapping(settings?: any): DatabaseTableMapping {
  return {
    panoramasTable: settings?.dbPanoramasTable || import.meta.env.VITE_DB_PANORAMAS_TABLE || 'panoramas',
    panoramasSummaryView: settings?.dbSummaryView || import.meta.env.VITE_DB_SUMMARY_VIEW || 'panoramas_subgrid_summary',
    batchLogsTable: settings?.dbTableName || import.meta.env.VITE_DB_BATCH_LOGS_TABLE || 'batch_logs',
    qaDefectsTable: settings?.dbQaDefectsTable || import.meta.env.VITE_DB_QA_DEFECTS_TABLE || 'qa_defects',
    auditLogsTable: settings?.dbAuditLogsTable || import.meta.env.VITE_DB_AUDIT_LOGS_TABLE || 'audit_logs',
    stagingPanoramasTable: settings?.dbStagingTable || import.meta.env.VITE_DB_STAGING_TABLE || 'staging_panoramas',
    notificationsTable: settings?.dbNotificationsTable || import.meta.env.VITE_DB_NOTIFICATIONS_TABLE || 'notifications'
  };
}