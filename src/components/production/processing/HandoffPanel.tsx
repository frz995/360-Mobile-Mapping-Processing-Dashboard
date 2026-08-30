import React, { useMemo, useState } from 'react';
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
  Play
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import {
  saveDatasetToSupabase,
  saveProcessingJobToSupabase,
  updateProcessingJobHandoffInSupabase,
  updateProcessingJobStatusInSupabase
} from '../../../services/supabase';
import type {
  ProcessingJobRecord,
  WorkstationStationConfig
} from '../../../types/production';
import { DEFAULT_4_WORKSTATIONS } from '../../../types/production';
import { jobStatusMeta } from '../../../utils/productionQueue';

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

const STATION_JOB_TYPE_MAP: Record<string, { jobType: any; nextJobType: any; nextStageName: string }> = {
  STITCH: { jobType: 'STITCH', nextJobType: 'BLUR', nextStageName: 'PC 2 — Privacy Blur' },
  BLUR: { jobType: 'BLUR', nextJobType: 'ENHANCE', nextStageName: 'PC 3 — Lightroom' },
  ENHANCE: { jobType: 'ENHANCE', nextJobType: 'MASK', nextStageName: 'PC 4 — Photoshop' },
  MASK: { jobType: 'MASK', nextJobType: null, nextStageName: 'Final PROCESSED Dataset' }
};

