import { describe, it, expect } from 'vitest';
import {
  parseGisImportFile,
  computeGeoJsonBBox,
  classifyGeometryType,
  parseCsvToGeoJson
} from '../gisImportParser';

describe('gisImportParser', () => {
  describe('computeGeoJsonBBox & classifyGeometryType', () => {
    it('correctly calculates bbox and geometry type for a LineString', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [101.5, 3.1],
                [101.7, 3.3]
              ]
            },
            properties: { name: 'Test Road' }
          }
        ]
      };

      const bbox = computeGeoJsonBBox(geojson);
      expect(bbox).toEqual([101.5, 3.1, 101.7, 3.3]);
      expect(classifyGeometryType(geojson)).toBe('LineString');
    });

    it('correctly calculates bbox and geometry type for a Polygon', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [100.0, 4.0],
                  [100.5, 4.0],
                  [100.5, 4.5],
                  [100.0, 4.5],
                  [100.0, 4.0]
                ]
              ]
            },
            properties: {}
          }
        ]
      };

      const bbox = computeGeoJsonBBox(geojson);
      expect(bbox).toEqual([100.0, 4.0, 100.5, 4.5]);
      expect(classifyGeometryType(geojson)).toBe('Polygon');
    });

    it('correctly classifies mixed geometries', () => {
      const geojson = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [101.0, 3.0] },
            properties: {}
          },
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [101.0, 3.0],
                [101.1, 3.1]
              ]
            },
            properties: {}
          }
        ]
      };

      expect(classifyGeometryType(geojson)).toBe('Mixed');
    });
  });

  describe('parseCsvToGeoJson', () => {
    it('parses valid CSV with lat/lon headers into Point FeatureCollection', () => {
      const csv = `id,name,lat,lon,status\n1,Point A,3.139,101.686,active\n2,Point B,3.145,101.692,pending`;
      const result = parseCsvToGeoJson(csv);

      expect(result.type).toBe('FeatureCollection');
      expect(result.features).toHaveLength(2);
      expect(result.features[0].geometry.type).toBe('Point');
      expect(result.features[0].geometry.coordinates).toEqual([101.686, 3.139]);
      expect(result.features[0].properties.name).toBe('Point A');
      expect(result.features[0].properties.status).toBe('active');
    });

    it('throws when spatial coordinate columns are missing', () => {
      const csv = `id,name,value\n1,Item A,100`;
      expect(() => parseCsvToGeoJson(csv)).toThrow(/identify spatial coordinate columns/i);
    });
  });

  describe('parseGisImportFile', () => {
    it('successfully parses a GeoJSON file', async () => {
      const geojsonContent = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [101.2, 3.2],
                [101.4, 3.4]
              ]
            },
            properties: { route: 'Federal Highway' }
          }
        ]
      });

      const file = new File([geojsonContent], 'federal_highway.geojson', {
        type: 'application/geo+json'
      });

      const res = await parseGisImportFile(file);
      expect(res.format).toBe('geojson');
      expect(res.featureCount).toBe(1);
      expect(res.geometryType).toBe('LineString');
      expect(res.hasRoadLines).toBe(true);
      expect(res.totalDistanceKm).toBeGreaterThan(0);
      expect(res.bbox).toEqual([101.2, 3.2, 101.4, 3.4]);
    });

    it('successfully parses a KML file', async () => {
      const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <Placemark>
            <name>Substation Alpha</name>
            <Point>
              <coordinates>101.65,3.15,0</coordinates>
            </Point>
          </Placemark>
        </Document>
      </kml>`;

      const file = new File([kmlContent], 'substations.kml', {
        type: 'application/vnd.google-earth.kml+xml'
      });

      const res = await parseGisImportFile(file);
      expect(res.format).toBe('kml');
      expect(res.featureCount).toBe(1);
      expect(res.geometryType).toBe('Point');
      expect(res.bbox).toEqual([101.65, 3.15, 101.65, 3.15]);
    });

    it('successfully parses a KMZ archive with KML inside', async () => {
      const { zipSync } = await import('fflate');
      const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <Placemark>
            <name>KMZ Point</name>
            <Point><coordinates>102.1,3.5,0</coordinates></Point>
          </Placemark>
        </Document>
      </kml>`;
      const zipBytes = zipSync({
        'doc.kml': new TextEncoder().encode(kmlContent)
      });
      const file = new File([zipBytes], 'dataset.kmz', {
        type: 'application/vnd.google-earth.kmz'
      });

      const res = await parseGisImportFile(file);
      expect(res.format).toBe('kml');
      expect(res.featureCount).toBe(1);
      expect(res.bbox).toEqual([102.1, 3.5, 102.1, 3.5]);
    });

    it('automatically reprojects Web Mercator EPSG:3857 coordinates to WGS84', async () => {
      // Kuala Lumpur in EPSG:3857 meters: ~11319747, 349603
      const webMercatorGeoJson = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [11319747.78, 349603.88]
            },
            properties: { site: 'KL Tower' }
          }
        ]
      });

      const file = new File([webMercatorGeoJson], 'projected_data.geojson', {
        type: 'application/geo+json'
      });

      const res = await parseGisImportFile(file);
      expect(res.warnings).toBeDefined();
      expect(res.warnings![0]).toMatch(/EPSG:3857 Web Mercator/i);
      // Longitude should be ~101.68 and Latitude ~3.139
      expect(res.bbox![0]).toBeCloseTo(101.6869, 2);
      expect(res.bbox![1]).toBeCloseTo(3.139, 2);
    });

    it('throws on unsupported file format', async () => {
      const file = new File(['dummy'], 'test.txt', { type: 'text/plain' });
      await expect(parseGisImportFile(file)).rejects.toThrow(/unsupported file format/i);
    });

    it('throws on invalid JSON in geojson file', async () => {
      const file = new File(['{not valid json'], 'bad.geojson', {
        type: 'application/json'
      });
      await expect(parseGisImportFile(file)).rejects.toThrow(/invalid json format/i);
    });
  });
});
