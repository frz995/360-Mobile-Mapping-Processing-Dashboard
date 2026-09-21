import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getActiveProjectId } from '../projectContext';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_KEY || '';

export type SupabaseClientInstance = SupabaseClient;

/**
 * Effective backend currently in use. Populated the first time
 * `configureSupabaseBackend` runs; empty means "still on env defaults".
 */
let _backendUrl = '';
let _backendKey = '';

/**
 * Active underlying Supabase client. Replaced in place by
 * `configureSupabaseBackend`. `supabase` is a stable Proxy over this value, so
 * every existing caller that imported `supabase` keeps working unchanged and
 * transparently starts talking to the new host after a backend switch.
 */
let _activeSupabaseClient: SupabaseClientInstance;

/**
 * Return a no-op client so importing this module never throws when Supabase
 * isn't configured (e.g. CI has no .env). Every property resolves to
 * `undefined`, so any method call (supabase.from(...), supabase.auth...)
 * throws a TypeError that the consumer call-sites already wrap in try/catch
 * and convert to safe defaults (null / { success: false }).
 */
function createNoopSupabaseClient(): SupabaseClientInstance {
  const dummyQuery = () => {
    const chain: any = {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      delete: () => chain,
      upsert: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: any, reject?: any) => Promise.resolve({ data: null, error: null }).then(resolve, reject)
    };
    return chain;
  };

  const client: any = {
    from: dummyQuery,
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }),
      signInWithPassword: () => Promise.resolve({ data: { user: null, session: null }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      updateUser: () => Promise.resolve({ data: { user: null }, error: null }),
      refreshSession: () => Promise.resolve({ data: { session: null }, error: null })
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
        list: () => Promise.resolve({ data: [], error: null }),
        remove: () => Promise.resolve({ data: null, error: null })
      })
    }
  };

  return client as SupabaseClientInstance;
}

/** Active project id for service-layer (v15) per-project scoping.
 * Returns null when no project is active (guest mode or the brief boot window
 * before the persisted project restores) — queries then run unscoped, i.e.
 * today's RLS-visible global view.
 */
export function getServiceProjectId(): string | null {
  const id = getActiveProjectId();
  return id && id.trim() ? id : null;
}

/** Append a `project_id = <active>` equality filter when a project is active. */
export function scoped(query: any): any {
  const id = getServiceProjectId();
  if (!id || !query) return query;
  if (typeof query.eq === 'function') {
    return query.eq('project_id', id);
  }
  return query;
}

const MAX_SAFE_HEADER_LENGTH = 1500;

/**
 * Safe fetch wrapper that guards against oversized Authorization headers.
 * Storing heavy objects (e.g. spatial/GeoJSON data) in auth user_metadata
 * causes the Supabase JWT token to expand beyond 8KB, which triggers
 * HTTP 431 (Request Header Fields Too Large) / CORS network failures on API gateways.
 *
 * This wrapper:
 * 1. Suppresses bloated Authorization headers (> 1500 bytes) on all requests,
 *    substituting the safe anon key so Kong/Cloudflare never rejects with HTTP 431.
 * 2. Reactively retries with the anon key if any request encounters HTTP 431 or NetworkError.
 */
function currentApiUrl(): string {
  return _backendUrl || supabaseUrl;
}

function currentApiKey(): string {
  return _backendKey || supabaseKey;
}

