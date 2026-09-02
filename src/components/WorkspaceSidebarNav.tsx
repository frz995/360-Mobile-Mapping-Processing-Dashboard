import { ChevronRight, Info, RefreshCw } from 'lucide-react';
import { WORKSPACES, WORKSPACE_CATEGORIES, type WorkspaceDefinition } from '../workspaces';
import type { WorkspaceKey } from '../utils/hashRouter';

interface WorkspaceSidebarNavProps {
  translate: (key: string) => string;
  activeWorkspace: WorkspaceKey;
  isSidebarExpanded: boolean;
  tourStep: number | null;
  onNavigate: (key: WorkspaceKey) => void;
  onRefresh: () => void;
  onOpenAbout: () => void;
  onToggleSidebar: () => void;
}

function activeButtonClass(active: boolean, isExpanded: boolean): string {
  return `transition-all duration-300 relative cursor-pointer flex items-center rounded-xl ${isExpanded ? 'w-full px-3 py-2 text-xs font-semibold gap-3 justify-start' : 'w-full h-10 justify-center p-0'} ${active ? 'text-sky-400 font-bold' : 'text-text-muted hover:text-text-base'}`;
}

function actionButtonClass(isExpanded: boolean): string {
  return `transition-all duration-200 cursor-pointer flex items-center rounded-xl text-text-muted hover:text-text-base ${isExpanded ? 'w-full px-3 py-2 text-xs font-semibold gap-3 justify-start' : 'w-full h-10 justify-center p-0'}`;
}

function labelClass(isExpanded: boolean): string {
  return `transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] whitespace-nowrap overflow-hidden origin-left flex items-center justify-between flex-1 ${isExpanded ? 'opacity-100 max-w-[140px] translate-x-0' : 'opacity-0 max-w-0 -translate-x-3 pointer-events-none'}`;
}

function pureLabelClass(isExpanded: boolean): string {
  return `transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] whitespace-nowrap overflow-hidden origin-left ${isExpanded ? 'opacity-100 max-w-[140px] translate-x-0' : 'opacity-0 max-w-0 -translate-x-3 pointer-events-none'}`;
}

function NavItem({
  definition,
  active,
  isSidebarExpanded,
  tourActive,
  onNavigate,
  translate
}: {
  definition: WorkspaceDefinition;
  active: boolean;
  isSidebarExpanded: boolean;
  tourActive: boolean;
  onNavigate: (key: WorkspaceKey) => void;
  translate: (key: string) => string;
}) {
  const Icon = definition.icon;
  return (
    <button
      onClick={() => onNavigate(definition.key)}
      className={`${activeButtonClass(active, isSidebarExpanded)} ${tourActive ? 'ring-2 ring-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.25)] z-30 bg-inner' : ''}`}
      title={translate(definition.labelKey)}
      aria-label={translate(definition.labelKey)}
      aria-current={active ? 'page' : undefined}
    >
      <div className="relative shrink-0 flex items-center justify-center">
        <Icon size={20} className="shrink-0 transition-transform duration-200" />
        {!isSidebarExpanded && (
          <span
            className={`absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)] transition-all duration-300 ease-out ${active ? 'opacity-100 scale-100' : 'opacity-0 scale-0'}`}
          />
        )}
      </div>
      <span className={labelClass(isSidebarExpanded)}>
        <span className="truncate">{translate(definition.labelKey)}</span>
        {definition.tag !== 'live' && (
          <span
            className={`w-1.5 h-1.5 rounded-full ml-2 shrink-0 ${definition.tag === 'planned' ? 'bg-amber-400' : 'bg-inner'}`}
          />
        )}
        {active && (
          <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.9)] animate-pulse ml-2 shrink-0" />
        )}
      </span>
    </button>
  );
}

