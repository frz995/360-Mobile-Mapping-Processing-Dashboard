import * as toGeoJSON from '@tmcw/togeojson';
import * as shapefile from 'shapefile';
import { extractZipFiles } from './zipReader';

export interface ParseRoadPlanResult {
  geojson: any;
  coordinates: Array<[number, number]>;
  format: 'geojson' | 'kml' | 'shapefile_zip' | 'shp';
  filename: string;
  featureCount: number;
}

/**
 * Robust coordinate extractor that parses raw LineString/MultiLineString geometries,
 * single Features, or FeatureCollections containing one or more road lines.
 */
export function extractLineCoords(geojson: any): Array<[number, number]> {
  if (!geojson) return [];

  // 1. If raw LineString geometry
  if (geojson.type === 'LineString' && Array.isArray(geojson.coordinates)) {
    return geojson.coordinates
      .filter((c: any) => Array.isArray(c) && c.length >= 2)
      .map((c: any) => [Number(c[0]), Number(c[1])] as [number, number]);
  }

  // 2. If raw MultiLineString geometry
  if (geojson.type === 'MultiLineString' && Array.isArray(geojson.coordinates)) {
    return geojson.coordinates
      .flatMap((line: any) => (Array.isArray(line) ? line : []))
      .filter((c: any) => Array.isArray(c) && c.length >= 2)
      .map((c: any) => [Number(c[0]), Number(c[1])] as [number, number]);
  }

  // 3. If Single Feature
  if (geojson.type === 'Feature' && geojson.geometry) {
    return extractLineCoords(geojson.geometry);
  }

  // 4. If FeatureCollection
  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    const coords: Array<[number, number]> = [];
    for (const feat of geojson.features) {
      if (feat?.geometry) {
        coords.push(...extractLineCoords(feat.geometry));
      }
    }
    return coords;
  }

  // 5. Fallback if geometry exists on object
  if (geojson.geometry) {
    return extractLineCoords(geojson.geometry);
  }

  return [];
}

/**
 * Extract each road line as its own coordinate run so lengths can be
 * computed per-line (instead of across a flattened array, which introduces
 * phantom distances between disconnected lines).
 */
export function extractLineRuns(geojson: any): Array<Array<[number, number]>> {
  if (!geojson) return [];

  const toRun = (coords: any): Array<[number, number]> =>
    (Array.isArray(coords) ? coords : [])
      .filter((c: any) => Array.isArray(c) && c.length >= 2)
      .map((c: any) => [Number(c[0]), Number(c[1])] as [number, number]);

  if (geojson.type === 'LineString' && Array.isArray(geojson.coordinates)) {
    return [toRun(geojson.coordinates)].filter((r) => r.length >= 2);
  }

  if (geojson.type === 'MultiLineString' && Array.isArray(geojson.coordinates)) {
    return geojson.coordinates
      .map((line: any) => toRun(line))
      .filter((r: Array<[number, number]>) => r.length >= 2);
  }

  if (geojson.type === 'Feature' && geojson.geometry) {
    return extractLineRuns(geojson.geometry);
  }

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    const runs: Array<Array<[number, number]>> = [];
    for (const feat of geojson.features) {
      if (feat?.geometry) runs.push(...extractLineRuns(feat.geometry));
    }
    return runs;
  }

  if (geojson.geometry) {
    return extractLineRuns(geojson.geometry);
  }

  return [];
}

export function readFileAsText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file as text'));
    reader.readAsText(file);
  });
}

export function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file as ArrayBuffer'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Universal spatial road-plan file parser.
 * Supports:
 * - GeoJSON (.geojson, .json)
 * - KML (.kml)
 * - Zipped Shapefile (.zip containing .shp, .dbf, .shx)
 * - Standalone Shapefile (.shp)
 */
export async function parseRoadPlanFile(file: File): Promise<ParseRoadPlanResult> {
  const lowerName = file.name.toLowerCase();

  // 1. GeoJSON (.geojson, .json)
  if (lowerName.endsWith('.geojson') || lowerName.endsWith('.json')) {
    const text = await readFileAsText(file);
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON format: Failed to parse file as valid JSON.');
    }
    const coords = extractLineCoords(parsed);
    if (coords.length < 2) {
      throw new Error('GeoJSON must contain a LineString or MultiLineString with at least 2 coordinate points.');
    }
    const featureCount = parsed.type === 'FeatureCollection' ? parsed.features?.length || 1 : 1;
    return {
      geojson: parsed,
      coordinates: coords,
      format: 'geojson',
      filename: file.name,
      featureCount
    };
  }

  // 2. KML (.kml)
  if (lowerName.endsWith('.kml')) {
    const text = await readFileAsText(file);
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(text, 'text/xml');
    const parserError = kmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Invalid KML format: XML parsing failed.');
    }
    const geojson = toGeoJSON.kml(kmlDoc);
    const coords = extractLineCoords(geojson);
    if (coords.length < 2) {
      throw new Error('KML file does not contain any valid LineString paths with at least 2 points.');
    }
    return {
      geojson,
      coordinates: coords,
      format: 'kml',
      filename: file.name,
      featureCount: geojson.features?.length || 1
    };
  }

  // 3. Shapefile in ZIP (.zip)
  if (lowerName.endsWith('.zip')) {
    const buffer = await readFileAsArrayBuffer(file);
    const zipEntries = await extractZipFiles(buffer);

    const shpEntry = zipEntries.find((e) => e.name.toLowerCase().endsWith('.shp'));
    if (!shpEntry) {
      throw new Error('The ZIP archive must contain a .shp file along with its companion .dbf and .shx files.');
    }

    const baseName = shpEntry.name.replace(/\.shp$/i, '').toLowerCase();
    const dbfEntry = zipEntries.find((e) => {
      const eLower = e.name.toLowerCase();
      return eLower.endsWith('.dbf') && (eLower === `${baseName}.dbf` || !zipEntries.some(x => x.name.toLowerCase() === `${baseName}.dbf`));
    });

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

    if (features.length === 0) {
      throw new Error('Shapefile inside ZIP contains 0 features.');
    }

    const geojson = {
      type: 'FeatureCollection',
      features
    };

    const coords = extractLineCoords(geojson);
    if (coords.length < 2) {
      throw new Error('Shapefile must contain LineString or MultiLineString road geometries with at least 2 coordinates.');
    }

    return {
      geojson,
      coordinates: coords,
      format: 'shapefile_zip',
      filename: file.name,
      featureCount: features.length
    };
  }

  // 4. Standalone Shapefile (.shp)
  if (lowerName.endsWith('.shp')) {
    const buffer = await file.arrayBuffer();
    const source = await shapefile.open(buffer);
    const features: any[] = [];
    let record = await source.read();
    while (!record.done) {
      if (record.value) {
        features.push(record.value);
      }
      record = await source.read();
    }

    if (features.length === 0) {
      throw new Error('Shapefile contains 0 features.');
    }

    const geojson = {
      type: 'FeatureCollection',
      features
    };

    const coords = extractLineCoords(geojson);
    if (coords.length < 2) {
      throw new Error('Shapefile must contain LineString or MultiLineString geometries with at least 2 coordinates.');
    }

    return {
      geojson,
      coordinates: coords,
      format: 'shp',
      filename: file.name,
      featureCount: features.length
    };
  }

  throw new Error(`Unsupported format "${file.name}". Please upload a GeoJSON (.geojson, .json), KML (.kml), or Shapefile ZIP (.zip).`);
}
