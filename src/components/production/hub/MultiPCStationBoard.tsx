import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowRight,
  Bot,
  EyeOff,
  Info,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Wifi,
  WifiOff
} from 'lucide-react';
import { StatusDot } from '../chrome';
import {
  DEFAULT_4_WORKSTATIONS,
  type StationAgentObservation,
  type StationBoardMetricUnit,
  type StationBoardRow,
  type StationBoardSource,
  type StationBoardStatus,
  type WorkstationStationConfig,
  type WorkstationStationId
} from '../../../types/production';
import {
  fetchStationBoardItemsFromSupabase,
  upsertStationBoardItemInSupabase
} from '../../../services/api/stationBoard';
import { appendStageEventToSupabase } from '../../../services/api/stageEventLedger';
import { DailyProcessingRegistry } from './DailyProcessingRegistry';

export interface MultiPCStationBoardProps {
  subgrid: string;
  surveyDate?: string;
  totalFrames: number;
  onAdvanceToQA: () => void;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  isGuestUser?: boolean;
  projectSettings?: { workstationsConfig?: WorkstationStationConfig[] } & Record<string, unknown>;
  /** Latest per-station agent observations from useStationAgents(). */
  stationObservations?: Record<string, StationAgentObservation>;
}

interface StationTemplate {
  id: WorkstationStationId;
  name: string;
  pcLabel: string;
  software: string;
  from: string;
  to: string;
  icon: React.ReactNode;
}

const STATION_TEMPLATE: StationTemplate[] = [
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

const STATUS_TONE: Record<StationBoardStatus, { label: string; text: string; dot: string }> = {
  WAITING: { label: 'Not started', text: 'text-text-muted', dot: 'text-text-muted/60' },
  IN_PROGRESS: { label: 'In progress', text: 'text-amber-300', dot: 'text-amber-400' },
  COMPLETED: { label: 'Completed', text: 'text-emerald-300', dot: 'text-emerald-400' },
  FLAGGED: { label: 'Flagged — early exit', text: 'text-red-300', dot: 'text-red-400' }
};

const SOURCE_PILL: Record<StationBoardSource, { label: string; cls: string; icon: React.ReactNode }> = {
  agent: {
    label: 'Auto · agent',
    // Plain text status: no border / background box per the design call.
    cls: 'text-emerald-300',
    icon: <Bot size={10} />
  },
  snapshot: {
    label: 'Restored snapshot',
    cls: 'text-amber-300',
    icon: <WifiOff size={10} />
  },
  none: {
    label: 'Awaiting agent',
    cls: 'text-text-muted',
    icon: <WifiOff size={10} />
  }
};

const logLocalTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const relativeTime = (iso?: string | null) => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 90) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
};

interface DerivedStation {
  id: WorkstationStationId;
  pcLabel: string;
  name: string;
  software: string;
  sourceFolder: string;
  outputFolder: string;
  status: StationBoardStatus;
  completedFrames: number;
  totalFrames: number;
  hasTotal: boolean;
  /** Counter unit: stitched frames (default) or capture points (tile rigs). */
  unit: StationBoardMetricUnit;
  tilesDone?: number;
  hostname?: string;
  startedAt?: string;
  completedAt?: string;
  source: StationBoardSource;
  agentOnline: boolean;
  lastPulseAt?: string;
  detail: string;
  note?: string;
}

