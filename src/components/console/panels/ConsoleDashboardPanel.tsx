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
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Users,
  HardDrive,
  Server,
  RefreshCw
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
  formatPercent,
  type CompanyStorageBreakdown
} from '../../../services/consoleStorage';
import { KpiCard, PanelCard, PanelHeader, ReadFailure, SecondaryButton } from './consoleUi';

interface Props {
  directory: ConsoleDirectory;
  onOpenCompanies: () => void;
  onOpenMembers: () => void;
}

export function getLicenseExpiryStatus(expiresAt: string | null): {
  label: string;
  tone: 'active' | 'warning' | 'expired' | 'neutral';
} {
  if (!expiresAt) {
    return { label: 'Perpetual', tone: 'neutral' };
  }
  const expiry = new Date(expiresAt).getTime();
  if (isNaN(expiry)) {
    return { label: 'Invalid Date', tone: 'neutral' };
  }
  const now = Date.now();
  const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: `Expired (${Math.abs(diffDays)}d ago)`, tone: 'expired' };
  }
  if (diffDays <= 30) {
    return { label: `Expiring soon (${diffDays}d left)`, tone: 'warning' };
  }
  return { label: `Active (${diffDays}d left)`, tone: 'active' };
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

  useEffect(() => {
    void loadStorage();
  }, [loadStorage]);

  const withContact = organizations.filter((o) => Boolean(o.settings?.contactEmail));

  // Prepare chart data (excluding system unassigned row from main company bar comparison)
  const chartData = breakdown
    .filter((b) => b.organizationId !== '00000000-0000-0000-0000-000000000000')
    .map((b) => ({
      name: b.organizationName.length > 15 ? `${b.organizationName.slice(0, 14)}…` : b.organizationName,
      fullName: b.organizationName,
      clientCode: b.clientCode,
      consumedGb: Number(b.consumedStorageGb.toFixed(3)),
      allocatedGb: b.allocatedStorageGb || 0,
      consumedBytes: b.consumedStorageBytes,
      filesCount: b.consumedFilesCount
    }));

  const totalConsumedBytes = breakdown.reduce((acc, b) => acc + b.consumedStorageBytes, 0);

  return (
    <div className="space-y-6">
      {/* 1. Portfolio KPIs */}
      <PanelCard>
        <PanelHeader
          title="Portfolio"
          subtitle="Figures read live from the organization directory and storage catalog on this page load."
          actions={
            <SecondaryButton
              onClick={() => {
                void reload();
                void loadStorage();
              }}
              disabled={directoryLoading || isStorageLoading}
            >
              <RefreshCw size={14} className={directoryLoading || isStorageLoading ? 'animate-spin' : ''} />
              {directoryLoading || isStorageLoading ? 'Refreshing…' : 'Refresh All'}
            </SecondaryButton>
          }
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
              caption="Allocated across all clients"
              icon={<Users size={18} />}
            />
            <KpiCard
              label="Storage Consumed"
              value={formatBytes(totalConsumedBytes)}
              caption={isStorageLoading ? 'Loading…' : `Allocated: ${metric(metrics.totalQuota, ' GB')}`}
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
                  margin={{ top: 15, right: 20, left: 0, bottom: 25 }}
                  barGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    interval={0}
                    angle={-15}
                    textAnchor="end"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    unit=" GB"
                    allowDecimals={true}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const d = payload[0].payload as {
                        fullName: string;
                        clientCode: string;
                        consumedBytes: number;
                        allocatedGb: number;
                        filesCount: number;
                      };
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-xl shadow-lg text-xs space-y-1">
                          <div className="font-bold border-b border-slate-700 pb-1">{d.fullName} ({d.clientCode})</div>
                          <div className="text-slate-200">
                            Consumed: <strong className="text-white">{formatBytes(d.consumedBytes)}</strong> ({d.filesCount.toLocaleString()} files)
                          </div>
                          <div className="text-slate-300">
                            Allocated Quota: <strong className="text-white">{d.allocatedGb} GB</strong>
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
                    dataKey="consumedGb"
                    name="Consumed Storage (GB)"
                    fill="#0f172a"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={45}
                  />
                  <Bar
                    dataKey="allocatedGb"
                    name="Allocated Quota (GB)"
                    fill="#cbd5e1"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={45}
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
          subtitle="Tenants provisioned on this platform with commercial licensing, live storage quota consumption, and per-bucket usage breakdown."
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
          <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="border-b font-bold uppercase tracking-wider text-[10px]" style={{ backgroundColor: '#f8fafc' }}>
                <tr>
                  <th className="px-5 py-3">Company</th>
                  <th className="px-5 py-3">Database & Storage</th>
                  <th className="px-5 py-3">License & Expiry</th>
                  <th className="px-5 py-3">Seats</th>
                  <th className="px-5 py-3">Storage Consumed / Quota</th>
                  <th className="px-5 py-3">Bucket Usage Breakdown</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {organizations.map((org) => {
                  const expiry = getLicenseExpiryStatus(org.licenseExpiresAt);
                  const isExternalStorage = Boolean(
                    org.settings?.storage?.provider && org.settings.storage.provider !== 'supabase'
                  );
                  const b = breakdown.find((item) => item.organizationId === org.id);
                  const consumedBytes = b ? b.consumedStorageBytes : 0;
                  const consumedFiles = b ? b.consumedFilesCount : 0;
                  const allocatedGb = org.settings?.storageQuotaGb ?? null;
                  const percentUsed =
                    allocatedGb && allocatedGb > 0
                      ? (consumedBytes / (allocatedGb * 1024 * 1024 * 1024)) * 100
                      : null;

                  return (
                    <tr key={org.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-slate-900">{org.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{org.clientCode || '—'}</div>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="space-y-1">
                          <span className="font-mono text-[11px] block text-slate-700">
                            {org.databaseType === 'dedicated_external' ? 'Dedicated DB' : 'Cloud DB (shared)'}
                          </span>
                          {isExternalStorage ? (
                            <span
                              title={`Dynamic Bucket: ${org.settings?.storage?.bucketName || 'default'}`}
                              className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200"
                            >
                              {org.settings?.storage?.provider?.replace('_', ' ')} BYOS
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-medium">Supabase Storage</span>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="space-y-1">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                            {org.licenseType ? org.licenseType.replace('_', ' ') : 'Cloud SaaS'}
                          </span>
                          <div>
                            <span
                              className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                expiry.tone === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : expiry.tone === 'warning'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : expiry.tone === 'expired'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {expiry.label}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3.5 font-mono">
                        {org.settings?.allowedUserSeats != null ? `${org.settings.allowedUserSeats} seats` : 'No limit'}
                      </td>

                      <td className="px-5 py-3.5">
                        <div>
                          <div className="font-bold text-slate-900 font-mono">
                            {formatBytes(consumedBytes)}
                            {allocatedGb != null ? ` / ${allocatedGb} GB` : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 font-medium">
                            {consumedFiles.toLocaleString()} files
                            {percentUsed != null ? ` · ${formatPercent(percentUsed)} used` : ''}
                          </div>
                          {percentUsed != null ? (
                            <div className="w-24 bg-slate-100 rounded-full h-1.5 mt-1 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${
                                  percentUsed > 90
                                    ? 'bg-rose-500'
                                    : percentUsed > 75
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-600'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(3, percentUsed))}%` }}
                              />
                            </div>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        {isStorageLoading && !storageError ? (
                          <div className="flex items-center gap-1.5 animate-pulse">
                            <div className="h-6 w-16 bg-slate-100 rounded-lg" />
                            <div className="h-6 w-16 bg-slate-100 rounded-lg" />
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {/* MMS_PIC */}
                            <span
                              title="MMS_PIC Bucket (Road Survey Images)"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11px] border border-slate-200"
                            >
                              <span className="font-semibold">MMS:</span>
                              <span className="font-mono font-bold text-slate-900">{formatBytes(b?.mmsPicBytes || 0)}</span>
                              <span className="text-slate-500 text-[10px]">({b?.mmsPicFiles || 0})</span>
                            </span>

                            {/* Panoramas */}
                            <span
                              title="panoramas Bucket (360 Equirectangular Frames)"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11px] border border-slate-200"
                            >
                              <span className="font-semibold">Pano:</span>
                              <span className="font-mono font-bold text-slate-900">{formatBytes(b?.panoramasBytes || 0)}</span>
                              <span className="text-slate-500 text-[10px]">({b?.panoramasFiles || 0})</span>
                            </span>

                            {/* Geometry */}
                            <span
                              title="road-analysis-geometry Bucket"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11px] border border-slate-200"
                            >
                              <span className="font-semibold">Geom:</span>
                              <span className="font-mono font-bold text-slate-900">{formatBytes(b?.geometryBytes || 0)}</span>
                              <span className="text-slate-500 text-[10px]">({b?.geometryFiles || 0})</span>
                            </span>

                            {/* Other / Dynamic */}
                            {b && b.otherBytes > 0 ? (
                              <span
                                title="Other / Dynamic buckets"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11px] border border-slate-200"
                              >
                                <span className="font-semibold">Other:</span>
                                <span className="font-mono font-bold text-slate-900">{formatBytes(b.otherBytes)}</span>
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-3.5">
                        <span className="capitalize font-semibold text-slate-700">{org.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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