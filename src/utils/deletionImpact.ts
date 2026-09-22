import { extractSubgridName } from './subgrid';
import { getItemId } from './items';

// =====================================================================
// Safe Data Deletion impact preview — computed fully on the client from
// metadata already present in the Data Management workspace.
// Supports hierarchical Parent (Masterlist batch) vs Child (Daily run)
// distinction so deletion impact matches the exact active layer.
// =====================================================================

export type DeletionMode = 'single' | 'bulk' | 'spatial';

export interface DailyTimeSeriesLike {
  id?: string;
  _id?: string;
  runId?: string;
  subgrid?: string;
  grid?: string;
  date?: string;
  kmProcessed?: number;
  imagesProcessed?: number;
  availableImagesCount?: number;
  availableFilenames?: string[];
  poiCount?: number;
  defectCount?: number;
  imagesDefected?: number;
  captureEquipment?: string;
  publishToWebGIS?: string;
  isSyncedWithSupabase?: boolean;
  panoramas?: any[];
}

export interface BatchLogLike {
  id?: string;
  _id?: string;
  subgrid?: string;
  grid?: string;
  date?: string;
  imageFilename?: string;
  images?: number;
  availableImagesCount?: number;
  availableFilenames?: string[];
  poiCount?: number;
  defects?: number;
  defectCount?: number;
  kmProcessed?: number;
  publishToWebGIS?: string;
  isSyncedWithSupabase?: boolean;
  status?: string;
  runsCount?: number;
  publishedRunsCount?: number;
  panoramas?: any[];
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

export interface ComputeDeletionImpactParams {
  mode: DeletionMode;
  subgrids: string[];
  dailyData: DailyTimeSeriesLike[];
  batchLogs: BatchLogLike[];
  qaRecords?: Record<string, unknown>;
  stagingAggregates?: StagingAggregateLike[];
  datasets?: DatasetRecordLike[];
  jobs?: ProcessingJobLike[];
  fallbackRecord?: DailyTimeSeriesLike | BatchLogLike;
  targetRecord?: DailyTimeSeriesLike | BatchLogLike | null;
  sourceTab?: 'batches' | 'daily' | 'datasets' | 'recovery' | string;
  selectedIds?: Set<string>;
}

function normSub(value?: string): string {
  return (value || '').trim().toUpperCase();
}

function matchesSubgrid(value: string | undefined, targetSg: string): boolean {
  if (!value || !targetSg) return false;
  const vNorm = normSub(value);
  const tNorm = normSub(targetSg);
  if (vNorm === tNorm) return true;
  const vExt = extractSubgridName(value).toUpperCase().trim();
  const tExt = extractSubgridName(targetSg).toUpperCase().trim();
  if (vExt && tExt && vExt === tExt) return true;
  if (vExt && vExt === tNorm) return true;
  if (tExt && vNorm === tExt) return true;
  return false;
}

export function extractPoiCount(item?: any): number {
  if (!item) return 0;
  if (typeof item.poiCount === 'number' && item.poiCount >= 0) {
    return item.poiCount;
  }
  if (Array.isArray(item.panoramas) && item.panoramas.length > 0) {
    return item.panoramas.length;
  }
  if (typeof item.imagesProcessed === 'number' && item.imagesProcessed >= 0) {
    return item.imagesProcessed;
  }
  if (typeof item.images === 'number' && item.images >= 0) {
    return item.images;
  }
  if (typeof item.availableImagesCount === 'number' && item.availableImagesCount >= 0) {
    return item.availableImagesCount;
  }
  return 0;
}

export function extractFramesCount(item?: any): number {
  if (!item) return 0;
  if (typeof item.availableImagesCount === 'number' && item.availableImagesCount >= 0) {
    return item.availableImagesCount;
  }
  if (typeof item.imagesProcessed === 'number' && item.imagesProcessed >= 0) {
    return item.imagesProcessed;
  }
  if (typeof item.images === 'number' && item.images >= 0) {
    return item.images;
  }
  return extractPoiCount(item);
}

export function computeDeletionImpact(params: ComputeDeletionImpactParams): DeletionImpact {
  const {
    mode,
    subgrids,
    dailyData = [],
    batchLogs = [],
    qaRecords,
    stagingAggregates = [],
    datasets = [],
    jobs = [],
    fallbackRecord,
    targetRecord,
    sourceTab,
    selectedIds
  } = params;

  const target = new Set(subgrids.map(normSub));

  const dailyFor = (sg: string) =>
    dailyData.filter((d) => matchesSubgrid(d.subgrid, sg));
  const batchFor = (sg: string) =>
    batchLogs.filter(
      (b) => matchesSubgrid(b.subgrid, sg) || matchesSubgrid(b.imageFilename, sg)
    );

  const datasetsFor = (sg: string) =>
    datasets.filter((d) => matchesSubgrid(d.subgrid, sg));

  const diskIdsFor = (sg: string) => {
    const ids = new Set<string>();
    datasetsFor(sg).forEach((d) => d.id && ids.add(d.id));
    return ids;
  };

  const jobsFor = (sg: string) => {
    const ids = diskIdsFor(sg);
    return jobs.filter((j) => {
      if (matchesSubgrid(j.subgrid, sg)) return true;
      if (j.source_dataset_id && ids.has(j.source_dataset_id)) return true;
      if (j.output_dataset_id && ids.has(j.output_dataset_id)) return true;
      return false;
    });
  };

  const stagingFor = (sg: string) =>
    stagingAggregates.filter((a) => matchesSubgrid(a.subgrid, sg)).reduce((s, a) => s + (a.frames || 0), 0);

  const qaFor = (sg: string) => {
    if (!qaRecords) return 0;
    return Object.keys(qaRecords).filter((k) => {
      const key = normSub(k);
      return matchesSubgrid(k, sg) || key.startsWith(normSub(sg)) || key.endsWith(normSub(sg));
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

  // =========================================================================
  // 1. SINGLE RECORD DELETION: Isolate Child (Daily Run) vs Parent (Masterlist)
  // =========================================================================
  const effectiveTarget = targetRecord !== undefined && targetRecord !== null ? targetRecord : fallbackRecord;
  if (mode === 'single' && effectiveTarget) {
    const isDaily = sourceTab === 'daily' || (!('imageFilename' in effectiveTarget) && sourceTab !== 'batches');

    if (isDaily) {
      // ---------------------------------------------------------------------
      // CHILD: Daily Survey Run single deletion
      // ---------------------------------------------------------------------
      const rawSg = ('subgrid' in effectiveTarget && effectiveTarget.subgrid) ? effectiveTarget.subgrid : 'RECORD';
      const sg = (extractSubgridName(rawSg) || rawSg || 'RECORD').toUpperCase().trim();
      const poi = extractPoiCount(effectiveTarget);
      const frames = extractFramesCount(effectiveTarget);
      const km = Math.round((Number(effectiveTarget.kmProcessed) || 0) * 100) / 100;
      const defects = Number(
        ('defectCount' in effectiveTarget ? effectiveTarget.defectCount : 0) ||
        ('imagesDefected' in (effectiveTarget as any) ? (effectiveTarget as any).imagesDefected : 0) ||
        ('defects' in (effectiveTarget as any) ? (effectiveTarget as any).defects : 0) ||
        0
      );
      const isPub = effectiveTarget.publishToWebGIS === 'yes' || Boolean(effectiveTarget.isSyncedWithSupabase);
      const published = isPub ? 1 : 0;

      const targetId = getItemId(effectiveTarget);
      const remainingRuns = dailyData.filter(
        (d) => matchesSubgrid(d.subgrid, sg) && (targetId ? getItemId(d) !== targetId : d !== effectiveTarget)
      );

      const ds = datasetsFor(sg);
      const deliverables = ds.filter((d) => d.dataset_type === 'DELIVERABLE');
      const js = jobsFor(sg);

      if (remainingRuns.length > 0) {
        warnings.push(
          `${sg}: Deleting 1 child daily run (${poi} frames, ${km} km). ${remainingRuns.length} other run(s) remain active for this subgrid.`
        );
      } else {
        warnings.push(
          `${sg}: Deleting the only daily run for this subgrid. The subgrid will be completely removed.`
        );
        if (deliverables.length > 0) {
          warnings.push(
            `${sg}: deleting this survey data leaves ${deliverables.length} DELIVERABLE dataset(s) orphaned — ${deliverables.map((d) => d.name || '—').join(', ')}.`
          );
        }
        if (js.length > 0) {
          warnings.push(
            `${sg}: ${js.length} processing job(s) reference this data — ${js.map((j) => j.name || j.job_type || '—').join(', ')}.`
          );
        }
      }

      if (isPub) {
        warnings.push(`${sg}: this daily record is marked as published to WebGIS / synchronised to the database.`);
      }

      const row: ImpactRow = {
        subgrid: sg,
        runs: 1,
        batch: 0,
        poi,
        frames,
        km,
        defects,
        published,
        staging: remainingRuns.length === 0 ? stagingFor(sg) : 0,
        qa: remainingRuns.length === 0 ? qaFor(sg) : 0,
        datasets: remainingRuns.length === 0 ? ds.length : 0,
        deliverables: remainingRuns.length === 0 ? deliverables.length : 0,
        jobs: remainingRuns.length === 0 ? js.length : 0,
        relatedNames: remainingRuns.length === 0 ? ds.map((d) => d.name || '—') : [],
        deliverableNames: remainingRuns.length === 0 ? deliverables.map((d) => d.name || '—') : [],
        jobNames: remainingRuns.length === 0 ? js.map((j) => j.name || j.job_type || '—') : []
      };

      rows.push(row);
      totals.subgrids = 1;
      totals.runs = 1;
      totals.batch = 0;
      totals.poi = poi;
      totals.frames = frames;
      totals.km = km;
      totals.defects = defects;
      totals.published = published;
      totals.staging = row.staging;
      totals.qa = row.qa;
      totals.datasets = row.datasets;
      totals.deliverables = row.deliverables;
      totals.jobs = row.jobs;

      return {
        mode,
        rows,
        totals,
        warnings,
        hasPublished: totals.published > 0,
        hasDeliverables: totals.deliverables > 0,
        hasLinkedJobs: totals.jobs > 0,
        hasOrphanRisk: totals.staging > 0
      };
    } else {
      // ---------------------------------------------------------------------
      // PARENT: Masterlist Batch Log single deletion
      // ---------------------------------------------------------------------
      const rawSg = ('subgrid' in effectiveTarget && effectiveTarget.subgrid)
        ? effectiveTarget.subgrid
        : ('imageFilename' in effectiveTarget ? (effectiveTarget as BatchLogLike).imageFilename : 'RECORD');
      const sg = (extractSubgridName(rawSg) || rawSg || 'RECORD').toUpperCase().trim();
      const poi = extractPoiCount(effectiveTarget);
      const frames = extractFramesCount(effectiveTarget);
      const km = Math.round((Number(effectiveTarget.kmProcessed) || 0) * 100) / 100;
      const defects = Number(
        ('defects' in effectiveTarget ? effectiveTarget.defects : 0) ||
        ('defectCount' in (effectiveTarget as any) ? (effectiveTarget as any).defectCount : 0) ||
        0
      );

      const linkedRuns = dailyFor(sg);
      const runs = (typeof (effectiveTarget as BatchLogLike).runsCount === 'number' && (effectiveTarget as BatchLogLike).runsCount! > 0)
        ? (effectiveTarget as BatchLogLike).runsCount!
        : (linkedRuns.length > 0 ? linkedRuns.length : 1);

      const isPub = effectiveTarget.publishToWebGIS === 'yes' ||
        Boolean(effectiveTarget.isSyncedWithSupabase) ||
        (effectiveTarget as any).status === 'Complete';
      const pubRunsCount = linkedRuns.filter((r) => r.publishToWebGIS === 'yes' || r.isSyncedWithSupabase).length;
      const published = isPub ? (pubRunsCount > 0 ? pubRunsCount : 1) : pubRunsCount;

      const ds = datasetsFor(sg);
      const deliverables = ds.filter((d) => d.dataset_type === 'DELIVERABLE');
      const js = jobsFor(sg);

      if (published > 0) {
        warnings.push(
          `${sg}: ${published} record(s) are published to WebGIS / synchronised to the database. Re-publishing after deletion would be required.`
        );
      }
      if (deliverables.length > 0) {
        warnings.push(
          `${sg}: deleting this masterlist batch leaves ${deliverables.length} DELIVERABLE dataset(s) orphaned — ${deliverables.map((d) => d.name || '—').join(', ')}.`
        );
      }
      if (js.length > 0) {
        warnings.push(
          `${sg}: ${js.length} processing job(s) reference this data — ${js.map((j) => j.name || j.job_type || '—').join(', ')}.`
        );
      }
      if (stagingFor(sg) > 0) {
        warnings.push(
          `${sg}: ${stagingFor(sg)} RAW capture frame(s) remain in staging and are NOT removed by this action.`
        );
      }

      const row: ImpactRow = {
        subgrid: sg,
        runs,
        batch: 1,
        poi,
        frames,
        km,
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
      totals.subgrids = 1;
      totals.runs = runs;
      totals.batch = 1;
      totals.poi = poi;
      totals.frames = frames;
      totals.km = km;
      totals.defects = defects;
      totals.published = published;
      totals.staging = row.staging;
      totals.qa = row.qa;
      totals.datasets = row.datasets;
      totals.deliverables = row.deliverables;
      totals.jobs = row.jobs;

      return {
        mode,
        rows,
        totals,
        warnings,
        hasPublished: totals.published > 0,
        hasDeliverables: totals.deliverables > 0,
        hasLinkedJobs: totals.jobs > 0,
        hasOrphanRisk: totals.staging > 0
      };
    }
  }

  // =========================================================================
  // 2. BULK SELECTION DELETION: Isolate Child (Daily) vs Parent (Masterlist)
  // =========================================================================
  if (mode === 'bulk' && selectedIds && selectedIds.size > 0) {
    if (sourceTab === 'daily') {
      const selectedRuns = dailyData.filter((d) => selectedIds.has(getItemId(d)));
      const subgridGroups = new Map<string, DailyTimeSeriesLike[]>();
      selectedRuns.forEach((d) => {
        const raw = d.subgrid || 'RECORD';
        const sg = (extractSubgridName(raw) || raw).toUpperCase().trim();
        const list = subgridGroups.get(sg) || [];
        list.push(d);
        subgridGroups.set(sg, list);
      });

      Array.from(subgridGroups.keys()).sort().forEach((sg) => {
        const runsInGroup = subgridGroups.get(sg) || [];
        const poi = runsInGroup.reduce((s, r) => s + extractPoiCount(r), 0);
        const frames = runsInGroup.reduce((s, r) => s + extractFramesCount(r), 0);
        const km = Math.round(runsInGroup.reduce((s, r) => s + (Number(r.kmProcessed) || 0), 0) * 100) / 100;
        const defects = runsInGroup.reduce((s, r) => s + Number(r.defectCount ?? (r as any).imagesDefected ?? 0), 0);
        const published = runsInGroup.filter((r) => r.publishToWebGIS === 'yes' || r.isSyncedWithSupabase).length;

        const allRunsForSg = dailyFor(sg);
        const remainingCount = allRunsForSg.length - runsInGroup.length;
        const isCompleteSubgridPurge = remainingCount <= 0;

        const ds = datasetsFor(sg);
        const deliverables = ds.filter((d) => d.dataset_type === 'DELIVERABLE');
        const js = jobsFor(sg);

        if (remainingCount > 0) {
          warnings.push(
            `${sg}: Deleting ${runsInGroup.length} child daily run(s). ${remainingCount} other run(s) remain active for this subgrid.`
          );
        } else {
          warnings.push(
            `${sg}: All daily runs selected for deletion. The subgrid will be completely removed.`
          );
          if (deliverables.length > 0) {
            warnings.push(
              `${sg}: deleting this survey data leaves ${deliverables.length} DELIVERABLE dataset(s) orphaned — ${deliverables.map((d) => d.name || '—').join(', ')}.`
            );
          }
        }
        if (published > 0) {
          warnings.push(`${sg}: ${published} selected daily record(s) are marked as published.`);
        }

        const row: ImpactRow = {
          subgrid: sg,
          runs: runsInGroup.length,
          batch: 0,
          poi,
          frames,
          km,
          defects,
          published,
          staging: isCompleteSubgridPurge ? stagingFor(sg) : 0,
          qa: isCompleteSubgridPurge ? qaFor(sg) : 0,
          datasets: isCompleteSubgridPurge ? ds.length : 0,
          deliverables: isCompleteSubgridPurge ? deliverables.length : 0,
          jobs: isCompleteSubgridPurge ? js.length : 0,
          relatedNames: isCompleteSubgridPurge ? ds.map((d) => d.name || '—') : [],
          deliverableNames: isCompleteSubgridPurge ? deliverables.map((d) => d.name || '—') : [],
          jobNames: isCompleteSubgridPurge ? js.map((j) => j.name || j.job_type || '—') : []
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
      });

      return {
        mode,
        rows,
        totals,
        warnings,
        hasPublished: totals.published > 0,
        hasDeliverables: totals.deliverables > 0,
        hasLinkedJobs: totals.jobs > 0,
        hasOrphanRisk: totals.staging > 0
      };
    } else if (sourceTab === 'batches') {
      const selectedBatches = batchLogs.filter((b) => selectedIds.has(getItemId(b)));

      selectedBatches.forEach((b) => {
        const raw = b.subgrid || b.imageFilename || 'RECORD';
        const sg = (extractSubgridName(raw) || raw).toUpperCase().trim();
        const poi = extractPoiCount(b);
        const frames = extractFramesCount(b);
        const km = Math.round((Number(b.kmProcessed) || 0) * 100) / 100;
        const defects = Number(b.defects ?? (b as any).defectCount ?? 0);

        const linkedRuns = dailyFor(sg);
        const runs = (typeof b.runsCount === 'number' && b.runsCount > 0)
          ? b.runsCount
          : (linkedRuns.length > 0 ? linkedRuns.length : 1);

        const isPub = b.publishToWebGIS === 'yes' || b.isSyncedWithSupabase || b.status === 'Complete';
        const pubRuns = linkedRuns.filter((r) => r.publishToWebGIS === 'yes' || r.isSyncedWithSupabase).length;
        const published = isPub ? (pubRuns > 0 ? pubRuns : 1) : pubRuns;

        const ds = datasetsFor(sg);
        const deliverables = ds.filter((d) => d.dataset_type === 'DELIVERABLE');
        const js = jobsFor(sg);

        if (published > 0) {
          warnings.push(`${sg}: ${published} record(s) are published to WebGIS.`);
        }
        if (deliverables.length > 0) {
          warnings.push(
            `${sg}: deleting this masterlist batch leaves ${deliverables.length} DELIVERABLE dataset(s) orphaned — ${deliverables.map((d) => d.name || '—').join(', ')}.`
          );
        }

        const row: ImpactRow = {
          subgrid: sg,
          runs,
          batch: 1,
          poi,
          frames,
          km,
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
      });

      return {
        mode,
        rows,
        totals,
        warnings,
        hasPublished: totals.published > 0,
        hasDeliverables: totals.deliverables > 0,
        hasLinkedJobs: totals.jobs > 0,
        hasOrphanRisk: totals.staging > 0
      };
    }
  }

  // =========================================================================
  // 3. SPATIAL OR GENERAL SUBGRID AGGREGATION FALLBACK
  // =========================================================================
  Array.from(target)
    .sort()
    .forEach((sg) => {
      const runs = dailyFor(sg);
      const batches = batchFor(sg);
      const ds = datasetsFor(sg);
      const js = jobsFor(sg);
      const deliverables = ds.filter((d) => d.dataset_type === 'DELIVERABLE');

      let poi = 0;
      let frames = 0;
      let km = 0;
      let defects = 0;
      let published = 0;

      if (sourceTab === 'daily') {
        poi = runs.reduce((s, r) => s + extractPoiCount(r), 0);
        frames = runs.reduce((s, r) => s + extractFramesCount(r), 0);
        km = runs.reduce((s, r) => s + (r.kmProcessed || 0), 0);
        defects = runs.reduce((s, r) => s + (r.defectCount || 0), 0);
        published = runs.filter((r) => r.publishToWebGIS === 'yes' || r.isSyncedWithSupabase).length;
      } else if (sourceTab === 'batches') {
        poi = batches.reduce((s, b) => s + extractPoiCount(b), 0);
        frames = batches.reduce((s, b) => s + extractFramesCount(b), 0);
        km = batches.reduce((s, b) => s + (b.kmProcessed || 0), 0);
        defects = batches.reduce((s, b) => s + (b.defects || 0), 0);
        published = batches.filter((b) => b.publishToWebGIS === 'yes' || b.isSyncedWithSupabase).length;
      } else {
        const runsPoi = runs.reduce((s, r) => s + extractPoiCount(r), 0);
        const batchesPoi = batches.reduce((s, b) => s + extractPoiCount(b), 0);
        poi = Math.max(runsPoi, batchesPoi);

        const runsFrames = runs.reduce((s, r) => s + extractFramesCount(r), 0);
        const batchesFrames = batches.reduce((s, b) => s + extractFramesCount(b), 0);
        frames = Math.max(runsFrames, batchesFrames);

        const runsKm = runs.reduce((s, r) => s + (r.kmProcessed || 0), 0);
        const batchesKm = batches.reduce((s, b) => s + (b.kmProcessed || 0), 0);
        km = Math.max(runsKm, batchesKm);

        const runsDefects = runs.reduce((s, r) => s + (r.defectCount || 0), 0);
        const batchesDefects = batches.reduce((s, b) => s + (b.defects || 0), 0);
        defects = Math.max(runsDefects, batchesDefects);

        const runsPublished = runs.filter(
          (r) => r.publishToWebGIS === 'yes' || r.isSyncedWithSupabase
        ).length;
        const batchesPublished = batches.filter(
          (b) => b.publishToWebGIS === 'yes' || b.isSyncedWithSupabase
        ).length;
        published = Math.max(runsPublished, batchesPublished);
      }

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

  if (rows.length === 0 && fallbackRecord) {
    const rawSg = ('subgrid' in fallbackRecord && fallbackRecord.subgrid)
      ? fallbackRecord.subgrid
      : ('imageFilename' in fallbackRecord ? (fallbackRecord as BatchLogLike).imageFilename : 'RECORD');
    const sg = (extractSubgridName(rawSg) || rawSg || 'RECORD').toUpperCase().trim();
    const poi = extractPoiCount(fallbackRecord);
    const frames = extractFramesCount(fallbackRecord);
    const km = fallbackRecord.kmProcessed || 0;
    const defects = (('defectCount' in fallbackRecord && typeof (fallbackRecord as any).defectCount === 'number')
      ? (fallbackRecord as any).defectCount
      : (('defects' in fallbackRecord && typeof (fallbackRecord as any).defects === 'number') ? (fallbackRecord as any).defects : 0)) || 0;
    const isPub = fallbackRecord.publishToWebGIS === 'yes' || fallbackRecord.isSyncedWithSupabase;

    const row: ImpactRow = {
      subgrid: sg,
      runs: 'grid' in fallbackRecord ? 1 : 0,
      batch: 'imageFilename' in fallbackRecord ? 1 : 0,
      poi,
      frames,
      km: Math.round(km * 100) / 100,
      defects,
      published: isPub ? 1 : 0,
      staging: 0,
      qa: 0,
      datasets: 0,
      deliverables: 0,
      jobs: 0,
      relatedNames: [],
      deliverableNames: [],
      jobNames: []
    };
    rows.push(row);
    totals.subgrids = 1;
    totals.runs = row.runs;
    totals.batch = row.batch;
    totals.poi = poi;
    totals.frames = frames;
    totals.km = row.km;
    totals.defects = defects;
    totals.published = isPub ? 1 : 0;
    if (isPub) {
      warnings.push(`${sg}: this record is published to WebGIS / synchronised to the database.`);
    }
  }

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