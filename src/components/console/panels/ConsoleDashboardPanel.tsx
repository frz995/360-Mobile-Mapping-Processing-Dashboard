/**
 * Console dashboard — portfolio totals.
 *
 * WHAT WAS REMOVED FROM HERE, AND WHY
 *   The previous dashboard carried a "Total Activity" chart, a regional node
 *   map and an infrastructure panel. Every figure in them was a literal in this
 *   file: `639 frames` today, `120,370` weekly, `TNB - 1,922,340`,
 *   `APEX - 822,340`, `AWS SG - 23,302`, a paired bar chart of hardcoded
 *   heights, `99.98% Latency SLA`, `Row-Level Security 100% Active`,
 *   `Gateway SLA`, `HEALTHY`, `Partner Verified` and `RLS Isolation Verified`.
 *   Nothing in this repository measured any of them.
 *
 *   That is v33 §3 failure mode C: a failure that renders as a healthy value,
 *   in its most expensive form. A seller would quote `1,922,340` to a client.
 *
 *   `implementation_plan_v31.md:61` claimed "Dynamic SVG Charts: Bars and curves
 *   rendered from live tenant arrays". They were neither dynamic nor from the
 *   tenant arrays.
 *
 *   Reinstating any of this needs a real query behind it and must render an em
 *   dash when the read fails, the way the KPI tiles already do. If the number
 *   cannot be measured, it does not go on this page.
 */

import React from 'react';
import { Building2, Users, HardDrive, Server } from 'lucide-react';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import { STATUS_LABEL, STATUS_TONE } from '../useConsoleDirectory';
import { KpiCard, PanelCard, PanelHeader, ReadFailure } from './consoleUi';

interface Props {
  directory: ConsoleDirectory;
  onOpenCompanies: () => void;
  onOpenMembers: () => void;
}

export const ConsoleDashboardPanel: React.FC<Props> = ({ directory, onOpenCompanies, onOpenMembers }) => {
  const { organizations, isLoading, directoryError, reload, metrics, metric } = directory;

  const withContact = organizations.filter((o) => Boolean(o.settings?.contactEmail));

  return (
    <div className="space-y-6">
      <PanelCard>
        <PanelHeader
          title="Portfolio"
          subtitle="Every figure below is read from the organization directory on this page load."
        />

        {directoryError ? (
          <ReadFailure reason={directoryError} subject="company directory" onRetry={() => void reload()} />
        ) : null}

        {/* The tiles render on a failed read too, showing an em dash. Hiding the
            whole grid makes a transient error look like a broken page, and the
            operator loses the shape of what they were looking at. */}
        {isLoading && !directoryError ? (
          <div className="py-12 text-center text-slate-400 text-xs font-medium">Reading the organization directory…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            <KpiCard
              label="Active Companies"
              value={metric(metrics.activeCount)}
              caption={directoryError ? 'unknown' : `of ${organizations.length} registered`}
              icon={<Building2 size={18} />}
            />
            <KpiCard
              label="Licensed Seats"
              value={metric(metrics.totalSeats)}
              caption="Allocated across all clients"
              icon={<Users size={18} />}
            />
            <KpiCard
              label="Total Storage"
              value={metric(metrics.totalQuota, ' GB')}
              caption="Allocated quota"
              icon={<HardDrive size={18} />}
            />
            <KpiCard
              label="Dedicated DBs"
              value={metric(metrics.dedicatedCount)}
              caption="Self-hosted instances"
              icon={<Server size={18} />}
            />
          </div>
        )}

        {/* Seats are allocated, not used. Saying so is the difference
            between a number a seller can act on and one they can quote. */}
        {!directoryError && !isLoading ? (
          <p className="text-[11px] text-slate-500 font-medium mt-5 leading-relaxed">
            These are <strong className="text-slate-700">allocated</strong> figures from each company&rsquo;s
            configuration. Actual members in use are counted separately — see Seat Licenses.
          </p>
        ) : null}
      </PanelCard>

      <PanelCard>
        <PanelHeader
          title="Companies"
          subtitle="Every company registered on this installation."
          actions={
            <button
              type="button"
              onClick={onOpenCompanies}
              className="text-xs font-bold text-slate-900 hover:underline cursor-pointer"
            >
              Manage companies
            </button>
          }
        />

        {directoryError ? (
          <ReadFailure reason={directoryError} subject="company directory" onRetry={() => void reload()} />
        ) : organizations.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">
            No companies are registered yet. Add one from the Companies panel.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="border-b font-bold uppercase tracking-wider text-[10px]" style={{ backgroundColor: '#f8fafc' }}>
                <tr>
                  <th className="px-5 py-3">Company</th>
                  <th className="px-5 py-3">Client Code</th>
                  <th className="px-5 py-3">Database</th>
                  <th className="px-5 py-3">Contact</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {organizations.slice(0, 8).map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-slate-900">{org.name}</td>
                    <td className="px-5 py-3.5 font-mono">{org.clientCode || '—'}</td>
                    <td className="px-5 py-3.5">
                      {org.databaseType === 'dedicated_external' ? 'Dedicated' : 'Cloud Shared'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{org.settings?.contactEmail || '—'}</td>
                    <td className={`px-5 py-3.5 font-bold ${STATUS_TONE[org.status]}`}>{STATUS_LABEL[org.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {organizations.length > 8 ? (
              <div className="px-5 py-3 text-[11px] text-slate-400 border-t border-slate-100">
                Showing the first 8 of {organizations.length} companies.
              </div>
            ) : null}
          </div>
        )}
      </PanelCard>

      <PanelCard>
        <PanelHeader
          title="Staffing"
          subtitle="Nobody can sign in to a company until somebody is added to it."
          actions={
            <button
              type="button"
              onClick={onOpenMembers}
              className="text-xs font-bold text-slate-900 hover:underline cursor-pointer"
            >
              Manage team members
            </button>
          }
        />
        <p className="text-xs text-slate-500 font-medium mt-4 leading-relaxed">
          {withContact.length === 0
            ? 'No company on this installation has a contact email configured.'
            : `${withContact.length} of ${organizations.length} companies have a contact email on file.`}{' '}
          An invite is created at <span className="font-mono text-[11px]">invited</span> status and grants no access
          until the person signs in with a confirmed email address.
        </p>
      </PanelCard>
    </div>
  );
};

export default ConsoleDashboardPanel;