import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveOrganizationId,
  setActiveOrganizationId,
  getActiveOrganizationStorage,
  setActiveOrganizationStorage,
  ACTIVE_ORGANIZATION_KEY,
  ACTIVE_ORGANIZATION_STORAGE_KEY,
  applyTenantScope,
  resolveActiveTenantProject,
  type OrganizationStorageConfig,
  type Organization
} from '../tenantContext';

describe('tenantContext multi-tab session isolation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setActiveOrganizationId(null);
  });

  it('writes active tenant to both sessionStorage and localStorage', () => {
    setActiveOrganizationId('org-alpha');
    expect(sessionStorage.getItem(ACTIVE_ORGANIZATION_KEY)).toBe('org-alpha');
    expect(localStorage.getItem(ACTIVE_ORGANIZATION_KEY)).toBe('org-alpha');
    expect(getActiveOrganizationId()).toBe('org-alpha');
  });

  it('prioritizes tab-scoped sessionStorage over localStorage', () => {
    // Simulate Tab 1 having org-tab-1 while Tab 2 set localStorage to org-tab-2
    sessionStorage.setItem(ACTIVE_ORGANIZATION_KEY, 'org-tab-1');
    localStorage.setItem(ACTIVE_ORGANIZATION_KEY, 'org-tab-2');

    // Reset memory variable so it reads from storage
    setActiveOrganizationId('org-tab-1');
    localStorage.setItem(ACTIVE_ORGANIZATION_KEY, 'org-tab-2');

    expect(getActiveOrganizationId()).toBe('org-tab-1');
  });

  it('falls back to localStorage if sessionStorage is empty', () => {
    localStorage.setItem(ACTIVE_ORGANIZATION_KEY, 'org-fallback');
    expect(getActiveOrganizationId()).toBe('org-fallback');
  });

  it('clears both sessionStorage and localStorage when setActiveOrganizationId(null)', () => {
    setActiveOrganizationId('org-beta');
    const storageConfig: OrganizationStorageConfig = {
      provider: 'cloudflare_r2',
      bucketName: 'beta-bucket',
      cdnUrl: 'https://cdn.beta.com'
    };
    setActiveOrganizationStorage(storageConfig);

    expect(sessionStorage.getItem(ACTIVE_ORGANIZATION_KEY)).toBe('org-beta');
    expect(sessionStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)).toContain('beta-bucket');

    setActiveOrganizationId(null);

    expect(sessionStorage.getItem(ACTIVE_ORGANIZATION_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_ORGANIZATION_KEY)).toBeNull();
    expect(sessionStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)).toBeNull();
    expect(getActiveOrganizationId()).toBeNull();
    expect(getActiveOrganizationStorage()).toBeNull();
  });

  it('manages tenantStorage configuration with sessionStorage prioritization', () => {
    const tabConfig: OrganizationStorageConfig = {
      provider: 'cloudflare_r2',
      bucketName: 'tab1-bucket',
      cdnUrl: 'https://cdn.tab1.com'
    };
    const globalConfig: OrganizationStorageConfig = {
      provider: 'aws_s3',
      bucketName: 'tab2-bucket',
      cdnUrl: 'https://cdn.tab2.com'
    };

    setActiveOrganizationStorage(tabConfig);
    // Simulate another tab modifying localStorage
    localStorage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, JSON.stringify(globalConfig));

    expect(getActiveOrganizationStorage()?.bucketName).toBe('tab1-bucket');
  });

  describe('applyTenantScope', () => {
    it('applies Cloud Shared RLS architecture and default storage for SaaS clients', () => {
      const org: Organization = {
        id: 'org-geosolution',
        name: 'Geosolution',
        slug: 'geosolution',
        clientCode: 'GSS',
        databaseType: 'cloud_shared',
        databaseConfig: {},
        status: 'active',
        licenseType: 'cloud_saas',
        licenseExpiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        settings: {
          storage: { provider: 'supabase' },
          webgisUrl: 'https://webgis.geosolution.com'
        }
      };

      const result = applyTenantScope({}, org);
      expect(result.clientName).toBe('Geosolution');
      expect(result.clientCode).toBe('GSS');
      expect(result.databaseProvider).toBe('supabase_cloud');
      expect(result.storageProvider).toBe('supabase');
      expect(result.supabaseBucket).toBe('panoramas');
      expect(result.webgisHost).toBe('https://webgis.geosolution.com');
    });

    it('applies Dedicated External DB and custom storage configuration', () => {
      const org: Organization = {
        id: 'org-devtest',
        name: 'GeoSphere - DevTest',
        slug: 'geosphere-devtest',
        clientCode: 'DevTest',
        databaseType: 'dedicated_external',
        databaseConfig: {
          url: 'http://192.168.1.100:8000',
          anonKey: 'anon-key-devtest-123'
        },
        status: 'active',
        licenseType: 'enterprise_dedicated',
        licenseExpiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        settings: {
          storage: {
            provider: 'cloudflare_r2',
            cdnUrl: 'https://cdn.devtest.com'
          }
        }
      };

      const result = applyTenantScope({}, org);
      expect(result.clientName).toBe('GeoSphere - DevTest');
      expect(result.databaseProvider).toBe('standalone_server');
      expect(result.supabaseUrl).toBe('http://192.168.1.100:8000');
      expect(result.supabaseKey).toBe('anon-key-devtest-123');
      expect(result.storageProvider).toBe('cloudflare_r2');
      expect(result.r2Domain).toBe('https://cdn.devtest.com');
    });

    it('applies Self-Hosted Supabase Storage configuration', () => {
      const org: Organization = {
        id: 'org-local',
        name: 'Local Test Org',
        slug: 'local-test',
        clientCode: 'LOCAL',
        databaseType: 'dedicated_external',
        databaseConfig: {
          url: 'http://localhost:8000',
          anonKey: 'local-anon-key'
        },
        status: 'active',
        licenseType: 'enterprise_dedicated',
        licenseExpiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        settings: {
          storage: {
            provider: 'supabase_self_hosted',
            bucketName: 'MMS_PIC',
            cdnUrl: 'http://localhost:8000'
          }
        }
      };

      const result = applyTenantScope({}, org);
      expect(result.storageProvider).toBe('supabase_self_hosted');
      expect(result.selfHostedStorageUrl).toBe('http://localhost:8000');
      expect(result.selfHostedBucket).toBe('MMS_PIC');
      expect(result.supabaseBucket).toBe('MMS_PIC');
      expect(result.imageStoragePath).toBe('/storage/v1/object/public/MMS_PIC/');
    });
  });

  describe('resolveActiveTenantProject', () => {
    it('restores savedId if present in tenant projects', () => {
      const projects = [{ id: 'p1', name: 'Proj 1' }, { id: 'p2', name: 'Proj 2' }];
      expect(resolveActiveTenantProject(projects, 'p2', null)?.id).toBe('p2');
    });

    it('falls back to legacyId if savedId is absent but legacy project belongs to this tenant', () => {
      const projects = [{ id: 'p1', name: 'Proj 1' }, { id: 'p2', name: 'Proj 2' }];
      expect(resolveActiveTenantProject(projects, null, 'p1')?.id).toBe('p1');
    });

    it('auto-selects first non-archived project if no saved project exists', () => {
      const projects = [
        { id: 'p-archived', name: 'Archived', status: 'archived' },
        { id: 'p-active', name: 'Active', status: 'active' }
      ];
      expect(resolveActiveTenantProject(projects, null, null)?.id).toBe('p-active');
    });

    it('returns null if tenant has no projects', () => {
      expect(resolveActiveTenantProject([], 'p1', 'p2')).toBeNull();
    });
  });
});
