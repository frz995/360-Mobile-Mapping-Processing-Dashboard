/**
 * Real QA/QC Web Worker (dedicated module worker).
 * Runs the entire per-station inspection loop off the main thread: GPS jump
 * detection, directional multi-quadrant blur / obstruction analysis, defect
 * aggregation and inspection history. The main thread (`useQAQCWorker`) drives
 * this worker via messages and forwards progress to the React UI, so the live
 * workbench view is unchanged while the CPU-heavy scan no longer stutters the
 * UI thread.
 *
 * NOTE: pixel math in `qaqcAnalyzer.ts` is identical whether it runs in a
 * worker or the main thread (image decode uses OffscreenCanvas in workers).
 * The WebGL GPU path self-falls-back to CPU execution off the main thread.
 */

import { analyzeImageSharpness } from '../utils/qaqcAnalyzer';
import { calculateGeodesicDistanceMeters, calculateForwardBearing } from '../utils/geo';
import type { QAQCConfig, QADefectRecord } from '../types/admin';
import type { LiveCheckStatus, StationInspectionRecord } from '../hooks/useQAQCWorker';

export interface QaqcWorkerStationInput {
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
  /** Precomputed on the main thread: `filename || point_id || <subgrid>-NNNN.jpg` */
  __pointId?: string;
  /** Precomputed on the main thread via `resolvePanoramaUrl` (main-thread-only helper) */
  __imageUrl?: string;
}

export interface QaqcWorkerThresholds {
  blurVarianceThreshold: number;
  gpsMaxJumpDistanceMeters: number;
  deliverableModel: 'masked_car' | 'generative_fill';
  obstructionMinBrightness: number;
  glareLuminanceThreshold: number;
}

export interface QaqcWorkerStartPayload {
  subgrid: string;
  runId: string | null;
  pic: string;
  config: QAQCConfig;
  stations: QaqcWorkerStationInput[];
  thresholds: QaqcWorkerThresholds;
}

export type QaqcWorkerRequest =
  | { type: 'START'; payload: QaqcWorkerStartPayload }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'ABORT' };

export interface QaqcStationMessage {
  type: 'STATION';
  index: number;
  total: number;
  pointId: string;
  lat: number;
  lng: number;
  bearing: number;
  stepDistance: number;
  thumbnailUrl: string;
  liveCheckStatus: LiveCheckStatus;
  defect?: QADefectRecord;
  stationRecord: StationInspectionRecord;
  defectCount: number;
}

export interface QaqcCompleteMessage {
  type: 'COMPLETE';
  totalInspected: number;
  defectsCount: number;
  defects: QADefectRecord[];
  history: StationInspectionRecord[];
  subgrid: string;
  runId: string | null;
}

export interface QaqcAbortedMessage {
  type: 'ABORTED';
}

export interface QaqcErrorMessage {
  type: 'ERROR';
  message: string;
}

export type QaqcWorkerResponse =
  | QaqcStationMessage
  | QaqcCompleteMessage
  | QaqcAbortedMessage
  | QaqcErrorMessage;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function publish(response: QaqcWorkerResponse) {
  self.postMessage(response, '*');
}

let aborted = false;
let paused = false;

