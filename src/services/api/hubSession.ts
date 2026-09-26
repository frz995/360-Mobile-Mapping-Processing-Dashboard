import { supabase, scoped, getServiceProjectId } from './client';

const HUB_SESSION_TABLE = 'hub_session_state';

/** Mirror so guest / offline sessions still restore their last activity. */
function getSessionStorageKey(): string {
  const pid = getServiceProjectId();
  return pid ? `geosphere_hub_session_${pid}` : 'geosphere_hub_session';
}

function getLocalSession(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(getSessionStorageKey());
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function setLocalSession(state: Record<string, unknown>): void {
  try {
    localStorage.setItem(getSessionStorageKey(), JSON.stringify(state));
  } catch (_) { }
}

/** The operator's last Production Hub activity for the active project. */
export async function fetchHubSessionFromSupabase(): Promise<Record<string, unknown> | null> {
  let remote: Record<string, unknown> | null = null;
  try {
    const query = scoped(supabase
      .from(HUB_SESSION_TABLE)
      .select('state, updated_by, updated_at'));
    const { data, error } = await query.maybeSingle();
    if (!error && data && data.state) {
      remote = (typeof data.state === 'string' ? JSON.parse(data.state) : data.state) as Record<string, unknown>;
    }
  } catch (_) { }
  if (remote) {
    setLocalSession(remote);
    return remote;
  }
  return getLocalSession();
}

/** Upsert the last-activity snapshot (debounced by the caller). */
export async function saveHubSessionToSupabase(
  state: Record<string, unknown>,
  updatedBy?: string
): Promise<boolean> {
  setLocalSession(state);
  const pid = getServiceProjectId();
  if (!pid) return false; // guest mode: local mirror only
  const payload = {
    project_id: pid,
    state,
    updated_by: updatedBy || null,
    updated_at: new Date().toISOString()
  };
  try {
    const { error } = await supabase
      .from(HUB_SESSION_TABLE)
      .upsert([payload], { onConflict: 'project_id' });
    return !error;
  } catch (_) {
    return false;
  }
}
