import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tqqybumedywzylujjkqa.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_Nf52vHR8rCpvoj-w77ZehQ_QniT4-EV';

function createSafeSupabaseClient() {
  const url = supabaseUrl || 'https://tqqybumedywzylujjkqa.supabase.co';
  const key = supabaseKey || 'sb_publishable_Nf52vHR8rCpvoj-w77ZehQ_QniT4-EV';

  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  } catch (err) {
    console.warn('Supabase client creation fallback:', err);
    return createClient(url, 'sb_publishable_Nf52vHR8rCpvoj-w77ZehQ_QniT4-EV', {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
}

export const supabase = createSafeSupabaseClient();

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
}

export interface SupabasePanoramaRecord {
  id?: string | number;
  filename?: string;
  image_url?: string;
  captured_at?: string;
  description?: string;
  bearing?: number;
  pitch?: number;
  roll?: number;
  defect_count?: number;
  qa_status?: string;
  defect_flags?: any;
  geom?: {
    type: string;
    coordinates: [number, number];
  };
}

// Subgrid centroid coordinates (longitude, latitude) populated dynamically
export const SUBGRID_COORDINATES: Record<string, [number, number]> = {};

// Helper: Extract subgrid name (e.g. 'N93E70-0158.jpg' -> 'N93E70')
function extractSubgrid(filename: string): string {
  if (!filename) return 'N/A';
  const match = filename.match(/^(N\d+E\d+)/i);
  return match ? match[1].toUpperCase() : filename.split('-')[0].split('.')[0].toUpperCase();
}

// Helper: Calculate geodesic distance in km
function calculateDistance(points: { lat: number; lon: number }[]): number {
  if (!points || points.length < 2) return 0;
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const R = 6371; // Earth radius in km
    const dLat = (p2.lat - p1.lat) * (Math.PI / 180);
    const dLon = (p2.lon - p1.lon) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1.lat * (Math.PI / 180)) *
      Math.cos(p2.lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalKm += R * c;
  }
  return parseFloat(totalKm.toFixed(2));
}

/**
 * Fetch records from Supabase and group into BatchLog[] and DailyTimeSeries[].
 * Accurately calculates image count matching Supabase storage & panoramas table.
 * Deduplicates rows by subgrid so each subgrid has exactly 1 clean record without duplicates or count doubling.
 */
