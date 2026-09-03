/**
 * AuthZ capability map — centralises the role → capability edge cases the UI
 * already assumes.
 *
 * IMPORTANT (v3, A1): The DATABASE is now the authoritative enforcement
 * boundary — see supabase/security_functions.sql (`sec.can()`) and
 * supabase/security_rls_apply.sql. This module is now only a UX mirror that
 * decides which controls to show/hide; it is NOT a security boundary. Keep
 * `ROLE_CAPABILITIES` (and the capability names) in sync with the SQL helper
 * (`sec.can`) so the two never silently drift — see
 * src/lib/__tests__/authz_matches_rls.test.ts which pins the matrix.
 */

export type UserRole = 'Administrator' | 'Survey Operator' | 'QA Inspector' | 'Viewer' | 'guest';

export const ROLE_ADMINISTRATOR: UserRole = 'Administrator';
export const ROLE_OPERATOR: UserRole = 'Survey Operator';
export const ROLE_QA_INSPECTOR: UserRole = 'QA Inspector';
export const ROLE_VIEWER: UserRole = 'Viewer';

export type AuthzCapability =
  | 'manageDatasets'        // create/update datasets (admin)
  | 'manageSettings'        // edit project settings (admin)
  | 'manageUsers'           // provision/change user roles (admin)
  | 'approveDeletions'      // approve/reject delete requests (admin)
  | 'deleteData'            // spatial safe-deletion (admin + operator)
  | 'runQaqc'               // run QA/QC workbench (operator + inspector)
  | 'reviewQaqc'            // resolve/approve defects (inspector + admin)
  | 'viewAll'               // read-only across workspaces (all authenticated)

/** Exact cap map per role. */
const ROLE_CAPABILITIES: Record<string, AuthzCapability[]> = {
  Administrator: ['manageDatasets', 'manageSettings', 'manageUsers', 'approveDeletions', 'deleteData', 'runQaqc', 'reviewQaqc', 'viewAll'],
  'Survey Operator': ['deleteData', 'runQaqc', 'viewAll'],
  'QA Inspector': ['runQaqc', 'reviewQaqc', 'viewAll'],
  Viewer: ['viewAll'],
  guest: ['viewAll']
};

export function normalizeRole(role?: string | null): UserRole {
  const r = (role || '').trim();
  if (r === 'Administrator' || r === 'admin' || r === 'Admin') return ROLE_ADMINISTRATOR;
  if (r === 'Survey Operator' || r === 'operator' || r === 'Operator') return ROLE_OPERATOR;
  if (r === 'QA Inspector' || r === 'inspector' || r === 'QA Officer') return ROLE_QA_INSPECTOR;
  if (r === 'Viewer' || r === 'viewer' || r === 'guest') return ROLE_VIEWER;
  return ROLE_VIEWER;
}

export function getRoleCapabilities(role?: string | null): AuthzCapability[] {
  const key = normalizeRole(role);
  return ROLE_CAPABILITIES[key] || ROLE_CAPABILITIES.Viewer;
}

export function can(role: string | null | undefined, capability: AuthzCapability): boolean {
  return getRoleCapabilities(role as any).includes(capability);
}

/** Convenience accessors used by the current UI toggles. */
export function isAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === ROLE_ADMINISTRATOR;
}

/**
 * Email-based guess (legacy behaviour). Several screens currently treat an
 * email containing "admin" as admin or "guest" as a guest viewer. Kept here
 * so the ad-hoc logic lives in exactly one place and reads the same way.
 */
export function roleFromEmail(email?: string | null): UserRole {
  const e = (email || '').toLowerCase();
  if (!e) return ROLE_VIEWER;
  if (e.includes('guest')) return ROLE_VIEWER;
  if (e.includes('admin')) return ROLE_ADMINISTRATOR;
  return ROLE_OPERATOR;
}

export function isGuestEmail(email?: string | null): boolean {
  return (email || '').toLowerCase().includes('guest');
}
