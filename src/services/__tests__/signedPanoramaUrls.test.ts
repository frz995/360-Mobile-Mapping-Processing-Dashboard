import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedSignedPanoramaUrl,
  setCachedSignedPanoramaUrl,
  clearSignedPanoramaUrlCache,
  getSignedPanoramaUrlCacheSize,
  ensureSignedPanoramaUrl,
  batchPreloadSignedPanoramaUrls,
  DEFAULT_SIGNED_URL_TTL_SECONDS
} from '../signedPanoramaUrls';
import { supabase } from '../api/client';

describe('signedPanoramaUrls cache operations', () => {
  beforeEach(() => {
    clearSignedPanoramaUrlCache();
  });

  it('returns null for empty or non-existent keys', () => {
    expect(getCachedSignedPanoramaUrl('')).toBeNull();
    expect(getCachedSignedPanoramaUrl('missing.jpg')).toBeNull();
  });

  it('stores and retrieves cached signed URLs', () => {
    setCachedSignedPanoramaUrl('test1.jpg', 'https://storage.example.com/test1.jpg?token=abc');
    expect(getSignedPanoramaUrlCacheSize()).toBe(1);
    expect(getCachedSignedPanoramaUrl('test1.jpg')).toBe('https://storage.example.com/test1.jpg?token=abc');
  });

  it('purges and returns null when cached URL has expired', () => {
    const originalNow = Date.now;
    let fakeNow = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    try {
      // Store with 300 second TTL (safe TTL is 300 - 300 buffer = 0ms if buffer is 300s, let's use 600s)
      setCachedSignedPanoramaUrl('expire-test.jpg', 'https://signed.example.com/item.jpg?token=123', 600);
      expect(getCachedSignedPanoramaUrl('expire-test.jpg')).toBe('https://signed.example.com/item.jpg?token=123');

      // Advance time past the safe window (600s - 300s buffer = 300s = 300,000ms)
      fakeNow += 301000;
      expect(getCachedSignedPanoramaUrl('expire-test.jpg')).toBeNull();
      expect(getSignedPanoramaUrlCacheSize()).toBe(0);
    } finally {
      Date.now = originalNow;
      vi.restoreAllMocks();
    }
  });

  it('clears all cached URLs with clearSignedPanoramaUrlCache', () => {
    setCachedSignedPanoramaUrl('a.jpg', 'https://signed.com/a.jpg');
    setCachedSignedPanoramaUrl('b.jpg', 'https://signed.com/b.jpg');
    expect(getSignedPanoramaUrlCacheSize()).toBe(2);

    clearSignedPanoramaUrlCache();
    expect(getSignedPanoramaUrlCacheSize()).toBe(0);
    expect(getCachedSignedPanoramaUrl('a.jpg')).toBeNull();
  });
});

describe('ensureSignedPanoramaUrl & batchPreloadSignedPanoramaUrls', () => {
  beforeEach(() => {
    clearSignedPanoramaUrlCache();
    vi.restoreAllMocks();
  });

  it('returns cached URL immediately without calling supabase storage', async () => {
    setCachedSignedPanoramaUrl('cached.jpg', 'https://signed.com/cached.jpg?token=xyz');
    const storageSpy = vi.spyOn(supabase.storage, 'from');

    const result = await ensureSignedPanoramaUrl('cached.jpg', { storageProvider: 'supabase' });
    expect(result).toBe('https://signed.com/cached.jpg?token=xyz');
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('requests and caches signed URL from supabase for private bucket', async () => {
    const mockCreateSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://supabase.co/storage/v1/object/sign/MMS_PIC/sub/photo.jpg?token=signed123' },
      error: null
    });
    vi.spyOn(supabase.storage, 'from').mockReturnValue({
      createSignedUrl: mockCreateSignedUrl
    } as any);

    const result = await ensureSignedPanoramaUrl('sub/photo.jpg', {
      storageProvider: 'supabase',
      supabaseBucket: 'MMS_PIC'
    });

    expect(result).toBe('https://supabase.co/storage/v1/object/sign/MMS_PIC/sub/photo.jpg?token=signed123');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('sub/photo.jpg', DEFAULT_SIGNED_URL_TTL_SECONDS);
    expect(getCachedSignedPanoramaUrl('sub/photo.jpg')).toBe(result);
  });

  it('batch preloads multiple panorama filenames and respects cached entries', async () => {
    setCachedSignedPanoramaUrl('photo1.jpg', 'https://signed.com/photo1.jpg?token=p1');

    const mockCreateSignedUrls = vi.fn().mockResolvedValue({
      data: [
        { path: 'photo2.jpg', signedUrl: 'https://signed.com/photo2.jpg?token=p2' },
        { path: 'photo3.jpg', signedUrl: 'https://signed.com/photo3.jpg?token=p3' }
      ],
      error: null
    });
    vi.spyOn(supabase.storage, 'from').mockReturnValue({
      createSignedUrls: mockCreateSignedUrls
    } as any);

    const results = await batchPreloadSignedPanoramaUrls(
      ['photo1.jpg', 'photo2.jpg', 'photo3.jpg'],
      { storageProvider: 'supabase', supabaseBucket: 'MMS_PIC' }
    );

    expect(results.get('photo1.jpg')).toBe('https://signed.com/photo1.jpg?token=p1');
    expect(results.get('photo2.jpg')).toBe('https://signed.com/photo2.jpg?token=p2');
    expect(results.get('photo3.jpg')).toBe('https://signed.com/photo3.jpg?token=p3');
    // Only the two uncached photos were queried from the server
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['photo2.jpg', 'photo3.jpg'], DEFAULT_SIGNED_URL_TTL_SECONDS);
  });
});
