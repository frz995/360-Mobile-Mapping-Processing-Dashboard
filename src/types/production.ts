// =====================================================================
// Production Pipeline Types — Image Production Workspace + NAS GPU Worker
// Dashboard stores metadata only; all image content lives on NAS folders.
// =====================================================================

type DatasetType = 'RAW' | 'PROCESSED' | 'DELIVERABLE';
type PipelineStage = 'STITCH' | 'BLUR' | 'ENHANCE' | 'MASK' | 'QAQC';
type DatasetStatus =
  | 'REGISTERED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'IMPORTED'
  | 'ARCHIVED';

type ProcessingJobType =
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
  project_id?: string;
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
  production_run_id?: string | null;
  production_attempt_id?: string | null;
  production_release_id?: string | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  /** Runtime-only pipeline stage association (not persisted). */
  pipeline_stage_key?: PipelineStageKey;
}

export interface ProcessingJobRecord {
  id?: string;
  project_id?: string;
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
  production_run_id?: string | null;
  production_attempt_id?: string | null;
  /** Runtime-only pipeline stage association (not persisted). */
  pipeline_stage_key?: PipelineStageKey;
}

type ExternalJobStatus = 'none' | 'awaiting_submit' | 'running_external' | 'done';

type ProductionAttemptStatus = 'ACTIVE' | 'PROCESSING' | 'QA_PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';
export type ProductionReleaseStatus = 'PREPARING' | 'READY' | 'PUBLISHED' | 'FAILED' | 'ARCHIVED';

