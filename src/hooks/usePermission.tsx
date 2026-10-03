import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_ROLE_PERMISSIONS,
  can,
  canAny,
  normalizeRole,
  type AuthzCapability,
  type RolePermissionsMatrix,
  type UserRole
} from '../lib/authz';
import {
  fetchRolePermissions,
  getCachedRolePermissions,
  subscribeRolePermissions
} from '../services/api/permissions';

interface PermissionContextValue {
  role: UserRole;
  matrix: RolePermissionsMatrix;
  /** True when the session is a guest — a hard read-only lock on top of the matrix. */
  isGuest: boolean;
  can: (capability: AuthzCapability) => boolean;
  canAny: (capabilities: readonly AuthzCapability[]) => boolean;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

export interface PermissionProviderProps {
  role?: string | null;
  isGuest?: boolean;
  /** Optional pre-resolved matrix — skips the Supabase read (used by tests). */
  matrix?: RolePermissionsMatrix;
  children: ReactNode;
}

/**
 * Resolves the signed-in user's effective permissions once and shares them with
 * every gate in the tree. Guests are pinned to `viewAll` regardless of the
 * stored matrix so guest exploration mode stays strictly read-only.
 */
export function PermissionProvider({ role, isGuest = false, matrix, children }: PermissionProviderProps) {
  const normalized = normalizeRole(role);
  const [resolved, setResolved] = useState<RolePermissionsMatrix>(
    () => matrix || getCachedRolePermissions() || DEFAULT_ROLE_PERMISSIONS
  );

  useEffect(() => {
    if (matrix) {
      setResolved(matrix);
      return;
    }
    let disposed = false;
    // The module-level snapshot is pre-seeded from the last save, so render the
    // cached matrix first and only fetch when nothing has been loaded yet.
    setResolved(getCachedRolePermissions());
    fetchRolePermissions().then((loaded) => {
      if (!disposed) setResolved(loaded);
    });
    // An admin saving the matrix updates the cache in place; re-read it so every
    // mounted gate flips without a full reload.
    const unsubscribe = subscribeRolePermissions((next) => {
      if (!disposed) setResolved(next);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [matrix]);

  const value = useMemo<PermissionContextValue>(() => {
    const effective: RolePermissionsMatrix = isGuest
      ? { ...resolved, Viewer: { viewAll: true } }
      : resolved;

    return {
      role: normalized,
      matrix: effective,
      isGuest,
      can: (capability) => !isGuest && can(normalized, capability, effective),
      canAny: (capabilities) => !isGuest && canAny(normalized, capabilities, effective)
    };
  }, [normalized, resolved, isGuest]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

function denyAll(): PermissionContextValue {
  return {
    role: normalizeRole(null),
    matrix: DEFAULT_ROLE_PERMISSIONS,
    isGuest: false,
    can: () => false,
    canAny: () => false
  };
}

/**
 * Capability gate. Without a provider mounted every capability is denied, so a
 * missing provider fails closed rather than granting writes.
 */
export function usePermission(capability: AuthzCapability): boolean {
  const ctx = useContext(PermissionContext);
  return ctx ? ctx.can(capability) : false;
}

/** Any-of gate — mirrors `WorkspaceDefinition.guard` semantics. */
export function useAnyPermission(capabilities: readonly AuthzCapability[]): boolean {
  const ctx = useContext(PermissionContext);
  return ctx ? ctx.canAny(capabilities) : false;
}

/** Escape hatch for components that need the resolved role alongside the gates. */
export function useCapabilities(): PermissionContextValue {
  return useContext(PermissionContext) || denyAll();
}