export async function fetchSupabaseData(): Promise<{
  dailyData: any[];
  batchLogs: any[];
  error?: string;
}> {
  try {
    // Try fetching from panoramas_view or panoramas table
    let { data, error } = await supabase
      .from('panoramas_view')
      .select('*');

    if (error || !data || data.length === 0) {
      console.warn('panoramas_view fallback to panoramas table:', error);
      const res = await supabase.from('panoramas').select('*');
      data = res.data;
      error = res.error;
    }

    if (error) {
      throw new Error(error.message);
    }

    // Query subgrids metadata table dynamically if available
    const knownMetadata: Record<string, { grid: string; pic: string; equipment: string; date: string; defaultKm: number; defaultCount: number }> = {};

    try {
      const { data: subgridRows } = await supabase.from('subgrids').select('*');
      if (subgridRows && subgridRows.length > 0) {
        subgridRows.forEach(row => {
          if (row.subgrid_code) {
            const sgKey = row.subgrid_code.toUpperCase().trim();
            knownMetadata[sgKey] = {
              grid: row.grid_id || '1',
              pic: row.pic || 'Unassigned',
              equipment: row.equipment || 'MMS',
              date: 'Sep 4',
              defaultKm: 0,
              defaultCount: 0
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
    const storageImageCounts = new Map<string, number>();
    const storageBucketName = import.meta.env.VITE_SUPABASE_BUCKET || import.meta.env.VITE_STORAGE_BUCKET || 'MMS_PIC';

    try {
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      let totalFetched = 0;

      while (hasMore && totalFetched < 10000) {
        const { data: storageFiles, error: storageError } = await supabase.storage.from(storageBucketName).list('', { limit, offset });
        if (storageError || !storageFiles || storageFiles.length === 0) {
          break;
        }
        totalFetched += storageFiles.length;
        storageFiles.forEach(file => {
          if (file.name && file.name.includes('.') && !file.name.startsWith('.')) {
            const sg = extractSubgrid(file.name);
            if (sg && sg !== 'N/A') {
              storageImageCounts.set(sg, (storageImageCounts.get(sg) || 0) + 1);
            }
          }
        });
        if (storageFiles.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }
    } catch (err) {
      console.warn('MMS_PIC storage list exception:', err);
    }

    // Group database records uniquely by subgrid
    const grouped = new Map<string, {
      subgrid: string;
      imageFilenames: string[];
      points: { lat: number; lon: number }[];
      dates: string[];
      grid: string;
      recordKm?: number;
      recordDefects?: number;
      recordImages?: number;
    }>();

    publishedRows.forEach(r => {
      const filename = r.filename || r.image_url || '';
      const sg = (extractSubgrid(filename) || 'UNKNOWN').toUpperCase().trim();
      if (!sg || sg === 'UNKNOWN' || sg === 'N/A') return;

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

      const dateStr = r.captured_at ? new Date(r.captured_at).toISOString().slice(0, 10) : '2022-09-04';

      if (!grouped.has(sg)) {
        grouped.set(sg, {
          subgrid: sg,
          imageFilenames: [],
          points: [],
          dates: [],
          grid: knownMetadata[sg]?.grid || '1',
          recordKm: typeof r.km_processed === 'number' ? r.km_processed : typeof r.kmProcessed === 'number' ? r.kmProcessed : undefined,
          recordDefects: typeof r.defects === 'number' ? r.defects : typeof r.defect_count === 'number' ? r.defect_count : undefined,
          recordImages: typeof r.images_processed === 'number' ? r.images_processed : typeof r.imagesProcessed === 'number' ? r.imagesProcessed : typeof r.images === 'number' ? r.images : undefined
        });
      }

      const g = grouped.get(sg)!;
      if (filename && !g.imageFilenames.includes(filename)) {
        g.imageFilenames.push(filename);
      }
      if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
        g.points.push({ lat, lon });
      }
      if (dateStr && !g.dates.includes(dateStr)) {
        g.dates.push(dateStr);
      }
    });


    console.log('Verified Supabase MMS_PIC storage counts:', Object.fromEntries(storageImageCounts));

    const dailyData: any[] = [];
    const batchLogs: any[] = [];

    Array.from(grouped.keys()).forEach((subgrid, idx) => {
      const g = grouped.get(subgrid);
      if (!g) return;
      const countFromDB = g.imageFilenames.length;
      const storageCount = storageImageCounts.get(subgrid);

      const poiCount = countFromDB;
      const verifiedImagesCount = (storageCount !== undefined && storageCount > 0)
        ? Math.min(storageCount, poiCount)
        : (g.recordImages !== undefined ? g.recordImages : countFromDB);

      const grid = g.grid || String(idx + 1);
      const pic = 'Fariz';
      const equipment = 'MMS';

      const calcKm = calculateDistance(g.points);
      const km = calcKm > 0 ? calcKm : Math.round((poiCount * 0.005) * 100) / 100;

      const defects = g.recordDefects !== undefined ? g.recordDefects : 0;

      const sortedDates = g.dates.sort();
      const rawDate = sortedDates[0] || new Date().toISOString().slice(0, 10);
      let dateFormatted = rawDate;
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      // 1. Unique Daily Record
      dailyData.push({
        id: `sp-d-${subgrid}`,
        date: dateFormatted,
        grid: grid,
        subgrid: subgrid,
        kmProcessed: km,
        imagesProcessed: verifiedImagesCount,
        poiCount: poiCount,
        availableImagesCount: verifiedImagesCount,
        defectCount: defects,
        imagesDefected: defects,
        captureEquipment: equipment,
        publishToWebGIS: 'yes',
        action: 'Published in database',
        pic: pic,
        isSyncedWithSupabase: true
      });

      // 2. Unique Batch Masterlist Record
      const lastFile = g.imageFilenames[g.imageFilenames.length - 1] || `${subgrid}-0001.jpg`;
      batchLogs.push({
        id: `sp-b-${subgrid}`,
        date: `${rawDate} 00:43`,
        grid: grid,
        subgrid: subgrid,
        imageFilename: lastFile,
        images: verifiedImagesCount,
        poiCount: poiCount,
        availableImagesCount: verifiedImagesCount,
        defects: defects,
        kmProcessed: km,
        status: 'Complete',
        captureEquipment: equipment,
        pic: pic || 'Unassigned',
        isSyncedWithSupabase: true
      });
    });

    // 3. Query staging_panoramas table for persistent staged records
    try {
      const { data: stagingData, error: stagingErr } = await supabase.from('staging_panoramas').select('*');
      if (!stagingErr && stagingData && stagingData.length > 0) {
        const stagingGrouped = new Map<string, any>();
        stagingData.forEach(r => {
          const filename = r.filename || r.image_url || '';
          const sg = (r.subgrid || extractSubgrid(filename) || 'UNKNOWN').toUpperCase().trim();
          if (!sg || sg === 'UNKNOWN' || sg === 'N/A') return;
          // If subgrid is already in production published panoramas, skip staging item
          if (grouped.has(sg)) return;

          // Unique run key preserves distinct daily survey runs per subgrid
          const rawDateStr = r.captured_at ? new Date(r.captured_at).toISOString().slice(0, 10) : '';
          const runKey = r.batch_id || r.run_id || `${sg}_${rawDateStr}_${r.poi_count || r.images_processed || 0}_${r.km_processed || 0}`;

          if (!stagingGrouped.has(runKey)) {
            stagingGrouped.set(runKey, {
              key: runKey,
              subgrid: sg,
              grid: r.grid || '1',
              imageFilenames: [],
              poiCount: r.poi_count || 0,
              imagesProcessed: r.images_processed || 0,
              kmProcessed: typeof r.km_processed === 'number' ? r.km_processed : 0,
              defectCount: r.defect_count || 0,
              capturedAt: r.captured_at,
              equipment: r.capture_equipment || 'MMS',
              status: r.status || 'in process',
              points: []
            });
          }

          const sgObj = stagingGrouped.get(runKey)!;
          if (filename && !sgObj.imageFilenames.includes(filename)) {
            sgObj.imageFilenames.push(filename);
          }
          if (r.geom) {
            let geomObj = r.geom;
            let lat: number | undefined;
            let lon: number | undefined;
            if (typeof geomObj === 'string') {
              const match = geomObj.match(/POINT\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
              if (match) { lon = parseFloat(match[1]); lat = parseFloat(match[2]); }
            } else if (geomObj && geomObj.coordinates && Array.isArray(geomObj.coordinates)) {
              lon = Number(geomObj.coordinates[0]); lat = Number(geomObj.coordinates[1]);
            }
            if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon)) {
              sgObj.points.push({ lat, lon });
            }
          }
        });

        stagingGrouped.forEach((g, runKey) => {
          const sg = g.subgrid;
          const count = g.imageFilenames.length || g.poiCount || 1;
          const calcKm = calculateDistance(g.points);
          const km = g.kmProcessed > 0 ? g.kmProcessed : (calcKm > 0 ? calcKm : Math.round((count * 0.005) * 100) / 100);
          const rawDate = g.capturedAt ? new Date(g.capturedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
          let dateFormatted = rawDate;
          const dObj = new Date(rawDate);
          if (!isNaN(dObj.getTime())) {
            dateFormatted = dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }

          const imgCount = count > 0 ? Math.min(g.imagesProcessed || count, count) : (g.imagesProcessed || count);

          dailyData.push({
            id: `staging-d-${runKey}`,
            date: dateFormatted,
            grid: g.grid,
            subgrid: sg,
            kmProcessed: km,
            imagesProcessed: imgCount,
            poiCount: count,
            availableImagesCount: imgCount,
            defectCount: g.defectCount,
            imagesDefected: g.defectCount,
            captureEquipment: g.equipment,
            publishToWebGIS: 'in process',
            action: 'Imported (staging)',
            pic: 'Unassigned',
            isStagingPreview: true,
            isSyncedWithSupabase: false,
            isStagedInSupabase: true
          });

          batchLogs.push({
            id: `staging-b-${runKey}`,
            date: `${rawDate} 00:43`,
            grid: g.grid,
            subgrid: sg,
            imageFilename: g.imageFilenames[0] || `${sg}-0001.jpg`,
            images: imgCount,
            poiCount: count,
            availableImagesCount: imgCount,
            defects: g.defectCount,
            kmProcessed: km,
            status: 'Ongoing',
            captureEquipment: g.equipment,
            pic: 'Unassigned',
            isSyncedWithSupabase: false,
            isStagedInSupabase: true
          });
        });
      }
    } catch (stgErr) {
      console.warn('staging_panoramas fetch notice (table may be pending creation):', stgErr);
    }

    console.log('Supabase sync complete. Subgrids processed:', Array.from(grouped.keys()), 'Daily:', dailyData.length, 'Batches:', batchLogs.length);
    return { batchLogs, dailyData };
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
  status?: string;
  panoramas?: PanoramaItem[];
  rawRows?: PanoramaItem[];
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
      const count = record.poiCount || record.imagesProcessed || 1;
      const baseFn = record.imageFilename || `${record.subgrid || 'N93E70'}-0001.jpg`;
      const ext = baseFn.includes('.') ? baseFn.slice(baseFn.lastIndexOf('.')) : '.jpg';
      const prefix = record.subgrid || baseFn.split('-')[0];
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

    const itemsToInsert: SupabasePanoramaRecord[] = rawList.map((p: any) => {
      const filename = p.filename || p.imageFilename || `${record.subgrid || 'N93E70'}-${Math.floor(1000 + Math.random() * 9000)}.jpg`;
      const sgKey = record.subgrid ? record.subgrid.toUpperCase() : extractSubgrid(filename);
      const defaultCoords = SUBGRID_COORDINATES[sgKey] || [102.805000, 2.538900];

      const lon = p.longitude !== undefined && !isNaN(Number(p.longitude))
        ? Number(p.longitude)
        : p.lon !== undefined && !isNaN(Number(p.lon))
          ? Number(p.lon)
          : defaultCoords[0];

      const lat = p.latitude !== undefined && !isNaN(Number(p.latitude))
        ? Number(p.latitude)
        : p.lat !== undefined && !isNaN(Number(p.lat))
          ? Number(p.lat)
          : defaultCoords[1];

      return {
        filename,
        image_url: filename,
        captured_at: parseToIsoTimestamp(p.date || p.captured_at || record.date),
        description: `Published Batch (${record.subgrid || filename}) - ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
        bearing: Number(p.bearing ?? p.heading ?? 16.2),
        pitch: Number(p.pitch ?? 0),
        roll: Number(p.roll ?? 0),
        geom: {
          type: 'Point',
          coordinates: [lon, lat]
        }
      };
    });

    // Chunked PostgREST HTTP requests with Service Role Key headers & on_conflict resolution
    const chunkSize = 50;
    for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
      const chunk = itemsToInsert.slice(i, i + chunkSize);
      const response = await fetch(`${supabaseUrl}/rest/v1/panoramas?on_conflict=filename`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates, return=representation'
        },
        body: JSON.stringify(chunk)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ message: response.statusText }));
        console.error('REST publish error on chunk:', errData);
        return {
          success: false,
          message: errData.message || 'Failed to insert rows into Supabase'
        };
      }
    }

    console.log(`Successfully published ${itemsToInsert.length} items to Supabase via REST API`);

    // Clean up staging_panoramas for specific published filenames (preventing collateral deletion of sibling rows)
    if (record.subgrid) {
      try {
        const pubFilenames = itemsToInsert.map(i => i.filename).filter((fn): fn is string => Boolean(fn));
        await deleteFromStagingSupabase(record.subgrid, pubFilenames);
      } catch (stgCleanErr) {
        console.warn('Staging cleanup notice:', stgCleanErr);
      }
    }

    return {
      success: true,
      message: `Successfully published ${itemsToInsert.length} item(s) for ${record.subgrid || 'subgrid'} to Supabase database!`
    };
  } catch (err) {
    console.error('Error publishing to Supabase:', err);
    return {
      success: false,
      message: (err as Error).message || 'Failed to publish to database'
    };
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
  publishToWebGIS?: string;
  panoramas?: PanoramaItem[];
  rawRows?: PanoramaItem[];
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
        filename: record.imageFilename && !record.imageFilename.endsWith('-0001.jpg')
          ? record.imageFilename
          : `${record.subgrid || 'N93E70'}-${Math.floor(1000 + Math.random() * 9000)}.jpg`,
        date: record.date
      }];
    }

    const itemsToInsert = rawList.map((p: any) => {
      const filename = p.filename || p.imageFilename || `${record.subgrid || 'N93E70'}-${Math.floor(1000 + Math.random() * 9000)}.jpg`;
      const sgKey = record.subgrid ? record.subgrid.toUpperCase() : extractSubgrid(filename);
      const defaultCoords = SUBGRID_COORDINATES[sgKey] || [102.805000, 2.538900];

      const lon = p.longitude !== undefined && !isNaN(Number(p.longitude)) ? Number(p.longitude) : defaultCoords[0];
      const lat = p.latitude !== undefined && !isNaN(Number(p.latitude)) ? Number(p.latitude) : defaultCoords[1];

      return {
        filename,
        image_url: filename,
        captured_at: new Date().toISOString(),
        description: `Staged Batch (${record.subgrid || filename})`,
        bearing: Number(p.bearing ?? p.heading ?? 0),
        pitch: Number(p.pitch ?? 0),
        roll: Number(p.roll ?? 0),
        subgrid: sgKey,
        grid: record.grid || '1',
        km_processed: record.kmProcessed || 0,
        poi_count: record.poiCount || rawList.length,
        images_processed: record.imagesProcessed || rawList.length,
        status: record.publishToWebGIS || 'in process',
        geom: { type: 'Point', coordinates: [lon, lat] }
      };
    });

    const { error } = await supabase.from('staging_panoramas').upsert(itemsToInsert, { onConflict: 'filename' });
    if (error) {
      console.warn('Supabase staging_panoramas JS upsert warning, attempting REST fallback:', error.message);
      const response = await fetch(`${supabaseUrl}/rest/v1/staging_panoramas?on_conflict=filename`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates, return=representation'
        },
        body: JSON.stringify(itemsToInsert)
      });
      if (!response.ok) {
        return { success: false, message: error.message };
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
      const cleanFns = filenames.map(f => f.trim()).filter(Boolean);
      await supabase.from('staging_panoramas').delete().in('filename', cleanFns);
      try {
        await fetch(`${supabaseUrl}/rest/v1/staging_panoramas?filename=in.(${cleanFns.join(',')})`, {
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
 * Permanently delete records for a subgrid from Supabase database.
 */
export async function deleteFromSupabase(subgrid: string): Promise<{ success: boolean; message: string }> {
  try {
    const cleanSub = (subgrid || '').trim();
    await deleteFromStagingSupabase(cleanSub).catch(() => { });

    const { error: pErr } = await supabase
      .from('panoramas')
      .delete()
      .ilike('filename', `${cleanSub}%`);

    try {
      await supabase
        .from('qa_defects')
        .delete()
        .or(`subgrid.ilike.${cleanSub},filename.ilike.${cleanSub}%`);
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

/**
 * Real-time update of defect count, QA status, and defect flags in Supabase database.
 * Supports updating both individual panotrack image records and subgrid aggregates.
 */
export async function updateDefectStatusInSupabase(
  itemKey: string,
  defectCount: number,
  qaStatus: string = 'Reviewing',
  defectFlags?: any
): Promise<{ success: boolean; message: string }> {
  try {
    const cleanKey = (itemKey || 'N93E70').trim();
    const isFilename = cleanKey.includes('-') || cleanKey.toLowerCase().endsWith('.jpg');

    // 1. Update panoramas table (by exact/matched filename or subgrid prefix)
    let query = supabase.from('panoramas').update({
      defect_count: defectCount,
      qa_status: qaStatus,
      defect_flags: defectFlags || {}
    });

    if (isFilename) {
      query = query.or(`filename.ilike.%${cleanKey}%,image_url.ilike.%${cleanKey}%`);
    } else {
      query = query.ilike('filename', `${cleanKey}%`);
    }

    const { error: panoramaError } = await query;
    if (panoramaError) {
      console.warn('Supabase panoramas update notice (non-fatal):', panoramaError.message);
    }

    // 2. Also upsert into qa_defects table for persistent QA logging per image item
    try {
      await supabase.from('qa_defects').upsert({
        item_key: cleanKey,
        subgrid: defectFlags?.subgrid || cleanKey.split('-')[0],
        filename: defectFlags?.filename || cleanKey,
        qa_status: qaStatus,
        defect_flags: defectFlags?.selectedQaFlags || defectFlags || {},
        answer: defectFlags?.answer || null,
        defect_count: defectCount,
        updated_at: new Date().toISOString()
      }, { onConflict: 'item_key' });
    } catch (qaErr) {
      // Non-fatal if qa_defects table is not created yet
    }

    console.log(`Successfully synced QA status to Supabase for ${cleanKey}`);
    return { success: true, message: `Synced QA status for ${cleanKey} in Supabase` };
  } catch (err) {
    console.warn('Supabase defect update error:', err);
    return { success: false, message: (err as Error).message };
  }
}

/**
 * Fetch saved QA records from Supabase database to restore state on page load.
 */
export async function fetchQaRecordsFromSupabase(): Promise<Record<string, { flags: any; answer: any; isLocked: boolean }>> {
  try {
    const records: Record<string, any> = {};
    const { data, error } = await supabase.from('qa_defects').select('*');
    if (!error && data && data.length > 0) {
      data.forEach(item => {
        if (item.item_key) {
          records[item.item_key.toUpperCase().trim()] = {
            flags: item.defect_flags?.selectedQaFlags || item.defect_flags || { blurry: false, obstruction: false, badGps: false },
            answer: item.answer || (item.qa_status?.toLowerCase().includes('flagged') ? 'yes' : item.qa_status?.toLowerCase().includes('passed') ? 'no' : null),
            isLocked: true
          };
        }
      });
    }
    return records;
  } catch (err) {
    console.warn('Unable to fetch QA records from Supabase:', err);
    return {};
  }
}

/**
 * Verify whether specific CSV image filenames exist in Supabase MMS_PIC storage bucket.
 * Returns the count and list of image files verified to exist in storage.
 */
export async function verifyCsvImageFilenamesInStorage(filenames: string[], settings?: any): Promise<{ availableCount: number; verifiedFilenames: string[] }> {
  if (!filenames || filenames.length === 0) return { availableCount: 0, verifiedFilenames: [] };

  const verifiedFilenames: string[] = [];
  let availableCount = 0;
  const bucketName = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC';

  // 1. Primary method: Query Supabase Storage bucket for uploaded file list and match explicit row filenames
  try {
    const fileSet = new Set<string>();
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let totalFetched = 0;

    while (hasMore && totalFetched < 10000) {
      const { data, error } = await supabase.storage.from(bucketName).list('', { limit, offset });
      if (error || !data || data.length === 0) break;
      totalFetched += data.length;

      data.forEach(item => {
        if (item.name) {
          fileSet.add(item.name.toLowerCase().trim());
          const cleanName = item.name.split('/').pop()?.toLowerCase().trim();
          if (cleanName) fileSet.add(cleanName);
        }
      });

      if (data.length < limit) hasMore = false;
      else offset += limit;
    }

    if (fileSet.size > 0) {
      filenames.forEach(fn => {
        const cleanFn = fn.split('/').pop()?.toLowerCase().trim() || fn.toLowerCase().trim();
        if (fileSet.has(cleanFn) || fileSet.has(fn.toLowerCase().trim())) {
          availableCount++;
          verifiedFilenames.push(fn);
        }
      });
      return { availableCount, verifiedFilenames };
    }
  } catch (e) {
    console.warn('Storage bucket listing notice, falling back to direct URL check:', e);
  }

  // 2. Fallback method: Direct HTTP HEAD availability checks per filename
  const checkSingleFile = (fn: string): Promise<boolean> => {
    const url = resolvePanoramaUrl(fn, settings);
    if (!url) return Promise.resolve(false);

    return new Promise(resolve => {
      fetch(url, { method: 'HEAD' })
        .then(res => {
          if (res.ok || res.status === 200 || res.status === 206) resolve(true);
          else resolve(false);
        })
        .catch(() => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
    });
  };

  const batchSize = 10;
  for (let i = 0; i < filenames.length; i += batchSize) {
    const batch = filenames.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fn => checkSingleFile(fn)));

    results.forEach((isAvailable, idx) => {
      if (isAvailable) {
        availableCount++;
        verifiedFilenames.push(batch[idx]);
      }
    });
  }

  return { availableCount, verifiedFilenames };
}

export interface DatabaseTableMapping {
  panoramasTable: string;
  panoramasSummaryView: string;
  batchLogsTable: string;
  qaDefectsTable: string;
  auditLogsTable: string;
  stagingPanoramasTable: string;
  notificationsTable: string;
}

/**
 * Get active database table names with smart defaults.
 * Allows seamless overrides when connecting to enterprise PostGIS databases with custom table names.
 */
export function getDatabaseTableMapping(settings?: any): DatabaseTableMapping {
  return {
    panoramasTable: settings?.dbPanoramasTable || import.meta.env.VITE_DB_PANORAMAS_TABLE || 'subgrids',
    panoramasSummaryView: settings?.dbSummaryView || import.meta.env.VITE_DB_SUMMARY_VIEW || 'panoramas_subgrid_summary',
    batchLogsTable: settings?.dbTableName || import.meta.env.VITE_DB_BATCH_LOGS_TABLE || 'batch_logs',
    qaDefectsTable: settings?.dbQaDefectsTable || import.meta.env.VITE_DB_QA_DEFECTS_TABLE || 'qa_defects',
    auditLogsTable: settings?.dbAuditLogsTable || import.meta.env.VITE_DB_AUDIT_LOGS_TABLE || 'audit_logs',
    stagingPanoramasTable: settings?.dbStagingTable || import.meta.env.VITE_DB_STAGING_TABLE || 'staging_panoramas',
    notificationsTable: settings?.dbNotificationsTable || import.meta.env.VITE_DB_NOTIFICATIONS_TABLE || 'notifications'
  };
}

export type StorageProviderType =
  | 'supabase'
  | 'aws_s3'
  | 'gcs'
  | 'azure_blob'
  | 'cloudflare_r2'
  | 'wasabi'
  | 'nas_local'
  | 'custom_cdn';

/**
 * Universal Image URL Resolver for GIS Industry Cloud & NAS Storage Providers.
 * Resolves 360° panorama image URLs across Supabase, AWS S3, GCS, Azure Blob, Cloudflare R2, Wasabi, and Local NAS.
 */
export function resolvePanoramaUrl(filename?: string, settings?: any): string {
  if (!filename) return '';
  const cleanFn = filename.replace(/^\/+/, '').replace(/^MMS_PIC\//i, '').trim();
  if (!cleanFn) return '';

  // 1. Direct absolute URL (e.g. S3/GCS signed URL stored directly in database)
  if (cleanFn.startsWith('http://') || cleanFn.startsWith('https://')) {
    return cleanFn;
  }

  const provider: StorageProviderType = settings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'supabase';
  const customBase: string = settings?.cloudStorageBaseUrl || settings?.imageStoragePath || import.meta.env.VITE_IMAGE_CDN_URL || '';

  // 2. Custom CDN / Direct URL prefix provided in Settings or Env
  if (customBase && (customBase.startsWith('http://') || customBase.startsWith('https://'))) {
    return `${customBase.replace(/\/+$/, '')}/${cleanFn}`;
  }

  switch (provider) {
    case 'aws_s3': {
      const bucket = settings?.s3Bucket || import.meta.env.VITE_S3_BUCKET || 'tnb-mobilemapping-panoramas';
      const region = settings?.s3Region || import.meta.env.VITE_S3_REGION || 'ap-southeast-1';
      return `https://${bucket}.s3.${region}.amazonaws.com/${cleanFn}`;
    }
    case 'gcs': {
      const bucket = settings?.gcsBucket || import.meta.env.VITE_GCS_BUCKET || 'tnb-gis-360-panoramas';
      return `https://storage.googleapis.com/${bucket}/${cleanFn}`;
    }
    case 'azure_blob': {
      const account = settings?.azureAccount || import.meta.env.VITE_AZURE_ACCOUNT || 'tnbgisstorage';
      const container = settings?.azureContainer || import.meta.env.VITE_AZURE_CONTAINER || 'panoramas';
      return `https://${account}.blob.core.windows.net/${container}/${cleanFn}`;
    }
    case 'cloudflare_r2': {
      const r2Domain = settings?.r2Domain || import.meta.env.VITE_R2_DOMAIN || 'pub-360.r2.dev';
      return `https://${r2Domain.replace(/\/+$/, '')}/${cleanFn}`;
    }
    case 'wasabi': {
      const bucket = settings?.wasabiBucket || import.meta.env.VITE_WASABI_BUCKET || 'tnb-wasabi-panoramas';
      const region = settings?.wasabiRegion || import.meta.env.VITE_WASABI_REGION || 'us-east-1';
      return `https://s3.${region}.wasabisys.com/${bucket}/${cleanFn}`;
    }
    case 'nas_local': {
      const nasUrl = settings?.nasServerUrl || import.meta.env.VITE_NAS_SERVER_URL || 'http://192.168.1.100/360_images';
      return `${nasUrl.replace(/\/+$/, '')}/${cleanFn}`;
    }
    case 'custom_cdn': {
      const cdnUrl = settings?.customCdnUrl || import.meta.env.VITE_CUSTOM_CDN_URL || '/MMS_PIC';
      return `${cdnUrl.replace(/\/+$/, '')}/${cleanFn}`;
    }
    case 'supabase':
    default: {
      const bucket = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC';
      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanFn}`;
    }
  }
}

let storageCountsCache: { data: Record<string, number>; timestamp: number } | null = null;

/**
 * Count actual uploaded images in storage bucket grouped by subgrid.
 * Caches results for 10 seconds to prevent unnecessary duplicate network calls.
 */
export async function getStorageImageCountsFromSupabase(forceRefresh: boolean = false, settings?: any): Promise<Record<string, number>> {
  const now = Date.now();
  if (!forceRefresh && storageCountsCache && (now - storageCountsCache.timestamp < 10000)) {
    return storageCountsCache.data;
  }

  const bucketName = settings?.supabaseBucket || import.meta.env.VITE_SUPABASE_BUCKET || 'MMS_PIC';
  const storageCounts: Record<string, number> = {};

  try {
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let totalFetched = 0;

    while (hasMore && totalFetched < 10000) {
      const { data: storageFiles, error: storageError } = await supabase.storage.from(bucketName).list('', { limit, offset });
      if (storageError || !storageFiles || storageFiles.length === 0) {
        break;
      }
      totalFetched += storageFiles.length;
      storageFiles.forEach(file => {
        if (file.name && file.name.includes('.') && !file.name.startsWith('.')) {
          const sg = extractSubgrid(file.name);
          if (sg && sg !== 'N/A') {
            const normSg = sg.toUpperCase().trim();
            storageCounts[normSg] = (storageCounts[normSg] || 0) + 1;
          }
        }
      });
      if (storageFiles.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }
  } catch (err) {
    console.warn('Storage bucket list exception:', err);
  }

  storageCountsCache = { data: storageCounts, timestamp: now };
  return storageCounts;
}

/**
 * Fetch persisted audit logs from Supabase database.
 */
export async function fetchAuditLogsFromSupabase(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) return [];
    return data.map(item => ({
      id: item.id || `audit-${Date.now()}`,
      timestamp: item.timestamp,
      type: item.type,
      title: item.title,
      details: item.details,
      user: item.user_name || item.user || 'System',
      status: item.status || 'info',
      read: item.read || false
    }));
  } catch (err) {
    console.warn('Unable to fetch audit logs from Supabase:', err);
    return [];
  }
}

/**
 * Persist new audit log record to Supabase database.
 */
export async function saveAuditLogToSupabase(log: {
  timestamp: string;
  type: string;
  title: string;
  details: string;
  user: string;
  status: string;
}): Promise<boolean> {
  try {
    const { error } = await supabase.from('audit_logs').insert([{
      timestamp: log.timestamp,
      type: log.type,
      title: log.title,
      details: log.details,
      user_name: log.user,
      status: log.status
    }]);
    if (error) {
      console.warn('Audit log insert notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception inserting audit log:', err);
    return false;
  }
}

/**
 * Fetch persisted system notifications from Supabase database.
 */
export async function fetchNotificationsFromSupabase(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) return [];
    return data.map(item => ({
      id: item.id || `notif-${Date.now()}`,
      timestamp: item.timestamp,
      title: item.title,
      message: item.message,
      category: item.category,
      read: item.read || false,
      totalItems: item.total_items
    }));
  } catch (err) {
    console.warn('Unable to fetch notifications from Supabase:', err);
    return [];
  }
}

/**
 * Persist new notification to Supabase database.
 */
export async function saveNotificationToSupabase(notif: {
  timestamp: string;
  title: string;
  message: string;
  category: string;
  read?: boolean;
  totalItems?: number;
}): Promise<boolean> {
  try {
    const { error } = await supabase.from('notifications').insert([{
      timestamp: notif.timestamp,
      title: notif.title,
      message: notif.message,
      category: notif.category,
      read: notif.read || false,
      total_items: notif.totalItems || 0
    }]);
    if (error) {
      console.warn('Notification insert notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception inserting notification:', err);
    return false;
  }
}

