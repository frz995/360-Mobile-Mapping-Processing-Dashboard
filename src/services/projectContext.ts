import { reportWriteFailure } from '../lib/writeFailures';
// ---------------------------------------------------------------------------
// Active-project context — single synchronous source of truth for the active
// project id used by the Supabase service layer to scope every operational
// query to the current project (v15 per-project isolation).
//
// Deliberately dependency-free (no imports of supabase.ts / projects.ts) to
// avoid import cycles: services call getActiveProjectId() with zero call-site
// changes.
// ---------------------------------------------------------------------------

export const ACTIVE_PROJECT_KEY_PREFIX = 'geosphere360_active_project_';

function activeProjectStorageKey(userKey: string, orgId?: string | null): string {
  const orgSuffix = orgId && orgId.trim() ? `_${orgId.trim()}` : '';
  return `${ACTIVE_PROJECT_KEY_PREFIX}${userKey}${orgSuffix}`;
}

/** In-memory override, written by the app when a project is loaded/created. */
let memoryProjectId: string | null = null;

/**
 * Resolve the authenticated user key from the persisted Supabase auth token,
 * mirroring `getAuthStorageUserKey`'s fallback so refreshes resolve the same
 * per-user active-project key without waiting for the auth promise.
 */
export function computeUserKey(): string {
  try {
    const tokenKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (tokenKey) {
      const raw = localStorage.getItem(tokenKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const user = parsed?.user;
        if (user?.id) return String(user.id);
        if (user?.email) return String(user.email).toLowerCase().trim();
      }
    }
  } catch {
    return 'guest';
  }
  return 'guest';
}

export function setActiveProjectId(projectId: string | null): void {
  memoryProjectId = projectId;
}

export function getActiveProjectId(orgId?: string | null): string | null {
  if (memoryProjectId) return memoryProjectId;
  try {
    const userKey = computeUserKey();
    const scopedVal = localStorage.getItem(activeProjectStorageKey(userKey, orgId));
    if (scopedVal) return scopedVal;
    if (!orgId) {
      return localStorage.getItem(activeProjectStorageKey(userKey));
    }
    return null;
  } catch {
    return null;
  }
}

export function saveActiveProjectId(userKey: string, projectId: string, orgId?: string | null): void {
  memoryProjectId = projectId;
  try {
    localStorage.setItem(activeProjectStorageKey(userKey, orgId), projectId);
  } catch (err) {
    reportWriteFailure('storage.local_storage', 'Active project id cache', err instanceof Error ? err.message : String(err), 'warning');
  }
}

export function loadActiveProjectId(userKey: string, orgId?: string | null): string | null {
  try {
    const scopedVal = localStorage.getItem(activeProjectStorageKey(userKey, orgId));
    if (scopedVal) return scopedVal;
    if (!orgId) {
      return localStorage.getItem(activeProjectStorageKey(userKey)) || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearActiveProjectId(userKey: string, orgId?: string | null): void {
  if (memoryProjectId && computeUserKey() === userKey) memoryProjectId = null;
  try {
    localStorage.removeItem(activeProjectStorageKey(userKey, orgId));
    if (!orgId) {
      localStorage.removeItem(activeProjectStorageKey(userKey));
    }
  } catch (err) {
    reportWriteFailure('storage.local_storage', 'Clear active project id cache', err instanceof Error ? err.message : String(err), 'warning');
  }
}