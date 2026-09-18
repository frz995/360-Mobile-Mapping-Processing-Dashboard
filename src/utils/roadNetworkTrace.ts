/**
 * Road Network Trace utilities.
 *
 * Builds a per-subgrid trace plan (chronologically-ordered survey chain from
 * dailyData runs) and evaluates plan coverage: captured panotracks are matched
 * against the active road plan (OSM extraction or user GIS plan lines clipped
 * to the subgrid's 5x5 km cell). Uncovered plan stretches are returned as
 * "gap runs" so the map can draw them as red lines along the ACTUAL plan road
 * geometry when a subgrid trace is incomplete.
 */

import { calculateGeodesicDistanceMeters, pathLengthLngLatKm } from './geo';
import { extractSubgridName } from './subgrid';
import {
  clipLineRunsToBbox,
  connectRunsByEndpoints,
  getSubgridBbox,
  subgridLinesLengthKm,
  PLAN_ENDPOINT_SNAP_M,
  PLAN_TJUNCTION_SNAP_M
} from './subgridComparison';

export type LonLat = [number, number];

export interface TraceSurvey {
  runId: string;
  subgrid: string;
  date: string;
  coords: LonLat[];
  lengthKm: number;
}

export interface SubgridTracePlan {
  subgrid: string;
  bbox: [number, number, number, number];
  surveys: TraceSurvey[];
  planRuns: LonLat[][];
  planKm: number;
  capturedKm: number;
  totalTraceM: number;
}

export interface PlanCoverage {
  planKm: number;
  coveredKm: number;
  coveredPct: number;
  uncoveredRuns: LonLat[][];
}

export type SubgridTraceStatus = 'complete' | 'incomplete' | 'no-plan';

export interface SubgridTraceResult {
  subgrid: string;
  bbox: [number, number, number, number];
  status: SubgridTraceStatus;
  surveyCount: number;
  capturedKm: number;
  planKm: number;
  coveredKm: number;
  coveredPct: number | null;
  gapKm: number;
  uncoveredRuns: LonLat[][];
}

/** A survey endpoint jump larger than this is rendered as a dashed connector. */
export const CONNECTOR_MIN_GAP_M = 15;

const GRID_RE = /^N(\d+)E(\d+)$/i;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function distM(a: LonLat, b: LonLat): number {
  return calculateGeodesicDistanceMeters(a[1], a[0], b[1], b[0]);
}

/**
 * Sort comparator for subgrid walk order: north-to-south (descending N row),
 * west-to-east (ascending E column). Non grid names sort after grid names.
 */
export function compareSubgridGridNames(a: string, b: string): number {
  const ma = a.match(GRID_RE);
  const mb = b.match(GRID_RE);
  if (ma && mb) {
    const rowDiff = Number(mb[1]) - Number(ma[1]);
    if (rowDiff !== 0) return rowDiff;
    const colDiff = Number(ma[2]) - Number(mb[2]);
    if (colDiff !== 0) return colDiff;
    return a.localeCompare(b);
  }
  if (ma && !mb) return -1;
  if (!ma && mb) return 1;
  return a.localeCompare(b);
}

/**
 * Extracts the sequential [lng, lat] trajectory of one dailyData survey run
 * (same panorama/point field fallbacks as the panotrack extractor).
 */
export function surveyCoordsFromRun(run: any): LonLat[] {
  const arr: any[] =
    Array.isArray(run?.panoramas) && run.panoramas.length > 0
      ? run.panoramas
      : Array.isArray(run?.points)
        ? run.points
        : [];
  const coords: LonLat[] = [];
  arr.forEach((p: any) => {
    const lng = parseNum(p.longitude ?? p.lon ?? p.lng);
    const lat = parseNum(p.latitude ?? p.lat);
    if (lng === null || lat === null || (lng === 0 && lat === 0)) return;
    coords.push([lng, lat]);
  });
  return coords;
}

