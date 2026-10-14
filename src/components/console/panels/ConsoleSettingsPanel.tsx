/**
 * Console settings.
 *
 * Everything on this page is either an account fact the caller can see about
 * themselves, or an explicit statement of what this console does not do. The
 * previous profile sidebar carried `Partner Verified`, `RLS Isolation Verified`,
 * `HEALTHY`, `99.98% SLA` and `Multi-Tenant Cloud Guard` as static text that no
 * code path could contradict.
 *
 * The "Not yet enforced" list below is not filler. A seller who cannot detect a
 * seat-limit breach needs to know that before they sign Schedule A, and a
 * limitation documented in the product is visible to the person who would
 * otherwise discover it in production.
 */

import React from 'react';
import { LogOut, Shield, Server, Users, HardDrive, ExternalLink, Info } from 'lucide-react';
import { PanelCard, PanelHeader, SecondaryButton } from './consoleUi';
import type { ConsoleAccess } from '../../../services/consoleAccess';

interface Props {
  access: ConsoleAccess;
  currentUserEmail?: string;
  organizationIds: string[];
  onBackToApp: () => void;
  onSignOut?: () => void;
}

/** Each entry names the check that would have to exist for it to be claimed. */
const NOT_YET_ENFORCED = [
  {
    icon: Users,
    title: 'Seat limits are not enforced',
    body: 'The count is reported on the Seat Licenses panel and members above the limit are highlighted, but no write is refused. Whether an unconfirmed invite should consume a licensed seat is a pricing decision, not a database default.'
  },
  {
    icon: HardDrive,
    title: 'Storage quotas are not enforced',
    body: 'storageQuotaGb is a configured number and a display figure. Nothing measures a company’s actual object usage, so an over-quota tenant is not detectable.'
  },
  {
    icon: Server,
    title: 'dedicated_external routing is not connected',
    body: 'Credentials for a dedicated instance are stored and readable here, but the client application still never dials that database. A company marked dedicated behaves like a shared one.'
  }
];

export const ConsoleSettingsPanel: React.FC<Props> = ({
  access,
  currentUserEmail,
  organizationIds,
  onBackToApp,
  onSignOut
}) => (
  <div className="space-y-6">
    <PanelCard>
      <PanelHeader title="This Console" subtitle="The account administering every company on this installation." />

      <div className="flex items-center gap-4 mt-6">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-black shrink-0"
          style={{ backgroundColor: '#0c0d0e', color: '#ffffff' }}
        >
          {(currentUserEmail || 'SA').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-base font-black text-slate-900 tracking-tight">
            {currentUserEmail ? currentUserEmail.split('@')[0] : 'Administrator'}
          </div>
          <div className="text-[11px] text-slate-400 font-mono truncate">{currentUserEmail || 'Not signed in'}</div>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-100">
        <div>
          <dt className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Platform Administrator</dt>
          <dd className="mt-1 flex items-center gap-1.5 text-sm font-bold text-emerald-600">
            <Shield size={14} />
            {access.verified ? 'Confirmed by the database' : 'Unverified'}
          </dd>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Read from <span className="font-mono">public.console_access()</span> on this page load.
          </p>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Company Memberships</dt>
          <dd className="mt-1 text-sm font-bold text-slate-900">{organizationIds.length}</dd>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            A platform administrator also resolves to every tenant, independently of these rows.
          </p>
        </div>
      </dl>

      <div className="flex items-center gap-2.5 mt-6 pt-5 border-t border-slate-100">
        <SecondaryButton onClick={onBackToApp} icon={<ExternalLink size={13} />}>
          Open Client Application
        </SecondaryButton>
        {onSignOut ? (
          <SecondaryButton onClick={onSignOut} icon={<LogOut size={13} />}>
            Sign Out
          </SecondaryButton>
        ) : null}
      </div>
    </PanelCard>

    <PanelCard>
      <PanelHeader
        title="Not Yet Enforced"
        subtitle="Stated here because a seller needs to know before quoting it, not after."
      />
      <div className="space-y-4 mt-5">
        {NOT_YET_ENFORCED.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex items-start gap-3 p-4 rounded-2xl border border-slate-100 bg-slate-50">
              <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                <Icon size={15} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">{item.title}</div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{item.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </PanelCard>

    <div className="flex items-start gap-2.5 px-1">
      <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-slate-400 font-medium leading-relaxed">
        This console bypasses the application&rsquo;s theming system by design — it renders its own fixed shell so it
        stays legible regardless of the theme selected in the client application. Anything reported here is read live
        from the database on this page load; nothing on this surface is cached or simulated.
      </p>
    </div>
  </div>
);

export default ConsoleSettingsPanel;