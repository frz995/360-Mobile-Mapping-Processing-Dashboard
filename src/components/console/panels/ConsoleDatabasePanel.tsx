/**
 * Database Hub — where each company is routed.
 *
 * WHAT IS REPORTED, AND WHAT IS NOT
 *   Two facts per company, both verifiable:
 *     * the routing mode recorded on the organization row, and
 *     * for a dedicated instance, a live reachability check the operator asks
 *       for by pressing the button.
 *
 *   What is deliberately absent: any statement about the shared cloud cluster.
 *   The previous console sidebar claimed `Row-Level Security 100% Active`,
 *   `Gateway SLA 99.98%`, `Edge Ingestion Cloud + NAS`, `HEALTHY` and
 *   `RLS Isolation Verified` as static text. Nothing measured any of it. A
 *   postmortem page that cannot go red is worse than no postmortem page.
 *
 *   `console_organization_seat_summary` and `0011_security_tests.sql` prove the
 *   RLS boundary on a real database. That is where that claim belongs, and it is
 *   asserted there rather than printed here.
 */

import React from 'react';
import { Database, Server, Activity, Check, ShieldAlert, Users } from 'lucide-react';
import { testDedicatedDatabaseConnection, type Organization } from '../../../services/tenantContext';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import { PanelCard, PanelHeader, ReadFailure } from './consoleUi';
import { getLicenseExpiryStatus } from './consoleLicenseStatus';

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'result'; success: boolean; message: string };

interface Props {
  directory: ConsoleDirectory;
  selectedOrgId: string;
  onSelectOrg: (orgId: string) => void;
  onOpenMembers: (orgId: string) => void;
}

