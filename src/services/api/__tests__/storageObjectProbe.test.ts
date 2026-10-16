import { describe, it, expect, vi, afterEach } from 'vitest';
import { testStorageObjectHealth } from '../storage';
import { clearSignedPanoramaUrlCache } from '../../signedPanoramaUrls';
import type { StorageResolveSettings } from '../../storageUrls';

/**
 * The diagnostics panel reported storage healthy while every panorama failed.
 *
 * WHY THESE TESTS EXIST
 *   `AdminSettingsView` asked for a Supabase or NAS probe and, instead of making
 *   one, synthesised `HTTP 200` from `testDatabaseHealth()` — a PostGIS query —
 *   labelled that query's duration as the image's latency, and hardcoded
 *   `corsOk: true`. In production every frame answered 400 while the panel read
 *   "Storage Reachable &bull; HTTP 200 Operational". A button labelled
 *   *Test Storage & CORS Probe* performed no probe at all.
 *
 *   Two things are pinned here. The probe must actually request the object, and
 *   it must never report a state it did not measure: `objectFound` is
 *   `boolean | null`, and `null` has to survive every path where no request was
 *   made or none completed.
 *
 *   The 400 case is the one that shipped the bug. Supabase Storage's public
 *   object endpoint answers a missing key with HTTP 400 and an
 *   `InvalidRequest / Object not found` body, not 404. A probe that only knows
 *   404 reports every missing panorama as a connection failure.
 */

const supabaseSettings: StorageResolveSettings = {
  storageProvider: 'supabase',
  imageStorageStrategy: 'single_equirectangular',
  supabaseUrl: 'https://tagqbumedwzylujikqa.supabase.co',
  supabaseBucket: 'MMS_PIC'
} as StorageResolveSettings;

/** Minimal `fetch` double returning a real Response. */
const stubFetch = (impl: (url: string) => Response | Promise<Response>) => {
  const spy = vi.fn(async (input: RequestInfo | URL) => impl(String(input)));
  vi.stubGlobal('fetch', spy);
  return spy;
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

afterEach(() => {
  vi.unstubAllGlobals();
  clearSignedPanoramaUrlCache();
});

describe('testStorageObjectHealth', () => {
  it('requests the URL the viewer will actually use', async () => {
    // Regression against the old design: probing with a provider override would
    // measure a URL the app never loads, and the panel could drift from the
    // viewer without anyone noticing.
    const spy = stubFetch(() => new Response('binary', { status: 200, headers: { 'content-type': 'image/jpeg' } }));

    await testStorageObjectHealth('N93E70-0001.jpg', supabaseSettings);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('/storage/v1/object/public/MMS_PIC/');
    expect(spy.mock.calls[0][0]).toContain('N93E70-0001.jpg');
  });

  it('probes the tile config for a multi-res deployment, not the flat image', async () => {
    // A multi-res panorama is never loaded as a flat JPEG, so probing the image
    // would report a working deployment as broken.
    const spy = stubFetch(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));

    await testStorageObjectHealth('N93E70-0001.jpg', {
      ...supabaseSettings,
      imageStorageStrategy: 'multires_tiles'
    } as StorageResolveSettings);

    expect(String(spy.mock.calls[0][0])).toContain('config.json');
  });

  it('probes the flat image when the deployment is single equirectangular', async () => {
    const spy = stubFetch(() => new Response('binary', { status: 200, headers: { 'content-type': 'image/jpeg' } }));

    await testStorageObjectHealth('N93E70-0001.jpg', supabaseSettings);

    expect(String(spy.mock.calls[0][0])).not.toContain('config.json');
    expect(String(spy.mock.calls[0][0])).toContain('N93E70-0001.jpg');
  });

  it('reports a served object as found', async () => {
    stubFetch(() => new Response('binary', { status: 200, headers: { 'content-type': 'image/jpeg' } }));

    const res = await testStorageObjectHealth('N93E70-0001.jpg', supabaseSettings);

    expect(res.ok).toBe(true);
    expect(res.reachable).toBe(true);
    expect(res.objectFound).toBe(true);
    expect(res.corsOk).toBe(true);
  });

  it('reads a Supabase 400 "Object not found" as missing, not as a broken connection', async () => {
    // The exact production response. Treating it as a connection failure sends
    // the operator to the wrong machine.
    stubFetch(() =>
      jsonResponse(400, { statusCode: '400', error: 'InvalidRequest', message: 'Object not found' })
    );

    const res = await testStorageObjectHealth('N93E70-0016.jpg', supabaseSettings);

    expect(res.reachable).toBe(true);
    expect(res.objectFound).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toContain('Object not found');
  });

  it('reads a 404 as missing', async () => {
    stubFetch(() => jsonResponse(404, { message: 'Object not found' }));

    const res = await testStorageObjectHealth('N93E70-0016.jpg', supabaseSettings);

    expect(res.reachable).toBe(true);
    expect(res.objectFound).toBe(false);
  });

  it('does not treat a 400 carrying an image as a missing object', async () => {
    // A 400 with an image body is a genuine bad request, not a lookup miss.
    stubFetch(() => new Response('binary', { status: 400, headers: { 'content-type': 'image/jpeg' } }));

    const res = await testStorageObjectHealth('N93E70-0016.jpg', supabaseSettings);

    expect(res.objectFound).toBe(false);
    expect(res.reachable).toBe(true);
    expect(res.statusText).not.toContain('Object Not Found');
  });

  it('never fabricates a latency from an unmeasured request', async () => {
    // The old panel reported `postgisLatencyMs` as the image's latency. With no
    // filename there is no object request, so there is no object latency.
    const res = await testStorageObjectHealth('', supabaseSettings);

    expect(res.objectFound).toBeNull();
    expect(res.reachable).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.latencyMs).toBe(0);
    expect(res.status).toBe(0);
  });

  it('makes no request at all when no filename is supplied', async () => {
    const spy = stubFetch(() => new Response('', { status: 200 }));

    await testStorageObjectHealth('', supabaseSettings);

    expect(spy).not.toHaveBeenCalled();
  });

  it('reports the object as unknown when the request is blocked before a response', async () => {
    // A CORS or DNS rejection is the one case where existence genuinely cannot
    // be asserted. It must be null, never false.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const res = await testStorageObjectHealth('N93E70-0016.jpg', supabaseSettings);

    expect(res.reachable).toBe(false);
    expect(res.objectFound).toBeNull();
    expect(res.corsOk).toBe(false);
    expect(res.error).toContain('whether the file exists is still unknown');
  });

  it('does not claim CORS unless a response actually arrived', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const res = await testStorageObjectHealth('N93E70-0016.jpg', supabaseSettings);

    expect(res.corsOk).toBe(false);
  });

  it('surfaces the server\'s own message rather than paraphrasing it', async () => {
    // The operator needs Supabase's actual words to act on; a generic
    // "request failed" sends them guessing.
    stubFetch(() =>
      jsonResponse(400, { statusCode: '400', error: 'InvalidRequest', message: 'Object not found' })
    );

    const res = await testStorageObjectHealth('N93E70-0016.jpg', supabaseSettings);

    expect(res.error).toContain('Object not found');
    expect(res.error).toContain('tenant folder');
  });
});