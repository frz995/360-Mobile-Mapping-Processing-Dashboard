// =====================================================================
// Project Explorer Spatial Geometry & Urban Density Calculations
// Supports:
// - Buffer circle polygon & inverted mask generation (dim outside / bright inside)
// - Road network density (km/km²) and classification (High Complex Urban vs Normal)
// - Panotrack survey data density (panoramas / km²)
// - Atlas.co choropleth sequential color palettes
// =====================================================================

import type { LonLat } from './roadNetworkTrace';
import { getCatalogLayerFeatures, getGeometryBbox } from './subgridComparison';

export type ExplorerChoroplethPalette =
  | 'greens'
  | 'purples'
  | 'ylgnbu'
  | 'oranges'
  | 'blues'
  | 'teal'
  | 'viridis'
  | 'magma'
  | 'pastel';

export interface PaletteStep {
  stop: number; // 0 to 1
  color: string;
}

export interface AtlasPaletteConfig {
  id: ExplorerChoroplethPalette;
  name: string;
  description: string;
  gradientCss: string;
  stops: PaletteStep[];
}

/**
 * 5-Category Sequential Choropleth Color Scales (ColorBrewer & Cartographic Standard):
 * - Greens: Sequential Greens (Pale Mint → Sage → Emerald → Forest → Deep Green)
 * - Purples: Sequential Purples (Lavender Tint → Soft Violet → Lilac → Purple → Deep Violet)
 * - YlGnBu: Sequential Teal-Blue (Pale Lime → Mint → Cyan → Blue → Deep Navy)
 * - Oranges: Sequential Warm (Pale Cream → Amber → Tangerine → Carmine → Dark Crimson)
 * - Blues: Sequential Blues (Ice Blue → Sky → Cornflower → Royal Blue → Deep Navy)
 * - Teal: Sequential PuBuGn (Pale Pearl → Aqua Gray → Seafoam → Ocean Teal → Dark Teal)
 * - Viridis, Magma, Pastel: High-contrast 5-step sequential ramps
 */
export const ATLAS_PALETTES: Record<ExplorerChoroplethPalette, AtlasPaletteConfig> = {
  greens: {
    id: 'greens',
    name: 'Sequential Greens',
    description: '5-class sequential green spectrum (Pale Mint → Sage → Emerald → Forest → Deep Green)',
    gradientCss: 'linear-gradient(90deg, #edf8e9 0%, #bae4b3 25%, #74c476 50%, #31a354 75%, #006d2c 100%)',
    stops: [
      { stop: 0.0, color: '#edf8e9' },
      { stop: 0.25, color: '#bae4b3' },
      { stop: 0.5, color: '#74c476' },
      { stop: 0.75, color: '#31a354' },
      { stop: 1.0, color: '#006d2c' }
    ]
  },
  purples: {
    id: 'purples',
    name: 'Sequential Purples',
    description: '5-class sequential purple spectrum (Lavender Tint → Soft Violet → Lilac → Purple → Deep Violet)',
    gradientCss: 'linear-gradient(90deg, #f2f0f7 0%, #cbc9e2 25%, #9e9ac8 50%, #756bb1 75%, #54278f 100%)',
    stops: [
      { stop: 0.0, color: '#f2f0f7' },
      { stop: 0.25, color: '#cbc9e2' },
      { stop: 0.5, color: '#9e9ac8' },
      { stop: 0.75, color: '#756bb1' },
      { stop: 1.0, color: '#54278f' }
    ]
  },
  ylgnbu: {
    id: 'ylgnbu',
    name: 'Sequential Teal-Blue (YlGnBu)',
    description: '5-class sequential yellow-green to blue spectrum (Pale Lime → Mint → Cyan → Blue → Deep Navy)',
    gradientCss: 'linear-gradient(90deg, #ffffcc 0%, #a1dab4 25%, #41b6c4 50%, #2c7fb8 75%, #253494 100%)',
    stops: [
      { stop: 0.0, color: '#ffffcc' },
      { stop: 0.25, color: '#a1dab4' },
      { stop: 0.5, color: '#41b6c4' },
      { stop: 0.75, color: '#2c7fb8' },
      { stop: 1.0, color: '#253494' }
    ]
  },
  oranges: {
    id: 'oranges',
    name: 'Sequential Oranges (YlOrRd)',
    description: '5-class sequential warm spectrum (Pale Cream → Amber → Tangerine → Carmine → Dark Crimson)',
    gradientCss: 'linear-gradient(90deg, #ffffb2 0%, #fecc5c 25%, #fd8d3c 50%, #f03b20 75%, #bd0026 100%)',
    stops: [
      { stop: 0.0, color: '#ffffb2' },
      { stop: 0.25, color: '#fecc5c' },
      { stop: 0.5, color: '#fd8d3c' },
      { stop: 0.75, color: '#f03b20' },
      { stop: 1.0, color: '#bd0026' }
    ]
  },
  blues: {
    id: 'blues',
    name: 'Sequential Blues',
    description: '5-class sequential blue spectrum (Ice Blue → Sky → Cornflower → Royal Blue → Deep Navy)',
    gradientCss: 'linear-gradient(90deg, #eff3ff 0%, #bdd7e7 25%, #6baed6 50%, #3182bd 75%, #08519c 100%)',
    stops: [
      { stop: 0.0, color: '#eff3ff' },
      { stop: 0.25, color: '#bdd7e7' },
      { stop: 0.5, color: '#6baed6' },
      { stop: 0.75, color: '#3182bd' },
      { stop: 1.0, color: '#08519c' }
    ]
  },
  teal: {
    id: 'teal',
    name: 'Sequential Teal (PuBuGn)',
    description: '5-class sequential teal spectrum (Pale Pearl → Aqua Gray → Seafoam → Ocean Teal → Dark Teal)',
    gradientCss: 'linear-gradient(90deg, #f6eff7 0%, #bdc9e1 25%, #67a9cf 50%, #1c9099 75%, #016c59 100%)',
    stops: [
      { stop: 0.0, color: '#f6eff7' },
      { stop: 0.25, color: '#bdc9e1' },
      { stop: 0.5, color: '#67a9cf' },
      { stop: 0.75, color: '#1c9099' },
      { stop: 1.0, color: '#016c59' }
    ]
  },
  viridis: {
    id: 'viridis',
    name: 'Viridis',
    description: '5-class perceptually uniform spectrum (Indigo → Blue → Teal → Green → Yellow)',
    gradientCss: 'linear-gradient(90deg, #440154 0%, #3b528b 25%, #21918c 50%, #5ec962 75%, #fde725 100%)',
    stops: [
      { stop: 0.0, color: '#440154' },
      { stop: 0.25, color: '#3b528b' },
      { stop: 0.5, color: '#21918c' },
      { stop: 0.75, color: '#5ec962' },
      { stop: 1.0, color: '#fde725' }
    ]
  },
  magma: {
    id: 'magma',
    name: 'Magma',
    description: '5-class thermal sequential spectrum (Midnight Violet → Magenta → Coral → Gold → Light Peach)',
    gradientCss: 'linear-gradient(90deg, #3b0f70 0%, #8c2981 25%, #de4968 50%, #fe9f6d 75%, #fcfdbf 100%)',
    stops: [
      { stop: 0.0, color: '#3b0f70' },
      { stop: 0.25, color: '#8c2981' },
      { stop: 0.5, color: '#de4968' },
      { stop: 0.75, color: '#fe9f6d' },
      { stop: 1.0, color: '#fcfdbf' }
    ]
  },
  pastel: {
    id: 'pastel',
    name: 'Pastel',
    description: '5-class curated pastel spectrum (Deep Navy → Indigo → Cobalt → Rose → Peach)',
    gradientCss: 'linear-gradient(90deg, #0b0151 0%, #1d1c8c 25%, #5573eb 50%, #ff8890 75%, #fdc094 100%)',
    stops: [
      { stop: 0.0, color: '#0b0151' },
      { stop: 0.25, color: '#1d1c8c' },
      { stop: 0.5, color: '#5573eb' },
      { stop: 0.75, color: '#ff8890' },
      { stop: 1.0, color: '#fdc094' }
    ]
  }
};

/**
 * Calculates great-circle Haversine distance in meters between two [lon, lat] coordinates.
 */
export function haversineMeters(p1: [number, number], p2: [number, number]): number {
  const R = 6371000; // Earth's mean radius in meters
  const dLat = ((p2[1] - p1[1]) * Math.PI) / 180;
  const dLon = ((p2[0] - p1[0]) * Math.PI) / 180;
  const lat1 = (p1[1] * Math.PI) / 180;
  const lat2 = (p2[1] * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Generates an array of [lon, lat] coordinates forming a geodesic circle.
 */
export function createCircleCoords(
  center: [number, number],
  radiusMeters: number,
  steps = 64
): [number, number][] {
  const coords: [number, number][] = [];
  const [lon, lat] = center;
  const d = radiusMeters / 6371000;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;

  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 2 * Math.PI) / steps;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(bearing)
    );
    const pLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
        Math.cos(d) - Math.sin(latRad) * Math.sin(pLat)
      );
    coords.push([(pLon * 180) / Math.PI, (pLat * 180) / Math.PI]);
  }
  return coords;
}

/**
 * Creates an inverted mask polygon covering the globe with circular holes.
 * Outside is filled with dark dimming; inside each circle is clear and bright.
 * Supports a single center or multiple centers (for Compare Mode).
 */
