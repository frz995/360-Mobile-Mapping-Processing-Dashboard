import React, { useState } from 'react';
import {
  Activity,
  ExternalLink,
  Monitor,
  Server,
  Terminal
} from 'lucide-react';
import { StatusDot } from '../chrome';
import { useStationAgents } from '../../../hooks/useStationAgents';
import {
  DEFAULT_4_WORKSTATIONS,
  type StationAgentObservation,
  type WorkstationStationConfig,
  type WorkstationStationId
} from '../../../types/production';

export interface PcMonitoringStationProps {
  projectSettings?: { workstationsConfig?: WorkstationStationConfig[] } & Record<string, unknown>;
  isGuestUser?: boolean;
  addNotification?: (item: { title: string; message: string; category?: string; read?: boolean }) => void;
  addAuditLog?: (type: string, title: string, details: string, status?: string) => void;
  userLabel: string;
}

const pct = (v?: number | null): string => (typeof v === 'number' ? `${Math.round(v)}%` : '—');

const usageColor = (v?: number | null): string =>
  typeof v !== 'number' ? 'bg-text-muted/40' : v >= 90 ? 'bg-rose-400' : v >= 75 ? 'bg-amber-400' : 'bg-emerald-400';

function Meter({ label, value, sub }: { label: string; value?: number | null; sub?: string }) {
  return (
    <div className="flex-1 min-w-[90px]">
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span className="font-bold uppercase tracking-wider">{label}</span>
        <span className="font-mono text-text-base">{pct(value)}</span>
      </div>
      <div className="w-full h-1 bg-inner border border-subtle rounded-full overflow-hidden mt-1">
        <div
          className={`h-full transition-all duration-500 ${usageColor(value)}`}
          style={{ width: `${Math.max(2, Math.min(100, value ?? 0))}%` }}
        />
      </div>
      {sub && <div className="text-[9px] font-mono text-text-muted mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

/** One-click Microsoft RDP launch: generates a per-PC .rdp handoff file. */
function openRdpFile(ws: WorkstationStationConfig): void {
  if (!ws.ipAddress) return;
  const body = [
    'screen mode id:i:2',
    'use multimon:i:1',
    `desktopwidth:i:1280`,
    `desktopheight:i:720`,
    'session bpp:i:32',
    `full address:s:${ws.ipAddress}:${ws.rdpPort || 3389}`,
    'prompt for credentials:i:1',
    'authentication level:i:0'
  ].join('\r\n');
  const blob = new Blob([body], { type: 'application/rdp' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ws.ipAddress.replace(/[.]/g, '-')}.rdp`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** In-browser live desktop pane: noVNC/websockify served by the station PC. */
function remotePaneUrl(ws: WorkstationStationConfig): string | null {
  if (ws.remoteChannel !== 'vnc') return null;
  const ip = ws.ipAddress || '';
  if (ws.remoteUrl) {
    const url = ws.remoteUrl
      .split('{ip}').join(ip)
      .split('{port}').join(String(ws.vncPort || 6080));
    if (import.meta.env.PROD && !url.startsWith('https://')) return null;
    return url;
  }
  // HTTPS-hosted dashboards must use an HTTPS Cloudflare Tunnel URL; browser
  // mixed-content rules block direct http://LAN VNC iframes.
  if (import.meta.env.PROD || !ws.vncPort || !ip) return null;
  return `http://${ip}:${ws.vncPort}/vnc.html?autoconnect=true&resize=scale`;
}

export const PcMonitoringStation: React.FC<PcMonitoringStationProps> = ({
  projectSettings,
  isGuestUser,
  addNotification,
  addAuditLog,
  userLabel
}) => {
  const [focusedStation, setFocusedStation] = useState<WorkstationStationId | null>(null);
  const workstations: WorkstationStationConfig[] =
    (projectSettings?.workstationsConfig as WorkstationStationConfig[] | undefined) || DEFAULT_4_WORKSTATIONS;
  const { observations } = useStationAgents(workstations, 5_000);

  const onlineCount = workstations.filter((w) => observations[w.id]?.online).length;
  const activeRemoteCount = workstations.filter((w) => !!remotePaneUrl(w)).length;

  const handleLaunchRdp = (ws: WorkstationStationConfig) => {
    if (!ws.ipAddress) return;
    openRdpFile(ws);
    addNotification?.({
      title: `RDP session prepared for ${ws.name}`,
      message: `${ws.ipAddress}:${ws.rdpPort || 3389} — hand the .rdp file to Microsoft Remote Desktop (mstsc) to open the console window.`,
      category: 'SYSTEM',
      read: false
    });
    addAuditLog?.(
      'INFO',
      'RDP Handoff Launched',
      `${userLabel} initiated a remote desktop session handoff to ${ws.name} (${ws.ipAddress}:${ws.rdpPort || 3389}).`,
      'info'
    );
  };

  const cardFor = (ws: WorkstationStationConfig) => {
    const obs: StationAgentObservation | undefined = observations[ws.id];
    const h = obs?.health;
    return { ws, obs, h };
  };

  if (focusedStation) {
    // Full-screen single-console overlay for immersive floor monitoring.
    const focused = workstations.find((w) => w.id === focusedStation);
    return focused ? (
      <MonitorPaneOverlay
        ws={focused}
        obs={observations[focused.id]}
        onClose={() => setFocusedStation(null)}
        onLaunchRdp={handleLaunchRdp}
      />
    ) : null;
  }

  return (
    <div className="flex flex-col gap-5 min-w-0 bg-card border border-subtle rounded-xl p-4 md:flex-1 md:min-h-0 md:overflow-y-auto">
      <div className="pb-3 border-b border-subtle flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">PC Monitoring</h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed max-w-3xl">
            Live status, hardware usage, and remote access for all four production workstations.
          </p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted shrink-0">
          {onlineCount}/4 agents live · {activeRemoteCount}/4 VNC enabled
        </span>
      </div>

      {/* === Telemetry cards === */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {workstations.map((w) => {
          const { ws, obs, h } = cardFor(w);
          const online = !!obs?.online;
          const ipLabel = `${ws.ipAddress || '—'}${ws.port ? `:${ws.port}` : ''}`;
          return (
            <div key={ws.id} className="rounded-xl border border-subtle bg-card flex flex-col divide-y divide-[var(--divider)]">
              <div className="p-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono font-black text-text-base">{ws.name.split('—')[0].trim()}</div>
                  <div className="text-[11px] font-bold text-text-base truncate">{ws.name.split('—').slice(1).join('—').trim() || ws.name}</div>
                  <div className="text-[10px] font-mono text-text-muted truncate mt-0.5" title={ipLabel}>{ipLabel}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <StatusDot tone={online ? 'text-emerald-400' : 'text-text-muted/60'} pulse={online} />
                  <span className={`text-[10px] font-bold ${online ? 'text-emerald-300' : 'text-text-muted'}`}>
                    {online ? 'Live' : 'Down'}
                  </span>
                </div>
              </div>

              <div className="p-3 flex flex-col gap-2">
                <div className="flex items-end gap-2 flex-wrap">
                  <Meter label="CPU" value={h?.cpu_usage} sub={h?.cpu_cores ? `${h.cpu_cores} threads` : undefined} />
                  <Meter label="GPU" value={h?.gpu_usage} sub={h?.gpu_name || undefined} />
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <Meter
                    label="RAM"
                    value={h?.ram_total_gb ? ((h?.ram_used_gb || 0) / h.ram_total_gb) * 100 : null}
                    sub={h?.ram_total_gb ? `${(h?.ram_used_gb || 0).toFixed(1)} / ${h.ram_total_gb} GB` : undefined}
                  />
                  <Meter
                    label="Storage"
                    value={h?.storage_used_pct}
                    sub={h?.disk_total ? `${h.disk_free_gb} GB free of ${h.disk_total} GB` : undefined}
                  />
                </div>
                {h?.cpu_percpu && h.cpu_percpu.length > 0 && (
                  <div className="flex gap-0.5 mt-0.5" title="Per-core CPU">
                    {h.cpu_percpu.map((c, i) => (
                      <div
                        key={i}
                        className={`flex-1 min-w-[3px] h-3 rounded-sm ${usageColor(c)}`}
                        style={{ opacity: 0.3 + Math.min(0.7, (c || 1) / 100) }}
                      />
                    ))}
                  </div>
                )}
                {online && h && (
                  <div className="text-[9px] font-mono text-text-muted flex flex-wrap gap-x-3">
                    <span>agent {h.agent_version || '—'}</span>
                    <span>up {h.uptime_sec !== undefined ? `${Math.round(h.uptime_sec / 3600)}h` : '—'}</span>
                    <span>pulse {obs?.lastProbeAt ? new Date(obs.lastProbeAt).toLocaleTimeString() : '—'}</span>
                  </div>
                )}
                {!online && (
                  <div className="text-[10px] text-text-muted leading-relaxed">
                    Agent unreachable — check the PC / LAN, then confirm `station-agent` is running (port {ws.port || 8000}).
                  </div>
                )}
              </div>

              <div className="px-3 py-2.5 flex items-center gap-2">
                <button
                  type="button"
                  disabled={isGuestUser || !ws.ipAddress}
                  onClick={() => handleLaunchRdp(ws)}
                  className="flex-1 py-1.5 bg-inner border border-subtle hover:border-divider text-text-base text-[11px] font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ExternalLink size={12} />
                  <span>Open RDP</span>
                </button>
                <button
                  type="button"
                  disabled={isGuestUser || !remotePaneUrl(ws)}
                  onClick={() => setFocusedStation(ws.id)}
                  className="flex-1 py-1.5 bg-text-base text-card hover:opacity-90 text-[11px] font-medium rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  title={remotePaneUrl(ws) ? 'Live desktop in browser (noVNC)' : 'Enable VNC port for this station under Providers → Workstations'}
                >
                  <Monitor size={12} />
                  <span>Live view</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* === 4-up live desktop quad === */}
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-muted pt-1">
        <Server size={12} /> 4-PC Live Desktop (embedded VNC)
      </div>
      <p className="text-[11px] text-text-muted leading-relaxed">
        Each cell below is the workstation&apos;s own noVNC/websockify live desktop served over the LAN
        (`Providers → Workstations` → enable *VNC Port* and pick *VNC* as the remote channel). Use
        `Open RDP` above for the full native console when precision is needed.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {workstations.map((w) => {
          const ws = w;
          const obs: StationAgentObservation | undefined = observations[w.id];
          const paneUrl = remotePaneUrl(ws);
          return (
            <div key={`pane-${ws.id}`} className="rounded-xl border border-subtle bg-card overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-[var(--divider)] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot tone={obs?.online ? 'text-emerald-400' : 'text-text-muted/50'} pulse={!!obs?.online} />
                  <span className="text-[11px] font-bold text-text-base truncate">{ws.name}</span>
                  <span className="text-[10px] font-mono text-text-muted truncate">{ws.ipAddress}{ws.rdpPort ? `:${ws.rdpPort}` : ':3389'}</span>
                </div>
                <button
                  type="button"
                  disabled={isGuestUser || !ws.ipAddress}
                  onClick={() => handleLaunchRdp(ws)}
                  className="text-[10px] font-bold text-text-muted hover:text-text-base flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  title="Open native RDP in a new window"
                >
                  <Terminal size={11} />
                  <span>RDP</span>
                </button>
              </div>
              {paneUrl ? (
                <iframe
                  src={paneUrl}
                  title={`${ws.name} live desktop`}
                  className="w-full h-64 lg:h-72 bg-black"
                  allow="fullscreen"
                />
              ) : (
                <div className="w-full h-64 lg:h-72 bg-inner border-t border-subtle flex flex-col items-center justify-center gap-2 text-center px-6">
                  <Activity size={20} className="text-text-muted" />
                  <p className="text-[11px] text-text-muted leading-relaxed max-w-xs">
                    Embedded live view is not enabled for this PC. Run **websockify + noVNC** on the workstation
                    (`pip install websockify` → `websockify --web /noVNC 5900:59xx` / port 6080), then set
                    **VNC Port** under Providers → Workstations.
                  </p>
                  <button
                    type="button"
                    disabled={isGuestUser || !ws.ipAddress}
                    onClick={() => handleLaunchRdp(ws)}
                    className="mt-1 px-3 py-1.5 bg-inner border border-subtle hover:border-divider text-text-base text-[10px] font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ExternalLink size={10} />
                    <span>Open RDP instead</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function MonitorPaneOverlay({
  ws,
  obs,
  onClose,
  onLaunchRdp
}: {
  ws: WorkstationStationConfig;
  obs?: StationAgentObservation;
  onClose: () => void;
  onLaunchRdp: (ws: WorkstationStationConfig) => void;
}) {
  const paneUrl = remotePaneUrl(ws);
  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col p-4 animate-fadeIn">
      <div className="max-w-6xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 pb-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
              <StatusDot tone={obs?.online ? 'text-emerald-400' : 'text-text-muted/50'} pulse={!!obs?.online} />
              <span className="truncate">{ws.name}</span>
              <span className="text-[11px] font-mono text-text-muted">{ws.ipAddress}</span>
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onLaunchRdp(ws)}
              className="px-3 py-1.5 bg-card border border-subtle hover:border-divider text-text-base text-[11px] font-medium rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Terminal size={12} />
              <span>Open RDP</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-card border border-subtle hover:border-divider text-text-base text-[11px] font-medium rounded-lg cursor-pointer transition-colors"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-subtle bg-black">
          {paneUrl ? (
            <iframe
              src={paneUrl}
              title={`${ws.name} live desktop`}
              className="w-full h-full"
              allow="fullscreen"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
              <Monitor size={26} className="text-text-muted" />
              <p className="text-xs text-text-muted max-w-sm leading-relaxed">
                This workstation has no embedded VNC channel configured. Set `VNC Port` under
                Providers → Workstations, or launch the native RDP console instead.
              </p>
              <button
                type="button"
                onClick={() => onLaunchRdp(ws)}
                className="px-3 py-1.5 bg-card border border-subtle hover:border-divider text-text-base text-[10px] font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <ExternalLink size={10} />
                <span>Open RDP</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
