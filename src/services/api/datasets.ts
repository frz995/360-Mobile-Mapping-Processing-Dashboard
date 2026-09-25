import { supabase, scoped, getServiceProjectId } from './client';
import { ensureManifestSettings, resolveStorageFiles } from './storage';
import type { ExtendedProjectSettings } from '../../types/admin';
import type { BatchLog } from '../../types/dashboard';
import type { DatasetRecord } from '../../types/production';
import { calculatePathDistanceKm } from '../../utils/geo';
import { formatPIC } from '../../utils/picFormat';
import { batchLogToDbRow } from '../../utils/dashboardData';
import { extractSubgridName } from '../../utils/subgrid';
import { getDatabaseTableMapping } from '../supabaseConfig';
import { withRetry } from '../../lib/retry';
import { STORAGE_BUCKET_DEFAULT, DATABASE_TABLE_DEFAULTS } from '../../config/defaults';
import { checkProductionPublicationEligibility } from './productionRuns';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_KEY || '';

export { extractSubgridName };

export interface PanoramaItem {
  filename?: string;
  imageFilename?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lon?: number;
  bearing?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  date?: string;
  time?: string;
  productionRunId?: string | null;
  productionAttemptId?: string | null;
  productionReleaseId?: string | null;
}

export interface SupabasePanoramaRecord {
  id?: string | number;
  project_id?: string;
  subgrid?: string;
  filename?: string;
  image_url?: string;
  captured_at?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  defect_count?: number;
  qa_status?: string;
  defect_flags?: any;
  is_fallback_coord?: boolean;
  geom?: {
    type: string;
    coordinates: [number, number];
  } | null;
}

// Subgrid centroid coordinates (longitude, latitude) populated dynamically from real database records
export const SUBGRID_COORDINATES: Record<string, [number, number]> = {};

function extractSubgrid(filename: string): string {
  if (!filename) return '';
  const clean = filename.split('/').pop() || filename;
  const match = clean.match(/(N\d+E\d+)/i);
  if (match) return match[1].toUpperCase();
  const base = clean.replace(/\.[^/.]+$/, '').trim();
  return base || '';
}

/**
 * Fetch records from Supabase and group into BatchLog[] and DailyTimeSeries[].
 * Accurately calculates image count matching Supabase storage & panoramas table.
 * Deduplicates rows by subgrid so each subgrid has exactly 1 clean record without duplicates or count doubling.
 */
