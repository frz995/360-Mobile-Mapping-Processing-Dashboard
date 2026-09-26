import { supabase } from './api/client';

/** Same-origin Production API fetch that forwards the active Supabase session.
 * Cloudflare Pages Functions validate this user token before proxying to the
 * private NAS worker / station-agent tunnels. Local Vite routes ignore it. */
export async function fetchDashboardApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  } catch {
    // The Cloudflare API will return 401 when no valid session is present.
  }
  return fetch(input, { ...init, headers });
}
