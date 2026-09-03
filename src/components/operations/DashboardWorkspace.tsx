import React from 'react';
import { PhotoSphereViewerComponent, type PhotoSphereViewerHandle } from '../PhotoSphereViewerComponent';
import { WebGISHUDViewerOverlay } from '../WebGISHUDViewerOverlay';
import { MapComponent } from '../MapComponent';
import { Skeleton } from '../common/Skeleton';
import {
  CheckCircle,
  Activity,
  Clock,
  Camera,
  Navigation,
  Edit2,
  X,
  FileText,
  Database,
  ShieldCheck,
  Maximize2,
  Filter,
  Calendar,
  ExternalLink,
  Loader2,
  Play,
  StopCircle
} from 'lucide-react';
import { updateDefectStatusInSupabase, resolvePanoramaUrl, resolvePanoramaConfigUrl, SUBGRID_COORDINATES, formatPIC, saveProcessingJobToSupabase } from '../../services/supabase';
import type { WorkspaceKey } from '../../utils/hashRouter';
import { extractSubgridName } from '../../utils/subgrid';
import { formatBatchIdDisplay, getPOICount, getImagesProcessedCount, formatDisplayDate } from '../../utils/dashboardData';
import { getItemId } from '../../utils/items';
import type { BatchLog, DailyTimeSeries } from '../../types/dashboard';
import type { QAQCAuditRunRecord } from '../../types/admin';
import type { QAQCWorkerState, StationNode } from '../../hooks/useQAQCWorker';
import type { Layer as CatalogLayer, Folder as CatalogFolder } from '../../types/catalog';

const OperationalActionCenter = React.lazy(() => import('../OperationalActionCenter').then(m => ({ default: m.OperationalActionCenter })));

export interface DashboardWorkspaceProps {
  tourStep: number | null;
  isDataLoading: boolean;
  totalKm: number;
  totalImages: number;
  lastUpdateDate: string;
  ongoingMasterlistCount: number;
  stagedDailyBatchesCount: number;
  pipelineHealthPercent: string;
  totalDefects: number;
  batchLogs: BatchLog[];
  dailyData: DailyTimeSeries[];
  isGuestUser: boolean;
  selectedSubgridFilter: string | null;
  selectedDailyRunId: string | null;
  selectedDateFilter: string | null;
  isDrawingBBox: boolean;
  isStatusFilterOpen: boolean;
  showPanotrackData: boolean;
  statusFilters: { published: boolean; defect: boolean; stitching: boolean };
  isDashFilterOpen: boolean;
  dashDailyFilters: { grid: string; subgrid: string; pic: string; equipment: string };
  hasActiveDashFilters: boolean;
  activeTab: 'batches' | 'daily';
  activeBatchLogs: BatchLog[];
  focusedSection: 'map' | 'processing' | 'qa' | null;
  projectSettings: any;
  qaqcWorkerState: QAQCWorkerState;
  qaqcAuditRuns: Record<string, QAQCAuditRunRecord>;
  selectedQaFlags: { blurry: boolean; obstruction: boolean; badGps: boolean };
  qaQuestionnaireAnswer: 'yes' | 'no' | null;
  isQaLocked: boolean;
  hasSelectedPoint: boolean;
  activePanoramaFilename: string;
  activePanoramaUrl: string;
  panoramaTelemetry: { yaw: number; pitch: number; fov: number };
  inspectorCoords: { lat: number; lng: number };
  inspectorSubgrid: string;
  activeAuthUserName: string;
  targetKm: number;
  progressPercent: number;
  mapRefreshKey: number;
  imagesListModal: {
    isOpen: boolean;
    subgrid: string;
    count: number;
    poiCount?: number;
    baseFilename?: string;
    customFilenames?: string[];
  } | null;
  layerCatalog: (CatalogLayer | CatalogFolder)[];
  allKnownDefects: any[];
  dashboardPsvRef: React.MutableRefObject<PhotoSphereViewerHandle | null>;
  inspectionMapIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  goToWorkspace: (key: WorkspaceKey) => void;
  generateExecutivePdfReport: () => void;
  handleRefreshMap: () => void;
  handleSelectDailyRun: (daily: DailyTimeSeries) => void;
  toggleSubgridFilter: (subgridRaw: string, date?: string) => void;
  clearMapSelection: () => void;
  abortQAQCInspection: () => void;
  saveSubgridQa: (sgKey: string, flags: { blurry: boolean; obstruction: boolean; badGps: boolean }, answer: 'yes' | 'no' | null, locked: boolean) => void;
  getStationsForSubgrid: (targetSubgrid: string, runId?: string | null) => StationNode[];
  addNotification: (item: Omit<any, 'id' | 'timestamp' | 'read'>) => void;
  t: (key: string) => string;
  setIsDrawingBBox: (v: React.SetStateAction<boolean>) => void;
  setIsStatusFilterOpen: (v: React.SetStateAction<boolean>) => void;
  setShowPanotrackData: (v: React.SetStateAction<boolean>) => void;
  setStatusFilters: (v: React.SetStateAction<{ published: boolean; defect: boolean; stitching: boolean }>) => void;
  setSelectedDailyRunId: (v: React.SetStateAction<string | null>) => void;
  setSelectedSubgridFilter: (v: React.SetStateAction<string | null>) => void;
  setSelectedDateFilter: (v: React.SetStateAction<string | null>) => void;
  setActiveTab: (v: React.SetStateAction<'batches' | 'daily'>) => void;
  setIsDashFilterOpen: (v: React.SetStateAction<boolean>) => void;
  setDashDailyFilters: (v: React.SetStateAction<{ grid: string; subgrid: string; pic: string; equipment: string }>) => void;
  setActivePanoramaFilename: (v: React.SetStateAction<string>) => void;
  setActivePanoramaUrl: (v: React.SetStateAction<string>) => void;
  setHasSelectedPoint: (v: React.SetStateAction<boolean>) => void;
  setInspectorCoords: (v: React.SetStateAction<{ lat: number; lng: number }>) => void;
  setInspectorSubgrid: (v: React.SetStateAction<string>) => void;
  setImagesListModal: (v: React.SetStateAction<{ isOpen: boolean; subgrid: string; count: number; poiCount?: number; baseFilename?: string; customFilenames?: string[] } | null>) => void;
  setSelectedDefectSubgrid: (v: React.SetStateAction<string>) => void;
  setDefectGalleryContext: (v: React.SetStateAction<any>) => void;
  setIsDefectsGalleryOpen: (v: React.SetStateAction<boolean>) => void;
  setIsQAQCRunnerModalOpen: (v: React.SetStateAction<boolean>) => void;
  setQaqcWorkbenchSubgrid: (v: React.SetStateAction<string | null>) => void;
  setDataManagementTab: (v: React.SetStateAction<'batches' | 'daily' | 'vector' | 'datasets' | 'recovery'>) => void;
  setDataManagementSearch: (v: React.SetStateAction<string>) => void;
  setBatchLogs: (v: React.SetStateAction<BatchLog[]>) => void;
}