export async function fetchSupabaseData(settings?: ExtendedProjectSettings): Promise<{
  dailyData: any[];
  batchLogs: any[];
  defectsList?: any[];
  error?: string;
}> {
  try {
    // Try fetching from panoramas_view or fallback to panoramas table
    let data: any[] | null = null;
    let error: any = null;
    const viewResult = await withRetry(
      async () => {
        const res = await scoped(supabase.from('panoramas_view').select('*'));
        if (res.error) throw new Error(res.error.message);
        return res;
      },
      { retries: 2 }
    );
    data = viewResult.data;
    error = viewResult.error;

    if (error || !data || data.length === 0) {
      const res = await scoped(supabase
        .from('panoramas')
        .select('*'));
      data = res.data;
      error = res.error;
    }

    if (error) {
      throw new Error(error.message);
    }

    // Query subgrids metadata table dynamically if available
    const knownMetadata: Record<string, { grid: string; pic: string; equipment: string; date: string; defaultKm: number; defaultCount: number }> = {};

    try {
      const { data: subgridRows } = await scoped(supabase.from('subgrids').select('*'));
      if (subgridRows && subgridRows.length > 0) {
        subgridRows.forEach((row: any) => {
          if (row.subgrid_code) {
            const sgKey = row.subgrid_code.toUpperCase().trim();
            knownMetadata[sgKey] = {
              grid: row.grid_id || row.grid || '1',
              pic: row.pic || row.operator || row.surveyor || '',
              equipment: row.equipment || row.capture_equipment || 'MMS',
              date: row.date || row.survey_date || (row.captured_at ? new Date(row.captured_at).toISOString().slice(0, 10) : ''),
              defaultKm: typeof row.km === 'number' ? row.km : 0,
              defaultCount: typeof row.poi_count === 'number' ? row.poi_count : 0
            };
            if (typeof row.latitude === 'number' && typeof row.longitude === 'number') {
              SUBGRID_COORDINATES[sgKey] = [Number(row.longitude), Number(row.latitude)];
            }
          }
        });
      }
    } catch (stgErr) {
      console.warn('Subgrid metadata table query notice:', stgErr);
    }

    // Process published records if available
    const publishedRows = data || [];

    // Count actual available images in storage bucket if accessible
    // (prefers server-side file_inventory table, falls back to bucket listing)
    const primaryBucket = settings?.supabaseBucket || (settings as any)?.storageBucket || import.meta.env.VITE_SUPABASE_BUCKET || import.meta.env.VITE_STORAGE_BUCKET || STORAGE_BUCKET_DEFAULT;
    const candidateLocations: Array<{ bucket: string; path: string }> = [
      { bucket: primaryBucket, path: '' },
      { bucket: primaryBucket.toLowerCase(), path: '' },
      { bucket: primaryBucket.toUpperCase(), path: '' },
      { bucket: 'MMS_PIC', path: '' },
      { bucket: 'mms_pic', path: '' },
      { bucket: 'panoramas', path: '' },
      { bucket: 'panoramas', path: 'MMS_PIC' },
      { bucket: 'panoramas', path: 'mms_pic' }
    ];

    const uniqueLocations = candidateLocations.filter((loc, idx, self) =>
      idx === self.findIndex(t => t.bucket === loc.bucket && t.path === loc.path)
    );

    const manifestSettings = await ensureManifestSettings(settings);
    const storageResolved = await resolveStorageFiles(uniqueLocations, manifestSettings);
    const storageImageCounts = storageResolved.countsBySubgrid;
    const storageFileSet = storageResolved.fileSet;

    // Helper to verify image filenames directly against storage
    function verifyFilenamesAgainstStorage(
      filenames: string[],
      _subgridKey?: string
    ): { count: number; verifiedFilenames: string[] } {
      if (!filenames || filenames.length === 0) {
        return { count: 0, verifiedFilenames: [] };
      }

      // Check in-memory storage file set from bucket list
      if (storageFileSet.size > 0) {
        const verified = filenames.filter((fn) => {
          const cleanFn = fn.split('/').pop()?.toLowerCase().trim() || fn.toLowerCase().trim();
          return storageFileSet.has(cleanFn) || storageFileSet.has(fn.toLowerCase().trim());
        });
        return { count: verified.length, verifiedFilenames: verified };
      }

      // If storage list is empty or track images are not uploaded, count is 0
      return { count: 0, verifiedFilenames: [] };
    }

    // Query qa_defects table to aggregate actual defect counts per subgrid
    const qaDefectsPerSubgrid = new Map<string, number>();
    const knownDefectFilenames = new Set<string>();
    const knownDefectsList: any[] = [];
    try {
      const { data: qdRows } = await scoped(supabase.from('qa_defects').select('point_id, filename, item_key, subgrid, qa_status, defect_flags, defect_count, defect_type, is_resolved'));
      if (qdRows && qdRows.length > 0) {
        qdRows.forEach((r: any) => {
          const fn = (r.point_id || r.filename || r.item_key || '').split('/').pop()?.toUpperCase().trim();
          if (fn) {
            knownDefectFilenames.add(fn);
            knownDefectsList.push(r);
          }
          const isFlagged = r.qa_status === 'flagged' ||
            (r.defect_flags && typeof r.defect_flags === 'object' && Object.values(r.defect_flags).some(Boolean)) ||
            (r.defect_count && Number(r.defect_count) > 0);
          if (isFlagged && r.subgrid) {
            const norm = (extractSubgrid(r.subgrid) || r.subgrid).toUpperCase().trim();
            qaDefectsPerSubgrid.set(norm, (qaDefectsPerSubgrid.get(norm) || 0) + 1);
          }
        });
      }
    } catch (_) { }

    // Query cloud qaqc_audit_runs table for persisted QAQC audit metrics
    const qaqcRunsTable = settings?.qaqcRunsTable || import.meta.env.VITE_DB_QAQC_RUNS_TABLE || DATABASE_TABLE_DEFAULTS.qaqcRunsTable;
    let cloudAuditCache: Record<string, any> = {};
    try {
      const { data: auditRows } = await scoped(supabase.from(qaqcRunsTable).select('subgrid, run_id, total_stations, defect_count, pass_rate, mean_tenengrad_score, defects_list, history, pic, user_id, user_email, completed_at, created_at'));
      if (auditRows && auditRows.length > 0) {
        auditRows.forEach((r: any) => {
          const norm = (extractSubgrid(r.subgrid) || r.subgrid || '').toUpperCase().trim();
          const runId = r.run_id || 'default';
          const entry = {
            subgrid: norm,
            runId: r.run_id || null,
            totalStations: Number(r.total_stations) || 0,
            defectCount: Number(r.defect_count) || 0,
            passRate: Number(r.pass_rate) || 100,
            meanTenengradScore: Number(r.mean_tenengrad_score) || 0,
            defectsList: Array.isArray(r.defects_list) ? r.defects_list : [],
            history: Array.isArray(r.history) ? r.history : [],
            pic: r.pic || '',
            user_id: r.user_id,
            user_email: r.user_email,
            completedAt: r.completed_at || r.created_at
          };
          cloudAuditCache[`${norm}_${runId}`] = entry;
          if (!cloudAuditCache[`${norm}_default`]) {
            cloudAuditCache[`${norm}_default`] = entry;
          }
          if (Array.isArray(r.defects_list)) {
            r.defects_list.forEach((d: any) => {
              const dfn = (d.point_id || d.filename || d.pointId || d.image_url || '').split('/').pop()?.toUpperCase().trim();
              if (dfn) {
                knownDefectFilenames.add(dfn);
                knownDefectsList.push(d);
              }
            });
          }
        });
      }
    } catch (_) { }

    // Group published database records by individual survey run (runKey) so daily journeys remain separate
    const publishedGrouped = new Map<string, {
      runKey: string;
      subgrid: string;
      imageFilenames: string[];
      points: { lat: number; lon: number }[];
      dateStr: string;
      grid: string;
      pic?: string;
      recordKm?: number;
      recordDefects?: number;
      recordImages?: number;
    }>();
    const publishedFilenamesSet = new Set<string>();

    // Process published rows
    publishedRows.forEach(r => {
      const filename = r.filename || r.image_url || '';
      const sg = (r.subgrid || extractSubgrid(filename) || extractSubgrid(r.description) || 'UNKNOWN').toUpperCase().trim();
      if (!sg || sg === 'UNKNOWN' || sg === 'N/A') return;
      if (filename) {
        publishedFilenamesSet.add(filename.toLowerCase().trim());
        const base = filename.split('/').pop()?.toLowerCase().trim();
        if (base) {
          publishedFilenamesSet.add(base);
          publishedFilenamesSet.add(`/mms_pic/${base}`);
          publishedFilenamesSet.add(`mms_pic/${base}`);
        }
      }

      let lat: number | undefined = r.latitude ?? r.lat;
      let lon: number | undefined = r.longitude ?? r.lon;

      if ((lat === undefined || lon === undefined) && r.geom) {
        let geomObj = r.geom;
        if (typeof geomObj === 'string') {
          const match = geomObj.match(/POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
          if (match) {
            lon = parseFloat(match[1]);
            lat = parseFloat(match[2]);
          } else {
            try { geomObj = JSON.parse(geomObj); } catch { }
          }
        }
        if (geomObj && geomObj.coordinates && Array.isArray(geomObj.coordinates) && geomObj.coordinates.length >= 2) {
          lon = Number(geomObj.coordinates[0]);
          lat = Number(geomObj.coordinates[1]);
        }
      }

      const rawDate = r.captured_at
        ? new Date(r.captured_at).toISOString().slice(0, 10)
        : (r.date || r.survey_date || (r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)));
      const extractedBatchId = r.description ? (r.description.match(/\[(.*?)\]/)?.[1] || r.description.match(/daily-[\w-]+/)?.[0] || r.description.match(/staging-[\w-]+/)?.[0]) : null;
      const extractedPublishSignature = r.description ? r.description.match(/Published Batch \([^)]+\) - ([\d\-: ]+)/)?.[0] : null;
      const runKey = r.batch_id || r.run_id || extractedBatchId || (extractedPublishSignature ? `${sg}_${extractedPublishSignature}` : `${sg}_${rawDate}`);

      const rowPic = r.pic || r.person_in_charge || r.operator || r.surveyor || r.created_by || r.pic_name || knownMetadata[sg]?.pic || '';

      if (!publishedGrouped.has(runKey)) {
        publishedGrouped.set(runKey, {
          runKey: runKey,
          subgrid: sg,
          imageFilenames: [],
          points: [],
          dateStr: rawDate,
          grid: knownMetadata[sg]?.grid || '1',
          pic: rowPic,
          recordKm: typeof r.km_processed === 'number' ? r.km_processed : typeof r.kmProcessed === 'number' ? r.kmProcessed : undefined,
          recordDefects: typeof r.defects === 'number' ? r.defects : typeof r.defect_count === 'number' ? r.defect_count : undefined,
          recordImages: typeof r.images_processed === 'number' ? r.images_processed : typeof r.imagesProcessed === 'number' ? r.imagesProcessed : typeof r.images === 'number' ? r.images : undefined
        });
      }

      const g = publishedGrouped.get(runKey)!;
      if (!g.pic && rowPic) {
        g.pic = rowPic;
      }
      const rowDefects = typeof r.defects === 'number' ? r.defects : typeof r.defect_count === 'number' ? r.defect_count : 0;
      if (rowDefects > 0) {
        g.recordDefects = (g.recordDefects || 0) + rowDefects;
      }
      if (filename && !g.imageFilenames.includes(filename)) {
        g.imageFilenames.push(filename);
      }
      if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
        g.points.push({ lat, lon });
      }
    });

    const dailyData: any[] = [];

    // Push published daily records
    const publishedEntries = Array.from(publishedGrouped.entries());
    for (const [runKey, g] of publishedEntries) {
      const subgrid = g.subgrid;
      const explicitPoi = g.recordImages || g.imageFilenames.length || g.points.length || 0;
      const countFromDB = g.imageFilenames.length || explicitPoi;
      const poiCount = countFromDB > 0 ? countFromDB : explicitPoi;

      // For published records: storage-verify actual DB filenames against bucket.
      // Fall back to g.imageFilenames.length only if storage verification is unavailable.
      let verifiedImagesCount = 0;
      let verifiedFiles: string[] = [];
      if (g.imageFilenames.length > 0) {
        const verifyRes = await verifyFilenamesAgainstStorage(g.imageFilenames, subgrid);
        verifiedImagesCount = typeof verifyRes.count === 'number' ? verifyRes.count : 0;
        verifiedFiles = verifyRes.verifiedFilenames || [];
      } else {
        verifiedImagesCount = 0;
        verifiedFiles = [];
      }

      const finalImageCount = poiCount > 0 ? Math.min(poiCount, verifiedImagesCount) : verifiedImagesCount;

      const grid = g.grid || '1';
      const pic = formatPIC(g.pic || knownMetadata[subgrid]?.pic || 'Unassigned');
      const equipment = 'MMS';

      const calcKm = calculatePathDistanceKm(g.points);
      const km = calcKm > 0 ? calcKm : Math.round((poiCount * 0.005) * 100) / 100;

      const normSubgrid = subgrid.toUpperCase().trim();
      const runId = `sp-d-${runKey}`;
      const subgridDefectsFromDb = qaDefectsPerSubgrid.get(normSubgrid) || 0;
      const cachedAudit = cloudAuditCache[`${normSubgrid}_${runId}`] || (runKey ? cloudAuditCache[`${normSubgrid}_${runKey}`] : undefined) || cloudAuditCache[`${normSubgrid}_default`] || Object.entries(cloudAuditCache).find(([k]) => k.startsWith(`${normSubgrid}_`))?.[1];
      const cachedDefectCount = (cachedAudit && typeof cachedAudit.defectCount === 'number')
        ? cachedAudit.defectCount
        : (g.recordDefects || subgridDefectsFromDb || 0);
      const defects = (poiCount > 0 || finalImageCount > 0)
        ? Math.min(cachedDefectCount, Math.max(poiCount, finalImageCount))
        : cachedDefectCount;
      const qaqcStatus = cachedAudit || defects > 0
        ? (defects === 0 ? 'Published (QAQC Verified)' : `Published (${defects} Defect${defects === 1 ? '' : 's'} Found)`)
        : undefined;

      let dateFormatted = g.dateStr;
      const d = new Date(g.dateStr);
      if (!isNaN(d.getTime())) {
        dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      dailyData.push({
        id: `sp-d-${runKey}`,
        date: dateFormatted,
        grid: grid,
        subgrid: subgrid,
        kmProcessed: km,
        imagesProcessed: finalImageCount,
        poiCount: poiCount,
        availableImagesCount: finalImageCount,
        availableFilenames: verifiedFiles.length > 0 ? verifiedFiles : undefined,
        defectCount: defects,
        imagesDefected: defects,
        ...(qaqcStatus ? { qaqcStatus } : {}),
        captureEquipment: equipment,
        publishToWebGIS: 'yes',
        action: 'Published in database',
        pic: pic,
        isSyncedWithSupabase: true,
        points: g.points,
        panoramas: g.points.map((pt, pIdx) => {
          const fn = g.imageFilenames[pIdx] || `${subgrid}-${String(pIdx + 1).padStart(4, '0')}.jpg`;
          const cleanFn = (fn.split('/').pop() || '').toUpperCase().trim();
          const isDef = cleanFn ? knownDefectFilenames.has(cleanFn) : false;
          const isAvail = verifiedFiles.length > 0 ? (verifiedFiles.includes(fn) || verifiedFiles.some(vf => vf.toLowerCase() === fn.toLowerCase())) : true;
          return {
            id: `pub-pt-${runKey}-${pIdx}`,
            runId: `sp-d-${runKey}`,
            filename: fn,
            latitude: pt.lat,
            longitude: pt.lon,
            lat: pt.lat,
            lon: pt.lon,
            subgrid: subgrid,
            status: isDef ? 'defect' : 'yes',
            qa_status: isDef ? 'defect' : 'published',
            publishToWebGIS: isDef ? 'need to recheck' : 'yes',
            publishToUSVPRO: isDef ? 'need to recheck' : 'yes',
            isPublished: !isDef,
            published: !isDef,
            isDefect: isDef,
            is_defect: isDef,
            isAvailable: isAvail,
            opacity: 1.0,
            color: isDef ? '#ef4444' : '#10b981',
            statusColor: isDef ? '#ef4444' : '#10b981',
            strokeColor: isDef ? '#ef4444' : '#10b981',
            fillColor: isDef ? '#ef4444' : '#10b981'
          };
        })
      });
    }

    // 2. Query staging_panoramas table for persistent staged records
    try {
      const { data: stagingData, error: stagingErr } = await scoped(supabase.from('staging_panoramas').select('*'));
      if (!stagingErr && stagingData && stagingData.length > 0) {
        const stagingGrouped = new Map<string, any>();
        stagingData.forEach((r: any) => {
          const filename = r.filename || r.image_url || '';
          const desc = r.description || '';
          const extractedSubgrid = r.subgrid || (desc.match(/\((.*?)\)/)?.[1]) || extractSubgrid(filename) || extractSubgrid(desc) || 'UNKNOWN';
          const sg = extractedSubgrid.toUpperCase().trim();
          if (!sg || sg === 'UNKNOWN' || sg === 'N/A') return;

          // If this specific image has already been published in production, skip it
          if (r.status === 'yes' || r.status === 'published' || r.publish_to_webgis === 'yes' || r.publishToWebGIS === 'yes' || r.qa_status === 'published') return;
          const baseName = (filename.split('/').pop() || filename).toLowerCase().trim();
          const cleanNoExt = baseName.replace(/\.[^/.]+$/, '');
          if (filename && (
            publishedFilenamesSet.has(filename.toLowerCase().trim()) ||
            publishedFilenamesSet.has(baseName) ||
            publishedFilenamesSet.has(cleanNoExt)
          )) return;

          // Extract encoded metadata tags
          const extractedBatchId = r.batch_id || r.run_id || (desc.match(/\[id:(.*?)\]/)?.[1]) || (desc.match(/\[(.*?)\]/)?.[1]) || null;
          const extractedPic = r.pic || r.person_in_charge || (desc.match(/\[pic:(.*?)\]/)?.[1]) || knownMetadata[sg]?.pic || 'Unassigned';
          const extractedGrid = r.grid ? String(r.grid) : (desc.match(/\[grid:(.*?)\]/)?.[1] || knownMetadata[sg]?.grid || '1');
          const extractedPoi = r.poi_count ? Number(r.poi_count) : (desc.match(/\[poi:(\d+)\]/)?.[1] ? Number(desc.match(/\[poi:(\d+)\]/)?.[1]) : 0);
          const extractedKm = typeof r.km_processed === 'number' ? r.km_processed : (desc.match(/\[km:([\d.]+)\]/)?.[1] ? parseFloat(desc.match(/\[km:([\d.]+)\]/)?.[1]) : 0);
          const extractedEq = r.capture_equipment || r.equipment || (desc.match(/\[eq:(.*?)\]/)?.[1]) || 'MMS';
          const extractedPub = r.status || r.publish_to_webgis || (desc.match(/\[pub:(.*?)\]/)?.[1]) || 'in process';

          const runKey = extractedBatchId || `${sg}_${r.id || `${extractedPoi}_${extractedKm}`}`;

          if (!stagingGrouped.has(runKey)) {
            stagingGrouped.set(runKey, {
              key: runKey,
              subgrid: sg,
              grid: extractedGrid,
              pic: extractedPic,
              imageFilenames: [],
              poiCount: extractedPoi,
              imagesProcessed: extractedPoi,
              kmProcessed: extractedKm,
              defectCount: r.defect_count || 0,
              capturedAt: r.captured_at,
              equipment: extractedEq,
              status: extractedPub,
              points: [],
              productionRunId: r.production_run_id || null,
              productionAttemptId: r.production_attempt_id || null,
              productionReleaseId: r.production_release_id || null
            });
          }

           const sgObj = stagingGrouped.get(runKey)!;
           if (r.production_run_id) sgObj.productionRunId = r.production_run_id;
           if (r.production_attempt_id) sgObj.productionAttemptId = r.production_attempt_id;
           if (r.production_release_id) sgObj.productionReleaseId = r.production_release_id;
           if (r.defect_count && Number(r.defect_count) > 0) {
            sgObj.defectCount = (sgObj.defectCount || 0) + Number(r.defect_count);
          }
          if (filename && !sgObj.imageFilenames.includes(filename)) {
            sgObj.imageFilenames.push(filename);
          }
          let lat: number | undefined = r.latitude ?? r.lat;
          let lon: number | undefined = r.longitude ?? r.lon;

          if ((lat === undefined || lon === undefined) && r.geom) {
            let geomObj = r.geom;
            if (typeof geomObj === 'string') {
              const match = geomObj.match(/POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
              if (match) { lon = parseFloat(match[1]); lat = parseFloat(match[2]); }
            } else if (geomObj && geomObj.coordinates && Array.isArray(geomObj.coordinates)) {
              lon = Number(geomObj.coordinates[0]); lat = Number(geomObj.coordinates[1]);
            }
          }
          if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
            sgObj.points.push({ lat, lon });
          }
        });

        const stagingEntries = Array.from(stagingGrouped.entries());
        for (const [runKey, g] of stagingEntries) {
          const sg = g.subgrid;
          const explicitPoi = g.poiCount || g.imagesProcessed || g.imageFilenames.length || g.points.length || 0;
          const count = explicitPoi;
          const calcKm = calculatePathDistanceKm(g.points);
          const km = g.kmProcessed > 0 ? g.kmProcessed : (calcKm > 0 ? calcKm : Math.round((count * 0.005) * 100) / 100);
          const rawDate = g.capturedAt ? new Date(g.capturedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
          let dateFormatted = rawDate;
          const dObj = new Date(rawDate);
          if (!isNaN(dObj.getTime())) {
            dateFormatted = dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }

          let verifiedCount = 0;
          let verifiedFiles: string[] = [];
          if (g.imageFilenames && g.imageFilenames.length > 0) {
            const verifyRes = await verifyFilenamesAgainstStorage(g.imageFilenames, sg);
            verifiedCount = typeof verifyRes.count === 'number' ? verifyRes.count : 0;
            verifiedFiles = verifyRes.verifiedFilenames || [];
          } else {
            const normSg = (sg || '').toUpperCase().trim();
            verifiedCount = storageImageCounts.get(normSg) || 0;
            verifiedFiles = [];
          }

          const finalImgCount = verifiedCount;
          const picName = formatPIC(g.pic || knownMetadata[sg]?.pic || 'Unassigned');
          const normSg = sg.toUpperCase().trim();
          const runId = `staging-d-${runKey}`;
          const subgridDefectsFromDb = qaDefectsPerSubgrid.get(normSg) || 0;
          const cachedAudit = cloudAuditCache[`${normSg}_${runId}`] || (runKey ? cloudAuditCache[`${normSg}_${runKey}`] : undefined) || cloudAuditCache[`${normSg}_default`] || Object.entries(cloudAuditCache).find(([k]) => k.startsWith(`${normSg}_`))?.[1];
          const cachedDefectCount = (cachedAudit && typeof cachedAudit.defectCount === 'number')
            ? cachedAudit.defectCount
            : (g.defectCount || subgridDefectsFromDb || 0);
          const finalDefectCount = (explicitPoi > 0 || finalImgCount > 0)
            ? Math.min(cachedDefectCount, Math.max(explicitPoi, finalImgCount))
            : cachedDefectCount;
          const isPub = g.status === 'yes';
          const qaqcStatus = cachedAudit || finalDefectCount > 0
            ? (isPub
              ? (finalDefectCount === 0 ? 'Published (QAQC Verified)' : `Published (${finalDefectCount} Defect${finalDefectCount === 1 ? '' : 's'} Found)`)
              : (finalDefectCount === 0 ? 'QAQC Passed (Ready to Publish)' : `QAQC Flagged (${finalDefectCount} Defect${finalDefectCount === 1 ? '' : 's'} Found)`)
            )
            : undefined;

          dailyData.push({
            id: `staging-d-${runKey}`,
            date: dateFormatted,
            grid: g.grid,
            subgrid: sg,
            kmProcessed: km,
            imagesProcessed: finalImgCount,
            poiCount: count,
            availableImagesCount: finalImgCount,
            availableFilenames: verifiedFiles.length > 0 ? verifiedFiles : undefined,
            defectCount: finalDefectCount,
            imagesDefected: finalDefectCount,
            ...(qaqcStatus ? { qaqcStatus } : {}),
            captureEquipment: g.equipment,
            publishToWebGIS: 'in process',
            action: 'Imported (staging)',
            pic: picName,
            isStagingPreview: true,
            isSyncedWithSupabase: false,
             isStagedInSupabase: true,
             productionRunId: g.productionRunId || null,
             productionAttemptId: g.productionAttemptId || null,
             productionReleaseId: g.productionReleaseId || null,
             points: g.points,
             panoramas: g.points.map((pt: any, pIdx: number) => {
              const fn = g.imageFilenames[pIdx] || `${sg}-${String(pIdx + 1).padStart(4, '0')}.jpg`;
              const cleanFn = (fn.split('/').pop() || '').toUpperCase().trim();
              const isDef = cleanFn ? knownDefectFilenames.has(cleanFn) : false;
              const isAvail = verifiedFiles.length > 0 ? (verifiedFiles.includes(fn) || verifiedFiles.some((vf: string) => vf.toLowerCase() === fn.toLowerCase())) : false;
              return {
                id: `staging-pt-${runKey}-${pIdx}`,
                runId: `staging-d-${runKey}`,
                filename: fn,
                latitude: pt.lat,
                longitude: pt.lon,
                lat: pt.lat,
                lon: pt.lon,
                subgrid: sg,
                status: isDef ? 'defect' : 'in process',
                qa_status: isDef ? 'defect' : 'in process',
                publishToWebGIS: isDef ? 'need to recheck' : 'in process',
                publishToUSVPRO: isDef ? 'need to recheck' : 'in process',
                isPublished: false,
                published: false,
                isDefect: isDef,
                is_defect: isDef,
                isAvailable: isAvail,
                opacity: 0.5,
                color: isDef ? '#ef4444' : '#f59e0b',
                statusColor: isDef ? '#ef4444' : '#f59e0b',
                strokeColor: isDef ? '#ef4444' : '#f59e0b',
                fillColor: isDef ? '#ef4444' : '#f59e0b'
              };
            })
          });
        }
      }
    } catch (e) {
      console.warn('Error reading staging_panoramas:', e);
    }

    // 3. Build masterlist Batch Logs by aggregating all dailyData runs per subgrid
    const batchMap = new Map<string, any>();
    dailyData.forEach(d => {
      const sg = (extractSubgrid(d.subgrid || d.imageFilename) || d.subgrid || '').toUpperCase().trim();
      if (!sg) return;

      const isPublished = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;
      const singlePoi = d.poiCount || 0;
      const singleImg = typeof d.imagesProcessed === 'number' ? d.imagesProcessed : (typeof d.availableImagesCount === 'number' ? d.availableImagesCount : 0);
      const kmVal = Number(d.kmProcessed || 0);
      const defCount = Number(d.imagesDefected || d.defectCount || 0);

      const existing = batchMap.get(sg);
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
        if (d.qaqcStatus) existing.qaqcStatus = d.qaqcStatus;
        existing.runsCount += 1;
        if (d.panoramas && d.panoramas.length > 0) {
          if (!existing.panoramas) existing.panoramas = [];
          existing.panoramas = [...existing.panoramas, ...d.panoramas];
        }
        if (d.availableFilenames && Array.isArray(d.availableFilenames)) {
          if (!existing.availableFilenames) existing.availableFilenames = [];
          d.availableFilenames.forEach((fn: string) => {
            if (!existing.availableFilenames.includes(fn)) existing.availableFilenames.push(fn);
          });
        }
      } else {
        const initialAvailFiles = d.availableFilenames && Array.isArray(d.availableFilenames)
          ? [...d.availableFilenames]
          : (d.panoramas ? d.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter(Boolean) : []);

        const adminPic = formatPIC(knownMetadata[sg]?.pic || 'Admin');

        batchMap.set(sg, {
          id: `BATCH-${sg}`,
          subgrid: sg,
          grid: d.grid || '',
          date: d.date || new Date().toISOString().slice(0, 10),
          imageFilename: (d.panoramas?.[0]?.filename) || `${sg}-0001.jpg`,
          totalImages: singleImg,
          publishedImages: isPublished ? singleImg : 0,
          totalPoi: singlePoi,
          publishedPoi: isPublished ? singlePoi : 0,
          publishedKm: isPublished ? kmVal : 0,
          totalKm: kmVal,
          defects: defCount,
          qaqcStatus: d.qaqcStatus,
          adminPic: adminPic,
          captureEquipment: d.captureEquipment || 'MMS',
          panoramas: d.panoramas ? [...d.panoramas] : [],
          availableFilenames: initialAvailFiles,
          runsCount: 1,
          publishedRunsCount: isPublished ? 1 : 0
        });
      }
    });

    const batchLogs: any[] = [];
    batchMap.forEach((entry, sg) => {
      const finalImages = typeof entry.totalImages === 'number' ? entry.totalImages : (typeof entry.publishedImages === 'number' ? entry.publishedImages : 0);
      const isComplete = entry.publishedRunsCount > 0 && entry.publishedRunsCount === entry.runsCount && finalImages >= entry.totalPoi && entry.totalPoi > 0;
      batchLogs.push({
        id: `BATCH-${sg}`,
        date: entry.date,
        grid: entry.grid,
        subgrid: sg,
        imageFilename: entry.imageFilename,
        images: finalImages,
        poiCount: entry.totalPoi,
        availableImagesCount: finalImages,
        availableFilenames: entry.availableFilenames && entry.availableFilenames.length > 0 ? entry.availableFilenames : undefined,
        defects: entry.defects,
        kmProcessed: entry.totalKm,
        status: isComplete ? 'Complete' : 'Ongoing',
        captureEquipment: entry.captureEquipment,
        pic: 'Admin',
        isSyncedWithSupabase: entry.publishedRunsCount > 0,
        panoramas: entry.panoramas
      });
    });

    return { batchLogs, dailyData, defectsList: knownDefectsList };
  } catch (err) {
    console.error('Error in fetchSupabaseData:', err);
    return { dailyData: [], batchLogs: [], error: (err as Error).message };
  }
}

