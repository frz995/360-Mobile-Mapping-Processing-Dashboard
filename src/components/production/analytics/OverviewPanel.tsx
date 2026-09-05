import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import type { SurveyAnalytics } from '../../../utils/surveyAnalytics';
import type { TranslateFn } from '../common';
import { formatNumber } from './analyticsCommon';

interface OverviewPanelProps {
  analytics: SurveyAnalytics;
  translate: TranslateFn;
}

const PIE_COLORS: Record<string, string> = {
  published: '#10b981',
  staged: '#38bdf8',
  partial: '#f59e0b',
  none: '#64748b'
};

const DARK_TOOLTIP = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { color: '#e2e8f0' }
};

export function OverviewPanel({ analytics, translate }: OverviewPanelProps) {
  const t = analytics.totals;
  const pieData = [
    { name: translate('analyticsStatePublished'), value: t.published, state: 'published' },
    { name: translate('analyticsStateStaged'), value: t.staged, state: 'staged' },
    { name: translate('analyticsStatePartial'), value: t.partial, state: 'partial' },
    { name: translate('analyticsStateNone'), value: Math.max(0, t.subgrids - t.published - t.staged - t.partial), state: 'none' }
  ].filter((p) => p.value > 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Executive Progress Telemetry Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-inner border border-subtle">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">
            Contract Road Coverage
          </div>
          <div className="text-base font-bold text-text-base font-mono mt-1">
            {formatNumber(t.km, 2)} km
          </div>
          <div className="text-[10px] text-text-muted font-mono mt-0.5">
            {t.effectiveTargetKm > 0
              ? `of ${formatNumber(t.effectiveTargetKm, 2)} km (${formatNumber(t.targetProgressKmPct, 1)}%)`
              : 'Active capture'}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-inner border border-subtle">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">
            Subgrids Surveyed
          </div>
          <div className="text-base font-bold text-text-base font-mono mt-1">
            {formatNumber(t.subgrids)}
          </div>
          <div className="text-[10px] text-text-muted font-mono mt-0.5">
            {t.totalProjectSubgrids > t.subgrids
              ? `of ${formatNumber(t.totalProjectSubgrids)} total project cells`
              : 'Active 5×5 km cells'}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-inner border border-subtle">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">
            Quality Pass Rate
          </div>
          <div className="text-base font-bold text-text-base font-mono mt-1">
            {formatNumber(t.passRate, 1)}%
          </div>
          <div className="text-[10px] text-text-muted font-mono mt-0.5">
            {t.defects === 0 ? '0 defects detected' : `${formatNumber(t.defects)} defect(s)`}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-inner border border-subtle">
          <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">
            Publish Pipeline
          </div>
          <div className="text-base font-bold text-text-base font-mono mt-1">
            {t.published > 0 ? `${formatNumber(t.published)} Published` : `${formatNumber(t.staged)} Staged`}
          </div>
          <div className="text-[10px] text-text-muted font-mono mt-0.5">
            {t.partial > 0 ? `${formatNumber(t.partial)} partial subgrid(s)` : 'Live / Verified'}
          </div>
        </div>
      </div>

      {/* KPI Telemetry Strip */}
      <div className="bg-card border border-subtle rounded-xl px-4 py-2.5 shadow-sm text-xs flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] font-bold text-text-muted shrink-0 uppercase tracking-wider">
          Operations Overview:
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
          <span>
            <span className="text-text-muted font-sans">{translate('analyticsKpiSubgrids')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.subgrids)}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted font-sans">{translate('analyticsStatePublished')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.published)}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted font-sans">{translate('analyticsStateStaged')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.staged)}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted font-sans">{translate('analyticsKpiDistance')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.km, 2)} km</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted font-sans">{translate('analyticsKpiPoi')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.poi)}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted font-sans">{translate('analyticsKpiDefects')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.defects)}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted font-sans">{translate('analyticsKpiQuality')}: </span>
            <strong className="font-semibold text-text-base">{formatNumber(t.passRate, 1)}%</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Target progress */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            {translate('analyticsTargetProgress')}
          </h3>
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-text-muted">{translate('analyticsKpiDistance')}</span>
              <span className="font-bold font-mono">
                {t.effectiveTargetKm > 0
                  ? `${formatNumber(t.km, 2)} km / ${formatNumber(t.effectiveTargetKm, 2)} km (${formatNumber(t.targetProgressKmPct, 1)}%)`
                  : `${formatNumber(t.km, 2)} km`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-inner border border-subtle overflow-hidden">
              <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${Math.min(100, t.targetProgressKmPct)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-text-muted">{translate('analyticsKpiFrames')}</span>
              <span className="font-bold font-mono">
                {t.targetImages > 0
                  ? `${formatNumber(t.frames)} / ${formatNumber(t.targetImages)} (${formatNumber(t.targetProgressImagesPct, 1)}%)`
                  : `${formatNumber(t.frames)} frames`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-inner border border-subtle overflow-hidden">
              <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, t.targetProgressImagesPct)}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div className="text-[11px] text-text-muted">
              {translate('analyticsQaApproved')}: <span className="font-bold text-emerald-300 font-mono">{formatNumber(t.qaApproved)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              {translate('analyticsQaRejected')}: <span className="font-bold text-rose-300 font-mono">{formatNumber(t.qaRejected)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              RAW Ingested: <span className="font-bold text-amber-300 font-mono">{formatNumber(t.captureFrames)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              Masterlist Reconciled: <span className="font-bold text-sky-300 font-mono">{formatNumber(t.masterlistFrames)}</span>
            </div>
          </div>
        </div>

        {/* Publish distribution */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
            Subgrid Publishing Distribution ({formatNumber(t.subgrids)} Subgrids)
          </h3>
          {pieData.length === 0 ? (
            <p className="text-[11px] text-text-muted py-8 text-center">{translate('analyticsEmpty')}</p>
          ) : (
            <div className="flex-1 min-h-[200px]">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                    {pieData.map((p) => (
                      <Cell key={p.state} fill={PIE_COLORS[p.state] || '#64748b'} stroke="#0b1020" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip {...DARK_TOOLTIP} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 justify-center text-[10px] text-text-muted">
                {pieData.map((p) => (
                  <span key={p.state} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: PIE_COLORS[p.state] }} />
                    {p.name}: <span className="font-mono font-semibold text-text-base">{p.value}</span> {p.value === 1 ? 'Subgrid' : 'Subgrids'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Daily trend */}
      <div className="bg-card border border-subtle rounded-xl p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
          {translate('analyticsDailyTrend')} (km)
        </h3>
        {analytics.dailySeries.length === 0 ? (
          <p className="text-[11px] text-text-muted py-8 text-center">{translate('analyticsEmpty')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={analytics.dailySeries} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} stroke="#334155" />
              <Tooltip {...DARK_TOOLTIP} />
              <Line type="monotone" dataKey="km" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2, fill: '#38bdf8' }} name="km" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}