import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import {
  buildSubgridWalk,
  chainRunsOrder,
  computePlanCoverage,
  finalizeSubgridResult,
  type LonLat,
  type SubgridTracePlan,
  type SubgridTraceResult,
  type SubgridWalk,
  type WalkSegment
} from '../utils/roadNetworkTrace';
import type { RoadTraceApi } from '../components/roadAnalysis/RoadAnalysisMap';

export type TracePhase = 'idle' | 'running' | 'paused' | 'finished';

export interface TraceProgress {
  mode: 'single' | 'multi';
  subgrid: string | null;
  /** 0..1 progress of the single-scope subgrid. */
  subgridFraction: number;
  /** finished cells / total cells. */
  overallFraction: number;
  activeWalkers: number;
  doneCells: number;
  totalCells: number;
}

export interface RoadTraceRunnerParams {
  plans: SubgridTracePlan[];
  capturedTracks: LonLat[][];
  toleranceM: number;
  thresholdPct: number;
  traceApiRef: MutableRefObject<RoadTraceApi | null>;
  mapRef: MutableRefObject<MaplibreMap | null>;
}

/** Scheduling and speed constants (100x baseline animation speed). */
const GAP_SPEED_MPS = 2500;
const SKIP_SPEED_MPS = 25000;
const MAX_CONCURRENT_WALKERS = 12;
const SINGLE_GRID_WALKERS = 4;
const MAX_WALKERS_PER_CELL = 4;
const PROGRESS_TICK_MS = 250;
/** Map overlay repaint interval for the BIG flushed geometry sources — full
 * re-setData is expensive; repainting at high fps stalled the map for seconds
 * on large cells. Per-tick updates (heads + live partials) still run freely. */
const RENDER_TICK_MS = 110;

interface ActiveWalker {
  cellIdx: number;
  walk: SubgridWalk;
  segIdx: number;
  distIntoSeg: number;
  walkedM: number;
  reportedM: number;
  openPassed: LonLat[] | null;
  openGap: LonLat[] | null;
  done: boolean;
}

interface CellState {
  cellIdx: number;
  plan: SubgridTracePlan;
  declaredWalkers: number;
  finishedWalkers: number;
  launched: boolean;
  finalized: boolean;
  walkerTotalM: number;
  walkerDoneM: number;
  groupsPassed: LonLat[][];
  groupsGap: LonLat[][];
  /** Dashed joints between disconnected plan runs (topology connectors). */
  links: LonLat[][];
}

interface RunnerState {
  runId: number;
  cells: CellState[];
  /** Cell cursor whose walkers have been built/pushed to the queue. */
  buildCursor: number;
  queue: ActiveWalker[];
  active: ActiveWalker[];
  results: SubgridTraceResult[];
  /** Cached immutable aggregates — rebuilt only when a flush happens. */
  cacheGap: LonLat[][];
  cachePassed: LonLat[][];
  aggDirty: boolean;
  scopeName: string | null;
  doneCells: number;
  totalCells: number;
  raf: number | null;
  lastTs: number;
  lastRenderTs: number;
  lastProgressTs: number;
}

function emptyState(): RunnerState {
  return {
    runId: 0,
    cells: [],
    buildCursor: 0,
    queue: [],
    active: [],
    results: [],
    cacheGap: [],
    cachePassed: [],
    aggDirty: true,
    scopeName: null,
    doneCells: 0,
    totalCells: 0,
    raf: null,
    lastTs: 0,
    lastRenderTs: 0,
    lastProgressTs: 0
  };
}

function cut(seg: WalkSegment, t: number): LonLat {
  return [
    seg.a[0] + (seg.b[0] - seg.a[0]) * t,
    seg.a[1] + (seg.b[1] - seg.a[1]) * t
  ] as LonLat;
}

/**
 * Splits a cell's plan runs into `k` length-balanced buckets, each an
 * independently animated walker (multiple trace lines run at once inside the
 * subgrid, entering from different grid angles).
 *
 * Topology preservation: runs are first chained into one continuous walk
 * order (greedy nearest-endpoint), then that ORDERED list is cut into
 * contiguous spans. Sorting by length (the old behaviour) scattered
 * geographically-jointed roads across different walkers, so junctions were
 * drawn as disconnected stubs. Keeping the chain in order means roads that
 * connect stay within the same walker, and the joints that DO fall between
 * walkers are returned as dashed connectors.
 */
