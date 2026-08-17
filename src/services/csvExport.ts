/**
 * Utility functions for spatially exporting filtered subgrid and BBOX points to CSV.
 */

export interface SpatialPoint {
  filename?: string;
  image_url?: string;
  imageFilename?: string;
  subgrid?: string;
  latitude?: number;
  lat?: number;
  longitude?: number;
  lon?: number;
  bearing?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  date?: string;
  captured_at?: string;
  qa_status?: string;
}

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Filters spatial points within a bounding box [minLon, minLat, maxLon, maxLat]
 * and generates/triggers a CSV file download in the browser.
 */
export function exportBboxPointsToCsv(
  points: SpatialPoint[],
  bbox?: BoundingBox,
  outputFilename: string = 'export_spatial_points.csv'
): { success: boolean; count: number; message: string } {
  try {
    if (!points || points.length === 0) {
      return { success: false, count: 0, message: 'No points available to export.' };
    }

    // Filter by spatial bounding box if provided
    const filtered = points.filter(p => {
      const lat = Number(p.latitude ?? p.lat);
      const lon = Number(p.longitude ?? p.lon);
      if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) return false;

      if (bbox) {
        return (
          lon >= bbox.minLon &&
          lon <= bbox.maxLon &&
          lat >= bbox.minLat &&
          lat <= bbox.maxLat
        );
      }
      return true;
    });

    if (filtered.length === 0) {
      return { success: false, count: 0, message: 'No points found within the selected bounding box.' };
    }

    // CSV Headers
    const headers = ['filename', 'subgrid', 'latitude', 'longitude', 'bearing', 'pitch', 'roll', 'captured_at', 'qa_status'];

    // Format rows
    const csvRows = filtered.map(p => {
      const filename = p.filename || p.image_url || p.imageFilename || '';
      const subgrid = p.subgrid || (filename.match(/^(N\d+E\d+)/i)?.[1] || 'UNKNOWN').toUpperCase();
      const lat = Number(p.latitude ?? p.lat ?? 0).toFixed(6);
      const lon = Number(p.longitude ?? p.lon ?? 0).toFixed(6);
      const bearing = Number(p.bearing ?? p.heading ?? 0).toFixed(1);
      const pitch = Number(p.pitch ?? 0).toFixed(1);
      const roll = Number(p.roll ?? 0).toFixed(1);
      const capturedAt = p.captured_at || p.date || new Date().toISOString();
      const qaStatus = p.qa_status || 'Passed';

      return [
        `"${filename.replace(/"/g, '""')}"`,
        `"${subgrid}"`,
        lat,
        lon,
        bearing,
        pitch,
        roll,
        `"${capturedAt}"`,
        `"${qaStatus}"`
      ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    // Trigger browser download
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', outputFilename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return {
      success: true,
      count: filtered.length,
      message: `Successfully exported ${filtered.length} points to ${outputFilename}`
    };
  } catch (err) {
    console.error('Failed to export BBOX points to CSV:', err);
    return {
      success: false,
      count: 0,
      message: (err as Error).message || 'CSV export failed'
    };
  }
}
