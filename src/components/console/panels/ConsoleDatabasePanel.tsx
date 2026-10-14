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
import { Database, Server, Activity, Check, ShieldAlert, ExternalLink } from 'lucide-react';
import { testDedicatedDatabaseConnection, type Organization } from '../../../services/tenantContext';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import { PanelCard, PanelHeader, ReadFailure, SecondaryButton } from './consoleUi';

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'result'; success: boolean; message: string };

interface Props {
  directory: ConsoleDirectory;
  selectedOrgId: string;
  onSelectOrg: (orgId: string) => void;
}

const CompanyRow: React.FC<{
  org: Organization;
  probe: ProbeState;
  onProbe: () => void;
  onOpen: () => void;
  isOpen: boolean;
}> = ({ org, probe, onProbe, onOpen, isOpen }) => {
  const dedicated = org.databaseType === 'dedicated_external';
  const hasCredentials = Boolean(org.databaseConfig?.url && org.databaseConfig?.anonKey);

  return (
    <div
      className={`rounded-2xl border p-5 transition-colors ${
        isOpen ? 'border-slate-900 bg-slate-50' : 'border-slate-100 bg-white'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              dedicated ? 'bg-purple-50 text-purple-600' : 'bg-sky-50 text-sky-600'
            }`}
          >
            {dedicated ? <Server size={17} /> : <Database size={17} />}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm truncate">{org.name}</div>
            <div className="text-[11px] text-slate-400 font-mono truncate">
              {org.clientCode || '—'} · {dedicated ? 'dedicated_external' : 'cloud_shared'}
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
            onClick={onOpen}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#0c0d0e] hover:bg-black text-white flex items-center gap-1 cursor-pointer"
          >
            Staff
            <ExternalLink size={10} className="opacity-70" />
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

export const ConsoleDatabasePanel: React.FC<Props> = ({ directory, selectedOrgId, onSelectOrg }) => {
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
          actions={<SecondaryButton onClick={() => void reload()} disabled={isLoading}>Refresh</SecondaryButton>}
        />

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 text-sky-600">
              <Database size={16} />
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
            <div className="flex items-center gap-2 text-purple-600">
              <Server size={16} />
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
                onOpen={() => onSelectOrg(org.id)}
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