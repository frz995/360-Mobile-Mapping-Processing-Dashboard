import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveOrganizationId,
  setActiveOrganizationId,
  getActiveOrganizationStorage,
  setActiveOrganizationStorage,
  ACTIVE_ORGANIZATION_KEY,
  ACTIVE_ORGANIZATION_STORAGE_KEY,
  type OrganizationStorageConfig
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
});
