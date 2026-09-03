import { SUBGRID_COORDINATES } from '../services/supabase';
import { pointInDistricts, type MalaysiaDistrict } from '../components/boundary/malaysiaDistricts';

export interface PanotrackPoint {
  id: string;
  subgrid: string;
  lng: number;
  lat: number;
  filename?: string;
  status?: string;
  qa_status?: string;
  isPublished?: boolean;
  color?: string;
}

export interface ExtractedPanotrackResult {
  points: PanotrackPoint[];
  tracks: Array<Array<[number, number]>>;
}

/**
 * Derives standardized status color for panotrack frames matching the GeoSphere 360 palette:
 * - Published: #10b981 (Emerald Green)
 * - Staging / In Process: #f59e0b (Amber)
 * - Defect / Flagged / Recheck: #ef4444 (Red)
 */
export function getPanotrackStatusColor(item?: {
  status?: string;
  qa_status?: string;
  isPublished?: boolean;
  color?: string;
  defectCount?: number;
  isDefect?: boolean;
}): string {
  if (!item) return '#10b981';

  const st = (item.status || '').toLowerCase().trim();
  const qa = (item.qa_status || '').toLowerCase().trim();

  // 1. Defect / Flagged / Recheck / No takes ABSOLUTE HIGHEST PRIORITY
  if (
    item.isDefect ||
    item.color === '#ef4444' ||
    st === 'defect' ||
    st === 'no' ||
    st === 'need to recheck' ||
    qa === 'defect' ||
    qa === 'flagged' ||
    qa.includes('defect') ||
    (typeof item.defectCount === 'number' && item.defectCount > 0)
  ) {
    return '#ef4444'; // Red
  }

  // 2. Published
  if (
    (item.isPublished && !item.isDefect) ||
    st === 'yes' ||
    st === 'published' ||
    qa === 'published' ||
    qa.includes('published')
  ) {
    return '#10b981'; // Emerald Green
  }

  // 3. Staging / In Process / Default
  return '#f59e0b'; // Amber
}

/**
 * Extracts and deduplicates panotrack survey points and sequential trajectory runs
 * from dailyData, batchLogs, and fallback subgrid coordinates.
 */
