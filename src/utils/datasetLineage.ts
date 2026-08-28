// =====================================================================
// Dataset Lineage builder — Data Lineage workspace (Phase 5)
// Builds a layered DAG from datasets + processing jobs + RAW staging.
// Dashboard is metadata-only: image bytes never leave the NAS.
// =====================================================================

import type { DatasetRecord, ProcessingJobRecord } from '../types/production';

export type LineageLayer =
  | 'RAW'
  | 'STITCH'
  | 'BLUR'
  | 'ENHANCE'
  | 'MASK'
  | 'QAQC'
  | 'DELIVERABLE';

export const LINEAGE_LAYERS: LineageLayer[] = [
  'RAW',
  'STITCH',
  'BLUR',
  'ENHANCE',
  'MASK',
  'QAQC',
  'DELIVERABLE'
];

export type LineageNodeKind = 'raw' | 'dataset' | 'job';

export type LineageEdgeKind = 'parent' | 'job_source' | 'job_output' | 'raw_to_dataset';

export interface StagingAggregate {
  subgrid: string;
  frames: number;
  captureStart?: string;
  captureEnd?: string;
  statuses: Record<string, number>;
}

export interface LineageNode {
  id: string;
  kind: LineageNodeKind;
  label: string;
  layer: LineageLayer;
  status: string;
  qaDecision?: string | null;
  subgrid?: string;
  dataset?: DatasetRecord;
  job?: ProcessingJobRecord;
  raw?: StagingAggregate;
}

export interface LineageEdge {
  id: string;
  source: string;
  target: string;
  kind: LineageEdgeKind;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  layers: LineageLayer[];
}

export interface LineageSummaryRow {
  subgrid: string;
  datasetCount: number;
  jobCount: number;
  rawFrames: number;
  rawHasCapture: boolean;
  qaApproved: number;
  qaRejected: number;
  qaPending: number;
  deliverableCount: number;
  refCount: number;
  orphanDatasets: number;
  longestChain: number;
  captureStart?: string;
  captureEnd?: string;
}

export interface DatasetChain {
  ancestors: DatasetRecord[];
  descendants: DatasetRecord[];
  jobs: ProcessingJobRecord[];
  raw?: StagingAggregate;
  deliverable?: DatasetRecord;
}

export interface LineageProvenance {
  dataset?: DatasetRecord;
  jobs: ProcessingJobRecord[];
  provider?: string;
  software_version?: string;
  source_folder?: string;
  output_folder?: string;
  settingsBlocks: Array<{
    job_type: string;
    name?: string;
    settings: Record<string, unknown>;
    qa_decision?: string | null;
    qa_by?: string;
    qa_at?: string | null;
  }>;
  raw?: StagingAggregate;
}

interface StagingRowLike {
  subgrid?: string;
  status?: string;
  created_at?: string;
}

