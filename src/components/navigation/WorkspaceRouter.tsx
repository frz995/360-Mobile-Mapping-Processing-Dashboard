import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { WorkspaceKey, WorkspacePathQuery } from '../../utils/urlRouter';
import { WorkspacePlaceholder, canAccessWorkspace, getWorkspaceDefinition, getWorkspaceGuards } from '../../workspaces';
import { ROLE_CAPABILITIES } from '../../lib/authz';
import { useCapabilities } from '../../hooks/usePermission';

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
  const { role, matrix, isGuest } = useCapabilities();

  // These pages are rendered directly in App.tsx — skip WorkspaceRouter
  if (currentPage === 'dashboard' || currentPage === 'settings' || currentPage === 'project' || currentPage === 'data') {
    return null;
  }

  // Defence in depth: the sidebar already locks guarded workspaces, but a
  // direct URL / deep link must not mount a workspace the role cannot use.
  if (
    !isGuest &&
    currentPage !== 'landing' &&
    currentPage !== 'signin' &&
    !canAccessWorkspace(currentPage, role, matrix)
  ) {
    const definition = getWorkspaceDefinition(currentPage);
    const required = getWorkspaceGuards(currentPage)
      .map((id) => ROLE_CAPABILITIES.find((c) => c.id === id)?.label || id)
      .join(' or ');
    return (
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto animate-panel-enter">
        <div className="bg-card border border-subtle rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2.5 bg-inner rounded-xl border border-subtle text-amber-400 shrink-0">
            <ShieldAlert size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-text-base tracking-wide">{t(definition.labelKey)}</h2>
            <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{t(definition.descriptionKey)}</p>
          </div>
        </div>
        <div className="bg-card border border-subtle rounded-xl p-8 flex-1 flex flex-col items-center justify-center text-center gap-3 min-h-0">
          <div className="p-3 bg-inner rounded-2xl border border-subtle text-text-muted">
            <ShieldAlert size={28} strokeWidth={1.5} />
          </div>
          <h3 className="text-sm font-semibold text-text-base">Restricted for your role</h3>
          <p className="text-xs text-text-muted max-w-md leading-relaxed">
            Your role <span className="font-semibold text-text-base">{role}</span> does not include
            {required ? <> <span className="font-mono text-[11px] text-text-base">{required}</span></> : ' this capability'}.
            Ask an administrator to grant it from Administration &rsaquo; Roles.
          </p>
          <button
            type="button"
            onClick={() => goToWorkspace('dashboard')}
            className="mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-inner hover:bg-slate-800 text-text-base border border-subtle transition-colors cursor-pointer"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (currentPage === 'storage') {
    return (
      <NASStorageWorkspace
        key="workspace-storage"
        projectSettings={projectSettings}
        setProjectSettings={setProjectSettings}
        addNotification={addNotification}
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
        translate={t}
        batchLogs={activeBatchLogs}
        dailyData={dailyData}
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
