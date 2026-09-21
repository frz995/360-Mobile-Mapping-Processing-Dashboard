import React from 'react';
import type { WorkspaceKey } from '../../utils/urlRouter';
import { WorkspacePlaceholder, getWorkspaceDefinition } from '../../workspaces';

const ImageProductionWorkspace = React.lazy(() => import('../ImageProductionWorkspace').then(m => ({ default: m.ImageProductionWorkspace })));
const NASStorageWorkspace = React.lazy(() => import('../NASStorageWorkspace').then(m => ({ default: m.NASStorageWorkspace })));
const ProcessingCenterWorkspace = React.lazy(() => import('../ProcessingCenterWorkspace').then(m => ({ default: m.ProcessingCenterWorkspace })));
const LineageWorkspace = React.lazy(() => import('../LineageWorkspace').then(m => ({ default: m.LineageWorkspace })));
const AnalyticsWorkspace = React.lazy(() => import('../AnalyticsWorkspace').then(m => ({ default: m.AnalyticsWorkspace })));
const ReportsWorkspace = React.lazy(() => import('../ReportsWorkspace').then(m => ({ default: m.ReportsWorkspace })));
const AdministrationWorkspace = React.lazy(() => import('../AdministrationWorkspace').then(m => ({ default: m.AdministrationWorkspace })));
const RoadAnalysisWorkspace = React.lazy(() => import('../RoadAnalysisWorkspace'));

export interface WorkspaceRouterProps {
  currentPage: WorkspaceKey;
  projectSettings: any;
  setProjectSettings: (s: any) => void;
  authSession: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  goToWorkspace: (ws: WorkspaceKey) => void;
  translate: (k: string) => string;
  storageFocusPath: string | null;
  openStorageAtPath: (p: string) => void;
  activeBatchLogs: any[];
  dailyData: any[];
  handleRefreshMap: () => void;
  auditLogs: any[];
  allKnownDefects: any[];
}

export const WorkspaceRouter = ({
  currentPage,
  projectSettings,
  setProjectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  goToWorkspace,
  translate: t,
  storageFocusPath,
  openStorageAtPath,
  activeBatchLogs,
  dailyData,
  handleRefreshMap,
  auditLogs,
  allKnownDefects
}: WorkspaceRouterProps) => {
  // These pages are rendered directly in App.tsx — skip WorkspaceRouter
  if (currentPage === 'dashboard' || currentPage === 'settings' || currentPage === 'project' || currentPage === 'data') {
    return null;
  }

  if (currentPage === 'production') {
    return (
      <ImageProductionWorkspace
        key="workspace-production"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        translate={t}
      />
    );
  }

  if (currentPage === 'storage') {
    return (
      <NASStorageWorkspace
        key="workspace-storage"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        translate={t}
        initialFocusPath={storageFocusPath ?? undefined}
      />
    );
  }

  if (currentPage === 'processing') {
    return (
      <ProcessingCenterWorkspace
        key="workspace-processing"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        translate={t}
        onOpenStoragePath={openStorageAtPath}
      />
    );
  }

  if (currentPage === 'lineage') {
    return (
      <LineageWorkspace
        key="workspace-lineage"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        translate={t}
      />
    );
  }

  if (currentPage === 'analytics') {
    return (
      <AnalyticsWorkspace
        key="workspace-analytics"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        translate={t}
        batchLogs={activeBatchLogs}
        dailyData={dailyData}
        onRefreshData={handleRefreshMap}
      />
    );
  }

  if (currentPage === 'reports') {
    return (
      <ReportsWorkspace
        key="workspace-reports"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        translate={t}
        batchLogs={activeBatchLogs}
        dailyData={dailyData}
        onRefreshData={handleRefreshMap}
      />
    );
  }

  if (currentPage === 'administration') {
    return (
      <AdministrationWorkspace
        key="workspace-administration"
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        translate={t}
        auditLogs={auditLogs}
        onRefreshData={handleRefreshMap}
      />
    );
  }

  if (currentPage === 'roadAnalysis') {
    return (
      <RoadAnalysisWorkspace
        key="workspace-road-analysis"
        projectSettings={projectSettings}
        batchLogs={activeBatchLogs}
        dailyData={dailyData}
        defectsList={allKnownDefects}
        onRefreshData={handleRefreshMap}
        translate={t}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
      />
    );
  }

  return (
    <div key={`workspace-${currentPage}`} className="flex flex-col md:flex-1 md:min-h-0 md:overflow-hidden animate-panel-enter">
      <WorkspacePlaceholder workspace={getWorkspaceDefinition(currentPage)} translate={t} />
    </div>
  );
};
