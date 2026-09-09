import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  buildManifestUrl,
  countFramesFromManifest,
  fetchFrameManifest,
  resolveProviderBaseUrl,
  resolveStorageProvider,
  type StorageSettingsForManifest
} from '../storageInventory';

describe('storageInventory — provider resolution', () => {
  it('defaults to cloudflare_r2 exactly like resolvePanoramaUrl', () => {
    expect(resolveStorageProvider()).toBe('cloudflare_r2');
    expect(resolveStorageProvider({})).toBe('cloudflare_r2');
  });

  it('prefers settings then env then default', () => {
    vi.stubEnv('VITE_STORAGE_PROVIDER', 'aws_s3');
    expect(resolveStorageProvider({})).toBe('aws_s3');
    vi.unstubAllEnvs();
    expect(resolveStorageProvider({ storageProvider: 'supabase' })).toBe('supabase');
    expect(resolveStorageProvider({ storageProvider: 'Cloudflare_R2' })).toBe('cloudflare_r2');
  });
});

describe('storageInventory — provider base URLs', () => {
  it('builds Cloudflare R2 / custom_cdn base from domain settings', () => {
    const settings: StorageSettingsForManifest = {
      storageProvider: 'cloudflare_r2',
      r2Domain: 'pub-abc123xyz.r2.dev'
    };
    expect(resolveProviderBaseUrl(settings)).toBe('https://pub-abc123xyz.r2.dev');
  });

  it('falls back to VITE_R2_DOMAIN env for R2', () => {
    vi.stubEnv('VITE_R2_DOMAIN', 'media.example.com');
    const settings: StorageSettingsForManifest = { storageProvider: 'cloudflare_r2' };
    expect(resolveProviderBaseUrl(settings)).toBe('https://media.example.com');
    vi.unstubAllEnvs();
  });

  it('builds AWS S3 base', () => {
    const settings: StorageSettingsForManifest = { storageProvider: 'aws_s3', s3Bucket: 'mms-pic', s3Region: 'ap-southeast-1' };
    expect(resolveProviderBaseUrl(settings)).toBe('https://mms-pic.s3.ap-southeast-1.amazonaws.com');
  });

  it('builds GCS base', () => {
    const settings: StorageSettingsForManifest = { storageProvider: 'gcs', gcsBucket: 'tnb-gis-360-panoramas' };
    expect(resolveProviderBaseUrl(settings)).toBe('https://storage.googleapis.com/tnb-gis-360-panoramas');
  });

  it('builds Azure Blob base', () => {
    const settings: StorageSettingsForManifest = { storageProvider: 'azure_blob', azureAccount: 'tnbgisstorage', azureContainer: 'panoramas' };
    expect(resolveProviderBaseUrl(settings)).toBe('https://tnbgisstorage.blob.core.windows.net/panoramas');
  });

  it('builds Wasabi base', () => {
    const settings: StorageSettingsForManifest = { storageProvider: 'wasabi', wasabiBucket: 'tnb-wasabi-panoramas', wasabiRegion: 'us-east-1' };
    expect(resolveProviderBaseUrl(settings)).toBe('https://s3.us-east-1.wasabisys.com/tnb-wasabi-panoramas');
  });

  it('builds NAS base', () => {
    const settings: StorageSettingsForManifest = { storageProvider: 'nas_local', nasServerUrl: 'http://192.168.1.50/360_images' };
    expect(resolveProviderBaseUrl(settings)).toBe('http://192.168.1.50/360_images');
  });

  it('returns empty base for supabase (manifest never used)', () => {
    expect(resolveProviderBaseUrl({ storageProvider: 'supabase' })).toBe('');
  });
});

describe('storageInventory — manifest URL building', () => {
  it('defaults to manifest.json at the bucket root', () => {
    const settings: StorageSettingsForManifest = { storageProvider: 'cloudflare_r2', r2Domain: 'pub-abc123xyz.r2.dev' };
    expect(buildManifestUrl(settings)).toBe('https://pub-abc123xyz.r2.dev/manifest.json');
  });

  it('honours a custom manifestPath and cleans leading slashes', () => {
    const settings: StorageSettingsForManifest = {
      storageProvider: 'custom_cdn',
      customCdnUrl: 'https://cdn.example.com/panoramas/',
      manifestPath: '/meta/frames.json'
    };
    expect(buildManifestUrl(settings)).toBe('https://cdn.example.com/panoramas/meta/frames.json');
  });

  it('returns empty when no base is resolvable', () => {
    expect(buildManifestUrl({ storageProvider: 'cloudflare_r2' })).toBe('');
    expect(buildManifestUrl({ storageProvider: 'supabase' })).toBe('');
  });
});

