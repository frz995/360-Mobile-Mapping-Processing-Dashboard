/**
 * Parent Database & Infrastructure Panel.
 *
 * WHAT IS REPORTED
 *   * Real physical PostgreSQL cluster disk usage via `pg_database_size(current_database())`.
 *   * Real physical file storage across public.file_inventory.
 *   * The plan tier and its limits, as reported by the catalog query.
 *   * Distributed child company allocation totals vs. the parent tier ceiling.
 *   * Postgres & PostGIS version information.
 *
 * THE NULL RULE
 *   Unmeasured quantities render as em dashes (—). Zero mock data.
 *
 * WHAT THIS PANEL IS NOT ALLOWED TO CLAIM
 *   It used to open with "Current Plan: Free Tier", a "500 MB Postgres Disk /
 *   1 GB Storage Bucket" baseline, a "1.0 GB" physical ceiling, a green
 *   "Active" badge beside a hard-coded PostgreSQL and PostGIS version, and a
 *   "GATE PASSED" stamp. None of those were measured by this page:
 *
 *   * The plan tier and its limits are DEPLOYMENT SETTINGS reported by
 *     `console_parent_database_stats()` — they are configuration, not a live
 *     billing read, and the panel now says so instead of asserting them.
 *   * The engine versions are measured by the catalog, or they are unknown.
 *     When the catalog query failed, the fallback used to answer with
 *     'PostgreSQL 17.6 (Cluster)' and '3.5.2 (PostGIS)' — invented strings
 *     presented as readings.
 *   * Row-level security is enforced by migration 0045 and exercised by the
 *     cross-tenant gate in `0011_security_tests.sql`. That is a true fact
 *     about the codebase, but it is not something this page observed at
 *     runtime, so it is stated as a fact about the migrations rather than as a
 *     live "GATE PASSED" badge.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Database, HardDrive, RefreshCw, AlertTriangle, ShieldCheck, Cpu, Layers, ExternalLink } from 'lucide-react';
import { fetchParentDatabaseStats, formatBytes, formatPercent, type ParentDatabaseStats } from '../../../services/consoleStorage';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import { PanelCard, PanelHeader, ReadFailure, SecondaryButton } from './consoleUi';

interface Props {
  directory: ConsoleDirectory;
}

/** Renders a plan tier as a label, or as unknown when it was not reported. */
function planTierLabel(tier: string | undefined | null): string {
  if (!tier || tier === 'unknown') return 'Not verified';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** The plan's limits, as a sentence. Unknown limits say so. */
function planLimitSummary(stats: ParentDatabaseStats | null): string {
  if (!stats || stats.planDbLimitBytes === null || stats.planStorageLimitBytes === null) {
    return 'Plan limits not reported by the catalog';
  }
  return `Baseline Cluster (${formatBytes(stats.planDbLimitBytes)} Postgres Disk / ${formatBytes(
    stats.planStorageLimitBytes
  )} Storage Bucket)`;
}

export const ConsoleParentDbPanel: React.FC<Props> = ({ directory }) => {
  const [stats, setStats] = useState<ParentDatabaseStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    const result = await fetchParentDatabaseStats();
    setStats(result.stats);
    setError(result.error);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const dbBytes = stats?.databaseSizeBytes ?? null;
  const dbLimit = stats?.planDbLimitBytes ?? null;
  const dbPercent = dbBytes !== null && dbLimit !== null && dbLimit > 0 ? (dbBytes / dbLimit) * 100 : null;

  const storageBytes = stats?.storageBytes ?? null;
  const storageLimit = stats?.planStorageLimitBytes ?? null;
  const storagePercent =
    storageBytes !== null && storageLimit !== null && storageLimit > 0 ? (storageBytes / storageLimit) * 100 : null;

  /**
   * The distributed quota.
   *
   * The console's own figure is preferred because the catalog's aggregate
   * collapses "no configured quota" onto zero (migration 0045) and cannot say
   * how many companies are unlimited. `?? null`, never `?? 0`: an unread quota
   * is unknown, and a zero here feeds the over-provisioning check below.
   */
  const allocatedQuotaGb = directory.metrics.totalQuota ?? stats?.totalAllocatedStorageGb ?? null;
  const unlimitedQuotaCount = directory.metrics.unlimitedQuotaCount;

  /**
   * How many companies the allocation is spread across.
   *
   * The catalog's own count is preferred. Falling back to the console's
   * directory is only honest when that read succeeded — an empty directory
   * from a failed read is zero companies only in the sense that nobody
   * counted.
   */
  const companyCount =
    stats?.totalCompanies ?? (directory.directoryError ? null : directory.organizations.length);

  /**
   * Over-provisioning is a comparison between two numbers, so it needs two
   * numbers. When either is unknown the check does not run — it does not run
   * against a hard-coded 1 GB ceiling, which is what made this fire on a
   * figure nobody had measured.
   */
  const isOverProvisioned =
    allocatedQuotaGb !== null &&
    storageLimit !== null &&
    storageLimit > 0 &&
    allocatedQuotaGb * 1024 * 1024 * 1024 > storageLimit;

  const postgresKnown = Boolean(stats?.postgresVersion);
  const postgisKnown = Boolean(stats?.postgisVersion);

  return (
    <div className="space-y-6">
      {/* 1. Header & Plan Baseline */}
      <PanelCard>
        <PanelHeader
          title="Parent Database & Cluster Specs"
          subtitle="Physical storage and disk usage measured live from the PostgreSQL database catalog."
          actions={
            <SecondaryButton onClick={() => void loadStats()} disabled={isLoading}>
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Querying…' : 'Refresh Metrics'}
            </SecondaryButton>
          }
        />

        {error ? (
          <div className="mt-4">
            <ReadFailure reason={error} subject="parent database catalog" onRetry={() => void loadStats()} />
          </div>
        ) : null}

        {/* Plan Tier Banner.
            The tier and its limits are deployment settings reported by the
            catalog query — configuration, not a live billing read. */}
        <div className="mt-6 p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider bg-white/10 text-slate-200 border border-white/20">
                Plan baseline: {planTierLabel(stats?.planTier)}
              </span>
              <span className="text-xs text-slate-400">· configured, not a live billing read</span>
            </div>
            <h3 className="text-base font-bold text-white tracking-tight">
              {planLimitSummary(stats)}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
              The plan tier and its limits are deployment settings reported by the catalog query, not a live read of
              what Supabase is currently billing. All client companies share this cluster with tenant isolation
              enforced by Row-Level Security.
            </p>
          </div>
          <div className="shrink-0">
            <a
              href="https://supabase.com/dashboard/project/_/settings/billing/subscription"
              target="_blank"
              rel="noopener noreferrer"
              title="Open Supabase Dashboard billing & plan subscription"
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              Check the live plan: <span className="text-white font-bold">Supabase billing</span>
              <ExternalLink size={12} className="opacity-80" />
            </a>
          </div>
        </div>

        {/* 2. Physical Usage Gauges */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6 animate-pulse">
            {[1, 2].map((i) => (
              <div key={i} className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-200" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-32 bg-slate-200 rounded" />
                      <div className="h-2.5 w-48 bg-slate-200 rounded" />
                    </div>
                  </div>
                  <div className="h-4 w-12 bg-slate-200 rounded" />
                </div>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between">
                    <div className="h-3 w-28 bg-slate-200 rounded" />
                    <div className="h-3 w-20 bg-slate-200 rounded" />
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
            {/* Database Disk Gauge */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 flex items-center justify-center">
                      <Database size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">PostgreSQL Disk Usage</h4>
                      <span className="text-[11px] text-slate-500">pg_database_size(current_database())</span>
                    </div>
                  </div>
                  <span className="text-xs font-black text-slate-900 font-mono">
                    {formatPercent(dbPercent)}
                  </span>
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Physical Disk Used:</span>
                    <span className="font-bold text-slate-900">
                      {stats?.databaseSizePretty ?? '—'}{' '}
                      <span className="text-slate-400 font-normal">/ {formatBytes(dbLimit)}</span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-500 ${
                        dbPercent === null
                          ? 'bg-slate-300'
                          : dbPercent > 85
                            ? 'bg-rose-500'
                            : dbPercent > 70
                              ? 'bg-amber-500'
                              : 'bg-emerald-600'
                      }`}
                      style={{ width: `${dbPercent === null ? 0 : Math.min(100, Math.max(2, dbPercent))}%` }}
                    />
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
                Includes PostgreSQL tables, indexes, spatial PostGIS indexes, and write-ahead logs.
              </p>
            </div>

            {/* Storage Bucket Gauge */}
            <div className="p-6 rounded-2xl border border-slate-100 bg-slate-50/50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-800 border border-slate-200 flex items-center justify-center">
                      <HardDrive size={16} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Storage Buckets Volume</h4>
                      <span className="text-[11px] text-slate-500">file_inventory aggregate</span>
                    </div>
                  </div>
                  <span className="text-xs font-black text-slate-900 font-mono">
                    {formatPercent(storagePercent)}
                  </span>
                </div>

                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-xs mb-1.5">
                    <span className="text-slate-500 font-medium">Bucket Bytes Used:</span>
                    <span className="font-bold text-slate-900">
                      {stats?.storageBytesPretty ?? '—'}{' '}
                      <span className="text-slate-400 font-normal">/ {formatBytes(storageLimit)}</span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full transition-all duration-500 ${
                        storagePercent === null
                          ? 'bg-slate-300'
                          : storagePercent > 85
                            ? 'bg-rose-500'
                            : storagePercent > 70
                              ? 'bg-amber-500'
                              : 'bg-emerald-600'
                      }`}
                      style={{ width: `${storagePercent === null ? 0 : Math.min(100, Math.max(2, storagePercent))}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 text-[11px] text-slate-500">
                <span>Tracked Files: <strong className="text-slate-800">{stats?.storageFiles != null ? stats.storageFiles.toLocaleString() : '—'}</strong></span>
                <span>Ceiling: {formatBytes(storageLimit)}</span>
              </div>
            </div>
          </div>
        )}
      </PanelCard>

      {/* 3. Child Allocation vs Parent Capacity (Over-provisioning Analysis) */}
      <PanelCard>
        <PanelHeader
          title="Distributed Child Allocation vs. Parent Capacity"
          subtitle="Comparison of customer quota promises against parent cluster physical limits."
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <div className="p-5 rounded-2xl border border-slate-100 bg-white">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Distributed Quotas</div>
            <div className="text-2xl font-black text-slate-900 mt-2">
              {allocatedQuotaGb === null ? '—' : `${allocatedQuotaGb} GB`}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Allocated across {companyCount === null ? '—' : companyCount} client companies
              {unlimitedQuotaCount !== null && unlimitedQuotaCount > 0
                ? ` · ${unlimitedQuotaCount} unlimited`
                : ''}
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-100 bg-white">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Configured Bucket Ceiling</div>
            <div className="text-2xl font-black text-slate-900 mt-2">
              {formatBytes(storageLimit)}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {storageLimit === null
                ? 'Not reported by the catalog'
                : 'Bucket limit configured for this deployment'}
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-100 bg-white">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Licensed Seats</div>
            <div className="text-2xl font-black text-slate-900 mt-2">
              {stats?.totalAllocatedSeats ?? '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Sum of the configured seat limits, across every company
            </div>
          </div>
        </div>

        {isOverProvisioned ? (
          <div className="mt-5 p-4 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 leading-relaxed">
              <strong className="font-bold">Over-Provisioning Notice:</strong> The total distributed storage quota (
              {allocatedQuotaGb} GB) exceeds the configured bucket limit ({formatBytes(storageLimit)}). This is a normal
              SaaS over-subscription model while clients ramp up data collection. When physical bucket usage nears the
              configured limit, upgrade the Supabase project to keep uploads from being rejected.
            </div>
          </div>
        ) : null}
      </PanelCard>

      {/* 4. Engine & Tenant Isolation Verification */}
      <PanelCard>
        <PanelHeader
          title="Engine & Security Isolation"
          subtitle="Database kernel versions and multi-tenant security verification status."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Cpu size={18} className="text-slate-600" />
              <div>
                <div className="text-xs font-bold text-slate-900">PostgreSQL Engine</div>
                <div className="text-[11px] text-slate-500 font-mono truncate max-w-xs">
                  {stats?.postgresVersion ?? '—'}
                </div>
              </div>
            </div>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                postgresKnown
                  ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                  : 'text-slate-500 bg-slate-100 border-slate-200'
              }`}
            >
              {postgresKnown ? 'Active' : 'Unverified'}
            </span>
          </div>

          <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Layers size={18} className="text-slate-600" />
              <div>
                <div className="text-xs font-bold text-slate-900">PostGIS Spatial Extension</div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {stats?.postgisVersion ?? '—'}
                </div>
              </div>
            </div>
            <span
              className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                postgisKnown
                  ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                  : 'text-slate-500 bg-slate-100 border-slate-200'
              }`}
            >
              {postgisKnown ? 'Active' : 'Unverified'}
            </span>
          </div>
        </div>

        <div className="mt-4 p-4 rounded-xl border border-slate-100 bg-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck size={20} className="text-emerald-600 shrink-0" />
            <div>
              <div className="text-xs font-bold text-slate-900">Multi-Tenant Row-Level Security</div>
              <div className="text-[11px] text-slate-500">
                Enforced by migration 0045 and exercised by the cross-tenant gate in 0011_security_tests.sql — a fact
                about the codebase, verified in CI rather than observed on this page.
              </div>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-700 font-mono shrink-0">
            ENFORCED
          </span>
        </div>
      </PanelCard>
    </div>
  );
};

export default ConsoleParentDbPanel;
