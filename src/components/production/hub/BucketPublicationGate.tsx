import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  RefreshCw,
  Copy,
  Check,
  Download,
  Terminal,
  ExternalLink,
  ArrowRight,
  UploadCloud,
  FileCode,
  Database,
  X,
  AlertTriangle
} from 'lucide-react';
import { SectionLabel, MetaList, TextAction, StatusDot } from '../chrome';
import { supabase } from '../../../services/supabase';
import { resolvePanoramaUrl, resolvePanoramaConfigUrl } from '../../../services/storageUrls';
import { testCloudflareStorageHealth } from '../../../services/api/storage';
import { appendStageEventToSupabase } from '../../../services/api/stageEventLedger';
import { probeStationAgent, startBucketSyncJob, pollBucketSyncJob } from '../../../services/stationAgentApi';
import { fetchDashboardApi } from '../../../services/cloudflareApi';
import type { PairedFrameRecord } from './IntakePairingStation';
import {
  STORAGE_BUCKET_DEFAULT,
  S3_BUCKET_DEFAULT,
  AZURE_CONTAINER_DEFAULT,
  REGION_DEFAULTS
} from '../../../config/defaults';
import { DEFAULT_4_WORKSTATIONS, type WorkstationStationConfig } from '../../../types/production';

export interface BucketPublicationGateProps {
  subgrid: string;
  surveyDate: string;
  totalFrames: number;
  projectSettings: any;
  onAdvanceToWebGIS: () => void;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  isGuestUser?: boolean;
  /** Paired frames (metadata names) — the one-click upload list. */
  pairedRecords?: PairedFrameRecord[];
  /** Survey run folder id (e.g. 20220904 / BP_20220630) for the final-image check. */
  surveyFolder?: string;
}

// ---------------------------------------------------------------------
// One-click image upload helpers (pure — unit-tested).
// ---------------------------------------------------------------------

/** Bucket-relative object path from the user's storage pattern. */
export function buildBucketObjectPath(pattern: string, subgrid: string, filename: string): string {
  return (pattern || '{subgrid}/{filename}')
    .replace('{subgrid}', subgrid)
    .replace('{pointFolder}', filename.replace(/\.(jpe?g|png)$/i, ''))
    .replace('{filename}', filename);
}

/** Where the final image may live on the NAS (worker /api/images rel paths),
 * tried in order: the survey run's 05_Final output → release copy → final
 * stage flat layouts. */
export function buildUploadRelCandidates(subgrid: string, folder: string, filename: string): string[] {
  const runFolder = (folder || '').trim();
  const candidates: string[] = [];
  if (runFolder && runFolder !== '__none__' && runFolder !== '__custom__') {
    candidates.push(`05_Final/Project-OUT/Grid 1/${subgrid}/${runFolder}/panoramas/${filename}`);
    candidates.push(`05_Final/Project-OUT/Grid 1/${subgrid}/${runFolder}/${filename}`);
  }
  candidates.push(`DELIVERABLES/${subgrid}/${filename}`);
  candidates.push(`05_Final/${subgrid}/${filename}`);
  return candidates;
}

export type BucketUploadMode = 'browser' | 'agent_cli' | 'unavailable';

export interface UploadModeResolution {
  mode: BucketUploadMode;
  /** Filled for 'unavailable' — shown on the disabled button. */
  reason?: string;
}

/**
 * The upload runs in the browser (supabase-js) only for the Supabase
 * provider with a single-image strategy and a worker URL to fetch the NAS
 * bytes through. Every other provider is pushed by the station agent running
 * the exact CLI the sync-script block shows (credentials never enter the
 * browser). Custom CDN has no sync CLI at all.
 */
export function resolveUploadMode(
  provider: string,
  strategy: string,
  hasWorkerUrl: boolean,
  hasAgent: boolean
): UploadModeResolution {
  if (provider === 'supabase' && strategy === 'single_equirectangular' && hasWorkerUrl) {
    return { mode: 'browser' };
  }
  if (provider === 'supabase' && strategy === 'multires_tiles' && hasAgent) {
    return { mode: 'agent_cli' };
  }
  if (provider === 'supabase') {
    if (hasAgent) return { mode: 'agent_cli' };
    return hasWorkerUrl
      ? { mode: 'unavailable', reason: 'Tile strategy pushes run via the station agent (CLI).' }
      : { mode: 'unavailable', reason: 'Set the Worker URL (Providers) to upload in-browser, or configure a station agent for the CLI push.' };
  }
  if (provider === 'custom_cdn') {
    return { mode: 'unavailable', reason: 'Custom CDN / reverse proxy has no sync CLI — deploy via your CDN pipeline.' };
  }
  if (hasAgent) return { mode: 'agent_cli' };
  return { mode: 'unavailable', reason: 'No station agent is configured (Providers → Workstations) to run the provider CLI.' };
}

export interface DetectedBucketConfig {
  provider: string;
  providerLabel: string;
  bucketName: string;
  region?: string;
  account?: string;
  container?: string;
  endpointUrl: string;
  strategy: 'single_equirectangular' | 'multires_tiles';
  strategyLabel: string;
  sampleUrl: string;
  sampleConfigUrl?: string;
  pathPattern: string;
  isCloudBucket: boolean;
  /** False when the active provider has no bucket/endpoint configured at all. */
  isConfigured: boolean;
}

/**
 * Resolves the publication target from real project settings / env only.
 * Provider-specific bucket names and endpoints are never invented: an
 * unconfigured provider resolves to empty strings plus isConfigured=false so
 * the gate can block the push instead of naming a bucket that does not exist.
 */