function splitCellIntoWalkers(
  cellIdx: number,
  plan: SubgridTracePlan,
  walkerCount: number,
  p: RoadTraceRunnerParams
): { walkers: ActiveWalker[]; links: LonLat[][] } {
  const runs = (plan.planRuns || [])
    .filter((r) => r && r.length >= 2)
    .map((r) => r.map((c) => c.slice() as LonLat));
  if (runs.length === 0) return { walkers: [], links: [] };

  const { ordered, links } = chainRunsOrder(runs, plan.bbox);

  const k = Math.max(1, Math.min(walkerCount, ordered.length));
  const totalWeight = ordered.reduce((sum, r) => sum + r.length, 0);
  const target = k > 0 ? totalWeight / k : totalWeight;
  const buckets: Array<Array<Array<[number, number]>>> = Array.from({ length: k }, () => []);
  let bucketIdx = 0;
  let bucketWeight = 0;
  ordered.forEach((run) => {
    if (bucketIdx < k - 1 && bucketWeight >= target) {
      bucketIdx += 1;
      bucketWeight = 0;
    }
    buckets[bucketIdx].push(run);
    bucketWeight += run.length;
  });

  const walkers = buckets
    .filter((bucket) => bucket.length > 0)
    .map((bucket) => ({
      cellIdx,
      walk: buildSubgridWalk(plan.subgrid, bucket, p.capturedTracks, p.toleranceM, 15, plan.bbox),
      segIdx: 0,
      distIntoSeg: 0,
      walkedM: 0,
      reportedM: 0,
      openPassed: null,
      openGap: null,
      done: false
    }));

  return { walkers, links };
}

/**
 * Parallel road-network trace: each subgrid's plan roads are walked by
 * multiple concurrent walkers (green = panotrack-covered pass-through, red =
 * unsurveyed traced road). Running "all subgrids" fans cells across up to
 * MAX_CONCURRENT_WALKERS simultaneous walkers.
 */
