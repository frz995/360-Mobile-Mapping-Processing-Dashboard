import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Eye, Loader2, ListChecks } from 'lucide-react';
import { PhotoSphereViewerComponent } from '../../PhotoSphereViewerComponent';
import type { ProductionApiClient } from '../../../services/productionApi';
import {
  updateProcessingJobQaInSupabase
} from '../../../services/supabase';
import type { DatasetRecord, ProcessingJobRecord } from '../../../types/production';
import { jobStatusMeta } from '../../../utils/productionQueue';
import { formatDateTime, productionNasUrlFor } from '../common';
import { isWorkerJobType } from './processingCommon';

export interface QAConsultPanelProps {
  jobs: ProcessingJobRecord[];
  datasets: DatasetRecord[];
  api: ProductionApiClient;
  projectSettings: any;
  isGuestUser?: boolean;
  onRefreshJobs: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

const INPUT_CLASS =
  'w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted';

export const QAConsultPanel: React.FC<QAConsultPanelProps> = ({
  jobs,
  datasets,
  projectSettings,
  isGuestUser,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel
}) => {
  const [selJobId, setSelJobId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const pending = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.status === 'QA_PENDING' ||
          j.status === 'REVIEW_REQUIRED' ||
          (j.status === 'COMPLETED' && !j.qa_decision)
      ),
    [jobs]
  );

  // Auto-select first pending job.
  useEffect(() => {
    if (!selJobId && pending.length > 0) setSelJobId(pending[0].id || null);
    if (selJobId && !pending.some((j) => j.id === selJobId)) {
      setSelJobId(pending[0]?.id || null);
      setNotes('');
    }
  }, [pending, selJobId]);

  const selected = pending.find((j) => j.id === selJobId) || null;
  const selDataset = selected?.subgrid
    ? datasets.find(
        (d) =>
          d.dataset_type === 'PROCESSED' &&
          d.subgrid === selected!.subgrid
      )
    : null;

  const previewUrl =
    selected && !isGuestUser
      ? productionNasUrlFor(
          projectSettings,
          selected.output_folder,
          `${selected.subgrid}-00001.jpg`
        )
      : '';

  const notify = (title: string, details: string) => {
    onAddNotification?.({ title, message: details, category: 'SYSTEM' as any, read: false });
    onAddAuditLog?.('EDIT', title, details, 'info');
  };

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    if (isGuestUser || !selected?.id || busy) return;
    setBusy(true);
    const ok = await updateProcessingJobQaInSupabase(selected.id, {
      decision,
      notes: notes.trim(),
      assignee: userLabel,
      status: decision
    });
    if (ok) {
      const superseded = pending.find((j) => j.id !== selected.id);
      setNotes('');
      notify(
        decision === 'APPROVED' ? `QA Approved` : `QA Rejected`,
        `${selected.name || selected.job_type} ${decision.toLowerCase()} by ${userLabel}${notes.trim() ? ` — ${notes.trim()}` : ''}.`
      );
      if (superseded) setSelJobId(superseded.id || null);
      else setSelJobId(null);
    }
    setBusy(false);
    onRefreshJobs();
  };

  const { stats } = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    jobs.forEach((j) => {
      if (j.qa_decision === 'APPROVED') approved += 1;
      if (j.qa_decision === 'REJECTED') rejected += 1;
    });
    return { stats: { pending: pending.length, approved, rejected } };
  }, [jobs, pending]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <ListChecks size={15} className="text-sky-400" /> QA/QC review console
        </div>
        <span className="text-[11px] text-text-muted font-mono">
          {stats.pending} pending · {stats.approved} approved · {stats.rejected} rejected
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3 items-start">
        {/* Worklist */}
        <div className="bg-inner border border-subtle rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-subtle text-[10px] uppercase tracking-wider text-text-muted font-bold">
            Awaiting decision
          </div>
          {pending.length === 0 ? (
            <p className="py-6 px-3 text-[11px] text-text-muted">
              No jobs awaiting QA. New QA_PENDING / REVIEW_REQUIRED / COMPLETED-unreviewed jobs will appear here.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {pending.map((job) => {
                const meta = jobStatusMeta(job.status);
                const active = selJobId === job.id;
                return (
                  <button key={job.id || job.name} onClick={() => { setSelJobId(job.id || null); setNotes(''); }}
                    className={`w-full text-left px-3 py-2.5 border-b border-subtle/50 transition-colors cursor-pointer flex items-start gap-2 ${
                      active ? 'bg-sky-500/10' : 'hover:bg-sky-500/5'
                    }`}>
                    <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                    <span className="min-w-0">
                      <span className="text-xs font-semibold text-text-base block truncate">{job.name || job.job_type}</span>
                      <span className="text-[10px] text-text-muted block truncate">
                        {job.job_type} · {job.subgrid || '—'} · {job.provider || '—'} · {formatDateTime(job.created_at)}
                      </span>
                      {job.error_count ? (
                        <span className="text-[10px] text-rose-300 block">{job.error_count} error frames flagged</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Review pane */}
        {selected ? (
          <div className="flex flex-col gap-3">
            <div className="bg-inner border border-subtle rounded-xl p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-text-base">{selected.name || selected.job_type}</h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${jobStatusMeta(selected.status).className}`}>
                  {selected.status}
                </span>
              </div>
              <div className="text-[11px] text-text-muted mt-1.5">
                {selected.job_type} · {selected.subgrid || '—'} · {selected.provider || '—'} · {isWorkerJobType(selected.job_type) ? 'NAS GPU Worker' : selected.provider || 'External'}
                {selected.completed_at ? ` · completed ${formatDateTime(selected.completed_at)}` : ''}
              </div>
              <div className="text-[11px] text-text-muted mt-1 font-mono">
                {selected.source_folder || '—'} → {selected.output_folder || '—'}
              </div>
              {selected.notes && <p className="text-[11px] text-text-muted mt-1">Notes: {selected.notes}</p>}
              {selDataset && (
                <p className="text-[11px] text-emerald-300 mt-1">
                  Matched dataset: {selDataset.name} ({selDataset.file_count} files registered)
                </p>
              )}
            </div>

            {previewUrl ? (
              <div className="bg-card border border-subtle rounded-xl p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold flex items-center gap-1.5 mb-2">
                  <Eye size={12} className="text-sky-400" /> 360 preview · {selected.subgrid}-00001.jpg
                </div>
                <div className="h-[360px] rounded-lg overflow-hidden border border-subtle bg-black/40">
                  <PhotoSphereViewerComponent key={`qa-${selected.id}`} panoramaUrl={previewUrl} caption={`${selected.subgrid}-00001.jpg`} />
                </div>
                <p className="text-[10px] text-text-muted font-mono break-all mt-1">{previewUrl}</p>
              </div>
            ) : (
              <p className="text-[11px] text-amber-300">
                Configure <span className="font-mono">nasServerUrl</span> in Settings to enable the 360 preview of processed output.
              </p>
            )}

            {!isGuestUser && (
              <div className="bg-inner border border-subtle rounded-xl p-4 flex flex-col gap-2">
                <span className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Decision & notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional notes for the operator (defects, retouch needed, pass criteria…)"
                  className={`${INPUT_CLASS} resize-y`} />
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => decide('APPROVED')} disabled={busy}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Approve
                  </button>
                  <button onClick={() => decide('REJECTED')} disabled={busy}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25 text-rose-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-text-muted bg-inner border border-subtle rounded-xl p-6 self-start">
            Select a job from the worklist to review and approve/reject.
          </p>
        )}
      </div>
    </div>
  );
};