// =====================================================================
// Production API Adapter — contract shared with the NAS GPU Worker.
// Connects dynamically to the on-prem NAS GPU Worker (FastAPI) endpoint.
// Zero hardcoded sample files: all folder listings, jobs and telemetry
// are queried live from the active NAS filesystem and worker daemon.
// See docs/production_worker_api.md for the wire contract.
// =====================================================================

import type {
  NasFolderListing,
  ProcessingJobRecord,
  ProcessingJobStatus,
  ProductionApiSettings,
  StorageInfo,
  WorkerHealthInfo
} from '../types/production';

export interface SubmitJobResult {
  ok: boolean;
  message: string;
}

export interface WorkerJobStatus {
  job_id: string;
  status: ProcessingJobStatus;
  progress: number;
  completed_items: number;
  total_items: number;
  current_item?: string;
  error_count?: number;
  message?: string;
  failed_items?: string[];
  error_log?: Array<{ at: string; message: string }>;
  last_heartbeat?: string | null;
  worker?: string;
  finished: boolean;
}

export interface ProductionApiClient {
  readonly mode: 'mock' | 'http';
  readonly baseUrl: string;
  submitJob(job: ProcessingJobRecord): Promise<SubmitJobResult>;
  getJobStatus(jobId: string): Promise<WorkerJobStatus | null>;
  cancelJob(jobId: string): Promise<boolean>;
  listFolder(path: string): Promise<NasFolderListing | null>;
  getStorageInfo(): Promise<StorageInfo | null>;
  getHealth(): Promise<WorkerHealthInfo | null>;
}

// ---------------------------------------------------------------------
// HTTP client for the NAS GPU Worker (FastAPI)
// ---------------------------------------------------------------------

function buildHttpClient(settings: ProductionApiSettings): ProductionApiClient {
  const baseUrl = (settings.baseUrl || 'http://localhost:8000').replace(/\/+$/, '');
  const apiKey = settings.apiKey || '';
  const api = (path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(init?.headers || {})
      }
    });

  return {
    mode: 'http' as const,
    baseUrl,
    async submitJob(job: ProcessingJobRecord): Promise<SubmitJobResult> {
      try {
        const res = await api('/api/jobs', {
          method: 'POST',
          body: JSON.stringify({
            job_id: job.id,
            job_type: job.job_type,
            source_folder: job.source_folder,
            output_folder: job.output_folder,
            subgrid: job.subgrid,
            total_items: job.total_items || 0,
            settings: job.settings || {}
          })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, message: body.detail || `HTTP ${res.status}` };
        return { ok: true, message: body.message || 'Job submitted to NAS GPU Worker.' };
      } catch (err) {
        return {
          ok: false,
          message: `Unable to reach NAS GPU Worker at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    },
    async getJobStatus(jobId: string): Promise<WorkerJobStatus | null> {
      try {
        const res = await api(`/api/jobs/${jobId}`);
        if (!res.ok) return null;
        const body = await res.json();
        return body as WorkerJobStatus;
      } catch {
        return null;
      }
    },
    async cancelJob(jobId: string): Promise<boolean> {
      try {
        const res = await api(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
        return res.ok;
      } catch {
        return false;
      }
    },
    async listFolder(path: string): Promise<NasFolderListing | null> {
      try {
        const res = await api(`/api/folders?path=${encodeURIComponent(path || '')}`);
        if (!res.ok) {
          return { path: path || '', entries: [], fileCount: 0, sizeBytes: 0, error: `Folder not found or inaccessible (${res.status})` };
        }
        return (await res.json()) as NasFolderListing;
      } catch (err) {
        return { path: path || '', entries: [], fileCount: 0, sizeBytes: 0, error: String(err) };
      }
    },
    async getStorageInfo(): Promise<StorageInfo | null> {
      try {
        const res = await api('/api/storage');
        if (!res.ok) return null;
        return (await res.json()) as StorageInfo;
      } catch {
        return null;
      }
    },
    async getHealth(): Promise<WorkerHealthInfo | null> {
      try {
        const res = await api('/health');
        if (!res.ok) return null;
        return (await res.json()) as WorkerHealthInfo;
      } catch {
        return null;
      }
    }
  };
}

export function createProductionApiClient(settings: ProductionApiSettings): ProductionApiClient {
  const baseUrl =
    settings.baseUrl ||
    (typeof window !== 'undefined' && (window as any).__NAS_WORKER_URL__) ||
    'http://localhost:8000';
  return buildHttpClient({ ...settings, baseUrl });
}