export function extractPanotrackPoints(
  dailyData?: any[],
  batchLogs?: any[],
  defectsList?: any[]
): ExtractedPanotrackResult {
  const points: PanotrackPoint[] = [];
  const tracks: Array<Array<[number, number]>> = [];
  const seenPointKeys = new Set<string>();

  // Build comprehensive known defect identifiers set
  const defectKeySet = new Set<string>();
  if (Array.isArray(defectsList)) {
    defectsList.forEach((d: any) => {
      const fn = (d.point_id || d.filename || d.pointId || d.image_url || d.item_key || '').split('/').pop()?.toUpperCase().trim();
      const ptId = (d.point_id || d.pointId || '').toUpperCase().trim();
      if (fn) defectKeySet.add(fn);
      if (ptId) defectKeySet.add(ptId);
    });
  }

  const parseNum = (val: any): number | null => {
    if (val === null || val === undefined || val === '') return null;
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
  };

  // 1. Process dailyData (primary operational source from main dashboard)
  if (Array.isArray(dailyData) && dailyData.length > 0) {
    dailyData.forEach((d, dIdx) => {
      const sg = (d.subgrid || '').toUpperCase().trim();
      const runId = d.id || d.runId || `run-${dIdx}`;
      const runPoints: Array<[number, number]> = [];
      const dPub = (d.publishToWebGIS || (d as any).publishToUSVPRO || '').toLowerCase().trim();

      if (Array.isArray(d.defectsList)) {
        d.defectsList.forEach((def: any) => {
          const fn = (def.point_id || def.filename || def.pointId || def.image_url || '').split('/').pop()?.toUpperCase().trim();
          const ptId = (def.point_id || def.pointId || '').toUpperCase().trim();
          if (fn) defectKeySet.add(fn);
          if (ptId) defectKeySet.add(ptId);
        });
      }

      if (Array.isArray(d.panoramas) && d.panoramas.length > 0) {
        d.panoramas.forEach((p: any, pIdx: number) => {
          const lng = parseNum(p.longitude ?? p.lon ?? p.lng);
          const lat = parseNum(p.latitude ?? p.lat);
          if (lat === null || lng === null || (lat === 0 && lng === 0)) return;

          const key = p.filename || p.id || `${sg}_${lat.toFixed(5)}_${lng.toFixed(5)}`;
          if (!seenPointKeys.has(key)) {
            seenPointKeys.add(key);

            const fnClean = (p.filename || p.image_url || p.point_id || p.pointId || '').split('/').pop()?.toUpperCase().trim();
            const ptClean = (p.point_id || p.pointId || '').toUpperCase().trim();
            const pStatus = (p.status || '').toLowerCase().trim();
            const pQa = (p.qa_status || '').toLowerCase().trim();

            const isPointDefect = Boolean(
              (fnClean && defectKeySet.has(fnClean)) ||
              (ptClean && defectKeySet.has(ptClean)) ||
              p.isDefect ||
              p.is_defect ||
              p.defectType ||
              pStatus === 'defect' ||
              pStatus === 'need to recheck' ||
              pStatus === 'no' ||
              pQa === 'defect' ||
              pQa === 'flagged' ||
              pQa.includes('defect') ||
              dPub === 'need to recheck' ||
              dPub === 'no' ||
              p.color === '#ef4444' ||
              p.statusColor === '#ef4444' ||
              (p.defect_flags && typeof p.defect_flags === 'object' && Object.values(p.defect_flags).some(Boolean))
            );

            const isPub = p.isPublished !== undefined
              ? Boolean(p.isPublished)
              : (d.publishToWebGIS === 'yes' || p.status === 'yes' || p.status === 'published');

            const color = isPointDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b');
            const pointStatus = isPointDefect ? 'defect' : (isPub ? 'published' : 'staging');

            points.push({
              id: p.id || `${runId}-p-${pIdx}`,
              subgrid: sg || p.subgrid || '',
              lng,
              lat,
              filename: p.filename,
              status: pointStatus,
              qa_status: isPointDefect ? 'defect' : (p.qa_status || d.qaqcStatus),
              isPublished: isPub && !isPointDefect,
              color
            });
          }
          runPoints.push([lng, lat]);
        });
      } else if (Array.isArray(d.points) && d.points.length > 0) {
        d.points.forEach((pt: any, ptIdx: number) => {
          const lng = parseNum(pt.lon ?? pt.lng ?? pt.longitude);
          const lat = parseNum(pt.lat ?? pt.latitude);
          if (lat === null || lng === null || (lat === 0 && lng === 0)) return;

          const key = `${sg}_${lat.toFixed(5)}_${lng.toFixed(5)}`;
          if (!seenPointKeys.has(key)) {
            seenPointKeys.add(key);

            const isPointDefect = Boolean(
              pt.isDefect ||
              pt.is_defect ||
              pt.color === '#ef4444' ||
              dPub === 'need to recheck' ||
              dPub === 'no'
            );
            const isPub = d.publishToWebGIS === 'yes';
            const color = isPointDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b');
            const pointStatus = isPointDefect ? 'defect' : (isPub ? 'published' : 'staging');

            points.push({
              id: `${runId}-pt-${ptIdx}`,
              subgrid: sg,
              lng,
              lat,
              status: pointStatus,
              isPublished: isPub && !isPointDefect,
              color
            });
          }
          runPoints.push([lng, lat]);
        });
      }

      if (runPoints.length >= 2) {
        tracks.push(runPoints);
      }
    });
  }

  // 2. Process batchLogs (if dailyData didn't have all points)
  if (Array.isArray(batchLogs) && batchLogs.length > 0) {
    batchLogs.forEach((b, bIdx) => {
      const sg = (b.subgrid || '').toUpperCase().trim();
      const bRunPoints: Array<[number, number]> = [];
      const bPub = (b.publishToWebGIS || '').toLowerCase().trim();

      if (Array.isArray(b.panoramas) && b.panoramas.length > 0) {
        b.panoramas.forEach((p: any, pIdx: number) => {
          const lng = parseNum(p.longitude ?? p.lon ?? p.lng);
          const lat = parseNum(p.latitude ?? p.lat);
          if (lat === null || lng === null || (lat === 0 && lng === 0)) return;

          const key = p.filename || p.id || `${sg}_${lat.toFixed(5)}_${lng.toFixed(5)}`;
          if (!seenPointKeys.has(key)) {
            seenPointKeys.add(key);

            const fnClean = (p.filename || p.image_url || p.point_id || p.pointId || '').split('/').pop()?.toUpperCase().trim();
            const ptClean = (p.point_id || p.pointId || '').toUpperCase().trim();
            const pStatus = (p.status || '').toLowerCase().trim();
            const pQa = (p.qa_status || '').toLowerCase().trim();

            const isPointDefect = Boolean(
              (fnClean && defectKeySet.has(fnClean)) ||
              (ptClean && defectKeySet.has(ptClean)) ||
              p.isDefect ||
              p.is_defect ||
              p.defectType ||
              pStatus === 'defect' ||
              pStatus === 'need to recheck' ||
              pStatus === 'no' ||
              pQa === 'defect' ||
              pQa === 'flagged' ||
              pQa.includes('defect') ||
              bPub === 'need to recheck' ||
              bPub === 'no' ||
              p.color === '#ef4444' ||
              p.statusColor === '#ef4444' ||
              (p.defect_flags && typeof p.defect_flags === 'object' && Object.values(p.defect_flags).some(Boolean))
            );

            const isPub = p.isPublished !== undefined
              ? Boolean(p.isPublished)
              : (b.publishToWebGIS === 'yes' || p.status === 'yes' || p.status === 'published');

            const color = isPointDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b');
            const pointStatus = isPointDefect ? 'defect' : (isPub ? 'published' : 'staging');

            points.push({
              id: p.id || `b-${bIdx}-p-${pIdx}`,
              subgrid: sg,
              lng,
              lat,
              filename: p.filename,
              status: pointStatus,
              qa_status: isPointDefect ? 'defect' : p.qa_status,
              isPublished: isPub && !isPointDefect,
              color
            });
          }
          bRunPoints.push([lng, lat]);
        });
      } else if (Array.isArray(b.points) && b.points.length > 0) {
        b.points.forEach((pt: any, ptIdx: number) => {
          const lng = parseNum(pt.lon ?? pt.lng ?? pt.longitude);
          const lat = parseNum(pt.lat ?? pt.latitude);
          if (lat === null || lng === null || (lat === 0 && lng === 0)) return;

          const key = `${sg}_${lat.toFixed(5)}_${lng.toFixed(5)}`;
          if (!seenPointKeys.has(key)) {
            seenPointKeys.add(key);
            const isPub = b.publishToWebGIS === 'yes';
            const color = getPanotrackStatusColor({
              status: b.status,
              qa_status: b.qaqcStatus,
              isPublished: isPub,
              color: pt.color,
              defectCount: b.defectCount
            });

            points.push({
              id: `b-${bIdx}-pt-${ptIdx}`,
              subgrid: sg,
              lng,
              lat,
              status: b.status || (isPub ? 'published' : 'staging'),
              isPublished: isPub,
              color
            });
          }
          bRunPoints.push([lng, lat]);
        });
      }

      if (bRunPoints.length >= 2) {
        tracks.push(bRunPoints);
      }
    });
  }

  // 3. Fallback to SUBGRID_COORDINATES if no points found in active data
  if (points.length === 0 && typeof SUBGRID_COORDINATES === 'object' && SUBGRID_COORDINATES !== null) {
    Object.entries(SUBGRID_COORDINATES).forEach(([sg, coord]) => {
      const lng = parseNum(coord?.[0]);
      const lat = parseNum(coord?.[1]);
      if (lng !== null && lat !== null && (lat !== 0 || lng !== 0)) {
        points.push({
          id: `sg-${sg}`,
          subgrid: sg,
          lng,
          lat,
          status: 'published',
          isPublished: true,
          color: '#10b981'
        });
      }
    });
  }

  return { points, tracks };
}

/**
 * Filter panotrack points and trajectory tracks by geographic districts.
 * If no district is specified, returns all points.
 */
export function filterPanotrackByDistricts(
  points: PanotrackPoint[],
  tracks: Array<Array<[number, number]>>,
  selectedDistricts: MalaysiaDistrict[]
): {
  filteredPoints: PanotrackPoint[];
  filteredTracks: Array<Array<[number, number]>>;
} {
  if (!selectedDistricts || selectedDistricts.length === 0) {
    return { filteredPoints: points, filteredTracks: tracks };
  }

  const filteredPoints = points.filter((p) => pointInDistricts([p.lng, p.lat], selectedDistricts));

  const filteredTracks: Array<Array<[number, number]>> = [];
  tracks.forEach((trk) => {
    const validCoords = trk.filter((pt) => pointInDistricts(pt, selectedDistricts));
    if (validCoords.length >= 2) {
      filteredTracks.push(validCoords);
    }
  });

  return { filteredPoints, filteredTracks };
}
