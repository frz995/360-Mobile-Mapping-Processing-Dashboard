/**
 * Canonical WebGIS host resolution.
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE CHAIN
 *   `VITE_MAP_URL` was read in six places with three different fallback shapes.
 *   `MapComponent` honoured a tenant override, `AdminSettingsView` and
 *   `App.tsx` ignored it and went straight to a hardcoded default, and
 *   `SharedMapPage` had no default at all and assembled a bare `/?...` URL. A
 *   tenant on a dedicated intranet map therefore saw the right host in the
 *   dashboard iframe and the public host everywhere else — including the
 *   published map and the link that opens the map full-screen.
 *
 *   Precedence is stated once, here, so it cannot drift per call site again.
 *   `import.meta.env` is passed in rather than read inside: Vite substitutes it
 *   at build time, and keeping it out makes both functions plain and testable.
 */

/** The production WebGIS host when there is no tenant override and no env value. */
export const DEFAULT_WEBGIS_URL = 'https://map.geosphere.my';

/**
 * Accept a candidate only if it is an absolute http(s) URL, and strip trailing
 * slashes.
 *
 * A bare host (`map.example.my`) is deliberately rejected. `new URL()` would
 * resolve it against the current page's origin rather than fail, so the iframe
 * origin check downstream would compare against an origin the operator never
 * configured — and, before that check is deny-by-default, quietly widen it.
 *
 * Trailing slashes are stripped because every caller appends `/?…`: a base
 * ending in `/` yields `//?embed=true`, which is the documented cause of a
 * black iframe that looks like a network failure.
 *
 * Returns null for an unusable value rather than throwing, so one bad
 * override degrades to the next source instead of blanking the map. The
 * rejection is logged because a silently ignored tenant setting is exactly the
 * class of "configured but not doing anything" this codebase refuses to ship.
 */
function normalizeCandidate(value: string | null | undefined, label: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    console.warn(`[config] Ignoring ${label}: "${trimmed}" is not an absolute URL.`);
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.warn(`[config] Ignoring ${label}: "${trimmed}" is not an http(s) URL.`);
    return null;
  }

  if (parsed.hostname.toLowerCase().endsWith('vercel.app')) {
    console.warn(`[config] Ignoring retired Vercel URL in ${label}: "${trimmed}". Defaulting to ${DEFAULT_WEBGIS_URL}.`);
    return null;
  }

  return trimmed.replace(/\/+$/, '');
}

/**
 * Resolve the WebGIS base URL for the active tenant.
 *
 * Order: tenant override -> build-time `VITE_MAP_URL` -> {@link DEFAULT_WEBGIS_URL}.
 * Never returns an empty string; callers can append a path unconditionally.
 */
export function resolveWebgisUrl(
  tenantOverride?: string | null,
  envUrl?: string | null
): string {
  return (
    normalizeCandidate(tenantOverride, 'the tenant WebGIS override') ||
    normalizeCandidate(envUrl, 'VITE_MAP_URL') ||
    DEFAULT_WEBGIS_URL
  );
}

/** Apex whose subdomains may be trusted. Opt-in — see `createMapOriginMatcher`. */
const DEFAULT_TRUSTED_APEX = 'geosphere.my';

/**
 * True when `hostname` is the apex itself or a subdomain of it.
 *
 * The dot boundary keeps this a subdomain test rather than a string suffix
 * test, and the input is a *parsed hostname* rather than a raw origin string.
 * To be clear about the previous implementation's actual behaviour, though:
 * `origin.endsWith('.geosphere.my')` was **not** an independent vulnerability.
 * The leading dot already forces a subdomain-label boundary, and no
 * attacker-registrable domain ends in `.geosphere.my` — `evilgeosphere.my` and
 * `evil.geosphere.my.attacker.com` both fail to match. It did fail to
 * distinguish scheme, and it failed closed on any non-default port, both of
 * which parsing handles properly. The exploitable defect in the handler was the
 * fail-open below, not the suffix match.
 */
function isHostUnder(hostname: string, apex: string): boolean {
  const host = hostname.toLowerCase();
  const root = apex.toLowerCase();
  return host === root || host.endsWith(`.${root}`);
}

