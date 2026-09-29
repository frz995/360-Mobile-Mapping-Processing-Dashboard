import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// These live outside functions/ on purpose: that directory is deployed as
// Cloudflare Pages Functions, and test-only imports must never be part of the
// deployed function bundle.
import { signAssetToken, verifyAssetToken } from '../../../functions/_lib/signing';
import { upstreamSignal, classifyUpstreamError, PROXY_STATUS } from '../../../functions/_lib/upstream';
import { onRequest as middleware } from '../../../functions/_middleware';
import { onRequestGet as nasScan } from '../../../functions/api/nas-scan';
import { onRequestGet as nasImage } from '../../../functions/api/nas-image';
import { onRequest as stationAgent } from '../../../functions/api/station-agent';
import { onRequest as workerProxy } from '../../../functions/api/worker/[[path]]';

// jsdom ships a `crypto` without SubtleCrypto; the Workers runtime does.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const SECRET = 'worker-secret-value';
const BASE_ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  NAS_API_URL: 'https://nas-api.example.com',
  NAS_WORKER_TOKEN: SECRET,
  STATION_AGENT_URLS: JSON.stringify({ blur: 'https://pc1-agent.example.com' }),
  STATION_AGENT_TOKENS: JSON.stringify({ blur: 'agent-token-1' })
};

function makeContext(url, env, init = {}) {
  return {
    request: new Request(url, init),
    env,
    next: vi.fn(async () => new Response('next', { status: 299 })),
    params: {},
    ...init.contextProps
  };
}

/** The URL/Request constructors collapse `.` and `%2e%2e` segments before a
 * handler ever sees them, so traversal guards are exercised with a raw
 * request whose pathname is preserved verbatim. */
function makeRawContext(pathname, env, init = {}) {
  return {
    request: {
      url: `https://app.pages.dev${pathname}`,
      method: init.method || 'GET',
      headers: new Headers(init.headers || {}),
      arrayBuffer: async () => new TextEncoder().encode(init.body || '').buffer
    },
    env,
    next: vi.fn(async () => new Response('next', { status: 299 })),
    params: {}
  };
}

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('functions/_lib/signing', () => {
  it('accepts a freshly signed token', async () => {
    const now = 1_700_000_000;
    const token = await signAssetToken(SECRET, now + 600);
    await expect(verifyAssetToken(SECRET, token, now)).resolves.toBe(true);
  });

  it('rejects an expired token', async () => {
    const now = 1_700_000_000;
    const token = await signAssetToken(SECRET, now + 10);
    await expect(verifyAssetToken(SECRET, token, now + 20)).resolves.toBe(false);
  });

  it('rejects a token signed with another secret', async () => {
    const now = 1_700_000_000;
    const token = await signAssetToken('other-secret', now + 600);
    await expect(verifyAssetToken(SECRET, token, now)).resolves.toBe(false);
  });

  it('rejects tampered and malformed tokens', async () => {
    const now = 1_700_000_000;
    const token = await signAssetToken(SECRET, now + 600);
    const [expiry, signature] = token.split('.');
    await expect(verifyAssetToken(SECRET, `${expiry}x.${signature}`, now)).resolves.toBe(false);
    await expect(verifyAssetToken(SECRET, 'not-a-token', now)).resolves.toBe(false);
    await expect(verifyAssetToken(SECRET, '', now)).resolves.toBe(false);
    await expect(verifyAssetToken('', token, now)).resolves.toBe(false);
  });
});

describe('functions/_middleware', () => {
  it('passes through non-private routes without auth', async () => {
    const ctx = makeContext('https://app.pages.dev/settings', BASE_ENV);
    await middleware(ctx);
    expect(ctx.next).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects private routes without a bearer token', async () => {
    const ctx = makeContext('https://app.pages.dev/api/nas-scan?action=registry', BASE_ENV);
    const res = await middleware(ctx);
    expect(res.status).toBe(401);
    expect(ctx.next).not.toHaveBeenCalled();
  });

  it('rejects an invalid Supabase session', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const ctx = makeContext('https://app.pages.dev/api/nas-scan', BASE_ENV, {
      headers: { Authorization: 'Bearer stale' }
    });
    const res = await middleware(ctx);
    expect(res.status).toBe(401);
    expect(ctx.next).not.toHaveBeenCalled();
  });

  it('allows a valid Supabase session through', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const ctx = makeContext('https://app.pages.dev/api/nas-scan', BASE_ENV, {
      headers: { Authorization: 'Bearer good' }
    });
    await middleware(ctx);
    expect(ctx.next).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('https://project.supabase.co/auth/v1/user', expect.anything());
  });

  it('reports missing server config as 503', async () => {
    const ctx = makeContext('https://app.pages.dev/api/nas-scan', {}, {
      headers: { Authorization: 'Bearer good' }
    });
    const res = await middleware(ctx);
    expect(res.status).toBe(503);
  });

  it('accepts a signed t parameter on the image route', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signAssetToken(SECRET, now + 600);
    const ctx = makeContext(
      `https://app.pages.dev/api/nas-image?path=${encodeURIComponent('05_Final/a.jpg')}&t=${token}`,
      BASE_ENV
    );
    await middleware(ctx);
    expect(ctx.next).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a bad t parameter on the image route', async () => {
    const ctx = makeContext('https://app.pages.dev/api/nas-image?path=a.jpg&t=bogus.zzz', BASE_ENV);
    const res = await middleware(ctx);
    expect(res.status).toBe(401);
    expect(ctx.next).not.toHaveBeenCalled();
  });

  it('does not let the image token bypass other private routes', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signAssetToken(SECRET, now + 600);
    const ctx = makeContext(`https://app.pages.dev/api/nas-scan?action=registry&t=${token}`, BASE_ENV);
    const res = await middleware(ctx);
    expect(res.status).toBe(401);
  });
});