export const HandoffPanel: React.FC<HandoffPanelProps> = ({
  jobs,
  api,
  projectSettings,
  isGuestUser,
  onRefreshJobs,
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
  const [dispatchSubgrid, setDispatchSubgrid] = useState('');
  const [dispatching, setDispatching] = useState(false);

  // GPU Worker Dispatch State
  const [gpuSubgrid, setGpuSubgrid] = useState('');
  const [gpuJobType, setGpuJobType] = useState<'ENHANCE' | 'MASK' | 'STITCH' | 'BLUR'>('ENHANCE');
  const [gpuDispatching, setGpuDispatching] = useState(false);

  const workstations: WorkstationStationConfig[] =
    (projectSettings?.workstationsConfig as WorkstationStationConfig[]) || DEFAULT_4_WORKSTATIONS;

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

  const advanceStation = async (job: ProcessingJobRecord) => {
    if (isGuestUser || !job.id) return;
    setBusyId(job.id);

    const subgrid = (job.subgrid || 'N93E70').toUpperCase().trim();
    const currentType = job.job_type;
    const stageMeta = STATION_JOB_TYPE_MAP[currentType];

    // Check NAS folder for output files
    const listing = await api.listFolder(job.output_folder || '');
    const fileCount = listing?.fileCount || job.total_items || 0;

    if (!fileCount && api.mode === 'http') {
      const proceed = window.confirm(
        `Warning: Output folder ${job.output_folder} appears empty.\nDo you want to mark this station complete anyway?`
      );
      if (!proceed) {
        setBusyId(null);
        return;
      }
    }

    // 1. Mark current job complete
    await updateProcessingJobStatusInSupabase(job.id, {
      status: 'COMPLETED',
      completed_at: new Date().toISOString()
    });
    await updateProcessingJobHandoffInSupabase(job.id, { externalStatus: 'done' });

    // 2. If this was the last station (MASK / Photoshop), register final PROCESSED dataset
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
        file_count: fileCount || 500,
        size_bytes: listing?.sizeBytes || 0,
        status: 'READY',
        version: 1,
        created_by: userLabel,
        metadata: { source: '4station-pipeline', final_job_id: job.id }
      });

      notify(
        `4-Station Pipeline Complete!`,
        `Subgrid ${subgrid} finished Station 4 (Photoshop) and is registered as final PROCESSED dataset.`
      );
    } else {
      // 3. Create next station job automatically
      const nextType = stageMeta.nextJobType;
      const nextStation = workstations.find((w) =>
        nextType === 'BLUR'
          ? w.id === 'blur'
          : nextType === 'ENHANCE'
            ? w.id === 'lightroom'
            : w.id === 'photoshop'
      );

      const nextInFolder = job.output_folder;
      const nextOutFolder = (nextStation?.outputFolderTemplate || '/ENHANCED/{subgrid}/').replace(
        '{subgrid}',
        subgrid
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
        total_items: fileCount || 500
      });

      notify(
        `Advanced to ${stageMeta.nextStageName}`,
        `Subgrid ${subgrid} moved to next station with input folder ${nextInFolder}.`
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
    const st1 = workstations[0] || DEFAULT_4_WORKSTATIONS[0];
    const inFolder = st1.sourceFolderTemplate.replace('{subgrid}', sg);
    const outFolder = st1.outputFolderTemplate.replace('{subgrid}', sg);

    await saveProcessingJobToSupabase({
      job_type: 'STITCH',
      name: `${st1.name} • ${sg}`,
      subgrid: sg,
      source_folder: inFolder,
      output_folder: outFolder,
      provider: st1.software,
      status: 'PENDING',
      operator: st1.defaultOperator,
      assigned_to: st1.defaultOperator,
      external_status: 'awaiting_submit',
      total_items: 500
    });

    notify(
      `Dispatched to 4-Station Pipeline`,
      `Subgrid ${sg} queued in Station 1 (${st1.name}) for ${st1.defaultOperator}.`
    );

    setDispatchSubgrid('');
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
      total_items: 500
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
      stitch: jobs.filter((j) => j.job_type === 'STITCH' && j.status !== 'COMPLETED'),
      blur: jobs.filter((j) => j.job_type === 'BLUR' && j.status !== 'COMPLETED'),
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
        <div
          className="flex items-center justify-between gap-2 cursor-pointer hover:opacity-90"
          onClick={() => onOpenJobDetails?.(job)}
        >
          <span className="font-sans font-bold text-sky-300 text-xs">{job.subgrid || 'SUBGRID'}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${meta.className}`}>
            {job.status}
          </span>
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
            <div className="text-base font-bold text-text-base">NVIDIA CUDA GPU</div>
            <div className="text-[10px] text-text-muted font-sans">PyTorch 2.3 · CUDA 12.4</div>
          </div>

          <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
              <span>GPU Memory (VRAM)</span>
              <Activity size={14} className="text-text-muted" />
            </div>
            <div className="text-base font-bold text-text-base">14.2 GB / 24.0 GB</div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden">
              <div className="bg-slate-400 h-1.5 rounded-full" style={{ width: '59%' }} />
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
            <div className="text-[10px] text-text-muted">Max parallel subgrid batches</div>
          </div>

          <div className="bg-inner border border-subtle rounded-xl p-3.5 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-text-muted font-semibold">
              <span>Throughput</span>
              <Play size={14} className="text-text-muted" />
            </div>
            <div className="text-base font-bold text-text-base">~24.8 FPS</div>
            <div className="text-[10px] text-text-muted">Batch processing speed</div>
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
                  <option value="STITCH">Dual-Fisheye Equirectangular Stitching</option>
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
                      <span>Frames: {j.completed_items || 0} / {j.total_items || 500}</span>
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
              Track subgrids moving sequentially across Stitching, Blurring, Lightroom, and Photoshop stations
            </p>
          </div>
        </div>

        {!isGuestUser && (
          <button
            onClick={() => setShowDispatchModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-500 text-slate-950 text-xs font-bold rounded-xl hover:bg-sky-400 transition-all shadow cursor-pointer"
          >
            <Plus size={13} /> Dispatch Subgrid to 4-PC Flow
          </button>
        )}
      </div>

      {/* 4-Lane Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Lane 1: Stitching PC */}
        <div className="bg-inner border border-subtle rounded-xl p-3 flex flex-col gap-3 min-h-[400px]">
          <div className="flex items-center justify-between border-b border-subtle pb-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-card text-text-muted border border-subtle flex items-center justify-center text-[10px] font-bold">1</span>
              <div className="flex items-center gap-1.5 text-text-muted">
                <Layers size={13} />
                <h4 className="text-xs font-bold text-text-base">Stitching PC</h4>
              </div>
            </div>
            <span className="text-[10px] font-sans font-bold text-text-muted bg-card px-2 py-0.5 rounded border border-subtle">
              {laneJobs.stitch.length}
            </span>
          </div>
          <p className="text-[10px] text-text-muted italic">PTGui / Insta360 Stitcher</p>
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto">
            {laneJobs.stitch.map((j) => renderWorkstationCard(j, workstations[0]))}
            {laneJobs.stitch.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center p-6 text-[11px] text-text-muted border border-dashed border-subtle rounded-lg">
                No batches currently in Stitching
              </div>
            )}
          </div>
        </div>

        {/* Lane 2: Privacy Blur PC */}
        <div className="bg-inner border border-subtle rounded-xl p-3 flex flex-col gap-3 min-h-[400px]">
          <div className="flex items-center justify-between border-b border-subtle pb-2">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-card text-text-muted border border-subtle flex items-center justify-center text-[10px] font-bold">2</span>
              <div className="flex items-center gap-1.5 text-text-muted">
                <EyeOff size={13} />
                <h4 className="text-xs font-bold text-text-base">Privacy Blur PC</h4>
              </div>
            </div>
            <span className="text-[10px] font-sans font-bold text-text-muted bg-card px-2 py-0.5 rounded border border-subtle">
              {laneJobs.blur.length}
            </span>
          </div>
          <p className="text-[10px] text-text-muted italic">YOLO Blur / Face &amp; Plate Tool</p>
          <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto">
            {laneJobs.blur.map((j) => renderWorkstationCard(j, workstations[1]))}
            {laneJobs.blur.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-center p-6 text-[11px] text-text-muted border border-dashed border-subtle rounded-lg">
                No batches currently in Privacy Blur
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
            <span className="text-[10px] font-sans font-bold text-text-muted bg-card px-2 py-0.5 rounded border border-subtle">
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
            <span className="text-[10px] font-sans font-bold text-text-muted bg-card px-2 py-0.5 rounded border border-subtle">
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

      {/* Dispatch Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-subtle pb-3">
              <h3 className="text-sm font-bold text-text-base">Dispatch Subgrid to 4-PC Pipeline</h3>
              <button
                onClick={() => setShowDispatchModal(false)}
                className="text-text-muted hover:text-text-base cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleStart4StationPipeline} className="space-y-4 text-xs">
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
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-text-base font-sans uppercase focus:outline-none focus:border-sky-500/60"
                />
              </div>

              <div className="p-3 bg-inner rounded-xl border border-subtle space-y-1 text-[11px] text-text-muted">
                <div className="font-semibold text-text-base mb-1">Pipeline Initial Route:</div>
                <div>• Initial Station: <strong>PC 1 — Stitching Station</strong></div>
                <div>• Source Folder: <code className="text-sky-300 font-sans">/RAW/{dispatchSubgrid || 'SUBGRID'}/</code></div>
                <div>• Output Folder: <code className="text-sky-300 font-sans">/STITCHED/{dispatchSubgrid || 'SUBGRID'}/</code></div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
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
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-lg cursor-pointer disabled:opacity-50 shadow-md"
                >
                  {dispatching ? 'Dispatching...' : 'Dispatch to Station 1'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};