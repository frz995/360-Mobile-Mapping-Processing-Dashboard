import React, { useEffect, useMemo, useState } from 'react';
import {
  Layers,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle
} from 'lucide-react';
import type { ProductionApiClient } from '../../services/productionApi';
import { getStorageImageCountsFromSupabase } from '../../services/supabase';
import type {
  DatasetRecord,
  ProcessingJobRecord
} from '../../types/production';
import { buildPipelineStages } from '../../utils/pipelineStages';
import type { StagingAggregate } from '../../utils/datasetLineage';
import { extractCanonicalSubgrid, extractSurveyDate } from '../../utils/datasetLineage';
import { ProcessStrip, Surface } from './chrome';
import { formatBytes } from './common';

export interface PipelinePanelProps {
  jobs: ProcessingJobRecord[];
  datasets: DatasetRecord[];
  api: ProductionApiClient;
  projectSettings?: any;
  stagingAggregates?: StagingAggregate[];
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onRefreshJobs: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  onOpenJobDetails?: (job: ProcessingJobRecord) => void;
}

interface SubgridLifecycleRow {
  key: string;
  subgrid: string;
  surveyDate?: string;
  rawAggregate?: StagingAggregate;
  rawDataset?: DatasetRecord;
  blurJob?: ProcessingJobRecord;
  stitchJob?: ProcessingJobRecord;
  enhanceJob?: ProcessingJobRecord;
  maskJob?: ProcessingJobRecord;
  qaDecision?: string | null;
  processedDataset?: DatasetRecord;
  deliverableDataset?: DatasetRecord;
  activeStageIndex: number;
  isComplete: boolean;
}