export function createInvertedMaskGeoJson(
  centerOrCenters: [number, number] | Array<[number, number]>,
  radii: number | number[],
  steps = 64
): GeoJSON.FeatureCollection {
  const centers: Array<[number, number]> =
    Array.isArray(centerOrCenters[0])
      ? (centerOrCenters as Array<[number, number]>)
      : [centerOrCenters as [number, number]];

  const outerRing: [number, number][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85]
  ];

  const holes: [number, number][][] = centers.map((c, idx) => {
    const r = Array.isArray(radii) ? (radii[idx] ?? radii[0]) : radii;
    return createCircleCoords(c, r, steps);
  });

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [outerRing, ...holes]
        }
      }
    ]
  };
}

/**
 * Creates an inverted mask polygon covering the globe with polygon hole(s).
 * Outside is filled with dark dimming; inside the selected grid cell polygon is clear and bright.
 */
export function createInvertedPolygonMaskGeoJson(
  rings: [number, number][][]
): GeoJSON.FeatureCollection {
  const outerRing: [number, number][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85]
  ];

  if (!rings || rings.length === 0) {
    return {
      type: 'FeatureCollection',
      features: []
    };
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [outerRing, ...rings]
        }
      }
    ]
  };
}

/**
 * Creates a LineString feature collection outlining a polygon's exterior rings.
 */
export function createPolygonOutlineGeoJson(
  rings: [number, number][][]
): GeoJSON.FeatureCollection {
  if (!rings || rings.length === 0) {
    return {
      type: 'FeatureCollection',
      features: []
    };
  }

  return {
    type: 'FeatureCollection',
    features: rings.map((ring, idx) => ({
      type: 'Feature',
      properties: { ringIndex: idx },
      geometry: {
        type: 'LineString',
        coordinates: ring
      }
    }))
  };
}

/**
 * Creates a LineString feature collection for circular buffer perimeter lines.
 * Supports single center or multiple centers (for Compare Mode Pin A / Pin B).
 */
export function createCircleOutlineGeoJson(
  centerOrCenters: [number, number] | Array<[number, number]>,
  radii: number | number[],
  steps = 64
): GeoJSON.FeatureCollection {
  const centers: Array<[number, number]> =
    Array.isArray(centerOrCenters[0])
      ? (centerOrCenters as Array<[number, number]>)
      : [centerOrCenters as [number, number]];

  return {
    type: 'FeatureCollection',
    features: centers.map((c, idx) => {
      const r = Array.isArray(radii) ? (radii[idx] ?? radii[0]) : radii;
      const circle = createCircleCoords(c, r, steps);
      return {
        type: 'Feature',
        properties: { radius: r, pinIndex: idx, label: idx === 0 ? 'A' : 'B' },
        geometry: {
          type: 'LineString',
          coordinates: circle
        }
      };
    })
  };
}

export type UrbanDensityClassification = 'High Complex Urban' | 'Moderate Suburban' | 'Normal / Arterial Rural';

export interface DemographicComposition {
  complexIntersectionsPct: number;
  arterialCorridorsPct: number;
  residentialStreetsPct: number;
  serviceConnectorsPct: number;
  urbanDensityScore: number; // 0 - 100
  estimatedStructuresCount: number;
}

export interface RoadCorridorBreakdown {
  shortPct: number;
  mediumPct: number;
  arterialPct: number;
  trunkPct: number;
  radialCorePct: number;
  radialInnerPct: number;
  radialMidPct: number;
  radialOuterPct: number;
}

export interface DensityBreakdown {
  highDensityPct: number;
  medDensityPct: number;
  lowDensityPct: number;
}

export interface ComplexityBreakdown {
  fourWayPct: number;
  threeWayPct: number;
  multiWayPct: number;
  deadEndPct: number;
  urbanScore: number;
  gridRatio: number;
  nodeDensityPct: number;
}

export interface PanotrackBreakdown {
  verifiedPct: number;
  defectPct: number;
  transitPct: number;
  mismatchPct: number;
  radialCorePct: number;
  radialInnerPct: number;
  radialMidPct: number;
  radialOuterPct: number;
}

export interface BufferAnalytics {
  radiusMeters: number;
  areaKm2: number;
  roadLengthKm: number;
  roadDensityKmPerKm2: number;
  roadSegmentsCount: number;
  intersectionCount: number;
  intersectionDensityPerKm2: number;
  panoCount: number;
  panoDensityPerKm2: number;
  capturedTrackKm: number;
  capturedTracksCount: number;
  uncoveredGapKm: number;
  coveragePercent: number;
  averageFrameIntervalMeters: number;
  coverageGrade: string;
  urbanClassification: UrbanDensityClassification;
  isHighComplexUrban: boolean;
  roadsBreakdown: RoadCorridorBreakdown;
  densityBreakdown: DensityBreakdown;
  complexityBreakdown: ComplexityBreakdown;
  panotrackBreakdown: PanotrackBreakdown;
  demographic: DemographicComposition;
  clippedRoadsGeojson: GeoJSON.FeatureCollection;
}

export function getDensityChoroplethColor(
  density: number,
  palette: ExplorerChoroplethPalette = 'greens'
): string {
  const cfg = ATLAS_PALETTES[palette] || ATLAS_PALETTES.greens;
  const stops = cfg.stops;
  if (density < 1.5) return stops[0]?.color || '#edf8e9';
  if (density < 3.5) return stops[1]?.color || '#bae4b3';
  if (density < 6.0) return stops[2]?.color || '#74c476';
  if (density < 9.0) return stops[3]?.color || '#31a354';
  return stops[4]?.color || '#006d2c';
}


/**
 * Converts a hex color string to rgba format with the given alpha value.
 */
export function hexToRgba(hex: string, alpha = 0.35): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16) || 0;
  const g = parseInt(c.substring(2, 4), 16) || 0;
  const b = parseInt(c.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Generates a MapLibre GL stepped expression for road LineStrings mapping
 * numeric density to 5 discrete sequential categories.
 */
export function buildMaplibreChoroplethExpression(
  palette: ExplorerChoroplethPalette = 'greens',
  property = 'density'
): any[] {
  const cfg = ATLAS_PALETTES[palette] || ATLAS_PALETTES.greens;
  const stops = cfg.stops;
  const thresholds = [1.5, 3.5, 6.0, 9.0];

  return [
    'step',
    ['coalesce', ['get', property], 0],
    stops[0]?.color || '#edf8e9',
    thresholds[0], stops[1]?.color || '#bae4b3',
    thresholds[1], stops[2]?.color || '#74c476',
    thresholds[2], stops[3]?.color || '#31a354',
    thresholds[3], stops[4]?.color || '#006d2c'
  ];
}

/**
 * Generates a MapLibre GL stepped expression for mesh polygon fills with 5 discrete sequential categories.
 * Maps values into 5 distinct sequential classes from lowest to highest.
 * Empty cells (value <= 0) evaluate to completely transparent rgba(0, 0, 0, 0), ensuring choropleth
 * styling colors strictly on active grid boxes and never blankets empty district areas.
 */
/**
 * @deprecated Prefer `buildMeshExpression` from `./choroplethSettings`, which
 * reads the operator's saved class breaks instead of the fixed thresholds
 * below. Retained for callers that have no access to a saved setting.
 */
export function buildMaplibreChoroplethMeshExpression(
  palette: ExplorerChoroplethPalette = 'greens',
  property = 'density',
  alpha = 0.85
): any[] {
  const cfg = ATLAS_PALETTES[palette] || ATLAS_PALETTES.greens;
  const stops = cfg.stops;

  // Thresholds separating the 5 sequential categories. These now mirror
  // DEFAULT_METRIC_BREAKS in ./choroplethSettings.
  let thresholds: [number, number, number, number];
  switch (property) {
    case 'complexity':
      // 5 categories: Very Low (0-20), Low (20-40), Moderate (40-60), High (60-80), Very High (80-100)
      thresholds = [20, 40, 60, 80];
      break;
    case 'panotrack':
      // 5 categories: Trace (1-15), Low (15-45), Moderate (45-90), High (90-180), Very High (180+)
      thresholds = [15, 45, 90, 180];
      break;
    case 'roads':
      // 5 categories: Short (0-5), Medium (5-15), Arterial (15-30), Primary (30-50), Highway/Major (50+)
      thresholds = [5, 15, 30, 50];
      break;
    case 'coverage':
      // 5 categories: Minimal (0-20%), Partial (20-40%), Half (40-60%), Substantial (60-80%), Complete (80-100%)
      thresholds = [20, 40, 60, 80];
      break;
    case 'density':
    default:
      // 5 categories: Rural/Sparse (<1.5), Light Suburban (1.5-3.5), Moderate Urban (3.5-6.0), Dense Urban (6.0-9.0), Core Urban (≥9.0)
      thresholds = [1.5, 3.5, 6.0, 9.0];
      break;
  }

  const c1 = hexToRgba(stops[0]?.color || '#edf8e9', alpha);
  const c2 = hexToRgba(stops[1]?.color || '#bae4b3', alpha);
  const c3 = hexToRgba(stops[2]?.color || '#74c476', alpha);
  const c4 = hexToRgba(stops[3]?.color || '#31a354', alpha);
  const c5 = hexToRgba(stops[4]?.color || '#006d2c', alpha);

  const stepExpr: any[] = [
    'step',
    ['coalesce', ['get', property], 0],
    c1,
    thresholds[0], c2,
    thresholds[1], c3,
    thresholds[2], c4,
    thresholds[3], c5
  ];

  return [
    'case',
    ['<=', ['coalesce', ['get', property], 0], 0],
    'rgba(0, 0, 0, 0)',
    stepExpr
  ];
}

/**
 * Sutherland-Hodgman polygon clipping algorithm: clips a closed 2D polygon ring
 * to an axis-aligned bounding box [minX, minY, maxX, maxY].
 */
export function clipPolygonRingToBbox(
  ring: [number, number][],
  bbox: [number, number, number, number]
): [number, number][] {
  const [minX, minY, maxX, maxY] = bbox;
  const clipEdge = (
    pts: [number, number][],
    inside: (p: [number, number]) => boolean,
    intersect: (p1: [number, number], p2: [number, number]) => [number, number]
  ): [number, number][] => {
    const out: [number, number][] = [];
    if (pts.length === 0) return out;
    let prev = pts[pts.length - 1];
    let prevIn = inside(prev);
    for (const cur of pts) {
      const curIn = inside(cur);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
      prev = cur;
      prevIn = curIn;
    }
    return out;
  };

  let pts = ring.slice();
  if (
    pts.length >= 2 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
  ) {
    pts.pop();
  }

  // Clip against 4 bounding edges
  pts = clipEdge(
    pts,
    (p) => p[0] >= minX,
    (p1, p2) => [minX, p1[1] + ((p2[1] - p1[1]) * (minX - p1[0])) / (p2[0] - p1[0] || 1e-12)]
  );
  pts = clipEdge(
    pts,
    (p) => p[0] <= maxX,
    (p1, p2) => [maxX, p1[1] + ((p2[1] - p1[1]) * (maxX - p1[0])) / (p2[0] - p1[0] || 1e-12)]
  );
  pts = clipEdge(
    pts,
    (p) => p[1] >= minY,
    (p1, p2) => [p1[0] + ((p2[0] - p1[0]) * (minY - p1[1])) / (p2[1] - p1[1] || 1e-12), minY]
  );
  pts = clipEdge(
    pts,
    (p) => p[1] <= maxY,
    (p1, p2) => [p1[0] + ((p2[0] - p1[0]) * (maxY - p1[1])) / (p2[1] - p1[1] || 1e-12), maxY]
  );

  if (pts.length >= 3) {
    pts.push([pts[0][0], pts[0][1]]);
    return pts;
  }
  return [];
}

/** Point-in-polygon test (ray casting). Point = [lng, lat]. */
export function isPointInPolygonRing(point: [number, number], ring: [number, number][]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Clips district boundary geometry to a cell bounding box.
 * Returns closed polygon rings strictly confined inside both the district boundary
 * and the cell bounding box, ensuring choropleth styling perfectly follows the district boundary.
 */
export function clipDistrictToCellBbox(
  districtGeojson: any,
  bbox: [number, number, number, number]
): [number, number][][] {
  const [minX, minY, maxX, maxY] = bbox;
  const fullCellRect: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY]
  ];

  if (!districtGeojson) {
    return [fullCellRect];
  }

  const ringsToProcess: [number, number][][] = [];
  const handleGeom = (g: any) => {
    if (!g) return;
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      if (Array.isArray(g.coordinates[0])) ringsToProcess.push(g.coordinates[0]);
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      g.coordinates.forEach((poly: any) => {
        if (Array.isArray(poly) && Array.isArray(poly[0])) ringsToProcess.push(poly[0]);
      });
    }
  };

  if (districtGeojson.type === 'FeatureCollection' && Array.isArray(districtGeojson.features)) {
    districtGeojson.features.forEach((f: any) => handleGeom(f?.geometry));
  } else if (districtGeojson.type === 'Feature') {
    handleGeom(districtGeojson.geometry);
  } else {
    handleGeom(districtGeojson);
  }

  if (ringsToProcess.length === 0) {
    return [fullCellRect];
  }

  const mid: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const corners: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY]
  ];

  const midInside = ringsToProcess.some((ring) => isPointInPolygonRing(mid, ring));
  const cornersInside = corners.filter((c) => ringsToProcess.some((ring) => isPointInPolygonRing(c, ring))).length;

  // Fully interior cell (center + all corners inside) -> keep whole clean rectangular cell
  if (midInside && cornersInside === 4) {
    return [fullCellRect];
  }

  // Boundary cell: clip district boundary ring to bbox
  const resultRings: [number, number][][] = [];
  for (const ring of ringsToProcess) {
    const clipped = clipPolygonRingToBbox(ring, bbox);
    if (clipped.length >= 4) {
      resultRings.push(clipped);
    }
  }

  if (resultRings.length > 0) {
    return resultRings;
  }

  // Fallback if interior cell but polygon vertices didn't touch bbox edges
  if (midInside || cornersInside >= 2) {
    return [fullCellRect];
  }

  // Outside district boundary
  return [];
}

