// =====================================================================
// Malaysia District boundary selection — driven by the real district
// geo-boundary file (`public/data/malaysia.district.geojson`, 160 districts,
// all MultiPolygon).
// Lightweight metadata is bundled directly (~44KB) to avoid embedding the
// 878KB raw GeoJSON into the main JS chunk. Detailed MultiPolygon geometries
// are loaded on-demand via `ensureDistrictGeometriesLoaded()`.
// =====================================================================

import { DISTRICT_METADATA, type DistrictMeta } from './districtMetadata';
import { pathLengthLngLatKm } from '../../utils/geo';

export interface MalaysiaDistrict extends DistrictMeta {
  /** Committed boundary geo (FeatureCollection). */
  geojson?: any;
}

let isGeometriesLoaded = false;
let loadPromise: Promise<void> | null = null;

// Initialize MALAYSIA_DISTRICTS with pre-computed metadata
export const MALAYSIA_DISTRICTS: MalaysiaDistrict[] = DISTRICT_METADATA.map((d) => ({
  ...d,
  geojson: undefined
}));

export function isDistrictGeometriesLoaded(): boolean {
  return isGeometriesLoaded;
}

/** Attach full GeoJSON MultiPolygon geometries to the in-memory district items. */
export function attachDistrictGeometries(featureCollection: any): void {
  if (!featureCollection || !Array.isArray(featureCollection.features)) return;
  const featureMap = new Map<string, any>();
  featureCollection.features.forEach((f: any) => {
    if (f.id) featureMap.set(String(f.id).toLowerCase(), f);
    if (f.properties?.name) {
      const slug = String(f.properties.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      featureMap.set(slug, f);
    }
  });

  MALAYSIA_DISTRICTS.forEach((d) => {
    const f = featureMap.get(d.id.toLowerCase());
    if (f) {
      d.geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: f.properties || {},
            id: f.id,
            geometry: f.geometry
          }
        ]
      };
    }
  });
  isGeometriesLoaded = true;
}

/** Lazily load the full 878KB GeoJSON features from static asset without blocking initial render. */
export async function ensureDistrictGeometriesLoaded(): Promise<void> {
  if (isGeometriesLoaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetch('/data/malaysia.district.geojson');
      if (!res.ok) throw new Error(`Failed to load district boundaries: ${res.statusText}`);
      const data = await res.json();
      attachDistrictGeometries(data);
    } catch (e) {
      console.error('Failed to load district geometries', e);
      throw e;
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

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
    } else {
      features.push({
        type: 'Feature',
        id: d.id,
        properties: { name: d.name, state: d.state },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [d.bbox[0], d.bbox[1]],
            [d.bbox[2], d.bbox[1]],
            [d.bbox[2], d.bbox[3]],
            [d.bbox[0], d.bbox[3]],
            [d.bbox[0], d.bbox[1]]
          ]]
        }
      });
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
export const DISTRICT_STATE_NAMES: string[] = Array.from(new Set(MALAYSIA_DISTRICTS.map((d) => d.stateName))).sort();

/** States present in the district data as { code, name }. */
export const DISTRICT_STATES: Array<{ code: string; name: string }> = Array.from(
  new Map(MALAYSIA_DISTRICTS.map((d) => [d.state, d.stateName]))
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
    if (geom) {
      if (pointInGeometry(point, geom)) return true;
    } else {
      return true;
    }
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
