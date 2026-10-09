import { describe, it, expect } from 'vitest';
import {
  formatCloudflareUrl,
  resolvePanoramaUrl,
  resolvePanoramaConfigUrl,
  sanitizeBucketName,
  type StorageResolveSettings
} from '../storageUrls';
import {
  setCachedSignedPanoramaUrl,
  clearSignedPanoramaUrlCache
} from '../signedPanoramaUrls';

const defaultSettings: StorageResolveSettings = {
  storageProvider: 'cloudflare_r2',
  imageStorageStrategy: 'multires_tile',
  r2Domain: 'pub-23569d9628d547acb97ec86212ecd51a.r2.dev',
  supabaseUrl: 'https://tqqybumedywzylujjkqa.supabase.co',
  supabaseBucket: 'MMS_PIC'
};

describe('formatCloudflareUrl', () => {
  it('prepends https when no scheme is present', () => {
    expect(formatCloudflareUrl('pub-xxx.r2.dev')).toBe('https://pub-xxx.r2.dev');
  });

  it('strips trailing slashes', () => {
    expect(formatCloudflareUrl('https://cdn.example.com///')).toBe('https://cdn.example.com');
  });

  it('returns empty string for empty input', () => {
    expect(formatCloudflareUrl('')).toBe('');
    expect(formatCloudflareUrl('   ')).toBe('');
  });
});

describe('resolvePanoramaUrl — flat resolution', () => {
  it('resolves a flat filename against the configured R2 domain', () => {
    const url = resolvePanoramaUrl('N93E70-0001.jpg', defaultSettings);
    expect(url).toBe('https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev/N93E70-0001.jpg');
  });

  it('strips legacy storage prefixes', () => {
    const url = resolvePanoramaUrl('storage/v1/object/public/MMS_PIC/PICTURES/A.jpg', defaultSettings);
    expect(url).toBe('https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev/PICTURES/A.jpg');
  });
});

describe('resolvePanoramaUrl — multi-res fallback', () => {
  it('returns the default fallback cube face path', () => {
    const url = resolvePanoramaUrl('N93E70-0001', defaultSettings, { asFallback: true });
    expect(url).toBe('https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev/tiles/N93E70/N93E70-0001/fallback/f.jpg');
  });

  it('honours an explicit subgrid override', () => {
    const url = resolvePanoramaUrl('N93E70-0001', defaultSettings, { asFallback: true, subgrid: 'N94E71' });
    expect(url).toBe('https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev/tiles/N94E71/N93E70-0001/fallback/f.jpg');
  });

  it('substitutes the multiResFallbackPattern template', () => {
    const settings: StorageResolveSettings = {
      ...defaultSettings,
      multiResFallbackPattern: 'tiles/{subgrid}/{pointFolder}/fallback/{face}.jpg'
    };
    const url = resolvePanoramaUrl('N93E70-0001', settings, { asFallback: true });
    expect(url).toBe('https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev/tiles/N93E70/N93E70-0001/fallback/{face}.jpg');
  });
});

describe('resolvePanoramaConfigUrl', () => {
  it('resolves the default config pattern for R2', () => {
    const url = resolvePanoramaConfigUrl('N93E70-0001', defaultSettings);
    expect(url).toBe('https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev/tiles/N93E70/N93E70-0001/config.json');
  });

  it('resolves to a supabase storage URL when provider is supabase', () => {
    const settings: StorageResolveSettings = {
      storageProvider: 'supabase',
      supabaseUrl: 'https://xx.supabase.co',
      supabaseBucket: 'MMS_PIC'
    };
    const url = resolvePanoramaConfigUrl('N93E70-0001.jpg', settings);
    expect(url).toBe('https://xx.supabase.co/storage/v1/object/public/MMS_PIC/tiles/N93E70/N93E70-0001/config.json');
  });

  it('returns empty string when no base URL is configured', () => {
    expect(resolvePanoramaConfigUrl('N93E70-0001', {})).toBe('');
  });

  it('resolves to authenticated endpoint when isPrivateBucket is enabled', () => {
    const settings: StorageResolveSettings = {
      storageProvider: 'supabase',
      supabaseUrl: 'https://xx.supabase.co',
      supabaseBucket: 'MMS_PIC',
      isPrivateBucket: true
    };
    const url = resolvePanoramaConfigUrl('N93E70-0001.jpg', settings);
    expect(url).toBe('https://xx.supabase.co/storage/v1/object/authenticated/MMS_PIC/tiles/N93E70/N93E70-0001/config.json');
  });

  it('uses cached signed URL for config.json when present in cache', () => {
    setCachedSignedPanoramaUrl(
      'tiles/N93E70/N93E70-0001/config.json',
      'https://signed.cdn.com/tiles/N93E70/N93E70-0001/config.json?signature=xyz'
    );
    const url = resolvePanoramaConfigUrl('N93E70-0001', defaultSettings);
    expect(url).toBe('https://signed.cdn.com/tiles/N93E70/N93E70-0001/config.json?signature=xyz');
    clearSignedPanoramaUrlCache();
  });
});

describe('sanitizeBucketName & private bucket URL resolution', () => {
  it('sanitizes spaces into underscores', () => {
    expect(sanitizeBucketName('MMS PIC')).toBe('MMS_PIC');
    expect(sanitizeBucketName('  custom  bucket  ')).toBe('custom_bucket');
  });

  it('resolves Supabase private bucket to authenticated endpoint', () => {
    const settings: StorageResolveSettings = {
      storageProvider: 'supabase',
      supabaseUrl: 'https://secure.supabase.co',
      supabaseBucket: 'MMS_PIC',
      isPrivateBucket: true
    };
    const url = resolvePanoramaUrl('N93E70-0001.jpg', settings);
    expect(url).toBe('https://secure.supabase.co/storage/v1/object/authenticated/MMS_PIC/N93E70-0001.jpg');
  });

  it('resolves using cached signed URL if one exists for panorama', () => {
    setCachedSignedPanoramaUrl('N93E70-0001.jpg', 'https://signed.r2.cloud/N93E70-0001.jpg?token=secret');
    const url = resolvePanoramaUrl('N93E70-0001.jpg', defaultSettings);
    expect(url).toBe('https://signed.r2.cloud/N93E70-0001.jpg?token=secret');
    clearSignedPanoramaUrlCache();
  });
});