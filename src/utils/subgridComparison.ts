import { pathLengthLngLatKm } from './geo';
import { extractSubgridName } from './subgrid';
import { SUBGRID_COORDINATES } from '../services/supabase';

export interface SubgridRelationNotice {
  type: 'INTERSECT' | 'MISMATCH' | 'METADATA_INCONSISTENCY';
  originSubgrid: string;
  spatialSubgrid: string;
  pointsCount: number;
  text: string;
  reason?: string;
  batchId?: string;
}

export interface SubgridMetric {
  subgrid: string;
  pointsCount: number;
  tracksCount: number;
  masterlistKm: number;
  planKm: number;
  differenceKm: number;
  remainingKm: number;
  completionRatio: string | null;
  bbox: [number, number, number, number];
  inboundTransits?: SubgridRelationNotice[];
  outboundTransits?: SubgridRelationNotice[];
  mismatches?: SubgridRelationNotice[];
}

/**
 * Ray-casting algorithm to test if [lng, lat] point is inside a linear ring.
 */
export function isPointInPolygonRing(pt: [number, number], ring: [number, number][]): boolean {
  if (!ring || ring.length < 3) return false;
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Tests if a [lng, lat] coordinate point is inside a GeoJSON Polygon or MultiPolygon geometry.
 */
export function isPointInPolygonGeometry(pt: [number, number], geometry: any): boolean {
  if (!geometry || !geometry.coordinates) return false;
  if (geometry.type === 'Polygon') {
    const rings: [number, number][][] = geometry.coordinates;
    if (!rings || rings.length === 0) return false;
    // Must be inside outer ring and not inside any hole
    if (!isPointInPolygonRing(pt, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) {
      if (isPointInPolygonRing(pt, rings[i])) return false;
    }
    return true;
  }
  if (geometry.type === 'MultiPolygon') {
    const polys: [number, number][][][] = geometry.coordinates;
    for (const poly of polys) {
      if (!poly || poly.length === 0) continue;
      if (isPointInPolygonRing(pt, poly[0])) {
        let inHole = false;
        for (let i = 1; i < poly.length; i++) {
          if (isPointInPolygonRing(pt, poly[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }
  return false;
}

/**
 * Resolves the subgrid ID of a coordinate point [lng, lat] by checking loaded
 * catalog polygon grid layers (e.g. Grid_5km_tangkak_segamat), or fallback bounding boxes.
 */
export function resolveSpatialSubgrid(
  pt: [number, number],
  catalogLayers: any[] = []
): string | null {
  for (const layer of catalogLayers) {
    const features = layer?.geojson?.features;
    if (!Array.isArray(features)) continue;
    for (const feat of features) {
      if (!feat.geometry) continue;
      const p = feat.properties || {};
      const candidate = p.NAME || p.name || p.grid_id || p.GRID_ID || p.subgrid || p.grid;
      const subgridName = extractSubgridName(String(candidate || ''));
      if (!subgridName) continue;

      if (isPointInPolygonGeometry(pt, feat.geometry)) {
        return subgridName;
      }
    }
  }
  return null;
}

/**
 * Checks if a [lng, lat] coordinate point is inside a [minLng, minLat, maxLng, maxLat] bounding box.
 */
export function pointInBbox(pt: [number, number], bbox: [number, number, number, number]): boolean {
  return pt[0] >= bbox[0] && pt[0] <= bbox[2] && pt[1] >= bbox[1] && pt[1] <= bbox[3];
}

/**
 * Clips an array of line runs to a bounding box.
 */
export function clipLineRunsToBbox(
  runs: Array<Array<[number, number]>>,
  bbox: [number, number, number, number],
  minRun = 2
): Array<Array<[number, number]>> {
  if (!runs || runs.length === 0) return [];
  const out: Array<Array<[number, number]>> = [];
  for (const coords of runs) {
    if (!coords || coords.length < 2) continue;
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length >= minRun) out.push(run.slice());
      run = [];
    };
    for (const pt of coords) {
      if (pointInBbox(pt, bbox)) {
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
 * Computes the total spherical length (km) of a set of coordinate runs using Haversine.
 */
export function subgridLinesLengthKm(runs: Array<Array<[number, number]>>): number {
  let total = 0;
  for (const run of runs) {
    total += pathLengthLngLatKm(run);
  }
  return total;
}

/**
 * Calculates a standard bounding box [minLng, minLat, maxLng, maxLat] from a GeoJSON geometry.
 */
export function getGeometryBbox(geometry: any): [number, number, number, number] | null {
  if (!geometry || !geometry.coordinates) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function traverse(coords: any) {
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    } else if (Array.isArray(coords)) {
      for (let i = 0; i < coords.length; i++) {
        traverse(coords[i]);
      }
    }
  }

  traverse(geometry.coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Derives a standard 5x5 km bounding box [minLng, minLat, maxLng, maxLat] centered on the subgrid.
 * At Malaysia latitudes (~2° to 6° N), 5 km corresponds to ~0.0450° (half-width ±0.0225°).
 *
 * Search priority:
 * 1. Exact polygon feature in loaded catalog vector layers (GeoJSON grid).
 * 2. SUBGRID_COORDINATES runtime dictionary.
 * 3. Average coordinates of captured survey points.
 * 4. Extrapolation from any known adjacent subgrid in the N{row}E{col} coordinate grid.
 */
export function getSubgridBbox(
  subgrid: string,
  points?: Array<{ lng: number; lat: number }>,
  catalogLayers: any[] = []
): [number, number, number, number] {
  const normSg = extractSubgridName(subgrid).toUpperCase();
  if (!normSg) return [0, 0, 0, 0];

  // 1. Direct Polygon Match in Catalog Layers
  if (Array.isArray(catalogLayers)) {
    for (const layer of catalogLayers) {
      const features = layer?.geojson?.features;
      if (!Array.isArray(features)) continue;
      for (const feat of features) {
        if (!feat.geometry) continue;
        const p = feat.properties || {};
        const candidate = p.NAME || p.name || p.grid_id || p.GRID_ID || p.subgrid || p.grid || p.ID || p.id || p.CODE || p.code;
        const featSg = extractSubgridName(String(candidate || '')).toUpperCase();
        if (featSg === normSg) {
          const bbox = getGeometryBbox(feat.geometry);
          if (bbox && (bbox[0] !== 0 || bbox[1] !== 0)) {
            return bbox;
          }
        }
      }
    }
  }

  // 2. SUBGRID_COORDINATES runtime dictionary
  let centerLng = SUBGRID_COORDINATES[normSg]?.[0];
  let centerLat = SUBGRID_COORDINATES[normSg]?.[1];

  // 3. Average coordinates of points
  if (
    (centerLng === undefined || centerLat === undefined || (centerLng === 0 && centerLat === 0)) &&
    points &&
    points.length > 0
  ) {
    centerLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
    centerLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  }

  // 4. Extrapolation from known grid neighbor if matching N{row}E{col} format
  const delta = 0.0225; // 2.5 km each side in degrees (5 km width = 0.0450)
  const cellWidthDeg = 0.0450;

  if (centerLng === undefined || centerLat === undefined) {
    const matchTarget = normSg.match(/^N(\d+)E(\d+)$/i);
    if (matchTarget) {
      const targetRow = parseInt(matchTarget[1], 10);
      const targetCol = parseInt(matchTarget[2], 10);

      let refRow: number | null = null;
      let refCol: number | null = null;
      let refLng: number | null = null;
      let refLat: number | null = null;

      // Search SUBGRID_COORDINATES for a known reference cell
      for (const [knownSg, coords] of Object.entries(SUBGRID_COORDINATES)) {
        const m = knownSg.match(/^N(\d+)E(\d+)$/i);
        if (m && coords && coords[0] && coords[1]) {
          refRow = parseInt(m[1], 10);
          refCol = parseInt(m[2], 10);
          refLng = coords[0];
          refLat = coords[1];
          break;
        }
      }

      // Also search catalogLayers for any known reference cell if none in SUBGRID_COORDINATES
      if (refLng === null && Array.isArray(catalogLayers)) {
        for (const layer of catalogLayers) {
          const features = layer?.geojson?.features;
          if (!Array.isArray(features)) continue;
          for (const feat of features) {
            const p = feat.properties || {};
            const candidate = p.NAME || p.name || p.grid_id || p.GRID_ID || p.subgrid || p.grid || p.ID || p.id || p.CODE || p.code;
            const featSg = extractSubgridName(String(candidate || '')).toUpperCase();
            const m = featSg.match(/^N(\d+)E(\d+)$/i);
            if (m && feat.geometry) {
              const bbox = getGeometryBbox(feat.geometry);
              if (bbox) {
                refRow = parseInt(m[1], 10);
                refCol = parseInt(m[2], 10);
                refLng = (bbox[0] + bbox[2]) / 2;
                refLat = (bbox[1] + bbox[3]) / 2;
                break;
              }
            }
          }
          if (refLng !== null) break;
        }
      }

      if (refLng !== null && refLat !== null && refRow !== null && refCol !== null) {
        const colDiff = targetCol - refCol;
        const rowDiff = targetRow - refRow;
        centerLng = refLng + (colDiff * cellWidthDeg);
        centerLat = refLat - (rowDiff * cellWidthDeg);
      }
    }
  }

  if (centerLng === undefined || centerLat === undefined) {
    return [0, 0, 0, 0];
  }

  return [
    centerLng - delta,
    centerLat - delta,
    centerLng + delta,
    centerLat + delta
  ];
}

/**
 * Evaluates point and batch spatial relationships across subgrids.
 * Detects:
 * - Scenario 2: Continuous Road Transit (e.g. track starts in N93E70, ends in N93E71)
 * - Scenario 3: Complete Misassignment (reason: "data missmatch with subgrid assign")
 * - Scenario 4: Metadata Inconsistency (CSV name vs photo prefix)
 */
export function evaluatePointSpatialRelation(
  point: { subgrid?: string; filename?: string; lng: number; lat: number },
  batchTotalPointsInOrigin: number,
  _batchTotalPointsInDestination = 0,
  catalogLayers: any[] = []
): {
  type: 'MATCHED' | 'INTERSECT' | 'MISMATCH';
  originSubgrid: string;
  spatialSubgrid: string;
  text: string;
  reason?: string;
} {
  const assignedSubgrid = extractSubgridName(point.subgrid);
  const coords: [number, number] = [Number(point.lng), Number(point.lat)];
  const spatialSubgrid = resolveSpatialSubgrid(coords, catalogLayers) || assignedSubgrid;

  if (!assignedSubgrid || !spatialSubgrid || assignedSubgrid === spatialSubgrid) {
    return {
      type: 'MATCHED',
      originSubgrid: assignedSubgrid || spatialSubgrid || '',
      spatialSubgrid: spatialSubgrid || assignedSubgrid || '',
      text: 'Matched with assigned subgrid'
    };
  }

  // Point is in a different subgrid from assigned
  if (batchTotalPointsInOrigin > 0) {
    // Continuous transit across boundary
    return {
      type: 'INTERSECT',
      originSubgrid: assignedSubgrid,
      spatialSubgrid,
      text: `Intersect with ${assignedSubgrid} — Track starts in ${assignedSubgrid}, ends in ${spatialSubgrid}`
    };
  } else {
    // 0 points in origin, all in destination -> Complete misassignment
    return {
      type: 'MISMATCH',
      originSubgrid: assignedSubgrid,
      spatialSubgrid,
      reason: 'data missmatch with subgrid assign',
      text: `data missmatch with subgrid assign (Assigned ${assignedSubgrid}, physically in ${spatialSubgrid})`
    };
  }
}

/**
 * Computes per-subgrid actual vs plan comparison metrics, including cross-boundary transit and mismatch diagnostics.
 * Actual captured tracks: strictly from dailyData (dailylist only).
 * Actual captured length: strictly from masterlist (batchLogs.kmProcessed).
 * Plan road length: clipped within each 5x5 km cell.
 */
export function computeSubgridMetrics(
  capturedPoints: Array<{ subgrid?: string; filename?: string; lng: number; lat: number }>,
  dailyData: any[] = [],
  batchLogs: any[] = [],
  activePlanRuns: Array<Array<[number, number]>> = [],
  overallCapturedTracksCount = 0,
  catalogLayers: any[] = []
): SubgridMetric[] {
  const subgridSet = new Set<string>();

  (capturedPoints || []).forEach((p) => {
    const sg = extractSubgridName(p.subgrid);
    if (sg) subgridSet.add(sg);
    const coords: [number, number] = [Number(p.lng), Number(p.lat)];
    const spatialSg = resolveSpatialSubgrid(coords, catalogLayers);
    if (spatialSg) subgridSet.add(spatialSg);
  });
  (dailyData || []).forEach((d) => {
    const sg = extractSubgridName(d.subgrid);
    if (sg) subgridSet.add(sg);
  });
  (batchLogs || []).forEach((b) => {
    const sg = extractSubgridName(b.subgrid);
    if (sg) subgridSet.add(sg);
  });
  (catalogLayers || []).forEach((layer) => {
    const features = layer?.geojson?.features;
    if (Array.isArray(features)) {
      features.forEach((feat: any) => {
        const p = feat.properties || {};
        const candidate = p.NAME || p.name || p.grid_id || p.GRID_ID || p.subgrid || p.grid || p.ID || p.id || p.CODE || p.code;
        const sg = extractSubgridName(String(candidate || ''));
        if (sg) subgridSet.add(sg);
      });
    }
  });

  const subgridList = Array.from(subgridSet).sort();
  const isSingleSubgrid = subgridList.length === 1;

  return subgridList.map((sg) => {
    const pts = (capturedPoints || []).filter((p) => extractSubgridName(p.subgrid) === sg);
    const pointsCount = pts.length;

    // Daily tracks: count from dailyData only
    const dailyRuns = (dailyData || []).filter((d) => extractSubgridName(d.subgrid) === sg);
    const tracksCount =
      isSingleSubgrid && overallCapturedTracksCount > 0
        ? overallCapturedTracksCount
        : dailyRuns.filter((d) => (d.panoramas?.length >= 2 || d.points?.length >= 2)).length || dailyRuns.length;

    // Masterlist KM: sum from batchLogs
    const matchingBatches = (batchLogs || []).filter((b) => extractSubgridName(b.subgrid) === sg);
    let masterlistKm = matchingBatches.reduce((sum, b) => {
      const km = Number(b.kmProcessed ?? b.km_processed ?? b.km ?? 0);
      return sum + (Number.isFinite(km) ? km : 0);
    }, 0);

    // Fallback if masterlist KM is 0 but coordinates exist
    if (masterlistKm <= 0 && pts.length >= 2) {
      masterlistKm = pathLengthLngLatKm(pts.map((p) => [p.lng, p.lat] as [number, number]));
    }

    // 5x5 km Bounding Box
    const bbox = getSubgridBbox(sg, pts, catalogLayers);

    // Plan road length clipped within 5x5 km cell
    const subgridPlanRuns = clipLineRunsToBbox(activePlanRuns, bbox);
    const planKm = subgridLinesLengthKm(subgridPlanRuns);

    const differenceKm = Number((masterlistKm - planKm).toFixed(2));
    const remainingKm = Math.max(0, Number((planKm - masterlistKm).toFixed(2)));

    let completionRatio: string | null = null;
    if (planKm > 0) {
      const pct = (masterlistKm / planKm) * 100;
      if (pct === 0) completionRatio = '0%';
      else if (pct < 0.01) completionRatio = '< 0.01%';
      else if (pct < 10) completionRatio = `${pct.toFixed(2)}%`;
      else completionRatio = `${pct.toFixed(1)}%`;
    }

    // Outbound transit and mismatch diagnostics (reports on THIS subgrid's data)
    const outboundTransits: SubgridRelationNotice[] = [];
    const mismatches: SubgridRelationNotice[] = [];

    // Check points assigned to THIS subgrid (sg) that physically fall outside in other subgrids
    const outboundPoints = pts.filter((p) => {
      const coords: [number, number] = [Number(p.lng), Number(p.lat)];
      const spatial = resolveSpatialSubgrid(coords, catalogLayers);
      return spatial !== null && spatial !== sg;
    });

    if (outboundPoints.length > 0) {
      const outboundByDest = new Map<string, number>();
      outboundPoints.forEach((p) => {
        const coords: [number, number] = [Number(p.lng), Number(p.lat)];
        const dest = resolveSpatialSubgrid(coords, catalogLayers) || 'adjacent subgrid';
        outboundByDest.set(dest, (outboundByDest.get(dest) || 0) + 1);
      });

      const pointsInsideSg = pts.length - outboundPoints.length;
      outboundByDest.forEach((count, dest) => {
        if (pointsInsideSg > 0) {
          // Continuous transit starting in this subgrid and crossing into dest
          outboundTransits.push({
            type: 'INTERSECT',
            originSubgrid: sg,
            spatialSubgrid: dest,
            pointsCount: count,
            text: `Extends into ${dest} — Track starts in ${sg}, ends in ${dest}`
          });
        } else {
          // 100% of points assigned to this subgrid are physically in dest (Misallocated batch!)
          mismatches.push({
            type: 'MISMATCH',
            originSubgrid: sg,
            spatialSubgrid: dest,
            pointsCount: count,
            reason: 'data missmatch with subgrid assign',
            text: `data missmatch with subgrid assign (Assigned ${sg}, physically in ${dest})`
          });
        }
      });
    }

    return {
      subgrid: sg,
      pointsCount,
      tracksCount,
      masterlistKm: Number(masterlistKm.toFixed(2)),
      planKm: Number(planKm.toFixed(2)),
      differenceKm,
      remainingKm,
      completionRatio,
      bbox,
      outboundTransits,
      mismatches
    };
  });
}

