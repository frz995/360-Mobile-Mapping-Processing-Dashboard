import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computePlanCoverage,
  type LonLat,
  type PlanCoverage
} from '../utils/roadNetworkTrace';
import type { CoverageWorkerRequest, CoverageWorkerResponse } from '../workers/coverage.worker';

export type CoveragePhase = 'idle' | 'running' | 'done' | 'error';
export type CoverageScope = 'none' | 'subgrid' | 'all';

export interface CoverageProgress {
  done: number;
  total: number;
}

export interface CoverageSegmentationState {
  phase: CoveragePhase;
  progress: CoverageProgress | null;
  coverage: PlanCoverage | null;
  activeScope: CoverageScope;
  activeSubgridId: string | null;
  subgridResults: Record<string, PlanCoverage>;
  segmentSubgrid: (subgridId: string, subgridRuns: LonLat[][]) => void;
  segmentAll: (allRuns: LonLat[][], subgridPlans?: Array<{ subgrid: string; planRuns: LonLat[][] }>) => void;
  clear: () => void;
}

/** Plan networks at/below this many runs are classified inline (fast enough
 *  to stay well under a frame); larger networks go through the module worker
 *  so the UI thread never freezes while progress streams back. */
const INLINE_THRESHOLD_RUNS = 2000;

let coverageWorker: Worker | null = null;
let coverageWorkerCount = 0;

function getCoverageWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (coverageWorker) return coverageWorker;
  try {
    coverageWorker = new Worker(new URL('../workers/coverage.worker.ts', import.meta.url), {
      type: 'module'
    });
  } catch {
    coverageWorker = null;
  }
  return coverageWorker;
}

export interface UseCoverageSegmentationInput {
  capturedTracks: LonLat[][];
  toleranceM: number;
}

/**
 * On-demand road-plan coverage segmentation. Does NOT auto-run on plan open.
 * Only executes when a specific subgrid is clicked (segmentSubgrid) or when
 * the user explicitly triggers "Segment all" (segmentAll).
 * Results are cached per-subgrid so re-selecting a subgrid is instantaneous.
 */
export function useCoverageSegmentation(
  input: UseCoverageSegmentationInput
): CoverageSegmentationState {
  const { capturedTracks, toleranceM } = input;

  const inputRef = useRef({ capturedTracks, toleranceM });
  inputRef.current = { capturedTracks, toleranceM };

  const subgridResultsRef = useRef<Record<string, PlanCoverage>>({});

  const [state, setState] = useState<Omit<CoverageSegmentationState, 'segmentSubgrid' | 'segmentAll' | 'clear'>>({
    phase: 'idle',
    progress: null,
    coverage: null,
    activeScope: 'none',
    activeSubgridId: null,
    subgridResults: {}
  });

  /** Detaches the active worker request's listeners (started a new one, or unmounted). */
  const cleanupRef = useRef<(() => void) | null>(null);

  const clear = useCallback(() => {
    cleanupRef.current?.();
    subgridResultsRef.current = {};
    setState((prev) => {
      if (prev.phase === 'idle' && !prev.coverage && Object.keys(prev.subgridResults).length === 0) {
        return prev;
      }
      return {
        phase: 'idle',
        progress: null,
        coverage: null,
        activeScope: 'none',
        activeSubgridId: null,
        subgridResults: {}
      };
    });
  }, []);

  const segmentSubgrid = useCallback((subgridId: string, subgridRuns: LonLat[][]) => {
    const { capturedTracks: tracks, toleranceM: tol } = inputRef.current;
    if (subgridResultsRef.current[subgridId]) {
      const cached = subgridResultsRef.current[subgridId];
      setState((prev) => ({
        ...prev,
        phase: 'done',
        coverage: cached,
        activeScope: 'subgrid',
        activeSubgridId: subgridId
      }));
      return;
    }

    if (!Array.isArray(subgridRuns) || subgridRuns.length === 0) {
      const emptyCov: PlanCoverage = { planKm: 0, coveredKm: 0, coveredPct: 0, tracedKm: 0, tracedPct: 0, uncoveredRuns: [] };
      subgridResultsRef.current = {
        ...subgridResultsRef.current,
        [subgridId]: emptyCov
      };
      setState((prev) => ({
        ...prev,
        phase: 'done',
        coverage: emptyCov,
        activeScope: 'subgrid',
        activeSubgridId: subgridId,
        subgridResults: subgridResultsRef.current
      }));
      return;
    }

    const cov = computePlanCoverage(subgridRuns, tracks, tol);
    subgridResultsRef.current = {
      ...subgridResultsRef.current,
      [subgridId]: cov
    };
    setState((prev) => ({
      ...prev,
      phase: 'done',
      coverage: cov,
      activeScope: 'subgrid',
      activeSubgridId: subgridId,
      subgridResults: subgridResultsRef.current
    }));
  }, []);

  const segmentAll = useCallback((allRuns: LonLat[][], subgridPlans?: Array<{ subgrid: string; planRuns: LonLat[][] }>) => {
    cleanupRef.current?.();
    const { capturedTracks: tracks, toleranceM: tol } = inputRef.current;
    if (!Array.isArray(allRuns) || allRuns.length === 0) {
      return;
    }

    const onComplete = (coverage: PlanCoverage) => {
      const newSubgridResults: Record<string, PlanCoverage> = { ...subgridResultsRef.current };
      if (Array.isArray(subgridPlans)) {
        subgridPlans.forEach((p) => {
          if (!newSubgridResults[p.subgrid] && p.planRuns.length > 0) {
            newSubgridResults[p.subgrid] = computePlanCoverage(p.planRuns, tracks, tol);
          }
        });
      }
      subgridResultsRef.current = newSubgridResults;
      setState({
        phase: 'done',
        progress: null,
        coverage,
        activeScope: 'all',
        activeSubgridId: null,
        subgridResults: newSubgridResults
      });
    };

    const worker = getCoverageWorker();
    if (!worker || allRuns.length <= INLINE_THRESHOLD_RUNS) {
      const coverage = computePlanCoverage(allRuns, tracks, tol);
      onComplete(coverage);
      return;
    }

    const id = ++coverageWorkerCount;
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onError = () => {
      cleanup();
      coverageWorker = null;
      const coverage = computePlanCoverage(allRuns, tracks, tol);
      onComplete(coverage);
    };
    const onMessage = (evt: MessageEvent<CoverageWorkerResponse>) => {
      const data = evt.data;
      if (!data || data.id !== id) return;
      if (data.status === 'progress') {
        setState((prev) => ({ ...prev, progress: { done: data.done, total: data.total } }));
        return;
      }
      cleanup();
      if (data.status === 'ok') {
        onComplete(data.coverage);
      } else {
        const coverage = computePlanCoverage(allRuns, tracks, tol);
        onComplete(coverage);
      }
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    cleanupRef.current = cleanup;
    setState((prev) => ({ ...prev, phase: 'running', progress: null }));
    const request: CoverageWorkerRequest = { id, planRuns: allRuns, capturedTracks: tracks, toleranceM: tol };
    worker.postMessage(request);
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      ...state,
      segmentSubgrid,
      segmentAll,
      clear
    }),
    [state, segmentSubgrid, segmentAll, clear]
  );
}