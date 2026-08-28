import React, { useMemo, useState } from 'react';
import {
  Plus,
  Play,
  Ban,
  RotateCcw,
  Trash2,
  Download,
  Loader2,
  ListChecks,
  ChevronRight
} from 'lucide-react';
import type { ProductionApiClient } from '../../services/productionApi';
import {
  deleteProcessingJobFromSupabase,
  saveProcessingJobToSupabase,
  updateProcessingJobStatusInSupabase,
  saveDatasetToSupabase
} from '../../services/supabase';
import type {
  DatasetRecord,
  ProcessingJobRecord,
  ProcessingJobType
} from '../../types/production';
import {
  estimateEtaSeconds,
  formatEta,
  isJobActive,
  jobStatusMeta
} from '../../utils/productionQueue';
import { JOB_TYPE_OPTIONS, formatDateTime } from './common';

export interface PipelinePanelProps {
  jobs: ProcessingJobRecord[];
  datasets: DatasetRecord[];
  api: ProductionApiClient;
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onRefreshJobs: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

interface NewJobDraft {
  name: string;
  job_type: ProcessingJobType;
  provider: string;
  software_version: string;
  source_folder: string;
  output_folder: string;
  subgrid: string;
  total_items: number;
}

const EMPTY_DRAFT: NewJobDraft = {
  name: '',
  job_type: 'ENHANCE',
  provider: 'NAS GPU Worker',
  software_version: '',
  source_folder: 'stitchblur',
  output_folder: 'cleaned',
  subgrid: '',
  total_items: 500
};

const NUMBER_INPUT_CLASS =
  'w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted';

function stageFromJobType(jobType: ProcessingJobType): DatasetRecord['pipeline_stage'] {
  switch (jobType) {
    case 'ENHANCE':
      return 'ENHANCE';
    case 'MASK':
      return 'MASK';
    case 'STITCH':
      return 'STITCH';
    case 'BLUR':
      return 'BLUR';
    default:
      return 'QAQC';
  }
}

export const PipelinePanel: React.FC<PipelinePanelProps> = ({
  jobs,
  api,
  isGuestUser,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel
}) => {
  const [draft, setDraft] = useState<NewJobDraft>(EMPTY_DRAFT);
  const [showNewJob, setShowNewJob] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const activeCount = useMemo(
    () => jobs.filter((j) => isJobActive(j.status)).length,
    [jobs]
  );

  const notify = (title: string, details: string, category: string) => {
    onAddNotification?.({ title, message: details, category: category as any, read: false });
    onAddAuditLog?.('CREATE', title, details, 'info');
  };

  const handleCreateAndStart = async () => {
    if (isGuestUser) return;
    if (!draft.subgrid.trim()) {
      setMessage({ ok: false, text: 'Subgrid is required to create a job.' });
      return;
    }
    setMessage(null);
    const job: ProcessingJobRecord = {
      job_type: draft.job_type,
      name: draft.name || `${draft.job_type} • ${draft.subgrid}`,
      source_folder: draft.source_folder || undefined,
      output_folder: draft.output_folder || undefined,
      subgrid: draft.subgrid.trim().toUpperCase(),
      provider: draft.provider,
      software_version: draft.software_version || undefined,
      total_items: draft.total_items || undefined,
      status: 'QUEUED',
      progress: 0,
      completed_items: 0,
      error_count: 0,
      operator: userLabel,
      settings: { apiMode: api.mode }
    };
    const saved = await saveProcessingJobToSupabase(job);
    if (!saved?.id) {
      setMessage({ ok: false, text: 'Failed to persist the job.' });
      return;
    }
    const res = await api.submitJob(saved);
    if (res.ok) {
      notify(`${saved.job_type} Job Started`, `${saved.name} submitted to ${api.mode === 'mock' ? 'mock' : 'NAS GPU Worker'} (${draft.subgrid || ''}).`, 'SYSTEM');
    } else {
      setMessage({ ok: false, text: res.message });
      await updateProcessingJobStatusInSupabase(saved.id, { status: 'PENDING' });
    }
    setDraft(EMPTY_DRAFT);
    setShowNewJob(false);
    onRefreshJobs();
  };

  const startJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    const res = await api.submitJob({ ...job });
    if (!res.ok) {
      setMessage({ ok: false, text: res.message });
    } else {
      setMessage({ ok: true, text: `${job.name || job.job_type} → ${res.message}` });
    }
    setBusyId(null);
    onRefreshJobs();
  };

