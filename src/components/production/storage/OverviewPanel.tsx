import React, { useEffect, useState } from 'react';
import {
  Activity,
  HardDrive,
  Server,
  Loader2,
  Database,
  RefreshCw,
  FolderTree,
  Settings2,
  Check
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { DatasetRecord, StorageInfo, WorkerHealthInfo } from '../../../types/production';
import { formatBytes, pct } from './storageCommon';
import { TextAction, StatusDot } from '../chrome';

export interface OverviewPanelProps {
  api: ProductionApiClient;
  projectSettings: any;
  setProjectSettings?: React.Dispatch<React.SetStateAction<any>>;
  addNotification?: (item: any) => void;
  datasets: DatasetRecord[];
  translate: (key: string) => string;
}

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  api,
  projectSettings,
  setProjectSettings,
  addNotification,
  datasets
}) => {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [health, setHealth] = useState<WorkerHealthInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Configuration Modal state
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [draftApiUrl, setDraftApiUrl] = useState(() => projectSettings?.productionApiUrl || '');
  const [draftMountPath, setDraftMountPath] = useState(() => projectSettings?.nasWorkBasePath || '');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // Keep draft state in sync when projectSettings update
  useEffect(() => {
    if (projectSettings?.productionApiUrl) {
      setDraftApiUrl(projectSettings.productionApiUrl);
    }
    if (projectSettings?.nasWorkBasePath) {
      setDraftMountPath(projectSettings.nasWorkBasePath);
    }
  }, [projectSettings]);

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

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    const targetUrl = draftApiUrl.trim().replace(/\/+$/, '');
    if (!targetUrl) {
      setTestStatus('error');
      setTestMessage('No endpoint URL entered');
      return;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${targetUrl}/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        setTestStatus('success');
        setTestMessage(`Responded ${res.status}`);
      } else {
        setTestStatus('error');
        setTestMessage(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(err.name === 'AbortError' ? 'Connection timed out' : 'Endpoint unreachable');
    }
  };

  const handleSaveConfig = () => {
    const cleanUrl = draftApiUrl.trim();
    const cleanMount = draftMountPath.trim();

    if (setProjectSettings) {
      setProjectSettings((prev: any) => ({
        ...(prev || {}),
        productionApiUrl: cleanUrl,
        nasWorkBasePath: cleanMount
      }));
    }

    addNotification?.({
      type: 'success',
      title: 'Configuration Saved',
      message: 'Service endpoint URL and storage mount base updated.'
    });

    setIsConfigOpen(false);
    setTimeout(loadData, 400);
  };

  const rawCount = datasets.filter((d) => d.dataset_type === 'RAW').length;
  const processedCount = datasets.filter((d) => d.dataset_type === 'PROCESSED').length;
  const deliverableCount = datasets.filter((d) => d.dataset_type === 'DELIVERABLE').length;

  const workerOnline = !!health && health.status === 'ok';
  const workerUrl = projectSettings?.productionApiUrl || api.baseUrl || 'Not configured';
  const mountPath = storage?.base_path || projectSettings?.nasWorkBasePath || '';
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
            NAS &amp; Daemon Telemetry
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Real-time NAS volume health, daemon connectivity, storage quotas, and catalog index.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsConfigOpen(true)}
            className="px-3 py-1.5 bg-text-base text-card hover:opacity-90 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
          >
            <Settings2 size={13} />
            <span>Configure Endpoints</span>
          </button>
          <TextAction
            icon={<RefreshCw size={11} className={loading ? 'animate-spin' : ''} />}
            onClick={loadData}
            disabled={loading}
            title="Re-query storage info and worker health"
          >
            Refresh
          </TextAction>
        </div>
      </div>

      {/* 2. Service Endpoints & Daemon Connectivity Table (RBAC line style) */}
      <div className="border border-subtle rounded-lg overflow-x-auto">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle">
              <th className="px-3.5 py-2.5">Service / Node</th>
              <th className="px-3.5 py-2.5">Protocol &amp; Address / Mount</th>
              <th className="px-3.5 py-2.5">Operational Details</th>
              <th className="px-3.5 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/80">
            {/* Row 1: The Actual NAS Storage Volume */}
            <tr className="hover:bg-inner transition-colors">
              <td className="px-3.5 py-2.5 font-semibold text-text-base">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-inner border border-subtle flex items-center justify-center text-zinc-300 shrink-0">
                    <HardDrive size={12} />
                  </div>
                  <div>
                    <span className="font-bold">NAS Network Storage Volume</span>
                    <div className="text-[10px] font-normal text-text-muted">
                      Filesystem mount · primary shared storage for PC 1–4 workstations
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3.5 py-2.5">
                <span className="font-mono text-[11px] text-zinc-200">
                  {mountPath || 'Not configured'}
                </span>
              </td>
              <td className="px-3.5 py-2.5 text-text-muted text-[11px]">
                Contains <span className="font-mono text-zinc-300">00_Raw_data</span>, <span className="font-mono text-zinc-300">01_Metadata</span>, <span className="font-mono text-zinc-300">03_Stitching</span>, <span className="font-mono text-zinc-300">05_Final</span>
              </td>
              <td className="px-3.5 py-2.5 text-center">
                <span
                  className={`text-[11px] font-medium inline-flex items-center gap-1.5 justify-center ${
                    workerOnline ? 'text-emerald-400' : 'text-text-muted'
                  }`}
                >
                  <StatusDot tone={workerOnline ? 'text-emerald-400' : 'text-text-muted/60'} pulse={loading} />
                  {loading ? 'Checking' : workerOnline ? 'Reachable via worker' : 'Not verified'}
                </span>
              </td>
            </tr>

            {/* Row 2: Local HTTP/HTTPS Browser Bridge Daemon */}
            <tr className="hover:bg-inner transition-colors">
              <td className="px-3.5 py-2.5 font-semibold text-text-base">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-inner border border-subtle flex items-center justify-center text-zinc-300 shrink-0">
                    <Activity size={12} />
                  </div>
                  <div>
                    <span className="font-bold">Browser Filesystem Bridge &amp; API</span>
                    <div className="text-[10px] font-normal text-text-muted">
                      Worker daemon for previews and job execution
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3.5 py-2.5">
                <span className="font-mono text-[11px] text-zinc-200">{workerUrl}</span>
              </td>
              <td className="px-3.5 py-2.5 text-text-muted text-[11px]">
                {health ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-emerald-400 font-semibold">{health.jobs_active} active task(s)</span>
                    <span>·</span>
                    <span>Mount: <span className="font-mono text-zinc-200">{health.nas_base || '—'}</span></span>
                  </span>
                ) : (
                  <div>
                    <span>Allows the browser to read directory trees and stream image previews from the NAS</span>
                    {error && <span className="block text-amber-400/80 mt-0.5 font-mono text-[10px]">{error}</span>}
                  </div>
                )}
              </td>
              <td className="px-3.5 py-2.5 text-center">
                <span
                  className={`text-[11px] font-medium inline-flex items-center gap-1.5 justify-center ${
                    loading
                      ? 'text-text-muted'
                      : workerOnline
                        ? 'text-emerald-400'
                        : 'text-text-muted'
                  }`}
                >
                  {loading ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <StatusDot tone={workerOnline ? 'text-emerald-400' : 'text-text-muted/60'} />
                  )}
                  {loading ? 'Checking' : workerOnline ? `Online (${health?.status ?? 'ok'})` : 'Offline / Standby'}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Endpoint & Storage Configuration Modal */}
      {isConfigOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-subtle rounded-2xl w-full max-w-lg p-5 shadow-2xl flex flex-col gap-4 text-text-base">
            <div className="flex items-center gap-2 pb-3 border-b border-subtle">
              <div className="w-8 h-8 rounded-lg bg-inner border border-subtle flex items-center justify-center text-text-base shrink-0">
                <Settings2 size={16} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text-base">Configure Service Endpoints &amp; Storage</h3>
                <p className="text-[11px] text-text-muted">Set worker HTTPS API URL and NAS volume working base path</p>
              </div>
            </div>

            <div className="flex flex-col gap-3.5">
              {/* Field 1: Worker API Endpoint URL */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                  Worker API Endpoint URL
                </label>
                <input
                  type="text"
                  value={draftApiUrl}
                  onChange={(e) => setDraftApiUrl(e.target.value)}
                  placeholder="https://nas.internal:8010"
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-base focus:outline-none focus:border-divider"
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Network endpoint URL for the Python filesystem bridge / GPU worker daemon. Use{' '}
                  <strong className="text-zinc-300 font-mono">https://</strong> for secure production environments.
                </p>
              </div>

              {/* Field 2: NAS Working Base Path */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                  NAS Working Base Path (Mount Root)
                </label>
                <input
                  type="text"
                  value={draftMountPath}
                  onChange={(e) => setDraftMountPath(e.target.value)}
                  placeholder="D:/360_project"
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-base focus:outline-none focus:border-divider"
                />
                <p className="text-[10px] text-text-muted mt-1">
                  Root directory where pipeline stages (<span className="font-mono text-zinc-300">00_Raw_data</span>, <span className="font-mono text-zinc-300">03_Stitching</span>, etc.) are located on disk or network share.
                </p>
              </div>

              {/* Live Test Ping Section */}
              <div className="p-3 rounded-lg bg-inner border border-subtle flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-text-base flex items-center gap-1.5">
                    <span>Connectivity Diagnostic</span>
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {testStatus === 'testing' && 'Testing connection to endpoint...'}
                    {testStatus === 'success' && <span className="text-emerald-400 font-semibold">{testMessage}</span>}
                    {testStatus === 'error' && <span className="text-amber-400">{testMessage || 'Could not connect to endpoint'}</span>}
                    {testStatus === 'idle' && 'Verify that the endpoint is reachable from this browser.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testStatus === 'testing'}
                  className="px-3 py-1.5 bg-card hover:bg-inner border border-subtle text-text-base rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {testStatus === 'testing' ? <Loader2 size={12} className="animate-spin" /> : <Activity size={12} />}
                  <span>Test Connection</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-subtle">
              <button
                type="button"
                onClick={() => setIsConfigOpen(false)}
                className="px-3 py-1.5 bg-inner hover:bg-card border border-subtle text-text-base rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                className="px-4 py-1.5 bg-text-base text-card hover:opacity-90 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <Check size={13} />
                <span>Save Configuration</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
            <div aria-hidden="true" className="space-y-1.5 py-2 animate-pulse">
              <div className="h-2.5 w-40 rounded bg-inner border border-subtle/50" />
              <div className="h-2.5 w-5/6 rounded bg-inner border border-subtle/50" />
              <div className="h-2.5 w-2/3 rounded bg-inner border border-subtle/50" />
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