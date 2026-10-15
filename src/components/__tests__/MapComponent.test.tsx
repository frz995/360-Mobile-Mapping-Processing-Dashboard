import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const getActiveOrganizationWebgis = vi.fn((): string | null => null);

vi.mock('../../services/tenantContext', () => ({
  getActiveOrganizationWebgis: () => getActiveOrganizationWebgis()
}));

import MapComponent from '../MapComponent';

/**
 * These pin the WIRING, not the policy. `mapOrigin.test.ts` already covers what
 * `createMapOriginMatcher` decides; what a pure-function suite cannot see is
 * whether the component consults it at all.
 *
 * That distinction is the point of this file. The live defect was a guard in
 * this component's effect body (`if (allowedOrigin && …)`) whose failure mode —
 * short-circuiting open — lives in the component, not in any module. Each
 * assertion below drives a real `MessageEvent` through the real listener.
 *
 * The observable is the preparing overlay: `MAP_READY` from a trusted origin
 * calls `finishPreparingNow()`, which dismisses it. An untrusted origin must
 * leave it standing.
 *
 * `VITE_MAP_URL` is stubbed rather than read from the environment: it is a
 * gitignored developer value, and a security test that passes or fails based on
 * whoever's `.env` is loaded is not a test.
 */
const SELF_ORIGIN = 'https://app.geosphere.my';
const CONFIGURED = 'https://webgis.example.com';

function dispatchMessage(origin: string, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });
}

function mapFrame(): HTMLIFrameElement {
  const frame = document.querySelector('iframe');
  if (!frame) throw new Error('MapComponent did not render an iframe');
  return frame as HTMLIFrameElement;
}

describe('MapComponent — WebGIS message origin policy', () => {
  beforeEach(() => {
    getActiveOrganizationWebgis.mockReturnValue(null);
    vi.stubEnv('VITE_MAP_URL', CONFIGURED);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: SELF_ORIGIN }
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('loads the configured WebGIS host in the iframe src', () => {
    render(<MapComponent />);
    expect(mapFrame().src).toContain(CONFIGURED);
  });

  it('falls back to the platform default when VITE_MAP_URL is unset', () => {
    vi.stubEnv('VITE_MAP_URL', '');
    render(<MapComponent />);
    expect(mapFrame().src).toContain('https://map.geosphere.my');
  });

  it('honours the activated company override in the iframe src', () => {
    getActiveOrganizationWebgis.mockReturnValue('https://intranet.tnb.com.my');
    render(<MapComponent />);
    expect(mapFrame().src).toContain('https://intranet.tnb.com.my');
    expect(mapFrame().src).not.toContain(CONFIGURED);
  });

  it('ignores MAP_READY from a foreign origin', () => {
    render(<MapComponent />);
    expect(screen.getByText(/Preparing GeoSphere map/i)).toBeInTheDocument();

    dispatchMessage('https://evil.example', { type: 'MAP_READY' });

    // Unchanged: the message was discarded before reaching the handler body.
    expect(screen.getByText(/Preparing GeoSphere map/i)).toBeInTheDocument();
  });

  it('accepts MAP_READY from the configured WebGIS origin', async () => {
    render(<MapComponent />);
    expect(screen.getByText(/Preparing GeoSphere map/i)).toBeInTheDocument();

    dispatchMessage(CONFIGURED, { type: 'MAP_READY' });

    await waitFor(() => expect(screen.queryByText(/Preparing GeoSphere map/i)).toBeNull());
  });

  it('accepts the same-origin handshake', async () => {
    render(<MapComponent />);
    dispatchMessage(SELF_ORIGIN, { type: 'VIEWER_READY' });
    await waitFor(() => expect(screen.queryByText(/Preparing GeoSphere map/i)).toBeNull());
  });

  it('rejects a hostname that merely contains the apex as a label', () => {
    // Hardening, not a fix: the old endsWith already refused this host. Kept so
    // the guarantee does not depend on the string form of the rule.
    getActiveOrganizationWebgis.mockReturnValue('https://map.geosphere.my');
    render(<MapComponent />);
    dispatchMessage('https://evil.geosphere.my.attacker.com', { type: 'MAP_READY' });
    expect(screen.getByText(/Preparing GeoSphere map/i)).toBeInTheDocument();
  });

  it('rejects a geosphere.my sibling subdomain, because wildcard trust is off by default', () => {
    // This is the assertion that catches a re-widening of the trust boundary,
    // and it fails loudly if the guard is reverted to the old short-circuiting
    // form. Wildcard trust is deliberately opt-in (plan §7.7); whoever enables
    // it should revisit this test in the same change.
    getActiveOrganizationWebgis.mockReturnValue('https://map.geosphere.my');
    render(<MapComponent />);
    dispatchMessage('https://staging.geosphere.my', { type: 'MAP_READY' });
    expect(screen.getByText(/Preparing GeoSphere map/i)).toBeInTheDocument();
  });

  it('re-trusts only the current tenant after the override changes', () => {
    // The stale-closure trap. `isAllowedMapOrigin` is a useMemo keyed on the
    // resolved host, so a tenant switch must re-key the listener rather than
    // leave the previous tenant's origin trusted.
    getActiveOrganizationWebgis.mockReturnValue('https://intranet.tnb.com.my');
    const { unmount } = render(<MapComponent />);
    dispatchMessage('https://map.geosphere.my', { type: 'MAP_READY' });
    expect(screen.getByText(/Preparing GeoSphere map/i)).toBeInTheDocument();
    unmount();

    getActiveOrganizationWebgis.mockReturnValue('https://other.example.my');
    render(<MapComponent />);
    dispatchMessage('https://intranet.tnb.com.my', { type: 'MAP_READY' });
    expect(screen.getByText(/Preparing GeoSphere map/i)).toBeInTheDocument();
  });
});