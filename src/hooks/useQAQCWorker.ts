import { useState, useRef, useEffect, useCallback } from 'react';
import type { ExtendedProjectSettings, QADefectRecord, QAQCConfig } from '../types/admin';
import { analyzeImageSharpness, detectBlurAndObstruction } from '../utils/qaqcAnalyzer';
import { resolvePanoramaUrl, supabase } from '../services/supabase';
import { withRetry } from '../lib/retry';
import { reportWarn } from '../lib/report';
import { DATABASE_TABLE_DEFAULTS } from '../config/defaults';
import type {
  QaqcWorkerRequest,
  QaqcWorkerResponse,
  QaqcWorkerStationInput,
  QaqcWorkerThresholds
} from '../workers/qaqc.worker';

export interface StationNode {
  filename?: string;
  point_id?: string;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  lon?: number | null;
  bearing?: number | null;
  heading?: number | null;
  image_url?: string;
  [key: string]: any;
}

export type CheckStatus = 'pending' | 'checking' | 'passed' | 'flagged' | 'skipped';

export interface LiveCheckStatus {
  blur: { active: boolean; status: CheckStatus; detail?: string };
  obstruction: { active: boolean; status: CheckStatus; detail?: string };
  gps: { active: boolean; status: CheckStatus; detail?: string };
}

export interface StationInspectionRecord {
  index: number;
  pointId: string;
  lat: number;
  lng: number;
  bearing: number;
  stepDistance: number;
  thumbnailUrl: string;
  status: 'passed' | 'flagged' | 'skipped';
  blurVariance?: number;
  avgBrightness?: number;
  isBadGps?: boolean;
  isBlur?: boolean;
  isObstruction?: boolean;
  defectType?: string;
  deliverableModel?: 'masked_car' | 'generative_fill';
  reasons?: string[];
  timestamp: string;
}

export interface QAQCThresholdSettings {
  blurVarianceThreshold?: number;
  gpsMaxJumpDistanceMeters?: number;
  glareLuminanceThreshold?: number;
  obstructionMinBrightness?: number;
  deliverableModel?: 'masked_car' | 'generative_fill';
}

export interface QAQCWorkerState {
  isRunning: boolean;
  isPaused: boolean;
  isCompleted: boolean;
  isAborted: boolean;
  subgrid: string;
  runId: string | null;
  pic: string;
  config: QAQCConfig;
  stations: StationNode[];
  currentIndex: number;
  totalStations: number;
  currentPointId: string;
  currentCoords: { lat: number; lng: number };
  currentBearing: number;
  currentStepDistance: number;
  currentThumbnail: string;
  liveCheckStatus: LiveCheckStatus;
  defectsList: QADefectRecord[];
  history: StationInspectionRecord[];
  syncedCount: number;
  elapsedSeconds: number;
}

export interface StartInspectionParams {
  subgrid: string;
  runId?: string | null;
  stations: StationNode[];
  config: QAQCConfig;
  pic?: string;
  authUser?: { id?: string; email?: string; name?: string };
  projectSettings?: ExtendedProjectSettings;
  customThresholds?: Partial<QAQCThresholdSettings>;
  onProgress?: (progress: {
    currentIndex: number;
    totalStations: number;
    defectsFound: number;
    currentPointId: string;
    subgrid: string;
    runId?: string | null;
  }) => void;
  onDefectFound?: (defect: QADefectRecord, newDefectCount: number) => void;
  onComplete?: (summary: {
    totalInspected: number;
    defectsCount: number;
    defects: QADefectRecord[];
    subgrid: string;
    runId?: string | null;
  }) => void;
}

/**
 * Directional Multi-Quadrant Blur & Obstruction Analyzer
 * Evaluates 4 horizontal quadrants (Front, Right, Back, Left) to prevent sharp background
 * objects or watermarks from masking blur in another sector.
 */
