import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ClipboardList, RefreshCw } from 'lucide-react';
import { fetchStationBoardItemsFromSupabase } from '../../../services/api/stationBoard';
import { fetchDashboardApi } from '../../../services/cloudflareApi';
import type { StationBoardRow, WorkstationStationId } from '../../../types/production';

interface RegistryChild {
  name: string;
  date: string;
  stitched: boolean;
  images: number;
  metadataRows: number;
  csvName: string;
  hasMetadata: boolean;
  stitchingPath: string;
}

interface RegistryEntry {
  subgrid: string;
  existsInStitching: boolean;
  totals: { surveys: number; stitchedRuns: number; metadataTotal: number; imagesTotal: number };
  children: RegistryChild[];
}

const STATION_ORDER: Array<{ id: WorkstationStationId; pcLabel: string }> = [
  { id: 'blur', pcLabel: 'PC 1' },
  { id: 'stitch', pcLabel: 'PC 2' },
  { id: 'lightroom', pcLabel: 'PC 3' },
  { id: 'photoshop', pcLabel: 'PC 4' }
];

interface StageAssessment {
  pass: boolean;
  tone: 'pass' | 'blocked' | 'warn';
  label: string;
  detail: string;
}

/** The 4-PC pipeline verdict for one subgrid, from persisted board rows. */
function assessStage(rows: Record<string, StationBoardRow | undefined> | undefined): StageAssessment {
  const statuses = STATION_ORDER.map((st) => ({ st, row: rows?.[st.id] }));
  if (!rows || statuses.every((s) => !s.row)) {
    return { pass: false, tone: 'warn', label: 'No station activity', detail: 'Flight board rows not persisted yet' };
  }
  const completed = statuses.filter((s) => s.row?.status === 'COMPLETED').length;
  if (completed === STATION_ORDER.length) {
    return { pass: true, tone: 'pass', label: 'Passed all 4 stages', detail: 'Blur → Stitch → Lightroom → Photoshop confirmed' };
  }
  const reasons = statuses
    .filter((s) => s.row?.status !== 'COMPLETED')
    .map((s) => {
      const status = s.row?.status;
      if (!status) return `${s.st.pcLabel} no record`;
      if (status === 'FLAGGED') return `${s.st.pcLabel} flagged (early exit)`;
      if (status === 'IN_PROGRESS') return `${s.st.pcLabel} in progress`;
      return `${s.st.pcLabel} not started`;
    });
  const hasFlag = statuses.some((s) => s.row?.status === 'FLAGGED');
  return {
    pass: false,
    tone: hasFlag ? 'blocked' : 'warn',
    label: `Not passed — ${completed}/4 stages`,
    detail: reasons.join(' · ')
  };
}

const STAGE_TONE: Record<StageAssessment['tone'], string> = {
  // Plain text status: no border / background box per the design call.
  pass: 'text-emerald-300',
  blocked: 'text-red-300',
  warn: 'text-amber-300'
};

