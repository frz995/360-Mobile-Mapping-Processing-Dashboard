// =====================================================================
// Production API Adapter — contract shared with the NAS GPU Worker.
// Modes:
//   'mock' — client-side simulation for development/preview (updates the
//            processing_jobs row directly so the dashboard stays "live").
//   'http' — talks to the on-prem NAS GPU Worker (FastAPI) endpoint.
// See docs/production_worker_api.md for the wire contract.
// =====================================================================

import { updateProcessingJobStatusInSupabase } from '../services/supabase';
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
// Mock simulator registry
// ---------------------------------------------------------------------

interface MockSimulator {
  jobId: string;
  timer: ReturnType<typeof setInterval>;
  aborted: boolean;
}

const activeSimulators = new Map<string, MockSimulator>();

function generateMockFilename(subgrid: string, index: number): string {
  const sg = (subgrid || 'N93E70').toUpperCase().replace(/-/g, '').trim();
  return `${sg}-${String(index).padStart(5, '0')}.jpg`;
}

function mockTotalItems(job: ProcessingJobRecord): number {
  return Math.max(1, job.total_items || 500);
}

function buildMockClient(baseUrl: string) {
  const seededFolders = new Map<string, { fileCount: number; sizeBytes: number; subgrid: string }>();

  const simulate = (job: ProcessingJobRecord): boolean => {
    if (activeSimulators.has(job.id || '')) return false;
    const jobId = job.id || '';
    const total = mockTotalItems(job);
    let progress = 4;
    let completed = 0;
    let errorCount = 0;
    let currentItem = '';

    const outPath = (job.output_folder || '').replace(/\/+$/, '');
    if (outPath) {
      seededFolders.set(outPath, {
        fileCount: total,
        sizeBytes: total * 1_840_000, // ~1.8 MB per 8K panorama
        subgrid: (job.subgrid || 'N93E70').toUpperCase()
      });
    }

    updateProcessingJobStatusInSupabase(jobId, {
      status: 'IN_PROGRESS',
      progress,
      started_at: new Date().toISOString()
    }).catch(() => { });

    const timer = setInterval(async () => {
      const sim = activeSimulators.get(jobId);
      if (!sim || sim.aborted) return;

      progress = Math.min(100, progress + 3 + Math.floor(Math.random() * 7));
      completed = Math.round((progress / 100) * total);
      if (Math.random() < 0.03 && errorCount < total * 0.02) {
        errorCount += 1;
      }
      currentItem = generateMockFilename(job.subgrid || 'N93E70', completed + 1);

      const finished = progress >= 100;
      const status: ProcessingJobStatus = finished
        ? 'COMPLETED'
        : 'IN_PROGRESS';

      await updateProcessingJobStatusInSupabase(jobId, {
        status,
        progress,
        completed_items: Math.min(completed, total),
        current_item: currentItem,
        error_count: errorCount,
        completed_at: finished ? new Date().toISOString() : undefined
      });

      if (finished) {
        clearInterval(timer);
        activeSimulators.delete(jobId);
      }
    }, 750);

    activeSimulators.set(jobId, {
      jobId,
      timer,
      aborted: false
    });
    return true;
  };

  return {
    mode: 'mock' as const,
    baseUrl,
    async submitJob(job: ProcessingJobRecord): Promise<SubmitJobResult> {
      if (!job.id) {
        return { ok: false, message: 'Mock mode requires a job id (persist first).' };
      }
      simulate(job);
      return { ok: true, message: 'Mock worker started (simulated).' };
    },
    async getJobStatus(jobId: string): Promise<WorkerJobStatus | null> {
      const sim = activeSimulators.get(jobId);
      if (!sim) return null;
      return {
        job_id: jobId,
        status: sim.aborted ? 'CANCELLED' : 'IN_PROGRESS',
        progress: 0,
        completed_items: 0,
        total_items: 0,
        finished: false
      };
    },
    async cancelJob(jobId: string): Promise<boolean> {
      const sim = activeSimulators.get(jobId);
      if (!sim) return false;
      sim.aborted = true;
      clearInterval(sim.timer);
      activeSimulators.delete(jobId);
      await updateProcessingJobStatusInSupabase(jobId, {
        status: 'CANCELLED',
        progress: 0
      }).catch(() => { });
      return true;
    },
    async listFolder(path: string): Promise<NasFolderListing | null> {
      const cleanPath = (path || '').replace(/^\/+/, '').replace(/\/+$/, '');
      const seed = seededFolders.get(cleanPath) || seededFolders.get(`/${cleanPath}`);
      if (seed && (cleanPath.includes('/') || cleanPath.length > 0)) {
        const sg = seed.subgrid;
        const names = Array.from({ length: seed.fileCount }, (_, i) =>
          generateMockFilename(sg, i + 1)
        );
        return {
          path: cleanPath,
          entries: [
            ...names.slice(0, 60).map((name) => ({
              name,
              path: `${cleanPath}/${name}`,
              isDirectory: false,
              fileCount: 1,
              sizeBytes: 1_840_000
            })),
            ...(seed.fileCount > 60
              ? [{ name: `+${seed.fileCount - 60} more files`, path: cleanPath, isDirectory: false, fileCount: seed.fileCount - 60, sizeBytes: (seed.fileCount - 60) * 1_840_000 }]
              : [])
          ],
          fileCount: seed.fileCount,
          sizeBytes: seed.sizeBytes
        };
      }
      const TOP_LEVELS: Record<string, { count: number; bytes: number }> = {
        RAW: { count: 1_311_200, bytes: 328_000_000_000 },
        stitchblur: { count: 391_410, bytes: 61_000_000_000 },
        cleaned: { count: 37_020, bytes: 11_800_000_000 },
        deliverables: { count: 600, bytes: 1_200_000_000 }
      };
      const SIMPLE_SUBGRIDS = ['N93E70', 'N93E71', 'N94E70', 'N94E71', 'N92E72'];
      // Subgrid level → frames
      const seg = cleanPath.split('/');
      if (seg.length === 2 && (TOP_LEVELS[seg[0]] || seg[0])) {
        const name = seg[1].toUpperCase();
        const count = 500 + (name.charCodeAt(name.length - 1) % 3) * 250;
        const names = Array.from({ length: Math.min(count, 120) }, (_, i) => generateMockFilename(name, i + 1));
        const more = count > 120 ? count - 120 : 0;
        return {
          path: cleanPath,
          entries: [
            ...names.map((n) => ({ name: n, path: `${cleanPath}/${n}`, isDirectory: false, fileCount: 1, sizeBytes: 1_840_000 })),
            ...(more > 0 ? [{ name: `+${more} more files`, path: cleanPath, isDirectory: false, fileCount: more, sizeBytes: more * 1_840_000 }] : [])
          ],
          fileCount: count,
          sizeBytes: count * 1_840_000
        };
      }
      // Top level → subgrid folders
      if (TOP_LEVELS[seg[0]] && seg.length === 1) {
        const meta = TOP_LEVELS[seg[0]];
        const per = Math.max(1, Math.round(meta.count / SIMPLE_SUBGRIDS.length));
        return {
          path: cleanPath,
          entries: SIMPLE_SUBGRIDS.map((sg) => ({
            name: sg,
            path: `${cleanPath}/${sg}`,
            isDirectory: true,
            fileCount: per,
            sizeBytes: Math.round(meta.bytes / SIMPLE_SUBGRIDS.length)
          })),
          fileCount: meta.count,
          sizeBytes: meta.bytes
        };
      }
      // Deterministic sample NAS layout for development + folder-picker demo.
      return {
        path: cleanPath || baseUrl,
        entries: [
          { name: 'RAW', path: 'RAW', isDirectory: true, fileCount: 1_311_200, sizeBytes: 328_000_000_000 },
          { name: 'stitchblur', path: 'stitchblur', isDirectory: true, fileCount: 391_410, sizeBytes: 61_000_000_000 },
          { name: 'cleaned', path: 'cleaned', isDirectory: true, fileCount: 37_020, sizeBytes: 11_800_000_000 },
          { name: 'deliverables', path: 'deliverables', isDirectory: true, fileCount: 600, sizeBytes: 1_200_000_000 },
          { name: 'README.txt', path: 'README.txt', isDirectory: false, fileCount: 1, sizeBytes: 128 }
        ],
        fileCount: 1_740_230,
        sizeBytes: 402_000_000_000
      };
    },
    async getStorageInfo(): Promise<StorageInfo | null> {
      const rawBytes = 618_000_000_000; // ~576 GiB demo volume
      const usedBytes = 402_000_000_000;
      return {
        base_path: baseUrl,
        total: rawBytes,
        used: usedBytes,
        free: rawBytes - usedBytes,
        files: 1_740_230,
        folders: 4_822,
        per_top_level: [
          { name: 'RAW', files: 1_311_200, bytes: 328_000_000_000, folders: 2_401 },
          { name: 'stitchblur', files: 391_410, bytes: 61_000_000_000, folders: 1_130 },
          { name: 'cleaned', files: 37_020, bytes: 11_800_000_000, folders: 1_124 },
          { name: 'deliverables', files: 600, bytes: 1_200_000_000, folders: 167 }
        ],
        source: 'mock'
      };
    },
    async getHealth(): Promise<WorkerHealthInfo | null> {
      return { status: 'ok', jobs_active: activeSimulators.size, nas_base: baseUrl };
    }
  };
}

// ---------------------------------------------------------------------
// HTTP client for the NAS GPU Worker (FastAPI)
// ---------------------------------------------------------------------

function buildHttpClient(baseUrl: string) {
  const cleanBase = (baseUrl || '').replace(/\/+$/, '');
  const api = (path: string, init?: RequestInit) =>
    fetch(`${cleanBase}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
    });

  return {
    mode: 'http' as const,
    baseUrl: cleanBase,
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
            settings: job.settings || {}
          })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, message: body.detail || `HTTP ${res.status}` };
        return { ok: true, message: body.message || 'Job submitted to NAS GPU Worker.' };
      } catch (err) {
        return {
          ok: false,
          message: `Unable to reach NAS GPU Worker at ${cleanBase}: ${err instanceof Error ? err.message : String(err)}`
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
        if (!res.ok) return null;
        return (await res.json()) as NasFolderListing;
      } catch {
        return null;
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
  return settings.mode === 'http'
    ? buildHttpClient(settings.baseUrl)
    : buildMockClient(settings.nasWorkBasePath || '//nas/360_images');
}

export { activeSimulators as mockSimulatorRegistry };