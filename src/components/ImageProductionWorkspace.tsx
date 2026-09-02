import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListChecks,
  Database,
  HardDrive,
  Eye,
  Sparkles,
  Eraser
} from 'lucide-react';
import {
  fetchDatasetsFromSupabase,
  fetchProcessingJobsFromSupabase,
  fetchStagingPanoramasFromSupabase
} from '../services/supabase';
import { createProductionApiClient } from '../services/productionApi';
import type { ProductionApiClient } from '../services/productionApi';
import type {
  DatasetRecord,
  ProcessingJobRecord,
  ProductionTab
} from '../types/production';
import { startJobPolling } from '../utils/productionQueue';
import { aggregateStagingBySubgrid } from '../utils/datasetLineage';
import type { StagingAggregate } from '../utils/datasetLineage';
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';
import {
  getProductionApiSettings,
  PRODUCTION_TAB_LABELS
} from './production/common';
import { PipelinePanel } from './production/PipelinePanel';
import { DatasetsPanel } from './production/DatasetsPanel';
import { ProvidersPanel } from './production/ProvidersPanel';
import { PreviewPanel } from './production/PreviewPanel';
import { EnhancementPanel } from './production/EnhancementPanel';
import { MaskingPanel } from './production/MaskingPanel';
import { JobDetailsDrawer } from './production/processing/JobDetailsDrawer';

export interface ImageProductionWorkspaceProps {
  projectSettings: any;
  setProjectSettings: React.Dispatch<React.SetStateAction<any>>;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  translate?: (key: string) => string;
}

const TABS: Array<ChromeTab<ProductionTab>> = [
  { key: 'pipeline', icon: <ListChecks size={14} /> },
  { key: 'datasets', icon: <Database size={14} /> },
  { key: 'providers', icon: <HardDrive size={14} /> },
  { key: 'preview', icon: <Eye size={14} /> },
  { key: 'enhance', icon: <Sparkles size={14} /> },
  { key: 'masking', icon: <Eraser size={14} /> }
];

export const ImageProductionWorkspace: React.FC<ImageProductionWorkspaceProps> = ({
  projectSettings,
  setProjectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard: _onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<ProductionTab>('pipeline');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [stagingRows, setStagingRows] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState<ProcessingJobRecord | null>(null);
  const pollStopRef = useRef<(() => void) | null>(null);

  const api: ProductionApiClient = useMemo(
    () => createProductionApiClient(getProductionApiSettings(projectSettings)),
    [projectSettings?.productionApiMode, projectSettings?.productionApiUrl, projectSettings?.productionConcurrency, projectSettings?.nasWorkBasePath]
  );

  const stagingAggregates: StagingAggregate[] = useMemo(
    () => aggregateStagingBySubgrid(stagingRows),
    [stagingRows]
  );

  const refreshDatasets = useCallback(() => {
    fetchDatasetsFromSupabase().then(setDatasets);
  }, []);

  const refreshJobs = useCallback(() => {
    fetchProcessingJobsFromSupabase().then(setJobs);
  }, []);

  const refreshStaging = useCallback(() => {
    fetchStagingPanoramasFromSupabase().then(setStagingRows);
  }, []);

  useEffect(() => {
    refreshDatasets();
    refreshJobs();
    refreshStaging();
  }, [refreshDatasets, refreshJobs, refreshStaging]);

  // Live job polling (async, non-blocking).
  useEffect(() => {
    if (!pollStopRef.current) {
      pollStopRef.current = startJobPolling({
        intervalMs: Math.max(2000, projectSettings?.dbAutoSyncSec || 5) * 1000,
        fetchJobs: fetchProcessingJobsFromSupabase,
        onUpdate: setJobs
      });
    }
    return () => {
      pollStopRef.current?.();
      pollStopRef.current = null;
    };
  }, [projectSettings?.dbAutoSyncSec]);

  const userEmail =
    authSession?.user?.email || authSession?.user?.user_metadata?.full_name || 'Operator';
  const userLabel = isGuestUser ? 'Guest' : userEmail;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="px-1">
          <h2 className="text-base font-bold text-text-base tracking-wide">
            Production Workspace
          </h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            RAW → stitch/blur → enhance + generative-fill mask removal → acceptance QA → deliverable. Metadata in Supabase; all image bytes on NAS; nothing modified in place.
          </p>
        </div>

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={TABS}
              active={activeTab}
              onChange={setActiveTab}
              tabLabel={(key) => translate(PRODUCTION_TAB_LABELS[key])}
            />
          </div>

          <div key={activeTab} className="p-4 flex-1 flex flex-col min-h-0 overflow-y-auto animate-panel-enter">
            {/* Active tab panel */}
            {activeTab === 'pipeline' && (
              <PipelinePanel
                jobs={jobs}
                datasets={datasets}
                api={api}
                projectSettings={projectSettings}
                stagingAggregates={stagingAggregates}
                translate={translate}
                isGuestUser={isGuestUser}
                onRefreshJobs={refreshJobs}
                onRefreshDatasets={refreshDatasets}
                onAddNotification={addNotification}
                onAddAuditLog={addAuditLog}
                userLabel={userLabel}
                onOpenJobDetails={setSelectedJob}
              />
            )}
            {activeTab === 'datasets' && (
              <DatasetsPanel
                datasets={datasets}
                stagingRows={stagingRows}
                stagingAggregates={stagingAggregates}
                jobs={jobs}
                api={api}
                translate={translate}
                isGuestUser={isGuestUser}
                onRefreshDatasets={refreshDatasets}
                onAddNotification={addNotification}
                onAddAuditLog={addAuditLog}
                userLabel={userLabel}
              />
            )}
            {activeTab === 'providers' && (
              <ProvidersPanel
                projectSettings={projectSettings}
                setProjectSettings={setProjectSettings}
                translate={translate}
                isGuestUser={isGuestUser}
                onAddNotification={addNotification}
                onAddAuditLog={addAuditLog}
                userLabel={userLabel}
              />
            )}
            {activeTab === 'preview' && (
              <PreviewPanel
                datasets={datasets}
                api={api}
                projectSettings={projectSettings}
                translate={translate}
              />
            )}
            {activeTab === 'enhance' && (
              <EnhancementPanel
                datasets={datasets}
                api={api}
                projectSettings={projectSettings}
                translate={translate}
                isGuestUser={isGuestUser}
                onRefreshJobs={refreshJobs}
                onAddNotification={addNotification}
                onAddAuditLog={addAuditLog}
                userLabel={userLabel}
              />
            )}
            {activeTab === 'masking' && (
              <MaskingPanel
                datasets={datasets}
                api={api}
                projectSettings={projectSettings}
                translate={translate}
                isGuestUser={isGuestUser}
                onRefreshJobs={refreshJobs}
                onAddNotification={addNotification}
                onAddAuditLog={addAuditLog}
                userLabel={userLabel}
              />
            )}
          </div>
        </div>
      </div>

      <JobDetailsDrawer
        job={selectedJob}
        datasets={datasets}
        onClose={() => setSelectedJob(null)}
        onRefreshJobs={refreshJobs}
        onAddNotification={addNotification}
        onAddAuditLog={addAuditLog}
        userLabel={userLabel}
        translate={translate}
        isGuestUser={isGuestUser}
      />
    </div>
  );
};