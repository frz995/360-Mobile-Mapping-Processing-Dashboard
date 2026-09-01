import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  Loader2
} from 'lucide-react';
import type { ProcessingJobRecord } from '../types/production';
import { fetchProcessingJobsFromSupabase } from '../services/supabase';

export interface OperationalActionCenterProps {
  batchLogs: any[];
  dailyData: any[];
  qaDefectsCount: number;
  isGuestUser?: boolean;
  onNavigate: (workspace: any, filterParams?: { tab?: 'batches' | 'daily' | 'vector' | 'datasets' | 'recovery'; search?: string }) => void;
  onGeneratePdfReport?: () => void;
  onRetryJob?: (job: ProcessingJobRecord) => void;
  onOpenQAQCWorkbench?: (subgridKey?: string) => void;
  onOpenDefectsGallery?: (subgridKey?: string) => void;
}

export const OperationalActionCenter: React.FC<OperationalActionCenterProps> = ({
  batchLogs = [],
  dailyData = [],
  qaDefectsCount = 0,
  onNavigate,
  onRetryJob,
  onOpenQAQCWorkbench,
  onOpenDefectsGallery
}) => {
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const loadJobs = async () => {
      try {
        const fetched = await fetchProcessingJobsFromSupabase();
        if (isMounted) setJobs(fetched);
      } catch {
        // Fallback silently
      } finally {
        if (isMounted) setIsLoadingJobs(false);
      }
    };
    loadJobs();
    const interval = setInterval(loadJobs, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const activeJobs = jobs.filter(
    (j) => j.status === 'IN_PROGRESS' || j.status === 'QUEUED' || j.status === 'PENDING'
  );
  const failedJobs = jobs.filter((j) => j.status === 'FAILED');

  const unpublishedCount = dailyData.filter(
    (d) => !d.publishToWebGIS || d.publishToWebGIS === 'no' || d.publishToWebGIS === 'in process'
  ).length;

  const totalDefectsInLogs = batchLogs.reduce((acc, b) => acc + (b.defects || 0), 0);
  const effectiveDefectsCount = Math.max(qaDefectsCount, totalDefectsInLogs);

  // Calculate specific subgrids that have defects (count each subgrid once — batch logs are derived
  // from daily data via reconcileBatchLogs, so the same defects must not be added twice).
  const defectBreakdown: { subgrid: string; defects: number }[] = [];
  dailyData.forEach((d) => {
    const defs = Number(d.imagesDefected || d.defectCount || 0);
    const sg = (d.subgrid || '').toUpperCase().trim();
    if (sg && defs > 0) {
      const existing = defectBreakdown.find((x) => x.subgrid === sg);
      if (existing) existing.defects += defs;
      else defectBreakdown.push({ subgrid: sg, defects: defs });
    }
  });
  const defectSubgridsFromDaily = new Set(defectBreakdown.map((x) => x.subgrid));
  batchLogs.forEach((b) => {
    const defs = Number(b.defects || 0);
    const sg = (b.subgrid || b.imageFilename || '').toUpperCase().trim();
    if (sg && defs > 0 && !defectSubgridsFromDaily.has(sg)) {
      defectBreakdown.push({ subgrid: sg, defects: defs });
    }
  });

  // Build concise attention bullet list with direct Acquisition QC Launch and defect hover breakdown
  const attentionItems: {
    label: string;
    actionText: string;
    tooltip?: string;
    hoverTitle?: string;
    unit?: string;
    subgrids?: { subgrid: string; defects: number }[];
    onClick: () => void;
  }[] = [];

  // Subgrids that are currently staging (have unpublished daily records)
  const stagedSubgridBreakdown: { subgrid: string; defects: number }[] = [];
  dailyData.forEach((d) => {
    const isStaged = !d.publishToWebGIS || d.publishToWebGIS === 'no' || d.publishToWebGIS === 'in process';
    const sg = (d.subgrid || '').toUpperCase().trim();
    if (sg && isStaged) {
      const existing = stagedSubgridBreakdown.find((x) => x.subgrid === sg);
      if (existing) existing.defects += 1;
      else stagedSubgridBreakdown.push({ subgrid: sg, defects: 1 });
    }
  });

  if (effectiveDefectsCount > 0) {
    const defectDaily = dailyData.find(
      (d) =>
        d.publishToWebGIS === 'need to recheck' ||
        d.publishToWebGIS === 'no' ||
        (d.defectCount && d.defectCount > 0) ||
        (d.imagesDefected && d.imagesDefected > 0)
    );
    const defectBatch = batchLogs.find((b) => (b.defects && b.defects > 0));
    const defectSubgrid = defectDaily?.subgrid || defectBatch?.subgrid || defectBatch?.imageFilename || '';

    const tooltipText = defectBreakdown.length > 0
      ? `Defect Subgrids:\n${defectBreakdown.map((b) => `• ${b.subgrid}: ${b.defects} defect frame(s)`).join('\n')}`
      : undefined;

    attentionItems.push({
      label: `${effectiveDefectsCount} QA issue${effectiveDefectsCount === 1 ? '' : 's'}`,
      actionText: 'Review QA',
      tooltip: tooltipText,
      subgrids: defectBreakdown,
      onClick: () => {
        if (onOpenQAQCWorkbench) {
          onOpenQAQCWorkbench(defectSubgrid);
        } else if (onOpenDefectsGallery) {
          onOpenDefectsGallery(defectSubgrid);
        } else {
          onNavigate('data', { tab: defectDaily ? 'daily' : 'batches', search: '' });
        }
      }
    });
  }

  if (failedJobs.length > 0) {
    attentionItems.push({
      label: `${failedJobs.length} failed job${failedJobs.length === 1 ? '' : 's'}`,
      actionText: 'Retry Job',
      onClick: () => {
        if (failedJobs[0] && onRetryJob) {
          onRetryJob(failedJobs[0]);
        }
        onNavigate('production');
      }
    });
  }

  if (unpublishedCount > 0) {
    const stagedTooltip = stagedSubgridBreakdown.length > 0
      ? `Staging Subgrids:\n${stagedSubgridBreakdown.map((s) => `• ${s.subgrid}: ${s.defects} staged record(s)`).join('\n')}`
      : undefined;
    attentionItems.push({
      label: `${unpublishedCount} staged subgrid${unpublishedCount === 1 ? '' : 's'}`,
      actionText: 'Publish',
      tooltip: stagedTooltip,
      hoverTitle: 'Staging Subgrids',
      unit: 'staged',
      subgrids: stagedSubgridBreakdown,
      onClick: () => onNavigate('data', { tab: 'daily', search: '' })
    });
  }

  const hasAttention = attentionItems.length > 0;

  return (
    <div className="bg-card border border-subtle rounded-xl px-3.5 py-2.5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
      {/* LEFT: ACTIVE WORK / PIPELINE STREAM */}
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="text-[11px] font-bold text-text-muted">
          Active Work:
        </span>
        {isLoadingJobs ? (
          <span className="text-text-muted flex items-center gap-1">
            <Loader2 size={11} className="animate-spin text-text-muted" /> Syncing...
          </span>
        ) : activeJobs.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-base">
              {activeJobs[0].name || activeJobs[0].job_type}
            </span>
            <span className="text-[10px] font-sans font-medium px-1.5 py-0.2 rounded bg-inner text-text-base border border-subtle">
              {activeJobs[0].progress || 0}% &bull; {activeJobs[0].provider || 'PC-01'}
            </span>
            {activeJobs.length > 1 && (
              <span className="text-[10px] text-text-muted">
                +{activeJobs.length - 1} more
              </span>
            )}
          </div>
        ) : (
          <span className="text-text-base text-xs">
            Pipeline Idle &bull; NAS Worker Ready
          </span>
        )}
      </div>

      {/* CENTER: ATTENTION REQUIRED */}
      <div className="flex-1 flex items-center gap-2 px-0 md:px-3 py-1 md:py-0 border-t md:border-t-0 md:border-l border-subtle">
        {hasAttention ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-text-muted shrink-0">
              Attention Required:
            </span>
            <div className="flex flex-wrap items-center gap-1.5 text-text-base">
              {attentionItems.map((item, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className="text-text-muted">&bull;</span>}
                  <span
                    className={`font-medium text-text-base relative group transition-colors ${item.subgrids && item.subgrids.length > 0 ? 'cursor-pointer hover:underline decoration-dotted' : ''}`}
                    title={item.tooltip}
                    onClick={item.onClick}
                  >
                    {item.label}
                    {item.subgrids && item.subgrids.length > 0 && (
                      <span className="invisible group-hover:visible absolute left-0 bottom-full mb-2 z-50 p-2.5 bg-card border border-subtle text-text-base text-xs rounded-xl shadow-2xl min-w-[200px] pointer-events-none transition-all animate-in fade-in zoom-in-95 duration-150">
                        <span className="font-bold text-[10px] uppercase tracking-wider text-text-muted block border-b border-subtle pb-1 mb-1.5">
                          {item.hoverTitle || `Defect Subgrids (${item.subgrids.length}):`}
                        </span>
                        <div className="space-y-1">
                          {item.subgrids.map((sg) => (
                            <div key={sg.subgrid} className="flex items-center justify-between gap-3 text-[11px]">
                              <span className="font-semibold text-text-base">{sg.subgrid}</span>
                              <span className="text-text-muted font-sans font-medium">{sg.defects} {item.unit || 'defect'}{sg.defects === 1 ? '' : 's'}</span>
                            </div>
                          ))}
                        </div>
                      </span>
                    )}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-text-muted text-xs">
            <span>All Systems Nominal &bull; 0 QA defects &bull; Storage optimal</span>
          </div>
        )}
      </div>

      {/* RIGHT: DIRECT ACTION SHORTCUTS */}
      <div className="flex items-center gap-2 shrink-0 border-t md:border-t-0 md:border-l border-subtle pt-1 md:pt-0 md:pl-3">
        {hasAttention ? (
          attentionItems.slice(0, 2).map((item, idx) => (
            <button
              key={idx}
              onClick={item.onClick}
              className="px-2.5 py-1 rounded-lg bg-inner hover:bg-card border border-subtle text-[11px] font-medium text-text-base transition-colors cursor-pointer flex items-center gap-1"
            >
              <span>{item.actionText}</span>
              <ArrowRight size={10} className="text-text-muted" />
            </button>
          ))
        ) : (
          <button
            onClick={() => onNavigate('production')}
            className="px-2.5 py-1 rounded-lg bg-inner hover:bg-card border border-subtle text-[11px] font-medium text-text-base transition-colors cursor-pointer flex items-center gap-1"
          >
            <span>Launch Pipeline</span>
            <ArrowRight size={10} className="text-text-muted" />
          </button>
        )}
      </div>
    </div>
  );
};