export const PipelinePanel: React.FC<PipelinePanelProps> = ({
  jobs,
  datasets,
  stagingAggregates = [],
  translate = (k) => k,
  onOpenJobDetails
}) => {
  const [search, setSearch] = useState('');
  const [filterState, setFilterState] = useState<'ALL' | 'ACTIVE' | 'QA' | 'COMPLETE'>('ALL');
  const [bucketFrames, setBucketFrames] = useState<number>(0);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);

  const refreshBucketFrames = useMemo(
    () => () => {
      getStorageImageCountsFromSupabase()
        .then((counts) => {
          const total = Object.values(counts || {}).reduce((a, b) => a + (Number(b) || 0), 0);
          setBucketFrames(total);
        })
        .catch(() => {});
    },
    []
  );

  useEffect(() => {
    refreshBucketFrames();
  }, [refreshBucketFrames, jobs]);

  // Aggregate subgrid lifecycle rows dynamically per (subgrid, surveyDate)
  const subgridRows = useMemo<SubgridLifecycleRow[]>(() => {
    const entryMap = new Map<string, { subgrid: string; surveyDate?: string }>();

    const register = (rawSg?: string, rawDateCandidate?: any, rawTs?: string) => {
      const sg = extractCanonicalSubgrid(rawSg);
      if (!sg) return;
      const date = extractSurveyDate(rawDateCandidate || rawSg, rawTs) || 'undated';
      const key = `${sg}::${date}`;
      if (!entryMap.has(key)) {
        entryMap.set(key, { subgrid: sg, surveyDate: date !== 'undated' ? date : undefined });
      }
    };

    stagingAggregates.forEach((a) => {
      register(a.subgrid, a.surveyDate || a.subgrid);
    });
    jobs.forEach((j) => {
      register(j.subgrid, j.subgrid || j.name, j.created_at);
    });
    datasets.forEach((d) => {
      register(d.subgrid, d.subgrid || d.name, d.created_at);
    });

    const entries = Array.from(entryMap.entries()).sort((a, b) => {
      const cmp = a[1].subgrid.localeCompare(b[1].subgrid);
      if (cmp !== 0) return cmp;
      return (b[1].surveyDate || '').localeCompare(a[1].surveyDate || '');
    });

    return entries.map(([key, item]) => {
      const sg = item.subgrid;
      const targetDate = item.surveyDate || 'undated';

      const matchDate = (val?: any, ts?: string) => {
        const d = extractSurveyDate(val, ts) || 'undated';
        return d === targetDate || (!item.surveyDate && d === 'undated');
      };

      const rawAgg = stagingAggregates.find(
        (a) => extractCanonicalSubgrid(a.subgrid) === sg && matchDate(a.surveyDate || a.subgrid)
      );
      const rawDs = datasets.find(
        (d) =>
          extractCanonicalSubgrid(d.subgrid) === sg &&
          d.dataset_type === 'RAW' &&
          matchDate(d.subgrid || d.name, d.created_at)
      );
      const processedDs = datasets.find(
        (d) =>
          extractCanonicalSubgrid(d.subgrid) === sg &&
          d.dataset_type === 'PROCESSED' &&
          matchDate(d.subgrid || d.name, d.created_at)
      );
      const deliverableDs = datasets.find(
        (d) =>
          extractCanonicalSubgrid(d.subgrid) === sg &&
          d.dataset_type === 'DELIVERABLE' &&
          matchDate(d.subgrid || d.name, d.created_at)
      );

      const sgJobs = jobs.filter(
        (j) =>
          extractCanonicalSubgrid(j.subgrid) === sg &&
          matchDate(j.subgrid || j.name, j.created_at)
      );
      const stitchJob = sgJobs.find((j) => j.job_type === 'STITCH');
      const blurJob = sgJobs.find((j) => j.job_type === 'BLUR');
      const enhanceJob = sgJobs.find((j) => j.job_type === 'ENHANCE');
      const maskJob = sgJobs.find((j) => j.job_type === 'MASK');

      const qaDecision =
        maskJob?.qa_decision ||
        sgJobs.find((j) => j.job_type === 'QAQC')?.qa_decision ||
        (processedDs ? 'APPROVED' : null);

      let activeStageIndex = 0;
      if (rawAgg || rawDs) activeStageIndex = 1;
      if (blurJob?.status === 'COMPLETED') activeStageIndex = 2;
      if (stitchJob?.status === 'COMPLETED') activeStageIndex = 3;
      if (enhanceJob?.status === 'COMPLETED') activeStageIndex = 4;
      if (maskJob?.status === 'COMPLETED') activeStageIndex = 5;
      if (qaDecision === 'APPROVED' || deliverableDs) activeStageIndex = 6;

      const isComplete = Boolean(deliverableDs || (processedDs && qaDecision === 'APPROVED'));

      return {
        key,
        subgrid: sg,
        surveyDate: item.surveyDate,
        rawAggregate: rawAgg,
        rawDataset: rawDs,
        blurJob,
        stitchJob,
        enhanceJob,
        maskJob,
        qaDecision,
        processedDataset: processedDs,
        deliverableDataset: deliverableDs,
        activeStageIndex,
        isComplete
      };
    });
  }, [stagingAggregates, jobs, datasets]);

  const selectedRow = useMemo(
    () => (selectedRowKey ? subgridRows.find((r) => r.key === selectedRowKey) : null),
    [subgridRows, selectedRowKey]
  );

  const pipelineStages = useMemo(() => {
    if (selectedRow) {
      const sg = selectedRow.subgrid;
      const targetDate = selectedRow.surveyDate || 'undated';
      const matchDate = (val?: any, ts?: string) => {
        const d = extractSurveyDate(val, ts) || 'undated';
        return d === targetDate || (!selectedRow.surveyDate && d === 'undated');
      };

      const sgJobs = jobs.filter(
        (j) => extractCanonicalSubgrid(j.subgrid) === sg && matchDate(j.subgrid || j.name, j.created_at)
      );
      const sgDatasets = datasets.filter(
        (d) => extractCanonicalSubgrid(d.subgrid) === sg && matchDate(d.subgrid || d.name, d.created_at)
      );
      const sgAggs = stagingAggregates.filter(
        (a) => extractCanonicalSubgrid(a.subgrid) === sg && matchDate(a.surveyDate || a.subgrid)
      );

      return buildPipelineStages({
        jobs: sgJobs,
        datasets: sgDatasets,
        stagingAggregates: sgAggs,
        bucketFrames: selectedRow.rawAggregate?.frames || (selectedRow.deliverableDataset?.file_count || 0)
      });
    }

    return buildPipelineStages({ jobs, datasets, stagingAggregates, bucketFrames });
  }, [selectedRow, jobs, datasets, stagingAggregates, bucketFrames]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subgridRows.filter((r) => {
      if (q && !r.subgrid.toLowerCase().includes(q)) return false;
      if (filterState === 'COMPLETE' && !r.isComplete) return false;
      if (filterState === 'QA' && r.qaDecision !== 'PENDING' && r.activeStageIndex !== 5) return false;
      if (filterState === 'ACTIVE' && r.isComplete) return false;
      return true;
    });
  }, [subgridRows, search, filterState]);

  const totals = useMemo(() => {
    const total = subgridRows.length;
    const complete = subgridRows.filter((r) => r.isComplete).length;
    const inProgress = subgridRows.filter((r) => !r.isComplete && r.activeStageIndex > 0).length;
    const qaPending = subgridRows.filter((r) => r.activeStageIndex === 5 && !r.qaDecision).length;
    return { total, complete, inProgress, qaPending };
  }, [subgridRows]);

  const segments = useMemo(() => {
    return pipelineStages.map((st) => ({
      key: st.key,
      label: translate ? translate(st.labelKey) : st.labelKey,
      status: (st.status === 'N/A' ? 'WAITING' : st.status) as 'COMPLETE' | 'IN_PROGRESS' | 'FAILED' | 'WAITING',
      pct: st.pct,
      note: st.note
    }));
  }, [pipelineStages, translate]);

  const renderStageCell = (
    _label: string,
    job?: ProcessingJobRecord,
    isCompleteDirect?: boolean
  ) => {
    const isDone = isCompleteDirect || job?.status === 'COMPLETED';
    const isRunning = job?.status === 'IN_PROGRESS';
    const isFailed = job?.status === 'FAILED' || job?.status === 'REJECTED';

    return (
      <div
        onClick={(e) => {
          if (job) {
            e.stopPropagation();
            onOpenJobDetails?.(job);
          }
        }}
        className={`flex items-center gap-1.5 py-1 px-2 rounded font-mono text-[11px] transition-colors ${
          job ? 'cursor-pointer hover:bg-white/5' : ''
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isDone
              ? 'bg-emerald-400'
              : isRunning
              ? 'bg-amber-400 animate-pulse'
              : isFailed
              ? 'bg-rose-400'
              : 'bg-zinc-600'
          }`}
        />
        <span
          className={`${
            isDone
              ? 'text-zinc-200 font-medium'
              : isRunning
              ? 'text-amber-300 font-medium'
              : isFailed
              ? 'text-rose-300'
              : 'text-zinc-500'
          }`}
        >
          {isDone
            ? 'Done'
            : isRunning
            ? `${job?.progress || 0}%`
            : isFailed
            ? 'Fail'
            : '—'}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 9-Stage Project Lifecycle Process Strip */}
      <Surface className="p-2.5 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 uppercase tracking-wider px-1">
          <span>
            {selectedRow
              ? `Subgrid Pipeline · ${selectedRow.subgrid}${selectedRow.surveyDate ? ` (${selectedRow.surveyDate})` : ''}`
              : 'Project Pipeline · All Subgrids'}
          </span>
          {selectedRow ? (
            <button
              onClick={() => setSelectedRowKey(null)}
              className="text-sky-400 hover:text-sky-300 cursor-pointer font-sans normal-case text-[11px]"
            >
              Show All
            </button>
          ) : (
            <span className="text-zinc-500 font-sans normal-case text-[11px]">
              Click subgrid row to focus
            </span>
          )}
        </div>
        <ProcessStrip segments={segments} />
      </Surface>

      {/* Engineering Control Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-inner border border-subtle rounded-xl px-3.5 py-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-text-base text-xs font-semibold tracking-wide">
            <Layers size={14} className="text-zinc-400" />
            <span className="uppercase text-[11px] font-bold text-zinc-300">Subgrid Matrix</span>
          </div>

          <div className="h-3.5 w-[1px] bg-subtle" />

          {/* Minimal Inline Telemetry */}
          <div className="flex items-center gap-3 font-mono text-[11px] text-text-muted">
            <span>
              Total: <strong className="text-zinc-200 font-semibold">{totals.total}</strong>
            </span>
            <span>·</span>
            <span>
              In Production: <strong className="text-amber-300 font-semibold">{totals.inProgress}</strong>
            </span>
            <span>·</span>
            <span>
              QA Pending: <strong className="text-sky-300 font-semibold">{totals.qaPending}</strong>
            </span>
            <span>·</span>
            <span>
              Ready: <strong className="text-emerald-300 font-semibold">{totals.complete}</strong>
            </span>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-card border border-subtle rounded-lg p-0.5">
            {(['ALL', 'ACTIVE', 'QA', 'COMPLETE'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterState(mode)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  filterState === mode
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {mode === 'ALL' ? 'All' : mode === 'ACTIVE' ? 'Active' : mode === 'QA' ? 'QA' : 'Ready'}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="bg-card border border-subtle rounded-lg pl-7 pr-2.5 py-1 text-xs text-zinc-200 font-mono outline-none focus:border-zinc-500 placeholder:text-zinc-600 w-32"
            />
          </div>
        </div>
      </div>

      {/* Dense Engineering Data Table */}
      <div className="bg-inner border border-subtle rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto max-h-[540px]">
          <table className="w-full text-left text-[11px] border-collapse">
            <thead className="sticky top-0 bg-card/95 backdrop-blur text-zinc-400 uppercase tracking-wider text-[10px] font-semibold border-b border-subtle z-10">
              <tr>
                <th className="py-2.5 px-3">Subgrid</th>
                <th className="py-2.5 px-3">RAW Intake</th>
                <th className="py-2.5 px-3">PC 1 Blur</th>
                <th className="py-2.5 px-3">PC 2 Stitch</th>
                <th className="py-2.5 px-3">PC 3 Lightroom</th>
                <th className="py-2.5 px-3">PC 4 Photoshop</th>
                <th className="py-2.5 px-3">Acceptance QA</th>
                <th className="py-2.5 px-3 text-right">Deliverable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle/40 font-mono">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500 text-xs font-sans">
                    No subgrids found.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const isSelected = selectedRowKey === row.key;
                  return (
                    <tr
                      key={row.key}
                      onClick={() => setSelectedRowKey((prev) => (prev === row.key ? null : row.key))}
                      className={`transition-colors cursor-pointer ${
                        isSelected ? 'bg-sky-500/10 hover:bg-sky-500/15' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                    {/* 1. Subgrid Code */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-zinc-100">{row.subgrid}</span>
                        {row.surveyDate && (
                          <span className="text-[10px] text-zinc-500 font-sans">
                            {row.surveyDate}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 2. RAW Intake */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            row.rawAggregate || row.rawDataset ? 'bg-emerald-400' : 'bg-zinc-600'
                          }`}
                        />
                        <span className="text-zinc-300">
                          {row.rawAggregate ? `${row.rawAggregate.frames} frames` : row.rawDataset ? 'Staged' : '—'}
                        </span>
                      </div>
                    </td>

                    {/* 3. PC 1 Blur */}
                    <td className="py-2.5 px-3">
                      {renderStageCell('BLUR', row.blurJob)}
                    </td>

                    {/* 4. PC 2 Stitch */}
                    <td className="py-2.5 px-3">
                      {renderStageCell('STITCH', row.stitchJob)}
                    </td>

                    {/* 5. PC 3 Lightroom */}
                    <td className="py-2.5 px-3">
                      {renderStageCell('ENHANCE', row.enhanceJob)}
                    </td>

                    {/* 6. PC 4 Photoshop */}
                    <td className="py-2.5 px-3">
                      {renderStageCell('MASK', row.maskJob, Boolean(row.processedDataset))}
                    </td>

                    {/* 7. QA Acceptance */}
                    <td className="py-2.5 px-3 font-sans">
                      {row.qaDecision === 'APPROVED' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                          <CheckCircle2 size={11} /> Approved
                        </span>
                      ) : row.qaDecision === 'REJECTED' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-400">
                          <AlertTriangle size={11} /> Rejected
                        </span>
                      ) : row.activeStageIndex >= 5 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
                          <Clock size={11} /> Review
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>

                    {/* 8. Deliverable Dataset */}
                    <td className="py-2.5 px-3 text-right">
                      {row.deliverableDataset || row.processedDataset ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-zinc-300">
                            {(row.deliverableDataset || row.processedDataset)?.file_count || 0} frames
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            ({formatBytes((row.deliverableDataset || row.processedDataset)?.size_bytes)})
                          </span>
                        </div>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};