// =====================================================================
// Road-line extraction service (Option A: client + cropper).
//
// The dashboard acts as a client for an external road-data / extraction
// service. It sends the selected district's bounding box, receives real
// road polylines (OSM/Overpass by default), and returns them for the
// workspace to clip to the exact district geometry and render.
//
// Providers are behind a small adapter interface so a hosted ML road
// extractor can be plugged in later with a one-file swap + an env change:
//   VITE_ROAD_EXTRACTION_ROUTE : 'overpass' (default) | 'custom'
//   VITE_ROAD_EXTRACTION_URL   : Overpass endpoint (default overpass-api.de)
//   VITE_ROAD_EXTRACTION_KEY   : optional API key for non-default providers
// =====================================================================

export interface RoadExtractionBBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** A road line as a list of [lng, lat] coordinates plus optional tags. */
export interface ExtractedRoadLine {
  id?: string;
  coordinates: Array<[number, number]>;
  highway?: string;
  name?: string;
}

export interface RoadExtractionResult {
  /** Provider human-readable name, e.g. "OSM / Overpass". */
  source: string;
  /** ISO timestamp of the extraction, or null when none. */
  timestamp: string | null;
  lines: ExtractedRoadLine[];
}

export interface RoadExtractionAdapter {
  name: string;
  extract(bbox: RoadExtractionBBox): Promise<RoadExtractionResult>;
}

interface OverpassElement {
  type: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

function bboxToString(b: RoadExtractionBBox): string {
  return `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`;
}

/** Highway values that represent drivable/street roads (exclude paths, etc.). */
const DRIVABLE_HIGHWAY = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'service', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'living_street', 'road'
]);

function isDrivable(tags?: Record<string, string>): boolean {
  if (!tags) return true;
  const h = (tags.highway || '').toLowerCase();
  if (!h) return false;
  return DRIVABLE_HIGHWAY.has(h);
}

/**
 * OSM / Overpass provider. Free, no credentials, returns the real road
 * network for the requested bounding box. Response elements are decoded
 * into road lines; only drivable highway ways are kept.
 */
const overpassAdapter: RoadExtractionAdapter = {
  name: 'OSM / Overpass',
  async extract(bbox): Promise<RoadExtractionResult> {
    const url = import.meta.env.VITE_ROAD_EXTRACTION_URL || 'https://overpass-api.de/api/interpreter';
    const query = [
      '[out:json][timeout:30];',
      `(way["highway"](${bboxToString(bbox)}););`,
      'out geom;'
    ].join('');

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query)
      });
    } catch (err) {
      throw new Error(`Road extraction unreachable (${url}): ${String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`Road extraction failed (${res.status} ${res.statusText}).`);
    }

    const payload: any = await res.json().catch(() => null);
    const elements: OverpassElement[] =
      payload && Array.isArray(payload.elements) ? payload.elements : [];

    const lines: ExtractedRoadLine[] = [];
    for (const el of elements) {
      if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
      if (!isDrivable(el.tags)) continue;
      const coords: Array<[number, number]> = [];
      for (const g of el.geometry) {
        const lng = Number(g?.lon);
        const lat = Number(g?.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        coords.push([lng, lat]);
      }
      if (coords.length < 2) continue;
      lines.push({
        id: el.id != null ? `overpass-${el.id}` : undefined,
        coordinates: coords,
        highway: el.tags?.highway,
        name: el.tags?.name
      });
    }

    return {
      source: this.name,
      timestamp: new Date().toISOString(),
      lines
    };
  }
};

/** Resolve the active adapter from env; default is Overpass. */
export function getRoadExtractionAdapter(): RoadExtractionAdapter {
  const route = (import.meta.env.VITE_ROAD_EXTRACTION_ROUTE || 'overpass').toLowerCase();
  if (route === 'overpass') return overpassAdapter;
  // Future: register custom adapters here keyed by route name.
  return overpassAdapter;
}
