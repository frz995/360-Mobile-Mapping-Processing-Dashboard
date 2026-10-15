import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_WEBGIS_URL, resolveWebgisUrl, createMapOriginMatcher } from '../mapOrigin';

/**
 * The regression these pin is the drift that let one tenant see two hosts: six
 * call sites had three different fallback shapes, and `SharedMapPage` had no
 * default at all. The precedence order is therefore the contract, and it is
 * asserted here rather than left to six call sites to agree on by inspection.
 */
describe('resolveWebgisUrl', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers the tenant override over the build-time env value', () => {
    expect(resolveWebgisUrl('https://intranet.tnb.com.my', 'https://map.geosphere.my')).toBe(
      'https://intranet.tnb.com.my'
    );
  });

  it('falls back to the env value when the tenant has no override', () => {
    expect(resolveWebgisUrl(null, 'https://staging.example.my')).toBe('https://staging.example.my');
    expect(resolveWebgisUrl(undefined, 'https://staging.example.my')).toBe('https://staging.example.my');
    expect(resolveWebgisUrl('', 'https://staging.example.my')).toBe('https://staging.example.my');
  });

  it('falls back to the platform default when neither source is set', () => {
    // The old SharedMapPage read produced '' here, which built a bare `/?…`
    // URL. Never-empty is the property that stops a blank embed.
    expect(resolveWebgisUrl(null, null)).toBe(DEFAULT_WEBGIS_URL);
    expect(resolveWebgisUrl(null, undefined)).toBe(DEFAULT_WEBGIS_URL);
    expect(resolveWebgisUrl(undefined, undefined)).toBe(DEFAULT_WEBGIS_URL);
  });

  it('strips trailing slashes so callers can append "/?…" safely', () => {
    // A base ending in "/" yields "//?embed=true" — the documented black-iframe cause.
    expect(resolveWebgisUrl('https://intranet.tnb.com.my/', null)).toBe('https://intranet.tnb.com.my');
    expect(resolveWebgisUrl('https://intranet.tnb.com.my///', null)).toBe('https://intranet.tnb.com.my');
    expect(resolveWebgisUrl(null, 'https://staging.example.my/')).toBe('https://staging.example.my');
  });

  it('preserves a sub-path base', () => {
    expect(resolveWebgisUrl('https://corp.my/webgis/', null)).toBe('https://corp.my/webgis');
  });

  it('rejects a bare host and falls through rather than resolving against the page origin', () => {
    // `new URL('map.example.my')` throws, so this is rejected by the guard and
    // not silently bound to whatever origin the dashboard happens to be served from.
    expect(resolveWebgisUrl('map.example.my', 'https://staging.example.my')).toBe('https://staging.example.my');
    expect(resolveWebgisUrl('map.example.my', null)).toBe(DEFAULT_WEBGIS_URL);
  });

  it('rejects a non-http scheme and falls through', () => {
    // A javascript: or data: base would execute in the iframe, not fail quietly.
    expect(resolveWebgisUrl('javascript:alert(1)', null)).toBe(DEFAULT_WEBGIS_URL);
    expect(resolveWebgisUrl('ftp://files.example.my', null)).toBe(DEFAULT_WEBGIS_URL);
  });

  it('reports a rejected override instead of dropping it silently', () => {
    // Rule zero: a configured setting that is not doing anything must say so.
    resolveWebgisUrl('map.example.my', null);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('map.example.my'));
  });

  it('does not warn for a tenant that simply has no override', () => {
    resolveWebgisUrl(null, 'https://staging.example.my');
    expect(console.warn).not.toHaveBeenCalled();
  });
});

/**
 * These pin the deny-by-default contract.
 *
 * The previous guard was `if (allowedOrigin && e.origin !== allowedOrigin && …)`:
 * it short-circuited to ACCEPT when the host was empty or unparseable, so an
 * unset `VITE_MAP_URL` admitted messages from every origin on the internet. That
 * is the exploitable defect this file exists to prevent.
 *
 * The lookalike cases below are hardening, not a fix for that defect. The old
 * `endsWith('.geosphere.my')` already refused `evilgeosphere.my` and
 * `evil.geosphere.my.attacker.com`, because the leading dot forces a subdomain
 * boundary and nothing registrable ends in `.geosphere.my`. They are kept
 * because hostname parsing is the correct basis for the rule, and because a
 * future refactor that drops the leading dot would otherwise pass silently.
 */
