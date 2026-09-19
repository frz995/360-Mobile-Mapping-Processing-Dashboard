/**
 * Dedicated module worker: runs the plan topology stitching
 * (`connectRunsByEndpoints` + id-based merge) off the main thread so large
 * plans never freeze the UI for a second while their endpoints are unified.
 * The workspace keeps showing the previous stitch until the new one lands.
 *
 * The worker mirrors the gisImport worker protocol (numeric request id,
 * filtered on the main thread) so stale replies from an older request can be
 * dropped even though the worker is reused across stitches.
 */
import {
  connectRunsByEndpoints,
  PLAN_ENDPOINT_SNAP_M,
  PLAN_TJUNCTION_SNAP_M,
  type PlanRunEndpointIds
} from '../utils/subgridComparison';

export interface PlanStitchWorkerRequest {
  id: number;
  runs: Array<Array<[number, number]>>;
  endpointIds?: Array<PlanRunEndpointIds>;
}

export type PlanStitchWorkerResponse =
  | { id: number; status: 'ok'; runs: Array<Array<[number, number]>> }
  | { id: number; status: 'error'; error: string };

const post = (message: PlanStitchWorkerResponse): void => {
  (self as unknown as { postMessage(message: PlanStitchWorkerResponse): void }).postMessage(message);
};

self.onmessage = (event: MessageEvent<PlanStitchWorkerRequest>) => {
  const { id, runs, endpointIds } = event.data;
  try {
    const stitched = connectRunsByEndpoints(
      runs,
      PLAN_ENDPOINT_SNAP_M,
      PLAN_TJUNCTION_SNAP_M,
      true,
      endpointIds
    );
    post({ id, status: 'ok', runs: stitched });
  } catch (err: any) {
    post({ id, status: 'error', error: err?.message || String(err) });
  }
};