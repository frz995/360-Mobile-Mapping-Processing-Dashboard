/**
 * Dedicated module worker: decodes uploaded GIS files (GeoJSON, CSV, and
 * standalone Shapefile) off the main thread so large uploads never freeze the
 * UI. KML/KMZ/GPX and zipped archives still run inline because they need
 * DOMParser, which Web Workers do not provide.
 *
 * The decode + analyze pipeline is shared with the inline path — this worker
 * only posts the `File` across, streams back live progress stages, and returns
 * a structured-clone of the result with error messages identical to the
 * main-thread parser.
 */
import {
  decodeSpatialFile,
  buildImportResult,
  analyzeImportGeometry,
  estimateGeometryBytes,
  type GisImportResult
} from '../utils/gisImportParser';
import { bboxExceedsRegion, clipGeoJsonToRegions } from '../utils/subgridComparison';

export interface GisImportWorkerRequest {
  id: number;
  file: File;
  /** Selected district geometry for the region-aware clip (FeatureCollection). */
  districtsGeo?: any;
}

export type GisImportWorkerResponse =
  | { id: number; status: 'progress'; stage: string }
  | { id: number; status: 'ok'; result: GisImportResult }
  | { id: number; status: 'error'; error: string };

const post = (message: GisImportWorkerResponse): void => {
  (self as unknown as { postMessage(message: GisImportWorkerResponse): void }).postMessage(message);
};

self.onmessage = async (event: MessageEvent<GisImportWorkerRequest>) => {
  const { id, file, districtsGeo } = event.data;
  const emit = (stage: string) => post({ id, status: 'progress', stage });
  try {
    const warnings: string[] = [];
    const { geojson, format } = await decodeSpatialFile(file, warnings, emit);
    const result = buildImportResult(geojson, format, file.name, warnings, emit);

    // Region-aware clip: decide + perform the polygon clip here, off the UI
    // thread. The dataset is already in this worker's memory, so the bbox gate
    // (cheap, no tree walk) plus the boundary-following clip never touch the
    // main thread. The panel just consumes result.regionClip to show the
    // Original-vs-Clipped preview and to import.
    if (districtsGeo && bboxExceedsRegion(result.bbox, districtsGeo)) {
      emit('Clipping to selected district…');
      const fc = clipGeoJsonToRegions(result.geojson, districtsGeo);
      const clipStats = analyzeImportGeometry(fc);
      result.regionClip = {
        fc,
        featureCount: Array.isArray(fc?.features) ? fc.features.length : 0,
        geometryType: clipStats.geometryType,
        bbox: clipStats.bbox,
        hasRoadLines: clipStats.lineCount > 0,
        lineCount: clipStats.lineCount,
        totalDistanceKm: clipStats.totalDistanceKm,
        geometryBytes: estimateGeometryBytes(fc),
        originalFeatureCount: result.featureCount
      };
    } else {
      result.regionClip = null;
    }

    post({ id, status: 'ok', result });
  } catch (err: any) {
    post({ id, status: 'error', error: err?.message || String(err) });
  }
};