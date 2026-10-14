/**
 * The state a person is in when their email is verified but nobody has put them
 * in a company.
 *
 * WHY IT EXISTS
 *   Since migration 0040 every operational policy requires `sec.in_org()`, and
 *   `sec.current_org()` returns NULL for a caller with no active membership.
 *   `bootstrap.sql` calls this out: "a user with no membership sees nothing. An
 *   unassigned user is a real state, and the console renders it as such."
 *
 *   Nothing rendered it. Such a person was dropped into an empty dashboard,
 *   which reads as a broken application rather than as an unassigned account —
 *   and the most likely explanation, that their invite has not been accepted
 *   yet, is invisible.
 *
 *   It also closes the loop this plan set out to close. An invited person who
 *   confirms their address and signs in for the first time is activated by
 *   `public.activate_pending_memberships()`, lands here if the membership was
 *   never created, and sees exactly what to tell their administrator.
 */

import React from 'react';
import { MailCheck, Clock, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';

interface Props {
  email?: string;
  onSignOut: () => void | Promise<void>;
  onRetry?: () => void;
}

export const AwaitingAssignment: React.FC<Props> = ({ email, onSignOut, onRetry }) => (
  <div className="min-h-screen bg-app flex items-center justify-center p-6">
    <div className="w-full max-w-lg">
      <div className="bg-card border border-subtle rounded-2xl shadow-md p-7">
        <div className="w-11 h-11 rounded-xl bg-inner border border-subtle text-sky-400 flex items-center justify-center">
          <MailCheck size={22} />
        </div>

        <h1 className="text-base font-bold text-text-base tracking-wide mt-4">Awaiting workspace assignment</h1>
        <p className="text-xs text-text-muted mt-2 leading-relaxed">
          {email ? (
            <>
              <span className="font-semibold text-text-base">{email}</span> is signed in and its address is verified,
              but it is not yet a member of any company.
            </>
          ) : (
            'This account is not yet a member of any company.'
          )}
        </p>

        <div className="mt-5 space-y-3">
          <div className="flex items-start gap-2.5">
            <Clock size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-text-muted leading-relaxed">
              If you were invited, your access begins the first time you sign in after confirming the email address
              sent to you. Nothing further is required from you.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={14} className="text-text-muted shrink-0 mt-0.5" />
            <p className="text-[11px] text-text-muted leading-relaxed">
              If you were not invited, ask your company administrator to add this address from the Seller Console
              under <span className="font-semibold text-text-base">Team Members</span>. An invitation grants nothing
              until it has been accepted.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-6 pt-5 border-t border-subtle">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-inner hover:bg-slate-800 text-text-base border border-subtle transition-colors cursor-pointer inline-flex items-center gap-1.5"
            >
              <RefreshCw size={13} />
              <span>Check again</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold text-text-muted hover:text-text-base transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  </div>
);

export default AwaitingAssignment;