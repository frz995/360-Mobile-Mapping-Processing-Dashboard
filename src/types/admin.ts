export type UserRole = 'Administrator' | 'Survey Operator' | 'QA Inspector' | 'Viewer';
export type UserStatus = 'Active' | 'Disabled' | 'Pending';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLogin: string;
  avatar?: string;
  createdAt: string;
  permissions?: string[];
}

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface DeletionApprovalRequest {
  id: string;
  subgrid: string;
  requestedBy: string;
  userEmail: string;
  reason: string;
  poiCount: number;
  kmProcessed: number;
  dateRequested: string;
  status: ApprovalStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  filenames?: string[];
}

export interface SystemHealthMetrics {
  postgisStatus: 'operational' | 'degraded' | 'offline';
  postgisLatencyMs: number;
  storageStatus: 'operational' | 'degraded' | 'offline';
  storageTotalFiles: number;
  realtimeStatus: 'connected' | 'connecting' | 'disconnected';
  webgisStatus: 'online' | 'degraded' | 'offline';
  memoryUsageMb: number;
  lastPingTime: string;
}

export interface ExtendedProjectSettings {
  // Database Connection & Endpoint Parameters
  supabaseUrl?: string;
  supabaseKey?: string;
  serviceRoleKey?: string;
  databaseHost?: string;
  databasePort?: number;
  databaseName?: string;
  databaseSchema?: string;
  databaseUser?: string;
  connectionMode?: 'postgrest' | 'direct_tcp' | 'realtime_ws';
  sslMode?: 'require' | 'verify-ca' | 'verify-full' | 'disable';

  // PostGIS Spatial Engine & Projections
  spatialSrid?: string; // 'EPSG:4326', 'EPSG:3375', 'EPSG:3168', 'EPSG:3857', 'EPSG:32647', 'EPSG:32648'
  geomColumnName?: string; // 'geom', 'geometry', 'the_geom', 'location'
  geomType?: string; // 'ST_Point', 'POINTZ', 'MultiPoint'
  autoCreateSpatialIndex?: boolean;

  // Production Pipeline (Image Production Workspace / NAS GPU Worker)
  productionProviders?: Array<{
    name: string;
    software: string;
    version: string;
    workerUrl?: string;
    enabled: boolean;
  }>;
  productionApiMode?: 'mock' | 'http';
  productionApiUrl?: string;
  productionConcurrency?: number; // 1 - 16
  nasWorkBasePath?: string; // NAS mount path the worker reads/writes under

  // PostGIS Table & View Mappings
  panoramasTable?: string;
  stagingTable?: string;
  subgridTable?: string;
  qaDefectsTable?: string;
  qaqcRunsTable?: string;
  auditLogsTable?: string;
  deletionRequestsTable?: string;
  notificationsTable?: string;
  userAccountsTable?: string;
  dbSummaryView?: string;

  // Performance & Query Optimization
  dbAutoSyncSec?: number; // 0, 30, 60, 300
  enableRealtimePush?: boolean;
  queryChunkSize?: number; // 25, 50, 100, 250
  poolTimeoutMs?: number;

  // Storage & MMS
  storageProvider?: 'supabase' | 'aws_s3' | 'gcs' | 'azure_blob' | 'cloudflare_r2' | 'wasabi' | 'nas_local' | 'custom_cdn';
  supabaseBucket?: string;
  s3Bucket?: string;
  s3Region?: string;
  gcsBucket?: string;
  azureAccount?: string;
  azureContainer?: string;
  r2Domain?: string;
  r2Bucket?: string;
  wasabiBucket?: string;
  wasabiRegion?: string;
  nasServerUrl?: string;
  customCdnUrl?: string;
  cloudStorageBaseUrl?: string;
  imageStorageStrategy?: 'single_equirectangular' | 'multires_tiles';
  multiResTilePattern?: string;
  multiResFallbackPattern?: string;
  multiResLevelPattern?: string;
  storageAccessPermission?: 'public_read' | 'signed_url' | 'intranet_only';
  subgridDirectoryHierarchy?: 'flat' | 'subgrid_folder' | 'daily_folder' | 'custom';
  customDirectoryHierarchy?: string;
  imageStoragePath?: string;
  imageFormatPattern?: string;
  imagePreloadCount?: number;
  defaultFov?: number;
  arrowColor?: 'sky' | 'emerald' | 'amber' | 'white';
  syncHeadingWithCar?: boolean;
  enableImagePreload?: boolean;
  fallbackPlaceholderEnabled?: boolean;

  // Security & Access Control
  requireAdminApprovalForDelete?: boolean;
  sessionTimeoutMinutes?: number; // 15, 30, 60, 240, 0 (Never)
  enforceCorporateDomain?: boolean;
  corporateDomain?: string; // e.g. '@example.com'
  twoFactorRequired?: boolean;

  // Basemap & Layer Management
  defaultBasemap?: 'esri_satellite' | 'osm_standard' | 'carto_dark' | 'carto_light' | 'google_hybrid' | 'custom_tile';
  customBasemapUrl?: string;
  basemapOpacity?: number; // 0 - 100
  publishedTrackColor?: string;
  stagingTrackColor?: string;
  defectTrackColor?: string;
  selectedTrackColor?: string;
  gridBoundaryColor?: string;
  poiTrackLineWidth?: number;
  poiMarkerRadius?: number;
  enableLayerGlow?: boolean;
  layerOpacity?: number; // 20 - 100

  // SLA & QA Benchmarks
  targetKm?: number;
  targetSubgridsCount?: number;
  maxDefectThresholdPercent?: number;
  qaFlag1?: string;
  qaFlag2?: string;
  qaFlag3?: string;
  qaFlag4?: string;
  blurVarianceThreshold?: number;
  gpsMaxJumpDistanceMeters?: number;
  glareLuminanceThreshold?: number;
  obstructionMinBrightness?: number;
  deliverableModel?: 'masked_car' | 'generative_fill';
  deduplicationStrategy?: 'clean_merge' | 'preserve_runs';
  dailyDataImportPolicy?: 'preserve_runs' | 'merge_samedate';
  autoDeduplicateSubgrids?: boolean;
  language?: 'en' | 'ms' | 'zh' | 'ja';
  defaultDataTab?: 'batches' | 'daily' | 'vector';
  dateFormat?: string;
  unitSystem?: 'metric' | 'imperial';
}

export interface QADefectRecord {
  id?: string;
  subgrid: string;
  point_id: string;
  frame_index: number;
  defect_flags: Record<string, any>;
  defect_type: string;
  pic: string;
  image_url?: string;
  lat?: number;
  lng?: number;
  bearing?: number;
  is_resolved?: boolean;
  resolved_at?: string;
  user_id?: string;
  user_email?: string;
  created_at?: string;
  updated_at?: string;
}

export interface QAQCAuditRunRecord {
  id?: string;
  subgrid: string;
  runId?: string | null;
  totalStations: number;
  defectCount: number;
  passRate: number;
  meanTenengradScore?: number;
  defectsList?: any[];
  history?: any[];
  pic?: string;
  user_id?: string;
  user_email?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface QAQCThresholds {
  blurVarianceThreshold: number;
  gpsMaxJumpDistanceMeters: number;
  obstructionMinBrightness: number;
  glareLuminanceThreshold: number;
  deliverableModel?: 'masked_car' | 'generative_fill';
}

export interface QAQCConfig {
  checkBlur: boolean;
  checkObstruction: boolean;
  checkGps: boolean;
  pic?: string;
}


