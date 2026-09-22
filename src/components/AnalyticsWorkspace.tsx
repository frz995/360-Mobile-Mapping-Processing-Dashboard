import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { restoreWorkspaceTab, persistWorkspaceTab } from '../utils/workspaceLocation';
import {
  BarChart3,
  Layers,
  ShieldCheck,
  History
} from 'lucide-react';
import { fetchStagingPanoramasFromSupabase, fetchProcessingJobsFromSupabase, SUBGRID_COORDINATES } from '../services/supabase';
import { aggregateStagingBySubgrid, extractCanonicalSubgrid } from '../utils/datasetLineage';
import { buildBoundarySubgridSet } from '../utils/projectBoundary';
import type { ProcessingJobRecord } from '../types/production';
import { computeSurveyAnalytics, type SurveyAnalytics } from '../utils/surveyAnalytics';
import { ANALYTICS_TAB_LABELS } from './production/analytics/analyticsCommon';
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';
import { OverviewPanel } from './production/analytics/OverviewPanel';
import { LedgerPanel } from './production/analytics/LedgerPanel';
import { CoveragePanel } from './production/analytics/CoveragePanel';

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

type AnalyticsTab = 'overview' | 'ledger' | 'coverage' | 'quality';

const TABS: ChromeTab<AnalyticsTab>[] = [
  { key: 'overview', icon: <BarChart3 size={14} /> },
  { key: 'ledger', icon: <History size={14} /> },
  { key: 'coverage', icon: <Layers size={14} /> },
  
  { key: 'quality', icon: <ShieldCheck size={14} /> }
];

