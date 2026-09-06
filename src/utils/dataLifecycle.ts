// =====================================================================
// Unified Data Lifecycle Taxonomy & WebGIS Handoff Engine
// Resolves the 6-stage lifecycle for every dataset and subgrid:
// RAW → IN_PROCESSING → PROCESSED → DELIVERABLE → STAGED → PUBLISHED
// Provides direct handoff commands, bucket verification, and guidance.
// =====================================================================

import type { DatasetRecord, ProcessingJobRecord } from '../types/production';
import type { StagingAggregate } from './datasetLineage';
import { extractCanonicalSubgrid } from './datasetLineage';

export type LifecycleStageKey =
  | 'RAW'
  | 'IN_PROCESSING'
  | 'PROCESSED'
  | 'DELIVERABLE'
  | 'STAGED'
  | 'PUBLISHED';

export interface LifecycleStageMeta {
  key: LifecycleStageKey;
  label: string;
  shortLabel: string;
  description: string;
  storageLocation: string;
  color: {
    bg: string;
    text: string;
    border: string;
    badgeClass: string;
    dotColor: string;
  };
  nextStep: string;
}

export const LIFECYCLE_STAGES: Record<LifecycleStageKey, LifecycleStageMeta> = {
  RAW: {
    key: 'RAW',
    label: '1. Raw Survey Intake',
    shortLabel: 'RAW',
    description: 'Fresh survey drive data from MMS vehicle. Unstitched camera files on local NAS.',
    storageLocation: 'NAS: /RAW/{subgrid}/',
    color: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/30',
      badgeClass: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
      dotColor: 'bg-amber-400'
    },
    nextStep: 'Queue Station 1 (PTGui Stitching) in Processing Center'
  },
  IN_PROCESSING: {
    key: 'IN_PROCESSING',
    label: '2. In Workstation Pipeline',
    shortLabel: 'IN PROGRESS',
    description: 'Actively processing through 4 workstation stations (Stitch, Blur, Enhance, Mask).',
    storageLocation: 'NAS: /STITCHED, /BLURRED, /ENHANCED',
    color: {
      bg: 'bg-orange-500/10',
      text: 'text-orange-400',
      border: 'border-orange-500/30',
      badgeClass: 'bg-orange-500/15 text-orange-300 border border-orange-500/30',
      dotColor: 'bg-orange-400'
    },
    nextStep: 'Advance through active station to Station 4 (Photoshop Masking)'
  },
  PROCESSED: {
    key: 'PROCESSED',
    label: '3. Final Processed (Pending QA)',
    shortLabel: 'PROCESSED',
    description: 'Station 4 (Masking) finished. Ready for inspection in QA Consult.',
    storageLocation: 'NAS: /MASKED/{subgrid}/ or /PROCESSED/{subgrid}/',
    color: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/30',
      badgeClass: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
      dotColor: 'bg-blue-400'
    },
    nextStep: 'QC Lead review in QA Consult (Approve to promote to Deliverable)'
  },
  DELIVERABLE: {
    key: 'DELIVERABLE',
    label: '4. QA Approved Deliverable',
    shortLabel: 'DELIVERABLE',
    description: 'QA/QC Lead Approved. Production master verified. Ready for WebGIS handoff.',
    storageLocation: 'NAS: /DELIVERABLES/{subgrid}/',
    color: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/30',
      badgeClass: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
      dotColor: 'bg-emerald-400'
    },
    nextStep: 'Sync images to Cloud Bucket & Ingest CSV in Data Management'
  },
  STAGED: {
    key: 'STAGED',
    label: '5. Staged in WebGIS (Pre-Publish)',
    shortLabel: 'STAGED',
    description: 'Images in Cloud Bucket + Trajectory CSV loaded in Data Management. Verified.',
    storageLocation: 'Cloud Storage Bucket + Staging DB',
    color: {
      bg: 'bg-purple-500/10',
      text: 'text-purple-400',
      border: 'border-purple-500/30',
      badgeClass: 'bg-purple-500/15 text-purple-300 border border-purple-500/30',
      dotColor: 'bg-purple-400'
    },
    nextStep: 'Review map coordinates in Data Management and click "Publish to WebGIS"'
  },
  PUBLISHED: {
    key: 'PUBLISHED',
    label: '6. Live on WebGIS Map',
    shortLabel: 'LIVE / PUBLISHED',
    description: 'Live in PostGIS database. Active on interactive Map, Road Analysis, and Reports.',
    storageLocation: 'PostGIS panoramas + Cloud CDN Bucket',
    color: {
      bg: 'bg-cyan-500/10',
      text: 'text-cyan-400',
      border: 'border-cyan-500/30',
      badgeClass: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30',
      dotColor: 'bg-cyan-400'
    },
    nextStep: 'Fully published and operational in WebGIS workspace'
  }
};

export interface SubgridLifecycleStatus {
  subgrid: string;
  stage: LifecycleStageKey;
  stageMeta: LifecycleStageMeta;
  activeJob?: ProcessingJobRecord;
  deliverableDataset?: DatasetRecord;
  processedDataset?: DatasetRecord;
  rawDataset?: DatasetRecord;
  rawFrames: number;
  bucketImages: number;
  publishedPoints: number;
  isReadyForHandoff: boolean;
  isReadyForPublish: boolean;
  handoffGuidance: {
    nasFolder: string;
    bucketTarget: string;
    scriptRecommendation: string;
    csvReady: boolean;
  };
}

