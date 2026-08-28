// =====================================================================
// Production queue helpers — async status monitor + ETA + status metadata.
// Used by the Pipeline tab so jobs poll without blocking the render loop.
// =====================================================================

import type {
  ProcessingJobRecord,
  ProcessingJobStatus
} from '../types/production';

export interface JobPollOptions {
  intervalMs?: number;
  fetchJobs: () => Promise<ProcessingJobRecord[]>;
  onUpdate: (jobs: ProcessingJobRecord[]) => void;
  immediate?: boolean;
}

/** Start polling job rows; returns a cleanup function. Never blocks the UI. */
export function startJobPolling(opts: JobPollOptions): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (cancelled) return;
    try {
      const jobs = await opts.fetchJobs();
      if (!cancelled) opts.onUpdate(jobs);
    } catch {
      // keep polling; transient DB hiccups are common
    }
    if (!cancelled) {
      timer = setTimeout(tick, opts.intervalMs || 5000);
    }
  };

  if (opts.immediate !== false) {
    void tick();
  } else {
    timer = setTimeout(tick, opts.intervalMs || 5000);
  }

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

const TERMINAL_STATUSES: ProcessingJobStatus[] = ['COMPLETED', 'FAILED', 'IMPORTED', 'APPROVED', 'REJECTED', 'CANCELLED'];
const ACTIVE_STATUSES: ProcessingJobStatus[] = ['QUEUED', 'IN_PROGRESS', 'QA_PENDING', 'PENDING'];

export function isJobActive(status?: ProcessingJobStatus): boolean {
  return !!status && ACTIVE_STATUSES.includes(status);
}

export function isJobTerminal(status?: ProcessingJobStatus): boolean {
  return !!status && TERMINAL_STATUSES.includes(status);
}

/** Rough seconds remaining estimate based on recent progress velocity. */
export function estimateEtaSeconds(job: ProcessingJobRecord): number | null {
  if (!isJobActive(job.status) || !job.progress || job.progress >= 100) return null;
  const denominator = Math.max(1, job.progress);
  const created = job.created_at ? Date.now() - new Date(job.created_at).getTime() : 0;
  if (created <= 0) return null;
  const elapsedPerProgress = created / denominator;
  const remaining = 100 - job.progress;
  return Math.round(elapsedPerProgress * remaining);
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export interface JobStatusMeta {
  label: string;
  className: string;
  dot: string;
}

export function jobStatusMeta(status?: ProcessingJobStatus): JobStatusMeta {
  switch (status) {
    case 'PENDING':
      return { label: 'PENDING', className: 'bg-slate-500/15 text-slate-300 border-slate-500/40', dot: 'bg-slate-400' };
    case 'QUEUED':
      return { label: 'QUEUED', className: 'bg-sky-500/15 text-sky-300 border-sky-500/40', dot: 'bg-sky-400' };
    case 'IN_PROGRESS':
      return { label: 'IN PROGRESS', className: 'bg-amber-500/15 text-amber-300 border-amber-500/40', dot: 'bg-amber-400' };
    case 'COMPLETED':
      return { label: 'COMPLETED', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400' };
    case 'FAILED':
      return { label: 'FAILED', className: 'bg-red-500/15 text-red-300 border-red-500/40', dot: 'bg-red-400' };
    case 'IMPORTED':
      return { label: 'IMPORTED', className: 'bg-teal-500/15 text-teal-300 border-teal-500/40', dot: 'bg-teal-400' };
    case 'QA_PENDING':
      return { label: 'QA PENDING', className: 'bg-violet-500/15 text-violet-300 border-violet-500/40', dot: 'bg-violet-400' };
    case 'APPROVED':
      return { label: 'APPROVED', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400' };
    case 'REJECTED':
      return { label: 'REJECTED', className: 'bg-red-500/15 text-red-300 border-red-500/40', dot: 'bg-red-400' };
    case 'REVIEW_REQUIRED':
      return { label: 'REVIEW REQUIRED', className: 'bg-orange-500/15 text-orange-300 border-orange-500/40', dot: 'bg-orange-400' };
    case 'CANCELLED':
      return { label: 'CANCELLED', className: 'bg-slate-500/15 text-slate-400 border-slate-600/40', dot: 'bg-slate-500' };
    default:
      return { label: 'UNKNOWN', className: 'bg-slate-500/15 text-slate-300 border-slate-500/40', dot: 'bg-slate-400' };
  }
}