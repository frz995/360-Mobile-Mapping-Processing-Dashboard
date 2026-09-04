// =====================================================================
// Malaysia District boundary selection — driven by the real district
// geo-boundary file (`malaysia.district.geojson`, 160 districts, all
// MultiPolygon). Each feature: `id` (e.g. 'kuala-selangor'),
// `properties.name` (display), `properties.state` (state CODE, e.g.
// 'SGR'), `properties.code_state` (state numeric code — repeated for
// every district in a state, so NOT a unique district id).
// Districts are therefore keyed by `name`/`id` and grouped by `state`.
// Loaded via `?raw` (Vite) because `.geojson` is not a `.json` module.
// =====================================================================

import malaysiaDistrictRaw from '../../../malaysia.district.geojson?raw';
import { pathLengthLngLatKm } from '../../utils/geo';

const malaysiaDistrictData: any = (() => {
  try {
    return JSON.parse(malaysiaDistrictRaw);
  } catch {
    return null;
  }
})();

/** Real Malaysia standard state codes → display name (16 states). */
const STATE_CODE_NAMES: Record<string, string> = {
  JHR: 'Johor',
  KDH: 'Kedah',
  KTN: 'Kelantan',
  MLK: 'Melaka',
  NSN: 'Negeri Sembilan',
  PHG: 'Pahang',
  PRK: 'Perak',
  PLS: 'Perlis',
  PNG: 'Pulau Pinang',
  SBH: 'Sabah',
  SWK: 'Sarawak',
  SGR: 'Selangor',
  TRG: 'Terengganu',
  KUL: 'W.P. Kuala Lumpur',
  LBN: 'W.P. Labuan',
  PJY: 'W.P. Putrajaya'
};

export interface MalaysiaDistrict {
  id: string;
  name: string;
  /** State CODE, e.g. 'SGR'. */
  state: string;
  /** Friendly state display name. */
  stateName: string;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** [lat, lng] map focus center */
  center?: [number, number];
  /** Suggested map zoom level when flying to this region */
  zoom?: number;
  /** Grouping label (state display name) used to group the list. */
  group: string;
  /** Committed boundary geo (FeatureCollection). */
  geojson?: any;
}

/** Compute the bbox of a Polygon / MultiPolygon geometry, or null. */
function bboxOfGeometry(geometry?: any): [number, number, number, number] | null {
  if (!geometry) return null;
  const rings: number[][][] = [];
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    rings.push(...geometry.coordinates);
  } else if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    geometry.coordinates.forEach((poly: any) => {
      if (Array.isArray(poly)) rings.push(...poly);
    });
  }
  if (rings.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  rings.forEach((ring) => {
    ring.forEach((c: number[]) => {
      if (!Array.isArray(c) || c.length < 2) return;
      const [lng, lat] = c;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  });
  if (minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function pickZoom(b: [number, number, number, number]): number {
  const lng = b[2] - b[0];
  const lat = b[3] - b[1];
  const diag = Math.sqrt(lng * lng + lat * lat);
  if (diag < 0.15) return 13;
  if (diag < 0.4) return 11;
  if (diag < 1.2) return 9;
  if (diag < 3) return 8;
  return 7;
}

const sourceDistrictFc: any =
  (malaysiaDistrictData as any)?.type === 'FeatureCollection' ? malaysiaDistrictData as any : null;

const DISTRICT_LIST: MalaysiaDistrict[] = [];
if (sourceDistrictFc && Array.isArray(sourceDistrictFc.features)) {
  sourceDistrictFc.features.forEach((feature: any) => {
    const props = feature?.properties || {};
    const name = props.name || 'Unknown';
    const state = props.state || '';
    const stateName = STATE_CODE_NAMES[state] || state || 'Unknown';
    const bbox = bboxOfGeometry(feature?.geometry);
    if (!bbox) return;
    const geojson: any = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: props,
          id: feature.id,
          geometry: feature.geometry
        }
      ]
    };
    DISTRICT_LIST.push({
      id: String(feature?.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      name,
      state,
      stateName,
      bbox,
      center: [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2],
      zoom: pickZoom(bbox),
      group: stateName,
      geojson
    });
  });
}

DISTRICT_LIST.sort((a, b) => a.stateName.localeCompare(b.stateName) || a.name.localeCompare(b.name));

/** All real districts, grouped under state display name. */
export const MALAYSIA_DISTRICTS: MalaysiaDistrict[] = DISTRICT_LIST;

/** Duplicates of a city name across states are disambiguated by state. */
export function findDistrictByName(name: string, state?: string): MalaysiaDistrict | undefined {
  return MALAYSIA_DISTRICTS.find(
    (d) => d.name.toLowerCase() === name.toLowerCase() && (!state || d.state === state)
  );
}

/**
 * Build a combined FeatureCollection + bbox from the selected districts.
 * Returns null when no districts are selected.
 */
export function districtsToGeoJSON(districts: MalaysiaDistrict[]): { geojson: any; bbox: [number, number, number, number] } | null {
  if (!districts || districts.length === 0) return null;
  const features: any[] = [];
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  districts.forEach((d) => {
    if (d.geojson?.features) {
      d.geojson.features.forEach((f: any) => features.push(f));
    }
    const [a, b, c, e] = d.bbox;
    if (a < minLng) minLng = a;
    if (b < minLat) minLat = b;
    if (c > maxLng) maxLng = c;
    if (e > maxLat) maxLat = e;
  });
  if (features.length === 0 || minLng === Infinity) return null;
  return {
    geojson: { type: 'FeatureCollection', features },
    bbox: [minLng, minLat, maxLng, maxLat]
  };
}

/** Group the district list by state display name preserving sorted order. */
export function groupMalaysiaDistricts(districts: MalaysiaDistrict[]): Array<{ group: string; items: MalaysiaDistrict[] }> {
  const order: string[] = [];
  const map = new Map<string, MalaysiaDistrict[]>();
  districts.forEach((d) => {
    if (!map.has(d.group)) {
      map.set(d.group, []);
      order.push(d.group);
    }
    map.get(d.group)!.push(d);
  });
  return order.map((g) => ({ group: g, items: map.get(g)! }));
}

/** All distinct state display names present in the district data. */
export const DISTRICT_STATE_NAMES: string[] = Array.from(new Set(DISTRICT_LIST.map((d) => d.stateName))).sort();

/** States present in the district data as { code, name }. */
export const DISTRICT_STATES: Array<{ code: string; name: string }> = Array.from(
  new Map(DISTRICT_LIST.map((d) => [d.state, d.stateName]))
    .entries()
).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));