describe('functions/api/nas-scan', () => {
  it('returns 503 when the worker is not configured', async () => {
    const res = await nasScan(makeContext('https://app.pages.dev/api/nas-scan', {}));
    expect(res.status).toBe(503);
  });

  it('proxies to the worker with the server-side token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"runs":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const res = await nasScan(
      makeContext('https://app.pages.dev/api/nas-scan?action=registry&subgrid=BP', BASE_ENV)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [] });
    const [target, init] = fetchMock.mock.calls[0];
    expect(target.toString()).toBe('https://nas-api.example.com/api/nas-scan?action=registry&subgrid=BP');
    expect(init.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('forwards Cloudflare Access service credentials when present', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await nasScan(
      makeContext('https://app.pages.dev/api/nas-scan', {
        ...BASE_ENV,
        CF_ACCESS_CLIENT_ID: 'cid',
        CF_ACCESS_CLIENT_SECRET: 'csecret'
      })
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.get('CF-Access-Client-Id')).toBe('cid');
    expect(init.headers.get('CF-Access-Client-Secret')).toBe('csecret');
  });

  it('surfaces upstream failures without leaking the origin', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await nasScan(makeContext('https://app.pages.dev/api/nas-scan', BASE_ENV));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('nas-api.example.com');
  });
});

describe('functions/api/nas-image', () => {
  it('rejects path traversal', async () => {
    const res = await nasImage(
      makeContext(`https://app.pages.dev/api/nas-image?path=${encodeURIComponent('../../etc/passwd')}`, BASE_ENV)
    );
    expect(res.status).toBe(400);
  });

  it('rejects an empty path', async () => {
    const res = await nasImage(makeContext('https://app.pages.dev/api/nas-image', BASE_ENV));
    expect(res.status).toBe(400);
  });

  it('rejects percent-encoded traversal and backslash smuggling', async () => {
    const encoded = await nasImage(
      makeContext('https://app.pages.dev/api/nas-image?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd', BASE_ENV)
    );
    expect(encoded.status).toBe(400);
    const backslash = await nasImage(
      makeContext('https://app.pages.dev/api/nas-image?path=05_Final%5c..%5c..%5c.env', BASE_ENV)
    );
    expect(backslash.status).toBe(400);
  });

  it('encodes each path segment for the upstream worker', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('binary', { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
    );
    const res = await nasImage(
      makeContext(`https://app.pages.dev/api/nas-image?path=${encodeURIComponent('05_Final/BP one.jpg')}`, BASE_ENV)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(fetchMock.mock.calls[0][0]).toBe('https://nas-api.example.com/api/images/05_Final/BP%20one.jpg');
  });
});

describe('functions/api/station-agent', () => {
  it('rejects a station without a configured tunnel', async () => {
    const res = await stationAgent(
      makeContext('https://app.pages.dev/api/station-agent?stationId=photoshop&resource=health', BASE_ENV)
    );
    expect(res.status).toBe(503);
  });

  it('rejects a non-HTTPS tunnel URL', async () => {
    const res = await stationAgent(
      makeContext('https://app.pages.dev/api/station-agent?stationId=blur&resource=health', {
        ...BASE_ENV,
        STATION_AGENT_URLS: JSON.stringify({ blur: 'http://192.168.1.20:8100' })
      })
    );
    expect(res.status).toBe(503);
  });

  it('forwards health checks with the per-station token', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const res = await stationAgent(
      makeContext('https://app.pages.dev/api/station-agent?stationId=blur&resource=health', BASE_ENV)
    );
    expect(res.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe('https://pc1-agent.example.com/health');
    expect(init.headers.get('Authorization')).toBe('Bearer agent-token-1');
  });

  it('enforces the upstream HTTP method', async () => {
    const res = await stationAgent(
      makeContext('https://app.pages.dev/api/station-agent?stationId=blur&resource=rename', BASE_ENV, {
        method: 'GET'
      })
    );
    expect(res.status).toBe(405);
  });

  it('only allows hex job ids on sync-poll', async () => {
    const res = await stationAgent(
      makeContext(
        'https://app.pages.dev/api/station-agent?stationId=blur&resource=sync-poll&jobId=../../health',
        BASE_ENV
      )
    );
    expect(res.status).toBe(400);
  });

  it('proxies sync polling for a valid job id', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"status":"running"}', { status: 200 }));
    const res = await stationAgent(
      makeContext(
        'https://app.pages.dev/api/station-agent?stationId=blur&resource=sync-poll&jobId=ab12cd34',
        BASE_ENV
      )
    );
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://pc1-agent.example.com/api/sync-bucket/ab12cd34');
  });

  it('passes rename bodies through', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const res = await stationAgent(
      makeContext('https://app.pages.dev/api/station-agent?stationId=blur&resource=rename', BASE_ENV, {
        method: 'POST',
        body: JSON.stringify({ from: 'a', to: 'b' })
      })
    );
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(Buffer.from(init.body).toString()).toBe(JSON.stringify({ from: 'a', to: 'b' }));
  });
});

