import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Columns3,
  Inbox,
  ListChecks,
  Gauge
} from 'lucide-react';
import { fetchDatasetsFromSupabase, fetchProcessingJobsFromSupabase } from '../services/supabase';
import { createProductionApiClient } from '../services/productionApi';
import type { ProductionApiClient } from '../services/productionApi';
import type { DatasetRecord, ProcessingCenterTab, ProcessingJobRecord } from '../types/production';
import { startJobPolling } from '../utils/productionQueue';
import { getProductionApiSettings } from './production/common';
import { PROCESSING_TAB_LABELS } from './production/processing/processingCommon';
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';
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

const TABS: ChromeTab<ProcessingCenterTab>[] = [
  { key: 'board', icon: <Columns3 size={14} /> },
  { key: 'handoff', icon: <Inbox size={14} /> },
  { key: 'qa', icon: <ListChecks size={14} /> },
  { key: 'capacity', icon: <Gauge size={14} /> }
];

export const ProcessingCenterWorkspace: React.FC<ProcessingCenterWorkspaceProps> = ({
  projectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard: _onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<ProcessingCenterTab>('board');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<ProcessingJobRecord | null>(null);
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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="px-1">
          <h2 className="text-base font-bold text-text-base tracking-wide">
            Processing Center
          </h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Central job operations: NAS GPU Worker (ENHANCE/MASK), external-PC handoff (STITCH/BLUR/REPORT/EXPORT job types), acceptance QA decisions and live capacity. Metadata in Supabase only.
          </p>
        </div>

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={TABS}
              active={activeTab}
              onChange={setActiveTab}
              tabLabel={(key) => translate(PROCESSING_TAB_LABELS[key])}
            />
          </div>

          <div key={activeTab} className="p-4 flex-1 flex flex-col min-h-0 overflow-y-auto animate-panel-enter">
            {/* Active tab panel */}
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
                datasets={datasets}
                api={api}
                projectSettings={projectSettings}
                isGuestUser={isGuestUser}
                onRefreshJobs={refreshJobs}
                onRefreshDatasets={refreshDatasets}
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