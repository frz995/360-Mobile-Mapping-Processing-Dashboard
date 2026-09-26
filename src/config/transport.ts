// =====================================================================
// Transport mode — how the browser reaches the on-prem services.
//
// Two different topologies, deliberately resolved separately.
//
// NAS GPU worker: ONE service, ONE tunnel, ONE token. It is therefore always
// reached through a same-origin proxy. In a deployed build that proxy is a
// Cloudflare Pages Function; in local dev it is the Vite dev server, which
// reads NAS_API_URL / NAS_WORKER_TOKEN from the developer's untracked .env.
// One code path means local dev cannot drift from production, and a laptop
// away from the office still works over the tunnel instead of showing dead
// private addresses.
//
// Station agents: FOUR services on FOUR private IPs, each with its OWN token
// held per-workstation in client config. No single env var can stand in for
// four credentials, so local dev talks to them directly on the LAN. A
// deployed build cannot do that — an HTTPS page may not fetch a private
// http:// IP (mixed content) — so there they go through /api/station-agent.
//
// Each policy is a pure function over explicit inputs, with a thin wrapper that
// reads import.meta.env. That keeps the rules unit-testable without having to
// mutate a build-time constant.
// =====================================================================

export type TransportMode = 'proxy' | 'direct';

/** Set by vite.config.ts at build time: is the dev worker proxy registered? */
declare const __NAS_WORKER_DEV_PROXY__: boolean | undefined;

function readMode(raw: string | undefined, fallback: TransportMode): TransportMode {
  const value = (raw || '').trim().toLowerCase();
  return value === 'proxy' || value === 'direct' ? value : fallback;
}

// --- policies (pure) --------------------------------------------------

/** The worker always proxies unless explicitly told otherwise. */
export function resolveWorkerMode(flag: string | undefined): TransportMode {
  return readMode(flag, 'proxy');
}

/**
 * A same-origin worker proxy exists in every deployed build (Pages Functions),
 * and in local dev only when vite.config.ts found NAS_API_URL and
 * NAS_WORKER_TOKEN. A build with no dev flag cannot have a dev proxy.
 */
export function resolveWorkerProxyAvailable(
  isProd: boolean,
  devProxyConfigured: boolean | undefined
): boolean {
  return isProd ? true : devProxyConfigured === true;
}

/** Deployed builds must proxy; local dev prefers the LAN unless overridden. */
export function resolveStationAgentMode(
  flag: string | undefined,
  isProd: boolean
): TransportMode {
  return readMode(flag, isProd ? 'proxy' : 'direct');
}

// --- env-bound helpers ------------------------------------------------

export function workerTransportMode(): TransportMode {
  return resolveWorkerMode(import.meta.env.VITE_WORKER_API_MODE);
}

export function workerProxyAvailable(): boolean {
  return resolveWorkerProxyAvailable(Boolean(import.meta.env.PROD), devProxyFlag());
}

function devProxyFlag(): boolean | undefined {
  return typeof __NAS_WORKER_DEV_PROXY__ === 'boolean' ? __NAS_WORKER_DEV_PROXY__ : undefined;
}

/**
 * Should NAS imagery be fetched through the same-origin image proxy?
 *
 * True whenever the worker proxy is both selected and actually present, which
 * now includes a configured local dev server — so previews work the same way
 * in both profiles. Supersedes the old PROD-only VITE_NAS_API_ENABLED flag.
 *
 * When false the caller must NOT fall back to a direct http:// NAS URL in a
 * production build: an HTTPS page cannot load one, and silently emitting it is
 * what produced blank images with no error.
 */
export function nasImageProxyEnabled(): boolean {
  return workerTransportMode() === 'proxy' && workerProxyAvailable();
}

export function stationAgentTransportMode(): TransportMode {
  return resolveStationAgentMode(import.meta.env.VITE_STATION_AGENT_MODE, Boolean(import.meta.env.PROD));
}

/**
 * Why a station agent is unreachable — surfaced instead of a flat "offline".
 *
 * Deliberately limited to states the client can actually prove. Whether the
 * *server-side* STATION_AGENT_URLS / STATION_AGENT_TOKENS are configured is not
 * observable from the browser, so a proxy missing credentials surfaces as
 * `unreachable` carrying the real HTTP error rather than a guess.
 */
export type StationAgentOfflineReason =
  | 'disabled'
  | 'no-ip-configured'
  | 'unreachable'
  | 'not-reporting';

export interface TransportDiagnosis {
  mode: TransportMode;
  /** Set when the chosen mode cannot possibly work in this environment. */
  problem?: StationAgentOfflineReason;
  detail?: string;
}

const NO_IP_DETAIL =
  'Station agents are reached directly on the LAN, but no workstation IP is configured. ' +
  'Set an address per PC, or set VITE_STATION_AGENT_MODE=proxy to reach them through the tunnel.';

/** Diagnose the chosen mode before probing, so a dead agent is distinguishable
 *  from a misconfigured one. */
export function diagnoseStationAgentMode(
  mode: TransportMode,
  hasAnyIp: boolean
): TransportDiagnosis {
  if (mode === 'direct' && !hasAnyIp) {
    return { mode, problem: 'no-ip-configured', detail: NO_IP_DETAIL };
  }
  return { mode };
}

export function diagnoseStationAgentTransport(hasAnyIp: boolean): TransportDiagnosis {
  return diagnoseStationAgentMode(stationAgentTransportMode(), hasAnyIp);
}
