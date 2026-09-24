import React, { useMemo } from 'react';
import { Route, FolderOpen, CheckCircle2, XCircle, Clock, MonitorUp } from 'lucide-react';
import type { DatasetRecord, ProcessingJobRecord, WorkstationStationConfig } from '../../../types/production';
import { DEFAULT_4_WORKSTATIONS } from '../../../types/production';
import { extractCanonicalSubgrid } from '../../../utils/datasetLineage';
import { estimateEtaSeconds, formatEta, jobStatusMeta, jobStatusTextClass } from '../../../utils/productionQueue';
import { qaDecisionMeta } from './processingCommon';

export interface SubgridLifecyclePanelProps {
  jobs: ProcessingJobRecord[];
  datasets: DatasetRecord[];
  projectSettings?: any;
  translate?: (k: string) => string;
  onExplorePath?: (path: string) => void;
  onFocusSubgrid?: (subgrid: string | null) => void;
  onOpenQa?: (subgrid?: string) => void;
}

interface StationCellState {
  job?: ProcessingJobRecord;
  status?: string;
  progress?: number;
  external?: string;
}

const STATIONS: Array<{ id: WorkstationStationConfig['id']; jobType: 'BLUR' | 'STITCH' | 'ENHANCE' | 'MASK' }> = [
  { id: 'blur', jobType: 'BLUR' },
  { id: 'stitch', jobType: 'STITCH' },
  { id: 'lightroom', jobType: 'ENHANCE' },
  { id: 'photoshop', jobType: 'MASK' }
];

const norm = (s?: string): string => extractCanonicalSubgrid(s) || (s || '').trim().toUpperCase();

const resolveTemplate = (tpl: string, subgrid: string): string =>
  (tpl || '').replace(/\{subgrid\}/gi, subgrid).trim();

const textClasses = (cls?: string): string =>
  (cls || '')
    .split(' ')
    .filter((c) => c.startsWith('text-'))
    .join(' ');

function statusChip(status?: string, extra?: string): React.ReactNode {
  if (!status) return <span className="text-[10px] text-text-muted">—</span>;
  const meta = jobStatusMeta(status as any);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[9px] font-bold ${jobStatusTextClass(status as any)}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
      {extra ? <span className="opacity-70">{extra}</span> : null}
    </span>
  );
}

