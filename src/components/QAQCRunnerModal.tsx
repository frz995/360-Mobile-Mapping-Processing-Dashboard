import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  X,
  Play,
  Pause,
  StopCircle,
  ShieldCheck,
  Camera,
  Navigation,
  Database
} from 'lucide-react';
import type { QAQCWorkerState } from '../hooks/useQAQCWorker';

export interface QAQCRunnerModalProps {
  isOpen: boolean;
  workerState: QAQCWorkerState;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onClose: () => void;
}

export const QAQCRunnerModal: React.FC<QAQCRunnerModalProps> = ({
  isOpen,
  workerState,
  onPause,
  onResume,
  onAbort,
  onClose
}) => {
  if (!isOpen) return null;

  const {
    subgrid,
    pic,
    currentIndex,
    totalStations: rawTotalStations,
    currentPointId,
    currentCoords,
    currentBearing,
    currentStepDistance,
    currentThumbnail,
    liveCheckStatus,
    defectsList,
    syncedCount,
    elapsedSeconds,
    isPaused,
    isCompleted,
    isAborted
  } = workerState;

  const totalStations = rawTotalStations || 1;
  const progressPct = Math.min(100, Math.round(((currentIndex + 1) / totalStations) * 100));
  const remainingStations = Math.max(0, totalStations - (currentIndex + 1));
  const estimatedSecondsLeft = Math.ceil(remainingStations * 0.25);

  return (
    <div className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-full h-full bg-black/80 backdrop-blur-md z-[99999] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-card border border-subtle rounded-2xl w-full max-w-3xl max-h-[92vh] sm:max-h-[85vh] shadow-2xl flex flex-col overflow-hidden text-text-base animate-in zoom-in-95 duration-200">

        {/* Modal Header */}
        <div className="p-3.5 sm:p-5 bg-card border-b border-subtle flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className={`p-2 sm:p-2.5 rounded-xl border shadow-sm shrink-0 ${
              isCompleted
                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                : isAborted
                ? 'bg-rose-500/20 border-rose-500/30 text-rose-400'
                : 'bg-sky-500/20 border-sky-500/30 text-sky-400'
            }`}>
              {isCompleted ? (
                <CheckCircle size={18} />
              ) : isAborted ? (
                <AlertTriangle size={18} />
              ) : (
                <Activity size={18} className="animate-pulse" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-text-base tracking-wide truncate">
                  QA/QC Analysis Runner
                </h2>
                <span className="text-[10px] font-mono font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20 shrink-0">
                  {subgrid || 'General'}
                </span>
                <span className={`text-[9px] sm:text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${
                  isCompleted
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : isAborted
                    ? 'text-rose-400 bg-rose-500/10 border-rose-500/20'
                    : isPaused
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                    : 'text-sky-400 bg-sky-500/10 border-sky-500/20'
                }`}>
                  {isCompleted ? 'COMPLETE' : isAborted ? 'ABORTED' : isPaused ? 'PAUSED' : 'INSPECTING'}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-text-muted mt-0.5 truncate">
                Target: {totalStations} Stations • PIC: <span className="text-emerald-400 font-semibold">{pic || 'Operator'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!isCompleted && !isAborted && (
              <button
                onClick={isPaused ? onResume : onPause}
                className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-inner hover:bg-slate-700 text-xs font-semibold rounded-lg border border-subtle transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                {isPaused ? <Play size={13} className="text-emerald-400" /> : <Pause size={13} className="text-amber-400" />}
                <span className="hidden sm:inline">{isPaused ? 'Resume' : 'Pause'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
              title="Close runner dialog (keeps running in background)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-3.5 sm:p-5 space-y-3.5 sm:space-y-4 overflow-y-auto max-h-[75vh]">

          {/* 1. High-Tech Progress Bar & Metrics */}
          <div className="p-4 rounded-xl bg-inner border border-subtle space-y-2.5 shadow-inner">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-text-base font-mono">
                Station <span className="text-sky-400">{Math.min(currentIndex + 1, totalStations)}</span> of {totalStations}
              </span>
              <span className="text-sky-400 font-mono font-bold text-sm">
                {progressPct}%
              </span>
            </div>

            {/* Glowing progress track */}
            <div className="w-full h-3 bg-app rounded-full overflow-hidden border border-subtle p-0.5 relative">
              <div
                className="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-200 shadow-[0_0_12px_rgba(56,189,248,0.5)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] font-mono">
              <div className="text-text-muted">
                Elapsed: <span className="text-text-base font-semibold">{elapsedSeconds}s</span>
              </div>
              <div className="text-text-muted">
                Est. Left: <span className="text-text-base font-semibold">{isCompleted ? '0s' : `${estimatedSecondsLeft}s`}</span>
              </div>
              <div className="text-text-muted">
                Passed: <span className="text-emerald-400 font-semibold">{Math.max(0, currentIndex + 1 - defectsList.length)}</span>
              </div>
              <div className="text-text-muted">
                Defects: <span className={`font-semibold ${defectsList.length > 0 ? 'text-amber-400' : 'text-slate-300'}`}>{defectsList.length}</span>
              </div>
            </div>
          </div>

          {/* 2. Live Telemetry HUD & Current Node Card */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">

            {/* Telemetry HUD (Left side) */}
            <div className="md:col-span-7 p-4 rounded-xl bg-inner border border-subtle space-y-2.5">
              <div className="flex items-center justify-between pb-1.5 border-b border-subtle">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                  <Navigation size={13} className="text-sky-400" />
                  Live Station Telemetry
                </span>
                <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
                  Node #{currentIndex + 1}
                </span>
              </div>

              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between text-text-muted">
                  <span>Point ID:</span>
                  <span className="text-text-base font-semibold truncate max-w-[200px]" title={currentPointId}>
                    {currentPointId || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-text-muted">
                  <span>Coordinates:</span>
                  <span className="text-text-base">
                    {currentCoords.lat && currentCoords.lng
                      ? `${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}`
                      : '0.00000, 0.00000 (GPS Dropout)'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-text-muted">
                  <span>Heading / Bearing:</span>
                  <span className="text-text-base">
                    {currentBearing.toFixed(1)}°
                  </span>
                </div>
                <div className="flex items-center justify-between text-text-muted">
                  <span>Step Distance:</span>
                  <span className={`font-semibold ${currentStepDistance > 50 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {currentStepDistance > 0 ? `+${currentStepDistance.toFixed(1)} m` : 'Start Origin (0m)'}
                  </span>
                </div>
              </div>

              {/* Real-time Checks Grid */}
              <div className="pt-2 border-t border-subtle grid grid-cols-3 gap-1.5 text-[10px]">
                {/* Blur */}
                <div className="p-1.5 rounded-lg bg-card border border-subtle flex flex-col items-center text-center">
                  <span className="text-text-muted uppercase">Blur</span>
                  <span className={`font-bold mt-0.5 ${
                    liveCheckStatus.blur.status === 'flagged' ? 'text-amber-400' : liveCheckStatus.blur.status === 'passed' ? 'text-emerald-400' : 'text-text-muted'
                  }`}>
                    {liveCheckStatus.blur.status.toUpperCase()}
                  </span>
                </div>
                {/* Obstruction */}
                <div className="p-1.5 rounded-lg bg-card border border-subtle flex flex-col items-center text-center">
                  <span className="text-text-muted uppercase">Lens</span>
                  <span className={`font-bold mt-0.5 ${
                    liveCheckStatus.obstruction.status === 'flagged' ? 'text-amber-400' : liveCheckStatus.obstruction.status === 'passed' ? 'text-emerald-400' : 'text-text-muted'
                  }`}>
                    {liveCheckStatus.obstruction.status.toUpperCase()}
                  </span>
                </div>
                {/* GPS */}
                <div className="p-1.5 rounded-lg bg-card border border-subtle flex flex-col items-center text-center">
                  <span className="text-text-muted uppercase">GPS</span>
                  <span className={`font-bold mt-0.5 ${
                    liveCheckStatus.gps.status === 'flagged' ? 'text-rose-400' : liveCheckStatus.gps.status === 'passed' ? 'text-emerald-400' : 'text-text-muted'
                  }`}>
                    {liveCheckStatus.gps.status.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* Thumbnail Canvas Preview (Right side) */}
            <div className="md:col-span-5 p-3 rounded-xl bg-inner border border-subtle flex flex-col justify-between items-center text-center relative overflow-hidden">
              <div className="w-full flex items-center justify-between pb-1.5 border-b border-subtle text-[11px] font-bold text-text-muted">
                <span className="flex items-center gap-1.5">
                  <Camera size={13} className="text-sky-400" />
                  Live Frame Analysis
                </span>
                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded">
                  256x256 Offscreen
                </span>
              </div>

              <div className="w-full h-28 my-2 rounded-lg bg-app border border-subtle overflow-hidden relative flex items-center justify-center">
                {currentThumbnail ? (
                  <img
                    src={currentThumbnail}
                    alt="Active Station"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '';
                    }}
                  />
                ) : (
                  <div className="text-text-muted text-[11px] flex flex-col items-center gap-1">
                    <Camera size={20} className="text-slate-600" />
                    <span>No Preview Loaded</span>
                  </div>
                )}
                <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[9px] font-mono text-text-base">
                  Frame #{currentIndex + 1}
                </div>
              </div>

              <span className="text-[10px] text-text-muted truncate w-full font-mono">
                {currentPointId || 'Scanning equirectangular canvas...'}
              </span>
            </div>

          </div>

          {/* 3. Real-time Flagged Defects Stream */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-text-muted uppercase tracking-wider text-[11px] font-bold flex items-center gap-1.5">
                <Database size={13} className="text-amber-400" />
                Live Defect Records ({defectsList.length})
              </span>
              <span className="text-[10px] font-mono text-emerald-400">
                {syncedCount} Synced to Supabase `qa_defects`
              </span>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
              {defectsList.length === 0 ? (
                <div className="p-4 rounded-xl bg-inner/40 border border-subtle text-center text-xs text-text-muted flex flex-col items-center justify-center gap-1.5">
                  <ShieldCheck size={20} className="text-emerald-400" />
                  <span>No defects flagged so far. Subgrid telemetry and imagery within SLA benchmarks.</span>
                </div>
              ) : (
                defectsList.map((defect, idx) => (
                  <div
                    key={`${defect.point_id}-${idx}`}
                    className="p-2.5 rounded-xl bg-inner border border-amber-500/30 flex items-center justify-between text-xs font-mono animate-in fade-in slide-in-from-top-2 duration-150"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-text-base font-bold truncate block">
                          {defect.point_id}
                        </span>
                        <span className="text-[10px] text-text-muted block">
                          Frame #{defect.frame_index} • {defect.lat?.toFixed(4)}, {defect.lng?.toFixed(4)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                        {defect.defect_type}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-card border-t border-subtle flex items-center justify-between text-xs shrink-0">
          <div className="text-[11px] text-text-muted font-mono">
            {isCompleted ? (
              <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                <CheckCircle size={13} /> Batch QA/QC finished successfully
              </span>
            ) : isAborted ? (
              <span className="text-rose-400 font-semibold flex items-center gap-1.5">
                <AlertTriangle size={13} /> Execution halted by operator
              </span>
            ) : (
              <span>Inspecting station telemetry in background...</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isCompleted && !isAborted && (
              <button
                onClick={onAbort}
                className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 font-semibold rounded-xl border border-rose-500/30 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <StopCircle size={14} />
                <span>Abort / Cancel</span>
              </button>
            )}

            {(isCompleted || isAborted) && (
              <button
                onClick={onClose}
                className="px-5 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-sky-500/20 hover:shadow-sky-500/30 transition-all cursor-pointer flex items-center gap-2 active:scale-95"
              >
                <span>Close Summary</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
