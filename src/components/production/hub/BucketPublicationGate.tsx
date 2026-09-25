import React, { useState, useEffect, useMemo } from 'react';
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
  X
} from 'lucide-react';
import { SectionLabel, MetaList, TextAction } from '../chrome';
import { supabase } from '../../../services/supabase';
import { resolvePanoramaUrl, resolvePanoramaConfigUrl } from '../../../services/storageUrls';
import { testCloudflareStorageHealth } from '../../../services/api/storage';
import {
  STORAGE_BUCKET_DEFAULT,
  S3_BUCKET_DEFAULT,
  AZURE_CONTAINER_DEFAULT,
  REGION_DEFAULTS
} from '../../../config/defaults';

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
  isGuestUser
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
  const [generatedManifest, setGeneratedManifest] = useState<any | null>(null);
  const [showManifestModal, setShowManifestModal] = useState<boolean>(false);

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
            Target bucket{' '}
            <span className="font-mono text-text-base">
              {bucketConfig.bucketName || 'not configured'}
            </span>
            {' · '}
            {bucketConfig.providerLabel}
            {' · '}
            {bucketConfig.strategyLabel}
            {!hasBatch && ' · no paired frame count from intake'}
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
                  {generatedManifest?.enumeratedFrames > 0
                    ? `${generatedManifest.enumeratedFrames} listed object(s)`
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
