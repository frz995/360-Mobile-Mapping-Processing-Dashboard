// =====================================================================
// Survey Analytics — Analytics workspace (Phase 6)
// Computes distance / coverage / density / quality / gap KPIs from
// survey batches, daily runs, RAW staging aggregates and QA records.
// Dashboard is metadata-only.
// =====================================================================

export interface BatchLike {
  id?: string;
  date?: string;
  grid?: string;
  subgrid?: string;
  imageFilename?: string;
  images?: number;
  poiCount?: number;
  availableImagesCount?: number;
  availableFilenames?: string[];
  defects?: number;
  kmProcessed?: number;
  status?: string;
  captureEquipment?: string;
  pic?: string;
  isSyncedWithSupabase?: boolean;
  isFromSupabase?: boolean;
  panoramas?: unknown[];
  runsCount?: number;
  publishedRunsCount?: number;
  publishToWebGIS?: string;
}

export interface AggregateLike {
  subgrid: string;
  frames: number;
  captureStart?: string;
  captureEnd?: string;
  statuses: Record<string, number>;
}

export interface PublishState {
  subgrid: string;
  poi: number;
  frames: number;
  missing: number;
}

export interface GapItem {
  kind: 'missing_frames' | 'unpublished' | 'capture_no_dataset';
  subgrid: string;
  poi?: number;
  frames?: number;
  missing?: number;
  detail: string;
}

export interface SubgridAnalytics {
  subgrid: string;
  grid: string;
  km: number;
  poi: number;
  frames: number;
  coveragePct: number;
  densityPoi: number;
  densityFrames: number;
  defects: number;
  defectsPerKm: number;
  passRate: number;
  publishState: 'published' | 'staged' | 'partial' | 'none';
  qaApproved: number;
  qaRejected: number;
  captureFrames: number;
  runsCount: number;
  captureEquipment?: string;
  pic?: string;
}

export interface DailySeriesPoint {
  date: string;
  km: number;
  poi: number;
  frames: number;
  defects: number;
}

export interface SurveyAnalytics {
  totals: {
    km: number;
    poi: number;
    frames: number;
    defects: number;
    subgrids: number;
    published: number;
    staged: number;
    partial: number;
    passRate: number;
    targetKm: number;
    targetImages: number;
    targetProgressKmPct: number;
    targetProgressImagesPct: number;
    qaApproved: number;
    qaRejected: number;
    captureFrames: number;
  };
  perSubgrid: SubgridAnalytics[];
  dailySeries: DailySeriesPoint[];
  gaps: GapItem[];
}

function extractSubgrid(value?: string): string {
  const m = /[nNsS]\d{2}[eEwW]\d{2,3}/.exec((value || '').trim());
  return m ? m[0].toUpperCase() : (value || '').trim().toUpperCase();
}

function poiOf(b: BatchLike): number {
  if (typeof b.poiCount === 'number' && b.poiCount >= 0) return b.poiCount;
  if (Array.isArray(b.panoramas) && b.panoramas.length > 0) return b.panoramas.length;
  return Number(b.images ?? 0);
}

function framesOf(b: BatchLike): number {
  if (typeof b.availableImagesCount === 'number' && b.availableImagesCount > 0) {
    return b.availableImagesCount;
  }
  const fns = b.availableFilenames?.length;
  if (fns) return fns;
  return poiOf(b);
}

export interface SurveyAnalyticsInput {
  batches?: BatchLike[];
  daily?: BatchLike[];
  aggregates?: AggregateLike[];
  qaBySubgrid?: Record<string, { approved: number; rejected: number }>;
  targetKm?: number;
  targetImages?: number;
}