describe('functions/api/worker proxy', () => {
  it('returns 503 when the worker is not configured', async () => {
    const res = await workerProxy(makeContext('https://app.pages.dev/api/worker/api/jobs', {}));
    expect(res.status).toBe(503);
  });

  it('rejects traversal segments, including percent-encoded ones', async () => {
    const encoded = await workerProxy(makeRawContext('/api/worker/api/%2e%2e/auth', BASE_ENV));
    expect(encoded.status).toBe(400);
    const smuggled = await workerProxy(makeRawContext('/api/worker/api/..%2f..%2fsettings', BASE_ENV));
    expect(smuggled.status).toBe(400);
    const backslash = await workerProxy(makeRawContext('/api/worker/api/..%5csettings', BASE_ENV));
    expect(backslash.status).toBe(400);
    const bare = await workerProxy(makeRawContext('/api/worker', BASE_ENV));
    expect(bare.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods', async () => {
    const res = await workerProxy(
      makeContext('https://app.pages.dev/api/worker/api/jobs', BASE_ENV, { method: 'PATCH' })
    );
    expect(res.status).toBe(405);
  });

  it('proxies POST bodies with the server-side token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"job_id":"j1"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const res = await workerProxy(
      makeContext('https://app.pages.dev/api/worker/api/jobs?dry=1', BASE_ENV, {
        method: 'POST',
        body: JSON.stringify({ job_id: 'j1' })
      })
    );
    expect(res.status).toBe(200);
    const [target, init] = fetchMock.mock.calls[0];
    expect(target.toString()).toBe('https://nas-api.example.com/api/jobs?dry=1');
    expect(init.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(Buffer.from(init.body).toString()).toBe(JSON.stringify({ job_id: 'j1' }));
  });
});

// --- cancellation ------------------------------------------------------
//
// The browser aborts slow calls (10s in productionApi.ts, 60s for images) but
// these proxies used to hand no signal to fetch, so the NAS read kept running
// with nobody waiting for it. These lock in that the client can now actually
// stop the work, and that a disconnect is not misreported as an outage.

/** A fetch that rejects the way a real one does once its signal fires. */
function abortRejectingFetch(abortClient) {
  return vi.fn(async (_url, init) => {
    abortClient();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (init?.signal?.aborted) {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    }
    return new Response('{}', { status: 200 });
  });
}

