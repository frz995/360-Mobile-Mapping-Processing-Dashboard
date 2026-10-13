/**
 * @vitest-environment node
 *
 * Node, not jsdom: the signing helpers use Web Crypto (`crypto.subtle`), which
 * jsdom does not implement. The Cloudflare Workers runtime provides it natively,
 * so node is the faithful environment for this code — jsdom would be testing a
 * polyfill rather than the thing that ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';

// The signing helpers use `crypto.subtle` — the Workers runtime provides it
// globally. Node 18 has it too, but vitest's node environment does not surface
// it inside the test context, so bridge it explicitly rather than polyfilling
// HMAC and testing something other than the shipped code.
//
// Assigned directly rather than through `vi.stubGlobal`, because an
// `afterEach(vi.unstubAllGlobals)` in an earlier suite would otherwise remove it
// before the signing cases run.
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true
  });
}
import {
  selectOrganization,
  resolveCallerOrganizations,
  resolveTenantWorker,
  authorizeTenantWorker,
  TenantWorkerError,
} from '../../functions/_lib/tenantWorker';
import { signAssetToken, verifyAssetToken } from '../../functions/_lib/signing';

/**
 * Per-organisation NAS worker resolution.
 *
 * Before migration 0043 the edge attached `env.NAS_WORKER_TOKEN` to
 * `env.NAS_API_URL` for every request, so any signed-in user of the install
 * could read any company's raw survey filesystem. These tests pin the two
 * properties that closes it:
 *
 *   1. the company is derived from the caller's verified membership, and a
 *      client-supplied `?org=` cannot select one they do not belong to;
 *   2. once any company has a registered worker, an unregistered company is
 *      refused rather than falling back to the install-wide worker.
 */

const ORG_A = '0a000000-0000-4000-8000-0000000000a1';
const ORG_B = '0b000000-0000-4000-8000-0000000000b1';

const BASE_ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key'
};

type StubResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
};

type RouteHandler = (url: string) => StubResponse;

function mockFetch(routes: Record<string, RouteHandler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [pattern, handler] of Object.entries(routes)) {
      if (new RegExp(pattern).test(url)) return handler(url);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): StubResponse {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    json: async () => body
  };
}

/** Narrow a caught TenantWorkerError without asserting on `any`. */
function asTenantError(err: unknown): TenantWorkerError {
  expect(err).toBeInstanceOf(TenantWorkerError);
  return err as TenantWorkerError;
}

describe('selectOrganization', () => {
  it('uses the sole membership', () => {
    expect(selectOrganization([ORG_A], '')).toBe(ORG_A);
  });

  it('honours a hint that matches a real membership', () => {
    expect(selectOrganization([ORG_A, ORG_B], ORG_B)).toBe(ORG_B);
  });

  it('refuses a hint for a company the caller does not belong to', () => {
    // The forged-selector case. It must fail; falling back to the caller's own
    // company would hide the attempt, and honouring it would be the leak.
    try {
      selectOrganization([ORG_A], ORG_B);
      throw new Error('should have thrown');
    } catch (err) {
      expect(asTenantError(err).status).toBe(403);
    }
  });

  it('refuses an ambiguous membership rather than picking the first row', () => {
    // Picking row one would drop a consultant into a client they are not on.
    try {
      selectOrganization([ORG_A, ORG_B], '');
      throw new Error('should have thrown');
    } catch (err) {
      expect(asTenantError(err).status).toBe(409);
    }
  });

  it('refuses a caller with no membership', () => {
    try {
      selectOrganization([], '');
      throw new Error('should have thrown');
    } catch (err) {
      expect(asTenantError(err).status).toBe(403);
    }
  });

  it('ignores empty and duplicate entries', () => {
    expect(selectOrganization([ORG_A, '', ORG_A], '')).toBe(ORG_A);
  });
});

