// =====================================================================
// Job Details Drawer — Processing Operations (Phase 1)
// Slide-over detailing a single processing job: Overview, Progress,
// Timeline, Logs, Errors and Lineage. Retry creates a NEW traceable
// child job (parent link preserved) instead of mutating in place.
// =====================================================================

import React, { useState } from 'react';
import {
  X,
  Cpu,
  Backpack,
  CalendarClock,
  ScrollText,
  AlertTriangle,
  GitBranch,
  Loader2,
  RotateCcw,
  Layers
} from 'lucide-react';
import { saveProcessingJobToSupabase, updateProcessingJobStatusInSupabase } from '../../../services/supabase';
import type { DatasetRecord, ProcessingJobRecord } from '../../../types/production';
import { isJobActive, jobStatusMeta } from '../../../utils/productionQueue';
import { formatDateTime } from '../common';

export interface JobDetailsDrawerProps {
  job: ProcessingJobRecord | null;
  datasets: DatasetRecord[];
  onClose: () => void;
  onRefreshJobs: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  translate?: (key: string) => string;
  isGuestUser?: boolean;
}

const TIMELINE = ['PENDING', 'QUEUED', 'IN_PROGRESS', 'COMPLETED', 'IMPORTED', 'QA_PENDING', 'APPROVED'] as const;

function resolveLineage(job: ProcessingJobRecord, datasets: DatasetRecord[]) {
  const source = datasets.find((d) => d.id === job.source_dataset_id);
  const output = datasets.find((d) => d.id === job.output_dataset_id);
  return { source, output };
}

