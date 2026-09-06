import { describe, it, expect } from 'vitest';
import {
  resolveSubgridLifecycle,
  generateUploadScript,
  LIFECYCLE_STAGES
} from '../dataLifecycle';
import type { DatasetRecord, ProcessingJobRecord } from '../../types/production';

describe('Data Lifecycle & WebGIS Handoff Engine', () => {
  it('defines all 6 standard lifecycle stages with clear descriptions and colors', () => {
    expect(LIFECYCLE_STAGES.RAW.shortLabel).toBe('RAW');
    expect(LIFECYCLE_STAGES.IN_PROCESSING.shortLabel).toBe('IN PROGRESS');
    expect(LIFECYCLE_STAGES.PROCESSED.shortLabel).toBe('PROCESSED');
    expect(LIFECYCLE_STAGES.DELIVERABLE.shortLabel).toBe('DELIVERABLE');
    expect(LIFECYCLE_STAGES.STAGED.shortLabel).toBe('STAGED');
    expect(LIFECYCLE_STAGES.PUBLISHED.shortLabel).toBe('Published in database');
  });

  it('resolves RAW stage when only raw dataset exists', () => {
    const datasets: DatasetRecord[] = [
      { id: '1', subgrid: 'SG01', dataset_type: 'RAW', pipeline_stage: 'STITCH', name: 'Raw SG01', version: 1 }
    ];
    const status = resolveSubgridLifecycle({ subgrid: 'SG01', datasets });
    expect(status.stage).toBe('RAW');
    expect(status.isReadyForHandoff).toBe(false);
    expect(status.isReadyForPublish).toBe(false);
  });

  it('resolves IN_PROCESSING stage when work orders are active', () => {
    const jobs: ProcessingJobRecord[] = [
      { id: 'j1', subgrid: 'SG01', job_type: 'STITCH', status: 'IN_PROGRESS' }
    ];
    const status = resolveSubgridLifecycle({ subgrid: 'SG01', jobs });
    expect(status.stage).toBe('IN_PROCESSING');
    expect(status.activeJob?.job_type).toBe('STITCH');
  });

  it('resolves PROCESSED stage when Station 4 is complete but not yet QA approved', () => {
    const datasets: DatasetRecord[] = [
      { id: 'p1', subgrid: 'SG01', dataset_type: 'PROCESSED', pipeline_stage: 'MASK', name: 'Processed SG01', version: 1 }
    ];
    const status = resolveSubgridLifecycle({ subgrid: 'SG01', datasets });
    expect(status.stage).toBe('PROCESSED');
    expect(status.isReadyForHandoff).toBe(false);
  });

  it('resolves DELIVERABLE stage when QA approves and flags as ready for handoff', () => {
    const datasets: DatasetRecord[] = [
      { id: 'd1', subgrid: 'SG01', dataset_type: 'DELIVERABLE', pipeline_stage: 'QAQC', name: 'Deliverable SG01', version: 1, file_count: 500 }
    ];
    const status = resolveSubgridLifecycle({
      subgrid: 'SG01',
      datasets,
      publishedCountsBySubgrid: new Map([['SG01', 0]])
    });
    expect(status.stage).toBe('DELIVERABLE');
    expect(status.isReadyForHandoff).toBe(true);
    expect(status.isReadyForPublish).toBe(false);
  });

  it('resolves STAGED stage when CSV trajectory is ingested in Data Management', () => {
    const datasets: DatasetRecord[] = [
      { id: 'd1', subgrid: 'SG01', dataset_type: 'DELIVERABLE', pipeline_stage: 'QAQC', name: 'Deliverable SG01', version: 1 }
    ];
    const stagingAggregates = [
      { id: 'stg1', subgrid: 'SG01', frames: 500, statuses: {} }
    ];
    const status = resolveSubgridLifecycle({
      subgrid: 'SG01',
      datasets,
      stagingAggregates,
      publishedCountsBySubgrid: new Map([['SG01', 0]])
    });
    expect(status.stage).toBe('STAGED');
    expect(status.isReadyForPublish).toBe(true);
    expect(status.handoffGuidance.csvReady).toBe(true);
  });

  it('resolves PUBLISHED stage when published points are active in PostGIS database', () => {
    const datasets: DatasetRecord[] = [
      { id: 'd1', subgrid: 'SG01', dataset_type: 'DELIVERABLE', pipeline_stage: 'QAQC', name: 'Deliverable SG01', version: 1 }
    ];
    const status = resolveSubgridLifecycle({
      subgrid: 'SG01',
      datasets,
      publishedCountsBySubgrid: new Map([['SG01', 500]])
    });
    expect(status.stage).toBe('PUBLISHED');
    expect(status.publishedPoints).toBe(500);
    expect(status.isReadyForHandoff).toBe(false);
  });

  it('generates multi-threaded rclone sync script for Cloudflare R2 bucket', () => {
    const script = generateUploadScript('SG01', 'D:/NAS/DELIVERABLES/SG01', 'r2', 'mms-pic');
    expect(script).toContain('rclone copy "D:/NAS/DELIVERABLES/SG01" r2:mms-pic/SG01');
    expect(script).toContain('--transfers 16');
  });

  it('generates AWS S3 sync script', () => {
    const script = generateUploadScript('SG01', 'D:/NAS/DELIVERABLES/SG01', 's3', 'mms-pic');
    expect(script).toContain('aws s3 sync "D:/NAS/DELIVERABLES/SG01" s3://mms-pic/SG01');
  });
});