  const cancelJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    await api.cancelJob(job.id);
    onAddAuditLog?.('EDIT', `Job Cancelled`, `${job.name || job.id} cancelled by ${userLabel}.`, 'warning');
    setBusyId(null);
    onRefreshJobs();
  };

  const retryJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    await updateProcessingJobStatusInSupabase(job.id, {
      status: 'QUEUED',
      progress: 0,
      completed_items: 0,
      error_count: 0,
      current_item: '',
      completed_at: null
    });
    const res = await api.submitJob({ ...job, status: 'QUEUED', progress: 0 });
    if (!res.ok) setMessage({ ok: false, text: res.message });
    setBusyId(null);
    onRefreshJobs();
  };

  const importOutput = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    const title = `Import Output: ${job.name || job.id}`;
    const listing = await api.listFolder(job.output_folder || '');
    const fileCount =
      listing?.fileCount || job.completed_items || job.total_items || 0;
    const sizeBytes = listing?.sizeBytes || fileCount * 1840000;

    const dataset: DatasetRecord = {
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
      parent_dataset_id: job.source_dataset_id || null,
      metadata: { origin_job_id: job.id },
      created_by: userLabel
    };
    const saved = await saveDatasetToSupabase(dataset);
    if (!saved?.id) {
      setMessage({ ok: false, text: 'Failed to register processed dataset.' });
    } else {
      await updateProcessingJobStatusInSupabase(job.id, {
        status: 'IMPORTED',
        output_dataset_id: saved.id,
        completed_at: new Date().toISOString()
      });
      notify(title, `Processed output registered as dataset "${saved.name}" (${fileCount.toLocaleString()} files).`, 'PUBLISH');
    }
    setBusyId(null);
    onRefreshJobs();
  };

  const deleteJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    if (!window.confirm(`Delete job "${job.name || job.id}"? This does not touch any NAS files.`)) return;
    await deleteProcessingJobFromSupabase(job.id);
    onAddAuditLog?.('DELETE', `Job Deleted`, `${job.name || job.id} removed by ${userLabel}.`, 'warning');
    onRefreshJobs();
  };

  const canImport = (job: ProcessingJobRecord) =>
    job.status === 'COMPLETED' && (job.completed_items || 0) > 0;

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
            <ListChecks size={20} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-base tracking-wide">Pipeline &amp; Jobs</h2>
            <span className="text-[11px] text-text-muted">
              {jobs.length} total · <span className="text-amber-300">{activeCount} active</span>
              {api.mode === 'mock' && <span className="ml-2 text-sky-400/80">● mock worker</span>}
            </span>
          </div>
        </div>
        {!isGuestUser && (
          <button
            onClick={() => setShowNewJob((s) => !s)}
            className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/35 border border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
          >
            {showNewJob ? <ChevronRight size={14} /> : <Plus size={14} />}
            {showNewJob ? 'Close Form' : 'New Job'}
          </button>
        )}
      </div>

      {message && (
        <div className={`text-[11px] px-3 py-2 rounded-lg border ${
          message.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {showNewJob && !isGuestUser && (
        <div className="bg-card border border-subtle rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 animate-in fade-in zoom-in-98 duration-150">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Job Name</label>
            <input className={NUMBER_INPUT_CLASS} placeholder="optional"
              value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Job Type</label>
            <select className={NUMBER_INPUT_CLASS} value={draft.job_type}
              onChange={(e) => setDraft({ ...draft, job_type: e.target.value as ProcessingJobType })}>
              {JOB_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Subgrid</label>
            <input className={NUMBER_INPUT_CLASS} placeholder="e.g. N93E70"
              value={draft.subgrid} onChange={(e) => setDraft({ ...draft, subgrid: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Provider</label>
            <input className={NUMBER_INPUT_CLASS} value={draft.provider}
              onChange={(e) => setDraft({ ...draft, provider: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Source Folder (NAS)</label>
            <input className={NUMBER_INPUT_CLASS} placeholder="stitchblur/N93E70"
              value={draft.source_folder} onChange={(e) => setDraft({ ...draft, source_folder: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Output Folder (NAS)</label>
            <input className={NUMBER_INPUT_CLASS} placeholder="cleaned/N93E70"
              value={draft.output_folder} onChange={(e) => setDraft({ ...draft, output_folder: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Frames</label>
            <input type="number" min={1} className={NUMBER_INPUT_CLASS} value={draft.total_items}
              onChange={(e) => setDraft({ ...draft, total_items: Number(e.target.value) || 0 })} />
          </div>
          <div className="flex items-end">
            <button onClick={handleCreateAndStart}
              className="w-full px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 active:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5">
              <Play size={13} /> Create &amp; Start
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-subtle rounded-xl overflow-hidden min-h-0">
        <div className="max-h-[620px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-subtle">
                <th className="px-3 py-2.5 font-semibold">JOB</th>
                <th className="px-3 py-2.5 font-semibold">FOLDERS</th>
                <th className="px-3 py-2.5 font-semibold">STATUS</th>
                <th className="px-3 py-2.5 font-semibold">PROGRESS</th>
                <th className="px-3 py-2.5 font-semibold">ETA</th>
                <th className="px-3 py-2.5 font-semibold">CREATED</th>
                <th className="px-3 py-2.5 font-semibold text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-text-muted">No processing jobs yet. Create one to start the pipeline.</td></tr>
              )}
              {jobs.map((job) => {
                const meta = jobStatusMeta(job.status);
                const eta = estimateEtaSeconds(job);
                const busy = busyId === job.id;
                return (
                  <tr key={job.id} className="border-b border-subtle/60 hover:bg-inner/50 transition-colors">
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-semibold text-text-base flex items-center gap-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-inner border border-subtle text-sky-300">{job.job_type}</span>
                        {job.name || job.id}
                      </div>
                      <div className="text-[10px] text-text-muted mt-0.5">
                        {job.subgrid || '—'} · {job.provider || '—'}
                        {job.software_version ? ` · v${job.software_version}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-[10px] text-text-muted font-mono">
                      <div className="truncate max-w-[160px]">in: {job.source_folder || '—'}</div>
                      <div className="truncate max-w-[160px]">out: {job.output_folder || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.className}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${job.status === 'IN_PROGRESS' ? 'animate-pulse' : ''}`} />
                        {meta.label}
                      </span>
                      {job.status === 'REVIEW_REQUIRED' && (
                        <div className="text-[10px] text-orange-300 mt-1">{job.error_count || 0} frame(s) need manual retouch</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-1.5">
                        <div className="w-28 h-1.5 bg-inner rounded-full overflow-hidden border border-subtle/60">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              job.status === 'FAILED' ? 'bg-red-400' : job.status === 'COMPLETED' ? 'bg-emerald-400' : 'bg-sky-400'
                            }`}
                            style={{ width: `${Math.min(100, job.progress || 0)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-text-muted font-mono">{job.progress || 0}%</span>
                      </div>
                      <div className="text-[10px] text-text-muted mt-0.5">
                        {job.completed_items || 0}/{job.total_items || '?'} · {job.current_item || ''}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono text-text-muted">{formatEta(eta)}</td>
                    <td className="px-3 py-2.5 align-top text-[10px] text-text-muted">{formatDateTime(job.created_at)}</td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center justify-end gap-1.5">
                        {isGuestUser ? (
                          <span className="text-[10px] text-text-muted italic">read-only</span>
                        ) : (
                          <>
                            {(job.status === 'PENDING' || job.status === 'QUEUED' || job.status === 'FAILED') && (
                              <button title="Start" onClick={() => startJob(job)}
                                className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-sky-500/20 hover:border-sky-500/40 text-sky-300 transition-colors cursor-pointer">
                                {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                              </button>
                            )}
                            {isJobActive(job.status) && (
                              <button title="Cancel" onClick={() => cancelJob(job)}
                                className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-red-500/20 hover:border-red-500/40 text-red-300 transition-colors cursor-pointer">
                                <Ban size={13} />
                              </button>
                            )}
                            {(job.status === 'FAILED' || job.status === 'CANCELLED') && (
                              <button title="Retry" onClick={() => retryJob(job)}
                                className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-amber-500/20 hover:border-amber-500/40 text-amber-300 transition-colors cursor-pointer">
                                <RotateCcw size={13} />
                              </button>
                            )}
                            {canImport(job) && (
                              <button title="Register output as PROCESSED dataset" onClick={() => importOutput(job)}
                                className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-300 text-[10px] font-bold transition-colors cursor-pointer">
                                {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Import
                              </button>
                            )}
                            <button title="Delete (metadata only)" onClick={() => deleteJob(job)}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-red-500/20 hover:border-red-500/40 text-red-400 transition-colors cursor-pointer">
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 text-[10px] text-text-muted border-t border-subtle flex flex-wrap gap-x-4 gap-y-1">
          <span>PENDING → QUEUED → IN_PROGRESS → COMPLETED → (Import) → IMPORTED → QA_PENDING → APPROVED / REJECTED</span>
          <span>· FAILED / REVIEW_REQUIRED → Retry or manual retouch</span>
          <span>· NAS files are never modified; only the output folder receives results</span>
        </div>
      </div>
    </div>
  );
};