/**
 * Deterministically computes the full lifecycle state for a given subgrid.
 */
export function resolveSubgridLifecycle(params: {
  subgrid: string;
  datasets?: DatasetRecord[];
  jobs?: ProcessingJobRecord[];
  stagingAggregates?: StagingAggregate[];
  publishedCountsBySubgrid?: Map<string, number> | Record<string, number>;
  bucketCountsBySubgrid?: Map<string, number> | Record<string, number>;
}): SubgridLifecycleStatus {
  const normSg = extractCanonicalSubgrid(params.subgrid) || params.subgrid.toUpperCase().trim();
  const ds = params.datasets || [];
  const jb = params.jobs || [];
  const stg = params.stagingAggregates || [];

  const subgridDatasets = ds.filter(
    (d) => extractCanonicalSubgrid(d.subgrid) === normSg && !d.superseded_by
  );
  const subgridJobs = jb.filter(
    (j) => extractCanonicalSubgrid(j.subgrid) === normSg
  );
  const stagingAgg = stg.find(
    (s) => extractCanonicalSubgrid(s.subgrid) === normSg
  );

  const getPublishedCount = (): number => {
    if (!params.publishedCountsBySubgrid) return 0;
    if (params.publishedCountsBySubgrid instanceof Map) {
      return params.publishedCountsBySubgrid.get(normSg) || 0;
    }
    return (params.publishedCountsBySubgrid as Record<string, number>)[normSg] || 0;
  };

  const getBucketCount = (): number => {
    if (!params.bucketCountsBySubgrid) return 0;
    if (params.bucketCountsBySubgrid instanceof Map) {
      return params.bucketCountsBySubgrid.get(normSg) || 0;
    }
    return (params.bucketCountsBySubgrid as Record<string, number>)[normSg] || 0;
  };

  const publishedPoints = getPublishedCount();
  const bucketImages = getBucketCount();
  const rawFrames = stagingAgg?.frames || 0;

  const deliverable = subgridDatasets.find((d) => d.dataset_type === 'DELIVERABLE');
  const processed = subgridDatasets.find((d) => d.dataset_type === 'PROCESSED');
  const raw = subgridDatasets.find((d) => d.dataset_type === 'RAW');

  const activeJob = subgridJobs.find((j) => j.status === 'IN_PROGRESS' || j.status === 'QUEUED')
    || subgridJobs.find((j) => j.status === 'QA_PENDING' || j.status === 'REVIEW_REQUIRED');

  let stage: LifecycleStageKey = 'RAW';

  if (publishedPoints > 0) {
    stage = 'PUBLISHED';
  } else if (stagingAgg && stagingAgg.frames > 0) {
    stage = 'STAGED';
  } else if (deliverable) {
    stage = 'DELIVERABLE';
  } else if (processed || subgridJobs.some((j) => j.qa_decision === 'APPROVED')) {
    stage = 'PROCESSED';
  } else if (subgridJobs.length > 0 || anyInProcessing(subgridJobs)) {
    stage = 'IN_PROCESSING';
  } else if (raw) {
    stage = 'RAW';
  }

  const isReadyForHandoff = stage === 'DELIVERABLE' && publishedPoints === 0;
  const isReadyForPublish = stage === 'STAGED' && publishedPoints === 0;

  const nasFolder = deliverable?.output_folder || deliverable?.source_folder
    || processed?.output_folder || `/DELIVERABLES/${normSg}/`;

  return {
    subgrid: normSg,
    stage,
    stageMeta: LIFECYCLE_STAGES[stage],
    activeJob,
    deliverableDataset: deliverable,
    processedDataset: processed,
    rawDataset: raw,
    rawFrames,
    bucketImages,
    publishedPoints,
    isReadyForHandoff,
    isReadyForPublish,
    handoffGuidance: {
      nasFolder,
      bucketTarget: `MMS_PIC/${normSg}/`,
      scriptRecommendation: generateUploadScript(normSg, nasFolder, 'r2'),
      csvReady: Boolean(stagingAgg && stagingAgg.frames > 0)
    }
  };
}

function anyInProcessing(jobs: ProcessingJobRecord[]): boolean {
  return jobs.some(
    (j) => j.status === 'IN_PROGRESS' || j.status === 'QUEUED' || j.status === 'REVIEW_REQUIRED'
  );
}

/**
 * Generate a pre-populated sync command for operators to copy & paste into terminal.
 */
export function generateUploadScript(
  subgrid: string,
  localFolder: string,
  targetType: 'r2' | 's3' | 'supabase' = 'r2',
  bucketName: string = 'mms-pic'
): string {
  const cleanSub = subgrid.toUpperCase().trim();
  const folder = localFolder || `D:/NAS/DELIVERABLES/${cleanSub}`;

  if (targetType === 'r2') {
    return `# Cloudflare R2 Upload (Multi-threaded & Zero Egress)
rclone copy "${folder}" r2:${bucketName}/${cleanSub} --transfers 16 --checkers 16 -P --fast-list`;
  }

  if (targetType === 's3') {
    return `# AWS / MinIO S3 Sync
aws s3 sync "${folder}" s3://${bucketName}/${cleanSub} --exact-timestamps --storage-class STANDARD`;
  }

  return `# Supabase Storage API Upload
python scripts/upload_supabase.py --folder "${folder}" --subgrid "${cleanSub}" --bucket "${bucketName}"`;
}
