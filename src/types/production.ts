// =====================================================================
// Production Pipeline Types — Image Production Workspace + NAS GPU Worker
// Dashboard stores metadata only; all image content lives on NAS folders.
// =====================================================================

export type DatasetType = 'RAW' | 'PROCESSED' | 'DELIVERABLE';
export type PipelineStage = 'STITCH' | 'BLUR' | 'ENHANCE' | 'MASK' | 'QAQC';
export type DatasetStatus =
  | 'REGISTERED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'IMPORTED'
  | 'ARCHIVED';

export type ProcessingJobType =
  | 'ENHANCE'
  | 'MASK'
  | 'STITCH'
  | 'BLUR'
  | 'QAQC'
  | 'REPORT'
  | 'EXPORT'
  | 'AI_DETECT';

export type ProcessingJobStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'IMPORTED'
  | 'QA_PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVIEW_REQUIRED'
  | 'CANCELLED';

export interface DatasetRecord {
  id?: string;
  dataset_type: DatasetType;
  pipeline_stage: PipelineStage;
  name: string;
  subgrid?: string;
  provider?: string;
  software_version?: string;
  source_folder?: string;
  output_folder?: string;
  storage_provider?: string;
  file_count?: number;
  size_bytes?: number;
  status?: DatasetStatus;
  version?: number;
  parent_dataset_id?: string | null;
  /** Id of the dataset that superseded (replaced) this one. Set when a newer version is created. */
  superseded_by?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  /** Runtime-only pipeline stage association (not persisted). */
  pipeline_stage_key?: PipelineStageKey;
}

export interface ProcessingJobRecord {
  id?: string;
  job_type: ProcessingJobType;
  name?: string;
  source_dataset_id?: string | null;
  output_dataset_id?: string | null;
  source_folder?: string;
  output_folder?: string;
  subgrid?: string;
  provider?: string;
  software_version?: string;
  status?: ProcessingJobStatus;
  progress?: number;
  total_items?: number;
  completed_items?: number;
  current_item?: string;
  error_count?: number;
  operator?: string;
  notes?: string;
  settings?: ProductionJobSettings;
  assigned_to?: string;
  external_status?: ExternalJobStatus;
  launch_command?: string;
  qa_decision?: 'APPROVED' | 'REJECTED' | null;
  qa_notes?: string;
  qa_by?: string;
  qa_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  // ---- Phase 1 runtime-only operational fields (no dedicated DB columns) ----
  skipped_items?: number;
  failed_items?: string[];
  failure_reason?: string;
  error_log?: Array<{ at: string; message: string }>;
  priority?: number;
  retry_of?: string;
  retry_count?: number;
  from_retry?: boolean;
  worker?: string;
  last_heartbeat?: string | null;
  /** Runtime-only pipeline stage association (not persisted). */
  pipeline_stage_key?: PipelineStageKey;
}

export type ExternalJobStatus = 'none' | 'awaiting_submit' | 'running_external' | 'done';

export type ProcessingCenterTab = 'board' | 'handoff' | 'qa' | 'capacity';

export type LineageTab = 'graph' | 'trace' | 'survey' | 'registry';

// ---------------------------------------------------------------------
// Dynamic Processing Pipeline (Phase 1)
// The 9 project-level stages are derived from real jobs/datasets/staging
// state — never hardcoded. Runtime-only; no dedicated DB columns.
// ---------------------------------------------------------------------
export type PipelineStageStatus =
  | 'WAITING'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'FAILED'
  | 'N/A';

export type PipelineStageKey =
  | 'ingestion'
  | 'image_validation'
  | 'stitching'
  | 'privacy_blur'
  | 'metadata_validation'
  | 'data_staging' // csvpanotrack -> staging_panoramas
  | 'qaqc'
  | 'publish'
  | 'final_export';

export interface PipelineStageResult {
  key: PipelineStageKey;
  labelKey: string;
  status: PipelineStageStatus;
  pct?: number;
  note?: string;
}

export interface EnhancementParams {
  brightness: number; //  -100 .. 100
  contrast: number; //    -100 .. 100
  exposure: number; //    -100 .. 100
  sharpness: number; //   0 .. 100
  saturation: number; //  -100 .. 100
  denoise: number; //     0 .. 100
}

export const DEFAULT_ENHANCEMENT_PARAMS: EnhancementParams = {
  brightness: 0,
  contrast: 0,
  exposure: 0,
  sharpness: 0,
  saturation: 0,
  denoise: 0
};

export interface MaskFootprint {
  detected: boolean;
  // Detected footprint bounding band on an equirectangular source:
  // bottomBandHeight is fraction (0..1) of image height covered by mask band.
  bottomBandHeight: number;
  // Rough fraction (0..1) of pixels inside the band judged as mask (dark).
  maskRatio: number;
  confidence: number; // 0..1
  maskB64?: string; // optional client-side mask JPEG/PNG dataURL override
  annotationPolygon?: Array<[number, number]>; // optional manual polygon
}

