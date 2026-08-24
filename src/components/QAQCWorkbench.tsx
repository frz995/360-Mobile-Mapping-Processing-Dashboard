import React, { useState, useMemo, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Play,
  Pause,
  StopCircle,
  ShieldCheck,
  Navigation,
  Database,
  Minimize2,
  X,
  Crosshair,
  Layers,
  Compass,
  Search,
  RotateCcw,
  Download,
  FileSpreadsheet,
  Check,
  SlidersHorizontal,
  User,
  Calendar,
  Camera,
  Clock,
  MapPin
} from 'lucide-react';
import type { QAQCWorkerState, StationInspectionRecord, StationNode } from '../hooks/useQAQCWorker';
import type { QAQCConfig, ExtendedProjectSettings, QADefectRecord } from '../types/admin';
import { saveProjectSettingsToSupabase } from '../services/supabase';
import { QAQCThresholdStudioView } from './QAQCThresholdStudioModal';
import {
  getImagesProcessedCount,
  formatDisplayDate,
  extractSubgridName,
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
    stepIntervalMs: number;
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
  km: number;
  pic: string;
  defectCount: number;
  qaqcStatus: string;
  isPublished: boolean;
  publishStatus: 'published' | 'staging' | 'recheck';
}

export const QAQCWorkbench: React.FC<QAQCWorkbenchProps> = ({
  isOpen,
  workerState,
  dailyData = [],
  batchLogs = [],
  projectSettings,
  qaqcAuditRuns = {},
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
  onSignOffAndPublish: _onSignOffAndPublish
}) => {
  // Navigation & Filter Tabs (Default to Daily tab if a specific run was selected, else Masterlist)
  const [targetTab, setTargetTab] = useState<'daily' | 'masterlist'>(initialRunId ? 'daily' : 'masterlist');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'staging' | 'published'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showOnlyWithFrames, setShowOnlyWithFrames] = useState<boolean>(false);

  // Selected Target Dataset in Console strictly scoped to the active selection
  const [selectedSubgrid, setSelectedSubgrid] = useState<string>(initialSubgrid || '');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId || null);

  useEffect(() => {
    if (initialSubgrid) setSelectedSubgrid(initialSubgrid);
    if (initialRunId !== undefined) {
      setSelectedRunId(initialRunId);
      if (initialRunId) setTargetTab('daily');
    }
  }, [initialSubgrid, initialRunId]);

  // Inspection Rules & 4 Pacing Options (Auto + 200ms + 300ms + 500ms)
  const [config, setConfig] = useState<QAQCConfig>({
    checkBlur: true,
    checkObstruction: true,
    checkGps: true
  });
  const [isAutoPacing, setIsAutoPacing] = useState<boolean>(true);
  const [stepIntervalMs, setStepIntervalMs] = useState<number>(200);
  const [inspectorPic, setInspectorPic] = useState<string>(activeUserName || 'Operator');

  // Telemetry stream history selection & filtering
  const [selectedStationIndex, setSelectedStationIndex] = useState<number | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'flagged'>('all');

  const [workbenchTab, setWorkbenchTab] = useState<'console' | 'thresholds' | 'audit'>('console');
  const [mobileConsoleTab, setMobileConsoleTab] = useState<'canvas' | 'targets' | 'telemetry'>('canvas');
  const [auditLogFilter, setAuditLogFilter] = useState<'all' | 'flagged' | 'passed'>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState<string>('');

  // Dynamic QA/QC Defect Detection Thresholds (Loaded from Cloud Project Settings)
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
    saveProjectSettingsToSupabase(updatedSettings).catch(() => {});
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
    saveProjectSettingsToSupabase(updatedSettings).catch(() => {});
  };

  // Persistent Audit Cache Map populated from Supabase Realtime/Cloud props and session updates
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

  // Auto-sync inspector PIC
  useEffect(() => {
    if (activeUserName && (!inspectorPic || inspectorPic === 'Operator')) {
      setInspectorPic(activeUserName);
    }
  }, [activeUserName]);

  // Save completed audit to cache
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

  // Processed list for Daily Runs Tab (matches exact order and logic of Processing Admin Daily Progress table)
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

        const cachedAudit = runId ? auditCache[`${sg}_${runId}`] : undefined;
        let parsedDefects: number | undefined;
        if (d.qaqcStatus) {
          const m = d.qaqcStatus.match(/(\d+)\s+Defect/i);
          if (m) parsedDefects = parseInt(m[1], 10);
        }

        const defectCount = frameCount === 0
          ? 0
          : (cachedAudit && typeof cachedAudit.defectCount === 'number')
          ? cachedAudit.defectCount
          : (parsedDefects !== undefined && parsedDefects > 0)
          ? parsedDefects
          : (d.imagesDefected && d.imagesDefected > 0)
          ? d.imagesDefected
          : (d.defectCount && d.defectCount > 0)
          ? d.defectCount
          : 0;

        const isPublished = d.publishToWebGIS === 'yes' || d.qaqcStatus === 'QA/QC Approved' || Boolean(d.isSyncedWithSupabase) || d.status === 'published';
        const isRecheck = d.publishToWebGIS === 'need to recheck';
        const publishStatus: 'published' | 'staging' | 'recheck' = isPublished ? 'published' : isRecheck ? 'recheck' : 'staging';

        const qaqcStatus = frameCount === 0
          ? (isPublished ? 'QA/QC Approved' : '')
          : (d.qaqcStatus || (cachedAudit ? `QAQC Completed (${defectCount} Defect${defectCount === 1 ? '' : 's'} Found)` : isPublished ? 'QA/QC Approved' : ''));

        return {
          raw: d,
          runId,
          subgrid: sg,
          date: formattedDate,
          rawDate: d.date,
          frameCount,
          km,
          pic,
          defectCount,
          qaqcStatus,
          isPublished,
          publishStatus
        };
      });
  }, [dailyData, batchLogs, auditCache, activeUserName]);

  // Processed list for Masterlist / Batches Tab (matches exact order and logic of Processing Admin Masterlist table)
  const processedBatchLogs: TargetDatasetItem[] = useMemo(() => {
    const reconciled = reconcileBatchLogs(dailyData, batchLogs);
    const sourceBatches = reconciled && reconciled.length > 0 ? reconciled : batchLogs;

    return sourceBatches.map((b, idx) => {
      const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const frameCount = getImagesProcessedCount(b);
      const km = b.kmProcessed ? Number(b.kmProcessed) : 0;
      const formattedBatchId = formatBatchIdDisplay(b, idx);
      const pic = (b.pic && b.pic.trim().toLowerCase() !== 'unassigned') ? b.pic : ((b as any).adminPic || activeUserName || 'Admin');
      const formattedDate = formatDisplayDate(b.date);

      const cachedAudit = auditCache[`${sg}_default`] || Object.entries(auditCache).find(([k]) => k.startsWith(`${sg}_`))?.[1];
      let parsedDefects: number | undefined;
      if (b.qaqcStatus) {
        const m = b.qaqcStatus.match(/(\d+)\s+Defect/i);
        if (m) parsedDefects = parseInt(m[1], 10);
      }

      const defectCount = (cachedAudit && typeof cachedAudit.defectCount === 'number')
        ? cachedAudit.defectCount
        : (parsedDefects !== undefined && parsedDefects > 0)
        ? parsedDefects
        : (b.defects && b.defects > 0)
        ? b.defects
        : 0;

      const isPublished = b.publishToWebGIS === 'yes' || b.qaqcStatus === 'QA/QC Approved' || Boolean(b.isSyncedWithSupabase) || b.status === 'published';
      const isRecheck = b.publishToWebGIS === 'need to recheck';
      const publishStatus: 'published' | 'staging' | 'recheck' = isPublished ? 'published' : isRecheck ? 'recheck' : 'staging';

      return {
        raw: b,
        runId: null,
        subgrid: sg,
        batchId: formattedBatchId,
        date: formattedDate,
        rawDate: b.date,
        frameCount,
        km,
        pic,
        defectCount,
        qaqcStatus: b.qaqcStatus || (cachedAudit ? `QAQC Completed (${defectCount} Defect${defectCount === 1 ? '' : 's'} Found)` : isPublished ? 'QA/QC Approved' : ''),
        isPublished,
        publishStatus
      };
    });
  }, [dailyData, batchLogs, auditCache, activeUserName]);

  // Counts for Category Switcher
  const stagingCount = useMemo(() => {
    const list = targetTab === 'daily' ? processedDailyRuns : processedBatchLogs;
    return list.filter(i => !i.isPublished).length;
  }, [targetTab, processedDailyRuns, processedBatchLogs]);

  const publishedCount = useMemo(() => {
    const list = targetTab === 'daily' ? processedDailyRuns : processedBatchLogs;
    return list.filter(i => i.isPublished).length;
  }, [targetTab, processedDailyRuns, processedBatchLogs]);

  // Auto-select first valid dataset if none selected
  useEffect(() => {
    if (!selectedSubgrid && !isRunning) {
      const firstValidDaily = processedDailyRuns.find(r => r.frameCount > 0);
      if (firstValidDaily) {
        setSelectedSubgrid(firstValidDaily.subgrid);
        setSelectedRunId(firstValidDaily.runId);
        if (firstValidDaily.pic && firstValidDaily.pic !== 'Unassigned') {
          setInspectorPic(firstValidDaily.pic);
        }
      }
    }
  }, [processedDailyRuns, selectedSubgrid, isRunning]);

  // Filtered dataset targets based on search query, category filter & valid frame toggles
  const filteredTargetList: TargetDatasetItem[] = useMemo(() => {
    let list = targetTab === 'daily' ? processedDailyRuns : processedBatchLogs;
    if (categoryFilter === 'staging') {
      list = list.filter(item => !item.isPublished);
    } else if (categoryFilter === 'published') {
      list = list.filter(item => item.isPublished);
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

  // Selected Target Dataset Station Array (strictly validated against frame count)
  const selectedStations = useMemo(() => {
    if (!selectedSubgrid) return [];
    return getStationsForSubgrid(selectedSubgrid, selectedRunId);
  }, [selectedSubgrid, selectedRunId, getStationsForSubgrid]);

  // Look up cached audit run for selected dataset
  const cachedAudit: AuditRunRecord | null = useMemo(() => {
    if (!selectedSubgrid) return null;
    const key = `${selectedSubgrid.toUpperCase()}_${selectedRunId || 'default'}`;
    return auditCache[key] || null;
  }, [auditCache, selectedSubgrid, selectedRunId]);

  // Effective Active Telemetry Data (live runner if active, else cached audit if available)
  const effectiveHistory = useMemo(() => {
    if (isRunning || liveHistory.length > 0) return liveHistory;
    if (cachedAudit && cachedAudit.history) return cachedAudit.history;
    return [];
  }, [isRunning, liveHistory, cachedAudit]);

  const effectiveDefectsList = useMemo(() => {
    if (isRunning || liveHistory.length > 0) return liveDefectsList;
    if (cachedAudit && cachedAudit.defectsList) return cachedAudit.defectsList;
    return [];
  }, [isRunning, liveHistory, liveDefectsList, cachedAudit]);

  // Telemetry station metrics
  const totalStations = rawTotalStations || (cachedAudit ? cachedAudit.totalStations : selectedStations.length) || 1;
  const progressPct = isRunning || isCompleted
    ? Math.min(100, Math.round(((currentIndex + 1) / totalStations) * 100))
    : cachedAudit
    ? 100
    : 0;
  const remainingStations = Math.max(0, totalStations - (currentIndex + 1));
  const estimatedSecondsLeft = Math.ceil((remainingStations * stepIntervalMs) / 1000);

  // Selected station preview if clicked from history feed, otherwise live current node
  const activeRecord: StationInspectionRecord | null = useMemo(() => {
    if (selectedStationIndex !== null) {
      return effectiveHistory.find(h => h.index === selectedStationIndex) || null;
    }
    return null;
  }, [selectedStationIndex, effectiveHistory]);

  const activeDisplayThumbnail = activeRecord
    ? activeRecord.thumbnailUrl
    : currentThumbnail || (cachedAudit && cachedAudit.history[0]?.thumbnailUrl) || (selectedStations[0]?.thumbnailUrl);
  const activeDisplayPointId = activeRecord
    ? activeRecord.pointId
    : currentPointId || (cachedAudit && cachedAudit.history[0]?.pointId) || (selectedStations[0]?.id);
  const activeDisplayCoords = activeRecord
    ? { lat: activeRecord.lat, lng: activeRecord.lng }
    : currentCoords.lat && currentCoords.lng
    ? currentCoords
    : { lat: selectedStations[0]?.lat || null, lng: selectedStations[0]?.lng || null };
  const activeDisplayBearing = activeRecord
    ? activeRecord.bearing
    : currentBearing || selectedStations[0]?.bearing || 0;
  const activeDisplayStepDistance = activeRecord
    ? activeRecord.stepDistance
    : currentStepDistance;
  const activeDisplayIndex = Math.min(
    totalStations,
    Math.max(1, activeRecord ? activeRecord.index : isRunning || isCompleted ? currentIndex + 1 : 1)
  );

  // Filtered station history stream
  const filteredHistory = useMemo(() => {
    if (filterMode === 'flagged') {
      return effectiveHistory.filter(h => h.status === 'flagged');
    }
    return effectiveHistory;
  }, [effectiveHistory, filterMode]);

  // Handle launch of inspection
  const handleLaunchInspection = () => {
    if (!selectedSubgrid || selectedStations.length === 0) return;

    setSelectedStationIndex(null);
    setMobileConsoleTab('canvas');
    onStartInspection({
      subgrid: selectedSubgrid,
      runId: selectedRunId,
      stations: selectedStations,
      config,
      stepIntervalMs,
      pic: inspectorPic.trim() || activeUserName || 'Operator',
      customThresholds: localThresholds
    });
  };

  // Export Audit CSV Functionality
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

  // Mean Tenengrad Sharpness across inspected history
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

  return (
    <div className="fixed inset-0 z-[99999] bg-app flex flex-col text-text-base select-none font-sans overflow-hidden">

      {/* ========================================================= */}
      {/* 1. TOP PRECISION CONSOLE HEADER BAR */}
      {/* ========================================================= */}
      <header className="h-14 px-4 bg-card border-b border-subtle flex items-center justify-between shrink-0 relative z-30 shadow-sm gap-2">
        
        {/* Left: Breadcrumbs & Target Identifier */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs truncate">
            <span className="text-text-muted font-medium tracking-tight hidden md:inline">GeoSphere 360</span>
            <span className="text-text-muted/30 hidden md:inline">/</span>
            <span className="text-text-muted font-medium hidden sm:inline">QA/QC</span>
            <span className="text-text-muted/30 hidden sm:inline">/</span>
            {workbenchTab === 'console' && (
              <>
                <span className="text-text-base font-mono font-bold px-2.5 py-1 rounded-lg bg-inner border border-subtle text-xs truncate max-w-[130px] sm:max-w-none">
                  {isRunning || isCompleted ? activeRunningSubgrid : (selectedSubgrid || 'No Target')}
                </span>
                {surveyDate && (
                  <>
                    <span className="text-text-muted/30 hidden lg:inline">•</span>
                    <span className="text-text-muted text-xs font-mono hidden lg:inline">{surveyDate}</span>
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
                <span className="text-text-muted text-[10px] hidden lg:inline font-mono px-2 py-0.5 rounded-lg bg-inner border border-subtle">
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

          {/* Engine Status Tag */}
          {workbenchTab === 'console' && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-inner border border-subtle text-[11px] shrink-0">
              <span className={`w-2 h-2 rounded-full ${
                isRunning && !isPaused
                  ? 'bg-sky-400 animate-pulse'
                  : isPaused
                  ? 'bg-amber-400'
                  : isCompleted || (cachedAudit && !isRunning)
                  ? 'bg-emerald-400'
                  : 'bg-slate-500'
              }`} />
              <span className="text-text-muted font-medium text-[11px]">
                {isRunning && !isPaused
                  ? `Active (${Math.round(1000 / stepIntervalMs)} FPS)`
                  : isPaused
                  ? 'Paused'
                  : isCompleted || (cachedAudit && !isRunning)
                  ? 'Completed'
                  : 'Idle'}
              </span>
            </div>
          )}
        </div>

        {/* Center: Live Station Progress Telemetry */}
        {workbenchTab === 'console' && (isRunning || isCompleted || cachedAudit) && (
          <div className="hidden lg:flex items-center gap-3 text-xs text-text-base bg-inner px-3.5 py-1.5 rounded-xl border border-subtle shrink-0 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-auto shadow-sm">
            <span className="text-text-muted font-normal text-xs">
              Station <strong className="text-text-base font-bold font-mono">{Math.min(currentIndex + 1, totalStations)}</strong> / <span className="text-text-muted font-mono">{totalStations}</span>
            </span>
            <div className="w-24 xl:w-32 h-1.5 bg-card rounded-full overflow-hidden border border-subtle">
              <div
                className="h-full bg-sky-400 rounded-full transition-all duration-150"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-text-base tabular-nums font-bold font-mono text-xs">{progressPct}%</span>
            <span className="text-text-muted text-[11px] tabular-nums font-mono">{elapsedSeconds || cachedAudit?.elapsedSeconds || 0}s</span>
          </div>
        )}

        {/* Right: Main View Navigation Switcher & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Main Navigation Segmented Switcher */}
          <div className="flex items-center p-1 rounded-xl bg-inner border border-subtle">
            <button
              type="button"
              onClick={() => setWorkbenchTab('console')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                workbenchTab === 'console'
                  ? 'bg-card text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
              }`}
              title="Return to Live QA/QC Inspection Console"
            >
              <Activity size={13} className={workbenchTab === 'console' ? 'text-text-base' : 'text-text-muted'} />
              <span className="hidden xs:inline">Console</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkbenchTab('thresholds')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                workbenchTab === 'thresholds'
                  ? 'bg-card text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
              }`}
              title="Configure and Calibrate Detection Thresholds"
            >
              <SlidersHorizontal size={13} className={workbenchTab === 'thresholds' ? 'text-text-base' : 'text-text-muted'} />
              <span className="hidden xs:inline">Thresholds</span>
            </button>

            <button
              type="button"
              onClick={() => setWorkbenchTab('audit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                workbenchTab === 'audit'
                  ? 'bg-card text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
              }`}
              title="View Complete Audit Metrics & Defect Report"
            >
              <FileSpreadsheet size={13} className={workbenchTab === 'audit' ? 'text-text-base' : 'text-text-muted'} />
              <span className="hidden xs:inline">Audit</span>
            </button>
          </div>

          {/* Contextual Action: Console Live Inspection */}
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
            onClick={onClose}
            className="px-3 py-1.5 bg-card hover:bg-inner text-text-muted hover:text-text-base rounded-xl border border-subtle text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
            title="Minimize console"
          >
            <Minimize2 size={13} />
            <span className="hidden sm:inline">Minimize</span>
          </button>

          {isRunning ? (
            <button
              onClick={onAbort}
              className="px-3 py-1.5 bg-inner hover:bg-rose-950/30 text-rose-400 rounded-xl border border-subtle hover:border-rose-800/40 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Abort inspection loop"
            >
              <StopCircle size={13} />
              <span className="hidden sm:inline">Abort</span>
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-card hover:bg-rose-950/30 text-text-muted hover:text-rose-400 rounded-xl border border-subtle hover:border-rose-800/40 text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Exit console"
            >
              <X size={14} />
              <span className="hidden sm:inline">Exit</span>
            </button>
          )}
        </div>
      </header>

      {/* ========================================================= */}
      {/* 2. BODY CONTENT: CONSOLE / THRESHOLDS / AUDIT SUMMARY */}
      {/* ========================================================= */}
      {workbenchTab === 'console' && (
        <div className="flex-1 p-2 sm:p-3 gap-2 sm:gap-3 flex flex-col lg:flex-row overflow-hidden bg-app min-h-0">

          {/* MOBILE SEGMENTED VIEWPORT SWITCHER */}
          <div className="flex lg:hidden items-center justify-between p-1 rounded-xl bg-card border border-subtle shrink-0 shadow-sm gap-1">
            <button
              type="button"
              onClick={() => setMobileConsoleTab('canvas')}
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                mobileConsoleTab === 'canvas'
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
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                mobileConsoleTab === 'targets'
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
              className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                mobileConsoleTab === 'telemetry'
                  ? 'bg-inner text-text-base shadow-sm border border-subtle'
                  : 'text-text-muted hover:text-text-base'
              }`}
            >
              <Activity size={13} />
              <span>Stream ({effectiveDefectsList.length > 0 ? `${effectiveDefectsList.length} Flagged` : effectiveHistory.length})</span>
            </button>
          </div>

        {/* --------------------------------------------------------- */}
        {/* COLUMN 1: TARGET SELECTION & CONFIG HUB (CARD CONTAINER) */}
        {/* --------------------------------------------------------- */}
        <aside className={`w-full lg:w-[380px] bg-card border border-subtle rounded-2xl flex flex-col shrink-0 overflow-hidden shadow-sm text-xs ${mobileConsoleTab === 'targets' ? 'flex-1' : 'hidden lg:flex'}`}>
          
          {/* Header Navigation Tabs */}
          <div className="p-3 border-b border-subtle bg-card">
            <div className="grid grid-cols-2 gap-1.5 bg-inner p-1 rounded-xl border border-subtle">
              <button
                onClick={() => setTargetTab('masterlist')}
                className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  targetTab === 'masterlist'
                    ? 'bg-card text-text-base shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                Master Subgrids ({processedBatchLogs.length})
              </button>
              <button
                onClick={() => setTargetTab('daily')}
                className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  targetTab === 'daily'
                    ? 'bg-card text-text-base shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                Daily Runs ({processedDailyRuns.length})
              </button>
            </div>
          </div>

          {/* Search, Category Filter & Quick Frame Toggles */}
          <div className="p-3 border-b border-subtle space-y-2.5 bg-card">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search subgrid, date, PIC..."
                className="w-full bg-inner border border-subtle rounded-xl pl-8 pr-3 py-1.5 text-xs text-text-base placeholder:text-text-muted focus:outline-none focus:border-slate-500 transition-all font-sans"
              />
            </div>

            {/* Category Filter Pills: All | Staging | Published */}
            <div className="grid grid-cols-3 gap-1.5 bg-inner p-1 rounded-xl border border-subtle text-xs">
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`py-1 text-center font-medium rounded-lg transition-all cursor-pointer text-[11px] ${
                  categoryFilter === 'all'
                    ? 'bg-card text-text-base font-semibold shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                All ({targetTab === 'daily' ? processedDailyRuns.length : processedBatchLogs.length})
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('staging')}
                className={`py-1 text-center font-medium rounded-lg transition-all cursor-pointer text-[11px] flex items-center justify-center gap-1.5 ${
                  categoryFilter === 'staging'
                    ? 'bg-card text-text-base font-semibold shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span>Staging</span>
                <span className="px-1.5 py-0.2 rounded-full bg-inner text-[10px] font-mono text-text-muted border border-subtle">{stagingCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setCategoryFilter('published')}
                className={`py-1 text-center font-medium rounded-lg transition-all cursor-pointer text-[11px] flex items-center justify-center gap-1.5 ${
                  categoryFilter === 'published'
                    ? 'bg-card text-text-base font-semibold shadow-sm border border-subtle'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                <Check size={11} className="text-emerald-400 shrink-0" />
                <span>Published</span>
                <span className="px-1.5 py-0.2 rounded-full bg-inner text-[10px] font-mono text-text-muted border border-subtle">{publishedCount}</span>
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-text-muted px-0.5">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showOnlyWithFrames}
                  onChange={(e) => setShowOnlyWithFrames(e.target.checked)}
                  className="rounded border-subtle bg-inner text-slate-400 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                />
                <span>Show valid frames only</span>
              </label>
              <span className="text-text-muted font-mono">{filteredTargetList.length} targets</span>
            </div>
          </div>

          {/* High-Density Target Dataset List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
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
                const hasAudit = Boolean(cached || item.qaqcStatus === 'QA/QC Approved');
                const auditDefects = cached ? cached.defectCount : item.defectCount;

                return (
                  <div
                    key={`${item.subgrid}-${item.runId || item.date}`}
                    onClick={() => {
                      if (isZeroFrames) return;
                      setSelectedSubgrid(item.subgrid);
                      setSelectedRunId(item.runId);
                      setSelectedStationIndex(null);
                      if (item.pic && item.pic !== 'Unassigned') {
                        setInspectorPic(item.pic);
                      } else if (activeUserName && activeUserName !== 'Operator') {
                        setInspectorPic(activeUserName);
                      }
                    }}
                    className={`p-3 rounded-xl border transition-all duration-150 flex items-center justify-between gap-2.5 ${
                      isZeroFrames
                        ? 'opacity-40 bg-card border-subtle/50 cursor-not-allowed text-text-muted'
                        : isSelected
                        ? 'bg-inner border-slate-500 text-text-base shadow-sm ring-1 ring-white/10 cursor-pointer'
                        : 'bg-card hover:bg-inner/60 text-text-muted hover:text-text-base border-subtle cursor-pointer'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold font-mono text-xs ${isSelected ? 'text-text-base' : 'text-text-base'}`}>
                          {item.subgrid}
                        </span>
                        <span className="text-[11px] text-text-muted font-mono">
                          • {item.date}
                        </span>
                      </div>

                      {/* Category & Status Indicators */}
                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
                        {/* Publish Category */}
                        {item.isPublished ? (
                          <span className="text-emerald-400 font-medium flex items-center gap-1">
                            <Check size={11} className="text-emerald-400 shrink-0" />
                            <span>Published</span>
                          </span>
                        ) : item.publishStatus === 'recheck' ? (
                          <span className="text-amber-400 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            <span>Recheck</span>
                          </span>
                        ) : (
                          <span className="text-amber-400 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            <span>Staging</span>
                          </span>
                        )}

                        <span className="text-text-muted/40">•</span>

                        {/* QA Audit Status */}
                        {hasAudit ? (
                          auditDefects === 0 ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                              <span>QA Passed</span>
                            </span>
                          ) : (
                            <span className="text-rose-400 font-semibold flex items-center gap-1">
                              <AlertTriangle size={11} className="shrink-0" />
                              <span>{auditDefects} Defect{auditDefects > 1 ? 's' : ''}</span>
                            </span>
                          )
                        ) : (
                          <span className="text-text-muted font-normal">
                            Pending Audit
                          </span>
                        )}

                        <span className="text-text-muted/40">•</span>

                        <span className="text-text-muted">
                          PIC: <span className="text-text-base font-medium">{item.pic}</span>
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="px-2.5 py-1 rounded-lg bg-inner border border-subtle text-[11px] text-text-muted font-mono font-medium">
                        {item.frameCount.toLocaleString()} Frames
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Dock: Inspection Rules, 4 Pacing Options & Operator Hub */}
          <div className="p-3.5 border-t border-subtle bg-inner space-y-3">
            <div className="flex items-center justify-between text-xs text-text-base font-semibold">
              <span>Inspection Parameters</span>
              <span className="text-text-muted text-[11px] font-mono font-normal">
                {selectedSubgrid ? `${selectedStations.length} Frames Queued` : 'No Target'}
              </span>
            </div>

            {/* Exact Defect Rule Toggles */}
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, checkBlur: !prev.checkBlur }))}
                className={`py-2 px-1 rounded-lg border text-center transition-all cursor-pointer text-[11px] font-medium truncate ${
                  config.checkBlur ? 'bg-card border-slate-500 text-text-base font-semibold shadow-sm' : 'bg-card border-subtle text-text-muted hover:text-text-base'
                }`}
                title={projectSettings?.qaFlag1 || 'Blurry Frame'}
              >
                {projectSettings?.qaFlag1 || 'Blurry Frame'}
              </button>
              <button
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, checkObstruction: !prev.checkObstruction }))}
                className={`py-2 px-1 rounded-lg border text-center transition-all cursor-pointer text-[11px] font-medium truncate ${
                  config.checkObstruction ? 'bg-card border-slate-500 text-text-base font-semibold shadow-sm' : 'bg-card border-subtle text-text-muted hover:text-text-base'
                }`}
                title={projectSettings?.qaFlag2 || 'Lens Obstruction'}
              >
                {projectSettings?.qaFlag2 || 'Lens Obstruction'}
              </button>
              <button
                type="button"
                onClick={() => setConfig(prev => ({ ...prev, checkGps: !prev.checkGps }))}
                className={`py-2 px-1 rounded-lg border text-center transition-all cursor-pointer text-[11px] font-medium truncate ${
                  config.checkGps ? 'bg-card border-slate-500 text-text-base font-semibold shadow-sm' : 'bg-card border-subtle text-text-muted hover:text-text-base'
                }`}
                title={projectSettings?.qaFlag3 || 'Bad GPS Signal'}
              >
                {projectSettings?.qaFlag3 || 'Bad GPS Signal'}
              </button>
            </div>

            {/* 4 Pacing Options: Auto, 200ms, 300ms, 500ms */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>Pacing Rate:</span>
                <span className="font-semibold text-text-base font-mono">
                  {isAutoPacing ? `Auto (${stepIntervalMs}ms)` : `${stepIntervalMs}ms (${(1000 / stepIntervalMs).toFixed(1)} FPS)`}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoPacing(true);
                    setStepIntervalMs(200);
                  }}
                  className={`py-1.5 px-1 rounded-lg text-xs font-semibold border text-center transition-all cursor-pointer flex items-center justify-center font-mono ${
                    isAutoPacing
                      ? 'bg-card border-slate-500 text-text-base shadow-sm'
                      : 'bg-card hover:bg-inner border-subtle text-text-muted hover:text-text-base'
                  }`}
                  title="Adaptive hardware pacing"
                >
                  <span>Auto</span>
                </button>
                {[
                  { label: '200ms', ms: 200 },
                  { label: '300ms', ms: 300 },
                  { label: '500ms', ms: 500 }
                ].map(speed => {
                  const isActive = !isAutoPacing && stepIntervalMs === speed.ms;
                  return (
                    <button
                      key={speed.ms}
                      type="button"
                      onClick={() => {
                        setIsAutoPacing(false);
                        setStepIntervalMs(speed.ms);
                      }}
                      className={`py-1.5 px-1 rounded-lg text-xs font-semibold border text-center transition-all cursor-pointer font-mono ${
                        isActive
                          ? 'bg-card border-slate-500 text-text-base shadow-sm'
                          : 'bg-card hover:bg-inner border-subtle text-text-muted hover:text-text-base'
                      }`}
                    >
                      {speed.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* QA/QC Operator in Dashboard */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-muted">QA/QC Operator (PIC):</span>
                <span className="text-text-muted text-[10px]">
                  Assigned: <span className="text-text-base font-semibold">{inspectorPic}</span>
                </span>
              </div>
              <input
                type="text"
                value={inspectorPic}
                onChange={(e) => setInspectorPic(e.target.value)}
                placeholder="Enter operator handle"
                className="w-full bg-card border border-subtle rounded-xl px-3 py-1.5 text-xs text-text-base placeholder:text-text-muted focus:outline-none focus:border-slate-500 transition-all font-sans"
              />
            </div>

            {/* Primary Action Button (Start or Re-run) */}
            <div className="pt-1">
              <button
                onClick={handleLaunchInspection}
                disabled={!selectedSubgrid || selectedStations.length === 0 || isRunning}
                className={`w-full py-2.5 px-3.5 rounded-xl text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2 shadow-sm active:scale-98 cursor-pointer ${
                  !selectedSubgrid || selectedStations.length === 0
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
                    <span>Start Automated QA/QC</span>
                  </>
                )}
              </button>
            </div>
          </div>

        </aside>

        {/* --------------------------------------------------------- */}
        {/* COLUMN 2: CENTER STAGE (EXPANSIVE VIEWPORT) */}
        {/* --------------------------------------------------------- */}
        <div className={`w-full lg:flex-1 bg-black border border-subtle rounded-2xl relative flex flex-col justify-between overflow-hidden shadow-sm min-w-0 ${mobileConsoleTab === 'canvas' ? 'flex-1' : 'hidden lg:flex'}`}>
          
          {/* Floating Top Completion / Post-Scan Banner */}
          {(isCompleted || (progressPct === 100 && !isRunning && effectiveHistory.length > 0)) && (
            <div className="m-3 px-3.5 py-2.5 bg-card/95 backdrop-blur-md border border-subtle rounded-xl shadow-md flex items-center justify-between shrink-0 text-xs z-20 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
                <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                <span className="font-semibold text-text-base text-xs">
                  Audit Completed ({effectiveHistory.length} Stations)
                </span>
                <span className="text-text-muted/40">•</span>
                <span className={`font-medium text-xs ${effectiveDefectsList.length > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400'}`}>
                  {effectiveDefectsList.length === 0 ? 'Zero Defects' : `${effectiveDefectsList.length} Defect(s)`}
                </span>
                <span className="text-text-muted/40">•</span>
                <span className="text-text-muted text-xs">Pass Rate: <strong className="text-text-base font-bold font-mono">{auditPassRate}%</strong></span>
              </div>

              <div className="flex items-center gap-2 text-text-muted text-xs font-mono shrink-0">
                <span>Subgrid: <strong className="text-text-base font-bold">{activeRunningSubgrid || selectedSubgrid}</strong></span>
              </div>
            </div>
          )}

          {/* Floating Top HUD Telemetry Bar (if not completed banner) */}
          {!(isCompleted || (progressPct === 100 && !isRunning && effectiveHistory.length > 0)) && (
            <div className="m-3 px-3.5 py-2 bg-card/90 backdrop-blur-md border border-subtle rounded-xl flex items-center justify-between shrink-0 text-xs z-10 shadow-sm gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-text-muted font-medium uppercase tracking-wider text-[10px] hidden xs:inline">Target:</span>
                <span className="font-bold text-text-base px-2.5 py-0.5 rounded-lg bg-inner border border-subtle font-mono text-xs truncate max-w-[120px] sm:max-w-none">
                  {activeRunningSubgrid || selectedSubgrid || 'None'}
                </span>
                <span className="text-text-muted/40">•</span>
                <span className="text-text-muted font-medium font-mono text-xs truncate">
                  {isRunning || isCompleted
                    ? `Node ${Math.min(currentIndex + 1, totalStations)} / ${totalStations}`
                    : `${selectedStations.length} Queued`}
                </span>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 text-xs text-text-muted shrink-0">
                <div className="flex items-center gap-1 font-mono">
                  <span className="text-text-muted text-[11px] hidden xs:inline">Remaining:</span>
                  <span className="tabular-nums text-text-base font-semibold">{isCompleted ? '0s' : isRunning ? `${estimatedSecondsLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1 font-mono">
                  <span className="text-text-muted text-[11px] hidden xs:inline">Defects:</span>
                  <span className={`tabular-nums font-bold px-2 py-0.5 rounded-lg font-mono ${effectiveDefectsList.length > 0 ? "bg-inner text-rose-400 border border-subtle" : "bg-inner text-text-base border border-subtle"}`}>
                    {effectiveDefectsList.length}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Main Equirectangular / Viewport Area */}
          <div className="flex-1 relative w-full h-full min-h-[260px] overflow-hidden bg-app flex items-center justify-center">
            {activeDisplayThumbnail ? (
              <img
                src={activeDisplayThumbnail}
                alt={`Station ${activeDisplayIndex}`}
                className="w-full h-full object-cover select-none pointer-events-none"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '';
                }}
              />
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
                {selectedSubgrid && !isRunning && (
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-card border border-subtle text-text-muted font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      {selectedSubgrid} • {selectedStations.length} frames queued
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* HUD OVERLAY 1: Top-Left Node Identifier */}
            {(isRunning || effectiveHistory.length > 0) && (
              <div className="absolute top-3 left-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2 shadow-md space-y-0.5 max-w-[160px] sm:max-w-[280px] z-10">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                  <span className="font-semibold text-xs text-white tracking-tight truncate font-mono">
                    {activeDisplayPointId || `Station ${activeDisplayIndex}`}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300 font-mono font-normal pl-3 truncate">
                  Frame <strong className="text-white font-bold">{activeDisplayIndex}</strong> / {totalStations}
                </div>
              </div>
            )}

            {/* HUD OVERLAY 2: Top-Right Diagnostics Stream (GPS & Equipment) */}
            {(isRunning || effectiveHistory.length > 0) && (
              <div className="absolute top-3 right-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2 shadow-md space-y-0.5 text-xs min-w-[110px] sm:min-w-[150px] z-10">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-300 font-medium">GPS:</span>
                  <span className={`font-semibold font-mono ${
                    activeRecord
                      ? (activeRecord.defectType?.includes('GPS') ? 'text-rose-400' : 'text-white')
                      : liveCheckStatus.gps.status === 'flagged'
                      ? 'text-rose-400'
                      : 'text-white'
                  }`}>
                    {activeRecord
                      ? `${activeDisplayStepDistance > 0 ? activeDisplayStepDistance.toFixed(1) : '0.0'}m`
                      : liveCheckStatus.gps.detail || `${currentStepDistance > 0 ? currentStepDistance.toFixed(1) : '0.0'}m`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-300 font-medium">Equip:</span>
                  <span className="font-semibold text-white font-mono truncate">
                    {(() => {
                      const currentItem = filteredTargetList.find(t => t.subgrid === (activeRunningSubgrid || selectedSubgrid));
                      return currentItem?.raw?.captureEquipment || currentItem?.raw?.equipment || (projectSettings as any)?.captureEquipment || 'MMS';
                    })()}
                  </span>
                </div>
              </div>
            )}

            {/* HUD OVERLAY 3: Bottom-Left Spatial Coordinates */}
            {(isRunning || effectiveHistory.length > 0) && (
              <div className="absolute bottom-3 left-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2 shadow-md space-y-0.5 z-10 max-w-[170px] sm:max-w-none">
                <div className="text-white text-xs tabular-nums font-semibold flex items-center gap-1.5 font-mono truncate">
                  <Navigation size={11} className="text-slate-300 shrink-0" />
                  <span>
                    {activeDisplayCoords.lat && activeDisplayCoords.lng
                      ? `${Number(activeDisplayCoords.lat).toFixed(4)}°, ${Number(activeDisplayCoords.lng).toFixed(4)}°`
                      : '0.0000°, 0.0000°'}
                  </span>
                </div>
                <div className="text-slate-300 text-[11px] font-normal flex items-center gap-1 font-mono pl-3">
                  <span className="text-slate-400">Step:</span>
                  <span className="tabular-nums text-white font-semibold">
                    {activeDisplayStepDistance > 0 ? `+${activeDisplayStepDistance.toFixed(1)}m` : '0.0m'}
                  </span>
                </div>
              </div>
            )}

            {/* HUD OVERLAY 4: Bottom-Right Compass Heading & Track State */}
            {(isRunning || effectiveHistory.length > 0) && (
              <div className="absolute bottom-3 right-3 bg-black/85 backdrop-blur-md border border-white/10 rounded-xl px-3 py-2 shadow-md space-y-0.5 text-right z-10">
                <div className="text-white text-xs tabular-nums font-semibold flex items-center justify-end gap-1.5 font-mono">
                  <Compass size={11} className="text-slate-300 shrink-0" />
                  <span>{activeDisplayBearing.toFixed(0)}°</span>
                </div>
                <div className="text-slate-300 text-[11px] font-normal flex items-center justify-end gap-1 font-mono">
                  <span className="text-slate-400">Track:</span>
                  <span className={`font-semibold ${
                    !activeDisplayCoords.lat || !activeDisplayCoords.lng
                      ? 'text-amber-400'
                      : activeDisplayStepDistance > 50
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}>
                    {!activeDisplayCoords.lat || !activeDisplayCoords.lng
                      ? 'No Fix'
                      : activeDisplayStepDistance > 50
                      ? 'Drift'
                      : 'Locked'}
                  </span>
                </div>
              </div>
            )}

            {/* Return to Live Telemetry Button */}
            {selectedStationIndex !== null && isRunning && (
              <button
                onClick={() => setSelectedStationIndex(null)}
                className="absolute bottom-12 sm:bottom-14 left-1/2 -translate-x-1/2 bg-card hover:bg-inner text-text-base border border-subtle px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shadow-lg flex items-center gap-1.5 active:scale-95 whitespace-nowrap z-20"
              >
                <RotateCcw size={12} />
                <span>Return to Live #{currentIndex + 1}</span>
              </button>
            )}

          </div>

          {/* Aborted Banner */}
          {isAborted && (
            <div className="m-3 p-3 bg-card border border-rose-500/30 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shrink-0 text-xs shadow-md">
              <div className="flex items-center gap-2 flex-wrap">
                <AlertTriangle size={14} className="text-rose-400 shrink-0" />
                <span className="font-bold text-text-base text-xs">
                  Inspection Halted
                </span>
                <span className="text-text-muted text-xs font-mono">
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

        {/* --------------------------------------------------------- */}
        {/* COLUMN 3: TELEMETRY & DEFECT STREAM */}
        {/* --------------------------------------------------------- */}
        <aside className={`w-full lg:w-[340px] bg-card border border-subtle rounded-2xl flex flex-col shrink-0 overflow-hidden shadow-sm text-xs ${mobileConsoleTab === 'telemetry' ? 'flex-1' : 'hidden lg:flex'}`}>
          
          {/* Header with Filter & SLA Pill */}
          <div className="p-3.5 border-b border-subtle flex items-center justify-between shrink-0 bg-card">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-text-muted" />
              <span className="font-bold text-text-base text-xs tracking-tight">
                Telemetry Stream
              </span>
            </div>

            {/* SLA Nominal or Anomalies Pill */}
            {effectiveDefectsList.length === 0 ? (
              <span className="px-2.5 py-0.5 rounded-full bg-inner text-text-muted border border-subtle text-[10px] font-medium font-mono">
                SLA Nominal
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-inner text-rose-400 border border-subtle text-[10px] font-bold font-mono">
                {effectiveDefectsList.length} Flagged
              </span>
            )}
          </div>

          {/* Filter Switcher */}
          <div className="p-3 border-b border-subtle bg-card">
            <div className="grid grid-cols-2 gap-1.5 bg-inner p-1 rounded-xl border border-subtle">
              <button
                onClick={() => setFilterMode('all')}
                className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  filterMode === 'all' ? 'bg-card text-text-base shadow-sm border border-subtle' : 'text-text-muted hover:text-text-base'
                }`}
              >
                All ({effectiveHistory.length})
              </button>
              <button
                onClick={() => setFilterMode('flagged')}
                className={`py-1.5 text-center text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  filterMode === 'flagged' ? 'bg-card text-text-base shadow-sm border border-subtle' : 'text-text-muted hover:text-text-base'
                }`}
              >
                Defects ({effectiveDefectsList.length})
              </button>
            </div>
          </div>

          {/* Scanned Nodes Feed List */}
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
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer space-y-1 ${
                      isSelected
                        ? 'bg-inner border-slate-500 text-text-base shadow-sm ring-1 ring-white/10'
                        : isLive
                        ? 'bg-inner border-subtle text-text-base'
                        : item.status === 'flagged'
                        ? 'bg-inner/60 border border-subtle text-text-base hover:bg-inner'
                        : 'bg-card hover:bg-inner/50 text-text-muted hover:text-text-base border-subtle'
                    }`}
                  >
                    {/* Row 1: Node Station Number, Filename & Timestamp */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          item.status === 'flagged' ? 'bg-rose-400' : 'bg-slate-500'
                        }`} />
                        <span className="font-bold text-xs text-text-base shrink-0 font-mono">
                          #{item.index}
                        </span>
                        <span className="text-text-muted/40 text-xs">•</span>
                        <span className="text-xs text-text-base font-medium truncate font-mono" title={item.pointId}>
                          {item.pointId}
                        </span>
                      </div>
                      <span className="text-[10px] tabular-nums font-mono text-text-muted shrink-0">
                        {item.timestamp}
                      </span>
                    </div>

                    {/* Row 2: Diagnostics or Geocoordinates */}
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
                      <div className="flex items-center justify-between text-[11px] text-text-muted font-mono">
                        <span className="tabular-nums text-text-muted">
                          {item.lat.toFixed(4)}°, {item.lng.toFixed(4)}°
                        </span>
                        <div className="flex items-center gap-2 tabular-nums text-text-muted">
                          <span>{item.stepDistance > 0 ? `+${item.stepDistance.toFixed(1)}m` : '0.0m'}</span>
                          {item.status === 'skipped' ? (
                            <span className="text-amber-400 font-mono text-[10px]">Skipped (Timeout/CORS)</span>
                          ) : item.blurVariance !== undefined ? (
                            <span className="text-text-base font-mono">Score {item.blurVariance.toFixed(1)}</span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Telemetry Footer with Database Sync Indicator */}
          <div className="p-3 bg-inner border-t border-subtle flex items-center justify-between text-[11px] text-text-muted">
            <div className="flex items-center gap-1.5 font-medium">
              <Database size={12} className="text-text-muted" />
              <span>Supabase Sync:</span>
            </div>
            <span className="text-text-base tabular-nums font-bold font-mono">
              {syncedCount} records upserted
            </span>
          </div>

        </aside>

        </div>
      )}

      {/* ========================================================= */}
      {/* 2B. THRESHOLD CALIBRATION STUDIO VIEW (SEAMLESS TAB) */}
      {/* ========================================================= */}
      {workbenchTab === 'thresholds' && (
        <QAQCThresholdStudioView
          thresholds={localThresholds}
          setThresholds={setLocalThresholds}
          onSave={handleSaveThresholds}
          onResetDefaults={handleResetThresholds}
        />
      )}

      {/* ========================================================= */}
      {/* 2C. AUDIT SUMMARY VIEW (SEAMLESS TAB) */}
      {/* ========================================================= */}
      {workbenchTab === 'audit' && (() => {
        const targetSub = (activeRunningSubgrid || selectedSubgrid || '').toUpperCase().trim();
        const activeItem = filteredTargetList.find(t => t.subgrid.toUpperCase().trim() === targetSub);
        const cachedAudit = auditCache[`${targetSub}_${activeItem?.runId || 'default'}`] || auditCache[`${targetSub}_default`];

        const currentSubgrid = targetSub || 'GENERAL';
        const currentDate = surveyDate || activeItem?.date || (cachedAudit as any)?.surveyDate || (cachedAudit ? new Date(cachedAudit.completedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
        const currentPic = activeRunningPic || inspectorPic || activeItem?.pic || cachedAudit?.pic || 'Operator';
        const currentEquipment = (activeItem?.raw?.captureEquipment || activeItem?.raw?.equipment || (projectSettings as any)?.captureEquipment || 'MMS 360 Survey Sensor');
        const currentDistance = activeItem?.raw?.kmProcessed ? `${activeItem.raw.kmProcessed.toFixed(1)} km` : (cachedAudit as any)?.trajectoryDistance ? `${(cachedAudit as any).trajectoryDistance.toFixed(1)} km` : '—';
        const currentRunId = activeItem?.runId || cachedAudit?.runId || 'RUN-AUDIT-ACTIVE';
        const currentModel = (localThresholds.deliverableModel || projectSettings?.deliverableModel || 'masked_car') === 'generative_fill' ? 'Generative Fill (Full 80% ROI)' : 'Vehicle Nadir Mask (Top 52% ROI)';

        const blurCount = effectiveDefectsList.filter((d: any) => (d.defectType || d.defectCategory || '').toLowerCase().includes('blur') || (Array.isArray(d.reasons) && d.reasons.some((r: string) => r.toLowerCase().includes('blur')))).length;
        const obstructionCount = effectiveDefectsList.filter((d: any) => (d.defectType || d.defectCategory || '').toLowerCase().includes('obstruction') || (d.defectType || d.defectCategory || '').toLowerCase().includes('glitch') || (Array.isArray(d.reasons) && d.reasons.some((r: string) => r.toLowerCase().includes('dark') || r.toLowerCase().includes('glare') || r.toLowerCase().includes('glitch')))).length;
        const gpsCount = effectiveDefectsList.filter((d: any) => (d.defectType || d.defectCategory || '').toLowerCase().includes('gps') || (Array.isArray(d.reasons) && d.reasons.some((r: string) => r.toLowerCase().includes('gps')))).length;
        const passedCount = Math.max(0, effectiveHistory.length - effectiveDefectsList.length);

        const filteredHistory = effectiveHistory.filter(item => {
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
            
            {/* Top Scope & Action Header Card */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-2xl bg-card border border-subtle shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-inner text-text-base border border-subtle shrink-0">
                  <FileSpreadsheet size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-sm text-text-base truncate flex items-center gap-2">
                    <span>QA/QC Audit Run History & Technical Details</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono text-text-muted bg-inner border border-subtle">
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

            {/* Detailed Survey Run & Operator Identification Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              
              {/* Card 1: Survey Dataset & Geodata */}
              <div className="p-3.5 bg-card border border-subtle rounded-xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-subtle pb-2">
                  <span className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin size={13} className="text-text-muted" />
                    Survey Dataset
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">Subgrid ID</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Target Subgrid:</span>
                    <span className="font-bold text-text-base font-mono">{currentSubgrid}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Survey Date:</span>
                    <span className="text-text-base flex items-center gap-1 font-mono text-[11px]">
                      <Calendar size={12} className="text-text-muted" />
                      {currentDate}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Trajectory Distance:</span>
                    <span className="font-medium text-text-base font-mono text-[11px]">{currentDistance}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Station Count:</span>
                    <span className="font-mono text-text-base font-semibold">{effectiveHistory.length} Frames</span>
                  </div>
                </div>
              </div>

              {/* Card 2: Operational Ownership & Equipment */}
              <div className="p-3.5 bg-card border border-subtle rounded-xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-subtle pb-2">
                  <span className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <User size={13} className="text-text-muted" />
                    Operator & Equipment
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">PIC Sign-Off</span>
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
                    <span className="text-text-base flex items-center gap-1 font-mono text-[11px]">
                      <Clock size={12} className="text-text-muted" />
                      {cachedAudit?.completedAt || (isCompleted ? 'Just now' : isRunning ? 'In Progress' : '—')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Inspection Run ID:</span>
                    <span className="font-mono text-[10px] text-text-muted truncate max-w-[140px]" title={currentRunId}>
                      {currentRunId}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: Applied Calibration Parameters */}
              <div className="p-3.5 bg-card border border-subtle rounded-xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between border-b border-subtle pb-2">
                  <span className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <SlidersHorizontal size={13} className="text-text-muted" />
                    Active Thresholds
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">Profile</span>
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
                    <span className="font-mono font-medium text-text-base">{localThresholds.blurVarianceThreshold ?? 68.0} / 100</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Max GPS Step:</span>
                    <span className="font-mono font-medium text-text-base">{localThresholds.gpsMaxJumpDistanceMeters ?? 50.0}m</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Obstruction Brightness:</span>
                    <span className="font-mono font-medium text-text-base">{localThresholds.obstructionMinBrightness ?? 15.0} lux</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Key Metrics & Defect Distribution Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">SLA Pass Rate</span>
                <p className="text-xl font-bold font-mono text-text-base">
                  {auditPassRate}%
                </p>
                <span className="text-[10px] text-text-muted font-mono">{passedCount} / {effectiveHistory.length} Passed</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Nodes Audited</span>
                <p className="text-xl font-bold text-text-base font-mono">{effectiveHistory.length}</p>
                <span className="text-[10px] text-text-muted font-mono">100% Surveyed</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Total Defects</span>
                <p className="text-xl font-bold font-mono text-text-base">
                  {effectiveDefectsList.length}
                </p>
                <span className="text-[10px] text-text-muted font-mono">{effectiveHistory.length > 0 ? ((effectiveDefectsList.length / effectiveHistory.length) * 100).toFixed(1) : 0}% Rate</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Mean Sharpness</span>
                <p className="text-xl font-bold text-text-base font-mono">{meanSharpnessScore}</p>
                <span className="text-[10px] text-text-muted font-mono">Cutoff {localThresholds.blurVarianceThreshold ?? 68.0}</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Blur Defects</span>
                <p className="text-xl font-bold font-mono text-text-base">
                  {blurCount}
                </p>
                <span className="text-[10px] text-text-muted font-mono">Low Focus</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">Obstructions</span>
                <p className="text-xl font-bold font-mono text-text-base">
                  {obstructionCount}
                </p>
                <span className="text-[10px] text-text-muted font-mono">Glare / Dark</span>
              </div>
              <div className="p-3 bg-card border border-subtle rounded-xl space-y-1 shadow-sm">
                <span className="text-[11px] text-text-muted font-medium">GPS Drift</span>
                <p className="text-xl font-bold font-mono text-text-base">
                  {gpsCount}
                </p>
                <span className="text-[10px] text-text-muted font-mono">&gt; {localThresholds.gpsMaxJumpDistanceMeters ?? 50}m</span>
              </div>
            </div>

            {/* Station-by-Station Scanned Diagnostics Log */}
            <div className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-sm flex flex-col">
              <div className="px-4 py-3 border-b border-subtle bg-inner flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                
                {/* Log Header & Filter Tabs */}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-xs text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <Activity size={14} className="text-text-muted" />
                    Station Diagnostics Log ({effectiveHistory.length})
                  </span>

                  <div className="flex items-center bg-card border border-subtle rounded-xl p-0.5 text-xs">
                    <button
                      onClick={() => setAuditLogFilter('all')}
                      className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                        auditLogFilter === 'all' ? 'bg-inner text-text-base font-semibold' : 'text-text-muted hover:text-text-base'
                      }`}
                    >
                      All ({effectiveHistory.length})
                    </button>
                    <button
                      onClick={() => setAuditLogFilter('flagged')}
                      className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                        auditLogFilter === 'flagged' ? 'bg-inner text-text-base font-semibold' : 'text-text-muted hover:text-text-base'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                      Defects ({effectiveDefectsList.length})
                    </button>
                    <button
                      onClick={() => setAuditLogFilter('passed')}
                      className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                        auditLogFilter === 'passed' ? 'bg-inner text-text-base font-semibold' : 'text-text-muted hover:text-text-base'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Passed ({passedCount})
                    </button>
                  </div>
                </div>

                {/* Quick Search */}
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

              {/* Station Diagnostics Structured Table */}
              <div className="max-h-[500px] overflow-x-auto overflow-y-auto">
                {filteredHistory.length === 0 ? (
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
                      {filteredHistory.map((item) => {
                        const isFlagged = item.status === 'flagged';
                        const timeStr = item.timestamp ? (item.timestamp.includes(',') ? item.timestamp.split(',').pop()?.trim() : item.timestamp) : '—';
                        const itemSubgrid = extractSubgridName(item.pointId) || currentSubgrid;
                        return (
                          <tr
                            key={`${item.pointId}-${item.index}`}
                            className="hover:bg-inner/40 transition-colors"
                          >
                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 font-mono font-medium text-text-base">
                                <span className={`w-1.5 h-1.5 rounded-full ${isFlagged ? 'bg-rose-400' : 'bg-slate-500'} shrink-0`} />
                                <span>#{item.index}</span>
                              </div>
                            </td>
                            <td className="px-3.5 py-2.5 font-mono font-bold text-text-base whitespace-nowrap">
                              {itemSubgrid}
                            </td>
                            <td className="px-3.5 py-2.5 font-mono font-medium text-text-base whitespace-nowrap">
                              {item.pointId}
                            </td>
                            <td className="px-3.5 py-2.5 text-text-muted whitespace-nowrap font-mono text-[11px]">
                              {currentDate}
                            </td>
                            <td className="px-3.5 py-2.5 text-text-muted whitespace-nowrap font-mono text-[11px]">
                              {timeStr}
                            </td>
                            <td className="px-3.5 py-2.5 font-mono text-text-muted text-[11px] whitespace-nowrap">
                              {item.lat.toFixed(4)}°, {item.lng.toFixed(4)}°
                            </td>
                            <td className="px-3.5 py-2.5 font-mono font-medium text-text-base whitespace-nowrap text-[11px]">
                              {item.blurVariance !== undefined ? item.blurVariance.toFixed(1) : '—'}
                            </td>
                            <td className="px-3.5 py-2.5 whitespace-nowrap">
                              {isFlagged ? (
                                <span className="px-2.5 py-0.5 rounded-full bg-inner border border-subtle text-rose-400 font-semibold text-[10px] inline-flex items-center gap-1 font-mono">
                                  {item.defectType || 'Defect'}
                                </span>
                              ) : (
                                <span className="px-2.5 py-0.5 rounded-full bg-inner border border-subtle text-emerald-400 font-medium text-[10px] inline-flex items-center gap-1 font-mono">
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
