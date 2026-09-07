export type WorkspaceKey =
  | 'project'
  | 'dashboard'
  | 'data'
  | 'settings'
  | 'production'
  | 'storage'
  | 'processing'
  | 'lineage'
  | 'analytics'
  | 'reports'
  | 'administration'
  | 'roadAnalysis'
  | 'onboarding'
  | 'landing'
  | 'signin';

export const WORKSPACE_KEYS: WorkspaceKey[] = [
  'project',
  'dashboard',
  'data',
  'settings',
  'production',
  'storage',
  'processing',
  'lineage',
  'analytics',
  'reports',
  'administration',
  'roadAnalysis',
  'onboarding',
  'landing',
  'signin'
];

export const DEFAULT_WORKSPACE: WorkspaceKey = 'dashboard';

export type WorkspacePathQuery = Record<string, string>;

type WorkspaceListener = (key: WorkspaceKey) => void;

const listeners = new Set<WorkspaceListener>();

function matchKey(raw: string): WorkspaceKey | null {
  if (!raw) return null;
  const key = raw.split(/[?#]/)[0].toLowerCase();
  if (key === 'login') return 'signin';
  if (key === 'showcase') return 'landing';
  return WORKSPACE_KEYS.find((k) => k.toLowerCase() === key) ?? null;
}

function readLegacyHash(hash: string): WorkspaceKey | null {
  const raw = hash.replace(/^#\/?/, '').trim();
  if (!raw) return null;
  return matchKey(raw);
}

function readPathname(path: string): string {
  return path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '');
}

/**
 * Resolve the active workspace from the current URL. Path routing wins; a
 * legacy `#/key` hash is honored only when the pathname names no route so a
 * stale hash can never override explicit path navigation. Pass an explicit
 * `path` to parse a path string without touching the browser location.
 */
export function parseWorkspace(path?: string): WorkspaceKey {
  if (path !== undefined) {
    return matchKey(readPathname(path)) ?? DEFAULT_WORKSPACE;
  }
  const segment = readPathname(window.location.pathname);
  if (segment && segment !== 'index.html') {
    return matchKey(segment) ?? DEFAULT_WORKSPACE;
  }
  return readLegacyHash(window.location.hash) ?? DEFAULT_WORKSPACE;
}

/** True when the URL (pathname or legacy hash) explicitly names a route. */
export function isExplicitRoute(): boolean {
  const segment = readPathname(window.location.pathname);
  if (segment && segment !== 'index.html') return true;
  return Boolean(readLegacyHash(window.location.hash));
}

function buildHref(key: WorkspaceKey, query?: WorkspacePathQuery): string {
  const suffix = query ? `?${new URLSearchParams(query).toString()}` : '';
  return `/${key}${suffix}`;
}

function currentPathAndQuery(): string {
  return window.location.pathname + window.location.search;
}

function emit(key: WorkspaceKey): void {
  listeners.forEach((l) => {
    try {
      l(key);
    } catch {
      // listener errors must not break navigation
    }
  });
}

/** Navigate to a workspace, pushing a history entry. Hash fragments are cleared. */
export function pushWorkspace(key: WorkspaceKey, query?: WorkspacePathQuery): void {
  const href = buildHref(key, query);
  if (currentPathAndQuery() === href) {
    if (window.location.hash) window.history.replaceState({}, '', href);
  } else {
    window.history.pushState({}, '', href);
  }
  emit(key);
}

/** Navigate to a workspace, replacing the current history entry. */
export function replaceWorkspace(key: WorkspaceKey, query?: WorkspacePathQuery): void {
  const href = buildHref(key, query);
  window.history.replaceState({}, '', href);
  emit(key);
}

export type WorkspaceListenerType = WorkspaceListener;

/** Subscribe to navigation changes (back/forward + programmatic). Returns unsubscribe. */
export function subscribeWorkspace(listener: WorkspaceListener): () => void {
  listeners.add(listener);
  const handlePop = () => emit(parseWorkspace());
  window.addEventListener('popstate', handlePop);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', handlePop);
  };
}