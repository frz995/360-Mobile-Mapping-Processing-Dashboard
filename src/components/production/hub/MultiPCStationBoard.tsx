import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  Play,
  Check,
  ArrowRight,
  EyeOff,
  Sparkles,
  SlidersHorizontal,
  RotateCcw,
  Info
} from 'lucide-react';
import { StatusDot } from '../chrome';

export interface StationState {
  id: 'blur' | 'stitch' | 'lightroom' | 'photoshop';
  name: string;
  pcLabel: string;
  software: string;
  sourceFolder: string;
  outputFolder: string;
  status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'FLAGGED';
  completedFrames: number;
  totalFrames: number;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
}

export interface MultiPCStationBoardProps {
  subgrid: string;
  surveyDate: string;
  totalFrames: number;
  onAdvanceToQA: () => void;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  isGuestUser?: boolean;
}

const STATION_TEMPLATE: Array<{
  id: StationState['id'];
  name: string;
  pcLabel: string;
  software: string;
  from: string;
  to: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'blur',
    name: 'Privacy Blur Station',
    pcLabel: 'PC 1',
    software: 'Privacy Keeper / Face & Plate Blur',
    from: '/00_Raw_data/',
    to: '/02_Blurring/',
    icon: <EyeOff size={11} className="text-text-muted shrink-0" />
  },
  {
    id: 'stitch',
    name: 'Stitching Station',
    pcLabel: 'PC 2',
    software: 'PTGui Pro Batch Stitcher (Equirectangular)',
    from: '/02_Blurring/',
    to: '/03_Stitching/',
    icon: <RotateCcw size={11} className="text-text-muted shrink-0" />
  },
  {
    id: 'lightroom',
    name: 'Lightroom Enhance',
    pcLabel: 'PC 3',
    software: 'Adobe Lightroom Classic (Color / Exposure)',
    from: '/03_Stitching/',
    to: '/04_Lightroom/',
    icon: <Sparkles size={11} className="text-text-muted shrink-0" />
  },
  {
    id: 'photoshop',
    name: 'Nadir Cap / Masking',
    pcLabel: 'PC 4',
    software: 'Adobe Photoshop Action (Nadir Patch)',
    from: '/04_Lightroom/',
    to: '/05_Final/',
    icon: <SlidersHorizontal size={11} className="text-text-muted shrink-0" />
  }
];

const STATUS_TONE: Record<StationState['status'], { label: string; text: string; dot: string }> = {
  WAITING: { label: 'Not started', text: 'text-text-muted', dot: 'text-text-muted/60' },
  IN_PROGRESS: { label: 'Operator in progress', text: 'text-amber-300', dot: 'text-amber-400' },
  COMPLETED: { label: 'Operator confirmed', text: 'text-emerald-300', dot: 'text-emerald-400' },
  FLAGGED: { label: 'Flagged', text: 'text-red-300', dot: 'text-red-400' }
};

const logLocalTime = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

