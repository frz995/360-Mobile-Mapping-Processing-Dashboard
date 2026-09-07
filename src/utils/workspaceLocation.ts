import { WORKSPACE_KEYS, type WorkspaceKey } from './urlRouter';

const LOCATION_STORAGE_KEY = 'geosphere360_workspace_location';
const LAST_ACTIVITY_STORAGE_KEY = 'geosphere360_last_activity';

interface WorkspaceLocationState {
  workspace?: WorkspaceKey;
  tabs?: Record<string, string>;
}

export function readWorkspaceLocation(): WorkspaceLocationState {
  try {
    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as WorkspaceLocationState;
    const normalized: WorkspaceLocationState = {
      workspace: parsed.workspace && WORKSPACE_KEYS.includes(parsed.workspace) ? parsed.workspace : undefined,
      tabs: parsed.tabs && typeof parsed.tabs === 'object' ? parsed.tabs : undefined
    };
    return normalized;
  } catch {
    return {};
  }
}

function writeWorkspaceLocation(state: WorkspaceLocationState): void {
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable — persistence is best-effort
  }
}

export function getStoredWorkspaceKey(): WorkspaceKey | undefined {
  return readWorkspaceLocation().workspace;
}

export function setStoredWorkspaceKey(key: WorkspaceKey): void {
  const current = readWorkspaceLocation();
  if (current.workspace === key) return;
  writeWorkspaceLocation({ ...current, workspace: key });
}

export function restoreWorkspaceTab<T extends string>(ws: WorkspaceKey, allowed: readonly T[]): T | null {
  const saved = readWorkspaceLocation().tabs?.[ws];
  if (!saved) return null;
  return allowed.includes(saved as T) ? (saved as T) : null;
}

export function persistWorkspaceTab<T extends string>(ws: WorkspaceKey, tab: T): void {
  const current = readWorkspaceLocation();
  const tabs = { ...(current.tabs || {}) };
  tabs[ws] = tab;
  writeWorkspaceLocation({ ...current, tabs });
}

export function clearWorkspaceLocation(): void {
  try {
    localStorage.removeItem(LOCATION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getLastActivityAgeMs(): number {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    if (!raw) return Number.POSITIVE_INFINITY;
    const at = Number(raw);
    if (!Number.isFinite(at) || at <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, Date.now() - at);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function hasLastActivity(): boolean {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && at > 0;
  } catch {
    return false;
  }
}

export function touchLastActivity(): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function clearLastActivity(): void {
  try {
    localStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
  } catch {
    // ignore
  }
}