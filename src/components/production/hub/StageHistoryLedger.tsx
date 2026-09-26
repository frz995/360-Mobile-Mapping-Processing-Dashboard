import React, { useEffect, useMemo, useState } from 'react';
import {
  Database,
  EyeOff,
  FolderInput,
  Globe,
  History,
  Info,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react';
import type {
  StageEventLedgerRow,
  StageLedgerEvent,
  StageLedgerStage
} from '../../../types/production';
import { fetchStageEventLedgerFromSupabase } from '../../../services/api/stageEventLedger';

export interface StageHistoryLedgerProps {
  subgrid?: string;
  totalFrames?: number;
}

const STAGES: Array<{ id: StageLedgerStage; label: string; icon: React.ReactNode }> = [
  { id: 'blur', label: 'PC 1 · Privacy Blur', icon: <EyeOff size={12} /> },
  { id: 'stitch', label: 'PC 2 · Stitching', icon: <RotateCcw size={12} /> },
  { id: 'lightroom', label: 'PC 3 · Lightroom', icon: <Sparkles size={12} /> },
  { id: 'photoshop', label: 'PC 4 · Nadir Mask', icon: <SlidersHorizontal size={12} /> },
  // Intake sits below the 4-PC stations: the ledger reads top-down as the
  // workstation floor activity first, then the surrounding gates.
  { id: 'intake', label: 'Intake & Pairing', icon: <FolderInput size={12} /> },
  { id: 'qa', label: 'Acceptance QA', icon: <ShieldCheck size={12} /> },
  { id: 'bucket', label: 'Cloud Bucket Gate', icon: <Database size={12} /> },
  { id: 'publish', label: 'WebGIS Release', icon: <Globe size={12} /> }
];

const EVENT_META: Record<StageLedgerEvent, { label: string; cls: string }> = {
  STARTED: { label: 'Started', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/5' },
  PROGRESS: { label: 'Progress', cls: 'text-sky-300 border-sky-500/30 bg-sky-500/5' },
  COMPLETED: { label: 'Completed', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5' },
  FLAGGED: { label: 'Flagged', cls: 'text-red-300 border-red-500/30 bg-red-500/5' },
  PUBLISHED: { label: 'Published', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5' },
  AGENT_ONLINE: { label: 'Agent online', cls: 'text-text-muted border-subtle bg-inner' },
  AGENT_OFFLINE: { label: 'Agent offline', cls: 'text-text-muted border-subtle bg-inner' }
};

const VIA_LABEL: Record<string, string> = {
  agent: 'Agent',
  operator: 'Operator',
  system: 'System'
};

interface StageHistory {
  stage: StageLedgerStage;
  events: StageEventLedgerRow[];
  completedAt?: string;
  startedAt?: string;
  elapsedMs?: number;
  done: number;
  total: number;
  unit: 'frames' | 'points';
}

const SIGNIFICANT_EVENTS = new Set<StageLedgerEvent>(['STARTED', 'PROGRESS', 'COMPLETED', 'FLAGGED', 'PUBLISHED']);

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const fmtDur = (ms: number): string => {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
};

function hllStage(stageId: StageLedgerStage, all: StageEventLedgerRow[]): StageHistory {
  const events = all.filter((e) => e.stage === stageId && SIGNIFICANT_EVENTS.has(e.event));
  const startedAt = events.find((e) => e.event === 'STARTED')?.occurrence;
  const completedAt = events.find((e) => e.event === 'COMPLETED' || e.event === 'PUBLISHED')?.occurrence;
  const lastFrames = [...events].reverse().find((e) => e.counts && typeof e.counts.done === 'number');
  const done = lastFrames ? Number(lastFrames.counts?.done) : 0;
  const total = lastFrames && typeof lastFrames.counts?.total === 'number' ? Number(lastFrames.counts?.total) : 0;
  let elapsedMs: number | undefined;
  if (startedAt && completedAt) {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) elapsedMs = ms;
  }
  const unit = lastFrames?.counts?.unit === 'points' ? 'points' : 'frames';
  return { stage: stageId, events, startedAt, completedAt, elapsedMs, done, total, unit };
}

function hllState(h: StageHistory): { label: string; cls: string } {
  if (h.completedAt) return { label: 'Completed', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5' };
  if (h.events.some((e) => e.event === 'FLAGGED')) {
    if (h.startedAt) return { label: 'Flagged · re-runnable', cls: 'text-red-300 border-red-500/30 bg-red-500/5' };
    return { label: 'Flagged', cls: 'text-red-300 border-red-500/30 bg-red-500/5' };
  }
  if (h.startedAt || h.events.length > 0) return { label: 'In progress', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/5' };
  return { label: 'Not started', cls: 'text-text-muted border-subtle bg-inner' };
}

export const StageHistoryLedger: React.FC<StageHistoryLedgerProps> = ({ subgrid, totalFrames }) => {
  const cleanSg = (subgrid || '').trim().toUpperCase();
  const [events, setEvents] = useState<StageEventLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let disposed = false;
    if (!cleanSg) return;
    setLoading(true);
    fetchStageEventLedgerFromSupabase(cleanSg)
      .then((rows) => {
        if (!disposed) setEvents(rows);
      })
      .catch(() => {
        if (!disposed) setEvents([]);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [cleanSg, tick]);

  const histories = useMemo(() => STAGES.map((s) => ({ ...s, ...hllStage(s.id, events) })), [events]);

  const completedCount = histories.filter((h) => !!h.completedAt).length;
  const earliestAt = events[0]?.occurrence;
  const latestRunAt = [...histories]
    .map((h) => (h.completedAt ? { stage: h.stage, at: h.completedAt } : null))
    .filter(Boolean)
    .slice(-1)[0];
  const leadMs = earliestAt && latestRunAt
    ? new Date(latestRunAt.at).getTime() - new Date(earliestAt).getTime()
    : undefined;

  if (!cleanSg) {
    return (
      <div className="flex flex-col gap-3 py-12 items-center text-center">
        <Info size={30} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-base tracking-tight">No Subgrid Selected</h3>
        <p className="text-xs text-text-muted max-w-md">
          Set a subgrid in Stitched Intake &amp; Pairing to see its per-stage processing history.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-3 border-b border-subtle flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">Stage History Ledger</h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed max-w-3xl">
            Review processing activity and stage completion for the selected subgrid.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-400 hover:text-sky-300 cursor-pointer transition-colors shrink-0"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Stage rollup chips */}
      <div className="flex flex-wrap gap-2">
        {histories.map((h) => {
          const state = hllState(h);
          return (
            <span
              key={h.stage}
              className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border ${state.cls}`}
              title={h.startedAt ? `Started ${fmtTime(h.startedAt)}` : 'No events yet'}
            >
              {h.icon}
              <span>{h.label}</span>
              <span className="opacity-70">{h.completedAt ? '✓' : ''}</span>
            </span>
          );
        })}
      </div>

      <div className="bg-inner border border-subtle rounded-xl px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-text-muted">
        <span>
          Batch total: <span className="font-bold text-text-base">{totalFrames && totalFrames > 0 ? totalFrames : '—'}</span>
        </span>
        <span>
          Stages completed: <span className="font-bold text-text-base">{completedCount}/8</span>
        </span>
        <span>
          First event: <span className="text-text-base">{earliestAt ? fmtTime(earliestAt) : '—'}</span>
        </span>
        {leadMs !== undefined && (
          <span>
            Lead time to release: <span className="font-bold text-text-base">{fmtDur(leadMs)}</span>
          </span>
        )}
        <span>
          Events recorded: <span className="font-bold text-text-base">{events.length}</span>
        </span>
      </div>

      {histories.every((h) => h.events.length === 0) ? (
        <div className="flex flex-col gap-3 py-10 items-center text-center">
          <History size={26} className="text-text-muted" />
          <h4 className="text-xs font-bold text-text-base">No Stage Events Yet for {cleanSg}</h4>
          <p className="text-[11px] text-text-muted max-w-md">
            Events appear as the pipeline runs: pair a CSV in intake, run the station apps (station agents auto-log
            start/progress), approve QA, push the bucket manifest and publish. Progress counts land here automatically.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {histories.map((h) => {
            const state = hllState(h);
            const lastAgent = [...events]
              .reverse()
              .find((e) => e.stage === h.stage && (e.event === 'AGENT_ONLINE' || e.event === 'AGENT_OFFLINE'));
            return (
              <div key={h.stage} className="rounded-xl border border-subtle bg-card flex flex-col divide-y divide-[var(--divider)]">
                <div className="px-3.5 py-2.5 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-text-muted shrink-0">{h.icon}</span>
                    <span className="text-xs font-bold text-text-base truncate">{h.label}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${state.cls}`}>
                      {state.label}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-text-muted flex items-center gap-3">
                    {h.done > 0 && h.total > 0 && <span>{Math.min(h.done, h.total)} / {h.total}{h.unit === 'points' ? ' pts' : ''}</span>}
                    {h.elapsedMs !== undefined && <span title="First start → completion">Δ {fmtDur(h.elapsedMs)}</span>}
                    {lastAgent && (
                      <span title={lastAgent.detail || ''}>
                        {lastAgent.event === 'AGENT_ONLINE' ? 'agent up' : 'agent down'} {fmtTime(lastAgent.occurrence)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="px-3.5 py-2.5 flex flex-col gap-1.5">
                  {h.events.length === 0 ? (
                    <span className="text-[10px] text-text-muted">No events yet — starts when the stage first runs.</span>
                  ) : (
                    [...h.events].reverse().map((e) => {
                      const meta = EVENT_META[e.event];
                      const countsText = typeof e.counts?.done === 'number'
                        ? ` · ${Number(e.counts.done)}${typeof e.counts?.total === 'number' ? ` / ${Number(e.counts.total)}` : ''}`
                        : '';
                      return (
                        <div key={e.id || `${e.event}-${e.occurrence}`} className="flex items-start gap-2 text-[10px] leading-relaxed">
                          <span className="text-text-muted font-mono shrink-0 w-28 truncate" title={fmtTime(e.occurrence)}>
                            {fmtTime(e.occurrence)}
                          </span>
                          <span className={`text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border shrink-0 ${meta.cls}`}>
                            {meta.label}
                          </span>
                          <span className="text-text-muted shrink-0">{VIA_LABEL[e.via || 'system']}</span>
                          <span className="text-text-muted min-w-0" title={e.detail || ''}>
                            {e.detail || ''}{countsText}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
