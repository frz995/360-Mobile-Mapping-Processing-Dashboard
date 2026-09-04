import * as toGeoJSON from '@tmcw/togeojson';
import * as shapefile from 'shapefile';
import { extractZipFiles } from './zipReader';
import { extractLineRuns, readFileAsText, readFileAsArrayBuffer } from './roadPlanParser';

export { readFileAsText, readFileAsArrayBuffer };

export type GisFormat = 'geojson' | 'kml' | 'shp_zip' | 'shp' | 'gpx' | 'csv';
export type GisGeometryType = 'LineString' | 'Polygon' | 'Point' | 'Mixed';

export interface CatalogVectorLayer {
  id: string;
  name: string;
  format: GisFormat;
  geojson: any;
  color: string;
  fillColor?: string;
  fillOpacity?: number; // 0 to 1 (0 = hollow outline only)
  opacity: number; // 0 to 1 (stroke opacity)
  strokeWidth: number; // 1 to 10
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  pointRadius?: number; // 2 to 16
  pointStrokeColor?: string;
  pointStrokeWidth?: number;
  visible: boolean;
  featureCount: number;
  geometryType: GisGeometryType;
  bbox: [number, number, number, number] | null; // [minLng, minLat, maxLng, maxLat]
  uploadedAt: string;
  fileSizeFormatted?: string;
  hasRoadLines: boolean;
  lineRuns?: Array<Array<[number, number]>>;
  totalDistanceKm?: number;
  showLabels?: boolean;
  labelField?: string;
  labelColor?: string;
  labelSize?: number;
  labelBold?: boolean;
  labelHaloColor?: string;
  labelHaloWidth?: number;
  labelMinZoom?: number;
}

export interface GisImportResult {
  geojson: any;
  format: GisFormat;
  filename: string;
  featureCount: number;
  geometryType: GisGeometryType;
  bbox: [number, number, number, number] | null;
  hasRoadLines: boolean;
  lineRuns: Array<Array<[number, number]>>;
  totalDistanceKm: number;
  warnings?: string[];
}

/**
 * Format raw byte size into human readable string (KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Traverses any GeoJSON geometry/feature/FeatureCollection and computes its 2D bounding box [minLng, minLat, maxLng, maxLat].
 */
export function computeGeoJsonBBox(geojson: any): [number, number, number, number] | null {
  if (!geojson) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let count = 0;

  const visitCoord = (c: any) => {
    if (Array.isArray(c) && c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1])) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      count++;
    }
  };

  const visitGeom = (geom: any) => {
    if (!geom || !geom.type) return;
    const { type, coordinates } = geom;
    if (!Array.isArray(coordinates)) return;

    if (type === 'Point') {
      visitCoord(coordinates);
    } else if (type === 'MultiPoint' || type === 'LineString') {
      coordinates.forEach(visitCoord);
    } else if (type === 'MultiLineString' || type === 'Polygon') {
      coordinates.forEach((ring: any) => {
        if (Array.isArray(ring)) ring.forEach(visitCoord);
      });
    } else if (type === 'MultiPolygon') {
      coordinates.forEach((poly: any) => {
        if (Array.isArray(poly)) {
          poly.forEach((ring: any) => {
            if (Array.isArray(ring)) ring.forEach(visitCoord);
          });
        }
      });
    } else if (type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      geom.geometries.forEach(visitGeom);
    }
  };

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    for (const f of geojson.features) {
      if (f?.geometry) visitGeom(f.geometry);
    }
  } else if (geojson.type === 'Feature' && geojson.geometry) {
    visitGeom(geojson.geometry);
  } else if (geojson.type) {
    visitGeom(geojson);
  }

  if (count === 0 || minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Classifies the dominant geometry type across all features in a GeoJSON dataset.
 */
export function classifyGeometryType(geojson: any): GisGeometryType {
  const types = new Set<string>();

  const recordType = (geom: any) => {
    if (!geom?.type) return;
    const t = geom.type;
    if (t === 'LineString' || t === 'MultiLineString') types.add('LineString');
    else if (t === 'Polygon' || t === 'MultiPolygon') types.add('Polygon');
    else if (t === 'Point' || t === 'MultiPoint') types.add('Point');
    else if (t === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      geom.geometries.forEach(recordType);
    }
  };

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    geojson.features.forEach((f: any) => {
      if (f?.geometry) recordType(f.geometry);
    });
  } else if (geojson.type === 'Feature' && geojson.geometry) {
    recordType(geojson.geometry);
  } else if (geojson.type) {
    recordType(geojson);
  }

  if (types.size === 0) return 'Point';
  if (types.size === 1) return types.values().next().value as GisGeometryType;
  return 'Mixed';
}

