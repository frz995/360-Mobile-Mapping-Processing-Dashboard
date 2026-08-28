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
  Filter,
  ExternalLink,
  Pause,
  UserRound
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
  ProcessingJobRecord,
  ProcessingJobType
} from '../../../types/production';
import {
  estimateEtaSeconds,
  formatEta,
  isJobActive,
  isJobTerminal,
  jobStatusMeta
} from '../../../utils/productionQueue';
import { formatDateTime } from '../common';
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

interface NewJobDraft {
  name: string;
  job_type: ProcessingJobType;
  source_folder: string;
  output_folder: string;
  subgrid: string;
  total_items: number;
  provider: string;
  software_version: string;
}

const EMPTY_DRAFT: NewJobDraft = {
  name: '',
  job_type: 'STITCH',
  source_folder: 'RAW',
  output_folder: 'stitchblur',
  subgrid: '',
  total_items: 500,
  provider: 'External PC',
  software_version: ''
};

const INPUT_CLASS =
  'w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted';

function typeChip(jobType: string): { label: string; cls: string } {
  const map: Record<string, string> = {
    STITCH: 'text-sky-300 border-sky-500/40 bg-sky-950/40',
    BLUR: 'text-indigo-300 border-indigo-500/40 bg-indigo-950/40',
    ENHANCE: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40',
    MASK: 'text-violet-300 border-violet-500/40 bg-violet-950/40',
    QAQC: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
    REPORT: 'text-teal-300 border-teal-500/40 bg-teal-950/40',
    EXPORT: 'text-rose-300 border-rose-500/40 bg-rose-950/40',
    AI_DETECT: 'text-slate-300 border-slate-600/40 bg-slate-500/10'
  };
  return { label: jobType, cls: map[jobType] || map.AI_DETECT };
}

function stageFromJobType(jobType: string): DatasetRecord['pipeline_stage'] {
  if (jobType === 'ENHANCE') return 'ENHANCE';
  if (jobType === 'MASK') return 'MASK';
  if (jobType === 'STITCH') return 'STITCH';
  if (jobType === 'BLUR') return 'BLUR';
  return 'QAQC';
}

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'QA', 'REVIEW', 'DONE', 'FAILED'] as const;

