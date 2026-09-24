import * as toGeoJSON from '@tmcw/togeojson';
import * as shapefile from 'shapefile';
import { extractZipFiles } from './zipReader';
import { readFileAsText, readFileAsArrayBuffer } from './roadPlanParser';
import type { GisImportWorkerResponse } from '../workers/gisImport.worker';

export { readFileAsText, readFileAsArrayBuffer };

export type GisFormat = 'geojson' | 'kml' | 'shp_zip' | 'shp' | 'gpx' | 'csv';
export type GisGeometryType = 'LineString' | 'Polygon' | 'Point' | 'Mixed';

/**
 * Cheap estimate of the serialized JSON size of a GeoJSON document.
 * Walks the tree once counting coordinate scalars (a Position like [lng, lat]
 * counts 2-3 scalars) instead of allocating a full JSON.stringify — safe to run
 * even inside a Web Worker without doubling peak memory.
 */
export function estimateGeometryBytes(geojson: any): number {
  if (!geojson) return 0;
  let scalars = 0;
  let depth = 0;
  const walk = (v: any): void => {
    if (Array.isArray(v)) {
      if (v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        scalars += v.length;
        return;
      }
      depth++;
      v.forEach(walk);
      depth--;
    } else if (v && typeof v === 'object') {
      depth++;
      for (const k of Object.keys(v)) {
        if (depth > 0) scalars += k.length; // property name characters
        walk(v[k]);
      }
      depth--;
    }
  };
  walk(geojson);
  return scalars * 8 + depth * 4 + 256;
}

export interface CatalogVectorLayer {
  id: string;
  name: string;
  format: GisFormat;
  geojson: any;
  /** Serialized GeoJSON string for heavy layers too large to cross the
   *  worker→main boundary as an object graph. When present, the map hands this
   *  string to MapLibre as a blob URL (parsed in MapLibre's own worker), and
   *  `geojson` is left undefined so the 39 MB graph is never cloned on the UI
   *  thread. */
  geojsonJson?: string;
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
  totalDistanceKm?: number;
  showLabels?: boolean;
  labelField?: string;
  labelColor?: string;
  labelSize?: number;
  labelBold?: boolean;
  labelHaloColor?: string;
  labelHaloWidth?: number;
  labelMinZoom?: number;
  // Approximate serialized size of `geojson` (bytes), computed once off the
  // main thread. Persistence uses this to decide whether the geometry is small
  // enough to cache in localStorage without freezing the UI.
  geometryBytes?: number;
  // True when the layer's geometry was too large to persist in the local cache
  // (the on-screen copy keeps rendering from memory until the page reloads).
  geometryDropped?: boolean;
  // Object path inside the Supabase Storage road-geometry bucket where the
  // serialized `geojsonJson` bytes were backed up (heavy layers only), so a
  // cloud restore on another browser/device can re-download the geometry.
  geometryStoragePath?: string;
}

export interface GisImportResult {
  geojson: any;
  /** Serialized GeoJSON string. For heavyweight datasets (≳1.5 MB serialized)
   *  the parse worker replaces the 39 MB object graph with this flat string so
   *  the structured clone back to the main thread is one copy instead of tens of
   *  thousands of feature objects; consumers pass it to MapLibre as a blob URL. */
  geojsonJson?: string;
  format: GisFormat;
  filename: string;
  featureCount: number;
  geometryType: GisGeometryType;
  bbox: [number, number, number, number] | null;
  hasRoadLines: boolean;
  totalDistanceKm: number;
  geometryBytes?: number;
  warnings?: string[];
  /**
   * Region-aware clip computed off the main thread (in the parse worker), so
   * the import panel receives the exact polygon-clipped FeatureCollection plus
   * its statistics WITHOUT re-walking the dataset on the UI thread. `null`
   * means the dataset fits inside the selected district (no clip needed) or no
   * region was supplied; undefined means the inline parse path ran (small XML
   * formats) and the panel falls back to clipping on the main thread.
   */
  regionClip?: {
    /** Polygon-clipped FeatureCollection ready to import. */
    fc: any;
    featureCount: number;
    geometryType: GisGeometryType;
    bbox: [number, number, number, number] | null;
    hasRoadLines: boolean;
    lineCount: number;
    totalDistanceKm: number;
    /** Serialized-size estimate of `fc` (bytes). */
    geometryBytes: number;
    /** Fields below are the raw clip inputs, reused to keep budgets straight. */
    originalFeatureCount: number;
  } | null;
}

