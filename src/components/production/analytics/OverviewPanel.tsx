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
  published: 'var(--palette-sage)',
  staged: 'var(--palette-mint)',
  partial: 'var(--palette-butter)',
  none: 'var(--palette-slateblue)'
};

const DARK_TOOLTIP = {
  contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: 'var(--text-primary)' },
  itemStyle: { color: 'var(--text-primary)' }
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
            {t.partial > 0 ? `${formatNumber(t.partial)} partial subgrid(s)` : 'Current / Verified'}
          </div>
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
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, t.targetProgressKmPct)}%`, backgroundColor: 'var(--palette-slateblue)' }} />
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
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, t.targetProgressImagesPct)}%`, backgroundColor: 'var(--palette-mint)' }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div className="text-[11px] text-text-muted">
              {translate('analyticsQaApproved')}: <span className="font-bold font-mono" style={{ color: 'var(--palette-sage)' }}>{formatNumber(t.qaApproved)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              {translate('analyticsQaRejected')}: <span className="font-bold font-mono" style={{ color: 'var(--palette-coral)' }}>{formatNumber(t.qaRejected)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              RAW Ingested: <span className="font-bold font-mono" style={{ color: 'var(--palette-butter)' }}>{formatNumber(t.captureFrames)}</span>
            </div>
            <div className="text-[11px] text-text-muted">
              Masterlist Reconciled: <span className="font-bold font-mono" style={{ color: 'var(--palette-slateblue)' }}>{formatNumber(t.masterlistFrames)}</span>
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
                      <Cell key={p.state} fill={PIE_COLORS[p.state] || 'var(--text-muted)'} stroke="var(--bg-app)" strokeWidth={2} />
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
              <CartesianGrid stroke="var(--divider)" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} stroke="var(--border-subtle)" />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} stroke="var(--border-subtle)" />
              <Tooltip {...DARK_TOOLTIP} />
              <Line type="monotone" dataKey="km" stroke="var(--palette-teal)" strokeWidth={2} dot={{ r: 2, fill: 'var(--palette-teal)' }} name="km" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
