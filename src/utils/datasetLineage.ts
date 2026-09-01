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
  'BLUR',
  'STITCH',
  'ENHANCE',
  'MASK',
  'QAQC',
  'DELIVERABLE'
];

export type LineageNodeKind = 'raw' | 'dataset' | 'job';

export type LineageEdgeKind = 'parent' | 'job_source' | 'job_output' | 'raw_to_dataset' | 'stage_flow';

export interface StagingAggregate {
  id: string;
  subgrid: string;
  surveyDate?: string;
  runId?: string;
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
  surveyDate?: string;
  runId?: string;
  version?: number;
  branchKey: string;
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
  surveyDates: string[];
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
  surveyDate?: string;
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
  filename?: string;
}

function norm(path?: string): string {
  return (path || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toUpperCase();
}

/**
 * Extracts pure canonical GIS subgrid format (e.g. 'N93E70' or 'S01W104')
 * Guaranteed never to append date suffixes or run IDs.
 */
export function extractCanonicalSubgrid(value?: string): string {
  if (!value) return '';
  const clean = value.split('/').pop()?.trim() || value.trim();

  // 1. GIS coordinate syntax: NxxExx / SxxWxx
  const coordMatch = clean.match(/([NS]\d+[EW]\d+)/i);
  if (coordMatch) return coordMatch[1].toUpperCase();

  // 2. Prefix before hyphen or underscore if valid
  const prefixMatch = clean.match(/^([A-Za-z0-9]+)[-_]/);
  if (prefixMatch && prefixMatch[1].length >= 3 && !/^\d+$/.test(prefixMatch[1])) {
    return prefixMatch[1].toUpperCase();
  }

  // 3. Fallback: stripped basename
  return clean.replace(/\.[^/.]+$/, '').toUpperCase();
}

export function hasSubgrid(value?: string): boolean {
  return /^[nNsS]\d{2}[eEwW]\d{2,3}$/i.test((value || '').trim());
}

export function subgridOf(value?: string): string | undefined {
  const sg = extractCanonicalSubgrid(value);
  return sg || undefined;
}

/**
 * Extracts standard YYYY-MM-DD survey date from strings, folders, metadata or timestamps.
 */
export function extractSurveyDate(
  valueOrRecord?: any,
  fallbackTimestamp?: string
): string | undefined {
  if (!valueOrRecord) {
    if (fallbackTimestamp) {
      const match = fallbackTimestamp.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return undefined;
  }

  if (typeof valueOrRecord === 'object') {
    const d = valueOrRecord;
    const directDate =
      (d.metadata as any)?.surveyDate ||
      (d.metadata as any)?.date ||
      (d.settings as any)?.date ||
      (d.settings as any)?.surveyDate ||
      d.survey_date;
    if (directDate) {
      const parsed = extractSurveyDate(String(directDate));
      if (parsed) return parsed;
    }

    const strCandidate = [d.name, d.subgrid, d.source_folder, d.output_folder]
      .filter(Boolean)
      .join(' ');
    const fromStr = extractSurveyDate(strCandidate);
    if (fromStr) return fromStr;

    const ts = d.created_at || d.started_at || fallbackTimestamp;
    if (ts) {
      const match = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return undefined;
  }

  const str = String(valueOrRecord).trim();
  // 1. Matches YYYY-MM-DD or YYYY_MM_DD or YYYY/MM/DD
  const isoMatch = str.match(/\b(20\d{2})[-_/](0[1-9]|1[0-2])[-_/](0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. Matches compact YYYYMMDD (e.g. 20220904 in N93E70-20220904 or 003485-20220904-144310)
  const compactMatch = str.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  if (fallbackTimestamp) {
    const match = fallbackTimestamp.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }

  return undefined;
}

/**
 * Aggregates staging RAW captures per (subgrid, surveyDate) so each survey campaign
 * is a distinct provenance root.
 */
export function aggregateStagingBySubgrid(rows: StagingRowLike[]): StagingAggregate[] {
  const map = new Map<string, StagingAggregate>();
  for (const r of rows || []) {
    const sg = subgridOf(r?.subgrid);
    if (!sg) continue;
    const date = extractSurveyDate(r?.subgrid || r?.filename, r?.created_at) || 'undated';
    const key = `${sg}::${date}`;
    const rawId = `raw::${sg}::${date}`;
    const existing =
      map.get(key) || {
        id: rawId,
        subgrid: sg,
        surveyDate: date !== 'undated' ? date : undefined,
        frames: 0,
        statuses: {} as Record<string, number>
      };
    existing.frames += 1;
    const st = (r?.status || 'staged').toUpperCase();
    existing.statuses[st] = (existing.statuses[st] || 0) + 1;
    const ts = r?.created_at;
    if (ts) {
      if (!existing.captureStart || ts < existing.captureStart) existing.captureStart = ts;
      if (!existing.captureEnd || ts > existing.captureEnd) existing.captureEnd = ts;
    }
    map.set(key, existing);
  }
  return Array.from(map.values()).sort((a, b) => {
    const cmp = a.subgrid.localeCompare(b.subgrid);
    if (cmp !== 0) return cmp;
    return (b.surveyDate || '').localeCompare(a.surveyDate || '');
  });
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
  return 'MASK';
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
  const targetSubgrid = options.subgrid ? subgridOf(options.subgrid) : undefined;

  const ds = targetSubgrid ? rows.filter((d) => subgridOf(d.subgrid) === targetSubgrid) : rows;
  const js = targetSubgrid ? runs.filter((j) => subgridOf(j.subgrid) === targetSubgrid) : runs;
  const ags = targetSubgrid ? aggs.filter((a) => a.subgrid === targetSubgrid) : aggs;

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

  // 1. RAW capture aggregate nodes (Per subgrid + surveyDate)
  ags.forEach((a) => {
    const rawNodeId = a.id || `raw::${a.subgrid}::${a.surveyDate || 'default'}`;
    const branchKey = `${a.subgrid}::${a.surveyDate || 'default'}`;
    addNode({
      id: rawNodeId,
      kind: 'raw',
      label: `RAW · ${a.subgrid}`,
      layer: 'RAW',
      status: 'CAPTURED',
      subgrid: a.subgrid,
      surveyDate: a.surveyDate,
      branchKey,
      raw: a
    });
  });

  // 2. Dataset nodes
  ds.forEach((d) => {
    const canonicalSg = subgridOf(d.subgrid) || 'SUBGRID';
    const date = extractSurveyDate(d, d.created_at);
    const branchKey = `${canonicalSg}::${date || 'default'}`;
    const kind: LineageNodeKind = d.dataset_type === 'RAW' ? 'raw' : 'dataset';
    
    const label = d.name || `${d.dataset_type || 'DATASET'} · ${canonicalSg}`;

    addNode({
      id: `ds::${d.id}`,
      kind,
      label,
      layer: datasetLayer(d),
      status: d.status || 'REGISTERED',
      subgrid: canonicalSg,
      surveyDate: date,
      version: d.version,
      branchKey,
      dataset: d
    });
  });

  // 3. Job vertices
  js.forEach((j) => {
    const canonicalSg = subgridOf(j.subgrid) || 'SUBGRID';
    const date = extractSurveyDate(j, j.created_at);
    const branchKey = `${canonicalSg}::${date || 'default'}`;
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
      subgrid: canonicalSg,
      surveyDate: date,
      branchKey,
      job: j
    });

    if (sourceId) {
      addEdge({ id: `ej::${j.id}::s`, source: `ds::${sourceId}`, target: jobNodeId, kind: 'job_source' });
    }
    if (outputId) {
      addEdge({ id: `ej::${j.id}::o`, source: jobNodeId, target: `ds::${outputId}`, kind: 'job_output' });
    }
  });

  // 4. Connect Parent (versioning) edges
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

  // 5. Connect RAW staging aggregates to corresponding RAW datasets of the same survey run
  ags.forEach((a) => {
    const rawNodeId = a.id || `raw::${a.subgrid}::${a.surveyDate || 'default'}`;
    const matchingDs = ds.filter((d) => {
      const sg = subgridOf(d.subgrid);
      if (sg !== a.subgrid) return false;
      const dDate = extractSurveyDate(d, d.created_at);
      if (a.surveyDate && dDate && a.surveyDate === dDate) return true;
      return d.dataset_type === 'RAW';
    });

    const candidate = matchingDs[0] || ds.find((d) => subgridOf(d.subgrid) === a.subgrid);
    if (candidate?.id) {
      addEdge({
        id: `erad::${rawNodeId}`,
        source: rawNodeId,
        target: `ds::${candidate.id}`,
        kind: 'raw_to_dataset'
      });
    }
  });

  // 6. Connect sequential multi-station jobs belonging to the same survey branch if not explicitly linked
  const branchMap = new Map<string, LineageNode[]>();
  nodes.forEach((n) => {
    if (n.kind === 'job') {
      const arr = branchMap.get(n.branchKey) || [];
      arr.push(n);
      branchMap.set(n.branchKey, arr);
    }
  });

  branchMap.forEach((jobNodes, bKey) => {
    const stageOrder: LineageLayer[] = ['BLUR', 'STITCH', 'ENHANCE', 'MASK'];
    const sortedJobs = [...jobNodes].sort((a, b) => {
      const idxA = stageOrder.indexOf(a.layer);
      const idxB = stageOrder.indexOf(b.layer);
      if (idxA !== -idxB) return idxA - idxB;
      return (a.job?.created_at || '').localeCompare(b.job?.created_at || '');
    });

    for (let i = 0; i < sortedJobs.length - 1; i++) {
      const current = sortedJobs[i];
      const next = sortedJobs[i + 1];
      const hasDirectConnection = edges.some(
        (e) => (e.source === current.id && e.target === next.id) ||
               (e.source === current.id && edges.some((e2) => e2.source === e.target && e2.target === next.id))
      );
      if (!hasDirectConnection) {
        addEdge({
          id: `eflow::${bKey}::${current.id}::${next.id}`,
          source: current.id,
          target: next.id,
          kind: 'stage_flow'
        });
      }
    }

    // Connect final job in branch (e.g. MASK) to PROCESSED dataset in same branch
    const finalJob = sortedJobs[sortedJobs.length - 1];
    if (finalJob) {
      const processedDs = ds.find(
        (d) => d.dataset_type === 'PROCESSED' &&
               subgridOf(d.subgrid) === finalJob.subgrid &&
               (!finalJob.surveyDate || extractSurveyDate(d, d.created_at) === finalJob.surveyDate)
      );
      if (processedDs?.id) {
        addEdge({
          id: `eflow::${bKey}::${finalJob.id}::ds::${processedDs.id}`,
          source: finalJob.id,
          target: `ds::${processedDs.id}`,
          kind: 'stage_flow'
        });
      }
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
    const aggs = aggregates.filter((a) => a.subgrid === sg);
    const graph = buildLineageGraph(datasets, jobs, aggregates, { subgrid: sg });

    const totalRawFrames = aggs.reduce((sum, a) => sum + (a.frames || 0), 0);
    const surveyDatesSet = new Set<string>();
    aggs.forEach((a) => {
      if (a.surveyDate) surveyDatesSet.add(a.surveyDate);
    });
    ds.forEach((d) => {
      const dt = extractSurveyDate(d, d.created_at);
      if (dt) surveyDatesSet.add(dt);
    });
    js.forEach((j) => {
      const dt = extractSurveyDate(j, j.created_at);
      if (dt) surveyDatesSet.add(dt);
    });

    const surveyDates = Array.from(surveyDatesSet).sort();

    rows.push({
      subgrid: sg,
      datasetCount: ds.length,
      jobCount: js.length,
      rawFrames: totalRawFrames,
      rawHasCapture: aggs.length > 0,
      surveyDates,
      qaApproved: js.filter((j) => j.qa_decision === 'APPROVED').length,
      qaRejected: js.filter((j) => j.qa_decision === 'REJECTED').length,
      qaPending: js.filter(
        (j) => j.status === 'QA_PENDING' || j.status === 'REVIEW_REQUIRED'
      ).length,
      deliverableCount: ds.filter((d) => d.dataset_type === 'DELIVERABLE').length,
      refCount: ds.filter((d) => d.parent_dataset_id).length,
      orphanDatasets: findOrphans(graph).length,
      longestChain: longestChainLength(ds),
      captureStart: aggs[0]?.captureStart,
      captureEnd: aggs[aggs.length - 1]?.captureEnd
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