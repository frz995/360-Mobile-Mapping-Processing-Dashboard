/**
 * Sub-routing for the Seller Partner Console.
 *
 * WHY THIS IS NOT IN `urlRouter.ts`
 *   `WorkspaceKey` drives the workspace sidebar: every entry in `WORKSPACES`
 *   renders a navigation item. Adding `console-companies`, `console-members`
 *   and the rest there would put six fake workspaces in the operator's sidebar
 *   and six entries in `getWorkspaceGuards`. The console is a standalone page
 *   with its own rail (`WorkspaceRouter.tsx:58` returns `null` for it), so it
 *   needs its own namespace rather than six borrowed ones.
 *
 * WHAT THIS FIXES
 *   The console's five rail buttons set `activeTab` state and rendered the
 *   identical body for all of them — `activeTab` was read at `SellerPartnerConsole.tsx`
 *   lines 293/311/329/347/389 and nothing else, each read picking a highlight
 *   colour. So there was no addressable panel, no Back button, no deep link and
 *   no refresh-in-place. A nav that highlights and does nothing is worse than
 *   no nav, because it reports a capability that is not there.
 *
 * SHAPE
 *   /console                 -> dashboard
 *   /console/companies       -> companies
 *   /console/members         -> members
 *   /console/database        -> database
 *   /console/seats           -> seats
 *   /console/settings        -> settings
 *
 *   An unknown or absent panel falls back to `dashboard` and is REPLACED in the
 *   address bar, so a stale `/console/tenants` left over from an earlier build
 *   does not sit in the URL claiming a panel that no longer exists.
 */

export type ConsolePanel = 'dashboard' | 'companies' | 'members' | 'database' | 'seats' | 'settings';

export interface ConsolePanelDefinition {
  key: ConsolePanel;
  /** Rail button label. */
  label: string;
  /** One line describing what the panel is for, shown as its heading subtitle. */
  description: string;
}

export const CONSOLE_PANELS: ConsolePanelDefinition[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Portfolio totals across every company on this installation.'
  },
  {
    key: 'companies',
    label: 'Companies',
    description: 'Provision, edit and route every client company.'
  },
  {
    key: 'members',
    label: 'Team Members',
    description: 'Invite staff, set their company role, and suspend access.'
  },
  {
    key: 'database',
    label: 'Database Hub',
    description: 'Where each company is routed: shared cloud or a dedicated instance.'
  },
  {
    key: 'seats',
    label: 'Seat Licenses',
    description: 'Licensed seats against confirmed members, per company.'
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'This console account and the installation it administers.'
  }
];

export const DEFAULT_CONSOLE_PANEL: ConsolePanel = 'dashboard';

const PANEL_KEYS: ConsolePanel[] = CONSOLE_PANELS.map((p) => p.key);

/** Console path prefix. `/console/login` is handled by the workspace router. */
export const CONSOLE_BASE_PATH = '/console';

export function getConsolePanelDefinition(panel: ConsolePanel): ConsolePanelDefinition {
  return CONSOLE_PANELS.find((p) => p.key === panel) || CONSOLE_PANELS[0];
}

/** True when `segment` names a panel. Used by `urlRouter` to route `/console/*`. */
export function isConsolePanel(segment: string): boolean {
  return (PANEL_KEYS as string[]).includes(segment.toLowerCase());
}

export type ConsolePanelQuery = Record<string, string>;

/**
 * Resolve the panel from a path.
 *
 * Returns `null` when the path is not a console path at all, so a caller can
 * tell "this is `/companies`, not a console panel" from "this is a console path
 * with a panel I do not recognise".
 */
export function parseConsolePanelFromPath(path: string): ConsolePanel | null {
  if (!path) return null;
  const raw = path.split(/[?#]/)[0].toLowerCase().replace(/^\/+|\/+$/g, '');
  if (raw === 'console') return DEFAULT_CONSOLE_PANEL;
  if (!raw.startsWith('console/')) return null;

  const segment = raw.slice('console/'.length).split('/')[0];
  if (!segment) return DEFAULT_CONSOLE_PANEL;
  return isConsolePanel(segment) ? (segment as ConsolePanel) : DEFAULT_CONSOLE_PANEL;
}

/** Resolve the panel from the current location. */
export function parseConsolePanel(): ConsolePanel {
  if (typeof window === 'undefined') return DEFAULT_CONSOLE_PANEL;
  return parseConsolePanelFromPath(window.location.pathname) || DEFAULT_CONSOLE_PANEL;
}

export function consoleHref(panel: ConsolePanel, query?: ConsolePanelQuery): string {
  const target = PANEL_KEYS.includes(panel) ? panel : DEFAULT_CONSOLE_PANEL;
  const suffix = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : '';
  return `${CONSOLE_BASE_PATH}/${target}${suffix}`;
}

type ConsolePanelListener = (panel: ConsolePanel) => void;

const listeners = new Set<ConsolePanelListener>();

function emit(panel: ConsolePanel): void {
  listeners.forEach((listener) => {
    try {
      listener(panel);
    } catch {
      // A listener that throws must not strand the others, or the console
      // stops responding to navigation while one broken panel keeps the rail.
    }
  });
}

/**
 * Navigate to a panel, pushing a history entry.
 *
 * When the requested panel is already current the address is normalised instead
 * of pushed, so pressing the same rail button twice does not build a history
 * stack the operator then has to Back through.
 */
export function pushConsolePanel(panel: ConsolePanel, query?: ConsolePanelQuery): void {
  if (typeof window === 'undefined') return;
  const href = consoleHref(panel, query);

  if (window.location.pathname + window.location.search === href) {
    // Already here. Normalise the stale legacy hash rather than pushing an
    // entry the operator would have to Back through to escape.
    if (window.location.hash) window.history.replaceState({}, '', href);
    return;
  }

  // pushState with a hash-free URL clears the legacy hash as a side effect.
  window.history.pushState({}, '', href);
  emit(panel);
}

/** Navigate without adding a history entry (first paint, invalid routes). */
export function replaceConsolePanel(panel: ConsolePanel, query?: ConsolePanelQuery): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState({}, '', consoleHref(panel, query));
  emit(panel);
}

export function subscribeConsolePanel(listener: ConsolePanelListener): () => void {
  listeners.add(listener);
  const handlePop = () => emit(parseConsolePanel());
  window.addEventListener('popstate', handlePop);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', handlePop);
  };
}

/** The `?org=` the console carries between panels, or '' when unset. */
export function getConsoleOrgQuery(search = typeof window === 'undefined' ? '' : window.location.search): string {
  return new URLSearchParams(search).get('org') || '';
}

/**
 * The `?new=1` intent flag.
 *
 * The shell's "Add Client Company" button lives on every panel, so reaching the
 * create form from another panel needs a navigable instruction rather than
 * shared React state. Encoding it in the URL keeps it deep-linkable and makes
 * Back return to wherever the button was pressed from.
 */
export const CONSOLE_NEW_KEY = 'new';

export function wantsConsoleCreate(search = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get(CONSOLE_NEW_KEY) === '1';
}