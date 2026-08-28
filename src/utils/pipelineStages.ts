// =====================================================================
// Dynamic Processing Pipeline (Phase 1)
// Computes the 9 project-level pipeline stages entirely from real
// dataset / processing-job / QA / staging state. No status is hardcoded:
// every stage is derived from the input collections on each call.
//
// Stages (per product):
// 1 Data Ingestion         <- RAW datasets registered
// 2 Image Validation       <- RAW/processed datasets present, none failed
// 3 External Stitching     <- STITCH jobs/datasets
// 4 External Privacy Blur  <- BLUR jobs/datasets (partial = progress %)
// 5 Metadata Validation    <- PROCESSED datasets imported
// 6 DataStaging (csvpanotrack) <- staging_panoramas aggregates
// 7 QA/QC                  <- QA_PENDING / APPROVED / REJECTED job state
// 8 Publish                <- DELIVERABLE datasets present
// 9 Final Export           <- EXPORT/REPORT jobs completed + DELIVERABLE
// =====================================================================

import type {
  DatasetRecord,
  PipelineStageKey,
  PipelineStageResult,
  PipelineStageStatus,
  ProcessingJobRecord
} from '../types/production';
import type { StagingAggregate } from './datasetLineage';

export interface PipelineStageCtx {
  jobs: ProcessingJobRecord[];
  datasets: DatasetRecord[];
  stagingAggregates: StagingAggregate[];
}

export interface PipelineStageDef {
  key: PipelineStageKey;
  labelKey: string;
  hint?: string;
  jobTypes?: readonly string[];
  derive: (ctx: PipelineStageCtx) => { status: PipelineStageStatus; pct?: number; note?: string };
}

function anyJob(
  jobs: ProcessingJobRecord[],
  types: readonly string[],
  status?: string
): boolean {
  return jobs.some((j) => types.includes(j.job_type) && (!status || j.status === status));
}

function anyDataset(datasets: DatasetRecord[], type: string): boolean {
  // Superseded (older-version) datasets are not live, so they do not satisfy
  // publish/export stage conditions.
  return datasets.some((d) => d.dataset_type === type && !d.superseded_by);
}

function stagingPublished(aggregates: StagingAggregate[], datasets: DatasetRecord[]): boolean {
  if (!aggregates || aggregates.length === 0) return false;
  const deliverable = new Set<string>();
  datasets.forEach((d) => {
    if (d.dataset_type === 'DELIVERABLE' && d.subgrid && !d.superseded_by)
      deliverable.add(d.subgrid.toLowerCase());
  });
  return aggregates.every((a) => deliverable.has(a.subgrid.toLowerCase()));
}

