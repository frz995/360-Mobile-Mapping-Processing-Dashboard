import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Route, GitCommitHorizontal, Sigma, CircleDot } from 'lucide-react';
import type { DatasetRecord, ProcessingJobRecord } from '../../../types/production';
import type {
  StagingAggregate,
  DatasetChain
} from '../../../utils/datasetLineage';
import { chainForDataset } from '../../../utils/datasetLineage';
import { formatDateTime } from '../common';
import type { TranslateFn } from '../common';
import { qaBadge, statusTone } from './lineageCommon';

interface TracePanelProps {
  datasets: DatasetRecord[];
  jobs: ProcessingJobRecord[];
  aggregates: StagingAggregate[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onGoGraph: () => void;
  translate: TranslateFn;
}

function datasetLinkRow(
  d: DatasetRecord,
  label: string,
  onSelectNode: (id: string | null) => void
) {
  return (
    <button
      key={`${label}-${d.id}`}
      onClick={() => d.id && onSelectNode(`ds::${d.id}`)}
      className="text-left w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-inner border border-subtle hover:border-sky-500/40 transition-colors cursor-pointer"
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-sky-300 font-bold truncate">{d.name || d.id}</span>
        <span className="block text-[10px] text-text-muted">
          {d.dataset_type} · {d.pipeline_stage || '—'}
          {d.version ? ` · v${d.version}` : ''}
        </span>
      </span>
      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${statusTone(d.status)}`}>
        {d.status || '—'}
      </span>
    </button>
  );
}

function SectionTitle({
  icon: Icon,
  children
}: {
  icon: typeof Route;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
      <Icon size={13} /> {children}
    </div>
  );
}

export function TracePanel({
  datasets,
  jobs,
  aggregates,
  selectedNodeId,
  onSelectNode,
  onGoGraph,
  translate
}: TracePanelProps) {
  const jobById = useMemo(() => {
    const m = new Map<string, ProcessingJobRecord>();
    jobs.forEach((j) => {
      if (j.id) m.set(j.id, j);
    });
    return m;
  }, [jobs]);

  const datasetById = useMemo(() => {
    const m = new Map<string, DatasetRecord>();
    datasets.forEach((d) => {
      if (d.id) m.set(d.id, d);
    });
    return m;
  }, [datasets]);

  if (!selectedNodeId) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="p-3 bg-inner rounded-2xl border border-subtle text-slate-500">
          <Route size={26} strokeWidth={1.5} />
        </div>
        <p className="text-xs text-text-muted max-w-md leading-relaxed">
          {translate('lineageTraceNone')}
        </p>
        <button
          onClick={onGoGraph}
          className="px-3 py-1.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[11px] font-bold uppercase tracking-wider cursor-pointer"
        >
          {translate('lineageTabGraph')}
        </button>
      </div>
    );
  }

  // RAW aggregate selected
  if (selectedNodeId.startsWith('raw::')) {
    const sg = selectedNodeId.slice(5);
    const agg = aggregates.find((a) => a.subgrid === sg) || {
      subgrid: sg,
      frames: 0,
      statuses: {}
    };
    const sgDatasets = datasets.filter((d) => (d.subgrid || '').toUpperCase() === sg);
    return (
      <div className="flex flex-col gap-3">
        <div className="p-4 rounded-xl bg-inner border border-amber-500/40">
          <div className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-1">
            RAW · {sg}
          </div>
          <div className="text-[11px] text-text-muted">
            {agg.frames} frames · {Object.entries(agg.statuses || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || '—'}
            {agg.captureStart && (
              <div className="mt-1">
                {formatDateTime(agg.captureStart)} → {formatDateTime(agg.captureEnd)}
              </div>
            )}
          </div>
        </div>
        <SectionTitle icon={GitCommitHorizontal}>
          {translate('lineageTraceDescendants')}
        </SectionTitle>
        <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
          {sgDatasets.length === 0 && (
            <p className="text-[11px] text-text-muted">{translate('lineageGraphEmpty')}</p>
          )}
          {sgDatasets.map((d) => datasetLinkRow(d, 'desc', onSelectNode))}
        </div>
      </div>
    );
  }

  // Job node selected
  if (selectedNodeId.startsWith('job::')) {
    const j = jobById.get(selectedNodeId.slice(5));
    if (!j) {
      return <p className="text-xs text-text-muted">{translate('lineageTraceNone')}</p>;
    }
    const source = j.source_dataset_id ? datasetById.get(j.source_dataset_id) : undefined;
    const output = j.output_dataset_id ? datasetById.get(j.output_dataset_id) : undefined;
    return (
      <div className="flex flex-col gap-3">
        <div className="p-4 rounded-xl bg-inner border border-violet-500/40">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="text-xs font-bold text-violet-300 uppercase tracking-wider">
              {j.job_type} {j.name ? `· ${j.name}` : ''}
            </div>
            <div className="flex items-center gap-2">{qaBadge(j.qa_decision, translate)}</div>
          </div>
          <div className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded border ${statusTone(j.status)}`}>
            {j.status || '—'}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2 text-[11px] text-text-muted">
            <div className="col-span-2">Subgrid: {j.subgrid || '—'}</div>
            <div>Provider: {j.provider || '—'}</div>
            <div>Software: {j.software_version || '—'}</div>
            <div>Operator: {j.operator || j.assigned_to || '—'}</div>
            <div>Progress: {j.progress ?? '—'}%</div>
            <div>Created: {formatDateTime(j.created_at)}</div>
            <div>
              {j.completed_at ? `Completed: ${formatDateTime(j.completed_at)}` : `Started: ${formatDateTime(j.started_at)}`}
            </div>
            {j.external_status && j.external_status !== 'none' && (
              <div className="col-span-2">
                External: {j.external_status}
                {j.launch_command ? ` · ${j.launch_command}` : ''}
              </div>
            )}
            {j.notes && <div className="col-span-2">Notes: {j.notes}</div>}
            {j.qa_by && (
              <div className="col-span-2">
                QA: {j.qa_by} @ {formatDateTime(j.qa_at)} — {j.qa_notes || '—'}
              </div>
            )}
          </dl>
        </div>
        {source && (
          <>
            <SectionTitle icon={Route}>{translate('lineageTraceAncestors')}</SectionTitle>
            {datasetLinkRow(source, 'src', onSelectNode)}
          </>
        )}
        {output && (
          <>
            <SectionTitle icon={GitCommitHorizontal}>{translate('lineageTraceDescendants')}</SectionTitle>
            {datasetLinkRow(output, 'out', onSelectNode)}
          </>
        )}
        {j.settings && Object.keys(j.settings).length > 0 && (
          <>
            <SectionTitle icon={Sigma}>{translate('lineageTraceSettings')}</SectionTitle>
            <pre className="text-[10px] text-sky-200/90 bg-inner border border-subtle rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(j.settings, null, 2)}
            </pre>
          </>
        )}
      </div>
    );
  }

  // Dataset node selected
  const datasetId = selectedNodeId.slice(4);
  const dataset = datasetById.get(datasetId);
  if (!dataset) {
    return <p className="text-xs text-text-muted">{translate('lineageTraceNone')}</p>;
  }
  const chain: DatasetChain = chainForDataset(datasets, jobs, aggregates, datasetId);

  return (
    <div className="flex flex-col gap-3">
      {/* Selected dataset */}
      <div className="p-4 rounded-xl bg-inner border border-sky-500/40">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
          <div className="text-xs font-bold text-sky-300">{dataset.name || dataset.id}</div>
          <div className="flex items-center gap-2">
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${statusTone(dataset.status)}`}>
              {dataset.status || '—'}
            </span>
          </div>
        </div>
        <div className="text-[10px] text-text-muted mb-2">
          {dataset.dataset_type} · {dataset.pipeline_stage || '—'}
          {dataset.version ? ` · v${dataset.version}` : ''} · {dataset.subgrid || '—'}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-text-muted">
          <div>Provider: {dataset.provider || '—'}</div>
          <div>Software: {dataset.software_version || '—'}</div>
          <div className="col-span-2">Source: {dataset.source_folder || '—'}</div>
          <div className="col-span-2">Output: {dataset.output_folder || '—'}</div>
          <div>Files: {dataset.file_count ?? '—'}</div>
          <div>Bytes: {dataset.size_bytes ? dataset.size_bytes.toLocaleString() : '—'}</div>
          <div>Registered: {formatDateTime(dataset.created_at)}</div>
          <div>Updated: {formatDateTime(dataset.updated_at)}</div>
          {dataset.parent_dataset_id && (
            <div className="col-span-2">Parent ID: {dataset.parent_dataset_id}</div>
          )}
        </dl>
      </div>

      {/* RAW source */}
      <div>
        <SectionTitle icon={CircleDot}>{translate('lineageTraceRawsource')}</SectionTitle>
        {chain.raw ? (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-inner border border-amber-500/40 cursor-pointer"
            onClick={() => onSelectNode(`raw::${chain.raw?.subgrid}`)}>
            <div>
              <div className="text-[11px] text-amber-300 font-bold">RAW · {chain.raw.subgrid}</div>
              <div className="text-[10px] text-text-muted">
                {chain.raw.frames} frames{chain.raw.captureStart ? ` · ${formatDateTime(chain.raw.captureStart)}` : ''}
              </div>
            </div>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300">
              CAPTURED
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-text-muted px-1">—</p>
        )}
      </div>

      {/* Ancestors */}
      <div>
        <SectionTitle icon={Route}>{translate('lineageTraceAncestors')}</SectionTitle>
        {chain.ancestors.length === 0 ? (
          <p className="text-[11px] text-text-muted px-1">—</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {[...chain.ancestors].reverse().map((d) => datasetLinkRow(d, 'anc', onSelectNode))}
          </div>
        )}
      </div>

      {/* Descendants */}
      <div>
        <SectionTitle icon={GitCommitHorizontal}>{translate('lineageTraceDescendants')}</SectionTitle>
        {chain.descendants.length === 0 ? (
          <p className="text-[11px] text-text-muted px-1">—</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {chain.descendants.map((d) => datasetLinkRow(d, 'desc', onSelectNode))}
          </div>
        )}
      </div>

      {/* Processing runs */}
      <div>
        <SectionTitle icon={Sigma}>{translate('lineageTraceJobs')}</SectionTitle>
        {chain.jobs.length === 0 ? (
          <p className="text-[11px] text-text-muted px-1">—</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {chain.jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => j.id && onSelectNode(`job::${j.id}`)}
                className="text-left w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-inner border border-subtle hover:border-violet-500/40 transition-colors cursor-pointer"
              >
                <span className="min-w-0">
                  <span className="block text-[11px] text-violet-300 font-bold truncate">
                    {j.job_type} {j.name ? `· ${j.name}` : ''}
                  </span>
                  <span className="block text-[10px] text-text-muted">
                    {formatDateTime(j.created_at)}
                    {j.completed_at ? ` → ${formatDateTime(j.completed_at)}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${statusTone(j.status)}`}>
                    {j.status || '—'}
                  </span>
                  {qaBadge(j.qa_decision, translate)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Deliverable */}
      <div>
        <SectionTitle icon={GitCommitHorizontal}>{translate('lineageTraceDeliverable')}</SectionTitle>
        {chain.deliverable ? (
          datasetLinkRow(chain.deliverable, 'deliv', onSelectNode)
        ) : (
          <p className="text-[11px] text-text-muted px-1">—</p>
        )}
      </div>

      {/* Repro settings */}
      <div>
        <SectionTitle icon={Sigma}>{translate('lineageTraceSettings')}</SectionTitle>
        {chain.jobs.filter((j) => j.settings && Object.keys(j.settings).length > 0).length === 0 ? (
          <p className="text-[11px] text-text-muted px-1">{translate('lineageHistorical')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {chain.jobs
              .filter((j) => j.settings && Object.keys(j.settings).length > 0)
              .map((j) => (
                <pre
                  key={j.id}
                  className="text-[10px] text-sky-200/90 bg-inner border border-subtle rounded-lg p-3 overflow-x-auto whitespace-pre-wrap"
                >
                  [{j.job_type}] {JSON.stringify(j.settings, null, 2)}
                </pre>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}