import React, { useEffect, useState } from 'react';
import {
  Activity,
  HardDrive,
  Wifi,
  WifiOff,
  Server,
  Loader2,
  Database,
  CheckCircle2
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

  const workerOnline = api.mode === 'mock' ? true : !!health;
  const workerUrl = api.mode === 'mock' ? (api.baseUrl || '//nas/360_images') : api.baseUrl;
  const used = storage?.used || 0;
  const total = storage?.total || 0;
  const free = storage?.free || 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Connectivity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-inner border border-subtle rounded-xl p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
              <Server size={15} className="text-sky-400" /> NAS GPU Worker API
            </div>
            {loading ? (
              <Loader2 size={14} className="animate-spin text-text-muted" />
            ) : workerOnline ? (
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300">
                <Wifi size={13} /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[11px] font-bold text-rose-300">
                <WifiOff size={13} /> Unreachable
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted mt-1.5 font-mono break-all">{workerUrl}</p>
          {health && (
            <div className="text-[11px] text-text-muted mt-2 flex items-center gap-1.5">
              <span className="text-emerald-300 font-semibold">{health.status}</span> ·
              <Activity size={12} /> {health.jobs_active} active job(s) · NAS mount:{" "}
              <span className="font-mono">{health.nas_base}</span>
            </div>
          )}
          {error && <p className="text-[11px] text-amber-300 mt-2">{error}</p>}
        </div>

        <div className="bg-inner border border-subtle rounded-xl p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
              <HardDrive size={15} className="text-sky-400" /> NAS Server (browser previews)
            </div>
            <span className={`text-[11px] font-bold ${(projectSettings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL) ? 'text-emerald-300' : 'text-amber-300'}`}>
              {projectSettings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL ? 'Configured' : 'Not set'}
            </span>
          </div>
          <p className="text-[11px] text-text-muted mt-1.5 font-mono break-all">
            {projectSettings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL || '—'}
          </p>
          <p className="text-[11px] text-text-muted mt-2">
            Direct image URLs. Must send CORS headers, or use the worker <span className="font-mono">/api/images</span> passthrough.
          </p>
        </div>
      </div>

      {/* Capacity */}
      <div className="bg-inner border border-subtle rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
            <Database size={15} className="text-sky-400" /> Capacity
          </div>
          <span className="text-[11px] text-text-muted font-mono">
            {storage ? storage.base_path : (projectSettings?.nasWorkBasePath || '—')}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-text-muted py-4">
            <Loader2 size={13} className="animate-spin" /> Querying worker for disk usage…
          </div>
        ) : storage ? (
          <>
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-text-muted mb-1">
                <span>
                  Used <span className="text-text-base font-semibold">{formatBytes(used)}</span> of{" "}
                  {formatBytes(total)}
                </span>
                <span className="font-mono">{pct(used, total).toFixed(1)}%</span>
              </div>
              <div className="h-2.5 bg-black/40 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct(used, total)}%`,
                    background: pct(used, total) > 90 ? '#f43f5e' : pct(used, total) > 75 ? '#f59e0b' : 'linear-gradient(90deg,#38bdf8,#0ea5e9)'
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-text-muted mt-2">
                <span>
                  Free <span className="text-emerald-300 font-semibold">{formatBytes(free)}</span>
                </span>
                <span>
                  Files <span className="text-text-base font-semibold">{storage.files?.toLocaleString?.() || storage.files}</span> · Folders{" "}
                  <span className="text-text-base font-semibold">{storage.folders?.toLocaleString?.() || storage.folders}</span>
                </span>
              </div>
            </div>

            {storage.per_top_level && storage.per_top_level.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="text-text-muted uppercase tracking-wide text-[10px]">
                      <th className="py-1.5 pr-2">Top-level folder</th>
                      <th className="py-1.5 pr-2 text-right">Files</th>
                      <th className="py-1.5 pr-2 text-right">Folders</th>
                      <th className="py-1.5 text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storage.per_top_level.map((row) => (
                      <tr key={row.name} className="border-t border-subtle">
                        <td className="py-1.5 pr-2 font-mono text-sky-300">{row.name}/</td>
                        <td className="py-1.5 pr-2 text-right text-text-muted">{row.files?.toLocaleString?.() || row.files}</td>
                        <td className="py-1.5 pr-2 text-right text-text-muted">{row.folders?.toLocaleString?.() || row.folders}</td>
                        <td className="py-1.5 text-right text-text-base">{formatBytes(row.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-amber-300 mt-2">
            Storage info unavailable — worker not reachable or <span className="font-mono">/api/storage</span> not exposed.
          </p>
        )}
      </div>

      {/* Dataset index summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        {[
          { label: 'RAW', count: rawCount, color: 'text-amber-300' },
          { label: 'PROCESSED', count: processedCount, color: 'text-sky-300' },
          { label: 'DELIVERABLE', count: deliverableCount, color: 'text-emerald-300' },
          { label: 'TOTAL', count: datasets.length, color: 'text-text-base' }
        ].map((k) => (
          <div key={k.label} className="bg-inner border border-subtle rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 size={16} className={k.color} />
            <div>
              <div className={`text-lg font-bold leading-none ${k.color}`}>{k.count}</div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mt-1">{k.label} datasets</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};