export function computeSurveyAnalytics(input: SurveyAnalyticsInput): SurveyAnalytics {
  const batches = (input.batches || []).filter(Boolean);
  const daily = (input.daily || []).filter(Boolean);
  const aggregates = input.aggregates || [];
  const qaBySubgrid = input.qaBySubgrid || {};
  const targetKm = Number(input.targetKm) || 0;
  const targetImages = Number(input.targetImages) || 0;

  // Merge batch + daily rows per subgrid (batch values take precedence).
  const bySubgrid = new Map<string, SubgridAnalytics>();

  const accFor = (sg: string): SubgridAnalytics => {
    const existing = bySubgrid.get(sg);
    if (existing) return existing;
    const created: SubgridAnalytics = {
      subgrid: sg,
      grid: '1',
      km: 0,
      poi: 0,
      frames: 0,
      coveragePct: 0,
      densityPoi: 0,
      densityFrames: 0,
      defects: 0,
      defectsPerKm: 0,
      passRate: 100,
      publishState: 'none',
      qaApproved: 0,
      qaRejected: 0,
      captureFrames: 0,
      runsCount: 0
    };
    bySubgrid.set(sg, created);
    return created;
  };

  const stateRank: Record<SubgridAnalytics['publishState'], number> = {
    published: 3,
    staged: 2,
    partial: 1,
    none: 0
  };

  const collectRow = (row: BatchLike, isDaily: boolean) => {
    const sg = extractSubgrid(row.subgrid || row.imageFilename) || 'UNASSIGNED';
    const acc = accFor(sg);
    acc.grid = row.grid || acc.grid || '1';
    const km = Number(row.kmProcessed) || 0;
    acc.km += km;
    acc.poi += poiOf(row);
    acc.frames = Math.max(acc.frames, framesOf(row)); // verified frames are per-subgrid totals
    acc.defects += Number(row.defects) || 0;
    acc.runsCount += 1;
    if (!acc.captureEquipment) acc.captureEquipment = row.captureEquipment || 'MMS';
    if (!acc.pic) acc.pic = row.pic || '';
    if (!isDaily) {
      const partialNow = acc.poi > 0 && framesOf(row) < acc.poi;
      const candidate: SubgridAnalytics['publishState'] =
        row.isSyncedWithSupabase || row.status === 'Complete'
          ? 'published'
          : partialNow
            ? 'partial'
            : km > 0
              ? 'staged'
              : 'none';
      if (stateRank[candidate] > stateRank[acc.publishState]) {
        acc.publishState = candidate;
      }
    } else if (acc.publishState === 'none' && km > 0) {
      acc.publishState = 'staged';
    }
  };

  batches.forEach((b) => collectRow(b, false));
  daily.forEach((d) => collectRow(d, true));

  // Post-derive ratios once totals are final.
  let totalKm = 0;
  let totalPoi = 0;
  let totalFrames = 0;
  let totalDefects = 0;
  let published = 0;
  let staged = 0;
  let partial = 0;

  aggregates.forEach((a) => {
    const acc = bySubgrid.get(a.subgrid);
    if (acc) {
      acc.captureFrames = a.frames;
    } else {
      const created = accFor(a.subgrid);
      created.captureFrames = a.frames;
      created.publishState = 'none';
    }
  });

  bySubgrid.forEach((acc) => {
    acc.coveragePct = acc.poi > 0 ? Math.min(100, Math.round((acc.frames / acc.poi) * 100)) : acc.frames > 0 ? 100 : 0;
    acc.densityPoi = acc.km > 0 ? acc.poi / acc.km : 0;
    acc.densityFrames = acc.km > 0 ? acc.frames / acc.km : 0;
    acc.defectsPerKm = acc.km > 0 ? acc.defects / acc.km : 0;
    acc.passRate = acc.poi > 0 ? Math.max(0, Math.round(((acc.poi - acc.defects) / acc.poi) * 100)) : 100;
    const qa = qaBySubgrid[acc.subgrid];
    acc.qaApproved = qa?.approved || 0;
    acc.qaRejected = qa?.rejected || 0;

    if (acc.publishState === 'none' && (acc.km > 0 || acc.frames > 0)) acc.publishState = 'staged';
    if (acc.publishState === 'partial' || (acc.poi > acc.frames && acc.poi > 0)) acc.publishState = 'partial';

    totalKm += acc.km;
    totalPoi += acc.poi;
    totalFrames += acc.frames;
    totalDefects += acc.defects;
    if (acc.publishState === 'published') published += 1;
    else if (acc.publishState === 'staged') staged += 1;
    else if (acc.publishState === 'partial') partial += 1;
  });

  const perSubgrid = Array.from(bySubgrid.values()).sort((a, b) => b.km - a.km);

  // Daily trend series (from daily runs).
  const dailyByDate = new Map<string, DailySeriesPoint>();
  daily.forEach((d) => {
    const date = (d.date || '').slice(0, 10) || 'unknown';
    const pt = dailyByDate.get(date) || { date, km: 0, poi: 0, frames: 0, defects: 0 };
    pt.km += Number(d.kmProcessed) || 0;
    pt.poi += poiOf(d);
    pt.frames = Math.max(pt.frames, framesOf(d));
    pt.defects += Number(d.defects) || 0;
    dailyByDate.set(date, pt);
  });
  const dailySeries = Array.from(dailyByDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Gaps.
  const gaps: GapItem[] = [];
  perSubgrid.forEach((s) => {
    const missing = s.poi - s.frames;
    if (missing > 0) {
      gaps.push({
        kind: 'missing_frames',
        subgrid: s.subgrid,
        poi: s.poi,
        frames: s.frames,
        missing,
        detail: `${missing} frame(s) short of ${s.poi} POIs`
      });
    }
    if (s.publishState === 'staged' || s.publishState === 'partial') {
      gaps.push({
        kind: 'unpublished',
        subgrid: s.subgrid,
        poi: s.poi,
        frames: s.frames,
        detail: 'surveyed but not yet published to the database'
      });
    }
  });
  aggregates.forEach((a) => {
    const hasBatch = bySubgrid.has(a.subgrid);
    if (!hasBatch) {
      gaps.push({
        kind: 'capture_no_dataset',
        subgrid: a.subgrid,
        frames: a.frames,
        detail: 'RAW captures exist but no processed dataset/batch imported yet'
      });
    }
  });

  const totalQaApproved = perSubgrid.reduce((a, s) => a + s.qaApproved, 0);
  const totalQaRejected = perSubgrid.reduce((a, s) => a + s.qaRejected, 0);
  const totalCaptureFrames = aggregates.reduce((a, g) => a + g.frames, 0);
  const passRate = totalPoi > 0 ? Math.round(((totalPoi - totalDefects) / totalPoi) * 100) : 100;

  return {
    totals: {
      km: Math.round(totalKm * 100) / 100,
      poi: totalPoi,
      frames: totalFrames,
      defects: totalDefects,
      subgrids: perSubgrid.length,
      published,
      staged,
      partial,
      passRate,
      targetKm,
      targetImages,
      targetProgressKmPct: targetKm > 0 ? Math.min(100, (totalKm / targetKm) * 100) : 0,
      targetProgressImagesPct: targetImages > 0 ? Math.min(100, (totalFrames / targetImages) * 100) : 0,
      qaApproved: totalQaApproved,
      qaRejected: totalQaRejected,
      captureFrames: totalCaptureFrames
    },
    perSubgrid,
    dailySeries,
    gaps
  };
}