/**
 * Detects whether coordinates are in EPSG:3857 (Web Mercator meters) and converts them
 * to standard EPSG:4326 (WGS84 degrees) so they render correctly on the map.
 */
export function normalizeGeoJsonCoordinates(geojson: any, warnings: string[]): any {
  if (!geojson) return geojson;

  const bbox = computeGeoJsonBBox(geojson);
  if (!bbox) return geojson;

  const [minLng, minLat, maxLng, maxLat] = bbox;

  // Web Mercator coordinate check (meters: X in [-20037508, 20037508], Y in [-20037508, 20037508])
  const isWebMercator =
    (Math.abs(minLng) > 180 || Math.abs(maxLng) > 180 || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) &&
    Math.abs(minLng) <= 20037508.35 &&
    Math.abs(maxLng) <= 20037508.35 &&
    Math.abs(minLat) <= 20037508.35 &&
    Math.abs(maxLat) <= 20037508.35;

  if (isWebMercator) {
    warnings.push(
      'Detected projected coordinates (EPSG:3857 Web Mercator). Converted to WGS84 (latitude/longitude) for map display.'
    );

    const transformCoord = (coord: any): any => {
      if (Array.isArray(coord) && coord.length >= 2 && typeof coord[0] === 'number' && typeof coord[1] === 'number') {
        const x = coord[0];
        const y = coord[1];
        const lng = (x / 20037508.342789244) * 180;
        let lat = (Math.atan(Math.exp((y / 20037508.342789244) * Math.PI)) * 360) / Math.PI - 90;
        const rest = coord.slice(2);
        return [lng, lat, ...rest];
      }
      return coord;
    };

    const transformGeom = (geom: any): any => {
      if (!geom || !geom.type || !Array.isArray(geom.coordinates)) return geom;
      const { type, coordinates } = geom;
      if (type === 'Point') {
        return { ...geom, coordinates: transformCoord(coordinates) };
      } else if (type === 'MultiPoint' || type === 'LineString') {
        return { ...geom, coordinates: coordinates.map(transformCoord) };
      } else if (type === 'MultiLineString' || type === 'Polygon') {
        return { ...geom, coordinates: coordinates.map((ring: any) => (Array.isArray(ring) ? ring.map(transformCoord) : ring)) };
      } else if (type === 'MultiPolygon') {
        return {
          ...geom,
          coordinates: coordinates.map((poly: any) =>
            Array.isArray(poly) ? poly.map((ring: any) => (Array.isArray(ring) ? ring.map(transformCoord) : ring)) : poly
          )
        };
      } else if (type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
        return { ...geom, geometries: geom.geometries.map(transformGeom) };
      }
      return geom;
    };

    const reprojectFeature = (f: any) => ({
      ...f,
      geometry: transformGeom(f.geometry)
    });

    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      return {
        ...geojson,
        features: geojson.features.map(reprojectFeature)
      };
    } else if (geojson.type === 'Feature') {
      return reprojectFeature(geojson);
    }
  } else if (Math.abs(minLng) > 180 || Math.abs(maxLng) > 180 || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
    warnings.push(
      `Coordinates [${minLng.toFixed(0)}, ${minLat.toFixed(0)}] appear to be in a projected system (e.g. Cassini, MRSO, UTM). Please export as WGS84 for exact map positioning.`
    );
  }

  return geojson;
}

/**
 * Parse CSV text into a GeoJSON FeatureCollection of Points.
 * Identifies latitude and longitude columns flexibly.
 */