describe('resolveCallerOrganizations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the rows RLS allowed', async () => {
    mockFetch({ 'organization_members': () => jsonResponse([{ organization_id: ORG_A }]) });
    await expect(resolveCallerOrganizations(BASE_ENV, 'Bearer user-a')).resolves.toEqual([ORG_A]);
  });

  it('returns an empty list when the caller has no membership', async () => {
    mockFetch({ 'organization_members': () => jsonResponse([]) });
    await expect(resolveCallerOrganizations(BASE_ENV, 'Bearer nobody')).resolves.toEqual([]);
  });

  it('reports a rejected session as 401, not as no membership', () => {
    // These are different answers: one is "not signed in", the other is "signed
    // in, awaiting assignment". Collapsing them is how a user gets a blank
    // workspace instead of a prompt to sign in.
    mockFetch({
      organization_members: () => ({ ok: false, status: 401, headers: new Headers(), json: async () => ({}) })
    });
    return expect(resolveCallerOrganizations(BASE_ENV, 'Bearer expired')).rejects.toMatchObject({ status: 401 });
  });

  it('queries with the caller\'s own bearer, never the service key', async () => {
    // Membership is proved by RLS on organization_members. Using a privileged
    // credential here would mean deciding who someone is without a policy.
    const fetchMock = mockFetch({ organization_members: () => jsonResponse([{ organization_id: ORG_A }]) });
    await resolveCallerOrganizations(BASE_ENV, 'Bearer user-a');
    // The stub is typed to the single argument it reads, so widen the recorded
    // call tuple rather than loosening the mock's own signature.
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const auth = new Headers(calls[0]?.[1]?.headers as HeadersInit).get('Authorization');
    expect(auth).toBe('Bearer user-a');
    expect(auth).not.toContain('service');
  });
});

describe('resolveTenantWorker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const legacyEnv = { ...BASE_ENV, NAS_API_URL: 'https://nas-legacy.example', NAS_WORKER_TOKEN: 'legacy-token' };

  it('returns the company\'s own worker', async () => {
    mockFetch({
      [`organization_workers\\?organization_id=eq\\.${ORG_A}`]: () =>
        jsonResponse([{ nas_api_url: 'https://nas-a.example/', worker_token: 'token-a' }])
    });
    const worker = await resolveTenantWorker(legacyEnv, ORG_A);
    expect(worker).toEqual({ base: 'https://nas-a.example', token: 'token-a', source: 'organization' });
  });

  it('falls back to the environment only while no worker is registered', async () => {
    // The cutover rule: a single-tenant install keeps working untouched.
    mockFetch({
      'organization_workers\\?organization_id': () => jsonResponse([]),
      'organization_workers\\?select=organization_id': () =>
        jsonResponse([], { 'content-range': '0-0/*' })
    });
    const worker = await resolveTenantWorker(legacyEnv, ORG_A);
    expect(worker.source).toBe('legacy');
    expect(worker.token).toBe('legacy-token');
  });

  it('REFUSES an unregistered company once any worker is registered', async () => {
    // The whole point. Falling back per-organisation would send an
    // unconfigured tenant to the install-wide worker — the original leak.
    mockFetch({
      [`organization_workers\\?organization_id=eq\\.${ORG_B}`]: () => jsonResponse([]),
      'organization_workers\\?select=organization_id': () =>
        jsonResponse([{ organization_id: ORG_A }], { 'content-range': '0-0/1' })
    });
    await expect(resolveTenantWorker(legacyEnv, ORG_B)).rejects.toMatchObject({ status: 409 });
  });

  it('uses the legacy path when there is no service key but the env is configured', async () => {
    // No service key means the edge cannot check whether the install has
    // per-company workers, so it cannot rule out the unsafe fallback. Falling
    // back is still correct when the env holds a complete legacy pair, because
    // that pair was the only way to reach a worker before this change.
    const noService = { SUPABASE_URL: BASE_ENV.SUPABASE_URL, SUPABASE_ANON_KEY: BASE_ENV.SUPABASE_ANON_KEY, NAS_API_URL: 'https://nas-legacy.example', NAS_WORKER_TOKEN: 'legacy-token' };
    mockFetch({ organization_workers: () => { throw new Error('must not be called'); } });
    const worker = await resolveTenantWorker(noService, ORG_A);
    expect(worker.source).toBe('legacy');
  });

  it('reports 503 when neither a service key nor a legacy pair is configured', async () => {
    const bare = { SUPABASE_URL: BASE_ENV.SUPABASE_URL, SUPABASE_ANON_KEY: BASE_ENV.SUPABASE_ANON_KEY };
    await expect(resolveTenantWorker(bare, ORG_A)).rejects.toMatchObject({ status: 503 });
  });
});

