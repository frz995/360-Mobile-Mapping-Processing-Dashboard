/**
 * Console dashboard — portfolio totals, live storage bar chart, and bucket details.
 *
 * WHAT IS REPORTED
 *   * Live metrics from directory and public.file_inventory.
 *   * Storage Consumed vs. Allocated Quota per company (Recharts bar chart).
 *   * Exact per-company bucket breakdown (MMS_PIC, panoramas, road-analysis-geometry).
 *   * Company licensing model and expiration countdowns.
 *   * Zero mock figures.
 *
 * THE NULL RULE
 *   Every derived figure renders an em dash (—) when the read fails.
 *
 * THE REFRESH CONTRACT
 *   The top-bar "Refresh" re-reads the company directory. The storage
 *   inventory is re-read with it, because the two sets of numbers have to come
 *   from the same moment: a quota edited on the Companies tab and a chart
 *   drawn from the previous read is a number nobody can reconcile.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Users,
  HardDrive,
  Server
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import {
  fetchCompanyStorageBreakdown,
  formatBytes,
  type CompanyStorageBreakdown
} from '../../../services/consoleStorage';
import { KpiCard, PanelCard, PanelHeader, ReadFailure } from './consoleUi';
import ConsoleCompanyStorageTable from './ConsoleCompanyStorageTable';

interface Props {
  directory: ConsoleDirectory;
  onOpenCompanies: () => void;
  onOpenMembers: () => void;
}

export const ConsoleDashboardPanel: React.FC<Props> = ({ directory, onOpenCompanies, onOpenMembers }) => {
  const { organizations, isLoading: directoryLoading, directoryError, reload, metrics, metric } = directory;

  const [breakdown, setBreakdown] = useState<CompanyStorageBreakdown[]>([]);
  const [isStorageLoading, setIsStorageLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);

  const loadStorage = useCallback(async () => {
    setIsStorageLoading(true);
    const res = await fetchCompanyStorageBreakdown();
    setBreakdown(res.breakdown);
    setStorageError(res.error);
    setIsStorageLoading(false);
  }, []);

  // The inventory is re-read whenever the directory is. `directory.organizations`
  // is replaced on every read and only on a read, so its identity IS the
  // refresh signal — which is what makes the top-bar "Refresh" button re-read
  // the whole console rather than half of it.
  //
  // The read waits for the directory to settle. On mount the directory has
  // not answered yet, so reading the inventory then would mean reading it
  // twice: once against an empty company list, and again against the real
  // one. Waiting costs a moment of skeleton and saves a round trip.
  useEffect(() => {
    if (directory.isLoading) return;
    void loadStorage();
  }, [loadStorage, directory.organizations, directory.isLoading]);

  const withContact = organizations.filter((o) => Boolean(o.settings?.contactEmail));

  // Prepare chart data (excluding system unassigned row from main company bar comparison)
  const activeBreakdown = breakdown.filter((b) => b.organizationId !== '00000000-0000-0000-0000-000000000000');
  const maxStorageGb = Math.max(
    ...activeBreakdown.map((b) => Math.max(b.consumedStorageGb, b.allocatedStorageGb || 0)),
    0
  );
  const useMbUnit = maxStorageGb > 0 && maxStorageGb < 1.0;
  const storageUnit = useMbUnit ? 'MB' : 'GB';

  const chartData = activeBreakdown.map((b) => {
    const rawAllocated = b.allocatedStorageGb;
    const consumedVal = useMbUnit
      ? Number((b.consumedStorageBytes / (1024 * 1024)).toFixed(1))
      : Number(b.consumedStorageGb.toFixed(3));
    const allocatedVal =
      rawAllocated !== null && rawAllocated > 0
        ? useMbUnit
          ? Number((rawAllocated * 1024).toFixed(0))
          : rawAllocated
        : null;

    // Smart label: show up to 26 chars for small tenant sets so names like "GeoSphere (bootstrap)" are not clipped
    const nameLimit = activeBreakdown.length <= 3 ? 26 : 16;
    const displayName =
      b.organizationName.length > nameLimit ? `${b.organizationName.slice(0, nameLimit - 2)}…` : b.organizationName;

    return {
      name: displayName,
      fullName: b.organizationName,
      clientCode: b.clientCode,
      consumedVal,
      allocatedVal,
      consumedGb: Number(b.consumedStorageGb.toFixed(3)),
      allocatedGb: rawAllocated,
      consumedBytes: b.consumedStorageBytes,
      filesCount: b.consumedFilesCount
    };
  });

  // null means "not measured". Summing an empty breakdown would report 0 B
  // for a portfolio whose storage nobody read, which is the same confident
  // zero the per-company table used to print for every tenant. An empty
  // breakdown mid-load is also not a measurement: the read has not answered
  // yet, so the honest figure there is unknown, not zero.
  const totalConsumedBytes =
    storageError || isStorageLoading ? null : breakdown.reduce((acc, b) => acc + b.consumedStorageBytes, 0);

  // The quota figure is the sum of the quotas that ARE configured. Companies
  // with no quota on file are unlimited, and counting them as zero would
  // under-report the portfolio — so they are disclosed instead.
  const unlimitedQuota = metrics.unlimitedQuotaCount;
  const allocatedCaption =
    isStorageLoading
      ? 'Loading…'
      : metrics.totalQuota === null
        ? 'Allocation not measured'
        : `Allocated: ${metric(metrics.totalQuota, ' GB')}${
            unlimitedQuota !== null && unlimitedQuota > 0
              ? ` · ${unlimitedQuota} company${unlimitedQuota === 1 ? '' : 'ies'} unlimited`
              : ''
          }`;

  return (
    <div className="space-y-6">
      {/* 1. Portfolio KPIs */}
      <PanelCard>
        <PanelHeader
          title="Portfolio"
          subtitle="Figures read live from the organization directory and storage catalog on this refresh."
        />

        {directoryError ? (
          <ReadFailure reason={directoryError} subject="company directory" onRetry={() => void reload()} />
        ) : null}

        {directoryLoading && !directoryError ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="p-6 rounded-3xl border border-slate-100 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col justify-between h-36 animate-pulse"
              >
                <div className="space-y-2">
                  <div className="h-8 w-20 bg-slate-100 rounded-lg" />
                  <div className="h-3 w-28 bg-slate-100 rounded" />
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-slate-100/80">
                  <div className="w-9 h-9 rounded-xl bg-slate-100" />
                  <div className="h-3 w-16 bg-slate-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <KpiCard
              label="Active Companies"
              value={metric(metrics.activeCount)}
              caption={directoryError ? 'unknown' : `of ${organizations.length} registered`}
              icon={<Building2 size={18} />}
            />
            <KpiCard
              label="Licensed Seats"
              value={metric(metrics.totalSeats)}
              caption={
                metrics.totalSeats === null
                  ? 'unknown'
                  : metrics.unlimitedSeatCount !== null && metrics.unlimitedSeatCount > 0
                    ? `Allocated · ${metrics.unlimitedSeatCount} company${metrics.unlimitedSeatCount === 1 ? '' : 'ies'} unlimited`
                    : 'Allocated across all clients'
              }
              icon={<Users size={18} />}
            />
            <KpiCard
              label="Storage Consumed"
              value={formatBytes(totalConsumedBytes)}
              caption={allocatedCaption}
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
      </PanelCard>

      {/* 2. Live Bar Chart: Storage Consumed vs. Allocated Quota */}
      <PanelCard>
        <PanelHeader
          title="Storage Consumed vs. Allocated Quota"
          subtitle="Comparison of physical storage consumed (GB) from file_inventory against allocated quota per company."
        />

        {storageError ? (
          <div className="mt-4">
            <ReadFailure reason={storageError} subject="storage inventory metrics" onRetry={() => void loadStorage()} />
          </div>
        ) : null}

        {isStorageLoading && !storageError ? (
          <div className="mt-6 p-6 rounded-2xl bg-white border border-slate-100 animate-pulse">
            <div className="h-56 flex items-end gap-6 px-6 py-4">
              {[40, 75, 25, 90, 60].map((h, i) => (
                <div key={i} className="flex-1 flex items-end gap-2 justify-center h-full">
                  <div className="w-8 bg-slate-200 rounded-t" style={{ height: `${h}%` }} />
                  <div className="w-8 bg-slate-100 rounded-t" style={{ height: `${Math.min(100, h + 15)}%` }} />
                </div>
              ))}
            </div>
            <div className="h-3 w-48 bg-slate-100 rounded mt-4" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 font-medium">
            No company storage data recorded yet.
          </div>
        ) : (
          <div className="mt-6">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 15, right: 20, left: 10, bottom: 25 }}
                  barSize={chartData.length > 8 ? 20 : 32}
                  barGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    interval={0}
                    angle={chartData.length > 3 ? -15 : 0}
                    textAnchor={chartData.length > 3 ? 'end' : 'middle'}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    unit={` ${storageUnit}`}
                    allowDecimals={true}
                  />
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload as {
                        fullName: string;
                        clientCode: string;
                        consumedBytes: number;
                        allocatedGb: number | null;
                        filesCount: number;
                      };
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl text-xs space-y-1.5 select-none pointer-events-none border border-slate-800">
                          <div className="font-bold border-b border-slate-700/80 pb-1.5 text-slate-100 flex items-center justify-between gap-3">
                            <span>{d.fullName}</span>
                            {d.clientCode && d.clientCode !== '—' && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                                {d.clientCode}
                              </span>
                            )}
                          </div>
                          <div className="text-slate-300 flex items-center justify-between gap-4 pt-0.5">
                            <span className="text-slate-400">Consumed:</span>
                            <span className="font-semibold text-white">
                              {formatBytes(d.consumedBytes)}{' '}
                              <span className="text-slate-400 font-normal">({d.filesCount.toLocaleString()} files)</span>
                            </span>
                          </div>
                          <div className="text-slate-300 flex items-center justify-between gap-4">
                            <span className="text-slate-400">Allocated Quota:</span>
                            <span className="font-semibold text-white">
                              {typeof d.allocatedGb === 'number' && d.allocatedGb > 0
                                ? `${d.allocatedGb} GB`
                                : 'Uncapped / Not set'}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ paddingBottom: 15, fontSize: 12 }}
                  />
                  <Bar
                    dataKey="consumedVal"
                    name={`Consumed Storage (${storageUnit})`}
                    fill="#0f172a"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="allocatedVal"
                    name={`Allocated Quota (${storageUnit})`}
                    fill="#94a3b8"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[11px] text-slate-500 font-medium mt-3 leading-relaxed">
              Bars represent live measurements. Consumed storage reflects actual bytes stored in the system buckets (<code className="text-slate-700">MMS_PIC</code>, <code className="text-slate-700">panoramas</code>, <code className="text-slate-700">road-analysis-geometry</code>).
            </p>
          </div>
        )}
      </PanelCard>

      {/* 3. Company Directory & Bucket Storage Console (Unified Table) */}
      <PanelCard>
        <PanelHeader
          title="Company Directory & Bucket Storage Console"
          subtitle="Every tenant on this platform — plan, seats, live storage usage and per-bucket breakdown."
          actions={
            <button
              type="button"
              onClick={onOpenCompanies}
              className="text-xs font-bold text-slate-900 hover:underline cursor-pointer"
            >
              Manage all ({organizations.length})
            </button>
          }
        />

        {directoryError ? (
          <ReadFailure reason={directoryError} subject="company directory" onRetry={() => void reload()} />
        ) : null}

        {directoryLoading && !directoryError ? (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
            <div className="p-4 space-y-3 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-slate-50 border border-slate-100 rounded-xl" />
              ))}
            </div>
          </div>
        ) : null}

        {!directoryLoading && !directoryError && organizations.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">
            No companies are registered yet. Open the Companies tab to register the first client.
          </p>
        ) : null}

        {!directoryLoading && !directoryError && organizations.length > 0 ? (
          <ConsoleCompanyStorageTable
            organizations={organizations}
            breakdown={breakdown}
            storageError={storageError}
            isStorageLoading={isStorageLoading}
          />
        ) : null}
      </PanelCard>

      {/* 4. Staffing Notice */}
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