export async function analyzeEquirectangularBlur(
  imageUrl: string,
  blurThreshold: number = 68.0,
  deliverableModel: 'masked_car' | 'generative_fill' = 'masked_car',
  options?: {
    timeoutMs?: number;
    obstructionMinBrightness?: number;
    glareLuminanceThreshold?: number;
  }
): Promise<{
  isBlur: boolean;
  minScore: number;
  worstSector: string;
  isObstruction: boolean;
  avgBrightness: number;
  clippedRatio: number;
  reason?: string;
  status: 'success' | 'skipped' | 'error';
}> {
  const [sharpResult, obsResult] = await Promise.all([
    analyzeImageSharpness(imageUrl, blurThreshold, deliverableModel, options),
    detectBlurAndObstruction(imageUrl, {
      darkThreshold: options?.obstructionMinBrightness,
      glareLuminanceThreshold: options?.glareLuminanceThreshold,
      timeoutMs: options?.timeoutMs
    })
  ]);

  const reasons: string[] = [];
  if (sharpResult.isBlurry && sharpResult.reason) reasons.push(sharpResult.reason);
  if (obsResult.isObstruction && obsResult.reason) reasons.push(obsResult.reason);

  return {
    isBlur: sharpResult.isBlurry,
    minScore: sharpResult.minScore,
    worstSector: sharpResult.worstSector,
    isObstruction: obsResult.isObstruction,
    avgBrightness: obsResult.avgBrightness,
    clippedRatio: obsResult.clippedRatio,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
    status: sharpResult.status
  };
}

function broadcastToMapIframes(payload: any) {
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach(f => {
    try {
      f.contentWindow?.postMessage(payload, '*');
    } catch (err) {
      console.warn('Failed to postMessage to iframe:', err);
    }
  });
}

const DEFAULT_CONFIG: QAQCConfig = {
  checkBlur: true,
  checkObstruction: true,
  checkGps: true
};

const QA_DEFECTS_BATCH_SIZE = 50;

async function persistDefectBatch(
  defects: QADefectRecord[],
  table: string,
  authUser?: { id?: string; email?: string; name?: string }
): Promise<number> {
  let synced = 0;
  for (let i = 0; i < defects.length; i += QA_DEFECTS_BATCH_SIZE) {
    const chunk = defects.slice(i, i + QA_DEFECTS_BATCH_SIZE).map(defectRecord => ({
      subgrid: defectRecord.subgrid,
      point_id: defectRecord.point_id,
      frame_index: defectRecord.frame_index,
      defect_flags: defectRecord.defect_flags,
      defect_type: defectRecord.defect_type,
      pic: defectRecord.pic || authUser?.name || 'Operator',
      user_id: defectRecord.user_id || authUser?.id || null,
      user_email: defectRecord.user_email || authUser?.email || null,
      image_url: defectRecord.image_url,
      lat: defectRecord.lat,
      lng: defectRecord.lng,
      bearing: defectRecord.bearing,
      created_at: defectRecord.created_at,
      updated_at: new Date().toISOString()
    }));
    const { error: upsertErr } = await withRetry(
      async () => {
        const res = await supabase.from(table).upsert(chunk, { onConflict: 'subgrid,point_id' });
        if (res.error) throw new Error(res.error.message);
        return res;
      },
      { retries: 2 }
    ).catch((err) => {
      console.warn('qa_defects batch sync notice:', err);
      try {
        reportWarn(`qa_defects batch sync failed after retries: ${err instanceof Error ? err.message : String(err)}`, 'persistDefectBatch');
      } catch {
        // logging must never break the batch loop
      }
      return { error: { message: String(err), code: 'RETRY_FAILED' } as any, data: null };
    });
    if (upsertErr) {
      console.warn('qa_defects batch sync notice:', upsertErr);
    } else {
      synced += chunk.length;
    }
  }
  return synced;
}

const INITIAL_LIVE_CHECK: LiveCheckStatus = {
  blur: { active: true, status: 'pending' },
  obstruction: { active: true, status: 'pending' },
  gps: { active: true, status: 'pending' }
};

