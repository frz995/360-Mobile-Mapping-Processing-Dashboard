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
import { ShieldAlert } from 'lucide-react';
import type { SurveyAnalytics } from '../../../utils/surveyAnalytics';
import type { TranslateFn } from '../common';
import { formatNumber } from './analyticsCommon';

interface QualityPanelProps {
  analytics: SurveyAnalytics;
  translate: TranslateFn;
}

const DARK_TOOLTIP = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { color: '#e2e8f0' }
};

export function QualityPanel({ analytics, translate }: QualityPanelProps) {
  const t = analytics.totals;
  const rows = [...analytics.perSubgrid].sort((a, b) => b.defects - a.defects).filter((r) => r.defects > 0 || r.qaRejected > 0);
  const chartData = rows.slice(0, 12).map((r) => ({ name: r.subgrid, defects: r.defects, dkm: Math.round(r.defectsPerKm * 100) / 100 }));

  return (
    <div className="flex flex-col gap-4">
      {/* Quality Telemetry Strip */}
      <div className="bg-card border border-subtle rounded-xl px-4 py-2.5 shadow-sm text-xs flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] font-bold text-text-muted shrink-0 uppercase tracking-wider">
          Quality Telemetry:
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="text-text-muted">{translate('analyticsKpiDefects')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.defects)}</strong>
            <span className="text-text-muted text-[10px] ml-1">({formatNumber(100 - t.passRate, 1)}% rate)</span>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">{translate('analyticsKpiQuality')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.passRate, 1)}%</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">{translate('analyticsQaApproved')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.qaApproved)}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">{translate('analyticsQaRejected')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.qaRejected)}</strong>
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
          <div className="p-3 bg-inner rounded-2xl border border-subtle text-slate-500">
            <ShieldAlert size={26} strokeWidth={1.5} />
          </div>
          <p className="text-xs text-text-muted max-w-md leading-relaxed">{translate('analyticsQaClean')}</p>
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
              {translate('analyticsDefectsRanking')}
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} stroke="#334155" interval={0} angle={-32} height={56} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" />
                <Tooltip {...DARK_TOOLTIP} />
                <Bar dataKey="defects" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.defects > 0 ? '#f43f5e' : '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-auto max-h-[440px] border border-subtle rounded-xl">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
                  <th className="px-3 py-2">{translate('analyticsColSubgrid')}</th>
                  <th className="px-3 py-2 text-right">{translate('analyticsColDefects')}</th>
                  <th className="px-3 py-2 text-right">Defects/km</th>
                  <th className="px-3 py-2 text-right">{translate('analyticsColPass')}</th>
                  <th className="px-3 py-2 text-center">{translate('analyticsQaApproved')}</th>
                  <th className="px-3 py-2 text-center">{translate('analyticsQaRejected')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.subgrid} className="border-b border-subtle hover:bg-inner/40 transition-colors">
                    <td className="px-3 py-2 font-bold text-sky-300">{r.subgrid}</td>
                    <td className="px-3 py-2 text-right font-sans text-rose-300">{formatNumber(r.defects)}</td>
                    <td className="px-3 py-2 text-right font-sans">{formatNumber(r.defectsPerKm, 2)}</td>
                    <td className="px-3 py-2 text-right font-sans">{formatNumber(r.passRate, 0)}%</td>
                    <td className="px-3 py-2 text-center font-sans text-emerald-300">{formatNumber(r.qaApproved)}</td>
                    <td className="px-3 py-2 text-center font-sans text-rose-300">{formatNumber(r.qaRejected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}