/**
 * Calculates the exact geodesic length in meters of a road line segment [p1, p2]
 * clipped within a 2D bounding box [minX, minY, maxX, maxY].
 */
export function segmentLengthInBbox(
  p1: [number, number],
  p2: [number, number],
  bbox: [number, number, number, number]
): number {
  const [minX, minY, maxX, maxY] = bbox;
  const in1 = p1[0] >= minX && p1[0] <= maxX && p1[1] >= minY && p1[1] <= maxY;
  const in2 = p2[0] >= minX && p2[0] <= maxX && p2[1] >= minY && p2[1] <= maxY;

  // Fully inside
  if (in1 && in2) {
    return haversineMeters(p1, p2);
  }

  // Trivial rejection if both points are completely on one side
  if (
    (p1[0] < minX && p2[0] < minX) ||
    (p1[0] > maxX && p2[0] > maxX) ||
    (p1[1] < minY && p2[1] < minY) ||
    (p1[1] > maxY && p2[1] > maxY)
  ) {
    return 0;
  }

  // Liang-Barsky parametric line clipping
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  let t0 = 0.0;
  let t1 = 1.0;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      if (q < 0) return false;
      return true;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    clip(-dx, p1[0] - minX) &&
    clip(dx, maxX - p1[0]) &&
    clip(-dy, p1[1] - minY) &&
    clip(dy, maxY - p1[1])
  ) {
    if (t1 > t0) {
      const cp1: [number, number] = [p1[0] + t0 * dx, p1[1] + t0 * dy];
      const cp2: [number, number] = [p1[0] + t1 * dx, p1[1] + t1 * dy];
      return haversineMeters(cp1, cp2);
    }
  }

  return 0;
}

function pointInBbox(pt: [number, number], bbox: [number, number, number, number]): boolean {
  return pt[0] >= bbox[0] && pt[0] <= bbox[2] && pt[1] >= bbox[1] && pt[1] <= bbox[3];
}

/**
 * Checks whether an axis-aligned bounding box [minX, minY, maxX, maxY]
 * intersects the given district geometry (FeatureCollection, Feature, or Geometry).
 */
export function isCellIntersectingDistrict(
  districtGeojson: any,
  bbox: [number, number, number, number]
): boolean {
  if (!districtGeojson) return true;

  const [minX, minY, maxX, maxY] = bbox;
  const mid: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const corners: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY]
  ];

  const ringsToProcess: [number, number][][] = [];
  const handleGeom = (g: any) => {
    if (!g) return;
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
      if (Array.isArray(g.coordinates[0])) ringsToProcess.push(g.coordinates[0]);
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      g.coordinates.forEach((poly: any) => {
        if (Array.isArray(poly) && Array.isArray(poly[0])) ringsToProcess.push(poly[0]);
      });
    }
  };

  if (districtGeojson.type === 'FeatureCollection' && Array.isArray(districtGeojson.features)) {
    districtGeojson.features.forEach((f: any) => handleGeom(f?.geometry));
  } else if (districtGeojson.type === 'Feature') {
    handleGeom(districtGeojson.geometry);
  } else {
    handleGeom(districtGeojson);
  }

  if (ringsToProcess.length === 0) return true;

  for (const ring of ringsToProcess) {
    if (isPointInPolygonRing(mid, ring)) return true;
    for (const c of corners) {
      if (isPointInPolygonRing(c, ring)) return true;
    }
    const clipped = clipPolygonRingToBbox(ring, bbox);
    if (clipped.length >= 3) return true;
  }
  return false;
}

/**
 * Floor on a cell's area, guarding divide-by-zero on degenerate slivers. A cell
 * clamped up to this UNDERSTATES density (larger denominator), so any cell that
 * hits it is reported via `MeshGridInfo.areaFloored`.
 */
const MIN_CELL_AREA_KM2 = 0.5;

/**
 * Where the mesh cells came from, and how big they are.
 *
 * Density (`planKm / areaKm2`) and complexity (`junctions / areaKm2`) are both
 * PER-CELL measures, so halving the cell size roughly doubles density for
 * identical roads. Against the fixed breaks in DEFAULT_METRIC_BREAKS the same
 * physical place therefore classifies differently on a 5x5 grid than on a
 * 10x10 one. That is correct — but only legible if the operator can see the
 * cell size they are reading, which is what this carries.
 */
export interface MeshGridInfo {
  /** 'imported' = the operator's own polygon grid layer; 'derived' = synthetic fallback. */
  source: 'imported' | 'derived';
  cellCount: number;
  /** Representative cell edge length in km. Median for an imported grid. */
  cellKm: number;
  /**
   * True when at least one cell was clamped up to the 0.5 km² area floor. Such
   * cells UNDERSTATE density, because the denominator is inflated. Surfaced so
   * the floor is never a silent bias.
   */
  areaFloored: boolean;
  /** True when the operator declared this size rather than the code measuring it. */
  declared: boolean;
  /** Where `cellKm` came from, so the UI can say so. */
  cellKmSource: 'declared' | 'measured' | 'auto';
}

/**
 * Operator-declared grid geometry.
 *
 * Both fields are optional and independent:
 *  - `derivedCellKm` sets the fallback lattice step when no grid layer is
 *    imported. `null` keeps the built-in auto resolution.
 *  - `importedCellKm` declares the nominal cell size of an imported grid and
 *    becomes the authoritative cell AREA for every cell.
 *
 * The second field is not cosmetic. Survey grids are usually clipped to the
 * district, so an edge cell's measured bbox is a fraction of a real cell. Using
 * that fraction as the denominator makes a half-cell report roughly double the
 * density of an interior cell, which then misclassifies it as denser urban
 * fabric. Declaring the nominal size keeps every cell on one denominator.
 */
