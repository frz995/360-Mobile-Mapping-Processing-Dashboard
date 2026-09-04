import { describe, it, expect } from 'vitest';
import { resolvePanoramaUrl, resolvePanoramaConfigUrl } from '../../services/supabase';
import { usePanoramaViewer } from '../../hooks/usePanoramaViewer';
import { renderHook } from '@testing-library/react';

describe('resolvePanoramaUrl with Supabase Bucket Provider', () => {
  const baseSettings = {
    storageProvider: 'supabase' as const,
    supabaseBucket: 'MMS_PIC',
    imageFormatPattern: '{subgrid}-{index:04d}.jpg'
  };

  it('resolves a simple equirectangular filename into a valid Supabase public storage URL', () => {
    const url = resolvePanoramaUrl('N93E70-0005.jpg', baseSettings);
    expect(url).toBe('https://tqqybumedywzylujjkqa.supabase.co/storage/v1/object/public/MMS_PIC/N93E70-0005.jpg');
  });

  it('strips redundant MMS_PIC bucket and storage/v1 prefixes to prevent double-nested URLs', () => {
    const url1 = resolvePanoramaUrl('MMS_PIC/N93E70-0005.jpg', baseSettings);
    expect(url1).toBe('https://tqqybumedywzylujjkqa.supabase.co/storage/v1/object/public/MMS_PIC/N93E70-0005.jpg');

    const url2 = resolvePanoramaUrl('/storage/v1/object/public/MMS_PIC/N93E70-0005.jpg', baseSettings);
    expect(url2).toBe('https://tqqybumedywzylujjkqa.supabase.co/storage/v1/object/public/MMS_PIC/N93E70-0005.jpg');

    const url3 = resolvePanoramaUrl('/mms_pic/N93E70-0005.jpg', baseSettings);
    expect(url3).toBe('https://tqqybumedywzylujjkqa.supabase.co/storage/v1/object/public/MMS_PIC/N93E70-0005.jpg');
  });

  it('does not corrupt concrete filenames with {index:04d} from imageFormatPattern', () => {
    const url = resolvePanoramaUrl('N93E70-0010.jpg', {
      ...baseSettings,
      imageFormatPattern: '{subgrid}-{index:04d}.jpg'
    });
    expect(url).not.toContain('{index:04d}');
    expect(url).toBe('https://tqqybumedywzylujjkqa.supabase.co/storage/v1/object/public/MMS_PIC/N93E70-0010.jpg');
  });

  it('falls back safely to active VITE_SUPABASE_URL when stale placeholder URL is present', () => {
    const url = resolvePanoramaUrl('N93E70-0001.jpg', {
      ...baseSettings,
      supabaseUrl: 'https://frz995-360-processing.supabase.co'
    });
    expect(url).toContain('https://tqqybumedywzylujjkqa.supabase.co');
    expect(url).not.toContain('frz995-360-processing');
  });

  it('passes through full absolute http/https URLs untouched', () => {
    const directUrl = 'https://my-cdn.com/panos/image.jpg';
    expect(resolvePanoramaUrl(directUrl, baseSettings)).toBe(directUrl);
  });

  it('resolves multi-res config URL for Supabase provider with default tile pattern', () => {
    const configUrl = resolvePanoramaConfigUrl('N93E70-0005.jpg', baseSettings, 'N93E70');
    expect(configUrl).toBe(
      'https://tqqybumedywzylujjkqa.supabase.co/storage/v1/object/public/MMS_PIC/tiles/N93E70/N93E70-0005/config.json'
    );
  });

  it('returns empty string if filename is not provided to resolvePanoramaConfigUrl', () => {
    expect(resolvePanoramaConfigUrl('', baseSettings)).toBe('');
    expect(resolvePanoramaConfigUrl(undefined, baseSettings)).toBe('');
  });
});

describe('usePanoramaViewer with Supabase Provider', () => {
  it('forces shouldUseMultiRes to false for Supabase even if multires_tiles strategy was selected', () => {
    const { result } = renderHook(() =>
      usePanoramaViewer({
        storageProvider: 'supabase',
        imageStorageStrategy: 'multires_tiles'
      })
    );

    expect(result.current.shouldUseMultiRes).toBe(false);
    expect(result.current.viewerDisplayName).toBe('PSV Equirectangular');
    expect(result.current.engineName).toBe('PhotoSphereViewer (Standard Equirectangular)');
  });
});

describe('resolvePanoramaUrl with Cloudflare R2 Provider', () => {
  const cfSettings = {
    storageProvider: 'cloudflare_r2' as const,
    r2Domain: 'https://pub-abc123xyz.r2.dev',
    imageStorageStrategy: 'single_equirectangular' as const
  };

  it('resolves flat 0001.jpg and station filenames to Cloudflare public domain', () => {
    expect(resolvePanoramaUrl('0001.jpg', cfSettings)).toBe('https://pub-abc123xyz.r2.dev/0001.jpg');
    expect(resolvePanoramaUrl('N93E70-0001.jpg', cfSettings)).toBe('https://pub-abc123xyz.r2.dev/N93E70-0001.jpg');
  });

  it('extracts filename and transforms incoming Supabase URLs to Cloudflare R2 URLs when provider is Cloudflare', () => {
    const supabaseUrl = 'https://tqqybumedywzylujjkqa.supabase.co/storage/v1/object/public/MMS_PIC/N93E70-0001.jpg';
    expect(resolvePanoramaUrl(supabaseUrl, cfSettings)).toBe('https://pub-abc123xyz.r2.dev/N93E70-0001.jpg');
  });

  it('does not append /fallback/f.jpg unless asFallback is explicitly requested', () => {
    const multiResSettings = {
      ...cfSettings,
      imageStorageStrategy: 'multires_tiles' as const
    };
    // Standard image request: returns flat image URL
    expect(resolvePanoramaUrl('0001.jpg', multiResSettings)).toBe('https://pub-abc123xyz.r2.dev/0001.jpg');
    // Explicit fallback request: returns cubemap fallback face
    expect(resolvePanoramaUrl('N93E70-0001.jpg', multiResSettings, { asFallback: true, subgrid: 'N93E70' }))
      .toBe('https://pub-abc123xyz.r2.dev/tiles/N93E70/N93E70-0001/fallback/f.jpg');
  });
});