export function detectBucketConfig(settings: any, subgrid: string = ''): DetectedBucketConfig {
  const cleanSg = (subgrid || '').toUpperCase().trim();
  const sgSeg = cleanSg || '{subgrid}';
  const sampleFilename = cleanSg ? `${cleanSg}-0001.jpg` : '';
  const rawProvider = (settings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'supabase').toLowerCase().trim();
  const strategy = (settings?.imageStorageStrategy || 'single_equirectangular') as 'single_equirectangular' | 'multires_tiles';
  const strategyLabel = strategy === 'multires_tiles' ? 'Multi-Resolution Tile Pyramid' : 'Single Equirectangular Full Image';

  let provider = rawProvider;
  let providerLabel = 'Supabase Cloud Storage';
  let bucketName = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || STORAGE_BUCKET_DEFAULT;
  let region: string | undefined = undefined;
  let account: string | undefined = undefined;
  let container: string | undefined = undefined;
  let endpointUrl = '';
  let pathPattern = `/${bucketName}/${sgSeg}/{filename}`;
  let isCloudBucket = true;
  let isConfigured = false;

  if (rawProvider === 'cloudflare_r2' || rawProvider === 'r2') {
    provider = 'cloudflare_r2';
    providerLabel = 'Cloudflare R2 Object Storage';
    bucketName = settings?.r2Bucket || import.meta.env.VITE_R2_BUCKET || '';
    const domain = settings?.r2Domain || settings?.r2PublicDomain || import.meta.env.VITE_R2_DOMAIN || '';
    endpointUrl = domain ? (domain.startsWith('http') ? domain : `https://${domain}`) : '';
    isConfigured = Boolean(bucketName && domain);
    pathPattern = strategy === 'multires_tiles'
      ? (settings?.multiResTilePattern || 'tiles/{subgrid}/{pointFolder}/config.json')
      : (settings?.singleImagePathPattern || '{subgrid}/{filename}');
  } else if (rawProvider === 'aws_s3') {
    provider = 'aws_s3';
    providerLabel = 'Amazon Web Services (AWS S3)';
    bucketName = settings?.s3Bucket || import.meta.env.VITE_S3_BUCKET || S3_BUCKET_DEFAULT;
    region = settings?.s3Region || import.meta.env.VITE_S3_REGION || REGION_DEFAULTS.s3Region;
    isConfigured = Boolean(bucketName);
    endpointUrl = isConfigured ? `https://${bucketName}.s3.${region}.amazonaws.com` : '';
    pathPattern = `${sgSeg}/{filename}`;
  } else if (rawProvider === 'wasabi') {
    provider = 'wasabi';
    providerLabel = 'Wasabi Hot Cloud Storage';
    bucketName = settings?.wasabiBucket || import.meta.env.VITE_WASABI_BUCKET || '';
    region = settings?.wasabiRegion || import.meta.env.VITE_WASABI_REGION || REGION_DEFAULTS.wasabiRegion;
    isConfigured = Boolean(bucketName);
    endpointUrl = isConfigured ? `https://s3.${region}.wasabisys.com/${bucketName}` : '';
    pathPattern = `${sgSeg}/{filename}`;
  } else if (rawProvider === 'gcs') {
    provider = 'gcs';
    providerLabel = 'Google Cloud Storage (GCS)';
    bucketName = settings?.gcsBucket || import.meta.env.VITE_GCS_BUCKET || '';
    isConfigured = Boolean(bucketName);
    endpointUrl = isConfigured ? `https://storage.googleapis.com/${bucketName}` : '';
    pathPattern = `${sgSeg}/{filename}`;
  } else if (rawProvider === 'azure_blob') {
    provider = 'azure_blob';
    providerLabel = 'Microsoft Azure Blob Storage';
    account = settings?.azureAccount || import.meta.env.VITE_AZURE_ACCOUNT || '';
    container = settings?.azureContainer || import.meta.env.VITE_AZURE_CONTAINER || AZURE_CONTAINER_DEFAULT;
    bucketName = container;
    isConfigured = Boolean(account && container);
    endpointUrl = isConfigured ? `https://${account}.blob.core.windows.net/${container}` : '';
    pathPattern = `${sgSeg}/{filename}`;
  } else if (rawProvider === 'custom_cdn') {
    provider = 'custom_cdn';
    providerLabel = 'Custom CDN / Reverse Proxy';
    bucketName = 'Edge CDN Cache';
    endpointUrl = settings?.customCdnUrl || '';
    isConfigured = Boolean(endpointUrl);
    pathPattern = `${sgSeg}/{filename}`;
  } else if (rawProvider === 'nas_local') {
    provider = 'nas_local';
    providerLabel = 'Local Intranet NAS / HTTP File Server';
    bucketName = 'NAS Share Base';
    endpointUrl = settings?.nasServerUrl || '';
    isConfigured = Boolean(endpointUrl);
    pathPattern = `${sgSeg}/{filename}`;
    isCloudBucket = false;
  } else {
    // Supabase native default
    provider = 'supabase';
    providerLabel = 'Supabase Cloud Storage (PostGIS Native)';
    bucketName = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || STORAGE_BUCKET_DEFAULT;
    const sbUrl = (settings?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
    isConfigured = Boolean(sbUrl && bucketName);
    endpointUrl = isConfigured ? `${sbUrl}/storage/v1/object/public/${bucketName}` : '';
    pathPattern = `${bucketName}/${sgSeg}/{filename}`;
  }

  const sampleUrl = resolvePanoramaUrl(sampleFilename, settings, { subgrid: cleanSg });
  const sampleConfigUrl = strategy === 'multires_tiles'
    ? resolvePanoramaConfigUrl(sampleFilename, settings, cleanSg)
    : undefined;

  return {
    provider,
    providerLabel,
    bucketName,
    region,
    account,
    container,
    endpointUrl,
    strategy,
    strategyLabel,
    sampleUrl,
    sampleConfigUrl,
    pathPattern,
    isCloudBucket,
    isConfigured
  };
}

export const BucketPublicationGate: React.FC<BucketPublicationGateProps> = ({
  subgrid,
  surveyDate,
  totalFrames,
  projectSettings,
  onAdvanceToWebGIS,
  addNotification,
  addAuditLog,
  userLabel,
  isGuestUser,
  pairedRecords,
  surveyFolder
}) => {
  const cleanSg = subgrid.trim().toUpperCase();
  // Real frame count only. An unknown total is reported as unknown and blocks
  // the push rather than being padded to a round number.
  const effectiveTotal = totalFrames > 0 ? totalFrames : 0;
  const nasBase = (projectSettings?.nasWorkBasePath || '').replace(/\/+$/, '');
  const deliverablePath = cleanSg
    ? `${nasBase ? `${nasBase}/` : ''}DELIVERABLES/${cleanSg}/`
    : '';
  const hasBatch = effectiveTotal > 0 && cleanSg.length > 0;

  // Auto-detect bucket specification from user's current project settings
  const bucketConfig = useMemo(
    () => detectBucketConfig(projectSettings, cleanSg),
    [projectSettings, cleanSg]
  );

  // The push writes a manifest and a sign-off record, so it only runs when a
  // real frame count and a real target bucket both exist.
  const canPush = hasBatch && bucketConfig.isConfigured;

  // Probe states
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    status: number;
    statusText: string;
    latencyMs: number;
    corsOk: boolean;
    error?: string;
  } | null>(null);

  // Verification & Publication states
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verifiedCount, setVerifiedCount] = useState<number>(0);
  const [inventoryFiles, setInventoryFiles] = useState<string[]>([]);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [isSignOffDone, setIsSignOffDone] = useState<boolean>(false);
  const [copiedSyncCommand, setCopiedSyncCommand] = useState<boolean>(false);

  // 1-Button Cloud Push states
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [pushStep, setPushStep] = useState<'IDLE' | 'VALIDATING' | 'GENERATING_MANIFEST' | 'SYNCING' | 'DONE' | 'FAILED'>('IDLE');
  const [pushProgress, setPushProgress] = useState<number>(0);
  const [pushLogs, setPushLogs] = useState<string[]>([]);
  interface GeneratedManifest {
    enumeratedFrames?: number;
    [key: string]: unknown;
  }
  const [generatedManifest, setGeneratedManifest] = useState<GeneratedManifest | null>(null);
  const [showManifestModal, setShowManifestModal] = useState<boolean>(false);

  // === One-click image upload (any provider) =================================
  const workstations: WorkstationStationConfig[] =
    (projectSettings?.workstationsConfig as WorkstationStationConfig[] | undefined) || DEFAULT_4_WORKSTATIONS;
  const agentConfigured = workstations.some((w) => w.ipAddress && w.enabled !== false);
  const workerBaseUrl = (
    projectSettings?.productionApiUrl ||
    import.meta.env.VITE_PRODUCTION_API_URL ||
    ''
  ).replace(/\/+$/, '');
  const hasWorkerUrl = workerBaseUrl.length > 0 || import.meta.env.VITE_NAS_API_ENABLED === 'true';
  const uploadMode = useMemo(
    () =>
      resolveUploadMode(
        bucketConfig.provider,
        bucketConfig.strategy,
        hasWorkerUrl,
        agentConfigured
      ),
    [bucketConfig.provider, bucketConfig.strategy, hasWorkerUrl, agentConfigured]
  );

  interface ImgUploadState {
    running: boolean;
    done: number;
    total: number;
    current: string;
    failed: string[];
    lastLine: string;
    finishedAt?: string;
    outcome?: 'DONE' | 'FAILED' | 'CANCELLED';
  }
  const [imgUpload, setImgUpload] = useState<ImgUploadState>({ running: false, done: 0, total: 0, current: '', failed: [], lastLine: '' });
  const imgCancelRef = useRef(false);

  /** Frames eligible for upload: verified pairs with a metadata name. */
  const uploadFrames = useMemo(() => {
    const list = (pairedRecords || []).filter((r) => r.targetFilename && (r.isMatched || r.renamedAt));
    const seen = new Set<string>();
    return list.filter((r) => {
      const key = r.targetFilename;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [pairedRecords]);

  // The upload only unlocks when the FINAL panoramic dataset actually exists
  // on disk for this survey run (05_Final/Project-OUT/Grid 1/<sg>/<run>/).
  const [finalImages, setFinalImages] = useState<string[] | null>(null);
  const [finalPath, setFinalPath] = useState<string>('');
  const surveyFolderId = (surveyFolder || '').trim();
  const scanFolderId = surveyFolderId === '__custom__' || surveyFolderId === '__none__' ? '' : surveyFolderId;
  useEffect(() => {
    let disposed = false;
    setFinalImages(null);
    setFinalPath('');
    if (!cleanSg || !scanFolderId) return;
    fetchDashboardApi(`/api/nas-scan?action=final-images&subgrid=${encodeURIComponent(cleanSg)}&folder=${encodeURIComponent(scanFolderId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (disposed) return;
        if (data?.success) {
          setFinalImages(Array.isArray(data.images) ? data.images : []);
          setFinalPath(data.path || '');
        } else {
          setFinalImages([]);
        }
      })
      .catch(() => {
        if (!disposed) setFinalImages([]);
      });
    return () => {
      disposed = true;
    };
  }, [cleanSg, scanFolderId]);
  const hasFinalImages = (finalImages?.length || 0) > 0;

  const fetchImageBlobFromNas = async (relCandidates: string[]): Promise<Blob | null> => {
    for (const rel of relCandidates) {
      try {
        const res = await fetchDashboardApi(`/api/nas-image?path=${encodeURIComponent(rel)}`, {
          method: 'GET',
          signal: AbortSignal.timeout(60_000)
        });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) return blob;
        }
      } catch {
        // try the next candidate location
      }
    }
    return null;
  };

  const handleUploadImagesToBucket = async () => {
    if (imgUpload.running || isGuestUser) return;
    if (!hasFinalImages) {
      addNotification?.({
        type: 'warning',
        title: 'No Final Image Found',
        message: `No final image dataset exists for ${cleanSg || 'this survey'}${scanFolderId ? ` / ${scanFolderId}` : ''} — run the 4-PC board (PC 4 output) first.`
      });
      return;
    }
    if (uploadMode.mode === 'unavailable') {
      addNotification?.({
        type: 'warning',
        title: 'Image Upload Unavailable',
        message: uploadMode.reason || 'No upload channel is configured for this provider.'
      });
      return;
    }
    if (uploadMode.mode === 'browser') {
      if (uploadFrames.length === 0) {
        addNotification?.({
          type: 'warning',
          title: 'No Paired Frames To Upload',
          message: 'Pair the survey frames in Stitched Intake & Pairing first — the upload list follows verified metadata names.'
        });
        return;
      }
      const objectPattern = projectSettings?.singleImagePathPattern || '{subgrid}/{filename}';
      imgCancelRef.current = false;
      setImgUpload({ running: true, done: 0, total: uploadFrames.length, current: '', failed: [], lastLine: '' });
      let uploaded = 0;
      const failed: string[] = [];
      for (const frame of uploadFrames) {
        if (imgCancelRef.current) break;
        const name = frame.targetFilename;
        setImgUpload((prev) => ({ ...prev, current: name }));
        const blob = await fetchImageBlobFromNas(buildUploadRelCandidates(cleanSg, scanFolderId, name));
        if (!blob) {
          failed.push(`${name} (not found on NAS)`);
          setImgUpload((prev) => ({ ...prev, done: prev.done + 1 }));
          continue;
        }
        try {
          const objectPath = buildBucketObjectPath(objectPattern, cleanSg, name);
          const { error } = await supabase.storage
            .from(bucketConfig.bucketName)
            .upload(objectPath, blob, { upsert: true, contentType: 'image/jpeg' });
          if (error) {
            failed.push(`${name} (${error.message})`);
          } else {
            uploaded += 1;
          }
        } catch (err) {
          failed.push(`${name} (${err instanceof Error ? err.message : 'upload failed'})`);
        }
        setImgUpload((prev) => ({ ...prev, done: prev.done + 1 }));
      }
      const outcome = imgCancelRef.current ? 'CANCELLED' : failed.length === 0 ? 'DONE' : 'FAILED';
      setImgUpload((prev) => ({ ...prev, running: false, finishedAt: new Date().toISOString(), outcome, failed }));
      const cancelled = outcome === 'CANCELLED';
      addNotification?.({
        title: cancelled ? 'Image Upload Cancelled' : uploaded > 0 ? 'Image Upload Finished' : 'Image Upload Failed',
        message: cancelled
          ? `${uploaded} of ${uploadFrames.length} image(s) uploaded before cancellation.`
          : `${uploaded}/${uploadFrames.length} image(s) uploaded to ${bucketConfig.bucketName}${failed.length > 0 ? `; ${failed.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}` : ''}.`,
        category: 'SYSTEM',
        read: false
      });
      addAuditLog?.(
        'BUCKET_PUSH',
        cancelled ? 'Bucket Image Upload Cancelled' : 'Bucket Image Upload (browser)',
        `${uploaded}/${uploadFrames.length} image(s) uploaded to ${bucketConfig.bucketName}/${objectPattern} by ${userLabel}${failed.length > 0 ? ` (${failed.length} failed)` : ''}.`,
        failed.length > 0 || cancelled ? 'warning' : 'success'
      );
      if (uploaded > 0) {
        void appendStageEventToSupabase({
          subgrid: cleanSg,
          stage: 'bucket',
          event: 'PROGRESS',
          via: 'operator',
          detail: `${uploaded} final image(s) uploaded to ${bucketConfig.bucketName} (browser channel)`,
          counts: { uploaded, failed: failed.length, total: uploadFrames.length },
          updated_by: userLabel || 'Operator'
        });
        // Upload implies new inventory — refresh the listing so the sign-off unlocks.
        void handleScanBucketFiles();
      }
      return;
    }

    // agent_cli mode: run the provider CLI on the station PC, poll the job.
    let agent: WorkstationStationConfig | null = null;
    for (const ws of workstations.filter((w) => w.ipAddress && w.enabled !== false)) {
      const probe = await probeStationAgent(ws, { timeoutMs: 2_000 });
      if (probe.online) {
        agent = ws;
        break;
      }
    }
    if (!agent) {
      addNotification?.({
        type: 'warning',
        title: 'No Station Agent Reachable',
        message: 'The CLI push runs on a workstation PC — start station-agent on one, or use the sync script manually.'
      });
      return;
    }
    const providerCli =
      bucketConfig.provider === 'cloudflare_r2' ? 'r2'
        : bucketConfig.provider === 'aws_s3' ? 's3'
          : bucketConfig.provider === 'wasabi' ? 'wasabi'
            : bucketConfig.provider === 'gcs' ? 'gcs'
              : bucketConfig.provider === 'azure_blob' ? 'azure'
                : bucketConfig.provider === 'nas_local' ? 'nas_local'
                  : 'supabase_cli';
    setImgUpload({ running: true, done: 0, total: uploadFrames.length || effectiveTotal, current: '', failed: [], lastLine: 'Starting CLI sync...' });
    const started = await startBucketSyncJob(agent, {
      provider: providerCli as 'r2' | 's3' | 'wasabi' | 'gcs' | 'azure' | 'supabase_cli' | 'nas_local',
      stageDir: `DELIVERABLES/${cleanSg}`,
      subgrid: cleanSg,
      bucket: bucketConfig.bucketName,
      region: bucketConfig.region,
      account: bucketConfig.account,
      endpoint: bucketConfig.endpointUrl,
      includeManifest: true
    });
    if (!started) {
      const message = 'Station agent unreachable.';
      setImgUpload((prev) => ({ ...prev, running: false, outcome: 'FAILED', finishedAt: new Date().toISOString(), lastLine: message }));
      addNotification?.({ type: 'warning', title: 'CLI Sync Could Not Start', message });
      return;
    }
    if ('message' in started) {
      const message = started.message;
      setImgUpload((prev) => ({ ...prev, running: false, outcome: 'FAILED', finishedAt: new Date().toISOString(), lastLine: message }));
      addNotification?.({ type: 'warning', title: 'CLI Sync Could Not Start', message });
      return;
    }
    const jobId = started.job_id;
    setImgUpload((prev) => ({ ...prev, lastLine: started.command_desc || 'CLI sync running...' }));
    // Poll until the agent-side job settles (2 s cadence, bounded to 1 h).
    const deadline = Date.now() + 3_600_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const status = await pollBucketSyncJob(agent, jobId);
      if (!status) {
        setImgUpload((prev) => ({ ...prev, lastLine: '… (agent unreachable, job continues on the PC)' }));
        continue;
      }
      setImgUpload((prev) => ({
        ...prev,
        lastLine: status.lines.length > 0 ? status.lines[status.lines.length - 1] : prev.lastLine,
        done: Math.min(prev.total, status.line_count || 0)
      }));
      if (status.status !== 'RUNNING') {
        const ok = status.status === 'DONE';
        setImgUpload((prev) => ({
          ...prev,
          running: false,
          outcome: ok ? 'DONE' : 'FAILED',
          finishedAt: new Date().toISOString(),
          failed: ok ? [] : [status.error || 'CLI failed']
        }));
        addNotification?.({
          title: ok ? 'Bucket Sync Finished' : 'Bucket Sync Failed',
          message: ok
            ? `${status.command_desc} completed on ${agent.ipAddress} (${status.line_count} log line(s)).`
            : `${status.command_desc} failed: ${status.error || 'CLI error'}.`,
          category: 'SYSTEM',
          read: false
        });
        addAuditLog?.(
          'BUCKET_PUSH',
          ok ? 'Bucket CLI Sync Completed' : 'Bucket CLI Sync Failed',
          `${status.command_desc} via station agent ${agent.ipAddress}: ${ok ? 'done' : status.error}.`,
          ok ? 'success' : 'error'
        );
        if (ok) {
          void appendStageEventToSupabase({
            subgrid: cleanSg,
            stage: 'bucket',
            event: 'PROGRESS',
            via: 'system',
            detail: `${status.command_desc} completed via station agent`,
            counts: { logLines: status.line_count, bucket: bucketConfig.bucketName },
            updated_by: userLabel || 'System'
          });
          if (bucketConfig.provider === 'supabase') void handleScanBucketFiles();
        }
        return;
      }
    }
    setImgUpload((prev) => ({ ...prev, running: false, outcome: 'FAILED', finishedAt: new Date().toISOString(), lastLine: 'Timed out after 1 h.' }));
  };

  // Run initial probe on mount. A changed provider, bucket, or subgrid makes
  // the previous inventory stale, so the enumerated object names are dropped.
  useEffect(() => {
    setVerifiedCount(0);
    setInventoryFiles([]);
    setInventoryError(null);
    setIsSignOffDone(false);
    handleProbeBucket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketConfig.provider, bucketConfig.bucketName, bucketConfig.isConfigured, cleanSg]);

  const handleProbeBucket = async () => {
    if (!bucketConfig.isConfigured) {
      setProbeResult({
        ok: false,
        status: 0,
        statusText: 'Not configured',
        latencyMs: 0,
        corsOk: false,
        error: `No bucket or endpoint is configured for ${bucketConfig.providerLabel}. Set it in project settings before probing.`
      });
      setIsProbing(false);
      return;
    }

    setIsProbing(true);
    const start = performance.now();

    try {
      if (bucketConfig.provider === 'cloudflare_r2' || bucketConfig.provider === 'custom_cdn') {
        const res = await testCloudflareStorageHealth(
          bucketConfig.endpointUrl,
          `${cleanSg}-0001.jpg`,
          projectSettings
        );
        setProbeResult({
          ok: res.ok,
          status: res.status || (res.ok ? 200 : 0),
          statusText: res.statusText,
          latencyMs: res.latencyMs || Math.round(performance.now() - start),
          corsOk: res.corsOk,
          error: res.error
        });
      } else if (bucketConfig.provider === 'supabase') {
        const { error } = await supabase.storage
          .from(bucketConfig.bucketName)
          .list('', { limit: 1 });

        const latencyMs = Math.round(performance.now() - start);
        if (error) {
          setProbeResult({
            ok: false,
            status: 403,
            statusText: error.message || 'Access Restricted',
            latencyMs,
            corsOk: true,
            error: error.message
          });
        } else {
          setProbeResult({
            ok: true,
            status: 200,
            statusText: 'Connected',
            latencyMs,
            corsOk: true
          });
        }
      } else {
        // Remaining providers have no in-browser listing API. Probe the real
        // endpoint instead of asserting a status that was never observed.
        const target = `${bucketConfig.endpointUrl.replace(/\/+$/, '')}/`;
        const res = await fetch(target, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
        const latencyMs = Math.round(performance.now() - start);
        setProbeResult({
          // no-cors responses are opaque: the request left the browser, but the
          // status and CORS headers are deliberately unreadable.
          ok: res.type !== 'opaque' ? res.ok : true,
          status: res.type === 'opaque' ? 0 : res.status,
          statusText: res.type === 'opaque' ? 'Opaque response' : `HTTP ${res.status}`,
          latencyMs,
          corsOk: res.type === 'opaque' ? true : res.headers.get('access-control-allow-origin') !== null,
          error: res.type === 'opaque' ? undefined : undefined
        });
      }
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      setProbeResult({
        ok: false,
        status: 0,
        statusText: 'Failed',
        latencyMs,
        corsOk: false,
        error: err?.message || 'Network probe failed'
      });
    } finally {
      setIsProbing(false);
    }
  };

  const handleScanBucketFiles = async () => {
    setIsVerifying(true);
    setInventoryError(null);

    if (bucketConfig.provider !== 'supabase') {
      setVerifiedCount(0);
      setInventoryError(
        `Object listing is only available for the Supabase provider. ${bucketConfig.providerLabel} inventory must be verified with the sync command below or the storage console.`
      );
      setIsVerifying(false);
      return;
    }

    if (isGuestUser) {
      setVerifiedCount(0);
      setInventoryError('Guest sessions cannot read bucket storage. Sign in to run an inventory check.');
      setIsVerifying(false);
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from(bucketConfig.bucketName)
        .list(cleanSg, { limit: 1000 });

      if (error) {
        setVerifiedCount(0);
        setInventoryError(error.message || 'Bucket listing was refused.');
        return;
      }

      const listed = (data || []).filter((f) => /\.(jpe?g|png)$/i.test(f.name));
      setVerifiedCount(listed.length);
      // The listed object names are the only frame identities this station can
      // assert. They are kept so the manifest enumerates real bucket objects
      // instead of names generated from a count.
      setInventoryFiles(listed.map((f) => f.name));
      if (listed.length === 0) {
        setInventoryError(`No images were listed under "${cleanSg}/" in ${bucketConfig.bucketName}.`);
        return;
      }
      if (effectiveTotal > 0 && listed.length !== effectiveTotal) {
        setInventoryError(
          `Bucket lists ${listed.length} images but intake paired ${effectiveTotal} frames. Resolve the difference before publishing.`
        );
        return;
      }

      addNotification?.({
        title: 'Bucket Inventory Verified',
        message: `${listed.length} images listed under ${cleanSg}/ in ${bucketConfig.bucketName}.`,
        category: 'SYSTEM',
        read: false
      });
    } catch (err: any) {
      setVerifiedCount(0);
      setInventoryError(err?.message || 'Bucket inventory scan failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  const buildManifestObject = () => {
    const isTiles = bucketConfig.strategy === 'multires_tiles';
    const layout = isTiles ? 'multires_tiles' : 'single_equirectangular';

    // Frames are enumerated only from objects the bucket actually listed. No
    // filename is generated from a frame count: an unenumerated manifest says
    // so instead of listing files that may not exist.
    const frames = inventoryFiles.map((name) => {
      const base = name.replace(/\.(jpe?g|png)$/i, '');
      const pointFolder = base;

      if (isTiles) {
        return {
          subgrid: cleanSg,
          pointFolder,
          filename: name,
          configUrl: `tiles/${cleanSg}/${pointFolder}/config.json`,
          fallbackUrl: `tiles/${cleanSg}/${pointFolder}/fallback/f.jpg`,
          path: `tiles/${cleanSg}/${pointFolder}/config.json`
        };
      }
      return {
        subgrid: cleanSg,
        pointFolder,
        filename: name,
        path: `${cleanSg}/${name}`
      };
    });

    return {
      version: 1,
      layout,
      subgrid: cleanSg,
      surveyDate,
      totalFrames: effectiveTotal,
      enumeratedFrames: frames.length,
      generatedAt: new Date().toISOString(),
      approvedBy: userLabel,
      storageProvider: bucketConfig.provider,
      bucket: bucketConfig.bucketName,
      // Declares how this frame list was produced, so a downstream consumer can
      // tell an enumerated manifest from a count-only one.
      frameListSource: frames.length > 0 ? 'listed-from-bucket' : 'not-enumerated',
      inventoryVerified,
      tilePattern: isTiles
        ? (projectSettings?.multiResTilePattern || 'tiles/{subgrid}/{pointFolder}/config.json')
        : undefined,
      fallbackPattern: isTiles
        ? (projectSettings?.multiResFallbackPattern || 'tiles/{subgrid}/{pointFolder}/fallback/f.jpg')
        : undefined,
      pathPattern: !isTiles
        ? (projectSettings?.singleImagePathPattern || '{subgrid}/{filename}')
        : undefined,
      frames
    };
  };

  const syncCommand = useMemo(() => {
    const isTiles = bucketConfig.strategy === 'multires_tiles';
    const subPath = isTiles ? `tiles/${cleanSg}` : cleanSg;

    switch (bucketConfig.provider) {
      case 'cloudflare_r2':
        return `# 1. Synchronize to Cloudflare R2 (${bucketConfig.strategyLabel})
rclone copy "${deliverablePath}" "r2:${bucketConfig.bucketName}/${subPath}/" --transfers=16 --checkers=32 -P --fast-list

# 2. Deploy generated manifest.json
rclone copyto "${deliverablePath}manifest.json" "r2:${bucketConfig.bucketName}/manifest.json"`;

      case 'aws_s3':
        return `# 1. AWS S3 Synchronization (${bucketConfig.strategyLabel})
aws s3 sync "${deliverablePath}" "s3://${bucketConfig.bucketName}/${subPath}/" --region ${bucketConfig.region || 'ap-southeast-1'} --acl public-read

# 2. Deploy generated manifest.json
aws s3 cp "${deliverablePath}manifest.json" "s3://${bucketConfig.bucketName}/manifest.json"`;

      case 'wasabi':
        return `# 1. Wasabi Storage Synchronization
aws s3 sync "${deliverablePath}" "s3://${bucketConfig.bucketName}/${subPath}/" --endpoint-url=https://s3.${bucketConfig.region || 'us-east-1'}.wasabisys.com --acl public-read

# 2. Deploy generated manifest.json
aws s3 cp "${deliverablePath}manifest.json" "s3://${bucketConfig.bucketName}/manifest.json" --endpoint-url=https://s3.${bucketConfig.region || 'us-east-1'}.wasabisys.com`;

      case 'gcs':
        return `gsutil -m rsync -r "${deliverablePath}" "gs://${bucketConfig.bucketName}/${subPath}/"
gsutil cp "${deliverablePath}manifest.json" "gs://${bucketConfig.bucketName}/manifest.json"`;

      case 'azure_blob':
        return `azcopy copy "${deliverablePath}*" "${bucketConfig.endpointUrl}/${subPath}/?[SAS_TOKEN]" --recursive
azcopy copy "${deliverablePath}manifest.json" "${bucketConfig.endpointUrl}/manifest.json?[SAS_TOKEN]"`;

      case 'nas_local':
        return `robocopy "D:\\Output\\${cleanSg}" "\\\\NAS\\360_images\\${cleanSg}" /E /MT:8`;

      case 'supabase':
      default:
        return `supabase storage cp -r "${deliverablePath}" "ss://${bucketConfig.bucketName}/${cleanSg}/"
supabase storage cp "${deliverablePath}manifest.json" "ss://${bucketConfig.bucketName}/manifest.json"`;
    }
  }, [bucketConfig, deliverablePath, cleanSg]);

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(syncCommand);
    setCopiedSyncCommand(true);
    setTimeout(() => setCopiedSyncCommand(false), 2000);
  };

  const openManifest = () => {
    const manifest = generatedManifest || buildManifestObject();
    setGeneratedManifest(manifest);
    setShowManifestModal(true);
  };

  const copyManifestJson = () => {
    navigator.clipboard.writeText(
      JSON.stringify(generatedManifest || buildManifestObject(), null, 2)
    );
  };

  const handleDownloadBatchScript = () => {
    const batScript = `@echo off
REM TNB 360 Mobile Mapping - Bucket Sync Script
REM Subgrid: ${cleanSg}
REM Bucket: ${bucketConfig.bucketName} (${bucketConfig.providerLabel})

echo [*] Starting sync for ${cleanSg}...
${syncCommand}
pause
`;

    const blob = new Blob([batScript], { type: 'application/x-bat' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sync_${cleanSg}_to_bucket.bat`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadManifest = (manifestObj: any) => {
    const blob = new Blob([JSON.stringify(manifestObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 1-Button PUSH IN CLOUD BUCKET
  const handleOneButtonClickPush = async () => {
    if (!canPush || isPushing) return;

    setIsPushing(true);
    setIsSignOffDone(false);
    setPushStep('VALIDATING');
    setPushProgress(20);
    setPushLogs([
      `[${new Date().toLocaleTimeString()}] Preparing manifest for ${cleanSg}.`,
      `[${new Date().toLocaleTimeString()}] Target: ${bucketConfig.bucketName || '(not configured)'} (${bucketConfig.providerLabel})`
    ]);

    const stamp = () => `[${new Date().toLocaleTimeString()}]`;

    try {
      setPushStep('GENERATING_MANIFEST');
      setPushProgress(50);

      const manifestObj = buildManifestObject();
      setGeneratedManifest(manifestObj);
      setPushLogs((prev) => [
        ...prev,
        `${stamp()} Generated manifest.json (${manifestObj.layout}, ${
          manifestObj.enumeratedFrames > 0
            ? `${manifestObj.enumeratedFrames} listed object(s)`
            : 'no enumerated frames'
        }, inventory ${
          verifiedCount > 0 && verifiedCount === effectiveTotal ? 'verified' : 'not verified'
        }).`
      ]);

      setPushStep('SYNCING');
      setPushProgress(80);

      const usesSupabaseChannel = bucketConfig.provider === 'supabase' && !isGuestUser;

      if (usesSupabaseChannel) {
        const manifestBlob = new Blob([JSON.stringify(manifestObj, null, 2)], { type: 'application/json' });
        // supabase-js resolves with { error } instead of throwing, so both
        // targets are checked explicitly.
        const subgridUpload = await supabase.storage
          .from(bucketConfig.bucketName)
          .upload(`${cleanSg}/manifest.json`, manifestBlob, { upsert: true, contentType: 'application/json' });
        if (subgridUpload.error) throw new Error(`${cleanSg}/manifest.json: ${subgridUpload.error.message}`);

        const rootUpload = await supabase.storage
          .from(bucketConfig.bucketName)
          .upload('manifest.json', manifestBlob, { upsert: true, contentType: 'application/json' });
        if (rootUpload.error) throw new Error(`manifest.json: ${rootUpload.error.message}`);

        setPushLogs((prev) => [...prev, `${stamp()} Uploaded manifest.json to both object roots.`]);
      } else {
        handleDownloadManifest(manifestObj);
        setPushLogs((prev) => [
          ...prev,
          `${stamp()} No in-browser upload channel for ${bucketConfig.providerLabel}${
            isGuestUser ? ' (guest session)' : ''
          }. manifest.json downloaded — run the sync command to transfer the frames.`
        ]);
      }

      setPushStep('DONE');
      setPushProgress(100);
      void appendStageEventToSupabase({
        subgrid: cleanSg,
        stage: 'bucket',
        event: 'PROGRESS',
        via: 'operator',
        detail: `manifest.json for ${effectiveTotal} frames ${usesSupabaseChannel ? 'uploaded to' : 'downloaded from'} ${bucketConfig.bucketName} — frame transfer follows the sync step`,
        counts: { total: effectiveTotal, channel: usesSupabaseChannel ? 'supabase' : 'manual-sync' },
        updated_by: userLabel || 'Operator'
      });
      addNotification?.({
        title: 'Bucket Manifest Prepared',
        message: usesSupabaseChannel
          ? `manifest.json for ${effectiveTotal} frames uploaded to ${bucketConfig.bucketName}.`
          : `manifest.json for ${effectiveTotal} frames downloaded. Frame transfer still requires the sync command.`,
        category: 'SYSTEM',
        read: false
      });
      addAuditLog?.(
        'BUCKET_PUSH',
        'Bucket Manifest Prepared',
        `Manifest generated for ${effectiveTotal} frames of ${cleanSg} (${
          usesSupabaseChannel ? 'uploaded' : 'downloaded, transfer pending'
        }). Frame objects were not uploaded by this action.`,
        usesSupabaseChannel ? 'success' : 'info'
      );
    } catch (err: any) {
      const message = err?.message || 'Unknown failure';
      setPushStep('FAILED');
      setPushLogs((prev) => [...prev, `${stamp()} FAILED — ${message}`]);
      addNotification?.({
        title: 'Bucket Push Failed',
        message,
        category: 'ALERT',
        read: false
      });
      addAuditLog?.('BUCKET_PUSH', 'Bucket Push Failed', message, 'error');
    } finally {
      setIsPushing(false);
    }
  };

  const handleSignOffBucket = () => {
    setIsSignOffDone(true);
    void appendStageEventToSupabase({
      subgrid: cleanSg,
      stage: 'bucket',
      event: 'COMPLETED',
      via: 'operator',
      detail: `${verifiedCount} listed image(s) in ${bucketConfig.bucketName} approved for ${cleanSg}`,
      counts: { verified: verifiedCount, total: effectiveTotal, bucket: bucketConfig.bucketName },
      updated_by: userLabel || 'Operator'
    });
    addNotification?.({
      title: 'Bucket Publication Approved',
      message: `${verifiedCount} listed images in ${bucketConfig.bucketName} approved for ${cleanSg}.`,
      category: 'SYSTEM',
      read: false
    });
    addAuditLog?.(
      'STORAGE_PUBLISH',
      'Bucket Stamped',
      `Operator approved ${verifiedCount} listed images for ${cleanSg} in ${bucketConfig.bucketName}.`,
      'success'
    );
  };

  const inventoryVerified = hasBatch && verifiedCount > 0 && verifiedCount === effectiveTotal;
  const verifiedPct = effectiveTotal > 0 ? Math.min(100, Math.round((verifiedCount / effectiveTotal) * 100)) : null;
  const probeStatus = !bucketConfig.isConfigured
    ? 'Not configured'
    : !probeResult
      ? 'Probing storage bucket...'
      : probeResult.ok
        ? `Reachable (${probeResult.status || 'opaque'})`
        : `Issue (${probeResult.status || 'Error'})`;
  const probeNote = !bucketConfig.isConfigured
    ? 'Set the provider bucket and endpoint in project settings to enable probing.'
    : !probeResult
      ? 'Waiting for the first probe response.'
      : `${probeResult.latencyMs} ms · CORS ${
          probeResult.corsOk ? 'allowed' : 'header missing'
        }${probeResult.error ? ` · ${probeResult.error}` : ''}`;

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-200">
      {/* Header toolbar — one surface, one primary action, probe as a text link */}
      <div className="pb-3 border-b border-subtle flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">
            Cloud Bucket Publication Gate
          </h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Prepare, upload, and verify final panorama images for the selected survey.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <TextAction
            icon={<RefreshCw size={11} className={isProbing ? 'animate-spin' : ''} />}
            onClick={handleProbeBucket}
            disabled={isProbing || isPushing}
            title="Re-run the storage endpoint probe"
          >
            {isProbing ? 'Probing...' : 'Probe'}
          </TextAction>
          <button
            onClick={handleOneButtonClickPush}
            disabled={isPushing || !canPush}
            title={
              !bucketConfig.isConfigured
                ? 'No bucket or endpoint is configured for the active provider'
                : !hasBatch
                  ? 'Pair frames in Stitched Intake & Pairing to establish a real frame count'
                  : 'Generate and publish manifest.json for this subgrid'
            }
            className="px-3.5 py-1.5 bg-text-base text-card hover:opacity-90 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-opacity cursor-pointer disabled:opacity-40"
          >
            {isPushing ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Preparing ({pushProgress}%)...</span>
              </>
            ) : (
              <>
                <UploadCloud size={14} />
                <span>Publish manifest.json</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Push telemetry — bare section, only while pushing or after completion */}
      {(isPushing || pushStep === 'DONE' || pushStep === 'FAILED') && (
        <div className="space-y-2.5">
          <SectionLabel
            icon={<UploadCloud size={12} />}
            note={`${bucketConfig.bucketName || 'not configured'} · ${
              pushStep === 'FAILED' ? 'failed' : `${pushProgress}%`
            }`}
          >
            Manifest Publication
          </SectionLabel>
          <div className="w-full h-1.5 bg-inner rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                pushStep === 'FAILED' ? 'bg-red-400' : 'bg-text-base'
              }`}
              style={{ width: `${pushProgress}%` }}
            />
          </div>
          <div className="bg-inner border border-subtle rounded-lg p-2.5 font-mono text-[11px] text-text-muted max-h-24 overflow-y-auto space-y-1">
            {pushLogs.map((log, idx) => (
              <div key={idx} className="truncate">
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Storage configuration — one divided list, no stacked stat cards */}
      <div className="space-y-3">
        <SectionLabel
          icon={<Database size={12} />}
          actions={
            <TextAction
              icon={<RefreshCw size={11} className={isVerifying ? 'animate-spin' : ''} />}
              onClick={handleScanBucketFiles}
              disabled={isVerifying || isPushing}
              title="Re-scan the bucket inventory and re-verify frame count"
            >
              {isVerifying ? 'Scanning...' : 'Verify Inventory'}
            </TextAction>
          }
        >
          Storage Configuration
        </SectionLabel>

        <MetaList
          items={[
            {
              key: 'provider',
              label: 'Provider',
              value: bucketConfig.providerLabel,
              note: bucketConfig.endpointUrl
            },
            {
              key: 'bucket',
              label: 'Bucket / Container',
              value: bucketConfig.bucketName || 'Not configured',
              note: bucketConfig.isConfigured
                ? bucketConfig.region
                  ? `Region: ${bucketConfig.region}`
                  : 'Standard region'
                : 'Set the provider bucket and endpoint in project settings'
            },
            {
              key: 'strategy',
              label: 'Storage Strategy',
              value: bucketConfig.strategyLabel,
              note: bucketConfig.pathPattern
            },
            {
              key: 'sample',
              label: 'Sample Public URL',
              value: bucketConfig.sampleUrl ? (
                <a
                  href={bucketConfig.sampleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-text-base hover:underline text-[11px] break-all"
                >
                  {bucketConfig.sampleUrl}
                </a>
              ) : (
                <span className="text-text-muted">
                  {cleanSg ? 'Not resolvable from the current storage settings' : 'Set a subgrid to resolve a preview URL'}
                </span>
              ),
              note: cleanSg ? `Expected frame name: ${cleanSg}-0001.jpg` : undefined,
              actions: bucketConfig.sampleUrl ? <ExternalLink size={12} className="text-text-muted shrink-0" /> : undefined
            },
            {
              key: 'connection',
              label: 'Connection',
              value: (
                <span
                  className={
                    !bucketConfig.isConfigured || !probeResult
                      ? 'text-text-muted'
                      : probeResult.ok
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                  }
                >
                  {probeStatus}
                </span>
              ),
              note: probeNote
            }
          ]}
        />
        {inventoryError && (
          <p className="text-[11px] text-amber-400/90 leading-relaxed">{inventoryError}</p>
        )}
      </div>

      {/* === One-click image upload (any provider) === */}
      <div className="space-y-3">
        <SectionLabel
          icon={<UploadCloud size={12} />}
          note={hasBatch ? `${uploadFrames.length} frame(s) ready` : 'no frame count'}
        >
          One-Click Image Upload — {bucketConfig.providerLabel}
        </SectionLabel>

        <div className="rounded-xl border border-subtle bg-card p-4 space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="min-w-0 space-y-1.5">
              <p className="text-[11px] text-text-muted leading-relaxed">
                Uploads the final panoramic images for <span className="font-mono text-text-base">{cleanSg || '{subgrid}'}</span> to{' '}
                <span className="font-mono text-text-base">{bucketConfig.bucketName || '—'}</span>
                {uploadMode.mode === 'browser' ? ' — streamed NAS → browser → bucket with per-frame progress.' : ' — the station agent runs the provider CLI (same command as the sync script), credentials stay on the PC.'}
              </p>
              {scanFolderId ? (
                finalImages === null ? (
                  <p className="text-[11px] text-text-muted flex items-center gap-1.5">
                    <RefreshCw size={11} className="animate-spin" />
                    <span>Checking the final image dataset for this survey…</span>
                  </p>
                ) : hasFinalImages ? (
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1.5" title={finalPath}>
                    <Check size={12} className="shrink-0" />
                    <span>Found <span className="font-bold">{finalImages!.length}</span> final image(s) at <span className="font-mono">{finalPath}</span></span>
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-400 flex items-start gap-1.5" title={finalPath}>
                    <AlertTriangle size={12} className="shrink-0 mt-px" />
                    <span>
                      <span className="font-bold">No final image found for this survey</span> — run the 4-PC board (PC 4 output) first.
                      Expected at <span className="font-mono">{finalPath || `/05_Final/Project-OUT/Grid 1/${cleanSg}/${scanFolderId}/`}</span>
                    </span>
                  </p>
                )
              ) : (
                <p className="text-[11px] text-text-muted">
                  Select a survey run in Stitched Intake &amp; Pairing to check the final image dataset before uploading.
                </p>
              )}
              {uploadMode.mode === 'agent_cli' && (
                <p className="text-[10px] text-text-muted font-mono">
                  source: DELIVERABLES/{cleanSg || '{subgrid}'}/ on the agent PC (run release prepare first)
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleUploadImagesToBucket}
              disabled={imgUpload.running || isGuestUser || uploadMode.mode === 'unavailable' || !hasBatch || finalImages === null || !hasFinalImages || (uploadMode.mode === 'browser' && uploadFrames.length === 0)}
              title={
                uploadMode.mode === 'unavailable'
                  ? uploadMode.reason
                  : finalImages === null
                    ? 'Checking the final image dataset…'
                    : !hasFinalImages
                      ? 'No final image found for this survey — run the 4-PC board first'
                      : `Upload ${uploadFrames.length || effectiveTotal} image(s) to ${bucketConfig.bucketName}`
              }
              className="px-4 py-2 bg-text-base text-card hover:opacity-90 font-semibold text-xs rounded-lg flex items-center gap-2 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <UploadCloud size={14} />
              <span>{imgUpload.running ? 'Uploading…' : `Upload Images (${uploadFrames.length || effectiveTotal})`}</span>
            </button>
          </div>

          {(imgUpload.running || imgUpload.finishedAt) && (
            <div className="space-y-2 pt-2 border-t border-[var(--divider)]">
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="flex items-center gap-1.5">
                  {imgUpload.running && <StatusDot tone="text-sky-400" pulse />}
                  <span className={imgUpload.outcome === 'FAILED' ? 'text-red-300' : imgUpload.outcome === 'CANCELLED' ? 'text-amber-300' : imgUpload.outcome === 'DONE' ? 'text-emerald-300' : 'text-text-base'}>
                    {imgUpload.running ? 'Uploading' : imgUpload.outcome === 'FAILED' ? 'Finished with failures' : imgUpload.outcome === 'CANCELLED' ? 'Cancelled' : 'Complete'}
                  </span>
                </span>
                <span className="text-text-muted">
                  {imgUpload.done} / {imgUpload.total}
                  {imgUpload.total > 0 ? ` (${Math.round((imgUpload.done / imgUpload.total) * 100)}%)` : ''}
                </span>
              </div>
              <div className="w-full h-2 bg-inner border border-subtle rounded-full overflow-hidden relative">
                {imgUpload.running && uploadMode.mode === 'agent_cli' ? (
                  <div className="absolute inset-0 animate-pulse" style={{ background: 'var(--text-base)', opacity: 0.3 }} />
                ) : (
                  <div
                    className="h-full bg-text-base transition-all duration-300"
                    style={{ width: `${imgUpload.total > 0 ? Math.max(2, Math.round((imgUpload.done / imgUpload.total) * 100)) : 2}%` }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap text-[10px] font-mono">
                <span className="text-text-muted truncate min-w-0 animate-pulse" title={imgUpload.current || imgUpload.lastLine}>
                  {imgUpload.current ? `→ ${imgUpload.current}` : imgUpload.lastLine || '…'}
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  {imgUpload.failed.length > 0 && <span className="text-red-300">{imgUpload.failed.length} failed</span>}
                  {imgUpload.running ? (
                    uploadMode.mode === 'browser' ? (
                      <button
                        type="button"
                        onClick={() => { imgCancelRef.current = true; }}
                        className="text-[10px] font-semibold text-text-muted hover:text-text-base cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                    ) : (
                      <span className="text-text-muted/70">job runs on the agent PC</span>
                    )
                  ) : (
                    <span className="text-text-muted/70">{imgUpload.finishedAt ? new Date(imgUpload.finishedAt).toLocaleTimeString() : ''}</span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Synchronization console — bare sections separated by rules */}
      <div className="space-y-3">
        <SectionLabel
          icon={<Terminal size={12} />}
          note={
            hasBatch
              ? `${verifiedCount} of ${effectiveTotal} listed${verifiedPct !== null ? ` · ${verifiedPct}%` : ''}`
              : 'no frame count'
          }
        >
          Subgrid Synchronization — {cleanSg || 'no subgrid set'}
        </SectionLabel>

        <div className="w-full h-1 bg-inner rounded-full overflow-hidden">
          <div
            className="h-full bg-text-base transition-all duration-300"
            style={{ width: `${verifiedPct ?? 0}%` }}
          />
        </div>

        <div className="space-y-3">
          <SectionLabel
            actions={
              <>
                <TextAction
                  icon={copiedSyncCommand ? <Check size={11} /> : <Copy size={11} />}
                  onClick={handleCopyCommand}
                  title="Copy the sync command to clipboard"
                >
                  {copiedSyncCommand ? 'Copied' : 'Copy'}
                </TextAction>
                <TextAction
                  icon={<Download size={11} />}
                  onClick={handleDownloadBatchScript}
                  title="Download a .bat wrapper for this sync command"
                >
                  .BAT Script
                </TextAction>
              </>
            }
          >
            Sync Script — {bucketConfig.providerLabel}
          </SectionLabel>

          <div className="p-3 bg-inner border border-subtle rounded-lg font-mono text-xs text-text-base overflow-x-auto">
            <pre className="whitespace-pre-wrap text-text-base opacity-90">{syncCommand}</pre>
          </div>
        </div>

        <div className="space-y-3">
          <SectionLabel
            icon={<FileCode size={12} />}
            note={
              hasBatch
                ? `${inventoryFiles.length > 0 ? `${inventoryFiles.length} listed object(s)` : 'no enumerated frames'} · inventory ${
                    inventoryVerified ? 'verified' : 'not verified'
                  }`
                : 'no frame count'
            }
            actions={
              <>
                <TextAction icon={<FileCode size={11} />} onClick={openManifest} title="Preview manifest.json">
                  View
                </TextAction>
                <TextAction icon={<Copy size={11} />} onClick={copyManifestJson} title="Copy manifest.json to clipboard">
                  Copy
                </TextAction>
                <TextAction
                  icon={<Download size={11} />}
                  onClick={() => handleDownloadManifest(generatedManifest || buildManifestObject())}
                  title="Download manifest.json"
                >
                  Download
                </TextAction>
              </>
            }
          >
            manifest.json
          </SectionLabel>

          <p className="text-[11px] text-text-muted leading-relaxed">
            Frame entries are enumerated from the actual bucket inventory when it has been verified; otherwise the
            manifest carries no frame list. Paths follow the configured pattern
            <span className="font-mono text-text-base"> {bucketConfig.pathPattern}</span>. Run Verify Inventory to
            reconcile against the live bucket.
          </p>
        </div>
      </div>

      {/* Sign-off — one row, one button that advances the state machine */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-4 border-t border-subtle">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-text-base">Bucket Publication Sign-off</div>
          <p className="text-[11px] text-text-muted mt-0.5">
            {isSignOffDone
              ? `${verifiedCount} listed images approved in ${bucketConfig.bucketName || 'the target bucket'}.`
              : inventoryVerified
                ? `Confirm the ${verifiedCount} listed images in ${
                    bucketConfig.bucketName || 'the target bucket'
                  } before database release.`
                : 'Sign-off stays locked until Verify Inventory reports a listing that matches the paired frame count.'}
          </p>
        </div>

        {!isSignOffDone ? (
          <button
            onClick={handleSignOffBucket}
            disabled={!inventoryVerified}
            title={inventoryVerified ? undefined : 'Run Verify Inventory and resolve any count mismatch first'}
            className="px-4 py-2 bg-inner border border-subtle hover:border-divider text-text-base font-medium text-xs rounded-lg transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>Approve Bucket Gate</span>
          </button>
        ) : (
          <button
            onClick={onAdvanceToWebGIS}
            className="px-4 py-2 bg-text-base text-card hover:opacity-90 font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-opacity cursor-pointer shrink-0"
          >
            <span>Advance to WebGIS Release</span>
            <ArrowRight size={13} />
          </button>
        )}
      </div>

      {/* Manifest Viewer Modal */}
      {showManifestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-subtle rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
            <div className="p-4 border-b border-divider flex items-center justify-between bg-inner">
              <div>
                <h3 className="text-sm font-bold text-text-base">
                  Frame Manifest (<span className="font-mono">manifest.json</span>)
                </h3>
                <p className="text-[11px] text-text-muted">
                  Layout: {bucketConfig.strategy} • Subgrid: {cleanSg || '—'} •{' '}
                  {(generatedManifest?.enumeratedFrames ?? 0) > 0
                    ? `${generatedManifest?.enumeratedFrames} listed object(s)`
                    : 'no enumerated frames'}{' '}
                  • inventory {inventoryVerified ? 'verified' : 'not verified'}
                </p>
              </div>

              <button
                onClick={() => setShowManifestModal(false)}
                title="Close manifest preview"
                className="p-1 rounded-lg hover:bg-card text-text-muted hover:text-text-base transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto font-mono text-xs text-text-base bg-inner max-h-[60vh]">
              <pre className="whitespace-pre-wrap text-text-base opacity-90">
                {JSON.stringify(generatedManifest || buildManifestObject(), null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

