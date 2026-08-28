// =====================================================================
// Shared helpers for the Processing Center workspace tabs.
// =====================================================================

import type { ProcessingJobRecord } from '../../../types/production';
import { JOB_TYPE_OPTIONS } from '../common';

export const PROCESSING_TAB_LABELS: Record<string, string> = {
  board: 'processingTabBoard',
  handoff: 'processingTabHandoff',
  qa: 'processingTabQA',
  capacity: 'processingTabCapacity'
};

/** Worker-executable job types (NAS GPU Worker actually processes these). */
export const WORKER_JOB_TYPES = ['ENHANCE', 'MASK'] as const;

/** Job types handled via external-PC handoff orchestration. */
export const EXTERNAL_JOB_TYPES = ['STITCH', 'BLUR', 'QAQC', 'REPORT', 'EXPORT'] as const;

/** Reservved/tracked-only job types. */
export const TRACKED_JOB_TYPES = ['AI_DETECT'] as const;

export const ALL_JOB_TYPES = JOB_TYPE_OPTIONS;

export const EXTERNAL_STATUS_META: Record<string, { label: string; className: string }> = {
  none: { label: 'Not assigned', className: 'text-slate-300 border-slate-600/40 bg-slate-500/10' },
  awaiting_submit: { label: 'Awaiting submit', className: 'text-amber-300 border-amber-500/40 bg-amber-950/40' },
  running_external: { label: 'Running external', className: 'text-sky-300 border-sky-500/40 bg-sky-950/40' },
  done: { label: 'External done', className: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40' }
};

export function isExternalJobType(jobType?: string): boolean {
  return !!jobType && (EXTERNAL_JOB_TYPES as readonly string[]).includes(jobType);
}

export function isWorkerJobType(jobType?: string): boolean {
  return !!jobType && (WORKER_JOB_TYPES as readonly string[]).includes(jobType);
}

export function jobTypeDescription(jobType: string): string {
  const map: Record<string, string> = {
    STITCH: 'External stitcher (e.g. Luminance HDR / PTGui) → out/frames',
    BLUR: 'External blur pipeline (license plates / faces)',
    ENHANCE: 'NAS GPU Worker — deterministic brightness/contrast/sharp/sat/denoise',
    MASK: 'NAS GPU Worker — generative-fill car-roof removal (LaMa)',
    QAQC: 'QA/QC review & decision (approve / reject with notes)',
    REPORT: 'Report deliverable build (external tooling)',
    EXPORT: 'Deliverable export to NAS output folder',
    AI_DETECT: 'Reserved — not yet implemented on worker'
  };
  return map[jobType] || 'Processing job';
}

export function qaDecisionMeta(decision?: string): { label: string; className: string } | null {
  if (!decision) return null;
  if (decision === 'APPROVED')
    return { label: 'APPROVED', className: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40' };
  if (decision === 'REJECTED')
    return { label: 'REJECTED', className: 'text-rose-300 border-rose-500/40 bg-rose-950/40' };
  return null;
}

export function backlogStats(jobs: ProcessingJobRecord[]) {
  return {
    queued: jobs.filter((j) => j.status === 'QUEUED').length,
    running: jobs.filter((j) => j.status === 'IN_PROGRESS').length,
    qaPending: jobs.filter((j) => j.status === 'QA_PENDING').length,
    reviewRequired: jobs.filter((j) => j.status === 'REVIEW_REQUIRED').length,
    completedToday: jobs.filter(
      (j) => j.status === 'COMPLETED' && j.completed_at && isToday(j.completed_at)
    ).length,
    failed: jobs.filter((j) => j.status === 'FAILED').length,
    errorFrames: jobs.reduce((acc, j) => acc + (j.error_count || 0), 0)
  };
}

function isToday(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}