function norm(path?: string): string {
  return (path || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toUpperCase();
}

export function hasSubgrid(value?: string): boolean {
  return /^[nNsS]\d{2}[eEwW]\d{2,3}$/i.test((value || '').trim());
}

export function subgridOf(value?: string): string | undefined {
  if (hasSubgrid(value)) return value!.trim().toUpperCase();
  const cleaned = (value || '').trim().toUpperCase();
  return cleaned || undefined;
}

export function aggregateStagingBySubgrid(rows: StagingRowLike[]): StagingAggregate[] {
  const map = new Map<string, StagingAggregate>();
  for (const r of rows || []) {
    const sg = subgridOf(r?.subgrid);
    if (!sg) continue;
    const existing =
      map.get(sg) || { subgrid: sg, frames: 0, statuses: {} as Record<string, number> };
    existing.frames += 1;
    const st = (r?.status || 'staged').toUpperCase();
    existing.statuses[st] = (existing.statuses[st] || 0) + 1;
    const ts = r?.created_at;
    if (ts) {
      if (!existing.captureStart || ts < existing.captureStart) existing.captureStart = ts;
      if (!existing.captureEnd || ts > existing.captureEnd) existing.captureEnd = ts;
    }
    map.set(sg, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.subgrid.localeCompare(b.subgrid));
}

const JOB_LAYER: Record<ProcessingJobRecord['job_type'], LineageLayer> = {
  STITCH: 'STITCH',
  BLUR: 'BLUR',
  ENHANCE: 'ENHANCE',
  MASK: 'MASK',
  QAQC: 'QAQC',
  REPORT: 'DELIVERABLE',
  EXPORT: 'DELIVERABLE',
  AI_DETECT: 'QAQC'
};

function datasetLayer(d: DatasetRecord): LineageLayer {
  if (d.dataset_type === 'RAW') return 'RAW';
  if (d.dataset_type === 'DELIVERABLE') return 'DELIVERABLE';
  if (d.pipeline_stage && LINEAGE_LAYERS.indexOf(d.pipeline_stage as LineageLayer) !== -1) {
    return d.pipeline_stage as LineageLayer;
  }
  return 'ENHANCE';
}

export interface BuildLineageOptions {
  subgrid?: string | null;
}

export function buildLineageGraph(
  datasets: DatasetRecord[],
  jobs: ProcessingJobRecord[],
  aggregates: StagingAggregate[],
  options: BuildLineageOptions = {}
): LineageGraph {
  const rows = datasets || [];
  const runs = jobs || [];
  const aggs = aggregates || [];
  const subgridFilter = options.subgrid ? subgridOf(options.subgrid) : undefined;

  const ds = subgridFilter ? rows.filter((d) => subgridOf(d.subgrid) === subgridFilter) : rows;
  const js = subgridFilter ? runs.filter((j) => subgridOf(j.subgrid) === subgridFilter) : runs;
  const ags = subgridFilter ? aggs.filter((a) => a.subgrid === subgridFilter) : aggs;

  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  const nodeIds = new Set<string>();

  const byId = new Map<string, DatasetRecord>();
  ds.forEach((d) => {
    if (d.id) byId.set(d.id, d);
  });

  const byFolderOut = new Map<string, DatasetRecord>();
  const byFolderIn = new Map<string, DatasetRecord[]>();
  ds.forEach((d) => {
    if (d.output_folder) {
      byFolderOut.set(norm(d.output_folder), d);
    }
    const kIn = norm(d.source_folder);
    if (kIn) {
      const arr = byFolderIn.get(kIn) || [];
      arr.push(d);
      byFolderIn.set(kIn, arr);
    }
  });

  const addNode = (n: LineageNode) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };

  const addEdge = (e: LineageEdge) => {
    if (e.source === e.target) return;
    const dup = edges.some(
      (x) => x.source === e.source && x.target === e.target && x.kind === e.kind
    );
    if (!dup) edges.push(e);
  };

  // RAW capture aggregate nodes (survey → publish origin)
  ags.forEach((a) => {
    addNode({
      id: `raw::${a.subgrid}`,
      kind: 'raw',
      label: `RAW · ${a.subgrid}`,
      layer: 'RAW',
      status: 'CAPTURED',
      subgrid: a.subgrid,
      raw: a
    });
  });

  // Dataset nodes (RAW datasets also live on the RAW layer)
  ds.forEach((d) => {
    const kind: LineageNodeKind = d.dataset_type === 'RAW' ? 'raw' : 'dataset';
    addNode({
      id: `ds::${d.id}`,
      kind,
      label: d.name || d.id || 'Dataset',
      layer: datasetLayer(d),
      status: d.status || 'REGISTERED',
      subgrid: d.subgrid,
      dataset: d
    });
  });

  // Job vertices placed between their source and output datasets
  js.forEach((j) => {
    const jLayer = JOB_LAYER[j.job_type] || 'ENHANCE';
    let sourceId: string | undefined;
    let outputId: string | undefined;

    if (j.source_dataset_id && byId.has(j.source_dataset_id)) sourceId = j.source_dataset_id;
    if (j.output_dataset_id && byId.has(j.output_dataset_id)) outputId = j.output_dataset_id;

    if (!sourceId && j.source_folder) {
      const k = norm(j.source_folder);
      const hit = byFolderOut.get(k);
      const alt = byFolderIn.get(k)?.[0];
      sourceId = hit?.id || alt?.id;
    }
    if (!outputId && j.output_folder) {
      const outs = byFolderIn.get(norm(j.output_folder));
      if (outs && outs[0].id) outputId = outs[0].id;
    }

    const jobNodeId = `job::${j.id}`;
    addNode({
      id: jobNodeId,
      kind: 'job',
      label: j.name ? `${j.job_type} · ${j.name}` : j.job_type,
      layer: jLayer,
      status: j.status || 'PENDING',
      qaDecision: j.qa_decision || null,
      subgrid: j.subgrid,
      job: j
    });

    if (sourceId || outputId) {
      if (sourceId) {
        addEdge({ id: `ej::${j.id}::s`, source: `ds::${sourceId}`, target: jobNodeId, kind: 'job_source' });
      }
      if (outputId) {
        addEdge({ id: `ej::${j.id}::o`, source: jobNodeId, target: `ds::${outputId}`, kind: 'job_output' });
      }
    }
  });

  // Parent (version / refinement) edges between datasets
  ds.forEach((d) => {
    if (d.parent_dataset_id && byId.has(d.parent_dataset_id)) {
      addEdge({
        id: `ep::${d.id}`,
        source: `ds::${d.parent_dataset_id}`,
        target: `ds::${d.id}`,
        kind: 'parent'
      });
    }
  });

  // RAW aggregate → earliest dataset of that subgrid (survey → publish trace)
  const dsBySubgrid = new Map<string, DatasetRecord[]>();
  ds.forEach((d) => {
    const sg = subgridOf(d.subgrid);
    if (!sg) return;
    const arr = dsBySubgrid.get(sg) || [];
    arr.push(d);
    dsBySubgrid.set(sg, arr);
  });

  ags.forEach((a) => {
    const arr = dsBySubgrid.get(a.subgrid);
    if (!arr || arr.length === 0) return;
    const sorted = [...arr].sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''));
    const hasIncoming = (id?: string) =>
      edges.some((e) => e.target === `ds::${id}`);
    const candidate =
      sorted.find((d) => !hasIncoming(d.id) && d.dataset_type === 'RAW') ||
      sorted.find((d) => !hasIncoming(d.id));
    if (candidate && candidate.id) {
      addEdge({
        id: `erad::${a.subgrid}`,
        source: `raw::${a.subgrid}`,
        target: `ds::${candidate.id}`,
        kind: 'raw_to_dataset'
      });
    }
  });

  return { nodes, edges, layers: LINEAGE_LAYERS };
}