async function runInspection(payload: QaqcWorkerStartPayload): Promise<void> {
  aborted = false;
  paused = false;

  const { subgrid: rawSubgrid, runId, pic, config, stations, thresholds } = payload;
  const cleanSubgrid = rawSubgrid.toUpperCase().trim();
  const total = stations.length;
  const accumulatedDefects: QADefectRecord[] = [];
  const accumulatedHistory: StationInspectionRecord[] = [];

  const {
    blurVarianceThreshold: blurThreshold,
    gpsMaxJumpDistanceMeters: gpsMaxJumpDistance,
    deliverableModel,
    obstructionMinBrightness: darkThreshold,
    glareLuminanceThreshold: glareThreshold
  } = thresholds;

  try {
    for (let i = 0; i < total; i++) {
      if (aborted) break;

      while (paused && !aborted) {
        await sleep(50);
      }
      if (aborted) break;

      const currStation = stations[i];
      const prevStation = i > 0 ? stations[i - 1] : undefined;

      const ptId = currStation.__pointId || currStation.filename || currStation.point_id || `${cleanSubgrid}-${String(i + 1).padStart(4, '0')}.jpg`;
      const lat = Number(currStation.latitude ?? currStation.lat ?? 0);
      const lng = Number(currStation.longitude ?? currStation.lng ?? currStation.lon ?? 0);

      let bearing = Number(currStation.bearing ?? currStation.heading ?? 0);
      if (!bearing && prevStation) {
        const prevLat = Number(prevStation.latitude ?? prevStation.lat ?? 0);
        const prevLng = Number(prevStation.longitude ?? prevStation.lng ?? prevStation.lon ?? 0);
        if (prevLat && prevLng && lat && lng && (prevLat !== lat || prevLng !== lng)) {
          bearing = calculateForwardBearing(prevLat, prevLng, lat, lng);
        }
      }

      const imgUrl = currStation.__imageUrl || currStation.image_url || ptId;

      const currentLiveCheck: LiveCheckStatus = {
        blur: { active: config.checkBlur, status: config.checkBlur ? 'checking' : 'skipped' },
        obstruction: { active: config.checkObstruction, status: config.checkObstruction ? 'checking' : 'skipped' },
        gps: { active: config.checkGps, status: config.checkGps ? 'checking' : 'skipped' }
      };

      // 1. Geodesic GPS Distance & Jump Check
      let isBadGps = false;
      let gpsReason = '';
      let stepDist = 0;

      if (config.checkGps) {
        const hasValidCoords = lat !== 0 && lng !== 0 && !isNaN(lat) && !isNaN(lng);
        if (!hasValidCoords) {
          isBadGps = true;
          gpsReason = 'Missing or zero GPS coordinates';
        } else if (prevStation) {
          const prevLat = Number(prevStation.latitude ?? prevStation.lat ?? 0);
          const prevLng = Number(prevStation.longitude ?? prevStation.lng ?? prevStation.lon ?? 0);
          if (prevLat && prevLng) {
            stepDist = calculateGeodesicDistanceMeters(prevLat, prevLng, lat, lng);
            if (stepDist > gpsMaxJumpDistance) {
              isBadGps = true;
              gpsReason = `GPS Jump Detected (${stepDist.toFixed(1)}m > ${gpsMaxJumpDistance}m)`;
            }
          }
        }

        currentLiveCheck.gps = {
          active: true,
          status: isBadGps ? 'flagged' : 'passed',
          detail: isBadGps ? gpsReason : `${stepDist.toFixed(1)}m step`
        };
      }

      // 2. Directional Multi-Quadrant Blur & Obstruction Check (Single Fast Pass)
      let isBlur = false;
      let isObstruction = false;
      let isSkippedImg = false;
      let blurDetail = '';
      let obstructionDetail = '';
      let blurVariance = 50.0;
      let avgBrightness = 128.0;

      if ((config.checkBlur || config.checkObstruction) && imgUrl) {
        const analysis = await analyzeImageSharpness(imgUrl, blurThreshold, deliverableModel, {
          timeoutMs: 4000,
          darkThreshold,
          glareThreshold
        });

        if (analysis.status === 'skipped') {
          isSkippedImg = true;
          blurVariance = 0;
          currentLiveCheck.blur = {
            active: true,
            status: 'skipped',
            detail: `SKIPPED (${analysis.reason || 'Timeout'})`
          };
          currentLiveCheck.obstruction = {
            active: true,
            status: 'skipped',
            detail: `SKIPPED (${analysis.reason || 'Timeout'})`
          };
        } else {
          if (config.checkBlur) {
            isBlur = analysis.isBlurry;
            blurVariance = analysis.minScore;
            if (isBlur) {
              blurDetail = analysis.reason || `Blurry Frame in ${analysis.worstSector} sector (Sharpness score ${blurVariance.toFixed(1)} below threshold ${blurThreshold.toFixed(1)})`;
            } else if (blurVariance < 55.0) {
              blurDetail = `Sharp ${blurVariance.toFixed(1)} (Marginal)`;
            } else {
              blurDetail = `Sharp ${blurVariance.toFixed(1)}`;
            }
            currentLiveCheck.blur = {
              active: true,
              status: isBlur ? 'flagged' : 'passed',
              detail: blurDetail
            };
          }

          if (config.checkObstruction) {
            isObstruction = analysis.isObstruction;
            avgBrightness = analysis.avgBrightness;
            obstructionDetail = isObstruction ? (analysis.obstructionReason || `Luma ${avgBrightness.toFixed(1)}`) : `Luma ${avgBrightness.toFixed(1)}`;
            currentLiveCheck.obstruction = {
              active: true,
              status: isObstruction ? 'flagged' : 'passed',
              detail: obstructionDetail
            };
          }
        }
      }

      // 3. Defect Aggregation & Recording
      const hasDefect = isBadGps || isBlur || isObstruction;
      let defectType = '';
      let defectRecord: QADefectRecord | undefined;

      if (hasDefect) {
        const reasonsList: string[] = [];
        if (isBadGps) reasonsList.push('Bad GPS Signal');
        if (isBlur) reasonsList.push('Blurry Frame');
        if (isObstruction) reasonsList.push('Lens Obstruction');
        defectType = reasonsList.join(' + ');

        defectRecord = {
          subgrid: cleanSubgrid,
          point_id: ptId,
          frame_index: i + 1,
          defect_flags: {
            blur: isBlur,
            obstruction: isObstruction,
            badGps: isBadGps,
            blurVariance,
            avgBrightness,
            stepDistanceMeters: stepDist,
            deliverableModel,
            reasons: [gpsReason, blurDetail, obstructionDetail].filter(Boolean)
          },
          defect_type: defectType,
          pic,
          image_url: imgUrl,
          lat: lat || undefined,
          lng: lng || undefined,
          bearing: bearing || undefined,
          created_at: new Date().toISOString()
        };

        accumulatedDefects.push(defectRecord);
      }

      // 4. Inspection History Record
      const nodeStatus: 'flagged' | 'skipped' | 'passed' = hasDefect ? 'flagged' : (isSkippedImg ? 'skipped' : 'passed');
      const stationRecord: StationInspectionRecord = {
        index: i + 1,
        pointId: ptId,
        lat,
        lng,
        bearing,
        stepDistance: stepDist,
        thumbnailUrl: imgUrl,
        status: nodeStatus,
        blurVariance,
        avgBrightness,
        isBadGps,
        isBlur,
        isObstruction,
        defectType: hasDefect ? defectType : undefined,
        deliverableModel,
        reasons: [gpsReason, blurDetail, obstructionDetail].filter(Boolean),
        timestamp: new Date().toLocaleTimeString()
      };

      accumulatedHistory.push(stationRecord);

      publish({
        type: 'STATION',
        index: i,
        total,
        pointId: ptId,
        lat,
        lng,
        bearing,
        stepDistance: stepDist,
        thumbnailUrl: imgUrl,
        liveCheckStatus: currentLiveCheck,
        defect: defectRecord,
        stationRecord,
        defectCount: accumulatedDefects.length
      });
    }

    if (!aborted) {
      publish({
        type: 'COMPLETE',
        totalInspected: total,
        defectsCount: accumulatedDefects.length,
        defects: accumulatedDefects,
        history: accumulatedHistory,
        subgrid: cleanSubgrid,
        runId
      });
    } else {
      publish({ type: 'ABORTED' });
    }
  } catch (err) {
    publish({ type: 'ERROR', message: (err as Error)?.message || String(err) });
  }
}

self.onmessage = (event: MessageEvent<QaqcWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'START') {
    void runInspection(message.payload);
  } else if (message.type === 'PAUSE') {
    paused = true;
  } else if (message.type === 'RESUME') {
    paused = false;
  } else if (message.type === 'ABORT') {
    aborted = true;
  }
};