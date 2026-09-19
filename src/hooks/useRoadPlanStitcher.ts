import { useEffect, useState } from 'react';
import {
  connectRunsByEndpoints,
  PLAN_ENDPOINT_SNAP_M,
  PLAN_TJUNCTION_SNAP_M,
  type PlanRunEndpointIds
} from '../utils/subgridComparison';
import type { PlanStitchWorkerRequest, PlanStitchWorkerResponse } from '../workers/planStitch.worker';

/** Plans below this many runs are stitched synchronously (fast enough to stay
 *  well under a frame). Larger plans go through the Web Worker so the UI
 *  thread never blocks, keeping the previous plan visible while they compute. */
const INLINE_THRESHOLD_RUNS = 400;

let planStitchWorker: Worker | null = null;
let planStitchWorkerCount = 0;

function getPlanStitchWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (planStitchWorker) return planStitchWorker;
  try {
    planStitchWorker = new Worker(new URL('../workers/planStitch.worker.ts', import.meta.url), {
      type: 'module'
    });
  } catch {
    planStitchWorker = null;
  }
  return planStitchWorker;
}

export interface RoadPlanStitchInput {
  runs: Array<Array<[number, number]>>;
  endpointIds?: Array<PlanRunEndpointIds>;
}

export interface RoadPlanStitchResult {
  runs: Array<Array<[number, number]>>;
  /** True while a newer, larger stitch is computing and the previous runs are
   *  still being shown. */
  stale: boolean;
}

/**
 * Off-thread plan stitching. Small plans and environments without workers
 * (tests, CSP) compute inline so behavior is identical; large plans are posted
 * to the `planStitch` worker and the result async-replaces the previous one.
 */
const EMPTY_RUNS: Array<Array<[number, number]>> = [];

export function useRoadPlanStitcher(input: RoadPlanStitchInput): RoadPlanStitchResult {
  const runs = input.runs || EMPTY_RUNS;
  const endpointIds = input.endpointIds;
  const [result, setResult] = useState<RoadPlanStitchResult>({ runs: EMPTY_RUNS, stale: false });

  useEffect(() => {
    if (runs.length === 0) {
      setResult((prev) => {
        if (prev.runs.length === 0 && !prev.stale) return prev;
        return { runs: EMPTY_RUNS, stale: false };
      });
      return;
    }

    const runInline = () => {
      setResult({
        runs: connectRunsByEndpoints(runs, PLAN_ENDPOINT_SNAP_M, PLAN_TJUNCTION_SNAP_M, true, endpointIds),
        stale: false
      });
    };

    if (runs.length <= INLINE_THRESHOLD_RUNS) {
      runInline();
      return;
    }

    const worker = getPlanStitchWorker();
    if (!worker) {
      runInline();
      return;
    }

    const id = ++planStitchWorkerCount;
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onError = () => {
      // The worker may be wedged — force a fresh one next time and stitch inline.
      cleanup();
      planStitchWorker = null;
      runInline();
    };
    const onMessage = (evt: MessageEvent<PlanStitchWorkerResponse>) => {
      if (!evt.data || evt.data.id !== id) return;
      cleanup();
      if (evt.data.status === 'ok') {
        setResult({ runs: evt.data.runs, stale: false });
      } else {
        runInline();
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    // Keep the current plan on screen while the larger stitch computes.
    setResult((prev) => ({ runs: prev.runs, stale: true }));
    const request: PlanStitchWorkerRequest = { id, runs, endpointIds };
    worker.postMessage(request);

    return cleanup;
  }, [runs, endpointIds]);

  return result;
}