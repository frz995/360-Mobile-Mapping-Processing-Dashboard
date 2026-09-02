import React, { useMemo, useState } from 'react';
import {
  Play,
  Ban,
  RotateCcw,
  Trash2,
  Download,
  Loader2,
  ListChecks,
  Filter,
  ExternalLink,
  Pause,
  UserRound,
  AlertTriangle,
  AlertCircle,
  X
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import {
  deleteProcessingJobFromSupabase,
  saveProcessingJobToSupabase,
  updateProcessingJobStatusInSupabase,
  updateProcessingJobHandoffInSupabase,
  saveDatasetToSupabase
} from '../../../services/supabase';
import type {
  DatasetRecord,
  ProcessingJobRecord
} from '../../../types/production';
import {
  estimateEtaSeconds,
  formatEta,
  isJobActive,
  isJobTerminal,
  jobStatusMeta
} from '../../../utils/productionQueue';
import { formatDateTime } from '../common';
import { extractCanonicalSubgrid } from '../../../utils/datasetLineage';
import { validateFolderForImport } from '../../../utils/processedOutputValidation';
import {
  ALL_JOB_TYPES,
  EXTERNAL_STATUS_META,
  isExternalJobType,
  isWorkerJobType
} from './processingCommon';

export interface JobBoardPanelProps {
  jobs: ProcessingJobRecord[];
  datasets: DatasetRecord[];
  api: ProductionApiClient;
  projectSettings?: any;
  isGuestUser?: boolean;
  onRefreshJobs: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  onOpenJobDetails?: (job: ProcessingJobRecord) => void;
}

const INPUT_CLASS =
  'w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted';

function typeChip(jobType: string): { label: string; cls: string } {
  return {
    label: jobType,
    cls: 'text-zinc-300 border-zinc-700 bg-zinc-800/70 font-mono text-[10px]'
  };
}

function stageFromJobType(jobType: string): DatasetRecord['pipeline_stage'] {
  if (jobType === 'ENHANCE') return 'ENHANCE';
  if (jobType === 'MASK') return 'MASK';
  if (jobType === 'STITCH') return 'STITCH';
  if (jobType === 'BLUR') return 'BLUR';
  return 'QAQC';
}

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'QA', 'REVIEW', 'DONE', 'FAILED'] as const;

interface SafeJobAction {
  type: 'PAUSE' | 'RESUME' | 'CANCEL' | 'DELETE';
  job: ProcessingJobRecord;
}

