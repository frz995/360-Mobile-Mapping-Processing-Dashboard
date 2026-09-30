// =====================================================================
// Production API Adapter — contract shared with the NAS GPU Worker.
// Connects dynamically to the on-prem NAS GPU Worker (FastAPI) endpoint.
// Zero hardcoded sample files: all folder listings, jobs and telemetry
// are queried live from the active NAS filesystem and worker daemon.
// See docs/production_worker_api.md for the wire contract.
// =====================================================================

import type {
  NasFolderListing,
  ProductionApiSettings,
  StorageInfo,
  WorkerHealthInfo
} from '../types/production';
import { workerProxyAvailable, workerTransportMode } from '../config/transport';
import { supabase } from './api/client';
import { fetchDashboardApi } from './cloudflareApi';

export interface ProductionApiClient {
  readonly mode: 'http';
  readonly baseUrl: string;
  listFolder(path: string): Promise<NasFolderListing | null>;
  getStorageInfo(): Promise<StorageInfo | null>;
  getHealth(): Promise<WorkerHealthInfo | null>;
}

// ---------------------------------------------------------------------
// HTTP client for the NAS GPU Worker (FastAPI)
// ---------------------------------------------------------------------

function buildHttpClient(settings: ProductionApiSettings): ProductionApiClient {
  // One code path for local and cloud: the worker is a single service behind a
  // single proxy, so dev and production differ only in where the proxy
  // terminates (Vite vs Pages Functions). See src/config/transport.ts.
  const useProxy = workerTransportMode() === 'proxy';
  const baseUrl = useProxy ? '/api/worker' : (settings.baseUrl || '').replace(/\/+$/, '');
  const apiKey = settings.apiKey || '';
  // The BFF gateway authorizes via the caller's Supabase access token (it
  // resolves the app role from user_accounts); a direct worker connection
  // uses the shared productionApiKey secret instead. Session token wins when
  // no static key is configured, so BFF-routed deployments stay authenticated.
  const authHeaders = async (): Promise<Record<string, string>> => {
    if (apiKey) return { Authorization: `Bearer ${apiKey}` };
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  };
  const api = async (path: string, init?: RequestInit): Promise<Response> => {
    if (useProxy && !workerProxyAvailable()) {
      // Fail loudly instead of issuing a same-origin request that can only 404.
      throw new Error(
        'Worker proxy is not configured. Set NAS_API_URL and NAS_WORKER_TOKEN in .env ' +
          '(local dev), or point VITE_WORKER_API_MODE=direct at a reachable worker URL.'
      );
    }
    if (!baseUrl) throw new Error('Worker URL not configured');
    if (useProxy) {
      return fetchDashboardApi(`${baseUrl}${path}`, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(10_000),
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {})
        }
      });
    }
    const auth = await authHeaders();
    return fetch(`${baseUrl}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(10_000),
      headers: {
        'Content-Type': 'application/json',
        ...auth,
        ...(init?.headers || {})
      }
    });
  };

  return {
    mode: 'http' as const,
    baseUrl,
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
  return buildHttpClient({ ...settings, baseUrl: settings.baseUrl || '' });
}