export interface ExplorerGridSpec {
  derivedCellKm?: number | null;
  importedCellKm?: number | null;
}

/** Presets offered in the Explorer grid control. */
export const GRID_PRESETS_KM = [
  { label: '2 × 2 km', value: 2 },
  { label: '3.9 × 3.9 km (auto)', value: 3.9 },
  { label: '5 × 5 km', value: 5 },
  { label: '10 × 10 km', value: 10 }
] as const;

/** Accepted range for a custom declared cell size. */
export const GRID_MIN_KM = 0.1;
export const GRID_MAX_KM = 100;

/** Keeps a declared size usable, or null when it is absent / out of range. */
export function sanitizeGridKm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < GRID_MIN_KM || n > GRID_MAX_KM) return null;
  return Number(n.toFixed(2));
}

/**
 * Degrees of longitude/latitude that spans `km` at the given latitude.
 *
 * A degree of longitude shrinks with latitude (cos φ) while a degree of
 * latitude does not, so a single "stepDeg" only yields square ground cells near
 * the equator. The fallback lattice is a regular DEGREE grid (one stepDeg for
 * both axes), so this returns the step that keeps the cells closest to square
 * in real distance for the region's latitude.
 */
export function kmToStepDeg(km: number, latitude: number): number {
  const lat = Number.isFinite(latitude) ? Math.min(85, Math.max(-85, latitude)) : 0;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  // Average the two so neither axis is badly off; the lattice is square in
  // degrees, so the cell is as square as a degree-square allows here.
  const denom = (kmPerDegLat + kmPerDegLng) / 2;
  return denom > 0 ? km / denom : km / kmPerDegLat;
}

export interface MeshRoadChoroplethResult {
  meshGeojson: GeoJSON.FeatureCollection;
  annotatedRoadsGeojson: GeoJSON.FeatureCollection;
  /**
   * The same cells as `meshGeojson`, un-ring-expanded. The Details card
   * aggregates these instead of re-deriving values from GeoJSON properties,
   * so idle means "all cells in the district grid".
   */
  cells: MeshCellData[];
  /** Grid provenance, reported alongside the cells so UI can explain the numbers. */
  grid: MeshGridInfo;
}

/**
 * Builds GeoJSON for:
 * 1. The mesh polygon grid blocks. Each block strictly follows the grid box
 *    (without clipping to curved district boundary lines, ensuring choropleth colors
 *    strictly on grid boxes with no solid district boundary fill).
 *    Bearing road density, urban complexity, Panotrack survey frames, road length, and coverage.
 * 2. Road LineString features annotated with density, complexity, and survey metrics.
 */
/**
 * Road length in a cell, bucketed by corridor class. The boundaries match the
 * ones `calculateBufferAnalytics` uses so a focused cell and a circle buffer
 * classify the same segment into the same bucket.
 */
export interface MeshCorridorBreakdown {
  shortKm: number;
  mediumKm: number;
  arterialKm: number;
  trunkKm: number;
}

/** Junction nodes in a cell, bucketed by the number of ways meeting there. */
export interface MeshJunctionBreakdown {
  deadEnd: number;
  threeWay: number;
  fourWay: number;
  fivePlus: number;
}

/** Panotrack survey frames in a cell, bucketed by capture status. */
export interface MeshFrameBreakdown {
  verified: number;
  defect: number;
  transit: number;
  mismatch: number;
}

export interface MeshCellData {
  subgrid: string;
  bbox: [number, number, number, number];
  planKm: number;
  roads: number;
  density: number;
  complexity: number;
  panotrack: number;
  coverage: number;
  /** Surveyed road length in km. `coverage` is a percentage, so this has to be
   *  derived per cell — summing percentages across cells is meaningless. */
  coverageKm: number;
  areaKm2: number;
  corridor: MeshCorridorBreakdown;
  junctions: MeshJunctionBreakdown;
  frames: MeshFrameBreakdown;
  rings: [number, number][][];
}

/**
 * Bucket a captured survey frame into one of the four capture states the
 * Explorer charts report. Defect wins over transit wins over mismatch, so a
 * flagged frame is never double-counted.
 */
export function classifyFrameStatus(pt: any): keyof MeshFrameBreakdown {
  if (pt?.status === 'defect' || pt?.color === '#ef4444') return 'defect';
  if (pt?.relationType === 'INTERSECT' || pt?.isTransit) return 'transit';
  if (pt?.relationType === 'MISMATCH') return 'mismatch';
  return 'verified';
}

