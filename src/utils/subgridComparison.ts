import { calculateGeodesicDistanceMeters, pathLengthLngLatKm } from './geo';
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
 * Clips an array of line runs to a bounding box, interpolating the exact
 * crossing point on each box edge. Point-filtering ended a run at its last
 * inside vertex, leaving a visible gap between the drawn road and the subgrid
 * edge; computing the true intersection makes the line stop exactly on the
 * edge so the trace reaches the boundary.
 */
export function clipLineRunsToBbox(
  runs: Array<Array<[number, number]>>,
  bbox: [number, number, number, number],
  minRun = 2
): Array<Array<[number, number]>> {
  if (!runs || runs.length === 0) return [];
  const [minX, minY, maxX, maxY] = bbox;
  const inside = (p: [number, number]) =>
    p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY;

  const crossings = (a: [number, number], b: [number, number]): Array<[number, number]> => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const ts: number[] = [];
    if (dx !== 0) {
      for (const x of [minX, maxX]) {
        const t = (x - a[0]) / dx;
        if (t > 0 && t < 1) {
          const y = a[1] + t * dy;
          if (y >= minY - 1e-12 && y <= maxY + 1e-12) ts.push(t);
        }
      }
    }
    if (dy !== 0) {
      for (const y of [minY, maxY]) {
        const t = (y - a[1]) / dy;
        if (t > 0 && t < 1) {
          const x = a[0] + t * dx;
          if (x >= minX - 1e-12 && x <= maxX + 1e-12) ts.push(t);
        }
      }
    }
    ts.sort((p, q) => p - q);
    return ts.map((t) => [a[0] + t * dx, a[1] + t * dy] as [number, number]);
  };

  const out: Array<Array<[number, number]>> = [];
  for (const coords of runs) {
    if (!coords || coords.length < 2) continue;
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length >= minRun) out.push(run.slice());
      run = [];
    };

    let prev = coords[0];
    if (inside(prev)) run.push(prev);
    for (let i = 1; i < coords.length; i++) {
      const cur = coords[i];
      const aIn = inside(prev);
      const bIn = inside(cur);
      if (aIn && bIn) {
        run.push(cur);
      } else if (aIn && !bIn) {
        const xs = crossings(prev, cur);
        if (xs.length) run.push(xs[0]);
        flush();
      } else if (!aIn && bIn) {
        flush();
        const xs = crossings(prev, cur);
        if (xs.length) run.push(xs[0]);
        run.push(cur);
      } else {
        flush();
        const xs = crossings(prev, cur);
        if (xs.length >= 2) {
          run = [xs[0], xs[1]];
          flush();
        }
      }
      prev = cur;
    }
    flush();
  }
  return out;
}

type BBox = [number, number, number, number];

/**
 * Union bounding box of every coordinate inside a GeoJSON document, or null
 * when the document has no usable coordinates.
 */