export function findOrphans(graph: LineageGraph): LineageNode[] {
  return graph.nodes.filter((n) => {
    if (n.kind === 'raw') return false;
    return graph.edges.every((e) => e.source !== n.id && e.target !== n.id);
  });
}

function longestChainLength(ds: DatasetRecord[]): number {
  const byId = new Map<string, DatasetRecord>();
  ds.forEach((d) => {
    if (d.id) byId.set(d.id, d);
  });
  const depth = new Map<string, number>();
  const depthOf = (id?: string | null): number => {
    if (!id || !byId.has(id)) return 0;
    if (depth.has(id)) return depth.get(id)!;
    const d = byId.get(id)!;
    const v = 1 + depthOf(d.parent_dataset_id);
    depth.set(id, v);
    return v;
  };
  let max = 0;
  ds.forEach((d) => {
    if (d.id) max = Math.max(max, depthOf(d.id));
  });
  return max;
}

export function lineageSummary(
  datasets: DatasetRecord[],
  jobs: ProcessingJobRecord[],
  aggregates: StagingAggregate[]
): LineageSummaryRow[] {
  const subgrids = new Set<string>();
  datasets.forEach((d) => {
    const sg = subgridOf(d.subgrid);
    if (sg) subgrids.add(sg);
  });
  jobs.forEach((j) => {
    const sg = subgridOf(j.subgrid);
    if (sg) subgrids.add(sg);
  });
  aggregates.forEach((a) => subgrids.add(a.subgrid));

  const rows: LineageSummaryRow[] = [];
  subgrids.forEach((sg) => {
    const ds = datasets.filter((d) => subgridOf(d.subgrid) === sg);
    const js = jobs.filter((j) => subgridOf(j.subgrid) === sg);
    const agg = aggregates.find((a) => a.subgrid === sg);
    const graph = buildLineageGraph(datasets, jobs, aggregates, { subgrid: sg });

    rows.push({
      subgrid: sg,
      datasetCount: ds.length,
      jobCount: js.length,
      rawFrames: agg?.frames || 0,
      rawHasCapture: !!agg,
      qaApproved: js.filter((j) => j.qa_decision === 'APPROVED').length,
      qaRejected: js.filter((j) => j.qa_decision === 'REJECTED').length,
      qaPending: js.filter(
        (j) => j.status === 'QA_PENDING' || j.status === 'REVIEW_REQUIRED'
      ).length,
      deliverableCount: ds.filter((d) => d.dataset_type === 'DELIVERABLE').length,
      refCount: ds.filter((d) => d.parent_dataset_id).length,
      orphanDatasets: findOrphans(graph).length,
      longestChain: longestChainLength(ds),
      captureStart: agg?.captureStart,
      captureEnd: agg?.captureEnd
    });
  });

  return rows.sort((a, b) => a.subgrid.localeCompare(b.subgrid));
}

