// =====================================================================
// datasetRegistry — the survey registry behind the Data Management
// Dataset Registry tab. Every row is real capture data that reached the
// system through one of exactly two ingress points:
//
//   'import' — a CSV survey import staged from Data Management
//              (staging_panoramas, `action: 'Imported (staging)'`)
//   'webgis' — records promoted to public.panoramas by the WebGIS
//              release gate in the production hub
//              (`action: 'Published in database'`)
//
// Rows are grouped parent subgrid → child survey records, the same
// parent→child shape the Multi PC daily processing registry uses. Point
// counts are capture points, not files: a survey record's `poiCount` is
// the number of captured panoramas, and a subgrid's total comes from the
// `subgrids.poi_count` index when one exists.
// =====================================================================

import { extractCanonicalSubgrid } from './datasetLineage';

export type RegistryChildSource = 'import' | 'webgis';
export type RegistryState = 'published' | 'staging' | 'defect' | 'mixed';

/** One survey record as produced by the Supabase capture reader. */
export interface SurveyRecordInput {
  /** `sp-d-<runKey>` when published, `staging-d-<runKey>` when staged. */
  id: string;
  /**
   * Real raw CSV file name the capture came from, e.g. `20220904.csv`. This is
   * the record name operators recognise, so it always wins over the run key.
   */
  csvFileName?: string;
  subgrid?: string;
  date?: string;
  poiCount?: number;
  imagesProcessed?: number;
  defectCount?: number;
  publishToWebGIS?: string;
  action?: string;
  pic?: string;
  grid?: string;
  kmProcessed?: number;
}

export interface SurveyRecordChild {
  key: string;
  source: RegistryChildSource;
  /** Human record label — the run key the capture was filed under. */
  name: string;
  subgrid: string;
  state: RegistryState;
  pointCapture: number;
  recordDate: string;
  /** Grid this record belongs to, e.g. `1`, `2`. */
  grid: string;
  /** True when no grid was recorded and one was assigned by subgrid order. */
  gridAssigned: boolean;
  pic?: string;
  kmProcessed: number;
  defectCount: number;
  searchText: string;
}

export interface SubgridIndexEntry {
  /** Authoritative point count for the subgrid, 0 when unknown. */
  points: number;
  /** Grid the subgrid is flown on, when the index records one. */
  grid?: string;
}

export interface RegistryNode {
  key: string;
  subgrid: string;
  unassigned: boolean;
  children: SurveyRecordChild[];
  surveyRecords: number;
  /** Subgrid point total: the `subgrids.poi_count` index, else the child sum. */
  pointCapture: number;
  /** Sum of the child records' own point counts. */
  recordedPointCapture: number;
  state: RegistryState;
  recordDate: string;
  /** Distinct grids flown on this subgrid, in ascending numeric order. */
  grids: string[];
  sources: RegistryChildSource[];
}

export interface RegistryTotals {
  subgrids: number;
  surveyRecords: number;
  pointCapture: number;
  imported: number;
  released: number;
}

