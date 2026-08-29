import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns3,
  Inbox,
  ListChecks,
  Gauge,
  Cpu,
  RefreshCw,
  Undo2
} from 'lucide-react';
import { fetchDatasetsFromSupabase, fetchProcessingJobsFromSupabase } from '../services/supabase';
import { createProductionApiClient } from '../services/productionApi';
import type { ProductionApiClient } from '../services/productionApi';
import type { DatasetRecord, ProcessingCenterTab, ProcessingJobRecord } from '../types/production';
import { startJobPolling } from '../utils/productionQueue';
import { getProductionApiSettings } from './production/common';
import { PROCESSING_TAB_LABELS } from './production/processing/processingCommon';
import { JobBoardPanel } from './production/processing/JobBoardPanel';
import { HandoffPanel } from './production/processing/HandoffPanel';
import { QAConsultPanel } from './production/processing/QAConsultPanel';
import { CapacityPanel } from './production/processing/CapacityPanel';
import { JobDetailsDrawer } from './production/processing/JobDetailsDrawer';

export interface ProcessingCenterWorkspaceProps {
  projectSettings: any;
  setProjectSettings: React.Dispatch<React.SetStateAction<any>>;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  translate?: (key: string) => string;
}

const TABS: Array<{ key: ProcessingCenterTab; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { key: 'board', icon: Columns3 },
  { key: 'handoff', icon: Inbox },
  { key: 'qa', icon: ListChecks },
  { key: 'capacity', icon: Gauge }
];

export const ProcessingCenterWorkspace: React.FC<ProcessingCenterWorkspaceProps> = ({
  projectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<ProcessingCenterTab>('board');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<ProcessingJobRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollStopRef = useRef<(() => void) | null>(null);

  const api: ProductionApiClient = useMemo(
    () => createProductionApiClient(getProductionApiSettings(projectSettings)),
    [projectSettings?.productionApiMode, projectSettings?.productionApiUrl, projectSettings?.productionConcurrency, projectSettings?.nasWorkBasePath]
  );

  const refreshDatasets = useCallback(
    () => fetchDatasetsFromSupabase().then(setDatasets),
    []
  );
  const refreshJobs = useCallback(
    () => fetchProcessingJobsFromSupabase().then(setJobs),
    []
  );

  useEffect(() => {
    refreshDatasets();
    refreshJobs();
  }, [refreshDatasets, refreshJobs]);

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
    Promise.all([refreshDatasets(), refreshJobs()]).finally(() => setRefreshing(false));
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
                <h2 className="text-sm font-bold text-text-base tracking-wide">Processing Center</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                  api.mode === 'mock'
                    ? 'text-sky-300 border-sky-500/40 bg-sky-950/40'
                    : 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40'
                }`}>
                  {api.mode === 'mock' ? 'Mock Worker' : `${api.baseUrl || 'Worker'} · HTTP`}
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                Central job operations: NAS GPU Worker (ENHANCE/MASK), external-PC handoff (STITCH/BLUR/REPORT/EXPORT job types), acceptance QA decisions and live capacity. Metadata in Supabase only.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-card text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> {translate('refresh')}
            </button>
            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-card text-text-muted hover:text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer"
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
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'text-text-muted hover:text-text-base border border-transparent'
                }`}>
                <Icon size={14} />
                {translate(PROCESSING_TAB_LABELS[tab.key])}
              </button>
            );
          })}
        </div>

        {isGuestUser && (
          <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            Read-only mode: you can inspect the board, handoff queue and QA worklist, but cannot create, start, hand off or approve/reject anything.
          </div>
        )}

        {/* Active tab panel */}
        <div className="bg-card border border-subtle rounded-xl p-4 min-h-0">
          {activeTab === 'board' && (
            <JobBoardPanel
              jobs={jobs}
              datasets={datasets}
              api={api}
              projectSettings={projectSettings}
              isGuestUser={isGuestUser}
              onRefreshJobs={refreshJobs}
              onAddNotification={addNotification}
              onAddAuditLog={addAuditLog}
              userLabel={userLabel}
              onOpenJobDetails={setSelectedJob}
            />
          )}
          {activeTab === 'handoff' && (
            <HandoffPanel
              jobs={jobs}
              api={api}
              projectSettings={projectSettings}
              isGuestUser={isGuestUser}
              onRefreshJobs={refreshJobs}
              onAddNotification={addNotification}
              onAddAuditLog={addAuditLog}
              userLabel={userLabel}
              onOpenJobDetails={setSelectedJob}
            />
          )}
          {activeTab === 'qa' && (
            <QAConsultPanel
              jobs={jobs}
              datasets={datasets}
              api={api}
              projectSettings={projectSettings}
              isGuestUser={isGuestUser}
              onRefreshJobs={refreshJobs}
              onAddNotification={addNotification}
              onAddAuditLog={addAuditLog}
              userLabel={userLabel}
            />
          )}
          {activeTab === 'capacity' && (
            <CapacityPanel
              jobs={jobs}
              api={api}
              projectSettings={projectSettings}
              translate={translate}
            />
          )}
        </div>
      </div>
      {selectedJob && (
        <JobDetailsDrawer
          job={selectedJob}
          datasets={datasets}
          isGuestUser={isGuestUser}
          userLabel={userLabel}
          onClose={() => setSelectedJob(null)}
          onRefreshJobs={refreshJobs}
          onAddNotification={addNotification}
          onAddAuditLog={addAuditLog}
        />
      )}
    </div>
  );
};