export function WorkspaceSidebarNav({
  translate,
  activeWorkspace,
  isSidebarExpanded,
  tourStep,
  onNavigate,
  onRefresh,
  onOpenAbout,
  onToggleSidebar
}: WorkspaceSidebarNavProps) {
  const navContainerClass = `transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden ${tourStep === 6 ? 'ring-2 ring-slate-400 shadow-[0_0_35px_rgba(255,255,255,0.15)] z-30 relative' : tourStep !== null && tourStep < 7 ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''} ${isSidebarExpanded ? 'w-52 px-2.5 items-stretch' : 'w-14 items-center px-0'}`;

  const divider = (
    <div className="w-full border-t border-dashed border-subtle shrink-0 my-1" />
  );

  const workspaceDefByKey = new Map<string, WorkspaceDefinition>(WORKSPACES.map((w) => [w.key, w]));
  const settingsDef = WORKSPACES.find((w) => w.key === 'settings')!;

  return (
    <nav aria-label="Workspace navigation" className={`bg-card border-r border-subtle flex flex-col py-3 gap-2 shrink-0 ${navContainerClass}`}>
      {WORKSPACE_CATEGORIES.map((category, catIndex) => (
        <div key={category.key} className="flex flex-col gap-0.5">
          {isSidebarExpanded && (
            <div className="px-3 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted/70">
              {translate(category.labelKey)}
            </div>
          )}
          {category.members.map((key) => {
            const w = workspaceDefByKey.get(key);
            if (!w) return null;
            return (
              <NavItem
                key={w.key}
                definition={w}
                active={activeWorkspace === w.key}
                isSidebarExpanded={isSidebarExpanded}
                tourActive={tourStep === 7 ? w.key === 'dashboard' : tourStep === 8 ? w.key === 'data' : false}
                onNavigate={onNavigate}
                translate={translate}
              />
            );
          })}
          {catIndex < WORKSPACE_CATEGORIES.length - 1 && divider}
        </div>
      ))}

      {divider}

      <button
        onClick={onRefresh}
        className={`${actionButtonClass(isSidebarExpanded)} ${tourStep === 9 ? 'ring-2 ring-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.25)] z-30 bg-inner' : ''}`}
        title={translate('refresh')}
        aria-label={translate('refresh')}
      >
        <div className="relative shrink-0 flex items-center justify-center">
          <RefreshCw size={20} className="shrink-0 transition-transform duration-300 active:rotate-180" />
        </div>
        <span className={pureLabelClass(isSidebarExpanded)}>
          {translate('refresh')}
        </span>
      </button>

      <NavItem
        definition={settingsDef}
        active={activeWorkspace === 'settings'}
        isSidebarExpanded={isSidebarExpanded}
        tourActive={tourStep === 10}
        onNavigate={onNavigate}
        translate={translate}
      />

      <button
        onClick={onOpenAbout}
        className={`${actionButtonClass(isSidebarExpanded)} ${tourStep === 11 ? 'ring-2 ring-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.25)] z-30 bg-inner' : ''}`}
        title={translate('about')}
        aria-label={translate('about')}
      >
        <div className="relative shrink-0 flex items-center justify-center">
          <Info size={20} className="shrink-0 transition-transform duration-200 hover:scale-110" />
        </div>
        <span className={pureLabelClass(isSidebarExpanded)}>
          {translate('about')}
        </span>
      </button>

      <div className="mt-auto" />
      {divider}

      <button
        onClick={onToggleSidebar}
        className={`rounded-xl text-text-muted hover:text-text-base hover:bg-inner transition-all duration-300 cursor-pointer flex items-center overflow-hidden ${tourStep === 12 ? 'ring-2 ring-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.25)] z-30 bg-inner' : ''} ${isSidebarExpanded ? 'justify-between w-full px-3 py-2 bg-inner border border-subtle shadow-sm' : 'justify-center w-10 h-10'}`}
        title={isSidebarExpanded ? 'Collapse Navigation Panel' : 'Expand Navigation Panel'}
        aria-label={isSidebarExpanded ? 'Collapse navigation panel' : 'Expand navigation panel'}
        aria-expanded={isSidebarExpanded}
      >
        <span className={`transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] text-[10px] font-bold text-text-base uppercase tracking-wider whitespace-nowrap overflow-hidden origin-left ${isSidebarExpanded ? 'opacity-100 max-w-[120px] translate-x-0' : 'opacity-0 max-w-0 -translate-x-3 pointer-events-none'}`}>
          {translate('collapsePanel')}
        </span>
        <div className="p-1 rounded-md bg-inner text-sky-400 shrink-0 shadow-sm border border-subtle">
          <ChevronRight size={15} className={`transition-transform duration-300 ease-in-out ${isSidebarExpanded ? 'rotate-180' : 'rotate-0'}`} />
        </div>
      </button>
    </nav>
  );
}
