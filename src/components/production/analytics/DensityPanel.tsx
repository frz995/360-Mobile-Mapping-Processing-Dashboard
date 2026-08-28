import { useState } from 'react';
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
import type { SurveyAnalytics } from '../../../utils/surveyAnalytics';
import type { TranslateFn } from '../common';
import { formatNumber } from './analyticsCommon';

interface DensityPanelProps {
  analytics: SurveyAnalytics;
  translate: TranslateFn;
}

const DARK_TOOLTIP = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { color: '#e2e8f0' }
};

export function DensityPanel({ analytics, translate }: DensityPanelProps) {
  const [metric, setMetric] = useState<'poi' | 'frames'>('poi');
  const rows = [...analytics.perSubgrid].sort((a, b) =>
    metric === 'poi' ? b.densityPoi - a.densityPoi : b.densityFrames - a.densityFrames
  );
  const chartData = rows.slice(0, 14).map((r) => ({
    name: r.subgrid,
    value: Math.round((metric === 'poi' ? r.densityPoi : r.densityFrames) * 10) / 10
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
          {translate('analyticsDensityTitle')}
        </h3>
        <div className="flex items-center gap-1 bg-inner border border-subtle rounded-lg p-0.5">
          <button
            onClick={() => setMetric('poi')}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${metric === 'poi' ? 'bg-sky-500/20 text-sky-300' : 'text-text-muted hover:text-text-base'}`}
          >
            POI/km
          </button>
          <button
            onClick={() => setMetric('frames')}
            className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${metric === 'frames' ? 'bg-sky-500/20 text-sky-300' : 'text-text-muted hover:text-text-base'}`}
          >
            {translate('analyticsColFrames')}/km
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-[11px] text-text-muted py-10 text-center">{translate('analyticsEmpty')}</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} stroke="#334155" interval={0} angle={-32} height={56} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" />
              <Tooltip {...DARK_TOOLTIP} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.value >= 100 ? '#38bdf8' : '#3b82f6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="overflow-x-auto border border-subtle rounded-xl">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
                  <th className="px-3 py-2">{translate('analyticsColSubgrid')}</th>
                  <th className="px-3 py-2 text-right">{translate('analyticsKpiDistance')}</th>
                  <th className="px-3 py-2 text-right">{translate('analyticsColPoi')}</th>
                  <th className="px-3 py-2 text-right">{translate('analyticsColFrames')}</th>
                  <th className="px-3 py-2 text-right">POI/km</th>
                  <th className="px-3 py-2 text-right">{translate('analyticsColFrames')}/km</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.subgrid} className="border-b border-subtle hover:bg-inner/40 transition-colors">
                    <td className="px-3 py-2 font-bold text-sky-300">{r.subgrid}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.km, 2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.poi)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.frames)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.densityPoi, 1)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.densityFrames, 1)}</td>
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