export function useRoadTraceRunner(params: RoadTraceRunnerParams) {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const stateRef = useRef<RunnerState>(emptyState());
  const [phase, setPhase] = useState<TracePhase>('idle');
  const phaseRef = useRef<TracePhase>('idle');
  const [progress, setProgress] = useState<TraceProgress | null>(null);
  const [results, setResults] = useState<SubgridTraceResult[]>([]);

  const setPhaseBoth = useCallback((p: TracePhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /** Builds the walkers for the next unbuilt cell, or null when exhausted. */
  const buildNextCellWalkers = useCallback((s: RunnerState): ActiveWalker[] | null => {
    while (s.buildCursor < s.cells.length) {
      const cell = s.cells[s.buildCursor++];
      const { walkers: rawWalkers, links } = splitCellIntoWalkers(cell.cellIdx, cell.plan, cell.declaredWalkers, paramsRef.current);
      cell.links = links;
      cell.walkerTotalM = rawWalkers.reduce((sum, w) => sum + w.walk.totalM, 0);
      if (rawWalkers.length === 0) {
        finalizeCellRef.current(s, cell);
        continue;
      }
      cell.declaredWalkers = rawWalkers.length;
      return rawWalkers;
    }
    return null;
  }, []);

  /** Keeps a ref to finalizeCell so the hoisted order stays simple. */
  const finalizeCellRef = useRef<(s: RunnerState, cell: CellState) => void>(() => {});
  const runIdCounterRef = useRef(0);

  const finalizeCell = useCallback((s: RunnerState, cell: CellState) => {
    if (cell.finalized) return;
    cell.finalized = true;
    const p = paramsRef.current;
    const coverage = computePlanCoverage(cell.plan.planRuns, p.capturedTracks, p.toleranceM);
    const result = finalizeSubgridResult(cell.plan, coverage, p.thresholdPct);
    s.results.push(result);
    setResults([...s.results]);
    s.doneCells += 1;
  }, []);

  finalizeCellRef.current = finalizeCell;

  /** Pushes the big immutable flushed-geometry sources — called only when a
   * flush happened (aggDirty). Rebuilding thousands of feature FCs each tick
   * is what previously stalled the map for seconds. */
  const pushStatic = useCallback((s: RunnerState) => {
    const api = paramsRef.current.traceApiRef.current;
    if (!api) return;
    if (s.aggDirty) {
      s.cacheGap = s.cells.flatMap((c) => c.groupsGap);
      s.cachePassed = s.cells.flatMap((c) => c.groupsPassed);
      s.aggDirty = false;
      api.setTraceRuns(s.cacheGap);
      api.setPassed(s.cachePassed);
    }
    // Topology connectors: the dashed joints that keep the drawn plan network
    // visually continuous across disconnected runs / walkers. Cheap, small FC.
    api.setConnectors(s.cells.flatMap((c) => c.links));
  }, []);

  /** Cheap per-frame update: growing partials + head markers. */
  const updateLive = useCallback((s: RunnerState) => {
    const api = paramsRef.current.traceApiRef.current;
    if (!api) return;
    const liveGap: LonLat[][] = [];
    const livePassed: LonLat[][] = [];
    const heads: LonLat[] = [];
    s.active.forEach((w) => {
      if (w.openGap && w.openGap.length >= 2) liveGap.push(w.openGap);
      if (w.openPassed && w.openPassed.length >= 2) livePassed.push(w.openPassed);
      const seg = w.walk.segments[w.segIdx];
      if (seg) {
        const t = Math.min(1, Math.max(0, w.distIntoSeg / seg.lengthM));
        const [hLng, hLat] = cut(seg, t);
        if (Number.isFinite(hLng) && Number.isFinite(hLat)) {
          heads.push([hLng, hLat]);
        }
      }
    });
    api.setLiveGap(liveGap);
    api.setLivePassed(livePassed);
    api.setHead(heads.length > 0 ? heads : null);
  }, []);

  const renderFrame = useCallback((s: RunnerState, ts: number, force = false) => {
    const api = paramsRef.current.traceApiRef.current;
    if (api) {
      pushStatic(s);
      updateLive(s);
    }

    if (force || ts - s.lastProgressTs >= PROGRESS_TICK_MS) {
      s.lastProgressTs = ts;
      const walkedTotal = s.cells.reduce((sum, c) => sum + c.walkerDoneM, 0);
      const walkedAll = s.cells.reduce((sum, c) => sum + c.walkerTotalM, 0);
      const singleCell = s.cells.length === 1 ? s.cells[0] : null;
      const cellPct = s.totalCells > 0 ? s.doneCells / s.totalCells : 0;
      const walkedPct = walkedAll > 0 ? Math.min(1, walkedTotal / walkedAll) : 0;
      setProgress({
        mode: singleCell ? 'single' : 'multi',
        subgrid: singleCell ? singleCell.plan.subgrid : s.scopeName,
        subgridFraction:
          singleCell && singleCell.walkerTotalM > 0
            ? Math.min(1, singleCell.walkerDoneM / singleCell.walkerTotalM)
            : 1,
        overallFraction: Math.min(1, Math.max(cellPct, walkedPct)),
        activeWalkers: s.active.length,
        doneCells: s.doneCells,
        totalCells: s.totalCells
      });
    }
  }, [pushStatic, updateLive]);

  const finish = useCallback((s: RunnerState) => {
    const api = paramsRef.current.traceApiRef.current;
    if (s.raf !== null) {
      cancelAnimationFrame(s.raf);
      s.raf = null;
    }
    if (s.aggDirty) {
      s.cacheGap = s.cells.flatMap((c) => c.groupsGap);
      s.cachePassed = s.cells.flatMap((c) => c.groupsPassed);
      s.aggDirty = false;
    }
    api?.setTraceRuns(s.cacheGap);
    api?.setPassed(s.cachePassed);
    api?.setConnectors(s.cells.flatMap((c) => c.links));
    api?.setLiveGap([]);
    api?.setLivePassed([]);
    api?.setHead(null);
    setResults([...s.results]);
    setProgress((prev) =>
      prev
        ? { ...prev, overallFraction: 1, subgridFraction: 1, activeWalkers: 0 }
        : {
            mode: s.totalCells === 1 ? 'single' : 'multi',
            subgrid: s.totalCells === 1 ? s.cells[0]?.plan.subgrid ?? null : null,
            subgridFraction: 1,
            overallFraction: 1,
            activeWalkers: 0,
            doneCells: s.doneCells,
            totalCells: s.totalCells
          }
    );
    setPhaseBoth('finished');
  }, [setPhaseBoth]);

  const fitScope = useCallback((s: RunnerState) => {
    const map = paramsRef.current.mapRef.current;
    if (!map || s.cells.length === 0) return;
    let [minLng, minLat, maxLng, maxLat] = s.cells[0].plan.bbox;
    s.cells.forEach((c) => {
      const b = c.plan.bbox;
      if (b.some((v) => v !== 0)) {
        minLng = Math.min(minLng, b[0]);
        minLat = Math.min(minLat, b[1]);
        maxLng = Math.max(maxLng, b[2]);
        maxLat = Math.max(maxLat, b[3]);
      }
    });
    if ((minLng === maxLng && minLat === maxLat) || minLng === maxLng) return;
    try {
      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 56, maxZoom: 16, duration: 900 }
      );
    } catch {
      // ignore camera fit errors
    }
  }, []);

  /** Fills free concurrency slots, launching built cells one at a time. */
  const refill = useCallback((s: RunnerState) => {
    while (s.active.length < MAX_CONCURRENT_WALKERS) {
      if (s.queue.length === 0) {
        const nextBatch = buildNextCellWalkers(s);
        if (!nextBatch) break;
        s.queue.push(...nextBatch);
      }
      const w = s.queue.shift()!;
      const cell = s.cells[w.cellIdx];
      if (!cell.launched) {
        cell.launched = true;
      }
      s.active.push(w);
    }
  }, [buildNextCellWalkers]);

  const frame = useCallback((ts: number) => {
    const s = stateRef.current;
    if (phaseRef.current !== 'running' || s.raf === null) return;
    try {
      const dt = s.lastTs > 0 ? Math.min(0.05, (ts - s.lastTs) / 1000) : 0.016;
      s.lastTs = ts;

      // Flush helpers: completed groups go STRAIGHT into their cell's cache so
      // per-tick aggregates stay tiny; the big map sources only update on flush.
      const flushGap = (w: ActiveWalker) => {
        if (w.openGap) {
          s.cells[w.cellIdx].groupsGap.push(w.openGap);
          w.openGap = null;
          s.aggDirty = true;
        }
      };
      const flushPassed = (w: ActiveWalker) => {
        if (w.openPassed) {
          s.cells[w.cellIdx].groupsPassed.push(w.openPassed);
          w.openPassed = null;
          s.aggDirty = true;
        }
      };

      // 1. Advance every active walker.
      for (const w of s.active) {
        if (w.done) continue;
        let budget = dt;
        while (budget > 0 && !w.done) {
          const seg = w.walk.segments[w.segIdx];
          if (!seg) {
            w.done = true;
            break;
          }
          const speedMps = seg.covered ? SKIP_SPEED_MPS : GAP_SPEED_MPS;
          const remaining = seg.lengthM - w.distIntoSeg;
          const stepTime = remaining / speedMps;

          if (stepTime <= budget) {
            budget -= stepTime;
            w.walkedM += remaining;
            if (seg.covered) {
              flushGap(w);
              if (!w.openPassed) w.openPassed = [seg.a];
              w.openPassed.push(seg.b);
            } else {
              flushPassed(w);
              if (!w.openGap) w.openGap = [seg.a];
              w.openGap.push(seg.b);
            }
            w.segIdx += 1;
            w.distIntoSeg = 0;
            const next = w.walk.segments[w.segIdx];
            if (!next || next.runIndex !== seg.runIndex || next.covered !== seg.covered) {
              flushPassed(w);
              flushGap(w);
            }
            if (w.segIdx >= w.walk.segments.length) w.done = true;
          } else {
            w.distIntoSeg += speedMps * budget;
            w.walkedM += speedMps * budget;
            budget = 0;
            const pt = cut(seg, w.distIntoSeg / seg.lengthM);
            if (seg.covered) {
              flushGap(w);
              if (!w.openPassed) w.openPassed = [seg.a];
              w.openPassed[w.openPassed.length - 1] = pt;
            } else {
              flushPassed(w);
              if (!w.openGap) w.openGap = [seg.a];
              w.openGap[w.openGap.length - 1] = pt;
            }
          }
        }
      }

      // 2. Retire finished walkers; schedule cell verdict computation OFF the
      //    animation frame (computePlanCoverage is heavy and must not block a
      //    frame, or the map visibly freezes).
      const runId = s.runId;
      const stillActive: ActiveWalker[] = [];
      for (const w of s.active) {
        const cell = s.cells[w.cellIdx];
        if (w.done) {
          flushPassed(w);
          flushGap(w);
          cell.finishedWalkers += 1;
          if (cell.finishedWalkers >= cell.declaredWalkers && !cell.finalized) {
            window.setTimeout(() => {
              // A stop/reset replaces the whole state; ignore stale verdicts.
              const cur = stateRef.current;
              if (cur && cur.runId === runId) {
                finalizeCellRef.current(cur, cell);
              }
            }, 0);
          }
        } else {
          stillActive.push(w);
        }
      }
      s.active = stillActive;

      // 3. Report per-cell progress and fill freed slots.
      for (const w of s.active) {
        const cell = s.cells[w.cellIdx];
        cell.walkerDoneM += w.walkedM - w.reportedM;
        w.reportedM = w.walkedM;
      }
      refill(s);

      const finishedAll = s.active.length === 0 && s.queue.length === 0 && s.buildCursor >= s.cells.length;
      if (finishedAll) {
        renderFrame(s, ts, true);
        finish(s);
        return;
      }

      // 4. Static flushed geometry pushes are throttled (~9 fps); heads and
      //    live partials update every frame (cheap, few features) so markers
      //    move smoothly.
      if (ts - s.lastRenderTs >= RENDER_TICK_MS) {
        s.lastRenderTs = ts;
        pushStatic(s);
      }
      updateLive(s);
      s.raf = requestAnimationFrame(frame);
    } catch (err) {
      // A broken frame must never silently kill the animation chain.
      console.warn('[RoadTrace] frame error:', err);
      finish(s);
    }
  }, [finish, pushStatic, refill, updateLive]);

  const start = useCallback(
    (options?: { scope?: string | null }) => {
      const p = paramsRef.current;
      p.traceApiRef.current?.clearAll();

      const scope = options?.scope ?? null;
      const list = scope ? p.plans.filter((pl) => pl.subgrid === scope) : p.plans;
      if (list.length === 0) return;

      const s = emptyState();
      runIdCounterRef.current += 1;
      s.runId = runIdCounterRef.current;
      s.scopeName = scope && list.length === 1 ? scope : null;
      s.totalCells = list.length;

      const concurrencyCap = list.length === 1 ? SINGLE_GRID_WALKERS : MAX_CONCURRENT_WALKERS;
      const walkersPerCell = list.length === 1
        ? SINGLE_GRID_WALKERS
        : Math.max(
            1,
            Math.min(MAX_WALKERS_PER_CELL, Math.floor(concurrencyCap / Math.min(list.length, MAX_CONCURRENT_WALKERS)))
          );

      list.forEach((plan, idx) => {
        s.cells.push({
          cellIdx: idx,
          plan,
          declaredWalkers: walkersPerCell,
          finishedWalkers: 0,
          launched: false,
          finalized: false,
          walkerTotalM: 0,
          walkerDoneM: 0,
          groupsPassed: [],
          groupsGap: [],
          links: []
        });
      });

      stateRef.current = s;
      setResults([]);
      setProgress(null);
      setPhaseBoth('running');
      refill(s);
      fitScope(s);
      s.raf = requestAnimationFrame(frame);
    },
    [fitScope, frame, refill, setPhaseBoth]
  );

  const pause = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    const s = stateRef.current;
    if (s.raf !== null) {
      cancelAnimationFrame(s.raf);
      s.raf = null;
    }
    setPhaseBoth('paused');
  }, [setPhaseBoth]);

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    const s = stateRef.current;
    setPhaseBoth('running');
    s.lastTs = 0;
    s.raf = requestAnimationFrame(frame);
  }, [frame, setPhaseBoth]);

  const stop = useCallback(() => {
    const s = stateRef.current;
    if (s.raf !== null) {
      cancelAnimationFrame(s.raf);
      s.raf = null;
    }
    stateRef.current = emptyState();
    paramsRef.current.traceApiRef.current?.clearAll();
    setResults([]);
    setProgress(null);
    setPhaseBoth('idle');
  }, [setPhaseBoth]);

  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (s.raf !== null) cancelAnimationFrame(s.raf);
    };
  }, []);

  return { phase, progress, results, start, pause, resume, stop };
}