export function buildMeshRoadChoroplethGeojson(
  roadRuns: LonLat[][] = [],
  districtGeojson?: any,
  catalogOrSubgrids?: any[],
  fallbackSubgridMetrics?: any[],
  capturedPoints: any[] = [],
  spec?: ExplorerGridSpec | null
): MeshRoadChoroplethResult {
  // Operator-declared geometry. Invalid or absent values fall back to the
  // built-in behaviour, so an old caller is completely unaffected.
  const declaredDerivedKm = sanitizeGridKm(spec?.derivedCellKm);
  const declaredImportedKm = sanitizeGridKm(spec?.importedCellKm);
  // Every cell is measured against this area instead of its own bbox when the
  // operator declares an imported grid size. `null` keeps per-cell measurement.
  const nominalAreaKm2 =
    declaredImportedKm !== null ? Number((declaredImportedKm * declaredImportedKm).toFixed(2)) : null;
  // Normalize arguments to support both signatures:
  // (roadRuns, districtGeojson, catalogLayers, subgridMetrics, capturedPoints)
  // or (roadRuns, districtGeojson, subgridMetrics)
  let rawLayers = Array.isArray(catalogOrSubgrids) ? catalogOrSubgrids : [];
  let rawMetrics = Array.isArray(fallbackSubgridMetrics) ? fallbackSubgridMetrics : [];
  let rawPoints = Array.isArray(capturedPoints) ? capturedPoints : [];

  // If argument 4 is actually captured points (e.g. array of points with lng/lat)
  if (rawMetrics.length > 0 && (rawMetrics[0]?.lng !== undefined || rawMetrics[0]?.latitude !== undefined || Array.isArray(rawMetrics[0]))) {
    rawPoints = rawMetrics;
    rawMetrics = [];
  }

  // Pre-flatten road segments with AABB and length for ultra-fast spatial intersection
  interface PreSegment {
    p1: [number, number];
    p2: [number, number];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    len: number;
  }
  const preSegments: PreSegment[] = [];
  for (const run of roadRuns) {
    if (!Array.isArray(run) || run.length < 2) continue;
    for (let i = 0; i < run.length - 1; i++) {
      const p1 = run[i];
      const p2 = run[i + 1];
      preSegments.push({
        p1,
        p2,
        minX: Math.min(p1[0], p2[0]),
        maxX: Math.max(p1[0], p2[0]),
        minY: Math.min(p1[1], p2[1]),
        maxY: Math.max(p1[1], p2[1]),
        len: haversineMeters(p1, p2)
      });
    }
  }

  // Pre-filter valid coordinate points, keeping capture status so a cell can
  // report its own frame breakdown instead of a bare count.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type FrameStatus = keyof MeshFrameBreakdown;
  const validPoints: Array<{ lng: number; lat: number; status: FrameStatus }> = [];
  for (const pt of rawPoints) {
    const lng = Array.isArray(pt) ? pt[0] : (pt?.lng ?? pt?.lon ?? pt?.longitude);
    const lat = Array.isArray(pt) ? pt[1] : (pt?.lat ?? pt?.latitude);
    if (typeof lng === 'number' && typeof lat === 'number') {
      validPoints.push({ lng, lat, status: classifyFrameStatus(pt) });
    }
  }

  // Node degree map, built once. Degree is the number of segment ends that land
  // on a coordinate — the same definition `calculateBufferAnalytics` uses to find
  // junctions. Quantising to 4 decimals merges the near-identical coordinates
  // that a track logger emits for one physical intersection.
  const nodeDegrees = new Map<string, { lng: number; lat: number; degree: number }>();
  for (const s of preSegments) {
    for (const p of [s.p1, s.p2]) {
      const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
      const hit = nodeDegrees.get(key);
      if (hit) hit.degree++;
      else nodeDegrees.set(key, { lng: p[0], lat: p[1], degree: 1 });
    }
  }
  const nodeList = [...nodeDegrees.values()];

  const cells: MeshCellData[] = [];

  // Set when any cell's area is clamped up to the floor; reported in `grid`.
  let areaFloored = false;
  // Side of the square cell this build is working at, in km. Recorded so the
  // UI can show cell size for the synthetic branch.
  let derivedCellKm = 0;

  // Helper to compute metrics for a cell
  const computeCellMetrics = (bbox: [number, number, number, number]) => {
    let roadMetersInCell = 0;
    let junctionCount = 0;
    const corridor: MeshCorridorBreakdown = { shortKm: 0, mediumKm: 0, arterialKm: 0, trunkKm: 0 };

    const [bMinX, bMinY, bMaxX, bMaxY] = bbox;
    for (let i = 0; i < preSegments.length; i++) {
      const s = preSegments[i];
      // Fast AABB rejection: 4 float comparisons
      if (s.maxX < bMinX || s.minX > bMaxX || s.maxY < bMinY || s.minY > bMaxY) {
        continue;
      }
      // Fully inside cell
      let segLen = s.len;
      if (s.minX >= bMinX && s.maxX <= bMaxX && s.minY >= bMinY && s.maxY <= bMaxY) {
        roadMetersInCell += s.len;
        junctionCount += 2;
      } else {
        // Partial intersection
        segLen = segmentLengthInBbox(s.p1, s.p2, bbox);
        roadMetersInCell += segLen;
        if (segLen > 0) {
          if (pointInBbox(s.p1, bbox)) junctionCount++;
          if (pointInBbox(s.p2, bbox)) junctionCount++;
        }
      }
      // Corridor length buckets. A segment clipped at the cell edge contributes
      // only its in-cell length, so the buckets still sum to planKm.
      if (segLen > 0) {
        const km = segLen / 1000;
        if (segLen < 150) corridor.shortKm += km;
        else if (segLen < 500) corridor.mediumKm += km;
        else if (segLen < 1200) corridor.arterialKm += km;
        else corridor.trunkKm += km;
      }
    }

    // Junction nodes inside the cell, by degree. Tracked separately from the
    // endpoint tally above, which counts segment ends rather than junctions.
    const junctions: MeshJunctionBreakdown = { deadEnd: 0, threeWay: 0, fourWay: 0, fivePlus: 0 };
    for (let i = 0; i < nodeList.length; i++) {
      const n = nodeList[i];
      if (n.lng < bMinX || n.lng > bMaxX || n.lat < bMinY || n.lat > bMaxY) continue;
      if (n.degree === 1) junctions.deadEnd++;
      else if (n.degree === 3) junctions.threeWay++;
      else if (n.degree === 4) junctions.fourWay++;
      else if (n.degree >= 5) junctions.fivePlus++;
    }

    const planKm = Number((roadMetersInCell / 1000).toFixed(2));
    const widthKm = haversineMeters([bbox[0], bbox[1]], [bbox[2], bbox[1]]) / 1000;
    const heightKm = haversineMeters([bbox[0], bbox[1]], [bbox[0], bbox[3]]) / 1000;
    // Floor guards divide-by-zero on slivers, but it also inflates the
    // denominator and so UNDERSTATES density. Record when it bites.
    const rawAreaKm2 = Number((widthKm * heightKm).toFixed(1));
    // A declared imported-grid size is authoritative: a cell clipped by the
    // district edge is still a real cell, so it must not report a fraction of
    // the nominal area and inflate its own density.
    const areaKm2 = nominalAreaKm2 !== null
      ? nominalAreaKm2
      : Math.max(MIN_CELL_AREA_KM2, rawAreaKm2);
    if (nominalAreaKm2 === null && rawAreaKm2 < MIN_CELL_AREA_KM2) areaFloored = true;
    const density = Number((planKm / areaKm2).toFixed(2));

    // Panotrack survey frames inside cell, split by capture status.
    const frames: MeshFrameBreakdown = { verified: 0, defect: 0, transit: 0, mismatch: 0 };
    let cellPanoCount = 0;
    for (let i = 0; i < validPoints.length; i++) {
      const pt = validPoints[i];
      if (pt.lng >= bMinX && pt.lng <= bMaxX && pt.lat >= bMinY && pt.lat <= bMaxY) {
        cellPanoCount++;
        frames[pt.status]++;
      }
    }

    // Urban complexity index (0 to 100)
    let complexity = 0;
    if (planKm > 0) {
      const densityRatio = Math.min(1, density / 10);
      const nodeDensity = junctionCount / areaKm2;
      complexity = Math.min(100, Math.round(densityRatio * 70 + Math.min(30, (nodeDensity / 15) * 30)));
      if (complexity === 0 && planKm > 0) complexity = 10;
    }

    // Survey network coverage percentage (0 to 100%)
    let coverage = 0;
    if (planKm > 0) {
      if (cellPanoCount > 0) {
        const estCoveredKm = (cellPanoCount * 5) / 1000; // standard ~5m spacing
        coverage = Math.min(100, Math.max(5, Math.round((estCoveredKm / planKm) * 100)));
      }
    } else if (cellPanoCount > 0) {
      coverage = 100;
    }

    return {
      planKm,
      roads: planKm,
      density,
      panotrack: cellPanoCount,
      complexity,
      coverage,
      coverageKm: Number(Math.min(planKm, (planKm * coverage) / 100).toFixed(2)),
      areaKm2,
      corridor: {
        shortKm: Number(corridor.shortKm.toFixed(2)),
        mediumKm: Number(corridor.mediumKm.toFixed(2)),
        arterialKm: Number(corridor.arterialKm.toFixed(2)),
        trunkKm: Number(corridor.trunkKm.toFixed(2))
      },
      junctions,
      frames
    };
  };

  // Branch 1: Check catalog layers for polygon subgrid features (e.g. Grid_5km_tangkak_segamat)
  // If an imported polygon grid layer exists, use ONLY its grid cells — never mix in rawMetrics or fallback grids.
  let foundImportedGrid = false;
  // Representative edge of the imported grid, filled in once a grid layer wins.
  let importedCellKm = 0;
  // True when the size came from the operator rather than from measurement.
  let gridIsDeclared = declaredDerivedKm !== null || declaredImportedKm !== null;
  for (const item of rawLayers) {
    if (!item) continue;
    const feats = getCatalogLayerFeatures(item);
    if (!feats || feats.length === 0) continue;

    const polyFeats = feats.filter((f: any) => {
      const gt = f?.geometry?.type;
      return gt === 'Polygon' || gt === 'MultiPolygon';
    });
    if (polyFeats.length === 0) continue;

    // First pass: collect genuine subgrid polygon features and compute median area
    const validPolyFeats: Array<{ feat: any; geom: any; bbox: [number, number, number, number]; area: number }> = [];
    const areas: number[] = [];

    for (const feat of polyFeats) {
      const geom = feat?.geometry;
      if (!geom) continue;
      const bbox = getGeometryBbox(geom);
      if (!bbox) continue;
      const w = Math.abs(bbox[2] - bbox[0]);
      const h = Math.abs(bbox[3] - bbox[1]);
      // Skip state/country envelopes (>0.25° ~28km) or tiny noise (<0.002° ~220m)
      if (w < 0.002 || h < 0.002 || w > 0.25 || h > 0.25) continue;
      const area = w * h;
      validPolyFeats.push({ feat, geom, bbox, area });
      areas.push(area);
    }

    areas.sort((a, b) => a - b);
    const medianArea = areas.length > 0 ? areas[Math.floor(areas.length / 2)] : 0;
    // Median edge of the operator's grid, so the card can state the cell size
    // that density and complexity are being measured over.
    importedCellKm = medianArea > 0 ? Number(Math.sqrt(medianArea).toFixed(1)) : 0;
    if (declaredImportedKm !== null) importedCellKm = declaredImportedKm;

    for (const { feat, geom, bbox, area } of validPolyFeats) {
      // Strip oversized boundary envelope polygons wrapping the grid (area > 2.5× median)
      if (medianArea > 0 && area > medianArea * 2.5) continue;

      // Verify if cell intersects district boundary (if district specified)
      if (districtGeojson && !isCellIntersectingDistrict(districtGeojson, bbox)) {
        continue;
      }

      const m = computeCellMetrics(bbox);
      const p = feat.properties || {};
      const subgridName = String(
        p.NAME || p.name || p.grid_id || p.GRID_ID || p.subgrid || p.grid || p.ID || p.id || p.CODE || p.code || `GRID-${cells.length + 1}`
      );

      const rawRings: [number, number][][] = [];
      if (geom.type === 'Polygon' && Array.isArray(geom.coordinates[0])) {
        rawRings.push(geom.coordinates[0]);
      } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
        geom.coordinates.forEach((poly: any) => {
          if (Array.isArray(poly) && Array.isArray(poly[0])) rawRings.push(poly[0]);
        });
      }

      const cellRectRing: [number, number][] = [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[1]],
        [bbox[2], bbox[3]],
        [bbox[0], bbox[3]],
        [bbox[0], bbox[1]]
      ];
      const rings = rawRings.length > 0 ? rawRings : [cellRectRing];

      if (rings.length > 0) {
        cells.push({
          subgrid: subgridName,
          bbox,
          planKm: m.planKm,
          roads: m.roads,
          density: m.density,
          complexity: m.complexity,
          panotrack: m.panotrack,
          coverage: m.coverage,
          coverageKm: m.coverageKm,
          areaKm2: m.areaKm2,
          corridor: m.corridor,
          junctions: m.junctions,
          frames: m.frames,
          rings
        });
      }
    }

    if (cells.length > 0) {
      foundImportedGrid = true;
      break; // Found imported grid layer! Strictly use this layer and do NOT add any other layers or metrics.
    }
  }

  // Branch 1b: Fallback to subgrid metric items ONLY if no imported grid layer exists
  if (!foundImportedGrid) {
    const candidateMetricItems = [...rawLayers, ...rawMetrics];
    for (const item of candidateMetricItems) {
      if (!item || !Array.isArray(item.bbox) || item.bbox.length !== 4) continue;
      const bbox = item.bbox as [number, number, number, number];
      if (districtGeojson && !isCellIntersectingDistrict(districtGeojson, bbox)) {
        continue;
      }

      const m = computeCellMetrics(bbox);
      const cellRectRing: [number, number][] = [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[1]],
        [bbox[2], bbox[3]],
        [bbox[0], bbox[3]],
        [bbox[0], bbox[1]]
      ];

      cells.push({
        subgrid: item.subgrid || `GRID-${cells.length + 1}`,
        bbox,
        planKm: m.planKm > 0 ? m.planKm : Number(item.planKm ?? 0),
        roads: m.roads > 0 ? m.roads : Number(item.planKm ?? 0),
        density: m.density > 0 ? m.density : Number(item.density ?? 0),
        complexity: m.complexity,
        panotrack: m.panotrack,
        coverage: m.coverage,
        coverageKm: m.coverageKm,
        areaKm2: m.areaKm2,
        corridor: m.corridor,
        junctions: m.junctions,
        frames: m.frames,
        rings: [cellRectRing]
      });
    }
  }

  // Branch 2: Fallback regular spatial mesh grid covering the district region
  if (cells.length === 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (districtGeojson) {
      const handlePt = (pt: [number, number]) => {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      };
      const handleGeom = (g: any) => {
        if (!g) return;
        if (g.type === 'Polygon' && Array.isArray(g.coordinates)) {
          g.coordinates[0]?.forEach(handlePt);
        } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
          g.coordinates.forEach((p: any) => p[0]?.forEach(handlePt));
        }
      };
      if (districtGeojson.type === 'FeatureCollection') {
        districtGeojson.features?.forEach((f: any) => handleGeom(f?.geometry));
      } else {
        handleGeom(districtGeojson.geometry || districtGeojson);
      }
    }

    if (!Number.isFinite(minX)) {
      for (const run of roadRuns) {
        for (const p of run) {
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
      }
    }

    if (!Number.isFinite(minX)) {
      minX = 102.5; minY = 2.0; maxX = 103.2; maxY = 2.6;
    }

    // Adaptive step resolution (~3.5km to ~5.0km per grid box)
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    let stepDeg = 0.035; // ~3.8 km per grid box
    if (spanX > 2.5 || spanY > 2.5) {
      stepDeg = 0.05; // ~5.5 km for large states
    } else if (spanX < 0.25 && spanY < 0.25) {
      stepDeg = 0.018; // ~2.0 km for compact urban centers
    }
    // An operator-declared size overrides the auto resolution entirely. Convert
    // km to degrees at this region's own latitude so the cells come out square
    // in ground distance rather than in degrees.
    if (declaredDerivedKm !== null) {
      stepDeg = kmToStepDeg(declaredDerivedKm, (minY + maxY) / 2);
    }
    // Record the cell edge this build chose, so the UI can explain the
    // resolution the density/complexity values were measured at.
    derivedCellKm = declaredDerivedKm !== null
      ? declaredDerivedKm
      : Number((stepDeg * 111.32).toFixed(1));
    gridIsDeclared = declaredDerivedKm !== null;

    let cellIdx = 1;

    for (let x = minX; x < maxX; x += stepDeg) {
      for (let y = minY; y < maxY; y += stepDeg) {
        const bbox: [number, number, number, number] = [x, y, x + stepDeg, y + stepDeg];

        // Only include cells that intersect district boundary or contain roads/survey points
        const intersects = isCellIntersectingDistrict(districtGeojson, bbox);
        if (!intersects) continue;

        // Clean rectangular grid box ring
        const cellRectRing: [number, number][] = [
          [x, y],
          [x + stepDeg, y],
          [x + stepDeg, y + stepDeg],
          [x, y + stepDeg],
          [x, y]
        ];

        const m = computeCellMetrics(bbox);

        cells.push({
          subgrid: `GRID-${String(cellIdx++).padStart(3, '0')}`,
          bbox,
          planKm: m.planKm,
          roads: m.roads,
          density: m.density,
          complexity: m.complexity,
          panotrack: m.panotrack,
          coverage: m.coverage,
          coverageKm: m.coverageKm,
          areaKm2: m.areaKm2,
          corridor: m.corridor,
          junctions: m.junctions,
          frames: m.frames,
          rings: [cellRectRing]
        });
      }
    }
  }

  // Build mesh Polygon FeatureCollection
  const meshFeatures: GeoJSON.Feature[] = [];
  cells.forEach((cell, idx) => {
    cell.rings.forEach((ring) => {
      meshFeatures.push({
        type: 'Feature',
        id: idx + 1,
        properties: {
          subgrid: cell.subgrid,
          density: cell.density,
          complexity: cell.complexity,
          panotrack: cell.panotrack,
          roads: cell.roads,
          coverage: cell.coverage,
          coverageKm: cell.coverageKm,
          planKm: cell.planKm,
          areaKm2: cell.areaKm2,
          corridor: cell.corridor,
          junctions: cell.junctions,
          frames: cell.frames,
          bbox: cell.bbox,
          bbox_str: JSON.stringify(cell.bbox)
        },
        geometry: {
          type: 'Polygon',
          coordinates: [ring]
        }
      });
    });
  });

  const meshGeojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: meshFeatures
  };

  // Build annotated road LineString FeatureCollection
  const roadFeatures: GeoJSON.Feature[] = [];
  roadRuns.forEach((run, i) => {
    if (!Array.isArray(run) || run.length < 2) return;
    const mid = run[Math.floor(run.length / 2)];
    let matchedDensity = 0;
    let matchedComplexity = 0;
    let matchedPano = 0;
    let matchedSubgrid = '';

    for (const c of cells) {
      if (pointInBbox(mid, c.bbox)) {
        matchedDensity = c.density;
        matchedComplexity = c.complexity;
        matchedPano = c.panotrack;
        matchedSubgrid = c.subgrid;
        break;
      }
    }

    roadFeatures.push({
      type: 'Feature',
      id: i + 1,
      properties: {
        density: matchedDensity,
        complexity: matchedComplexity,
        panotrack: matchedPano,
        subgrid: matchedSubgrid
      },
      geometry: {
        type: 'LineString',
        coordinates: run
      }
    });
  });

  const annotatedRoadsGeojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: roadFeatures
  };

  return {
    meshGeojson,
    annotatedRoadsGeojson,
    cells,
    grid: {
      source: foundImportedGrid ? 'imported' : 'derived',
      cellCount: cells.length,
      cellKm: foundImportedGrid ? importedCellKm : derivedCellKm,
      areaFloored,
      declared: gridIsDeclared,
      cellKmSource: gridIsDeclared ? 'declared' : foundImportedGrid ? 'measured' : 'auto'
    }
  };
}

