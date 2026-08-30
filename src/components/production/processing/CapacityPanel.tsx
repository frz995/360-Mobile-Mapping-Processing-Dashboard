import React, { useEffect, useMemo, useState } from 'react';
import { Cpu, Gauge, Loader2, RefreshCw, Activity, ServerCog } from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { ProcessingJobRecord, WorkerHealthInfo } from '../../../types/production';
import { isJobActive, isJobTerminal } from '../../../utils/productionQueue';
import { formatDateTime } from '../common';
import { backlogStats } from './processingCommon';

export interface CapacityPanelProps {
  jobs: ProcessingJobRecord[];
  api: ProductionApiClient;
  projectSettings: any;
  translate: (key: string) => string;
}

export const CapacityPanel: React.FC<CapacityPanelProps> = ({ jobs, api, projectSettings }) => {
  const [health, setHealth] = useState<WorkerHealthInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api.getHealth().then((h) => setHealth(h)).finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const stats = backlogStats(jobs);
  const concurrency = projectSettings?.productionConcurrency || 1;
  const active = jobs.filter((j) => isJobActive(j.status)).length;

  const providerRegistry = useMemo(() => {
    const list = (projectSettings?.productionProviders || []) as Array<{
      name: string;
      software: string;
      version: string;
      workerUrl?: string;
      enabled: boolean;
    }>;
    return list;
  }, [projectSettings?.productionProviders]);

  const providerRows = useMemo(() => {
    const names = new Set<string>();
    providerRegistry.forEach((p) => p.name && names.add(p.name));
    jobs.forEach((j) => j.provider && names.add(j.provider));
    const rows = Array.from(names).map((name) => {
      const own = jobs.filter((j) => j.provider === name);
      const reg = providerRegistry.find((p) => p.name === name);
      return {
        name,
        software: reg?.software || '',
        version: reg?.version || '',
        workerUrl: reg?.workerUrl || (name === 'NAS GPU Worker' ? projectSettings?.productionApiUrl : '') || '',
        enabled: reg ? reg.enabled !== false : own.some((j) => isJobActive(j.status) || true),
        queued: own.filter((j) => j.status === 'QUEUED').length,
        running: own.filter((j) => isJobActive(j.status)).length,
        completed: own.filter((j) => isJobTerminal(j.status) || j.status === 'COMPLETED' || j.status === 'IMPORTED' || j.status === 'APPROVED').length,
        failed: own.filter((j) => j.status === 'FAILED' || j.status === 'REJECTED').length
      };
    });
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs, providerRegistry, projectSettings?.productionApiUrl]);

  const bars: Array<{ label: string; value: number; cls: string }> = [
    { label: 'QUEUED', value: stats.queued, cls: 'bg-sky-400' },
    { label: 'IN PROGRESS', value: stats.running, cls: 'bg-amber-400' },
    { label: 'QA PENDING', value: stats.qaPending, cls: 'bg-blue-400' },
    { label: 'REVIEW REQUIRED', value: stats.reviewRequired, cls: 'bg-orange-400' },
    { label: 'COMPLETED TODAY', value: stats.completedToday, cls: 'bg-emerald-400' },
    { label: 'FAILED', value: stats.failed, cls: 'bg-rose-400' }
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <Gauge size={15} className="text-sky-400" /> Worker capacity & queue
        </div>
        <div className="flex-1" />
        <button onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-sky-500/20 hover:border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-inner border border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
            <Cpu size={14} className="text-sky-400" /> NAS GPU Worker
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-text-muted py-3">
              <Loader2 size={13} className="animate-spin" /> probing /health…
            </div>
          ) : health ? (
            <>
              <div className="flex items-center gap-1.5 text-emerald-300 text-sm font-bold mt-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Online
              </div>
              <div className="text-[11px] text-text-muted mt-1">
                <span className="text-text-base font-semibold">{health.jobs_active}</span> active job(s) on worker
              </div>
              <div className="text-[11px] text-text-muted font-sans mt-1 break-all">{health.nas_base}</div>
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-rose-300 text-sm font-bold mt-1">
              <Activity size={14} /> Unreachable
            </div>
          )}
          <div className="text-[11px] text-text-muted mt-2">
            Configured concurrency: <span className="text-text-base font-semibold">{concurrency}</span>
          </div>
        </div>

        <div className="bg-inner border border-subtle rounded-xl p-4 sm:col-span-2">
          <div className="text-text-base text-xs font-bold uppercase tracking-wide">Live backlog</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            {bars.map((b) => (
              <div key={b.label} className="bg-card border border-subtle rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">{b.label}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg font-bold leading-none text-text-base">{b.value}</span>
                  <span className={`w-2 h-2 rounded-full ${b.cls}`} />
                </div>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-text-muted mt-3 flex flex-wrap gap-3">
            <span>Active jobs: <span className="text-text-base font-semibold">{active}</span></span>
            <span>Error frames: <span className="text-rose-300 font-semibold">{stats.errorFrames}</span></span>
            {['COMPLETED', 'IMPORTED', 'APPROVED'].map((s) => (
              <span key={s}>{s}: <span className="text-text-base font-semibold">{jobs.filter((j) => j.status === s).length}</span></span>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-inner border border-subtle rounded-xl p-4">
        <div className="text-text-base text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-2">
          <ServerCog size={14} className="text-sky-400" /> Workers &amp; providers
          <span className="text-[10px] font-normal normal-case text-text-muted">{providerRows.length} registered / seen</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-text-muted uppercase tracking-wide text-[10px]">
                <th className="py-1.5 pr-2">Provider</th>
                <th className="py-1.5 pr-2">Software</th>
                <th className="py-1.5 pr-2">Endpoint</th>
                <th className="py-1.5 pr-2 text-right">Queued</th>
                <th className="py-1.5 pr-2 text-right">Running</th>
                <th className="py-1.5 pr-2 text-right">Done</th>
                <th className="py-1.5 text-right">Failed</th>
              </tr>
            </thead>
            <tbody>
              {providerRows.length === 0 && (
                <tr><td colSpan={7} className="py-3 text-center text-text-muted">No providers configured or seen on jobs yet.</td></tr>
              )}
              {providerRows.map((p) => (
                <tr key={p.name} className="border-t border-subtle">
                  <td className="py-2 pr-2">
                    <span className={`inline-flex items-center gap-1.5 font-semibold text-text-base ${p.enabled ? '' : 'text-text-muted'}`}>
                      <span className={`w-2 h-2 rounded-full ${p.enabled ? 'bg-emerald-400' : 'bg-slate-500'}`} /> {p.name}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-text-muted">{p.software ? `${p.software}${p.version ? ` v${p.version}` : ''}` : '—'}</td>
                  <td className="py-2 pr-2 text-[10px] font-sans text-text-muted truncate max-w-[200px]">{p.workerUrl || '—'}</td>
                  <td className="py-2 pr-2 text-right font-sans text-sky-300">{p.queued}</td>
                  <td className="py-2 pr-2 text-right font-sans text-amber-300">{p.running}</td>
                  <td className="py-2 pr-2 text-right font-sans text-emerald-300">{p.completed}</td>
                  <td className={`py-2 text-right font-sans ${p.failed ? 'text-rose-300' : 'text-text-muted'}`}>{p.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-inner border border-subtle rounded-xl p-4">
        <div className="text-text-base text-xs font-bold uppercase tracking-wide mb-2">Recent activity</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-text-muted uppercase tracking-wide text-[10px]">
                <th className="py-1.5 pr-2">Job</th>
                <th className="py-1.5 pr-2">Type</th>
                <th className="py-1.5 pr-2">Status</th>
                <th className="py-1.5 pr-2">Progress</th>
                <th className="py-1.5 pr-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {[...jobs]
                .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
                .slice(0, 8)
                .map((j) => (
                  <tr key={j.id || j.name} className="border-t border-subtle">
                    <td className="py-2 pr-2 text-text-base font-semibold">{j.name || j.job_type}</td>
                    <td className="py-2 pr-2 text-text-muted">{j.job_type}</td>
                    <td className="py-2 pr-2 text-text-muted">{j.status}</td>
                    <td className="py-2 pr-2 font-sans text-text-muted">{j.progress || 0}%</td>
                    <td className="py-2 text-text-muted">{formatDateTime(j.updated_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};