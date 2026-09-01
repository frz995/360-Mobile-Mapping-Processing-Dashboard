import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Cell
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { SurveyAnalytics } from '../../../utils/surveyAnalytics';
import type { TranslateFn } from '../common';
import { formatNumber, publishTone } from './analyticsCommon';

interface CoveragePanelProps {
  analytics: SurveyAnalytics;
  translate: TranslateFn;
}

const DARK_TOOLTIP = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { color: '#e2e8f0' }
};

export function CoveragePanel({ analytics, translate }: CoveragePanelProps) {
  const rows = [...analytics.perSubgrid].sort((a, b) => b.coveragePct - a.coveragePct);
  const chartData = rows.map((r) => ({ name: r.subgrid, pct: r.coveragePct }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-inner border border-subtle rounded-xl p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('analyticsColPublished')}</div>
          <div className="text-sm font-bold text-emerald-300">{formatNumber(analytics.totals.published)}</div>
        </div>
        <div className="bg-inner border border-subtle rounded-xl p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('analyticsColStaged')}</div>
          <div className="text-sm font-bold text-sky-300">{formatNumber(analytics.totals.staged)}</div>
        </div>
        <div className="bg-inner border border-subtle rounded-xl p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('analyticsColPartial')}</div>
          <div className="text-sm font-bold text-amber-300">{formatNumber(analytics.totals.partial)}</div>
        </div>
      </div>

      {rows.length > 0 && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} stroke="#334155" interval={0} angle={-32} height={56} />
            <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" />
            <Tooltip {...DARK_TOOLTIP} />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.pct >= 100 ? '#10b981' : d.pct >= 80 ? '#38bdf8' : '#f59e0b'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}

      <div className="overflow-auto max-h-[440px] border border-subtle rounded-xl">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2">{translate('analyticsColSubgrid')}</th>
              <th className="px-3 py-2 text-right">{translate('analyticsColPoi')}</th>
              <th className="px-3 py-2 text-right">{translate('analyticsColFrames')}</th>
              <th className="px-3 py-2 text-right">{translate('analyticsColCoverage')}</th>
              <th className="px-3 py-2 text-center">{translate('analyticsColState')}</th>
              <th className="px-3 py-2 text-center">{translate('analyticsColDelivery')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subgrid} className="border-b border-subtle hover:bg-inner/40 transition-colors">
                <td className="px-3 py-2 font-bold text-sky-300">{r.subgrid}</td>
                <td className="px-3 py-2 text-right font-sans">{formatNumber(r.poi)}</td>
                <td className="px-3 py-2 text-right font-sans">{formatNumber(r.frames)}</td>
                <td className="px-3 py-2 text-right font-sans">{formatNumber(r.coveragePct, 0)}%</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${publishTone(r.publishState)}`}>
                    {translate(`analyticsState_${r.publishState}`)}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">{r.pic || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Gaps */}
      {analytics.gaps.length > 0 && (
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-amber-300" /> {translate('analyticsGaps')} ({analytics.gaps.length})
          </h3>
          <div className="flex flex-col gap-1.5">
            {analytics.gaps.map((g) => (
              <div key={`${g.kind}-${g.subgrid}-${g.detail}`} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-inner border border-amber-500/30">
                <div>
                  <span className="text-[11px] font-bold text-amber-300">{g.subgrid}</span>
                  <span className="text-[10px] text-text-muted ml-2">
                    {g.kind === 'missing_frames'
                      ? `${g.missing} ${translate('analyticsGapMissing')}`
                      : g.kind === 'unpublished'
                        ? translate('analyticsGapUnpublished')
                        : translate('analyticsGapCapture')}
                  </span>
                </div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">
                  {translate(`analyticsGapKind_${g.kind}`)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}