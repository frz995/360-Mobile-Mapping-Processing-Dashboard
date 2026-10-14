/**
 * Shown when a signed-in person reaches `/console` without platform-admin
 * access.
 *
 * WHY THIS IS A DISTINCT SCREEN RATHER THAN A REDIRECT
 *   Redirecting a non-admin to the dashboard would be indistinguishable from
 *   the console having worked, and a seller who mistyped the URL would be
 *   dropped somewhere unexplained. Saying "this account cannot use the console"
 *   is the answer; silently relocating them is not.
 *
 * WHY UNVERIFIED IS ITS OWN MESSAGE
 *   When the access check could not run, the person may well be an
 *   administrator on a flaky network. Telling them they are not an administrator
 *   would be asserting something nobody measured — the same defect as the
 *   fabricated SLA figures this plan removed. The copy says so and offers a
 *   retry.
 */

import React from 'react';
import { ShieldAlert, LogOut, RefreshCw, ArrowLeft } from 'lucide-react';

interface Props {
  /** null when the check ran and refused. A string when it could not run. */
  reason: string | null;
  email?: string;
  onSignOut: () => void | Promise<void>;
  onBackToApp?: () => void;
  onRetry?: () => void;
}

export const ConsoleAccessDenied: React.FC<Props> = ({ reason, email, onSignOut, onBackToApp, onRetry }) => {
  const unverified = reason !== null;

  return (
    <div
      style={{ backgroundColor: '#0c0d0e', color: '#ffffff', minHeight: '100vh' }}
      className="flex flex-col items-center justify-center p-6 font-sans antialiased"
    >
      <div className="w-full max-w-[420px]">
        <div
          style={{ backgroundColor: '#ffffff', color: '#0f172a', borderColor: '#edf0f4', borderRadius: '20px' }}
          className="w-full p-8 border shadow-2xl"
        >
          <div className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
            <ShieldAlert size={22} className="text-slate-900" />
          </div>

          <h1 className="text-lg font-black text-slate-900 tracking-tight mt-4">
            {unverified ? 'Could not verify console access' : 'Console access is restricted'}
          </h1>

          <p className="text-xs text-slate-500 font-medium mt-2 leading-relaxed">
            {unverified ? (
              <>
                The administrator check did not complete, so whether this account may use the console is{' '}
                <strong className="text-slate-700">unknown</strong>. Nothing has been blocked on a guess.
              </>
            ) : (
              <>
                {email ? (
                  <>
                    <span className="font-semibold text-slate-700">{email}</span> is not a platform administrator, so
                    the Seller Console is not available to this account.
                  </>
                ) : (
                  'This account is not a platform administrator, so the Seller Console is not available.'
                )}{' '}
                Ask a platform administrator to grant access, or sign in with an administrator account.
              </>
            )}
          </p>

          {unverified ? (
            <p className="text-[11px] text-rose-600 font-mono mt-3 p-2.5 bg-rose-50 border border-rose-200 rounded-lg leading-relaxed break-words">
              {reason}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 mt-6 pt-5 border-t border-slate-100">
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <RefreshCw size={13} />
                <span>Try again</span>
              </button>
            ) : null}
            {onBackToApp ? (
              <button
                type="button"
                onClick={onBackToApp}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <ArrowLeft size={13} />
                <span>Return to the application</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer inline-flex items-center gap-1.5"
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

export default ConsoleAccessDenied;