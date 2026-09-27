/**
 * Camera framing helpers for subgrid-level selections in the WebGIS Database &
 * Admin tables.
 *
 * A masterlist (Overall Progress) row identifies a subgrid, not a single frame.
 * Selecting one must frame every frame that belongs to that parent subgrid, so
 * these helpers keep the payload scoped to the subgrid and usable for a camera
 * extent. They exist as pure functions so the behaviour is testable without
 * mounting the dashboard.
 */
import { extractSubgridName } from './subgrid';

export interface FramePointLike {
  filename?: string;
  image_url?: string;
  lat?: number | string | null;
  lon?: number | string | null;
  longitude?: number | string | null;
  latitude?: number | string | null;
  lng?: number | string | null;
  x?: number | string | null;
  y?: number | string | null;
  [key: string]: unknown;
}

export interface FramedPoint {
  [key: string]: unknown;
  filename: string;
  subgrid: string;
  lat: number;
  lon: number;
}

const normalizeCode = (value?: string | null) => (value || '').toUpperCase().trim();

/** Canonical, upper-cased subgrid code for any raw value. */
export function subgridCode(raw?: string | null): string {
  return normalizeCode(extractSubgridName(raw || '') || raw);
}

/**
 * Rows belonging to one subgrid. Daily runs are preferred because they carry
 * the surveyed coordinates; masterlist rows are the fallback for a subgrid whose
 * daily run has not landed yet. Never falls back to "every row" — that framed
 * the whole project instead of the selected parent subgrid.
 */
export function rowsForSubgrid<T>(
  subgrid: string,
  dailyRows: T[],
  batchRows: T[],
  pickSubgrid: (row: T) => string | undefined | null
): T[] {
  const target = subgridCode(subgrid);
  if (!target) return [];
  const matches = (rows: T[]) => rows.filter(row => subgridCode(pickSubgrid(row)) === target);
  const daily = matches(dailyRows);
  return daily.length > 0 ? daily : matches(batchRows);
}

const toFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
};

/**
 * Points that can actually drive a camera extent for a subgrid selection.
 * Rows without coordinates are dropped: a lone stray coordinate would make the
 * map fit a single frame (zoom in) instead of the subgrid's full extent, and
 * `0` is a valid coordinate while `NaN` is not.
 */
export function framableSubgridPoints<T extends FramePointLike>(
  rows: T[],
  subgrid: string
): FramedPoint[] {
  const code = subgridCode(subgrid);
  return rows
    .flatMap(row => (Array.isArray(row.panoramas) && row.panoramas.length > 0
      ? row.panoramas
      : (Array.isArray(row.points) ? row.points : [])))
    .map(p => {
      const lat = toFiniteNumber(p.lat ?? p.latitude ?? p.y);
      const lon = toFiniteNumber(p.lon ?? p.longitude ?? p.lng ?? p.x);
      return {
        ...p,
        filename: p.filename || p.image_url || '',
        subgrid: code,
        lat: lat as number,
        lon: lon as number
      };
    })
    .filter(p => p.lat !== null && p.lon !== null) as FramedPoint[];
}