function dateRankMs(date?: string): number {
  if (!date) return Number.MAX_SAFE_INTEGER;
  const t = Date.parse(date);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

export interface BuildTracePlansOptions {
  catalogLayers?: any[];
  /** Active plan line runs (extracted OSM or manual/GIS layer), unclipped. */
  planRuns?: LonLat[][];
  /** When provided, only subgrids present in this set are traced. */
  subgridFilter?: Set<string>;
}

/**
 * Groups dailyData surveys into per-subgrid trace plans:
 * - surveys ordered chronologically (ties keep original run order),
 * - subgrids ordered N→S / W→E so the animation walks the grid,
 * - plan runs clipped to each subgrid's 5x5 km bbox.
 */
export function buildTracePlans(
  dailyData: any[],
  options: BuildTracePlansOptions = {}
): SubgridTracePlan[] {
  const { catalogLayers = [], planRuns = [], subgridFilter } = options;

  const bySubgrid = new Map<string, TraceSurvey[]>();
  (dailyData || []).forEach((d: any, idx: number) => {
    const sg = extractSubgridName(d?.subgrid);
    if (!sg) return;
    if (subgridFilter && !subgridFilter.has(sg)) return;
    const coords = surveyCoordsFromRun(d);
    if (coords.length < 2) return;
    const list = bySubgrid.get(sg) || [];
    list.push({
      runId: d?.id || `run-${idx}`,
      subgrid: sg,
      date: d?.date || '',
      coords,
      lengthKm: pathLengthLngLatKm(coords)
    });
    bySubgrid.set(sg, list);
  });

  const plans: SubgridTracePlan[] = [];
  Array.from(bySubgrid.entries())
    .sort((a, b) => compareSubgridGridNames(a[0], b[0]))
    .forEach(([sg, surveys]) => {
      const pts = surveys.flatMap((s) => s.coords.map((c) => ({ lng: c[0], lat: c[1] })));
      const bbox = getSubgridBbox(sg, pts, catalogLayers);
      const clipped = bbox.some((v) => v !== 0) ? clipLineRunsToBbox(planRuns, bbox) : [];
      // Clipping can cut a run at the cell edge and strand short stubs; stitch
      // the in-cell fragments back into a connected network before walking.
      const stitched =
        clipped.length > 1
          ? connectRunsByEndpoints(clipped, PLAN_ENDPOINT_SNAP_M, PLAN_TJUNCTION_SNAP_M, true)
          : clipped;
      // Stable chronological chain: parseable dates first, then original order.
      const ordered = surveys
        .map((s, i) => ({ s, i }))
        .sort((a, b) => {
          const da = dateRankMs(a.s.date);
          const db = dateRankMs(b.s.date);
          if (da !== db) return da - db;
          return a.i - b.i;
        })
        .map((x) => x.s);

      plans.push({
        subgrid: sg,
        bbox,
        surveys: ordered,
        planRuns: stitched,
        planKm: subgridLinesLengthKm(stitched),
        capturedKm: ordered.reduce((sum, s) => sum + s.lengthKm, 0),
        totalTraceM: ordered.reduce((sum, s) => sum + polylineTotalM(s.coords), 0)
      });
    });

  return plans;
}

/**
 * Connector line between two consecutive chained surveys, or null when the
 * endpoints are already effectively adjacent.
 */
export function chainConnector(prev: TraceSurvey, next: TraceSurvey): LonLat[] | null {
  if (!prev?.coords?.length || !next?.coords?.length) return null;
  const a = prev.coords[prev.coords.length - 1];
  const b = next.coords[0];
  return distM(a, b) > CONNECTOR_MIN_GAP_M ? [a, b] : null;
}

// ─────────────────────────────── polyline math ───────────────────────────────

export function polylineCumulativeM(coords: LonLat[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + distM(coords[i - 1], coords[i]));
  }
  return cum;
}

export function polylineTotalM(coords: LonLat[]): number {
  const cum = polylineCumulativeM(coords);
  return cum[cum.length - 1] || 0;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Interpolated coordinate at `distMeters` along the polyline. */
export function polylineInterpolateAt(coords: LonLat[], distMeters: number): LonLat | null {
  if (!coords || coords.length === 0) return null;
  if (coords.length === 1) return coords[0].slice() as LonLat;
  const cum = polylineCumulativeM(coords);
  const target = clamp(distMeters, 0, cum[cum.length - 1]);
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= target) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
      const [lng1, lat1] = coords[i - 1];
      const [lng2, lat2] = coords[i];
      return [lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t] as LonLat;
    }
  }
  return coords[coords.length - 1].slice() as LonLat;
}

/**
 * Prefix of the polyline covering `fraction` (0..1) of its total length —
 * used to render each animation frame of a growing trace line.
 */
