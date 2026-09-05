import React from 'react';
import {
  Loader2,
  Database,
  Calendar,
  ExternalLink,
  Activity,
  CheckCircle,
  Clock
} from 'lucide-react';
import type { BatchLog } from '../../types/dashboard';
import { extractSubgridName } from '../../utils/subgrid';
import {
  formatBatchIdDisplay,
  getPOICount,
  getImagesProcessedCount,
  formatDisplayDate
} from '../../utils/dashboardData';
import { formatPIC } from '../../services/supabase';
import { getItemId } from '../../utils/items';

export interface DashboardBatchTableProps {
  activeTab: 'batches' | 'daily';
  isDataLoading: boolean;
  activeBatchLogs: BatchLog[];
  dailyData: any[];
  filteredDailyData: any[];
  selectedSubgridFilter: string | null;
  toggleSubgridFilter: (subgrid: string) => void;
  dailyDataBySubgrid: Map<string, any[]>;
  setImagesListModal: (modal: any) => void;
  qaqcWorkerState: any;
  qaqcAuditRuns: Record<string, any>;
  setSelectedDefectSubgrid: (subgrid: string) => void;
  setDefectGalleryContext: (context: any) => void;
  setIsDefectsGalleryOpen: (open: boolean) => void;
  setIsQAQCRunnerModalOpen: (open: boolean) => void;
  selectedDailyRunId: string | null;
  handleSelectDailyRun: (run: any) => void;
  activeAuthUserName?: string;
  t: (key: string) => string;
}

export const DashboardBatchTable: React.FC<DashboardBatchTableProps> = ({
  activeTab,
  isDataLoading,
  activeBatchLogs,
  dailyData,
  filteredDailyData,
  selectedSubgridFilter,
  toggleSubgridFilter,
  dailyDataBySubgrid,
  setImagesListModal,
  qaqcWorkerState,
  qaqcAuditRuns,
  setSelectedDefectSubgrid,
  setDefectGalleryContext,
  setIsDefectsGalleryOpen,
  setIsQAQCRunnerModalOpen,
  selectedDailyRunId,
  handleSelectDailyRun,
  activeAuthUserName,
  t
}) => {
  return (
    <div className="flex-1 overflow-auto">
      {activeTab === 'batches' ? (
        <table className="w-full text-left text-[11px]">
          <thead className="bg-card text-text-muted sticky top-0 z-10 border-b border-subtle">
            <tr>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('batchId')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('grid')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('subgrid')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('frames')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('distance')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('images')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('defectsTable')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('pic')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">{t('status')}</th>
              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted text-right whitespace-nowrap">{t('action')}</th>
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
                          const matchingDaily = dailyDataBySubgrid.get(subFilter) || [];
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
                          const subgridDailyRuns = dailyDataBySubgrid.get(batchSubgrid) || [];
                          if (subgridDailyRuns.length > 0) {
                            let sumDefects = 0;
                            let anyDailyInspected = false;
                            subgridDailyRuns.forEach(d => {
                              const fCount = getImagesProcessedCount(d);
                              const maxDailyCap = (typeof d.poiCount === 'number' && d.poiCount > 0) ? d.poiCount : (fCount > 0 ? fCount : undefined);

                              const runId = getItemId(d);
                              const isThisDailyActive = isSpecificRunActive && qaqcWorkerState.runId === runId;
                              const dailyCached = (runId ? qaqcAuditRuns[`${batchSubgrid}_${runId}`] : undefined) || qaqcAuditRuns[`${batchSubgrid}_default`];
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
                              sumDefects += maxDailyCap !== undefined ? Math.min(runDefects, maxDailyCap) : runDefects;
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

                        const maxBatchCap = (typeof log.poiCount === 'number' && log.poiCount > 0) ? log.poiCount : (batchFrames > 0 ? batchFrames : undefined);
                        if (maxBatchCap !== undefined) {
                          dCount = Math.min(dCount, maxBatchCap);
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
              filteredDailyData.map((log, i) => {
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
                const cachedAuditObj = (runId ? qaqcAuditRuns[`${dailySubgrid}_${runId}`] : undefined) ||
                  qaqcAuditRuns[`${dailySubgrid}_default`] ||
                  Object.entries(qaqcAuditRuns).find(([k]) => k.startsWith(`${dailySubgrid}_`))?.[1];
                if (cachedAuditObj && typeof cachedAuditObj.defectCount === 'number') {
                  cachedDefects = cachedAuditObj.defectCount;
                }

                let parsedStatusDefects: number | undefined;
                if (log.qaqcStatus) {
                  const m = log.qaqcStatus.match(/(\d+)\s+Defect/i);
                  if (m) parsedStatusDefects = parseInt(m[1], 10);
                }

                const rawDailyDefects = (isThisRowUnderInspection || isThisRowCompleted)
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

                const maxDailyCap = (typeof log.poiCount === 'number' && log.poiCount > 0) ? log.poiCount : (frameCount > 0 ? frameCount : undefined);
                const defectCount = maxDailyCap !== undefined ? Math.min(rawDailyDefects, maxDailyCap) : rawDailyDefects;

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
                              ? log.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter((f: any): f is string => Boolean(f) && (extractSubgridName(f) || '').toUpperCase().trim() === subFilter)
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
                              batchFilenames: dailyPanos.map((p: any) => p.filename || p.id).filter((f: any): f is string => Boolean(f))
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
                    <td className="px-3.5 py-3.5 text-text-base font-medium whitespace-nowrap">{formatPIC(log.pic, activeAuthUserName || "Operator")}</td>
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
  );
};
