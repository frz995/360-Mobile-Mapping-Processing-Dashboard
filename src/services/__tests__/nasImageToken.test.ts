import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureNasImageToken,
  isNasImageProxyEnabled,
  nasImageToken,
  nasImageUrl,
  setNasImageToken
} from '../nasImageToken';

describe('nasImageUrl', () => {
  beforeEach(() => {
    setNasImageToken('');
  });

  it('builds an encoded same-origin path with no token when none is cached', () => {
    expect(nasImageUrl('05_Final/BP one.jpg')).toBe('/api/nas-image?path=05_Final%2FBP%20one.jpg');
  });

  it('appends the cached signed token once available', () => {
    setNasImageToken('1700.abc-123');
    expect(nasImageUrl('a.jpg')).toBe('/api/nas-image?path=a.jpg&t=1700.abc-123');
  });

  it('drops the token again when the cache is cleared', () => {
    setNasImageToken('1700.abc-123');
    setNasImageToken('');
    expect(nasImageToken()).toBe('');
    expect(nasImageUrl('a.jpg')).toBe('/api/nas-image?path=a.jpg');
  });
});

describe('ensureNasImageToken', () => {
  it('is a no-op outside Cloudflare production builds', async () => {
    // Vitest runs with PROD === false, so the proxy stays disabled here.
    expect(isNasImageProxyEnabled()).toBe(false);
    await expect(ensureNasImageToken()).resolves.toBe('');
  });

  it('never performs a network call while disabled', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await ensureNasImageToken();
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