export const DailyProcessingRegistry: React.FC = () => {
  const [registry, setRegistry] = useState<RegistryEntry[] | null>(null);
  const [boardRows, setBoardRows] = useState<StationBoardRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let disposed = false;
    fetchDashboardApi('/api/nas-scan?action=registry')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!disposed) setRegistry(data?.success && Array.isArray(data.registry) ? data.registry : []);
      })
      .catch(() => {
        if (!disposed) setRegistry([]);
      });
    fetchStationBoardItemsFromSupabase()
      .then((rows) => {
        if (!disposed) setBoardRows(rows);
      })
      .catch(() => {
        if (!disposed) setBoardRows([]);
      });
    return () => {
      disposed = true;
    };
  }, [tick]);

  const rowsBySubgrid = useMemo(() => {
    const map: Record<string, Record<string, StationBoardRow>> = {};
    boardRows.forEach((r) => {
      const sg = (r.subgrid || '').trim().toUpperCase();
      if (!sg) return;
      map[sg] = map[sg] || {};
      map[sg][r.station_id] = r;
    });
    return map;
  }, [boardRows]);

  const toggle = (sg: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sg)) next.delete(sg);
      else next.add(sg);
      return next;
    });
  };

  const totals = useMemo(() => {
    const list = registry || [];
    return {
      subgrids: list.length,
      surveys: list.reduce((a, e) => a + e.totals.surveys, 0),
      metadata: list.reduce((a, e) => a + e.totals.metadataTotal, 0),
      images: list.reduce((a, e) => a + e.totals.imagesTotal, 0)
    };
  }, [registry]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList size={13} className="text-text-muted shrink-0" />
          <h4 className="text-xs font-bold text-text-base tracking-tight">Daily Processing Registry</h4>
          <span className="text-[10px] text-text-muted">
            parent subgrid → child survey runs · metadata CSV totals · images processed · 4-PC pipeline verdict
          </span>
        </div>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer transition-colors shrink-0"
        >
          <RefreshCw size={11} />
          <span>Refresh</span>
        </button>
      </div>

      {registry === null ? (
        <div className="rounded-xl border border-subtle bg-card px-4 py-8 text-center text-[11px] text-text-muted">
          Reading survey registry…
        </div>
      ) : registry.length === 0 ? (
        <div className="rounded-xl border border-subtle bg-card px-4 py-8 text-center text-[11px] text-text-muted">
          No survey data found under the NAS working base yet — stitched runs, metadata folders and raw captures appear here automatically.
        </div>
      ) : (
        <>
          <div className="bg-inner border border-subtle rounded-xl px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-text-muted">
            <span>Subgrids: <span className="font-bold text-text-base">{totals.subgrids}</span></span>
            <span>Survey runs: <span className="font-bold text-text-base">{totals.surveys}</span></span>
            <span>Metadata rows: <span className="font-bold text-text-base">{totals.metadata}</span></span>
            <span>Images processed: <span className="font-bold text-text-base">{totals.images}</span></span>
          </div>

          <div className="rounded-xl border border-subtle bg-card overflow-hidden">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs min-w-[900px]">
                <thead>
                  <tr className="border-b border-divider bg-inner text-[10px] uppercase font-bold text-text-muted tracking-wider sticky top-0 z-10">
                    <th className="py-2.5 px-3">Subgrid / Survey Run</th>
                    <th className="py-2.5 px-3 w-24">Date</th>
                    <th className="py-2.5 px-3 w-28 text-right">Metadata</th>
                    <th className="py-2.5 px-3 w-28 text-right">Images</th>
                    <th className="py-2.5 px-3">4-PC Pipeline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {registry.map((entry) => {
                    const stage = assessStage(rowsBySubgrid[entry.subgrid]);
                    const isOpen = expanded.has(entry.subgrid);
                    return (
                      <React.Fragment key={entry.subgrid}>
                        <tr className="hover:bg-inner transition-colors">
                          <td className="py-2.5 px-3">
                            <button
                              type="button"
                              onClick={() => toggle(entry.subgrid)}
                              disabled={entry.children.length === 0}
                              className="flex items-center gap-2 text-left cursor-pointer disabled:cursor-default"
                              title={entry.children.length > 0 ? `Show ${entry.children.length} survey run(s)` : 'No survey runs'}
                            >
                              {entry.children.length > 0 ? (
                                isOpen ? <ChevronDown size={13} className="text-text-muted" /> : <ChevronRight size={13} className="text-text-muted" />
                              ) : (
                                <span className="w-[13px]" />
                              )}
                              <span className="font-mono font-bold text-text-base">{entry.subgrid}</span>
                              <span className="text-[10px] font-sans text-text-muted">({entry.totals.surveys} run{entry.totals.surveys === 1 ? '' : 's'})</span>
                            </button>
                          </td>
                          <td className="py-2.5 px-3 text-text-muted font-mono">—</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-text-base">{entry.totals.metadataTotal}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-text-base">{entry.totals.imagesTotal}</td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider font-sans ${STAGE_TONE[stage.tone]}`}>
                                {stage.label}
                              </span>
                              <span className="text-[10px] font-sans text-text-muted truncate min-w-0" title={stage.detail}>{stage.detail}</span>
                            </div>
                          </td>
                        </tr>
                        {isOpen && entry.children.map((child) => (
                          <tr key={`${entry.subgrid}-${child.name}`} className="bg-inner/40 hover:bg-inner transition-colors">
                            <td className="py-1.5 pl-10 pr-3">
                              <span className="font-mono text-[11px] text-text-muted">└</span>{' '}
                              <span className="font-mono text-[11px] text-text-base">{child.name}</span>
                              {!child.stitched && <span className="text-[9px] font-sans text-text-muted ml-2">(not stitched)</span>}
                              {!child.hasMetadata && <span className="text-[9px] font-sans text-text-muted ml-1">(no CSV)</span>}
                            </td>
                            <td className="py-1.5 px-3 font-mono text-[11px] text-text-muted">{child.date || '—'}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-[11px] text-text-base">{child.metadataRows}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-[11px] text-text-base">{child.images}</td>
                            <td className="py-1.5 px-3 text-[10px] font-sans text-text-muted truncate" title={child.stitchingPath}>
                              {child.csvName || '—'}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
