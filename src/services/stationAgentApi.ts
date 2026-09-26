// =====================================================================
// Station Agent API — probes the per-PC station agents (PC 1-4) that
// power the 4-PC Multi-Station Flight Board's auto mode.
// Wire contract: station-agent/README.md + docs/production_worker_api.md
// (health section). LAN HTTP, same pattern as WorkerMonitorPanel.
// =====================================================================

import type {
  StationAgentObservation,
  StationAgentReport,
  WorkstationStationConfig,
  WorkerHealthInfo
} from '../types/production';
import { diagnoseStationAgentTransport, stationAgentTransportMode } from '../config/transport';
import { fetchDashboardApi } from './cloudflareApi';

const DEFAULT_TIMEOUT_MS = 4_000;

export interface StationAgentProbeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function stationBaseUrl(ws: WorkstationStationConfig): string {
  const ip = (ws.ipAddress || '').trim();
  return `http://${ip}:${ws.port || 8000}`;
}

const usesPagesProxy = (): boolean => stationAgentTransportMode() === 'proxy';

function stationProxyUrl(ws: WorkstationStationConfig, resource: string, jobId?: string): string {
  const params = new URLSearchParams({ stationId: ws.id, resource });
  if (jobId) params.set('jobId', jobId);
  return `/api/station-agent?${params.toString()}`;
}

async function stationFetch(
  ws: WorkstationStationConfig,
  resource: string,
  directPath: string,
  init: RequestInit = {},
  opts?: StationAgentProbeOptions,
  jobId?: string
): Promise<Response> {
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = opts?.signal ?? AbortSignal.timeout(timeout);
  const proxy = usesPagesProxy();
  const headers = new Headers(init.headers || {});
  if (!proxy && ws.agentToken) headers.set('Authorization', `Bearer ${ws.agentToken}`);
  const url = proxy ? stationProxyUrl(ws, resource, jobId) : `${stationBaseUrl(ws)}${directPath}`;
  const request = { ...init, signal, headers };
  return proxy ? fetchDashboardApi(url, request) : fetch(url, request);
}

