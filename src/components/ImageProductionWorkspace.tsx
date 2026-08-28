import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListChecks,
  Database,
  HardDrive,
  Eye,
  Sparkles,
  Eraser,
  Cpu,
  RefreshCw,
  Undo2
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

const TABS: Array<{ key: ProductionTab; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { key: 'pipeline', icon: ListChecks },
  { key: 'datasets', icon: Database },
  { key: 'providers', icon: HardDrive },
  { key: 'preview', icon: Eye },
  { key: 'enhance', icon: Sparkles },
  { key: 'masking', icon: Eraser }
];

export const ImageProductionWorkspace: React.FC<ImageProductionWorkspaceProps> = ({
  projectSettings,
  setProjectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<ProductionTab>('pipeline');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [stagingRows, setStagingRows] = useState<any[]>([]);
  const [selectedJob, setSelectedJob] = useState<ProcessingJobRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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

  const handleRefresh = () => {
    setRefreshing(true);
    Promise.all([refreshDatasets(), refreshJobs(), refreshStaging()]).finally(() => setRefreshing(false));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
              <Cpu size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-text-base tracking-wide">Image Production Workspace</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                  api.mode === 'mock'
                    ? 'text-sky-300 border-sky-500/40 bg-sky-950/40'
                    : 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40'
                }`}>
                  {api.mode === 'mock' ? 'Mock Worker' : `${api.baseUrl || 'Worker'} · HTTP`}
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                RAW → stitch/blur → enhance + generative-fill mask removal → QA/QC → deliverable. Metadata in Supabase; all image bytes on NAS; nothing modified in place.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-sky-500/20 hover:border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            {onBackToDashboard && (
              <button onClick={onBackToDashboard}
                className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-amber-500/20 hover:border-amber-500/40 text-amber-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
                <Undo2 size={13} /> Dashboard
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
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'text-text-muted hover:text-text-base border border-transparent'
                }`}>
                <Icon size={14} />
                {translate(PRODUCTION_TAB_LABELS[tab.key])}
              </button>
            );
          })}
        </div>

        {isGuestUser && (
          <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            Read-only mode: you can inspect datasets, jobs, folders and previews, but cannot create, start, cancel, import or delete anything.
          </div>
        )}

        {/* Active tab panel */}
        <div className="bg-card border border-subtle rounded-xl p-4 min-h-0">
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
              onAddNotification={addNotification}
              onAddAuditLog={addAuditLog}
              userLabel={userLabel}
              onOpenJobDetails={setSelectedJob}
            />
          )}
          {activeTab === 'datasets' && (
            <DatasetsPanel
              datasets={datasets}
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