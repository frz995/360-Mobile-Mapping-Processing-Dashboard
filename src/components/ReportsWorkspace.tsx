import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Layers,
  ShieldCheck,
  GitBranch,
  FileText,
  Printer
} from 'lucide-react';
import { fetchDatasetsFromSupabase, fetchProcessingJobsFromSupabase, fetchStagingPanoramasFromSupabase, SUBGRID_COORDINATES } from '../services/supabase';
import { aggregateStagingBySubgrid } from '../utils/datasetLineage';
import { buildBoundarySubgridSet } from '../utils/projectBoundary';
import { computeSurveyAnalytics } from '../utils/surveyAnalytics';
import {
  openPrintableReport,
  buildExecutiveReportHtml,
  buildDailyReportHtml,
  buildSubgridReportHtml,
  buildQaReportHtml,
  buildLineageReportHtml
} from '../utils/reportDocuments';
import type { ProcessingJobRecord, DatasetRecord } from '../types/production';
import { REPORTS_TAB_LABELS } from './production/reports/reportsCommon';
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';

export interface ReportsWorkspaceProps {
  projectSettings: any;
  setProjectSettings: React.Dispatch<React.SetStateAction<any>>;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  translate?: (key: string) => string;
  batchLogs: any[];
  dailyData: any[];
  onRefreshData?: () => void;
}

type ReportsTab = 'executive' | 'daily' | 'subgrid' | 'qa' | 'lineage';

const TABS: ChromeTab<ReportsTab>[] = [
  { key: 'executive', icon: <FileText size={14} /> },
  { key: 'daily', icon: <CalendarClock size={14} /> },
  { key: 'subgrid', icon: <Layers size={14} /> },
  { key: 'qa', icon: <ShieldCheck size={14} /> },
  { key: 'lineage', icon: <GitBranch size={14} /> }
];

