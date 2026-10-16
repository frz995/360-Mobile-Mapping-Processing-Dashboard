import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getActiveOrganizationId,
  setActiveOrganizationId,
  getActiveOrganizationStorage,
  setActiveOrganizationStorage,
  getActiveOrganizationWebgis,
  setActiveOrganizationWebgis,
  getActiveOrganizationClientCode,
  setActiveOrganizationClientCode,
  fetchR2BucketUsage
} from '../tenantStorage';

describe('tenantStorage service', () => {
  beforeEach(() => {
    setActiveOrganizationId(null);
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setActiveOrganizationId(null);
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('manages active organization id and storage in memory and storage', () => {
    expect(getActiveOrganizationId()).toBeNull();
    setActiveOrganizationId('org-123');
    expect(getActiveOrganizationId()).toBe('org-123');

    setActiveOrganizationStorage({
      provider: 'cloudflare_r2',
      bucketName: 'test-bucket',
      byosQuotaGb: 500,
      imageStorageStrategy: 'multires_tiles'
    });

    const storage = getActiveOrganizationStorage();
    expect(storage?.provider).toBe('cloudflare_r2');
    expect(storage?.bucketName).toBe('test-bucket');
    expect(storage?.byosQuotaGb).toBe(500);
    expect(storage?.imageStorageStrategy).toBe('multires_tiles');

    setActiveOrganizationWebgis('https://map.example.com');
    expect(getActiveOrganizationWebgis()).toBe('https://map.example.com');

    setActiveOrganizationClientCode('CLIENT-99');
    expect(getActiveOrganizationClientCode()).toBe('CLIENT-99');

    // Clear
    setActiveOrganizationId(null);
    expect(getActiveOrganizationId()).toBeNull();
    expect(getActiveOrganizationStorage()).toBeNull();
  });

  describe('fetchR2BucketUsage', () => {
    it('returns error when missing parameters', async () => {
      const res = await fetchR2BucketUsage('', '', '');
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Missing account ID/);
    });

    it('queries Cloudflare R2 bucket usage and returns byte metrics', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            storageSize: 53687091200, // 50 GB
            objectCount: 1420
          }
        })
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await fetchR2BucketUsage('acc-123', 'geosphere-panorama', 'token-abc');
      expect(res.success).toBe(true);
      expect(res.storageSizeBytes).toBe(53687091200);
      expect(res.objectCount).toBe(1420);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/acc-123/r2/buckets/geosphere-panorama/usage',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token-abc'
          })
        })
      );
    });

    it('handles HTTP error status from Cloudflare', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Invalid token'
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await fetchR2BucketUsage('acc-123', 'geosphere-panorama', 'bad-token');
      expect(res.success).toBe(false);
      expect(res.error).toContain('HTTP 403');
    });
  });
});