function deriveStation(
  tpl: StationTemplate,
  ctx: {
    cleanSg: string;
    intakeTotal: number;
    obs?: StationAgentObservation;
    row?: StationBoardRow;
    ws?: WorkstationStationConfig;
  }
): DerivedStation {
  const { cleanSg, intakeTotal, obs, row, ws } = ctx;
  const report = obs?.report || null;
  const agentLive = !!obs?.online && !!report;
  const subOut = report?.output?.subgrids?.[cleanSg];
  const task = report?.task;

  if (agentLive) {
    const files = subOut?.files ?? 0;
    // Tile-rig stations (POINT_MODE, default PC 1 blur): the atomic unit is a
    // capture point (rig folder of camera tiles), not a stitchable image.
    const pt = report?.points?.subgrids?.[cleanSg];
    const ptCounted = pt && (pt.points_total ?? 0) > 0 ? pt : null;
    const ptTotal = ptCounted ? ptCounted.points_total ?? 0 : 0;
    const unit: StationBoardMetricUnit = ptCounted ? 'points' : 'frames';
    const hasTotal = ptCounted ? true : intakeTotal > 0;
    const total = ptCounted ? ptTotal : hasTotal ? intakeTotal : files;
    const done = ptCounted
      ? Math.min(ptCounted.points_done ?? 0, ptTotal)
      : Math.min(files, total || files);
    let status: StationBoardStatus;
    let startedAt: string | undefined;
    let completedAt: string | undefined;
    let note: string | undefined;
    const procNames = (task?.processes || []).map((p) => p.name).filter(Boolean);
    const procLabel = procNames.length > 0 ? procNames.slice(0, 2).join(' + ') : 'the station app';
    const unitLabel = unit === 'points' ? 'capture point(s)' : 'frame(s)';

    if (task?.started) {
      status = 'IN_PROGRESS';
      startedAt = task.first_started_at || row?.started_at || undefined;
      note = done === 0
        ? `${procLabel} running — awaiting first ${unit === 'points' ? 'point output' : 'output'}`
        : undefined;
    } else if (done > 0) {
      if (hasTotal && done >= total) {
        status = 'COMPLETED';
        completedAt = subOut?.last_write_at || row?.completed_at || undefined;
      } else {
        status = 'FLAGGED';
        note = `${procLabel} ended with ${done} of ${hasTotal ? total : '?'} ${unitLabel} written. Restart the app to resume.`;
      }
    } else {
      status = 'WAITING';
    }
    return {
      id: tpl.id,
      pcLabel: tpl.pcLabel,
      name: tpl.name,
      software: tpl.software,
      sourceFolder: `${tpl.from}${cleanSg}/`,
      outputFolder: `${tpl.to}${cleanSg}/`,
      status,
      completedFrames: done,
      totalFrames: total,
      hasTotal: hasTotal || done > 0,
      unit,
      tilesDone: pt?.tiles_done,
      hostname: report?.hostname || undefined,
      startedAt,
      completedAt,
      source: 'agent',
      agentOnline: true,
      lastPulseAt: obs?.lastProbeAt,
      detail: status === 'WAITING' ? 'Watching for the station app…' : `${procLabel} · output in ${tpl.to}${cleanSg}/`,
      note
    };
  }

  if (row) {
    return {
      id: tpl.id,
      pcLabel: tpl.pcLabel,
      name: tpl.name,
      software: tpl.software,
      sourceFolder: `${tpl.from}${cleanSg}/`,
      outputFolder: `${tpl.to}${cleanSg}/`,
      status: row.status || 'WAITING',
      completedFrames: row.completed_frames || 0,
      totalFrames: row.total_frames || intakeTotal || 0,
      hasTotal: (row.total_frames || 0) > 0 || intakeTotal > 0,
      unit: row.metric_unit === 'points' ? 'points' : 'frames',
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      source: 'snapshot',
      agentOnline: false,
      lastPulseAt: row.last_agent_pulse || row.updated_at,
      detail: `Last persisted state · agent pulse ${relativeTime(row.last_agent_pulse || row.updated_at)}`,
      note: row.note || undefined
    };
  }

  return {
    id: tpl.id,
    pcLabel: tpl.pcLabel,
    name: tpl.name,
    software: tpl.software,
    sourceFolder: `${tpl.from}${cleanSg}/`,
    outputFolder: `${tpl.to}${cleanSg}/`,
    status: 'WAITING',
    completedFrames: 0,
    totalFrames: intakeTotal,
    hasTotal: intakeTotal > 0,
    unit: 'frames',
    source: 'none',
    agentOnline: false,
    detail: ws?.ipAddress
      ? `Agent unreachable at ${ws.ipAddress}:${ws.port || 8000} — see station-agent/README.md`
      : 'No agent configured for this PC — set its IP under Providers → Workstations'
  };
}