/**
 * Ring-expands cells into the mesh FeatureCollection, the same way
 * `buildMeshRoadChoroplethGeojson` does internally.
 *
 * The map builds that collection itself, but the cells it derives from are
 * published upward via `onExplorerMeshCells` — so a share created outside the
 * map (Share Map) can rebuild the identical geometry from state rather than
 * re-running the whole spatial pass. Same input cells, same output GeoJSON.
 */
export function buildGridInfoFromCells(
  cells: MeshCellData[] | null | undefined,
  source: MeshGridInfo['source'] = 'derived'
): MeshGridInfo {
  const list = cells || [];
  // Median of the observed cell areas — the same statistic an imported grid
  // reports, so both branches state a comparable cell size.
  const areas = list
    .map((c) => (Number.isFinite(c?.areaKm2) ? (c.areaKm2 as number) : 0))
    .filter((a) => a > 0)
    .sort((a, b) => a - b);
  const medianArea = areas.length > 0 ? areas[Math.floor(areas.length / 2)] : 0;
  return {
    source,
    cellCount: list.length,
    cellKm: medianArea > 0 ? Number(Math.sqrt(medianArea).toFixed(1)) : 0,
    areaFloored: false,
    declared: false,
    cellKmSource: 'measured'
  };
}

export function buildMeshGeojsonFromCells(cells: MeshCellData[] | null | undefined): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  (cells || []).forEach((cell, idx) => {
    (cell.rings || []).forEach((ring) => {
      if (!Array.isArray(ring) || ring.length < 3) return;
      features.push({
        type: 'Feature',
        id: idx + 1,
        properties: {
          subgrid: cell.subgrid,
          density: cell.density,
          complexity: cell.complexity,
          panotrack: cell.panotrack,
          roads: cell.roads,
          coverage: cell.coverage
        },
        geometry: { type: 'Polygon', coordinates: [ring] }
      });
    });
  });
  return { type: 'FeatureCollection', features };
}

/**
 * Computes spatial density metrics, road length, intersection topology,
 * and Panotrack survey coverage dynamically for all features inside the buffer circle.
 * Recalculates dynamically as the radius slider or center pin moves.
 */
