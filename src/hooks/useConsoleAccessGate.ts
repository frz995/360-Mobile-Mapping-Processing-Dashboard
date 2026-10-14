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