export function safeSupabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request)?.url || '';

  let headers: Headers;
  if (init?.headers instanceof Headers) {
    headers = new Headers(init.headers);
  } else if (Array.isArray(init?.headers)) {
    headers = new Headers(init.headers);
  } else if (init?.headers && typeof init.headers === 'object') {
    headers = new Headers(init.headers as Record<string, string>);
  } else {
    headers = new Headers();
  }

  const authHeader = headers.get('Authorization') || headers.get('authorization') || '';
  const isBloatedToken = authHeader.length > MAX_SAFE_HEADER_LENGTH;

  // If the user token is bloated (> 1500 chars), proactively swap it for the anon key
  // on ALL endpoints (including /auth/v1/token refresh) so Kong/Cloudflare never rejects
  // with HTTP 431 and the persisted session is NOT dropped. The refresh token is carried
  // in the POST body, so gotrue still validates it independently of the Authorization header.
  if (isBloatedToken) {
    headers.set('Authorization', `Bearer ${currentApiKey()}`);
  }

  // Ensure Authorization header exists for Supabase requests
  if (urlStr.includes(currentApiUrl()) && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${currentApiKey()}`);
  }

  const safeInit: RequestInit = {
    ...init,
    headers
  };

  return fetch(input, safeInit)
    .then(async (res) => {
      if (res.status === 431) {
        console.warn('[Supabase] Received HTTP 431 on', urlStr, 'Retrying with safe anon key...');
        const retryHeaders = new Headers(headers);
        retryHeaders.set('Authorization', `Bearer ${currentApiKey()}`);
        return fetch(input, { ...safeInit, headers: retryHeaders });
      }
      return res;
    })
    .catch(async (err: any) => {
      const currentAuth = headers.get('Authorization') || '';
      if (currentAuth && !currentAuth.includes(currentApiKey())) {
        console.warn('[Supabase] NetworkError on', urlStr, 'Retrying with anon key...', err);
        const retryHeaders = new Headers(headers);
        retryHeaders.set('Authorization', `Bearer ${currentApiKey()}`);
        return fetch(input, { ...safeInit, headers: retryHeaders });
      }
      throw err;
    });
}

/**
 * Clean legacy bloated roadAnalysisState sessions directly from browser localStorage
 * so supabase-js does not load an oversized JWT token into memory and cause HTTP 431.
 *
 * IMPORTANT: only the ONE known bloat source is pruned — a session whose stored JSON
 * references `roadAnalysisState` (legacy spatial state embedded in auth.user_metadata).
 * Ordinary sessions must NEVER be deleted here: wiping any token whose access token
 * exceeds the size guard is what previously sent every refresh straight back to the
 * Login page. Oversized-but-valid tokens are instead kept and their Authorization
 * header neutralized by `safeSupabaseFetch`.
 */
export function pruneLocalStorageSession(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('supabase.auth.token'))) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        if (!raw.includes('roadAnalysisState')) continue;
        try {
          const parsed = JSON.parse(raw);
          const tokenLen = (parsed?.access_token || '').length;
          if (tokenLen > MAX_SAFE_HEADER_LENGTH) {
            console.warn('[Supabase] Removing legacy bloated (roadAnalysisState) session to cure HTTP 431:', key);
            localStorage.removeItem(key);
          }
        } catch {
          // Unparseable storage: keep it — removing valid sessions spuriously
          // would log the user out on every refresh.
        }
      }
    }
  } catch { }
}

// Immediately run local storage pruning on module load
pruneLocalStorageSession();

/**
 * Automatically prunes bloated legacy roadAnalysisState from auth.users metadata
 * if present on the active authenticated user, reducing JWT token size from
 * tens of kilobytes back to normal (~1KB) and permanently curing HTTP 431.
 */
export async function pruneBloatedUserMetadata(): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.user_metadata?.roadAnalysisState) {
      console.warn('[Supabase] Detected bloated roadAnalysisState in auth.users user_metadata. Cleaning up...');
      const { error } = await supabase.auth.updateUser({
        data: {
          roadAnalysisState: null
        }
      });
      if (!error) {
        console.info('[Supabase] Successfully pruned roadAnalysisState from user_metadata. Refreshing session...');
        await supabase.auth.refreshSession();
      } else {
        console.warn('[Supabase] Notice: updateUser could not prune user_metadata:', error.message);
      }
    }
  } catch (err) {
    console.warn('[Supabase] pruneBloatedUserMetadata notice:', err);
  }
}

function createSafeSupabaseClient(overrideUrl?: string, overrideKey?: string): SupabaseClientInstance {
  const url = (overrideUrl || '').trim() || supabaseUrl || '';
  const key = (overrideKey || '').trim() || supabaseKey || '';

  if (!url || !key) {
    console.error(
      '[Supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not configured. Check your .env file.'
    );
    // Can't build a real client (createClient('') throws). Return a no-op so
    // module load never throws (important for CI/test environments without a
    // .env); all Supabase call sites already fall back to safe defaults.
    return createNoopSupabaseClient();
  }

  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: {
        fetch: safeSupabaseFetch
      }
    });
  } catch (err) {
    console.warn('[Supabase] client creation fallback:', err);
    try {
      return createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
        global: { fetch: safeSupabaseFetch }
      });
    } catch (err2) {
      console.error('[Supabase] client creation failed:', err2);
      return createNoopSupabaseClient();
    }
  }
}

/**
 * Stable Proxy over `_activeSupabaseClient`; swaps transparently on backend change.
 * Also keeps mock-compatibility for tests: assignments / defineProperty (e.g.
 * `vi.spyOn(supabase, 'from')`) are stored in `overrides` and shadow the active
 * client until restored, exactly like patching a plain object.
 */
const _supabaseOverrides = new Map<string | symbol, unknown>();

const supabaseProxy = new Proxy({} as Record<string | symbol, unknown>, {
  get(_target, prop: string | symbol) {
    if (_supabaseOverrides.has(prop)) {
      return _supabaseOverrides.get(prop);
    }
    const active: any = _activeSupabaseClient;
    const value = active?.[prop as keyof typeof active];
    return typeof value === 'function' ? value.bind(active) : value;
  },
  set(_target, prop: string | symbol, value: unknown) {
    _supabaseOverrides.set(prop, value);
    return true;
  },
  defineProperty(_target, prop: string | symbol, descriptor: PropertyDescriptor) {
    if (Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      _supabaseOverrides.set(prop, descriptor.value);
    }
    return true;
  },
  deleteProperty(_target, prop: string | symbol) {
    _supabaseOverrides.delete(prop);
    return true;
  },
  getOwnPropertyDescriptor(_target, prop: string | symbol): PropertyDescriptor {
    if (_supabaseOverrides.has(prop)) {
      return { value: _supabaseOverrides.get(prop), writable: true, enumerable: true, configurable: true };
    }
    const active: any = _activeSupabaseClient;
    if (active && prop in active) {
      const activeDesc = Object.getOwnPropertyDescriptor(active, prop);
      if (activeDesc) {
        return { ...activeDesc, configurable: true };
      }
      return { value: active[prop], writable: true, enumerable: true, configurable: true };
    }
    return { value: undefined, writable: true, enumerable: true, configurable: true };
  },
  has(_target, prop: string | symbol) {
    return _supabaseOverrides.has(prop) || prop in (_activeSupabaseClient as any);
  },
  ownKeys(_target) {
    return Array.from(
      new Set([
        ...Reflect.ownKeys(_target),
        ...Reflect.ownKeys(_activeSupabaseClient as any),
        ..._supabaseOverrides.keys()
      ])
    );
  }
});

export const supabase: SupabaseClientInstance = supabaseProxy as unknown as SupabaseClientInstance;

export interface SupabaseBackendConfig {
  url?: string;
  anonKey?: string;
}

/**
 * Reconfigure the active Supabase backend (e.g. Supabase Cloud vs self-hosted
 * on an on-premise server PC vs NAS) at runtime. All existing `supabase.*`
 * callers transparently begin talking to the new host.
 *
 * Sessions are scoped per host by supabase-js storage keys, so switching
 * backend keeps tokens separate; the previous host is best-effort signed out
 * before the swap. A `geosphere:backend-change` window event is dispatched so
 * auth/data layers can react (e.g. clear cached per-backend data, prompt a
 * fresh login on the new host).
 */
export function configureSupabaseBackend(cfg: SupabaseBackendConfig): boolean {
  const url = (cfg?.url || '').trim().replace(/\/+$/, '');
  const key = (cfg?.anonKey || '').trim();

  // No backend override supplied — leave the currently active client untouched.
  // Never fall back to the env default here: that would silently re-point an
  // already-active self-hosted / on-premise deployment back at Supabase Cloud
  // and force a sign-out mid-session.
  if (!url || !key) {
    return false;
  }

  if (url === _backendUrl && key === _backendKey) {
    return false; // already on this backend
  }

  // Boot default: the module client was already created on the env config and
  // the backend has never been switched. Don't teardown/sign-out for a no-op.
  if (_backendUrl === '' && url === supabaseUrl && key === supabaseKey) {
    return false;
  }

  try {
    _activeSupabaseClient.auth.signOut().catch(() => {});
  } catch { /* best-effort */ }

  _activeSupabaseClient = createSafeSupabaseClient(url, key);
  _backendUrl = url;
  _backendKey = key;

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('geosphere:backend-change', {
        detail: { url, anonKey: key }
      }));
    } catch { /* dispatch failure is non-fatal */ }
  }
  console.info(`[Supabase] Backend reconfigured → ${url}`);
  return true;
}

/** Return the backend currently wired into the active client. */
export function getActiveSupabaseBackend(): SupabaseBackendConfig {
  return { url: _backendUrl || supabaseUrl, anonKey: _backendKey || supabaseKey };
}

_activeSupabaseClient = createSafeSupabaseClient();