export const JobDetailsDrawer: React.FC<JobDetailsDrawerProps> = ({
  job,
  datasets,
  onClose,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel,
  translate = (k) => k,
  isGuestUser
}) => {
  const [busy, setBusy] = useState(false);

  if (!job) return null;

  const meta = jobStatusMeta(job.status);
  const { source, output } = resolveLineage(job, datasets);
  const pct = Math.min(100, job.progress || 0);
  const skipped = job.skipped_items || 0;
  const failed = job.failed_items?.length ?? (job.error_count || 0);

  const timelineIndex = TIMELINE.indexOf((job.status as string) as (typeof TIMELINE)[number]);
  const activeIndex = timelineIndex === -1 ? -1 : timelineIndex;

  const retryTraceable = async () => {
    if (isGuestUser || !job.id) return;
    setBusy(true);
    try {
      const child: ProcessingJobRecord = {
        job_type: job.job_type,
        name: `${job.name || job.job_type} · retry`,
        source_dataset_id: job.source_dataset_id,
        source_folder: job.source_folder,
        output_folder: job.output_folder,
        subgrid: job.subgrid,
        provider: job.provider,
        software_version: job.software_version,
        total_items: job.total_items,
        status: 'QUEUED',
        progress: 0,
        completed_items: 0,
        error_count: 0,
        priority: typeof job.priority === 'number' ? job.priority : 0,
        operator: userLabel,
        retry_of: job.id,
        retry_count: (job.retry_count || 0) + 1,
        settings: { ...(job.settings || {}) }
      };
      const saved = await saveProcessingJobToSupabase(child);
      if (!saved?.id) {
        onAddNotification?.({ title: 'Retry Failed', message: 'Could not create a retry job.', category: 'ERROR', read: false });
      } else {
        onAddAuditLog?.('CREATE', 'Job Retried (traceable)', `${child.name} created as child of ${job.id} by ${userLabel}.`, 'info');
      }
      onRefreshJobs();
    } finally {
      setBusy(false);
    }
  };

  const isRetryable =
    job.status === 'FAILED' ||
    job.status === 'CANCELLED' ||
    job.status === 'REVIEW_REQUIRED' ||
    job.status === 'REJECTED';

  return (
    <div className="fixed inset-0 z-[900] flex justify-end">
      <div className="absolute inset-0 bg-[var(--modal-overlay)] backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-app border-l border-subtle shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
        <div className="sticky top-0 z-10 bg-app/95 backdrop-blur-md border-b border-subtle px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold flex items-center gap-1.5">
              <Cpu size={12} /> {translate('jobDetailsTitle')}
            </div>
            <div className="text-sm font-bold text-text-base truncate mt-0.5 flex items-center gap-2">
              <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-inner border border-subtle text-sky-300">{job.job_type}</span>
              {job.name || job.id}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-inner text-text-muted hover:text-text-base transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Overview */}
          <Section title={translate('jobDetailsOverview')} icon={<Layers size={13} />}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <KV k={translate('jobDetailsStatus')}>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.className}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                </span>
              </KV>
              <KV k={translate('jobDetailsWorker')}>{job.worker || job.assigned_to || '—'}</KV>
              <KV k="Subgrid">{job.subgrid || '—'}</KV>
              <KV k="Operator">{job.operator || '—'}</KV>
              <KV k="Provider">{job.provider || '—'}</KV>
              <KV k="Software">{job.software_version || '—'}</KV>
            </div>
            <div className="text-[10px] font-sans text-text-muted mt-2 space-y-0.5">
              <div className="truncate">in: {job.source_folder || '—'}</div>
              <div className="truncate">out: {job.output_folder || '—'}</div>
            </div>
          </Section>

          {/* Progress */}
          <Section title={translate('jobDetailsProgress')} icon={<Backpack size={13} />}>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2 bg-inner rounded-full overflow-hidden border border-subtle/60">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${job.status === 'FAILED' ? 'bg-red-400' : job.status === 'COMPLETED' ? 'bg-emerald-400' : 'bg-sky-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] font-sans text-text-muted">{pct}%</span>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3 text-center">
              <Stat label="Total" value={job.total_items || 0} />
              <Stat label="Processed" value={job.completed_items || 0} tone="text-emerald-300" />
              <Stat label="Failed" value={failed} tone={failed > 0 ? 'text-red-300' : undefined} />
              <Stat label="Skipped" value={skipped} tone={skipped > 0 ? 'text-amber-300' : undefined} />
            </div>
            {job.current_item && (
              <div className="text-[10px] text-text-muted mt-2 truncate">now: {job.current_item}</div>
            )}
            {(job.completed_at || job.started_at || job.created_at) && (
              <div className="text-[10px] text-text-muted mt-2">
                {job.created_at && <>created {formatDateTime(job.created_at)}</>}
                {job.started_at && <> · started {formatDateTime(job.started_at)}</>}
                {job.completed_at && <> · done {formatDateTime(job.completed_at)}</>}
              </div>
            )}
          </Section>

          {/* Timeline */}
          <Section title={translate('jobDetailsTimeline')} icon={<CalendarClock size={13} />}>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {TIMELINE.map((step, i) => {
                const done = activeIndex >= i;
                const current = i === activeIndex;
                return (
                  <div key={step} className="flex items-center gap-1 shrink-0">
                    <div className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold border ${
                      current
                        ? 'border-sky-500/50 bg-sky-500/20 text-sky-200'
                        : done
                          ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                          : 'border-subtle bg-inner text-text-muted'
                    }`}>
                      {step}
                    </div>
                    {i < TIMELINE.length - 1 && <span className="text-text-muted">→</span>}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Logs */}
          <Section title={translate('jobDetailsLogs')} icon={<ScrollText size={13} />}>
            {!job.notes && !job.error_log?.length && (
              <div className="text-[11px] text-text-muted italic">No log entries.</div>
            )}
            {job.notes && (
              <div className="text-[11px] text-text-base bg-inner border border-subtle rounded-lg p-2 mb-2 whitespace-pre-wrap">{job.notes}</div>
            )}
            {job.error_log?.map((e, i) => (
              <div key={i} className="text-[10px] font-sans text-red-300 bg-red-950/20 border border-red-500/20 rounded-lg px-2 py-1 mb-1">
                <span className="text-red-400/70">{e.at}</span> — {e.message}
              </div>
            ))}
          </Section>

          {/* Errors */}
          {failed > 0 && (
            <Section title={translate('jobDetailsErrors')} icon={<AlertTriangle size={13} />}>
              <div className="text-[11px] text-red-300 mb-2">{failed} failed item(s).</div>
              {job.failure_reason && (
                <div className="text-[10px] text-red-200 bg-red-950/20 border border-red-500/20 rounded-lg px-2 py-1 mb-2">{job.failure_reason}</div>
              )}
              {job.failed_items && job.failed_items.length > 0 && (
                <div className="max-h-24 overflow-y-auto space-y-0.5">
                  {job.failed_items.map((f, i) => (
                    <div key={i} className="text-[10px] font-sans text-red-300 truncate">{f}</div>
                  ))}
                </div>
              )}
              {job.status === 'REVIEW_REQUIRED' && (
                <div className="text-[10px] text-orange-300 mt-2">Frames need manual retouch before import.</div>
              )}
            </Section>
          )}

          {/* Lineage */}
          <Section title={translate('jobDetailsLineage')} icon={<GitBranch size={13} />}>
            <div className="flex items-center gap-2 text-[11px] flex-wrap">
              <LineageChip label="Input Dataset" name={source?.name || '—'} />
              <span className="text-text-muted">→</span>
              <LineageChip label="Job" name={job.name || job.job_type} highlight />
              <span className="text-text-muted">→</span>
              <LineageChip label="Output" name={output?.name || '—'} />
            </div>
            {job.retry_of && (
              <div className="text-[10px] text-sky-300 mt-2">
                {translate('jobDetailsRetryOf')}: {job.retry_of}
              </div>
            )}
          </Section>

          {/* Actions */}
          {!isGuestUser && (
            <div className="flex items-center gap-2 pt-1">
              {isRetryable && (
                <button
                  onClick={retryTraceable}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                  {translate('jobDetailsRetry')}
                </button>
              )}
              {isJobActive(job.status) && (
                <button
                  onClick={async () => {
                    await updateProcessingJobStatusInSupabase(job.id!, { status: 'QUEUED' });
                    onRefreshJobs();
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-inner hover:bg-sky-500/15 border border-subtle text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Pause
                </button>
              )}
              <span className="text-[10px] text-text-muted italic">Retry creates a new traceable job.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-subtle rounded-lg overflow-hidden divide-y divide-divider">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted font-bold px-3 py-2 bg-inner/40">
        {icon} {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{k}</div>
      <div className="text-text-base">{children}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="bg-inner/60 border border-subtle rounded-lg p-2">
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`text-sm font-bold ${tone || 'text-text-base'}`}>{value}</div>
    </div>
  );
}

function LineageChip({ label, name, highlight }: { label: string; name: string; highlight?: boolean }) {
  return (
    <div className={`px-2 py-1 rounded-lg border text-[10px] ${highlight ? 'border-sky-500/40 bg-sky-950/30 text-sky-200' : 'border-subtle bg-inner text-text-muted'}`}>
      <div className="text-[9px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="font-semibold max-w-[140px] truncate">{name}</div>
    </div>
  );
}
