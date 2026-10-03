import { DEFAULT_ROLE_PERMISSIONS, resolveMatrix, type RolePermissionsMatrix } from '../../lib/authz';
import { fetchProjectSettingsFromSupabase, saveProjectSettingsToSupabase } from './admin';

/**
 * The role → capability matrix is persisted inside `project_settings.settings`
 * (key `role_permissions`) and cached in module scope so every consumer — the
 * administration editor and each `usePermission` gate — resolves against the
 * same snapshot without re-querying Supabase.
 */

let cachedMatrix: RolePermissionsMatrix = DEFAULT_ROLE_PERMISSIONS;
let loaded = false;
let inflight: Promise<RolePermissionsMatrix> | null = null;

type MatrixListener = (matrix: RolePermissionsMatrix) => void;
const listeners = new Set<MatrixListener>();

/** Notified whenever the shared snapshot changes (i.e. right after an admin save). */
export function subscribeRolePermissions(listener: MatrixListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  listeners.forEach((listener) => {
    try {
      listener(cachedMatrix);
    } catch {
      /* a failing subscriber must not block the others */
    }
  });
}

export function getCachedRolePermissions(): RolePermissionsMatrix {
  return cachedMatrix;
}

export function isRolePermissionsLoaded(): boolean {
  return loaded;
}

/** Optimistically swap the in-memory matrix (used right after an admin saves). */
export function setCachedRolePermissions(matrix: RolePermissionsMatrix): void {
  cachedMatrix = resolveMatrix(matrix);
  loaded = true;
  inflight = null;
  emit();
}

/**
 * Load the matrix once. Concurrent callers share the same request; a failed
 * read leaves the shipped defaults in place rather than dropping every gate.
 */
export async function fetchRolePermissions(options: { force?: boolean } = {}): Promise<RolePermissionsMatrix> {
  if (loaded && !options.force) return cachedMatrix;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const settings = await fetchProjectSettingsFromSupabase();
      cachedMatrix = resolveMatrix(settings?.role_permissions);
    } catch (err) {
      console.warn('Role permissions load notice:', err);
      cachedMatrix = resolveMatrix(null);
    } finally {
      loaded = true;
      inflight = null;
      emit();
    }
    return cachedMatrix;
  })();

  return inflight;
}

/**
 * Persist the matrix alongside the rest of the project settings. Callers pass
 * the FULL settings object so nothing else in `project_settings` is clobbered.
 */
export async function saveRolePermissions(
  settings: Record<string, unknown>,
  matrix: RolePermissionsMatrix,
  updatedBy: string
): Promise<boolean> {
  const next = {
    ...settings,
    role_permissions: matrix,
    role_permissions_updated_at: new Date().toISOString(),
    role_permissions_updated_by: updatedBy
  };
  const ok = await saveProjectSettingsToSupabase(next);
  if (ok) setCachedRolePermissions(matrix);
  return ok;
}