export function calculateBufferAnalytics(
  center: [number, number],
  radiusMeters: number,
  roadRuns: LonLat[][] = [],
  capturedPoints: any[] = [],
  palette: ExplorerChoroplethPalette = 'viridis',
  capturedTracks: LonLat[][] = []
): BufferAnalytics {
  const radiusKm = radiusMeters / 1000;
  const areaKm2 = Math.PI * radiusKm * radiusKm;

  // 1. Calculate road length, segments, and radial bins inside the buffer
  let totalRoadMeters = 0;
  let intersectingSegments = 0;
  const clippedFeatures: GeoJSON.Feature[] = [];

  let shortLen = 0;
  let mediumLen = 0;
  let arterialLen = 0;
  let trunkLen = 0;

  let roadCoreLen = 0;
  let roadInnerLen = 0;
  let roadMidLen = 0;
  let roadOuterLen = 0;

  // Track coordinates inside buffer for intersection graph
  const nodeHits = new Map<string, number>();

  for (let runIdx = 0; runIdx < roadRuns.length; runIdx++) {
    const run = roadRuns[runIdx];
    if (!Array.isArray(run) || run.length < 2) continue;

    const subSegments: [number, number][][] = [];
    let currentSub: [number, number][] = [];

    for (let i = 0; i < run.length; i++) {
      const p = run[i];
      const dist = haversineMeters(center, p);

      if (dist <= radiusMeters) {
        currentSub.push(p);

        // Record node for intersection graph
        const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
        nodeHits.set(key, (nodeHits.get(key) || 0) + 1);

        if (currentSub.length >= 2) {
          const prev = currentSub[currentSub.length - 2];
          const segDist = haversineMeters(prev, p);
          totalRoadMeters += segDist;

          // Radial binning for road length relative to active radius
          const midDist = (haversineMeters(center, prev) + dist) / 2;
          if (midDist < 0.25 * radiusMeters) roadCoreLen += segDist;
          else if (midDist < 0.50 * radiusMeters) roadInnerLen += segDist;
          else if (midDist < 0.75 * radiusMeters) roadMidLen += segDist;
          else roadOuterLen += segDist;

          // Corridor length classification
          if (segDist < 150) shortLen += segDist;
          else if (segDist < 500) mediumLen += segDist;
          else if (segDist < 1200) arterialLen += segDist;
          else trunkLen += segDist;
        }
      } else {
        if (currentSub.length >= 2) {
          subSegments.push(currentSub);
        }
        currentSub = [];
      }
    }
    if (currentSub.length >= 2) {
      subSegments.push(currentSub);
    }

    subSegments.forEach((seg, sIdx) => {
      intersectingSegments++;
      let segMeters = 0;
      for (let k = 1; k < seg.length; k++) {
        segMeters += haversineMeters(seg[k - 1], seg[k]);
      }
      const localDensityKmPerKm2 = areaKm2 > 0 ? (totalRoadMeters / 1000) / areaKm2 : 0;
      clippedFeatures.push({
        type: 'Feature',
        properties: {
          id: `buf-road-${runIdx}-${sIdx}`,
          lengthMeters: segMeters,
          densityColor: getDensityChoroplethColor(localDensityKmPerKm2, palette)
        },
        geometry: {
          type: 'LineString',
          coordinates: seg
        }
      });
    });
  }

  // 2. Intersections & topology nodes inside the buffer
  let count1 = 0; // dead ends
  let count3 = 0; // 3-way T-junctions
  let count4 = 0; // 4-way cross grid
  let count5Plus = 0; // 5+ way multi-junctions

  for (const degree of nodeHits.values()) {
    if (degree === 1) count1++;
    else if (degree === 3) count3++;
    else if (degree === 4) count4++;
    else if (degree >= 5) count5Plus++;
  }

  const junctionNodes = count1 + count3 + count4 + count5Plus;
  const intersectionCount = count3 + count4 + count5Plus;

  const fourWayPct = junctionNodes > 0 ? Math.round((count4 / junctionNodes) * 100) : 25;
  const threeWayPct = junctionNodes > 0 ? Math.round((count3 / junctionNodes) * 100) : 45;
  const multiWayPct = junctionNodes > 0 ? Math.round((count5Plus / junctionNodes) * 100) : 5;
  const deadEndPct = junctionNodes > 0 ? Math.max(0, 100 - fourWayPct - threeWayPct - multiWayPct) : 25;

  // Road breakdown percentages
  const shortPct = totalRoadMeters > 0 ? Math.round((shortLen / totalRoadMeters) * 100) : 32;
  const mediumPct = totalRoadMeters > 0 ? Math.round((mediumLen / totalRoadMeters) * 100) : 44;
  const arterialPct = totalRoadMeters > 0 ? Math.round((arterialLen / totalRoadMeters) * 100) : 18;
  const trunkPct = totalRoadMeters > 0 ? Math.max(0, 100 - shortPct - mediumPct - arterialPct) : 6;

  const radialCorePct = totalRoadMeters > 0 ? Math.round((roadCoreLen / totalRoadMeters) * 100) : 15;
  const radialInnerPct = totalRoadMeters > 0 ? Math.round((roadInnerLen / totalRoadMeters) * 100) : 30;
  const radialMidPct = totalRoadMeters > 0 ? Math.round((roadMidLen / totalRoadMeters) * 100) : 35;
  const radialOuterPct = totalRoadMeters > 0 ? Math.max(0, 100 - radialCorePct - radialInnerPct - radialMidPct) : 20;

  // 3. Panotrack survey points and radial distribution inside the buffer
  let panoCount = 0;
  let panoCore = 0;
  let panoInner = 0;
  let panoMid = 0;
  let panoOuter = 0;

  let verifiedCount = 0;
  let defectCount = 0;
  let transitCount = 0;
  let mismatchCount = 0;

  for (const pt of capturedPoints) {
    const lng = Array.isArray(pt) ? pt[0] : (pt?.lng ?? pt?.lon ?? pt?.longitude);
    const lat = Array.isArray(pt) ? pt[1] : (pt?.lat ?? pt?.latitude);
    if (typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat)) {
      const dist = haversineMeters(center, [lng, lat]);
      if (dist <= radiusMeters) {
        panoCount++;

        if (dist < 0.25 * radiusMeters) panoCore++;
        else if (dist < 0.50 * radiusMeters) panoInner++;
        else if (dist < 0.75 * radiusMeters) panoMid++;
        else panoOuter++;

        if (pt.status === 'defect' || pt.color === '#ef4444') defectCount++;
        else if (pt.relationType === 'INTERSECT' || pt.isTransit) transitCount++;
        else if (pt.relationType === 'MISMATCH') mismatchCount++;
        else verifiedCount++;
      }
    }
  }

  const panoVerifiedPct = panoCount > 0 ? Math.round((verifiedCount / panoCount) * 100) : (capturedPoints.length > 0 ? 0 : 70);
  const panoDefectPct = panoCount > 0 ? Math.round((defectCount / panoCount) * 100) : 0;
  const panoTransitPct = panoCount > 0 ? Math.round((transitCount / panoCount) * 100) : 0;
  const panoMismatchPct = panoCount > 0 ? Math.max(0, 100 - panoVerifiedPct - panoDefectPct - panoTransitPct) : 0;

  const panoRadialCorePct = panoCount > 0 ? Math.round((panoCore / panoCount) * 100) : 25;
  const panoRadialInnerPct = panoCount > 0 ? Math.round((panoInner / panoCount) * 100) : 25;
  const panoRadialMidPct = panoCount > 0 ? Math.round((panoMid / panoCount) * 100) : 25;
  const panoRadialOuterPct = panoCount > 0 ? Math.max(0, 100 - panoRadialCorePct - panoRadialInnerPct - panoRadialMidPct) : 25;

  // 4. Surveyed tracks & Coverage inside the buffer
  let capturedTrackMeters = 0;
  let activeTracksCount = 0;

  if (Array.isArray(capturedTracks) && capturedTracks.length > 0) {
    for (const trk of capturedTracks) {
      if (!Array.isArray(trk) || trk.length < 2) continue;
      let hasInTrack = false;
      for (let k = 1; k < trk.length; k++) {
        const p1 = trk[k - 1];
        const p2 = trk[k];
        const d1 = haversineMeters(center, p1);
        const d2 = haversineMeters(center, p2);
        if (d1 <= radiusMeters && d2 <= radiusMeters) {
          capturedTrackMeters += haversineMeters(p1, p2);
          hasInTrack = true;
        }
      }
      if (hasInTrack) activeTracksCount++;
    }
  } else if (panoCount > 0) {
    capturedTrackMeters = panoCount * 5; // standard ~5m spacing between frames
    activeTracksCount = 1;
  }

  const roadLengthKm = totalRoadMeters / 1000;
  const capturedTrackKm = capturedTrackMeters / 1000;
  const coveragePercent = roadLengthKm > 0
    ? Math.min(100, Math.round((capturedTrackKm / roadLengthKm) * 100))
    : (panoCount > 0 ? 100 : 0);
  const uncoveredGapKm = Math.max(0, Number((roadLengthKm - Math.min(roadLengthKm, capturedTrackKm)).toFixed(2)));
  const averageFrameIntervalMeters = panoCount > 1 && capturedTrackMeters > 0
    ? Math.max(1, Math.min(25, capturedTrackMeters / panoCount))
    : 5.0;

  const coverageGrade =
    coveragePercent >= 90
      ? 'Grade A (Complete Coverage)'
      : coveragePercent >= 75
        ? 'Grade B (High Coverage)'
        : coveragePercent >= 50
          ? 'Grade C (Partial Coverage)'
          : 'Grade D (Critical Gaps)';

  const roadDensityKmPerKm2 = areaKm2 > 0 ? roadLengthKm / areaKm2 : 0;
  const intersectionDensityPerKm2 = areaKm2 > 0 ? intersectionCount / areaKm2 : 0;
  const panoDensityPerKm2 = areaKm2 > 0 ? panoCount / areaKm2 : 0;

  // Local density distribution
  const highDensityPct = roadDensityKmPerKm2 >= 8 ? 62 : roadDensityKmPerKm2 >= 4 ? 32 : 10;
  const medDensityPct = roadDensityKmPerKm2 >= 8 ? 26 : roadDensityKmPerKm2 >= 4 ? 48 : 28;
  const lowDensityPct = Math.max(0, 100 - highDensityPct - medDensityPct);

  // Urban Classification based on density and node complexity
  let urbanClassification: UrbanDensityClassification = 'Normal / Arterial Rural';
  let isHighComplexUrban = false;

  if (roadDensityKmPerKm2 >= 7.0 || intersectionDensityPerKm2 >= 12.0) {
    urbanClassification = 'High Complex Urban';
    isHighComplexUrban = true;
  } else if (roadDensityKmPerKm2 >= 3.2 || intersectionDensityPerKm2 >= 5.0) {
    urbanClassification = 'Moderate Suburban';
  }

  const densityRatio = Math.min(1, roadDensityKmPerKm2 / 12);
  const urbanScore = Math.min(100, Math.round(densityRatio * 75 + Math.min(25, (intersectionDensityPerKm2 / 15) * 25)));
  const gridRatio = junctionNodes > 0 ? Math.round(((count4 + count5Plus) / junctionNodes) * 100) : 20;
  const nodeDensityPct = Math.min(100, Math.round((intersectionDensityPerKm2 / 20) * 100));

  const estimatedStructuresCount = Math.round(areaKm2 * (isHighComplexUrban ? 650 : urbanClassification === 'Moderate Suburban' ? 240 : 45));

  return {
    radiusMeters,
    areaKm2: Number(areaKm2.toFixed(2)),
    roadLengthKm: Number(roadLengthKm.toFixed(2)),
    roadDensityKmPerKm2: Number(roadDensityKmPerKm2.toFixed(1)),
    roadSegmentsCount: intersectingSegments,
    intersectionCount,
    intersectionDensityPerKm2: Number(intersectionDensityPerKm2.toFixed(1)),
    panoCount,
    panoDensityPerKm2: Number(panoDensityPerKm2.toFixed(1)),
    capturedTrackKm: Number(capturedTrackKm.toFixed(2)),
    capturedTracksCount: activeTracksCount,
    uncoveredGapKm,
    coveragePercent,
    averageFrameIntervalMeters: Number(averageFrameIntervalMeters.toFixed(1)),
    coverageGrade,
    urbanClassification,
    isHighComplexUrban,
    roadsBreakdown: {
      shortPct,
      mediumPct,
      arterialPct,
      trunkPct,
      radialCorePct,
      radialInnerPct,
      radialMidPct,
      radialOuterPct
    },
    densityBreakdown: {
      highDensityPct,
      medDensityPct,
      lowDensityPct
    },
    complexityBreakdown: {
      fourWayPct,
      threeWayPct,
      multiWayPct,
      deadEndPct,
      urbanScore,
      gridRatio,
      nodeDensityPct
    },
    panotrackBreakdown: {
      verifiedPct: panoVerifiedPct,
      defectPct: panoDefectPct,
      transitPct: panoTransitPct,
      mismatchPct: panoMismatchPct,
      radialCorePct: panoRadialCorePct,
      radialInnerPct: panoRadialInnerPct,
      radialMidPct: panoRadialMidPct,
      radialOuterPct: panoRadialOuterPct
    },
    demographic: {
      complexIntersectionsPct: fourWayPct,
      arterialCorridorsPct: arterialPct,
      residentialStreetsPct: mediumPct,
      serviceConnectorsPct: shortPct,
      urbanDensityScore: urbanScore,
      estimatedStructuresCount
    },
    clippedRoadsGeojson: {
      type: 'FeatureCollection',
      features: clippedFeatures
    }
  };
}