const INITIAL_WORKER_STATE: QAQCWorkerState = {
  isRunning: false,
  isPaused: false,
  isCompleted: false,
  isAborted: false,
  subgrid: '',
  runId: null,
  pic: 'Operator',
  config: DEFAULT_CONFIG,
  stations: [],
  currentIndex: 0,
  totalStations: 0,
  currentPointId: '',
  currentCoords: { lat: 0, lng: 0 },
  currentBearing: 0,
  currentStepDistance: 0,
  currentThumbnail: '',
  liveCheckStatus: INITIAL_LIVE_CHECK,
  defectsList: [],
  history: [],
  syncedCount: 0,
  elapsedSeconds: 0
};

export function useQAQCWorker() {
  const [workerState, setWorkerState] = useState<QAQCWorkerState>(INITIAL_WORKER_STATE);

  const abortRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const isRunningRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(Date.now());
  const workerRef = useRef<Worker | null>(null);
  const accumulatedDefectsRef = useRef<QADefectRecord[]>([]);
  const accumulatedHistoryRef = useRef<StationInspectionRecord[]>([]);
  const runCallbacksRef = useRef<{
    cleanSubgrid: string;
    runId: string | null;
    onProgress?: StartInspectionParams['onProgress'];
    onDefectFound?: StartInspectionParams['onDefectFound'];
    onComplete?: StartInspectionParams['onComplete'];
  } | null>(null);

  // Elapsed timer in background
  useEffect(() => {
    const timer = setInterval(() => {
      if (isRunningRef.current && !isPausedRef.current) {
        setWorkerState(prev => ({
          ...prev,
          elapsedSeconds: Math.floor((Date.now() - startTimeRef.current) / 1000)
        }));
      }
    }, 500);

    return () => clearInterval(timer);
  }, []);

  // Terminate the running worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const pauseInspection = useCallback(() => {
    isPausedRef.current = true;
    workerRef.current?.postMessage({ type: 'PAUSE' } satisfies QaqcWorkerRequest);
    setWorkerState(prev => ({ ...prev, isPaused: true }));
  }, []);

  const resumeInspection = useCallback(() => {
    isPausedRef.current = false;
    workerRef.current?.postMessage({ type: 'RESUME' } satisfies QaqcWorkerRequest);
    setWorkerState(prev => ({ ...prev, isPaused: false }));
  }, []);

  const abortInspection = useCallback(() => {
    abortRef.current = true;
    isPausedRef.current = false;
    isRunningRef.current = false;
    workerRef.current?.postMessage({ type: 'ABORT' } satisfies QaqcWorkerRequest);
    setWorkerState(prev => {
      broadcastToMapIframes({
        type: 'UNLOCK_SUBGRID',
        subgrid: prev.subgrid
      });
      return {
        ...prev,
        isAborted: true,
        isRunning: false,
        isPaused: false
      };
    });
  }, []);

  const resetInspection = useCallback(() => {
    abortRef.current = true;
    isPausedRef.current = false;
    isRunningRef.current = false;
    workerRef.current?.terminate();
    workerRef.current = null;
    accumulatedDefectsRef.current = [];
    accumulatedHistoryRef.current = [];
    runCallbacksRef.current = null;
    setWorkerState(INITIAL_WORKER_STATE);
  }, []);

  const startInspection = useCallback(async (params: StartInspectionParams) => {
    const {
      subgrid,
      runId = null,
      stations,
      config,
      pic = 'Operator',
      authUser,
      projectSettings,
      customThresholds,
      onProgress,
      onDefectFound,
      onComplete
    } = params;

    if (!stations || stations.length === 0) {
      setWorkerState(prev => ({
        ...prev,
        isRunning: false,
        isCompleted: true,
        totalStations: 0,
        subgrid,
        runId
      }));
      if (onComplete) {
        onComplete({
          totalInspected: 0,
          defectsCount: 0,
          defects: [],
          subgrid,
          runId
        });
      }
      return;
    }

    const cleanSubgrid = subgrid.toUpperCase().trim();
    abortRef.current = false;
    isPausedRef.current = false;
    isRunningRef.current = true;
    startTimeRef.current = Date.now();

    const total = stations.length;

    // Precompute per-station point id + resolved image URL on the main thread
    // (resolvePanoramaUrl is a main-thread helper; the worker receives resolved URLs)
    const stationsPayload: QaqcWorkerStationInput[] = stations.map((s, i) => {
      const pointId = s.filename || s.point_id || `${cleanSubgrid}-${String(i + 1).padStart(4, '0')}.jpg`;
      return {
        ...s,
        __pointId: pointId,
        __imageUrl: s.image_url || resolvePanoramaUrl(pointId, projectSettings)
      };
    });

    const thresholds: QaqcWorkerThresholds = {
      blurVarianceThreshold: customThresholds?.blurVarianceThreshold ?? projectSettings?.blurVarianceThreshold ?? 68.0,
      gpsMaxJumpDistanceMeters: customThresholds?.gpsMaxJumpDistanceMeters ?? projectSettings?.gpsMaxJumpDistanceMeters ?? 50.0,
      deliverableModel: customThresholds?.deliverableModel ?? projectSettings?.deliverableModel ?? 'masked_car',
      obstructionMinBrightness: customThresholds?.obstructionMinBrightness ?? projectSettings?.obstructionMinBrightness ?? 15.0,
      glareLuminanceThreshold: customThresholds?.glareLuminanceThreshold ?? projectSettings?.glareLuminanceThreshold ?? 240.0
    };

    accumulatedDefectsRef.current = [];
    accumulatedHistoryRef.current = [];
    runCallbacksRef.current = { cleanSubgrid, runId, onProgress, onDefectFound, onComplete };

    // Initialize worker state
    setWorkerState({
      isRunning: true,
      isPaused: false,
      isCompleted: false,
      isAborted: false,
      subgrid: cleanSubgrid,
      runId,
      pic,
      config,
      stations,
      currentIndex: 0,
      totalStations: total,
      currentPointId: stations[0]?.filename || stations[0]?.point_id || '',
      currentCoords: {
        lat: Number(stations[0]?.latitude ?? stations[0]?.lat ?? 0),
        lng: Number(stations[0]?.longitude ?? stations[0]?.lng ?? stations[0]?.lon ?? 0)
      },
      currentBearing: Number(stations[0]?.bearing ?? stations[0]?.heading ?? 0),
      currentStepDistance: 0,
      currentThumbnail: stations[0]?.image_url || '',
      liveCheckStatus: {
        blur: { active: config.checkBlur, status: config.checkBlur ? 'pending' : 'skipped' },
        obstruction: { active: config.checkObstruction, status: config.checkObstruction ? 'pending' : 'skipped' },
        gps: { active: config.checkGps, status: config.checkGps ? 'pending' : 'skipped' }
      },
      defectsList: [],
      history: [],
      syncedCount: 0,
      elapsedSeconds: 0
    });

    // Broadcast LOCK_SUBGRID to map iframes
    broadcastToMapIframes({
      type: 'LOCK_SUBGRID',
      subgrid: cleanSubgrid,
      pic
    });

    // (Re)create the real analysis worker
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../workers/qaqc.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onerror = (err) => {
      console.error('QA/QC Worker error:', err);
      isRunningRef.current = false;
      abortRef.current = true;
      runCallbacksRef.current = null;
      setWorkerState(prev => ({ ...prev, isRunning: false, isAborted: true }));
    };

    worker.onmessage = (evt: MessageEvent<QaqcWorkerResponse>) => {
      const msg = evt.data;

      if (msg.type === 'STATION') {
        if (abortRef.current) return;
        const runCb = runCallbacksRef.current;

        if (runCb?.onProgress) {
          runCb.onProgress({
            currentIndex: msg.index,
            totalStations: msg.total,
            defectsFound: msg.defectCount,
            currentPointId: msg.pointId,
            subgrid: runCb.cleanSubgrid,
            runId: runCb.runId
          });
        }

        if (msg.defect) {
          accumulatedDefectsRef.current.push(msg.defect);
          broadcastToMapIframes({
            type: 'MAP_POINT_DEFECT',
            pointId: msg.pointId,
            filename: msg.pointId,
            is_defect: true,
            lat: msg.lat || undefined,
            lng: msg.lng || undefined,
            color: '#EF4444'
          });
          broadcastToMapIframes({
            type: 'UPDATE_POINT_DEFECT',
            pointId: msg.pointId,
            filename: msg.pointId,
            is_defect: true,
            color: '#EF4444'
          });
          broadcastToMapIframes({
            type: 'QAQC_DEFECTS_SYNC',
            subgrid: runCb?.cleanSubgrid,
            defects: [...accumulatedDefectsRef.current]
          });
          runCb?.onDefectFound?.(msg.defect, accumulatedDefectsRef.current.length);
        }

        accumulatedHistoryRef.current.push(msg.stationRecord);

        broadcastToMapIframes({
          type: 'MAP_POINT_INSPECTING',
          pointId: msg.pointId,
          lat: msg.lat || undefined,
          lng: msg.lng || undefined,
          bearing: msg.bearing,
          index: msg.index + 1,
          total: msg.total
        });

        // Update real-time hook state
        setWorkerState(prev => ({
          ...prev,
          currentIndex: msg.index,
          currentPointId: msg.pointId,
          currentCoords: { lat: msg.lat, lng: msg.lng },
          currentBearing: msg.bearing,
          currentStepDistance: msg.stepDistance,
          currentThumbnail: msg.thumbnailUrl,
          liveCheckStatus: msg.liveCheckStatus,
          defectsList: [...accumulatedDefectsRef.current],
          history: [...accumulatedHistoryRef.current]
        }));
      } else if (msg.type === 'COMPLETE') {
        if (abortRef.current) return;
        isRunningRef.current = false;

        // Reconciled canonical results from the worker
        accumulatedDefectsRef.current = msg.defects;
        accumulatedHistoryRef.current = msg.history;

        setWorkerState(prev => ({
          ...prev,
          isRunning: false,
          isCompleted: true,
          isPaused: false,
          defectsList: msg.defects,
          history: msg.history,
          syncedCount: 0
        }));

        broadcastToMapIframes({
          type: 'UNLOCK_SUBGRID',
          subgrid: msg.subgrid
        });

        broadcastToMapIframes({
          type: 'QAQC_DEFECTS_SYNC',
          subgrid: msg.subgrid,
          defects: msg.defects
        });

        const onCompleteCb = runCallbacksRef.current?.onComplete;
        runCallbacksRef.current = null;
        if (onCompleteCb) {
          onCompleteCb({
            totalInspected: msg.totalInspected,
            defectsCount: msg.defectsCount,
            defects: msg.defects,
            subgrid: msg.subgrid,
            runId: msg.runId
          });
        }

        // Batch-result persist (single batched upsert at end of run, not per-frame)
        if (msg.defects.length > 0) {
          const qaDefectsTable = projectSettings?.qaDefectsTable || import.meta.env.VITE_DB_QA_DEFECTS_TABLE || DATABASE_TABLE_DEFAULTS.qaDefectsTable;
          void persistDefectBatch(msg.defects, qaDefectsTable, authUser).then(synced => {
            setWorkerState(prev => ({ ...prev, syncedCount: synced }));
          });
        }
      } else if (msg.type === 'ABORTED') {
        isRunningRef.current = false;
        abortRef.current = true;
        runCallbacksRef.current = null;
        setWorkerState(prev => {
          broadcastToMapIframes({
            type: 'UNLOCK_SUBGRID',
            subgrid: prev.subgrid
          });
          return {
            ...prev,
            isRunning: false,
            isAborted: true,
            isPaused: false
          };
        });
      } else if (msg.type === 'ERROR') {
        console.error('QA/QC Worker exception:', msg.message);
        isRunningRef.current = false;
        abortRef.current = true;
        runCallbacksRef.current = null;
        setWorkerState(prev => ({
          ...prev,
          isRunning: false,
          isAborted: true
        }));
      }
    };

    worker.postMessage({
      type: 'START',
      payload: {
        subgrid: cleanSubgrid,
        runId,
        pic,
        config,
        stations: stationsPayload,
        thresholds
      }
    } satisfies QaqcWorkerRequest);
  }, []);

  return {
    workerState,
    startInspection,
    pauseInspection,
    resumeInspection,
    abortInspection,
    resetInspection
  };
}