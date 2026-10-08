import { supabase, scoped, getServiceProjectId } from './client';
import { reportWriteFailure, reportWriteSuccess } from '../../lib/writeFailures';

const HUB_SESSION_TABLE = 'hub_session_state';

/**
 * Stable keys, so a debounced retry loop raises one banner line rather than one
 * per attempt. `hub_session_state` had no `authenticated` grant until migration
 * 0035, which is precisely why these reports had to be added alongside it: the
 * failure was invisible for the whole period the grant was missing.
 */
export const HUB_WRITE_OPS = {
  sessionRead: 'hub.session_read',
  sessionWrite: 'hub.session_write'
} as const;

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
    if (error) {
      // Reported rather than swallowed. A silent fallback here is how the missing
      // grant went unnoticed: the hub appeared to work while every read failed and
      // the local mirror answered instead.
      reportWriteFailure(
        HUB_WRITE_OPS.sessionRead,
        'Production hub session (read)',
        `${error.message} — serving the local mirror instead.`,
        'warning'
      );
    } else if (data && data.state) {
      remote = (typeof data.state === 'string' ? JSON.parse(data.state) : data.state) as Record<string, unknown>;
      reportWriteSuccess(HUB_WRITE_OPS.sessionRead);
    }
  } catch (err) {
    reportWriteFailure(
      HUB_WRITE_OPS.sessionRead,
      'Production hub session (read)',
      `${err instanceof Error ? err.message : String(err)} — serving the local mirror instead.`,
      'warning'
    );
  }
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
    // A PostgREST builder is thenable: it resolves with `{ data, error }` and
    // does NOT throw on a rejected write, so `error` must be inspected here.
    if (error) {
      reportWriteFailure(
        HUB_WRITE_OPS.sessionWrite,
        'Production hub session',
        `${error.message} — activity is being kept in this browser only.`
      );
      return false;
    }
    reportWriteSuccess(HUB_WRITE_OPS.sessionWrite);
    return true;
  } catch (err) {
    reportWriteFailure(
      HUB_WRITE_OPS.sessionWrite,
      'Production hub session',
      `${err instanceof Error ? err.message : String(err)} — activity is being kept in this browser only.`
    );
    return false;
  }
}

/** Drop the stored snapshot entirely.
 *
 * Used to retire session payloads that cached NAS-derived facts (pairing rows,
 * frame totals). Those are re-derived from the live worker on every load, so a
 * cached copy can only ever be stale — and showing it as current is worse than
 * showing nothing. */
export async function purgeHubSession(): Promise<void> {
  try {
    localStorage.removeItem(getSessionStorageKey());
  } catch (_) { }
  const pid = getServiceProjectId();
  if (!pid) return;
  try {
    await supabase.from(HUB_SESSION_TABLE).delete().eq('project_id', pid);
  } catch (_) { }
}
