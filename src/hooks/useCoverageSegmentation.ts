import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computePlanCoverage,
  type LonLat,
  type PlanCoverage
} from '../utils/roadNetworkTrace';
import type { CoverageWorkerRequest, CoverageWorkerResponse } from '../workers/coverage.worker';

export type CoveragePhase = 'idle' | 'running' | 'done' | 'error';

export interface CoverageProgress {
  done: number;
  total: number;
}

export interface CoverageSegmentationState {
  phase: CoveragePhase;
  progress: CoverageProgress | null;
  coverage: PlanCoverage | null;
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
  planRuns: LonLat[][];
  capturedTracks: LonLat[][];
  toleranceM: number;
  enabled: boolean;
}

/**
 * Off-thread road-plan coverage segmentation. Small networks (and
 * environments without workers: tests, CSP) classify inline so behavior is
 * identical; large networks are posted to the `coverage` worker, which streams
 * run-by-run progress for the map's progress popup. Results are cached per
 * input so toggling the overlay off/on never recomputes.
 */
export function useCoverageSegmentation(
  input: UseCoverageSegmentationInput
): CoverageSegmentationState {
  const { planRuns, capturedTracks, toleranceM, enabled } = input;

  const inputRef = useRef({ planRuns, capturedTracks, toleranceM });
  inputRef.current = { planRuns, capturedTracks, toleranceM };

  const [state, setState] = useState<CoverageSegmentationState>({
    phase: 'idle',
    progress: null,
    coverage: null
  });

  /** Last successful result keyed by the exact arrays it was computed from. */
  const cacheRef = useRef<{
    runs: LonLat[][];
    tracks: LonLat[][];
    coverage: PlanCoverage;
    progress: CoverageProgress;
  } | null>(null);

  /** Detaches the active worker request's listeners (started a new one, or
   *  unmounted). */
  const cleanupRef = useRef<(() => void) | null>(null);

  const compute = useCallback(() => {
    cleanupRef.current?.();
    const { planRuns: runs, capturedTracks: tracks, toleranceM: tol } = inputRef.current;
    if (!Array.isArray(runs) || runs.length === 0) {
      cacheRef.current = null;
      setState({ phase: 'idle', progress: null, coverage: null });
      return;
    }

    const progress = {
      done: runs.length,
      total: runs.length
    };
    const runInline = () => {
      const coverage = computePlanCoverage(runs, tracks, tol, 10);
      cacheRef.current = { runs, tracks, coverage, progress };
      setState({ phase: 'done', progress, coverage });
    };

    const worker = getCoverageWorker();
    if (!worker || runs.length <= INLINE_THRESHOLD_RUNS) {
      runInline();
      return;
    }

    const id = ++coverageWorkerCount;
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onError = () => {
      // The worker may be wedged — force a fresh one next time and run inline.
      cleanup();
      coverageWorker = null;
      runInline();
    };
    const onMessage = (evt: MessageEvent<CoverageWorkerResponse>) => {
      const data = evt.data;
      if (!data || data.id !== id) return;
      if (data.status === 'progress') {
        setState((prev) => ({ ...prev, progress: { done: data.done, total: data.total } }));
        return;
      }
      // Final reply (ok or error): the request is finished either way.
      cleanup();
      if (data.status === 'ok') {
        cacheRef.current = { runs, tracks, coverage: data.coverage, progress };
        setState({ phase: 'done', progress, coverage: data.coverage });
      } else {
        runInline();
      }
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    cleanupRef.current = cleanup;
    setState((prev) => ({ ...prev, phase: 'running', progress: null }));
    const request: CoverageWorkerRequest = { id, planRuns: runs, capturedTracks: tracks, toleranceM: tol };
    worker.postMessage(request);
  }, []);

  useEffect(() => {
    if (!enabled) {
      cleanupRef.current?.();
      setState({ phase: 'idle', progress: null, coverage: null });
      return;
    }
    // Re-showing the overlay with unchanged inputs restores the cached result.
    const cached = cacheRef.current;
    if (
      cached &&
      cached.runs === planRuns &&
      cached.tracks === capturedTracks
    ) {
      setState({ phase: 'done', progress: cached.progress, coverage: cached.coverage });
      return;
    }
    compute();
  }, [enabled, planRuns, capturedTracks, compute]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return state;
}