export const MultiPCStationBoard: React.FC<MultiPCStationBoardProps> = ({
  subgrid,
  totalFrames,
  onAdvanceToQA,
  addNotification,
  addAuditLog
}) => {
  const cleanSg = subgrid.trim().toUpperCase();
  // Folder paths are templates. An unresolved subgrid stays visible as a
  // placeholder instead of silently falling back to a real-looking code.
  const sgToken = cleanSg || '[subgrid]';
  const incomingTotal = totalFrames > 0 ? totalFrames : 0;

  const [stations, setStations] = useState<StationState[]>(() =>
    STATION_TEMPLATE.map((t) => ({
      id: t.id,
      name: t.name,
      pcLabel: t.pcLabel,
      software: t.software,
      sourceFolder: `${t.from}${sgToken}/`,
      outputFolder: `${t.to}${sgToken}/`,
      status: 'WAITING',
      completedFrames: 0,
      totalFrames: incomingTotal
    }))
  );

  // Track the incoming real batch total until an operator overrides it.
  useEffect(() => {
    setStations((prev) =>
      prev.map((st) => ({
        ...st,
        totalFrames: st.totalFrames > 0 ? st.totalFrames : incomingTotal,
        sourceFolder: `${st.sourceFolder.split(sgToken)[0]}${sgToken}/`,
        outputFolder: `${st.outputFolder.split(sgToken)[0]}${sgToken}/`
      }))
    );
  }, [incomingTotal, sgToken]);

  const stationsWithKnownTotal = useMemo(() => stations.filter((s) => s.totalFrames > 0), [stations]);

  const overallProgress = useMemo(() => {
    if (stationsWithKnownTotal.length === 0) return null;
    const possible = stationsWithKnownTotal.reduce((acc, s) => acc + s.totalFrames, 0);
    const done = stationsWithKnownTotal.reduce((acc, s) => acc + Math.min(s.completedFrames, s.totalFrames), 0);
    if (possible <= 0) return null;
    return Math.round((done / possible) * 100);
  }, [stationsWithKnownTotal]);

  const allStationsComplete = useMemo(
    () => stations.length > 0 && stations.every((s) => s.status === 'COMPLETED'),
    [stations]
  );

  const patchStation = (idx: number, patch: Partial<StationState>) => {
    setStations((prev) => prev.map((st, i) => (i === idx ? { ...st, ...patch } : st)));
  };

  const handleStartStation = (idx: number) => {
    const station = stations[idx];
    patchStation(idx, { status: 'IN_PROGRESS', startedAt: new Date().toISOString() });
    addNotification?.({
      title: `${station.pcLabel} Marked In Progress`,
      message: `An operator recorded the start of ${station.name} for ${cleanSg}. This is a manual log entry, not worker telemetry.`,
      category: 'SYSTEM',
      read: false
    });
    addAuditLog?.(
      'INFO',
      'Workstation Progress Logged',
      `${station.pcLabel} (${station.name}) marked in progress by an operator for ${cleanSg}. Manual entry, unverified.`,
      'info'
    );
  };

  const handleFramesChanged = (idx: number, field: 'completedFrames' | 'totalFrames', raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const station = stations[idx];
    const next = { ...station, [field]: value } as StationState;
    if (field === 'completedFrames' && next.totalFrames > 0) {
      next.completedFrames = Math.min(next.completedFrames, next.totalFrames);
    }
    patchStation(idx, next);
  };

  const handleMarkStationComplete = (idx: number) => {
    const station = stations[idx];
    const completed = station.totalFrames > 0 ? station.totalFrames : station.completedFrames;
    patchStation(idx, {
      status: 'COMPLETED',
      completedFrames: completed,
      completedAt: new Date().toISOString()
    });

    addNotification?.({
      title: `${station.pcLabel} Marked Complete`,
      message: `An operator confirmed ${station.name} for ${cleanSg}. The next workstation is not started automatically — start it when the handoff is done.`,
      category: 'SYSTEM',
      read: false
    });
    addAuditLog?.(
      'INFO',
      'Workstation Completion Logged',
      `${station.pcLabel} (${station.name}) confirmed complete for ${cleanSg} with ${completed} frames. Manual entry, unverified.`,
      'info'
    );
  };

  if (!cleanSg) {
    return (
      <div className="flex flex-col gap-3 py-12 items-center text-center">
        <Info size={30} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-base tracking-tight">No Subgrid Selected</h3>
        <p className="text-xs text-text-muted max-w-md">
          Set a subgrid in Stitched Intake &amp; Pairing before tracking the 4-PC flight board. Station
          folder paths stay as templates until a real subgrid is provided.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-3 border-b border-subtle flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">
            4-PC Multi-Workstation Flight Board
          </h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed max-w-3xl">
            Manual handoff tracker for <span className="font-mono text-text-base">{cleanSg}</span>. This board does not
            poll the stitching workers, so every figure below is operator-entered and unverified — no throughput, elapsed
            time or ETA is inferred. Timestamps are the local browser clock of whoever clicked the control.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Pipeline</span>
          {overallProgress !== null ? (
            <>
              <div className="w-24 h-1.5 bg-inner border border-subtle rounded-full overflow-hidden">
                <div
                  className="h-full bg-text-base transition-all duration-300"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
              <span className="text-xs font-mono font-medium text-text-base">{overallProgress}%</span>
            </>
          ) : (
            <span className="text-xs text-text-muted">Unknown — no batch total entered</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {stations.map((st, idx) => {
          const tone = STATUS_TONE[st.status];
          const hasTotal = st.totalFrames > 0;
          const pct = hasTotal ? Math.round((Math.min(st.completedFrames, st.totalFrames) / st.totalFrames) * 100) : null;

          return (
            <div key={st.id} className="rounded-xl border border-subtle flex flex-col divide-y divide-[var(--divider)]">
              <div className="p-3.5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-mono font-black text-text-base">{st.pcLabel}</span>
                      <span className="text-xs font-bold text-text-base truncate">{st.name}</span>
                    </div>
                    <div className="text-[11px] text-text-muted flex items-center gap-1 truncate mt-0.5" title={st.software}>
                      {STATION_TEMPLATE[idx].icon}
                      <span className="truncate">{st.software}</span>
                    </div>
                  </div>
                </div>

                <div className={`text-[11px] font-semibold flex items-center gap-1.5 ${tone.text}`}>
                  <StatusDot tone={tone.dot} pulse={st.status === 'IN_PROGRESS'} />
                  <span>{tone.label}</span>
                </div>

                <div className="text-[10px] font-mono text-text-muted space-y-0.5">
                  <div className="truncate" title={st.sourceFolder}>
                    IN <span className="text-text-base">{st.sourceFolder}</span>
                  </div>
                  <div className="truncate" title={st.outputFolder}>
                    OUT <span className="text-text-base">{st.outputFolder}</span>
                  </div>
                </div>
              </div>

              <div className="px-3.5 py-2.5 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Done</span>
                    <input
                      type="number"
                      min={0}
                      max={hasTotal ? st.totalFrames : undefined}
                      value={st.completedFrames}
                      onChange={(e) => handleFramesChanged(idx, 'completedFrames', e.target.value)}
                      className="bg-inner border border-subtle rounded-md px-2 py-1 text-xs font-mono text-text-base focus:outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Batch Total</span>
                    <input
                      type="number"
                      min={0}
                      value={st.totalFrames}
                      onChange={(e) => handleFramesChanged(idx, 'totalFrames', e.target.value)}
                      className="bg-inner border border-subtle rounded-md px-2 py-1 text-xs font-mono text-text-base focus:outline-none focus:border-sky-500"
                    />
                  </label>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-text-muted">Progress</span>
                  <span className="text-text-base">
                    {st.completedFrames} / {hasTotal ? st.totalFrames : '?'}
                    {pct !== null ? ` (${pct}%)` : ''}
                  </span>
                </div>
                {pct !== null && (
                  <div className="w-full h-1 bg-inner border border-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-text-base transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                <div className="text-[10px] text-text-muted font-mono space-y-0.5 pt-1 border-t border-divider">
                  <div className="flex justify-between gap-2">
                    <span>Started</span>
                    <span className="truncate">{logLocalTime(st.startedAt)}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Confirmed</span>
                    <span className="truncate">{logLocalTime(st.completedAt)}</span>
                  </div>
                </div>
              </div>

              <div className="px-3.5 py-2.5">
                {st.status === 'WAITING' && (
                  <button
                    type="button"
                    onClick={() => handleStartStation(idx)}
                    className="w-full py-1.5 bg-inner border border-subtle hover:border-divider text-text-base text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Play size={12} />
                    <span>Mark {st.pcLabel} Started</span>
                  </button>
                )}

                {st.status === 'IN_PROGRESS' && (
                  <button
                    type="button"
                    onClick={() => handleMarkStationComplete(idx)}
                    className="w-full py-1.5 bg-text-base text-card hover:opacity-90 text-xs font-medium rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer"
                  >
                    <Check size={13} />
                    <span>Confirm Complete</span>
                  </button>
                )}

                {st.status === 'COMPLETED' && (
                  <div className="text-[11px] text-emerald-300 flex items-center justify-center gap-1.5 py-1">
                    <CheckCircle2 size={13} />
                    <span>Operator confirmed complete</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {allStationsComplete && (
        <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
          <div>
            <h4 className="text-xs font-bold text-text-base">
              All 4 Workstations Logged Complete for {cleanSg}
            </h4>
            <p className="text-[11px] text-text-muted mt-0.5">
              Operator-reported output should be in{' '}
              <span className="font-mono text-text-base">/05_Final/{cleanSg}/</span>. The QA inspection tab checks what is
              actually stored there.
            </p>
          </div>
          <button
            type="button"
            onClick={onAdvanceToQA}
            className="px-4 py-2 bg-text-base text-card hover:opacity-90 font-medium text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <span>Proceed to 360° QA Review</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
