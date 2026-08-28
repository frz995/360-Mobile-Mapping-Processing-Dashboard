// =====================================================================
// Safe Data Deletion impact preview — computed fully on the client from
// metadata already present in the Data Management workspace.
// =====================================================================

export type DeletionMode = 'single' | 'bulk' | 'spatial';

export interface DailyTimeSeriesLike {
  subgrid?: string;
  grid?: string;
  kmProcessed?: number;
  imagesProcessed?: number;
  availableImagesCount?: number;
  poiCount?: number;
  defectCount?: number;
  publishToWebGIS?: string;
  isSyncedWithSupabase?: boolean;
}

export interface BatchLogLike {
  subgrid?: string;
  imageFilename?: string;
  images?: number;
  availableImagesCount?: number;
  poiCount?: number;
  defects?: number;
  kmProcessed?: number;
  publishToWebGIS?: string;
  isSyncedWithSupabase?: boolean;
}

export interface DatasetRecordLike {
  id?: string;
  name?: string;
  subgrid?: string;
  dataset_type?: string;
  file_count?: number;
  size_bytes?: number;
  version?: number;
  parent_dataset_id?: string | null;
}

export interface ProcessingJobLike {
  id?: string;
  name?: string;
  job_type?: string;
  subgrid?: string;
  source_dataset_id?: string | null;
  output_dataset_id?: string | null;
  status?: string;
  qa_decision?: string | null;
}

export interface StagingAggregateLike {
  subgrid?: string;
  frames?: number;
}

export interface ImpactRow {
  subgrid: string;
  runs: number;
  batch: number;
  poi: number;
  frames: number;
  km: number;
  defects: number;
  published: number;
  staging: number;
  qa: number;
  datasets: number;
  deliverables: number;
  jobs: number;
  relatedNames: string[];
  deliverableNames: string[];
  jobNames: string[];
}

export interface DeletionImpactTotals {
  subgrids: number;
  runs: number;
  batch: number;
  poi: number;
  frames: number;
  km: number;
  defects: number;
  published: number;
  staging: number;
  qa: number;
  datasets: number;
  deliverables: number;
  jobs: number;
}

export interface DeletionImpact {
  mode: DeletionMode;
  rows: ImpactRow[];
  totals: DeletionImpactTotals;
  warnings: string[];
  hasPublished: boolean;
  hasDeliverables: boolean;
  hasLinkedJobs: boolean;
  hasOrphanRisk: boolean;
}

function normSub(value?: string): string {
  return (value || '').trim().toUpperCase();
}

function sgOf(value?: string): string {
  return normSub(value);
}

