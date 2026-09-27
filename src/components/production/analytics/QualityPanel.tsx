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
  contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: 'var(--text-primary)' },
  itemStyle: { color: 'var(--text-primary)' }
};

export function QualityPanel({ analytics, translate }: QualityPanelProps) {
  const t = analytics.totals;
  const rows = [...analytics.perSubgrid].sort((a, b) => b.defects - a.defects).filter((r) => r.defects > 0 || r.qaRejected > 0);
  const chartData = rows.slice(0, 12).map((r) => ({ name: r.subgrid, defects: r.defects, dkm: Math.round(r.defectsPerKm * 100) / 100 }));

  return (
    <div className="flex flex-col gap-4">
      {/* QA summary — boxed telemetry strip removed; keep only the unique values */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] px-1">
        <span className="text-text-muted">
          {translate('analyticsQaApproved')}:{' '}
          <strong className="font-mono font-semibold" style={{ color: 'var(--palette-sage)' }}>{formatNumber(t.qaApproved)}</strong>
        </span>
        <span className="text-text-muted">&bull;</span>
        <span className="text-text-muted">
          {translate('analyticsQaRejected')}:{' '}
          <strong className="font-mono font-semibold" style={{ color: 'var(--palette-coral)' }}>{formatNumber(t.qaRejected)}</strong>
        </span>
        <span className="text-text-muted">&bull;</span>
        <span className="text-text-muted">
          {formatNumber(t.defects)} {translate('analyticsKpiDefects').toLowerCase()} · {formatNumber(t.passRate, 1)}% {translate('analyticsKpiQuality').toLowerCase()}
        </span>
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
                <CartesianGrid stroke="var(--divider)" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} stroke="var(--border-subtle)" interval={0} angle={-32} height={56} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} stroke="var(--border-subtle)" />
                <Tooltip {...DARK_TOOLTIP} />
                <Bar dataKey="defects" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.defects > 0 ? 'var(--palette-coral)' : 'var(--palette-slateblue)'} />
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
                    <td className="px-3 py-2 font-bold" style={{ color: 'var(--palette-slateblue)' }}>{r.subgrid}</td>
                    <td className="px-3 py-2 text-right font-sans" style={{ color: 'var(--palette-coral)' }}>{formatNumber(r.defects)}</td>
                    <td className="px-3 py-2 text-right font-sans">{formatNumber(r.defectsPerKm, 2)}</td>
                    <td className="px-3 py-2 text-right font-sans">{formatNumber(r.passRate, 0)}%</td>
                    <td className="px-3 py-2 text-center font-sans" style={{ color: 'var(--palette-sage)' }}>{formatNumber(r.qaApproved)}</td>
                    <td className="px-3 py-2 text-center font-sans" style={{ color: 'var(--palette-coral)' }}>{formatNumber(r.qaRejected)}</td>
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
