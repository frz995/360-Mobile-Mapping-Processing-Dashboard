import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  MonitorSpeaker,
  Zap,
  X,
  Network,
  ChevronRight
} from 'lucide-react';
import type { ProcessingJobRecord, WorkstationStationConfig, WorkerHealthInfo } from '../../../types/production';
import { DEFAULT_4_WORKSTATIONS } from '../../../types/production';
import type { ProductionApiClient } from '../../../services/productionApi';
import { backlogStats } from './processingCommon';
import { isJobActive, jobStatusTextClass } from '../../../utils/productionQueue';

export interface WorkerMonitorPanelProps {
  jobs: ProcessingJobRecord[];
  api: ProductionApiClient;
  projectSettings?: any;
  translate?: (key: string) => string;
}

interface SystemMetrics {
  cpuUsage: number;
  gpuUsage: number;
  ramUsedGb: number;
  ramTotalGb: number;
  gpuName: string;
  gpuSupported: boolean;
  cpuCores: number;
}

interface StationMetrics {
  ramPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  gpuPct: number;
  gpuName: string | null;
  storagePct: number;
}

const USAGE_COLOR = (pct: number): string =>
  pct < 50 ? 'bg-emerald-400' : pct < 80 ? 'bg-amber-400' : 'bg-rose-400';

const BAR_BG = 'bg-slate-800';
const BAR_H = 'h-1.5 rounded-full';

