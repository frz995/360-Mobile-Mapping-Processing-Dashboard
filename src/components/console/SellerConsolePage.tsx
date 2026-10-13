import React from 'react';
import { SellerPartnerConsole } from './SellerPartnerConsole';
import { ContentLoading } from '../common/ContentLoading';
import { PermissionProvider } from '../../hooks/usePermission';
import type { RolePermissionsMatrix } from '../../lib/authz';

/**
 * Mount point for the Seller Partner Console (`/console`).
 *
 * The console is a standalone surface: it deliberately bypasses the
 * dashboard chrome, the theme system and the sidebar, so it renders its own
 * full-bleed light shell rather than inheriting `app-canvas`. That makes it a
 * page rather than a workspace, which is why `App.tsx` returns it early and
 * why `WorkspaceRouter` excludes `console` from its dispatch
 * (`WorkspaceRouter.tsx:58`).
 *
 * It still sits inside `PermissionProvider`, because the console is only
 * reachable by a platform Administrator and the gates below must resolve
 * against the caller's real capability matrix — not an assumed one.
 *
 * Extracted from `App.tsx` so the console page does not grow the root shell
 * past its file-size budget.
 */

interface SellerConsolePageProps {
  role?: string | null;
  isGuest: boolean;
  matrix?: RolePermissionsMatrix;
  currentUserEmail?: string;
  onBackToDashboard: () => void;
  onSignOut: () => void;
}

const SellerConsolePage: React.FC<SellerConsolePageProps> = ({
  role,
  isGuest,
  matrix,
  currentUserEmail,
  onBackToDashboard,
  onSignOut
}) => {
  // Completely isolate the standalone console from global app theme & surface rules
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const prevSurface = root.getAttribute('data-surface');

    // Strip global attributes so no global [data-theme] or [data-surface] CSS rules apply
    root.removeAttribute('data-theme');
    root.removeAttribute('data-surface');

    return () => {
      if (prevTheme) root.setAttribute('data-theme', prevTheme);
      else root.removeAttribute('data-theme');
      if (prevSurface) root.setAttribute('data-surface', prevSurface);
      else root.removeAttribute('data-surface');
    };
  }, []);

  return (
    <PermissionProvider role={role} isGuest={isGuest} matrix={matrix}>
      <div
        id="seller-console-root"
        data-theme="light"
        style={{ backgroundColor: '#f4f5f8', color: '#0f172a', colorScheme: 'light' }}
        className="w-screen h-screen overflow-hidden bg-[#f4f5f8] text-slate-900 font-sans antialiased"
      >
        <React.Suspense fallback={<ContentLoading label="Loading Seller Console..." variant="spinner" />}>
          <SellerPartnerConsole
            key="workspace-console"
            onBackToApp={onBackToDashboard}
            currentUserEmail={currentUserEmail}
            onSignOut={onSignOut}
          />
        </React.Suspense>
      </div>
    </PermissionProvider>
  );
};

export default SellerConsolePage;