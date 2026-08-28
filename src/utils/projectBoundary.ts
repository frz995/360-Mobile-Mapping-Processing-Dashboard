// =====================================================================
// Project Boundary helpers — resolve the project geographic boundary
// (a GeoJSON polygon / bbox in projectSettings.projectBoundary) into a
// subgrid allow-list used to filter coverage & analytics, and to provide
// bounding boxes for map focus.
// =====================================================================

export interface ProjectBoundaryLike {
  geojson?: any;
  bbox?: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
}

/** Return [minLng, minLat, maxLng, maxLat] for the boundary, or null. */
export function boundaryBbox(boundary?: ProjectBoundaryLike): [number, number, number, number] | null {
  if (boundary?.bbox) return boundary.bbox as [number, number, number, number];
  return bboxFromGeojson(boundary?.geojson);
}

function bboxFromGeojson(geojson?: any): [number, number, number, number] | null {
  if (!geojson) return null;
  const ring = polygonRing(geojson);
  if (ring.length < 3) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  ring.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  return [minLng, minLat, maxLng, maxLat];
}

/** Extract the outer ring of a GeoJSON polygon as [lng, lat] pairs. */
export function polygonRing(geojson?: any): number[][] {
  if (!geojson) return [];
  const feat = geojson.type === 'FeatureCollection'
    ? geojson.features?.[0]
    : geojson.type === 'Feature'
      ? geojson
      : null;
  const geometry = feat ? feat.geometry || geojson : geojson;
  const coords = geometry?.coordinates;
  if (geometry?.type === 'Polygon') return (Array.isArray(coords?.[0]) ? coords[0] : []) as number[][];
  if (geometry?.type === 'MultiPolygon') return (Array.isArray(coords?.[0]?.[0]) ? coords[0][0] : []) as number[][];
  return [];
}

/** Point-in-polygon test (ray casting). Point = [lng, lat]. */
export function pointInBoundary(
  point: [number, number],
  boundary?: ProjectBoundaryLike
): boolean {
  const ring = polygonRing(boundary?.geojson);
  if (ring.length === 0 && boundary?.bbox) {
    const [minLng, minLat, maxLng, maxLat] = boundary.bbox;
    return point[0] >= minLng && point[0] <= maxLng && point[1] >= minLat && point[1] <= maxLat;
  }
  if (ring.length === 0) return false;
  const bb = bboxFromGeojson(boundary?.geojson);
  if (bb) {
    const [minLng, minLat, maxLng, maxLat] = bb;
    if (point[0] < minLng || point[0] > maxLng || point[1] < minLat || point[1] > maxLat) return false;
  }
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Build the subgrid allow-list (uppercase subgrid names) whose center
 * falls inside the boundary. `subgridCoordinates` maps subgrid -> [lng, lat]
 * (i.e. SUBGRID_COORDINATES).
 */
export function buildBoundarySubgridSet(
  subgrids: string[],
  boundary: ProjectBoundaryLike | undefined,
  subgridCoordinates?: Record<string, [number, number]>
): Set<string> {
  const set = new Set<string>();
  if (!boundary?.geojson && !boundary?.bbox) return set;
  subgrids.forEach((sg) => {
    const key = sg.toUpperCase().trim();
    const coord = subgridCoordinates?.[key] || subgridCoordinates?.[key.toLowerCase()];
    if (!coord) return;
    // coord is [lng, lat] per SUBGRID_COORDINATES.
    if (pointInBoundary([Number(coord[0]), Number(coord[1])], boundary)) {
      set.add(key);
    }
  });
  return set;
}
