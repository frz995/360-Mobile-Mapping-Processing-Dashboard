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

  const kpis = [
    { label: translate('analyticsKpiSubgrids'), value: formatNumber(t.subgrids), sub: `${t.published} ${translate('analyticsStatePublished')} · ${t.staged} ${translate('analyticsStateStaged')}` },
    { label: translate('analyticsKpiDistance'), value: `${formatNumber(t.km, 2)} km`, sub: `${formatNumber(t.targetProgressKmPct, 1)}% of ${formatNumber(t.targetKm, 1)} km` },
    { label: translate('analyticsKpiFrames'), value: formatNumber(t.frames), sub: translate('analyticsKpiFramesSub') },
    { label: translate('analyticsKpiPoi'), value: formatNumber(t.poi), sub: `${formatNumber(analytics.dailySeries.length)} ${translate('analyticsDays')}` },
    { label: translate('analyticsKpiDefects'), value: formatNumber(t.defects), sub: `${formatNumber(100 - t.passRate, 1)}% ${translate('analyticsDefectRate')}` },
    { label: translate('analyticsKpiQuality'), value: `${formatNumber(t.passRate, 1)}%`, sub: translate('analyticsKpiQualitySub') }
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {kpis.map((k) => (
          <div key={k.label} className="bg-inner border border-subtle rounded-xl p-3">
            <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{k.label}</div>
            <div className="text-sm font-bold text-text-base mt-1">{k.value}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{k.sub}</div>
          </div>
        ))}
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
              <span className="font-bold">{formatNumber(t.targetProgressKmPct, 1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-inner border border-subtle overflow-hidden">
              <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${Math.min(100, t.targetProgressKmPct)}%` }} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-text-muted">{translate('analyticsKpiFrames')}</span>
              <span className="font-bold">{formatNumber(t.targetProgressImagesPct, 1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-inner border border-subtle overflow-hidden">
              <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, t.targetProgressImagesPct)}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div className="text-[11px] text-text-muted">
              {translate('analyticsQaApproved')}: <span className="font-bold text-emerald-300">{formatNumber(t.qaApproved)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              {translate('analyticsQaRejected')}: <span className="font-bold text-rose-300">{formatNumber(t.qaRejected)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              RAW frames: <span className="font-bold text-amber-300">{formatNumber(t.captureFrames)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              {translate('analyticsKpiFramesSub')}: <span className="font-bold">{formatNumber(t.frames - t.captureFrames)}</span>
            </div>
          </div>
        </div>

        {/* Publish distribution */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
            {translate('analyticsPublishDistribution')}
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
                    {p.name}: {p.value}
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