export function chainForDataset(
  datasets: DatasetRecord[],
  jobs: ProcessingJobRecord[],
  aggregates: StagingAggregate[],
  datasetId: string
): DatasetChain {
  const byId = new Map<string, DatasetRecord>();
  datasets.forEach((d) => {
    if (d.id) byId.set(d.id, d);
  });

  const target = byId.get(datasetId);
  const ancestors: DatasetRecord[] = [];
  if (target) {
    let cur = target.parent_dataset_id ? byId.get(target.parent_dataset_id) : undefined;
    while (cur) {
      ancestors.push(cur);
      cur = cur.parent_dataset_id ? byId.get(cur.parent_dataset_id) : undefined;
    }
  }

  const descendants: DatasetRecord[] = [];
  let frontier = [datasetId];
  const seen = new Set(frontier);
  while (frontier.length > 0) {
    const next: string[] = [];
    datasets.forEach((d) => {
      if (
        d.parent_dataset_id &&
        frontier.includes(d.parent_dataset_id) &&
        d.id &&
        !seen.has(d.id)
      ) {
        seen.add(d.id);
        next.push(d.id);
        descendants.push(d);
      }
    });
    frontier = next;
  }

  const jobsTouch = jobs.filter(
    (j) => j.source_dataset_id === datasetId || j.output_dataset_id === datasetId
  );
  const sg = subgridOf(target?.subgrid);
  const raw = aggregates.find((a) => a.subgrid === sg);
  const deliverable = datasets.find(
    (d) => d.dataset_type === 'DELIVERABLE' && subgridOf(d.subgrid) === sg
  );

  return { ancestors, descendants, jobs: jobsTouch, raw, deliverable };
}

export function provenanceOf(
  dataset: DatasetRecord | undefined,
  jobs: ProcessingJobRecord[],
  aggregates: StagingAggregate[]
): LineageProvenance {
  if (!dataset) {
    return { jobs: [], settingsBlocks: [] };
  }
  const sg = subgridOf(dataset.subgrid);
  const related = jobs.filter(
    (j) =>
      j.source_dataset_id === dataset.id ||
      j.output_dataset_id === dataset.id ||
      (sg && j.subgrid && subgridOf(j.subgrid) === sg)
  );
  const settingsBlocks = related
    .filter((j) => j.settings && Object.keys(j.settings).length > 0)
    .map((j) => ({
      job_type: j.job_type,
      name: j.name,
      settings: j.settings as unknown as Record<string, unknown>,
      qa_decision: j.qa_decision,
      qa_by: j.qa_by,
      qa_at: j.qa_at
    }));

  return {
    dataset,
    jobs: related,
    provider: dataset.provider,
    software_version: dataset.software_version,
    source_folder: dataset.source_folder,
    output_folder: dataset.output_folder,
    settingsBlocks,
    raw: aggregates.find((a) => a.subgrid === sg)
  };
}