/** Parse an origin string to its hostname, or '' when it is not a valid origin. */
function originHostname(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** An origin string to a canonical `scheme://host[:port]`, or null. */
function canonicalOrigin(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export interface MapOriginMatcherOptions {
  /**
   * Trust any subdomain of the apex, not just the exact map origin.
   *
   * Off by default and it should stay that way until the set of hosts under
   * the apex is known. Widening this grants a message channel to every host
   * beneath it, including staging and preview deployments.
   */
  trustApexSubdomains?: boolean;
  /** Apex for the wildcard. Defaults to `geosphere.my`. */
  apex?: string;
}

/**
 * Build the predicate that decides whether an inbound `MessageEvent` may be
 * processed.
 *
 * WHY A PREDICATE AND NOT A `Set<string>`
 *   Optional subdomain trust cannot be enumerated — `*.geosphere.my` is
 *   infinite. A set would force the caller to re-implement the matching rule
 *   somewhere less tested, which is how the vulnerable `endsWith` got there in
 *   the first place.
 *
 * DENY BY DEFAULT
 *   When `effectiveMapUrl` is empty or unparseable, the map origin contributes
 *   nothing and only the caller's own origin is accepted. The previous guard
 *   read `if (allowedOrigin && …)`, which short-circuits to "accept" when
 *   `allowedOrigin` is empty — so an unset or malformed host silently admitted
 *   messages from every origin on the internet. An unknown host must mean no
 *   host, not any host.
 */
export function createMapOriginMatcher(
  effectiveMapUrl: string | null | undefined,
  selfOrigin: string,
  options: MapOriginMatcherOptions = {}
): (origin: string) => boolean {
  const self = canonicalOrigin(selfOrigin);
  const mapOrigin = canonicalOrigin(effectiveMapUrl);
  const apex = (options.apex || DEFAULT_TRUSTED_APEX).toLowerCase();
  const wildcard = options.trustApexSubdomains === true;

  return (origin: string): boolean => {
    const incoming = canonicalOrigin(origin);
    if (!incoming) return false;
    if (self && incoming === self) return true;
    if (mapOrigin && incoming === mapOrigin) return true;
    if (wildcard) {
      const host = originHostname(incoming);
      if (host && isHostUnder(host, apex)) return true;
    }
    return false;
  };
}

/**
 * Resolves the target origin for posting messages to an iframe element.
 * 
 * WHY FAIL-CLOSED
 *   A missing or unparseable `src` means we cannot prove the recipient origin.
 *   Falling back to `'*'` broadcasts sensitive state (staged data, filters,
 *   camera targets) to any document that happened to load in that frame. We
 *   never broadcast with `'*'`; if the target origin cannot be determined we
 *   return null and the send path must not deliver the message.
 */
export function resolveFrameOrigin(frame: HTMLIFrameElement | null | undefined): string | null {
  if (!frame?.src) return null;
  try {
    const base = typeof window !== 'undefined' && window.location?.href ? window.location.href : undefined;
    const url = new URL(frame.src, base);
    return url.origin && url.origin !== 'null' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Post a message to an embedded map frame, fail-closed.
 * 
 * Only the sanctioned send path. If the target origin cannot be determined
 * (frame detached, src missing/unparseable), the message is not sent and a
 * single warning is logged. We never fall back to broadcast-to-all-origins.
 */
export function postToMapFrame(frame: HTMLIFrameElement | null | undefined, message: unknown): void {
  if (!frame?.contentWindow) return;
  const targetOrigin = resolveFrameOrigin(frame);
  if (!targetOrigin) {
    warnMissingOriginOnce();
    return;
  }
  try {
    frame.contentWindow.postMessage(message, targetOrigin);
  } catch (postErr) {
    console.warn('[bridge] Map frame message not delivered (frame detached):', postErr);
  }
}

let warnedMissingOrigin = false;
function warnMissingOriginOnce(): void {
  if (warnedMissingOrigin) return;
  warnedMissingOrigin = true;
  console.warn(
    '[bridge] Refusing to postMessage: target origin unknown (frame src missing or unparseable). ' +
      'The bridge does not broadcast to all origins.'
  );
}

/**
 * True when a `message` event came from `frame` *and* from the origin that
 * frame was loaded from.
 *
 * The `source` half stops a foreign embedder; the origin half stops a
 * compromised or redirected map host. Deny-by-default when the frame's origin
 * cannot be resolved.
 */
export function isTrustedMapMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null | undefined
): boolean {
  if (!frame || event.source !== frame.contentWindow) return false;
  const mapOrigin = resolveFrameOrigin(frame);
  if (!mapOrigin) return false;
  return createMapOriginMatcher(mapOrigin, window.location.origin)(event.origin);
}

/** Broadcast one message to every embedded map iframe on the page, fail-closed. */
export function postToMapFrames(message: unknown): void {
  if (typeof document === 'undefined') return;
  const frames = document.querySelectorAll<HTMLIFrameElement>('iframe');
  frames.forEach((frame) => {
    postToMapFrame(frame, message);
  });
}