export function polylineSliceByFraction(coords: LonLat[], fraction: number): LonLat[] {
  if (!coords || coords.length < 2) return coords ? coords.slice() : [];
  const f = clamp(fraction, 0, 1);
  if (f >= 1) return coords.map((c) => c.slice() as LonLat);
  if (f <= 0) return [];
  const cum = polylineCumulativeM(coords);
  const target = cum[cum.length - 1] * f;
  const out: LonLat[] = [];
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] <= target) {
      out.push(coords[i].slice() as LonLat);
    } else {
      break;
    }
  }
  const head = polylineInterpolateAt(coords, target);
  if (head) {
    if (out.length === 0) out.push(coords[0].slice() as LonLat);
    out.push(head);
  }
  return out;
}

/** Vertices plus inserted intermediates so no consecutive gap exceeds `maxStepM`. */
export function densifyRun(coords: LonLat[], maxStepM = 10): LonLat[] {
  if (!coords || coords.length < 2) return coords ? coords.slice() : [];
  const out: LonLat[] = [coords[0].slice() as LonLat];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = distM(a, b);
    const pieces = Math.max(1, Math.ceil(seg / maxStepM));
    for (let k = 1; k <= pieces; k++) {
      const t = k / pieces;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as LonLat);
    }
  }
  return out;
}

// ──────────────────────────── coverage evaluation ────────────────────────────

interface CaptureIndex {
  grid: Map<string, LonLat[]>;
  cellDeg: number;
}

