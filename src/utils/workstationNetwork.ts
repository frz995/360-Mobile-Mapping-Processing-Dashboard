// =====================================================================
// Workstation network settings
// The Production Pipeline boards (Flight Board, PC Monitoring, intake
// pairing, publication gate) read every station address from
// `project_settings.workstationsConfig`. Until this module existed there
// was no way to write one: the shipped topology deliberately carries no
// invented addresses (see DEFAULT_4_WORKSTATIONS), so an operator had to
// hand-edit the project_settings JSON row to make a single station
// reachable. This is the shared merge/normalise logic behind the editor,
// kept pure so it can be tested without mounting the panel.
// =====================================================================

import {
  DEFAULT_4_WORKSTATIONS,
  type WorkstationStationConfig,
  type WorkstationStationId
} from '../types/production';

/** Default station-agent listen port, matching station-agent/.env.example. */
export const STATION_AGENT_DEFAULT_PORT = 8000;

/** Default RDP port, matching the Windows mstsc default. */
export const RDP_DEFAULT_PORT = 3389;

/** The subset of a station entry that an operator may set by hand. */
export interface WorkstationNetworkFields {
  enabled: boolean;
  ipAddress?: string;
  port?: number;
  agentToken?: string;
  rdpPort?: number;
  vncPort?: number;
  remoteChannel?: 'rdp' | 'vnc';
  remoteUrl?: string;
}

/** A station as it comes back from `project_settings`: `id` is widened to
 *  string because a site may have added a station outside the shipped
 *  topology, and those rows must survive a save. */
export type StoredWorkstation = { id: string } & Partial<Omit<WorkstationStationConfig, 'id'>>;

/** Drops undefined/blank so an emptied field is genuinely absent rather than
 *  an empty string that would be sent to the agent as a real value. */
function compact<T extends object>(value: T): T {
  const out = {} as Record<string, unknown>;
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[key] = typeof v === 'string' ? v.trim() : v;
  }
  return out as T;
}

/**
 * Seeds the four shipped stations and overlays whatever the operator has
 * already saved. Unknown or extra ids in storage are preserved at the end so
 * a site that added its own station does not silently lose it on next save.
 *
 * Only the network fields are copied across, so live agent observations
 * (heartbeat, online flag, CPU/GPU/RAM/disk) can never be persisted into
 * settings: a stored "online" would freeze a badge that contradicts the board.
 */
export function normalizeWorkstations(
  stored?: ReadonlyArray<StoredWorkstation> | null
): WorkstationStationConfig[] {
  const byId = new Map<string, StoredWorkstation>();
  for (const entry of stored || []) {
    if (entry && typeof entry.id === 'string') byId.set(entry.id, entry);
  }

  const merged = DEFAULT_4_WORKSTATIONS.map((base) => {
    const override = byId.get(base.id) || {};
    byId.delete(base.id);
    const { enabled, ipAddress, port, agentToken, rdpPort, vncPort, remoteChannel, remoteUrl } =
      override as Partial<WorkstationNetworkFields>;
    return compact({
      ...base,
      enabled: typeof enabled === 'boolean' ? enabled : base.enabled,
      ipAddress,
      port,
      agentToken,
      rdpPort,
      vncPort,
      remoteChannel,
      remoteUrl
    }) as WorkstationStationConfig;
  });

  for (const leftover of byId.values()) {
    const { enabled, ipAddress, port, agentToken, rdpPort, vncPort, remoteChannel, remoteUrl } =
      leftover as Partial<WorkstationNetworkFields>;
    merged.push(
      compact({
        ...(leftover as unknown as WorkstationStationConfig),
        enabled: typeof enabled === 'boolean' ? enabled : true,
        ipAddress,
        port,
        agentToken,
        rdpPort,
        vncPort,
        remoteChannel,
        remoteUrl
      }) as WorkstationStationConfig
    );
  }

  return merged;
}

/** Immutably replaces the network fields of one station, leaving every other
 *  station and all non-address fields untouched. */
export function withStationPatch(
  list: ReadonlyArray<WorkstationStationConfig>,
  id: WorkstationStationId | string,
  patch: Partial<WorkstationNetworkFields>
): WorkstationStationConfig[] {
  return list.map((station) => {
    if (station.id !== id) return station;
    const next = compact({
      ...station,
      ...patch,
      // `enabled: false` is meaningful, so it must survive compaction; only
      // the optional address fields get dropped when blanked.
      enabled: patch.enabled === undefined ? station.enabled : patch.enabled
    }) as WorkstationStationConfig;
    return next;
  });
}

/** Blank input clears the port; anything non-numeric or out of TCP range
 *  also clears it rather than persisting a value the agent cannot bind. */
export function parsePortInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return undefined;
  return n;
}

/** Accepts a dotted-IPv4 literal or a resolvable hostname. Deliberately
 *  permissive: this warns on a likely typo, it does not gate saving. */
export function isValidStationHost(raw: string): boolean {
  const value = raw.trim();
  if (value === '' || /\s/.test(value)) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = value.match(ipv4);
  if (m) return m.slice(1).every((part) => Number(part) <= 255 && String(Number(part)) === part);
  // A digits-and-dots string that is not valid IPv4 is a mistyped address, not
  // a hostname: reject it instead of letting the hostname rule accept "10.20.30".
  if (/^[\d.]+$/.test(value)) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value);
}

/** A station with no address cannot be polled, so the boards report it as
 *  unconfigured. The editor surfaces this as a per-station badge. */
export function stationIsConfigured(station: WorkstationStationConfig): boolean {
  return Boolean(station.ipAddress && station.ipAddress.trim() !== '');
}

/** How many stations are reachable — used for the section's summary line. */
export function countConfiguredStations(
  list: ReadonlyArray<WorkstationStationConfig>
): number {
  return list.filter(stationIsConfigured).length;
}
