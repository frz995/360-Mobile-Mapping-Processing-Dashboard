import { useState, useRef, useEffect, useCallback } from 'react';
import type { ExtendedProjectSettings, QADefectRecord, QAQCConfig } from '../types/admin';
import { analyzeImageSharpness, detectBlurAndObstruction } from '../utils/qaqcAnalyzer';
import { resolvePanoramaUrl, supabase } from '../services/supabase';

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
  blurVarianceThreshold?: number; // default: 68.0
  gpsMaxJumpDistanceMeters?: number; // default: 50.0
  glareLuminanceThreshold?: number; // default: 240.0
  obstructionMinBrightness?: number; // default: 15.0
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
  stepIntervalMs?: number;
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
 * Calculates geodesic distance in meters between two lat/lng coordinates using the Haversine formula.
 */
export function calculateGeodesicDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;

  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculates geodesic forward azimuth / bearing in degrees [0, 360) between two coordinates.
 */
export function calculateForwardBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(radLat2);
  const x =
    Math.cos(radLat1) * Math.sin(radLat2) -
    Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(dLon);

  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
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

export function useQAQCWorker() {
  const [workerState, setWorkerState] = useState<QAQCWorkerState>({
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
    liveCheckStatus: {
      blur: { active: true, status: 'pending' },
      obstruction: { active: true, status: 'pending' },
      gps: { active: true, status: 'pending' }
    },
    defectsList: [],
    history: [],
    syncedCount: 0,
    elapsedSeconds: 0
  });

  const abortRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const isRunningRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(Date.now());

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

  const pauseInspection = useCallback(() => {
    isPausedRef.current = true;
    setWorkerState(prev => ({ ...prev, isPaused: true }));
  }, []);

  const resumeInspection = useCallback(() => {
    isPausedRef.current = false;
    setWorkerState(prev => ({ ...prev, isPaused: false }));
  }, []);

  const abortInspection = useCallback(() => {
    abortRef.current = true;
    isPausedRef.current = false;
    isRunningRef.current = false;
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
    setWorkerState({
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
      liveCheckStatus: {
        blur: { active: true, status: 'pending' },
        obstruction: { active: true, status: 'pending' },
        gps: { active: true, status: 'pending' }
      },
      defectsList: [],
      history: [],
      syncedCount: 0,
      elapsedSeconds: 0
    });
  }, []);

  const startInspection = useCallback(async (params: StartInspectionParams) => {
    const {
      subgrid,
      runId = null,
      stations,
      config,
      stepIntervalMs = 250,
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
    const accumulatedDefects: QADefectRecord[] = [];
    const accumulatedHistory: StationInspectionRecord[] = [];

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

    try {
      // Broadcast LOCK_SUBGRID to map iframes
      broadcastToMapIframes({
        type: 'LOCK_SUBGRID',
        subgrid: cleanSubgrid,
        pic
      });

      for (let i = 0; i < total; i++) {
        if (abortRef.current) break;

        while (isPausedRef.current && !abortRef.current) {
          await new Promise(r => setTimeout(r, 100));
        }

        if (abortRef.current) break;

        const currStation = stations[i];
        const prevStation = i > 0 ? stations[i - 1] : undefined;

        const ptId = currStation.filename || currStation.point_id || `${cleanSubgrid}-${String(i + 1).padStart(4, '0')}.jpg`;
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

        const imgUrl = currStation.image_url || resolvePanoramaUrl(ptId, projectSettings);

        // Progress callback
        if (onProgress) {
          onProgress({
            currentIndex: i,
            totalStations: total,
            defectsFound: accumulatedDefects.length,
            currentPointId: ptId,
            subgrid: cleanSubgrid,
            runId
          });
        }

        const currentLiveCheck: LiveCheckStatus = {
          blur: { active: config.checkBlur, status: config.checkBlur ? 'checking' : 'skipped' },
          obstruction: { active: config.checkObstruction, status: config.checkObstruction ? 'checking' : 'skipped' },
          gps: { active: config.checkGps, status: config.checkGps ? 'checking' : 'skipped' }
        };

        // QA/QC Thresholds from Custom Overrides or Project Settings
        const blurThreshold = customThresholds?.blurVarianceThreshold ?? projectSettings?.blurVarianceThreshold ?? 68.0;
        const gpsMaxJumpDistance = customThresholds?.gpsMaxJumpDistanceMeters ?? projectSettings?.gpsMaxJumpDistanceMeters ?? 50.0;
        const deliverableModel = customThresholds?.deliverableModel ?? projectSettings?.deliverableModel ?? 'masked_car';
        const darkThreshold = customThresholds?.obstructionMinBrightness ?? projectSettings?.obstructionMinBrightness ?? 15.0;
        const glareThreshold = customThresholds?.glareLuminanceThreshold ?? projectSettings?.glareLuminanceThreshold ?? 240.0;

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
          const analysis = await detectBlurAndObstruction(imgUrl, {
            blurThreshold,
            darkThreshold,
            glareLuminanceThreshold: glareThreshold,
            timeoutMs: 2500,
            thresholds: {
              blurVarianceThreshold: blurThreshold,
              obstructionMinBrightness: darkThreshold,
              glareLuminanceThreshold: glareThreshold,
              deliverableModel
            }
          });

          if (analysis.analysisStatus === 'skipped') {
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
              isBlur = analysis.isBlur;
              blurVariance = analysis.blurVariance;
              if (isBlur) {
                blurDetail = analysis.reason || `Blurry Frame (${blurVariance.toFixed(1)} below threshold ${blurThreshold.toFixed(1)})`;
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
              obstructionDetail = isObstruction ? (analysis.reason || `Luma ${avgBrightness.toFixed(1)}`) : `Luma ${avgBrightness.toFixed(1)}`;
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

        if (hasDefect) {
          const reasonsList: string[] = [];
          if (isBadGps) reasonsList.push('Bad GPS Signal');
          if (isBlur) reasonsList.push('Blurry Frame');
          if (isObstruction) reasonsList.push('Lens Obstruction');
          defectType = reasonsList.join(' + ');

          const defectRecord: QADefectRecord = {
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

          // Broadcast defect marker to map
          broadcastToMapIframes({
            type: 'MAP_POINT_DEFECT',
            pointId: ptId,
            filename: ptId,
            is_defect: true,
            lat: lat || undefined,
            lng: lng || undefined,
            color: '#EF4444'
          });
          broadcastToMapIframes({
            type: 'UPDATE_POINT_DEFECT',
            pointId: ptId,
            filename: ptId,
            is_defect: true
          });

          if (onDefectFound) {
            onDefectFound(defectRecord, accumulatedDefects.length);
          }

          // Asynchronously upsert defect to Supabase without blocking the loop
          (async () => {
            try {
              const qaDefectsTable = projectSettings?.qaDefectsTable || import.meta.env.VITE_DB_QA_DEFECTS_TABLE || 'qa_defects';
              const { error: upsertErr } = await supabase.from(qaDefectsTable).upsert({
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
              }, { onConflict: 'subgrid,point_id' });

              if (!upsertErr) {
                setWorkerState(prev => ({ ...prev, syncedCount: prev.syncedCount + 1 }));
              }
            } catch (err) {
              console.warn('qa_defects sync notice:', err);
            }
          })();
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

        // Update real-time hook state
        setWorkerState(prev => ({
          ...prev,
          currentIndex: i,
          currentPointId: ptId,
          currentCoords: { lat, lng },
          currentBearing: bearing,
          currentStepDistance: stepDist,
          currentThumbnail: imgUrl,
          liveCheckStatus: currentLiveCheck,
          defectsList: [...accumulatedDefects],
          history: [...accumulatedHistory]
        }));

        // Broadcast active node inspection to maps
        broadcastToMapIframes({
          type: 'MAP_POINT_INSPECTING',
          pointId: ptId,
          lat: lat || undefined,
          lng: lng || undefined,
          bearing,
          index: i + 1,
          total
        });

        // Step pacing interval
        if (stepIntervalMs > 0 && i < total - 1) {
          await new Promise(r => setTimeout(r, stepIntervalMs));
        }
      }

      // Complete inspection run
      if (!abortRef.current) {
        setWorkerState(prev => ({
          ...prev,
          isRunning: false,
          isCompleted: true,
          isPaused: false
        }));

        broadcastToMapIframes({
          type: 'UNLOCK_SUBGRID',
          subgrid: cleanSubgrid
        });

        broadcastToMapIframes({
          type: 'QAQC_DEFECTS_SYNC',
          subgrid: cleanSubgrid,
          defects: accumulatedDefects
        });

        if (onComplete) {
          onComplete({
            totalInspected: total,
            defectsCount: accumulatedDefects.length,
            defects: accumulatedDefects,
            subgrid: cleanSubgrid,
            runId
          });
        }
      } else {
        setWorkerState(prev => ({
          ...prev,
          isRunning: false,
          isAborted: true
        }));
      }
    } catch (err) {
      console.error('QA/QC Worker exception:', err);
      setWorkerState(prev => ({
        ...prev,
        isRunning: false,
        isAborted: true
      }));
    } finally {
      isRunningRef.current = false;
      broadcastToMapIframes({
        type: 'UNLOCK_SUBGRID',
        subgrid: cleanSubgrid
      });
    }
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
