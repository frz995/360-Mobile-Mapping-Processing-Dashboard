import { useEffect } from 'react';
import { ChevronRight, Info, RefreshCw, X } from 'lucide-react';
import { WORKSPACES, WORKSPACE_CATEGORIES, type WorkspaceDefinition } from '../workspaces';
import type { WorkspaceKey } from '../utils/urlRouter';

interface WorkspaceSidebarNavProps {
  translate: (key: string) => string;
  activeWorkspace: WorkspaceKey;
  isSidebarExpanded: boolean;
  tourStep: number | null;
  onNavigate: (key: WorkspaceKey) => void;
  onRefresh: () => void;
  onOpenAbout: () => void;
  onToggleSidebar: () => void;
  approvalBadgeCount?: number;
  mobileNavOpen?: boolean;
  onCloseMobileNav?: () => void;
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
  translate,
  badge
}: {
  definition: WorkspaceDefinition;
  active: boolean;
  isSidebarExpanded: boolean;
  tourActive: boolean;
  onNavigate: (key: WorkspaceKey) => void;
  translate: (key: string) => string;
  badge?: number;
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
        {badge != null && badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center border border-black/30 shadow-[0_2px_6px_rgba(0,0,0,0.45)]">
            {badge > 99 ? '99+' : badge}
          </span>
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
  onToggleSidebar,
  approvalBadgeCount,
  mobileNavOpen = false,
  onCloseMobileNav = () => {}
}: WorkspaceSidebarNavProps) {
  const navContainerClass = `transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden ${tourStep === 6 ? 'ring-2 ring-slate-400 shadow-[0_0_35px_rgba(255,255,255,0.15)] z-30 relative' : tourStep !== null && tourStep < 7 ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''} ${isSidebarExpanded ? 'w-52 px-2.5 items-stretch' : 'w-14 items-center px-0'}`;

  const divider = (
    <div className="w-full border-t border-dashed border-subtle shrink-0 my-1" />
  );

  const workspaceDefByKey = new Map<string, WorkspaceDefinition>(WORKSPACES.map((w) => [w.key, w]));
  const settingsDef = WORKSPACES.find((w) => w.key === 'settings')!;

  // Close the mobile drawer via Escape.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseMobileNav();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen, onCloseMobileNav]);

  // Shared nav list rendered in both the desktop rail and the mobile drawer.
  const renderNavContent = (isExpanded: boolean, onNavigateItem: (key: WorkspaceKey) => void) => (
    <>
      {WORKSPACE_CATEGORIES.map((category, catIndex) => (
        <div key={category.key} className="flex flex-col gap-0.5">
          {isExpanded && (
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
                isSidebarExpanded={isExpanded}
                tourActive={tourStep === 7 ? w.key === 'dashboard' : tourStep === 8 ? w.key === 'data' : false}
                onNavigate={onNavigateItem}
                translate={translate}
                badge={w.key === 'administration' ? approvalBadgeCount : undefined}
              />
            );
          })}
          {catIndex < WORKSPACE_CATEGORIES.length - 1 && divider}
        </div>
      ))}

      {divider}

      <button
        onClick={onRefresh}
        className={`${actionButtonClass(isExpanded)} ${tourStep === 9 ? 'ring-2 ring-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.25)] z-30 bg-inner' : ''}`}
        title={translate('refresh')}
        aria-label={translate('refresh')}
      >
        <div className="relative shrink-0 flex items-center justify-center">
          <RefreshCw size={20} className="shrink-0 transition-transform duration-300 active:rotate-180" />
        </div>
        <span className={pureLabelClass(isExpanded)}>
          {translate('refresh')}
        </span>
      </button>

      <NavItem
        definition={settingsDef}
        active={activeWorkspace === 'settings'}
        isSidebarExpanded={isExpanded}
        tourActive={tourStep === 10}
        onNavigate={onNavigateItem}
        translate={translate}
      />

      <button
        onClick={onOpenAbout}
        className={`${actionButtonClass(isExpanded)} ${tourStep === 11 ? 'ring-2 ring-slate-300 shadow-[0_0_20px_rgba(255,255,255,0.25)] z-30 bg-inner' : ''}`}
        title={translate('about')}
        aria-label={translate('about')}
      >
        <div className="relative shrink-0 flex items-center justify-center">
          <Info size={20} className="shrink-0 transition-transform duration-200 hover:scale-110" />
        </div>
        <span className={pureLabelClass(isExpanded)}>
          {translate('about')}
        </span>
      </button>
    </>
  );

  return (
    <>
      {/* MOBILE OFF-CANVAS NAV DRAWER (< md). Rendered only while open so it
          never duplicates the desktop rail's labelled controls. */}
      {mobileNavOpen && (
        <>
          <div
            aria-hidden="true"
            onClick={onCloseMobileNav}
            className="fixed inset-0 z-[45] bg-black/50 backdrop-blur-sm animate-fade-in"
          />
          <nav
            aria-label="Workspace navigation (mobile)"
            className="fixed top-0 bottom-0 left-0 z-50 w-64 max-w-[84vw] bg-card border-r border-subtle flex flex-col shadow-2xl drawer-slide-in-left"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 shrink-0 border-b border-subtle bg-inner/40">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted/70 truncate">
                {translate('collapsePanel')}
              </span>
              <button
                onClick={onCloseMobileNav}
                aria-label="Close navigation menu"
                className="p-1.5 rounded-lg text-text-muted hover:text-text-base hover:bg-inner transition-colors cursor-pointer shrink-0"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col gap-2 px-2.5 py-3 overflow-y-auto">
              {renderNavContent(true, (key) => {
                onNavigate(key);
                onCloseMobileNav();
              })}
            </div>
          </nav>
        </>
      )}

      {/* DESKTOP EXPANDABLE RAIL (md+) */}
      <nav aria-label="Workspace navigation" className={`hidden md:flex bg-card border-r border-subtle flex-col py-3 gap-2 shrink-0 ${navContainerClass}`}>
        {renderNavContent(isSidebarExpanded, onNavigate)}

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
    </>
  );
}