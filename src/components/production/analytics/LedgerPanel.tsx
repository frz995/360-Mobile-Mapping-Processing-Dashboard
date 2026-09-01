import React from 'react';
import {
  FileText,
  Download,
  History
} from 'lucide-react';
import type { SurveyAnalytics } from '../../../utils/surveyAnalytics';
import { openPrintableReport, buildExecutiveReportHtml } from '../../../utils/reportDocuments';

export interface LedgerPanelProps {
  analytics: SurveyAnalytics;
  batchLogs?: any[];
  dailyData?: any[];
  projectSettings?: any;
  translate: (k: string) => string;
}

export const LedgerPanel: React.FC<LedgerPanelProps> = ({
  analytics,
  batchLogs = [],
  dailyData = [],
  projectSettings = {},
  translate: _translate
}) => {
  // Dynamically compute exact ledger totals directly from dailyData or analytics
  const totalReportDistance = dailyData.length > 0
    ? dailyData.reduce((sum, r) => sum + (Number(r.kmProcessed) || 0), 0)
    : (analytics.totals.km || 0);

  const totalReportFrames = dailyData.length > 0
    ? dailyData.reduce(
        (sum, r) =>
          sum +
          Number(
            r.availableImagesCount ??
              r.panoramas?.length ??
              r.imagesProcessed ??
              r.poiCount ??
              r.images ??
              0
          ),
        0
      )
    : (analytics.totals.frames || 0);

  const totalReportDefects = dailyData.length > 0
    ? dailyData.reduce(
        (sum, r) =>
          sum +
          (Number(r.imagesDefected) ||
            Number(r.defectCount) ||
            Number(r.defects) ||
            0),
        0
      )
    : (analytics.totals.defects || 0);

  const activeSubgridsCount = dailyData.length > 0
    ? new Set(
        dailyData.map((r) => (r.subgrid || '').toUpperCase().trim()).filter(Boolean)
      ).size
    : (batchLogs.length || analytics.totals.subgrids || 1);

  const targetKm = Number(projectSettings?.targetKm) || analytics.totals.targetKm || 300.0;
  const overallProgressPercent = targetKm > 0 ? (totalReportDistance / targetKm) * 100 : 0;
  const compliantPercent =
    totalReportFrames > 0
      ? Math.max(0, Math.min(100, ((totalReportFrames - totalReportDefects) / totalReportFrames) * 100)).toFixed(1)
      : analytics.totals.passRate.toFixed(1);

  const completedBatchesCount = batchLogs.filter(
    (b) => b.status === 'Complete' || b.publishToWebGIS === 'yes'
  ).length;
  const ongoingBatchesCount =
    batchLogs.filter((b) => b.status === 'Ongoing' || b.status === 'In Progress').length ||
    Math.max(0, activeSubgridsCount - completedBatchesCount);
  const readyForWebGISCount =
    batchLogs.filter((b) => b.publishToWebGIS === 'yes' || b.isSyncedWithSupabase).length ||
    completedBatchesCount;

  const handleExportPdf = () => {
    const html = buildExecutiveReportHtml(analytics);
    openPrintableReport('GeoSphere 360 Executive Progress Report', html);
  };

  return (
    <div className="bg-card border border-subtle rounded-xl p-5 space-y-5 shadow-sm animate-in fade-in">
      {/* Header with Export Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
        <div>
          <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
            <FileText size={16} className="text-sky-400" />
            Project Survey Reports &amp; Executive Export
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Generate contract delivery audits, QC summary reports, and data ledgers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportPdf}
            className="px-3.5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
          >
            <Download size={13} /> Export PDF Report
          </button>
        </div>
      </div>

      {/* 1. OVERALL CONTRACT SURVEY PROGRESS BANNER */}
      <div className="p-4 rounded-xl border border-subtle bg-inner space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold tracking-wider text-text-muted uppercase">
              Overall Contract Survey Progress
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <h4 className="text-2xl font-bold text-text-base font-sans">
                {overallProgressPercent.toFixed(1)}%
              </h4>
              <span className="text-xs text-text-muted">
                ({totalReportDistance.toFixed(1)} km of {targetKm.toFixed(1)} km target)
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs font-sans">
            <div className="text-right">
              <span className="text-text-muted text-[10px] block font-sans">Processed Frames</span>
              <strong className="text-text-base">
                {totalReportFrames.toLocaleString()} frames{' '}
                <span className="text-[10px] font-normal text-text-muted font-sans">(incl. staging)</span>
              </strong>
            </div>
            <div className="text-right pl-4 border-l border-subtle">
              <span className="text-text-muted text-[10px] block font-sans">Remaining KM</span>
              <strong className="text-text-base">
                {Math.max(0, targetKm - totalReportDistance).toFixed(1)} km
              </strong>
            </div>
            <div className="text-right pl-4 border-l border-subtle">
              <span className="text-text-muted text-[10px] block font-sans">Active Subgrids</span>
              <strong className="text-text-base">
                {activeSubgridsCount} subgrids
              </strong>
            </div>
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="w-full h-2.5 bg-card rounded-full overflow-hidden border border-subtle">
          <div
            className="h-full bg-sky-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.max(1, Math.min(100, overallProgressPercent))}%` }}
          />
        </div>
      </div>

      {/* 2. EXECUTIVE KPI BREAKDOWN CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div className="p-4 rounded-xl border border-subtle bg-inner space-y-2">
          <h4 className="font-bold text-text-base flex items-center justify-between">
            <span>Survey Coverage Breakdown</span>
            <span className="text-[10px] font-sans text-text-muted">Live PostGIS</span>
          </h4>
          <div className="space-y-1.5 text-text-muted">
            <div className="flex justify-between">
              <span>Total Distance:</span>{' '}
              <strong className="text-text-base font-sans">{totalReportDistance.toFixed(1)} km</strong>
            </div>
            <div className="flex justify-between">
              <span>Processed Frames:</span>{' '}
              <strong className="text-text-base font-sans">
                {totalReportFrames.toLocaleString()} frames
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Target Distance:</span>{' '}
              <strong className="text-text-base font-sans">{targetKm.toFixed(1)} km</strong>
            </div>
            <div className="flex justify-between pt-1 border-t border-subtle">
              <span>Remaining to Survey:</span>{' '}
              <strong className="text-sky-400 font-sans">
                {Math.max(0, targetKm - totalReportDistance).toFixed(1)} km
              </strong>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-subtle bg-inner space-y-2">
          <h4 className="font-bold text-text-base flex items-center justify-between">
            <span>Acquisition QC Quality SLA Metrics</span>
            <span className="text-[10px] font-sans text-emerald-400">Verified</span>
          </h4>
          <div className="space-y-1.5 text-text-muted">
            <div className="flex justify-between">
              <span>Defect Frames:</span>{' '}
              <strong className="text-text-base font-sans">{totalReportDefects}</strong>
            </div>
            <div className="flex justify-between">
              <span>Allowed Threshold:</span>{' '}
              <strong className="text-text-base font-sans">
                {projectSettings?.maxDefectThresholdPercent || 5.0}%
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Defect Rate:</span>{' '}
              <strong className="text-text-base font-sans">
                {totalReportFrames > 0
                  ? ((totalReportDefects / totalReportFrames) * 100).toFixed(2)
                  : '0.00'}
                %
              </strong>
            </div>
            <div className="flex justify-between pt-1 border-t border-subtle">
              <span>Pipeline Quality:</span>{' '}
              <strong className="text-emerald-400 font-sans">{compliantPercent}% Compliant</strong>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-subtle bg-inner space-y-2">
          <h4 className="font-bold text-text-base flex items-center justify-between">
            <span>Subgrid Masterlist Summary</span>
            <span className="text-[10px] font-sans text-text-muted">
              {activeSubgridsCount} Total
            </span>
          </h4>
          <div className="space-y-1.5 text-text-muted">
            <div className="flex justify-between">
              <span>Total Subgrids:</span>{' '}
              <strong className="text-text-base font-sans">
                {activeSubgridsCount}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Completed Batches:</span>{' '}
              <strong className="text-emerald-400 font-sans">
                {completedBatchesCount}
              </strong>
            </div>
            <div className="flex justify-between">
              <span>Ongoing Batches:</span>{' '}
              <strong className="text-amber-300 font-sans">
                {ongoingBatchesCount}
              </strong>
            </div>
            <div className="flex justify-between pt-1 border-t border-subtle">
              <span>Ready for WebGIS:</span>{' '}
              <strong className="text-sky-400 font-sans">
                {readyForWebGISCount}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* 3. DAILY PROGRESS DATA & SURVEY OPERATION LEDGER */}
      <div className="space-y-2.5 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
            <History size={14} className="text-sky-400" />
            Daily Operation &amp; Survey Progress Ledger
          </h4>
          <span className="text-[11px] text-text-muted font-sans">
            {dailyData.length} daily logs recorded
          </span>
        </div>

        <div className="border border-subtle rounded-xl overflow-auto max-h-[480px] shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wider font-semibold border-b bg-card text-text-muted border-subtle sticky top-0 z-10">
              <tr>
                <th className="px-3.5 py-2.5">Date</th>
                <th className="px-3.5 py-2.5">Subgrid / Area</th>
                <th className="px-3.5 py-2.5">Distance</th>
                <th className="px-3.5 py-2.5">Processed Frames</th>
                <th className="px-3.5 py-2.5">QC Defects</th>
                <th className="px-3.5 py-2.5">PIC / Equipment</th>
                <th className="px-3.5 py-2.5 text-right">WebGIS Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle/60">
              {dailyData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                    No daily operation records available.
                  </td>
                </tr>
              ) : (
                dailyData.map((row, idx) => {
                  const frameCount =
                    row.availableImagesCount ??
                    row.panoramas?.length ??
                    row.imagesProcessed ??
                    row.poiCount ??
                    row.images ??
                    0;
                  const km = Number(row.kmProcessed) || 0;
                  const defects = Number(row.imagesDefected) || Number(row.defectCount) || 0;
                  const isPublished =
                    row.publishToWebGIS === 'yes' || row.isSyncedWithSupabase === true;

                  return (
                    <tr
                      key={row.id || `${row.date}-${row.subgrid}-${idx}`}
                      className="hover:bg-inner transition-colors text-text-base"
                    >
                      <td className="px-3.5 py-2.5 font-sans text-[11px] font-semibold">
                        {row.date || '—'}
                      </td>
                      <td className="px-3.5 py-2.5 font-medium">{row.subgrid || '—'}</td>
                      <td className="px-3.5 py-2.5 font-sans">{km.toFixed(1)} km</td>
                      <td className="px-3.5 py-2.5 font-sans font-semibold text-text-base">
                        {Number(frameCount).toLocaleString()} frames
                      </td>
                      <td className="px-3.5 py-2.5 font-sans">
                        {defects > 0 ? (
                          <span className="text-amber-400 font-semibold">{defects}</span>
                        ) : (
                          <span className="text-emerald-400">0</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-text-muted">
                        {row.pic || 'Field Operator'}{' '}
                        <span className="text-text-muted">
                          ({row.captureEquipment || 'MMS'})
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        {isPublished ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans">
                            Published
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-inner text-text-muted border border-subtle font-sans">
                            Staging
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {dailyData.length > 0 && (
              <tfoot className="font-semibold border-t bg-card text-text-base border-subtle">
                <tr>
                  <td colSpan={2} className="px-3.5 py-2.5 text-text-muted text-[11px]">
                    Total ({dailyData.length} daily logs)
                  </td>
                  <td className="px-3.5 py-2.5 font-sans text-sky-400">
                    {totalReportDistance.toFixed(1)} km
                  </td>
                  <td className="px-3.5 py-2.5 font-sans text-text-base">
                    {totalReportFrames.toLocaleString()} frames{' '}
                    <span className="text-[10px] font-normal text-text-muted font-sans">
                      (incl. staging)
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 font-sans text-text-base">{totalReportDefects}</td>
                  <td colSpan={2} className="px-3.5 py-2.5 text-right text-[11px] text-emerald-400 font-sans">
                    {compliantPercent}% Quality
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};
