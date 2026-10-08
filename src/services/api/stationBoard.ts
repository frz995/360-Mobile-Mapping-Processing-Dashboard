import { supabase, scoped, getServiceProjectId } from './client';
import { reportWriteFailure, reportWriteSuccess } from '../../lib/writeFailures';
import type { StationBoardRow, StationBoardMetricUnit } from '../../types/production';

const STATION_BOARD_TABLE = 'station_board_items';

/**
 * Stable keys, so a poll loop that fails repeatedly raises one banner line.
 * `station_board_items` had no `authenticated` grant until migration 0035; the
 * board looked healthy throughout because every failure resolved to the local
 * mirror without a word.
 */
export const STATION_WRITE_OPS = {
  boardRead: 'station_board.read',
  boardWrite: 'station_board.write'
} as const;

function getBoardStorageKey(): string {
  const pid = getServiceProjectId();
  return pid ? `geosphere_station_board_${pid}` : 'geosphere_station_board';
}

function getLocalBoardRows(): StationBoardRow[] {
  try {
    const raw = localStorage.getItem(getBoardStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function setLocalBoardRows(rows: StationBoardRow[]): void {
  try {
    localStorage.setItem(getBoardStorageKey(), JSON.stringify(rows.slice(0, 400)));
  } catch (_) { }
}

function sameKey(a: StationBoardRow, b: StationBoardRow): boolean {
  return (
    (a.subgrid || '').trim().toUpperCase() === (b.subgrid || '').trim().toUpperCase() &&
    a.station_id === b.station_id
  );
}

/** Board rows for a subgrid. Supabase wins; local cache fills only when the
 * backend is unreachable (guest / offline mode). */
export async function fetchStationBoardItemsFromSupabase(subgrid?: string): Promise<StationBoardRow[]> {
  const local = getLocalBoardRows();
  const target = (subgrid || '').trim().toUpperCase();
  const fromLocal = () =>
    target
      ? local.filter((r) => (r.subgrid || '').trim().toUpperCase() === target)
      : local;

  try {
    const query = scoped(supabase
      .from(STATION_BOARD_TABLE)
      .select('*'));
    const { data, error } = await query;
    if (error) {
      // The local mirror is a legitimate offline cache, but answering from it
      // without saying so makes an unreachable database indistinguishable from a
      // healthy one. Reported at warning severity so a guest/offline session
      // still reads normally while a real outage is visible.
      reportWriteFailure(
        STATION_WRITE_OPS.boardRead,
        'Station board (read)',
        `${error.message} — showing the browser-local cache instead.`,
        'warning'
      );
      return fromLocal();
    }
    if (Array.isArray(data)) {
      setLocalBoardRows(data as StationBoardRow[]);
      reportWriteSuccess(STATION_WRITE_OPS.boardRead);
      const rows = data as StationBoardRow[];
      return target
        ? rows.filter((r) => (r.subgrid || '').trim().toUpperCase() === target)
        : rows;
    }
    return fromLocal();
  } catch (err) {
    reportWriteFailure(
      STATION_WRITE_OPS.boardRead,
      'Station board (read)',
      `${err instanceof Error ? err.message : String(err)} — showing the browser-local cache instead.`,
      'warning'
    );
    return fromLocal();
  }
}

/** Upsert one derived station state keyed (project_id, subgrid, station_id). */
export async function upsertStationBoardItemInSupabase(
  row: StationBoardRow & { metric_unit?: StationBoardMetricUnit | null }
): Promise<boolean> {
  const payload: StationBoardRow = {
    ...row,
    subgrid: (row.subgrid || '').trim().toUpperCase(),
    project_id: row.project_id || getServiceProjectId() || null,
    metric_unit: row.metric_unit || 'frames',
    updated_at: new Date().toISOString()
  };
  // Local mirror first: the board must still hydrate for guest / offline use.
  try {
    const local = getLocalBoardRows();
    const idx = local.findIndex((r) => sameKey(r, payload));
    if (idx >= 0) local[idx] = { ...local[idx], ...payload, id: local[idx].id || payload.id };
    else local.push(payload);
    setLocalBoardRows(local);
  } catch (_) { }
  try {
    const { error } = await supabase
      .from(STATION_BOARD_TABLE)
      .upsert([payload], { onConflict: 'project_id,subgrid,station_id' });
    // A PostgREST builder is thenable: it resolves with `{ data, error }` and
    // does NOT throw on a rejected write, so `error` must be inspected here.
    if (error) {
      reportWriteFailure(
        STATION_WRITE_OPS.boardWrite,
        'Station board',
        `${error.message} — this station's snapshot is being kept in this browser only.`
      );
      return false;
    }
    reportWriteSuccess(STATION_WRITE_OPS.boardWrite);
    return true;
  } catch (err) {
    reportWriteFailure(
      STATION_WRITE_OPS.boardWrite,
      'Station board',
      `${err instanceof Error ? err.message : String(err)} — this station's snapshot is being kept in this browser only.`
    );
    return false;
  }
}