describe('storageInventory — fetchFrameManifest', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a valid manifest on 200 with a frames array', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ version: 1, layout: 'multires_tiles', frames: [] }) });
    const manifest = await fetchFrameManifest('https://pub-abc.r2.dev/manifest.json');
    expect(manifest?.layout).toBe('multires_tiles');
    expect(Array.isArray(manifest?.frames)).toBe(true);
  });

  it('returns null on non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchFrameManifest('https://pub-abc.r2.dev/manifest.json')).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    expect(await fetchFrameManifest('https://pub-abc.r2.dev/manifest.json')).toBeNull();
  });

  it('returns null when the shape has no frames array', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ hello: 'world' }) });
    expect(await fetchFrameManifest('https://pub-abc.r2.dev/manifest.json')).toBeNull();
  });

  it('returns null on network failure (never throws)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await fetchFrameManifest('https://pub-abc.r2.dev/manifest.json')).toBeNull();
  });

  it('returns null for an empty URL without touching fetch', async () => {
    expect(await fetchFrameManifest('')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('storageInventory — layout-aware frame counting', () => {
  it('collapses multi-res tile pyramids to distinct station folders', () => {
    const manifest = {
      version: 1,
      layout: 'multires_tiles',
      frames: [
        { subgrid: 'N93E70', pointFolder: 'N93E70-0015', filename: 'N93E70-0015.jpg', path: 'tiles/N93E70/N93E70-0015/config.json' },
        { subgrid: 'N93E70', pointFolder: 'N93E70-0015', filename: 'N93E70-0015.jpg', path: 'tiles/N93E70/N93E70-0015/config.json' },
        { subgrid: 'N93E70', pointFolder: 'N93E70-0016', filename: 'N93E70-0016.jpg', path: 'tiles/N93E70/N93E70-0016/config.json' },
        { subgrid: 'N93F20', pointFolder: 'N93F20-0001', filename: 'file://n93f20-0001.jpg', path: 'tiles/N93F20/N93F20-0001/config.json' }
      ]
    };
    const counted = countFramesFromManifest(manifest);
    expect(counted.totalFiles).toBe(3);
    expect(counted.countsBySubgrid.get('N93E70')).toBe(2);
    expect(counted.countsBySubgrid.get('N93F20')).toBe(1);
    expect(counted.fileSet.has('n93e70-0015.jpg')).toBe(true);
    expect(counted.fileSet.has('N93E70-0016.jpg'.toLowerCase())).toBe(true);
  });

  it('counts every frame as a file for single_equirectangular', () => {
    const manifest = {
      version: 1,
      layout: 'single_equirectangular',
      frames: [
        { subgrid: 'N93E70', pointFolder: 'N93E70-0001', filename: 'N93E70-0001.jpg' },
        { subgrid: 'N93E70', pointFolder: 'N93E70-0002', filename: 'N93E70-0002.jpg' },
        { subgrid: 'N93E70', pointFolder: 'N93E70-0003', filename: 'N93E70-0003.jpg' }
      ]
    };
    const counted = countFramesFromManifest(manifest);
    expect(counted.totalFiles).toBe(3);
    expect(counted.countsBySubgrid.get('N93E70')).toBe(3);
  });

  it('uses imageStorageStrategy when manifest has no layout', () => {
    const manifest = { version: 1, frames: [
      { subgrid: 'SG01', pointFolder: 'SG01-0001', filename: 'SG01-0001.jpg' },
      { subgrid: 'SG01', pointFolder: 'SG01-0002', filename: 'SG01-0002.jpg' }
    ] };
    expect(countFramesFromManifest(manifest, { storageProvider: 'supabase', imageStorageStrategy: 'single_equirectangular' }).totalFiles).toBe(2);
    expect(countFramesFromManifest(manifest, { storageProvider: 'supabase', imageStorageStrategy: 'multires_tiles' }).totalFiles).toBe(2);
  });

  it('adds both the full token and basename to fileSet for verification', () => {
    const manifest = { version: 1, frames: [
      { subgrid: 'N93E70', pointFolder: 'N93E70-0001', filename: 'tiles/N93E70/N93E70-0001.jpg' }
    ] };
    const counted = countFramesFromManifest(manifest, { imageStorageStrategy: 'single_equirectangular' });
    expect(counted.fileSet.has('tiles/n93e70/n93e70-0001.jpg')).toBe(true);
    expect(counted.fileSet.has('n93e70-0001.jpg')).toBe(true);
  });

  it('ignores malformed frames and derives subgrid from filename when missing', () => {
    const manifest = { version: 1, frames: [
      { pointFolder: 'N93E70-0001' },
      { filename: 'N93E70-0002.jpg' },
      { subgrid: 'N93E70', filename: '.hidden' },
      { path: 'tiles/N93E70/N93E70-0003/config.json' }
    ] };
    const counted = countFramesFromManifest(manifest);
    expect(counted.totalFiles).toBe(2);
    expect(counted.countsBySubgrid.get('N93E70')).toBe(2);
    expect(counted.fileSet.has('n93e70-0001.jpg')).toBe(true);
    expect(counted.fileSet.has('n93e70-0002.jpg')).toBe(true);
  });

  it('returns zero counts for empty or missing frames', () => {
    expect(countFramesFromManifest(null).totalFiles).toBe(0);
    expect(countFramesFromManifest({ version: 1, frames: [] }).totalFiles).toBe(0);
  });
});