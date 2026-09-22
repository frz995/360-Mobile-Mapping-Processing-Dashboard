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
import { AlertTriangle, Download } from 'lucide-react';
import type { SurveyAnalytics } from '../../../utils/surveyAnalytics';
import type { TranslateFn } from '../common';
import { downloadCsv, formatNumber, publishTone } from './analyticsCommon';

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
  const rows = [...analytics.perSubgrid].sort((a, b) => (b.actualCoveragePct ?? 0) - (a.actualCoveragePct ?? 0));
  // Subgrids without a per-subgrid plan attribution have no coverage % — exclude from the chart.
  const chartableRows = rows.filter((r) => typeof r.actualCoveragePct === 'number');
  // Cap chart display to top 24 subgrids to avoid heavy SVG overdraw and illegible text bars when projects have 100+ subgrids
  const isTruncated = chartableRows.length > 24;
  const chartRows = isTruncated ? chartableRows.slice(0, 24) : chartableRows;
  const chartData = chartRows.map((r) => ({
    name: r.subgrid,
    pct: r.actualCoveragePct as number,
    hasPlan: r.hasPlanSource
  }));
  const xAxisInterval = chartRows.length > 16 ? 'preserveStartEnd' : 0;

  const handleExport = () => {
    downloadCsv('analytics-distance-coverage.csv', [
      ['Grid', 'Subgrid', 'Current capture (km)', 'Road plan (km)', 'Remaining to capture (km)', 'Actual Coverage (%)', 'POI', 'Runs', 'Status', 'PIC'],
      ...rows.map((r) => [
        r.grid || '1',
        r.subgrid,
        Math.round(r.km * 100) / 100,
        r.hasPlanSource && typeof r.planKm === 'number' ? Math.round(r.planKm * 100) / 100 : (analytics.totals.hasRoadPlanSource ? '—' : 'No existing road plan source'),
        r.hasPlanSource && typeof r.remainingKm === 'number' ? Math.round(r.remainingKm * 100) / 100 : '—',
        r.hasPlanSource && typeof r.actualCoveragePct === 'number' ? `${r.actualCoveragePct}%` : '—',
        r.poi,
        r.runsCount,
        translate(`analyticsState_${r.publishState}`),
        r.pic || '—'
      ])
    ]);
  };

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
      {/* Actual Coverage Campaign Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-inner border border-subtle rounded-xl p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Total Road Plan</div>
          <div className="text-sm font-bold text-sky-300 font-sans">
            {analytics.totals.hasRoadPlanSource ? (
              `${formatNumber(analytics.totals.totalPlanKm, 2)} km`
            ) : (
              <span className="text-[11px] text-amber-300/80 font-normal italic">No plan source</span>
            )}
          </div>
        </div>
        <div className="bg-inner border border-subtle rounded-xl p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Current Capture</div>
          <div className="text-sm font-bold text-text-base font-sans">
            {formatNumber(analytics.totals.km, 2)} km
          </div>
        </div>
        <div className="bg-inner border border-subtle rounded-xl p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Remaining to Capture</div>
          <div className="text-sm font-bold font-sans">
            {analytics.totals.hasRoadPlanSource ? (
              <span className={analytics.totals.totalRemainingKm > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                {formatNumber(analytics.totals.totalRemainingKm, 2)} km
              </span>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </div>
        </div>
        <div className="bg-inner border border-subtle rounded-xl p-3">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">Actual Coverage</div>
          <div className="text-sm font-bold font-sans">
            {analytics.totals.hasRoadPlanSource && analytics.totals.actualCoveragePct !== null ? (
              <span className={analytics.totals.actualCoveragePct >= 100 ? 'text-emerald-300' : analytics.totals.actualCoveragePct >= 80 ? 'text-sky-300' : 'text-amber-300'}>
                {analytics.totals.actualCoveragePct}%
              </span>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </div>
        </div>
      </div>

      {!analytics.totals.hasRoadPlanSource ? (
        <div className="px-4 py-3 bg-inner/60 border border-amber-500/30 rounded-xl text-center">
          <p className="text-[11px] text-amber-300 font-medium">
            No existing road plan source detected.
          </p>
          <p className="text-[10px] text-text-muted mt-0.5">
            Upload a road GeoJSON or extract road network in the Road Analysis workspace to measure actual survey coverage % against your road plan.
          </p>
        </div>
      ) : (
        rows.length > 0 && (
          <div className="space-y-1">
            {isTruncated && (
              <div className="text-[10px] text-text-muted flex items-center justify-between px-1">
                <span>Showing top 24 subgrids by actual coverage (current vs road plan)</span>
                <span>Full dataset ({rows.length} subgrids) in table below</span>
              </div>
            )}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} stroke="#334155" interval={xAxisInterval} angle={-32} height={56} />
                <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" unit="%" />
                <Tooltip {...DARK_TOOLTIP} formatter={(value: any) => [`${value}%`, 'Actual Coverage']} />
                <Bar dataKey="pct" name="Actual Coverage" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.pct >= 100 ? '#10b981' : d.pct >= 80 ? '#38bdf8' : '#f59e0b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      )}

      <div className="overflow-auto max-h-[440px] border border-subtle rounded-xl">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2">Grid</th>
              <th className="px-3 py-2">Subgrid</th>
              <th className="px-3 py-2 text-right">Current capture</th>
              <th className="px-3 py-2 text-right">Road plan (in km)</th>
              <th className="px-3 py-2 text-right">Remaining to capture</th>
              <th className="px-3 py-2 text-right">Actual Coverage (%)</th>
              <th className="px-3 py-2 text-right">{translate('analyticsColPoi')}</th>
              <th className="px-3 py-2 text-right">{translate('analyticsColRuns')}</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-center">PIC</th>
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
                  ) : analytics.totals.hasRoadPlanSource ? (
                    <span className="text-text-muted">—</span>
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