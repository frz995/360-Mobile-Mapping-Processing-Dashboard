/**
 * Lockout barrier rendered when a client organization's license has expired
 * or when the tenant account has been suspended by the platform operator.
 *
 * WHY THIS EXISTS
 *   Without a hard gate in the client application, an expired contract date is
 *   merely an administrative badge in the Seller Console while client staff can
 *   continue streaming 360 viewer tiles, PostGIS queries, and survey operations.
 *   This barrier locks the workspace until the seller renews the contract or
 *   unsuspends the company.
 */

import React from 'react';
import { ShieldAlert, LogOut, RefreshCw, CalendarX, AlertOctagon, HelpCircle } from 'lucide-react';

interface Props {
  organizationName?: string;
  email?: string;
  status?: 'expired' | 'suspended';
  expiresAt?: string | null;
  onSignOut: () => void | Promise<void>;
  onCheckAgain?: () => void | Promise<void>;
  checking?: boolean;
}

export const LicenseExpiredScreen: React.FC<Props> = ({
  organizationName,
  email,
  status = 'expired',
  expiresAt,
  onSignOut,
  onCheckAgain,
  checking = false
}) => {
  const isSuspended = status === 'suspended';

  const formattedDate = React.useMemo(() => {
    if (!expiresAt) return null;
    try {
      return new Date(expiresAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return expiresAt;
    }
  }, [expiresAt]);

  return (
    <div className="min-h-screen bg-app flex items-center justify-center p-6 select-none">
      <div className="w-full max-w-lg">
        <div className="bg-card border border-subtle rounded-3xl shadow-xl p-8 backdrop-blur-sm">
          {/* Header Icon */}
          <div
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center ${
              isSuspended
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-500'
            }`}
          >
            {isSuspended ? <AlertOctagon size={24} /> : <CalendarX size={24} />}
          </div>

          {/* Heading */}
          <h1 className="text-lg font-bold text-text-base tracking-tight mt-5">
            {isSuspended ? 'Organization Account Suspended' : 'Enterprise License Expired'}
          </h1>

          {/* Subtitle with Context */}
          <p className="text-xs text-text-muted mt-2 leading-relaxed">
            {isSuspended ? (
              <>
                Access for <span className="font-semibold text-text-base">{organizationName || 'this organization'}</span> has been temporarily suspended by the platform administrator.
              </>
            ) : (
              <>
                The commercial license for <span className="font-semibold text-text-base">{organizationName || 'this organization'}</span>{' '}
                {formattedDate ? (
                  <>
                    expired on <span className="font-semibold text-rose-400">{formattedDate}</span>.
                  </>
                ) : (
                  'has ended.'
                )}
              </>
            )}
          </p>

          {/* Information Cards */}
          <div className="mt-6 space-y-3">
            <div className="p-3.5 rounded-xl bg-inner border border-subtle/80 flex items-start gap-3">
              <ShieldAlert size={16} className={`shrink-0 mt-0.5 ${isSuspended ? 'text-amber-400' : 'text-rose-400'}`} />
              <div className="text-[11px] text-text-muted leading-relaxed">
                <span className="font-semibold text-text-base block mb-0.5">Workspace Access Restricted</span>
                360° panorama streaming, road asset inspections, and survey analytics are paused until subscription renewal is confirmed.
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-inner border border-subtle/80 flex items-start gap-3">
              <HelpCircle size={16} className="text-sky-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-text-muted leading-relaxed">
                <span className="font-semibold text-text-base block mb-0.5">How to Restore Access</span>
                Contact your company IT/GIS manager or your designated{' '}
                <span className="font-semibold text-text-base">GeoSphere 360 Partner / Reseller</span> to renew your license term. Once renewed, click below to immediately restore access.
              </div>
            </div>
          </div>

          {/* Account Details Footer */}
          {email ? (
            <div className="mt-5 text-[11px] text-text-muted font-mono bg-inner/50 px-3 py-1.5 rounded-lg border border-subtle inline-block">
              Signed in as: <span className="text-text-base font-semibold">{email}</span>
            </div>
          ) : null}

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 mt-7 pt-5 border-t border-subtle">
            <div className="flex items-center gap-2">
              {onCheckAgain ? (
                <button
                  type="button"
                  onClick={() => void onCheckAgain()}
                  disabled={checking}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-slate-900 hover:bg-slate-100 transition-all cursor-pointer inline-flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
                  <span>{checking ? 'Checking Status…' : 'Check Status'}</span>
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void onSignOut()}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <LogOut size={13} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LicenseExpiredScreen;