const numeric = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const time = (value?: string | null): number => {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const isPublished = (r: SurveyRecordInput): boolean =>
  (r.publishToWebGIS || '').trim().toLowerCase() === 'yes' ||
  (r.action || '').toLowerCase().includes('published');

/** A flagged point wins over the published flag, exactly as the map colours it. */
export function surveyRecordState(r: SurveyRecordInput): RegistryState {
  if (numeric(r.defectCount) > 0) return 'defect';
  return isPublished(r) ? 'published' : 'staging';
}

/** `staging-d-L20220904` → `L20220904`. */
export function surveyRecordLabel(id?: string | null): string {
  const raw = (id || '').trim();
  const stripped = raw.replace(/^(staging-d|sp-d)-/, '');
  return stripped || raw || '—';
}

const mergeState = (states: RegistryState[]): RegistryState => {
  if (states.length === 0) return 'staging';
  const distinct = Array.from(new Set(states));
  return distinct.length === 1 ? distinct[0] : 'mixed';
};

/** `N93E70_L20220904` → `L20220904`, so the row shows the survey record only. */
const stripSubgridPrefix = (label: string, subgrid: string): string => {
  if (!subgrid || !label) return label;
  for (const sep of ['_', '-']) {
    const prefix = `${subgrid}${sep}`;
    if (label.slice(0, prefix.length).toUpperCase() === prefix.toUpperCase()) {
      return label.slice(prefix.length) || label;
    }
  }
  return label;
};

export interface SurveyRegistryInput {
  records: SurveyRecordInput[];
  /** Canonical subgrid → subgrid index facts, when the index is available. */
  subgridIndex?: Record<string, SubgridIndexEntry>;
}

const gridLabel = (value?: string | number | null): string => {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  return raw;
};

const compareGrids = (a: string, b: string): number => {
  const na = Number(a);
  const nb = Number(b);
  const bothNumeric = Number.isFinite(na) && Number.isFinite(nb) && a !== '' && b !== '';
  if (bothNumeric) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
};

export function buildSurveyRegistry({
  records,
  subgridIndex
}: SurveyRegistryInput): { nodes: RegistryNode[]; totals: RegistryTotals } {
  const nodes = new Map<string, RegistryNode>();

  const nodeFor = (rawSubgrid: string): RegistryNode => {
    const clean = (rawSubgrid || '').trim();
    const unassigned = !clean;
    const key = unassigned ? '__unassigned__' : clean.toUpperCase();
    let node = nodes.get(key);
    if (!node) {
      node = {
        key,
        subgrid: unassigned ? '— unassigned —' : key,
        unassigned,
        children: [],
        surveyRecords: 0,
        pointCapture: 0,
        recordedPointCapture: 0,
        state: 'staging',
        recordDate: '',
        grids: [],
        sources: []
      };
      nodes.set(key, node);
    }
    return node;
  };

  // Records are grouped per subgrid first so a record without a recorded grid
  // can be assigned the next grid number for that subgrid (1, 2, 3 …) instead
  // of being left blank.
  const bySubgrid = new Map<string, SurveyRecordInput[]>();
  (records || []).forEach((r) => {
    if (!r) return;
    const subgrid = extractCanonicalSubgrid(r.subgrid);
    const bucket = bySubgrid.get(subgrid) || [];
    bucket.push(r);
    bySubgrid.set(subgrid, bucket);
  });

  bySubgrid.forEach((bucket, subgrid) => {
    const node = nodeFor(subgrid);
    const indexedGrid = gridLabel(subgridIndex?.[subgrid]?.grid);
    let nextFreeGrid = 1;
    const usedGrids = new Set<string>();

    const claimGrid = (explicit?: string | number | null): { grid: string; assigned: boolean } => {
      const grid = gridLabel(explicit);
      if (grid) return { grid, assigned: false };
      if (indexedGrid) return { grid: indexedGrid, assigned: false };
      while (usedGrids.has(String(nextFreeGrid))) nextFreeGrid += 1;
      return { grid: String(nextFreeGrid), assigned: true };
    };

    bucket.forEach((r) => {
      const { grid, assigned } = claimGrid(r.grid);
      usedGrids.add(grid);
      const pointCapture = numeric(r.poiCount) || numeric(r.imagesProcessed);
      const state = surveyRecordState(r);
      const label = stripSubgridPrefix(r.csvFileName || surveyRecordLabel(r.id), subgrid);
      node.children.push({
        key: r.id || `${subgrid}::${label}`,
        source: isPublished(r) ? 'webgis' : 'import',
        name: label,
        subgrid: subgrid || (r.subgrid || '').trim().toUpperCase(),
        state,
        pointCapture,
        recordDate: r.date || '',
        grid,
        gridAssigned: assigned,
        pic: r.pic,
        kmProcessed: numeric(r.kmProcessed),
        defectCount: numeric(r.defectCount),
        searchText: [label, r.csvFileName, r.id, r.subgrid, r.pic, grid, r.action, r.publishToWebGIS]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
      });
      node.surveyRecords += 1;
      node.recordedPointCapture += pointCapture;
      if (time(r.date) > time(node.recordDate)) node.recordDate = r.date || '';
    });
  });

  const list = Array.from(nodes.values());
  list.forEach((node) => {
    node.children.sort((a, b) => time(b.recordDate) - time(a.recordDate) || a.name.localeCompare(b.name));
    node.state = mergeState(node.children.map((c) => c.state));
    node.grids = Array.from(new Set(node.children.map((c) => c.grid).filter(Boolean))).sort(compareGrids);
    node.sources = node.children.reduce<RegistryChildSource[]>(
      (acc, c) => (acc.includes(c.source) ? acc : [...acc, c.source]),
      []
    );
    const indexed = numeric(subgridIndex?.[node.key]?.points);
    node.pointCapture = indexed > 0 ? indexed : node.recordedPointCapture;
  });
  list.sort((a, b) => time(b.recordDate) - time(a.recordDate) || a.subgrid.localeCompare(b.subgrid));

  const totals = list.reduce<RegistryTotals>(
    (acc, n) => ({
      subgrids: acc.subgrids + (n.unassigned ? 0 : 1),
      surveyRecords: acc.surveyRecords + n.surveyRecords,
      pointCapture: acc.pointCapture + n.pointCapture,
      imported: acc.imported + n.children.filter((c) => c.source === 'import').length,
      released: acc.released + n.children.filter((c) => c.source === 'webgis').length
    }),
    { subgrids: 0, surveyRecords: 0, pointCapture: 0, imported: 0, released: 0 }
  );

  return { nodes: list, totals };
}

export interface RegistryFilter {
  search: string;
  source: 'all' | RegistryChildSource;
  state: 'all' | RegistryState;
}

/** Search and filters apply per record, so a parent only survives if a child does. */
export function filterRegistryNodes(
  nodes: RegistryNode[],
  { search, source, state }: Partial<RegistryFilter>
): RegistryNode[] {
  const q = (search || '').trim().toLowerCase();
  const sourceFilter = source || 'all';
  const stateFilter = state || 'all';
  return nodes
    .map((node) => {
      const children = node.children.filter((child) => {
        if (sourceFilter !== 'all' && child.source !== sourceFilter) return false;
        if (stateFilter !== 'all' && child.state !== stateFilter) return false;
        if (q && !child.searchText.includes(q) && !node.subgrid.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });
      if (children.length === 0) return null;
      return { ...node, children };
    })
    .filter((n): n is RegistryNode => n !== null);
}