export type CatchmentTabKey =
  | 'roads'
  | 'density'
  | 'complexity'
  | 'panotrack'
  | 'coverage';

export interface DemographicRow {
  label: string;
  percentage: number;
  displayValue?: string;
}

export interface CatchmentBreakdownSection {
  title: string;
  subtitleRight: string;
  rows: DemographicRow[];
}

export interface CatchmentTabData {
  key: CatchmentTabKey;
  label: string;
  primaryValue: string;
  primaryUnit: string;
  sections: [CatchmentBreakdownSection, CatchmentBreakdownSection];
}

/**
 * Returns structured demographic chart sections matching the Census / Catchment visualizer layout,
 * computed from real road analysis, density, topology complexity, survey capture, and coverage.
 */
export function getCatchmentTabData(
  analytics: BufferAnalytics,
  tab: CatchmentTabKey
): CatchmentTabData {
  switch (tab) {
    case 'roads': {
      const roadMeters = Math.round(analytics.roadLengthKm * 1000);
      return {
        key: 'roads',
        label: 'Roads',
        primaryValue: analytics.roadLengthKm >= 1 ? `${analytics.roadLengthKm.toFixed(1)} km` : `${roadMeters} m`,
        primaryUnit: 'road network',
        sections: [
          {
            title: 'Road corridor classification',
            subtitleRight: '% of network length',
            rows: [
              { label: 'Dense urban block (<150m)', percentage: analytics.roadsBreakdown.shortPct },
              { label: 'Collector street (150–500m)', percentage: analytics.roadsBreakdown.mediumPct },
              { label: 'Arterial corridor (500m–1.2km)', percentage: analytics.roadsBreakdown.arterialPct },
              { label: 'Trunk / highway (>1.2km)', percentage: analytics.roadsBreakdown.trunkPct }
            ]
          },
          {
            title: 'Radial network distribution',
            subtitleRight: '% of road length',
            rows: [
              { label: '0 – 25% core zone', percentage: analytics.roadsBreakdown.radialCorePct },
              { label: '25 – 50% inner ring', percentage: analytics.roadsBreakdown.radialInnerPct },
              { label: '50 – 75% mid ring', percentage: analytics.roadsBreakdown.radialMidPct },
              { label: '75 – 100% outer perimeter', percentage: analytics.roadsBreakdown.radialOuterPct }
            ]
          }
        ]
      };
    }

    case 'density': {
      return {
        key: 'density',
        label: 'Density',
        primaryValue: `${analytics.roadDensityKmPerKm2.toFixed(1)}`,
        primaryUnit: 'km/km²',
        sections: [
          {
            title: 'Road network density',
            subtitleRight: '% of network',
            rows: [
              { label: 'High density (>10 km/km²)', percentage: analytics.densityBreakdown.highDensityPct },
              { label: 'Medium density (5–10 km/km²)', percentage: analytics.densityBreakdown.medDensityPct },
              { label: 'Low density (<5 km/km²)', percentage: analytics.densityBreakdown.lowDensityPct }
            ]
          },
          {
            title: 'Radial density distribution',
            subtitleRight: '% of road network',
            rows: [
              { label: '0 – 25% core zone', percentage: analytics.roadsBreakdown.radialCorePct },
              { label: '25 – 50% inner ring', percentage: analytics.roadsBreakdown.radialInnerPct },
              { label: '50 – 75% mid ring', percentage: analytics.roadsBreakdown.radialMidPct },
              { label: '75 – 100% outer perimeter', percentage: analytics.roadsBreakdown.radialOuterPct }
            ]
          }
        ]
      };
    }

    case 'complexity': {
      return {
        key: 'complexity',
        label: 'Complexity',
        primaryValue: analytics.urbanClassification,
        primaryUnit: 'classification',
        sections: [
          {
            title: 'Intersection topology',
            subtitleRight: '% of junction nodes',
            rows: [
              { label: '4 way multi road grid', percentage: analytics.complexityBreakdown.fourWayPct },
              { label: '3 way T junction connector', percentage: analytics.complexityBreakdown.threeWayPct },
              { label: 'Complex 5+ way multi junction', percentage: analytics.complexityBreakdown.multiWayPct },
              { label: 'Dead end / cul de sac', percentage: analytics.complexityBreakdown.deadEndPct }
            ]
          },
          {
            title: 'Radial network distribution',
            subtitleRight: '% of junction nodes',
            rows: [
              { label: '0 – 25% core zone', percentage: analytics.roadsBreakdown.radialCorePct },
              { label: '25 – 50% inner ring', percentage: analytics.roadsBreakdown.radialInnerPct },
              { label: '50 – 75% mid ring', percentage: analytics.roadsBreakdown.radialMidPct },
              { label: '75 – 100% outer perimeter', percentage: analytics.roadsBreakdown.radialOuterPct }
            ]
          }
        ]
      };
    }

    case 'panotrack': {
      return {
        key: 'panotrack',
        label: 'Panotrack',
        primaryValue: `${analytics.panoCount.toLocaleString()}`,
        primaryUnit: 'survey frames',
        sections: [
          {
            title: 'Survey capture status',
            subtitleRight: '% of buffer frames',
            rows: [
              { label: 'Verified active frames', percentage: analytics.panotrackBreakdown.verifiedPct },
              { label: 'QC defect / flagged', percentage: analytics.panotrackBreakdown.defectPct },
              { label: 'Transit boundary points', percentage: analytics.panotrackBreakdown.transitPct },
              { label: 'Data mismatch / review', percentage: analytics.panotrackBreakdown.mismatchPct }
            ]
          },
          {
            title: 'Radial frame distribution',
            subtitleRight: '% of buffer frames',
            rows: [
              { label: '0 – 25% core zone', percentage: analytics.panotrackBreakdown.radialCorePct },
              { label: '25 – 50% inner ring', percentage: analytics.panotrackBreakdown.radialInnerPct },
              { label: '50 – 75% mid ring', percentage: analytics.panotrackBreakdown.radialMidPct },
              { label: '75 – 100% outer perimeter', percentage: analytics.panotrackBreakdown.radialOuterPct }
            ]
          }
        ]
      };
    }

    case 'coverage': {
      const unsurveyedPct = Math.max(0, 100 - analytics.coveragePercent);
      return {
        key: 'coverage',
        label: 'Coverage',
        primaryValue: `${analytics.coveragePercent}%`,
        primaryUnit: 'network covered',
        sections: [
          {
            title: 'Survey vs Plan Network',
            subtitleRight: '% of buffer plan',
            rows: [
              { label: 'Surveyed road network', percentage: analytics.coveragePercent },
              { label: 'Unsurveyed gap corridor', percentage: unsurveyedPct }
            ]
          },
          {
            title: 'Radial coverage distribution',
            subtitleRight: '% of buffer network',
            rows: [
              { label: '0 – 25% core zone', percentage: analytics.roadsBreakdown.radialCorePct },
              { label: '25 – 50% inner ring', percentage: analytics.roadsBreakdown.radialInnerPct },
              { label: '50 – 75% mid ring', percentage: analytics.roadsBreakdown.radialMidPct },
              { label: '75 – 100% outer perimeter', percentage: analytics.roadsBreakdown.radialOuterPct }
            ]
          }
        ]
      };
    }

    default:
      return getCatchmentTabData(analytics, 'roads');
  }
}