export const JobBoardPanel: React.FC<JobBoardPanelProps> = ({
  jobs,
  datasets,
  api,
  projectSettings,
  isGuestUser,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel,
  onOpenJobDetails
}) => {
  const [draft, setDraft] = useState<NewJobDraft>(EMPTY_DRAFT);
  const [showNewJob, setShowNewJob] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const providers = useMemo(() => {
    const list = (projectSettings?.productionProviders || []) as Array<{
      name: string;
      software: string;
      version: string;
      enabled: boolean;
    }>;
    return list.filter((p) => p.enabled !== false);
  }, [projectSettings?.productionProviders]);

  const subgrids = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => j.subgrid && set.add(j.subgrid));
    datasets.forEach((d) => d.subgrid && set.add(d.subgrid));
    return Array.from(set).sort();
  }, [jobs, datasets]);

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

  const startJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    if (isWorkerJobType(job.job_type)) {
      const res = await api.submitJob({ ...job, status: 'QUEUED', progress: 0 });
      if (res.ok) {
        notify(`Job Started`, `${job.name || job.job_type} submitted to NAS GPU Worker.`, 'SYSTEM', 'info');
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
      notify(`External Job Queued`, `${job.name || job.job_type} queued — assign an operator to submit it externally.`, 'SYSTEM', 'info');
    } else {
      await updateProcessingJobStatusInSupabase(job.id, { status: 'QUEUED', progress: 0 });
    }
    setBusyId(null);
    onRefreshJobs();
  };

  const cancelJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    if (isWorkerJobType(job.job_type)) await api.cancelJob(job.id);
    else await updateProcessingJobStatusInSupabase(job.id, { status: 'CANCELLED' });
    onAddAuditLog?.('EDIT', `Job Cancelled`, `${job.name || job.id} cancelled by ${userLabel}.`, 'warning');
    setBusyId(null);
    onRefreshJobs();
  };

  const pauseJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    await updateProcessingJobStatusInSupabase(job.id, { status: 'QUEUED' });
    onAddAuditLog?.('EDIT', `Job Paused`, `${job.name || job.id} paused by ${userLabel}.`, 'info');
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

  const deleteJob = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job?.id) return;
    setBusyId(job.id);
    await deleteProcessingJobFromSupabase(job.id);
    onAddAuditLog?.('DELETE', `Job Deleted`, `${job.name || job.id} deleted by ${userLabel}.`, 'info');
    setBusyId(null);
    onRefreshJobs();
  };

  const createJob = async () => {
    if (isGuestUser) return;
    if (!draft.subgrid.trim()) {
      setMessage({ ok: false, text: 'Subgrid is required to create a job.' });
      return;
    }
    setMessage(null);
    const external = isExternalJobType(draft.job_type);
    const job: ProcessingJobRecord = {
      job_type: draft.job_type,
      name: draft.name || `${draft.job_type} • ${draft.subgrid.trim().toUpperCase()}`,
      source_folder: draft.source_folder || undefined,
      output_folder: draft.output_folder || undefined,
      subgrid: draft.subgrid.trim().toUpperCase(),
      provider: draft.provider || (isWorkerJobType(draft.job_type) ? 'NAS GPU Worker' : external ? 'External PC' : 'Tracked'),
      software_version: draft.software_version || undefined,
      status: 'PENDING',
      progress: 0,
      completed_items: 0,
      error_count: 0,
      operator: userLabel,
      external_status: external ? ('none' as const) : ('none' as const),
      settings: { apiMode: api.mode }
    };
    const saved = await saveProcessingJobToSupabase(job);
    if (!saved?.id) {
      setMessage({ ok: false, text: 'Failed to persist the job.' });
      return;
    }
    if (isWorkerJobType(saved.job_type)) {
      const res = await api.submitJob(saved);
      if (res.ok) {
        notify(`Job Started`, `${saved.name} submitted to NAS GPU Worker.`, 'SYSTEM', 'info');
      } else {
        setMessage({ ok: false, text: res.message });
        await updateProcessingJobStatusInSupabase(saved.id, { status: 'PENDING' });
      }
    } else {
      notify(`Job Created`, `${saved.name} created (${external ? 'external handoff' : 'tracked'}).`, 'SYSTEM', 'info');
    }
    setDraft(EMPTY_DRAFT);
    setShowNewJob(false);
    onRefreshJobs();
  };

  const activeCount = useMemo(() => jobs.filter((j) => isJobActive(j.status)).length, [jobs]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <ListChecks size={15} className="text-sky-400" /> Global job board
        </div>
        <span className="text-[11px] text-text-muted font-mono">{filtered.length}/{jobs.length} jobs · {activeCount} active</span>
        <div className="flex-1" />
        {!isGuestUser && (
          <button onClick={() => setShowNewJob((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/15 border border-sky-500/30 hover:bg-sky-500/25 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
            <Plus size={13} /> New job
          </button>
        )}
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

      {showNewJob && !isGuestUser && (
        <div className="bg-inner border border-subtle rounded-xl p-4">
          <div className="text-xs font-bold text-text-base uppercase tracking-wide mb-3">Create processing job</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Job type</span>
              <select value={draft.job_type} onChange={(e) => setDraft({ ...draft, job_type: e.target.value as ProcessingJobType })} className={INPUT_CLASS}>
                {ALL_JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Subgrid *</span>
              <input list="board-subgrids" value={draft.subgrid} onChange={(e) => setDraft({ ...draft, subgrid: e.target.value })}
                placeholder="e.g. N93E70" className={INPUT_CLASS} />
              <datalist id="board-subgrids">
                {subgrids.map((s) => <option key={s} value={s} />)}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Name (optional)</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Stitch N93E70 batch 1" className={INPUT_CLASS} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Source folder</span>
              <input value={draft.source_folder} onChange={(e) => setDraft({ ...draft, source_folder: e.target.value })} className={INPUT_CLASS} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Output folder</span>
              <input value={draft.output_folder} onChange={(e) => setDraft({ ...draft, output_folder: e.target.value })} className={INPUT_CLASS} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Expected frames</span>
              <input type="number" min={1} value={draft.total_items}
                onChange={(e) => setDraft({ ...draft, total_items: parseInt(e.target.value || '0', 10) || 0 })} className={INPUT_CLASS} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Provider</span>
              {providers.length > 0 ? (
                <select value={draft.provider}
                  onChange={(e) => {
                    const p = providers.find((x) => x.name === e.target.value);
                    setDraft({ ...draft, provider: e.target.value, software_version: p?.version || draft.software_version });
                  }}
                  className={INPUT_CLASS}>
                  {providers.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}{p.version ? ` (v${p.version})` : ''}</option>
                  ))}
                </select>
              ) : (
                <input value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })} className={INPUT_CLASS} />
              )}
            </label>
          </div>
          <p className="text-[11px] text-text-muted mt-2">
            {isWorkerJobType(draft.job_type) ? 'Executed by the NAS GPU Worker (deterministic params).' :
             isExternalJobType(draft.job_type) ? 'External-PC handoff — an operator runs the tool, then submits output for validation + import.' :
             'Tracked-only job (AI_DETECT reserved — not yet implemented on the worker).'}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={createJob}
              className="flex items-center gap-1.5 px-4 py-2 bg-sky-500/15 border border-sky-500/30 hover:bg-sky-500/25 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              <Play size={13} /> Create {isWorkerJobType(draft.job_type) ? '& start' : ''}
            </button>
            <button onClick={() => setShowNewJob(false)}
              className="px-3 py-2 bg-inner border border-subtle hover:bg-rose-500/15 hover:border-rose-500/30 text-text-muted hover:text-rose-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Board table */}
      <div className="bg-inner border border-subtle rounded-xl overflow-x-auto">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-[11px] text-text-muted">No jobs match the current filters.</p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-text-muted uppercase tracking-wide text-[10px] border-b border-subtle">
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
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">P{job.priority}</span>
                        )}
                        <span className="text-text-base font-semibold">{job.name || job.job_type}</span>
                      </div>
                      <div className="text-[10px] text-text-muted font-mono">{job.id ? job.id.slice(0, 8) : ''} · <span className="font-sans">{formatDateTime(job.created_at)}</span></div>
                      {job.output_folder && <div className="text-[10px] text-text-muted font-mono truncate max-w-[220px]">→ {job.output_folder}</div>}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${meta.className}`}>{meta.label}</span>
                      {job.qa_decision && (
                        <div className="mt-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${
                            job.qa_decision === 'APPROVED' ? 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40' : 'text-rose-300 border-rose-500/40 bg-rose-950/40'
                          }`}>{job.qa_decision}</span>
                        </div>
                      )}
                      {job.error_count ? <div className="text-[10px] text-rose-300 mt-0.5">{job.error_count} error frames</div> : null}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 bg-black/40 rounded-full overflow-hidden min-w-20">
                          <div className={`h-full rounded-full ${job.status === 'FAILED' || job.status === 'REJECTED' ? 'bg-rose-400' : 'bg-sky-400'} transition-all duration-500`}
                            style={{ width: `${job.progress || 0}%` }} />
                        </div>
                        <span className="text-[10px] text-text-muted font-mono w-14">{job.progress || 0}% · {formatEta(eta)}</span>
                      </div>
                      {job.current_item && <div className="text-[10px] text-text-muted font-mono truncate max-w-[180px] mt-0.5">{job.current_item}</div>}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${type.cls}`}>{type.label}</span>
                      <div className="mt-1">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${extMeta.className}`}>{extMeta.label}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 font-mono text-sky-300">{job.subgrid || '—'}</td>
                    <td className="py-2 px-3 text-text-muted">
                      {job.assigned_to || job.operator || '—'}
                      {job.launch_command && <div className="text-[10px] font-mono text-text-muted truncate max-w-[160px]">⮞ {job.launch_command}</div>}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {isGuestUser ? (
                        <span className="text-[10px] text-amber-300">read-only</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          {!isJobActive(job.status) && job.status !== 'IMPORTED' && job.status !== 'CANCELLED' && (
                            <button onClick={() => startJob(job)} disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-emerald-500/15 hover:border-emerald-500/40 text-emerald-300 cursor-pointer disabled:opacity-40 transition-colors" title="Start / requeue">
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                            </button>
                          )}
                          {isJobActive(job.status) && (
                            <>
                              {job.status === 'IN_PROGRESS' && (
                                <button onClick={() => pauseJob(job)} disabled={busy}
                                  className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-amber-500/15 hover:border-amber-500/40 text-amber-300 cursor-pointer disabled:opacity-40 transition-colors" title="Pause">
                                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
                                </button>
                              )}
                              <button onClick={() => cancelJob(job)} disabled={busy}
                                className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-rose-500/15 hover:border-rose-500/40 text-rose-300 cursor-pointer disabled:opacity-40 transition-colors" title="Cancel">
                                {busy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                              </button>
                            </>
                          )}
                          {(job.status === 'COMPLETED') && (
                            <button onClick={() => importOutput(job)} disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-sky-500/15 hover:border-sky-500/40 text-sky-300 cursor-pointer disabled:opacity-40 transition-colors" title="Import output as dataset">
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                            </button>
                          )}
                          {isJobTerminal(job.status) && (
                            <button onClick={() => retryJob(job)} disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-amber-500/15 hover:border-amber-500/40 text-amber-300 cursor-pointer disabled:opacity-40 transition-colors" title="Retry">
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                            </button>
                          )}
                          {isJobTerminal(job.status) && (
                            <button onClick={() => deleteJob(job)} disabled={busy}
                              className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-rose-500/15 hover:border-rose-500/40 text-rose-300 cursor-pointer disabled:opacity-40 transition-colors" title="Delete record">
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
    </div>
  );
};