function buildCaptureIndex(tracks: LonLat[][], toleranceM: number): CaptureIndex {
  const cellDeg = Math.max((toleranceM / 111000) * 2, 0.0004);
  const grid = new Map<string, LonLat[]>();
  const denseStep = Math.max(6, toleranceM / 3);
  (tracks || []).forEach((trk) => {
    // Densify each captured trajectory so sparse frames still create a
    // continuous capture corridor for the plan-line classifier. Raw points
    // only would leave holes between frames (the "road surveyed but skipped"
    // symptom).
    const valid = (trk || []).filter(
      (pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
    ) as LonLat[];
    const pts = valid.length >= 2 ? densifyRun(valid, denseStep) : valid;
    pts.forEach((pt) => {
      const key = `${Math.floor(pt[0] / cellDeg)}|${Math.floor(pt[1] / cellDeg)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(pt);
      else grid.set(key, [pt]);
    });
  });
  return { grid, cellDeg };
}

function nearestCaptureDistM(pt: LonLat, index: CaptureIndex): number {
  const cx = Math.floor(pt[0] / index.cellDeg);
  const cy = Math.floor(pt[1] / index.cellDeg);
  let best = Number.POSITIVE_INFINITY;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = index.grid.get(`${cx + dx}|${cy + dy}`);
      if (!bucket) continue;
      for (const p of bucket) {
        const d = distM(pt, p);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/**
 * Classifies every ~`sampleStepM` segment of each plan run as covered when
 * BOTH its endpoints have a captured panotrack point within `toleranceM`.
 * Contiguous uncovered segments are merged into `uncoveredRuns` (the red gaps
 * that follow the plan road geometry).
 */
export function computePlanCoverage(
  planRuns: LonLat[][],
  capturedTracks: LonLat[][],
  toleranceM = 25,
  sampleStepM = 10
): PlanCoverage {
  const index = buildCaptureIndex(capturedTracks, toleranceM);
  let planKm = 0;
  let coveredKm = 0;
  const uncoveredRuns: LonLat[][] = [];

  (planRuns || []).forEach((run) => {
    if (!run || run.length < 2) return;
    const samples = densifyRun(run, sampleStepM);
    if (samples.length < 2) return;
    const split = splitRunCoverage(samples, index, toleranceM);
    planKm += split.runM / 1000;
    coveredKm += split.covM / 1000;
    uncoveredRuns.push(...split.uncoveredRuns);
  });

  const coveredPct = planKm > 0 ? clamp((coveredKm / planKm) * 100, 0, 100) : 0;
  return {
    planKm: round2(planKm),
    coveredKm: round2(coveredKm),
    coveredPct,
    uncoveredRuns
  };
}

/** Assembles the per-subgrid COMPLETE / INCOMPLETE verdict from coverage. */
export function finalizeSubgridResult(
  plan: SubgridTracePlan,
  coverage: PlanCoverage,
  thresholdPct: number
): SubgridTraceResult {
  const hasPlan = plan.planRuns.length > 0 && coverage.planKm > 0.0001;
  const gapKm = Math.max(0, coverage.planKm - coverage.coveredKm);
  const status: SubgridTraceStatus = !hasPlan
    ? 'no-plan'
    : coverage.coveredPct >= thresholdPct
      ? 'complete'
      : 'incomplete';

  return {
    subgrid: plan.subgrid,
    bbox: plan.bbox,
    status,
    surveyCount: plan.surveys.length,
    capturedKm: round2(plan.capturedKm),
    planKm: round2(coverage.planKm),
    coveredKm: round2(coverage.coveredKm),
    coveredPct: hasPlan ? Math.round(coverage.coveredPct * 10) / 10 : null,
    gapKm: hasPlan ? round2(gapKm) : 0,
    uncoveredRuns: hasPlan ? coverage.uncoveredRuns : []
  };
}

// ────────────────────────────── plan-walk trace ──────────────────────────────

/** One ~sampleStepM slice of the plan road with its panotrack coverage flag. */
export interface WalkSegment {
  a: LonLat;
  b: LonLat;
  /** true = already surveyed (panotrack within tolerance) → trace skips it. */
  covered: boolean;
  lengthM: number;
  /** Index of the source plan run this segment belongs to (for drawn grouping). */
  runIndex: number;
}

/**
 * A single walkable path along the subgrid's plan roads: plan runs chained
 * end-to-start (greedy nearest endpoint), every slice flagged as covered
 * (has panotrack) or uncovered (gap). The trace animation walks this path,
 * fast-forwards through covered slices and draws the uncovered ones.
 */
export interface SubgridWalk {
  subgrid: string;
  segments: WalkSegment[];
  /** Dashed jump lines between disconnected plan runs. */
  links: LonLat[][];
  /** Plan runs in walk order (orientation normalized). */
  orderedRuns: LonLat[][];
  totalM: number;
  coveredM: number;
  gapM: number;
}

/**
 * Chains plan runs into one continuous walk: from the current endpoint the
 * nearest remaining run endpoint is chosen and that run is oriented so the
 * walk enters at that endpoint. Disconnected jumps become dashed links.
 *
 * The walk START is chosen from "any angle" of the grid: the plan endpoint
 * closest to one of the 4 corners of `bbox` begins the trace, so the line
 * enters the cell from a corner and walks across the grid.
 */
/**
 * Chains plan runs into one continuous walk: from the current endpoint the
 * nearest remaining run endpoint is chosen and that run is oriented so the
 * walk enters at that endpoint. Disconnected jumps become dashed links —
 * but only SHORT joints are drawn (capped by {@link LINK_DRAW_MAX_M}); long
 * cross-country jumps stay invisible so the trace never paints dashed lines
 * across open ground.
 */
export const LINK_DRAW_MAX_M = 120;

export function chainRunsOrder(
  runs: LonLat[][],
  bbox?: [number, number, number, number]
): { ordered: LonLat[][]; links: LonLat[][] } {
  if (runs.length === 0) return { ordered: [], links: [] };
  const remaining = runs.map((r) => r.map((c) => c.slice() as LonLat));
  const ordered: LonLat[][] = [];
  const links: LonLat[][] = [];

  // Pick the starting run/endpoint nearest any grid corner (any angle).
  if (bbox && (bbox[0] !== 0 || bbox[1] !== 0)) {
    const corners: LonLat[] = [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[1]],
      [bbox[0], bbox[3]],
      [bbox[2], bbox[3]]
    ];
    let bestRun = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestFromStartPt = true;
    remaining.forEach((run, idx) => {
      corners.forEach((corner) => {
        const dS = distM(corner, run[0]);
        const dE = distM(corner, run[run.length - 1]);
        if (dS < bestDist) {
          bestDist = dS;
          bestRun = idx;
          bestFromStartPt = true;
        }
        if (dE < bestDist) {
          bestDist = dE;
          bestRun = idx;
          bestFromStartPt = false;
        }
      });
    });
    if (bestRun !== 0) {
      const [picked] = remaining.splice(bestRun, 1);
      remaining.unshift(picked);
    }
    if (!bestFromStartPt) {
      const pickedRun = remaining[0];
      pickedRun.reverse();
    }
  }

  let current = remaining.shift()!;
  ordered.push(current);
  const visitedEnds: LonLat[] = [current[0], current[current.length - 1]];

  while (remaining.length > 0) {
    const end = current[current.length - 1];
    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    let bestFromEnd = true;

    // 1. Direct continuation: find any remaining run that connects to `end` directly (dist <= 1.0m)
    for (let i = 0; i < remaining.length; i++) {
      const run = remaining[i];
      const dStart = distM(end, run[0]);
      const dEnd = distM(end, run[run.length - 1]);
      if (dStart <= 1.0) {
        bestIdx = i;
        bestDist = dStart;
        bestFromEnd = true;
        break;
      }
      if (dEnd <= 1.0) {
        bestIdx = i;
        bestDist = dEnd;
        bestFromEnd = false;
        break;
      }
    }

    // 2. Branch traversal: if at a dead-end, check recent visited junctions for unvisited branches
    if (bestIdx < 0) {
      for (let vi = visitedEnds.length - 1; vi >= 0; vi--) {
        const v = visitedEnds[vi];
        for (let i = 0; i < remaining.length; i++) {
          const run = remaining[i];
          const dStart = distM(v, run[0]);
          const dEnd = distM(v, run[run.length - 1]);
          if (dStart <= 1.0) {
            bestIdx = i;
            bestDist = 0;
            bestFromEnd = true;
            break;
          }
          if (dEnd <= 1.0) {
            bestIdx = i;
            bestDist = 0;
            bestFromEnd = false;
            break;
          }
        }
        if (bestIdx >= 0) break;
      }
    }

    // 3. Greedy fallback: nearest remaining run endpoint from current end
    if (bestIdx < 0) {
      remaining.forEach((run, idx) => {
        const dStart = distM(end, run[0]);
        const dEnd = distM(end, run[run.length - 1]);
        if (dStart < bestDist) {
          bestDist = dStart;
          bestIdx = idx;
          bestFromEnd = true;
        }
        if (dEnd < bestDist) {
          bestDist = dEnd;
          bestIdx = idx;
          bestFromEnd = false;
        }
      });
    }

    const next = remaining.splice(bestIdx, 1)[0];
    if (!bestFromEnd) next.reverse();
    if (bestDist > CONNECTOR_MIN_GAP_M && bestDist <= LINK_DRAW_MAX_M) {
      links.push([end, next[0]]);
    }
    visitedEnds.push(next[0], next[next.length - 1]);
    ordered.push(next);
    current = next;
  }

  return { ordered, links };
}

/**
 * A plan stretch counts as covered only when its ENDPOINTS *and* midpoint
 * all have a captured panotrack point within tolerance — a stricter
 * three-sample test that rejects frames captured next to (not on) the road
 * and prevents false-green stubs.
 */
function classifyCovered(
  a: LonLat,
  b: LonLat,
  index: CaptureIndex,
  toleranceM: number
): boolean {
  const mid: LonLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return (
    nearestCaptureDistM(a, index) <= toleranceM &&
    nearestCaptureDistM(mid, index) <= toleranceM &&
    nearestCaptureDistM(b, index) <= toleranceM
  );
}

/**
 * Uncovered stretches shorter than this are to be bridged (treated as
 * covered): panotrack frame spacing / fragment joints at road forks create
 * speckled micro-gaps that would otherwise fragment the drawn trace even
 * where the road was clearly surveyed.
 */
export const MIN_UNCOVERED_M = 30;

/** Bridges sub-`maxGapM` uncovered stretches into covered ones in-place. */
function mergeShortGaps(segments: WalkSegment[], maxGapM: number): void {
  let i = 0;
  while (i < segments.length) {
    if (segments[i].covered) {
      i += 1;
      continue;
    }
    let j = i;
    let gapLen = 0;
    while (j < segments.length && !segments[j].covered) {
      gapLen += segments[j].lengthM;
      j += 1;
    }
    // Only bridge if:
    // 1) It is an internal gap bounded by covered segments on BOTH sides, OR
    // 2) It is a tiny joint stub (<= 10m) adjacent to a covered segment.
    // An entire isolated unsurveyed run (i === 0 && j === segments.length) must NEVER be bridged.
    const isInternal = i > 0 && j < segments.length;
    const isBoundaryStub = (i > 0 || j < segments.length) && gapLen <= 10;
    if ((isInternal && gapLen < maxGapM) || isBoundaryStub) {
      for (let k = i; k < j; k++) segments[k] = { ...segments[k], covered: true };
    }
    i = j;
  }
}

/**
 * Prunes false-covered stubs at junction mouths: when a survey vehicle drove
 * along an intersecting main road, its tolerance buffer marks the first 10-25m
 * mouth of an unsurveyed side street as covered. If the rest of the run is
 * predominantly a gap, this terminal stub is bleed-over from the cross street
 * and should be drawn as an uncovered gap so the red line connects to the junction.
 */
function pruneJunctionBleed(segments: WalkSegment[], maxBleedM = 25): void {
  if (segments.length < 2) return;
  const totalM = segments.reduce((sum, s) => sum + s.lengthM, 0);
  const gapM = segments.filter((s) => !s.covered).reduce((sum, s) => sum + s.lengthM, 0);
  if (totalM <= 0 || gapM / totalM < 0.4) return;

  // Leading covered stub at start of run
  if (segments[0].covered) {
    let leadM = 0;
    let endIdx = 0;
    while (endIdx < segments.length && segments[endIdx].covered) {
      leadM += segments[endIdx].lengthM;
      endIdx++;
    }
    if (leadM <= maxBleedM && endIdx < segments.length) {
      for (let k = 0; k < endIdx; k++) {
        segments[k] = { ...segments[k], covered: false };
      }
    }
  }

  // Trailing covered stub at end of run
  const last = segments.length - 1;
  if (segments[last].covered) {
    let trailM = 0;
    let startIdx = last;
    while (startIdx >= 0 && segments[startIdx].covered) {
      trailM += segments[startIdx].lengthM;
      startIdx--;
    }
    if (trailM <= maxBleedM && startIdx >= 0) {
      for (let k = startIdx + 1; k <= last; k++) {
        segments[k] = { ...segments[k], covered: false };
      }
    }
  }
}

/** Per-run classification result shared by the walk builder + coverage. */
interface RunSplit {
  segments: WalkSegment[];
  runM: number;
  covM: number;
  uncoveredRuns: LonLat[][];
}

function splitRunCoverage(
  samples: LonLat[],
  index: CaptureIndex,
  toleranceM: number
): RunSplit {
  const segments: WalkSegment[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const lengthM = distM(a, b);
    if (lengthM <= 0) continue;
    segments.push({
      a,
      b,
      covered: classifyCovered(a, b, index, toleranceM),
      lengthM,
      runIndex: 0
    });
  }
  mergeShortGaps(segments, MIN_UNCOVERED_M);
  pruneJunctionBleed(segments);

  let runM = 0;
  let covM = 0;
  const uncoveredRuns: LonLat[][] = [];
  let openGap: LonLat[] | null = null;
  for (const seg of segments) {
    runM += seg.lengthM;
    if (seg.covered) {
      covM += seg.lengthM;
      if (openGap) {
        uncoveredRuns.push(openGap);
        openGap = null;
      }
    } else if (openGap) {
      openGap.push(seg.b);
    } else {
      openGap = [seg.a, seg.b];
    }
  }
  if (openGap) uncoveredRuns.push(openGap);

  return { segments, runM, covM, uncoveredRuns };
}

/**
 * Builds the plan-walk path for one subgrid: chains the clipped plan runs,
 * densifies them and flags every slice as covered (panotrack within
 * tolerance) or uncovered (a gap the trace will draw).
 */
export function buildSubgridWalk(
  subgrid: string,
  planRuns: LonLat[][],
  capturedTracks: LonLat[][],
  toleranceM = 25,
  sampleStepM = 15,
  bbox?: [number, number, number, number]
): SubgridWalk {
  const { ordered, links } = chainRunsOrder(planRuns || [], bbox);
  const index = buildCaptureIndex(capturedTracks, toleranceM);

  const segments: WalkSegment[] = [];
  let totalM = 0;
  let coveredM = 0;
  let gapM = 0;

  ordered.forEach((run, runIndex) => {
    if (run.length < 2) return;
    const samples = densifyRun(run, sampleStepM);
    if (samples.length < 2) return;
    const split = splitRunCoverage(samples, index, toleranceM);
    split.segments.forEach((seg) => segments.push({ ...seg, runIndex }));
    totalM += split.runM;
    coveredM += split.covM;
    gapM += split.runM - split.covM;
  });

  return { subgrid, segments, links, orderedRuns: ordered, totalM, coveredM, gapM };
}

/** Groups contiguous walk segments into drawable line runs (per plan run). */
export function walkSegmentsToRuns(segments: WalkSegment[]): LonLat[][] {
  const runs: LonLat[][] = [];
  let current: LonLat[] | null = null;
  for (const seg of segments) {
    const last = current?.[current.length - 1];
    if (last && last[0] === seg.a[0] && last[1] === seg.a[1]) {
      current!.push(seg.b);
    } else {
      current = [seg.a, seg.b];
      runs.push(current);
    }
  }
  return runs;
}