export function bboxOfFeatureCollection(fc: any): BBox | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const walk = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const x = coords[0];
      const y = coords[1];
      if (x < minLng) minLng = x;
      if (y < minLat) minLat = y;
      if (x > maxLng) maxLng = x;
      if (y > maxLat) maxLat = y;
      return;
    }
    for (const c of coords) walk(c);
  };
  if (!fc || !Array.isArray(fc.features)) return null;
  fc.features.forEach((f: any) => walk(f?.geometry?.coordinates));
  if (minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * True when the `inner` bbox sits entirely inside the `outer` one (allowing a
 * tiny degree tolerance so an overshoot of a few metres does not count as
 * "exceeding" the selected region).
 */
export function bboxContainsBbox(outer: BBox, inner: BBox, tolDegs = 1e-4): boolean {
  const [ol, ob, or2, ot] = outer;
  const [il, ib, ir2, it] = inner;
  return (
    il >= ol - tolDegs &&
    ib >= ob - tolDegs &&
    ir2 <= or2 + tolDegs &&
    it <= ot + tolDegs
  );
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

type Ring = Array<Array<number>>;

function collectGeometryRings(geometry: any): Ring[] {
  if (!geometry?.coordinates) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[];
  if (geometry.type === 'MultiPolygon') {
    const rings: Ring[] = [];
    for (const poly of geometry.coordinates as any[]) {
      for (const ring of poly as any[]) rings.push(ring as Ring);
    }
    return rings;
  }
  return [];
}

interface RegionClipTarget {
  geometry: any;
  bbox: BBox;
  rings: Ring[];
}

function buildRegionClipTargets(regionGeojson: any): RegionClipTarget[] {
  const features = regionGeojson?.features;
  if (!Array.isArray(features)) return [];
  const targets: RegionClipTarget[] = [];
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    const bbox = bboxOfFeatureCollection({ type: 'FeatureCollection', features: [f] });
    if (!bbox) continue;
    targets.push({ geometry: g, bbox, rings: collectGeometryRings(g) });
  }
  return targets;
}

/**
 * Clips line runs to the UNION of the selected region polygons, following the
 * actual district BOUNDARY rather than its bounding box. Every segment is cut
 * at the exact edge crossing (interpolated), and only the sub-segments whose
 * midpoint falls inside a district polygon are kept — a road that leaves and
 * re-enters the region is split into several runs. Points exactly on the
 * boundary are treated as outside so the result hugs the district shape.
 */
export function clipLineRunsToRegion(
  runs: Array<Array<[number, number]>>,
  regionGeojson: any,
  minRun = 2
): Array<Array<[number, number]>> {
  const targets = buildRegionClipTargets(regionGeojson);
  if (targets.length === 0) return runs;
  if (!runs || runs.length === 0) return [];

  const inRegion = (pt: [number, number]): boolean => {
    for (const t of targets) {
      if (!pointInBbox(pt, t.bbox)) continue;
      if (isPointInPolygonGeometry(pt, t.geometry)) return true;
    }
    return false;
  };

  const segmentCrossings = (a: [number, number], b: [number, number]): number[] => {
    const minX = Math.min(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxX = Math.max(a[0], b[0]);
    const maxY = Math.max(a[1], b[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const ts: number[] = [];
    for (const t of targets) {
      const bb = t.bbox;
      if (bb[0] > maxX || bb[2] < minX || bb[1] > maxY || bb[3] < minY) continue;
      for (const ring of t.rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [px, py] = ring[i];
          const [qx, qy] = ring[j];
          const rxs = qx - px;
          const rys = qy - py;
          const denom = dx * rys - dy * rxs;
          if (denom === 0) continue;
          const tsParam = ((px - a[0]) * rys - (py - a[1]) * rxs) / denom;
          if (tsParam <= 1e-12 || tsParam >= 1 - 1e-12) continue;
          const us = ((px - a[0]) * dy - (py - a[1]) * dx) / denom;
          if (us <= 1e-12 || us >= 1 - 1e-12) continue;
          ts.push(tsParam);
        }
      }
    }
    ts.sort((p, q) => p - q);
    return ts;
  };

  const interp = (a: [number, number], b: [number, number], t: number): [number, number] =>
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  const out: Array<Array<[number, number]>> = [];
  for (const coords of runs) {
    if (!coords || coords.length < 2) continue;
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length >= minRun) out.push(run.slice());
      run = [];
    };
    let prev = coords[0];
    if (inRegion(prev)) run.push(prev.slice() as [number, number]);
    for (let i = 1; i < coords.length; i++) {
      const cur = coords[i];
      const aIn = inRegion(prev);
      const bIn = inRegion(cur);
      const cuts = segmentCrossings(prev, cur);
      if (aIn && bIn) {
        run.push(cur.slice() as [number, number]);
      } else if (aIn && !bIn) {
        if (cuts.length > 0) run.push(interp(prev, cur, cuts[0]));
        flush();
      } else if (!aIn && bIn) {
        flush();
        if (cuts.length > 0) run.push(interp(prev, cur, cuts[0]));
        run.push(cur.slice() as [number, number]);
      } else {
        // Both endpoints outside — keep any sub-span that dips through the region.
        for (let k = 0; k + 1 < cuts.length; k++) {
          if (!inRegion(interp(prev, cur, (cuts[k] + cuts[k + 1]) / 2))) continue;
          flush();
          run = [interp(prev, cur, cuts[k]), interp(prev, cur, cuts[k + 1])];
          flush();
        }
      }
      prev = cur;
    }
    flush();
  }
  return out;
}

/**
 * True when a parsed dataset's extent pokes outside the currently selected
 * region geometry. Used by the import flow to decide whether an upload needs
 * the clip-confirmation stage: fully-inside data imports immediately, larger
 * data must be reviewed and clipped first.
 */
export function geoJsonExceedsRegion(geojson: any, regionGeojson: any, tolDegs = 1e-4): boolean {
  const regions = regionGeojson?.features;
  if (!Array.isArray(regions) || regions.length === 0) return false;
  const dataBbox = bboxOfFeatureCollection(geojson);
  if (!dataBbox) return false;
  const regionBbox = bboxOfFeatureCollection(regionGeojson);
  if (!regionBbox) return false;
  return !bboxContainsBbox(regionBbox, dataBbox, tolDegs);
}

/**
 * True when a dataset bbox (already computed during parsing) pokes outside the
 * selected region geometry. Bbox is passed in because the worker computes it
 * once while decoding — recomputing it here would re-walk the whole dataset
 * tree on the main thread and freeze the UI on large imports.
 */
export function bboxExceedsRegion(
  dataBbox: [number, number, number, number] | null,
  regionGeojson: any,
  tolDegs = 1e-4
): boolean {
  const regions = regionGeojson?.features;
  if (!Array.isArray(regions) || regions.length === 0) return false;
  if (!dataBbox) return false;
  const regionBbox = bboxOfFeatureCollection(regionGeojson);
  if (!regionBbox) return false;
  return !bboxContainsBbox(regionBbox, dataBbox, tolDegs);
}

/**
 * Clips a parsed GIS FeatureCollection down to the selected region geometry
 * (union of district polygons):
 *  - LineString / MultiLineString features are trimmed to the actual district
 *    polygon boundaries with interpolated edge crossings (segments can split
 *    into several), so the result follows the district shape — not its bbox.
 *  - Points are kept only when they fall inside a region polygon.
 *  - Polygon / MultiPolygon features are kept when their bbox overlaps the
 *    region (cheap approximation; road data is almost always lines/points).
 * A brand-new FeatureCollection is returned — the input is never mutated.
 */
export function clipGeoJsonToRegions(geojson: any, regionGeojson: any): any {
  const regions = regionGeojson?.features;
  if (!Array.isArray(regions) || regions.length === 0) return geojson;
  const regionBbox = bboxOfFeatureCollection(regionGeojson);
  if (!regionBbox) return geojson;

  const insideRegion = (pt: [number, number]): boolean => {
    if (!pointInBbox(pt, regionBbox)) return false;
    for (const r of regions) {
      if (r?.geometry && isPointInPolygonGeometry(pt, r.geometry)) return true;
    }
    return false;
  };

  const features: any[] = [];
  for (const feat of geojson?.features ?? []) {
    const g = feat?.geometry;
    if (!g || !g.type) {
      features.push(feat);
      continue;
    }
    switch (g.type) {
      case 'LineString': {
        const runs = clipLineRunsToRegion([g.coordinates], regionGeojson, 2);
        runs.forEach((r) =>
          features.push({ ...feat, geometry: { type: 'LineString', coordinates: r } })
        );
        break;
      }
      case 'MultiLineString': {
        const runs = clipLineRunsToRegion(g.coordinates, regionGeojson, 2);
        runs.forEach((r) =>
          features.push({ ...feat, geometry: { type: 'LineString', coordinates: r } })
        );
        break;
      }
      case 'Point':
        if (insideRegion(g.coordinates)) features.push(feat);
        break;
      case 'MultiPoint': {
        const pts = (g.coordinates as any[]).filter((p: any) => insideRegion(p));
        if (pts.length > 0) {
          features.push({ ...feat, geometry: { type: 'MultiPoint', coordinates: pts } });
        }
        break;
      }
      case 'Polygon':
      case 'MultiPolygon': {
        const gBbox = bboxOfFeatureCollection({
          type: 'FeatureCollection',
          features: [{ geometry: g }]
        });
        if (gBbox && bboxesOverlap(gBbox, regionBbox)) features.push(feat);
        break;
      }
      default:
        features.push(feat);
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Default tolerance for stitching nearby plan-run endpoints into one node.
 * OSM ways are routinely split at junctions / admin borders and the shared
 * node ends up a few metres apart, or a bbox clip truncates each side at a
 * different vertex. Kept below the trace tolerance (25 m) so stitching the
 * endpoints cannot hide a genuine gap.
 */
export const PLAN_ENDPOINT_SNAP_M = 25;

/**
 * Tolerance for the second pass (dangling endpoint → nearest road segment).
 * In OSM, dual carriageways with medians, suburban cul-de-sacs, and link roads
 * routinely leave 25–40 m gaps between the side road endpoint and the main
 * road centerline. A 40 m tolerance reliably closes these gaps.
 */
export const PLAN_TJUNCTION_SNAP_M = 40;

/**
 * Maximum repair iterations for the final topology runner. Each iteration can
 * expose new dangling endpoints (a snap inserts a junction vertex, a bridge
 * merges two runs), so the stitch/bridge passes repeat until nothing changes.
 */
export const PLAN_REPAIR_MAX_PASSES = 3;

/**
 * Maximum straight-line gap that the collinear bridge pass will close by
 * merging the two facing runs into one. OSM occasionally drops a whole chunk
 * of a way (bridge / tunnel / access restriction), leaving two collinear dead
 * ends tens of metres apart; endpoint snapping cannot reach those.
 */
export const PLAN_BRIDGE_M = 100;

/** Heading alignment (cos of max deviation) required to bridge a gap. */
const PLAN_BRIDGE_COS = Math.cos((25 * Math.PI) / 180);

/** Endpoint identifier carried through the plan pipeline (OSM node ref, GIS
 *  feature node field, or a compact-plan-assigned id). */
export type PlanEndpointId = string | number | null | undefined;

/** Start/end endpoint identifiers for one road run. */
export interface PlanRunEndpointIds {
  start?: PlanEndpointId;
  end?: PlanEndpointId;
}

/**
 * Joins runs that share an endpoint node id into single continuous runs.
 * Two ways meeting at the same node are the same street split by editors, and
 * joining by node identity is exact — no coordinate tolerance involved. Nodes
 * used by more than one pair of ends (junctions, degree >= 3) are left alone;
 * their runs already share the exact junction coordinate. Endpoint ids left
 * dangling after a join (e.g. a boundary-clip insertion vertex) are dropped.
 *
 * Returns the merged runs plus the recomputed endpoint ids aligned with the
 * output. Does not mutate the input arrays.
 */
export function mergeRunsByIdentity(
  runs: Array<Array<[number, number]>>,
  endpointIds?: Array<PlanRunEndpointIds>
): { runs: Array<Array<[number, number]>>; endpointIds: Array<PlanRunEndpointIds> } {
  const clean = (runs || []).filter((r) => Array.isArray(r) && r.length >= 2);
  if (clean.length === 0) return { runs: [], endpointIds: [] };
  const cleanIds: Array<PlanRunEndpointIds> = [];
  (runs || []).forEach((r, ri) => {
    if (!Array.isArray(r) || r.length < 2) return;
    cleanIds.push(endpointIds?.[ri] ? { ...endpointIds[ri] } : {});
  });
  if (!cleanIds.some((ids) => ids.start != null || ids.end != null)) {
    return { runs: clean.map((r) => r.slice()), endpointIds: cleanIds.map((ids) => ({ ...ids })) };
  }

  const nodeKeyOf = (id: PlanEndpointId): string => (id == null ? '' : String(id));
  const atNode = new Map<string, Array<{ li: number; end: 0 | 1 }>>();
  clean.forEach((_, li) => {
    ([0, 1] as const).forEach((end) => {
      const id = end === 0 ? cleanIds[li].start : cleanIds[li].end;
      if (id == null || id === '') return;
      const key = nodeKeyOf(id);
      const list = atNode.get(key);
      if (list) list.push({ li, end });
      else atNode.set(key, [{ li, end }]);
    });
  });

  // node -> the two (run, end) halves it joins; only degree-2 nodes link.
  const partner = new Map<string, { li: number; end: 0 | 1 }>();
  const parent = clean.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  atNode.forEach((list) => {
    if (list.length !== 2 || list[0].li === list[1].li) return;
    partner.set(`${list[0].li}|${list[0].end}`, { li: list[1].li, end: list[1].end });
    partner.set(`${list[1].li}|${list[1].end}`, { li: list[0].li, end: list[0].end });
    const a = find(list[0].li);
    const b = find(list[1].li);
    if (a !== b) parent[a] = b;
  });

  const groups = new Map<number, number[]>();
  clean.forEach((_, li) => {
    const root = find(li);
    const g = groups.get(root);
    if (g) g.push(li);
    else groups.set(root, [li]);
  });

  const outRuns: Array<Array<[number, number]>> = [];
  const outIds: Array<PlanRunEndpointIds> = [];
  groups.forEach((members) => {
    if (members.length === 1) {
      const li = members[0];
      outRuns.push(clean[li].slice());
      outIds.push({ start: cleanIds[li].start, end: cleanIds[li].end });
      return;
    }

    let startLi = members[0];
    let startEnd: 0 | 1 = 0;
    let cyclic = true;
    for (const li of members) {
      let open: 0 | 1 | -1 = -1;
      if (!partner.has(`${li}|0`)) open = 0;
      else if (!partner.has(`${li}|1`)) open = 1;
      if (open !== -1) {
        startLi = li;
        startEnd = open;
        cyclic = false;
        break;
      }
    }

    const coords: Array<[number, number]> = [];
    const used = new Set<number>();
    let cur = startLi;
    let enterEnd: 0 | 1 = startEnd;
    let finalRun = startLi;
    let finalEnd: 0 | 1 = startEnd;
    while (!used.has(cur)) {
      used.add(cur);
      const seq = enterEnd === 0 ? clean[cur] : clean[cur].slice().reverse();
      if (coords.length === 0) {
        coords.push(...seq);
      } else {
        const tail = coords[coords.length - 1];
        if (tail[0] !== seq[0][0] || tail[1] !== seq[0][1]) coords.push(seq[0]);
        for (let i = 1; i < seq.length; i++) coords.push(seq[i]);
      }
      const exitEnd: 0 | 1 = enterEnd === 0 ? 1 : 0;
      finalRun = cur;
      finalEnd = exitEnd;
      const nx = partner.get(`${cur}|${exitEnd}`);
      if (!nx) break;
      cur = nx.li;
      enterEnd = nx.end;
    }
    if (cyclic && coords.length > 1) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
    }
    if (coords.length >= 2) {
      outRuns.push(coords);
      outIds.push({
        start: startEnd === 0 ? cleanIds[startLi].start : cleanIds[startLi].end,
        end: finalEnd === 0 ? cleanIds[finalRun].start : cleanIds[finalRun].end
      });
    }
  });
  return { runs: outRuns, endpointIds: outIds };
}

/**
 * Splits road runs at any internal vertices that are shared with other road
 * endpoints or junctions. This planarizes the road network into true graph
 * edges where every junction connects to the ends of its intersecting roads.
 */
export function splitRunsAtJunctions(
  runs: Array<Array<[number, number]>>
): Array<Array<[number, number]>> {
  if (!runs || runs.length === 0) return [];
  const vCount = new Map<string, number>();
  const coordKey = (p: [number, number]) => `${p[0].toFixed(5)}|${p[1].toFixed(5)}`;

  runs.forEach((r) => {
    r.forEach((p) => {
      const k = coordKey(p);
      vCount.set(k, (vCount.get(k) || 0) + 1);
    });
  });

  const out: Array<Array<[number, number]>> = [];
  runs.forEach((r) => {
    if (!r || r.length < 2) return;
    let current: Array<[number, number]> = [r[0]];
    for (let i = 1; i < r.length - 1; i++) {
      const p = r[i];
      const prev = current[current.length - 1];
      if (Math.abs(p[0] - prev[0]) > 1e-7 || Math.abs(p[1] - prev[1]) > 1e-7) {
        current.push(p);
      }
      const k = coordKey(p);
      if ((vCount.get(k) || 0) > 1) {
        if (current.length >= 2) out.push(current);
        current = [p];
      }
    }
    const last = r[r.length - 1];
    const prev = current[current.length - 1];
    if (Math.abs(last[0] - prev[0]) > 1e-7 || Math.abs(last[1] - prev[1]) > 1e-7) {
      current.push(last);
    }
    if (current.length >= 2) out.push(current);
  });
  return out;
}

/**
 * Stitches road-plan runs into a connected topology by unifying endpoints that
 * fall within `endpointTolM` of each other, then projecting any endpoint left
 * dangling within `junctionTolM` onto the nearest road segment. When `planarize`
 * is true (default), runs are also split at shared junctions so every junction
 * renders as a real shared node in the topological graph.
 *
 * When `endpointIds` is supplied, runs that share a start/end node id are joined
 * first (exact, identity-based topology — see `mergeRunsByIdentity`); the
 * geometric passes then only handle genuine gaps and boundary cuts.
 */
export function connectRunsByEndpoints(
  runs: Array<Array<[number, number]>>,
  endpointTolM: number = PLAN_ENDPOINT_SNAP_M,
  junctionTolM: number = PLAN_TJUNCTION_SNAP_M,
  planarize: boolean = false,
  endpointIds?: Array<PlanRunEndpointIds>
): Array<Array<[number, number]>> {
  const cleaned: Array<Array<[number, number]>> = [];
  const cleanedIds: Array<PlanRunEndpointIds> = [];
  (runs || []).forEach((r, ri) => {
    if (!Array.isArray(r) || r.length < 2) return;
    cleaned.push(r.map((c) => [c[0], c[1]] as [number, number]));
    cleanedIds.push(endpointIds?.[ri] ?? {});
  });
  let out = cleaned;
  if (cleanedIds.some((ids) => ids.start != null || ids.end != null)) {
    out = mergeRunsByIdentity(out, cleanedIds).runs;
  }
  if (out.length === 0 || !(endpointTolM > 0)) return out;

  // ── Step 1: Pairwise, angle-aware endpoint connection (no blind transitive collapse) ──
  interface EndpointInfo {
    runIdx: number;
    isStart: boolean;
    pt: [number, number];
    outVec: [number, number]; // outward unit vector in metric space
    runLengthM: number;
  }

  const endpoints: EndpointInfo[] = [];
  out.forEach((run, ri) => {
    const latRef = (run[0][1] + run[run.length - 1][1]) / 2;
    const kx = 111320 * Math.cos((latRef * Math.PI) / 180);
    const ky = 110574;
    const lenM = pathLengthLngLatKm(run) * 1000;

    // Start endpoint (outward vector points away from run[1] through run[0])
    const s0 = run[0];
    const s1 = run[1];
    const sDx = (s0[0] - s1[0]) * kx;
    const sDy = (s0[1] - s1[1]) * ky;
    const sMag = Math.hypot(sDx, sDy) || 1;
    endpoints.push({
      runIdx: ri,
      isStart: true,
      pt: s0,
      outVec: [sDx / sMag, sDy / sMag],
      runLengthM: lenM
    });

    // End endpoint (outward vector points away from run[last-1] through run[last])
    const eLast = run[run.length - 1];
    const ePrev = run[run.length - 2];
    const eDx = (eLast[0] - ePrev[0]) * kx;
    const eDy = (eLast[1] - ePrev[1]) * ky;
    const eMag = Math.hypot(eDx, eDy) || 1;
    endpoints.push({
      runIdx: ri,
      isStart: false,
      pt: eLast,
      outVec: [eDx / eMag, eDy / eMag],
      runLengthM: lenM
    });
  });

  interface CandidatePair {
    i: number;
    j: number;
    distM: number;
  }
  const candidates: CandidatePair[] = [];

  const cellDeg = Math.max(endpointTolM / 111000, 1e-5);
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cellDeg)}|${Math.floor(y / cellDeg)}`;
  endpoints.forEach((ep, i) => {
    const key = keyOf(ep.pt[0], ep.pt[1]);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  });

  for (let i = 0; i < endpoints.length; i++) {
    const a = endpoints[i];
    const gx = Math.floor(a.pt[0] / cellDeg);
    const gy = Math.floor(a.pt[1] / cellDeg);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx}|${gy + dy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = endpoints[j];
          if (a.runIdx === b.runIdx) continue;
          const d = calculateGeodesicDistanceMeters(a.pt[1], a.pt[0], b.pt[1], b.pt[0]);
          if (d <= endpointTolM) {
            candidates.push({ i, j, distM: d });
          }
        }
      }
    }
  }

  // Sort candidate pairs closest first
  candidates.sort((c1, c2) => c1.distM - c2.distM);

  const snappedEndpoints = new Set<number>();
  candidates.forEach(({ i, j }) => {
    if (snappedEndpoints.has(i) || snappedEndpoints.has(j)) return;
    const a = endpoints[i];
    const b = endpoints[j];

    // Angle check: prevent collapsing parallel roads / lanes
    const dot = a.outVec[0] * b.outVec[0] + a.outVec[1] * b.outVec[1];
    if (dot > 0.75) {
      // Both roads are pointing in almost the same direction (e.g. parallel cul-de-sacs or lanes)
      const latRef = (a.pt[1] + b.pt[1]) / 2;
      const kx = 111320 * Math.cos((latRef * Math.PI) / 180);
      const ky = 110574;
      const dispX = (b.pt[0] - a.pt[0]) * kx;
      const dispY = (b.pt[1] - a.pt[1]) * ky;
      const dispMag = Math.hypot(dispX, dispY) || 1;
      const dispDot = Math.abs(a.outVec[0] * (dispX / dispMag) + a.outVec[1] * (dispY / dispMag));
      if (dispDot < 0.6) {
        // Displacement is perpendicular to road heading: side-by-side parallel roads
        return;
      }
    }

    // Short-run guard: do not collapse short runs (< 25m) to zero length
    if (a.runLengthM < 25 && a.runIdx === b.runIdx) return;

    // Anchor snap to longer through-road, or midpoint if similar
    let targetPt: [number, number];
    if (a.runLengthM > 2.2 * b.runLengthM) {
      targetPt = [a.pt[0], a.pt[1]];
    } else if (b.runLengthM > 2.2 * a.runLengthM) {
      targetPt = [b.pt[0], b.pt[1]];
    } else {
      targetPt = [(a.pt[0] + b.pt[0]) / 2, (a.pt[1] + b.pt[1]) / 2];
    }

    const runA = out[a.runIdx];
    runA[a.isStart ? 0 : runA.length - 1] = [targetPt[0], targetPt[1]];
    const runB = out[b.runIdx];
    runB[b.isStart ? 0 : runB.length - 1] = [targetPt[0], targetPt[1]];

    snappedEndpoints.add(i);
    snappedEndpoints.add(j);
  });

  for (let pass = 0; pass < PLAN_REPAIR_MAX_PASSES; pass++) {
    const snaps = stitchEndpointsOntoRuns(out, junctionTolM);
    const merges = bridgeCollinearGaps(out, PLAN_BRIDGE_M);
    if (snaps === 0 && merges === 0) break;
  }
  const merged = out.filter((r) => r && r.length >= 2);
  return planarize ? splitRunsAtJunctions(merged) : merged;
}

/** Outward unit heading (metres space) at one end of a run. */
function endpointHeadingMeters(
  run: Array<[number, number]>,
  isStart: boolean
): [number, number] | null {
  if (!run || run.length < 2) return null;
  const a = isStart ? run[0] : run[run.length - 1];
  const b = isStart ? run[1] : run[run.length - 2];
  const latRef = (a[1] + b[1]) / 2;
  const kx = 111320 * Math.cos((latRef * Math.PI) / 180);
  const ky = 110574;
  const vx = (a[0] - b[0]) * kx;
  const vy = (a[1] - b[1]) * ky;
  const m = Math.hypot(vx, vy);
  if (m < 1e-9) return null;
  return [vx / m, vy / m];
}

/**
 * Third stitching pass: closes long collinear gaps. When two dangling dead
 * ends face each other along (almost) the same heading — the signature of one
 * road whose middle chunk is missing from OSM — the two runs are merged into a
 * single run so the drawn network is continuous across the gap. Endpoints that
 * already coincide with another run (real junctions) are left alone.
 */
function bridgeCollinearGaps(out: Array<Array<[number, number]>>, maxGapM: number): number {
  if (!(maxGapM > 0)) return 0;
  const COINCIDENT_M = 0.5;
  interface End {
    run: number;
    isStart: boolean;
    pt: [number, number];
    head: [number, number] | null;
  }
  const ends: End[] = [];
  out.forEach((run, ri) => {
    if (!run || run.length < 2) return;
    ends.push({ run: ri, isStart: true, pt: run[0], head: endpointHeadingMeters(run, true) });
    ends.push({
      run: ri,
      isStart: false,
      pt: run[run.length - 1],
      head: endpointHeadingMeters(run, false)
    });
  });
  if (ends.length < 2) return 0;

  const cellDeg = Math.max(maxGapM / 111000, 1e-5);
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cellDeg)}|${Math.floor(y / cellDeg)}`;
  ends.forEach((e, i) => {
    const key = keyOf(e.pt[0], e.pt[1]);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  });
  const neighborsOf = (i: number): number[] => {
    const gx = Math.floor(ends[i].pt[0] / cellDeg);
    const gy = Math.floor(ends[i].pt[1] / cellDeg);
    const found: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx}|${gy + dy}`);
        if (bucket) found.push(...bucket);
      }
    }
    return found;
  };

  const isShared = ends.map((e, i) =>
    neighborsOf(i).some((j) => {
      if (j === i || ends[j].run === e.run) return false;
      const o = ends[j];
      return calculateGeodesicDistanceMeters(e.pt[1], e.pt[0], o.pt[1], o.pt[0]) <= COINCIDENT_M;
    })
  );

  const pairs: Array<{ i: number; j: number; d: number }> = [];
  for (let i = 0; i < ends.length; i++) {
    if (isShared[i] || !ends[i].head) continue;
    for (const j of neighborsOf(i)) {
      if (j <= i || isShared[j] || !ends[j].head) continue;
      if (ends[i].run === ends[j].run) continue;
      const d = calculateGeodesicDistanceMeters(
        ends[i].pt[1],
        ends[i].pt[0],
        ends[j].pt[1],
        ends[j].pt[0]
      );
      if (d > COINCIDENT_M && d <= maxGapM) pairs.push({ i, j, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d);

  const consumed = new Set<number>();
  const used = new Set<number>();
  let merges = 0;
  for (const { i, j } of pairs) {
    if (used.has(i) || used.has(j)) continue;
    const a = ends[i];
    const b = ends[j];
    if (consumed.has(a.run) || consumed.has(b.run)) continue;
    const latRef = (a.pt[1] + b.pt[1]) / 2;
    const kx = 111320 * Math.cos((latRef * Math.PI) / 180);
    const ky = 110574;
    const gx = (b.pt[0] - a.pt[0]) * kx;
    const gy = (b.pt[1] - a.pt[1]) * ky;
    const gm = Math.hypot(gx, gy);
    if (gm < 1e-9) continue;
    const ux = gx / gm;
    const uy = gy / gm;
    const dotA = (a.head as [number, number])[0] * ux + (a.head as [number, number])[1] * uy;
    const dotB = (b.head as [number, number])[0] * ux + (b.head as [number, number])[1] * uy;
    if (dotA < PLAN_BRIDGE_COS || dotB > -PLAN_BRIDGE_COS) continue;

    const runA = a.isStart ? out[a.run].slice().reverse() : out[a.run].slice();
    const runB = b.isStart ? out[b.run].slice() : out[b.run].slice().reverse();
    out[a.run] = runA.concat(runB);
    out[b.run] = [];
    consumed.add(b.run);
    used.add(i);
    used.add(j);
    merges++;
  }
  return merges;
}

/**
 * Second stitching pass: OSM disconnects are most often T-junctions, where a
 * side road stops `x` metres short of the road it meets. We check:
 * 1. Heading ray extension: Does extending the stub along its heading vector
 *    intersect the target segment within `toleranceM` (up to 45m)?
 * 2. Orthogonal projection: As fallback, nearest point on segment within tolerance.
 * Splicing reconstructs the run cleanly to avoid any vertex index shift bugs.
 */
function stitchEndpointsOntoRuns(out: Array<Array<[number, number]>>, toleranceM: number): number {
  const cellDeg = Math.max(toleranceM / 111000, 1e-5);
  const segGrid = new Map<string, Array<{ run: number; seg: number }>>();
  let snaps = 0;

  out.forEach((run, runIdx) => {
    for (let seg = 0; seg < run.length - 1; seg++) {
      const a = run[seg];
      const b = run[seg + 1];
      const minX = Math.min(a[0], b[0]);
      const maxX = Math.max(a[0], b[0]);
      const minY = Math.min(a[1], b[1]);
      const maxY = Math.max(a[1], b[1]);
      for (let gx = Math.floor(minX / cellDeg); gx <= Math.floor(maxX / cellDeg); gx++) {
        for (let gy = Math.floor(minY / cellDeg); gy <= Math.floor(maxY / cellDeg); gy++) {
          const key = `${gx}|${gy}`;
          const bucket = segGrid.get(key);
          if (bucket) bucket.push({ run: runIdx, seg });
          else segGrid.set(key, [{ run: runIdx, seg }]);
        }
      }
    }
  });

  interface Insertion {
    pt: [number, number];
    t: number;
  }
  // Key: `${runIdx}|${segIdx}` -> list of insertions along that segment
  const insertsBySeg = new Map<string, Insertion[]>();

  for (let ri = 0; ri < out.length; ri++) {
    const run = out[ri];
    if (run.length < 2) continue;
    const ends: Array<{ isStart: boolean; p: [number, number]; pNeighbor: [number, number] }> = [
      { isStart: true, p: run[0], pNeighbor: run[1] },
      { isStart: false, p: run[run.length - 1], pNeighbor: run[run.length - 2] }
    ];

    for (const { isStart, p, pNeighbor } of ends) {
      const latRef = p[1];
      const kx = 111320 * Math.cos((latRef * Math.PI) / 180);
      const ky = 110574;

      // Outward vector along stub heading
      const vx = (p[0] - pNeighbor[0]) * kx;
      const vy = (p[1] - pNeighbor[1]) * ky;
      const vMag = Math.hypot(vx, vy) || 1;
      const vNorm: [number, number] = [vx / vMag, vy / vMag];

      const gx = Math.floor(p[0] / cellDeg);
      const gy = Math.floor(p[1] / cellDeg);
      let bestDist = toleranceM;
      let bestRun = -1;
      let bestSeg = -1;
      let bestPt: [number, number] | null = null;
      let bestT = 0;
      let bestIsRay = false;
      const seen = new Set<string>();

      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const bucket = segGrid.get(`${gx + dx}|${gy + dy}`);
          if (!bucket) continue;
          for (const cand of bucket) {
            if (cand.run === ri) continue;
            const sig = `${cand.run}|${cand.seg}`;
            if (seen.has(sig)) continue;
            seen.add(sig);

            const a = out[cand.run][cand.seg];
            const b = out[cand.run][cand.seg + 1];

            // 1. Heading ray extension test:
            // Ray R(lambda) = p + lambda * vNorm
            // Segment S(mu) = a + mu * (b - a)
            const ax = a[0] * kx;
            const ay = a[1] * ky;
            const bx = b[0] * kx;
            const by = b[1] * ky;
            const px = p[0] * kx;
            const py = p[1] * ky;
            const dSegX = bx - ax;
            const dSegY = by - ay;
            const deltaX = ax - px;
            const deltaY = ay - py;

            const det = vNorm[1] * dSegX - vNorm[0] * dSegY;
            if (Math.abs(det) > 1e-6) {
              const lambda = (deltaY * dSegX - deltaX * dSegY) / det;
              const mu = (vNorm[0] * deltaY - vNorm[1] * deltaX) / det;
              if (lambda >= 0 && lambda <= toleranceM && mu >= 0 && mu <= 1) {
                // Ray directly hits segment! Prefer ray extension over orthogonal projection
                if (!bestIsRay || lambda < bestDist) {
                  bestDist = lambda;
                  bestRun = cand.run;
                  bestSeg = cand.seg;
                  bestPt = [a[0] + mu * (b[0] - a[0]), a[1] + mu * (b[1] - a[1])];
                  bestT = mu;
                  bestIsRay = true;
                  continue;
                }
              }
            }

            // 2. Orthogonal projection fallback (only if no ray hit yet)
            // Only allow if the road is approaching the target segment, or is a short lay-by (< 80m)
            if (!bestIsRay) {
              const proj = nearestPointOnSegmentMeters(p, a, b);
              const projPrev = nearestPointOnSegmentMeters(pNeighbor, a, b);
              const isShortLayBy = run.length <= 3 && Math.hypot(vx, vy) < 80;
              const segMag = Math.hypot(dSegX, dSegY) || 1;
              const ox = (run[run.length - 1][0] - run[0][0]) * kx;
              const oy = (run[run.length - 1][1] - run[0][1]) * ky;
              const oMag = Math.hypot(ox, oy) || 1;
              const parallelTarget =
                Math.abs((dSegX / segMag) * (ox / oMag) + (dSegY / segMag) * (oy / oMag)) >= 0.7;
              const isApproaching =
                isShortLayBy || proj.distM < projPrev.distM - 0.5 || !parallelTarget;
              if (isApproaching && proj.distM < bestDist) {
                bestDist = proj.distM;
                bestRun = cand.run;
                bestSeg = cand.seg;
                bestPt = proj.pt;
                bestT = proj.t;
              }
            }
          }
        }
      }

      if (bestRun >= 0 && bestPt && bestDist > 0.05) {
        // Snap endpoint onto bestPt
        const at = isStart ? 0 : run.length - 1;
        run[at] = [bestPt[0], bestPt[1]];
        snaps++;

        // If landing on existing segment vertex (t <= 1e-4 or t >= 1 - 1e-4), unify directly
        if (bestT <= 1e-4) {
          out[bestRun][bestSeg] = [bestPt[0], bestPt[1]];
        } else if (bestT >= 1 - 1e-4) {
          out[bestRun][bestSeg + 1] = [bestPt[0], bestPt[1]];
        } else {
          // Register internal insertion
          const key = `${bestRun}|${bestSeg}`;
          const list = insertsBySeg.get(key) || [];
          list.push({ pt: bestPt, t: bestT });
          insertsBySeg.set(key, list);
        }
      }
    }
  }

  // Cleanly rebuild target runs with sorted insertions (immune to index shift bugs)
  for (let ri = 0; ri < out.length; ri++) {
    const run = out[ri];
    let hasInserts = false;
    for (let seg = 0; seg < run.length - 1; seg++) {
      if (insertsBySeg.has(`${ri}|${seg}`)) {
        hasInserts = true;
        break;
      }
    }
    if (!hasInserts) continue;

    const rebuilt: Array<[number, number]> = [run[0]];
    for (let seg = 0; seg < run.length - 1; seg++) {
      const list = insertsBySeg.get(`${ri}|${seg}`);
      if (list && list.length > 0) {
        list.sort((insA, insB) => insA.t - insB.t);
        list.forEach((ins) => {
          const last = rebuilt[rebuilt.length - 1];
          if (Math.abs(ins.pt[0] - last[0]) > 1e-7 || Math.abs(ins.pt[1] - last[1]) > 1e-7) {
            rebuilt.push([ins.pt[0], ins.pt[1]]);
          }
        });
      }
      const nextV = run[seg + 1];
      const last = rebuilt[rebuilt.length - 1];
      if (Math.abs(nextV[0] - last[0]) > 1e-7 || Math.abs(nextV[1] - last[1]) > 1e-7) {
        rebuilt.push(nextV);
      }
    }
    out[ri] = rebuilt;
  }
  return snaps;
}

/** Distance (m) from `p` to segment `a→b` plus the closest point and ratio. */
function nearestPointOnSegmentMeters(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): { pt: [number, number]; distM: number; t: number } {
  const latRef = (a[1] + b[1] + p[1]) / 3;
  const kx = 111320 * Math.cos((latRef * Math.PI) / 180);
  const ky = 110574;
  const ax = a[0] * kx;
  const ay = a[1] * ky;
  const bx = b[0] * kx;
  const by = b[1] * ky;
  const px = p[0] * kx;
  const py = p[1] * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const rawT = ((px - ax) * dx + (py - ay) * dy) / (len2 || 1);
  const t = rawT < 0 ? 0 : rawT > 1 ? 1 : rawT;
  if (t <= 0) return { pt: [a[0], a[1]], distM: Math.hypot(px - ax, py - ay), t: 0 };
  if (t >= 1) return { pt: [b[0], b[1]], distM: Math.hypot(px - bx, py - by), t: 1 };
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { pt: [cx / kx, cy / ky], distM: Math.hypot(px - cx, py - cy), t };
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