function gaugeBar(pct: number): React.ReactNode {
  return (
    <div className={`w-full ${BAR_BG} ${BAR_H} overflow-hidden`}>
      <div
        className={`${BAR_H} ${USAGE_COLOR(pct)} transition-all duration-700`}
        style={{ width: `${Math.max(1, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

const emptyStationMetrics = (): StationMetrics => ({
  ramPct: 0,
  ramUsedGb: 0,
  ramTotalGb: 0,
  gpuPct: 0,
  gpuName: null,
  storagePct: 0
});

const STATION_JOB_TYPE: Record<string, string> = {
  blur: 'BLUR',
  stitch: 'STITCH',
  lightroom: 'ENHANCE',
  photoshop: 'MASK'
};

export const WorkerMonitorPanel: React.FC<WorkerMonitorPanelProps> = ({
  jobs,
  api,
  projectSettings
}) => {
  const [health, setHealth] = useState<WorkerHealthInfo | null>(null);
  const [storageUsedPct, setStorageUsedPct] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [stationMetrics, setStationMetrics] = useState<Record<string, StationMetrics>>({});
  const [selectedStation, setSelectedStation] = useState<WorkstationStationConfig | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const lockedRef = useRef<Record<string, Set<string>>>({});

  const workstations: WorkstationStationConfig[] = useMemo(
    () => (projectSettings?.workstationsConfig as WorkstationStationConfig[] | undefined) || DEFAULT_4_WORKSTATIONS,
    [projectSettings?.workstationsConfig]
  );

  const stats = useMemo(() => backlogStats(jobs), [jobs]);

  const lock = (key: string, field: string) => {
    if (!lockedRef.current[key]) lockedRef.current[key] = new Set();
    lockedRef.current[key].add(field);
  };

  const applyDaemonMetrics = (h: WorkerHealthInfo) => {
    setMetrics((prev) => {
      const next: SystemMetrics = {
        ...(prev || { cpuUsage: 0, gpuUsage: 0, ramUsedGb: 0, ramTotalGb: 0, gpuName: '—', gpuSupported: false, cpuCores: 0 })
      };
      if (typeof h.cpu_usage === 'number') { next.cpuUsage = h.cpu_usage; lock('system', 'cpuUsage'); }
      if (typeof h.cpu_cores === 'number') { next.cpuCores = h.cpu_cores; lock('system', 'cpuCores'); }
      if (typeof h.gpu_usage === 'number') { next.gpuUsage = h.gpu_usage; lock('system', 'gpuUsage'); }
      if (h.gpu_name) { next.gpuName = h.gpu_name; lock('system', 'gpuName'); }
      if (typeof h.ram_used_gb === 'number') { next.ramUsedGb = h.ram_used_gb; lock('system', 'ramUsedGb'); }
      if (typeof h.ram_total_gb === 'number') { next.ramTotalGb = h.ram_total_gb; lock('system', 'ramTotalGb'); }
      return next;
    });
    if (typeof h.storage_used_pct === 'number') {
      setStorageUsedPct(Math.round(h.storage_used_pct));
      lock('system', 'storageUsedPct');
    }
  };

  const applyStationHealth = (wsId: string, h: WorkerHealthInfo) => {
    setStationMetrics((prev) => {
      const base = prev[wsId] || emptyStationMetrics();
      const next: StationMetrics = { ...base };
      const lockKey = `station:${wsId}`;
      if (typeof h.ram_total_gb === 'number') {
        next.ramTotalGb = h.ram_total_gb;
        lock(lockKey, 'ramTotalGb');
      }
      if (typeof h.ram_used_gb === 'number') {
        next.ramUsedGb = h.ram_used_gb;
        lock(lockKey, 'ramUsedGb');
        if (next.ramTotalGb > 0) {
          next.ramPct = Math.round((h.ram_used_gb / next.ramTotalGb) * 100);
          lock(lockKey, 'ramPct');
        }
      }
      if (typeof h.gpu_usage === 'number') {
        next.gpuPct = h.gpu_usage;
        lock(lockKey, 'gpuPct');
      }
      if (h.gpu_name) {
        next.gpuName = h.gpu_name;
        lock(lockKey, 'gpuName');
      }
      if (typeof h.storage_used_pct === 'number') {
        next.storagePct = h.storage_used_pct;
        lock(lockKey, 'storagePct');
      }
      return { ...prev, [wsId]: next };
    });
  };

  const probeStations = useCallback(async () => {
    for (const ws of workstations) {
      if (!ws.ipAddress || ws.enabled === false) continue;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(`http://${ws.ipAddress}:${ws.port || 8000}/health`, {
          method: 'GET',
          signal: controller.signal
        }).catch(() => null);
        clearTimeout(timeoutId);
        if (res && res.ok) {
          const data = (await res.json()) as WorkerHealthInfo;
          applyStationHealth(ws.id, data);
        }
      } catch {
        clearTimeout(timeoutId);
      }
    }
  }, [workstations]);

  const refresh = useCallback(async () => {
    setRefreshTick((t) => t + 1);
    const h = await api.getHealth();
    setHealth(h);
    if (h) applyDaemonMetrics(h);
    const info = await api.getStorageInfo();
    if (info && info.total > 0 && typeof h?.storage_used_pct !== 'number') {
      setStorageUsedPct(Math.round(((info.total - info.free) / info.total) * 100));
    }
  }, [api]);

  useEffect(() => {
    refresh();
    probeStations();
    const iv = setInterval(() => {
      refresh();
      probeStations();
    }, 15000);
    return () => clearInterval(iv);
  }, [refresh, probeStations]);

  const daemonOnline = !!health && health.status === 'ok';
  const runningJobs = jobs.filter((j) => isJobActive(j.status) && (j.provider?.toLowerCase().includes('gpu') || j.provider?.toLowerCase().includes('worker')));
  const queuedJobs = jobs.filter((j) => (j.status === 'QUEUED' || j.status === 'PENDING') && (j.provider?.toLowerCase().includes('gpu') || j.provider?.toLowerCase().includes('worker')));

  const gpuWorkerJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.provider?.toLowerCase().includes('gpu') ||
          j.provider?.toLowerCase().includes('worker') ||
          j.provider?.toLowerCase().includes('fastapi')
      ),
    [jobs]
  );

  const stationJobsFor = (ws: WorkstationStationConfig): ProcessingJobRecord[] =>
    jobs.filter(
      (j) =>
        j.job_type === STATION_JOB_TYPE[ws.id] &&
        (j.status === 'QUEUED' || j.status === 'IN_PROGRESS' || j.status === 'PENDING')
    );

  const ramPct = metrics && metrics.ramTotalGb > 0 ? Math.round((metrics.ramUsedGb / metrics.ramTotalGb) * 100) : 0;
  const daemonJobsActive = health?.jobs_active ?? 0;
  const gpuDoneToday = gpuWorkerJobs.filter((j) => j.status === 'COMPLETED' && j.completed_at && new Date(j.completed_at).toDateString() === new Date().toDateString()).length;
  const gpuFailed = gpuWorkerJobs.filter((j) => j.status === 'FAILED').length;
  const selectedSM = selectedStation ? stationMetrics[selectedStation.id] : undefined;

  const NumberValue: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="text-lg font-bold text-text-base">{children}</span>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-inner rounded-lg border border-subtle text-text-muted">
            <MonitorSpeaker size={18} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-text-base">Worker Manager &amp; System Monitor</h3>
            <p className="text-[10px] text-text-muted">CPU · GPU · Memory · Daemon · Workstation health</p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-semibold cursor-pointer transition-colors"
        >
          <RefreshCw size={12} className={refreshTick % 2 === 0 ? '' : 'animate-spin'} />
          Refresh
        </button>
      </div>

      {/* System Resource Cards — 4 column */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
            <span className="flex items-center gap-1.5"><Cpu size={13} /> CPU</span>
            <span className="font-bold text-text-base">{metrics ? `${Math.round(metrics.cpuUsage)}%` : '—'}</span>
          </div>
          {gaugeBar(metrics?.cpuUsage ?? 0)}
          <div className="text-[10px] text-text-muted">{metrics ? `${metrics.cpuCores} threads · PyTorch CUDA Worker` : 'Waiting for daemon report…'}</div>
        </div>

        <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
            <span className="flex items-center gap-1.5"><Zap size={13} /> GPU</span>
            <span className="font-bold text-text-base">{metrics ? `${Math.round(metrics.gpuUsage)}%` : '—'}</span>
          </div>
          {gaugeBar(metrics?.gpuUsage ?? 0)}
          <div className="text-[10px] text-text-muted truncate" title={metrics?.gpuName}>{metrics?.gpuName || '—'}</div>
        </div>

        <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
            <span className="flex items-center gap-1.5"><MemoryStick size={13} /> RAM</span>
            <span className="font-bold text-text-base">{metrics ? `${ramPct}%` : '—'}</span>
          </div>
          {gaugeBar(ramPct)}
          <div className="text-[10px] text-text-muted">{metrics ? `${metrics.ramUsedGb.toFixed(1)} / ${metrics.ramTotalGb} GB` : '—'}</div>
        </div>

        <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
            <span className="flex items-center gap-1.5"><HardDrive size={13} /> Storage</span>
            <span className="font-bold text-text-base">{storageUsedPct !== null ? `${storageUsedPct}%` : '—'}</span>
          </div>
          {gaugeBar(storageUsedPct ?? 0)}
          <div className="text-[10px] text-text-muted">NAS local volume</div>
        </div>
      </div>

      {/* ============ NAS GPU Worker Category ============ */}
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-muted pt-1">
        <Server size={12} /> NAS GPU Worker
      </div>

      <div className="bg-inner border border-subtle rounded-xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            Daemon: <span className={`font-bold ${daemonOnline ? 'text-emerald-300' : 'text-rose-300'}`}>
              {daemonOnline ? 'Connected' : 'Unreachable'}
            </span>
          </span>
          <span>Active: <span className="font-bold text-text-base">{daemonJobsActive}</span></span>
          <span>Running: <span className="font-bold text-text-base">{runningJobs.length}</span></span>
          <span>Queued: <span className="font-bold text-text-base">{queuedJobs.length}</span></span>
          <span>Done today: <span className="font-bold text-text-base">{gpuDoneToday}</span></span>
          <span>Failed: <span className="font-bold text-text-base">{gpuFailed}</span></span>
          <span>Jobs tracked: <span className="font-bold text-text-base">{gpuWorkerJobs.length}</span></span>
          <span>Concurrency: <span className="font-bold text-text-base">{projectSettings?.productionConcurrency || 1}</span></span>
          <span>QA review: <span className="font-bold text-text-base">{stats.qaPending + stats.reviewRequired}</span></span>
          <span className="font-mono text-[10px]">NAS: {health?.nas_base || '—'}</span>
        </div>
      </div>

      {/* NAS Worker queue list */}
      <div className="bg-inner border border-subtle rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-subtle text-[11px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <Zap size={12} /> NAS Worker Pipeline Queue
        </div>
        <div className="flex flex-col">
          {gpuWorkerJobs.length === 0 ? (
            <div className="p-6 text-center text-text-muted text-xs">No automated NAS worker jobs in the queue.</div>
          ) : (
            gpuWorkerJobs.slice(0, 8).map((j) => {
              const progressPct = j.total_items ? Math.round(((j.completed_items || 0) / j.total_items) * 100) : 0;
              return (
                <div key={j.id || j.name} className="px-4 py-2.5 border-t border-subtle/50 flex items-center gap-3 text-xs">
                  <span className="font-bold text-text-base truncate w-24">{j.subgrid || 'SUBGRID'}</span>
                  <span className="text-text-muted truncate flex-1">{j.name || j.job_type}</span>
                  <span className={`text-[10px] font-bold uppercase ${jobStatusTextClass(j.status)}`}>{j.status}</span>
                  <div className="w-28 flex items-center gap-1.5">
                    <div className={`flex-1 ${BAR_BG} ${BAR_H} overflow-hidden`}>
                      <div className={`${BAR_H} ${USAGE_COLOR(progressPct)}`} style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="text-text-muted text-[10px] w-8 text-right">{progressPct}%</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ============ Multi-Station Category ============ */}
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-muted pt-1">
        <Network size={12} /> Multi-Station Workstations
      </div>

      <div className="bg-inner border border-subtle rounded-xl overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-card/60 text-[10px] uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-2">Station</th>
                <th className="px-4 py-2">IP Address</th>
                <th className="px-4 py-2">Software</th>
                <th className="px-4 py-2">Operator</th>
                <th className="px-4 py-2">RAM</th>
                <th className="px-4 py-2">GPU</th>
                <th className="px-4 py-2">Storage</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Jobs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle/50">
              {workstations.map((ws) => {
                const sm = stationMetrics[ws.id];
                const stationJobs = stationJobsFor(ws);
                const isEnabled = ws.enabled !== false;
                const hasActive = stationJobs.some((j) => isJobActive(j.status));
                const latencyLabel = ws.latencyMs != null ? `${ws.latencyMs}ms` : '—';

                return (
                  <tr
                    key={ws.id}
                    onClick={() => setSelectedStation(ws)}
                    className={`transition-colors cursor-pointer ${isEnabled ? 'hover:bg-inner/50' : 'opacity-55'}`}
                    title={isEnabled ? 'Click to view station RAM / GPU / Storage' : 'Worker disabled in Production → Providers'}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-bold text-text-base flex items-center gap-1">
                        {ws.name.split('—')[0].trim()}
                        <ChevronRight size={11} className="text-text-muted" />
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-text-muted">
                      {ws.ipAddress || '—'}{ws.port ? `:${ws.port}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted truncate max-w-[160px]" title={ws.software}>
                      {ws.software}
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">{ws.defaultOperator}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 w-24">
                        <div className={`flex-1 ${BAR_BG} ${BAR_H} overflow-hidden`}>
                          <div className={`${BAR_H} ${USAGE_COLOR(sm?.ramPct ?? 0)}`} style={{ width: `${sm?.ramPct ?? 0}%` }} />
                        </div>
                        <span className="text-[10px] text-text-muted w-8 text-right">{sm ? Math.round(sm.ramPct) : '—'}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 w-24">
                        <div className={`flex-1 ${BAR_BG} ${BAR_H} overflow-hidden`}>
                          <div className={`${BAR_H} ${USAGE_COLOR(sm?.gpuPct ?? 0)}`} style={{ width: `${sm?.gpuPct ?? 0}%` }} />
                        </div>
                        <span className="text-[10px] text-text-muted w-8 text-right">{sm ? Math.round(sm.gpuPct) : '—'}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 w-24">
                        <div className={`flex-1 ${BAR_BG} ${BAR_H} overflow-hidden`}>
                          <div className={`${BAR_H} ${USAGE_COLOR(sm?.storagePct ?? 0)}`} style={{ width: `${sm?.storagePct ?? 0}%` }} />
                        </div>
                        <span className="text-[10px] text-text-muted w-8 text-right">{sm ? Math.round(sm.storagePct) : '—'}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold">
                        <span className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                        <span className={isEnabled ? 'text-emerald-300' : 'text-text-muted'}>
                          {isEnabled ? (hasActive ? 'Active' : 'Online') : 'Disabled'}
                        </span>
                        <span className="text-text-muted font-normal">{latencyLabel}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <NumberValue>{stationJobs.length}</NumberValue>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Station Detail Modal */}
      {selectedStation && selectedSM && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-subtle pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-inner rounded-lg border border-subtle text-text-muted">
                  <MonitorSpeaker size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-base">{selectedStation.name}</h3>
                  <p className="text-[10px] text-text-muted font-mono">
                    {selectedStation.ipAddress || '—'}{selectedStation.port ? `:${selectedStation.port}` : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedStation(null)}
                className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${selectedStation.enabled === false ? 'bg-slate-500' : 'bg-emerald-400'}`} />
                <span className={selectedStation.enabled === false ? 'text-text-muted' : 'text-emerald-300'}>
                  {selectedStation.enabled === false ? 'Disabled' : 'Active'}
                </span>
              </span>
              <span className="text-text-muted">· {selectedStation.defaultOperator}</span>
              <span className="text-text-muted">· {selectedStation.latencyMs != null ? `${selectedStation.latencyMs}ms` : '—'}</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {/* RAM */}
              <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
                  <span className="flex items-center gap-1.5"><MemoryStick size={13} /> RAM</span>
                  <span className="font-bold text-text-base">{Math.round(selectedSM.ramPct)}%</span>
                </div>
                {gaugeBar(selectedSM.ramPct)}
                <div className="text-[10px] text-text-muted">{selectedSM.ramUsedGb.toFixed(1)} / {selectedSM.ramTotalGb} GB</div>
              </div>

              {/* GPU */}
              <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
                  <span className="flex items-center gap-1.5"><Zap size={13} /> GPU</span>
                  <span className="font-bold text-text-base">{Math.round(selectedSM.gpuPct)}%</span>
                </div>
                {gaugeBar(selectedSM.gpuPct)}
                <div className="text-[10px] text-text-muted">{selectedSM.gpuName || metrics?.gpuName || '—'}</div>
              </div>

              {/* Storage */}
              <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
                  <span className="flex items-center gap-1.5"><HardDrive size={13} /> Storage</span>
                  <span className="font-bold text-text-base">{Math.round(selectedSM.storagePct)}%</span>
                </div>
                {gaugeBar(selectedSM.storagePct)}
                <div className="text-[10px] text-text-muted">NAS volume share</div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-subtle pt-3 text-[11px] text-text-muted">
              <span>{selectedStation.software}</span>
              <span>{stationJobsFor(selectedStation).length} active job(s)</span>
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-text-muted">
        Metrics show real daemon <span className="font-mono">/health</span> reports only. Values appear once a worker system reports CPU / GPU / RAM / storage; systems without an agent show ‘—’. Refreshes every 15s.
      </p>
    </div>
  );
};