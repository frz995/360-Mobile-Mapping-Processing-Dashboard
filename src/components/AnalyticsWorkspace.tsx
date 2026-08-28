import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  RefreshCw,
  Undo2,
  Route,
  Layers,
  Radar,
  ShieldCheck
} from 'lucide-react';
import { fetchStagingPanoramasFromSupabase, fetchProcessingJobsFromSupabase, SUBGRID_COORDINATES } from '../services/supabase';
import { aggregateStagingBySubgrid } from '../utils/datasetLineage';
import { buildBoundarySubgridSet } from '../utils/projectBoundary';
import type { ProcessingJobRecord } from '../types/production';
import { computeSurveyAnalytics, type SurveyAnalytics } from '../utils/surveyAnalytics';
import { ANALYTICS_TAB_LABELS } from './production/analytics/analyticsCommon';
import { OverviewPanel } from './production/analytics/OverviewPanel';
import { DistancePanel } from './production/analytics/DistancePanel';
import { CoveragePanel } from './production/analytics/CoveragePanel';
import { DensityPanel } from './production/analytics/DensityPanel';
import { QualityPanel } from './production/analytics/QualityPanel';

export interface AnalyticsWorkspaceProps {
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

type AnalyticsTab = 'overview' | 'distance' | 'coverage' | 'density' | 'quality';

const TABS: Array<{ key: AnalyticsTab; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { key: 'overview', icon: BarChart3 },
  { key: 'distance', icon: Route },
  { key: 'coverage', icon: Layers },
  { key: 'density', icon: Radar },
  { key: 'quality', icon: ShieldCheck }
];

export const AnalyticsWorkspace: React.FC<AnalyticsWorkspaceProps> = ({
  projectSettings,
  isGuestUser,
  onBackToDashboard,
  translate = (k) => k,
  batchLogs = [],
  dailyData = [],
  onRefreshData
}) => {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('overview');
  const [stagingRows, setStagingRows] = useState<any[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refreshStaging = useCallback(() => {
    fetchStagingPanoramasFromSupabase().then(setStagingRows);
  }, []);
  const refreshJobs = useCallback(() => {
    fetchProcessingJobsFromSupabase().then(setJobs);
  }, []);

  useEffect(() => {
    refreshStaging();
    refreshJobs();
  }, [refreshStaging, refreshJobs]);

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.all([refreshStaging(), refreshJobs(), onRefreshData?.()])
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  };

  const aggregates = useMemo(() => aggregateStagingBySubgrid(stagingRows), [stagingRows]);

  const qaBySubgrid = useMemo(() => {
    const map: Record<string, { approved: number; rejected: number }> = {};
    for (const j of jobs) {
      const sg = (j.subgrid || '').trim().toUpperCase();
      if (!sg) continue;
      const entry = map[sg] || { approved: 0, rejected: 0 };
      if (j.qa_decision === 'APPROVED') entry.approved += 1;
      else if (j.qa_decision === 'REJECTED') entry.rejected += 1;
      map[sg] = entry;
    }
    return map;
  }, [jobs]);

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

  const analytics: SurveyAnalytics = useMemo(
    () =>
      computeSurveyAnalytics({
        batches: batchLogs,
        daily: dailyData,
        aggregates,
        qaBySubgrid,
        targetKm: Number(projectSettings?.targetKm) || 0,
        targetImages: Number(projectSettings?.targetImages) || 0,
        boundarySubgrids
      }),
    [batchLogs, dailyData, aggregates, qaBySubgrid, projectSettings?.targetKm, projectSettings?.targetImages, boundarySubgrids]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-inner rounded-xl border border-subtle text-emerald-400">
              <BarChart3 size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-text-base tracking-wide">
                  {translate('analyticsTitle')}
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-emerald-500/40 bg-emerald-950/40 text-emerald-300">
                  Live
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                {translate('analyticsSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-emerald-500/20 hover:border-emerald-500/40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
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
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-text-muted hover:text-text-base border border-transparent'
                }`}
              >
                <Icon size={14} />
                {translate(ANALYTICS_TAB_LABELS[tab.key])}
              </button>
            );
          })}
        </div>

        {isGuestUser && (
          <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            {translate('analyticsGuestNote')}
          </div>
        )}

        {/* Active tab panel */}
        <div className="min-h-0">
          {activeTab === 'overview' && <OverviewPanel analytics={analytics} translate={translate} />}
          {activeTab === 'distance' && <DistancePanel analytics={analytics} translate={translate} />}
          {activeTab === 'coverage' && <CoveragePanel analytics={analytics} translate={translate} />}
          {activeTab === 'density' && <DensityPanel analytics={analytics} translate={translate} />}
          {activeTab === 'quality' && <QualityPanel analytics={analytics} translate={translate} />}
        </div>
      </div>
    </div>
  );
};