export interface ProductionJobSettings {
  apiMode?: 'mock' | 'http';
  concurrency?: number;
  enhance?: EnhancementParams;
  mask?: {
    detectAutomatically?: boolean;
    bottomBandHeight?: number;
    annotationPolygon?: Array<[number, number]>;
    maskB64?: string;
    fillModel?: 'lama' | 'zits';
  };
  blur?: {
    detectFaces?: boolean;
    detectPlates?: boolean;
    blurStrength?: number;
    boxMargin?: number;
    fullFrameBlur?: number;
    /** BLUR jobs scan the whole source tree (raw date/camera folders) recursively. */
    recurse?: boolean;
  };
  exportFormat?: 'original' | 'jpeg';
  jpegQuality?: number; // 0..100
}

export interface ProductionProviderSettings {
  name: string;
  software: string;
  version: string;
  workerUrl?: string; // optional per-provider NAS GPU Worker endpoint
  enabled: boolean;
}

export type ProcessingEngineMode = 'gpu_worker' | 'multi_pc_workstations';

export type WorkstationStationId = 'stitch' | 'blur' | 'lightroom' | 'photoshop';

export interface WorkstationStationConfig {
  id: WorkstationStationId;
  name: string;
  stepNumber: number;
  software: string;
  defaultOperator: string;
  sourceFolderTemplate: string;
  outputFolderTemplate: string;
  description: string;
  iconName?: string;
  enabled: boolean;
  ipAddress?: string;
  port?: number;
  lastHeartbeat?: string;
  isOnline?: boolean;
  latencyMs?: number;
}

export const DEFAULT_4_WORKSTATIONS: WorkstationStationConfig[] = [
  {
    id: 'blur',
    name: 'PC 1 — Privacy Blur Station',
    stepNumber: 1,
    ipAddress: '192.168.1.101',
    software: 'Privacy Keeper / Face & Plate Blur',
    defaultOperator: 'Blurring Operator',
    sourceFolderTemplate: '/RAW/{subgrid}/',
    outputFolderTemplate: '/BLURRED/{subgrid}/',
    description: 'Detects and blurs pedestrian faces and license plates on the raw frames before stitching.',
    enabled: true
  },
  {
    id: 'stitch',
    name: 'PC 2 — Stitching Station',
    stepNumber: 2,
    ipAddress: '192.168.1.102',
    software: 'Creator 6 / PTGui / Insta360 Stitcher',
    defaultOperator: 'Stitching Operator',
    sourceFolderTemplate: '/BLURRED/{subgrid}/',
    outputFolderTemplate: '/STITCHED/{subgrid}/',
    description: 'Stitches the blurred six-camera frames into 360° equirectangular panoramas.',
    enabled: true
  },
  {
    id: 'lightroom',
    name: 'PC 3 — Lightroom Station',
    stepNumber: 3,
    ipAddress: '192.168.1.103',
    software: 'Adobe Lightroom Classic / Camera RAW',
    defaultOperator: 'Colorist Operator',
    sourceFolderTemplate: '/STITCHED/{subgrid}/',
    outputFolderTemplate: '/ENHANCED/{subgrid}/',
    description: 'Applies bulk color grading, shadow recovery, clarity, and sharpness presets.',
    enabled: true
  },
  {
    id: 'photoshop',
    name: 'PC 4 — Photoshop Station',
    stepNumber: 4,
    ipAddress: '192.168.1.104',
    software: 'Adobe Photoshop (Batch Actions)',
    defaultOperator: 'Retouch Operator',
    sourceFolderTemplate: '/ENHANCED/{subgrid}/',
    outputFolderTemplate: '/PROCESSED/{subgrid}/',
    description: 'Applies circular nadir hood mask or generative inpaint to remove the vehicle, plus watermark.',
    enabled: true
  }
];

export interface NasFolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  fileCount?: number;
  sizeBytes?: number;
}

export interface NasFolderListing {
  path: string;
  entries: NasFolderEntry[];
  fileCount: number;
  sizeBytes: number;
  error?: string;
}

export interface StorageTopLevelUsage {
  name: string;
  files: number;
  bytes: number;
  folders: number;
}

export interface StorageInfo {
  base_path: string;
  total: number;
  used: number;
  free: number;
  files: number;
  folders: number;
  per_top_level: StorageTopLevelUsage[];
  source: 'worker' | 'mock';
  error?: string;
}

export interface WorkerHealthInfo {
  status: string;
  jobs_active: number;
  nas_base: string;
}

export interface ProductionApiSettings {
  mode: 'mock' | 'http';
  baseUrl: string;
  concurrency: number;
  nasWorkBasePath: string;
  apiKey?: string;
}

export interface ProcessedOutputValidationResult {
  ok: boolean;
  expectedCount: number;
  foundCount: number;
  validCount: number;
  invalid: string[];
  missing: string[];
  totalSizeBytes: number;
  issues: string[];
  duplicates?: string[];
  gpsIssues?: string[];
  timestampIssues?: string[];
  metadataIssues?: string[];
}

export type ProductionTab =
  | 'pipeline'
  | 'datasets'
  | 'providers'
  | 'preview'
  | 'enhance'
  | 'masking';

export type StorageTab =
  | 'overview'
  | 'browser'
  | 'rawregistry'
  | 'validation'
  | 'index';