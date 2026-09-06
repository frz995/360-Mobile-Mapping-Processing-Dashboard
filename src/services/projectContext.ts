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

function activeProjectStorageKey(userKey: string): string {
  return `${ACTIVE_PROJECT_KEY_PREFIX}${userKey}`;
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
    // ignore and fall through
  }
  return 'guest';
}

export function setActiveProjectId(projectId: string | null): void {
  memoryProjectId = projectId;
}

export function getActiveProjectId(): string | null {
  if (memoryProjectId) return memoryProjectId;
  try {
    return localStorage.getItem(activeProjectStorageKey(computeUserKey()));
  } catch {
    return null;
  }
}

export function saveActiveProjectId(userKey: string, projectId: string): void {
  memoryProjectId = projectId;
  try {
    localStorage.setItem(activeProjectStorageKey(userKey), projectId);
  } catch {
    // storage unavailable (private mode / quota) — non-fatal
  }
}

export function loadActiveProjectId(userKey: string): string | null {
  // Prefer storage (truth per user) over memory.
  try {
    return localStorage.getItem(activeProjectStorageKey(userKey)) || null;
  } catch {
    return null;
  }
}

export function clearActiveProjectId(userKey: string): void {
  if (memoryProjectId && computeUserKey() === userKey) memoryProjectId = null;
  try {
    localStorage.removeItem(activeProjectStorageKey(userKey));
  } catch {
    // ignore
  }
}