export function computeDeletionImpact(params: {
  mode: DeletionMode;
  subgrids: string[];
  dailyData: DailyTimeSeriesLike[];
  batchLogs: BatchLogLike[];
  qaRecords?: Record<string, unknown>;
  stagingAggregates?: StagingAggregateLike[];
  datasets?: DatasetRecordLike[];
  jobs?: ProcessingJobLike[];
}): DeletionImpact {
  const {
    mode,
    subgrids,
    dailyData = [],
    batchLogs = [],
    qaRecords,
    stagingAggregates = [],
    datasets = [],
    jobs = []
  } = params;

  const target = new Set(subgrids.map(normSub));

  const dailyFor = (sg: string) =>
    dailyData.filter((d) => sgOf(d.subgrid) === sg);
  const batchFor = (sg: string) =>
    batchLogs.filter(
      (b) => sgOf(b.subgrid) || sgOf(b.imageFilename) === sg
    );

  const datasetsFor = (sg: string) =>
    datasets.filter((d) => sgOf(d.subgrid) === sg);

  const diskIdsFor = (sg: string) => {
    const ids = new Set<string>();
    datasetsFor(sg).forEach((d) => d.id && ids.add(d.id));
    return ids;
  };

  const jobsFor = (sg: string) => {
    const ids = diskIdsFor(sg);
    return jobs.filter((j) => {
      if (sgOf(j.subgrid) === sg) return true;
      if (j.source_dataset_id && ids.has(j.source_dataset_id)) return true;
      if (j.output_dataset_id && ids.has(j.output_dataset_id)) return true;
      return false;
    });
  };

  const stagingFor = (sg: string) =>
    stagingAggregates.filter((a) => sgOf(a.subgrid) === sg).reduce((s, a) => s + (a.frames || 0), 0);

  const qaFor = (sg: string) => {
    if (!qaRecords) return 0;
    return Object.keys(qaRecords).filter((k) => {
      const key = normSub(k);
      return key === sg || key.startsWith(sg) || key.endsWith(sg);
    }).length;
  };

  const rows: ImpactRow[] = [];
  const totals: DeletionImpactTotals = {
    subgrids: 0,
    runs: 0,
    batch: 0,
    poi: 0,
    frames: 0,
    km: 0,
    defects: 0,
    published: 0,
    staging: 0,
    qa: 0,
    datasets: 0,
    deliverables: 0,
    jobs: 0
  };

  const warnings: string[] = [];

  Array.from(target)
    .sort()
    .forEach((sg) => {
      const runs = dailyFor(sg);
      const batches = batchFor(sg);
      const ds = datasetsFor(sg);
      const js = jobsFor(sg);
      const deliverables = ds.filter((d) => d.dataset_type === 'DELIVERABLE');

      const poi = runs.reduce((s, r) => s + (r.poiCount || 0), 0) +
        batches.reduce((s, b) => s + (b.poiCount || 0), 0);
      const frames = runs.reduce((s, r) => s + (r.availableImagesCount ?? r.imagesProcessed ?? 0), 0) +
        batches.reduce((s, b) => s + (b.availableImagesCount ?? b.images ?? 0), 0);
      const km = runs.reduce((s, r) => s + (r.kmProcessed || 0), 0) +
        batches.reduce((s, b) => s + (b.kmProcessed || 0), 0);
      const defects = runs.reduce((s, r) => s + (r.defectCount || 0), 0) +
        batches.reduce((s, b) => s + (b.defects || 0), 0);
      const published = runs.filter(
        (r) => r.publishToWebGIS === 'yes' || r.isSyncedWithSupabase
      ).length +
      batches.filter(
        (b) => b.publishToWebGIS === 'yes' || b.isSyncedWithSupabase
      ).length;

      const row: ImpactRow = {
        subgrid: sg,
        runs: runs.length,
        batch: batches.length,
        poi,
        frames,
        km: Math.round(km * 100) / 100,
        defects,
        published,
        staging: stagingFor(sg),
        qa: qaFor(sg),
        datasets: ds.length,
        deliverables: deliverables.length,
        jobs: js.length,
        relatedNames: ds.map((d) => d.name || '—'),
        deliverableNames: deliverables.map((d) => d.name || '—'),
        jobNames: js.map((j) => j.name || j.job_type || '—')
      };
      rows.push(row);

      totals.subgrids += 1;
      totals.runs += row.runs;
      totals.batch += row.batch;
      totals.poi += row.poi;
      totals.frames += row.frames;
      totals.km += row.km;
      totals.defects += row.defects;
      totals.published += row.published;
      totals.staging += row.staging;
      totals.qa += row.qa;
      totals.datasets += row.datasets;
      totals.deliverables += row.deliverables;
      totals.jobs += row.jobs;

      if (row.published > 0) {
        warnings.push(
          `${sg}: ${row.published} record(s) are already published to WebGIS / synchronised to the database. Re-publishing after deletion would be required.`
        );
      }
      if (row.deliverables > 0) {
        warnings.push(
          `${sg}: deleting this survey data leaves ${row.deliverables} DELIVERABLE dataset(s) orphaned — ${row.deliverableNames.join(', ')}.`
        );
      }
      if (row.jobs > 0) {
        warnings.push(
          `${sg}: ${row.jobs} processing job(s) reference this data — ${row.jobNames.join(', ')}.`
        );
      }
      if (row.staging > 0) {
        warnings.push(
          `${sg}: ${row.staging} RAW capture frame(s) remain in staging and are NOT removed by this action.`
        );
      }
    });

  const hasPublished = totals.published > 0;
  const hasDeliverables = totals.deliverables > 0;
  const hasLinkedJobs = totals.jobs > 0;
  const hasOrphanRisk = totals.staging > 0;

  if (rows.length === 0) {
    warnings.unshift('No survey records found for the selected subgrid(s).');
  }

  return {
    mode,
    rows,
    totals,
    warnings,
    hasPublished,
    hasDeliverables,
    hasLinkedJobs,
    hasOrphanRisk
  };
}