describe('createMapOriginMatcher', () => {
  const SELF = 'https://app.geosphere.my';

  it('denies every foreign origin when the map host is unset', () => {
    // The regression that mattered most: an unknown host must mean no host.
    const allowed = createMapOriginMatcher('', SELF);
    expect(allowed('https://map.geosphere.my')).toBe(false);
    expect(allowed('https://evil.example')).toBe(false);
    expect(allowed('http://localhost:5173')).toBe(false);
    expect(allowed('null')).toBe(false);
  });

  it('denies every foreign origin when the map host is unparseable', () => {
    const allowed = createMapOriginMatcher('not a url', SELF);
    expect(allowed('https://map.geosphere.my')).toBe(false);
    expect(allowed('https://evil.example')).toBe(false);
  });

  it('still accepts same-origin messages regardless of the map host', () => {
    // Self-origin is our own code, not the iframe channel.
    expect(createMapOriginMatcher('', SELF)(SELF)).toBe(true);
    expect(createMapOriginMatcher('https://map.geosphere.my', SELF)(SELF)).toBe(true);
  });

  it('accepts the exact configured map origin', () => {
    const allowed = createMapOriginMatcher('https://map.geosphere.my', SELF);
    expect(allowed('https://map.geosphere.my')).toBe(true);
    expect(allowed('https://app.geosphere.my')).toBe(true);
  });

  it('honours a tenant-specific map host', () => {
    const allowed = createMapOriginMatcher('https://intranet.tnb.com.my', SELF);
    expect(allowed('https://intranet.tnb.com.my')).toBe(true);
    expect(allowed('https://map.geosphere.my')).toBe(false);
  });

  it('rejects a subdomains-lookalike when wildcard trust is off', () => {
    const allowed = createMapOriginMatcher('https://map.geosphere.my', SELF);
    expect(allowed('https://staging.geosphere.my')).toBe(false);
    expect(allowed('https://anything.geosphere.my')).toBe(false);
  });

  it('REJECTS lookalike hosts even with wildcard trust on', () => {
    // Hardening rather than a fix: `endsWith('.geosphere.my')` already refused
    // these. Hostname parsing is kept because it is the correct basis for the
    // rule, so the guarantee does not depend on the string form staying so.
    const allowed = createMapOriginMatcher('https://map.geosphere.my', SELF, {
      trustApexSubdomains: true
    });
    expect(allowed('https://evil.geosphere.my.attacker.com')).toBe(false);
    expect(allowed('https://geosphere.my.attacker.com')).toBe(false);
    expect(allowed('https://evilgeosphere.my')).toBe(false);
  });

  it('accepts genuine subdomains when wildcard trust is explicitly enabled', () => {
    const allowed = createMapOriginMatcher('https://map.geosphere.my', SELF, {
      trustApexSubdomains: true
    });
    expect(allowed('https://staging.geosphere.my')).toBe(true);
    expect(allowed('https://deep.nested.geosphere.my')).toBe(true);
  });

  it('restricts wildcard trust to the configured apex', () => {
    const allowed = createMapOriginMatcher('https://map.geosphere.my', SELF, {
      trustApexSubdomains: true,
      apex: 'example.my'
    });
    expect(allowed('https://a.example.my')).toBe(true);
    expect(allowed('https://staging.geosphere.my')).toBe(false);
  });

  it('rejects a non-http origin outright', () => {
    const allowed = createMapOriginMatcher('https://map.geosphere.my', SELF, {
      trustApexSubdomains: true
    });
    expect(allowed('javascript:alert(1)')).toBe(false);
    expect(allowed('file:///etc/passwd')).toBe(false);
  });
});