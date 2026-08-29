// =====================================================================
// Malaysia Region Boundary selection — driven by the real Malaysia
// geo-boundary file (Malaysia_Boundary.json, simplemaps MY states).
// Exposes selectable regions (whole Malaysia + each state) whose
// committed `geojson` is the actual boundary geometry (Polygon or
// MultiPolygon), plus a computed [minLng, minLat, maxLng, maxLat] bbox.
// 'custom' has no fixed geometry — it kept the manual draw/upload workflow.
// =====================================================================

import malaysiaBoundaryData from '../../../Malaysia_Boundary.json';

export interface MalaysiaRegion {
  id: string;
  name: string;
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** [lat, lng] map focus center */
  center?: [number, number];
  /** Suggested map zoom level when flying to this region */
  zoom?: number;
  /** Grouping label used to group the list (e.g. "Peninsular", "Borneo"). */
  group: string;
  /** Committed boundary geo (FeatureCollection). Falls back to bbox rect. */
  geojson?: any;
}

export const ENTIRE_MALAYSIA_ID = 'malaysia';
export const CUSTOM_REGION_ID = 'custom';

/** Initial map bounding box for a healthy project wide view. */
export const MALAYSIA_WIDE_BBOX: [number, number, number, number] = [99.64, 0.85, 119.27, 7.36];

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

function bboxOfFeatureCollection(fc: any): [number, number, number, number] | null {
  if (!fc || !Array.isArray(fc.features)) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  fc.features.forEach((feat: any) => {
    const b = bboxOfGeometry(feat?.geometry);
    if (!b) return;
    if (b[0] < minLng) minLng = b[0];
    if (b[1] < minLat) minLat = b[1];
    if (b[2] > maxLng) maxLng = b[2];
    if (b[3] > maxLat) maxLat = b[3];
  });
  if (minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function isBorneo(name: string): boolean {
  return /sabah|sarawak|labuan/i.test(name);
}

function pickZoom(b: [number, number, number, number]): number {
  const lng = b[2] - b[0];
  const lat = b[3] - b[1];
  const diag = Math.sqrt(lng * lng + lat * lat);
  if (diag < 0.4) return 11;
  if (diag < 1.2) return 9;
  if (diag < 3) return 8;
  if (diag < 7) return 7;
  return 6;
}

// --- Build state regions + whole Malaysia from the boundary data ---
const sourceFc: any = (malaysiaBoundaryData as any)?.type === 'FeatureCollection' ? malaysiaBoundaryData as any : null;

const STATE_REGIONS: MalaysiaRegion[] = [];
if (sourceFc && Array.isArray(sourceFc.features)) {
  sourceFc.features.forEach((feature: any) => {
    const name = feature?.properties?.name || 'Unknown';
    const bbox = bboxOfGeometry(feature?.geometry);
    if (!bbox) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const id = `state:${feature?.properties?.id || slug}`;
    const geojson: any = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: feature.properties || {},
          geometry: feature.geometry
        }
      ]
    };
    STATE_REGIONS.push({
      id,
      name,
      bbox,
      center: [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2],
      zoom: pickZoom(bbox),
      group: isBorneo(name) ? 'Borneo' : 'Peninsular',
      geojson
    });
  });
}

// Whole Malaysia = all state features combined into one boundary.
const WHOLE_MALAYSIA_REGION: MalaysiaRegion = (() => {
  const wholeBbox = sourceFc ? bboxOfFeatureCollection(sourceFc) : MALAYSIA_WIDE_BBOX;
  return {
    id: ENTIRE_MALAYSIA_ID,
    name: 'Whole Malaysia',
    bbox: wholeBbox || MALAYSIA_WIDE_BBOX,
    center: [3.8, 109.5],
    zoom: 5,
    group: 'Malaysia',
    geojson: sourceFc || undefined
  };
})();

/** Selectable regions: Whole Malaysia first, then each state. */
export const MALAYSIA_REGIONS: MalaysiaRegion[] = [WHOLE_MALAYSIA_REGION, ...STATE_REGIONS];

/** Corners of a region bbox as [lng, lat] pairs (EPSG:4326, WGS84). */
export function regionCorners(region: MalaysiaRegion): Array<[number, number]> {
  const [minLng, minLat, maxLng, maxLat] = region.bbox;
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat]
  ];
}

/** Convert a region into the GeoJSON FeatureCollection that gets committed
 *  as the projectBoundary — uses the real boundary geometry when available,
 *  otherwise a bounding-box rectangle. */
export function regionToGeoJSON(region: MalaysiaRegion): { geojson: any; bbox: [number, number, number, number] } {
  if (region.geojson) {
    return {
      geojson: region.geojson,
      bbox: [region.bbox[0], region.bbox[1], region.bbox[2], region.bbox[3]]
    };
  }
  const ring = regionCorners(region);
  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: `region:${region.id}`, region: region.name },
        geometry: { type: 'Polygon', coordinates: [ring] }
      }
    ]
  };
  return { geojson, bbox: [region.bbox[0], region.bbox[1], region.bbox[2], region.bbox[3]] };
}

/** Group the region list preserving preset order. */
export function groupMalaysiaRegions(regions: MalaysiaRegion[]): Array<{ group: string; items: MalaysiaRegion[] }> {
  const order: string[] = [];
  const map = new Map<string, MalaysiaRegion[]>();
  regions.forEach((r) => {
    if (!map.has(r.group)) {
      map.set(r.group, []);
      order.push(r.group);
    }
    map.get(r.group)!.push(r);
  });
  return order.map((g) => ({ group: g, items: map.get(g)! }));
}
