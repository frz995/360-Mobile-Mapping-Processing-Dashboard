import React, { useMemo, useState } from 'react';
import {
  Send,
  CheckCircle2,
  Loader2,
  UserRound,
  Terminal,
  Inbox
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import {
  saveDatasetToSupabase,
  updateProcessingJobHandoffInSupabase,
  updateProcessingJobStatusInSupabase
} from '../../../services/supabase';
import type { DatasetRecord, ProcessingJobRecord } from '../../../types/production';
import { jobStatusMeta } from '../../../utils/productionQueue';
import { validateFolderForImport } from '../../../utils/processedOutputValidation';
import { formatDateTime } from '../common';
import { EXTERNAL_STATUS_META, EXTERNAL_JOB_TYPES, isExternalJobType } from './processingCommon';

export interface HandoffPanelProps {
  jobs: ProcessingJobRecord[];
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

function stageFromJobType(jobType: string): DatasetRecord['pipeline_stage'] {
  if (jobType === 'STITCH') return 'STITCH';
  if (jobType === 'BLUR') return 'BLUR';
  return 'QAQC';
}

export const HandoffPanel: React.FC<HandoffPanelProps> = ({
  jobs,
  api,
  isGuestUser,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel,
  onOpenJobDetails
}) => {
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');

  const external = useMemo(
    () =>
      jobs
        .filter((j) => isExternalJobType(j.job_type))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [jobs]
  );

  const perType = useMemo(() => {
    const map: Record<string, ProcessingJobRecord[]> = {};
    EXTERNAL_JOB_TYPES.forEach((t) => {
      map[t] = external.filter((j) => j.job_type === t);
    });
    return map;
  }, [external]);

  const notify = (title: string, details: string) => {
    onAddNotification?.({ title, message: details, category: 'SYSTEM' as any, read: false });
    onAddAuditLog?.('EDIT', title, details, 'info');
  };

  const assign = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    const ok = await updateProcessingJobHandoffInSupabase(job.id, {
      assignedTo: (assignees[job.id] || '').trim() || job.operator || 'Operator',
      externalStatus: 'awaiting_submit',
      launchCommand: commands[job.id]?.trim() || undefined
    });
    if (!ok) setMessage('Failed to assign external job.');
    else notify(`External Assigned`, `${job.name || job.job_type} assigned to ${assignees[job.id] || job.operator || 'Operator'}.`);
    setBusyId(null);
    onRefreshJobs();
  };

  const markSubmitted = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    await updateProcessingJobStatusInSupabase(job.id, { status: 'IN_PROGRESS' });
    await updateProcessingJobHandoffInSupabase(job.id, { externalStatus: 'running_external' });
    notify(`Submitted External`, `${job.name || job.job_type} handed to ${job.assigned_to || 'operator'} for external run.`);
    setBusyId(null);
    onRefreshJobs();
  };

  const completeExternal = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    const listing = await api.listFolder(job.output_folder || '');
    const fileCount = listing?.fileCount || job.total_items || 0;
    if (!fileCount) {
      setMessage(`Output folder ${job.output_folder} appears empty — cannot complete.`);
      setBusyId(null);
      return;
    }
    const v = validateFolderForImport(listing, job.subgrid || '', { expectedCount: fileCount });
    if (v && !v.ok) {
      const proceed = window.confirm(`Output validation found issues:\n\n${v.issues.slice(0, 6).join('\n')}\n\nComplete and import anyway?`);
      if (!proceed) {
        setMessage('Import blocked — output failed validation.');
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
      size_bytes: listing?.sizeBytes || 0,
      status: 'READY',
      version: 1,
      created_by: userLabel,
      metadata: { source: 'external-handoff', job_id: job.id }
    });
    if (!dataset?.id) {
      setMessage('Failed to register the processed dataset.');
      setBusyId(null);
      return;
    }
    await updateProcessingJobStatusInSupabase(job.id, {
      status: 'IMPORTED',
      completed_at: new Date().toISOString(),
      output_dataset_id: dataset.id
    });
    await updateProcessingJobHandoffInSupabase(job.id, { externalStatus: 'done' });
    notify(`External Run Complete`, `${fileCount} frames imported as dataset ${dataset.name}.`);
    setBusyId(null);
    onRefreshJobs();
  };

  const renderJob = (job: ProcessingJobRecord) => {
    const meta = jobStatusMeta(job.status);
    const ext = EXTERNAL_STATUS_META[job.external_status || 'none'];
    const busy = busyId === job.id;
    const assigned = job.assigned_to;
    const jid = job.id || '';
    const cmd = job.launch_command || commands[jid] || '';

    return (
      <div key={job.id || job.name} className="bg-card border border-subtle rounded-xl p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap cursor-pointer" onClick={() => onOpenJobDetails?.(job)}>
          <span className="text-xs font-bold text-text-base">{job.name || job.job_type}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${meta.className}`}>{meta.label}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${ext.className}`}>{ext.label}</span>
          <span className="font-mono text-sky-300 text-[11px]">{job.subgrid || ''}</span>
        </div>
        <div className="text-[10px] text-text-muted font-mono truncate">
          {job.source_folder || '—'} → {job.output_folder || '—'} · {job.provider || 'External PC'} · {formatDateTime(job.created_at)}
        </div>

        {!assigned && !isGuestUser && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <UserRound size={13} className="text-text-muted" />
              <input value={assignees[jid] || ''} onChange={(e) => setAssignees({ ...assignees, [jid]: e.target.value })}
                placeholder="Operator (e.g. Alex / PC-2)" className={INPUT_CLASS} />
            </div>
            <div className="flex items-center gap-1.5">
              <Terminal size={13} className="text-text-muted" />
              <input value={commands[jid] || ''} onChange={(e) => setCommands({ ...commands, [jid]: e.target.value })}
                placeholder="Launch command / tool (optional)" className={INPUT_CLASS} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {isGuestUser ? (
            <span className="text-[10px] text-amber-300">read-only</span>
          ) : (
            <>
              {!assigned && (job.external_status === 'none' || !job.external_status) && (
                <button onClick={() => assign(job)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-500/15 border border-sky-500/30 hover:bg-sky-500/25 text-sky-300 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <UserRound size={12} />} Assign
                </button>
              )}
              {assigned && job.external_status === 'awaiting_submit' && (
                <button onClick={() => markSubmitted(job)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 text-amber-300 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Mark submitted
                </button>
              )}
              {assigned && job.external_status === 'running_external' && (
                <button onClick={() => completeExternal(job)} disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Complete & import output
                </button>
              )}
            </>
          )}
          {assigned && (
            <span className="text-[11px] text-text-muted">
              <span className="text-sky-300">{assigned}</span>
              {cmd && <span className="font-mono text-text-muted"> · {cmd}</span>}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <Inbox size={15} className="text-sky-400" /> External-PC handoff
        </div>
        <span className="text-[11px] text-text-muted">{external.length} external job(s)</span>
      </div>

      {message && <p className="text-[11px] text-amber-300">{message}</p>}

      {external.length === 0 ? (
        <p className="py-8 text-center text-[11px] text-text-muted bg-inner border border-subtle rounded-xl">
          No STITCH / BLUR / QAQC / REPORT / EXPORT jobs yet. Create one on the Job Board and it appears here for operator assignment.
        </p>
      ) : (
        EXTERNAL_JOB_TYPES.map((t) => {
          const list = perType[t];
          if (!list.length) return null;
          return (
            <div key={t} className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{t} ({list.length})</div>
              {list.map(renderJob)}
            </div>
          );
        })
      )}
    </div>
  );
};