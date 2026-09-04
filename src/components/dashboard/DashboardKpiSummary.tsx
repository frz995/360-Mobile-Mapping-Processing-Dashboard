import React from 'react';
import { Navigation, Camera, Database } from 'lucide-react';
import { Skeleton } from '../common/Skeleton';

export interface DashboardKpiSummaryProps {
  tourStep: number | null;
  t: (key: string) => string;
  isDataLoading: boolean;
  totalKm: number;
  progressPercent: number | string;
  targetKm: number;
  lastUpdateDate: string;
  totalImages: number;
  ongoingMasterlistCount: number;
  stagedDailyBatchesCount: number;
  pipelineHealthPercent: string | null;
  totalDefects: number;
}

export const DashboardKpiSummary: React.FC<DashboardKpiSummaryProps> = ({
  tourStep,
  t,
  isDataLoading,
  totalKm,
  progressPercent,
  targetKm,
  lastUpdateDate,
  totalImages,
  ongoingMasterlistCount,
  stagedDailyBatchesCount,
  pipelineHealthPercent,
  totalDefects
}) => {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0 transition-all duration-300 ${
        tourStep === 1
          ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative rounded-xl p-1 bg-sky-950/20'
          : tourStep !== null
            ? 'opacity-30 blur-[1.5px] pointer-events-none'
            : ''
      }`}
    >
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
          Total 360° Image Frames Ingested &bull; Updated {lastUpdateDate}
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
            <span className={pipelineHealthPercent ? "text-2xl font-extrabold text-emerald-400 tracking-tight" : "text-2xl font-extrabold text-text-muted tracking-tight"}>
              {pipelineHealthPercent ? `${pipelineHealthPercent}% Normal` : t('noData')}
            </span>
          )}
        </div>
        <div className="text-[10px] text-text-muted font-medium truncate">
          <span className={totalDefects > 0 ? 'text-amber-400 font-semibold' : 'text-text-muted'}>{totalDefects} Defect {totalDefects === 1 ? 'Frame' : 'Frames'} Flagged</span> &bull; Updated {lastUpdateDate}
        </div>
      </div>
    </div>
  );
};
