/**
 * Tenant membership state for the signed-in user, and the platform-admin
 * answer the Seller Console gate depends on.
 *
 * WHY THIS IS EXTRACTED FROM `App.tsx`
 *   The gate is ~70 lines of security-relevant logic sitting in the middle of a
 *   4,700-line shell. Extracted rather than the file-size budget raised,
 *   because a budget raise on a god file is how `App.tsx` got to 4,589 in the
 *   first place. It also makes the rule testable on its own: the whole point of
 *   this hook is that "could not determine" is a distinct third state, and that
 *   is much easier to assert against a small module.
 *
 * THE THREE-STATE RULE
 *
 *   `null`          the question has not been answered (or was re-asked)
 *   verified:false  the answer is UNKNOWN — an outage, not a refusal
 *   verified:true   the answer is known and is `allowed`
 *
 *   Collapsing the middle state is the defect this exists to prevent. Treating
 *   it as "refused" locks every administrator out during a network blip;
 *   treating it as "allowed" opens the seller console to everyone during one.
 *
 * ACTIVATION
 *   `activatePendingMemberships()` runs once per session user. It is the ONLY
 *   client-side path that grants access, it is scoped to `auth.uid()` in SQL,
 *   and it requires a confirmed email address — so registering somebody's
 *   unverified address cannot claim their company. See migration 0044.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchConsoleAccess, activatePendingMemberships, type ConsoleAccess } from '../services/consoleAccess';
import { fetchUserOrganizations, getActiveOrganizationId, type Organization } from '../services/tenantContext';

export interface TenantSessionState {
  /** null until the question is answered. See the three-state rule above. */
  access: ConsoleAccess | null;
  /** Force a re-read. Used by the retry affordance on the denied screens. */
  refresh: () => void;
}

export function useConsoleAccessGate(sessionUserId: string, isGuest: boolean): TenantSessionState {
  const [access, setAccess] = useState<ConsoleAccess | null>(null);

  useEffect(() => {
    if (!sessionUserId || isGuest) {
      setAccess(null);
      return;
    }
    let disposed = false;
    // Reset to unknown on every re-ask. Holding the previous answer while a new
    // one is in flight would let a stale "allowed" authorise a console mount.
    setAccess(null);
    fetchConsoleAccess().then((result) => {
      if (!disposed) setAccess(result);
    });
    return () => {
      disposed = true;
    };
  }, [sessionUserId, isGuest]);

  const refresh = useCallback(() => {
    if (!sessionUserId || isGuest) return;
    setAccess(null);
    fetchConsoleAccess().then(setAccess);
  }, [sessionUserId, isGuest]);

  return { access, refresh };
}

/**
 * Promote this caller's own pending invites on first sign-in.
 *
 * Idempotent by construction (the SQL only touches rows still at `invited`), so
 * a repeated call costs one cheap statement. A failure is deliberately not
 * surfaced: the person stays signed in and keeps the awaiting-assignment state
 * until it succeeds, which is honest rather than a redirect loop.
 */
export function useActivatePendingMemberships(sessionUserId: string, isGuest: boolean): void {
  const doneForRef = useRef('');

  useEffect(() => {
    if (!sessionUserId || isGuest) {
      doneForRef.current = '';
      return;
    }
    if (doneForRef.current === sessionUserId) return;
    doneForRef.current = sessionUserId;
    void activatePendingMemberships();
  }, [sessionUserId, isGuest]);
}

export interface AwaitingAssignmentInput {
  access: ConsoleAccess | null;
  isGuest: boolean;
  hasSession: boolean;
  /** Excluded routes that must keep working for an unassigned user. */
  route: string;
}

/** Routes that must never be replaced by the awaiting-assignment screen. */
const ALWAYS_ALLOWED_ROUTES = new Set(['landing', 'signin', 'console', 'console-login']);

/**
 * True when this person is signed in, verified, and a member of nothing.
 *
 * Since migration 0040 every operational policy requires `sec.in_org()`, so an
 * unassigned user is dropped into an empty dashboard that reads as broken
 * rather than unassigned. `bootstrap.sql` calls that state real; this names it.
 *
 * Requires `access.verified`. An unreachable RPC must never lock a working
 * administrator out of their own install, which is the failure this guard
 * exists to prevent.
 */