export const ReportsWorkspace: React.FC<ReportsWorkspaceProps> = ({
  projectSettings,
  isGuestUser,
  onBackToDashboard: _onBackToDashboard,
  translate = (k) => k,
  batchLogs = [],
  dailyData = [],
  onRefreshData: _onRefreshData
}) => {
  const [activeTab, setActiveTab] = useState<ReportsTab>('executive');
  const [stagingRows, setStagingRows] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);

  const refreshAll = useCallback(() => {
    Promise.all([
      fetchStagingPanoramasFromSupabase().then(setStagingRows),
      fetchDatasetsFromSupabase().then(setDatasets),
      fetchProcessingJobsFromSupabase().then(setJobs)
    ]).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const boundarySubgrids = useMemo(() => {
    const boundary = (projectSettings as any)?.projectBoundary;
    if (!boundary?.geojson && !boundary?.bbox) return undefined;
    const all = new Set<string>();
    batchLogs.forEach((b: any) => { const s = (b.subgrid || b.imageFilename || ''); if (s) all.add((s.match(/[nNsS]\d{2}[eEwW]\d{2,3}/) || [s.toUpperCase().trim()])[0].toUpperCase()); });
    dailyData.forEach((d: any) => { const s = (d.subgrid || d.imageFilename || ''); if (s) all.add((s.match(/[nNsS]\d{2}[eEwW]\d{2,3}/) || [s.toUpperCase().trim()])[0].toUpperCase()); });
    stagingRows.forEach((r: any) => { const s = (r.subgrid || ''); if (s) all.add(s.toUpperCase().trim()); });
    const set = buildBoundarySubgridSet(Array.from(all), boundary, SUBGRID_COORDINATES as Record<string, [number, number]>);
    return set.size > 0 ? set : undefined;
  }, [batchLogs, dailyData, stagingRows, projectSettings]);

  const analytics = useMemo(
    () =>
      computeSurveyAnalytics({
        batches: batchLogs,
        daily: dailyData,
        aggregates: aggregateStagingBySubgrid(stagingRows),
        targetKm: Number(projectSettings?.targetKm) || 0,
        targetImages: Number(projectSettings?.targetImages) || 0,
        boundarySubgrids
      }),
    [batchLogs, dailyData, stagingRows, projectSettings?.targetKm, projectSettings?.targetImages, boundarySubgrids]
  );

  const generate = (builder: () => string) => {
    if (isGuestUser) return;
    openPrintableReport('GeoSphere 360 Report', builder());
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="px-1">
          <h2 className="text-base font-bold text-text-base tracking-wide">
            {translate('reportsTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            {translate('reportsSubtitle')}
          </p>
        </div>

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={TABS}
              active={activeTab}
              onChange={setActiveTab}
              tabLabel={(key) => translate(REPORTS_TAB_LABELS[key])}
            />
          </div>

          <div className="p-4 sm:p-5 flex flex-col gap-4 min-h-0">
            {/* Reports Telemetry Strip */}
            <div className="bg-inner/40 border border-subtle rounded-xl px-4 py-2.5 shadow-sm text-xs flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-[11px] font-bold text-text-muted shrink-0 uppercase tracking-wider">
                Reports Telemetry:
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span>
                  <span className="text-text-muted">{translate('reportsKpiSubgrids')}: </span>
                  <strong className="font-semibold text-text-base">{analytics.totals.subgrids}</strong>
                </span>
                <span className="text-text-muted">&bull;</span>
                <span>
                  <span className="text-text-muted">{translate('reportsKpiPublished')}: </span>
                  <strong className="font-semibold text-text-base">{analytics.totals.published}</strong>
                </span>
                <span className="text-text-muted">&bull;</span>
                <span>
                  <span className="text-text-muted">{translate('reportsKpiStaged')}: </span>
                  <strong className="font-semibold text-text-base">{analytics.totals.staged}</strong>
                </span>
                <span className="text-text-muted">&bull;</span>
                <span>
                  <span className="text-text-muted">{translate('reportsKpiKm')}: </span>
                  <strong className="font-semibold text-text-base">{analytics.totals.km.toFixed(2)} km</strong>
                </span>
                <span className="text-text-muted">&bull;</span>
                <span>
                  <span className="text-text-muted">{translate('reportsKpiPoi')}: </span>
                  <strong className="font-semibold text-text-base">{analytics.totals.poi.toLocaleString()}</strong>
                </span>
                <span className="text-text-muted">&bull;</span>
                <span>
                  <span className="text-text-muted">{translate('reportsKpiDefects')}: </span>
                  <strong className="font-semibold text-text-base">{analytics.totals.defects.toLocaleString()}</strong>
                </span>
                <span className="text-text-muted">&bull;</span>
                <span>
                  <span className="text-text-muted">{translate('reportsKpiPassRate')}: </span>
                  <strong className="font-semibold text-text-base">{analytics.totals.passRate.toFixed(1)}%</strong>
                </span>
              </div>
            </div>

            {/* Active report panel */}
            {activeTab === 'executive' && (
              <ReportActionCard
                icon={<FileText size={20} />}
                title={translate('reportsExecTitle')}
                desc={translate('reportsExecDesc')}
                onGenerate={() => generate(() => buildExecutiveReportHtml(analytics))}
                disabled={isGuestUser}
                translate={translate}
              />
            )}
            {activeTab === 'daily' && (
              <ReportActionCard
                icon={<CalendarClock size={20} />}
                title={translate('reportsDailyTitle')}
                desc={translate('reportsDailyDesc')}
                onGenerate={() => generate(() => buildDailyReportHtml(dailyData))}
                disabled={isGuestUser}
                translate={translate}
              />
            )}
            {activeTab === 'subgrid' && (
              <ReportActionCard
                icon={<Layers size={20} />}
                title={translate('reportsSubgridTitle')}
                desc={translate('reportsSubgridDesc')}
                onGenerate={() => generate(() => buildSubgridReportHtml(analytics))}
                disabled={isGuestUser}
                translate={translate}
              />
            )}
            {activeTab === 'qa' && (
              <ReportActionCard
                icon={<ShieldCheck size={20} />}
                title={translate('reportsQaTitle')}
                desc={translate('reportsQaDesc')}
                onGenerate={() => generate(() => buildQaReportHtml({ jobs, analytics }))}
                disabled={isGuestUser}
                translate={translate}
              />
            )}
            {activeTab === 'lineage' && (
              <ReportActionCard
                icon={<GitBranch size={20} />}
                title={translate('reportsLineageTitle')}
                desc={translate('reportsLineageDesc')}
                onGenerate={() => generate(() => buildLineageReportHtml({ datasets, jobs }))}
                disabled={isGuestUser}
                translate={translate}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

function ReportActionCard({
  icon,
  title,
  desc,
  onGenerate,
  disabled,
  translate
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onGenerate: () => void;
  disabled?: boolean;
  translate: (k: string) => string;
}) {
  return (
    <div className="bg-card border border-subtle rounded-xl p-5 flex flex-col xl:flex-row xl:items-center gap-4 xl:justify-between">
      <div className="flex items-start gap-4 min-w-0">
        <div className="p-3 bg-inner rounded-2xl border border-subtle text-sky-400 shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-text-base">{title}</h3>
          </div>
          <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{desc}</p>
          <ul className="flex flex-wrap gap-1.5 mt-3">
            {[
              translate('reportsChkSummary'),
              translate('reportsChkTables'),
              translate('reportsChkPrint')
            ].map((s) => (
              <li key={s} className="text-[10px] px-2 py-1 rounded-md bg-inner border border-subtle text-emerald-300">
                ✓ {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <button
        onClick={onGenerate}
        disabled={disabled}
        className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0 shadow-sm ${
          disabled
            ? 'bg-inner border border-subtle text-text-muted cursor-not-allowed'
            : 'bg-sky-500 hover:bg-sky-400 text-slate-950'
        }`}
      >
        <Printer size={15} /> {translate('reportsGenerate')}
      </button>
    </div>
  );
}