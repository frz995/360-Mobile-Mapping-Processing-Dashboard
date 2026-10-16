import React, { useEffect, useState } from 'react';
import { Shield, ExternalLink } from 'lucide-react';
import { fetchConsoleAccess } from '../../services/consoleAccess';

/**
 * Entry point to the Seller Partner Console from Administration.
 *
 * Only rendered for Platform Administrators (Seller staff). Company Admins
 * and tenant members never see this button because the Seller Console is
 * strictly a platform-level surface.
 *
 * Opens in a new tab rather than navigating, because `/console` renders
 * outside the app shell and would otherwise strand the operator on a surface
 * with no sidebar to navigate back from. `noopener,noreferrer` keeps the
 * console window from reaching back through `window.opener`.
 */
export const SellerConsoleLauncher: React.FC = () => {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    fetchConsoleAccess()
      .then((res) => {
        if (active && res.verified && res.allowed) {
          setIsPlatformAdmin(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!isPlatformAdmin) return null;

  return (
    <button
      type="button"
      onClick={() => {
        window.open('/console', '_blank', 'noopener,noreferrer');
      }}
      className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 flex items-center gap-1.5 transition-colors cursor-pointer"
      title="Open Seller Partner Console in a new tab (Multi-Tenant Management)"
    >
      <Shield size={12} />
      <span>Seller Console</span>
      <ExternalLink size={11} className="opacity-70" />
    </button>
  );
};

export default SellerConsoleLauncher;