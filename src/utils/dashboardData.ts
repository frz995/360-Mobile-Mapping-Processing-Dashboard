/**
 * Shared data-domain utilities extracted from App.tsx.
 * Imported by both App.tsx (via re-export) and extracted components.
 */
import { extractSubgridName } from './subgrid';
import { calculatePathDistanceKm } from './geo';
import type { BatchLog, DailyTimeSeries, PanoramaItem } from '../types/dashboard';

// Helper: Format Batch ID cleanly (e.g. 'sp-b-N93E70' -> '2123S-N93E70', '1' -> '2123S-0001')
export function formatBatchIdDisplay(log?: Partial<BatchLog>, index: number = 0): string {
  if (!log) return `2123S-${String(1001 + index).padStart(4, '0')}`;
  const rawId = String(log.id || '').trim();
  const subgrid = (extractSubgridName(log.subgrid || log.imageFilename || '') || '').toUpperCase().trim();

  if (!rawId || rawId === 'undefined' || rawId === 'null') {
    return subgrid ? `2123S-${subgrid}` : `2123S-${String(1001 + index).padStart(4, '0')}`;
  }

  let cleanId = rawId.replace(/^2123S-?/i, '').replace(/^sp-b-/i, '').trim();

  if (/^\d+$/.test(cleanId)) {
    return `2123S-${cleanId.padStart(4, '0')}`;
  }

  return cleanId ? `2123S-${cleanId}` : (subgrid ? `2123S-${subgrid}` : `2123S-${String(1001 + index).padStart(4, '0')}`);
}

// Helper: Get POI count (total survey track points from metadata)
export function getPOICount(item?: { poiCount?: number; imagesProcessed?: number; images?: number; panoramas?: PanoramaItem[] }): number {
  if (!item) return 0;
  if (typeof item.poiCount === 'number' && item.poiCount >= 0) {
    return item.poiCount;
  }
  if (Array.isArray(item.panoramas) && item.panoramas.length > 0) {
    return item.panoramas.length;
  }
  return Number(item.imagesProcessed ?? item.images ?? 0);
}

// Helper: Get available uploaded image frames count in MMS_PIC per row
export function getImagesProcessedCount(item?: {
  imagesProcessed?: number;
  images?: number;
  availableImagesCount?: number;
  availableFilenames?: string[];
  panoramas?: PanoramaItem[];
  poiCount?: number;
}): number {
  if (!item) return 0;

  const rawPoi = Number(item.poiCount ?? (item as any).poi ?? (item.panoramas ? item.panoramas.length : 0));

  // 1. Explicit verified count from Supabase storage verification is the gold standard
  if (typeof item.availableImagesCount === 'number') {
    return Math.min(item.availableImagesCount, rawPoi > 0 ? rawPoi : item.availableImagesCount);
  }
  if (item.availableFilenames && Array.isArray(item.availableFilenames)) {
    return item.availableFilenames.length;
  }
  if (item.panoramas && item.panoramas.length > 0) {
    const availablePans = item.panoramas.filter((p: any) => p.isAvailable === true);
    return availablePans.length;
  }
  if (typeof item.imagesProcessed === 'number') {
    return Math.min(item.imagesProcessed, rawPoi > 0 ? rawPoi : item.imagesProcessed);
  }
  if (typeof item.images === 'number') {
    return Math.min(item.images, rawPoi > 0 ? rawPoi : item.images);
  }
  return 0;
}

// Helper: Flexible date parser handling ISO, DMY, MDY, timestamps, and word dates
export function parseFlexibleDate(dateVal?: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;
  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    return !isNaN(d.getTime()) ? d : null;
  }
  if (typeof dateVal !== 'string') return null;

  const clean = dateVal.trim();
  if (!clean) return null;

  // 1. Try standard ISO / Date parse
  const std = new Date(clean);
  if (!isNaN(std.getTime()) && !/^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(clean)) {
    return std;
  }

  // 2. Check DD/MM/YYYY or DD-MM-YYYY (e.g. 19/08/2026 or 08/04/2022)
  const dmyMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const d = new Date(year, month, day, hour, min, sec);
    if (!isNaN(d.getTime())) return d;
  }

  // 3. Check YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = clean.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const hour = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
    const min = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
    const sec = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
    const d = new Date(year, month, day, hour, min, sec);
    if (!isNaN(d.getTime())) return d;
  }

  // 4. Check "Month Day, Year" or "Day Month Year"
  const wordsMatch = clean.match(/^(?:([A-Za-z]+)\s+(\d{1,2})|(\d{1,2})\s+([A-Za-z]+))(?:,?\s*(\d{4}))?/);
  if (wordsMatch) {
    const monthStr = wordsMatch[1] || wordsMatch[4];
    const dayStr = wordsMatch[2] || wordsMatch[3];
    const yearStr = wordsMatch[5] || String(new Date().getFullYear());
    const months: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11
    };
    const m = months[monthStr.toLowerCase()];
    if (m !== undefined) {
      const d = new Date(parseInt(yearStr, 10), m, parseInt(dayStr, 10));
      if (!isNaN(d.getTime())) return d;
    }
  }

  if (!isNaN(std.getTime())) return std;
  return null;
}