export const JobBoardPanel: React.FC<JobBoardPanelProps> = ({
  jobs,
  api,
  isGuestUser,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel,
  onOpenJobDetails
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  // Safe Action confirmation modal state
  const [safeAction, setSafeAction] = useState<SafeJobAction | null>(null);
  const [safeActionInput, setSafeActionInput] = useState('');

  const filtered = useMemo(() => {
    let out = jobs;
    if (filterType !== 'ALL') out = out.filter((j) => j.job_type === filterType);
    if (filterStatus === 'ACTIVE') out = out.filter((j) => isJobActive(j.status));
    else if (filterStatus === 'QA') out = out.filter((j) => j.status === 'QA_PENDING');
    else if (filterStatus === 'REVIEW') out = out.filter((j) => j.status === 'REVIEW_REQUIRED');
    else if (filterStatus === 'DONE') out = out.filter((j) => isJobTerminal(j.status));
    else if (filterStatus === 'FAILED') out = out.filter((j) => j.status === 'FAILED');
    if (mineOnly) out = out.filter((j) => (j.operator || j.assigned_to) === userLabel);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((j) =>
        [j.name, j.subgrid, j.operator, j.assigned_to, j.source_folder, j.output_folder]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    return [...out].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [jobs, filterType, filterStatus, mineOnly, search, userLabel]);

  const notify = (title: string, details: string, category: string, audit: string) => {
    onAddNotification?.({ title, message: details, category: category as any, read: false });
    onAddAuditLog?.('CREATE', title, details, audit);
  };

  const handleExecuteSafeAction = async () => {
    if (!safeAction || !safeAction.job || isGuestUser) return;
    const { type, job } = safeAction;
    if (!job.id) return;
    setBusyId(job.id);

    try {
      if (type === 'PAUSE') {
        await updateProcessingJobStatusInSupabase(job.id, { status: 'QUEUED' });
        notify('Job Paused', `Paused processing for ${job.name || job.id}.`, 'SYSTEM', 'info');
        onAddAuditLog?.('EDIT', 'Job Paused', `${job.name || job.id} paused by ${userLabel}.`, 'info');
      } else if (type === 'RESUME') {
        if (isWorkerJobType(job.job_type)) {
          const res = await api.submitJob({ ...job, status: 'QUEUED', progress: 0 });
          if (res.ok) {
            notify(`Job Resumed`, `${job.name || job.job_type} resumed on NAS GPU Worker.`, 'SYSTEM', 'info');
          } else {
            setMessage({ ok: false, text: res.message });
          }
        } else if (isExternalJobType(job.job_type)) {
          await updateProcessingJobStatusInSupabase(job.id, {
            status: 'QUEUED',
            progress: 0,
            completed_items: 0,
            error_count: 0,
            current_item: ''
          });
          await updateProcessingJobHandoffInSupabase(job.id, { externalStatus: 'awaiting_submit' });
          notify(`External Job Queued`, `${job.name || job.job_type} queued — ready for operator execution.`, 'SYSTEM', 'info');
        } else {
          await updateProcessingJobStatusInSupabase(job.id, { status: 'QUEUED', progress: 0 });
          notify(`Job Resumed`, `${job.name || job.job_type} queued for execution.`, 'SYSTEM', 'info');
        }
      } else if (type === 'CANCEL') {
        if (isWorkerJobType(job.job_type)) await api.cancelJob(job.id);
        else await updateProcessingJobStatusInSupabase(job.id, { status: 'CANCELLED' });
        notify('Job Cancelled', `Cancelled execution for ${job.name || job.id}.`, 'SYSTEM', 'warning');
        onAddAuditLog?.('EDIT', 'Job Cancelled', `${job.name || job.id} cancelled by ${userLabel}.`, 'warning');
      } else if (type === 'DELETE') {
        await deleteProcessingJobFromSupabase(job.id);
        notify('Job Deleted', `Deleted job record ${job.name || job.id}.`, 'SYSTEM', 'warning');
        onAddAuditLog?.('DELETE', 'Job Deleted', `${job.name || job.id} deleted by ${userLabel}.`, 'warning');
      }
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Failed to execute action.' });
    }

    setSafeAction(null);
    setSafeActionInput('');
    setBusyId(null);
    onRefreshJobs();
  };

  const retryJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    // Traceable retry: create a NEW child job, preserving lineage.
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
      status: 'PENDING',
      progress: 0,
      completed_items: 0,
      error_count: 0,
      priority: typeof job.priority === 'number' ? job.priority : 0,
      operator: userLabel,
      retry_of: job.id,
      retry_count: (job.retry_count || 0) + 1,
      external_status: isExternalJobType(job.job_type) ? 'none' : undefined,
      settings: { ...(job.settings || {}) }
    };
    const saved = await saveProcessingJobToSupabase(child);
    if (!saved?.id) {
      setMessage({ ok: false, text: 'Failed to create a traceable retry job.' });
    } else {
      onAddAuditLog?.('CREATE', 'Job Retried (traceable)', `${child.name} created as child of ${job.id} by ${userLabel}.`, 'info');
    }
    setBusyId(null);
    onRefreshJobs();
  };

  const importOutput = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    const listing = await api.listFolder(job.output_folder || '');
    const fileCount = listing?.fileCount || job.completed_items || job.total_items || 0;
    const sizeBytes = listing?.sizeBytes || fileCount * 1840000;

    const v = validateFolderForImport(listing, job.subgrid || '', { expectedCount: fileCount });
    if (v && !v.ok) {
      const proceed = window.confirm(`Output validation found issues:\n\n${v.issues.slice(0, 6).join('\n')}\n\nImport anyway?`);
      if (!proceed) {
        setMessage({ ok: false, text: 'Import blocked — output failed validation.' });
        onAddAuditLog?.('WARN', 'Import Blocked', `${job.name || job.id} blocked by validation: ${v.issues.join('; ')}`, 'warning');
        setBusyId(null);
        return;
      }
      onAddAuditLog?.('WARN', 'Import Overridden', `${job.name || job.id} imported despite validation issues: ${v.issues.join('; ')}`, 'warning');
    }

    const dataset = await saveDatasetToSupabase({
      dataset_type: 'PROCESSED',
      pipeline_stage: stageFromJobType(job.job_type),
      name: `${job.job_type} • ${job.subgrid || ''}`.trim(),
      subgrid: job.subgrid,
      provider: job.provider,
      software_version: job.software_version,
      source_folder: job.source_folder,
      output_folder: job.output_folder,
      storage_provider: 'nas_local',
      file_count: fileCount,
      size_bytes: sizeBytes,
      status: 'READY',
      version: 1,
      created_by: userLabel,
      metadata: { source: 'processing-center-import', job_id: job.id }
    });
    if (!dataset?.id) {
      setMessage({ ok: false, text: 'Failed to register the processed dataset.' });
      setBusyId(null);
      return;
    }
    await updateProcessingJobStatusInSupabase(job.id, { status: 'IMPORTED', output_dataset_id: dataset.id });
    notify(`Import Complete`, `${fileCount} frames registered as dataset ${dataset.name}.`, 'SYSTEM', 'info');
    setBusyId(null);
    onRefreshJobs();
  };

  const activeCount = useMemo(() => jobs.filter((j) => isJobActive(j.status)).length, [jobs]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <ListChecks size={15} className="text-sky-400" /> Global job board
        </div>
        <span className="text-[11px] text-text-muted font-sans">{filtered.length}/{jobs.length} jobs · {activeCount} active</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-text-muted"><Filter size={13} /></div>
        <div className="flex items-center gap-1 bg-inner border border-subtle rounded-lg p-0.5 overflow-x-auto">
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                filterStatus === s ? 'bg-sky-500/20 text-sky-300' : 'text-text-muted hover:text-text-base'
              }`}>
              {s}
            </button>
          ))}
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={`${INPUT_CLASS} w-32`}>
          <option value="ALL">All types</option>
          {ALL_JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / subgrid / operator…"
          className={`${INPUT_CLASS} w-52`} />
        <button onClick={() => setMineOnly((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
            mineOnly
              ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
              : 'bg-inner border-subtle text-text-muted hover:text-text-base'
          }`}>
          <UserRound size={13} /> Mine
        </button>
      </div>

      {message && (
        <div className={`text-[11px] px-3 py-2 rounded-lg border ${message.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
          {message.text}
        </div>
      )}

      {/* Board table */}
      <div className="bg-inner border border-subtle rounded-xl overflow-auto max-h-[520px]">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-[11px] text-text-muted">No jobs match the current filters.</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-inner text-text-muted uppercase tracking-wide text-[10px] border-b border-subtle z-10 shadow-sm">
              <tr>
                <th className="py-2 px-3">Job</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 w-44">Progress</th>
                <th className="py-2 px-3">Type / handoff</th>
                <th className="py-2 px-3">Subgrid</th>
                <th className="py-2 px-3">Operator</th>
                <th className="py-2 px-3 text-right w-56">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => {
                const meta = jobStatusMeta(job.status);
                const type = typeChip(job.job_type);
                const extMeta = EXTERNAL_STATUS_META[job.external_status || 'none'];
                const eta = estimateEtaSeconds(job);
                const busy = busyId === job.id;
                return (
                  <tr key={job.id || job.name} className="border-b border-subtle/50 cursor-pointer" onClick={() => onOpenJobDetails?.(job)}>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        {typeof job.priority === 'number' && job.priority > 0 && (
                          <span className="text-[10px] font-sans px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">P{job.priority}</span>
                        )}
                        <span className="text-text-base font-semibold">{job.name || job.job_type}</span>
                      </div>
                      <div className="text-[10px] text-text-muted font-sans">{job.id ? job.id.slice(0, 8) : ''} · <span className="font-sans">{formatDateTime(job.created_at)}</span></div>
                      {job.source_folder && <div className="text-[10px] text-text-muted font-sans truncate max-w-[240px]">in: {job.source_folder}</div>}
                      {job.output_folder && <div className="text-[10px] text-text-muted font-sans truncate max-w-[240px]">out: {job.output_folder}</div>}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            job.status === 'COMPLETED' || job.status === 'IMPORTED'
                              ? 'bg-emerald-400'
                              : isJobActive(job.status)
                              ? 'bg-amber-400 animate-pulse'
                              : job.status === 'FAILED' || job.status === 'REJECTED'
                              ? 'bg-rose-400'
                              : 'bg-zinc-500'
                          }`}
                        />
                        <span
                          className={`font-semibold uppercase tracking-wider text-[10px] ${
                            job.status === 'COMPLETED' || job.status === 'IMPORTED'
                              ? 'text-emerald-300'
                              : isJobActive(job.status)
                              ? 'text-amber-300'
                              : job.status === 'FAILED' || job.status === 'REJECTED'
                              ? 'text-rose-300'
                              : 'text-zinc-400'
                          }`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      {job.qa_decision && (
                        <div className="text-[10px] font-mono mt-0.5 flex items-center gap-1">
                          <span className="text-zinc-500">QA:</span>
                          <span className={job.qa_decision === 'APPROVED' ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                            {job.qa_decision}
                          </span>
                        </div>
                      )}
                      {job.error_count ? <div className="text-[10px] text-rose-400 font-mono mt-0.5">{job.error_count} error frames</div> : null}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 bg-black/40 rounded-full overflow-hidden min-w-20">
                          <div className={`h-full rounded-full ${job.status === 'FAILED' || job.status === 'REJECTED' ? 'bg-rose-400' : 'bg-sky-400'} transition-all duration-500`}
                            style={{ width: `${job.progress || 0}%` }} />
                        </div>
                        <span className="text-[10px] text-text-muted font-sans w-14">{job.progress || 0}% · {formatEta(eta)}</span>
                      </div>
                      {job.current_item && <div className="text-[10px] text-text-muted font-sans truncate max-w-[180px] mt-0.5">{job.current_item}</div>}
                    </td>
                    <td className="py-2 px-3 font-mono">
                      <div className="text-[11px] font-bold text-zinc-200 uppercase tracking-wide">
                        {type.label}
                      </div>
                      {job.external_status && job.external_status !== 'none' && (
                        <div className="text-[10px] font-sans font-medium text-emerald-400/90 mt-0.5">
                          {extMeta.label}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 font-sans text-sky-300">{extractCanonicalSubgrid(job.subgrid) || '—'}</td>
                    <td className="py-2 px-3 text-text-muted">
                      {job.assigned_to || job.operator || '—'}
                      {job.launch_command && <div className="text-[10px] font-sans text-text-muted truncate max-w-[160px]">⮞ {job.launch_command}</div>}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {isGuestUser ? (
                        <span className="text-[10px] text-amber-300">read-only</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          {!isJobActive(job.status) && job.status !== 'IMPORTED' && job.status !== 'CANCELLED' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSafeAction({ type: 'RESUME', job });
                                setSafeActionInput('');
                              }}
                              disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-card hover:border-subtle/80 text-text-muted hover:text-text-base cursor-pointer disabled:opacity-40 transition-colors"
                              title="Start / resume execution"
                            >
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                            </button>
                          )}
                          {isJobActive(job.status) && (
                            <>
                              {job.status === 'IN_PROGRESS' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSafeAction({ type: 'PAUSE', job });
                                    setSafeActionInput('');
                                  }}
                                  disabled={busy}
                                  className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-card hover:border-subtle/80 text-text-muted hover:text-text-base cursor-pointer disabled:opacity-40 transition-colors"
                                  title="Safe pause"
                                >
                                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSafeAction({ type: 'CANCEL', job });
                                  setSafeActionInput('');
                                }}
                                disabled={busy}
                                className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-card hover:border-subtle/80 text-text-muted hover:text-text-base cursor-pointer disabled:opacity-40 transition-colors"
                                title="Safe cancel"
                              >
                                {busy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                              </button>
                            </>
                          )}
                          {(job.status === 'COMPLETED') && (
                            <button onClick={() => importOutput(job)} disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-card hover:border-subtle/80 text-text-muted hover:text-text-base cursor-pointer disabled:opacity-40 transition-colors" title="Import output as dataset">
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                            </button>
                          )}
                          {isJobTerminal(job.status) && (
                            <button onClick={() => retryJob(job)} disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-card hover:border-subtle/80 text-text-muted hover:text-text-base cursor-pointer disabled:opacity-40 transition-colors" title="Retry">
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                            </button>
                          )}
                          {isJobTerminal(job.status) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSafeAction({ type: 'DELETE', job });
                                setSafeActionInput('');
                              }}
                              disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-card hover:border-subtle/80 text-text-muted hover:text-text-base cursor-pointer disabled:opacity-40 transition-colors"
                              title="Safe delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                          {isExternalJobType(job.job_type) && (
                            <span title="External-PC job — manage in Handoff tab" className="text-text-muted"><ExternalLink size={12} /></span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Safe Action Confirmation Modal */}
      {safeAction && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-subtle rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col font-sans modal-slide-in">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-subtle flex items-center justify-between bg-inner/60">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-xl border ${
                    safeAction.type === 'PAUSE'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : safeAction.type === 'RESUME'
                      ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  }`}
                >
                  {safeAction.type === 'PAUSE' ? (
                    <Pause size={18} />
                  ) : safeAction.type === 'RESUME' ? (
                    <Play size={18} />
                  ) : (
                    <AlertTriangle size={18} />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-base">
                    {safeAction.type === 'PAUSE'
                      ? 'Confirm Pause Job'
                      : safeAction.type === 'RESUME'
                      ? 'Confirm Resume Job'
                      : safeAction.type === 'CANCEL'
                      ? 'Safe Cancel Job'
                      : 'Safe Delete Job'}
                  </h3>
                  <p className="text-[11px] text-text-muted">
                    {safeAction.type === 'PAUSE'
                      ? 'Temporarily halt workstation pipeline execution'
                      : safeAction.type === 'RESUME'
                      ? 'Resume and queue pipeline job for execution'
                      : safeAction.type === 'CANCEL'
                      ? 'Terminate active processing for this subgrid'
                      : 'Permanently remove job record from database'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSafeAction(null);
                  setSafeActionInput('');
                }}
                className="p-1.5 text-text-muted hover:text-text-base rounded-lg hover:bg-inner transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-3.5">
              {/* Job Summary Pill */}
              <div className="p-3 bg-inner/50 rounded-xl border border-subtle space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text-base truncate max-w-[260px]">
                    {safeAction.job.name || safeAction.job.job_type}
                  </span>
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-subtle">
                    {safeAction.job.job_type}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                  <div>
                    <span className="text-zinc-500">Subgrid:</span>{' '}
                    <span className="font-semibold text-zinc-200">
                      {extractCanonicalSubgrid(safeAction.job.subgrid) || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Operator:</span>{' '}
                    <span className="font-semibold text-zinc-200">
                      {safeAction.job.assigned_to || safeAction.job.operator || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Status:</span>{' '}
                    <span className="font-mono font-semibold text-zinc-200">
                      {safeAction.job.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Progress:</span>{' '}
                    <span className="font-mono font-semibold text-zinc-200">
                      {safeAction.job.progress || 0}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Warning Context */}
              <div
                className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed ${
                  safeAction.type === 'PAUSE'
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                    : safeAction.type === 'RESUME'
                    ? 'bg-sky-500/10 border-sky-500/20 text-sky-300'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                }`}
              >
                <AlertCircle
                  size={16}
                  className={`shrink-0 mt-0.5 ${
                    safeAction.type === 'PAUSE'
                      ? 'text-amber-400'
                      : safeAction.type === 'RESUME'
                      ? 'text-sky-400'
                      : 'text-rose-400'
                  }`}
                />
                <div>
                  {safeAction.type === 'PAUSE'
                    ? 'Pausing will hold this job in queue. Ongoing external processing on workstations will be flagged to wait until resumed.'
                    : safeAction.type === 'RESUME'
                    ? 'Resuming will queue this job and signal the assigned workstation or worker to begin/continue processing.'
                    : safeAction.type === 'CANCEL'
                    ? 'Cancelling will immediately terminate execution. You will need to retry or create a new job to process this subgrid stage again.'
                    : 'Deleting will remove this job record completely. Ensure you have backed up any relevant logs.'}
                </div>
              </div>

              {/* Typed Safety Guard for CANCEL & DELETE */}
              {(safeAction.type === 'CANCEL' || safeAction.type === 'DELETE') && (
                <div className="pt-1 space-y-1.5">
                  <label className="block text-[11px] font-semibold text-text-muted">
                    Type{' '}
                    <span className="font-mono font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                      {safeAction.type.toLowerCase()}
                    </span>{' '}
                    to confirm:
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={safeActionInput}
                    onChange={(e) => setSafeActionInput(e.target.value)}
                    placeholder={`Type '${safeAction.type.toLowerCase()}' here...`}
                    className="w-full bg-inner border border-subtle focus:border-rose-500 focus:ring-1 focus:ring-rose-500/50 rounded-xl px-3.5 py-2 text-xs font-mono text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors"
                  />
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {(() => {
              const isTypedValid =
                safeAction.type === 'PAUSE' ||
                safeAction.type === 'RESUME' ||
                safeActionInput.trim().toLowerCase() === safeAction.type.toLowerCase();

              return (
                <div className="px-5 py-3.5 border-t border-subtle flex items-center justify-end gap-2.5 bg-inner/60">
                  <button
                    type="button"
                    onClick={() => {
                      setSafeAction(null);
                      setSafeActionInput('');
                    }}
                    disabled={busyId === safeAction.job.id}
                    className="px-4 py-2 bg-inner hover:bg-card border border-subtle rounded-xl text-xs font-semibold text-text-base transition-colors cursor-pointer"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteSafeAction}
                    disabled={!isTypedValid || busyId === safeAction.job.id}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 ${
                      !isTypedValid
                        ? 'bg-zinc-800 text-zinc-500 border border-subtle cursor-not-allowed opacity-60'
                        : safeAction.type === 'PAUSE'
                        ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer shadow-amber-950/40'
                        : safeAction.type === 'RESUME'
                        ? 'bg-sky-500 hover:bg-sky-400 text-white cursor-pointer shadow-sky-950/40'
                        : 'bg-rose-500 hover:bg-rose-400 text-white cursor-pointer shadow-rose-950/40'
                    }`}
                  >
                    {busyId === safeAction.job.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : safeAction.type === 'PAUSE' ? (
                      <Pause size={13} />
                    ) : safeAction.type === 'RESUME' ? (
                      <Play size={13} />
                    ) : (
                      <AlertTriangle size={13} />
                    )}
                    <span>
                      {busyId === safeAction.job.id
                        ? 'Processing...'
                        : safeAction.type === 'PAUSE'
                        ? 'Confirm Pause'
                        : safeAction.type === 'RESUME'
                        ? 'Confirm Resume'
                        : safeAction.type === 'CANCEL'
                        ? 'Confirm Cancel'
                        : 'Confirm Delete'}
                    </span>
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};