export const PIPELINE_STAGE_DEFS: PipelineStageDef[] = [
  {
    key: 'ingestion',
    labelKey: 'pipelineStageIngestion',
    hint: 'RAW datasets registered',
    derive: ({ datasets }) =>
      anyDataset(datasets, 'RAW')
        ? { status: 'COMPLETE' }
        : { status: 'WAITING' }
  },
  {
    key: 'image_validation',
    labelKey: 'pipelineStageImageValidation',
    derive: ({ datasets }) => {
      if (datasets.some((d) => d.status === 'FAILED')) return { status: 'FAILED' };
      if (datasets.length > 0) return { status: 'COMPLETE' };
      return { status: 'WAITING' };
    }
  },
  {
    key: 'stitching',
    labelKey: 'pipelineStageStitching',
    hint: 'STITCH',
    jobTypes: ['STITCH'],
    derive: ({ jobs }) => {
      if (anyJob(jobs, ['STITCH'], 'FAILED')) return { status: 'FAILED' };
      if (anyJob(jobs, ['STITCH'], 'COMPLETED')) return { status: 'COMPLETE' };
      if (anyJob(jobs, ['STITCH'])) {
        const active = jobs.find((j) => j.job_type === 'STITCH' && j.status !== 'COMPLETED');
        return { status: 'IN_PROGRESS', pct: active?.progress || 0 };
      }
      return { status: 'WAITING' };
    }
  },
  {
    key: 'privacy_blur',
    labelKey: 'pipelineStagePrivacyBlur',
    hint: 'BLUR',
    jobTypes: ['BLUR'],
    derive: ({ jobs }) => {
      if (anyJob(jobs, ['BLUR'], 'FAILED')) return { status: 'FAILED' };
      if (anyJob(jobs, ['BLUR'], 'COMPLETED')) return { status: 'COMPLETE' };
      const active = jobs.find((j) => j.job_type === 'BLUR' && j.status !== 'COMPLETED');
      if (active) return { status: 'IN_PROGRESS', pct: active.progress || 0 };
      return { status: 'WAITING' };
    }
  },
  {
    key: 'metadata_validation',
    labelKey: 'pipelineStageMetadataValidation',
    derive: ({ datasets }) =>
      datasets.some(
        (d) =>
          (d.dataset_type === 'PROCESSED' || d.dataset_type === 'DELIVERABLE') &&
          (d.status === 'READY' || d.status === 'IMPORTED' || d.status === 'COMPLETED')
      )
        ? { status: 'COMPLETE' }
        : { status: 'WAITING' }
  },
  {
    key: 'data_staging',
    labelKey: 'pipelineStageDataStaging',
    hint: 'csvpanotrack → staging_panoramas',
    derive: ({ stagingAggregates, datasets }) => {
      if (!stagingAggregates || stagingAggregates.length === 0) return { status: 'WAITING' };
      const frames = stagingAggregates.reduce((a, s) => a + (s.frames || 0), 0);
      if (stagingPublished(stagingAggregates, datasets)) {
        return { status: 'COMPLETE', note: `${frames.toLocaleString()} frames` };
      }
      return { status: 'IN_PROGRESS', note: `${frames.toLocaleString()} frames` };
    }
  },
  {
    key: 'qaqc',
    labelKey: 'pipelineStageQaqc',
    hint: 'QA_PENDING / APPROVED / REJECTED',
    jobTypes: ['QAQC'],
    derive: ({ jobs }) => {
      if (anyJob(jobs, ['QAQC'], 'REJECTED')) return { status: 'FAILED' };
      if (anyJob(jobs, ['QAQC'], 'APPROVED') || anyJob(jobs, ['QAQC'], 'COMPLETED'))
        return { status: 'COMPLETE' };
      if (anyJob(jobs, ['QAQC'])) return { status: 'IN_PROGRESS' };
      // Fall back to job-level QA state across all job types.
      if (jobs.some((j) => j.qa_decision === 'APPROVED')) return { status: 'COMPLETE' };
      if (jobs.some((j) => j.qa_decision === 'REJECTED')) return { status: 'FAILED' };
      if (jobs.some((j) => j.status === 'QA_PENDING')) return { status: 'IN_PROGRESS' };
      return { status: 'WAITING' };
    }
  },
  {
    key: 'publish',
    labelKey: 'pipelineStagePublish',
    hint: 'DELIVERABLE datasets',
    derive: ({ datasets }) =>
      anyDataset(datasets, 'DELIVERABLE') ? { status: 'COMPLETE' } : { status: 'WAITING' }
  },
  {
    key: 'final_export',
    labelKey: 'pipelineStageFinalExport',
    hint: 'EXPORT / REPORT',
    jobTypes: ['EXPORT', 'REPORT'],
    derive: ({ jobs, datasets }) => {
      const exportDone = anyJob(jobs, ['EXPORT', 'REPORT'], 'COMPLETED');
      if (exportDone && anyDataset(datasets, 'DELIVERABLE'))
        return { status: 'COMPLETE' };
      if (exportDone || anyJob(jobs, ['EXPORT', 'REPORT']))
        return { status: 'IN_PROGRESS' };
      return { status: 'WAITING' };
    }
  }
];

export function buildPipelineStages(ctx: PipelineStageCtx): PipelineStageResult[] {
  return PIPELINE_STAGE_DEFS.map((def) => {
    const r = def.derive(ctx);
    return { key: def.key, labelKey: def.labelKey, status: r.status, pct: r.pct, note: r.note };
  });
}

export function stageJobsFor(key: PipelineStageKey): readonly string[] {
  const def = PIPELINE_STAGE_DEFS.find((d) => d.key === key);
  return def?.jobTypes || [];
}
