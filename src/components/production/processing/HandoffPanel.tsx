import React, { useMemo, useState, useEffect } from 'react';
import {
  Send,
  CheckCircle2,
  Loader2,
  Monitor,
  ArrowRight,
  Copy,
  Plus,
  Layers,
  EyeOff,
  SlidersHorizontal,
  Wand2,
  Cpu,
  Zap,
  Activity,
  Terminal,
  Server,
  Play,
  Edit2,
  Trash2,
  Table,
  RefreshCw,
  X,
  Save,
  AlertTriangle
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import {
  saveDatasetToSupabase,
  saveProcessingJobToSupabase,
  updateProcessingJobHandoffInSupabase,
  updateProcessingJobStatusInSupabase,
  deleteProcessingJobFromSupabase
} from '../../../services/supabase';
import type {
  DatasetRecord,
  ProcessingJobRecord,
  ProcessingJobType,
  WorkstationStationConfig
} from '../../../types/production';
import { DEFAULT_4_WORKSTATIONS } from '../../../types/production';
import { jobStatusMeta } from '../../../utils/productionQueue';
import { extractCanonicalSubgrid } from '../../../utils/datasetLineage';

export interface HandoffPanelProps {
  jobs: ProcessingJobRecord[];
  datasets?: DatasetRecord[];
  api: ProductionApiClient;
  projectSettings?: any;
  isGuestUser?: boolean;
  onRefreshJobs: () => void;
  onRefreshDatasets?: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  onOpenJobDetails?: (job: ProcessingJobRecord) => void;
}

const STATION_JOB_TYPE_MAP: Record<string, { jobType: any; nextJobType: any; nextStageName: string }> = {
  BLUR: { jobType: 'BLUR', nextJobType: 'STITCH', nextStageName: 'PC 2 — Stitching' },
  STITCH: { jobType: 'STITCH', nextJobType: 'ENHANCE', nextStageName: 'PC 3 — Lightroom' },
  ENHANCE: { jobType: 'ENHANCE', nextJobType: 'MASK', nextStageName: 'PC 4 — Photoshop' },
  MASK: { jobType: 'MASK', nextJobType: null, nextStageName: 'Final PROCESSED Dataset' }
};

export const HandoffPanel: React.FC<HandoffPanelProps> = ({
  jobs,
  datasets = [],
  api,
  projectSettings,
  isGuestUser,
  onRefreshJobs,
  onRefreshDatasets,
  onAddNotification,
  onAddAuditLog,
  userLabel,
  onOpenJobDetails
}) => {
  const engineMode = projectSettings?.processingEngineMode || 'multi_pc_workstations';
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New Batch Dispatch Modal (4-PC Workstations)
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [dispatchStationIdx, setDispatchStationIdx] = useState(0);
  const [dispatchSubgrid, setDispatchSubgrid] = useState('');
  const [dispatchGrid, setDispatchGrid] = useState('Grid 1');
  const [dispatchDate, setDispatchDate] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  });
  const [dispatchRunId] = useState('');
  const [dispatching, setDispatching] = useState(false);

  // Active Job Edit Modal State
  const [editingJob, setEditingJob] = useState<ProcessingJobRecord | null>(null);
  const [deleteConfirmJob, setDeleteConfirmJob] = useState<ProcessingJobRecord | null>(null);
  const [advanceWarningJob, setAdvanceWarningJob] = useState<{ job: ProcessingJobRecord; fileCount: number } | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);

  const handleClearAllCards = async () => {
    setBusyId('clear_all');
    for (const j of jobs) {
      if (j.id) await deleteProcessingJobFromSupabase(j.id);
    }
    setClearAllConfirm(false);
    setBusyId(null);
    notify('Board Reset', 'All workstation cards have been cleared.');
    onRefreshJobs();
  };

  // Helper to dynamically resolve template variables against user workstation settings
  const resolveStationPath = (
    template: string,
    vars: { subgrid: string; grid?: string; date?: string; run_id?: string }
  ) => {
    let res = (template || '').trim();
    res = res.replace(/\{subgrid\}/gi, vars.subgrid || '');
    res = res.replace(/\{grid\}/gi, vars.grid || 'Grid 1');
    res = res.replace(/\{date\}/gi, vars.date || '');
    res = res.replace(/\{run_id\}/gi, vars.run_id || '');
    return res;
  };

  // Editable 4-Station Table State
  interface EditableStationRow {
    id: 'blur' | 'stitch' | 'lightroom' | 'photoshop';
    jobType: ProcessingJobType;
    name: string;
    software: string;
    operator: string;
    sourceFolder: string;
    outputFolder: string;
    totalItems: number;
  }

  const [tableRows, setTableRows] = useState<EditableStationRow[]>([]);

  const workstations: WorkstationStationConfig[] =
    (projectSettings?.workstationsConfig as WorkstationStationConfig[]) || DEFAULT_4_WORKSTATIONS;

  // Initialize/refresh table rows whenever variables or templates change
  useEffect(() => {
    const vars = {
      subgrid: dispatchSubgrid.trim() || '{subgrid}',
      grid: dispatchGrid.trim() || '{grid}',
      date: dispatchDate.trim() || '{date}',
      run_id: dispatchRunId.trim() || '{run_id}'
    };
    const dynamicCount = datasets.find((d) => d.subgrid === dispatchSubgrid.trim().toUpperCase())?.file_count || 0;
    const rows: EditableStationRow[] = workstations.map((w) => {
      const jType: ProcessingJobType =
        w.id === 'blur' ? 'BLUR' : w.id === 'stitch' ? 'STITCH' : w.id === 'lightroom' ? 'ENHANCE' : 'MASK';
      return {
        id: w.id as any,
        jobType: jType,
        name: w.name,
        software: w.software,
        operator: w.defaultOperator,
        sourceFolder: resolveStationPath(w.sourceFolderTemplate, vars),
        outputFolder: resolveStationPath(w.outputFolderTemplate, vars),
        totalItems: dynamicCount
      };
    });
    setTableRows(rows);
  }, [dispatchSubgrid, dispatchGrid, dispatchDate, dispatchRunId, datasets, showDispatchModal, workstations]);

  const updateTableRow = (idx: number, field: keyof EditableStationRow, val: any) => {
    setTableRows((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };
      return copy;
    });
  };

  const resetTableToTemplates = () => {
    const vars = {
      subgrid: dispatchSubgrid.trim() || '{subgrid}',
      grid: dispatchGrid.trim() || '{grid}',
      date: dispatchDate.trim() || '{date}',
      run_id: dispatchRunId.trim() || '{run_id}'
    };
    const dynamicCount = datasets.find((d) => d.subgrid === dispatchSubgrid.trim().toUpperCase())?.file_count || 0;
    const rows: EditableStationRow[] = workstations.map((w) => {
      const jType: ProcessingJobType =
        w.id === 'blur' ? 'BLUR' : w.id === 'stitch' ? 'STITCH' : w.id === 'lightroom' ? 'ENHANCE' : 'MASK';
      return {
        id: w.id as any,
        jobType: jType,
        name: w.name,
        software: w.software,
        operator: w.defaultOperator,
        sourceFolder: resolveStationPath(w.sourceFolderTemplate, vars),
        outputFolder: resolveStationPath(w.outputFolderTemplate, vars),
        totalItems: dynamicCount
      };
    });
    setTableRows(rows);
    notify('Reset to Templates', 'Restored table folder templates from settings.');
  };

  // GPU Worker Dispatch State
  const [gpuSubgrid, setGpuSubgrid] = useState('');
  const [gpuJobType, setGpuJobType] = useState<'ENHANCE' | 'MASK' | 'STITCH' | 'BLUR'>('ENHANCE');
  const [gpuDispatching, setGpuDispatching] = useState(false);

  const notify = (title: string, details: string) => {
    onAddNotification?.({ title, message: details, category: 'SYSTEM' as any, read: false });
    onAddAuditLog?.('EDIT', title, details, 'info');
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const markSubmitted = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);
    await updateProcessingJobStatusInSupabase(job.id, { status: 'IN_PROGRESS' });
    await updateProcessingJobHandoffInSupabase(job.id, { externalStatus: 'running_external' });
    notify(`Workstation In-Progress`, `${job.name || job.job_type} is now being processed on ${job.assigned_to || 'workstation'}.`);
    setBusyId(null);
    onRefreshJobs();
  };

  const handleDeleteJob = (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setDeleteConfirmJob(job);
  };

  const confirmDeleteJob = async () => {
    if (!deleteConfirmJob?.id) return;
    setBusyId(deleteConfirmJob.id);
    await deleteProcessingJobFromSupabase(deleteConfirmJob.id);
    notify('Job Removed', `Deleted ${deleteConfirmJob.name || deleteConfirmJob.subgrid} from board.`);
    setDeleteConfirmJob(null);
    setBusyId(null);
    onRefreshJobs();
  };

  const handleSaveEditedJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingJob?.id) return;
    setBusyId(editingJob.id);
    await saveProcessingJobToSupabase(editingJob);
    notify('Job Updated', `Updated parameters for ${editingJob.name || editingJob.subgrid}.`);
    setEditingJob(null);
    setBusyId(null);
    onRefreshJobs();
  };

  const advanceStation = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);

    const subgrid = extractCanonicalSubgrid(job.subgrid || 'N93E70') || 'N93E70';
    const currentType = job.job_type;
    const stageMeta = STATION_JOB_TYPE_MAP[currentType];

    // 1. Strict Check: Query the physical NAS output folder
    const listing = await api.listFolder(job.output_folder || '');
    const fileCount = listing?.fileCount || 0;

    // In HTTP mode with real NAS connection: If output folder is empty (not processed yet by operator), DO NOT transfer!
    if (api.mode === 'http' && fileCount === 0) {
      setAdvanceWarningJob({ job, fileCount: 0 });
      setBusyId(null);
      return;
    }

    // 2. Permanently remove previous station job from board so it never hangs around as duplicate
    await deleteProcessingJobFromSupabase(job.id);

    // 3. If this was the last station (MASK / Photoshop), register final PROCESSED dataset
    if (!stageMeta?.nextJobType) {
      await saveDatasetToSupabase({
        dataset_type: 'PROCESSED',
        pipeline_stage: 'MASK',
        name: `PROCESSED • ${subgrid}`,
        subgrid,
        provider: '4-PC Workstation Pipeline',
        software_version: 'Photoshop Nadir Inpaint',
        source_folder: job.source_folder,
        output_folder: job.output_folder,
        storage_provider: 'nas_local',
        file_count: fileCount || job.total_items || (datasets.find((d) => d.subgrid === subgrid)?.file_count) || 0,
        size_bytes: listing?.sizeBytes || 0,
        status: 'READY',
        version: 1,
        created_by: userLabel,
        metadata: { source: '4station-pipeline', final_job_id: job.id, ...(job.settings || {}) }
      });

      onRefreshDatasets?.();

      notify(
        `4-Station Pipeline Complete!`,
        `Subgrid ${subgrid} finished Station 4 (Photoshop) and is registered as final PROCESSED dataset.`
      );
    } else {
      // 4. Create next station job automatically
      const nextType = stageMeta.nextJobType;
      const nextStation = workstations.find((w) => {
        if (nextType === 'BLUR') return w.id === 'blur';
        if (nextType === 'STITCH') return w.id === 'stitch';
        if (nextType === 'ENHANCE') return w.id === 'lightroom';
        return w.id === 'photoshop'; // MASK / final
      });

      const nextInFolder = job.output_folder;
      const vars = {
        subgrid,
        grid: (job.settings as any)?.grid || 'Grid 1',
        date: (job.settings as any)?.date || '20220904',
        run_id: (job.settings as any)?.run_id || ''
      };
      const nextOutFolder = resolveStationPath(
        nextStation?.outputFolderTemplate || '/ENHANCED/{subgrid}/',
        vars
      );

      await saveProcessingJobToSupabase({
        job_type: nextType,
        name: `${nextStation?.name || nextType} • ${subgrid}`,
        subgrid,
        source_folder: nextInFolder,
        output_folder: nextOutFolder,
        provider: nextStation?.software || 'Workstation PC',
        status: 'PENDING',
        operator: nextStation?.defaultOperator || 'Operator',
        assigned_to: nextStation?.defaultOperator || 'Operator',
        external_status: 'awaiting_submit',
        total_items: fileCount || job.total_items || (datasets.find((d) => d.subgrid === subgrid)?.file_count) || 0,
        settings: { ...(job.settings || {}), ...vars }
      });

      notify(
        `Advanced to ${stageMeta.nextStageName}`,
        `Subgrid ${subgrid} moved to ${stageMeta.nextStageName}.`
      );
    }

    setBusyId(null);
    onRefreshJobs();
  };

  const handleStart4StationPipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchSubgrid.trim()) return;
    setDispatching(true);

    const sg = dispatchSubgrid.trim().toUpperCase();
    const row = tableRows[dispatchStationIdx] || tableRows[0];
    const dynamicCount = row.totalItems || (datasets.find((d) => d.subgrid === sg)?.file_count) || 0;

    await saveProcessingJobToSupabase({
      job_type: row.jobType,
      name: `${row.name} • ${sg}`,
      subgrid: sg,
      source_folder: row.sourceFolder,
      output_folder: row.outputFolder,
      provider: row.software,
      status: 'PENDING',
      operator: row.operator,
      assigned_to: row.operator,
      external_status: 'awaiting_submit',
      total_items: dynamicCount,
      settings: {
        grid: dispatchGrid,
        date: dispatchDate,
        customTable: tableRows
      } as any
    });

    notify(
      `Dispatched to ${row.name}`,
      `Subgrid ${sg} queued in ${row.name} for ${row.operator}.`
    );

    setShowDispatchModal(false);
    setDispatching(false);
    onRefreshJobs();
  };

  const handleDispatchGpuJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gpuSubgrid.trim()) return;
    setGpuDispatching(true);

    const sg = gpuSubgrid.trim().toUpperCase();
    const inFolder = `/RAW/${sg}/`;
    const outFolder = `/PROCESSED/${sg}/`;
    const dynamicCount = (datasets.find((d) => d.subgrid === sg)?.file_count) || 0;

    await saveProcessingJobToSupabase({
      job_type: gpuJobType,
      name: `GPU ${gpuJobType} • ${sg}`,
      subgrid: sg,
      source_folder: inFolder,
      output_folder: outFolder,
      provider: 'NAS GPU Worker',
      software_version: 'PyTorch CUDA / FastAPI',
      status: 'QUEUED',
      operator: userLabel,
      total_items: dynamicCount
    });

    notify(
      `GPU Job Queued`,
      `Subgrid ${sg} queued for automated GPU processing on ${projectSettings?.productionApiUrl || 'GPU Server'}.`
    );

    setGpuSubgrid('');
    setGpuDispatching(false);
    onRefreshJobs();
  };

  // Group jobs by 4-station lanes
  const laneJobs = useMemo(() => {
    return {
      blur: jobs.filter((j) => j.job_type === 'BLUR' && j.status !== 'COMPLETED'),
      stitch: jobs.filter((j) => j.job_type === 'STITCH' && j.status !== 'COMPLETED'),
      lightroom: jobs.filter((j) => j.job_type === 'ENHANCE' && j.status !== 'COMPLETED'),
      photoshop: jobs.filter((j) => j.job_type === 'MASK' && j.status !== 'COMPLETED')
    };
  }, [jobs]);

  // Active GPU Jobs
  const gpuJobs = useMemo(() => {
    return jobs.filter((j) => j.provider?.toLowerCase().includes('gpu') || j.provider?.toLowerCase().includes('worker') || j.status === 'QUEUED' || j.status === 'IN_PROGRESS');
  }, [jobs]);

  const renderWorkstationCard = (job: ProcessingJobRecord, stationConfig?: WorkstationStationConfig) => {
    const meta = jobStatusMeta(job.status);
    const busy = busyId === job.id;
    const assigned = job.assigned_to;
    const jid = job.id || '';

    return (
      <div
        key={job.id || job.name}
        className="bg-card border border-subtle rounded-xl p-3.5 flex flex-col gap-2.5 shadow-sm hover:border-sky-500/30 transition-all text-xs"
      >
        <div className="flex items-center justify-between gap-2">
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-90 min-w-0 flex-1"
            onClick={() => onOpenJobDetails?.(job)}
          >
            <span className="font-sans font-bold text-sky-300 text-xs truncate">{job.subgrid || 'SUBGRID'}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0 ${meta.className}`}>
              {job.status}
            </span>
          </div>

          {!isGuestUser && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingJob({ ...job });
                }}
                className="p-1 text-text-muted hover:text-sky-300 hover:bg-inner rounded transition-colors cursor-pointer"
                title="Edit Folder Paths & Operator"
              >
                <Edit2 size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteJob(job);
                }}
                className="p-1 text-text-muted hover:text-rose-400 hover:bg-inner rounded transition-colors cursor-pointer"
                title="Delete Job from Board"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>

        <div className="bg-inner border border-subtle rounded-lg p-2 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between text-text-muted">
            <span>Primary Tool:</span>
            <span className="font-semibold text-text-base">{job.provider || stationConfig?.software || 'Software'}</span>
          </div>
          <div className="flex items-center justify-between text-text-muted">
            <span>Operator PC:</span>
            <span className="font-semibold text-sky-300">{assigned || job.operator || 'Unassigned'}</span>
          </div>
        </div>

        {/* Folder Paths with Copy */}
        <div className="space-y-1 text-[10px] font-sans text-text-muted">
          <div className="flex items-center justify-between gap-1 bg-inner/60 p-1.5 rounded border border-subtle/60">
            <span className="truncate" title={job.source_folder}>IN: {job.source_folder}</span>
            <button
              onClick={() => copyToClipboard(job.source_folder || '', `${jid}-in`)}
              className="text-sky-400 hover:text-sky-300 shrink-0 cursor-pointer"
              title="Copy NAS Input Folder"
            >
              {copiedId === `${jid}-in` ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
            </button>
          </div>
          <div className="flex items-center justify-between gap-1 bg-inner/60 p-1.5 rounded border border-subtle/60">
            <span className="truncate" title={job.output_folder}>OUT: {job.output_folder}</span>
            <button
              onClick={() => copyToClipboard(job.output_folder || '', `${jid}-out`)}
              className="text-sky-400 hover:text-sky-300 shrink-0 cursor-pointer"
              title="Copy NAS Output Folder"
            >
              {copiedId === `${jid}-out` ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
            </button>
          </div>
        </div>

        {/* Station Action Buttons */}
        {!isGuestUser && (
          <div className="pt-2 border-t border-subtle flex flex-col gap-1.5">
            {job.external_status === 'awaiting_submit' || !job.external_status || job.external_status === 'none' ? (
              <button
                onClick={() => markSubmitted(job)}
                disabled={busy}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 rounded-lg font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                <span>Start Station Run</span>
              </button>
            ) : (
              <button
                onClick={() => advanceStation(job)}
                disabled={busy}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-lg font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowRight size={12} />}
                <span>Mark Done &amp; Advance Station</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // If in GPU Worker Mode, render the Automated GPU Server Console
  if (engineMode === 'gpu_worker') {
    return (
      <div className="flex flex-col gap-4 min-h-0 animate-fadeIn">
        {/* GPU Cluster Status Banner */}
        <div className="bg-card border border-subtle rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-inner text-text-base rounded-xl border border-subtle shrink-0">
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-text-base">Automated GPU Worker Dispatch Console</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-inner text-text-muted border border-subtle uppercase">
                  Headless Server
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                Real-time FastAPI daemon monitor, automated PyTorch batch jobs, and GPU cluster throughput
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-sans">
            <span className="p-2 bg-inner rounded-xl border border-subtle text-text-muted">
              URL: <strong className="text-text-base">{projectSettings?.productionApiUrl || 'http://127.0.0.1:8000'}</strong>
            </span>
            <span className={`px-2.5 py-2 rounded-xl border font-bold uppercase ${
              api.mode === 'mock'
                ? 'bg-inner text-text-muted border-subtle'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}>
              {api.mode === 'mock' ? '● MOCK DAEMON' : '● CONNECTED'}
            </span>
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
              <span>Compute Target</span>
              <Zap size={14} className="text-text-muted" />
            </div>
            <div className="text-base font-bold text-text-base">
              {api.mode === 'http' ? 'NAS GPU Worker' : 'Local Mock Daemon'}
            </div>
            <div className="text-[10px] text-text-muted font-sans">
              {api.mode === 'http' ? 'FastAPI · PyTorch / CUDA' : 'Simulated Browser Dispatch'}
            </div>
          </div>

          <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
              <span>Active Workload</span>
              <Activity size={14} className="text-text-muted" />
            </div>
            <div className="text-base font-bold text-text-base">
              {gpuJobs.filter((j) => j.status === 'IN_PROGRESS').length} Active / {gpuJobs.length} Tracked
            </div>
            <div className="text-[10px] text-text-muted font-sans">
              {gpuJobs.filter((j) => j.status === 'QUEUED').length} queued in admission queue
            </div>
          </div>

          <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
              <span>Worker Concurrency</span>
              <Server size={14} className="text-text-muted" />
            </div>
            <div className="text-base font-bold text-text-base">
              {projectSettings?.productionConcurrency || 1} Thread(s)
            </div>
            <div className="text-[10px] text-text-muted">Configured batch parallelism</div>
          </div>

          <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
              <span>Daemon Status</span>
              <Play size={14} className="text-text-muted" />
            </div>
            <div className="text-base font-bold text-text-base">
              {api.mode === 'http' ? 'Connected' : 'Standalone'}
            </div>
            <div className="text-[10px] text-text-muted">
              {api.mode === 'http' ? 'Live HTTP backend' : 'In-memory queue'}
            </div>
          </div>
        </div>

        {/* Quick Automated Dispatch Box */}
        {!isGuestUser && (
          <div className="bg-card border border-subtle rounded-2xl p-4 shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-text-base flex items-center gap-2">
              <Play size={14} className="text-sky-400" /> Dispatch Automated Batch to GPU Worker
            </h4>
            <form onSubmit={handleDispatchGpuJob} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                  Subgrid Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. N93E70"
                  value={gpuSubgrid}
                  onChange={(e) => setGpuSubgrid(e.target.value.toUpperCase())}
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs font-sans uppercase text-text-base outline-none focus:border-sky-500/60"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                  Job Pipeline Type
                </label>
                <select
                  value={gpuJobType}
                  onChange={(e) => setGpuJobType(e.target.value as any)}
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60"
                >
                  <option value="ENHANCE">AI Tone &amp; Clarity Enhancement</option>
                  <option value="MASK">Nadir Car Hood Generative-Fill Mask</option>
                  <option value="BLUR">YOLO Privacy Blur (Face &amp; License Plate)</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={gpuDispatching || !gpuSubgrid.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-lg transition-all shadow cursor-pointer disabled:opacity-50"
                >
                  {gpuDispatching ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  <span>Launch GPU Batch</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Live Active GPU Jobs Queue */}
        <div className="bg-card border border-subtle rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-subtle pb-2.5">
            <h4 className="text-xs font-bold text-text-base flex items-center gap-2">
              <Terminal size={14} className="text-text-muted" /> Active GPU Pipeline Queue &amp; Daemon Logs
            </h4>
            <span className="text-[11px] text-text-muted">{gpuJobs.length} active job(s)</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {gpuJobs.map((j) => {
              const meta = jobStatusMeta(j.status);
              const progressPct = j.total_items ? Math.round(((j.completed_items || 0) / j.total_items) * 100) : 0;

              return (
                <div
                  key={j.id || j.name}
                  className="bg-inner border border-subtle rounded-xl p-3.5 flex flex-col gap-2 hover:border-subtle/80 transition-all text-xs cursor-pointer"
                  onClick={() => onOpenJobDetails?.(j)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-sans font-bold text-sky-300">{j.subgrid || 'SUBGRID'}</span>
                      <span className="text-text-base font-semibold">{j.name || j.job_type}</span>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${meta.className}`}>
                      {j.status}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-text-muted font-sans">
                      <span>Frames: {j.completed_items || 0} / {j.total_items || (datasets.find((d) => d.subgrid === j.subgrid)?.file_count) || j.completed_items || 0}</span>
                      <span className="text-text-muted">{progressPct}%</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-sky-400 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-sans text-text-muted pt-1">
                    <span className="truncate">IN: {j.source_folder || '/RAW/'} → OUT: {j.output_folder || '/PROCESSED/'}</span>
                    <span className="shrink-0 text-text-muted">{j.provider || 'GPU Worker'}</span>
                  </div>
                </div>
              );
            })}

            {gpuJobs.length === 0 && (
              <div className="p-8 text-center text-text-muted text-xs border border-dashed border-subtle rounded-xl">
                No active GPU jobs running. Submit a batch above to start automated processing.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Otherwise (4-Station Multi-PC Workstations Mode):
  return (
    <div className="flex flex-col gap-4">
      {/* Top Bar with Mode Toggle and Dispatch Action */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-card border border-subtle rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-sky-500/20 text-sky-400 rounded-lg border border-sky-500/30">
            <Monitor size={18} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-text-base">4-Station Workstation Handoff Board</h3>
            <p className="text-[11px] text-text-muted">
              Track subgrids moving sequentially across Blurring, Stitching, Lightroom, and Photoshop stations
            </p>
          </div>
        </div>

        {!isGuestUser && (
          <div className="flex items-center gap-2">
            {jobs.length > 0 && (
              <button
                onClick={() => setClearAllConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle text-text-muted hover:text-rose-400 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                title="Clear all cards from the workstation board"
              >
                <Trash2 size={13} />
                <span>Reset Board</span>
              </button>
            )}
            <button
              onClick={() => setShowDispatchModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-500 text-slate-950 text-xs font-bold rounded-xl hover:bg-sky-400 transition-all shadow cursor-pointer"
            >
              <Plus size={13} /> Dispatch Subgrid to 4-PC Flow
            </button>
          </div>
        )}
      </div>

      {/* 4-Lane Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Lane 1: Privacy Blur PC */}
        <div className="bg-inner border border-subtle rounded-xl p-3 flex flex-col gap-3 min-h-[400px]">
          <div className="flex items-center justify-between border-b border-subtle pb-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-card text-text-muted border border-subtle flex items-center justify-center text-[10px] font-bold">1</span>
              <div className="flex items-center gap-1.5 text-text-muted">
                <EyeOff size={13} />
                <h4 className="text-xs font-bold text-text-base">Privacy Blur PC</h4>
              </div>
            </div>
            <span className="text-[10px] font-sans font-bold text-text-muted">
              {laneJobs.blur.length}
            </span>
          </div>
          <p className="text-[10px] text-text-muted italic">Face &amp; Plate Blur</p>
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto">
            {laneJobs.blur.map((j) => renderWorkstationCard(j, workstations[0]))}
            {laneJobs.blur.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center p-6 text-[11px] text-text-muted border border-dashed border-subtle rounded-lg">
                No batches currently in Privacy Blur
              </div>
            )}
          </div>
        </div>

        {/* Lane 2: Stitching PC */}
        <div className="bg-inner border border-subtle rounded-xl p-3 flex flex-col gap-3 min-h-[400px]">
          <div className="flex items-center justify-between border-b border-subtle pb-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-card text-text-muted border border-subtle flex items-center justify-center text-[10px] font-bold">2</span>
              <div className="flex items-center gap-1.5 text-text-muted">
                <Layers size={13} />
                <h4 className="text-xs font-bold text-text-base">Stitching PC</h4>
              </div>
            </div>
            <span className="text-[10px] font-sans font-bold text-text-muted">
              {laneJobs.stitch.length}
            </span>
          </div>
          <p className="text-[10px] text-text-muted italic">Creator 6 / PTGui / Insta360 Stitcher</p>
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto">
            {laneJobs.stitch.map((j) => renderWorkstationCard(j, workstations[1]))}
            {laneJobs.stitch.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center p-6 text-[11px] text-text-muted border border-dashed border-subtle rounded-lg">
                No batches currently in Stitching
              </div>
            )}
          </div>
        </div>

        {/* Lane 3: Lightroom PC */}
        <div className="bg-inner border border-subtle rounded-xl p-3 flex flex-col gap-3 min-h-[400px]">
          <div className="flex items-center justify-between border-b border-subtle pb-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-card text-text-muted border border-subtle flex items-center justify-center text-[10px] font-bold">3</span>
              <div className="flex items-center gap-1.5 text-text-muted">
                <SlidersHorizontal size={13} />
                <h4 className="text-xs font-bold text-text-base">Lightroom PC</h4>
              </div>
            </div>
            <span className="text-[10px] font-sans font-bold text-text-muted">
              {laneJobs.lightroom.length}
            </span>
          </div>
          <p className="text-[10px] text-text-muted italic">Adobe Lightroom Classic Presets</p>
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto">
            {laneJobs.lightroom.map((j) => renderWorkstationCard(j, workstations[2]))}
            {laneJobs.lightroom.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center p-6 text-[11px] text-text-muted border border-dashed border-subtle rounded-lg">
                No batches currently in Lightroom
              </div>
            )}
          </div>
        </div>

        {/* Lane 4: Photoshop PC */}
        <div className="bg-inner border border-subtle rounded-xl p-3 flex flex-col gap-3 min-h-[400px]">
          <div className="flex items-center justify-between border-b border-subtle pb-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-card text-text-muted border border-subtle flex items-center justify-center text-[10px] font-bold">4</span>
              <div className="flex items-center gap-1.5 text-text-muted">
                <Wand2 size={13} />
                <h4 className="text-xs font-bold text-text-base">Photoshop PC</h4>
              </div>
            </div>
            <span className="text-[10px] font-sans font-bold text-text-muted">
              {laneJobs.photoshop.length}
            </span>
          </div>
          <p className="text-[10px] text-text-muted italic">Nadir Car Hood Mask &amp; Inpaint</p>
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto">
            {laneJobs.photoshop.map((j) => renderWorkstationCard(j, workstations[3]))}
            {laneJobs.photoshop.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center p-6 text-[11px] text-text-muted border border-dashed border-subtle rounded-lg">
                No batches currently in Photoshop
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full 4-Station Route Data Table Dispatch Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-subtle px-6 py-4 bg-card/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-sky-500/20 text-sky-400 rounded-lg border border-sky-500/30">
                  <Table size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-base">Dispatch Subgrid • 4-Station Pipeline Table</h3>
                  <p className="text-[11px] text-text-muted">
                    Review and edit the exact folder paths and assigned operators for each station before dispatching
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDispatchModal(false)}
                className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleStart4StationPipeline} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Batch Global Parameters */}
              <div className="p-5 border-b border-subtle bg-inner/30 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                    Subgrid Code *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. N93E70"
                    value={dispatchSubgrid}
                    onChange={(e) => setDispatchSubgrid(e.target.value.toUpperCase())}
                    className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-text-base font-sans font-bold uppercase focus:outline-none focus:border-sky-500/60"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                    Grid Region
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Grid 1"
                    value={dispatchGrid}
                    onChange={(e) => setDispatchGrid(e.target.value)}
                    className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-text-base font-sans focus:outline-none focus:border-sky-500/60"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                    Survey Date (YYYYMMDD)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 20220904"
                    value={dispatchDate}
                    onChange={(e) => setDispatchDate(e.target.value)}
                    className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-text-base font-sans focus:outline-none focus:border-sky-500/60"
                  />
                </div>
              </div>

              {/* Editable 4-Station Route Data Table */}
              <div className="flex-1 overflow-auto p-5 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                    Pipeline Routing &amp; Station Configuration Table
                  </span>
                  <button
                    type="button"
                    onClick={resetTableToTemplates}
                    className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                  >
                    <RefreshCw size={11} /> Reset to Defaults
                  </button>
                </div>

                <div className="border border-subtle rounded-xl overflow-hidden bg-inner/40">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-subtle bg-card/80 text-[10px] uppercase tracking-wider text-text-muted font-bold">
                        <th className="py-2.5 px-3 w-12 text-center">Start</th>
                        <th className="py-2.5 px-3 w-44">Station &amp; Tool</th>
                        <th className="py-2.5 px-3 w-36">Operator PC</th>
                        <th className="py-2.5 px-3">Input Folder Path (Source)</th>
                        <th className="py-2.5 px-3">Output Folder Path (Destination)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle/50 text-[11px]">
                      {tableRows.map((row, idx) => {
                        const isSelectedStart = dispatchStationIdx === idx;
                        return (
                          <tr
                            key={row.id}
                            className={`transition-colors ${
                              isSelectedStart ? 'bg-sky-500/10' : 'hover:bg-inner/80'
                            }`}
                          >
                            <td className="py-3 px-3 text-center">
                              <input
                                type="radio"
                                name="startStation"
                                checked={isSelectedStart}
                                onChange={() => setDispatchStationIdx(idx)}
                                className="accent-sky-500 cursor-pointer w-4 h-4"
                                title={`Start pipeline at ${row.name}`}
                              />
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-bold text-text-base mb-1">{row.name}</div>
                              <input
                                type="text"
                                value={row.software}
                                onChange={(e) => updateTableRow(idx, 'software', e.target.value)}
                                className="w-full bg-inner border border-subtle rounded px-2 py-1 text-[11px] text-text-muted focus:text-text-base focus:border-sky-500/60"
                                placeholder="Software tool"
                              />
                            </td>
                            <td className="py-3 px-3">
                              <input
                                type="text"
                                value={row.operator}
                                onChange={(e) => updateTableRow(idx, 'operator', e.target.value)}
                                className="w-full bg-inner border border-subtle rounded px-2 py-1 text-[11px] text-sky-300 font-semibold focus:border-sky-500/60"
                                placeholder="Operator name"
                              />
                            </td>
                            <td className="py-3 px-3">
                              <input
                                type="text"
                                value={row.sourceFolder}
                                onChange={(e) => updateTableRow(idx, 'sourceFolder', e.target.value)}
                                className="w-full bg-inner border border-subtle rounded px-2.5 py-1.5 text-[11px] font-sans text-sky-300 focus:text-text-base focus:border-sky-500/60"
                                placeholder="Source input folder"
                              />
                            </td>
                            <td className="py-3 px-3">
                              <input
                                type="text"
                                value={row.outputFolder}
                                onChange={(e) => updateTableRow(idx, 'outputFolder', e.target.value)}
                                className="w-full bg-inner border border-subtle rounded px-2.5 py-1.5 text-[11px] font-sans text-emerald-300 focus:text-text-base focus:border-emerald-500/60"
                                placeholder="Destination output folder"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between border-t border-subtle px-6 py-4 bg-card/60">
                <div className="text-[11px] text-text-muted">
                  Initial Station Target:{' '}
                  <strong className="text-text-base">
                    {tableRows[dispatchStationIdx]?.name || 'PC 1 — Privacy Blur'}
                  </strong>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDispatchModal(false)}
                    className="px-4 py-2 bg-inner border border-subtle text-text-muted hover:text-text-base rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={dispatching || !dispatchSubgrid.trim()}
                    className="px-5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-lg cursor-pointer disabled:opacity-50 shadow-md flex items-center gap-1.5"
                  >
                    {dispatching ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    <span>
                      {dispatching
                        ? 'Dispatching...'
                        : `Dispatch to ${tableRows[dispatchStationIdx]?.name?.split('—')[0]?.trim() || 'Station'}`}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Job Card Quick Edit Modal */}
      {editingJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Edit2 size={16} className="text-sky-400" />
                <h3 className="text-sm font-bold text-text-base">Edit Job Parameters • {editingJob.subgrid}</h3>
              </div>
              <button
                onClick={() => setEditingJob(null)}
                className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEditedJob} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted mb-1">Subgrid Code</label>
                  <input
                    type="text"
                    value={editingJob.subgrid || ''}
                    onChange={(e) => setEditingJob({ ...editingJob, subgrid: e.target.value.toUpperCase() })}
                    className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-text-base font-sans font-bold focus:outline-none focus:border-sky-500/60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted mb-1">Status</label>
                  <select
                    value={editingJob.status}
                    onChange={(e) => setEditingJob({ ...editingJob, status: e.target.value as any })}
                    className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-text-base focus:outline-none focus:border-sky-500/60"
                  >
                    <option value="PENDING">PENDING</option>
                    <option value="IN_PROGRESS">IN_PROGRESS</option>
                    <option value="COMPLETED">COMPLETED</option>
                    <option value="FAILED">FAILED</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted mb-1">Primary Tool</label>
                  <input
                    type="text"
                    value={editingJob.provider || ''}
                    onChange={(e) => setEditingJob({ ...editingJob, provider: e.target.value })}
                    className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-text-base focus:outline-none focus:border-sky-500/60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted mb-1">Assigned Operator</label>
                  <input
                    type="text"
                    value={editingJob.assigned_to || editingJob.operator || ''}
                    onChange={(e) =>
                      setEditingJob({
                        ...editingJob,
                        assigned_to: e.target.value,
                        operator: e.target.value
                      })
                    }
                    className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-sky-300 font-semibold focus:outline-none focus:border-sky-500/60"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Source Input Folder</label>
                <input
                  type="text"
                  value={editingJob.source_folder || ''}
                  onChange={(e) => setEditingJob({ ...editingJob, source_folder: e.target.value })}
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 font-sans text-sky-300 focus:outline-none focus:border-sky-500/60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Output Folder</label>
                <input
                  type="text"
                  value={editingJob.output_folder || ''}
                  onChange={(e) => setEditingJob({ ...editingJob, output_folder: e.target.value })}
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 font-sans text-emerald-300 focus:outline-none focus:border-emerald-500/60"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-subtle">
                <button
                  type="button"
                  onClick={() => setEditingJob(null)}
                  className="px-4 py-2 bg-inner border border-subtle text-text-muted hover:text-text-base rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === editingJob.id}
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-lg cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  {busyId === editingJob.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Professional Clean Dark Delete Confirmation Modal */}
      {deleteConfirmJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 bg-inner border border-subtle text-text-muted rounded-xl shrink-0">
                <Trash2 size={18} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-text-base">Remove Workstation Job?</h3>
                <p className="text-xs text-text-muted">
                  Are you sure you want to remove this job from the workstation queue?
                </p>
              </div>
            </div>

            <div className="bg-inner border border-subtle rounded-xl p-3.5 text-xs space-y-2 text-text-muted font-sans">
              <div className="flex items-center justify-between">
                <span>Subgrid Batch:</span>
                <strong className="text-text-base font-bold font-sans">{deleteConfirmJob.subgrid || 'SUBGRID'}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Station:</span>
                <strong className="text-text-base">{deleteConfirmJob.name || deleteConfirmJob.job_type}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Assigned PC:</span>
                <strong className="text-text-muted">{deleteConfirmJob.assigned_to || deleteConfirmJob.operator || 'Unassigned'}</strong>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmJob(null)}
                className="px-4 py-2 bg-inner border border-subtle text-text-muted hover:text-text-base rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteJob}
                disabled={busyId === deleteConfirmJob.id}
                className="px-5 py-2 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 text-red-300 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
              >
                {busyId === deleteConfirmJob.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Delete Job</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Strict Output File Verification Modal (Blocks advancing when 0 files exist) */}
      {advanceWarningJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 bg-inner border border-subtle text-text-muted rounded-xl shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-text-base">Output Files Required to Advance</h3>
                <p className="text-xs text-text-muted">
                  Cannot transfer to the next station because no output files were detected in the destination folder on the NAS.
                </p>
              </div>
            </div>

            <div className="bg-inner border border-subtle rounded-xl p-3.5 text-xs text-text-muted space-y-2 font-sans">
              <div>
                <span className="text-[10px] uppercase font-bold text-text-muted block mb-0.5">Primary Software:</span>
                <strong className="text-text-base">{advanceWarningJob.job.provider || 'Desktop Software'}</strong>
              </div>
              <div className="break-all">
                <span className="text-[10px] uppercase font-bold text-text-muted block mb-0.5">Expected Output NAS Folder:</span>
                <code className="text-sky-300 font-sans text-[11px]">{advanceWarningJob.job.output_folder || '—'}</code>
              </div>
              <p className="text-[11px] text-text-muted italic pt-1 border-t border-subtle">
                Please process the images in {advanceWarningJob.job.provider || 'software'} and export them to this folder.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setAdvanceWarningJob(null)}
                className="px-4 py-2 bg-inner border border-subtle text-text-muted hover:text-text-base rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = advanceWarningJob.job;
                  setAdvanceWarningJob(null);
                  advanceStation(target);
                }}
                className="px-5 py-2 bg-card border border-subtle hover:bg-inner text-text-base font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition-all"
              >
                <RefreshCw size={12} />
                <span>Check NAS &amp; Advance</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Cards Confirmation Modal */}
      {clearAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 bg-inner border border-subtle text-text-muted rounded-xl shrink-0">
                <Trash2 size={18} />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-text-base">Reset Workstation Board?</h3>
                <p className="text-xs text-text-muted">
                  Are you sure you want to clear all active cards from the 4-station workstation board?
                </p>
              </div>
            </div>

            <div className="bg-inner border border-subtle rounded-xl p-3 text-xs text-text-muted">
              This will remove all {jobs.length} card(s) currently on the board so you can start fresh.
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setClearAllConfirm(false)}
                className="px-4 py-2 bg-inner border border-subtle text-text-muted hover:text-text-base rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllCards}
                disabled={busyId === 'clear_all'}
                className="px-5 py-2 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 text-red-300 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all"
              >
                {busyId === 'clear_all' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                <span>Clear All Cards</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};