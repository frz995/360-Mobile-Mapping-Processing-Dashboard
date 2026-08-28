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
  metadata?: Record<string, unknown>;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
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
}

export type ExternalJobStatus = 'none' | 'awaiting_submit' | 'running_external' | 'done';

export type ProcessingCenterTab = 'board' | 'handoff' | 'qa' | 'capacity';

export type LineageTab = 'graph' | 'trace' | 'survey' | 'registry';

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