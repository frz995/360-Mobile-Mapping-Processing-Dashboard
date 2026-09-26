import React from 'react';
import type { WorkspaceKey, WorkspacePathQuery } from '../../utils/urlRouter';
import { WorkspacePlaceholder, getWorkspaceDefinition } from '../../workspaces';

const ProductionHubWorkspace = React.lazy(() => import('../production/hub/ProductionHubWorkspace').then(m => ({ default: m.ProductionHubWorkspace })));
const NASStorageWorkspace = React.lazy(() => import('../NASStorageWorkspace').then(m => ({ default: m.NASStorageWorkspace })));
const PcMonitoringStation = React.lazy(() => import('../production/hub/PcMonitoringStation').then(m => ({ default: m.PcMonitoringStation })));
// processing and lineage consolidated into ProductionHubWorkspace
// lineage consolidated into ProductionHubWorkspace
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
  goToWorkspace: (ws: WorkspaceKey, query?: WorkspacePathQuery) => void;
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
  openStorageAtPath: _openStorageAtPath,
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
        onOpenProductionHub={(_path, subgrid) => goToWorkspace('production', subgrid ? { subgrid } : undefined)}
        translate={t}
        initialFocusPath={storageFocusPath ?? undefined}
      />
    );
  }

  if (currentPage === 'production' || currentPage === 'processing' || currentPage === 'lineage') {
    return (
      <ProductionHubWorkspace
        key="workspace-production"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        authSession={authSession}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        onBackToDashboard={() => goToWorkspace('dashboard')}
        onOpenDataManagement={(subgrid) => goToWorkspace('data', subgrid ? { subgrid } : undefined)}
        onOpenStorage={() => goToWorkspace('storage')}
        translate={t}
      />
    );
  }

  if (currentPage === 'pcmon') {
    const userLabel = isGuestUser
      ? 'Guest'
      : authSession?.user?.email || authSession?.user?.user_metadata?.full_name || 'Operator';
    return (
      <PcMonitoringStation
        key="workspace-pcmon"
        projectSettings={projectSettings}
        isGuestUser={isGuestUser}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
        userLabel={userLabel}
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
        setProjectSettings={setProjectSettings}
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
