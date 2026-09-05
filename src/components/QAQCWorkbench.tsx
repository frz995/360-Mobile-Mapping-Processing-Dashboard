import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
  StopCircle,
  ShieldCheck,
  Navigation,
  Compass,
  ChevronLeft,
  ChevronRight,
  Database,
  Minimize2,
  X,
  Crosshair,
  Layers,
  Search,
  RotateCcw,
  Download,
  FileSpreadsheet,
  SlidersHorizontal,
  User,
  Calendar,
  Camera,
  Clock,
  MapPin,
  Columns,
  Rows,
  Zap,
  Cpu,
  Map as MapIcon,
  Maximize2,
  Minimize
} from 'lucide-react';
import type { QAQCWorkerState, StationInspectionRecord, StationNode } from '../hooks/useQAQCWorker';
import type { QAQCConfig, ExtendedProjectSettings, QADefectRecord } from '../types/admin';
import { saveProjectSettingsToSupabase, resolvePanoramaUrl, resolvePanoramaConfigUrl, SUBGRID_COORDINATES } from '../services/supabase';
import { PhotoSphereViewerComponent, type PhotoSphereViewerHandle } from './PhotoSphereViewerComponent';
import { usePanoramaViewer } from '../hooks/usePanoramaViewer';
import { isGpuAccelerationSupported, getGpuHardwareName } from '../utils/qaqcAnalyzer';
import { QAQCThresholdStudioView } from './QAQCThresholdStudioModal';
import { extractSubgridName } from '../utils/subgrid';
import { DEFAULT_BASEMAP } from '../config/defaults';
import {
  getImagesProcessedCount,
  formatDisplayDate,
  formatBatchIdDisplay,
  reconcileBatchLogs,
  getItemId
} from '../App';

export interface AuditRunRecord {
  subgrid: string;
  runId: string | null;
  totalStations: number;
  defectCount: number;
  meanTenengradScore: number;
  passRate: number;
  elapsedSeconds: number;
  completedAt: string;
  pic: string;
  history: StationInspectionRecord[];
  defectsList: (StationInspectionRecord | QADefectRecord)[];
  isSignedOff?: boolean;
}

export interface QAQCWorkbenchProps {
  isOpen: boolean;
  workerState: QAQCWorkerState;
  dailyData?: any[];
  batchLogs?: any[];
  projectSettings?: ExtendedProjectSettings;
  qaqcAuditRuns?: Record<string, any>;
  defectsList?: any[];
  activeUserName?: string;
  surveyDate?: string;
  initialSubgrid?: string;
  initialRunId?: string | null;
  getStationsForSubgrid: (subgrid: string, runId?: string | null) => StationNode[];
  onStartInspection: (params: {
    subgrid: string;
    runId?: string | null;
    stations: StationNode[];
    config: QAQCConfig;
    pic: string;
    customThresholds?: {
      blurVarianceThreshold?: number;
      gpsMaxJumpDistanceMeters?: number;
      obstructionMinBrightness?: number;
      glareLuminanceThreshold?: number;
      deliverableModel?: 'masked_car' | 'generative_fill';
    };
  }) => void;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onClose: () => void;
  onOpenDefectsGallery?: (subgrid: string) => void;
  onSignOffAndPublish?: (subgrid: string, runId?: string | null) => Promise<void> | void;
}

interface TargetDatasetItem {
  raw: any;
  runId: string | null;
  subgrid: string;
  batchId?: string;
  date: string;
  rawDate: any;
  frameCount: number;
  poiCount?: number;
  km: number;
  pic: string;
  defectCount: number;
  qaqcStatus: string;
  isPublished: boolean;
  publishStatus: 'published' | 'staging' | 'recheck';
  status?: 'Complete' | 'Ongoing';
}