export function needsAwaitingAssignment({
  access,
  isGuest,
  hasSession,
  route
}: AwaitingAssignmentInput): boolean {
  if (!hasSession || isGuest) return false;
  if (ALWAYS_ALLOWED_ROUTES.has(route)) return false;
  if (!access || !access.verified) return false;
  if (access.allowed) return false;
  return access.organizationIds.length === 0;
}

export interface TenantLicenseState {
  organization: Organization | null;
  isExpired: boolean;
  isSuspended: boolean;
  licenseExpiresAt: string | null;
  checking: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Commercial license and tenancy status gate.
 *
 * Verifies whether the user's active tenant organization is allowed to access
 * production GIS dashboards, 360 viewer streaming, and survey operations.
 *
 * Expiration rules:
 * - Cloud SaaS / Trial: Bound by `licenseExpiresAt`. If timestamp < now, expired.
 * - Perpetual: Does NOT expire by date. Only blocked if status is explicitly
 *   'expired' or 'suspended'.
 * - Unverified network reads never falsely lock out a valid paying client.
 */
export function useTenantLicenseGate(sessionUserId: string, isGuest: boolean): TenantLicenseState {
  const [state, setState] = useState<{
    organization: Organization | null;
    isExpired: boolean;
    isSuspended: boolean;
    licenseExpiresAt: string | null;
    error: string | null;
  }>({
    organization: null,
    isExpired: false,
    isSuspended: false,
    licenseExpiresAt: null,
    error: null
  });
  const [checking, setChecking] = useState(false);

  const evaluateLicense = useCallback(async () => {
    if (!sessionUserId || isGuest) {
      setState({
        organization: null,
        isExpired: false,
        isSuspended: false,
        licenseExpiresAt: null,
        error: null
      });
      return;
    }

    setChecking(true);
    try {
      const result = await fetchUserOrganizations(sessionUserId);
      if (result.error || result.unverified || result.organizations.length === 0) {
        setState({
          organization: null,
          isExpired: false,
          isSuspended: false,
          licenseExpiresAt: null,
          error: result.error
        });
        return;
      }

      const activeOrgId = getActiveOrganizationId();
      const currentOrg =
        (activeOrgId ? result.organizations.find((o) => o.id === activeOrgId) : null) || result.organizations[0];

      if (!currentOrg) {
        setState({
          organization: null,
          isExpired: false,
          isSuspended: false,
          licenseExpiresAt: null,
          error: null
        });
        return;
      }

      const isSuspended = currentOrg.status === 'suspended';
      let isExpired = currentOrg.status === 'expired';

      if (!isExpired && currentOrg.licenseExpiresAt && currentOrg.licenseType !== 'perpetual') {
        const expiryTime = new Date(currentOrg.licenseExpiresAt).getTime();
        if (!Number.isNaN(expiryTime) && expiryTime < Date.now()) {
          isExpired = true;
        }
      }

      setState({
        organization: currentOrg,
        isExpired,
        isSuspended,
        licenseExpiresAt: currentOrg.licenseExpiresAt,
        error: null
      });
    } catch (err: unknown) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to verify license'
      }));
    } finally {
      setChecking(false);
    }
  }, [sessionUserId, isGuest]);

  useEffect(() => {
    void evaluateLicense();
  }, [evaluateLicense]);

  return {
    organization: state.organization,
    isExpired: state.isExpired,
    isSuspended: state.isSuspended,
    licenseExpiresAt: state.licenseExpiresAt,
    checking,
    error: state.error,
    refresh: evaluateLicense
  };
}

export interface LicenseLockoutInput {
  licenseState: TenantLicenseState | null;
  isPlatformAdmin: boolean;
  isGuest: boolean;
  hasSession: boolean;
  /** Excluded routes that must keep working for unassigned/unauthorized users. */
  route: string;
}

/**
 * True when the client organization's license has expired or is suspended,
 * blocking workspace access. Platform administrators and guests are exempt.
 */
export function needsLicenseLockout({
  licenseState,
  isPlatformAdmin,
  isGuest,
  hasSession,
  route
}: LicenseLockoutInput): boolean {
  if (!hasSession || isGuest) return false;
  if (ALWAYS_ALLOWED_ROUTES.has(route)) return false;
  if (isPlatformAdmin) return false;
  if (!licenseState || !licenseState.organization) return false;
  return licenseState.isExpired || licenseState.isSuspended;
}