export const AnalyticsWorkspace: React.FC<AnalyticsWorkspaceProps> = ({
  projectSettings,
  isGuestUser: _isGuestUser,
  onBackToDashboard: _onBackToDashboard,
  translate = (k) => k,
  batchLogs = [],
  dailyData = [],
  onRefreshData: _onRefreshData
}) => {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>(() => {
    // Legacy 'distance' persisted tabs redirect to the merged coverage view.
    const analyticsTabs = ['overview', 'ledger', 'distance', 'coverage', 'quality'] as const;
    const restored = restoreWorkspaceTab<typeof analyticsTabs[number]>('analytics', analyticsTabs);
    return restored === 'distance' ? 'coverage' : restored ?? 'overview';
  });
  useEffect(() => {
    persistWorkspaceTab('analytics', activeTab);
  }, [activeTab]);
  const [stagingRows, setStagingRows] = useState<any[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);

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

  const aggregates = useMemo(() => aggregateStagingBySubgrid(stagingRows), [stagingRows]);

  const qaBySubgrid = useMemo(() => {
    const map: Record<string, { approved: number; rejected: number }> = {};
    for (const j of jobs) {
      const sg = extractCanonicalSubgrid(j.subgrid);
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
    batchLogs.forEach((b: any) => { const s = extractCanonicalSubgrid(b.subgrid || b.imageFilename || ''); if (s) all.add(s); });
    dailyData.forEach((d: any) => { const s = extractCanonicalSubgrid(d.subgrid || d.imageFilename || ''); if (s) all.add(s); });
    stagingRows.forEach((r: any) => { const s = extractCanonicalSubgrid(r.subgrid || ''); if (s) all.add(s); });
    const set = buildBoundarySubgridSet(Array.from(all), boundary, SUBGRID_COORDINATES as Record<string, [number, number]>);
    return set.size > 0 ? set : undefined;
  }, [batchLogs, dailyData, stagingRows, projectSettings]);

  const roadAnalysisConfig = useMemo(() => {
    // 1. Direct from projectSettings
    if (projectSettings?.roadAnalysisState) {
      return projectSettings.roadAnalysisState;
    }
    // 2. From cached road analysis state in localStorage
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('geosphere_road_analysis_state_'));
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed) return parsed;
        }
      }
    } catch { }
    return null;
  }, [projectSettings]);

  const hasRoadPlanSource = useMemo(() => {
    if (!roadAnalysisConfig) return false;
    const planKm = Number(roadAnalysisConfig.planDistanceKm);
    const hasExtracted = Array.isArray(roadAnalysisConfig.extractedLines) && roadAnalysisConfig.extractedLines.length > 0;
    const hasManual = Boolean(roadAnalysisConfig.manualGeoJson?.features?.length);
    const hasCatalogPlan = Boolean(roadAnalysisConfig.catalogPlanLayerId);
    const hasSubgridPlan = Boolean(roadAnalysisConfig.subgridPlanKm && Object.values(roadAnalysisConfig.subgridPlanKm).some((v: any) => Number(v) > 0));
    // Also detect catalog layers that contain road lines (imported road plan layers
    // that may not have been explicitly promoted via the plan icon).
    const hasCatalogRoadLayer = Array.isArray(roadAnalysisConfig.catalogLayers) &&
      roadAnalysisConfig.catalogLayers.some((l: any) => l.hasRoadLines || (l.totalDistanceKm && Number(l.totalDistanceKm) > 0));
    return planKm > 0 || hasExtracted || hasManual || hasCatalogPlan || hasSubgridPlan || hasCatalogRoadLayer;
  }, [roadAnalysisConfig]);

  const roadPlanKm = useMemo(() => {
    if (hasRoadPlanSource) {
      const planKm = Number(roadAnalysisConfig?.planDistanceKm);
      if (planKm > 0) return planKm;
      // Fallback: derive from catalog road layer's totalDistanceKm
      if (Array.isArray(roadAnalysisConfig?.catalogLayers)) {
        for (const l of roadAnalysisConfig.catalogLayers) {
          const dist = Number(l.totalDistanceKm);
          if (dist > 0) return dist;
        }
      }
    }
    return Number(projectSettings?.targetKm) || 0;
  }, [hasRoadPlanSource, roadAnalysisConfig, projectSettings]);

  const subgridPlanKm = useMemo(() => {
    if (!hasRoadPlanSource || !roadAnalysisConfig) return undefined;
    if (roadAnalysisConfig.subgridPlanKm && typeof roadAnalysisConfig.subgridPlanKm === 'object') {
      return roadAnalysisConfig.subgridPlanKm as Record<string, number>;
    }
    return undefined;
  }, [hasRoadPlanSource, roadAnalysisConfig]);

  const totalProjectSubgrids = useMemo(() => {
    const fromState = Number(roadAnalysisConfig?.totalSubgrids);
    if (fromState > 0) return fromState;
    if (boundarySubgrids && boundarySubgrids.size > 0) return boundarySubgrids.size;
    return undefined;
  }, [roadAnalysisConfig, boundarySubgrids]);

  const analytics: SurveyAnalytics = useMemo(
    () =>
      computeSurveyAnalytics({
        batches: batchLogs,
        daily: dailyData,
        aggregates,
        qaBySubgrid,
        targetKm: Number(projectSettings?.targetKm) || 0,
        targetImages: Number(projectSettings?.targetImages) || 0,
        roadPlanKm,
        subgridPlanKm,
        hasRoadPlanSource,
        totalProjectSubgrids,
        boundarySubgrids
      }),
    [
      batchLogs,
      dailyData,
      aggregates,
      qaBySubgrid,
      projectSettings?.targetKm,
      projectSettings?.targetImages,
      roadPlanKm,
      subgridPlanKm,
      hasRoadPlanSource,
      totalProjectSubgrids,
      boundarySubgrids
    ]
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="px-1">
          <h2 className="text-base font-bold text-text-base tracking-wide">
            {translate('analyticsTitle')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            {translate('analyticsSubtitle')}
          </p>
        </div>

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={TABS}
              active={activeTab}
              onChange={setActiveTab}
              tabLabel={(key) => translate(ANALYTICS_TAB_LABELS[key])}
            />
          </div>

          <div key={activeTab} className="p-4 sm:p-5 flex-1 flex flex-col min-h-0 overflow-y-auto animate-panel-enter">
            {/* Active tab panel */}
            {activeTab === 'overview' && <OverviewPanel analytics={analytics} translate={translate} />}
            {activeTab === 'ledger' && (
              <LedgerPanel
                analytics={analytics}
                batchLogs={batchLogs}
                dailyData={dailyData}
                projectSettings={projectSettings}
                translate={translate}
              />
            )}
            {activeTab === 'coverage' && <CoveragePanel analytics={analytics} translate={translate} />}
            {activeTab === 'quality' && <QualityPanel analytics={analytics} translate={translate} />}
          </div>
        </div>
      </div>
    </div>
  );
};