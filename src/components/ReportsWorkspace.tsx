import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Layers,
  ShieldCheck,
  GitBranch,
  RefreshCw,
  Undo2,
  FileText,
  Printer
} from 'lucide-react';
import { fetchDatasetsFromSupabase, fetchProcessingJobsFromSupabase, fetchStagingPanoramasFromSupabase } from '../services/supabase';
import { aggregateStagingBySubgrid } from '../utils/datasetLineage';
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

const TABS: Array<{ key: ReportsTab; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { key: 'executive', icon: FileText },
  { key: 'daily', icon: CalendarClock },
  { key: 'subgrid', icon: Layers },
  { key: 'qa', icon: ShieldCheck },
  { key: 'lineage', icon: GitBranch }
];

export const ReportsWorkspace: React.FC<ReportsWorkspaceProps> = ({
  projectSettings,
  isGuestUser,
  onBackToDashboard,
  translate = (k) => k,
  batchLogs = [],
  dailyData = [],
  onRefreshData
}) => {
  const [activeTab, setActiveTab] = useState<ReportsTab>('executive');
  const [stagingRows, setStagingRows] = useState<any[]>([]);
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

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

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.all([refreshAll(), onRefreshData?.()])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  const analytics = useMemo(
    () =>
      computeSurveyAnalytics({
        batches: batchLogs,
        daily: dailyData,
        aggregates: aggregateStagingBySubgrid(stagingRows),
        targetKm: Number(projectSettings?.targetKm) || 0,
        targetImages: Number(projectSettings?.targetImages) || 0
      }),
    [batchLogs, dailyData, stagingRows, projectSettings?.targetKm, projectSettings?.targetImages]
  );

  const generate = (builder: () => string) => {
    if (isGuestUser) return;
    openPrintableReport('GeoSphere 360 Report', builder());
  };

  const kpis = [
    { label: translate('reportsKpiSubgrids'), value: String(analytics.totals.subgrids) },
    { label: translate('reportsKpiPublished'), value: String(analytics.totals.published) },
    { label: translate('reportsKpiStaged'), value: String(analytics.totals.staged) },
    { label: translate('reportsKpiKm'), value: `${analytics.totals.km.toFixed(2)} km` },
    { label: translate('reportsKpiPoi'), value: analytics.totals.poi.toLocaleString() },
    { label: translate('reportsKpiDefects'), value: analytics.totals.defects.toLocaleString() },
    { label: translate('reportsKpiPassRate'), value: `${analytics.totals.passRate.toFixed(1)}%` }
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-inner rounded-xl border border-subtle text-violet-400">
              <FileText size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-text-base tracking-wide">
                  {translate('reportsTitle')}
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-emerald-500/40 bg-emerald-950/40 text-emerald-300">
                  Live
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                {translate('reportsSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-violet-500/20 hover:border-violet-500/40 text-violet-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {translate('refresh')}
            </button>
            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-amber-500/20 hover:border-amber-500/40 text-amber-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <Undo2 size={13} /> {translate('backToDashboard')}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto bg-card border border-subtle rounded-xl p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                    : 'text-text-muted hover:text-text-base border border-transparent'
                }`}
              >
                <Icon size={14} />
                {translate(REPORTS_TAB_LABELS[tab.key])}
              </button>
            );
          })}
        </div>

        {isGuestUser && (
          <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            {translate('reportsGuestNote')}
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-2">
          {kpis.map((k) => (
            <div key={k.label} className="bg-inner border border-subtle rounded-xl p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{k.label}</div>
              <div className="text-sm font-bold text-text-base mt-1">{k.value}</div>
            </div>
          ))}
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
            tag={translate('reportsTagAutomatic')}
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
            tag={`${dailyData.length} ${translate('reportsTagRecords')}`}
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
            tag={`${analytics.perSubgrid.length} ${translate('reportsTagSubgrids')}`}
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
            tag={`${jobs.filter((j: any) => j.qa_decision).length} ${translate('reportsTagDecisions')}`}
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
            tag={`${datasets.length} ${translate('reportsTagDatasets')}`}
          />
        )}
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
  translate,
  tag
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onGenerate: () => void;
  disabled?: boolean;
  translate: (k: string) => string;
  tag?: string;
}) {
  return (
    <div className="bg-card border border-subtle rounded-xl p-5 flex flex-col xl:flex-row xl:items-center gap-4 xl:justify-between">
      <div className="flex items-start gap-4 min-w-0">
        <div className="p-3 bg-inner rounded-2xl border border-subtle text-violet-300 shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-text-base">{title}</h3>
            {tag && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-violet-500/40 bg-violet-950/40 text-violet-300">
                {tag}
              </span>
            )}
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
        className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
          disabled
            ? 'bg-inner border border-subtle text-text-muted cursor-not-allowed'
            : 'bg-violet-500/20 border border-violet-500/40 text-violet-300 hover:bg-violet-500/30'
        }`}
      >
        <Printer size={15} /> {translate('reportsGenerate')}
      </button>
    </div>
  );
}