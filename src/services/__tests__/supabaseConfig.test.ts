import { describe, it, expect } from 'vitest';
import { getDatabaseTableMapping } from '../supabaseConfig';

describe('getDatabaseTableMapping', () => {
  it('applies smart defaults when no settings or env vars are present', () => {
    delete import.meta.env.VITE_DB_PANORAMAS_TABLE;
    delete import.meta.env.VITE_DB_SUMMARY_VIEW;
    const mapping = getDatabaseTableMapping();
    expect(mapping.panoramasTable).toBe('panoramas');
    expect(mapping.panoramasSummaryView).toBe('panoramas_subgrid_summary');
    expect(mapping.batchLogsTable).toBe('batch_logs');
    expect(mapping.qaDefectsTable).toBe('qa_defects');
    expect(mapping.auditLogsTable).toBe('audit_logs');
    expect(mapping.stagingPanoramasTable).toBe('staging_panoramas');
    expect(mapping.notificationsTable).toBe('notifications');
  });

  it('honours explicit settings overrides', () => {
    const mapping = getDatabaseTableMapping({
      dbPanoramasTable: 'custom_panoramas',
      dbTableName: 'custom_batch_logs',
      dbStagingTable: 'custom_staging'
    });
    expect(mapping.panoramasTable).toBe('custom_panoramas');
    expect(mapping.batchLogsTable).toBe('custom_batch_logs');
    expect(mapping.stagingPanoramasTable).toBe('custom_staging');
  });
});