export interface DecodedSpatialFile {
  geojson: any;
  format: GisFormat;
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
 * XML parsing helper. Kept behind this indirection because Web Workers do not
 * expose DOMParser, so callers can branch between worker/inline execution.
 */
function parseXmlString(text: string): Document {
  const Parser = (globalThis as any).DOMParser as typeof DOMParser | undefined;
  if (!Parser) {
    throw new Error('XML parsing is unavailable in this environment.');
  }
  return new Parser().parseFromString(text, 'text/xml');
}

/**
 * Single-pass import statistics: bounding box, geometry classification, line
 * count, and total line kilometres are all computed in ONE traversal of the
 * GeoJSON tree, WITHOUT materializing a duplicate copy of the coordinates for
 * every line (the previous pipeline built a full `lineRuns` array that was
 * stored on the layer but never read back). This keeps peak memory flat for
 * large road datasets.
 */
export function analyzeImportGeometry(geojson: any): {
  bbox: [number, number, number, number] | null;
  geometryType: GisGeometryType;
  lineCount: number;
  totalDistanceKm: number;
} {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let count = 0;
  const types = new Set<string>();
  let lineCount = 0;
  let totalDistanceKm = 0;

  if (!geojson) {
    return { bbox: null, geometryType: 'Point', lineCount, totalDistanceKm };
  }

  const recordCoord = (c: any) => {
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

  // Sums haversine distance along one polyline WITHOUT allocating run arrays;
  // `lineCount` is incremented once per usable line (> 1 vertex).
  const addRun = (coords: any) => {
    if (!Array.isArray(coords)) return;
    let vertexCount = 0;
    let prevLng = 0;
    let prevLat = 0;
    for (const c of coords) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (vertexCount > 0) {
        const dLat = ((lat - prevLat) * Math.PI) / 180;
        const dLon = ((lng - prevLng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((prevLat * Math.PI) / 180) *
            Math.cos((lat * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const cAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        totalDistanceKm += 6371 * cAngle;
      }
      prevLng = lng;
      prevLat = lat;
      vertexCount++;
    }
    if (vertexCount >= 2) lineCount++;
  };

  const visitGeom = (geom: any) => {
    if (!geom || !geom.type) return;
    const t = geom.type;
    const coords = geom.coordinates;
    if (t === 'Point') {
      recordCoord(coords);
      types.add('Point');
    } else if (t === 'MultiPoint') {
      (Array.isArray(coords) ? coords : []).forEach(recordCoord);
      types.add('Point');
    } else if (t === 'LineString') {
      (Array.isArray(coords) ? coords : []).forEach(recordCoord);
      types.add('LineString');
      addRun(coords);
    } else if (t === 'MultiLineString') {
      (Array.isArray(coords) ? coords : []).forEach((line: any) => {
        (Array.isArray(line) ? line : []).forEach(recordCoord);
      });
      types.add('LineString');
      (Array.isArray(coords) ? coords : []).forEach((line: any) => addRun(line));
    } else if (t === 'Polygon') {
      (Array.isArray(coords) ? coords : []).forEach((ring: any) => {
        (Array.isArray(ring) ? ring : []).forEach(recordCoord);
      });
      types.add('Polygon');
    } else if (t === 'MultiPolygon') {
      (Array.isArray(coords) ? coords : []).forEach((poly: any) => {
        (Array.isArray(poly) ? poly : []).forEach((ring: any) => {
          (Array.isArray(ring) ? ring : []).forEach(recordCoord);
        });
      });
      types.add('Polygon');
    } else if (t === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      geom.geometries.forEach(visitGeom);
    }
  };

  if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
    geojson.features.forEach((f: any) => {
      if (f?.geometry) visitGeom(f.geometry);
    });
  } else if (geojson.type === 'Feature' && geojson.geometry) {
    visitGeom(geojson.geometry);
  } else if (geojson.type) {
    visitGeom(geojson);
  } else if (geojson.geometry) {
    visitGeom(geojson.geometry);
  }

  const geometryType: GisGeometryType =
    types.size === 0 ? 'Point' : types.size === 1 ? (types.values().next().value as GisGeometryType) : 'Mixed';

  return {
    bbox: count === 0 || minLng === Infinity ? null : [minLng, minLat, maxLng, maxLat],
    geometryType,
    lineCount,
    totalDistanceKm
  };
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
 * Streams every record from a shapefile source into memory, emitting a
 * throttled progress label (at most ~8/s) so the UI can show a live feature
 * counter instead of a static stage while a large .shp/.dbf is decoded.
 */
async function readShapefileRecords<R>(
  source: { read: () => Promise<{ done: boolean; value?: R }> },
  onProgress?: (stage: string) => void,
  cooperative = false
): Promise<R[]> {
  onProgress?.('Reading shapefile records…');
  const features: R[] = [];
  let record = await source.read();
  let lastEmitAt = Date.now();
  let seen = 0;
  while (!record.done) {
    if (record.value) {
      features.push(record.value);
    }
    seen++;
    if (seen % 200 === 0) {
      const now = Date.now();
      if (now - lastEmitAt > 120) {
        lastEmitAt = now;
        onProgress?.(`Reading shapefile records… ${seen.toLocaleString()} features`);
      }
    }
    if (cooperative && seen % 400 === 0) {
      // Yield to the event loop between record batches so the inline fallback
      // path (used when a worker is unavailable) lets the browser paint and
      // service input instead of hard-blocking the UI thread for the whole
      // decode. The worker path never enables this — no yield overhead there.
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    record = await source.read();
  }
  return features;
}

interface DecodeSpatialFileOptions {
  /** True on the main-thread inline path: yield periodically so the UI stays responsive. */
  cooperative?: boolean;
}

/**
 * Decodes a spatial file into a GeoJSON container (worker-safe for the non-XML
 * formats). XML formats (KML/KMZ/GPX and zipped KML archives) need DOMParser,
 * which Web Workers do not provide, so those always execute inline on the main
 * thread; the remaining formats reuse the exact same body inside a Worker.
 */
export async function decodeSpatialFile(
  file: File,
  warnings: string[],
  onProgress?: (stage: string) => void,
  options: DecodeSpatialFileOptions = {}
): Promise<DecodedSpatialFile> {
  const lowerName = file.name.toLowerCase();

  // Fail fast before reading a file that would exhaust the tab's memory once it
  // is buffered, parsed into GeoJSON, cloned, and (region-aware) clipped.
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error(
      `This file is ${formatBytes(file.size)} — too large for the browser to import in one pass. ` +
        'Clip the dataset to a single district (or fewer features) and re-export, then upload the smaller file.'
    );
  }

  let geojson: any = null;
  let format: GisFormat = 'geojson';

  onProgress?.('Reading file…');

  // 1. GeoJSON (.geojson, .json)
  if (lowerName.endsWith('.geojson') || lowerName.endsWith('.json')) {
    format = 'geojson';
    const text = await readFileAsText(file);
    onProgress?.('Parsing GeoJSON geometry…');
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
    onProgress?.('Parsing KML placemarks…');
    const kmlDoc = parseXmlString(text);
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
    onProgress?.('Parsing GPX tracks…');
    const gpxDoc = parseXmlString(text);
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
    onProgress?.('Parsing CSV coordinates…');
    geojson = parseCsvToGeoJson(text);
  }
    // 5. Shapefile in ZIP or KMZ (.zip, .kmz)
  else if (lowerName.endsWith('.zip') || lowerName.endsWith('.kmz')) {
    format = lowerName.endsWith('.kmz') ? 'kml' : 'shp_zip';
    const buffer = await readFileAsArrayBuffer(file);
    onProgress?.('Extracting archive…');
    const zipEntries = await extractZipFiles(buffer);

    // Check if the zip is actually a KMZ or zipped KML
    const kmlEntry = zipEntries.find((e) => e.name.toLowerCase().endsWith('.kml'));
    const shpEntry = zipEntries.find((e) => e.name.toLowerCase().endsWith('.shp'));

    if (kmlEntry && (!shpEntry || lowerName.endsWith('.kmz'))) {
      format = 'kml';
      const kmlText = new TextDecoder('utf-8').decode(kmlEntry.data);
      onProgress?.('Decoding KML placemarks…');
      const kmlDoc = parseXmlString(kmlText);
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
      const features = await readShapefileRecords(source, onProgress, options.cooperative);

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
    onProgress?.('Reading shapefile records…');
    const source = await shapefile.open(buffer);

    const features = await readShapefileRecords(source, onProgress, options.cooperative);

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

  return { geojson, format };
}

// ---------------------------------------------------------------------------
// Result assembly (pure, worker-safe)
// ---------------------------------------------------------------------------

/**
 * Turns a decoded GeoJSON container into the final import result: wraps loose
 * geometries into a FeatureCollection, normalizes projected coordinates, then
 * computes ALL statistics (bbox, geometry type, line count, total distance) in a
 * single traversal instead of the previous 4-5 full-document scans.
 */
export function buildImportResult(
  geojson: any,
  format: GisFormat,
  filename: string,
  warnings: string[],
  onProgress?: (stage: string) => void
): GisImportResult {
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
    throw new Error(`The file "${filename}" contained 0 spatial features.`);
  }

  onProgress?.('Computing geometry statistics…');
  const { bbox, geometryType, lineCount, totalDistanceKm } = analyzeImportGeometry(geojson);

  // Check for coordinates outside WGS84 range (likely projected UTM/State Plane)
  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) {
      warnings.push(
        `Coordinates [${minLng.toFixed(1)}, ${minLat.toFixed(1)}] appear to be in a projected coordinate system (e.g. UTM/Cassini). Re-export as WGS84 (EPSG:4326) for exact global map positioning.`
      );
    }
  }

  const hasRoadLines = lineCount > 0;

  return {
    geojson,
    format,
    filename,
    featureCount: features.length,
    geometryType,
    bbox,
    hasRoadLines,
    totalDistanceKm,
    geometryBytes: estimateGeometryBytes(geojson),
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

// ---------------------------------------------------------------------------
// Dispatch: Web Worker for large non-XML formats, inline fallback otherwise
// ---------------------------------------------------------------------------

// `.zip` is worker-routed too: shapefile archives unzip + decode fully off the
// UI thread. Only archives that turn out to hold KML/KMZ bounce back to inline
// (see parseGisImportFile) because workers have no DOMParser.
const WORKER_PARSE_EXT = /\.(geojson|json|shp|zip|csv)$/i;

/** Thrown by decodeSpatialFile when a worker tries to parse XML. */
export const WORKER_XML_UNAVAILABLE_ERROR = 'XML parsing is unavailable in this environment.';

/**
 * Hard ceiling on the RAW uploaded file size. Above this the browser is very
 * likely to run out of memory once the file is read into an ArrayBuffer, parsed
 * into a GeoJSON tree, cloned back from the worker, and clipped — the failure
 * surfaces to the user as an unhelpful "Array buffer allocation failed", so we
 * fail fast with guidance instead.
 */
export const MAX_IMPORT_FILE_BYTES = 350 * 1024 * 1024;

/**
 * True when an error is really a browser out-of-memory / allocation failure
 * rather than a genuine format problem with the uploaded file.
 */
export function isImportMemoryError(err: any): boolean {
  const msg = String(err?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('array buffer allocation failed') ||
    msg.includes('allocation failed') ||
    msg.includes('out of memory') ||
    msg.includes('memory limit') ||
    msg.includes('failed to allocate')
  );
}

export const IMPORT_MEMORY_ERROR_MESSAGE =
  'The browser ran out of memory while importing this file. The dataset is too large to load in one pass — clip it to a single district (or fewer features) and re-export, then upload the smaller file.';

function isWorkerParseSupported(name: string): boolean {
  return WORKER_PARSE_EXT.test(name) && typeof Worker !== 'undefined';
}

let importWorker: Worker | null = null;
let importWorkerCount = 0;

function getImportWorker(): Worker | null {
  if (importWorker) return importWorker;
  try {
    importWorker = new Worker(new URL('../workers/gisImport.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    importWorker = null;
  }
  return importWorker;
}

function parseInline(
  file: File,
  onProgress?: (stage: string) => void,
  onTransport?: (mode: 'worker' | 'inline') => void
): Promise<GisImportResult> {
  onTransport?.('inline');
  const warnings: string[] = [];
  return decodeSpatialFile(file, warnings, onProgress, { cooperative: true }).then(({ geojson, format }) =>
    buildImportResult(geojson, format, file.name, warnings, onProgress)
  );
}

async function parseInWorker(
  file: File,
  onProgress?: (stage: string) => void,
  districtsGeo?: any,
  onTransport?: (mode: 'worker' | 'inline') => void
): Promise<GisImportResult> {
  const worker = getImportWorker();
  if (!worker) {
    if (GIS_IMPORT_DEBUG) console.warn('[gisImport] Web Worker unavailable — parsing on the UI thread.');
    return parseInline(file, onProgress, onTransport);
  }
  onTransport?.('worker');
  const target = worker;
  return new Promise<GisImportResult>((resolve, reject) => {
    const id = ++importWorkerCount;
    const onMessage = (event: MessageEvent<GisImportWorkerResponse>) => {
      if (!event.data || event.data.id !== id) return;
      // Live stage updates from the worker never resolve the import promise.
      if (event.data.status === 'progress') {
        onProgress?.(event.data.stage);
        return;
      }
      cleanup();
      if (event.data.status === 'ok') {
        if (event.data.result) {
          resolve(event.data.result);
        } else {
          reject(new Error('Failed to parse the GIS file in the background worker.'));
        }
      } else {
        reject(new Error(event.data.error || 'Failed to parse the GIS file in the background worker.'));
      }
    };
    const onError = (err: ErrorEvent) => {
      cleanup();
      reject(new Error(err.message || 'Failed to parse the GIS file in the background worker.'));
    };
    function cleanup() {
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
    }
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);
    target.postMessage({ id, file, districtsGeo });
  });
}

/**
 * Universal spatial GIS file parser supporting GeoJSON, KML, KMZ, Shapefile
 * (zip or standalone), GPX, and CSV.
 *
 * Large non-XML datasets (GeoJSON, CSV, Shapefile, and .zip archives that
 * contain a .shp) are parsed in a dedicated Web Worker so the UI never freezes
 * while the file is decoded — INCLUDING the region-aware clip: when
 * `districtsGeo` is supplied, the worker also performs the bbox gate, the
 * polygon clip, and all clipped statistics (`result.regionClip`) off the UI
 * thread. XML formats (KML/KMZ/GPX) always run inline because DOMParser is not
 * available in workers; zipped archives that contain KML/KMZ start in the
 * worker but fall back to inline automatically when the worker reports the
 * XML-unavailable error. Inline parsing is also used as a fallback when
 * workers are unavailable (e.g. tests, older browsers, or strict CSP).
 *
 * `onProgress` receives human-readable stage labels (e.g. "Reading file…",
 * "Extracting archive…") as the import advances, on both the worker and the
 * inline path, so the UI can show live status while a large dataset loads.
 */
const GIS_IMPORT_DEBUG = typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;

export async function parseGisImportFile(
  file: File,
  onProgress?: (stage: string) => void,
  districtsGeo?: any,
  onTransport?: (mode: 'worker' | 'inline') => void
): Promise<GisImportResult> {
  const t0 = performance.now();
  if (GIS_IMPORT_DEBUG) {
    console.info(
      `[gisImport] start ${file.name} ${(file.size / 1024 / 1024).toFixed(1)} MB ` +
        (districtsGeo ? '(worker clip=on)' : '(clip=off)')
    );
  }
  if (!isWorkerParseSupported(file.name)) {
    if (GIS_IMPORT_DEBUG) console.warn(`[gisImport] inline (${file.name} not worker-routable)`);
    return parseInline(file, onProgress, onTransport);
  }
  try {
    const result = await parseInWorker(file, onProgress, districtsGeo, onTransport);
    if (GIS_IMPORT_DEBUG) {
      console.info(
        `[gisImport] worker ok ${file.name} in ${((performance.now() - t0) / 1000).toFixed(1)}s ` +
          `${result.featureCount.toLocaleString()} features` +
          (result.geometryBytes ? ` ${(result.geometryBytes / 1048576).toFixed(1)} MB geojson` : '')
      );
    }
    return result;
  } catch (err) {
    // Workers have no DOMParser, so archives that contain KML/KMZ cannot be
    // decoded off the UI thread. Only those fall back inline — a .zip holding
    // a .shp parses fully in the worker and never reaches this branch.
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (message.includes('XML parsing is unavailable')) {
      if (GIS_IMPORT_DEBUG) console.warn(`[gisImport] XML-unavailable → inline fallback ${file.name}`);
      return parseInline(file, onProgress, onTransport);
    }
    throw err;
  }
}
