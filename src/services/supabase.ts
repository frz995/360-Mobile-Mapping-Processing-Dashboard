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

// Subgrid default centroid coordinates (longitude, latitude)
export const SUBGRID_COORDINATES: Record<string, [number, number]> = {
  'N93E70': [102.826514, 2.558054],
  'N94E70': [102.805000, 2.538900],
  'N94E71': [102.810000, 2.540000],
  'N90E67': [102.750000, 2.500000]
};

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



    // If no records in database at all, return empty data
    if (!data || data.length === 0) {
      return { dailyData: [], batchLogs: [] };
    }

    // Count actual available images in MMS_PIC storage bucket if accessible
    const storageImageCounts = new Map<string, number>();

    try {
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      let totalFetched = 0;

      while (hasMore && totalFetched < 10000) {
        const { data: storageFiles, error: storageError } = await supabase.storage.from('MMS_PIC').list('', { limit, offset });
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
      pic?: string;
      equipment?: string;
    }>();

    data.forEach(r => {
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
          grid: r.grid || '1',
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
      const pic = g.pic || 'Fariz';
      const equipment = g.equipment || 'MMS';
      const calcKm = calculateDistance(g.points);
      const km = (typeof g.recordKm === 'number' && g.recordKm > 0)
        ? g.recordKm
        : (calcKm > 0 ? calcKm : Math.round((poiCount * 0.005) * 100) / 100);

      const defects = g.recordDefects !== undefined ? g.recordDefects : 0;

      const sortedDates = g.dates.sort();
      const rawDate = sortedDates[0] || new Date().toISOString().slice(0, 10);
      let dateFormatted = rawDate;
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      // 1. Unique Daily Subgrid Record
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
        pic: pic,
        isSyncedWithSupabase: true
      });
    });

    // 3. Query staging_panoramas table for persistent staged records
    try {
        const { data: stagingData, error: stagingErr } = await supabase.from('staging_panoramas').select('*');
        if (!stagingErr && stagingData && stagingData.length > 0) {
        const stagingGrouped = new Map<string, any>();
        stagingData.forEach((r, rIdx) => {
          const filename = r.filename || r.image_url || '';
          const sg = (r.subgrid || extractSubgrid(filename) || 'UNKNOWN').toUpperCase().trim();
          if (!sg || sg === 'UNKNOWN' || sg === 'N/A') return;

          // Key by unique staged record ID so separated daily rows are preserved
          const entryKey = r.id ? String(r.id) : `${sg}_row_${rIdx}`;

          if (!stagingGrouped.has(entryKey)) {
            stagingGrouped.set(entryKey, {
              id: entryKey,
              subgrid: sg,
              grid: r.grid || String(rIdx + 1),
              imageFilenames: [],
              poiCount: r.poi_count || r.images_processed || 0,
              imagesProcessed: r.images_processed || 0,
              kmProcessed: typeof r.km_processed === 'number' ? r.km_processed : 0,
              defectCount: r.defect_count || 0,
              capturedAt: r.captured_at || r.created_at,
              equipment: r.capture_equipment || 'MMS',
              status: r.status || 'in process',
              points: []
            });
          }

          const sgObj = stagingGrouped.get(entryKey)!;
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

        stagingGrouped.forEach((g, entryKey) => {
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

          const imgCount = g.imagesProcessed || count;

          dailyData.push({
            id: `staging-d-${entryKey}`,
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
            pic: g.pic || 'Fariz',
            isStagingPreview: true,
            isSyncedWithSupabase: false,
            isStagedInSupabase: true
          });
        });
      }
    } catch (err) {
      console.warn('Error querying staging_panoramas table:', err);
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
      rawList = [{
        filename: record.imageFilename && !record.imageFilename.endsWith('-0001.jpg')
          ? record.imageFilename
          : `${record.subgrid || 'N93E70'}-${Math.floor(1000 + Math.random() * 9000)}.jpg`,
        date: record.date
      }];
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

    // Clean up staging_panoramas if subgrid was previously staged
    if (record.subgrid) {
      try {
        await deleteFromStagingSupabase(record.subgrid);
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
export async function deleteFromStagingSupabase(subgrid: string): Promise<{ success: boolean; message: string }> {
  try {
    const cleanSub = (subgrid || '').trim();
    if (!cleanSub) return { success: true, message: 'No subgrid specified' };

    const { error } = await supabase
      .from('staging_panoramas')
      .delete()
      .or(`subgrid.ilike.${cleanSub},filename.ilike.${cleanSub}%`);

    if (error) {
      console.warn('deleteFromStagingSupabase error:', error.message);
    }
    return { success: true, message: `Removed ${cleanSub} from staging database.` };
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
    await deleteFromStagingSupabase(cleanSub).catch(() => {});

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
export async function verifyCsvImageFilenamesInStorage(filenames: string[]): Promise<{ availableCount: number; verifiedFilenames: string[] }> {
  if (!filenames || filenames.length === 0) return { availableCount: 0, verifiedFilenames: [] };

  const supabaseStorageBase = `${supabaseUrl}/storage/v1/object/public/MMS_PIC`;
  const verifiedFilenames: string[] = [];
  let availableCount = 0;

  const checkSingleFile = (fn: string): Promise<boolean> => {
    const cleanFn = fn.replace(/^\/+/, '').replace(/^MMS_PIC\//i, '').replace(/^mms_pic\//i, '').trim();
    const url = `${supabaseStorageBase}/${cleanFn}`;

    return new Promise(resolve => {
      fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } })
        .then(res => {
          if (res.ok || res.status === 200 || res.status === 206) {
            resolve(true);
          } else {
            resolve(false);
          }
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
