import React, { useEffect, useState } from 'react';
import {
  Activity,
  HardDrive,
  Server,
  Loader2,
  Database,
  RefreshCw,
  FolderTree
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { DatasetRecord, StorageInfo, WorkerHealthInfo } from '../../../types/production';
import { formatBytes, pct } from './storageCommon';

export interface OverviewPanelProps {
  api: ProductionApiClient;
  projectSettings: any;
  datasets: DatasetRecord[];
  translate: (key: string) => string;
}

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  api,
  projectSettings,
  datasets
}) => {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [health, setHealth] = useState<WorkerHealthInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    setError('');
    Promise.all([api.getStorageInfo(), api.getHealth()])
      .then(([s, h]) => {
        if (s) setStorage(s);
        if (s?.error) setError(s.error);
        if (h) setHealth(h);
      })
      .catch(() => {
        setError('Failed to query storage info.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([api.getStorageInfo(), api.getHealth()])
      .then(([s, h]) => {
        if (!mounted) return;
        if (s) setStorage(s);
        if (s?.error) setError(s.error);
        if (h) setHealth(h);
      })
      .catch(() => {
        if (mounted) setError('Failed to query storage info.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [api]);

  const rawCount = datasets.filter((d) => d.dataset_type === 'RAW').length;
  const processedCount = datasets.filter((d) => d.dataset_type === 'PROCESSED').length;
  const deliverableCount = datasets.filter((d) => d.dataset_type === 'DELIVERABLE').length;

  const workerOnline = !!health && health.status === 'ok';
  const workerUrl = api.baseUrl || 'http://localhost:8000';
  const used = storage?.used || 0;
  const total = storage?.total || 0;
  const free = storage?.free || 0;

  return (
    <div className="space-y-4 animate-in fade-in font-sans">
      {/* 1. Header with bottom divider line matching RBAC */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
        <div>
          <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
            <Server size={16} className="text-sky-400" />
            NAS Storage &amp; Worker Telemetry
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Real-time NAS volume health, daemon connectivity, storage quotas, and catalog index.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="px-3 py-1.5 bg-inner hover:bg-card border border-subtle rounded-lg text-xs font-semibold text-text-base flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span>Check Connectivity</span>
          </button>
        </div>
      </div>

      {/* 2. Service Endpoints & Daemon Connectivity Table (RBAC line style) */}
      <div className="border border-subtle rounded-lg overflow-x-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle">
              <th className="px-3.5 py-2.5">Service / Node</th>
              <th className="px-3.5 py-2.5">Endpoint URL / Mount</th>
              <th className="px-3.5 py-2.5">Operational Details</th>
              <th className="px-3.5 py-2.5 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/80">
            {/* Row 1: GPU Worker */}
            <tr className="hover:bg-inner transition-colors">
              <td className="px-3.5 py-2.5 font-semibold text-text-base flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-inner border border-subtle flex items-center justify-center text-sky-400">
                  <Activity size={12} />
                </div>
                <span>NAS GPU Worker API</span>
              </td>
              <td className="px-3.5 py-2.5 font-mono text-[11px] text-zinc-300">
                {workerUrl}
              </td>
              <td className="px-3.5 py-2.5 text-text-muted text-[11px]">
                {health ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-emerald-400 font-semibold">{health.jobs_active} active job(s)</span>
                    <span>·</span>
                    <span>Mount: <span className="font-mono text-zinc-200">{health.nas_base}</span></span>
                  </span>
                ) : error ? (
                  <span className="text-amber-400">{error}</span>
                ) : (
                  <span>Headless CUDA &amp; processing engine daemon</span>
                )}
              </td>
              <td className="px-3.5 py-2.5 text-right">
                {loading ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">
                    <Loader2 size={11} className="animate-spin" /> Checking
                  </span>
                ) : workerOnline ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Online
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border border-rose-500/40 bg-rose-500/10 text-rose-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Unreachable
                  </span>
                )}
              </td>
            </tr>

            {/* Row 2: NAS Preview Server */}
            <tr className="hover:bg-inner transition-colors">
              <td className="px-3.5 py-2.5 font-semibold text-text-base flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-inner border border-subtle flex items-center justify-center text-sky-400">
                  <HardDrive size={12} />
                </div>
                <span>NAS Server (Browser Previews)</span>
              </td>
              <td className="px-3.5 py-2.5 font-mono text-[11px] text-zinc-300">
                {projectSettings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL || '—'}
              </td>
              <td className="px-3.5 py-2.5 text-text-muted text-[11px]">
                Direct image URLs (supports CORS or worker <span className="font-mono text-zinc-300">/api/images</span> pass-through)
              </td>
              <td className="px-3.5 py-2.5 text-right">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border ${
                  (projectSettings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL)
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-subtle bg-inner text-text-muted'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    (projectSettings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL) ? 'bg-emerald-400' : 'bg-zinc-500'
                  }`} />
                  {(projectSettings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL) ? 'Configured' : 'Standby'}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Volume Capacity & Quota Section with clean table & line styling */}
      <div className="border border-subtle rounded-lg overflow-hidden flex flex-col">
        <div className="px-3.5 py-2.5 bg-app border-b border-subtle flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-text-base text-xs font-bold">
            <Database size={14} className="text-sky-400" />
            <span>Volume Capacity &amp; Directory Quota</span>
          </div>
          <div className="text-[11px] font-mono text-text-muted">
            Mount: <span className="text-zinc-200">{storage ? storage.base_path : (projectSettings?.nasWorkBasePath || '—')}</span>
          </div>
        </div>

        {/* Progress Bar and Summary */}
        <div className="p-3.5 bg-inner/40 border-b border-subtle">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-text-muted py-2">
              <Loader2 size={13} className="animate-spin" /> Querying worker for disk usage…
            </div>
          ) : storage ? (
            <div>
              <div className="flex items-center justify-between text-xs text-text-muted mb-1.5">
                <span>
                  Used <strong className="text-text-base font-semibold">{formatBytes(used)}</strong> of{" "}
                  <strong className="text-text-base font-semibold">{formatBytes(total)}</strong>
                </span>
                <span className="font-mono text-zinc-200 font-semibold">{pct(used, total).toFixed(1)}% Allocated</span>
              </div>
              <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct(used, total)}%`,
                    background: pct(used, total) > 90 ? '#f43f5e' : pct(used, total) > 75 ? '#f59e0b' : '#38bdf8'
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-text-muted mt-2">
                <span>
                  Free Space: <strong className="text-emerald-300 font-semibold">{formatBytes(free)}</strong>
                </span>
                <span>
                  Files: <strong className="text-text-base font-semibold">{storage.files?.toLocaleString?.() || storage.files || 0}</strong> · Folders:{" "}
                  <strong className="text-text-base font-semibold">{storage.folders?.toLocaleString?.() || storage.folders || 0}</strong>
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-300 py-1">
              Storage info unavailable — worker not reachable or /api/storage not exposed.
            </p>
          )}
        </div>

        {/* Top-Level Directory Breakdown Table */}
        {storage?.per_top_level && storage.per_top_level.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle">
                  <th className="px-3.5 py-2">Top-Level Folder</th>
                  <th className="px-3.5 py-2 text-right">Files</th>
                  <th className="px-3.5 py-2 text-right">Folders</th>
                  <th className="px-3.5 py-2 text-right">Total Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle/80 font-mono text-[11px]">
                {storage.per_top_level.map((row) => (
                  <tr key={row.name} className="hover:bg-inner transition-colors">
                    <td className="px-3.5 py-2 text-sky-300 font-semibold flex items-center gap-1.5">
                      <FolderTree size={12} className="text-zinc-500" />
                      <span>{row.name}/</span>
                    </td>
                    <td className="px-3.5 py-2 text-right text-text-muted">{row.files?.toLocaleString?.() || row.files}</td>
                    <td className="px-3.5 py-2 text-right text-text-muted">{row.folders?.toLocaleString?.() || row.folders}</td>
                    <td className="px-3.5 py-2 text-right text-text-base font-semibold">{formatBytes(row.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Dataset Catalog Telemetry Strip */}
      <div className="border border-subtle rounded-lg px-4 py-2.5 bg-inner/40 text-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted">
            Datasets Catalog:
          </span>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span>
              <span className="text-text-muted">RAW: </span>
              <strong className="text-text-base font-semibold">{rawCount}</strong>
            </span>
            <span className="text-text-muted">·</span>
            <span>
              <span className="text-text-muted">Processed: </span>
              <strong className="text-text-base font-semibold">{processedCount}</strong>
            </span>
            <span className="text-text-muted">·</span>
            <span>
              <span className="text-text-muted">Deliverable: </span>
              <strong className="text-text-base font-semibold">{deliverableCount}</strong>
            </span>
          </div>
        </div>
        <div className="text-xs font-mono">
          <span className="text-text-muted">Total Indexed: </span>
          <strong className="text-sky-300 font-semibold">{datasets.length}</strong>
        </div>
      </div>
    </div>
  );
};