export const SubgridLifecyclePanel: React.FC<SubgridLifecyclePanelProps> = ({
  jobs,
  datasets,
  projectSettings,
  onExplorePath,
  onFocusSubgrid,
  onOpenQa
}) => {
  const workstations = useMemo<WorkstationStationConfig[]>(
    () => (projectSettings?.workstationsConfig as WorkstationStationConfig[] | undefined) || DEFAULT_4_WORKSTATIONS,
    [projectSettings?.workstationsConfig]
  );

  const workstationsById = useMemo(() => {
    const m = new Map<string, WorkstationStationConfig>();
    workstations.forEach((w) => m.set(w.id, w));
    return m;
  }, [workstations]);

  const subgrids = useMemo(() => {
    const set = new Set<string>();
    datasets.forEach((d) => {
      const clean = norm(d.subgrid);
      if (clean) set.add(clean);
    });
    jobs.forEach((j) => {
      const clean = norm(j.subgrid);
      if (clean) set.add(clean);
    });
    return Array.from(set).sort();
  }, [datasets, jobs]);

  const rows = useMemo(() => {
    return subgrids.map((sg) => {
      const sgDatasets = datasets.filter((d) => norm(d.subgrid) === sg && !d.superseded_by);
      const raw = sgDatasets.find((d) => d.dataset_type === 'RAW');
      const processed = sgDatasets.find((d) => d.dataset_type === 'PROCESSED');
      const deliverable = sgDatasets.find((d) => d.dataset_type === 'DELIVERABLE');

      const sgJobs = jobs
        .filter((j) => norm(j.subgrid) === sg)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

      const maskJob = sgJobs.find((j) => j.job_type === 'MASK');
      const maskStageDataset = sgDatasets.find(
        (d) => d.pipeline_stage === 'MASK' && !d.superseded_by
      );

      const stationJobs: Record<string, StationCellState> = {};
      const stationStatusByType = (jobType: string): StationCellState => {
        const latest = sgJobs.find((j) => j.job_type === jobType);
        if (!latest) return { job: undefined, status: undefined, progress: undefined, external: undefined };
        return {
          job: latest,
          status: latest.status,
          progress: latest.progress,
          external: latest.external_status
        };
      };
      STATIONS.forEach((s) => {
        stationJobs[s.jobType] = stationStatusByType(s.jobType);
      });

      const decided = [...sgJobs].filter((j) => j.qa_decision);
      let qaDecision: string | null = decided[0]?.qa_decision || null;
      if (!qaDecision) {
        const awaiting =
          sgJobs.some((j) => j.status === 'QA_PENDING' || j.status === 'REVIEW_REQUIRED') ||
          sgJobs.some(
            (j) =>
              j.status === 'COMPLETED' &&
              (j.job_type === 'MASK' || j.job_type === 'QAQC') &&
              !j.qa_decision
          );
        if (awaiting) qaDecision = 'PENDING';
      }

      let liveText = 'Not started';
      if (deliverable) {
        liveText = deliverable.status === 'COMPLETED' || deliverable.status === 'IMPORTED'
          ? 'v' + (deliverable.version || 1) + ' · sync to WebGIS'
          : 'v' + (deliverable.version || 1) + ' · ' + deliverable.status;
      } else if (processed || qaDecision) {
        liveText = 'Awaiting QA / handoff';
      }

      return {
        subgrid: sg,
        raw,
        rawFrames:
          raw?.file_count ||
          sgJobs.reduce((acc, j) => acc + (j.total_items || 0), 0),
        processed,
        processedFrames:
          (maskJob && (maskJob.completed_items || maskJob.total_items || maskStageDataset?.file_count)) ||
          maskStageDataset?.file_count ||
          processed?.file_count ||
          0,
        deliverable,
        stationJobs,
        qaDecision,
        liveText,
        jobCount: sgJobs.length
      };
    });
  }, [subgrids, datasets, jobs]);

  const folderCell = (path: string, onOpen?: (p: string) => void) => {
    const clickable = !!onExplorePath && !!onOpen;
    return (
      <div
        onClick={clickable ? () => onOpen!(path) : undefined}
        className={clickable ? 'flex items-center gap-1 cursor-pointer hover:text-sky-300 transition-colors' : 'flex items-center gap-1'}
        title={clickable ? `Open ${path} in NAS Storage Browser` : path}
      >
        <FolderOpen size={11} className="shrink-0 text-text-muted" />
        <code className="text-[10px] font-mono text-text-muted truncate">{path}</code>
      </div>
    );
  };

  const renderStation = (sg: string, jobType: 'BLUR' | 'STITCH' | 'ENHANCE' | 'MASK') => {
    const cell = rows.find((r) => r.subgrid === sg)?.stationJobs[jobType];
    const ws = workstationsById.get(STATIONS.find((s) => s.jobType === jobType)!.id);
    if (!cell || !cell.status) {
      return (
        <div className="flex flex-col gap-1">
          {ws && <span className="text-[9px] font-bold text-text-muted">{ws.name.replace(/^PC \d — /, '')}</span>}
          <span className="text-[10px] text-text-muted">—</span>
        </div>
      );
    }
    const meta = jobStatusMeta(cell.status as any);
    const eta =
      cell.job && cell.status === 'IN_PROGRESS' && cell.progress
        ? formatEta(estimateEtaSeconds(cell.job))
        : null;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-bold text-text-muted">
          {ws ? ws.name.replace(/^PC \d — /, '') : jobType}
          {cell.external && cell.external !== 'none' ? ' · ' + cell.external.replace('_', ' ') : ''}
        </span>
        {folderCell(
          cell.job?.output_folder?.trim() ||
            (ws ? resolveTemplate(ws.outputFolderTemplate, sg) : `/${jobType}/${sg}/`),
          (p) => onExplorePath?.(p)
        )}
        {statusChip(cell.status, eta ? ` ~${eta}` : undefined)}
        {typeof cell.progress === 'number' && cell.progress > 0 && (
          <div className="w-full h-1 rounded-full bg-inner">
            <div
              className={`h-1 rounded-full ${meta.dot}`}
              style={{ width: `${Math.min(100, cell.progress)}%` }}
            />
          </div>
        )}
      </div>
    );
  };

  if (subgrids.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="p-3 bg-inner rounded-2xl border border-subtle text-slate-500">
          <Route size={26} strokeWidth={1.5} />
        </div>
        <p className="text-xs text-text-muted max-w-md leading-relaxed">
          No subgrids yet. Register a RAW dataset or dispatch a processing job to build the lifecycle view.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px] px-3 py-2 rounded-lg bg-inner/60 border border-subtle text-text-muted">
        <span className="font-bold uppercase tracking-wider text-text-base">Flow:</span>
        <span className="font-mono">RAW</span>
        <span>→</span>
        <span className="font-mono">1 Blur → 2 Stitch → 3 Enhance → 4 Mask</span>
        <span>→</span>
        <span className="font-mono">QA Gate</span>
        <span>→</span>
        <span className="font-mono">Deliverable</span>
        <span>→</span>
        <span className="font-mono">WebGIS Live</span>
        <span className="mx-2 opacity-40">•</span>
        <span>Click a folder to open the NAS Storage Browser · click a subgrid to filter the Job Board · click QA to open Acceptance QA.</span>
      </div>

      <div className="overflow-auto border border-subtle rounded-xl max-h-[560px]">
        <table className="w-full text-left text-[11px] min-w-[1180px]">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2 min-w-[110px]">Subgrid</th>
              <th className="px-3 py-2 min-w-[150px]">RAW · Capture</th>
              <th className="px-3 py-2 min-w-[150px]">1 · Blur</th>
              <th className="px-3 py-2 min-w-[150px]">2 · Stitch</th>
              <th className="px-3 py-2 min-w-[150px]">3 · Enhance</th>
              <th className="px-3 py-2 min-w-[150px]">4 · Mask</th>
              <th className="px-3 py-2 min-w-[110px]">QA Gate</th>
              <th className="px-3 py-2 min-w-[150px]">Deliverable</th>
              <th className="px-3 py-2 min-w-[140px]">WebGIS Live</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const qaMeta =
                row.qaDecision === 'PENDING'
                  ? { label: 'QA PENDING', className: 'bg-sky-500/15 text-sky-300 border-sky-500/40' }
                  : qaDecisionMeta(row.qaDecision ?? undefined);
              return (
                <tr key={row.subgrid} className="border-b border-subtle align-top hover:bg-inner/30 transition-colors">
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => onFocusSubgrid?.(row.subgrid)}
                      title={`Filter Job Board to ${row.subgrid}`}
                      className="text-[11px] font-bold text-text-base hover:text-sky-200 hover:underline underline-offset-2 transition-colors cursor-pointer"
                    >
                      {row.subgrid}
                    </button>
                    {row.jobCount > 0 && (
                      <div className="mt-1 text-[9px] text-text-muted">{row.jobCount} jobs</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      {folderCell(`/RAW/${row.subgrid}/`, (p) => onExplorePath?.(p))}
                      {row.raw ? (
                        <span className="text-[10px] text-text-muted">{row.rawFrames.toLocaleString()} frames</span>
                      ) : (
                        <span className="text-[10px] text-text-muted">not registered</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{renderStation(row.subgrid, 'BLUR')}</td>
                  <td className="px-3 py-2.5">{renderStation(row.subgrid, 'STITCH')}</td>
                  <td className="px-3 py-2.5">{renderStation(row.subgrid, 'ENHANCE')}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      {renderStation(row.subgrid, 'MASK')}
                      {row.processedFrames > 0 ? (
                        <span className="text-[10px] text-text-muted">
                          {row.processedFrames.toLocaleString()} frames registered
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => onOpenQa?.(row.subgrid)}
                      title="Open Acceptance QA for this subgrid"
                      className="cursor-pointer"
                    >
                      {qaMeta ? (
                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold ${textClasses(qaMeta.className)}`}>
                          {row.qaDecision === 'APPROVED' ? <CheckCircle2 size={11} /> : row.qaDecision === 'REJECTED' ? <XCircle size={11} /> : <Clock size={11} />}
                          {row.qaDecision === 'PENDING' ? 'QA PENDING' : row.qaDecision}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] text-text-muted">
                          <Clock size={11} /> None
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      {folderCell(`/DELIVERABLES/${row.subgrid}/`, (p) => onExplorePath?.(p))}
                      {row.deliverable ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-text-base">
                            v{row.deliverable.version || 1}
                          </span>
                          <span className="text-[9px] font-bold text-text-muted">
                            {row.deliverable.status}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-text-muted">
                          {row.qaDecision === 'APPROVED' ? 'not exported yet' : 'awaiting QA approval'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-text-muted">
                        <MonitorUp size={11} /> {row.liveText}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-text-muted">
        {subgrids.length} subgrid{subgrids.length === 1 ? '' : 's'} · Start: RAW capture folder → End: published WebGIS map. Deep trace per dataset lives in the Data Lineage module.
      </p>
    </div>
  );
};