export const QAQCWorkbench: React.FC<QAQCWorkbenchProps> = ({
  isOpen,
  workerState,
  dailyData = [],
  batchLogs = [],
  projectSettings,
  qaqcAuditRuns = {},
  defectsList = [],
  activeUserName = 'Operator',
  surveyDate,
  initialSubgrid,
  initialRunId,
  getStationsForSubgrid,
  onStartInspection,
  onPause,
  onResume,
  onAbort,
  onClose,
  onOpenDefectsGallery,
  onSignOffAndPublish,
}) => {
  // Load saved dynamic environment state
  const savedState = useMemo(() => {
    try {
      const raw = localStorage.getItem('GEOSPHERE_QAQC_LAST_STATE');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const [targetTab, setTargetTab] = useState<'daily' | 'masterlist'>(() => {
    if (initialRunId) return 'daily';
    if (savedState?.targetTab) return savedState.targetTab;
    return 'masterlist';
  });
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'staging' | 'published'>(() => {
    return savedState?.categoryFilter || 'all';
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    return savedState?.searchQuery || '';
  });
  const [showOnlyWithFrames, setShowOnlyWithFrames] = useState<boolean>(() => {
    return savedState?.showOnlyWithFrames || false;
  });

  const [selectedSubgrid, setSelectedSubgrid] = useState<string>(() => {
    if (initialSubgrid) return initialSubgrid;
    return savedState?.selectedSubgrid || '';
  });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => {
    if (initialRunId !== undefined) return initialRunId;
    return savedState?.selectedRunId ?? null;
  });

  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  useEffect(() => {
    if (initialSubgrid) setSelectedSubgrid(initialSubgrid);
    if (initialRunId !== undefined) {
      setSelectedRunId(initialRunId);
      if (initialRunId) setTargetTab('daily');
    }
  }, [initialSubgrid, initialRunId]);

  const [config, setConfig] = useState<QAQCConfig>(() => {
    return savedState?.config || {
      checkBlur: true,
      checkObstruction: true,
      checkGps: true
    };
  });
  const [inspectorPic, setInspectorPic] = useState<string>(() => {
    return activeUserName || savedState?.inspectorPic || 'Operator';
  });

  const [viewportMode, setViewportMode] = useState<'horizontal' | 'vertical' | 'pip' | 'full'>(() => {
    return savedState?.viewportMode || 'horizontal';
  });
  const [isPipCollapsed, setIsPipCollapsed] = useState<boolean>(() => {
    return savedState?.isPipCollapsed || false;
  });
  const mapIframeRef = useRef<HTMLIFrameElement | null>(null);
  const psvRef = useRef<PhotoSphereViewerHandle | null>(null);
  const [_isMapReady, setIsMapReady] = useState<boolean>(false);

  const [selectedStationIndex, setSelectedStationIndex] = useState<number | null>(() => {
    return typeof savedState?.selectedStationIndex === 'number' ? savedState.selectedStationIndex : null;
  });
  const [filterMode, setFilterMode] = useState<'all' | 'flagged'>(() => {
    return savedState?.filterMode || 'all';
  });

  const [workbenchTab, setWorkbenchTab] = useState<'console' | 'thresholds' | 'audit'>(() => {
    return savedState?.workbenchTab || 'console';
  });
  const [mobileConsoleTab, setMobileConsoleTab] = useState<'canvas' | 'targets' | 'telemetry'>('canvas');
  const [auditLogFilter, setAuditLogFilter] = useState<'all' | 'flagged' | 'passed'>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');

  // Persist dynamic environment state so user can resume last state on minimize or reopen
  useEffect(() => {
    try {
      const stateToSave = {
        targetTab,
        categoryFilter,
        searchQuery,
        showOnlyWithFrames,
        selectedSubgrid,
        selectedRunId,
        selectedStationIndex,
        viewportMode,
        isPipCollapsed,
        filterMode,
        workbenchTab,
        config,
        inspectorPic
      };
      localStorage.setItem('GEOSPHERE_QAQC_LAST_STATE', JSON.stringify(stateToSave));
    } catch { }
  }, [
    targetTab,
    categoryFilter,
    searchQuery,
    showOnlyWithFrames,
    selectedSubgrid,
    selectedRunId,
    selectedStationIndex,
    viewportMode,
    isPipCollapsed,
    filterMode,
    workbenchTab,
    config,
    inspectorPic
  ]);

  const [localThresholds, setLocalThresholds] = useState<{
    blurVarianceThreshold: number;
    gpsMaxJumpDistanceMeters: number;
    obstructionMinBrightness: number;
    glareLuminanceThreshold: number;
    deliverableModel?: 'masked_car' | 'generative_fill';
  }>(() => ({
    blurVarianceThreshold: projectSettings?.blurVarianceThreshold ?? 68.0,
    gpsMaxJumpDistanceMeters: projectSettings?.gpsMaxJumpDistanceMeters ?? 50.0,
    obstructionMinBrightness: projectSettings?.obstructionMinBrightness ?? 15.0,
    glareLuminanceThreshold: projectSettings?.glareLuminanceThreshold ?? 240.0,
    deliverableModel: projectSettings?.deliverableModel ?? 'masked_car'
  }));

  const {
    shouldUseMultiRes,
    viewerDisplayName,
    engineName: viewerEngineName
  } = usePanoramaViewer(projectSettings);

  useEffect(() => {
    if (projectSettings) {
      setLocalThresholds({
        blurVarianceThreshold: projectSettings?.blurVarianceThreshold ?? 68.0,
        gpsMaxJumpDistanceMeters: projectSettings?.gpsMaxJumpDistanceMeters ?? 50.0,
        obstructionMinBrightness: projectSettings?.obstructionMinBrightness ?? 15.0,
        glareLuminanceThreshold: projectSettings?.glareLuminanceThreshold ?? 240.0,
        deliverableModel: projectSettings?.deliverableModel ?? 'masked_car'
      });
    }
  }, [projectSettings?.blurVarianceThreshold, projectSettings?.gpsMaxJumpDistanceMeters, projectSettings?.obstructionMinBrightness, projectSettings?.glareLuminanceThreshold, projectSettings?.deliverableModel]);

  const handleSaveThresholds = (updated: typeof localThresholds) => {
    setLocalThresholds(updated);
    const updatedSettings = {
      ...(projectSettings || {}),
      ...updated
    };
    saveProjectSettingsToSupabase(updatedSettings).catch(() => { });
  };

  const handleResetThresholds = () => {
    const defaults = {
      blurVarianceThreshold: 68.0,
      gpsMaxJumpDistanceMeters: 50.0,
      obstructionMinBrightness: 15.0,
      glareLuminanceThreshold: 240.0,
      deliverableModel: (projectSettings?.deliverableModel || 'masked_car') as 'masked_car' | 'generative_fill'
    };
    setLocalThresholds(defaults);
    const updatedSettings = {
      ...(projectSettings || {}),
      ...defaults
    };
    saveProjectSettingsToSupabase(updatedSettings).catch(() => { });
  };

  const [localAuditRuns, setLocalAuditRuns] = useState<Record<string, AuditRunRecord>>({});
  const auditCache = useMemo<Record<string, AuditRunRecord>>(() => {
    return {
      ...(qaqcAuditRuns || {}),
      ...localAuditRuns
    };
  }, [qaqcAuditRuns, localAuditRuns]);

  const {
    subgrid: activeRunningSubgrid,
    pic: activeRunningPic,
    currentIndex,
    totalStations: rawTotalStations,
    currentPointId,
    currentCoords,
    currentBearing,
    currentStepDistance,
    currentThumbnail,
    liveCheckStatus,
    defectsList: liveDefectsList,
    history: liveHistory,
    syncedCount,
    elapsedSeconds,
    isRunning,
    isPaused,
    isCompleted,
    isAborted
  } = workerState;

  useEffect(() => {
    if (activeUserName && (!inspectorPic || inspectorPic === 'Operator')) {
      setInspectorPic(activeUserName);
    }
  }, [activeUserName]);

  useEffect(() => {
    if (isCompleted && activeRunningSubgrid && liveHistory.length > 0) {
      const cacheKey = `${activeRunningSubgrid.toUpperCase()}_${workerState.runId || 'default'}`;
      const total = liveHistory.length;
      const defectCount = liveDefectsList.length;
      const passRate = total > 0 ? Math.round(((total - defectCount) / total) * 100) : 100;
      const totalScore = liveHistory.reduce((acc, h) => acc + (h.blurVariance || 0), 0);
      const meanTenengradScore = total > 0 ? Math.round((totalScore / total) * 10) / 10 : 0;

      const record: AuditRunRecord = {
        subgrid: activeRunningSubgrid,
        runId: workerState.runId || null,
        totalStations: total,
        defectCount,
        meanTenengradScore,
        passRate,
        elapsedSeconds,
        completedAt: new Date().toLocaleTimeString(),
        pic: activeRunningPic || inspectorPic,
        history: liveHistory,
        defectsList: liveDefectsList
      };

      setLocalAuditRuns(prev => {
        const next = {
          ...prev,
          [cacheKey]: record,
          [`${activeRunningSubgrid.toUpperCase()}_default`]: record
        };
        window.dispatchEvent(new CustomEvent('qaqc_audit_updated', { detail: { cacheKey, record } }));
        return next;
      });
    }
  }, [isCompleted, activeRunningSubgrid, liveHistory, liveDefectsList, elapsedSeconds, activeRunningPic, inspectorPic, workerState.runId]);

  const processedDailyRuns: TargetDatasetItem[] = useMemo(() => {
    return [...dailyData]
      .reverse()
      .map((d) => {
        const sg = (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim();
        const runId = getItemId(d);
        const frameCount = getImagesProcessedCount(d);
        const km = d.kmProcessed ? Number(d.kmProcessed) : 0;
        const formattedDate = formatDisplayDate(d.date);
        const pic = (d.pic && d.pic.trim().toLowerCase() !== 'unassigned') ? d.pic : (activeUserName || 'Operator');

        const cachedAuditRecord = (runId ? auditCache[`${sg}_${runId}`] : undefined) || auditCache[`${sg}_default`] || Object.entries(auditCache).find(([k]) => k.startsWith(`${sg}_`))?.[1];
        let parsedDefects: number | undefined;
        let defectCount = (typeof d.defectCount === 'number')
          ? d.defectCount
          : (typeof d.imagesDefected === 'number')
            ? d.imagesDefected
            : 0;

        if (defectCount === 0 && cachedAuditRecord && typeof cachedAuditRecord.defectCount === 'number') {
          defectCount = cachedAuditRecord.defectCount;
        }
        if (defectCount === 0 && parsedDefects !== undefined && parsedDefects > 0) {
          defectCount = parsedDefects;
        }
        if (frameCount > 0) {
          defectCount = Math.min(defectCount, frameCount);
        }

        const isPublished = d.publishToWebGIS === 'yes' || d.publishToUSVPRO === 'yes' || Boolean(d.isSyncedWithSupabase) || d.isFromSupabase === true;
        const isRecheck = d.publishToWebGIS === 'need to recheck';
        const publishStatus: 'published' | 'staging' | 'recheck' = isPublished ? 'published' : isRecheck ? 'recheck' : 'staging';

        const qaqcStatus = frameCount === 0
          ? (isPublished ? 'QA/QC Approved' : '')
          : (d.qaqcStatus || (cachedAuditRecord || defectCount > 0 ? `QAQC Completed (${defectCount} Defect${defectCount === 1 ? '' : 's'} Found)` : isPublished ? 'QA/QC Approved' : ''));

        const poiCount = typeof d.poiCount === 'number' ? d.poiCount : (d.panoramas ? d.panoramas.length : frameCount);

        return {
          raw: d,
          runId,
          subgrid: sg,
          date: formattedDate,
          rawDate: d.date,
          frameCount,
          poiCount,
          km,
          pic,
          defectCount,
          qaqcStatus,
          isPublished,
          publishStatus
        };
      });
  }, [dailyData, auditCache, activeUserName]);

  const processedBatchLogs: TargetDatasetItem[] = useMemo(() => {
    const reconciled = reconcileBatchLogs(dailyData, batchLogs);
    const sourceBatches = reconciled && reconciled.length > 0 ? reconciled : batchLogs;

    return sourceBatches.map((b, idx) => {
      const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const frameCount = getImagesProcessedCount(b);
      const poiCount = typeof b.poiCount === 'number' ? b.poiCount : (b.panoramas ? b.panoramas.length : frameCount);
      const km = b.kmProcessed ? Number(b.kmProcessed) : 0;
      const formattedBatchId = formatBatchIdDisplay(b, idx);
      const pic = (b.pic && b.pic.trim().toLowerCase() !== 'unassigned') ? b.pic : ((b as any).adminPic || activeUserName || 'Admin');
      const formattedDate = formatDisplayDate(b.date);

      const cachedAuditRecord = auditCache[`${sg}_default`] || Object.entries(auditCache).find(([k]) => k.startsWith(`${sg}_`))?.[1];
      let parsedDefects: number | undefined;
      if (b.qaqcStatus) {
        const m = b.qaqcStatus.match(/(\d+)\s+Defect/i);
        if (m) parsedDefects = parseInt(m[1], 10);
      }

      let defectCount = typeof b.defects === 'number' ? b.defects : 0;
      if (defectCount === 0 && cachedAuditRecord && typeof cachedAuditRecord.defectCount === 'number') {
        defectCount = cachedAuditRecord.defectCount;
      }
      if (defectCount === 0 && parsedDefects !== undefined && parsedDefects > 0) {
        defectCount = parsedDefects;
      }
      if (frameCount > 0) {
        defectCount = Math.min(defectCount, frameCount);
      }

      const isRecheck = b.publishToWebGIS === 'need to recheck';
      const isPublished = (b.publishToWebGIS === 'yes' || b.publishToUSVPRO === 'yes' || Boolean(b.isSyncedWithSupabase) || b.isFromSupabase === true) && !isRecheck;
      const publishStatus: 'published' | 'staging' | 'recheck' = isPublished ? 'published' : isRecheck ? 'recheck' : 'staging';

      return {
        raw: b,
        runId: null,
        subgrid: sg,
        batchId: formattedBatchId,
        date: formattedDate,
        rawDate: b.date,
        frameCount,
        poiCount,
        km,
        pic,
        defectCount,
        qaqcStatus: b.qaqcStatus || (cachedAuditRecord || defectCount > 0 ? `QAQC Completed (${defectCount} Defect${defectCount === 1 ? '' : 's'} Found)` : isPublished ? 'QA/QC Approved' : ''),
        isPublished,
        publishStatus,
        status: b.status === 'Complete' || b.status === 'Ongoing' ? b.status : (isPublished ? 'Complete' : 'Ongoing')
      };
    });
  }, [dailyData, batchLogs, auditCache, activeUserName]);

  const isListedPublished = (item: TargetDatasetItem) =>
    targetTab === 'masterlist' ? item.status === 'Complete' : item.isPublished;

  const stagingCount = useMemo(() => {
    const list = targetTab === 'daily' ? processedDailyRuns : processedBatchLogs;
    return list.filter(i => !isListedPublished(i)).length;
  }, [targetTab, processedDailyRuns, processedBatchLogs]);

  const publishedCount = useMemo(() => {
    const list = targetTab === 'daily' ? processedDailyRuns : processedBatchLogs;
    return list.filter(i => isListedPublished(i)).length;
  }, [targetTab, processedDailyRuns, processedBatchLogs]);

  useEffect(() => {
    if (initialSubgrid && !selectedSubgrid && !isRunning) {
      const matchInitial = processedDailyRuns.find(r => (initialRunId && r.runId === initialRunId) || (r.subgrid.toUpperCase() === initialSubgrid.toUpperCase() && r.frameCount > 0));
      if (matchInitial) {
        setSelectedSubgrid(matchInitial.subgrid);
        setSelectedRunId(initialRunId || matchInitial.runId);
        if (matchInitial.pic && matchInitial.pic !== 'Unassigned') {
          setInspectorPic(matchInitial.pic);
        }
      }
    }
  }, [processedDailyRuns, selectedSubgrid, isRunning, initialSubgrid, initialRunId]);

  const filteredTargetList: TargetDatasetItem[] = useMemo(() => {
    let list = targetTab === 'daily' ? processedDailyRuns : processedBatchLogs;
    if (categoryFilter === 'staging') {
      list = list.filter(item => !isListedPublished(item));
    } else if (categoryFilter === 'published') {
      list = list.filter(item => isListedPublished(item));
    }
    if (showOnlyWithFrames) {
      list = list.filter(item => item.frameCount > 0);
    }
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(item =>
      item.subgrid.toLowerCase().includes(q) ||
      item.date.toLowerCase().includes(q) ||
      item.pic.toLowerCase().includes(q)
    );
  }, [targetTab, processedDailyRuns, processedBatchLogs, categoryFilter, searchQuery, showOnlyWithFrames]);

  const selectedStations = useMemo(() => {
    if (!selectedSubgrid) return [];
    return getStationsForSubgrid(selectedSubgrid, selectedRunId);
  }, [selectedSubgrid, selectedRunId, getStationsForSubgrid]);

  const cachedAudit: AuditRunRecord | null = useMemo(() => {
    if (!selectedSubgrid) return null;
    const key = `${selectedSubgrid.toUpperCase()}_${selectedRunId || 'default'}`;
    const direct = auditCache[key];
    if (direct) return direct;
    return Object.entries(auditCache).find(([k]) => k.startsWith(`${selectedSubgrid.toUpperCase()}_`))?.[1] || null;
  }, [auditCache, selectedSubgrid, selectedRunId]);

  const effectiveDefectsList = useMemo(() => {
    if (isRunning || liveHistory.length > 0) return liveDefectsList;

    const list: any[] = [];
    const seen = new Set<string>();

    const addDef = (d: any) => {
      if (!d) return;
      const fn = (d.point_id || d.filename || d.pointId || d.image_url || '').split('/').pop()?.toUpperCase().trim();
      const ptId = (d.point_id || d.pointId || '').toUpperCase().trim();
      const key = fn || ptId;
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push(d);
      }
    };

    if (cachedAudit && Array.isArray(cachedAudit.defectsList)) {
      cachedAudit.defectsList.forEach(addDef);
    }

    if (selectedSubgrid && Array.isArray(defectsList)) {
      const currentSg = selectedSubgrid.toUpperCase().trim();
      defectsList.forEach((d: any) => {
        const dSg = (extractSubgridName(d.subgrid || '') || d.subgrid || '').toUpperCase().trim();
        const dRunId = d.run_id || d.runId;
        if (selectedRunId && dRunId) {
          if (dSg === currentSg && dRunId === selectedRunId) addDef(d);
        } else if (dSg === currentSg) {
          addDef(d);
        }
      });
    }

    return list;
  }, [isRunning, liveHistory, liveDefectsList, cachedAudit, selectedSubgrid, selectedRunId, defectsList]);

  const effectiveHistory = useMemo((): StationInspectionRecord[] => {
    if (isRunning || liveHistory.length > 0) return liveHistory;

    const defectMap = new Map<string, any>();
    const indexDefectMap = new Map<number, any>();

    effectiveDefectsList.forEach((d: any) => {
      const fn = (d.point_id || d.filename || d.pointId || d.image_url || '').split('/').pop()?.toUpperCase().trim();
      const ptId = (d.point_id || d.pointId || '').toUpperCase().trim();
      if (fn) defectMap.set(fn, d);
      if (ptId) defectMap.set(ptId, d);
      const fIdx = d.frame_index || d.index;
      if (typeof fIdx === 'number') indexDefectMap.set(fIdx, d);
    });

    if (selectedStations.length > 0) {
      return selectedStations.map((station, idx) => {
        const frameIdx = idx + 1;
        const fnClean = (station.filename || station.point_id || '').split('/').pop()?.toUpperCase().trim();
        const ptIdClean = (station.point_id || station.filename || '').toUpperCase().trim();

        const defect = (fnClean && defectMap.get(fnClean)) || (ptIdClean && defectMap.get(ptIdClean)) || indexDefectMap.get(frameIdx);

        if (defect) {
          const reasons = defect.defect_flags?.reasons || defect.reasons || [defect.defect_type || 'Defect Flagged'];
          const blurVariance = defect.defect_flags?.blurScore ?? defect.blurVariance ?? 35.0;

          return {
            index: frameIdx,
            pointId: station.point_id || station.filename || `Station ${frameIdx}`,
            timestamp: defect.created_at ? new Date(defect.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : (cachedAudit?.completedAt || 'Logged'),
            lat: station.lat ?? station.latitude ?? Number(defect.lat || defect.latitude || 0),
            lng: station.lng ?? station.longitude ?? Number(defect.lng || defect.lon || defect.longitude || 0),
            bearing: station.bearing ?? defect.bearing ?? 0,
            stepDistance: station.stepDistance ?? defect.step_distance ?? 0,
            status: 'flagged' as const,
            defectType: defect.defect_type || defect.defectType || 'Defect Flagged',
            deliverableModel: (defect.defect_flags?.deliverableModel || projectSettings?.deliverableModel || 'masked_car') as 'masked_car' | 'generative_fill',
            reasons: Array.isArray(reasons) ? reasons : [String(reasons)],
            blurVariance,
            thumbnailUrl: station.image_url || station.filename || defect.filename || defect.image_url || ''
          };
        }

        const cachedH = cachedAudit?.history?.find(h => h.index === frameIdx || (h.pointId && h.pointId.toUpperCase().trim() === ptIdClean));
        if (cachedH) {
          return {
            ...cachedH,
            index: frameIdx,
            pointId: station.point_id || station.filename || cachedH.pointId,
            thumbnailUrl: station.image_url || station.filename || cachedH.thumbnailUrl || ''
          };
        }

        const isAudited = Boolean(cachedAudit || effectiveDefectsList.length > 0);
        return {
          index: frameIdx,
          pointId: station.point_id || station.filename || `Station ${frameIdx}`,
          timestamp: isAudited ? (cachedAudit?.completedAt || 'Passed') : 'Ready',
          lat: station.lat ?? station.latitude ?? 0,
          lng: station.lng ?? station.longitude ?? 0,
          bearing: station.bearing ?? ((idx * 15) % 360),
          stepDistance: station.stepDistance ?? 0,
          status: 'passed' as const,
          defectType: undefined,
          deliverableModel: (projectSettings?.deliverableModel || 'masked_car') as 'masked_car' | 'generative_fill',
          reasons: [],
          blurVariance: 85.0,
          thumbnailUrl: station.image_url || station.filename || ''
        };
      });
    }

    if (cachedAudit && cachedAudit.history && cachedAudit.history.length > 0) return cachedAudit.history;

    if (effectiveDefectsList.length > 0) {
      return effectiveDefectsList.map((d: any, idx: number) => {
        const ptId = d.point_id || d.pointId || d.filename || `Station ${idx + 1}`;
        const fn = d.filename || d.image_url || ptId;
        const frameIdx = d.frame_index || d.index || (idx + 1);
        const lat = Number(d.lat || d.latitude || 0);
        const lng = Number(d.lng || d.lon || d.longitude || 0);
        const reasons = d.defect_flags?.reasons || d.reasons || [d.defect_type || 'Defect Flagged'];
        const blurVariance = d.defect_flags?.blurScore ?? d.blurVariance ?? 35.0;

        return {
          index: frameIdx,
          pointId: ptId,
          timestamp: d.created_at ? new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Logged',
          lat,
          lng,
          bearing: d.bearing || 0,
          stepDistance: d.step_distance || 0,
          status: 'flagged' as const,
          defectType: d.defect_type || 'Defect Flagged',
          deliverableModel: (d.defect_flags?.deliverableModel || projectSettings?.deliverableModel || 'masked_car') as 'masked_car' | 'generative_fill',
          reasons: Array.isArray(reasons) ? reasons : [String(reasons)],
          blurVariance,
          thumbnailUrl: fn
        };
      });
    }
    return [];
  }, [isRunning, liveHistory, cachedAudit, effectiveDefectsList, selectedStations, projectSettings?.deliverableModel]);

  const totalStations = rawTotalStations || (selectedStations.length > 0 ? selectedStations.length : (cachedAudit ? cachedAudit.totalStations : 0)) || 1;
  const progressPct = isRunning || isCompleted
    ? Math.min(100, Math.round(((currentIndex + 1) / totalStations) * 100))
    : cachedAudit
      ? 100
      : 0;
  const remainingStations = Math.max(0, totalStations - (currentIndex + 1));
  const estimatedSecondsLeft = Math.ceil(remainingStations * 0.25);

  const selectedStationFallback = useMemo(() => {
    if (selectedStationIndex !== null && selectedStations.length >= selectedStationIndex) {
      return selectedStations[selectedStationIndex - 1];
    }
    return selectedStations[0] || null;
  }, [selectedStationIndex, selectedStations]);

  const activeRecord: StationInspectionRecord | null = useMemo(() => {
    if (selectedStationIndex !== null) {
      return effectiveHistory.find(h => h.index === selectedStationIndex) || null;
    }
    return null;
  }, [selectedStationIndex, effectiveHistory]);

  const curSg = (activeRunningSubgrid || selectedSubgrid || '').toUpperCase().trim();

  const defaultStation = selectedStations[0];
  const defaultThumbnail = defaultStation
    ? resolvePanoramaUrl(
      defaultStation.image_url || defaultStation.filename || (defaultStation as any).thumbnailUrl || (curSg ? `${curSg}-0001.jpg` : ''),
      projectSettings,
      { subgrid: curSg }
    )
    : '';

  const activeRawFile = activeRecord?.thumbnailUrl || activeRecord?.pointId || currentThumbnail || selectedStationFallback?.filename || selectedStationFallback?.point_id || (curSg ? `${curSg}-0001.jpg` : '');

  const activeDisplayThumbnail = activeRawFile
    ? resolvePanoramaUrl(activeRawFile, projectSettings, { subgrid: curSg })
    : defaultThumbnail;

  const activeDisplayPointId = activeRecord
    ? activeRecord.pointId
    : currentPointId || selectedStationFallback?.point_id || selectedStationFallback?.filename || selectedStationFallback?.id || (cachedAudit && cachedAudit.history?.[0]?.pointId) || (selectedSubgrid ? `${selectedSubgrid}-0001` : '');

  const activeDisplayCoords = activeRecord
    ? { lat: activeRecord.lat, lng: activeRecord.lng }
    : currentCoords.lat && currentCoords.lng
      ? currentCoords
      : selectedStationFallback
        ? { lat: selectedStationFallback.lat || (selectedStationFallback as any)?.latitude || null, lng: selectedStationFallback.lng || (selectedStationFallback as any)?.longitude || (selectedStationFallback as any)?.lon || null }
        : { lat: selectedStations[0]?.lat || null, lng: selectedStations[0]?.lng || null };

  const activeDisplayBearing = activeRecord
    ? activeRecord.bearing
    : currentBearing || selectedStationFallback?.bearing || (selectedStationFallback as any)?.heading || 0;

  const activeDisplayStepDistance = activeRecord
    ? activeRecord.stepDistance
    : currentStepDistance;

  const activeDisplayIndex = Math.min(
    totalStations > 0 ? totalStations : Math.max(1, selectedStations.length),
    Math.max(1, selectedStationIndex !== null ? selectedStationIndex : isRunning || isCompleted ? currentIndex + 1 : 1)
  );

  const lastLoadedSubgridRef = useRef<string>('');

  const initWorkbenchMapTrack = useCallback(() => {
    if (!mapIframeRef.current?.contentWindow) return;
    const activeSg = (activeRunningSubgrid || selectedSubgrid || '').toUpperCase().trim();
    if (!activeSg) return;
    const activeSgNorm = activeSg.toUpperCase().trim();

    const allDefectsMerged = isRunning
      ? (liveDefectsList || [])
      : (effectiveDefectsList || []);
    const cacheKey = `${activeSg}_${selectedRunId || 'default'}_${allDefectsMerged.length}`;
    lastLoadedSubgridRef.current = cacheKey;

    const knownDefectFilenames = new Set<string>();
    allDefectsMerged.forEach((d: any) => {
      const fn = (d.point_id || d.filename || d.pointId || d.image_url || '').split('/').pop()?.toUpperCase().trim();
      const ptId = (d.point_id || d.pointId || '').toUpperCase().trim();
      if (fn) knownDefectFilenames.add(fn);
      if (ptId) knownDefectFilenames.add(ptId);
    });

    const formatTrackItem = (item: any) => {
      const isPub = item.publishToWebGIS === 'yes' || item.publishToUSVPRO === 'yes' || Boolean(item.isSyncedWithSupabase) || item.isFromSupabase === true;
      const statusVal = isPub ? 'yes' : 'in process';
      const op = isPub ? 1.0 : 0.7;
      const colorHex = isPub ? '#10b981' : '#f59e0b';

      let pans = item.panoramas || item.points || [];
      if (pans.length === 0 && (item.poiCount || item.availableImagesCount)) {
        const count = item.poiCount || item.availableImagesCount || 0;
        pans = Array.from({ length: count }, (_, idx) => {
          const fn = (item.availableFilenames && item.availableFilenames[idx]) || `${activeSgNorm}-${String(idx + 1).padStart(4, '0')}.jpg`;
          return {
            filename: fn,
            point_id: fn,
            isAvailable: Boolean(item.availableFilenames && item.availableFilenames[idx])
          };
        });
      }

      const formattedPans = pans.map((p: any, idx: number) => {
        const fnClean = (p.filename || p.image_url || '').split('/').pop()?.toUpperCase().trim();
        const ptClean = (p.point_id || p.pointId || '').toUpperCase().trim();
        const isPointDefect = Boolean(
          (fnClean && knownDefectFilenames.has(fnClean)) ||
          (ptClean && knownDefectFilenames.has(ptClean)) ||
          p.isDefect === true ||
          p.is_defect === true ||
          p.status === 'defect' ||
          p.qa_status === 'defect' ||
          (p.defect_flags && typeof p.defect_flags === 'object' && Object.values(p.defect_flags).some(Boolean))
        );
        const pointColorHex = isPointDefect ? '#ef4444' : colorHex;
        const pointStatusVal = isPointDefect ? 'defect' : statusVal;
        const pointOp = isPointDefect ? 1.0 : op;

        const rawLat = p.lat ?? p.latitude ?? p.y;
        const rawLon = p.lon ?? p.longitude ?? p.lng ?? p.x;

        let finalLat = typeof rawLat === 'number' && !isNaN(rawLat) && rawLat !== 0 ? rawLat : (typeof rawLat === 'string' ? parseFloat(rawLat) : null);
        let finalLon = typeof rawLon === 'number' && !isNaN(rawLon) && rawLon !== 0 ? rawLon : (typeof rawLon === 'string' ? parseFloat(rawLon) : null);

        if (finalLat === null || isNaN(finalLat) || finalLon === null || isNaN(finalLon)) {
          const baseCoords = SUBGRID_COORDINATES[activeSgNorm];
          finalLat = baseCoords ? baseCoords[1] : 0;
          finalLon = baseCoords ? baseCoords[0] : 0;
        }

        return {
          ...p,
          filename: p.filename || p.image_url || `${activeSgNorm}-${String(idx + 1).padStart(4, '0')}.jpg`,
          image_url: p.image_url || p.filename,
          subgrid: p.subgrid || item.subgrid || activeSgNorm,
          grid: p.grid || item.grid,
          latitude: finalLat,
          longitude: finalLon,
          lat: finalLat,
          lon: finalLon,
          lng: finalLon,
          y: finalLat,
          x: finalLon,
          date: p.date ?? p.captured_at,
          captured_at: p.captured_at ?? p.date,
          status: pointStatusVal,
          qa_status: pointStatusVal,
          publishToWebGIS: statusVal,
          publishToUSVPRO: statusVal,
          isPublished: isPub,
          published: isPub,
          is_defect: isPointDefect,
          isDefect: isPointDefect,
          opacity: pointOp,
          fillOpacity: pointOp,
          strokeOpacity: pointOp,
          color: pointColorHex,
          statusColor: pointColorHex,
          strokeColor: pointColorHex,
          fillColor: pointColorHex
        };
      });

      return {
        ...item,
        status: statusVal,
        color: colorHex,
        isPublished: isPub,
        panoramas: formattedPans,
        points: formattedPans
      };
    };

    try {
      const isSingleDailyRun = Boolean(selectedRunId);

      // 2. Dispatch staged data first (Keeps Defect Colors) so the map view state below
      //    can reuse the exact per-point published/defect colors.
      const matchingRuns = selectedRunId
        ? dailyData.filter(d => (getItemId(d) === selectedRunId || d.id === selectedRunId || (d as any)._id === selectedRunId))
        : dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === activeSgNorm);

      const runsToSend = matchingRuns.length > 0
        ? matchingRuns
        : dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === activeSgNorm);

      let formattedItems: ReturnType<typeof formatTrackItem>[] = [];
      if (runsToSend.length > 0) {
        formattedItems = runsToSend.map(formatTrackItem);
        mapIframeRef.current.contentWindow.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: formattedItems,
          isSingleRun: isSingleDailyRun,
          runId: selectedRunId || ''
        }, '*');
      }

      // Build a filename -> colored-point lookup from the formatted (staged) items so the
      // direct SET_MAP_VIEW_STATE payload carries the same publish/defect colors. The webgis
      // map renders mapViewState.points directly (skipping staged merges), so these points
      // MUST carry the correct color or the track shows default amber.
      const pointColorByKey = new Map<string, { color: string; status: string; isPublished: boolean }>();
      formattedItems.forEach((item: any) => {
        const pans = item.panoramas || item.points || [];
        pans.forEach((p: any) => {
          const fn = (p.filename || p.image_url || '').replace(/^.*[\\\/]/, '').toUpperCase().trim();
          if (fn) {
            pointColorByKey.set(fn, {
              color: p.color || (p.isPublished ? '#10b981' : '#f59e0b'),
              status: p.status || (p.isPublished ? 'yes' : 'in process'),
              isPublished: Boolean(p.isPublished)
            });
          }
        });
      });

      // 1. Force Map to load exact normalized selectedStations (with correct per-point colors)
      const formattedPoints = selectedStations.map((st, idx) => {
        const fnKey = (st.filename || st.image_url || '').replace(/^.*[\\\/]/, '').toUpperCase().trim();
        const colorInfo = pointColorByKey.get(fnKey) || {
          color: '#f59e0b',
          status: 'in process',
          isPublished: false
        };
        return {
          id: st.point_id || st.filename || `station-${idx}`,
          filename: st.filename,
          image_url: st.image_url,
          subgrid: activeSgNorm,
          lat: st.latitude ?? st.lat,
          lon: st.longitude ?? st.lng,
          latitude: st.latitude ?? st.lat,
          longitude: st.longitude ?? st.lng,
          bearing: st.bearing ?? 0,
          status: colorInfo.status,
          isPublished: colorInfo.isPublished,
          published: colorInfo.isPublished,
          color: colorInfo.color
        };
      });

      mapIframeRef.current.contentWindow.postMessage({
        type: 'SET_MAP_VIEW_STATE',
        viewMode: isSingleDailyRun ? 'SINGLE_RUN' : 'SUBGRID',
        subgrid: activeSg,
        runId: selectedRunId || null,
        points: formattedPoints
      }, '*');

      mapIframeRef.current.contentWindow.postMessage({
        type: 'FILTER_SUBGRID',
        subgrid: activeSg,
        runId: selectedRunId || '',
        isSingleRun: isSingleDailyRun
      }, '*');

      // 3. Dispatch Live Defects
      mapIframeRef.current.contentWindow.postMessage({
        type: 'QAQC_DEFECTS_RESET'
      }, '*');
      if (allDefectsMerged.length > 0) {
        mapIframeRef.current.contentWindow.postMessage({
          type: 'QAQC_DEFECTS_SYNC',
          defects: allDefectsMerged
        }, '*');
      }

      // 4. Force map to center on active display node
      if (selectedStations.length > 0) {
        const activeIdx = Math.max(0, Math.min(activeDisplayIndex - 1, selectedStations.length - 1));
        const activeNode = selectedStations[activeIdx];
        if (activeNode) {
          mapIframeRef.current.contentWindow.postMessage(
            {
              type: 'SET_PANORAMA',
              point: {
                filename: activeNode.filename,
                image_url: activeNode.image_url,
                config_url: activeNode.filename ? resolvePanoramaConfigUrl(activeNode.filename, projectSettings, activeSgNorm) : '',
                subgrid: activeSgNorm,
                lat: activeNode.latitude ?? activeNode.lat,
                lon: activeNode.longitude ?? activeNode.lng,
                lng: activeNode.longitude ?? activeNode.lng,
                bearing: activeNode.bearing ?? 0
              }
            },
            '*'
          );
        }
      }
    } catch (_) { }
  }, [activeRunningSubgrid, selectedSubgrid, selectedRunId, dailyData, effectiveDefectsList, isRunning, liveDefectsList, selectedStations, activeDisplayIndex]);

  useEffect(() => {
    initWorkbenchMapTrack();
  }, [initWorkbenchMapTrack, selectedSubgrid, selectedRunId, viewportMode]);

  useEffect(() => {
    const handleMapMessage = (e: MessageEvent) => {
      if (e.data?.type === 'VIEWER_READY' || e.data?.type === 'MAP_READY' || e.data?.type === 'MAP_LOADED' || e.data?.type === 'REQUEST_STAGED_DATA') {
        lastLoadedSubgridRef.current = '';
        initWorkbenchMapTrack();
      }
    };
    window.addEventListener('message', handleMapMessage);
    return () => window.removeEventListener('message', handleMapMessage);
  }, [initWorkbenchMapTrack]);

  useEffect(() => {
    if (!mapIframeRef.current?.contentWindow) return;
    if (effectiveDefectsList.length === 0) return;
    try {
      mapIframeRef.current.contentWindow.postMessage({
        type: 'QAQC_DEFECTS_SYNC',
        subgrid: activeRunningSubgrid || selectedSubgrid,
        defects: effectiveDefectsList
      }, '*');
    } catch (_) { }
  }, [effectiveDefectsList, activeRunningSubgrid, selectedSubgrid]);

  useEffect(() => {
    if (!isRunning) return;
    if (!mapIframeRef.current?.contentWindow) return;
    if (!activeDisplayCoords.lat || !activeDisplayCoords.lng) return;

    const isCurrentDefect = Boolean(
      activeRecord?.defectType ||
      liveCheckStatus.blur.status === 'flagged' ||
      liveCheckStatus.obstruction.status === 'flagged' ||
      liveCheckStatus.gps.status === 'flagged' ||
      effectiveDefectsList.some((d: any) => (d.point_id || d.pointId || d.filename) === activeDisplayPointId)
    );

    try {
      mapIframeRef.current.contentWindow.postMessage({
        type: 'MAP_POINT_SELECTED',
        point: {
          filename: activeDisplayPointId,
          subgrid: activeRunningSubgrid || selectedSubgrid,
          lat: activeDisplayCoords.lat,
          lon: activeDisplayCoords.lng,
          lng: activeDisplayCoords.lng,
          bearing: activeDisplayBearing,
          is_defect: isCurrentDefect,
          isDefect: isCurrentDefect,
          color: isCurrentDefect ? '#EF4444' : undefined
        },
        isLiveTracking: true,
        noAnimation: true
      }, '*');

      mapIframeRef.current.contentWindow.postMessage({
        type: 'SET_CAMERA_HEADING',
        bearing: activeDisplayBearing,
        heading: activeDisplayBearing
      }, '*');
    } catch (_) { }
  }, [isRunning, activeDisplayIndex, activeDisplayCoords, activeDisplayBearing, activeDisplayPointId, activeRecord, liveCheckStatus, effectiveDefectsList, activeRunningSubgrid, selectedSubgrid]);

  useEffect(() => {
    if (!mapIframeRef.current?.contentWindow || isRunning) return;
    if (!activeDisplayCoords.lat || !activeDisplayCoords.lng) return;

    const targetSubgrid = (activeRunningSubgrid || selectedSubgrid || '').toUpperCase().trim();
    const pointPayload = {
      filename: activeDisplayPointId,
      image_url: activeDisplayThumbnail,
      config_url: activeDisplayPointId ? resolvePanoramaConfigUrl(activeDisplayPointId, projectSettings, targetSubgrid) : '',
      subgrid: targetSubgrid,
      lat: activeDisplayCoords.lat,
      lon: activeDisplayCoords.lng,
      lng: activeDisplayCoords.lng,
      bearing: activeDisplayBearing,
      index: activeDisplayIndex
    };

    try {
      mapIframeRef.current.contentWindow.postMessage({
        type: 'SET_PANORAMA',
        point: pointPayload
      }, '*');

      mapIframeRef.current.contentWindow.postMessage({
        type: 'MAP_POINT_SELECTED',
        point: pointPayload,
        isUserSelect: true,
        panTo: true
      }, '*');

      mapIframeRef.current.contentWindow.postMessage({
        type: 'SET_CAMERA_HEADING',
        bearing: activeDisplayBearing,
        heading: activeDisplayBearing
      }, '*');
    } catch (_) { }
  }, [selectedStationIndex, activeDisplayIndex, isRunning, activeDisplayCoords, activeDisplayPointId, activeDisplayThumbnail, activeDisplayBearing, activeRunningSubgrid, selectedSubgrid]);

  useEffect(() => {
    if (!activeRunningSubgrid || !getStationsForSubgrid) return;

    const currentStations = getStationsForSubgrid(activeRunningSubgrid) || [];
    if (currentStations.length === 0) return;

    const currentIndexLoc = currentStations.findIndex(
      (item: any) => (item.filename || item.point_id) === (activeDisplayPointId || activeRawFile)
    );

    if (currentIndexLoc === -1) return;

    const adjacentIndices = [currentIndexLoc + 1, currentIndexLoc - 1];

    adjacentIndices.forEach(idx => {
      if (idx >= 0 && idx < currentStations.length) {
        const neighbor = currentStations[idx];
        const filename = neighbor.filename || neighbor.point_id || (neighbor as any).raw_image_filename;
        if (filename) {
          const configUrl = resolvePanoramaConfigUrl(filename, projectSettings, activeRunningSubgrid);
          fetch(configUrl, { cache: 'force-cache' }).catch(() => { });

          const previewUrl = resolvePanoramaUrl(filename, projectSettings, { subgrid: activeRunningSubgrid });
          if (previewUrl) {
            const img = new Image();
            img.src = previewUrl;
          }
        }
      }
    });
  }, [activeDisplayPointId, activeRawFile, activeRunningSubgrid, getStationsForSubgrid, projectSettings]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'VIEWER_READY' || e.data?.type === 'MAP_READY') {
        setIsMapReady(true);
        lastLoadedSubgridRef.current = '';
        initWorkbenchMapTrack();
      } else if (e.data?.type === 'MAP_POINT_SELECTED' || e.data?.type === 'POINT_SELECTED' || e.data?.type === 'PANORAMA_SELECTED') {
        if (isRunning) return;
        const pt = e.data.point || e.data.payload || e.data;
        if (pt) {
          const fn = (pt.filename || pt.image_url || pt.pointId || pt.point_id || '').split('/').pop()?.toUpperCase().trim();
          const stnIdx = selectedStations.findIndex(s => {
            const sFn = (s.filename || s.image_url || s.point_id || s.id || '').split('/').pop()?.toUpperCase().trim();
            const sPtId = (s.point_id || s.id || '').toUpperCase().trim();
            return fn && (sFn === fn || sPtId === fn);
          });
          if (stnIdx !== -1) {
            setSelectedStationIndex(stnIdx + 1);
          } else {
            const ptLat = Number(pt.lat || pt.latitude);
            const ptLng = Number(pt.lng || pt.lon || pt.longitude);
            if (!isNaN(ptLat) && !isNaN(ptLng)) {
              const coordIdx = selectedStations.findIndex(s => {
                const sLat = Number(s.lat || (s as any).latitude);
                const sLng = Number(s.lng || (s as any).longitude || (s as any).lon);
                return Math.abs(sLat - ptLat) < 0.0001 && Math.abs(sLng - ptLng) < 0.0001;
              });
              if (coordIdx !== -1) {
                setSelectedStationIndex(coordIdx + 1);
              }
            }
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [initWorkbenchMapTrack, isRunning, selectedStations]);

  const filteredHistory = useMemo(() => {
    if (filterMode === 'flagged') {
      return effectiveHistory.filter(h => h.status === 'flagged');
    }
    return effectiveHistory;
  }, [effectiveHistory, filterMode]);

  const handleLaunchInspection = () => {
    if (!selectedSubgrid || selectedStations.length === 0) return;

    setSelectedStationIndex(null);
    setMobileConsoleTab('canvas');

    const firstStation = selectedStations[0];
    if (firstStation && firstStation.lat && firstStation.lng && mapIframeRef.current?.contentWindow) {
      try {
        mapIframeRef.current.contentWindow.postMessage({
          type: 'MAP_POINT_SELECTED',
          point: {
            filename: firstStation.filename || firstStation.id,
            image_url: firstStation.image_url,
            subgrid: selectedSubgrid,
            lat: firstStation.lat,
            lon: firstStation.lng,
            lng: firstStation.lng,
            bearing: firstStation.bearing || 0
          },
          zoom: 18
        }, '*');
        mapIframeRef.current.contentWindow.postMessage({
          type: 'SET_CAMERA_HEADING',
          bearing: firstStation.bearing || 0,
          heading: firstStation.bearing || 0
        }, '*');
      } catch (_) { }
    }
    onStartInspection({
      subgrid: selectedSubgrid,
      runId: selectedRunId,
      stations: selectedStations,
      config,
      pic: inspectorPic.trim() || activeUserName || 'Operator',
      customThresholds: localThresholds
    });
  };

  const handleExportCSV = () => {
    const targetSg = activeRunningSubgrid || selectedSubgrid || 'QAQC_Audit';
    const list = effectiveHistory;
    if (list.length === 0) return;

    const headers = [
      'Station Index',
      'Point ID',
      'Latitude',
      'Longitude',
      'Bearing (deg)',
      'Step Distance (m)',
      'Tenengrad Score',
      'Status',
      'Deliverable Model',
      'Defect Type',
      'Reason',
      'Timestamp',
      'PIC'
    ];

    const rows = list.map(item => [
      item.index,
      `"${item.pointId}"`,
      item.lat,
      item.lng,
      item.bearing.toFixed(1),
      item.stepDistance.toFixed(2),
      (item.blurVariance ?? 0).toFixed(1),
      item.status,
      `"${item.deliverableModel || localThresholds.deliverableModel || 'masked_car'}"`,
      `"${item.defectType || ''}"`,
      `"${(item.reasons || []).join('; ')}"`,
      `"${item.timestamp}"`,
      `"${inspectorPic || activeUserName}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `QAQC_Audit_${targetSg}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const meanSharpnessScore = useMemo(() => {
    if (effectiveHistory.length === 0) return 0;
    const sum = effectiveHistory.reduce((acc, h) => acc + (h.blurVariance || 0), 0);
    return Math.round((sum / effectiveHistory.length) * 10) / 10;
  }, [effectiveHistory]);

  const auditPassRate = useMemo(() => {
    if (effectiveHistory.length === 0) return 100;
    const passed = effectiveHistory.length - effectiveDefectsList.length;
    return Math.round((passed / effectiveHistory.length) * 100);
  }, [effectiveHistory, effectiveDefectsList]);

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-[99999] animate-in fade-in slide-in-from-bottom-3 duration-200">
        <div className="bg-card/95 backdrop-blur-xl border border-subtle rounded-2xl p-3 shadow-2xl flex items-center gap-3 text-text-base ring-1 ring-sky-500/30">
          <div className="p-2 bg-gradient-to-tr from-sky-600 to-emerald-500 rounded-xl shadow-md text-white">
            <Activity size={16} className={isRunning ? 'animate-pulse' : ''} />
          </div>

          <div className="cursor-pointer select-none" onClick={() => setIsMinimized(false)}>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs text-text-base">
                Acquisition QC
              </span>
              <span className="px-2 py-0.5 rounded-full bg-inner text-[10px] font-sans font-bold text-sky-400 border border-subtle">
                {activeRunningSubgrid || selectedSubgrid || 'Standby'}
              </span>
              {isRunning && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Running
                </span>
              )}
            </div>
            <p className="text-[10px] text-text-muted mt-0.5 font-sans">
              Station {activeDisplayIndex} of {selectedStations.length || totalStations} • {effectiveDefectsList.length} Defect(s)
            </p>
          </div>

          <div className="flex items-center gap-1.5 pl-2 border-l border-subtle">
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              className="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow transition-all cursor-pointer flex items-center gap-1 active:scale-95"
              title="Restore Acquisition QC Workbench"
            >
              <Maximize2 size={13} />
              <span>Restore</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-rose-950/40 text-text-muted hover:text-rose-400 rounded-lg transition-all cursor-pointer"
              title="Exit Acquisition QC"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[99999] bg-app flex flex-col text-text-base select-none font-sans overflow-hidden">
      {/* 1. TOP PRECISION CONSOLE HEADER BAR */}
      <header className="h-14 px-4 bg-card border-b border-subtle flex items-center justify-between shrink-0 relative z-30 shadow-sm gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs truncate">
            <span className="text-text-muted font-medium tracking-tight hidden md:inline">GeoSphere 360</span>
            <span className="text-text-muted/30 hidden md:inline">/</span>
            <span className="text-text-muted font-medium hidden sm:inline">Acquisition QC</span>
            <span className="text-text-muted/30 hidden sm:inline">/</span>
            {workbenchTab === 'console' && (
              <>
                <span className="text-text-base font-sans font-bold px-2.5 py-1 rounded-lg bg-inner border border-subtle text-xs truncate max-w-[130px] sm:max-w-none">
                  {isRunning || isCompleted ? activeRunningSubgrid : (selectedSubgrid || 'No Target')}
                </span>
                {surveyDate && (
                  <>
                    <span className="text-text-muted/30 hidden lg:inline">•</span>
                    <span className="text-text-muted text-xs font-sans hidden lg:inline">{surveyDate}</span>
                  </>
                )}
                {(activeRunningPic || inspectorPic || activeUserName) && (
                  <>
                    <span className="text-text-muted/30 hidden xl:inline">•</span>
                    <span className="text-text-muted text-xs hidden xl:inline">
                      PIC: <span className="text-text-base font-semibold">
                        {(activeRunningPic && activeRunningPic !== 'Operator' && activeRunningPic !== 'Unassigned')
                          ? activeRunningPic
                          : (inspectorPic && inspectorPic !== 'Operator' && inspectorPic !== 'Unassigned')
                            ? inspectorPic
                            : (activeUserName && activeUserName !== 'Operator' && activeUserName !== 'Unassigned')
                              ? activeUserName
                              : (inspectorPic || activeUserName || 'Operator')}
                      </span>
                    </span>
                  </>
                )}
                <span className="text-text-muted/30 hidden lg:inline">•</span>
                <span className="text-text-muted text-[10px] hidden lg:inline font-sans px-2 py-0.5 rounded-lg bg-inner border border-subtle">
                  {(localThresholds.deliverableModel || projectSettings?.deliverableModel || 'masked_car') === 'generative_fill' ? 'Generative (80% ROI)' : 'Masked (52% ROI)'}
                </span>
              </>
            )}
            {workbenchTab === 'thresholds' && (
              <span className="text-text-base font-semibold px-2.5 py-1 rounded-lg bg-inner border border-subtle flex items-center gap-1.5 shadow-sm text-xs">
                <SlidersHorizontal size={13} className="text-text-muted" />
                <span>Thresholds</span>
              </span>
            )}
            {workbenchTab === 'audit' && (
              <span className="text-text-base font-semibold px-2.5 py-1 rounded-lg bg-inner border border-subtle flex items-center gap-1.5 shadow-sm text-xs">
                <FileSpreadsheet size={13} className="text-text-muted" />
                <span>Audit</span>
              </span>
            )}
          </div>

          {workbenchTab === 'console' && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-inner border border-subtle text-[11px] shrink-0">
              <span className={`w-2 h-2 rounded-full ${isRunning && !isPaused
                ? 'bg-sky-400 animate-pulse'
                : isPaused
                  ? 'bg-amber-400'
                  : isCompleted || (cachedAudit && !isRunning)
                    ? 'bg-emerald-400'
                    : 'bg-slate-500'
                }`} />
              <span className="text-text-muted font-medium text-[11px]">
                {isRunning && !isPaused
                  ? `Active`
                  : isPaused
                    ? 'Paused'
                    : isCompleted || (cachedAudit && !isRunning)
                      ? 'Completed'
                      : 'Idle'}
              </span>
            </div>
          )}
        </div>

        {workbenchTab === 'console' && (isRunning || isCompleted || cachedAudit) && (
          <div className="hidden lg:flex items-center gap-3 text-xs text-text-base bg-inner px-3.5 py-1.5 rounded-xl border border-subtle shrink-0 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-auto shadow-sm">
            <span className="text-text-muted font-normal text-xs">
              Station <strong className="text-text-base font-bold font-sans">{Math.min(currentIndex + 1, totalStations)}</strong> / <span className="text-text-muted font-sans">{totalStations}</span>
            </span>
            <div className="w-24 xl:w-32 h-1.5 bg-card rounded-full overflow-hidden border border-subtle">
              <div
                className="h-full bg-sky-400 rounded-full transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-text-base tabular-nums font-bold font-sans text-xs">{progressPct}%</span>
            <span className="text-text-muted text-[11px] tabular-nums font-sans">{elapsedSeconds || cachedAudit?.elapsedSeconds || 0}s</span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {workbenchTab === 'console' && (
            <div className="hidden sm:flex items-center p-1 rounded-xl bg-inner border border-subtle gap-0.5">
              <button
                type="button"
                onClick={() => setViewportMode('horizontal')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${viewportMode === 'horizontal'
                  ? 'bg-card text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
                  }`}
                title="Horizontal Split View"
              >
                <Rows size={12} />
                <span className="hidden xl:inline">Horizontal Split</span>
              </button>
              <button
                type="button"
                onClick={() => setViewportMode('vertical')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${viewportMode === 'vertical'
                  ? 'bg-card text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
                  }`}
                title="Vertical Split View"
              >
                <Columns size={12} />
                <span className="hidden xl:inline">Vertical Split</span>
              </button>
              <button
                type="button"
                onClick={() => setViewportMode('pip')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${viewportMode === 'pip'
                  ? 'bg-card text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
                  }`}
                title="Minimap PiP"
              >
                <Layers size={12} />
                <span className="hidden xl:inline">Minimap PiP</span>
              </button>
              <button
                type="button"
                onClick={() => setViewportMode('full')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${viewportMode === 'full'
                  ? 'bg-card text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
                  }`}
                title="Full 360 Only"
              >
                <Maximize2 size={12} />
                <span className="hidden xl:inline">360 Only</span>
              </button>
            </div>
          )}

          <div className="flex items-center p-1 rounded-xl bg-inner border border-subtle">
            <button
              type="button"
              onClick={() => setWorkbenchTab('console')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${workbenchTab === 'console'
                ? 'bg-card text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              <Activity size={13} className={workbenchTab === 'console' ? 'text-text-base' : 'text-text-muted'} />
              <span className="hidden xs:inline">Console</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkbenchTab('thresholds')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${workbenchTab === 'thresholds'
                ? 'bg-card text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              <SlidersHorizontal size={13} className={workbenchTab === 'thresholds' ? 'text-text-base' : 'text-text-muted'} />
              <span className="hidden xs:inline">Thresholds</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkbenchTab('audit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${workbenchTab === 'audit'
                ? 'bg-card text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              <FileSpreadsheet size={13} className={workbenchTab === 'audit' ? 'text-text-base' : 'text-text-muted'} />
              <span className="hidden xs:inline">Audit</span>
            </button>
          </div>

          {workbenchTab === 'console' && isRunning && (
            <button
              onClick={isPaused ? onResume : onPause}
              className="px-3 py-1.5 rounded-xl border border-subtle bg-inner hover:bg-inner/80 text-text-base text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
            >
              {isPaused ? <Play size={13} /> : <Pause size={13} />}
              <span className="hidden sm:inline">{isPaused ? 'Resume' : 'Pause'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="px-3 py-1.5 bg-card hover:bg-inner text-text-muted hover:text-text-base rounded-xl border border-subtle text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
            title="Minimize console to floating dock"
          >
            <Minimize2 size={13} />
            <span className="hidden sm:inline">Minimize</span>
          </button>

          {isRunning ? (
            <button
              type="button"
              onClick={onAbort}
              className="px-3 py-1.5 bg-inner hover:bg-rose-950/30 text-rose-400 rounded-xl border border-subtle hover:border-rose-800/40 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Abort inspection loop"
            >
              <StopCircle size={13} />
              <span className="hidden sm:inline">Abort</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 bg-card hover:bg-rose-950/30 text-text-muted hover:text-rose-400 rounded-xl border border-subtle hover:border-rose-800/40 text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Exit QAQC Workspace"
            >
              <X size={14} />
              <span className="hidden sm:inline">Exit</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. BODY CONTENT */}
      {workbenchTab === 'console' && (
        <div className="flex-1 p-2 sm:p-3 gap-2 sm:gap-3 flex flex-col lg:flex-row overflow-hidden bg-app min-h-0">
          <div className="flex lg:hidden items-center justify-between p-1 rounded-xl bg-card border border-subtle shrink-0 shadow-sm gap-1">
            <button
              type="button"
              onClick={() => setMobileConsoleTab('canvas')}
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${mobileConsoleTab === 'canvas'
                ? 'bg-inner text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              <Crosshair size={13} />
              <span>Canvas ({Math.min(currentIndex + 1, totalStations)}/{totalStations})</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileConsoleTab('targets')}
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${mobileConsoleTab === 'targets'
                ? 'bg-inner text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              <Layers size={13} />
              <span>Targets ({filteredTargetList.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileConsoleTab('telemetry')}
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${mobileConsoleTab === 'telemetry'
                ? 'bg-inner text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              <Activity size={13} />
              <span>Stream ({effectiveDefectsList.length > 0 ? `${effectiveDefectsList.length} Flagged` : effectiveHistory.length})</span>
            </button>
          </div>

          {/* COLUMN 1: TARGET SELECTION */}
          <aside className={`w-full lg:w-[380px] bg-card border border-subtle rounded-2xl flex flex-col shrink-0 overflow-hidden shadow-sm text-xs ${mobileConsoleTab === 'targets' ? 'flex-1' : 'hidden lg:flex'}`}>
            <div className="p-3 border-b border-subtle bg-card">
              <div className="grid grid-cols-2 gap-1.5 bg-inner p-1 rounded-xl border border-subtle">
                <button
                  onClick={() => setTargetTab('masterlist')}
                  className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${targetTab === 'masterlist'
                    ? 'bg-card text-text-base shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                    }`}
                >
                  Master Subgrids ({processedBatchLogs.length})
                </button>
                <button
                  onClick={() => setTargetTab('daily')}
                  className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${targetTab === 'daily'
                    ? 'bg-card text-text-base shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                    }`}
                >
                  Daily Runs ({processedDailyRuns.length})
                </button>
              </div>
            </div>

            <div className="p-3 border-b border-subtle space-y-2.5 bg-card">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search subgrid, date, PIC..."
                  className="w-full bg-inner border border-subtle rounded-xl pl-8 pr-3 py-1.5 text-xs text-text-base placeholder:text-text-muted focus:outline-none focus:border-subtle transition-all font-sans"
                />
              </div>

              <div className="grid grid-cols-3 gap-1.5 bg-inner p-1 rounded-xl border border-subtle text-xs">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('all')}
                  className={`py-1 text-center font-medium rounded-lg transition-all cursor-pointer text-[11px] ${categoryFilter === 'all'
                    ? 'bg-card text-text-base font-semibold shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                    }`}
                >
                  All ({targetTab === 'daily' ? processedDailyRuns.length : processedBatchLogs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryFilter(prev => prev === 'staging' ? 'all' : 'staging')}
                  className={`py-1 text-center font-medium rounded-lg transition-all cursor-pointer text-[11px] flex items-center justify-center gap-1.5 ${categoryFilter === 'staging'
                    ? 'bg-card text-text-base font-semibold shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                    }`}
                >
                  <Clock size={11} className="text-amber-400 shrink-0" />
                  <span>{targetTab === 'masterlist' ? 'Ongoing' : 'Staging'}</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-inner text-[10px] font-sans text-text-muted border border-subtle">{stagingCount}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCategoryFilter(prev => prev === 'published' ? 'all' : 'published')}
                  className={`py-1 text-center font-medium rounded-lg transition-all cursor-pointer text-[11px] flex items-center justify-center gap-1.5 ${categoryFilter === 'published'
                    ? 'bg-card text-text-base font-semibold shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                    }`}
                >
                  <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                  <span>{targetTab === 'masterlist' ? 'Complete' : 'Published'}</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-inner text-[10px] font-sans text-text-muted border border-subtle">{publishedCount}</span>
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-text-muted px-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showOnlyWithFrames}
                    onChange={(e) => setShowOnlyWithFrames(e.target.checked)}
                    className="rounded border-subtle bg-inner text-text-muted focus:ring-0 cursor-pointer w-3.5 h-3.5"
                  />
                  <span>Show valid frames only</span>
                </label>
                <span className="text-text-muted font-sans">{filteredTargetList.length} targets</span>
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto p-2.5 space-y-1.5"
              onClick={(e) => {
                if (e.target === e.currentTarget && selectedSubgrid) {
                  setSelectedSubgrid('');
                  setSelectedRunId(null);
                  setSelectedStationIndex(null);
                  if (mapIframeRef.current?.contentWindow) {
                    mapIframeRef.current.contentWindow.postMessage({
                      type: 'FILTER_SUBGRID',
                      subgrid: '',
                      runId: ''
                    }, '*');
                  }
                }
              }}
            >
              {filteredTargetList.length === 0 ? (
                <div className="p-6 text-center text-text-muted text-xs space-y-1.5">
                  <Layers size={20} className="mx-auto text-text-muted/60" />
                  <p>No matching targets in {categoryFilter === 'all' ? 'list' : categoryFilter} category</p>
                </div>
              ) : (
                filteredTargetList.map((item) => {
                  const isSelected = selectedSubgrid === item.subgrid && (targetTab === 'masterlist' || selectedRunId === item.runId);
                  const isZeroFrames = item.frameCount === 0;
                  const cached = auditCache[`${item.subgrid.toUpperCase()}_${item.runId || 'default'}`];
                  const hasAudit = Boolean(item.defectCount > 0 || (cached && typeof cached.defectCount === 'number') || item.qaqcStatus === 'QA/QC Approved' || (item.qaqcStatus && item.qaqcStatus.includes('Defect')));
                  const auditDefects = item.defectCount;

                  return (
                    <div
                      key={`${item.subgrid}-${item.runId || item.date}`}
                      onClick={() => {
                        if (isZeroFrames) return;
                        if (isSelected) {
                          setSelectedSubgrid('');
                          setSelectedRunId(null);
                          setSelectedStationIndex(null);
                          if (mapIframeRef.current?.contentWindow) {
                            mapIframeRef.current.contentWindow.postMessage({
                              type: 'FILTER_SUBGRID',
                              subgrid: '',
                              runId: ''
                            }, '*');
                          }
                          return;
                        }
                        setSelectedSubgrid(item.subgrid);
                        setSelectedRunId(item.runId);
                        setSelectedStationIndex(null);
                        if (item.pic && item.pic !== 'Unassigned') {
                          setInspectorPic(item.pic);
                        } else if (activeUserName && activeUserName !== 'Operator') {
                          setInspectorPic(activeUserName);
                        }
                      }}
                      className={`p-3 rounded-xl border transition-all duration-150 flex items-center justify-between gap-2.5 ${isZeroFrames
                        ? 'opacity-40 bg-card border-subtle/50 cursor-not-allowed text-text-muted'
                        : isSelected
                          ? 'bg-inner/60 border-slate-300/80 text-white shadow-lg ring-2 ring-slate-400/40 cursor-pointer'
                          : 'bg-card hover:bg-slate-800/40 hover:border-subtle/50 text-text-muted hover:text-text-base border-subtle cursor-pointer'
                        }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-bold font-sans text-xs ${isSelected ? 'text-text-base' : 'text-text-base'}`}>
                            {item.subgrid}
                          </span>
                          <span className="text-[11px] text-text-muted font-sans">
                            • {item.date}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
                          {targetTab === 'masterlist' ? (
                            item.status === 'Complete' ? (
                              <span className="text-text-muted font-medium flex items-center gap-1">
                                <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                                <span>Complete</span>
                              </span>
                            ) : (
                              <span className="text-text-muted font-medium flex items-center gap-1">
                                <Clock size={11} className="text-amber-400 shrink-0" />
                                <span>Ongoing</span>
                              </span>
                            )
                          ) : item.isPublished ? (
                            <span className="text-text-muted font-medium flex items-center gap-1">
                              <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                              <span>Published</span>
                            </span>
                          ) : item.publishStatus === 'recheck' ? (
                            <span className="text-text-muted font-medium flex items-center gap-1">
                              <Clock size={11} className="text-amber-400 shrink-0" />
                              <span>Recheck</span>
                            </span>
                          ) : (
                            <span className="text-text-muted font-medium flex items-center gap-1">
                              <Clock size={11} className="text-amber-400 shrink-0" />
                              <span>Staging</span>
                            </span>
                          )}

                          <span className="text-text-muted/40">•</span>

                          {hasAudit ? (
                            auditDefects === 0 ? (
                              <span className="text-text-muted font-medium flex items-center gap-1">
                                <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                                <span>QA Passed</span>
                              </span>
                            ) : (
                              <span className="text-text-muted font-medium flex items-center gap-1">
                                <AlertTriangle size={11} className="text-rose-400 shrink-0" />
                                <span>{auditDefects} Defect{auditDefects > 1 ? 's' : ''}</span>
                              </span>
                            )
                          ) : (
                            <span className="text-text-muted font-normal">
                              Pending Audit
                            </span>
                          )}

                          {typeof item.poiCount === 'number' && item.poiCount > 0 && (
                            <>
                              <span className="text-text-muted/40">•</span>
                              <span className="text-text-muted font-sans text-[11px]">
                                {item.poiCount} POI
                              </span>
                            </>
                          )}

                          <span className="text-text-muted/40">•</span>

                          <span className="text-text-muted">
                            PIC: <span className="text-text-base font-medium">{item.pic}</span>
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        {!item.isPublished && !isZeroFrames && hasAudit && auditDefects === 0 && onSignOffAndPublish && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSignOffAndPublish?.(item.subgrid, item.runId);
                            }}
                            title="Sign off this subgrid as Acquisition QC Approved and publish to WebGIS"
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold uppercase tracking-wide hover:bg-emerald-500/25 transition-colors cursor-pointer"
                          >
                            <CheckCircle2 size={11} /> Sign Off &amp; Publish
                          </button>
                        )}
                        <span className="px-2.5 py-1 rounded-lg bg-inner border border-subtle text-[11px] text-text-muted font-sans font-medium inline-flex items-center gap-1">
                          {targetTab === 'masterlist' && typeof item.poiCount === 'number' && item.poiCount > 0 ? (
                            item.frameCount < item.poiCount ? (
                              <>
                                <span className="text-amber-400 font-semibold">{item.frameCount.toLocaleString()}</span>
                                <span className="text-text-muted/50 mx-0.5">/</span>
                                <span className="text-text-base font-semibold">{item.poiCount.toLocaleString()}</span>
                                <span className="text-text-muted text-[10px] ml-0.5">Frames</span>
                              </>
                            ) : (
                              <>
                                <span className="text-text-base font-semibold">{item.frameCount.toLocaleString()}</span>
                                <span className="text-text-muted text-[10px] ml-0.5">Frames</span>
                              </>
                            )
                          ) : (
                            <span>{item.frameCount.toLocaleString()} Frames</span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-3.5 border-t border-subtle bg-inner space-y-3">
              <div className="flex items-center justify-between text-xs text-text-base font-semibold">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span>Inspection Parameters</span>
                  {isGpuAccelerationSupported() ? (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 truncate max-w-[130px] sm:max-w-none"
                      title={`Hardware Engine: ${getGpuHardwareName()}`}
                    >
                      <Zap size={10} className="fill-current text-emerald-400 shrink-0" />
                      <span>GPU</span>
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-slate-500/10 text-text-muted border border-subtle/20"
                      title="Hardware Engine: CPU Multi-Sector"
                    >
                      <Cpu size={10} className="text-text-muted shrink-0" />
                      <span>CPU</span>
                    </span>
                  )}
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20"
                    title={`${viewerEngineName} • ${projectSettings?.storageProvider || 'dynamic'}`}
                  >
                    <Camera size={10} className="text-sky-400 shrink-0" />
                    <span>{viewerDisplayName}</span>
                  </span>
                </div>
                <span className="text-text-muted text-[11px] font-sans font-normal shrink-0">
                  {selectedSubgrid ? `${selectedStations.length} Frames Queued` : 'No Target'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({ ...prev, checkBlur: !prev.checkBlur }))}
                  className={`py-2 px-1 rounded-lg border text-center transition-all cursor-pointer text-[11px] font-medium truncate ${config.checkBlur ? 'bg-card border-subtle text-text-base font-semibold shadow-sm' : 'bg-card border-subtle text-text-muted hover:text-text-base'
                    }`}
                  title={projectSettings?.qaFlag1 || 'Blurry Frame'}
                >
                  {projectSettings?.qaFlag1 || 'Blurry Frame'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({ ...prev, checkObstruction: !prev.checkObstruction }))}
                  className={`py-2 px-1 rounded-lg border text-center transition-all cursor-pointer text-[11px] font-medium truncate ${config.checkObstruction ? 'bg-card border-subtle text-text-base font-semibold shadow-sm' : 'bg-card border-subtle text-text-muted hover:text-text-base'
                    }`}
                  title={projectSettings?.qaFlag2 || 'Lens Obstruction'}
                >
                  {projectSettings?.qaFlag2 || 'Lens Obstruction'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({ ...prev, checkGps: !prev.checkGps }))}
                  className={`py-2 px-1 rounded-lg border text-center transition-all cursor-pointer text-[11px] font-medium truncate ${config.checkGps ? 'bg-card border-subtle text-text-base font-semibold shadow-sm' : 'bg-card border-subtle text-text-muted hover:text-text-base'
                    }`}
                  title={projectSettings?.qaFlag3 || 'Bad GPS Signal'}
                >
                  {projectSettings?.qaFlag3 || 'Bad GPS Signal'}
                </button>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-muted">Acquisition QC Operator (PIC):</span>
                  <span className="text-text-muted text-[10px]">
                    Assigned: <span className="text-text-base font-semibold">{inspectorPic}</span>
                  </span>
                </div>
                <input
                  type="text"
                  value={inspectorPic}
                  onChange={(e) => setInspectorPic(e.target.value)}
                  placeholder="Enter operator handle"
                  className="w-full bg-card border border-subtle rounded-xl px-3 py-1.5 text-xs text-text-base placeholder:text-text-muted focus:outline-none focus:border-subtle transition-all font-sans"
                />
              </div>

              <div className="pt-1">
                <button
                  onClick={handleLaunchInspection}
                  disabled={!selectedSubgrid || selectedStations.length === 0 || isRunning}
                  className={`w-full py-2.5 px-3.5 rounded-xl text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2 shadow-sm active:scale-98 cursor-pointer ${!selectedSubgrid || selectedStations.length === 0
                    ? 'bg-card text-text-muted border border-subtle cursor-not-allowed opacity-40'
                    : isRunning
                      ? 'bg-inner text-text-muted border border-subtle cursor-wait'
                      : 'bg-card hover:bg-inner text-text-base border border-subtle shadow-sm'
                    }`}
                >
                  {isRunning ? (
                    <>
                      <Activity size={14} className="animate-spin text-text-muted" />
                      <span>Scanning Stream...</span>
                    </>
                  ) : cachedAudit ? (
                    <>
                      <RotateCcw size={14} />
                      <span>Re-run Inspection</span>
                    </>
                  ) : (
                    <>
                      <Play size={14} className="fill-current" />
                      <span>Start Automated Acquisition QC</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </aside>

          {/* COLUMN 2: CENTER STAGE VIEWPORT */}
          <div className={`w-full lg:flex-1 bg-black border border-subtle rounded-2xl relative flex flex-col justify-between overflow-hidden shadow-sm min-w-0 ${mobileConsoleTab === 'canvas' ? 'flex-1' : 'hidden lg:flex'}`}>
            {(isCompleted || (progressPct === 100 && !isRunning && effectiveHistory.length > 0)) && (
              <div className="m-3 px-3.5 py-2.5 bg-card/95 backdrop-blur-md border border-subtle rounded-xl shadow-md flex items-center justify-between shrink-0 text-xs z-20 animate-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <span className="font-semibold text-text-base text-xs">
                    Audit Completed ({selectedStations.length > 0 ? selectedStations.length : effectiveHistory.length} Stations)
                  </span>
                  <span className="text-text-muted/40">•</span>
                  <span className={`font-medium text-xs ${effectiveDefectsList.length > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400'}`}>
                    {effectiveDefectsList.length === 0 ? 'Zero Defects' : `${effectiveDefectsList.length} Defect(s)`}
                  </span>
                  <span className="text-text-muted/40">•</span>
                  <span className="text-text-muted text-xs">Pass Rate: <strong className="text-text-base font-bold font-sans">{selectedStations.length > 0 ? Math.max(0, Math.round(((selectedStations.length - effectiveDefectsList.length) / selectedStations.length) * 100)) : auditPassRate}%</strong></span>
                </div>

                <div className="flex items-center gap-2 text-text-muted text-xs font-sans shrink-0">
                  <span>Subgrid: <strong className="text-text-base font-bold">{activeRunningSubgrid || selectedSubgrid}</strong></span>
                </div>
              </div>
            )}

            {!(isCompleted || (progressPct === 100 && !isRunning && effectiveHistory.length > 0)) && (
              <div className="m-3 px-3.5 py-2 bg-card/90 backdrop-blur-md border border-subtle rounded-xl flex items-center justify-between shrink-0 text-xs z-10 shadow-sm gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-text-muted font-medium uppercase tracking-wider text-[10px] hidden xs:inline">Target:</span>
                  <span className="font-bold text-text-base px-2.5 py-0.5 rounded-lg bg-inner border border-subtle font-sans text-xs truncate max-w-[120px] sm:max-w-none">
                    {activeRunningSubgrid || selectedSubgrid || 'None'}
                  </span>
                  <span className="text-text-muted/40">•</span>
                  <span className="text-text-muted font-medium font-sans text-xs truncate">
                    {isRunning || isCompleted
                      ? `Node ${Math.min(currentIndex + 1, totalStations)} / ${totalStations}`
                      : `${selectedStations.length} Queued`}
                  </span>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 text-xs text-text-muted shrink-0">
                  <div className="flex items-center gap-1 font-sans">
                    <span className="text-text-muted text-[11px] hidden xs:inline">Remaining:</span>
                    <span className="tabular-nums text-text-base font-semibold">{isCompleted ? '0s' : isRunning ? `${estimatedSecondsLeft}s` : '--'}</span>
                  </div>
                  <div className="flex items-center gap-1 font-sans">
                    <span className="text-text-muted text-[11px] hidden xs:inline">Defects:</span>
                    <span className={`tabular-nums font-bold px-2 py-0.5 rounded-lg font-sans ${effectiveDefectsList.length > 0 ? "bg-inner text-rose-400 border border-subtle" : "bg-inner text-text-base border border-subtle"}`}>
                      {effectiveDefectsList.length}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Main Dual-Viewport Area */}
            <div className={`flex-1 relative w-full h-full min-h-[300px] overflow-hidden flex bg-app ${viewportMode === 'vertical' ? 'flex-col lg:flex-row' : 'flex-col'
              }`}>
              {/* 360° PANORAMA CANVAS VIEWPORT */}
              <div
                className={`relative w-full overflow-hidden flex items-center justify-center bg-black ${viewportMode === 'horizontal'
                  ? 'h-1/2 sm:h-[55%] border-b border-subtle'
                  : viewportMode === 'vertical'
                    ? 'h-1/2 lg:h-full lg:w-1/2 border-b lg:border-b-0 lg:border-r border-subtle'
                    : 'h-full w-full'
                  }`}
              >
                {(activeRunningSubgrid || selectedSubgrid) && activeDisplayThumbnail ? (
                  <>
                    <PhotoSphereViewerComponent
                      ref={psvRef}
                      key={`pano-psv-${activeRunningSubgrid || selectedSubgrid}-${projectSettings?.storageProvider || 'dynamic'}`}
                      configUrl={
                        shouldUseMultiRes
                          ? resolvePanoramaConfigUrl(
                            activeDisplayPointId || activeRawFile,
                            projectSettings,
                            activeRunningSubgrid || selectedSubgrid
                          )
                          : undefined
                      }
                      panoramaUrl={!shouldUseMultiRes ? activeDisplayThumbnail : undefined}
                      initialYaw={activeDisplayBearing ?? 0}
                      initialFov={projectSettings?.defaultFov}
                      onPositionChange={(pos) => {
                        // Live heading-cone sync: reflect 360 rotation onto the embedded WebGIS map.
                        const yawDeg = Math.round(pos.yaw * 100) / 100;
                        const pitchDeg = Math.round(pos.pitch * 100) / 100;
                        if (mapIframeRef.current?.contentWindow) {
                          try {
                            mapIframeRef.current.contentWindow.postMessage({
                              type: 'CAMERA_ROTATED',
                              source: 'parent',
                              yaw: yawDeg,
                              pitch: pitchDeg
                            }, '*');
                          } catch (_) { }
                        }
                      }}
                      className="w-full h-full"
                    />

                    {/* HUD OVERLAY 1: Top-Left Node Identifier */}
                    {(isRunning || effectiveHistory.length > 0) && (
                      <div className="absolute top-3 left-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3.5 py-2 shadow-md space-y-0.5 max-w-[200px] sm:max-w-[320px] z-10">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0 animate-pulse" />
                          <span className="font-semibold text-xs text-white tracking-tight truncate font-sans">
                            {activeDisplayPointId || `Station ${activeDisplayIndex}`}
                          </span>
                        </div>
                        <div className="text-xs text-text-base font-sans font-normal pl-4 truncate">
                          Station <strong className="text-white font-bold">{activeDisplayIndex}</strong> of {totalStations}
                        </div>
                      </div>
                    )}

                    {/* HUD OVERLAY 2: Top-Right Diagnostics Stream */}
                    {(isRunning || effectiveHistory.length > 0) && (
                      <div className="absolute top-3 right-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3.5 py-2 shadow-md space-y-0.5 text-xs min-w-[120px] sm:min-w-[160px] z-10">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-text-base font-medium">GPS:</span>
                          <span
                            className={`font-bold font-sans ${activeRecord
                              ? activeRecord.defectType?.includes('GPS')
                                ? 'text-rose-400'
                                : 'text-sky-400'
                              : liveCheckStatus.gps.status === 'flagged'
                                ? 'text-rose-400'
                                : 'text-sky-400'
                              }`}
                          >
                            {activeRecord
                              ? `${activeDisplayStepDistance > 0 ? activeDisplayStepDistance.toFixed(1) : '0.0'}m`
                              : liveCheckStatus.gps.detail || `${currentStepDistance > 0 ? currentStepDistance.toFixed(1) : '0.0'}m`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-text-base font-medium">Equip:</span>
                          <span className="font-bold text-white font-sans truncate">
                            {(() => {
                              const currentItem = filteredTargetList.find(
                                (t) => t.subgrid === (activeRunningSubgrid || selectedSubgrid)
                              );
                              return (
                                currentItem?.raw?.captureEquipment ||
                                currentItem?.raw?.equipment ||
                                (projectSettings as any)?.captureEquipment ||
                                'MMS'
                              );
                            })()}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* HUD OVERLAY 3: Bottom-Left Spatial Coordinates */}
                    {(isRunning || effectiveHistory.length > 0) && (
                      <div className="absolute bottom-3 left-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3.5 py-2 shadow-md space-y-0.5 z-10">
                        <div className="text-white text-xs tabular-nums font-semibold flex items-center gap-1.5 font-sans">
                          <Navigation size={13} className="text-sky-400 shrink-0 rotate-45" />
                          <span>
                            {activeDisplayCoords.lat && activeDisplayCoords.lng
                              ? `${Number(activeDisplayCoords.lat).toFixed(4)}°, ${Number(activeDisplayCoords.lng).toFixed(4)}°`
                              : '0.0000°, 0.0000°'}
                          </span>
                        </div>
                        <div className="text-text-base text-xs font-normal flex items-center gap-1 font-sans pl-4">
                          <span className="text-text-muted">Step:</span>
                          <span className="tabular-nums text-white font-semibold">
                            {activeDisplayStepDistance > 0 ? `+${activeDisplayStepDistance.toFixed(1)}m` : '0.0m'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* HUD OVERLAY 4: Bottom-Right Compass Heading */}
                    {(isRunning || effectiveHistory.length > 0) && viewportMode !== 'pip' && (
                      <div className="absolute bottom-3 right-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3.5 py-2 shadow-md space-y-0.5 text-right z-10">
                        <div className="text-white text-xs tabular-nums font-semibold flex items-center justify-end gap-1.5 font-sans">
                          <Compass size={13} className="text-amber-400 shrink-0" />
                          <span>{activeDisplayBearing.toFixed(0)}°</span>
                        </div>
                        <div className="text-text-base text-xs font-normal flex items-center justify-end gap-1 font-sans">
                          <span className="text-text-muted">Track:</span>
                          <span
                            className={`font-semibold ${!activeDisplayCoords.lat || !activeDisplayCoords.lng
                              ? 'text-amber-400'
                              : activeDisplayStepDistance > 50
                                ? 'text-rose-400'
                                : 'text-sky-400'
                              }`}
                          >
                            {!activeDisplayCoords.lat || !activeDisplayCoords.lng
                              ? 'No Fix'
                              : activeDisplayStepDistance > 50
                                ? 'Drift'
                                : 'Locked'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Large Circular Navigation Buttons */}
                    <button
                      type="button"
                      onClick={() => setSelectedStationIndex(Math.max(1, activeDisplayIndex - 1))}
                      disabled={activeDisplayIndex <= 1 || isRunning}
                      aria-label="Previous Station"
                      className={`absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/80 hover:bg-black text-white border border-white/20 hover:border-white/50 shadow-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md active:scale-90 ${activeDisplayIndex <= 1 || isRunning
                        ? 'opacity-20 pointer-events-none'
                        : 'opacity-85 hover:opacity-100 hover:scale-105'
                        }`}
                      title={`Previous Station (Frame ${Math.max(1, activeDisplayIndex - 1)})`}
                    >
                      <ChevronLeft size={24} className="shrink-0 -translate-x-0.5" />
                    </button>

                    {/* Large Circular Next Station Button */}
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStationIndex(
                          Math.min(
                            totalStations > 0 ? totalStations : selectedStations.length,
                            activeDisplayIndex + 1
                          )
                        )
                      }
                      disabled={
                        activeDisplayIndex >= (totalStations > 0 ? totalStations : selectedStations.length) ||
                        isRunning
                      }
                      aria-label="Next Station"
                      className={`absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/80 hover:bg-black text-white border border-white/20 hover:border-white/50 shadow-2xl flex items-center justify-center transition-all cursor-pointer backdrop-blur-md active:scale-90 ${activeDisplayIndex >= (totalStations > 0 ? totalStations : selectedStations.length) ||
                        isRunning
                        ? 'opacity-20 pointer-events-none'
                        : 'opacity-85 hover:opacity-100 hover:scale-105'
                        }`}
                      title={`Next Station (Frame ${Math.min(
                        totalStations > 0 ? totalStations : selectedStations.length,
                        activeDisplayIndex + 1
                      )})`}
                    >
                      <ChevronRight size={24} className="shrink-0 translate-x-0.5" />
                    </button>

                    {/* Return to Live Telemetry Button */}
                    {selectedStationIndex !== null && isRunning && (
                      <button
                        onClick={() => setSelectedStationIndex(null)}
                        className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-card hover:bg-inner text-text-base border border-subtle px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shadow-lg flex items-center gap-1.5 active:scale-95 whitespace-nowrap z-20"
                      >
                        <RotateCcw size={13} />
                        <span>Return to Live #{currentIndex + 1}</span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 sm:p-8 text-center select-none bg-app">
                    <div className="w-12 h-12 rounded-xl bg-card border border-subtle flex items-center justify-center text-text-muted shadow-sm">
                      <Crosshair size={22} className="text-text-muted" />
                    </div>
                    <div className="space-y-1 max-w-sm">
                      <h4 className="text-xs sm:text-sm font-semibold text-text-base">
                        {isRunning ? 'Analyzing Panorama Stream' : 'Inspection Canvas Standby'}
                      </h4>
                      <p className="text-xs text-text-muted leading-relaxed max-w-xs mx-auto">
                        {selectedSubgrid
                          ? `Ready to scan ${selectedStations.length} stations in ${selectedSubgrid}`
                          : 'Select a survey dataset from the targets panel to initialize automated analysis'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* SYNCHRONIZED MAP VIEWPORT */}
              {(viewportMode === 'horizontal' || viewportMode === 'vertical') && (
                <div className={`relative bg-app flex flex-col overflow-hidden ${viewportMode === 'horizontal'
                  ? 'w-full h-1/2 sm:h-[45%]'
                  : 'w-full lg:w-1/2 h-1/2 lg:h-full'
                  }`}>
                  <div className="h-8 px-3 bg-card/90 backdrop-blur-md border-b border-subtle flex items-center justify-between shrink-0 text-xs z-10">
                    <div className="flex items-center gap-2">
                      <MapIcon size={13} className="text-sky-400" />
                      <span className="font-semibold text-text-base text-xs">Vehicle Trajectory Map</span>
                      <span className="text-text-muted/40">•</span>
                      <span className="text-text-muted font-sans text-[11px] truncate max-w-[120px] sm:max-w-none">
                        {activeRunningSubgrid || selectedSubgrid || 'No Target'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-text-muted font-sans text-[11px]">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="hidden sm:inline">Tracking Active</span>
                    </div>
                  </div>

                  <div className="flex-1 w-full h-full relative">
                    {(activeRunningSubgrid || selectedSubgrid) ? (
                      <iframe
                        ref={mapIframeRef}
                        src={`${import.meta.env.VITE_MAP_URL || ''}/?embed=true&dashboard=true&qaqcWorkbench=true&basemap=${encodeURIComponent(projectSettings?.defaultBasemap || DEFAULT_BASEMAP)}`}
                        className="w-full h-full border-0"
                        title="QAQC Synchronized Trajectory Map"
                        onLoad={() => {
                          setIsMapReady(true);
                          initWorkbenchMapTrack();
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-6 text-center select-none bg-app">
                        <div className="w-10 h-10 rounded-xl bg-card border border-subtle flex items-center justify-center text-text-muted">
                          <MapIcon size={20} className="text-text-muted" />
                        </div>
                        <div className="space-y-0.5 max-w-xs">
                          <h5 className="text-xs font-semibold text-text-base">Trajectory Map Standby</h5>
                          <p className="text-[11px] text-text-muted">Select a survey target from the left panel to load trajectory path</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* FLOATING PICTURE-IN-PICTURE MINIMAP */}
              {viewportMode === 'pip' && (
                <div className={`absolute bottom-3 right-3 z-30 transition-all duration-200 bg-card/95 backdrop-blur-md border border-subtle rounded-2xl shadow-2xl overflow-hidden flex flex-col ${isPipCollapsed ? 'w-56 h-10' : 'w-72 sm:w-88 md:w-96 h-56 sm:h-64'
                  }`}>
                  <div className="h-9 px-3 bg-inner/90 border-b border-subtle flex items-center justify-between shrink-0 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0" />
                      <span className="font-semibold text-text-base truncate text-xs">Live Map Follower</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setIsPipCollapsed(!isPipCollapsed)}
                        className="p-1 text-text-muted hover:text-text-base rounded-md hover:bg-card transition-colors cursor-pointer"
                        title={isPipCollapsed ? 'Expand Minimap' : 'Collapse Minimap'}
                      >
                        {isPipCollapsed ? <Maximize2 size={12} /> : <Minimize size={12} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewportMode('horizontal')}
                        className="p-1 text-text-muted hover:text-text-base rounded-md hover:bg-card transition-colors cursor-pointer"
                        title="Dock to Horizontal Split View"
                      >
                        <Rows size={12} />
                      </button>
                    </div>
                  </div>

                  {!isPipCollapsed && (
                    <div className="flex-1 w-full h-full relative">
                      <iframe
                        ref={mapIframeRef}
                        src={`${import.meta.env.VITE_MAP_URL || ''}/?embed=true&dashboard=true&qaqcWorkbench=true&basemap=${encodeURIComponent(projectSettings?.defaultBasemap || DEFAULT_BASEMAP)}`}
                        className="w-full h-full border-0"
                        title="QAQC Minimap PiP"
                        onLoad={() => {
                          setIsMapReady(true);
                          initWorkbenchMapTrack();
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {isAborted && (
              <div className="m-3 p-3 bg-card border border-rose-500/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shrink-0 text-xs shadow-md">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle size={14} className="text-rose-400 shrink-0" />
                  <span className="font-bold text-text-base text-xs">
                    Inspection Halted
                  </span>
                  <span className="text-text-muted text-xs font-sans">
                    • {effectiveHistory.length} scanned • {effectiveDefectsList.length} defects
                  </span>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  {effectiveDefectsList.length > 0 && onOpenDefectsGallery && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenDefectsGallery(activeRunningSubgrid || selectedSubgrid);
                      }}
                      className="w-full sm:w-auto px-3.5 py-1.5 bg-inner hover:bg-inner/80 text-text-base border border-subtle rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-sm text-center"
                    >
                      Review Defect Gallery
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* COLUMN 3: TELEMETRY STREAM */}
          <aside className={`w-full lg:w-[340px] bg-card border border-subtle rounded-2xl flex flex-col shrink-0 overflow-hidden shadow-sm text-xs ${mobileConsoleTab === 'telemetry' ? 'flex-1' : 'hidden lg:flex'}`}>
            <div className="p-3.5 border-b border-subtle flex items-center justify-between shrink-0 bg-card">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-text-muted" />
                <span className="font-bold text-text-base text-xs tracking-tight">
                  Telemetry Stream
                </span>
              </div>

              {effectiveDefectsList.length === 0 ? (
                <span className="px-2.5 py-0.5 rounded-full bg-inner text-text-muted border border-subtle text-[10px] font-medium font-sans">
                  SLA Nominal
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-inner text-rose-400 border border-subtle text-[10px] font-bold font-sans">
                  {effectiveDefectsList.length} Flagged
                </span>
              )}
            </div>

            <div className="p-3 border-b border-subtle bg-card">
              <div className="grid grid-cols-2 gap-1.5 bg-inner p-1 rounded-xl border border-subtle">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${filterMode === 'all' ? 'bg-card text-text-base shadow-sm border border-subtle' : 'text-text-muted hover:text-text-base'
                    }`}
                >
                  All ({effectiveHistory.length})
                </button>
                <button
                  onClick={() => setFilterMode('flagged')}
                  className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${filterMode === 'flagged' ? 'bg-card text-text-base shadow-sm border border-subtle' : 'text-text-muted hover:text-text-base'
                    }`}
                >
                  Defects ({effectiveDefectsList.length})
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
              {filteredHistory.length === 0 ? (
                <div className="p-8 text-center text-text-muted space-y-2 text-xs">
                  <ShieldCheck size={22} className="mx-auto text-text-muted/60" />
                  <p>{filterMode === 'flagged' ? 'No defects flagged' : 'Awaiting station telemetry...'}</p>
                </div>
              ) : (
                filteredHistory.map((item) => {
                  const isSelected = selectedStationIndex === item.index;
                  const isLive = item.index === currentIndex + 1 && selectedStationIndex === null && isRunning;

                  return (
                    <div
                      key={`${item.pointId}-${item.index}`}
                      onClick={() => setSelectedStationIndex(isSelected ? null : item.index)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer space-y-1 ${isSelected
                        ? 'bg-inner/60 border-slate-300/80 text-white shadow-lg ring-2 ring-slate-400/40'
                        : isLive
                          ? 'bg-slate-800/40 border-subtle/60 text-white'
                          : item.status === 'flagged'
                            ? 'bg-inner/60 border border-subtle text-text-base hover:bg-slate-800/40'
                            : 'bg-card hover:bg-slate-800/40 text-text-muted hover:text-text-base border-subtle'
                        }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.status === 'flagged' ? 'bg-rose-400' : 'bg-slate-500'
                            }`} />
                          <span className="font-bold text-xs text-text-base shrink-0 font-sans">
                            #{item.index}
                          </span>
                          <span className="text-text-muted/40 text-xs">•</span>
                          <span className="text-xs text-text-base font-medium truncate font-sans" title={item.pointId}>
                            {item.pointId}
                          </span>
                        </div>
                        <span className="text-[10px] tabular-nums font-sans text-text-muted shrink-0">
                          {item.timestamp}
                        </span>
                      </div>

                      {item.status === 'flagged' ? (
                        <div className="space-y-0.5 pt-0.5">
                          <span className="text-[11px] font-semibold text-rose-400 flex items-center gap-1">
                            <AlertTriangle size={11} className="shrink-0" />
                            <span>{item.defectType || 'Defect Flagged'}</span>
                          </span>
                          {item.reasons && item.reasons.length > 0 && (
                            <p className="text-[11px] text-text-muted truncate pl-3.5 font-sans">
                              {item.reasons[0]}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-[11px] text-text-muted font-sans">
                          <span className="tabular-nums text-text-muted">
                            {item.lat.toFixed(4)}°, {item.lng.toFixed(4)}°
                          </span>
                          <div className="flex items-center gap-2 tabular-nums text-text-muted">
                            <span>{item.stepDistance > 0 ? `+${item.stepDistance.toFixed(1)}m` : '0.0m'}</span>
                            {item.status === 'skipped' ? (
                              <span className="text-amber-400 font-sans text-[10px]">Skipped (Timeout/CORS)</span>
                            ) : item.blurVariance !== undefined ? (
                              <span className="text-text-base font-sans">Score {item.blurVariance.toFixed(1)}</span>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-3 bg-inner border-t border-subtle flex items-center justify-between text-[11px] text-text-muted">
              <div className="flex items-center gap-1.5 font-medium">
                <Database size={12} className="text-text-muted" />
                <span>Supabase Sync:</span>
              </div>
              <span className="text-text-base tabular-nums font-bold font-sans">
                {syncedCount} records upserted
              </span>
            </div>
          </aside>
        </div>
      )}

      {/* 2B. THRESHOLD CALIBRATION STUDIO VIEW */}
      {workbenchTab === 'thresholds' && (
        <QAQCThresholdStudioView
          thresholds={localThresholds}
          setThresholds={setLocalThresholds}
          onSave={handleSaveThresholds}
          onResetDefaults={handleResetThresholds}
        />
      )}

      {/* 2C. AUDIT SUMMARY VIEW */}
      {workbenchTab === 'audit' && (() => {
        const targetSub = (activeRunningSubgrid || selectedSubgrid || '').toUpperCase().trim();
        const activeItem = filteredTargetList.find(t => t.subgrid.toUpperCase().trim() === targetSub);
        const cachedAuditRecord = auditCache[`${targetSub}_${activeItem?.runId || 'default'}`] || auditCache[`${targetSub}_default`];

        const currentSubgrid = targetSub || 'GENERAL';
        const currentDate = surveyDate || activeItem?.date || (cachedAuditRecord as any)?.surveyDate || (cachedAuditRecord ? new Date(cachedAuditRecord.completedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
        const currentPic = activeRunningPic || inspectorPic || activeItem?.pic || cachedAuditRecord?.pic || 'Operator';
        const currentEquipment = (activeItem?.raw?.captureEquipment || activeItem?.raw?.equipment || (projectSettings as any)?.captureEquipment || 'MMS 360 Survey Sensor');
        const currentDistance = activeItem?.raw?.kmProcessed ? `${activeItem.raw.kmProcessed.toFixed(1)} km` : (cachedAuditRecord as any)?.trajectoryDistance ? `${(cachedAuditRecord as any).trajectoryDistance.toFixed(1)} km` : '—';
        const currentRunId = activeItem?.runId || cachedAuditRecord?.runId || 'RUN-AUDIT-ACTIVE';
        const currentModel = (localThresholds.deliverableModel || projectSettings?.deliverableModel || 'masked_car') === 'generative_fill' ? 'Generative Fill (Full 80% ROI)' : 'Vehicle Nadir Mask (Top 52% ROI)';

        const blurCount = effectiveDefectsList.filter((d: any) => (d.defectType || d.defectCategory || '').toLowerCase().includes('blur') || (Array.isArray(d.reasons) && d.reasons.some((r: string) => r.toLowerCase().includes('blur')))).length;
        const obstructionCount = effectiveDefectsList.filter((d: any) => (d.defectType || d.defectCategory || '').toLowerCase().includes('obstruction') || (d.defectType || d.defectCategory || '').toLowerCase().includes('glitch') || (Array.isArray(d.reasons) && d.reasons.some((r: string) => r.toLowerCase().includes('dark') || r.toLowerCase().includes('glare') || r.toLowerCase().includes('glitch')))).length;
        const gpsCount = effectiveDefectsList.filter((d: any) => (d.defectType || d.defectCategory || '').toLowerCase().includes('gps') || (Array.isArray(d.reasons) && d.reasons.some((r: string) => r.toLowerCase().includes('gps')))).length;
        const passedCount = Math.max(0, effectiveHistory.length - effectiveDefectsList.length);

        const filteredAuditHistory = effectiveHistory.filter(item => {
          if (auditLogFilter === 'flagged' && item.status !== 'flagged') return false;
          if (auditLogFilter === 'passed' && item.status === 'flagged') return false;
          if (auditSearchQuery.trim()) {
            const q = auditSearchQuery.toLowerCase();
            const matchId = (item.pointId || '').toLowerCase().includes(q);
            const matchReason = item.reasons ? item.reasons.some((r: string) => r.toLowerCase().includes(q)) : false;
            if (!matchId && !matchReason) return false;
          }
          return true;
        });

        return (
          <div className="flex-1 flex flex-col p-3 sm:p-6 bg-app overflow-y-auto space-y-4 sm:space-y-6 max-w-7xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-card border border-subtle shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-inner text-text-base border border-subtle shrink-0">
                  <FileSpreadsheet size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-text-base truncate flex items-center gap-2">
                    <span>QA/QC Audit Run History & Technical Details</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-sans text-text-muted bg-inner border border-subtle">
                      {isCompleted ? 'Completed' : isRunning ? 'In Progress' : 'Loaded Profile'}
                    </span>
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5 truncate">
                    Comprehensive quality assurance diagnostics, operator sign-off, and hardware sensor telemetry.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleExportCSV}
                  className="flex-1 sm:flex-initial px-3.5 py-2 bg-card hover:bg-inner text-text-base border border-subtle text-xs font-medium rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95 shrink-0"
                >
                  <Download size={13} />
                  <span>Export CSV Report</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 bg-card border border-subtle rounded-xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-subtle pb-2">
                  <span className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin size={13} className="text-text-muted" />
                    Survey Dataset
                  </span>
                  <span className="font-sans text-[10px] text-text-muted">Subgrid ID</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Target Subgrid:</span>
                    <span className="font-bold text-text-base font-sans">{currentSubgrid}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Survey Date:</span>
                    <span className="text-text-base flex items-center gap-1 font-sans text-[11px]">
                      <Calendar size={12} className="text-text-muted" />
                      {currentDate}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Trajectory Distance:</span>
                    <span className="font-medium text-text-base font-sans text-[11px]">{currentDistance}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Station Count:</span>
                    <span className="font-sans text-text-base font-semibold">{effectiveHistory.length} Frames</span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-card border border-subtle rounded-xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-subtle pb-2">
                  <span className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <User size={13} className="text-text-muted" />
                    Operator & Equipment
                  </span>
                  <span className="font-sans text-[10px] text-text-muted">PIC Sign-Off</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Person In Charge (PIC):</span>
                    <span className="font-medium text-text-base bg-inner px-2 py-0.5 rounded-lg border border-subtle text-[11px]">
                      {currentPic}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Capture Device:</span>
                    <span className="text-text-base flex items-center gap-1">
                      <Camera size={12} className="text-text-muted" />
                      {currentEquipment}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Audit Completed:</span>
                    <span className="text-text-base flex items-center gap-1 font-sans text-[11px]">
                      <Clock size={12} className="text-text-muted" />
                      {cachedAuditRecord?.completedAt || (isCompleted ? 'Just now' : isRunning ? 'In Progress' : '—')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Inspection Run ID:</span>
                    <span className="font-sans text-[10px] text-text-muted truncate max-w-[140px]" title={currentRunId}>
                      {currentRunId}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-card border border-subtle rounded-xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-subtle pb-2">
                  <span className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <SlidersHorizontal size={13} className="text-text-muted" />
                    Active Thresholds
                  </span>
                  <span className="font-sans text-[10px] text-text-muted">Profile</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Deliverable Model:</span>
                    <span className="font-medium text-text-base text-[11px] truncate max-w-[150px]" title={currentModel}>
                      {currentModel}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Blur Cutoff:</span>
                    <span className="font-sans font-medium text-text-base">{localThresholds.blurVarianceThreshold ?? 68.0} / 100</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Max GPS Step:</span>
                    <span className="font-sans font-medium text-text-base">{localThresholds.gpsMaxJumpDistanceMeters ?? 50.0}m</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Obstruction Brightness:</span>
                    <span className="font-sans font-medium text-text-base">{localThresholds.obstructionMinBrightness ?? 15.0} lux</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">SLA Pass Rate</span>
                <p className="text-xl font-bold font-sans text-text-base">
                  {auditPassRate}%
                </p>
                <span className="text-[10px] text-text-muted font-sans">{passedCount} / {effectiveHistory.length} Passed</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Nodes Audited</span>
                <p className="text-xl font-bold text-text-base font-sans">{effectiveHistory.length}</p>
                <span className="text-[10px] text-text-muted font-sans">100% Surveyed</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Total Defects</span>
                <p className="text-xl font-bold font-sans text-text-base">
                  {effectiveDefectsList.length}
                </p>
                <span className="text-[10px] text-text-muted font-sans">{effectiveHistory.length > 0 ? ((effectiveDefectsList.length / effectiveHistory.length) * 100).toFixed(1) : 0}% Rate</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Mean Sharpness</span>
                <p className="text-xl font-bold text-text-base font-sans">{meanSharpnessScore}</p>
                <span className="text-[10px] text-text-muted font-sans">Cutoff {localThresholds.blurVarianceThreshold ?? 68.0}</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Blur Defects</span>
                <p className="text-xl font-bold font-sans text-text-base">
                  {blurCount}
                </p>
                <span className="text-[10px] text-text-muted font-sans">Low Focus</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Obstructions</span>
                <p className="text-xl font-bold font-sans text-text-base">
                  {obstructionCount}
                </p>
                <span className="text-[10px] text-text-muted font-sans">Glare / Dark</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">GPS Drift</span>
                <p className="text-xl font-bold font-sans text-text-base">
                  {gpsCount}
                </p>
                <span className="text-[10px] text-text-muted font-sans">&gt; {localThresholds.gpsMaxJumpDistanceMeters ?? 50}m</span>
              </div>
            </div>

            <div className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-sm flex flex-col">
              <div className="px-4 py-3 border-b border-subtle bg-inner flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-xs text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <Activity size={14} className="text-text-muted" />
                    Station Diagnostics Log ({effectiveHistory.length})
                  </span>

                  <div className="flex items-center bg-card border border-subtle rounded-xl p-0.5 text-xs">
                    <button
                      onClick={() => setAuditLogFilter('all')}
                      className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${auditLogFilter === 'all' ? 'bg-inner text-text-base font-semibold' : 'text-text-muted hover:text-text-base'
                        }`}
                    >
                      All ({effectiveHistory.length})
                    </button>
                    <button
                      onClick={() => setAuditLogFilter('flagged')}
                      className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${auditLogFilter === 'flagged' ? 'bg-inner text-text-base font-semibold' : 'text-text-muted hover:text-text-base'
                        }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                      Defects ({effectiveDefectsList.length})
                    </button>
                    <button
                      onClick={() => setAuditLogFilter('passed')}
                      className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${auditLogFilter === 'passed' ? 'bg-inner text-text-base font-semibold' : 'text-text-muted hover:text-text-base'
                        }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Passed ({passedCount})
                    </button>
                  </div>
                </div>

                <div className="relative min-w-[200px]">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={auditSearchQuery}
                    onChange={(e) => setAuditSearchQuery(e.target.value)}
                    placeholder="Search filename / reason..."
                    className="w-full pl-8 pr-3 py-1.5 bg-card border border-subtle rounded-xl text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-subtle transition-colors font-sans"
                  />
                </div>
              </div>

              <div className="max-h-[500px] overflow-x-auto overflow-y-auto">
                {filteredAuditHistory.length === 0 ? (
                  <div className="p-12 text-center text-xs text-text-muted flex flex-col items-center justify-center gap-2">
                    <Activity size={24} className="text-text-muted" />
                    <span>No station records matching the current filter.</span>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="sticky top-0 bg-inner border-b border-subtle z-10">
                      <tr className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Station</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Subgrid</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Point ID / File</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Date</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Time</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Coordinates</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Score</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Status</th>
                        <th className="px-3.5 py-2.5 whitespace-nowrap">Diagnostic Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {filteredAuditHistory.map((item) => {
                        const isFlagged = item.status === 'flagged';
                        const timeStr = item.timestamp ? (item.timestamp.includes(',') ? item.timestamp.split(',').pop()?.trim() : item.timestamp) : '—';
                        const itemSubgrid = extractSubgridName(item.pointId) || currentSubgrid;
                        return (
                          <tr
                            key={`${item.pointId}-${item.index}`}
                            className="hover:bg-inner/40 transition-colors"
                          >
                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 font-sans font-medium text-text-base">
                                <span className={`w-1.5 h-1.5 rounded-full ${isFlagged ? 'bg-rose-400' : 'bg-slate-500'} shrink-0`} />
                                <span>#{item.index}</span>
                              </div>
                            </td>
                            <td className="px-3.5 py-2.5 font-sans font-bold text-text-base whitespace-nowrap">
                              {itemSubgrid}
                            </td>
                            <td className="px-3.5 py-2.5 font-sans font-medium text-text-base whitespace-nowrap">
                              {item.pointId}
                            </td>
                            <td className="px-3.5 py-2.5 text-text-muted whitespace-nowrap font-sans text-[11px]">
                              {currentDate}
                            </td>
                            <td className="px-3.5 py-2.5 text-text-muted whitespace-nowrap font-sans text-[11px]">
                              {timeStr}
                            </td>
                            <td className="px-3.5 py-2.5 font-sans text-text-muted text-[11px] whitespace-nowrap">
                              {item.lat.toFixed(4)}°, {item.lng.toFixed(4)}°
                            </td>
                            <td className="px-3.5 py-2.5 font-sans font-medium text-text-base whitespace-nowrap text-[11px]">
                              {item.blurVariance !== undefined ? item.blurVariance.toFixed(1) : '—'}
                            </td>
                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                              {isFlagged ? (
                                <span className="px-2.5 py-0.5 rounded-full bg-inner border border-subtle text-rose-400 font-semibold text-[10px] inline-flex items-center gap-1 font-sans">
                                  {item.defectType || 'Defect'}
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 rounded-full bg-inner border border-subtle text-emerald-400 font-medium text-[10px] inline-flex items-center gap-1 font-sans">
                                  PASSED
                                </span>
                              )}
                            </td>
                            <td className="px-3.5 py-2.5 text-text-muted text-[11px] max-w-xs truncate">
                              {item.reasons && item.reasons.length > 0 ? item.reasons.join('; ') : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
