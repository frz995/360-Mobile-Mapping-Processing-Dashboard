import React from 'react';
import { Shield, ExternalLink } from 'lucide-react';

/**
 * Entry point to the Seller Partner Console from Administration.
 *
 * Opens in a new tab rather than navigating, because `/console` renders
 * outside the app shell and would otherwise strand the operator on a surface
 * with no sidebar to navigate back from. `noopener,noreferrer` keeps the
 * console window from reaching back through `window.opener`.
 *
 * Extracted from `AdministrationWorkspace.tsx` so the host component does not
 * absorb console wiring as it grows.
 */
export const SellerConsoleLauncher: React.FC = () => (
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

export default SellerConsoleLauncher;