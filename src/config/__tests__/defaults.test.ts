import { describe, it, expect } from 'vitest';
import {
  STORAGE_BUCKET_DEFAULT,
  STORAGE_PATH_PREFIX_DEFAULT,
  DATABASE_TABLE_DEFAULTS,
  REGION_DEFAULTS,
  S3_BUCKET_DEFAULT,
  AZURE_CONTAINER_DEFAULT,
  DATABASE_HOST_DEFAULT,
  DEFAULT_BASEMAP
} from '../defaults';

describe('config defaults', () => {
  it('provides environment-agnostic storage bucket defaults', () => {
    expect(STORAGE_BUCKET_DEFAULT).toBe('MMS_PIC');
    expect(STORAGE_PATH_PREFIX_DEFAULT).toBe('/MMS_PIC/');
  });

  it('provides generic database table defaults', () => {
    expect(DATABASE_TABLE_DEFAULTS).toEqual({
      panoramasTable: 'panoramas',
      panoramasSummaryView: 'panoramas_subgrid_summary',
      batchLogsTable: 'batch_logs',
      qaDefectsTable: 'qa_defects',
      auditLogsTable: 'audit_logs',
      stagingPanoramasTable: 'staging_panoramas',
      notificationsTable: 'notifications',
      qaqcRunsTable: 'qaqc_audit_runs'
    });
  });

  it('provides region, bucket, container, host and basemap defaults', () => {
    expect(REGION_DEFAULTS).toEqual({ s3Region: 'ap-southeast-1', wasabiRegion: 'us-east-1' });
    expect(S3_BUCKET_DEFAULT).toBe('tnb-mobilemapping-panoramas');
    expect(AZURE_CONTAINER_DEFAULT).toBe('panoramas');
    expect(DATABASE_HOST_DEFAULT).toBe('db.aws-0-ap-southeast-1.supabase.co');
    expect(DEFAULT_BASEMAP).toBe('ofm-positron');
  });

  it('does not contain any environment-specific URLs or credentials', () => {
    const values = JSON.stringify([
      STORAGE_BUCKET_DEFAULT,
      STORAGE_PATH_PREFIX_DEFAULT,
      DATABASE_TABLE_DEFAULTS,
      REGION_DEFAULTS,
      S3_BUCKET_DEFAULT,
      AZURE_CONTAINER_DEFAULT,
      DATABASE_HOST_DEFAULT,
      DEFAULT_BASEMAP
    ]);
    expect(values).not.toContain('tqqybumedywzylujjkqa');
    expect(values).not.toContain('mobilemapping-nine.vercel.app');
    expect(values).not.toContain('eyJhbGciOi');
    expect(values).not.toContain('Fariz');
  });
});