// Helper: Format date string into Month Day, Year without time suffix
export function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) return 'N/A';
  const parsed = parseFlexibleDate(dateStr);
  if (parsed && !isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return dateStr;
}

// Helper: Convert any date string to YYYY-MM-DD for input type="date"
export function toISODateString(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  const parsed = parseFlexibleDate(dateStr);
  if (parsed && !isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return new Date().toISOString().slice(0, 10);
}

// Helper: Calculate point-to-point geodesic range distance (km) for points within the same subgrid
export const calculateSubgridDistanceKm = calculatePathDistanceKm;

// Helper: Build a BatchLog from Supabase record or return dynamic fallback
export function createBatchLogFromSupabaseOrDummy(
  row?: { filename?: string; image_url?: string; captured_at?: string; images?: number; defects?: number; km_processed?: number; kmProcessed?: number; grid?: string; subgrid?: string; pic?: string },
  fallbackSubgrid: string = '',
  gridNum: string = '1'
): BatchLog {
  const imageFilename = row?.image_url || row?.filename || (fallbackSubgrid ? `${fallbackSubgrid}-0001.jpg` : '');
  const subgrid = (row?.subgrid || extractSubgridName(imageFilename) || fallbackSubgrid || '').toUpperCase().trim();
  const date = row?.captured_at
    ? new Date(row.captured_at).toISOString().replace('T', ' ').slice(0, 16)
    : new Date().toISOString().replace('T', ' ').slice(0, 16);

  return {
    id: String(Date.now()),
    date,
    grid: row?.grid || gridNum,
    subgrid,
    imageFilename,
    images: Number(row?.images || 0),
    defects: Number(row?.defects || 0),
    kmProcessed: Number(row?.km_processed || row?.kmProcessed || 0),
    status: 'Complete',
    pic: row?.pic || 'Admin'
  };
}

export function reconcileBatchLogs(dailyItems: DailyTimeSeries[], baseBatches?: BatchLog[]): BatchLog[] {
  if (!dailyItems || dailyItems.length === 0) {
    return [];
  }

  // Lookup existing Masterlist Admin PICs
  const baseBatchPicMap = new Map<string, string>();
  if (baseBatches && Array.isArray(baseBatches)) {
    baseBatches.forEach(b => {
      const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      if (sg && b.pic) {
        baseBatchPicMap.set(sg, b.pic);
      }
    });
  }

  // Group all daily records by normalized subgrid
  const batchMap = new Map<string, {
    id: string;
    subgrid: string;
    grid: string;
    date: string;
    imageFilename: string;
    totalImages: number;
    publishedImages: number;
    totalPoi: number;
    publishedPoi: number;
    publishedKm: number;
    totalKm: number;
    defects: number;
    adminPic: string;
    captureEquipment: string;
    panoramas: any[];
    availableFilenames?: string[];
    runsCount: number;
    publishedRunsCount: number;
  }>();

  for (const d of dailyItems) {
    const rawSub = d.subgrid || (d.panoramas?.[0]?.filename) || '';
    const normSub = (extractSubgridName(rawSub) || rawSub).toUpperCase().trim();
    if (!normSub) continue;

    const isPublished = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;
    const singlePoi = d.poiCount || (d.panoramas?.length) || 0;
    const singleImg = getImagesProcessedCount(d);
    const kmVal = Number(d.kmProcessed || 0);
    let parsedStatusDefects = 0;
    if (d.qaqcStatus) {
      const m = d.qaqcStatus.match(/(\d+)\s+Defect/i);
      if (m) parsedStatusDefects = parseInt(m[1], 10);
    }

    const defCount = (d.imagesDefected && d.imagesDefected > 0)
      ? d.imagesDefected
      : (d.defectCount && d.defectCount > 0)
        ? d.defectCount
        : (parsedStatusDefects > 0)
          ? parsedStatusDefects
          : 0;

    const existing = batchMap.get(normSub);
    if (existing) {
      existing.totalPoi += singlePoi;
      existing.totalImages += singleImg;
      existing.totalKm = Math.round((existing.totalKm + kmVal) * 100) / 100;
      if (isPublished) {
        existing.publishedPoi += singlePoi;
        existing.publishedImages += singleImg;
        existing.publishedKm = Math.round((existing.publishedKm + kmVal) * 100) / 100;
        existing.publishedRunsCount += 1;
      }
      existing.defects += defCount;
      existing.runsCount += 1;
      if (d.date) existing.date = d.date;
      if (d.captureEquipment) existing.captureEquipment = d.captureEquipment;
      if (d.panoramas && d.panoramas.length > 0) {
        if (!existing.panoramas) existing.panoramas = [];
        existing.panoramas = [...existing.panoramas, ...d.panoramas];
      }
      if (d.availableFilenames && Array.isArray(d.availableFilenames)) {
        if (!existing.availableFilenames) existing.availableFilenames = [];
        d.availableFilenames.forEach(fn => {
          if (!existing.availableFilenames!.includes(fn)) existing.availableFilenames!.push(fn);
        });
      }
    } else {
      const initialAvailFiles = d.availableFilenames && Array.isArray(d.availableFilenames)
        ? [...d.availableFilenames]
        : (d.panoramas ? d.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter(Boolean) : []);

      const designatedAdminPic = baseBatchPicMap.get(normSub) || 'Admin';

      batchMap.set(normSub, {
        id: 'BATCH-' + normSub,
        subgrid: normSub,
        grid: d.grid || '1',
        date: d.date || new Date().toISOString().slice(0, 10),
        imageFilename: (d.panoramas?.[0]?.filename) || (normSub + '-0001.jpg'),
        totalImages: singleImg,
        publishedImages: isPublished ? singleImg : 0,
        totalPoi: singlePoi,
        publishedPoi: isPublished ? singlePoi : 0,
        publishedKm: isPublished ? kmVal : 0,
        totalKm: kmVal,
        defects: defCount,
        adminPic: designatedAdminPic,
        captureEquipment: d.captureEquipment || 'MMS',
        panoramas: d.panoramas ? [...d.panoramas] : [],
        availableFilenames: initialAvailFiles.length > 0 ? initialAvailFiles : undefined,
        runsCount: 1,
        publishedRunsCount: isPublished ? 1 : 0
      });
    }
  }

  // Convert map to BatchLog array
  const result: BatchLog[] = [];
  for (const [normSub, entry] of batchMap.entries()) {
    const finalImages = typeof entry.totalImages === 'number' ? entry.totalImages : (typeof entry.publishedImages === 'number' ? entry.publishedImages : 0);
    const isComplete = entry.publishedRunsCount > 0 && entry.publishedRunsCount === entry.runsCount && finalImages >= entry.totalPoi && entry.totalPoi > 0;
    const finalStatus: 'Complete' | 'Ongoing' = isComplete ? 'Complete' : 'Ongoing';

    result.push({
      id: 'BATCH-' + normSub,
      date: entry.date.length <= 10 ? (entry.date + ' 00:43') : entry.date,
      grid: entry.grid,
      subgrid: normSub,
      imageFilename: entry.imageFilename,
      images: finalImages,
      poiCount: entry.totalPoi,
      availableImagesCount: finalImages,
      availableFilenames: entry.availableFilenames && entry.availableFilenames.length > 0 ? entry.availableFilenames : undefined,
      kmProcessed: entry.totalKm,
      defects: entry.defects,
      pic: entry.adminPic || baseBatchPicMap.get(normSub) || 'Admin',
      status: finalStatus,
      captureEquipment: entry.captureEquipment,
      panoramas: entry.panoramas,
      publishToWebGIS: isComplete ? 'yes' : 'in process',
      isSyncedWithSupabase: isComplete,
      runsCount: entry.runsCount,
      publishedRunsCount: entry.publishedRunsCount
    });
  }

  return result;
}