async function getJson<T>(
  ws: WorkstationStationConfig,
  resource: string,
  directPath: string,
  opts?: StationAgentProbeOptions
): Promise<T | null> {
  try {
    const res = await stationFetch(ws, resource, directPath, { method: 'GET' }, opts);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Probe one station agent: /health plus /api/station (auto-detect payload).
 *
 *  A failed probe always carries a `reason`, so the UI can distinguish "nobody
 *  configured an address" from "the agent is down" from "this build cannot
 *  reach a private IP" — previously all three looked identical. */
export async function probeStationAgent(
  ws: WorkstationStationConfig,
  opts?: StationAgentProbeOptions
): Promise<StationAgentObservation> {
  const base: StationAgentObservation = {
    stationId: ws.id,
    online: false,
    lastProbeAt: new Date().toISOString(),
    health: null,
    report: null
  };

  if (ws.enabled === false) {
    return { ...base, reason: 'disabled', error: 'Station is disabled' };
  }

  const diagnosis = diagnoseStationAgentTransport(Boolean((ws.ipAddress || '').trim()));
  if (diagnosis.problem) {
    return {
      ...base,
      reason: diagnosis.problem,
      error: diagnosis.detail || 'Station agent transport is not configured'
    };
  }

  try {
    const [health, report] = await Promise.all([
      getJson<WorkerHealthInfo>(ws, 'health', '/health', opts),
      getJson<StationAgentReport>(ws, 'report', '/api/station', opts)
    ]);
    if (!report) {
      // /health answering while /api/station does not is a distinct, actionable
      // fault: the agent is alive but cannot inspect its NAS mount.
      return health
        ? {
            ...base,
            health,
            reason: 'not-reporting',
            error:
              'Agent health responded but /api/station did not. Check the agent version and that its NAS mount is reachable.'
          }
        : {
            ...base,
            reason: 'unreachable',
            error:
              'Agent unreachable. Check the PC is powered on, the agent service is running, and that this network can route to it.'
          };
    }
    return { ...base, online: true, health, report };
  } catch (err) {
    return {
      ...base,
      reason: 'unreachable',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/** Probe every configured workstation once (sequential round, LAN-keyed).
 *
 *  Disabled and unconfigured stations are still probed so the caller receives a
 *  reason for each — filtering them out here is what previously made a station
 *  vanish from the board with no explanation. */
export async function probeAllStationAgents(
  workstations: WorkstationStationConfig[] | undefined,
  opts?: StationAgentProbeOptions
): Promise<Record<string, StationAgentObservation>> {
  const list = (workstations || []).filter((w) => w.enabled !== false);
  if (list.length === 0) return {};
  const results = await Promise.all(list.map((ws) => probeStationAgent(ws, opts)));
  const map: Record<string, StationAgentObservation> = {};
  results.forEach((r) => {
    map[r.stationId] = r;
  });
  return map;
}

export interface NasRenameItem {
  src: string;
  dst: string;
}

export interface NasRenameResult {
  ok: boolean;
  message?: string;
  renamed?: number;
  skipped?: Array<{ src: string; reason: string }>;
  missing?: string[];
  total?: number;
}

/** POST /api/rename — batch-rename files inside a WATCH_ROOT-relative folder
 * via the target station's agent. Returns null when the agent is unreachable. */
export async function renameNasFilesOnStation(
  ws: WorkstationStationConfig,
  stageDir: string,
  renames: NasRenameItem[],
  opts?: StationAgentProbeOptions
): Promise<NasRenameResult | null> {
  if ((!usesPagesProxy() && !ws.ipAddress) || ws.enabled === false || renames.length === 0) return null;
  const timeout = opts?.timeoutMs ?? Math.max(20_000, renames.length * 300);
  try {
    const res = await stationFetch(ws, 'rename', '/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_dir: stageDir, renames })
    }, { ...opts, timeoutMs: timeout });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: body?.detail || `HTTP ${res.status}` };
    }
    return (await res.json()) as NasRenameResult;
  } catch {
    return null;
  }
}

export interface BucketSyncJobRequest {
  provider: 'r2' | 's3' | 'wasabi' | 'gcs' | 'azure' | 'supabase_cli' | 'nas_local';
  stageDir: string;
  subgrid: string;
  bucket?: string;
  region?: string;
  account?: string;
  endpoint?: string;
  includeManifest?: boolean;
}

export interface BucketSyncJobStatus {
  ok: boolean;
  job_id: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  command_desc: string;
  lines: string[];
  line_count: number;
  exit_code?: number | null;
  error?: string | null;
}

/** POST /api/sync-bucket — start the provider CLI sync on the station PC. */
export async function startBucketSyncJob(
  ws: WorkstationStationConfig,
  req: BucketSyncJobRequest,
  opts?: StationAgentProbeOptions
): Promise<BucketSyncJobStatus | { ok: false; message: string } | null> {
  if ((!usesPagesProxy() && !ws.ipAddress) || ws.enabled === false) return null;
  try {
    const res = await stationFetch(ws, 'sync-start', '/api/sync-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: req.provider,
        stage_dir: req.stageDir,
        subgrid: req.subgrid,
        bucket: req.bucket || '',
        region: req.region,
        account: req.account,
        endpoint: req.endpoint,
        include_manifest: req.includeManifest !== false
      })
    }, { ...opts, timeoutMs: opts?.timeoutMs ?? 10_000 });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, message: body?.detail || `HTTP ${res.status}` };
    }
    return (await res.json()) as BucketSyncJobStatus;
  } catch {
    return null;
  }
}

/** GET /api/sync-bucket/{id} — poll a running CLI sync job. */
export async function pollBucketSyncJob(
  ws: WorkstationStationConfig,
  jobId: string,
  opts?: StationAgentProbeOptions
): Promise<BucketSyncJobStatus | null> {
  if ((!usesPagesProxy() && !ws.ipAddress) || ws.enabled === false) return null;
  try {
    const res = await stationFetch(ws, 'sync-poll', `/api/sync-bucket/${jobId}`, { method: 'GET' }, { ...opts, timeoutMs: opts?.timeoutMs ?? 5_000 }, jobId);
    if (!res.ok) return null;
    return (await res.json()) as BucketSyncJobStatus;
  } catch {
    return null;
  }
}