const CompanyRow: React.FC<{
  org: Organization;
  probe: ProbeState;
  onProbe: () => void;
  onOpenMembers: () => void;
  onSelect: () => void;
  isOpen: boolean;
}> = ({ org, probe, onProbe, onOpenMembers, onSelect, isOpen }) => {
  const dedicated = org.databaseType === 'dedicated_external';
  const hasCredentials = Boolean(org.databaseConfig?.url && org.databaseConfig?.anonKey);

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border p-5 transition-colors cursor-pointer ${
        isOpen ? 'border-slate-900 bg-slate-50' : 'border-slate-100 bg-white hover:border-slate-200'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-slate-100 text-slate-800 border border-slate-200">
            {dedicated ? <Server size={17} /> : <Database size={17} />}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm truncate">{org.name}</div>
            <div className="text-[11px] text-slate-400 font-mono truncate flex items-center gap-1.5 mt-0.5">
              <span>{org.clientCode || '—'}</span>
              <span>·</span>
              <span>{dedicated ? 'dedicated_external' : 'cloud_shared'}</span>
              <span>·</span>
              <span className="capitalize text-slate-700 font-sans font-semibold">
                {(org.licenseType || 'cloud_saas').replace('_', ' ')}
              </span>
              {org.licenseExpiresAt ? (
                (() => {
                  const exp = getLicenseExpiryStatus(org.licenseExpiresAt);
                  return (
                    <span
                      className={`font-sans text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                        exp.tone === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : exp.tone === 'warning'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : exp.tone === 'expired'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {exp.label}
                    </span>
                  );
                })()
              ) : (
                <span className="font-sans text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-500 font-medium">
                  Perpetual
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {dedicated ? (
            <>
              <span className="text-[11px] text-slate-500 font-semibold">
                {hasCredentials ? 'Credentials on file' : 'No credentials on file'}
              </span>
              <button
                type="button"
                onClick={onProbe}
                disabled={!hasCredentials || probe.kind === 'testing'}
                title={hasCredentials ? 'Send a live request to this instance' : 'Add credentials in Companies → Edit'}
                className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Activity size={12} className={probe.kind === 'testing' ? 'animate-spin' : ''} />
                {probe.kind === 'testing' ? 'Checking…' : 'Check Reachability'}
              </button>
            </>
          ) : (
            <span className="text-[11px] text-slate-500 font-semibold">
              Isolated by Row-Level Security on the shared cluster
            </span>
          )}
          <button
            type="button"
            onClick={onOpenMembers}
            title={`View team members for ${org.name}`}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#0c0d0e] hover:bg-black text-white flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Users size={12} />
            <span>Staff</span>
          </button>
        </div>
      </div>

      {probe.kind === 'result' ? (
        <div
          className={`mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-xs font-semibold ${
            probe.success ? 'text-emerald-600' : 'text-rose-600'
          }`}
        >
          {probe.success ? <Check size={13} /> : <ShieldAlert size={13} />}
          {probe.message}
        </div>
      ) : null}
    </div>
  );
};

export const ConsoleDatabasePanel: React.FC<Props> = ({ directory, selectedOrgId, onSelectOrg, onOpenMembers }) => {
  const { organizations, isLoading, directoryError, reload } = directory;
  const [probes, setProbes] = React.useState<Record<string, ProbeState>>({});

  const runProbe = async (org: Organization) => {
    setProbes((prev) => ({ ...prev, [org.id]: { kind: 'testing' } }));
    // A real request. The button is labelled Check Reachability and it checks.
    const result = await testDedicatedDatabaseConnection(
      org.databaseConfig?.url || '',
      org.databaseConfig?.anonKey || ''
    );
    setProbes((prev) => ({ ...prev, [org.id]: { kind: 'result', ...result } }));
  };

  const dedicated = organizations.filter((o) => o.databaseType === 'dedicated_external');
  const shared = organizations.filter((o) => o.databaseType !== 'dedicated_external');

  return (
    <div className="space-y-6">
      <PanelCard>
        <PanelHeader
          title="Database Routing"
          subtitle="Each company is either isolated on the shared cluster by RLS, or pointed at its own instance."
        />

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 text-slate-800">
              <Database size={16} className="text-slate-600" />
              <span className="text-xs font-bold uppercase tracking-wider">Cloud Shared (RLS)</span>
            </div>
            <div className="text-2xl font-black text-slate-900 mt-3">
              {directoryError ? '—' : shared.length}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Isolated by policy, not by connection. The cross-tenant boundary is asserted by
              <span className="font-mono"> 0011_security_tests.sql</span>, not by this page.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 text-slate-800">
              <Server size={16} className="text-slate-600" />
              <span className="text-xs font-bold uppercase tracking-wider">Dedicated Instance</span>
            </div>
            <div className="text-2xl font-black text-slate-900 mt-3">
              {directoryError ? '—' : dedicated.length}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Credentials are stored and never leave the database. Whether the client app connects to them is a
              separate, unfinished capability.
            </p>
          </div>
        </div>
      </PanelCard>

      <PanelCard>
        <PanelHeader title="Routing Table" subtitle="Per company, with a live reachability check for dedicated instances." />

        {directoryError ? (
          <ReadFailure reason={directoryError} subject="routing table" onRetry={() => void reload()} />
        ) : isLoading ? (
          <div className="space-y-3 mt-5 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-200" />
                  <div className="space-y-1.5">
                    <div className="h-4 w-36 bg-slate-200 rounded" />
                    <div className="h-3 w-48 bg-slate-100 rounded" />
                  </div>
                </div>
                <div className="h-7 w-24 bg-slate-200 rounded-xl" />
              </div>
            ))}
          </div>
        ) : organizations.length === 0 ? (
          <p className="py-10 text-center text-xs text-slate-500">No companies are registered yet.</p>
        ) : (
          <div className="space-y-3 mt-5">
            {organizations.map((org) => (
              <CompanyRow
                key={org.id}
                org={org}
                probe={probes[org.id] || { kind: 'idle' }}
                onProbe={() => void runProbe(org)}
                onOpenMembers={() => onOpenMembers(org.id)}
                onSelect={() => onSelectOrg(org.id)}
                isOpen={org.id === selectedOrgId}
              />
            ))}
          </div>
        )}
      </PanelCard>
    </div>
  );
};

export default ConsoleDatabasePanel;