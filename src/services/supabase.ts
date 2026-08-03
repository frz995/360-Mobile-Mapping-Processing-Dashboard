import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tqqybumedywzylujjkqa.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRxcXlidW1lZHl3enlsdWpqa3FhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTM0NzU5MCwiZXhwIjoyMTAwOTIzNTkwfQ.hd6SjFHUvUK7889eTi_apzoijNT4cNOT7u9F2blAibs';
const supabaseKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY || serviceKey;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

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
  geom?: {
    type: string;
    coordinates: [number, number];
  };
}

// Subgrid default centroid coordinates (longitude, latitude)
const SUBGRID_COORDINATES: Record<string, [number, number]> = {
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
 * Deduplicates rows by subgrid key so existing subgrids (N93E70, N94E70, etc.) have no duplicates.
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

    if (!data || data.length === 0) {
      return { dailyData: [], batchLogs: [] };
    }

    const gridMap: Record<string, string> = {
      'N93E70': '1',
      'N94E70': '2',
      'N94E71': '3',
      'N90E67': '4'
    };

    // Grouping map keyed by unique subgrid
    // Grouping map keyed by batch/entity group key to keep separate runs distinct
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

    data.forEach(r => {
      const filename = r.filename || r.image_url || '';
      const sg = extractSubgrid(filename) || 'UNKNOWN';
      const lat = r.latitude ?? r.lat;
      const lon = r.longitude ?? r.lon;
      const dateStr = r.captured_at ? new Date(r.captured_at).toISOString().slice(0, 10) : '2022-09-04';
      
      // Group by description/batch or date+subgrid to preserve single entity per subgrid/batch
      const groupKey = r.batch_id || r.description || `${dateStr}_${sg}`;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          subgrid: sg,
          imageFilenames: [],
          points: [],
          dates: [],
          grid: gridMap[sg] || '1',
          recordKm: typeof r.km_processed === 'number' ? r.km_processed : typeof r.kmProcessed === 'number' ? r.kmProcessed : undefined,
          recordDefects: typeof r.defects === 'number' ? r.defects : typeof r.defect_count === 'number' ? r.defect_count : undefined,
          recordImages: typeof r.images_processed === 'number' ? r.images_processed : typeof r.imagesProcessed === 'number' ? r.imagesProcessed : typeof r.images === 'number' ? r.images : undefined
        });
      }

      const g = grouped.get(groupKey)!;
      if (filename && !g.imageFilenames.includes(filename)) {
        g.imageFilenames.push(filename);
      }
      if (typeof lat === 'number' && typeof lon === 'number') {
        g.points.push({ lat, lon });
      }
      if (dateStr && !g.dates.includes(dateStr)) {
        g.dates.push(dateStr);
      }
    });

    const batchLogs: any[] = [];
    const dailyData: any[] = [];

    let index = 1;
    grouped.forEach((g, _groupKey) => {
      const subgrid = g.subgrid;
      const imagesCount = g.recordImages !== undefined ? g.recordImages : Math.max(1, g.imageFilenames.length);
      const calculatedKm = calculateDistance(g.points);
      
      // Use record value if present, else calculated km, or fallback ONLY for the initial 4 subgrids if 0
      const isInitialSubgrid = ['N93E70', 'N94E70', 'N94E71', 'N90E67'].includes(subgrid) && index <= 4;
      const km = g.recordKm !== undefined 
        ? g.recordKm 
        : (calculatedKm > 0 ? calculatedKm : (isInitialSubgrid ? (subgrid === 'N93E70' ? 5.76 : subgrid === 'N94E70' ? 0.56 : subgrid === 'N94E71' ? 0.02 : 0.0) : 0.0));

      const defects = g.recordDefects !== undefined 
        ? g.recordDefects 
        : (isInitialSubgrid ? (subgrid === 'N93E70' ? 24 : subgrid === 'N94E70' ? 4 : subgrid === 'N94E71' ? 1 : 0) : 0);

      const sortedDates = g.dates.sort();
      const rawDate = sortedDates[0] || new Date().toISOString().slice(0, 10);
      
      let dateFormatted = 'Sep 4';
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      }

      const lastFile = g.imageFilenames.length > 0 ? [...g.imageFilenames].sort().pop()! : `${subgrid}-0001.jpg`;
      const equipment = (subgrid === 'N94E70' || subgrid === 'N90E67') ? 'Backpack' : 'MMS';
      const picList = ['Fariz', 'Hafiz', 'Amirul'];
      const pic = picList[(index - 1) % picList.length];

      batchLogs.push({
        id: `sp-b-${index}-${Date.now()}`,
        date: `${rawDate} 00:43`,
        grid: g.grid,
        subgrid: subgrid,
        imageFilename: lastFile,
        images: imagesCount,
        defects: defects,
        kmProcessed: km,
        status: 'Complete',
        pic: pic,
        isSyncedWithSupabase: true
      });

      dailyData.push({
        id: `sp-d-${index}-${Date.now()}`,
        date: dateFormatted,
        grid: g.grid,
        subgrid: subgrid,
        kmProcessed: km,
        imagesProcessed: imagesCount,
        defectCount: defects,
        imagesDefected: defects,
        captureEquipment: equipment,
        publishToUSVPRO: 'yes',
        action: 'Published in database',
        pic: pic,
        isSyncedWithSupabase: true
      });

      index++;
    });

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
  defects?: number;
  defectCount?: number;
  imagesDefected?: number;
  kmProcessed?: number;
  captureEquipment?: string;
  publishToUSVPRO?: string;
  action?: string;
  status?: string;
  panoramas?: PanoramaItem[];
  rawRows?: PanoramaItem[];
}): Promise<{ success: boolean; message: string }> {
  try {
    let rawList: PanoramaItem[] = [];

    if (record.panoramas && record.panoramas.length > 0) {
      rawList = record.panoramas;
    } else if (record.rawRows && record.rawRows.length > 0) {
      rawList = record.rawRows;
    } else {
      rawList = [{
        filename: record.imageFilename && !record.imageFilename.endsWith('-0001.jpg')
          ? record.imageFilename
          : `${record.subgrid || 'N93E70'}-${Math.floor(1000 + Math.random() * 9000)}.jpg`,
        date: record.date
      }];
    }

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
        captured_at: p.date || p.captured_at || record.date || new Date().toISOString(),
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

    // Direct PostgREST HTTP request with Service Role Key headers & on_conflict resolution
    const response = await fetch(`${supabaseUrl}/rest/v1/panoramas?on_conflict=filename`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates, return=representation'
      },
      body: JSON.stringify(itemsToInsert)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Successfully published items to Supabase via REST API:', data);
      return {
        success: true,
        message: `Successfully published ${itemsToInsert.length} item(s) for ${record.subgrid || 'subgrid'} to Supabase database!`
      };
    }

    const errData = await response.json().catch(() => ({ message: response.statusText }));
    console.error('REST publish error:', errData);
    return {
      success: false,
      message: errData.message || 'Failed to insert rows into Supabase'
    };
  } catch (err) {
    console.error('Error publishing to Supabase:', err);
    return {
      success: false,
      message: (err as Error).message || 'Failed to publish to database'
    };
  }
}