export interface ProductionAttemptRecord {
  id?: string;
  project_id?: string;
  production_run_id: string;
  attempt_number: number;
  status: ProductionAttemptStatus;
  source_dataset_id?: string | null;
  output_dataset_id?: string | null;
  processing_job_id?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProductionReleaseRecord {
  id?: string;
  project_id?: string;
  production_run_id: string;
  attempt_id: string;
  release_code: string;
  subgrid: string;
  status: ProductionReleaseStatus;
  is_active: boolean;
  source_folder: string;
  release_folder: string;
  manifest_path: string;
  file_count: number;
  total_size_bytes: number;
  metadata?: Record<string, unknown>;
  generated_at?: string | null;
  published_at?: string | null;
  published_by?: string | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

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
  label: string;
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

interface ProductionJobSettings {
  apiMode?: 'http';
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

export type WorkstationStationId = 'stitch' | 'blur' | 'lightroom' | 'photoshop';

type StationRemoteChannel = 'rdp' | 'vnc';

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
  /** Lower-case substrings the station agent matches work processes against
   * (authoritative list lives in each PC's station-agent/.env). */
  processNames?: string[];
  /** Optional shared secret for agent probes (station agent AGENT_TOKEN). */
  agentToken?: string;
  ipAddress?: string;
  port?: number;
  /** Microsoft RDP port for one-click mstsc launch (default 3389). */
  rdpPort?: number;
  /** Optional noVNC/websockify port for the in-browser live desktop pane. */
  vncPort?: number;
  /** Optional HTTPS noVNC URL (Cloudflare Tunnel) for the live desktop pane.
   * Supports `{ip}` and `{port}` placeholders. Required on HTTPS deployments
   * because browsers block a private http:// VNC iframe (mixed content). */
  remoteUrl?: string;
  /** Which remote channel the quad view uses for this station. */
  remoteChannel?: StationRemoteChannel;
  lastHeartbeat?: string;
  isOnline?: boolean;
  latencyMs?: number;
  cpuUsage?: number;
  gpuUsage?: number;
  gpuName?: string;
  ramTotalGb?: number;
  ramUsedGb?: number;
  storageUsedPct?: number;
}

/** Production topology template for the four processing PCs.
 *
 * This carries only the real process flow (order, software, NAS stage
 * folders). Network addresses, ports and remote URLs are deliberately absent:
 * they are per-site facts an operator must set in Providers, and shipping
 * invented values made the dashboard dial addresses that do not exist. Until
 * a station is configured it reports itself as unconfigured. */
export const DEFAULT_4_WORKSTATIONS: WorkstationStationConfig[] = [
  {
    id: 'blur',
    name: 'PC 1 — Privacy Blur Station',
    stepNumber: 1,
    software: 'Privacy Keeper / Face & Plate Blur',
    defaultOperator: 'Multi-PC',
    sourceFolderTemplate: '/00_Raw_data/{subgrid}/',
    outputFolderTemplate: '/02_Blurring/{subgrid}/',
    description: 'Detects and blurs pedestrian faces and license plates on the raw frames before stitching.',
    enabled: true
  },
  {
    id: 'stitch',
    name: 'PC 2 — Stitching Station',
    stepNumber: 2,
    software: 'Creator 6 / PTGui / Insta360 Stitcher',
    defaultOperator: 'Multi-PC',
    sourceFolderTemplate: '/02_Blurring/{subgrid}/',
    outputFolderTemplate: '/03_Stitching/{subgrid}/',
    description: 'Stitches the blurred six-camera frames into 360° equirectangular panoramas.',
    enabled: true
  },
  {
    id: 'lightroom',
    name: 'PC 3 — Lightroom Station',
    stepNumber: 3,
    software: 'Adobe Lightroom Classic / Camera RAW',
    defaultOperator: 'Multi-PC',
    sourceFolderTemplate: '/03_Stitching/{subgrid}/',
    outputFolderTemplate: '/04_Enhanced/{subgrid}/',
    description: 'Applies bulk color grading, shadow recovery, clarity, and sharpness presets.',
    enabled: true
  },
  {
    id: 'photoshop',
    name: 'PC 4 — Photoshop Station',
    stepNumber: 4,
    software: 'Adobe Photoshop (Batch Actions)',
    defaultOperator: 'Multi-PC',
    sourceFolderTemplate: '/04_Enhanced/{subgrid}/',
    outputFolderTemplate: '/05_Final/{subgrid}/',
    description: 'Applies circular nadir hood mask or generative inpaint to remove the vehicle, plus watermark.',
    enabled: true
  }
];

// ---------------------------------------------------------------------
// Station agent telemetry (4-PC Multi-Station Flight Board auto mode)
// Matches the station-agent/app.py wire contract (station-agent/README.md).
// ---------------------------------------------------------------------
interface StationAgentProcessInfo {
  name: string;
  pid?: number;
  /** psutil process create_time — the true task start moment. */
  started_at?: string | null;
}

interface StationAgentOutputSubgrid {
  files: number;
  last_write_at?: string | null;
  /** A file landed within the agent's growing window (live activity). */
  growing?: boolean;
}

interface StationAgentPointsSubgrid {
  points_total?: number;
  points_done?: number;
  tiles_done?: number;
}

export interface StationAgentReport {
  agent_version?: string;
  station_id: WorkstationStationId;
  hostname?: string;
  generated_at?: string;
  watch_error?: string | null;
  task?: {
    started: boolean;
    processes?: StationAgentProcessInfo[];
    first_started_at?: string | null;
  };
  output?: {
    root?: string;
    stage?: string;
    subgrids?: Record<string, StationAgentOutputSubgrid>;
  };
  /** Capture-point progress for tile-rig stations (POINT_MODE, default blur). */
  points?: {
    stage_in?: string;
    point_mode?: boolean;
    subgrids?: Record<string, StationAgentPointsSubgrid>;
    error?: string | null;
  };
}

export interface StationAgentObservation {
  stationId: WorkstationStationId;
  online: boolean;
  lastProbeAt?: string;
  health?: WorkerHealthInfo | null;
  report?: StationAgentReport | null;
  /** Why this station is offline. Absent when online. */
  reason?: import('../config/transport').StationAgentOfflineReason;
  error?: string;
}

export type StationBoardStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'FLAGGED';

export type StationBoardSource = 'agent' | 'snapshot' | 'none';

/** Unit behind the Done/Total counters: stitched frames (default) or capture
 * points (tile-rig stations like PC 1 blur, POINT_MODE). */
export type StationBoardMetricUnit = 'frames' | 'points';

/** Board state for one (project, subgrid, station), persisted so the
 * board survives refresh and shares one state across operator browsers. */
export interface StationBoardRow {
  id?: string;
  project_id?: string | null;
  subgrid: string;
  station_id: WorkstationStationId;
  status: StationBoardStatus;
  total_frames?: number | null;
  completed_frames?: number | null;
  metric_unit?: StationBoardMetricUnit | null;
  started_at?: string | null;
  completed_at?: string | null;
  source?: string;
  note?: string | null;
  last_agent_pulse?: string | null;
  updated_by?: string | null;
  updated_at?: string;
}

// ---------------------------------------------------------------------
// Stage event ledger — append-only history for the Production Hub
// pipeline (intake → blur → stitch → lightroom → photoshop → qa →
// bucket → publish). Written by the browser on real stage transitions.
// ---------------------------------------------------------------------
export type StageLedgerStage =
  | 'intake' | 'blur' | 'stitch' | 'lightroom' | 'photoshop'
  | 'qa' | 'bucket' | 'publish';

export type StageLedgerEvent =
  | 'STARTED' | 'PROGRESS' | 'COMPLETED' | 'FLAGGED' | 'PUBLISHED'
  | 'AGENT_ONLINE' | 'AGENT_OFFLINE';

type StageLedgerVia = 'agent' | 'operator' | 'system';

export interface StageEventLedgerRow {
  id?: string;
  project_id?: string | null;
  subgrid: string;
  stage: StageLedgerStage;
  event: StageLedgerEvent;
  /** Business time: agent process start / file mtime / operator action time. */
  occurrence?: string;
  recorded_at?: string;
  via?: StageLedgerVia;
  detail?: string | null;
  counts?: Record<string, unknown> | null;
  updated_by?: string | null;
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

interface StorageTopLevelUsage {
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
  source: 'worker';
  error?: string;
}

/** Liveness probe for a worker (`GET /health`) or a station agent
 *  (`GET /api/station`). The optional telemetry fields are only ever populated by
 *  the station agent — the worker reports status and NAS mount only. */
export interface WorkerHealthInfo {
  status: string;
  nas_base: string;
  agent_version?: string;
  cpu_usage?: number;
  cpu_cores?: number;
  /** Optional per-core CPU belt (0-100 each, capped at 24 cores). */
  cpu_percpu?: number[];
  gpu_usage?: number;
  gpu_name?: string;
  gpu_vram_total_gb?: number;
  gpu_vram_used_gb?: number;
  ram_total_gb?: number;
  ram_used_gb?: number;
  storage_used_pct?: number;
  /** Agent disk readout (GB) of the watched volume / system disk. */
  disk_total?: number;
  disk_free_gb?: number;
  hostname?: string;
  uptime_sec?: number;
}

export interface ProductionApiSettings {
  mode: 'http';
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

export type StorageTab =
  | 'overview'
  | 'browser'
  | 'rawregistry'
  | 'validation'
  | 'index';