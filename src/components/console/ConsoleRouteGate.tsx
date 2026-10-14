/**
 * The `/console` route gate.
 *
 * WHY A COMPONENT RATHER THAN AN INLINE BRANCH IN `App.tsx`
 *   Three security outcomes — answered-and-allowed, answered-and-refused, and
 *   NOT ANSWERED — plus a signed-out redirect. Inlined that is 40 lines of
 *   routing logic in a 4,600-line shell, which is the shape that let `/console`
 *   ship gated on `authSession` alone in the first place. As a component it is
 *   small enough to read in one screen and test directly.
 *
 * IT OWNS THE PAGE MOUNT, NOT THE ELEMENT
 *   `App.tsx` passes props, not a pre-built `<SellerConsolePage>`. Building the
 *   element at the call site would evaluate it before the gate had answered,
 *   so the `access` prop could only be `ConsoleAccess | null` — and the type
 *   system would then permit handing a `null` access to the console. Constructing
 *   it here means the console is only ever built from an answer that says yes.
 *
 * THE RULE
 *   The console must never mount optimistically. Before `console_access()`
 *   answers, the only truthful thing to render is "verifying" — not the console,
 *   and not a refusal either, because a refusal during a network blip locks out
 *   a real administrator.
 */

import React from 'react';
import { ConsoleAccessDenied } from './ConsoleAccessDenied';
import type { ConsoleAccess } from '../../services/consoleAccess';
import type { RolePermissionsMatrix } from '../../lib/authz';

const SellerConsolePageLazy = React.lazy(() => import('./SellerConsolePage'));

interface Props {
  /** A session exists. False with `authLoading` false means redirect to login. */
  isSignedIn: boolean;
  /** True while the session itself is still being restored. */
  authLoading: boolean;
  /** null = UNANSWERED. Never pass a default here; see the module comment. */
  access: ConsoleAccess | null;
  email?: string;
  role?: string | null;
  isGuest: boolean;
  matrix?: RolePermissionsMatrix;
  onNeedsLogin: () => void;
  onRetry: () => void;
  onBackToDashboard: () => void;
  onSignOut: () => void | Promise<void>;
}

export const ConsoleRouteGate: React.FC<Props> = ({
  isSignedIn,
  authLoading,
  access,
  email,
  role,
  isGuest,
  matrix,
  onNeedsLogin,
  onRetry,
  onBackToDashboard,
  onSignOut
}) => {
  if (!isSignedIn && !authLoading) {
    onNeedsLogin();
    return null;
  }

  // No session, but the session is still loading. The auth block in `App.tsx`
  // normally owns this case, so this is a safety net rather than a state worth
  // designing for.
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#f4f5f8] flex items-center justify-center text-slate-500 text-xs font-mono">
        Verifying session…
      </div>
    );
  }

  if (!access) {
    return (
      <div className="min-h-screen bg-[#f4f5f8] flex items-center justify-center text-slate-500 text-xs font-mono">
        Verifying administrator access…
      </div>
    );
  }

  if (!access.allowed) {
    return (
      <ConsoleAccessDenied
        // null => the check ran and refused. A string => it could not run, and
        // saying "you are not an administrator" there would be asserting
        // something nobody measured.
        reason={access.verified ? null : access.error}
        email={email}
        onRetry={onRetry}
        onBackToApp={onBackToDashboard}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-[#f4f5f8] flex items-center justify-center text-slate-900 text-xs font-mono">
          Loading Console...
        </div>
      }
    >
      <SellerConsolePageLazy
        role={role}
        isGuest={isGuest}
        matrix={matrix}
        access={access}
        currentUserEmail={email}
        onBackToDashboard={onBackToDashboard}
        onSignOut={onSignOut}
      />
    </React.Suspense>
  );
};

export default ConsoleRouteGate;