/**
 * Publish / Upsert panorama records to Supabase database.
 * Guarantees valid PostGIS geom coordinates for every inserted row to prevent Leaflet LatLng crashes.
 */
export async function publishToSupabase(record: {
  id?: string;
  date?: string;
  grid?: string;
  subgrid?: string;
  imageFilename?: string;
  images?: number;
  imagesProcessed?: number;
  poiCount?: number;
  defects?: number;
  defectCount?: number;
  imagesDefected?: number;
  kmProcessed?: number;
  captureEquipment?: string;
  publishToWebGIS?: string;
  action?: string;
  pic?: string;
  status?: string;
  panoramas?: PanoramaItem[];
  rawRows?: PanoramaItem[];
  productionRunId?: string | null;
  productionAttemptId?: string | null;
  productionReleaseId?: string | null;
}): Promise<{ success: boolean; message: string }> {
  try {
    const publicationGate = await checkProductionPublicationEligibility(record);
    if (!publicationGate.allowed) {
      return {
        success: false,
        message: `Publication blocked: ${publicationGate.reason}`
      };
    }

    let rawList: PanoramaItem[] = [];

    if (record.panoramas && record.panoramas.length > 0) {
      const maxCount = record.poiCount || record.imagesProcessed || record.panoramas.length;
      rawList = record.panoramas.slice(0, maxCount);
    } else if (record.rawRows && record.rawRows.length > 0) {
      const maxCount = record.poiCount || record.imagesProcessed || record.rawRows.length;
      rawList = record.rawRows.slice(0, maxCount);
    } else {
      const count = record.poiCount || record.imagesProcessed || 1;
      const baseFn = record.imageFilename || (record.subgrid ? `${record.subgrid}-0001.jpg` : 'IMG-0001.jpg');
      const ext = baseFn.includes('.') ? baseFn.slice(baseFn.lastIndexOf('.')) : '.jpg';
      const prefix = record.subgrid || baseFn.split('-')[0] || 'IMG';
      rawList = [];
      for (let idx = 1; idx <= count; idx++) {
        rawList.push({
          filename: `${prefix}-${String(idx).padStart(4, '0')}${ext}`,
          date: record.date
        });
      }
    }

    const parseToIsoTimestamp = (rawDate?: string): string => {
      if (!rawDate) return new Date().toISOString();
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          return d.toISOString();
        }
      } catch { }
      const parts = String(rawDate).trim().split(/[\/\-]/);
      if (parts.length === 3) {
        const [m, d, y] = parts.map(Number);
        if (!isNaN(m) && !isNaN(d) && !isNaN(y)) {
          const year = y < 100 ? 2000 + y : y;
          return new Date(Date.UTC(year, m - 1, d)).toISOString();
        }
      }
      return new Date().toISOString();
    };

    const currentPid = getServiceProjectId();
    const itemsToInsert: SupabasePanoramaRecord[] = rawList.map((p: any) => {
      const filename = p.filename || p.imageFilename || record.imageFilename || '';
      const sgKey = record.subgrid ? record.subgrid.toUpperCase().trim() : extractSubgrid(filename);
      if (!filename || !sgKey) {
        throw new Error('Every published panorama needs a filename and subgrid');
      }
      const cachedCoords = SUBGRID_COORDINATES[sgKey];

      const hasRealLon = p.longitude !== undefined && !isNaN(Number(p.longitude))
        ? true
        : p.lon !== undefined && !isNaN(Number(p.lon));
      const hasRealLat = p.latitude !== undefined && !isNaN(Number(p.latitude))
        ? true
        : p.lat !== undefined && !isNaN(Number(p.lat));

      const rawLon = hasRealLon ? Number(p.longitude ?? p.lon) : (cachedCoords ? cachedCoords[0] : null);
      const rawLat = hasRealLat ? Number(p.latitude ?? p.lat) : (cachedCoords ? cachedCoords[1] : null);
      const hasCoords = rawLon !== null && rawLat !== null && !isNaN(rawLon) && !isNaN(rawLat);
      if (!hasCoords) {
        throw new Error(`Cannot publish ${filename}: latitude and longitude are required`);
      }
      const longitude = Number(rawLon);
      const latitude = Number(rawLat);

      return {
        ...(currentPid ? { project_id: currentPid } : {}),
        subgrid: sgKey,
        filename,
        image_url: filename,
        captured_at: parseToIsoTimestamp(p.date || p.captured_at || record.date),
        description: `Published Batch (Grid ${record.grid || '1'} / ${sgKey}) [id:${record.id || 'batch'}] [pic:${record.pic || 'Unassigned'}] - ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
        latitude,
        longitude,
        heading: Number(p.bearing ?? p.heading ?? 0),
        pitch: Number(p.pitch ?? 0),
        roll: Number(p.roll ?? 0),
        is_fallback_coord: !hasRealLon || !hasRealLat,
        defect_count: (p.is_defect || (p.defect_flags && typeof p.defect_flags === 'object' && Object.values(p.defect_flags).some(Boolean))) ? 1 : 0,
        qa_status: p.is_defect ? 'flagged' : 'published',
        defect_flags: p.defect_flags || {},
        geom: {
          type: 'Point',
          coordinates: [longitude, latitude]
        }
      };
    });

    // 3H: Atomic publish using upsert on unique filename constraint.
    // Avoids hazardous delete-then-insert where network failure results in permanent data loss.
    const chunkSize = 50;
    for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
      const chunk = itemsToInsert.slice(i, i + chunkSize);
      const { error: upsertErr } = await supabase
        .from('panoramas')
        .upsert(chunk, { onConflict: currentPid ? 'project_id,filename' : 'filename' });

      if (upsertErr) {
        console.warn('publishToSupabase upsert batch error, attempting fallback insert:', upsertErr);
        const { error: insErr } = await supabase.from('panoramas').insert(chunk);
        if (insErr) {
          throw new Error(`Failed to publish batch to panoramas: ${insErr.message || upsertErr.message}`);
        }
      }
    }

    return { success: true, message: `Successfully published ${itemsToInsert.length} items to Supabase panoramas table` };
  } catch (err) {
    console.error('publishToSupabase exception:', err);
    return { success: false, message: (err as Error).message || 'Failed to publish to database' };
  }
}

/**
 * Save / Upsert panorama records to staging_panoramas table in Supabase.
 */
export async function saveToStagingSupabase(record: {
  id?: string;
  date?: string;
  grid?: string;
  subgrid?: string;
  imageFilename?: string;
  images?: number;
  imagesProcessed?: number;
  poiCount?: number;
  defects?: number;
  kmProcessed?: number;
  captureEquipment?: string;
  pic?: string;
  publishToWebGIS?: string;
  panoramas?: PanoramaItem[];
  rawRows?: PanoramaItem[];
  productionRunId?: string | null;
  productionAttemptId?: string | null;
}): Promise<{ success: boolean; message: string }> {
  try {
    let rawList: PanoramaItem[] = [];

    if (record.panoramas && record.panoramas.length > 0) {
      const maxCount = record.poiCount || record.imagesProcessed || record.panoramas.length;
      rawList = record.panoramas.slice(0, maxCount);
    } else if (record.rawRows && record.rawRows.length > 0) {
      const maxCount = record.poiCount || record.imagesProcessed || record.rawRows.length;
      rawList = record.rawRows.slice(0, maxCount);
    } else {
      rawList = [{
        filename: record.imageFilename || '',
        date: record.date
      }];
    }

    const currentPid = getServiceProjectId();
    const itemsToInsert = rawList.map((p: any) => {
      const filename = p.filename || p.imageFilename || record.imageFilename || '';
      const sgKey = record.subgrid ? record.subgrid.toUpperCase() : extractSubgrid(filename);
      const cachedCoords = SUBGRID_COORDINATES[sgKey];

      const hasRealLon = p.longitude !== undefined && !isNaN(Number(p.longitude))
        ? true
        : p.lon !== undefined && !isNaN(Number(p.lon));
      const hasRealLat = p.latitude !== undefined && !isNaN(Number(p.latitude))
        ? true
        : p.lat !== undefined && !isNaN(Number(p.lat));

      const rawLon = hasRealLon ? Number(p.longitude ?? p.lon) : (cachedCoords ? cachedCoords[0] : null);
      const rawLat = hasRealLat ? Number(p.latitude ?? p.lat) : (cachedCoords ? cachedCoords[1] : null);
      const hasCoords = rawLon !== null && rawLat !== null && !isNaN(rawLon) && !isNaN(rawLat);
      if (!filename || !sgKey || !hasCoords) {
        throw new Error(`Cannot stage ${filename || 'panorama'}: filename, subgrid, latitude, and longitude are required`);
      }
      const longitude = Number(rawLon);
      const latitude = Number(rawLat);

      const itemDate = p.date || record.date;
      const capturedAtIso = itemDate && !isNaN(new Date(itemDate).getTime())
        ? new Date(itemDate).toISOString()
        : new Date().toISOString();

      return {
        ...(currentPid ? { project_id: currentPid } : {}),
        ...(record.productionRunId || p.productionRunId
          ? { production_run_id: record.productionRunId || p.productionRunId }
          : {}),
        ...(record.productionAttemptId || p.productionAttemptId
          ? { production_attempt_id: record.productionAttemptId || p.productionAttemptId }
          : {}),
        filename,
        image_url: filename,
        captured_at: capturedAtIso,
        description: `Staged Batch (${record.subgrid || filename}) [id:${record.id || 'batch'}] [pic:${record.pic || p.pic || 'Unassigned'}] [grid:${record.grid || '1'}] [poi:${record.poiCount || rawList.length}] [km:${record.kmProcessed || 0}] [eq:${record.captureEquipment || 'MMS'}] [pub:${record.publishToWebGIS || 'in process'}]`,
        latitude,
        longitude,
        heading: Number(p.bearing ?? p.heading ?? 0),
        pitch: Number(p.pitch ?? 0),
        roll: Number(p.roll ?? 0),
        subgrid: sgKey,
        grid: record.grid || '1',
        km_processed: record.kmProcessed || 0,
        poi_count: record.poiCount || rawList.length,
        images_processed: record.imagesProcessed || rawList.length,
        defect_count: typeof record.defects === 'number' ? record.defects : 0,
        capture_equipment: record.captureEquipment || p.captureEquipment || 'MMS',
        status: record.publishToWebGIS || 'In Process',
        is_fallback_coord: !hasRealLon || !hasRealLat,
        geom: { type: 'Point', coordinates: [longitude, latitude] }
      };
    });

    // Atomic / safe upsert into staging_panoramas table
    const chunkSize = 50;
    for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
      const chunk = itemsToInsert.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('staging_panoramas')
        .upsert(chunk, { onConflict: currentPid ? 'project_id,filename' : 'filename' });

      if (error) {
        console.warn('Supabase staging_panoramas upsert notice, trying REST API:', error.message);
        const response = await fetch(`${supabaseUrl}/rest/v1/staging_panoramas`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(chunk)
        });
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({ message: response.statusText }));
          console.error('REST staging upsert failed:', errBody);
          return { success: false, message: errBody.message || error.message };
        }
      }
    }
    return { success: true, message: `Staged ${itemsToInsert.length} item(s) for ${record.subgrid || 'subgrid'} in Supabase staging database.` };
  } catch (err) {
    console.warn('Error saving to Supabase staging:', err);
    return { success: false, message: (err as Error).message || 'Failed to save to staging' };
  }
}

/**
 * Delete records from staging_panoramas table for a subgrid.
 */
export async function deleteFromStagingSupabase(subgrid: string, filenames?: string[]): Promise<{ success: boolean; message: string }> {
  try {
    const cleanSub = (subgrid || '').trim();
    if (!cleanSub) return { success: true, message: 'No subgrid specified' };

    if (filenames && filenames.length > 0) {
      const allVariants = new Set<string>();
      filenames.forEach(f => {
        const clean = f.trim();
        if (clean) {
          allVariants.add(clean);
          const base = clean.split('/').pop() || clean;
          allVariants.add(base);
          allVariants.add(`/MMS_PIC/${base}`);
          allVariants.add(`MMS_PIC/${base}`);
        }
      });
      const cleanFns = Array.from(allVariants);
      await supabase.from('staging_panoramas').delete().in('filename', cleanFns);
      try {
        await fetch(`${supabaseUrl}/rest/v1/staging_panoramas?filename=in.(${cleanFns.map(encodeURIComponent).join(',')})`, {
          method: 'DELETE',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        });
      } catch { }
    } else {
      await supabase
        .from('staging_panoramas')
        .delete()
        .or(`subgrid.ilike.${cleanSub},filename.ilike.${cleanSub}%`);
    }

    return { success: true, message: `Removed published items for ${cleanSub} from staging database.` };
  } catch (err) {
    console.warn('deleteFromStagingSupabase exception:', err);
    return { success: false, message: (err as Error).message || 'Failed to delete from staging' };
  }
}

/**
 * Permanently delete specific panorama points / filenames from Supabase database.
 */
export async function deletePointsFromSupabase(
  filenames: string[],
  _subgrid?: string
): Promise<{ success: boolean; message: string; deletedCount: number }> {
  try {
    const validFilenames = filenames.filter(Boolean).map((f) => f.trim());
    if (validFilenames.length === 0) {
      return { success: false, message: 'No filenames provided for point deletion', deletedCount: 0 };
    }

    const allVariants = new Set<string>();
    validFilenames.forEach((fn) => {
      allVariants.add(fn);
      const base = fn.split('/').pop() || fn;
      allVariants.add(base);
      allVariants.add(`/MMS_PIC/${base}`);
      allVariants.add(`MMS_PIC/${base}`);
    });
    const cleanFns = Array.from(allVariants);

    // 1. Delete from panoramas table matching filenames
    const { error: pErr } = await supabase
      .from('panoramas')
      .delete()
      .in('filename', cleanFns);

    // 2. Also delete from qa_defects matching filenames
    try {
      await supabase
        .from('qa_defects')
        .delete()
        .in('filename', cleanFns);
    } catch {
      /* ignore */
    }

    if (pErr) {
      console.error('Error deleting specific points from Supabase panoramas:', pErr);
      return { success: false, message: pErr.message, deletedCount: 0 };
    }

    return {
      success: true,
      message: `Successfully deleted ${validFilenames.length} point(s) from database`,
      deletedCount: validFilenames.length
    };
  } catch (err) {
    console.error('Error deleting points from Supabase:', err);
    return { success: false, message: (err as Error).message, deletedCount: 0 };
  }
}

/**
 * Permanently delete records for a subgrid from Supabase database.
 */
export async function deleteFromSupabase(subgrid: string): Promise<{ success: boolean; message: string }> {
  try {
    const cleanSub = (subgrid || '').trim();
    await deleteFromStagingSupabase(cleanSub).catch(() => { });

    const { error: pErr } = await supabase
      .from('panoramas')
      .delete()
      .or(`filename.ilike.${cleanSub}%,filename.ilike.%/${cleanSub}/%,filename.ilike.%-${cleanSub}-%,filename.ilike.%_${cleanSub}%,description.ilike.%/${cleanSub})%`);

    try {
      await supabase
        .from('qa_defects')
        .delete()
        .or(`subgrid.ilike.${cleanSub},filename.ilike.${cleanSub}%,filename.ilike.%/${cleanSub}/%,filename.ilike.%-${cleanSub}-%,filename.ilike.%_${cleanSub}%`);
    } catch { }

    try {
      await supabase
        .from('qaqc_audit_runs')
        .delete()
        .ilike('subgrid', cleanSub);
    } catch { }

    if (pErr) {
      console.error('Error deleting from Supabase panoramas:', pErr);
      return { success: false, message: pErr.message };
    }
    return { success: true, message: `Successfully deleted subgrid ${cleanSub} from database` };
  } catch (err) {
    console.error('Error deleting from Supabase:', err);
    return { success: false, message: (err as Error).message };
  }
}

export interface RecycleBinItem {
  id: string;
  subgrid: string;
  grid?: string;
  type: 'partial_points' | 'whole_subgrid';
  deleted_at: string;
  deleted_by: string;
  poi_count: number;
  km_processed: number;
  points: {
    filename?: string;
    pointId?: string;
    lat: number;
    lng: number;
    bearing?: number;
    pitch?: number;
    roll?: number;
  }[];
  original_record?: any;
}

export const RECYCLE_BIN_TABLE = 'survey_recycle_bin';

/**
 * Save deleted subgrid or points to Supabase Recycle Bin.
 */
export async function saveToRecycleBinInSupabase(item: RecycleBinItem): Promise<boolean> {
  try {
    const { error } = await supabase.from(RECYCLE_BIN_TABLE).insert([{
      id: item.id,
      subgrid: item.subgrid,
      grid: item.grid || '1',
      type: item.type,
      deleted_at: item.deleted_at,
      deleted_by: item.deleted_by,
      poi_count: item.poi_count,
      km_processed: item.km_processed,
      points: item.points,
      original_record: item.original_record
    }]);

    if (error) {
      console.warn('saveToRecycleBinInSupabase Supabase insert note:', error.message);
    }
  } catch (err) {
    console.warn('saveToRecycleBinInSupabase catch:', err);
  }

  try {
    const existing: RecycleBinItem[] = JSON.parse(localStorage.getItem('geosphere360_recycle_bin') || '[]');
    const updated = [item, ...existing.filter(x => x.id !== item.id)];
    localStorage.setItem('geosphere360_recycle_bin', JSON.stringify(updated));
  } catch { }

  return true;
}

/**
 * Fetch all items currently stored in the Recycle Bin.
 */
export async function fetchRecycleBinFromSupabase(): Promise<RecycleBinItem[]> {
  let dbItems: RecycleBinItem[] = [];
  try {
    const { data, error } = await supabase
      .from(RECYCLE_BIN_TABLE)
      .select('*')
      .order('deleted_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      dbItems = data as RecycleBinItem[];
    }
  } catch { }

  try {
    const localItems: RecycleBinItem[] = JSON.parse(localStorage.getItem('geosphere360_recycle_bin') || '[]');
    const idSet = new Set(dbItems.map(i => i.id));
    const merged = [...dbItems];
    localItems.forEach(l => {
      if (!idSet.has(l.id)) merged.push(l);
    });
    return merged.sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());
  } catch {
    return dbItems;
  }
}

/**
 * Remove an item permanently from the Recycle Bin.
 */
export async function deleteFromRecycleBinInSupabase(id: string): Promise<boolean> {
  try {
    await supabase.from(RECYCLE_BIN_TABLE).delete().eq('id', id);
  } catch { }

  try {
    const existing: RecycleBinItem[] = JSON.parse(localStorage.getItem('geosphere360_recycle_bin') || '[]');
    const updated = existing.filter(x => x.id !== id);
    localStorage.setItem('geosphere360_recycle_bin', JSON.stringify(updated));
  } catch { }

  return true;
}

/**
 * Persistable user-edited masterlist batch fields.
 * Only these user-defined values are read back from / written to the
 * configured `batch_logs` table; derived metrics (defects, km, POI) are
 * always recomputed live from the daily/panoramas data.
 */
export interface BatchLogOverride {
  status?: 'Complete' | 'Ongoing' | string;
  pic?: string;
  publishToWebGIS?: string;
  isSyncedWithSupabase?: boolean;
}

/**
 * Load user-defined masterlist batch overrides from the configured `batch_logs`
 * table, keyed by normalized UPPER subgrid. Fail-open: any error resolves to an
 * empty map so data loading is never blocked by a missing table or RLS config.
 */
export async function fetchBatchLogOverridesFromSupabase(settings?: any): Promise<Record<string, BatchLogOverride>> {
  const overrides: Record<string, BatchLogOverride> = {};
  try {
    const batchLogsTableName = getDatabaseTableMapping(settings).batchLogsTable;
    const { data, error } = await supabase
      .from(batchLogsTableName)
      .select('subgrid, status, pic, publish_to_webgis, is_synced_with_supabase');

    if (error) {
      console.warn('fetchBatchLogOverridesFromSupabase notice:', error.message);
      return overrides;
    }

    (data || []).forEach((row) => {
      const rawSg = row?.subgrid;
      if (!rawSg) return;
      const sg = String(rawSg).toUpperCase().trim();
      if (!sg) return;
      overrides[sg] = {
        ...(row.status && String(row.status).trim() ? { status: row.status as string } : {}),
        ...(row.pic && String(row.pic).trim() ? { pic: row.pic as string } : {}),
        ...(row.publish_to_webgis && String(row.publish_to_webgis).trim() ? { publishToWebGIS: row.publish_to_webgis as string } : {}),
        ...(row.is_synced_with_supabase !== undefined && row.is_synced_with_supabase !== null
          ? isTrueish(row.is_synced_with_supabase) ? { isSyncedWithSupabase: true } : { isSyncedWithSupabase: false }
          : {})
      };
    });
  } catch (err) {
    console.warn('fetchBatchLogOverridesFromSupabase exception:', err);
  }
  return overrides;
}

const isTrueish = (v: unknown): boolean => v === true || v === 'true' || v === 'yes' || v === 1 || Number(v) === 1;

/**
 * Persist a user-defined batch (status / PIC / publish flags) to the configured
 * `batch_logs` table. Fire-and-forget friendly: returns false on any failure and
 * never throws, mirroring saveProjectSettingsToSupabase's graceful fail-open.
 */
export async function persistBatchLogToSupabase(batch: BatchLog, settings?: any): Promise<boolean> {
  try {
    const batchLogsTableName = getDatabaseTableMapping(settings).batchLogsTable;
    const row = batchLogToDbRow(batch);
    if (!row.subgrid) return true;

    const { error } = await supabase
      .from(batchLogsTableName)
      .upsert([row], { onConflict: 'subgrid' });

    if (error) {
      console.warn('persistBatchLogToSupabase upsert notice:', error.message);
    }
  } catch (err) {
    console.warn('persistBatchLogToSupabase exception:', err);
  }
  return true;
}

const DATASETS_TABLE = 'datasets';
const STAGING_PANORAMAS_TABLE = 'staging_panoramas';

export interface StagingPanoramaRow {
  id?: string;
  subgrid?: string;
  filename?: string;
  status?: string;
  created_at?: string;
}

/** Minimal capture-metadata fetch from the RAW staging table (lineage Survey tab). */
export async function fetchStagingPanoramasFromSupabase(): Promise<StagingPanoramaRow[]> {
  try {
    const result = await withRetry(
      async () => {
        const query = scoped(supabase
          .from(STAGING_PANORAMAS_TABLE)
          .select('id, subgrid, filename, status, created_at'));
        const res = await query.order('created_at', { ascending: true });
        if (res.error) throw new Error(res.error.message);
        return res;
      },
      { retries: 2 }
    );
    const { data, error } = result as { data: StagingPanoramaRow[] | null; error: any };
    if (error) {
      console.warn('fetchStagingPanoramasFromSupabase:', error.message);
      return [];
    }
    return (data || []) as StagingPanoramaRow[];
  } catch (err) {
    console.warn('fetchStagingPanoramasFromSupabase catch:', err);
    return [];
  }
}

function getDatasetStorageKey(): string {
  const pid = getServiceProjectId();
  return pid ? `geosphere_datasets_${pid}` : 'geosphere_datasets';
}

function getLocalDatasets(): DatasetRecord[] {
  try {
    const raw = localStorage.getItem(getDatasetStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function setLocalDatasets(datasets: DatasetRecord[]): void {
  try {
    localStorage.setItem(getDatasetStorageKey(), JSON.stringify(datasets));
  } catch (_) { }
}

export async function fetchDatasetsFromSupabase(): Promise<DatasetRecord[]> {
  try {
    const query = scoped(supabase
      .from(DATASETS_TABLE)
      .select('*'));
    const { data, error } = await query
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      setLocalDatasets(data as DatasetRecord[]);
      return data as DatasetRecord[];
    }
  } catch (err) {
    console.warn('fetchDatasetsFromSupabase catch:', err);
  }
  return getLocalDatasets();
}

export async function saveDatasetToSupabase(dataset: DatasetRecord): Promise<DatasetRecord | null> {
  const now = new Date().toISOString();
  const pid = getServiceProjectId();
  const target: DatasetRecord = {
    ...dataset,
    id: dataset.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `ds_${Date.now()}`),
    created_at: dataset.created_at || now,
    updated_at: now,
    ...(pid ? { project_id: pid } : {})
  };

  // 1. Immediately cache locally
  const current = getLocalDatasets();
  const idx = current.findIndex((d) => d.id === target.id);
  if (idx >= 0) current[idx] = target;
  else current.unshift(target);
  setLocalDatasets(current);

  // 2. Try Supabase
  try {
    if (dataset.id) {
      let query = supabase
        .from(DATASETS_TABLE)
        .update({ ...target })
        .eq('id', target.id);
      if (pid) query = query.eq('project_id', pid);
      const { data, error } = await query
        .select('*')
        .single();
      if (!error && data) return data as DatasetRecord;
    } else {
      const { data, error } = await supabase
        .from(DATASETS_TABLE)
        .insert([{ ...target }])
        .select('*')
        .single();
      if (!error && data) return data as DatasetRecord;
    }
  } catch (err) {
    console.warn('saveDatasetToSupabase catch:', err);
  }

  return target;
}

export async function registerSurveyDataset(params: {
  name: string;
  subgrid?: string;
  equipment?: string;
  sourceFolder?: string;
  outputFolder?: string;
  fileCount?: number;
  sizeBytes?: number;
  datasetType?: 'RAW' | 'PROCESSED' | 'DELIVERABLE';
  pipelineStage?: 'STITCH' | 'BLUR' | 'ENHANCE' | 'MASK' | 'QAQC';
  storageProvider?: string;
  userLabel?: string;
  metadata?: Record<string, unknown>;
}): Promise<DatasetRecord | null> {
  const dataset: DatasetRecord = {
    dataset_type: params.datasetType || 'RAW',
    pipeline_stage: params.pipelineStage || 'STITCH',
    name: params.name.trim(),
    subgrid: (params.subgrid || '').toUpperCase().trim() || undefined,
    provider: params.equipment || 'MMS Vehicle Unit',
    source_folder: params.sourceFolder || '',
    output_folder: params.outputFolder || '',
    storage_provider: params.storageProvider || 'nas_local',
    file_count: params.fileCount || 0,
    size_bytes: params.sizeBytes || 0,
    status: 'REGISTERED',
    version: 1,
    parent_dataset_id: null,
    created_by: params.userLabel || 'System',
    metadata: {
      equipment: params.equipment,
      source: 'nas-intake',
      registeredAt: new Date().toISOString(),
      ...(params.metadata || {})
    }
  };
  return saveDatasetToSupabase(dataset);
}

export async function checkDatasetDuplicates(subgrid: string, folderPath?: string): Promise<DatasetRecord[]> {
  try {
    const sg = (subgrid || '').toUpperCase().trim();
    if (!sg && !folderPath) return [];

    let query = scoped(supabase.from(DATASETS_TABLE).select('*'));
    if (sg) {
      query = query.eq('subgrid', sg);
    }
    if (folderPath) {
      query = query.eq('source_folder', folderPath);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('checkDatasetDuplicates:', error.message);
      return [];
    }
    return (data || []) as DatasetRecord[];
  } catch (err) {
    console.warn('checkDatasetDuplicates catch:', err);
    return [];
  }
}

export async function deleteDatasetFromSupabase(id: string): Promise<boolean> {
  try {
    let query = supabase.from(DATASETS_TABLE).delete().eq('id', id);
    const pid = getServiceProjectId();
    if (pid) query = query.eq('project_id', pid);
    const { error } = await query;
    if (error) {
      console.warn('deleteDatasetFromSupabase:', error.message);
      return false;
    }
    const current = getLocalDatasets().filter((d) => d.id !== id);
    setLocalDatasets(current);
    return true;
  } catch (err) {
    console.warn('deleteDatasetFromSupabase catch:', err);
    return false;
  }
}