export function DashboardWorkspace(props: DashboardWorkspaceProps) {
  const {
    tourStep,
    isDataLoading,
    totalKm,
    totalImages,
    lastUpdateDate,
    ongoingMasterlistCount,
    stagedDailyBatchesCount,
    pipelineHealthPercent,
    totalDefects,
    batchLogs,
    dailyData,
    isGuestUser,
    selectedSubgridFilter,
    selectedDailyRunId,
    selectedDateFilter,
    isDrawingBBox,
    isStatusFilterOpen,
    showPanotrackData,
    statusFilters,
    isDashFilterOpen,
    dashDailyFilters,
    hasActiveDashFilters,
    activeTab,
    activeBatchLogs,
    focusedSection,
    projectSettings,
    qaqcWorkerState,
    qaqcAuditRuns,
    selectedQaFlags,
    qaQuestionnaireAnswer,
    isQaLocked,
    hasSelectedPoint,
    activePanoramaFilename,
    activePanoramaUrl,
    panoramaTelemetry,
    inspectorCoords,
    inspectorSubgrid,
    activeAuthUserName,
    targetKm,
    progressPercent,
    mapRefreshKey,
    layerCatalog,
    allKnownDefects,
    dashboardPsvRef,
    inspectionMapIframeRef,
    goToWorkspace,
    generateExecutivePdfReport,
    handleRefreshMap,
    handleSelectDailyRun,
    toggleSubgridFilter,
    clearMapSelection,
    abortQAQCInspection,
    saveSubgridQa,
    getStationsForSubgrid,
    addNotification,
    t,
    setIsDrawingBBox,
    setIsStatusFilterOpen,
    setShowPanotrackData,
    setStatusFilters,
    setSelectedDailyRunId,
    setSelectedSubgridFilter,
    setSelectedDateFilter,
    setActiveTab,
    setIsDashFilterOpen,
    setDashDailyFilters,
    setActivePanoramaFilename,
    setActivePanoramaUrl,
    setHasSelectedPoint,
    setInspectorCoords,
    setInspectorSubgrid,
    setImagesListModal,
    setSelectedDefectSubgrid,
    setDefectGalleryContext,
    setIsDefectsGalleryOpen,
    setIsQAQCRunnerModalOpen,
    setQaqcWorkbenchSubgrid,
    setDataManagementTab,
    setDataManagementSearch,
    setBatchLogs
  } = props;
  return (
            <div key="dashboard-canvas" className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto md:overflow-hidden animate-workspace-focus">
              {/* TOP ROW: EXECUTIVE KPI SUMMARY (4 Cards) */}
              <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0 transition-all duration-300 ${tourStep === 1 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative rounded-xl p-1 bg-sky-950/20' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
                }`}>
                {/* Card 1: Total Distance Mapped */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm animate-waterfall stagger-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('totalDistance')}</span>
                    <Navigation size={15} className="text-sky-400 shrink-0" />
                  </div>
                  <div className="my-1 flex items-baseline gap-2">
                    {isDataLoading ? (
                      <Skeleton className="h-6 w-32 my-0.5" />
                    ) : (
                      <span className="text-2xl font-extrabold text-text-base tracking-tight">{totalKm.toFixed(1)} km</span>
                    )}
                    <span className="text-[10px] text-text-base bg-inner border border-subtle px-1.5 py-0.5 rounded font-medium">
                      {progressPercent}% of {targetKm} km Target
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    Cumulative Trajectory Distance &bull; Updated {lastUpdateDate}
                  </div>
                </div>

                {/* Card 2: Processed Panoramas */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm animate-waterfall stagger-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('processedPanoramas')}</span>
                    <Camera size={15} className="text-sky-400 shrink-0" />
                  </div>
                  <div className="my-1">
                    {isDataLoading ? (
                      <Skeleton className="h-6 w-32 my-0.5" />
                    ) : (
                      <span className="text-2xl font-extrabold text-text-base tracking-tight">{totalImages.toLocaleString()} Frames</span>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    Total 360Â° Image Frames Ingested &bull; Updated {lastUpdateDate}
                  </div>
                </div>

                {/* Card 3: Active Processing Jobs */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm animate-waterfall stagger-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('activeJobs')}</span>
                    <Database size={15} className="text-sky-400 shrink-0" />
                  </div>
                  <div className="my-1 flex items-baseline gap-2 flex-wrap">
                    {isDataLoading ? (
                      <Skeleton className="h-6 w-32 my-0.5" />
                    ) : (
                      <>
                        <span className="text-2xl font-extrabold text-text-base tracking-tight">
                          {ongoingMasterlistCount} Ongoing {ongoingMasterlistCount === 1 ? 'Subgrid' : 'Subgrids'}
                        </span>
                        {stagedDailyBatchesCount > 0 && (
                          <span className="text-xs font-medium text-text-muted">
                            ({stagedDailyBatchesCount} Staged)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    {ongoingMasterlistCount} Masterlist {ongoingMasterlistCount === 1 ? 'sector' : 'sectors'} in progress &bull; {stagedDailyBatchesCount} daily {stagedDailyBatchesCount === 1 ? 'pass' : 'passes'} pending
                  </div>
                </div>

                {/* Card 4: Pipeline Health */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm animate-waterfall stagger-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('pipelineHealth')}</span>
                    <div className="w-14 h-5">
                      <svg className="w-full h-full text-emerald-400 stroke-current fill-none stroke-2" viewBox="0 0 50 20">
                        <path d="M0,15 L10,12 L20,18 L30,5 L40,10 L50,2" />
                      </svg>
                    </div>
                  </div>
                  <div className="my-1">
                    {isDataLoading ? (
                      <Skeleton className="h-6 w-32 my-0.5" />
                    ) : (
                      <span className="text-2xl font-extrabold text-emerald-400 tracking-tight">
                        {pipelineHealthPercent}% Normal
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    <span className={totalDefects > 0 ? 'text-amber-400 font-semibold' : 'text-text-muted'}>{totalDefects} Defect {totalDefects === 1 ? 'Frame' : 'Frames'} Flagged</span> &bull; Updated {lastUpdateDate}
                  </div>
                </div>
              </div>

              {/* OPERATIONAL COMMAND & ACTION CENTER */}
              <OperationalActionCenter
                batchLogs={batchLogs}
                dailyData={dailyData}
                qaDefectsCount={totalDefects}
                isGuestUser={isGuestUser}
                onOpenQAQCWorkbench={(subgridKey) => {
                  setQaqcWorkbenchSubgrid(subgridKey || null);
                  setIsQAQCRunnerModalOpen(true);
                }}
                onOpenDefectsGallery={(subgridKey) => {
                  if (subgridKey) setSelectedDefectSubgrid(subgridKey);
                  setIsDefectsGalleryOpen(true);
                }}
                onNavigate={(ws, params) => {
                  goToWorkspace(ws);
                  if (ws === 'data' && params) {
                    if (params.tab) setDataManagementTab(params.tab);
                    if (params.search !== undefined) setDataManagementSearch(params.search);
                  }
                }}
                onGeneratePdfReport={generateExecutivePdfReport}
                onRetryJob={async (job) => {
                  if (job.id) {
                    await saveProcessingJobToSupabase({ ...job, status: 'QUEUED', progress: 0 });
                    if (addNotification) {
                      addNotification({
                        title: 'Job Retried',
                        message: `Job ${job.name || job.id} queued for retry.`,
                        category: 'SYSTEM'
                      });
                    }
                  }
                }}
              />

              {/* MIDDLE & BOTTOM GRID: LEFT (COVERAGE MAP) & RIGHT (CONTROL + INSPECTOR) */}
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-y-auto lg:overflow-hidden">

                {/* LEFT COLUMN: INTERACTIVE COVERAGE MAP (7 Cols) */}
                <div className={`col-span-1 lg:col-span-7 min-h-[380px] lg:min-h-0 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden relative transition-all duration-300 ${tourStep === 2 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative scale-[1.002]' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
                  }`}>
                  {/* Header */}
                  <div className="p-2.5 sm:p-3 border-b border-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shrink-0 bg-card">
                    <span className="text-xs font-bold uppercase tracking-wider text-text-base">
                      INTERACTIVE COVERAGE MAP
                    </span>
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap w-full sm:w-auto justify-end">
                      <button
                        onClick={generateExecutivePdfReport}
                        className="flex-1 sm:flex-none px-2.5 sm:px-3 py-1.5 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-[10px] sm:text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95 whitespace-nowrap"
                        title="Generate printable Executive PDF Summary Report"
                      >
                        <FileText size={13} className="shrink-0" />
                        <span className="hidden xs:inline">GENERATE PDF REPORT</span>
                        <span className="xs:hidden">PDF REPORT</span>
                      </button>
                      <button
                        onClick={() => {
                          const next = !isDrawingBBox;
                          setIsDrawingBBox(next);
                          const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
                          iframes.forEach(f => {
                            try {
                              f.contentWindow?.postMessage({ type: 'TOGGLE_BBOX_DRAW', isDrawing: next }, '*');
                            } catch (err) { }
                          });
                        }}
                        className={`flex-1 sm:flex-none px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-[11px] font-medium rounded-lg border transition-all uppercase tracking-tight flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95 whitespace-nowrap ${isDrawingBBox
                          ? 'bg-card border-slate-400 text-text-base'
                          : 'bg-card hover:bg-inner text-text-base border-subtle hover:border-subtle'
                          }`}
                        title="Toggle spatial bounding box rectangle filter on map"
                      >
                        <Maximize2 size={13} className="shrink-0" />
                        <span>{isDrawingBBox ? 'CLEAR BBOX' : 'BBOX FILTER'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Embedded WebGIS Map */}
                  <div className="flex-1 relative overflow-hidden bg-app">
                    {/* Minimalist Trajectory Filter Button & Popup Menu (bottom-left) */}
                    <div className="absolute bottom-3 left-3 z-10 pointer-events-auto flex flex-col items-start gap-2">
                      {/* Popup Panel (shown when isStatusFilterOpen === true) */}
                      {isStatusFilterOpen && (
                        <div className="bg-app backdrop-blur-xl border border-subtle rounded-xl p-2.5 text-[11px] space-y-1.5 shadow-2xl min-w-[200px] animate-in fade-in slide-in-from-bottom-2 duration-150">
                          <div className="flex items-center justify-between border-b border-subtle pb-1.5 mb-1 px-1">
                            <span className="font-semibold text-[10px] text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Filter size={12} />
                              Trajectory Status
                            </span>
                            <button
                              onClick={() => setIsStatusFilterOpen(false)}
                              className="text-text-muted hover:text-text-base text-xs px-1 cursor-pointer transition-colors"
                            >
                              âœ•
                            </button>
                          </div>

                          <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
                            <span className="text-[11px] font-medium text-text-base">Show Panotrack Layer</span>
                            <input
                              type="checkbox"
                              checked={showPanotrackData}
                              onChange={(e) => {
                                const val = e.target.checked;
                                setShowPanotrackData(val);
                                const iframes = document.querySelectorAll('iframe');
                                iframes.forEach(f => {
                                  try {
                                    f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters, showPanotrackData: val }, '*');
                                  } catch (err) { }
                                });
                              }}
                              className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                            />
                          </label>

                          <div className="border-t border-subtle pt-1 space-y-0.5">
                            <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                <span className="text-[11px]">Published to WebGIS</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={statusFilters.published}
                                disabled={!showPanotrackData}
                                onChange={(e) => {
                                  const next = { ...statusFilters, published: e.target.checked };
                                  setStatusFilters(next);
                                  const iframes = document.querySelectorAll('iframe');
                                  iframes.forEach(f => {
                                    try {
                                      f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters: next, showPanotrackData }, '*');
                                    } catch (err) { }
                                  });
                                }}
                                className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                              />
                            </label>

                            <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                <span className="text-[11px]">Defect / Flags</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={statusFilters.defect}
                                disabled={!showPanotrackData}
                                onChange={(e) => {
                                  const next = { ...statusFilters, defect: e.target.checked };
                                  setStatusFilters(next);
                                  const iframes = document.querySelectorAll('iframe');
                                  iframes.forEach(f => {
                                    try {
                                      f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters: next, showPanotrackData }, '*');
                                    } catch (err) { }
                                  });
                                }}
                                className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                              />
                            </label>

                            <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                                <span className="text-[11px]">In Progress / Stitching</span>
                              </div>
                              <input
                                type="checkbox"
                                checked={statusFilters.stitching}
                                disabled={!showPanotrackData}
                                onChange={(e) => {
                                  const next = { ...statusFilters, stitching: e.target.checked };
                                  setStatusFilters(next);
                                  const iframes = document.querySelectorAll('iframe');
                                  iframes.forEach(f => {
                                    try {
                                      f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters: next, showPanotrackData }, '*');
                                    } catch (err) { }
                                  });
                                }}
                                className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                              />
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Minimalist Trajectory Status Trigger Button */}
                      <button
                        onClick={() => setIsStatusFilterOpen(prev => !prev)}
                        className={`px-2.5 py-1.5 rounded-xl border shadow-lg flex items-center gap-2 text-[11px] font-semibold transition-all duration-200 cursor-pointer select-none relative active:scale-95 ${isStatusFilterOpen
                          ? 'bg-sky-600 text-text-base border-sky-400 shadow-sky-950/50'
                          : 'bg-app hover:bg-inner text-text-base border-subtle hover:border-subtle'
                          }`}
                        title="Filter Trajectory Status"
                      >
                        <Filter size={13} className={isStatusFilterOpen ? 'text-text-base' : 'text-sky-400'} />
                        <span>Trajectory Status</span>
                        {(!statusFilters.published || !statusFilters.defect || !statusFilters.stitching || !showPanotrackData) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                        )}
                      </button>
                    </div>

                    {/* Derived active subgrid item details for clicked row */}
                    {(() => {
                      const isDailySelected = Boolean(selectedDailyRunId);
                      const activeBatchLog = batchLogs.find(b =>
                        (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim()
                      );
                      const activeDailyLog = selectedDailyRunId
                        ? dailyData.find(d => getItemId(d) === selectedDailyRunId || d.id === selectedDailyRunId)
                        : (selectedDateFilter
                          ? dailyData.find(d =>
                            (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim() &&
                            (d.date === selectedDateFilter || formatDisplayDate(d.date) === formatDisplayDate(selectedDateFilter))
                          )
                          : null);

                      const getSubgridCoords = () => {
                        const firstPan = activeDailyLog?.panoramas?.[0] || (activeDailyLog as any)?.points?.[0] || activeBatchLog?.panoramas?.[0];
                        const lat = firstPan?.latitude ?? (firstPan as any)?.lat ?? (SUBGRID_COORDINATES[selectedSubgridFilter || '']?.[1] ?? 0);
                        const lng = firstPan?.longitude ?? (firstPan as any)?.lon ?? (firstPan as any)?.lng ?? (SUBGRID_COORDINATES[selectedSubgridFilter || '']?.[0] ?? 0);
                        return { lat, lng };
                      };

                      const activeCoords = getSubgridCoords();
                      const activeKm = isDailySelected && activeDailyLog
                        ? (activeDailyLog.kmProcessed?.toFixed(1) || '0.0')
                        : (activeBatchLog?.kmProcessed ? activeBatchLog.kmProcessed.toFixed(1) : '0.0');
                      const activeImages = isDailySelected && activeDailyLog
                        ? (activeDailyLog.imagesProcessed || activeDailyLog.availableImagesCount || activeDailyLog.poiCount || 0)
                        : (activeBatchLog?.images || getPOICount(activeBatchLog) || 0);
                      const activeDefects = isDailySelected && activeDailyLog
                        ? ((activeDailyLog.imagesDefected ?? activeDailyLog.defectCount) || 0)
                        : (activeBatchLog?.defects || 0);
                      const activePic = (isDailySelected && activeDailyLog ? activeDailyLog.pic : activeBatchLog?.pic) || 'Unassigned';

                      const isPublished = isDailySelected && activeDailyLog
                        ? (activeDailyLog.publishToWebGIS === 'yes' || activeDailyLog.isSyncedWithSupabase === true)
                        : (activeBatchLog?.status === 'Complete' || activeBatchLog?.publishToWebGIS === 'yes');

                      const activeStatusText = isDailySelected && activeDailyLog
                        ? (activeDailyLog.publishToWebGIS === 'yes'
                          ? 'Published to WebGIS'
                          : (activeDailyLog.qaqcStatus || (activeDefects > 0 ? `QAQC Flagged (${activeDefects} Defects)` : 'In Progress (Staging)')))
                        : (activeBatchLog?.status === 'Complete' ? 'Published to WebGIS' : 'In Progress (Staging)');

                      return selectedSubgridFilter ? (
                        <div className="absolute top-3 right-3 z-20 bg-card backdrop-blur-md border border-subtle rounded-xl p-3 text-xs text-text-base shadow-2xl max-w-xs space-y-1.5 animate-in fade-in zoom-in-95 duration-200">
                          <div className="flex items-center justify-between font-bold pb-1 border-b border-subtle">
                            <span className="text-sky-400 font-sans text-xs">
                              Subgrid ID: {selectedSubgridFilter} {isDailySelected && activeDailyLog ? `(${formatDisplayDate(activeDailyLog.date)})` : (selectedDateFilter ? `(${selectedDateFilter})` : '')}
                            </span>
                            <button
                              onClick={() => {
                                if (selectedDailyRunId) {
                                  setSelectedDailyRunId(null);
                                  setSelectedSubgridFilter(null);
                                  setSelectedDateFilter(null);
                                  const iframes = document.querySelectorAll('iframe');
                                  iframes.forEach(f => {
                                    try {
                                      f.contentWindow?.postMessage({ type: 'FILTER_SUBGRID', subgrid: '', date: '', isSingleRun: false, runId: null }, '*');
                                    } catch (_) { }
                                  });
                                } else if (selectedSubgridFilter) {
                                  toggleSubgridFilter(selectedSubgridFilter);
                                }
                              }}
                              className="text-text-muted hover:text-text-base p-0.5 rounded cursor-pointer transition-colors"
                              title="Close filter"
                            >
                              âœ•
                            </button>
                          </div>
                          <div className="text-text-base font-sans text-[11px] flex justify-between gap-4"><span className="text-text-muted">Coordinates:</span> <span>{activeCoords.lat && activeCoords.lng ? `${activeCoords.lat.toFixed(4)}Â° N, ${activeCoords.lng.toFixed(4)}Â° E` : 'â€”'}</span></div>
                          <div className="text-text-base text-[11px] flex justify-between gap-4"><span className="text-text-muted">Distance from start:</span> <span className="font-semibold text-text-base">{activeKm} km</span></div>
                          <div className="text-text-base text-[11px] flex justify-between gap-4"><span className="text-text-muted">Image Count:</span> <span className="font-semibold text-text-base">{activeImages}</span></div>
                          <div className="text-text-base text-[11px] flex justify-between items-center gap-4">
                            <span className="text-text-muted">Defect Images:</span>
                            <button
                              onClick={() => {
                                const validFn = activeDailyLog?.panoramas?.[0]?.filename || activeBatchLog?.imageFilename || '';
                                const imgUrl = validFn ? resolvePanoramaUrl(validFn, projectSettings) : '';
                                setActivePanoramaFilename(validFn);
                                setActivePanoramaUrl(imgUrl);
                                setHasSelectedPoint(Boolean(activeCoords.lat && activeCoords.lng));
                                if (activeCoords.lat && activeCoords.lng) {
                                  setInspectorCoords(activeCoords);
                                }
                                if (selectedSubgridFilter) {
                                  setInspectorSubgrid(selectedSubgridFilter);
                                }
                              }}
                              className={`font-semibold px-2 py-0.5 rounded border text-[10px] cursor-pointer transition-all flex items-center gap-1.5 group shadow-sm active:scale-95 ${activeDefects > 0
                                ? 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/25 border-amber-500/30 hover:border-amber-500/60'
                                : 'text-text-muted bg-slate-500/10 border-subtle/20'
                                }`}
                              title="Click to filter & select defect data"
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeDefects > 0 ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                              <span>{activeDefects} Flagged</span>
                              <Filter size={10} className="group-hover:scale-110 transition-transform shrink-0" />
                            </button>
                          </div>
                          <div className="text-text-base text-[11px] flex justify-between gap-4"><span className="text-text-muted">PIC:</span> <span className="font-semibold text-emerald-400">{activePic}</span></div>
                          <div className="text-text-base text-[11px] flex justify-between items-center pt-1 border-t border-subtle">
                            <span className="text-text-muted">Processing Status:</span>
                            <span className={`font-semibold px-2 py-0.5 rounded border text-[10px] ${isPublished
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                              : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                              }`}>
                              {activeStatusText}
                            </span>
                          </div>
                        </div>
                      ) : null;
                    })()}

                    <MapComponent
                      layerCatalog={layerCatalog}
                      refreshKey={mapRefreshKey}
                      onManualRefresh={handleRefreshMap}
                      selectedSubgridFilter={selectedSubgridFilter}
                      selectedDailyRunId={selectedDailyRunId}
                      selectedDateFilter={selectedDateFilter}
                      stagedItems={
                        selectedDailyRunId
                          ? dailyData.filter(d => getItemId(d) === selectedDailyRunId)
                          : (selectedSubgridFilter
                            ? dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim())
                            : dailyData)
                      }
                      projectSettings={projectSettings}
                      defectsList={allKnownDefects}
                      iframeRefCb={(el) => { inspectionMapIframeRef.current = el; }}
                    />
                  </div>
                </div>

                {/* RIGHT COLUMN: PROCESSING CONTROL & 360 QA INSPECTOR (5 Cols) */}
                <div className="col-span-1 lg:col-span-5 flex flex-col gap-3 min-h-[400px] lg:min-h-0">

                  {/* TOP RIGHT PANEL: WEBGIS DATABASE & ADMIN */}
                  <div className={`flex-1 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden transition-all duration-700 ${focusedSection === 'processing'
                    ? 'relative z-30 ring-4 ring-emerald-400 shadow-[0_0_50px_rgba(52,211,153,0.5)] scale-[1.005]'
                    : focusedSection
                      ? 'filter blur-[4px] opacity-25 pointer-events-none'
                      : ''
                    }`}>
                    <div className="p-2.5 sm:p-3 border-b border-subtle flex flex-wrap items-center justify-between gap-2 shrink-0 bg-card">
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <span className="text-xs font-bold uppercase tracking-wider text-text-base flex items-center gap-1.5 sm:gap-2">
                          <Database size={14} className="text-sky-400 shrink-0" />
                          <span>{t('processingControlTitle')}</span>
                        </span>
                        <div className="flex bg-inner border border-subtle rounded-lg p-0.5 text-[10px]">
                          <button
                            onClick={() => setActiveTab('batches')}
                            className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${activeTab === 'batches' ? 'bg-card text-text-base shadow-sm' : 'text-text-muted hover:text-text-base'}`}
                          >
                            Overall Progress ({activeBatchLogs.length})
                          </button>
                          <button
                            onClick={() => setActiveTab('daily')}
                            className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${activeTab === 'daily' ? 'bg-card text-text-base shadow-sm' : 'text-text-muted hover:text-text-base'}`}
                          >
                            Daily Progress ({dailyData.length})
                          </button>
                        </div>

                        {/* Simple Icon-Only Filter Button */}
                        <button
                          onClick={() => setIsDashFilterOpen(prev => !prev)}
                          className={`p-1 rounded-lg border transition-all cursor-pointer ${hasActiveDashFilters
                            ? 'bg-sky-600 border-sky-500 text-text-base shadow-sm'
                            : isDashFilterOpen
                              ? 'bg-card border-subtle text-sky-400'
                              : 'bg-card border-subtle text-text-muted hover:text-text-base hover:bg-card'
                            }`}
                          title="Filter Daily Progress columns"
                        >
                          <Filter size={13} />
                        </button>
                      </div>
                      <button
                        onClick={() => goToWorkspace('data')}
                        className="px-2.5 sm:px-3 py-1.5 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-[10px] sm:text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer shadow-sm ml-auto sm:ml-0"
                      >
                        RE-UPLOAD CSV
                      </button>
                    </div>

                    {/* Compact Inline Filter Bar for Daily Progress */}
                    {isDashFilterOpen && (
                      <div className="px-3 py-2 bg-card border-b border-subtle flex flex-wrap items-center justify-between gap-2 text-[10px] animate-in fade-in duration-150">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">Grid:</span>
                            <select
                              value={dashDailyFilters.grid}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, grid: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                            >
                              <option value="">All</option>
                              {Array.from(new Set(dailyData.map(d => d.grid).filter(Boolean))).sort().map(g => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">Subgrid:</span>
                            <select
                              value={dashDailyFilters.subgrid}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, subgrid: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                            >
                              <option value="">All</option>
                              {Array.from(new Set(dailyData.map(d => (d.subgrid || '').toUpperCase().trim()).filter(Boolean))).sort().map(sg => (
                                <option key={sg} value={sg}>{sg}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">PIC:</span>
                            <select
                              value={dashDailyFilters.pic}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, pic: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                            >
                              <option value="">All</option>
                              {Array.from(new Set(dailyData.map(d => d.pic).filter(Boolean))).sort().map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">Equipment:</span>
                            <select
                              value={dashDailyFilters.equipment}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, equipment: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                            >
                              <option value="">All</option>
                              {Array.from(new Set(dailyData.map(d => d.captureEquipment || 'MMS').filter(Boolean))).sort().map(eq => (
                                <option key={eq} value={eq}>{eq}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {hasActiveDashFilters && (
                          <button
                            onClick={() => setDashDailyFilters({ grid: '', subgrid: '', pic: '', equipment: '' })}
                            className="text-red-400 hover:text-red-300 text-[10px] font-semibold cursor-pointer flex items-center gap-1"
                            title="Clear dashboard filters"
                          >
                            <X size={12} /> Clear
                          </button>
                        )}
                      </div>
                    )}

                    {/* Table */}
                    <div className="flex-1 overflow-auto">
                      {activeTab === 'batches' ? (
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-card text-text-muted sticky top-0 z-10 border-b border-subtle">
                            <tr>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Batch ID</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Grid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Subgrid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Frames</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Distance</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Images</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Defects</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">PIC</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Status</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted text-right whitespace-nowrap">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                            {isDataLoading ? (
                              <tr>
                                <td colSpan={10} className="py-12 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Loader2 size={22} className="animate-spin text-sky-400" />
                                    <span className="text-xs font-semibold text-text-base">Loading batch logs...</span>
                                  </div>
                                </td>
                              </tr>
                            ) : activeBatchLogs.length === 0 ? (
                              <tr>
                                <td colSpan={10} className="py-10 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Database size={28} className="text-text-muted" />
                                    <span className="text-xs font-semibold text-text-base">No batch logs found</span>
                                    <span className="text-[11px] text-text-muted">Import a CSV file to ingest processing logs.</span>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              activeBatchLogs.map((log: BatchLog, i: number) => {
                                const batchSubgrid = (extractSubgridName(log.subgrid || log.imageFilename) || '').toUpperCase().trim();
                                const isSelected = selectedSubgridFilter === batchSubgrid;
                                const formattedBatchId = formatBatchIdDisplay(log, i);
                                return (
                                  <tr
                                    key={log.id || i}
                                    onClick={() => toggleSubgridFilter(batchSubgrid)}
                                    className={`cursor-pointer transition-all ${isSelected ? 'bg-sky-950/70 text-text-base font-medium' : 'hover:bg-inner text-text-base'}`}
                                  >
                                    <td className="px-3.5 py-3.5 font-sans text-[11px] text-text-base font-semibold whitespace-nowrap">{formattedBatchId}</td>
                                    <td className="px-3.5 py-3.5 font-medium text-text-base whitespace-nowrap">{log.grid || '1'}</td>
                                    <td className="px-3.5 py-3.5 font-semibold text-text-base whitespace-nowrap">{batchSubgrid}</td>
                                    <td className="px-3.5 py-3.5 font-sans text-xs text-text-base font-semibold whitespace-nowrap">{getPOICount(log).toLocaleString()}</td>
                                    <td className="px-3.5 py-3.5 font-semibold text-text-base whitespace-nowrap">{(log.kmProcessed || 0).toFixed(1)} km</td>
                                    <td className="px-3.5 py-3.5 whitespace-nowrap">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const subFilter = (extractSubgridName(batchSubgrid) || batchSubgrid).toUpperCase().trim();
                                          const matchingDaily = dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid).toUpperCase().trim() === subFilter);
                                          const dailyAvailFiles = matchingDaily.flatMap(d => d.availableFilenames || []);
                                          const customFn = log.availableFilenames && log.availableFilenames.length > 0
                                            ? log.availableFilenames
                                            : (dailyAvailFiles.length > 0
                                              ? Array.from(new Set(dailyAvailFiles))
                                              : (log.panoramas && log.panoramas.length > 0
                                                ? log.panoramas.filter((p) => p.isAvailable !== false).map((p) => p.filename).filter((f): f is string => Boolean(f) && (extractSubgridName(f) || '').toUpperCase().trim() === subFilter)
                                                : undefined));
                                          setImagesListModal({
                                            isOpen: true,
                                            subgrid: batchSubgrid,
                                            count: customFn && customFn.length > 0 ? customFn.length : getImagesProcessedCount(log),
                                            poiCount: getPOICount(log),
                                            baseFilename: log.imageFilename,
                                            customFilenames: customFn && customFn.length > 0 ? customFn : undefined
                                          });
                                        }}
                                        className="inline-flex items-center gap-1.5 text-text-base hover:text-text-base hover:underline font-semibold text-[11px] cursor-pointer whitespace-nowrap"
                                        title="Click to view list of image filenames"
                                      >
                                        <span>{getImagesProcessedCount(log).toLocaleString()} frames</span>
                                        <ExternalLink size={10} className="shrink-0 text-text-muted" />
                                      </button>
                                    </td>
                                    <td className="px-3.5 py-3.5 font-semibold whitespace-nowrap">
                                      {(() => {
                                        const isThisMasterlistActive = (qaqcWorkerState.isRunning || qaqcWorkerState.isCompleted) && qaqcWorkerState.subgrid === batchSubgrid;
                                        const isSpecificRunActive = isThisMasterlistActive && Boolean(qaqcWorkerState.runId);
                                        const isWholeSubgridActive = isThisMasterlistActive && !qaqcWorkerState.runId;

                                        const batchFrames = getImagesProcessedCount(log);
                                        const cached = qaqcAuditRuns[`${batchSubgrid}_default`];
                                        const cachedDefects = (cached && typeof cached.defectCount === 'number') ? cached.defectCount : undefined;

                                        let parsedDefects: number | undefined;
                                        if (log.qaqcStatus) {
                                          const m = log.qaqcStatus.match(/(\d+)\s+Defect/i);
                                          if (m) parsedDefects = parseInt(m[1], 10);
                                        }

                                        let dCount = 0;
                                        if (isWholeSubgridActive) {
                                          dCount = qaqcWorkerState.defectsList.length;
                                        } else {
                                          const subgridDailyRuns = dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === batchSubgrid);
                                          if (subgridDailyRuns.length > 0) {
                                            let sumDefects = 0;
                                            let anyDailyInspected = false;
                                            subgridDailyRuns.forEach(d => {
                                              const fCount = getImagesProcessedCount(d);
                                              if (fCount === 0) return;

                                              const runId = getItemId(d);
                                              const isThisDailyActive = isSpecificRunActive && qaqcWorkerState.runId === runId;
                                              const dailyCached = runId ? qaqcAuditRuns[`${batchSubgrid}_${runId}`] : undefined;
                                              const dailyCachedCount = (dailyCached && typeof dailyCached.defectCount === 'number') ? dailyCached.defectCount : 0;

                                              let runDefects = 0;
                                              if (isThisDailyActive) {
                                                runDefects = qaqcWorkerState.defectsList.length;
                                                anyDailyInspected = true;
                                              } else if (dailyCachedCount > 0) {
                                                runDefects = dailyCachedCount;
                                                anyDailyInspected = true;
                                              } else if (typeof d.imagesDefected === 'number' && d.imagesDefected > 0) {
                                                runDefects = d.imagesDefected;
                                                anyDailyInspected = true;
                                              } else if (typeof d.defectCount === 'number' && d.defectCount > 0) {
                                                runDefects = d.defectCount;
                                                anyDailyInspected = true;
                                              }
                                              sumDefects += Math.min(runDefects, fCount);
                                            });

                                            if (anyDailyInspected) {
                                              dCount = sumDefects;
                                            } else if (typeof log.defects === 'number' && log.defects > 0) {
                                              dCount = log.defects;
                                            } else if (cachedDefects !== undefined && cachedDefects > 0) {
                                              dCount = cachedDefects;
                                            } else if (parsedDefects !== undefined && parsedDefects > 0) {
                                              dCount = parsedDefects;
                                            }
                                          } else {
                                            dCount = (typeof log.defects === 'number' && log.defects > 0)
                                              ? log.defects
                                              : (cachedDefects !== undefined && cachedDefects > 0)
                                                ? cachedDefects
                                                : (parsedDefects !== undefined && parsedDefects > 0)
                                                  ? parsedDefects
                                                  : 0;
                                          }
                                        }

                                        if (batchFrames > 0) {
                                          dCount = Math.min(dCount, batchFrames);
                                        } else {
                                          dCount = 0;
                                        }

                                        return dCount > 0 ? (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedDefectSubgrid(batchSubgrid);
                                              setDefectGalleryContext({
                                                mode: 'master',
                                                subgrid: batchSubgrid,
                                                totalPoi: (typeof log.poiCount === 'number' && log.poiCount > 0) ? log.poiCount : (log.images || 0)
                                              });
                                              setIsDefectsGalleryOpen(true);
                                            }}
                                            className="text-amber-400 hover:text-amber-300 font-semibold hover:underline cursor-pointer text-[11px] tabular-nums transition-colors"
                                            title="Click to open Masterlist QA/QC Defect Review Gallery"
                                          >
                                            {dCount}
                                          </button>
                                        ) : (
                                          <span className="text-text-muted text-[11px] font-medium tabular-nums">0</span>
                                        );
                                      })()}
                                    </td>
                                    <td className="px-3.5 py-3.5 text-text-base font-medium whitespace-nowrap">Admin</td>
                                    <td className="px-3.5 py-3.5 whitespace-nowrap">
                                      {qaqcWorkerState.isRunning && !qaqcWorkerState.runId && qaqcWorkerState.subgrid === batchSubgrid ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setIsQAQCRunnerModalOpen(true);
                                          }}
                                          className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 inline-flex items-center gap-1.5 whitespace-nowrap animate-pulse shadow-sm hover:scale-105 transition-transform cursor-pointer"
                                          title="Click to open QA/QC Live HUD"
                                        >
                                          <Activity size={10} className="text-sky-400 animate-spin" />
                                          QAQC In Progress ({qaqcWorkerState.currentIndex + 1}/{qaqcWorkerState.totalStations})
                                        </button>
                                      ) : log.qaqcStatus || (qaqcWorkerState.isCompleted && !qaqcWorkerState.runId && qaqcWorkerState.subgrid === batchSubgrid) ? (
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1 whitespace-nowrap shadow-sm">
                                          <CheckCircle size={10} className="text-emerald-400" />
                                          {log.qaqcStatus || `QAQC Completed (${qaqcWorkerState.defectsList.length} Defects Found)`}
                                        </span>
                                      ) : (
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${log.status === 'Complete' || (log.status as string) === 'Published'
                                          ? 'bg-inner text-text-base border border-subtle'
                                          : 'bg-app text-text-muted border border-subtle'
                                          }`}>
                                          {log.status === 'Complete' || (log.status as string) === 'Published' ? <CheckCircle size={10} className="text-emerald-400" /> : <Clock size={10} className="text-amber-400" />}
                                          {log.status || 'Complete'}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                                      <button onClick={(e) => { e.stopPropagation(); toggleSubgridFilter(batchSubgrid); }} className="px-2.5 py-1 bg-inner hover:bg-inner text-text-base hover:text-text-base border border-subtle rounded-md text-[10px] font-medium cursor-pointer transition-colors whitespace-nowrap" aria-label={`View logs for subgrid ${batchSubgrid}`}>
                                        View Logs
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-card text-text-muted sticky top-0 z-10 border-b border-subtle">
                            <tr>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Date</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Grid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Subgrid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Distance</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Images</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Defects</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">PIC</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Status</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted text-right whitespace-nowrap">Equipment</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                            {isDataLoading ? (
                              <tr>
                                <td colSpan={9} className="py-12 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Loader2 size={22} className="animate-spin text-sky-400" />
                                    <span className="text-xs font-semibold text-text-base">Loading daily progress...</span>
                                  </div>
                                </td>
                              </tr>
                            ) : dailyData.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="py-10 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Calendar size={28} className="text-text-muted" />
                                    <span className="text-xs font-semibold text-text-base">No daily records yet</span>
                                    <span className="text-[11px] text-text-muted">Daily processing progress logs will appear here.</span>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              [...dailyData]
                                .reverse()
                                .filter(log => {
                                  if (dashDailyFilters.grid && log.grid !== dashDailyFilters.grid) return false;
                                  if (dashDailyFilters.subgrid && (log.subgrid || '').toUpperCase().trim() !== dashDailyFilters.subgrid.toUpperCase().trim()) return false;
                                  if (dashDailyFilters.pic && (log.pic || '') !== dashDailyFilters.pic) return false;
                                  if (dashDailyFilters.equipment && (log.captureEquipment || 'MMS') !== dashDailyFilters.equipment) return false;
                                  return true;
                                })
                                .map((log, i) => {
                                  const dailySubgrid = (log.subgrid || '').toUpperCase().trim();
                                  const runId = getItemId(log);
                                  const frameCount = getImagesProcessedCount(log);
                                  const isRowSelected = selectedDailyRunId === runId;
                                  const isThisRowUnderInspection = qaqcWorkerState.isRunning && (
                                    qaqcWorkerState.runId ? qaqcWorkerState.runId === runId : false
                                  );
                                  const isThisRowCompleted = qaqcWorkerState.isCompleted && (
                                    qaqcWorkerState.runId ? qaqcWorkerState.runId === runId : false
                                  );

                                  let cachedDefects: number | undefined;
                                  const cachedAuditObj = runId ? qaqcAuditRuns[`${dailySubgrid}_${runId}`] : undefined;
                                  if (cachedAuditObj && typeof cachedAuditObj.defectCount === 'number') {
                                    cachedDefects = cachedAuditObj.defectCount;
                                  }

                                  let parsedStatusDefects: number | undefined;
                                  if (log.qaqcStatus) {
                                    const m = log.qaqcStatus.match(/(\d+)\s+Defect/i);
                                    if (m) parsedStatusDefects = parseInt(m[1], 10);
                                  }

                                  const defectCount = frameCount === 0
                                    ? 0
                                    : (isThisRowUnderInspection || isThisRowCompleted)
                                      ? qaqcWorkerState.defectsList.length
                                      : (log.imagesDefected && log.imagesDefected > 0)
                                        ? log.imagesDefected
                                        : (log.defectCount && log.defectCount > 0)
                                          ? log.defectCount
                                          : (cachedDefects !== undefined && cachedDefects > 0)
                                            ? cachedDefects
                                            : (parsedStatusDefects !== undefined && parsedStatusDefects > 0)
                                              ? parsedStatusDefects
                                              : 0;

                                  const isPublished = log.publishToWebGIS === 'yes';
                                  return (
                                    <tr
                                      key={log.id || `dash-d-${log.date}-${log.subgrid}-${i}`}
                                      onClick={() => handleSelectDailyRun(log)}
                                      className={`cursor-pointer transition-all duration-150 ${isRowSelected
                                        ? '!bg-sky-900/60 border-l-4 border-sky-400 !text-white font-semibold shadow-inner'
                                        : 'hover:bg-inner text-text-base'
                                        }`}
                                    >
                                      <td className="px-3.5 py-3.5 font-sans text-[10px] text-text-muted whitespace-nowrap">
                                        <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                          <span>{formatDisplayDate(log.date)}</span>
                                          {isRowSelected && <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />}
                                        </div>
                                      </td>
                                      <td className="px-3.5 py-3.5 font-medium text-text-base whitespace-nowrap">{log.grid}</td>
                                      <td className="px-3.5 py-3.5 font-semibold text-text-base whitespace-nowrap">{dailySubgrid}</td>
                                      <td className="px-3.5 py-3.5 text-text-base whitespace-nowrap">{log.kmProcessed.toFixed(1)} km</td>
                                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const subFilter = (extractSubgridName(dailySubgrid) || dailySubgrid).toUpperCase().trim();
                                            const customFn = log.availableFilenames && log.availableFilenames.length > 0
                                              ? log.availableFilenames
                                              : (log.panoramas && log.panoramas.length > 0
                                                ? log.panoramas.filter((p) => p.isAvailable !== false).map((p) => p.filename).filter((f): f is string => Boolean(f) && (extractSubgridName(f) || '').toUpperCase().trim() === subFilter)
                                                : undefined);
                                            const rowFrameCount = getImagesProcessedCount(log);
                                            setImagesListModal({
                                              isOpen: true,
                                              subgrid: dailySubgrid,
                                              count: customFn && customFn.length > 0 ? customFn.length : rowFrameCount,
                                              poiCount: getPOICount(log),
                                              baseFilename: (log.panoramas?.[0]?.filename) || `${dailySubgrid}-0001.jpg`,
                                              customFilenames: customFn && customFn.length > 0 ? customFn : undefined
                                            });
                                          }}
                                          className="inline-flex items-center gap-1.5 text-text-base hover:text-text-base hover:underline font-semibold text-[11px] cursor-pointer whitespace-nowrap"
                                          title="Click to view list of image filenames"
                                        >
                                          <span>{getImagesProcessedCount(log).toLocaleString()} frames</span>
                                          <ExternalLink size={10} className="shrink-0 text-text-muted" />
                                        </button>
                                      </td>
                                      <td className="px-3.5 py-3.5 font-semibold whitespace-nowrap">
                                        {defectCount > 0 ? (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedDefectSubgrid(dailySubgrid);
                                              const dailyPanos = log.panoramas || [];
                                              setDefectGalleryContext({
                                                mode: 'daily',
                                                subgrid: dailySubgrid,
                                                surveyDate: log.date || ((log as any).created_at ? new Date((log as any).created_at).toLocaleDateString() : undefined),
                                                totalPoi: log.poiCount || dailyPanos.length || getImagesProcessedCount(log),
                                                batchFilenames: dailyPanos.map((p) => p.filename || p.id).filter((f): f is string => Boolean(f))
                                              });
                                              setIsDefectsGalleryOpen(true);
                                            }}
                                            className="text-amber-400 hover:text-amber-300 font-semibold hover:underline cursor-pointer text-[11px] tabular-nums transition-colors"
                                            title="Click to open Daily QA/QC Defect Review Gallery"
                                          >
                                            {defectCount}
                                          </button>
                                        ) : (
                                          <span className="text-text-muted text-[11px] font-medium tabular-nums">0</span>
                                        )}
                                      </td>
                                      <td className="px-3.5 py-3.5 text-text-base font-medium whitespace-nowrap">{formatPIC(log.pic, activeAuthUserName || "Fariz.farhan95")}</td>
                                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                                        {(() => {
                                          if (isThisRowUnderInspection) {
                                            return (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setIsQAQCRunnerModalOpen(true);
                                                }}
                                                className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 inline-flex items-center gap-1.5 whitespace-nowrap animate-pulse shadow-sm hover:scale-105 transition-transform cursor-pointer"
                                                title="Click to view live QA/QC inspection HUD"
                                              >
                                                <Activity size={10} className="text-sky-400 animate-spin" />
                                                QAQC In Progress ({qaqcWorkerState.currentIndex + 1}/{qaqcWorkerState.totalStations})
                                              </button>
                                            );
                                          }

                                          const effectiveQaqcStatus = frameCount === 0
                                            ? undefined
                                            : (log.qaqcStatus || (isThisRowCompleted ? `QAQC Completed (${qaqcWorkerState.defectsList.length} Defects Found)` : (cachedAuditObj ? `QAQC Completed (${cachedAuditObj.defectCount} Defect${cachedAuditObj.defectCount === 1 ? '' : 's'} Found)` : undefined)));

                                          if (effectiveQaqcStatus) {
                                            return (
                                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-inner text-text-base border border-subtle inline-flex items-center gap-1 whitespace-nowrap shadow-sm">
                                                <CheckCircle size={10} className="text-emerald-400" />
                                                {effectiveQaqcStatus}
                                              </span>
                                            );
                                          }

                                          if (isPublished) {
                                            return (
                                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-inner text-text-base border border-subtle inline-flex items-center gap-1 whitespace-nowrap">
                                                <CheckCircle size={10} className="text-emerald-400" /> Published
                                              </span>
                                            );
                                          }

                                          return (
                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-app text-text-muted border border-subtle inline-flex items-center gap-1 whitespace-nowrap">
                                              <Clock size={10} className="text-amber-400" /> In Progress
                                            </span>
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3.5 py-3.5 text-right font-medium text-text-base whitespace-nowrap">{log.captureEquipment || 'MMS'}</td>
                                    </tr>
                                  );
                                })
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* 360 INSPECTOR VIEWER & QAQC CARD */}
                  <div className={`flex-1 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden transition-all duration-700 ${focusedSection === 'qa'
                    ? 'relative z-30 ring-4 ring-indigo-400 shadow-[0_0_50px_rgba(129,140,248,0.5)] scale-[1.005]'
                    : focusedSection
                      ? 'filter blur-[4px] opacity-25 pointer-events-none'
                      : ''
                    }`}>

                    {/* Card Header */}
                    <div className="px-3.5 py-2 border-b border-subtle bg-card flex flex-wrap items-center justify-between shrink-0 gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-text-base flex items-center gap-2 shrink-0">
                        <Camera size={14} className="text-accent" />
                        <span>360 INSPECTOR VIEWER & ACQUISITION QC</span>
                      </span>

                      <div className="flex items-center gap-2 min-w-0">
                        {qaqcWorkerState.isRunning ? (
                          <div className="flex items-center gap-2.5 px-3 py-1 bg-inner border border-subtle rounded-xl text-xs shadow-sm animate-in fade-in duration-200">
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                            </span>
                            <span className="text-xs font-medium text-text-base whitespace-nowrap">
                              QA/QC: <span className="font-sans font-bold text-accent">{qaqcWorkerState.subgrid || 'General'}</span>
                            </span>
                            <div className="w-16 h-1.5 bg-card rounded-full overflow-hidden border border-subtle/80 shrink-0">
                              <div
                                className="h-full bg-accent transition-all duration-150"
                                style={{
                                  width: `${Math.min(100, Math.round(((qaqcWorkerState.currentIndex + 1) / (qaqcWorkerState.totalStations || 1)) * 100))}%`
                                }}
                              />
                            </div>
                            <span className="text-xs font-semibold tabular-nums text-text-base shrink-0 font-sans">
                              {Math.min(100, Math.round(((qaqcWorkerState.currentIndex + 1) / (qaqcWorkerState.totalStations || 1)) * 100))}%
                            </span>
                            <span className="text-[11px] text-text-muted tabular-nums shrink-0 font-sans">
                              ({Math.min(qaqcWorkerState.totalStations || 1, qaqcWorkerState.currentIndex + 1)}/{qaqcWorkerState.totalStations || 1})
                            </span>
                            <button
                              type="button"
                              onClick={() => setIsQAQCRunnerModalOpen(true)}
                              className="px-2 py-0.5 bg-card hover:bg-card text-text-base hover:text-text-base border border-subtle rounded text-[10px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-sm active:scale-95 shrink-0"
                            >
                              <Activity size={10} className="animate-spin text-sky-400" />
                              <span>Open HUD</span>
                            </button>
                            <button
                              type="button"
                              onClick={abortQAQCInspection}
                              className="px-2 py-0.5 bg-card hover:bg-red-950/30 text-text-base hover:text-rose-400 border border-subtle hover:border-red-800/50 rounded text-[10px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-sm active:scale-95 shrink-0"
                              title="Abort inspection"
                            >
                              <StopCircle size={10} />
                              <span>Abort</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setIsQAQCRunnerModalOpen(true);
                            }}
                            title="Launch Full Canvas QA/QC Inspection Workbench with Target Selection Hub"
                            className="px-3 py-1.5 bg-card hover:bg-card text-text-base hover:text-text-base border border-subtle text-[11px] font-medium rounded-lg transition-all cursor-pointer shadow-sm flex items-center gap-1.5 active:scale-95"
                          >
                            <Play size={11} className="fill-current text-text-base" />
                            <span>Run Batch Acquisition QC</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="flex-1 flex gap-2.5 p-2.5 min-h-0">
                      {/* Left: 360 Panorama Canvas + Floating HUD Overlay */}
                      <div className="flex-1 bg-app rounded-lg border border-subtle relative overflow-hidden group flex flex-col min-w-0">
                        {hasSelectedPoint && (
                          <button
                            onClick={clearMapSelection}
                            title="Return to map (clear 360 selection)"
                            className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-subtle text-[10px] font-bold uppercase tracking-wide text-text-base hover:bg-slate-800 hover:border-sky-500/40 transition-colors cursor-pointer shadow"
                          >
                            <X size={12} /> Return to Map
                          </button>
                        )}
                        {hasSelectedPoint ? (
                          <>
                            {(() => {
                              const targetSubgrid = inspectorSubgrid || selectedSubgridFilter || '';
                              const targetFilename = activePanoramaFilename || '';

                              const provider = projectSettings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2';
                              const isMultiResStrategy = projectSettings?.imageStorageStrategy !== 'single_equirectangular';

                              const shouldUseMultiRes = isMultiResStrategy && (
                                provider === 'cloudflare_r2' ||
                                provider === 'custom_cdn' ||
                                provider === 'aws_s3' ||
                                provider === 'wasabi' ||
                                provider === 'gcs' ||
                                provider === 'azure_blob' ||
                                provider === 'nas_local'
                              );

                              const dynamicConfigUrl = shouldUseMultiRes && targetFilename
                                ? resolvePanoramaConfigUrl(targetFilename, projectSettings, targetSubgrid)
                                : '';
                              const dynamicPanoUrl = activePanoramaUrl || (targetFilename
                                ? resolvePanoramaUrl(targetFilename, projectSettings, { subgrid: targetSubgrid })
                                : '');

                              return (
                                <PhotoSphereViewerComponent
                                  ref={dashboardPsvRef}
                                  key={`pano-psv-${targetSubgrid}-${provider}`}
                                  configUrl={shouldUseMultiRes && dynamicConfigUrl ? dynamicConfigUrl : undefined}
                                  panoramaUrl={!shouldUseMultiRes ? dynamicPanoUrl : undefined}
                                  initialYaw={panoramaTelemetry.yaw}
                                  initialFov={projectSettings?.defaultFov}
                                  onPositionChange={(pos) => {
                                    // Live heading-cone sync: broadcast 360 camera rotation to the
                                    // embedded WebGIS map so its sonar/heading cone follows the view.
                                    // NOTE: React state (panoramaTelemetry) is intentionally NOT updated
                                    // here â€” rotation would re-render the entire dashboard. The live
                                    // heading is published via the heading store (see
                                    // PhotoSphereViewerComponent) for the HUD readout without App re-render.
                                    const yawDeg = Math.round(pos.yaw * 100) / 100;
                                    const pitchDeg = Math.round(pos.pitch * 100) / 100;
                                    const cameraMsg = {
                                      type: 'CAMERA_ROTATED',
                                      source: 'parent',
                                      yaw: yawDeg,
                                      pitch: pitchDeg
                                    };
                                    const mapIframe = inspectionMapIframeRef.current;
                                    if (mapIframe?.contentWindow) {
                                      try {
                                        mapIframe.contentWindow.postMessage(cameraMsg, '*');
                                      } catch (_) { }
                                    }
                                  }}
                                  className="w-full h-full"
                                />
                              );
                            })()}

                            {/* Dashboard-only Compact Floating HUD */}
                            <WebGISHUDViewerOverlay
                              imageName={activePanoramaFilename || (inspectorSubgrid ? `${inspectorSubgrid}-0001.jpg` : 'Inspection Node')}
                              currentIndex={
                                (() => {
                                  const cleanSg = (inspectorSubgrid || selectedSubgridFilter || 'N93E70').toUpperCase().trim();
                                  const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);

                                  // 1. Match by exact filename in the sorted stations list
                                  const currentClean = (activePanoramaFilename || '').split('/').pop()?.toLowerCase().trim();
                                  const foundIdx = stations.findIndex(
                                    (s) => (s.filename || '').split('/').pop()?.toLowerCase().trim() === currentClean
                                  );
                                  if (foundIdx >= 0) return foundIdx;

                                  // 2. Fallback: Parse sequence number (1-based -> 0-based)
                                  const match = (activePanoramaFilename || '').match(/(\d+)\.jpg$/i);
                                  return match ? Math.max(0, parseInt(match[1], 10) - 1) : 0;
                                })()
                              }
                              totalFrames={
                                (() => {
                                  const cleanSg = (inspectorSubgrid || selectedSubgridFilter || 'N93E70').toUpperCase().trim();
                                  const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);
                                  if (stations.length > 0) return stations.length;
                                  const currentItem = dailyData.find(
                                    (d) => (extractSubgridName(d.subgrid) || '').toUpperCase() === cleanSg
                                  );
                                  return currentItem ? getImagesProcessedCount(currentItem) : (totalImages > 0 ? totalImages : 104);
                                })()
                              }
                              coordinates={inspectorCoords}
                              heading={panoramaTelemetry.yaw}
                              gpsAccuracy="0.0m"
                              equipType={projectSettings?.defaultEquipment || 'MMS 360'}
                              onIndexChange={(newIdx: number) => {
                                const cleanSg = (inspectorSubgrid || selectedSubgridFilter || 'N93E70').toUpperCase().trim();

                                // Retrieve sorted sequential station track
                                const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);
                                const total = stations.length > 0 ? stations.length : (totalImages > 0 ? totalImages : 1);

                                // Clamp strictly to array boundaries
                                const targetIdx = Math.max(0, Math.min(newIdx, total - 1));
                                const targetStation = stations[targetIdx];

                                // Exact filename from station object without manual addition
                                const nextFn = targetStation?.filename || `${cleanSg}-${String(targetIdx + 1).padStart(4, '0')}.jpg`;
                                const nextUrl = targetStation?.image_url || resolvePanoramaUrl(nextFn, projectSettings, { subgrid: cleanSg });
                                const nextLat = Number(targetStation?.latitude ?? (targetStation as any)?.lat ?? inspectorCoords.lat);
                                const nextLng = Number(targetStation?.longitude ?? (targetStation as any)?.lng ?? (targetStation as any)?.lon ?? inspectorCoords.lng);
                                const nextBearing = targetStation?.bearing ?? (targetStation as any)?.heading ?? ((targetIdx * 12) % 360);

                                // Preload adjacent stations into browser cache for instant 0ms stepping
                                const aheadStation = stations[targetIdx + 1];
                                if (aheadStation) {
                                  const url = aheadStation.image_url || resolvePanoramaUrl(aheadStation.filename, projectSettings, { subgrid: cleanSg });
                                  if (url) { const img = new Image(); img.src = url; }
                                }
                                const behindStation = stations[targetIdx - 1];
                                if (behindStation) {
                                  const url = behindStation.image_url || resolvePanoramaUrl(behindStation.filename, projectSettings, { subgrid: cleanSg });
                                  if (url) { const img = new Image(); img.src = url; }
                                }

                                // Update Dashboard State
                                setActivePanoramaFilename(nextFn);
                                setActivePanoramaUrl(nextUrl);
                                if (nextLat !== 0 && nextLng !== 0) {
                                  setInspectorCoords({ lat: nextLat, lng: nextLng });
                                }

                                // Synchronize Map Marker & View
                                const pointPayload = {
                                  filename: nextFn,
                                  image_url: nextUrl,
                                  config_url: nextFn ? resolvePanoramaConfigUrl(nextFn, projectSettings, cleanSg) : '',
                                  subgrid: cleanSg,
                                  lat: nextLat,
                                  lng: nextLng,
                                  lon: nextLng,
                                  bearing: nextBearing,
                                  index: targetIdx + 1
                                };

                                // Keep the live 360 camera facing the station heading.
                                if (typeof nextBearing === 'number' && isFinite(nextBearing)) {
                                  dashboardPsvRef.current?.setPosition({ yaw: nextBearing });
                                }

                                const iframes = document.querySelectorAll('iframe');
                                iframes.forEach((f) => {
                                  try {
                                    f.contentWindow?.postMessage(
                                      {
                                        type: 'SET_PANORAMA',
                                        point: pointPayload
                                      },
                                      '*'
                                    );
                                    f.contentWindow?.postMessage(
                                      {
                                        type: 'MAP_POINT_SELECTED',
                                        point: pointPayload
                                      },
                                      '*'
                                    );
                                    f.contentWindow?.postMessage(
                                      {
                                        type: 'SET_CAMERA_HEADING',
                                        heading: nextBearing
                                      },
                                      '*'
                                    );
                                  } catch (e) { }
                                });
                              }}
                              onZoomIn={() => dashboardPsvRef.current?.zoomIn()}
                              onZoomOut={() => dashboardPsvRef.current?.zoomOut()}
                              onFullscreen={() => dashboardPsvRef.current?.toggleFullscreen()}
                            />
                          </>
                        ) : (
                          <div className="w-full h-full bg-card flex flex-col items-center justify-center p-4 text-center select-none">
                            <Maximize2 size={38} className="text-text-muted mb-2.5 stroke-[1.5]" />
                            <h4 className="text-xs sm:text-sm font-medium text-text-base tracking-tight">
                              Select a location on the map
                            </h4>
                            <p className="text-[11px] text-text-muted mt-1">
                              to view 360Â° imagery
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right: Operator QA Defect Flags Panel */}
                      <div className="w-52 sm:w-56 shrink-0 bg-card rounded-lg border border-subtle p-3 flex flex-col justify-between overflow-y-auto">
                        <div>
                          <div className="flex items-center justify-between gap-1 pb-2 border-b border-subtle mb-2.5">
                            <span className="text-[11px] font-bold text-text-base uppercase tracking-tight flex items-center gap-1.5 whitespace-nowrap">
                              <ShieldCheck size={14} className="text-sky-400 shrink-0" />
                              <span>OPERATOR QA</span>
                            </span>
                            <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                              Reviewing
                            </span>
                          </div>

                          {/* Info Card */}
                          <div className="bg-app rounded-md p-2 border border-subtle space-y-1.5 text-[10px] mb-3">
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">Subgrid:</span>
                              <span className="font-semibold text-sky-400 truncate text-right">
                                {hasSelectedPoint ? (inspectorSubgrid || selectedSubgridFilter || '-') : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">Equipment:</span>
                              <span className="font-medium text-text-base text-right whitespace-nowrap">
                                {hasSelectedPoint ? 'MMS 360' : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">Coordinates:</span>
                              <span className="font-sans text-text-base text-[9px] whitespace-nowrap text-right">
                                {hasSelectedPoint ? `${inspectorCoords.lat.toFixed(4)}, ${inspectorCoords.lng.toFixed(4)}` : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">PIC:</span>
                              <span className="font-semibold text-emerald-400 text-right whitespace-nowrap">
                                {hasSelectedPoint ? (batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === (inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim())?.pic || '-') : '-'}
                              </span>
                            </div>
                            {isQaLocked && (
                              <div className="flex flex-col gap-0.5 pt-1 border-t border-subtle">
                                <div className="flex items-center justify-between text-[9.5px]">
                                  <span className="text-text-muted font-medium">QA Status:</span>
                                  <span className={`font-bold font-sans ${qaQuestionnaireAnswer === 'yes' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {qaQuestionnaireAnswer === 'yes' ? 'DEFECT CONFIRMED' : 'PASSED'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[9px]">
                                  <span className="text-text-muted">Defect Choices:</span>
                                  <span className="text-amber-300/90 font-medium truncate text-right max-w-[110px]">
                                    {Object.entries(selectedQaFlags).filter(([_, v]) => v).map(([k]) => k === 'blurry' ? 'Blurry' : k === 'obstruction' ? 'Obstruction' : 'Bad GPS').join(', ') || 'None'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* QA Action Flags */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted block">
                                QA Defect Flags
                              </span>
                              {isGuestUser ? (
                                <span className="text-[8.5px] font-semibold text-amber-500/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">Guest</span>
                              ) : isQaLocked ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                    const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    saveSubgridQa(itemKey, selectedQaFlags, qaQuestionnaireAnswer, false);
                                    const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                    updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Editing QA', { selectedQaFlags, answer: qaQuestionnaireAnswer, action: 'EDIT_QA', filename: activePanoramaFilename, subgrid: sg });
                                  }}
                                  className="text-[8.5px] font-semibold text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-1.5 py-0.5 rounded border border-sky-500/30 flex items-center gap-1 cursor-pointer transition-all shadow-sm active:scale-95"
                                  title="Click to unlock & edit QA defect choices"
                                >
                                  <Edit2 size={10} /> Edit QA
                                </button>
                              ) : (
                                <span className="text-[8.5px] text-text-muted font-sans">Toggle to Flag</span>
                              )}
                            </div>

                            {isGuestUser ? (
                              <div className="space-y-1.5 pointer-events-none opacity-40 select-none">
                                {[
                                  { label: projectSettings.qaFlag1 || 'Blurry Frame', color: 'red' },
                                  { label: projectSettings.qaFlag2 || 'Lens Obstruction', color: 'amber' },
                                  { label: projectSettings.qaFlag3 || 'Bad GPS Signal', color: 'sky' },
                                ].map(({ label, color }) => (
                                  <div key={label} className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between border bg-inner border-subtle text-text-muted cursor-not-allowed`}>
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 bg-${color}-400`}></span>
                                      <span className="truncate">{label}</span>
                                    </span>
                                    <span className="text-[9px] font-sans shrink-0 ml-1 text-text-muted">Flag</span>
                                  </div>
                                ))}
                                <p className="text-[9px] text-amber-500/70 text-center pt-1 italic">QA editing disabled for guests</p>
                              </div>
                            ) : (
                              <>
                                {(!isQaLocked || selectedQaFlags.blurry) && (
                                  <button
                                    type="button"
                                    disabled={isQaLocked}
                                    onClick={() => {
                                      if (isQaLocked) return;
                                      const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                      const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const nextFlags = { ...selectedQaFlags, blurry: !selectedQaFlags.blurry };
                                      saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                      const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                      updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: projectSettings.qaFlag1 || 'Blurry Frame', filename: activePanoramaFilename, subgrid: sg });
                                    }}
                                    className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                      } ${selectedQaFlags.blurry
                                        ? 'bg-red-500/25 border-red-500 text-red-300 ring-1 ring-red-500/50 shadow-md'
                                        : 'bg-inner hover:bg-red-500/10 hover:border-red-500/50 border-subtle text-text-base hover:text-red-400'
                                      }`}
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.blurry ? 'bg-red-300 ring-2 ring-red-400' : 'bg-red-400'}`}></span>
                                      <span className="truncate">{projectSettings.qaFlag1 || 'Blurry Frame'}</span>
                                    </span>
                                    <span className={`text-[9px] font-sans shrink-0 ml-1 ${selectedQaFlags.blurry ? 'text-red-300 font-bold' : 'text-text-muted group-hover:text-red-400'}`}>Flag</span>
                                  </button>
                                )}

                                {(!isQaLocked || selectedQaFlags.obstruction) && (
                                  <button
                                    type="button"
                                    disabled={isQaLocked}
                                    onClick={() => {
                                      if (isQaLocked) return;
                                      const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                      const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const nextFlags = { ...selectedQaFlags, obstruction: !selectedQaFlags.obstruction };
                                      saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                      const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                      updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: projectSettings.qaFlag2 || 'Lens Obstruction', filename: activePanoramaFilename, subgrid: sg });
                                    }}
                                    className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                      } ${selectedQaFlags.obstruction
                                        ? 'bg-amber-500/25 border-amber-500 text-amber-300 ring-1 ring-amber-500/50 shadow-md'
                                        : 'bg-inner hover:bg-amber-500/10 hover:border-amber-500/50 border-subtle text-text-base hover:text-amber-400'
                                      }`}
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.obstruction ? 'bg-amber-300 ring-2 ring-amber-400' : 'bg-amber-400'}`}></span>
                                      <span className="truncate">{projectSettings.qaFlag2 || 'Lens Obstruction'}</span>
                                    </span>
                                    <span className={`text-[9px] font-sans shrink-0 ml-1 ${selectedQaFlags.obstruction ? 'text-amber-300 font-bold' : 'text-text-muted group-hover:text-amber-400'}`}>Flag</span>
                                  </button>
                                )}

                                {(!isQaLocked || selectedQaFlags.badGps) && (
                                  <button
                                    type="button"
                                    disabled={isQaLocked}
                                    onClick={() => {
                                      if (isQaLocked) return;
                                      const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                      const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const nextFlags = { ...selectedQaFlags, badGps: !selectedQaFlags.badGps };
                                      saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                      const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                      updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: projectSettings.qaFlag3 || 'Bad GPS Signal', filename: activePanoramaFilename, subgrid: sg });
                                    }}
                                    className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                      } ${selectedQaFlags.badGps
                                        ? 'bg-sky-500/25 border-sky-500 text-sky-300 ring-1 ring-sky-500/50 shadow-md'
                                        : 'bg-inner hover:bg-sky-500/10 hover:border-sky-500/50 border-subtle text-text-base hover:text-sky-400'
                                      }`}
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.badGps ? 'bg-sky-300 ring-2 ring-sky-400' : 'bg-sky-400'}`}></span>
                                      <span className="truncate">{projectSettings.qaFlag3 || 'Bad GPS Signal'}</span>
                                    </span>
                                    <span className={`text-[9px] font-sans shrink-0 ml-1 ${selectedQaFlags.badGps ? 'text-sky-300 font-bold' : 'text-text-muted group-hover:text-sky-400'}`}>Flag</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>

                          {/* QA Questionnaire Box */}
                          {!isGuestUser && !isQaLocked && (selectedQaFlags.blurry || selectedQaFlags.obstruction || selectedQaFlags.badGps) && (
                            <div className="bg-app rounded-md p-2 border border-subtle space-y-1.5 text-[10px] mt-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
                              <div className="flex items-center justify-between text-text-base font-medium">
                                <span>Update Status?</span>
                                <span className="text-[9px] text-text-muted font-sans">
                                  {qaQuestionnaireAnswer === 'yes' ? 'DEFECT CONFIRMED' : qaQuestionnaireAnswer === 'no' ? 'NO DEFECT' : 'SELECT RESPONSE'}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  disabled={isQaLocked}
                                  onClick={() => {
                                    const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                    const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    saveSubgridQa(itemKey, selectedQaFlags, 'yes', true);
                                    const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                    const newDefects = (targetLog?.defects || 0) + 1;
                                    setBatchLogs(prev => prev.map(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim() ? { ...b, defects: newDefects } : b));
                                    updateDefectStatusInSupabase(itemKey, newDefects, 'Flagged (Defect Confirmed)', { selectedQaFlags, answer: 'YES', filename: activePanoramaFilename, subgrid: sg });
                                  }}
                                  className={`py-1.5 px-2 rounded border text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 ${isQaLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer active:scale-95'
                                    } ${qaQuestionnaireAnswer === 'yes'
                                      ? 'bg-emerald-500 text-text-base border-emerald-400 shadow-md ring-1 ring-emerald-400/50'
                                      : 'bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-400 border-emerald-500/30'
                                    }`}
                                >
                                  <CheckCircle size={11} className="shrink-0" /> YES
                                </button>

                                <button
                                  type="button"
                                  disabled={isQaLocked}
                                  onClick={() => {
                                    const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                    const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    saveSubgridQa(itemKey, selectedQaFlags, 'no', true);
                                    const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                    const currentDefects = targetLog?.defects || 0;
                                    updateDefectStatusInSupabase(itemKey, currentDefects, 'Passed (No Defect)', { selectedQaFlags, answer: 'NO', filename: activePanoramaFilename, subgrid: sg });
                                  }}
                                  className={`py-1.5 px-2 rounded border text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 ${isQaLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer active:scale-95'
                                    } ${qaQuestionnaireAnswer === 'no'
                                      ? 'bg-rose-500 text-text-base border-rose-400 shadow-md ring-1 ring-rose-400/50'
                                      : 'bg-rose-600/20 hover:bg-rose-600/35 text-rose-400 border-rose-500/30'
                                    }`}
                                >
                                  <X size={11} className="shrink-0" /> NO
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
  );
}
