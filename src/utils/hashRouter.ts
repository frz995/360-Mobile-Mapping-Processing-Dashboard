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

export function parseHashWorkspace(hash: string = window.location.hash): WorkspaceKey {
  const raw = hash.replace(/^#\/?/, '').trim();
  if (!raw) return DEFAULT_WORKSPACE;
  const key = raw.split(/[?#]/)[0].toLowerCase();
  if (key === 'login') return 'signin';
  if (key === 'showcase') return 'landing';
  const matched = WORKSPACE_KEYS.find((k) => k.toLowerCase() === key);
  return matched ?? DEFAULT_WORKSPACE;
}

export function setHashWorkspace(key: WorkspaceKey): void {
  const normalized = `#/${key}`;
  if (window.location.hash !== normalized) {
    window.location.hash = normalized;
  }
}

export type HashWorkspaceListener = (key: WorkspaceKey) => void;

export function subscribeHashWorkspace(listener: HashWorkspaceListener): () => void {
  const handle = () => listener(parseHashWorkspace(window.location.hash));
  window.addEventListener('hashchange', handle);
  return () => window.removeEventListener('hashchange', handle);
}