export const MultiPCStationBoard: React.FC<MultiPCStationBoardProps> = ({
  subgrid,
  totalFrames,
  onAdvanceToQA,
  addNotification,
  addAuditLog,
  userLabel,
  projectSettings,
  stationObservations
}) => {
  const cleanSg = subgrid.trim().toUpperCase();
  const incomingTotal = totalFrames > 0 ? totalFrames : 0;

  const workstations: WorkstationStationConfig[] = useMemo(
    () =>
      ((projectSettings?.workstationsConfig as WorkstationStationConfig[] | undefined) ||
        DEFAULT_4_WORKSTATIONS),
    [projectSettings?.workstationsConfig]
  );
  const wsById = useMemo(() => {
    const map: Partial<Record<WorkstationStationId, WorkstationStationConfig>> = {};
    workstations.forEach((w) => {
      map[w.id] = w;
    });
    return map;
  }, [workstations]);

  // Persisted snapshots restore the board when agents are unreachable.
  const [rows, setRows] = useState<StationBoardRow[]>([]);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  useEffect(() => {
    let disposed = false;
    const sg = cleanSg;
    if (!sg) return;
    setRowsLoaded(false);
    fetchStationBoardItemsFromSupabase(sg)
      .then((r) => {
        if (!disposed) {
          setRows(r);
          setRowsLoaded(true);
        }
      })
      .catch(() => {
        if (!disposed) setRowsLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, [cleanSg]);

  const derived = useMemo(
    () =>
      STATION_TEMPLATE.map((tpl) =>
        deriveStation(tpl, {
          cleanSg,
          intakeTotal: incomingTotal,
          obs: stationObservations?.[tpl.id],
          row: rows.find((r) => r.station_id === tpl.id),
          ws: wsById[tpl.id]
        })
      ),
    [cleanSg, incomingTotal, stationObservations, rows, wsById]
  );

  const overallProgress = useMemo(() => {
    const done = derived.reduce((acc, s) => acc + (s.hasTotal ? Math.min(s.completedFrames, s.totalFrames) : 0), 0);
    const possible = derived.reduce((acc, s) => acc + (s.hasTotal ? s.totalFrames : 0), 0);
    if (possible <= 0) return null;
    return Math.round((done / possible) * 100);
  }, [derived]);

  const allStationsComplete = derived.length > 0 && derived.every((s) => s.status === 'COMPLETED');
  const agentsOnline = derived.filter((s) => s.agentOnline).length;

  // Persist derived state so the board survives refresh and is shared across
  // operator browsers. Guarded by the fingerprint to avoid per-pulse writes.
  const persistFingerprint = useMemo(
    () =>
      derived
        .map((d) =>
          [d.id, d.status, d.completedFrames, d.totalFrames, d.startedAt || '', d.completedAt || ''].join('~')
        )
        .join('|'),
    [derived]
  );
  const lastPersistRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cleanSg || !rowsLoaded) return;
    const key = `${cleanSg}|${persistFingerprint}`;
    if (lastPersistRef.current === key) return;
    lastPersistRef.current = key;
    derived.forEach((d) => {
      void upsertStationBoardItemInSupabase({
        subgrid: cleanSg,
        station_id: d.id,
        status: d.status,
        total_frames: d.hasTotal ? d.totalFrames : 0,
        completed_frames: d.completedFrames,
        metric_unit: d.unit === 'points' ? 'points' : 'frames',
        started_at: d.startedAt || null,
        completed_at: d.completedAt || null,
        source: d.source,
        note: d.note || null,
        last_agent_pulse: d.lastPulseAt || null,
        updated_by: userLabel || 'System'
      }).then((ok) => {
        if (!ok) {
          addAuditLog?.('WARN', 'Flight Board Save Failed', `Could not save ${d.pcLabel} state for ${cleanSg} (offline-mode cache in use).`, 'warn');
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistFingerprint, cleanSg, rowsLoaded]);

  // Auto-transition notifications + stage-ledger events: fire once per status
  // change while the board is open (first mount stays silent).
  const lastStatusRef = useRef<Partial<Record<WorkstationStationId, StationBoardStatus>>>({});
  useEffect(() => {
    derived.forEach((d) => {
      const prev = lastStatusRef.current[d.id];
      lastStatusRef.current[d.id] = d.status;
      if (prev === undefined || prev === d.status || !rowsLoaded) return;
      if (d.status === 'IN_PROGRESS' && d.source === 'agent') {
        addNotification?.({
          title: `${d.pcLabel} Auto-Started`,
          message: `Station agent detected ${d.note || d.detail}.`,
          category: 'SYSTEM',
          read: false
        });
        addAuditLog?.('INFO', 'Workstation Auto-Detected Running', `${d.pcLabel}: ${d.detail}. Task start recorded automatically.`, 'info');
        void appendStageEventToSupabase({
          subgrid: cleanSg,
          stage: d.id,
          event: 'STARTED',
          via: 'agent',
          occurrence: d.startedAt || undefined,
          detail: d.hostname ? `${d.detail} (${d.hostname})` : d.detail,
          counts: { done: d.completedFrames, total: d.hasTotal ? d.totalFrames : null, hostname: d.hostname || null },
          updated_by: userLabel || 'System'
        });
      } else if (d.status === 'COMPLETED' && d.source === 'agent') {
        addNotification?.({
          title: `${d.pcLabel} Auto-Completed`,
          message: `${d.outputFolder}${cleanSg}/ reached the batch target (${d.completedFrames}/${d.totalFrames}).`,
          category: 'SYSTEM',
          read: false
        });
        addAuditLog?.('INFO', 'Workstation Auto-Completed', `${d.pcLabel} reached ${d.completedFrames}/${d.totalFrames} for ${cleanSg}.`, 'info');
        void appendStageEventToSupabase({
          subgrid: cleanSg,
          stage: d.id,
          event: 'COMPLETED',
          via: 'agent',
          occurrence: d.completedAt || undefined,
          detail: `${d.outputFolder}${cleanSg}/ reached the batch target`,
          counts: { done: d.completedFrames, total: d.totalFrames, unit: d.unit, hostname: d.hostname || null },
          updated_by: userLabel || 'System'
        });
      } else if (d.status === 'FLAGGED') {
        addNotification?.({
          title: `${d.pcLabel} Flagged`,
          message: d.note || 'Station process ended before the batch target.',
          category: 'SYSTEM',
          read: false
        });
        addAuditLog?.('WARN', 'Workstation Flagged', `${d.pcLabel}: ${d.note}.`, 'warn');
        void appendStageEventToSupabase({
          subgrid: cleanSg,
          stage: d.id,
          event: 'FLAGGED',
          via: d.source === 'agent' ? 'agent' : 'system',
          detail: d.note || 'Station process ended before the batch target.',
          counts: { done: d.completedFrames, total: d.hasTotal ? d.totalFrames : null, hostname: d.hostname || null },
          updated_by: userLabel || 'System'
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, rowsLoaded]);

  // Per-frame PROGRESS events: appended whenever the agent reports a new
  // output count for an in-progress station (gives the count curve).
  const lastFramesRef = useRef<Partial<Record<WorkstationStationId, number>>>({});
  useEffect(() => {
    derived.forEach((d) => {
      if (d.status !== 'IN_PROGRESS' || !d.agentOnline) return;
      const prev = lastFramesRef.current[d.id];
      lastFramesRef.current[d.id] = d.completedFrames;
      if (prev === undefined || prev === d.completedFrames || !rowsLoaded) return;
      void appendStageEventToSupabase({
        subgrid: cleanSg,
        stage: d.id,
        event: 'PROGRESS',
        via: 'agent',
        detail: `${d.completedFrames} ${d.unit === 'points' ? 'capture point(s)' : 'frame(s)'} in ${d.outputFolder}${cleanSg}/`,
        counts: { done: d.completedFrames, total: d.hasTotal ? d.totalFrames : null, unit: d.unit, hostname: d.hostname || null },
        updated_by: userLabel || 'System'
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, rowsLoaded]);

  // Agent reachability transitions for accountability (up/down while open).
  const lastOnlineRef = useRef<Partial<Record<WorkstationStationId, boolean>>>({});
  useEffect(() => {
    derived.forEach((d) => {
      const prev = lastOnlineRef.current[d.id];
      const now = d.source === 'agent' && d.agentOnline;
      lastOnlineRef.current[d.id] = now;
      if (prev === undefined || prev === now || !rowsLoaded) return;
      void appendStageEventToSupabase({
        subgrid: cleanSg,
        stage: d.id,
        event: now ? 'AGENT_ONLINE' : 'AGENT_OFFLINE',
        via: 'system',
        detail: now
          ? d.hostname ? `Agent reachable on ${d.hostname}` : 'Agent reachable'
          : 'Agent unreachable — board shows last persisted snapshot',
        counts: { done: d.completedFrames, total: d.hasTotal ? d.totalFrames : null },
        updated_by: userLabel || 'System'
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, rowsLoaded]);

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
      <div className="pb-3 border-b border-subtle flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">
            4-PC Multi-Workstation Flight Board
          </h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed max-w-3xl">
            {agentsOnline > 0 ? (
              <>
                Track progress across the four processing stations for{' '}
                <span className="font-mono text-text-base">{cleanSg}</span>. {agentsOnline}/4 workstation agents connected.
              </>
            ) : (
              <>
                Track progress across the four processing stations for{' '}
                <span className="font-mono text-text-base">{cleanSg}</span>. Connect workstation agents for live updates.
              </>
            )}
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
        {derived.map((st) => {
          const tone = STATUS_TONE[st.status];
          const pill = SOURCE_PILL[st.source];
          const pct = st.hasTotal && st.totalFrames > 0
            ? Math.round((Math.min(st.completedFrames, st.totalFrames) / st.totalFrames) * 100)
            : null;
          const ws = wsById[st.id];
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
                      {STATION_TEMPLATE.find((t) => t.id === st.id)?.icon}
                      <span className="truncate">{st.software}</span>
                    </div>
                  </div>
                  {st.agentOnline ? (
                    <span title={`Agent live · pulse ${relativeTime(st.lastPulseAt)}`} className="flex shrink-0">
                      <Wifi size={13} className="text-emerald-400" />
                    </span>
                  ) : (
                    <span title="Agent unreachable" className="flex shrink-0">
                      <WifiOff size={13} className="text-text-muted/50" />
                    </span>
                  )}
                </div>

                <div className={`text-[11px] font-semibold flex items-center gap-1.5 ${tone.text}`}>
                  <StatusDot tone={tone.dot} pulse={st.status === 'IN_PROGRESS' && st.agentOnline} />
                  <span>{tone.label}</span>
                </div>

                <span
                  className={`self-start inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider ${pill.cls}`}
                  title={st.source === 'agent' ? 'State comes live from the station agent' : st.source === 'snapshot' ? 'Agent offline — showing last persisted state' : 'Waiting for this PC\'s station agent'}
                >
                  {pill.icon}
                  <span>{pill.label}</span>
                </span>

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
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-text-muted">Progress</span>
                  <span className="text-text-base">
                    {st.completedFrames} / {st.totalFrames > 0 ? st.totalFrames : '?'}
                    {st.unit === 'points' ? ' pts' : ''}
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

                <div className="text-[10px] text-text-muted leading-relaxed">
                  {st.note ? st.note : st.detail}
                  {st.unit === 'points' && (
                    <span className="block text-text-muted">
                      Counted in capture points (tile rigs) — {st.tilesDone ? `${st.tilesDone} tiles blurred` : 'no tiles yet'}; raw rigs merge into single panoramas at PC 2.
                    </span>
                  )}
                  {ws?.processNames && ws.processNames.length > 0 && (
                    <span className="block truncate text-text-muted/70" title={ws.processNames.join(', ')}>
                      Watches: {ws.processNames.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {allStationsComplete && (
        <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
          <div>
            <h4 className="text-xs font-bold text-text-base">
              All 4 Workstations Completed for {cleanSg}
            </h4>
            <p className="text-[11px] text-text-muted mt-0.5">
              Auto-verified output lives in <span className="font-mono text-text-base">/05_Final/{cleanSg}/</span>. The QA
              inspection tab checks what is actually stored there.
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

      <div className="pt-4 border-t border-subtle">
        <DailyProcessingRegistry />
      </div>
    </div>
  );
};
