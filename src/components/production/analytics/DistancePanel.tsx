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
import { Download } from 'lucide-react';
import type { SurveyAnalytics } from '../../../utils/surveyAnalytics';
import type { TranslateFn } from '../common';
import { downloadCsv, formatNumber } from './analyticsCommon';

interface DistancePanelProps {
  analytics: SurveyAnalytics;
  translate: TranslateFn;
}

const DARK_TOOLTIP = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { color: '#e2e8f0' }
};

export function DistancePanel({ analytics, translate }: DistancePanelProps) {
  const rows = [...analytics.perSubgrid].sort((a, b) => b.km - a.km);
  const chartData = rows.slice(0, 14).map((r) => ({
    name: r.subgrid,
    km: Math.round(r.km * 100) / 100,
    dp: formatNumber(r.densityPoi, 1)
  }));

  const handleExport = () => {
    downloadCsv('analytics-distance.csv', [
      ['Grid', 'Subgrid', 'Current capture (km)', 'Road plan (km)', 'Remaining to capture (km)', 'Actual Coverage (%)', 'POI', 'Runs'],
      ...rows.map((r) => [
        r.grid || '1',
        r.subgrid,
        Math.round(r.km * 100) / 100,
        r.hasPlanSource && typeof r.planKm === 'number' ? Math.round(r.planKm * 100) / 100 : 'No existing road plan source',
        r.hasPlanSource && typeof r.remainingKm === 'number' ? Math.round(r.remainingKm * 100) / 100 : '—',
        r.hasPlanSource && typeof r.actualCoveragePct === 'number' ? `${r.actualCoveragePct}%` : '—',
        r.poi,
        r.runsCount
      ])
    ]);
  };

  if (rows.length === 0) {
    return <p className="text-[11px] text-text-muted py-10 text-center">{translate('analyticsEmpty')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
          {translate('analyticsDistanceBySubgrid')}
        </h3>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-inner border border-subtle text-sky-300 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:border-sky-500/40"
        >
          <Download size={12} /> CSV
        </button>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} stroke="#334155" interval={0} angle={-32} height={56} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" />
          <Tooltip {...DARK_TOOLTIP} />
          <Bar dataKey="km" name="Current capture (km)" radius={[4, 4, 0, 0]}>
            {chartData.map((_d, i) => (
              <Cell key={i} fill={i === 0 ? '#38bdf8' : '#1d4ed8'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-auto max-h-[440px] border border-subtle rounded-xl">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2">Grid</th>
              <th className="px-3 py-2">Subgrid</th>
              <th className="px-3 py-2 text-right">Current capture</th>
              <th className="px-3 py-2 text-right">Road plan (in km)</th>
              <th className="px-3 py-2 text-right">Remaining to capture</th>
              <th className="px-3 py-2 text-right">Actual Coverage</th>
              <th className="px-3 py-2 text-right">POI</th>
              <th className="px-3 py-2 text-right">{translate('analyticsColRuns')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subgrid} className="border-b border-subtle hover:bg-inner/40 transition-colors">
                <td className="px-3 py-2 font-mono text-text-muted">{r.grid || '1'}</td>
                <td className="px-3 py-2 font-bold text-sky-300">{r.subgrid}</td>
                <td className="px-3 py-2 text-right font-sans font-medium text-text-base">
                  {formatNumber(r.km, 2)} km
                </td>
                <td className="px-3 py-2 text-right font-sans">
                  {r.hasPlanSource && r.planKm !== null && r.planKm !== undefined ? (
                    <span className="text-text-base">{formatNumber(r.planKm, 2)} km</span>
                  ) : (
                    <span className="text-[10px] text-amber-300/80 italic">No existing road plan source</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-sans">
                  {r.hasPlanSource && r.remainingKm !== null && r.remainingKm !== undefined ? (
                    <span className={r.remainingKm > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                      {formatNumber(r.remainingKm, 2)} km
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-sans">
                  {r.hasPlanSource && typeof r.actualCoveragePct === 'number' ? (
                    <span className={`font-bold ${r.actualCoveragePct >= 100 ? 'text-emerald-300' : r.actualCoveragePct >= 80 ? 'text-sky-300' : 'text-amber-300'}`}>
                      {r.actualCoveragePct}%
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-sans">{formatNumber(r.poi)}</td>
                <td className="px-3 py-2 text-right">{r.runsCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}