export function parseCsvToGeoJson(csvText: string): any {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  // Simple CSV line splitter that respects quotes
  const splitCsvLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));
    return values;
  };

  const headers = splitCsvLine(lines[0]);
  const lowerHeaders = headers.map((h) => h.toLowerCase());

  // Find longitude column index
  const lonIndex = lowerHeaders.findIndex((h) =>
    ['lon', 'lng', 'longitude', 'long', 'x', 'easting', 'coord_x'].includes(h)
  );
  // Find latitude column index
  const latIndex = lowerHeaders.findIndex((h) =>
    ['lat', 'latitude', 'y', 'northing', 'coord_y'].includes(h)
  );

  if (lonIndex === -1 || latIndex === -1) {
    throw new Error(
      `Could not identify spatial coordinate columns in CSV. Expected headers such as "lat"/"latitude" and "lon"/"lng"/"longitude". Found: [${headers.join(', ')}]`
    );
  }

  const features: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvLine(lines[i]);
    if (row.length <= Math.max(lonIndex, latIndex)) continue;

    const lon = parseFloat(row[lonIndex]);
    const lat = parseFloat(row[latIndex]);

    if (!isNaN(lon) && !isNaN(lat)) {
      const properties: Record<string, any> = {};
      headers.forEach((h, idx) => {
        if (idx !== lonIndex && idx !== latIndex) {
          properties[h] = row[idx] ?? '';
        }
      });

      features.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        }
      });
    }
  }

  if (features.length === 0) {
    throw new Error('CSV file did not contain any rows with valid numerical latitude and longitude coordinates.');
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Universal spatial GIS file parser supporting:
 * - GeoJSON (.geojson, .json)
 * - KML (.kml)
 * - Shapefile inside ZIP (.zip containing .shp, .dbf, .shx)
 * - Standalone Shapefile (.shp)
 * - GPX (.gpx)
 * - CSV (.csv with coordinates)
 */
export async function parseGisImportFile(file: File): Promise<GisImportResult> {
  const lowerName = file.name.toLowerCase();
  const warnings: string[] = [];

  let geojson: any = null;
  let format: GisFormat = 'geojson';

  // 1. GeoJSON (.geojson, .json)
  if (lowerName.endsWith('.geojson') || lowerName.endsWith('.json')) {
    format = 'geojson';
    const text = await readFileAsText(file);
    try {
      geojson = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON format: File "${file.name}" could not be parsed as valid JSON.`);
    }
  }
  // 2. KML (.kml)
  else if (lowerName.endsWith('.kml')) {
    format = 'kml';
    const text = await readFileAsText(file);
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(text, 'text/xml');
    const parserError = kmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error(`Invalid KML format: XML parsing failed for "${file.name}".`);
    }
    geojson = toGeoJSON.kml(kmlDoc);
  }
  // 3. GPX (.gpx)
  else if (lowerName.endsWith('.gpx')) {
    format = 'gpx';
    const text = await readFileAsText(file);
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(text, 'text/xml');
    const parserError = gpxDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error(`Invalid GPX format: XML parsing failed for "${file.name}".`);
    }
    geojson = toGeoJSON.gpx(gpxDoc);
  }
  // 4. CSV (.csv)
  else if (lowerName.endsWith('.csv')) {
    format = 'csv';
    const text = await readFileAsText(file);
    geojson = parseCsvToGeoJson(text);
  }
    // 5. Shapefile in ZIP or KMZ (.zip, .kmz)
  else if (lowerName.endsWith('.zip') || lowerName.endsWith('.kmz')) {
    format = lowerName.endsWith('.kmz') ? 'kml' : 'shp_zip';
    const buffer = await readFileAsArrayBuffer(file);
    const zipEntries = await extractZipFiles(buffer);

    // Check if the zip is actually a KMZ or zipped KML
    const kmlEntry = zipEntries.find((e) => e.name.toLowerCase().endsWith('.kml'));
    const shpEntry = zipEntries.find((e) => e.name.toLowerCase().endsWith('.shp'));

    if (kmlEntry && (!shpEntry || lowerName.endsWith('.kmz'))) {
      format = 'kml';
      const kmlText = new TextDecoder('utf-8').decode(kmlEntry.data);
      const parser = new DOMParser();
      const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
      const parserError = kmlDoc.querySelector('parsererror');
      if (parserError) {
        throw new Error(`Invalid KML format in archive "${file.name}".`);
      }
      geojson = toGeoJSON.kml(kmlDoc);
    } else if (shpEntry) {
      const baseName = shpEntry.name.replace(/\.shp$/i, '').toLowerCase();
      const dbfEntry = zipEntries.find((e) => {
        const eLower = e.name.toLowerCase();
        return eLower.endsWith('.dbf') && (eLower === `${baseName}.dbf` || !zipEntries.some((x) => x.name.toLowerCase() === `${baseName}.dbf`));
      });

      if (!dbfEntry) {
        warnings.push('ZIP did not contain a matching .dbf table; feature attributes will be empty.');
      }

      // Isolate clean ArrayBuffer slices for shapefile parser
      const shpBuffer = shpEntry.data.buffer.slice(
        shpEntry.data.byteOffset,
        shpEntry.data.byteOffset + shpEntry.data.byteLength
      );
      const dbfBuffer = dbfEntry
        ? dbfEntry.data.buffer.slice(
            dbfEntry.data.byteOffset,
            dbfEntry.data.byteOffset + dbfEntry.data.byteLength
          )
        : undefined;

      const source = await shapefile.open(shpBuffer, dbfBuffer);
      const features: any[] = [];
      let record = await source.read();
      while (!record.done) {
        if (record.value) {
          features.push(record.value);
        }
        record = await source.read();
      }

      geojson = {
        type: 'FeatureCollection',
        features
      };
    } else {
      // Check if archive contains GeoJSON
      const jsonEntry = zipEntries.find(
        (e) => e.name.toLowerCase().endsWith('.geojson') || e.name.toLowerCase().endsWith('.json')
      );
      if (jsonEntry) {
        format = 'geojson';
        const jsonText = new TextDecoder('utf-8').decode(jsonEntry.data);
        geojson = JSON.parse(jsonText);
      } else {
        throw new Error(
          `Archive "${file.name}" must contain a .shp, .kml, or .geojson file. Found: [${zipEntries.map((e) => e.name.split('/').pop()).join(', ')}]`
        );
      }
    }
  }
  // 6. Standalone Shapefile (.shp)
  else if (lowerName.endsWith('.shp')) {
    format = 'shp';
    const buffer = await readFileAsArrayBuffer(file);
    const source = await shapefile.open(buffer);

    const features: any[] = [];
    let record = await source.read();
    while (!record.done) {
      if (record.value) {
        features.push(record.value);
      }
      record = await source.read();
    }

    geojson = {
      type: 'FeatureCollection',
      features
    };
    warnings.push('Standalone .shp uploaded without .dbf. For full attributes, upload a .zip archive containing .shp and .dbf.');
  } else {
    throw new Error(
      `Unsupported file format "${file.name}". Please upload a GeoJSON (.geojson, .json), KML/KMZ (.kml, .kmz), GPX (.gpx), CSV (.csv), or Shapefile ZIP (.zip).`
    );
  }

  // Normalize GeoJSON container
  if (!geojson) {
    throw new Error(`Failed to extract spatial data from "${file.name}".`);
  }

  if (geojson.type === 'Feature') {
    geojson = { type: 'FeatureCollection', features: [geojson] };
  } else if (geojson.type && geojson.type !== 'FeatureCollection') {
    geojson = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: geojson }]
    };
  }

  // Automatic coordinate system detection and Web Mercator reprojection
  geojson = normalizeGeoJsonCoordinates(geojson, warnings);

  const features = Array.isArray(geojson.features) ? geojson.features : [];
  if (features.length === 0) {
    throw new Error(`The file "${file.name}" contained 0 spatial features.`);
  }

  const bbox = computeGeoJsonBBox(geojson);
  const geometryType = classifyGeometryType(geojson);

  // Check for coordinates outside WGS84 range (likely projected UTM/State Plane)
  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
      warnings.push(
        `Coordinates [${minLng.toFixed(1)}, ${minLat.toFixed(1)}] appear to be in a projected coordinate system (e.g. UTM/Cassini). Re-export as WGS84 (EPSG:4326) for exact global map positioning.`
      );
    }
  }

  // Extract road runs if lines are present
  const lineRuns = extractLineRuns(geojson);
  const hasRoadLines = lineRuns.length > 0;

  // Calculate approximate distance in KM for line runs
  let totalDistanceKm = 0;
  if (hasRoadLines) {
    for (const run of lineRuns) {
      for (let i = 0; i < run.length - 1; i++) {
        const [lon1, lat1] = run[i];
        const [lon2, lat2] = run[i + 1];
        const R = 6371; // km
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        totalDistanceKm += R * c;
      }
    }
  }

  return {
    geojson,
    format,
    filename: file.name,
    featureCount: features.length,
    geometryType,
    bbox,
    hasRoadLines,
    lineRuns,
    totalDistanceKm,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}
