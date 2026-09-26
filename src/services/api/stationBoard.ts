import { supabase, scoped, getServiceProjectId } from './client';
import type { StationBoardRow, StationBoardMetricUnit, WorkstationStationId } from '../../types/production';

const STATION_BOARD_TABLE = 'station_board_items';

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
  try {
    const query = scoped(supabase
      .from(STATION_BOARD_TABLE)
      .select('*'));
    const { data, error } = await query;
    if (!error && Array.isArray(data) && data.length >= 0) {
      setLocalBoardRows(data as StationBoardRow[]);
    }
    let rows = (!error && Array.isArray(data) ? data : local) as StationBoardRow[];
    if (target) rows = rows.filter((r) => (r.subgrid || '').trim().toUpperCase() === target);
    return rows;
  } catch (_) {
    if (target) return local.filter((r) => (r.subgrid || '').trim().toUpperCase() === target);
    return local;
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
    return !error;
  } catch (_) {
    return false;
  }
}

export type StationBoardDelta = Partial<StationBoardRow> & { station_id: WorkstationStationId };
