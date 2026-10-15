/**
 * Seat Licenses — licensed against actual.
 *
 * WHY THE SPLIT
 *   Schedule A sells named user seats and the Vendor could not previously detect
 *   a breach of them. `allowedUserSeats` is configured per company but nothing
 *   ever counted anybody, so "Licensed Seats" on the dashboard was an allocation
 *   total being read as a usage total.
 *
 *   The four columns are different facts and are never summed together:
 *     licensed  — what was sold. NULL means never configured, which is a
 *                 different thing from zero and renders as an em dash.
 *     active    — people who have signed in. This is what consumes a seat.
 *     invited   — issued but not yet usable. NOT counted as usage: someone who
 *                 never confirms should not appear to occupy a paid seat.
 *     suspended — revoked, and no longer counted.
 *
 *   Nothing here ENFORCES the limit. Whether an unconfirmed invite should be
 *   blocked at capacity is a commercial decision, recorded as open in
 *   `implementation_plan_v34.md` §8. Blocking invites here without it would be
 *   inventing a pricing rule in a UI.
 */

import React from 'react';
import { Users, AlertTriangle } from 'lucide-react';
import { fetchSeatSummary, type SeatSummaryRow } from '../../../services/consoleAccess';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import { formatMetric } from '../useConsoleDirectory';
import { PanelCard, PanelHeader, PrimaryButton, ReadFailure } from './consoleUi';

interface Props {
  directory: ConsoleDirectory;
  selectedOrgId: string;
  onSelectOrg: (orgId: string) => void;
  onOpenMembers: (orgId: string) => void;
}

export const ConsoleSeatsPanel: React.FC<Props> = ({ directory, selectedOrgId, onSelectOrg, onOpenMembers }) => {
  const { organizations } = directory;

  const [rows, setRows] = React.useState<SeatSummaryRow[]>([]);
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    const result = await fetchSeatSummary();
    setRows(result.rows);
    setSummaryError(result.error);
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Totals only make sense over a verified read. A failed read would sum an
  // empty array to zero, which is the defect this codebase keeps rediscovering.
  const totals = React.useMemo(() => {
    if (summaryError) return { active: null, invited: null, licensed: null, overCapacity: null };
    const active = rows.reduce((a, r) => a + r.activeSeats, 0);
    const invited = rows.reduce((a, r) => a + r.invitedSeats, 0);
    // A company with no configured limit contributes nothing to the total, and
    // is counted separately so the seller can see that it exists.
    const licensedValues = rows.map((r) => r.licensedSeats).filter((v): v is number => typeof v === 'number');
    return {
      active,
      invited,
      licensed: licensedValues.length === rows.length && rows.length > 0 ? licensedValues.reduce((a, b) => a + b, 0) : null,
      overCapacity: rows.filter((r) => r.licensedSeats !== null && r.activeSeats > r.licensedSeats).length
    };
  }, [rows, summaryError]);

  const unconfigured = rows.filter((r) => r.licensedSeats === null).length;

  return (
    <div className="space-y-6">
      <PanelCard>
        <PanelHeader
          title="Seat Licenses"
          subtitle="What was sold, against who is actually using it."
          actions={
            <PrimaryButton onClick={() => onOpenMembers(selectedOrgId || organizations[0]?.id || '')} icon={<Users size={14} />}>
              Manage Members
            </PrimaryButton>
          }
        />

        {summaryError ? (
          <ReadFailure reason={summaryError} subject="seat summary" onRetry={() => void load()} retryLabel="Retry Read" />
        ) : isLoading ? (
          <div className="py-10 text-center text-xs text-slate-400 font-medium">Counting members…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
            <div className="rounded-2xl border border-slate-100 p-5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Licensed</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{formatMetric(totals.licensed)}</div>
              <div className="text-[11px] text-slate-400 mt-1">
                {unconfigured > 0 ? `${unconfigured} compan${unconfigured === 1 ? 'y has' : 'ies have'} no limit set` : 'Across all companies'}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-100 p-5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">In Use</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{formatMetric(totals.active)}</div>
              <div className="text-[11px] text-slate-400 mt-1">Confirmed members signed in</div>
            </div>
            <div className="rounded-2xl border border-slate-100 p-5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Pending</div>
              <div className="text-2xl font-black text-slate-900 mt-1">{formatMetric(totals.invited)}</div>
              <div className="text-[11px] text-slate-400 mt-1">Invited, not yet signed in</div>
            </div>
          </div>
        )}

        {totals.overCapacity !== null && totals.overCapacity > 0 ? (
          <div className="mt-5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600" />
            <div className="text-xs text-amber-800 leading-relaxed">
              <strong className="font-bold">
                {totals.overCapacity} compan{totals.overCapacity === 1 ? 'y is' : 'ies are'} above its licensed seat
                count.
              </strong>{' '}
              The dashboard reports this; it does not block new members. Enforcing the limit is unfinished — see
              <span className="font-mono"> implementation_plan_v34.md</span> §8.
            </div>
          </div>
        ) : null}
      </PanelCard>

      <PanelCard>
        <PanelHeader title="Per Company" subtitle="Licensed, active, invited and suspended, for every company." />

        {summaryError ? (
          <ReadFailure reason={summaryError} subject="seat summary" onRetry={() => void load()} retryLabel="Retry Read" />
        ) : isLoading ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
            <div className="p-4 space-y-3 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-slate-50 border border-slate-100 rounded-xl" />
              ))}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">No companies are registered yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="border-b font-bold uppercase tracking-wider text-[10px]" style={{ backgroundColor: '#f8fafc' }}>
                <tr>
                  <th className="px-6 py-3.5">Company</th>
                  <th className="px-6 py-3.5">Licensed</th>
                  <th className="px-6 py-3.5">Active</th>
                  <th className="px-6 py-3.5">Invited</th>
                  <th className="px-6 py-3.5">Suspended</th>
                  <th className="px-6 py-3.5 text-right">Staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const over = row.licensedSeats !== null && row.activeSeats > row.licensedSeats;
                  return (
                    <tr
                      key={row.organizationId}
                      onClick={() => onSelectOrg(row.organizationId)}
                      className={`transition-colors cursor-pointer ${
                        row.organizationId === selectedOrgId ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900">{row.organizationName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{row.clientCode || '—'}</div>
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-900">
                        {formatMetric(row.licensedSeats)}
                        {row.licensedSeats === null ? (
                          <span className="block text-[11px] font-medium text-slate-400 font-normal">No limit configured</span>
                        ) : null}
                      </td>
                      <td className={`px-6 py-4 font-bold ${over ? 'text-rose-600' : 'text-slate-900'}`}>{row.activeSeats}</td>
                      <td className="px-6 py-4 text-slate-500">{row.invitedSeats}</td>
                      <td className="px-6 py-4 text-slate-500">{row.suspendedSeats}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenMembers(row.organizationId)}
                          title={`Manage team members for ${row.organizationName}`}
                          className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#0c0d0e] hover:bg-black text-white cursor-pointer transition-colors"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </div>
  );
};

export default ConsoleSeatsPanel;