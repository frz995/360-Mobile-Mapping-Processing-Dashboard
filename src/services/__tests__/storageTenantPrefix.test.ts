import { describe, it, expect } from 'vitest';
import {
  applyTenantObjectPrefix,
  buildTenantObjectPrefix,
  resolvePanoramaUrl,
  resolvePanoramaConfigUrl,
  TENANT_OBJECT_ROOT
} from '../storageUrls';

/**
 * Tenant object-key namespacing.
 *
 * The invariant under test is the one migration 0041's storage policies rely
 * on: a key that names one company must not be reachable by another, and a
 * key that names no company must not be reachable by any tenant at all.
 */

const ORG_A = '0a000000-0000-4000-8000-0000000000a1';
const ORG_B = '0b000000-0000-4000-8000-0000000000b1';

const supabaseSettings = {
  storageProvider: 'supabase',
  supabaseUrl: 'https://project.supabase.co',
  supabaseBucket: 'MMS_PIC'
};

describe('buildTenantObjectPrefix', () => {
  it('emits the orgs/<uuid> convention', () => {
    expect(buildTenantObjectPrefix(ORG_A)).toBe(`${TENANT_OBJECT_ROOT}/${ORG_A}`);
  });

  it('returns an empty prefix for a missing organization', () => {
    // Absent is the legacy flat layout, which the bootstrap organization still
    // uses. Returning '' rather than null keeps "not configured" and
    // "configured blank" distinguishable at the call site.
    expect(buildTenantObjectPrefix(null)).toBe('');
    expect(buildTenantObjectPrefix(undefined)).toBe('');
    expect(buildTenantObjectPrefix('')).toBe('');
  });

  it('refuses a malformed organization id', () => {
    // A bad prefix would scatter objects under keys the storage policies do not
    // recognise — silently invisible, which is worse than loudly wrong.
    expect(buildTenantObjectPrefix('not-a-uuid')).toBe('');
    expect(buildTenantObjectPrefix('orgs/x')).toBe('');
    expect(buildTenantObjectPrefix('0a000000-0000-4000-8000')).toBe('');
  });
});

describe('applyTenantObjectPrefix', () => {
  it('prefixes a bare key', () => {
    expect(applyTenantObjectPrefix('N93E70-0001.jpg', ORG_A)).toBe(
      `orgs/${ORG_A}/N93E70-0001.jpg`
    );
  });

  it('preserves an existing subfolder', () => {
    expect(applyTenantObjectPrefix('tiles/N93E70/point/config.json', ORG_A)).toBe(
      `orgs/${ORG_A}/tiles/N93E70/point/config.json`
    );
  });

  it('strips a leading slash rather than doubling it', () => {
    expect(applyTenantObjectPrefix('/N93E70-0001.jpg', ORG_A)).toBe(`orgs/${ORG_A}/N93E70-0001.jpg`);
  });

  it('is idempotent, so re-reading a stored key cannot drift', () => {
    const once = applyTenantObjectPrefix('N93E70-0001.jpg', ORG_A);
    expect(applyTenantObjectPrefix(once, ORG_A)).toBe(once);
  });

  it('leaves another organization’s key alone rather than re-homing it', () => {
    // A stored key already names its company. Re-prefixing would let a caller
    // move an object between tenants by re-reading it.
    const orgBKey = `orgs/${ORG_B}/N93E70-0001.jpg`;
    expect(applyTenantObjectPrefix(orgBKey, ORG_A)).toBe(orgBKey);
  });

  it('leaves the path untouched when no organization is supplied', () => {
    expect(applyTenantObjectPrefix('N93E70-0001.jpg', null)).toBe('N93E70-0001.jpg');
  });
});

describe('resolvePanoramaUrl with a tenant scope', () => {
  it('scopes the Supabase object key to the organization', () => {
    const url = resolvePanoramaUrl('N93E70-0001.jpg', {
      ...supabaseSettings,
      tenantOrganizationId: ORG_A
    });
    expect(url).toBe(`https://project.supabase.co/storage/v1/object/public/MMS_PIC/orgs/${ORG_A}/N93E70-0001.jpg`);
  });

  it('produces different keys for two organizations — the whole point', () => {
    const a = resolvePanoramaUrl('N93E70-0001.jpg', { ...supabaseSettings, tenantOrganizationId: ORG_A });
    const b = resolvePanoramaUrl('N93E70-0001.jpg', { ...supabaseSettings, tenantOrganizationId: ORG_B });
    expect(a).not.toBe(b);
    expect(a).toContain(ORG_A);
    expect(b).toContain(ORG_B);
  });

  it('leaves the legacy flat key when no organization is set', () => {
    const url = resolvePanoramaUrl('N93E70-0001.jpg', supabaseSettings);
    expect(url).toBe('https://project.supabase.co/storage/v1/object/public/MMS_PIC/N93E70-0001.jpg');
  });

  it('uses the authenticated endpoint for a private bucket', () => {
    const url = resolvePanoramaUrl('N93E70-0001.jpg', {
      ...supabaseSettings,
      isPrivateBucket: true,
      tenantOrganizationId: ORG_A
    });
    expect(url).toContain('/storage/v1/object/authenticated/');
    expect(url).toContain(`orgs/${ORG_A}`);
  });

  it('does not prefix a non-Supabase provider, whose key layout it does not own', () => {
    const url = resolvePanoramaUrl('N93E70-0001.jpg', {
      storageProvider: 'cloudflare_r2',
      r2Domain: 'https://pub-abc.r2.dev',
      tenantOrganizationId: ORG_A
    });
    expect(url).toBe('https://pub-abc.r2.dev/N93E70-0001.jpg');
  });
});

describe('resolvePanoramaConfigUrl with a tenant scope', () => {
  it('scopes the tile config path to the organization', () => {
    const url = resolvePanoramaConfigUrl(
      'N93E70-0005.jpg',
      { ...supabaseSettings, tenantOrganizationId: ORG_A },
      'N93E70'
    );
    expect(url).toContain(`orgs/${ORG_A}/tiles/N93E70/`);
    expect(url).toContain('config.json');
  });

  it('still returns an empty string when there is no filename', () => {
    expect(resolvePanoramaConfigUrl('', { ...supabaseSettings, tenantOrganizationId: ORG_A })).toBe('');
    expect(
      resolvePanoramaConfigUrl(undefined, { ...supabaseSettings, tenantOrganizationId: ORG_A })
    ).toBe('');
  });
});