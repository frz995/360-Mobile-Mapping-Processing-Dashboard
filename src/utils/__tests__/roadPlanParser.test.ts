import { describe, it, expect } from 'vitest';
import { extractLineCoords, parseRoadPlanFile } from '../roadPlanParser';

describe('roadPlanParser', () => {
  describe('extractLineCoords', () => {
    it('extracts coordinates from LineString geometry', () => {
      const geo = {
        type: 'LineString',
        coordinates: [[101.5, 3.1], [101.6, 3.2], [101.7, 3.3]]
      };
      const res = extractLineCoords(geo);
      expect(res).toEqual([[101.5, 3.1], [101.6, 3.2], [101.7, 3.3]]);
    });

    it('extracts coordinates from MultiLineString geometry', () => {
      const geo = {
        type: 'MultiLineString',
        coordinates: [
          [[101.1, 3.0], [101.2, 3.0]],
          [[101.3, 3.0], [101.4, 3.0]]
        ]
      };
      const res = extractLineCoords(geo);
      expect(res).toEqual([[101.1, 3.0], [101.2, 3.0], [101.3, 3.0], [101.4, 3.0]]);
    });

    it('extracts coordinates from FeatureCollection containing LineStrings', () => {
      const fc = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[100.1, 1.1], [100.2, 1.2]]
            }
          },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [[100.3, 1.3], [100.4, 1.4]]
            }
          }
        ]
      };
      const res = extractLineCoords(fc);
      expect(res).toEqual([[100.1, 1.1], [100.2, 1.2], [100.3, 1.3], [100.4, 1.4]]);
    });

    it('returns empty array for invalid or non-line geometries', () => {
      expect(extractLineCoords(null)).toEqual([]);
      expect(extractLineCoords({ type: 'Point', coordinates: [100, 1] })).toEqual([]);
    });
  });

  describe('parseRoadPlanFile', () => {
    it('parses valid GeoJSON file', async () => {
      const data = JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[103.5, 1.8], [103.6, 1.9]]
        }
      });
      const file = new File([data], 'highway_plan.geojson', { type: 'application/json' });
      const res = await parseRoadPlanFile(file);

      expect(res.format).toBe('geojson');
      expect(res.filename).toBe('highway_plan.geojson');
      expect(res.coordinates.length).toBe(2);
      expect(res.coordinates[0]).toEqual([103.5, 1.8]);
    });

    it('parses valid KML file', async () => {
      const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Survey Route</name>
      <LineString>
        <coordinates>
          103.85,1.29,0 103.86,1.30,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
      const file = new File([kmlContent], 'survey_track.kml', { type: 'application/vnd.google-earth.kml+xml' });
      const res = await parseRoadPlanFile(file);

      expect(res.format).toBe('kml');
      expect(res.filename).toBe('survey_track.kml');
      expect(res.coordinates.length).toBe(2);
    });

    it('rejects unsupported file formats with helpful instructions', async () => {
      const file = new File(['image bytes'], 'picture.png', { type: 'image/png' });
      await expect(parseRoadPlanFile(file)).rejects.toThrow('Unsupported format');
    });

    it('rejects empty or corrupt zip files without .shp', async () => {
      // 22 bytes dummy header lacking central directory
      const emptyZip = new Uint8Array(22);
      const file = new File([emptyZip], 'empty.zip', { type: 'application/zip' });
      await expect(parseRoadPlanFile(file)).rejects.toThrow();
    });
  });
});
