import type { ElementType } from 'react';
import {
  Activity,
  BarChart3,
  Cpu,
  Database,
  FileText,
  FolderPlus,
  GitBranch,
  HardDrive,
  Workflow,
  LayoutDashboard,
  Route,
  Settings,
  Shield
} from 'lucide-react';
import type { WorkspaceKey } from './utils/urlRouter';
import { canAny, type AuthzCapability, type RolePermissionsMatrix } from './lib/authz';

export type WorkspaceTag = 'live' | 'planned' | 'reserved';

export interface WorkspaceDefinition {
  key: WorkspaceKey;
  labelKey: string;
  descriptionKey: string;
  icon: ElementType;
  tag: WorkspaceTag;
  /**
   * AuthZ capabilities that grant access to this workspace (any-of semantics).
   * Undefined or empty means "no special restriction" — `viewAll` applies, so
   * every authenticated role can open it. Enforced by WorkspaceSidebarNav
   * (disabled item) and WorkspaceRouter (denied placeholder).
   */
  guard?: AuthzCapability[];
}

export const WORKSPACES: WorkspaceDefinition[] = [
  { key: 'project', labelKey: 'workspaceProject', descriptionKey: 'workspaceProjectDesc', icon: FolderPlus, tag: 'live', guard: ['manageProjects'] },
  { key: 'dashboard', labelKey: 'dashboard', descriptionKey: 'workspaceDashboardDesc', icon: LayoutDashboard, tag: 'live' },
  { key: 'data', labelKey: 'data', descriptionKey: 'workspaceDataDesc', icon: Database, tag: 'live', guard: ['importDatasets'] },
  { key: 'settings', labelKey: 'settings', descriptionKey: 'workspaceSettingsDesc', icon: Settings, tag: 'live', guard: ['manageSettings'] },
  { key: 'production', labelKey: 'workspaceProduction', descriptionKey: 'workspaceProductionDesc', icon: Workflow, tag: 'live', guard: ['runIntake'] },
  { key: 'pcmon', labelKey: 'workspacePcMon', descriptionKey: 'workspacePcMonDesc', icon: Activity, tag: 'live', guard: ['operateStations'] },
  { key: 'storage', labelKey: 'workspaceStorage', descriptionKey: 'workspaceStorageDesc', icon: HardDrive, tag: 'live', guard: ['manageStorage'] },
  // `processing` and `lineage` are consolidated into ProductionHubWorkspace
  // (see WorkspaceRouter) but remain routable URLs, so they carry its guard.
  { key: 'processing', labelKey: 'workspaceProcessing', descriptionKey: 'workspaceProcessingDesc', icon: Cpu, tag: 'live', guard: ['runIntake'] },
  { key: 'lineage', labelKey: 'workspaceLineage', descriptionKey: 'workspaceLineageDesc', icon: GitBranch, tag: 'live', guard: ['runIntake'] },
  { key: 'analytics', labelKey: 'workspaceAnalytics', descriptionKey: 'workspaceAnalyticsDesc', icon: BarChart3, tag: 'live' },
  { key: 'roadAnalysis', labelKey: 'workspaceRoadAnalysis', descriptionKey: 'workspaceRoadAnalysisDesc', icon: Route, tag: 'live' },
  { key: 'reports', labelKey: 'workspaceReports', descriptionKey: 'workspaceReportsDesc', icon: FileText, tag: 'live' },
  { key: 'administration', labelKey: 'workspaceAdministration', descriptionKey: 'workspaceAdministrationDesc', icon: Shield, tag: 'live', guard: ['manageUsers'] }
];

export function getWorkspaceDefinition(key: WorkspaceKey): WorkspaceDefinition {
  return WORKSPACES.find((w) => w.key === key) || WORKSPACES[0];
}

/**
 * AuthZ capabilities that grant access to a workspace (any-of semantics).
 * Returns an empty array when no explicit guard is defined (no restriction).
 */
export function getWorkspaceGuards(key: WorkspaceKey): AuthzCapability[] {
  return getWorkspaceDefinition(key).guard || [];
}

/** True when the role may open the workspace (unguarded workspaces always pass). */
export function canAccessWorkspace(
  key: WorkspaceKey,
  role: string | null | undefined,
  matrix?: RolePermissionsMatrix | null
): boolean {
  return canAny(role, getWorkspaceGuards(key), matrix);
}

export interface WorkspaceCategory {
  key: string;
  labelKey: string;
  members: WorkspaceKey[];
}

/** Content grouping for the workspace navigation bar (separated by dashed dividers). */
export const WORKSPACE_CATEGORIES: WorkspaceCategory[] = [
  {
    key: 'projects',
    labelKey: 'workspaceCategoryProjects',
    members: ['project']
  },
  {
    key: 'webgis',
    labelKey: 'workspaceCategoryWebGIS',
    members: ['dashboard', 'data', 'roadAnalysis', 'analytics', 'reports']
  },
  {
    key: 'production',
    labelKey: 'workspaceCategoryProduction',
    members: ['production', 'pcmon', 'storage']
  },
  {
    key: 'governance',
    labelKey: 'workspaceCategoryGovernance',
    members: ['administration']
  }
];

interface WorkspacePlaceholderProps {
  workspace: WorkspaceDefinition;
  translate: (key: string) => string;
}

export function WorkspacePlaceholder({ workspace, translate }: WorkspacePlaceholderProps) {
  const Icon = workspace.icon;

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto animate-panel-enter">
      <div className="bg-card border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl p-4 flex items-center gap-3 shadow-sm">
        <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400 shrink-0">
          <Icon size={22} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-text-base tracking-wide">{translate(workspace.labelKey)}</h2>
          <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{translate(workspace.descriptionKey)}</p>
        </div>
      </div>
      <div className="bg-card border border-subtle rounded-xl p-8 flex-1 flex flex-col items-center justify-center text-center gap-3 min-h-0">
        <div className="p-3 bg-inner rounded-2xl border border-subtle text-text-muted">
          <Icon size={28} strokeWidth={1.5} />
        </div>
        <h3 className="text-sm font-semibold text-text-base">{translate('workspaceComingSoon')}</h3>
        <p className="text-xs text-text-muted max-w-md leading-relaxed">{translate('workspaceComingSoonDesc')}</p>
      </div>
    </div>
  );
}
