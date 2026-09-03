import type { ElementType } from 'react';
import {
  BarChart3,
  Cpu,
  Database,
  FileText,
  GitBranch,
  HardDrive,
  Workflow,
  LayoutDashboard,
  Route,
  Settings,
  Shield
} from 'lucide-react';
import type { WorkspaceKey } from './utils/hashRouter';
import type { AuthzCapability } from './lib/authz';

export type WorkspaceTag = 'live' | 'planned' | 'reserved';

export interface WorkspaceDefinition {
  key: WorkspaceKey;
  labelKey: string;
  descriptionKey: string;
  icon: ElementType;
  tag: WorkspaceTag;
  /**
   * Optional AuthZ capabilities that grant access to this workspace. A
   * user may open the workspace if they hold ANY of these capabilities.
   * Undefined (or empty) means "no special restriction" (viewAll applies).
   * Metadata only for P1.3 — enforcement is wired in P2; setting this has
   * no effect on current rendering, so the dashboard is visually untouched.
   */
  guard?: AuthzCapability[];
}

export const WORKSPACES: WorkspaceDefinition[] = [
  { key: 'dashboard', labelKey: 'dashboard', descriptionKey: 'workspaceDashboardDesc', icon: LayoutDashboard, tag: 'live' },
  { key: 'data', labelKey: 'data', descriptionKey: 'workspaceDataDesc', icon: Database, tag: 'live' },
  { key: 'settings', labelKey: 'settings', descriptionKey: 'workspaceSettingsDesc', icon: Settings, tag: 'live', guard: ['manageSettings'] },
  { key: 'production', labelKey: 'workspaceProduction', descriptionKey: 'workspaceProductionDesc', icon: Workflow, tag: 'live' },
  { key: 'storage', labelKey: 'workspaceStorage', descriptionKey: 'workspaceStorageDesc', icon: HardDrive, tag: 'live' },
  { key: 'processing', labelKey: 'workspaceProcessing', descriptionKey: 'workspaceProcessingDesc', icon: Cpu, tag: 'live' },
  { key: 'lineage', labelKey: 'workspaceLineage', descriptionKey: 'workspaceLineageDesc', icon: GitBranch, tag: 'live' },
  { key: 'analytics', labelKey: 'workspaceAnalytics', descriptionKey: 'workspaceAnalyticsDesc', icon: BarChart3, tag: 'live' },
  { key: 'reports', labelKey: 'workspaceReports', descriptionKey: 'workspaceReportsDesc', icon: FileText, tag: 'live' },
  { key: 'administration', labelKey: 'workspaceAdministration', descriptionKey: 'workspaceAdministrationDesc', icon: Shield, tag: 'live', guard: ['manageUsers', 'approveDeletions'] },
  { key: 'roadAnalysis', labelKey: 'workspaceRoadAnalysis', descriptionKey: 'workspaceRoadAnalysisDesc', icon: Route, tag: 'live' }
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

export interface WorkspaceCategory {
  key: string;
  labelKey: string;
  members: WorkspaceKey[];
}

/** Content grouping for the workspace navigation bar (separated by dashed dividers). */
export const WORKSPACE_CATEGORIES: WorkspaceCategory[] = [
  { key: 'core', labelKey: 'workspaceCategoryCore', members: ['dashboard', 'data'] },
  {
    key: 'production',
    labelKey: 'workspaceCategoryProduction',
    members: ['production', 'processing', 'lineage', 'storage']
  },
  {
    key: 'insights',
    labelKey: 'workspaceCategoryInsights',
    members: ['analytics', 'reports', 'roadAnalysis']
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
        {workspace.tag === 'planned' && (
          <p className="text-[11px] text-sky-400/80 font-medium">{translate('workspacePlannedRoadmap')}</p>
        )}
      </div>
    </div>
  );
}