describe('authorizeTenantWorker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('composes membership, selection and credential lookup', async () => {
    mockFetch({
      organization_members: () => jsonResponse([{ organization_id: ORG_A }, { organization_id: ORG_B }]),
      [`organization_workers\\?organization_id=eq\\.${ORG_B}`]: () =>
        jsonResponse([{ nas_api_url: 'https://nas-b.example', worker_token: 'token-b' }])
    });
    const result = await authorizeTenantWorker(
      { ...BASE_ENV, NAS_API_URL: 'https://nas-legacy.example', NAS_WORKER_TOKEN: 'legacy-token' },
      'Bearer user',
      ORG_B
    );
    expect(result.organizationId).toBe(ORG_B);
    expect(result.token).toBe('token-b');
    expect(result.source).toBe('organization');
  });

  it('never returns another company\'s token when the hint is forged', async () => {
    const fetchMock = mockFetch({
      organization_members: () => jsonResponse([{ organization_id: ORG_A }]),
      [`organization_workers\\?organization_id=eq\\.${ORG_B}`]: () =>
        jsonResponse([{ nas_api_url: 'https://nas-b.example', worker_token: 'token-b' }])
    });
    await expect(
      authorizeTenantWorker(
        { ...BASE_ENV, NAS_API_URL: 'https://nas-legacy.example', NAS_WORKER_TOKEN: 'legacy-token' },
        'Bearer user',
        ORG_B
      )
    ).rejects.toMatchObject({ status: 403 });
    // And it never asked for B's credentials.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(ORG_B))).toBe(false);
  });
});

describe('asset token carries the company as a signed claim', () => {
  const SECRET = 'signing-secret';

  it('round-trips the organization', async () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = await signAssetToken(SECRET, expires, ORG_A);
    await expect(verifyAssetToken(SECRET, token, expires - 10)).resolves.toBe(ORG_A);
  });

  it('rejects a token whose organization was swapped after signing', async () => {
    // This is the <img src> attack: the client cannot send a bearer, so the
    // company has to travel in the token. If it were editable, an attacker
    // could point any image request at another company\'s worker.
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = await signAssetToken(SECRET, expires, ORG_A);
    const [exp, , sig] = token.split('.');
    const forged = `${exp}.${ORG_B}.${sig}`;
    await expect(verifyAssetToken(SECRET, forged, expires - 10)).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = await signAssetToken(SECRET, expires, ORG_A);
    await expect(verifyAssetToken('other-secret', token, expires - 10)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const expires = Math.floor(Date.now() / 1000) - 1;
    const token = await signAssetToken(SECRET, expires, ORG_A);
    await expect(verifyAssetToken(SECRET, token, expires)).resolves.toBeNull();
  });

  it('still accepts the legacy two-part shape, reporting no company', async () => {
    // Tokens minted before this change live for an hour. They must verify rather
    // than 401 every image on a deploy, and they must report "" so the edge
    // falls back only while it is safe to.
    const expires = Math.floor(Date.now() / 1000) + 60;
    const legacy = await signAssetToken(SECRET, expires, '');
    await expect(verifyAssetToken(SECRET, legacy, expires - 5)).resolves.toBe('');
  });

  it('rejects malformed input without throwing', async () => {
    const malformed: Array<string | null | undefined | number> = [
      '', 'x', 'not.a.token.at.all', null, undefined, 123
    ];
    for (const bad of malformed) {
      await expect(verifyAssetToken(SECRET, bad as string | null | undefined, 0)).resolves.toBeNull();
    }
  });
});