// --- light-weight point-in-region (used to filter real captured points) ---

function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi: number = ring[i][0];
    const yi: number = ring[i][1];
    const xj: number = ring[j][0];
    const yj: number = ring[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(pt: [number, number], geometry?: any): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.some((ring: number[][]) => pointInRing(pt, ring));
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.some((poly: number[][][]) =>
      poly.some((ring: number[][]) => pointInRing(pt, ring))
    );
  }
  return false;
}

/**
 * True when the point (lng, lat) falls inside the union of the given
 * districts' real geometry. Fast bbox pre-check avoids the ring test.
 */
export function pointInDistricts(point: [number, number], districts: MalaysiaDistrict[]): boolean {
  for (const d of districts) {
    const [minLng, minLat, maxLng, maxLat] = d.bbox;
    if (point[0] < minLng || point[0] > maxLng || point[1] < minLat || point[1] > maxLat) continue;
    const geom = d.geojson?.features?.[0]?.geometry;
    if (pointInGeometry(point, geom)) return true;
  }
  return false;
}

/**
 * Clip road lines to the union of the selected districts, dependency-free.
 * Each input line is split into its runs of vertices that fall inside the
 * region; only runs with >= 2 vertices are kept (a value > 2 preserves the
 * line's shape while dropping short stubs that poke outside). This produces
 * road lines "within region/district" without a full GIS library.
 */
export function clipLineStringsToDistricts(
  lines: Array<{ coordinates: Array<[number, number]> }>,
  districts: MalaysiaDistrict[],
  minRun = 2
): Array<Array<[number, number]>> {
  if (!lines || lines.length === 0 || districts.length === 0) return [];
  const out: Array<Array<[number, number]>> = [];
  for (const line of lines) {
    const coords = line.coordinates || [];
    if (coords.length < 2) continue;
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length >= minRun) out.push(run.slice());
      run = [];
    };
    for (const pt of coords) {
      if (pointInDistricts(pt, districts)) {
        run.push(pt);
      } else {
        flush();
      }
    }
    flush();
  }
  return out;
}

/**
 * Total length (km) of a set of clipped coordinate runs using haversine.
 */
export function linesLengthKm(runs: Array<Array<[number, number]>>): number {
  let total = 0;
  for (const run of runs) {
    total += pathLengthLngLatKm(run);
  }
  return total;
}
