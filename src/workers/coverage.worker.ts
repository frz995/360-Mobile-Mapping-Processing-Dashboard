/**
 * Dedicated module worker: runs the road-plan coverage segmentation
 * (`computePlanCoverage`, the same classifier the network trace used) off the
 * main thread so a large OSM / GIS road network never freezes the UI while the
 * covered-vs-uncovered pass runs. Streams live run-by-run progress so the map
 * can show a progress popup over a blurred backdrop.
 *
 * Mirrors the planStitch / gisImport protocol: numeric request id is filtered
 * on the main thread so stale replies from an older request are dropped.
 */
import {
  computePlanCoverage,
  type LonLat,
  type PlanCoverage
} from '../utils/roadNetworkTrace';

export interface CoverageWorkerRequest {
  id: number;
  planRuns: LonLat[][];
  capturedTracks: LonLat[][];
  toleranceM: number;
}

export type CoverageWorkerResponse =
  | { id: number; status: 'progress'; done: number; total: number }
  | { id: number; status: 'ok'; coverage: PlanCoverage }
  | { id: number; status: 'error'; error: string };

const post = (message: CoverageWorkerResponse): void => {
  (self as unknown as { postMessage(message: CoverageWorkerResponse): void }).postMessage(message);
};

self.onmessage = (event: MessageEvent<CoverageWorkerRequest>) => {
  const { id, planRuns, capturedTracks, toleranceM } = event.data;
  try {
    const coverage = computePlanCoverage(
      planRuns,
      capturedTracks,
      toleranceM,
      10,
      (done, total) => post({ id, status: 'progress', done, total })
    );
    post({ id, status: 'ok', coverage });
  } catch (err: any) {
    post({ id, status: 'error', error: err?.message || String(err) });
  }
};