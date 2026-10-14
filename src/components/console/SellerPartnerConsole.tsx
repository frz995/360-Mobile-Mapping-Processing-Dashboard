import React from 'react';
import { LogOut, LayoutDashboard, Building2, Users, Database, Settings as SettingsIcon, Plus, Shield } from 'lucide-react';
import { CONSOLE_PANELS, CONSOLE_NEW_KEY, getConsolePanelDefinition, parseConsolePanel, pushConsolePanel, replaceConsolePanel, subscribeConsolePanel, getConsoleOrgQuery, type ConsolePanel } from '../../utils/consoleRouter';
import { useConsoleDirectory } from './useConsoleDirectory';
import { PrimaryButton, SecondaryButton } from './panels/consoleUi';
import ConsoleDashboardPanel from './panels/ConsoleDashboardPanel';
import ConsoleCompaniesPanel from './panels/ConsoleCompaniesPanel';
import ConsoleMembersPanel from './panels/ConsoleMembersPanel';
import ConsoleDatabasePanel from './panels/ConsoleDatabasePanel';
import ConsoleSeatsPanel from './panels/ConsoleSeatsPanel';
import ConsoleSettingsPanel from './panels/ConsoleSettingsPanel';
import type { ConsoleAccess } from '../../services/consoleAccess';
import type { Organization } from '../../services/tenantContext';

interface SellerPartnerConsoleProps {
  onBackToApp: () => void;
  onSelectCompanyForPreview?: (org: Organization) => void;
  currentUserEmail?: string;
  onSignOut?: () => void;
  /**
   * The verified platform-admin answer, resolved by `App.tsx` before this
   * component mounts.
   *
   * Passed in rather than fetched here so the shell has no way to render while
   * the question is unanswered. The previous version derived `activeTab` from
   * React state and never read the address bar at all, so the five rail buttons
   * highlighted different icons while rendering one identical body.
   */
  access: ConsoleAccess;
}

/** Rail icons, kept beside the labels so a panel cannot be added without one. */
const PANEL_ICONS: Record<ConsolePanel, React.ReactNode> = {
  dashboard: <LayoutDashboard size={18} />,
  companies: <Building2 size={18} />,
  members: <Users size={18} />,
  database: <Database size={18} />,
  seats: <Users size={18} />,
  settings: <SettingsIcon size={18} />
};

/** Rail order. `database` and `seats` share an icon family; the labels differ. */
const RAIL_ORDER: ConsolePanel[] = ['dashboard', 'companies', 'members', 'database', 'seats', 'settings'];

