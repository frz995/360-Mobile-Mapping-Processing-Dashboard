import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Bug,
  Info,
  Trash2,
  Clock,
  Eye,
  ChevronDown,
  ChevronRight,
  Server,
  Zap
} from 'lucide-react';
import {
  subscribeReports,
  getReports,
  clearReports,
  type ReportEntry
} from '../lib/report';
import { isSentryEnabled } from '../lib/sentry';
import { testDatabaseHealth } from '../services/supabase';
const LEVEL_STYLES: Record<string, { color: string; icon: React.ReactNode }> = {
  error: { color: 'text-rose-400', icon: <Bug size={12} /> },
  warn:  { color: 'text-amber-400', icon: <AlertTriangle size={12} /> },
  info:  { color: 'text-sky-400', icon: <Info size={12} /> },
  debug: { color: 'text-text-muted', icon: <Eye size={12} /> }
};

const VITE_ENV_KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SENTRY_DSN',
  'VITE_MAP_URL',
  'VITE_R2_ACCOUNT_ID',
  'VITE_R2_BUCKET',
  'VITE_PSV_SERVER_URL'
] as const;

export const DiagnosticsPanel: React.FC<{ cardBg?: string }> = ({ cardBg = 'bg-card border border-subtle' }) => {
  const [entries, setEntries] = useState<ReportEntry[]>(() => getReports());
  const [pingLoading, setPingLoading] = useState(false);
  const [pingResult, setPingResult] = useState<{
    ok: boolean;
    latencyMs: number;
    postgisStatus: string;
    storageStatus: string;
    webgisStatus: string;
    realtimeStatus: string;
    memoryUsageMb: number;
    lastPingTime: string;
  } | null>(null);
  const [envExpanded, setEnvExpanded] = useState(false);

  useEffect(() => {
    return subscribeReports((snap) => setEntries(snap));
  }, []);

  const handlePing = useCallback(async () => {
    setPingLoading(true);
    try {
      const res = await testDatabaseHealth();
      setPingResult({
        ok: res.postgisStatus !== 'offline',
        latencyMs: res.postgisLatencyMs ?? 0,
        postgisStatus: res.postgisStatus,
        storageStatus: res.storageStatus,
        webgisStatus: res.webgisStatus,
        realtimeStatus: res.realtimeStatus,
        memoryUsageMb: res.memoryUsageMb,
        lastPingTime: res.lastPingTime
      });
    } catch {
      setPingResult({ ok: false, latencyMs: 0, postgisStatus: 'offline', storageStatus: 'offline', webgisStatus: 'offline', realtimeStatus: 'disconnected', memoryUsageMb: 0, lastPingTime: new Date().toISOString() });
    } finally {
      setPingLoading(false);
    }
  }, []);

  const handleClearBuffer = useCallback(() => {
    clearReports();
    setEntries([]);
  }, []);

  const recentEntries = entries.slice(-80).reverse();
  const sentryActive = isSentryEnabled();

  return (
    <div className="space-y-4 animate-panel-enter">

      {/* Supabase Ping Card */}
      <div className={`${cardBg} rounded-2xl p-4`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-sky-400" />
            <div>
              <h4 className="text-xs font-bold text-text-base uppercase tracking-wide">Supabase Latency</h4>
              <p className="text-[11px] text-text-muted mt-0.5">Ping the database and measure round-trip latency.</p>
            </div>
          </div>
          <button
            onClick={handlePing}
            disabled={pingLoading}
            className="px-3 py-1.5 bg-inner hover:bg-sky-950/60 border border-subtle rounded-lg text-xs font-semibold text-sky-400 flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
          >
            {pingLoading ? (
              <><Activity size={12} className="animate-spin" /> Pinging…</>
            ) : (
              <><Zap size={12} /> Ping</>
            )}
          </button>
        </div>
        {pingResult && (
          <>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono ${pingResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
              {pingResult.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              <span>{pingResult.ok ? `Connected` : 'Connection failed'}</span>
              <span className="ml-auto text-text-muted">{pingResult.latencyMs} ms</span>
            </div>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="px-3 py-2 rounded-lg bg-inner/60 border border-subtle/40 flex items-center gap-1.5">
                <span className="text-text-muted">PostGIS</span>
                <span className={`ml-auto font-semibold ${pingResult.postgisStatus === 'operational' ? 'text-emerald-400' : pingResult.postgisStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400'}`}>{pingResult.postgisStatus}</span>
              </div>
              <div className="px-3 py-2 rounded-lg bg-inner/60 border border-subtle/40 flex items-center gap-1.5">
                <span className="text-text-muted">Storage</span>
                <span className={`ml-auto font-semibold ${pingResult.storageStatus === 'operational' ? 'text-emerald-400' : pingResult.storageStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400'}`}>{pingResult.storageStatus}</span>
              </div>
              <div className="px-3 py-2 rounded-lg bg-inner/60 border border-subtle/40 flex items-center gap-1.5">
                <span className="text-text-muted">WebGIS</span>
                <span className={`ml-auto font-semibold ${pingResult.webgisStatus === 'online' ? 'text-emerald-400' : pingResult.webgisStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400'}`}>{pingResult.webgisStatus}</span>
              </div>
              <div className="px-3 py-2 rounded-lg bg-inner/60 border border-subtle/40 flex items-center gap-1.5">
                <span className="text-text-muted">Realtime</span>
                <span className={`ml-auto font-semibold ${pingResult.realtimeStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}`}>{pingResult.realtimeStatus}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-text-muted font-mono">
              <span className="flex items-center gap-1"><Clock size={10} /> Last ping: {pingResult.lastPingTime ? new Date(pingResult.lastPingTime).toLocaleTimeString() : '—'}</span>
              <span className="flex items-center gap-1"><Server size={10} /> Mem: {pingResult.memoryUsageMb} MB</span>
            </div>
          </>
        )}
      </div>

      {/* Sentry / Telemetry Status */}
      <div className={`${cardBg} rounded-2xl p-4`}>
        <div className="flex items-center gap-2 mb-2">
          <Server size={16} className="text-sky-400" />
          <h4 className="text-xs font-bold text-text-base uppercase tracking-wide">Telemetry Status</h4>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono bg-inner/60 border border-subtle">
          <span className={`w-2 h-2 rounded-full ${sentryActive ? 'bg-emerald-400' : 'bg-text-muted/40'}`} />
          <span className="text-text-base">Sentry</span>
          <span className="ml-auto text-text-muted">{sentryActive ? 'Enabled' : 'Disabled (no DSN)'}</span>
        </div>
        <p className="text-[11px] text-text-muted mt-2">Runtime environment: <code className="text-sky-400">{import.meta.env.MODE || 'development'}</code></p>
      </div>

      {/* In-Memory Error Buffer */}
      <div className={`${cardBg} rounded-2xl p-4`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bug size={16} className="text-sky-400" />
            <div>
              <h4 className="text-xs font-bold text-text-base uppercase tracking-wide">Error Buffer</h4>
              <p className="text-[11px] text-text-muted mt-0.5">
                Last {recentEntries.length} of {entries.length} in-memory entries (ring buffer, max 500).
              </p>
            </div>
          </div>
          {entries.length > 0 && (
            <button
              onClick={handleClearBuffer}
              className="px-2.5 py-1.5 bg-inner hover:bg-rose-950/40 border border-subtle rounded-lg text-xs font-semibold text-text-muted hover:text-rose-400 flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Trash2 size={11} /> Clear
            </button>
          )}
        </div>

        {recentEntries.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4">Buffer is empty — no errors or warnings recorded yet.</p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {recentEntries.map((e) => {
              const style = LEVEL_STYLES[e.level] || LEVEL_STYLES.debug;
              return (
                <div key={e.id} className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-inner/40 border border-subtle/40 text-[11px] font-mono leading-tight">
                  <span className={style.color}>{style.icon}</span>
                  <span className="text-text-muted shrink-0 mt-0.5">{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="text-text-base break-all flex-1">{e.message}</span>
                  {e.origin && <span className="text-text-muted shrink-0">[{e.origin}]</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Runtime Environment */}
      <div className={`${cardBg} rounded-2xl p-4`}>
        <button
          onClick={() => setEnvExpanded(!envExpanded)}
          className="flex items-center gap-2 w-full text-left cursor-pointer"
        >
          {envExpanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
          <Eye size={16} className="text-sky-400" />
          <h4 className="text-xs font-bold text-text-base uppercase tracking-wide">Runtime Environment</h4>
          <span className="ml-auto text-[10px] text-text-muted">read-only</span>
        </button>

        {envExpanded && (
          <div className="mt-3 space-y-1.5">
            {VITE_ENV_KEYS.map((key) => {
              const raw = import.meta.env[key] as string | undefined;
              const display = raw ? (raw.length > 40 ? raw.slice(0, 8) + '…' + raw.slice(-6) : raw) : '— not set —';
              return (
                <div key={key} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-inner/40 border border-subtle/40 text-[11px]">
                  <span className="font-mono text-text-muted">{key}</span>
                  <span className="font-mono text-text-base truncate ml-3" title={raw || ''}>{display}</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-inner/40 border border-subtle/40 text-[11px]">
              <span className="font-mono text-text-muted">import.meta.env.MODE</span>
              <span className="font-mono text-text-base">{import.meta.env.MODE || 'development'}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-inner/40 border border-subtle/40 text-[11px]">
              <span className="font-mono text-text-muted">navigator.userAgent</span>
              <span className="font-mono text-text-base truncate ml-3" title={navigator.userAgent}>{navigator.userAgent.slice(0, 60)}…</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