describe('functions/_lib/upstream', () => {
  it('aborts when the client disconnects', () => {
    const client = new AbortController();
    const { signal, state, dispose } = upstreamSignal({ signal: client.signal }, 60_000);
    expect(signal.aborted).toBe(false);
    client.abort();
    expect(signal.aborted).toBe(true);
    expect(state.clientClosed).toBe(true);
    expect(state.timedOut).toBe(false);
    dispose();
  });

  it('aborts when its own timeout elapses', () => {
    vi.useFakeTimers();
    const { signal, state, dispose } = upstreamSignal({ signal: new AbortController().signal }, 5_000);
    vi.advanceTimersByTime(4_999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(2);
    expect(signal.aborted).toBe(true);
    expect(state.timedOut).toBe(true);
    dispose();
    vi.useRealTimers();
  });

  it('starts aborted when the client signal is already dead', () => {
    // A proxy that inherited a dead signal would reject every request.
    const client = new AbortController();
    client.abort();
    const { signal, state, dispose } = upstreamSignal({ signal: client.signal }, 60_000);
    expect(signal.aborted).toBe(true);
    expect(state.clientClosed).toBe(true);
    dispose();
  });

  it('still times out when the request carries no signal', () => {
    vi.useFakeTimers();
    const { signal, state, dispose } = upstreamSignal({}, 1_000);
    vi.advanceTimersByTime(1_001);
    expect(signal.aborted).toBe(true);
    expect(state.timedOut).toBe(true);
    dispose();
    vi.useRealTimers();
  });

  it('dispose clears the timer and detaches the client listener', () => {
    vi.useFakeTimers();
    const client = new AbortController();
    const { signal, dispose } = upstreamSignal({ signal: client.signal }, 1_000);
    dispose();
    // A retained listener would keep this controller alive for the whole
    // request and fire against an already-sent response.
    client.abort();
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('maps its own timeout to 504 and a client hang-up to 499', () => {
    const timeout = classifyUpstreamError(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
      { timedOut: true, clientClosed: false }
    );
    expect(timeout.status).toBe(PROXY_STATUS.UPSTREAM_TIMEOUT);

    const closed = classifyUpstreamError(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
      { timedOut: false, clientClosed: true }
    );
    expect(closed.status).toBe(PROXY_STATUS.CLIENT_CLOSED);

    // Client left first, so nobody is waiting for a 504 either.
    const both = classifyUpstreamError(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
      { timedOut: true, clientClosed: true }
    );
    expect(both.status).toBe(PROXY_STATUS.CLIENT_CLOSED);
  });

  it('leaves a real transport failure as a 502 with no message override', () => {
    const result = classifyUpstreamError(new TypeError('fetch failed'), {
      timedOut: false,
      clientClosed: false
    });
    expect(result.status).toBe(502);
    expect(result.message).toBeNull();
  });
});

describe('proxy cancellation', () => {
  it('passes a signal to every live upstream proxy', async () => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    await workerProxy(makeContext('https://app.pages.dev/api/worker/api/folders', BASE_ENV));
    await nasScan(makeContext('https://app.pages.dev/api/nas-scan', BASE_ENV));
    await stationAgent(
      makeContext('https://app.pages.dev/api/station-agent?stationId=blur&resource=health', BASE_ENV)
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal.aborted).toBe(false);
    }
  });

  it('answers 499, not 502, when the client disconnects mid-flight', async () => {
    const client = new AbortController();
    const request = new Request('https://app.pages.dev/api/worker/api/folders', {
      signal: client.signal
    });
    vi.stubGlobal('fetch', abortRejectingFetch(() => client.abort()));
    const res = await workerProxy({ request, env: BASE_ENV, params: {} });
    expect(res.status).toBe(499);
    await expect(res.json()).resolves.toMatchObject({ error: 'Client closed the request.' });
  });

  it('applies the same disconnect handling to the image and agent proxies', async () => {
    const routes = [
      'https://app.pages.dev/api/nas-image?path=a.jpg',
      'https://app.pages.dev/api/station-agent?stationId=blur&resource=report'
    ];
    for (const url of routes) {
      const client = new AbortController();
      // The signal must reach the Request the handler actually reads.
      vi.stubGlobal('fetch', abortRejectingFetch(() => client.abort()));
      const ctx = makeContext(url, BASE_ENV, { signal: client.signal });
      const res = url.includes('nas-image') ? await nasImage(ctx) : await stationAgent(ctx);
      expect(res.status).toBe(499);
    }
  });

  it('still reports a real outage as 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const res = await workerProxy(makeContext('https://app.pages.dev/api/worker/health', BASE_ENV));
    expect(res.status).toBe(502);
  });

  it('answers 504 when the proxy timeout fires before the client gives up', async () => {
    vi.useFakeTimers();
    try {
      // Never settles on its own: only the proxy's own timer can end it.
      vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
        );
      })));
      const pending = workerProxy(makeContext('https://app.pages.dev/api/worker/health', BASE_ENV));
      await vi.advanceTimersByTimeAsync(30_000);
      const res = await pending;
      expect(res.status).toBe(504);
      await expect(res.json()).resolves.toMatchObject({ error: 'Upstream service timed out.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the ETag pass-through while adding the signal', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('bytes', {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', ETag: '"abc123"' }
      })
    );
    const res = await nasImage(makeContext('https://app.pages.dev/api/nas-image?path=a.jpg', BASE_ENV));
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"abc123"');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