export const SellerPartnerConsole: React.FC<SellerPartnerConsoleProps> = ({
  onBackToApp,
  currentUserEmail,
  onSignOut,
  access
}) => {
  const directory = useConsoleDirectory();

  /**
   * The whole console location, read as one object.
   *
   * Tracked as a single value rather than as a panel string because panel
   * identity alone is not enough to cause a re-render: pressing "Add Client
   * Company" while already on the Companies panel changes only the query
   * (`?new=1`), and a `setState` to the value it already holds bails out. The
   * button would silently do nothing on the one panel where it is most
   * obviously redundant to navigate first.
   */
  const readConsoleLocation = React.useCallback((): { panel: ConsolePanel; org: string } => {
    if (typeof window === 'undefined') return { panel: parseConsolePanel(), org: '' };
    return {
      panel: parseConsolePanel(),
      org: new URLSearchParams(window.location.search).get('org') || ''
    };
  }, []);

  const [location, setLocation] = React.useState(readConsoleLocation);
  const panel = location.panel;
  const selectedOrgId = location.org;

  const setSelectedOrgId = React.useCallback((orgId: string) => {
    setLocation((prev) => (prev.org === orgId ? prev : { ...prev, org: orgId }));
  }, []);

  // Back / forward, and any programmatic push. The address bar is the source of
  // truth; React state that can drift from it is what made the previous shell
  // untestable.
  React.useEffect(
    () => subscribeConsolePanel(() => setLocation(readConsoleLocation())),
    [readConsoleLocation]
  );

  // An address that does not name this panel exactly — `/console`, a stale
  // `/console/tenants` from an earlier release, a differently-cased segment —
  // is rewritten to the canonical path, so the URL never advertises a panel
  // that this build does not have. `parseConsolePanel` maps unknown segments to
  // `dashboard`, which would make a stale path indistinguishable from a valid
  // one and leave it sitting there forever.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const canonical = `/console/${panel}`;
    if (window.location.pathname.replace(/\/+$/, '') !== canonical) {
      const org = getConsoleOrgQuery();
      replaceConsolePanel(panel, org ? { org } : undefined);
    }
  }, [panel]);

  const go = React.useCallback((next: ConsolePanel, orgId?: string) => {
    const query = orgId ? { org: orgId } : undefined;
    pushConsolePanel(next, query);
    // The subscription fires synchronously from pushConsolePanel; reading the
    // location again here would just duplicate it.
  }, []);

  /**
   * Change the selected company.
   *
   * Replaces rather than pushes: picking a company is a refinement of the
   * current panel, not a new destination, so Back should return to the panel
   * the operator came from rather than walking through every company they
   * inspected. The id also goes in the URL, because otherwise a reload on
   * `/console/members` loses the selection and silently shows the empty
   * "select a company" state — which reads as the company having no staff.
   */
  const selectOrg = React.useCallback(
    (orgId: string) => {
      setSelectedOrgId(orgId);
      const current = getConsoleOrgQuery();
      if (current !== orgId) {
        replaceConsolePanel(panel, orgId ? { org: orgId } : undefined);
      }
    },
    [panel, setSelectedOrgId]
  );

  /**
   * Open the create-company form from anywhere in the console.
   *
   * The button lives in the top bar, so from most panels this is a navigation
   * plus an intent. `?new=1` rather than shared state, so Back still returns to
   * wherever the button was pressed from and the form is deep-linkable.
   */
  const startCreateCompany = React.useCallback(() => {
    pushConsolePanel('companies', { [CONSOLE_NEW_KEY]: '1' });
  }, []);

  /** Strip the create intent once the panel has consumed it. */
  const clearCreateIntent = React.useCallback(
    (open: boolean) => {
      if (!open) return;
      const params = new URLSearchParams(window.location.search);
      params.delete(CONSOLE_NEW_KEY);
      const org = getConsoleOrgQuery();
      if (org) params.set('org', org);
      const query = Array.from(params.entries()).reduce<Record<string, string>>((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {});
      replaceConsolePanel(panel, Object.keys(query).length > 0 ? query : undefined);
    },
    [panel]
  );

  const definition = getConsolePanelDefinition(panel);
  const { organizations, metrics, metric, directoryError } = directory;

  return (
    <div
      style={{ backgroundColor: '#f4f5f8', color: '#0f172a', colorScheme: 'light' }}
      className="console-canvas-bg h-screen w-screen max-w-full overflow-hidden flex font-sans antialiased"
    >
      {/* ---- Column 1: rail ------------------------------------------------ */}
      <aside
        style={{ backgroundColor: '#0c0d0e', color: '#ffffff', borderColor: '#17181c' }}
        className="console-rail-dark w-16 shrink-0 flex flex-col items-center justify-between py-5 border-r z-30 select-none h-screen"
      >
        <div className="flex flex-col items-center gap-5 w-full">
          <div className="flex items-center justify-center shrink-0 w-10 h-10 select-none" aria-label="GeoSphere 360">
            <img
              src="/branding/geosphere-arrow-icon-white.svg"
              alt="GeoSphere 360"
              className="w-7 h-7 object-contain select-none"
              draggable={false}
            />
          </div>

          <nav className="flex flex-col items-center gap-2.5 w-full" aria-label="Console Navigation">
            {RAIL_ORDER.map((key) => {
              const active = panel === key;
              const item = getConsolePanelDefinition(key);
              return (
                <a
                  key={key}
                  href={`/console/${key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(key, key === 'dashboard' ? undefined : selectedOrgId || undefined);
                  }}
                  aria-label={item.label}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 9999,
                    backgroundColor: active ? '#ffffff' : 'transparent',
                    color: active ? '#0c0d0e' : '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  className="transition-all cursor-pointer hover:bg-white/10 hover:text-white shrink-0"
                >
                  {PANEL_ICONS[key]}
                </a>
              );
            })}

            <button
              type="button"
              aria-label="Add Client Company"
              onClick={() => go('companies')}
              style={{
                width: 40,
                height: 40,
                borderRadius: 9999,
                backgroundColor: 'rgba(255,255,255,0.08)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.15)'
              }}
              className="flex items-center justify-center hover:bg-white/20 transition-all cursor-pointer mt-1 shrink-0"
              title="Add Client Company"
            >
              <Plus size={18} />
            </button>
          </nav>
        </div>

        <div className="flex flex-col items-center gap-2.5 w-full">
          {onSignOut ? (
            <button
              type="button"
              aria-label="Sign Out"
              onClick={onSignOut}
              style={{ width: 40, height: 40, borderRadius: 9999, color: '#94a3b8' }}
              className="flex items-center justify-center hover:text-rose-400 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>
          ) : null}
        </div>
      </aside>

      {/* ---- Column 2: profile --------------------------------------------- */}
      <aside
        style={{ backgroundColor: '#ffffff', color: '#0f172a', borderColor: '#edf0f4' }}
        className="console-sidebar-profile w-72 shrink-0 border-r flex flex-col justify-between p-6 select-none h-screen overflow-y-auto"
      >
        <div className="space-y-6">
          <div className="text-center pt-2">
            <div className="relative inline-flex items-center justify-center mx-auto" style={{ width: 64, height: 64 }}>
              <div
                style={{ width: 64, height: 64, borderRadius: 9999, backgroundColor: '#0c0d0e', color: '#ffffff', border: '3px solid #f1f5f9' }}
                className="flex items-center justify-center text-xl font-black shadow-sm shrink-0"
              >
                {(currentUserEmail || 'SA').charAt(0).toUpperCase()}
              </div>
            </div>
            <h2 className="text-base font-black text-slate-900 tracking-tight mt-3">
              {currentUserEmail ? currentUserEmail.split('@')[0] : 'Administrator'}
            </h2>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
              Platform Administrator
            </div>
            <div className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-emerald-600">
              <span style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: '#10b981' }} className="shrink-0" />
              <span>{access.verified ? 'Access confirmed by the database' : 'Access unverified'}</span>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-100 text-xs">
            <div>
              <div className="text-[10px] text-slate-400 font-medium">Signed in as</div>
              <div className="font-semibold text-slate-900 truncate mt-0.5">{currentUserEmail || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400 font-medium">Console address</div>
              <div className="font-semibold text-slate-900 truncate mt-0.5 font-mono text-[11px]">
                {typeof window === 'undefined' ? '/console' : `${window.location.origin}/console`}
              </div>
            </div>
          </div>

          {/* Allocation figures only. The previous sidebar also printed
              `Row-Level Security 100% Active`, `Gateway SLA 99.98%`,
              `Edge Ingestion Cloud + NAS` and an `RLS Isolation Verified`
              badge as fixed text that no code path could contradict. Those
              claims are either proven by 0011_security_tests.sql or not made. */}
          <div className="space-y-3 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-900 tracking-tight">Allocation</span>
              <span className="text-[11px] font-bold text-slate-400">
                {directoryError ? 'UNVERIFIED' : 'LIVE'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-slate-400 font-medium">Companies</div>
                <div className="text-lg font-black text-slate-900 font-mono">{metric(metrics.activeCount)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-medium">Licensed seats</div>
                <div className="text-lg font-black text-slate-900 font-mono">{metric(metrics.totalSeats)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-medium">Storage GB</div>
                <div className="text-lg font-black text-slate-900 font-mono">{metric(metrics.totalQuota)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-medium">Dedicated</div>
                <div className="text-lg font-black text-slate-900 font-mono">{metric(metrics.dedicatedCount)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <Shield size={16} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-bold text-slate-900 leading-tight">Tenant boundary enforced in Postgres</span>
              <span className="text-[10px] text-slate-400">Asserted by 0011_security_tests.sql</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ---- Column 3: main ------------------------------------------------ */}
      <div
        style={{ backgroundColor: '#f4f5f8', color: '#0f172a' }}
        className="console-canvas-bg flex-1 flex flex-col min-w-0 h-screen overflow-y-auto"
      >
        <header
          style={{ backgroundColor: '#ffffff', borderColor: '#edf0f4', color: '#0f172a' }}
          className="console-top-bar border-b px-8 py-4 flex items-center justify-between sticky top-0 z-20 shadow-xs shrink-0 gap-4"
        >
          <div className="flex flex-col min-w-0">
            <h1 className="text-xl font-black text-slate-900 tracking-tight leading-tight">
              {definition.label}
            </h1>
            <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">{definition.description}</p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void directory.reload()}
              disabled={directory.isLoading}
              style={{ borderRadius: 12, backgroundColor: '#ffffff', color: '#334155' }}
              className="px-3.5 py-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              title="Re-read the organization directory"
            >
              Refresh
            </button>
            {/* The single "Add Client Company" affordance for the whole console.
                Panels must not add their own: two buttons with one label and
                different behaviour is how the wrong one gets clicked. */}
            <PrimaryButton onClick={startCreateCompany} icon={<Plus size={14} />}>
              Add Client Company
            </PrimaryButton>
            <SecondaryButton onClick={onBackToApp} icon={<Shield size={13} />}>
              Client App
            </SecondaryButton>
          </div>
        </header>

        <main className="flex-1 p-8 max-w-7xl w-full mx-auto">
          {panel === 'dashboard' ? (
            <ConsoleDashboardPanel
              directory={directory}
              onOpenCompanies={() => go('companies')}
              onOpenMembers={() => go('members', selectedOrgId || organizations[0]?.id)}
            />
          ) : null}

          {panel === 'companies' ? (
            <ConsoleCompaniesPanel
              directory={directory}
              selectedOrgId={selectedOrgId}
              onSelectOrg={selectOrg}
              onOpenMembers={(orgId) => go('members', orgId)}
              onBackToApp={onBackToApp}
              onCreateIntentHandled={clearCreateIntent}
            />
          ) : null}

          {panel === 'members' ? (
            <ConsoleMembersPanel directory={directory} selectedOrgId={selectedOrgId} onSelectOrg={selectOrg} />
          ) : null}

          {panel === 'database' ? (
            <ConsoleDatabasePanel directory={directory} selectedOrgId={selectedOrgId} onSelectOrg={selectOrg} />
          ) : null}

          {panel === 'seats' ? (
            <ConsoleSeatsPanel directory={directory} selectedOrgId={selectedOrgId} onSelectOrg={selectOrg} />
          ) : null}

          {panel === 'settings' ? (
            <ConsoleSettingsPanel
              access={access}
              currentUserEmail={currentUserEmail}
              organizationIds={access.organizationIds}
              onBackToApp={onBackToApp}
              onSignOut={onSignOut}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
};

export { CONSOLE_PANELS };
export default SellerPartnerConsole;