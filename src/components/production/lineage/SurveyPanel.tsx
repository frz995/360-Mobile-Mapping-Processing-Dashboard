import { Radar } from 'lucide-react';
import type { DatasetRecord } from '../../../types/production';
import type { StagingAggregate } from '../../../utils/datasetLineage';
import { formatDateTime } from '../common';
import type { TranslateFn } from '../common';

interface SurveyPanelProps {
  aggregates: StagingAggregate[];
  datasets: DatasetRecord[];
  onTraceSubgrid: (subgrid: string) => void;
  translate: TranslateFn;
}

export function SurveyPanel({
  aggregates,
  datasets,
  onTraceSubgrid,
  translate
}: SurveyPanelProps) {
  if (aggregates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="p-3 bg-inner rounded-2xl border border-subtle text-slate-500">
          <Radar size={26} strokeWidth={1.5} />
        </div>
        <p className="text-xs text-text-muted max-w-md leading-relaxed">
          {translate('lineageSurveyEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Summary chips */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="px-2.5 py-1 rounded-lg bg-inner border border-subtle text-text-muted">
          {aggregates.length} subgrids
        </span>
        <span className="px-2.5 py-1 rounded-lg bg-inner border border-subtle text-text-muted">
          {aggregates.reduce((a, g) => a + g.frames, 0)} RAW frames
        </span>
      </div>

      <div className="overflow-x-auto border border-subtle rounded-xl">
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2">Subgrid</th>
              <th className="px-3 py-2">RAW frames</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Capture window</th>
              <th className="px-3 py-2">Deliverable</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {aggregates.map((a) => {
              const deliverable = datasets.find(
                (d) =>
                  d.dataset_type === 'DELIVERABLE' &&
                  (d.subgrid || '').toUpperCase() === a.subgrid
              );
              const statuses = Object.entries(a.statuses || {})
                .map(([k, v]) => `${k}:${v}`)
                .join(' · ');
              return (
                <tr key={a.subgrid} className="border-b border-subtle hover:bg-inner/40 transition-colors">
                  <td className="px-3 py-2 font-bold text-amber-300">{a.subgrid}</td>
                  <td className="px-3 py-2">{a.frames}</td>
                  <td className="px-3 py-2 text-text-muted">{statuses || 'staged'}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {a.captureStart
                      ? `${formatDateTime(a.captureStart)} → ${formatDateTime(a.captureEnd)}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {deliverable ? (
                      <span className="text-emerald-300 font-semibold">
                        {deliverable.name || deliverable.id}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => onTraceSubgrid(a.subgrid)}
                      className="px-2.5 py-1 rounded-md bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-sky-500/30"
                    >
                      {translate('lineageGraphTitle')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}