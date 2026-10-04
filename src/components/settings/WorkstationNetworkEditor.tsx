// =====================================================================
// Workstation Network Editor
// Per-site addressing for the four Production Pipeline stations.
//
// The shipped topology (DEFAULT_4_WORKSTATIONS) intentionally carries no
// addresses — inventing them made the boards dial hosts that do not exist.
// That left operators with no way to configure a station short of editing
// the project_settings JSON by hand, which is why the Flight Board could not
// be set up without raw SQL. This editor writes those per-site facts.
//
// Address fields only. Topology (order, software, NAS stage folders) stays
// in DEFAULT_4_WORKSTATIONS so the pipeline contract cannot drift per site,
// and live agent telemetry is never persisted here.
// =====================================================================

import { AlertTriangle, CheckCircle2, CircleSlash, Monitor } from 'lucide-react';
import {
  DEFAULT_4_WORKSTATIONS,
  type WorkstationStationConfig
} from '../../types/production';
import {
  RDP_DEFAULT_PORT,
  STATION_AGENT_DEFAULT_PORT,
  countConfiguredStations,
  isValidStationHost,
  normalizeWorkstations,
  parsePortInput,
  stationIsConfigured,
  withStationPatch,
  type StoredWorkstation,
  type WorkstationNetworkFields
} from '../../utils/workstationNetwork';

export interface WorkstationNetworkEditorProps {
  value?: ReadonlyArray<StoredWorkstation> | null;
  onChange: (next: WorkstationStationConfig[]) => void;
  themeMode?: 'dark' | 'light';
}

const INPUT_BASE =
  'w-full px-3 py-2 rounded-lg font-medium focus:outline-none border';

export function WorkstationNetworkEditor({
  value,
  onChange,
  themeMode = 'dark'
}: WorkstationNetworkEditorProps) {
  const light = themeMode === 'light';
  const inputBg = light ? 'bg-white border-slate-300 text-slate-900' : 'bg-card border-subtle text-text-base';
  const labelClass = 'block text-text-muted font-medium mb-1';
  const stations = normalizeWorkstations(value);
  const configured = countConfiguredStations(stations);

  const patch = (id: string, next: Partial<WorkstationNetworkFields>) =>
    onChange(withStationPatch(stations, id, next));

  return (
    <div className="space-y-4">
      <p className={`text-[11px] ${light ? 'text-text-muted' : 'text-text-muted'}`}>
        Each station runs a small agent on its own PC. The dashboard polls it to show live status,
        progress and telemetry on the Flight Board. Leave an address blank and that station reports
        itself as <strong>unconfigured</strong> — the rest of the board keeps working.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={`px-2.5 py-1 rounded-full font-bold border ${
            configured === stations.length
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
          }`}
        >
          {configured} of {stations.length} stations configured
        </span>
        <span className="text-text-muted">
          Default agent port {STATION_AGENT_DEFAULT_PORT} · RDP {RDP_DEFAULT_PORT}
        </span>
      </div>

      {stations.map((station) => {
        const ready = stationIsConfigured(station);
        const badHost = Boolean(station.ipAddress) && !isValidStationHost(station.ipAddress || '');
        const inputClass = `${INPUT_BASE} ${inputBg}`;

        return (
          <div
            key={station.id}
            data-testid={`workstation-${station.id}`}
            className={`rounded-lg border p-4 space-y-3 ${
              light ? 'bg-slate-50 border-slate-200' : 'bg-card border-subtle'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Monitor size={15} className="text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-text-base truncate">
                    Step {station.stepNumber} · {station.name}
                  </div>
                  <div className="text-[10px] text-text-muted truncate">{station.software}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={station.enabled !== false}
                    onChange={e => patch(station.id, { enabled: e.target.checked })}
                    className="accent-sky-500"
                  />
                  Enabled
                </label>
                {badHost ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400">
                    <AlertTriangle size={12} /> Check address
                  </span>
                ) : ready ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                    <CheckCircle2 size={12} /> Ready
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-text-muted">
                    <CircleSlash size={12} /> Unconfigured
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className={labelClass} htmlFor={`ws-${station.id}-ip`}>
                  IP address or hostname
                </label>
                <input
                  id={`ws-${station.id}-ip`}
                  type="text"
                  inputMode="url"
                  placeholder="10.20.30.11"
                  value={station.ipAddress || ''}
                  onChange={e => patch(station.id, { ipAddress: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`ws-${station.id}-port`}>
                  Agent port
                </label>
                <input
                  id={`ws-${station.id}-port`}
                  type="text"
                  inputMode="numeric"
                  placeholder={String(STATION_AGENT_DEFAULT_PORT)}
                  value={station.port === undefined ? '' : String(station.port)}
                  onChange={e => patch(station.id, { port: parsePortInput(e.target.value) })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`ws-${station.id}-channel`}>
                  Live desktop channel
                </label>
                <select
                  id={`ws-${station.id}-channel`}
                  value={station.remoteChannel || 'rdp'}
                  onChange={e =>
                    patch(station.id, {
                      remoteChannel: e.target.value === 'vnc' ? 'vnc' : 'rdp'
                    })
                  }
                  className={inputClass}
                >
                  <option value="rdp">RDP (mstsc)</option>
                  <option value="vnc">noVNC (browser)</option>
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor={`ws-${station.id}-rdp`}>
                  RDP port
                </label>
                <input
                  id={`ws-${station.id}-rdp`}
                  type="text"
                  inputMode="numeric"
                  placeholder={String(RDP_DEFAULT_PORT)}
                  value={station.rdpPort === undefined ? '' : String(station.rdpPort)}
                  onChange={e => patch(station.id, { rdpPort: parsePortInput(e.target.value) })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`ws-${station.id}-vnc`}>
                  noVNC port
                </label>
                <input
                  id={`ws-${station.id}-vnc`}
                  type="text"
                  inputMode="numeric"
                  placeholder="6080"
                  value={station.vncPort === undefined ? '' : String(station.vncPort)}
                  onChange={e => patch(station.id, { vncPort: parsePortInput(e.target.value) })}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className={labelClass} htmlFor={`ws-${station.id}-remote`}>
                  noVNC public URL (optional)
                </label>
                <input
                  id={`ws-${station.id}-remote`}
                  type="text"
                  placeholder="https://pc1-remote.example.com/{port}"
                  value={station.remoteUrl || ''}
                  onChange={e => patch(station.id, { remoteUrl: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`ws-${station.id}-token`}>
                  Agent token (optional)
                </label>
                <input
                  id={`ws-${station.id}-token`}
                  type="password"
                  autoComplete="off"
                  placeholder="AGENT_TOKEN"
                  value={station.agentToken || ''}
                  onChange={e => patch(station.id, { agentToken: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        );
      })}

      <p className="text-[10.5px] text-text-muted leading-relaxed">
        On HTTPS deployments a browser blocks a private <code>http://</code> VNC iframe, so the
        live desktop pane needs the public noVNC URL above (it accepts <code>{'{ip}'}</code> and{' '}
        <code>{'{port}'}</code> placeholders). Leave it blank and the pane stays hidden for that
        station; RDP launch still works from the office LAN.
      </p>

      {stations.length !== DEFAULT_4_WORKSTATIONS.length && (
        <p className="text-[10.5px] text-amber-400">
          This deployment defines {stations.length} stations, not the shipped four. Saved entries
          beyond the default topology are preserved as-is.
        </p>
      )}
    </div>
  );
}

export default WorkstationNetworkEditor;
