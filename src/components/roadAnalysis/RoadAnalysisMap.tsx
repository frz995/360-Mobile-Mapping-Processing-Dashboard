// =====================================================================
// Local map surface for the Road Analysis workspace (Option A), rendered
// with MapLibre GL so it can display the SAME OpenFreeMap vector basemap
// the dashboard uses (Leaflet cannot render vector tiles).
//
// Shows the selected district boundary + real captured points, and the
// extracted road lines (clipped to the district) as an overlay at the
// OpenFreeMap style. The extracted road-line layer can be hidden via the
// `showRoadLines` toggle.
// =====================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification, Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Let Vite resolve & serve maplibre's worker as a proper asset instead of
// maplibre self-constructing its own worker path (which Vite dev serves with
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { CatalogVectorLayer } from '../../utils/gisImportParser';
import { type SystemLayerStyles } from './RoadCatalogPanel';
import { resolveSpatialSubgrid } from '../../utils/subgridComparison';
import { extractSubgridName } from '../../utils/subgrid';
import { minMaxOf } from '../../utils/arrayBounds';

const effectiveWorkerUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPLIBRE_WORKER_URL) || workerUrl;
maplibregl.setWorkerUrl(effectiveWorkerUrl);

export interface RoadAnalysisMapProps {
  bbox?: [number, number, number, number] | null;
  districtGeojson?: any;
  /**
   * Non-selected region geometry (all districts minus the selected ones).
   * Rendered as a dimmed shade so the selected region stands out.
   */
  dimmedRegionsGeojson?: any;
  capturedPoints?: Array<[number, number] | any>;
  /** Real captured survey trajectory tracks from dailyData / batchLogs. */
  capturedTracks?: Array<Array<[number, number]>>;
  /** Clipped road-runs from the extraction service or manual plan line. */
  roadRuns?: Array<Array<[number, number]>>;
  /**
   * Map style: an OpenFreeMap style URL (string) or a raster fallback style
   * object. Matches the dashboard basemap when an 'ofm-*' key is used.
   */
  style?: string | StyleSpecification;
  /**
   * Whether this surface is currently visible. While hidden the container is
   * 0-sized; MapLibre needs resize() when it becomes visible to repaint.
   */
  active?: boolean;
  /** Toggle the extracted road-line layer (district + captured points always show). */
  showRoadLines?: boolean;
  /** User-imported custom GIS layers to display and style dynamically. */
  catalogLayers?: CatalogVectorLayer[];
  /** Styling customizations for system baseline layers. */
  systemStyles?: SystemLayerStyles;
  /** Bounding box to zoom map to when requested by catalog. */
  focusBbox?: [number, number, number, number] | null;
  /** Selected feature from Attribute Table to highlight on map in yellow. */
  selectedFeature?: any;
  /** Callback fired when a survey point is clicked, passing its subgrid code. */
  onSelectSubgrid?: (subgrid: string) => void;
  /** Enable 3D building extrusion mode (requires pitch > 0 + vector basemap). */
  show3D?: boolean;
  /**
   * Optional ref filled with the live MapLibre map instance so parent
   * workspace panels (e.g. Print) can read the current camera/extent or
   * capture the canvas.
   */
  mapInstanceRef?: React.MutableRefObject<MaplibreMap | null>;
}

const DEFAULT_CENTER: [number, number] = [101.9758, 4.2105];
const DEFAULT_ZOOM = 7;
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** Base system source ids created by this component. */
const BASE_SOURCE_IDS = ['ra-dim', 'ra-districts', 'ra-captured', 'ra-roads'] as const;

/** Base system layer ids created by this component. */
const BASE_LAYER_IDS = [
  'ra-dim',
  'ra-districts',
  'ra-districts-line',
  'ra-captured',
  'ra-roads'
] as const;

const BUILDING_LAYER_ID = 'ra-buildings';

function extractLineStringRuns(runs: Array<Array<[number, number]>>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: runs
      .filter((r) => Array.isArray(r) && r.length >= 2)
      .map((r) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: r.map((p) => p.slice() as [number, number]) }
      }))
  };
}

function extractPointCollection(
  points: Array<[number, number] | any>,
  catalogLayers: CatalogVectorLayer[] = []
): GeoJSON.FeatureCollection {
  // 1. Group points by assigned subgrid to know batch distribution
  const countByAssigned = new Map<string, { total: number; inOrigin: number }>();
  points.forEach((p) => {
    if (Array.isArray(p)) return;
    const assigned = extractSubgridName(p.subgrid);
    if (!assigned) return;
    const lng = Number(p.lng ?? p.lon ?? p.longitude);
    const lat = Number(p.lat ?? p.latitude);
    const spatial = resolveSpatialSubgrid([lng, lat], catalogLayers) || assigned;
    const current = countByAssigned.get(assigned) || { total: 0, inOrigin: 0 };
    current.total += 1;
    if (spatial === assigned) current.inOrigin += 1;
    countByAssigned.set(assigned, current);
  });

  // Sort points so defect frames are drawn on top of normal points
  const sorted = [...points].sort((a, b) => {
    const aDef = (!Array.isArray(a) && (a.color === '#ef4444' || a.status === 'defect')) ? 1 : 0;
    const bDef = (!Array.isArray(b) && (b.color === '#ef4444' || b.status === 'defect')) ? 1 : 0;
    return aDef - bDef;
  });

  return {
    type: 'FeatureCollection',
    features: sorted.map((p, idx) => {
      const lng = Array.isArray(p) ? Number(p[0]) : Number(p.lng ?? p.lon ?? p.longitude);
      const lat = Array.isArray(p) ? Number(p[1]) : Number(p.lat ?? p.latitude);
      const isDefect = !Array.isArray(p) && (p.color === '#ef4444' || p.status === 'defect');
      const color = isDefect ? '#ef4444' : (!Array.isArray(p) && p.color ? p.color : '#10b981');

      const assigned = !Array.isArray(p) ? extractSubgridName(p.subgrid) : '';
      const spatial = resolveSpatialSubgrid([lng, lat], catalogLayers) || assigned;

      let relationType = 'MATCHED';
      let transitNote = '';
      let reason = '';

      if (assigned && spatial && assigned !== spatial) {
        const stats = countByAssigned.get(assigned);
        if (stats && stats.inOrigin > 0) {
          relationType = 'INTERSECT';
          transitNote = `Intersect with ${assigned} — Track starts in ${assigned}, ends in ${spatial}`;
        } else {
          relationType = 'MISMATCH';
          reason = 'data missmatch with subgrid assign';
          transitNote = `data missmatch with subgrid assign (Assigned ${assigned}, physically in ${spatial})`;
        }
      }

      return {
        type: 'Feature' as const,
        properties: {
          id: !Array.isArray(p) ? (p.id || `pt-${idx}`) : `pt-${idx}`,
          subgrid: !Array.isArray(p) ? (p.subgrid || '') : '',
          filename: !Array.isArray(p) ? (p.filename || '') : '',
          status: !Array.isArray(p) ? (isDefect ? 'defect' : (p.status || (p.isPublished ? 'published' : 'staging'))) : 'published',
          color,
          spatialSubgrid: spatial,
          relationType,
          transitNote,
          reason
        },
        geometry: { type: 'Point' as const, coordinates: [lng, lat] }
      };
    })
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers for in-place style updates (no layer teardown → zero basemap flash)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Structural fingerprint: changes ONLY when layers are added/removed, toggled,
 * or their geometry type / dash pattern / label toggle changes.
 * Style-only changes (color, opacity, size …) do NOT change the fingerprint.
 */
function computeStructuralFingerprint(layers: CatalogVectorLayer[]): string {
  return layers
    .map((l) =>
      [
        l.id,
        l.visible ? '1' : '0',
        l.geometryType,
        l.showLabels ? '1' : '0',
        l.strokeStyle || 'solid',
        l.featureCount
      ].join(':')
    )
    .join('|');
}

/** Updates paint / layout properties of an already-rendered catalog layer in-place. */
function updateCatalogLayerStyle(
  map: MaplibreMap,
  catLayer: CatalogVectorLayer,
  srcId: string
): void {
  const sp = (id: string, prop: string, val: unknown) => {
    if (map.getLayer(id)) (map as any).setPaintProperty(id, prop, val);
  };
  const sl = (id: string, prop: string, val: unknown) => {
    if (map.getLayer(id)) (map as any).setLayoutProperty(id, prop, val);
  };

  const color   = catLayer.color || '#38bdf8';
  const opacity  = Math.max(0.01, Math.min(1, catLayer.opacity ?? 0.85));
  const width    = catLayer.strokeWidth ?? 3;
  const pRadius  = catLayer.pointRadius ?? 5;

  // Polygon fill
  sp(`${srcId}-fill`, 'fill-color',   catLayer.fillColor || color);
  sp(`${srcId}-fill`, 'fill-opacity',  catLayer.fillOpacity !== undefined ? catLayer.fillOpacity : opacity * 0.4);

  // Polygon + standalone line
  for (const lid of [`${srcId}-poly-line`, `${srcId}-line`]) {
    sp(lid, 'line-color',   color);
    sp(lid, 'line-opacity', opacity);
    sp(lid, 'line-width',   width);
  }

  // Circle / point
  sp(`${srcId}-circle`, 'circle-color',        color);
  sp(`${srcId}-circle`, 'circle-opacity',       opacity);
  sp(`${srcId}-circle`, 'circle-radius',        pRadius);
  sp(`${srcId}-circle`, 'circle-stroke-color',  catLayer.pointStrokeColor  || '#ffffff');
  sp(`${srcId}-circle`, 'circle-stroke-width',  catLayer.pointStrokeWidth  ?? 1.5);

  // Labels
  sp(`${srcId}-labels`, 'text-color',       catLayer.labelColor     || '#f8fafc');
  sp(`${srcId}-labels`, 'text-halo-color',  catLayer.labelHaloColor || '#090d16');
  sp(`${srcId}-labels`, 'text-halo-width',  catLayer.labelHaloWidth ?? 2);
  sl(`${srcId}-labels`, 'text-size',        catLayer.labelSize      || 11);
  const propKeys = Object.keys(catLayer.geojson?.features?.[0]?.properties || {});
  const lf =
    catLayer.labelField ||
    propKeys.find((k) => /^(name|label|id|title|station|grid|district|code|road)/i.test(k)) ||
    propKeys[0];
  if (lf) sl(`${srcId}-labels`, 'text-field', ['to-string', ['get', lf]]);
}

/** Detect whether the loaded style exposes the OpenMapTiles vector source. */
function styleHasVectorBuildings(map: MaplibreMap): boolean {
  try {
    const style = map.getStyle() as StyleSpecification;
    return !!style?.sources?.openmaptiles;
  } catch { return false; }
}

/** Toggle the3D building fill-extrusion layer on/off. */
function applyBuildingLayer(
  map: MaplibreMap,
  show3D: boolean
): void {
  const hasSource = styleHasVectorBuildings(map);
  const layerExists = map.getLayer(BUILDING_LAYER_ID);

  if (show3D && hasSource && !layerExists) {
    map.addLayer({
      id: BUILDING_LAYER_ID,
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0],
          0,   '#c8d6e5',
          10,  '#a0b4c8',
          30,  '#7f9ab5',
          60,  '#5d7f9e',
          100, '#3d6588'
        ],
        'fill-extrusion-height': [
          'coalesce',
          ['get', 'render_height'],
          ['get', 'height'],
          10
        ],
        'fill-extrusion-base': [
          'coalesce',
          ['get', 'render_min_height'],
          ['get', 'min_height'],
          0
        ],
        'fill-extrusion-opacity': 0.72
      }
    });
  } else if ((!show3D || !hasSource) && layerExists) {
    map.removeLayer(BUILDING_LAYER_ID);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 2D↔3D camera FLIGHT (Google / Tesla style swoop)
//
// A plain easeTo only *rotates* the camera; the fly effect comes from coupling
// pitch with zoom so the camera physically descends toward the surface on the
// curve. Keeping `zoom + log2(cos(pitch))` constant preserves the ground
// footprint, so as we tilt to 60° the camera sinks ~1 zoom level closer, and
// flattening raises it back — which reads as "flying down to / up from" the
// 3D surface view.
// ──────────────────────────────────────────────────────────────────────────────
const clampCosDeg = (deg: number) => Math.cos((Math.min(deg, 72) * Math.PI) / 180);

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Drives an rAF camera flight. Returns a cancel() that stops the loop. */
function startCameraFlight(
  map: MaplibreMap,
  opts: { targetPitch: number; targetBearing: number; duration: number }
): () => void {
  const startPitch = map.getPitch();
  const startZoom = map.getZoom();
  const startBearing = map.getBearing();
  // Baseline altitude constant preserved along the flight path.
  const baseline = startZoom + Math.log2(clampCosDeg(startPitch));
  const { targetPitch, targetBearing, duration } = opts;
  const t0 = performance.now();
  let raf: number | null = null;

  const stop = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };

  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - t0) / duration));
    const e = easeInOutCubic(t);
    const pitchDeg = startPitch + (targetPitch - startPitch) * e;
    const bearing = startBearing + (targetBearing - startBearing) * e;
    const zoom = Math.max(2.5, baseline - Math.log2(clampCosDeg(pitchDeg)));
    map.jumpTo({ pitch: pitchDeg, zoom, bearing });
    if (t < 1) {
      raf = requestAnimationFrame(step);
    } else {
      raf = null;
    }
  };

  raf = requestAnimationFrame(step);
  return stop;
}

/** Updates system baseline layer paint properties without triggering a full rebuild. */
function applySystemStyles(
  map: MaplibreMap,
  ss: SystemLayerStyles | undefined,
  showRoadLines: boolean
): void {
  if (map.getLayer('ra-districts-line')) {
    const b = ss?.districtBoundary;
    map.setPaintProperty('ra-districts-line', 'line-color',   b?.color || '#000000');
    map.setPaintProperty('ra-districts-line', 'line-opacity',  b?.visible !== false ? (b?.opacity ?? 1) : 0);
    map.setPaintProperty('ra-districts-line', 'line-width',    b?.strokeWidth ?? 2.5);
  }
  if (map.getLayer('ra-roads')) {
    const rp = ss?.roadPlan;
    const vis = showRoadLines && (rp?.visible !== false);
    map.setPaintProperty('ra-roads', 'line-color',   rp?.color || '#10b981');
    map.setPaintProperty('ra-roads', 'line-opacity',  vis ? (rp?.opacity ?? 0.85) : 0);
    map.setPaintProperty('ra-roads', 'line-width',    rp?.strokeWidth ?? 3.5);
  }
  if (map.getLayer('ra-captured')) {
    const cp = ss?.capturedPoints;
    map.setPaintProperty('ra-captured', 'circle-opacity', cp?.visible !== false ? (cp?.opacity ?? 0.95) : 0);
    if (cp?.pointRadius) map.setPaintProperty('ra-captured', 'circle-radius', cp.pointRadius);
  }
}

const RoadAnalysisMapComponent: React.FC<RoadAnalysisMapProps> = ({
  bbox,
  districtGeojson,
  dimmedRegionsGeojson,
  capturedPoints = [],
  roadRuns = [],
  style,
  active = true,
  showRoadLines = true,
  catalogLayers = [],
  systemStyles,
  focusBbox,
  selectedFeature,
  onSelectSubgrid,
  mapInstanceRef,
  show3D = false
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  const buildOverlayRef = useRef<(() => void) | null>(null);
  const dynamicLayersRef = useRef<string[]>([]);
  const dynamicSourcesRef = useRef<string[]>([]);
  const lastFittedBboxRef = useRef<string>('');
  const selectedPopupRef = useRef<maplibregl.Popup | null>(null);

  // Loading indicator: the overlay stays up until the style has loaded AND the
  // first overlay build (district geometry + OSM captured points + roads) has
  // painted. A failsafe guarantees the spinner can never hang forever if the
  // basemap network request stalls.
  const [ready, setReady] = useState(false);
  // Tracks every geojson source this component registers (district, dimmed
  // regions, captured points, road runs, catalog + selected feature). The map is
  // only considered ready when ALL of them AND the basemap's own tile sources
  // report isSourceLoaded() AND the current viewport has no pending tiles —
  // i.e. the OSM vector tiles + every overlay/catalog layer have actually
  // painted, not merely been added.
  const overlayBuiltRef = useRef(false);
  const addedSourceIdsRef = useRef<Set<string>>(new Set());
  // Timestamp of the most recent dataloading/sourcedataloading event. The overlay
  // only dismisses once the map passes a full readiness battery for 3
  // consecutive polls (~750ms) with no in-flight requests in the last 650ms —
  // a single idle is NOT trusted because it can fire before the fitted region's
  // OSM tiles finish streaming.
  const lastDataLoadAtRef = useRef(0);
  // Timestamp of the most recent tile/data PROGRESS (anything arriving or being
  // requested). A slow-but-advancing OSM load must never be interrupted, so the
  // map is only force-dismissed when loading has made zero progress for a long
  // while (a real stall), never merely because a huge district takes time.
  const lastLoadProgressAtRef = useRef(Date.now());
  const mountStartAtRef = useRef(Date.now());
  const cleanPollsRef = useRef(0);

  const verifyAndDismiss = useCallback(() => {
    const map = mapRef.current;
    const now = Date.now();
    // Stall failsafe: if the basemap/catalog loading has made NO progress for a
    // long window (nothing requested AND nothing arrived), the request is hung —
    // force-dismiss so the UI is never blocked forever. Ongoing tile traffic
    // keeps this branch inert no matter how long the district takes.
    if (
      map &&
      overlayBuiltRef.current &&
      now - mountStartAtRef.current > 15000 &&
      now - lastLoadProgressAtRef.current > 15000
    ) {
      setReady(true);
      return;
    }
    if (!map || !overlayBuiltRef.current) { cleanPollsRef.current = 0; return; }
    if (!map.loaded() || !map.isStyleLoaded()) { cleanPollsRef.current = 0; return; }
    if (map.isMoving() || map.isZooming() || map.isRotating()) { cleanPollsRef.current = 0; return; }
    if (!map.areTilesLoaded()) { cleanPollsRef.current = 0; return; }
    if (now - lastDataLoadAtRef.current < 650) { cleanPollsRef.current = 0; return; }

    let allLoaded = true;
    try {
      const style = map.getStyle();
      const styleSources = style?.sources ? Object.keys(style.sources) : [];
      for (const id of styleSources) {
        if (map.getSource(id) && !map.isSourceLoaded(id)) {
          allLoaded = false;
          break;
        }
      }
    } catch {
      allLoaded = false;
    }
    if (allLoaded) {
      addedSourceIdsRef.current.forEach((id) => {
        if (!allLoaded) return;
        const src = map.getSource(id);
        if (src && !map.isSourceLoaded(id)) allLoaded = false;
      });
    }
    if (!allLoaded) { cleanPollsRef.current = 0; return; }

    // Sustained-clean window required so late tile batches reset the counter.
    cleanPollsRef.current += 1;
    if (cleanPollsRef.current >= 3) setReady(true);
  }, []);

  useEffect(() => {
    const poll = window.setInterval(verifyAndDismiss, 300);
    // Absolute escape hatch (background tabs / paused renderer): the overlay can
    // never outlast this, regardless of stalled state.
    const failsafe = window.setTimeout(() => setReady(true), 120000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(failsafe);
    };
  }, [verifyAndDismiss]);

  // Refs for values that should NOT trigger a full overlay rebuild
  // (style-only changes are applied via setPaintProperty in separate effects)
  const catalogLayersRef        = useRef<CatalogVectorLayer[]>(catalogLayers);
  const systemStylesRef         = useRef<SystemLayerStyles | undefined>(systemStyles);
  const selectedFeatureRef      = useRef<any>(selectedFeature);
  const prevCatalogFingerprintRef = useRef<string>('');
  const show3DRef = useRef(show3D);

  catalogLayersRef.current   = catalogLayers;
  systemStylesRef.current    = systemStyles;
  selectedFeatureRef.current = selectedFeature;
  show3DRef.current          = show3D;


  const buildOverlay = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const catalogLayers = catalogLayersRef.current;
    const systemStyles  = systemStylesRef.current;
    // selectedFeature is read from selectedFeatureRef.current later where needed

    dynamicLayersRef.current.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    dynamicSourcesRef.current.forEach((id) => {
      if (map.getSource(id)) map.removeSource(id);
    });
    BASE_LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    BASE_SOURCE_IDS.forEach((id) => {
      if (map.getSource(id)) map.removeSource(id);
    });

    dynamicLayersRef.current = [];
    dynamicSourcesRef.current = [];

    // 1. Dim the non-selected regions so the selected one stands out.
    if (dimmedRegionsGeojson?.features) {
      map.addSource('ra-dim', { type: 'geojson', data: dimmedRegionsGeojson });
      addedSourceIdsRef.current.add('ra-dim');
      map.addLayer({
        id: 'ra-dim',
        type: 'fill',
        source: 'ra-dim',
        paint: { 'fill-color': '#0b1220', 'fill-opacity': 0.45 }
      });
    }

    // 2. Selected region: boundary line and optional fill.
    if (districtGeojson?.features) {
      const boundaryVisible = systemStyles?.districtBoundary?.visible !== false;
      const boundaryColor = systemStyles?.districtBoundary?.color || '#000000';
      const boundaryOpacity = boundaryVisible ? (systemStyles?.districtBoundary?.opacity ?? 1) : 0;
      const boundaryWidth = systemStyles?.districtBoundary?.strokeWidth ?? 2.5;

      map.addSource('ra-districts', { type: 'geojson', data: districtGeojson });
      addedSourceIdsRef.current.add('ra-districts');
      map.addLayer({
        id: 'ra-districts',
        type: 'fill',
        source: 'ra-districts',
        paint: { 'fill-color': '#0b1220', 'fill-opacity': 0 }
      });
      map.addLayer({
        id: 'ra-districts-line',
        type: 'line',
        source: 'ra-districts',
        paint: {
          'line-color': boundaryColor,
          'line-opacity': boundaryOpacity,
          'line-width': boundaryWidth
        }
      });
    }

    // 3. User Catalog Vector Layers (rendered below baseline lines so road analysis remains clear)
    catalogLayers.forEach((catLayer) => {
      if (!catLayer.visible || !catLayer.geojson) return;

      const srcId = `ra-cat-${catLayer.id}`;
      map.addSource(srcId, { type: 'geojson', data: catLayer.geojson });
      addedSourceIdsRef.current.add(srcId);
      dynamicSourcesRef.current.push(srcId);

      const color = catLayer.color || '#38bdf8';
      const opacity = Math.max(0.01, Math.min(1, catLayer.opacity ?? 0.85));
      const strokeWidth = catLayer.strokeWidth ?? 3;
      const pointRadius = catLayer.pointRadius ?? 5;
      const geomType = catLayer.geometryType || 'Point';

      const clickableLayerIds: string[] = [];

      // Dash array according to strokeStyle
      let dashArray: number[] | undefined;
      if (catLayer.strokeStyle === 'dashed') dashArray = [3, 2];
      else if (catLayer.strokeStyle === 'dotted') dashArray = [1, 2];

      // Render Polygons (fills and outlines)
      if (geomType === 'Polygon' || geomType === 'Mixed') {
        const fillId = `${srcId}-fill`;
        const outlineId = `${srcId}-poly-line`;
        const fillColor = catLayer.fillColor || color;
        const fillOpacity = catLayer.fillOpacity !== undefined ? catLayer.fillOpacity : opacity * 0.4;

        map.addLayer({
          id: fillId,
          type: 'fill',
          source: srcId,
          paint: {
            'fill-color': fillColor,
            'fill-opacity': fillOpacity
          }
        });

        const linePaint: any = {
          'line-color': color,
          'line-opacity': opacity,
          'line-width': strokeWidth
        };
        if (dashArray) linePaint['line-dasharray'] = dashArray;

        map.addLayer({
          id: outlineId,
          type: 'line',
          source: srcId,
          paint: linePaint
        });
        dynamicLayersRef.current.push(fillId, outlineId);
        clickableLayerIds.push(fillId);
      }

      // Render Lines
      if (geomType === 'LineString' || geomType === 'Mixed') {
        const lineId = `${srcId}-line`;
        const linePaint: any = {
          'line-color': color,
          'line-opacity': opacity,
          'line-width': strokeWidth
        };
        if (dashArray) linePaint['line-dasharray'] = dashArray;

        map.addLayer({
          id: lineId,
          type: 'line',
          source: srcId,
          paint: linePaint
        });
        dynamicLayersRef.current.push(lineId);
        clickableLayerIds.push(lineId);
      }

      // Render Points
      if (geomType === 'Point' || geomType === 'Mixed') {
        const ptId = `${srcId}-circle`;
        map.addLayer({
          id: ptId,
          type: 'circle',
          source: srcId,
          paint: {
            'circle-color': color,
            'circle-opacity': opacity,
            'circle-radius': pointRadius,
            'circle-stroke-color': catLayer.pointStrokeColor || '#ffffff',
            'circle-stroke-width': catLayer.pointStrokeWidth ?? 1.5
          }
        });
        dynamicLayersRef.current.push(ptId);
        clickableLayerIds.push(ptId);
      }

      // Render Feature Labels on map if enabled
      if (catLayer.showLabels) {
        const sampleFeat = catLayer.geojson?.features?.[0];
        const props = sampleFeat?.properties || {};
        const propKeys = Object.keys(props);
        const labelField =
          catLayer.labelField ||
          propKeys.find((k) =>
            /^(name|label|id|title|station|grid|district|code|road)/i.test(k)
          ) ||
          propKeys[0];

        if (labelField) {
          const labelId = `${srcId}-labels`;
          const isBold = catLayer.labelBold ?? false;
          const haloColor = catLayer.labelHaloColor || '#090d16';
          const haloWidth = catLayer.labelHaloWidth ?? 2;
          const minZoom = catLayer.labelMinZoom ?? 0;
          map.addLayer({
            id: labelId,
            type: 'symbol',
            source: srcId,
            minzoom: minZoom,
            layout: {
              'text-field': ['to-string', ['get', labelField]],
              'text-size': catLayer.labelSize || 11,
              'symbol-placement': geomType === 'LineString' ? 'line-center' : 'point',
              'text-offset': geomType === 'Point' ? [0, 1.2] : [0, 0],
              'text-anchor': geomType === 'Point' ? 'top' : 'center',
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-max-width': 10,
              ...(isBold ? { 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] } : {})
            },
            paint: {
              'text-color': catLayer.labelColor || '#f8fafc',
              'text-halo-color': haloColor,
              'text-halo-width': haloWidth
            }
          });
          dynamicLayersRef.current.push(labelId);
        }
      }

      // Interactive popup on feature click
      clickableLayerIds.forEach((layerId) => {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = '';
        });
        map.on('click', layerId, (e) => {
          // If a point on ra-captured was clicked at this same location, suppress polygon popup
          if (map.getLayer('ra-captured')) {
            const renderedPoints = map.queryRenderedFeatures(e.point, { layers: ['ra-captured'] });
            if (renderedPoints && renderedPoints.length > 0) return;
          }
          const feat = e.features?.[0];
          if (!feat) return;
          const props = feat.properties || {};
          const propKeys = Object.keys(props).slice(0, 6);
          const coords = e.lngLat;

          const rowsHtml = propKeys
            .map(
              (k) =>
                `<div style="display: flex; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
                   <span style="color: #94a3b8; text-transform: capitalize;">${k}:</span>
                   <span style="font-weight: 600; color: #f1f5f9; text-align: right; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${String(props[k])}</span>
                 </div>`
            )
            .join('');

          new maplibregl.Popup({ className: 'custom-panotrack-popup', offset: 8 })
            .setLngLat(coords)
            .setHTML(`
              <div style="font-family: system-ui, sans-serif; font-size: 11px; line-height: 1.4; color: #f1f5f9; background: #0f172a; padding: 7px 10px; border-radius: 8px; border: 1px solid ${color}60; box-shadow: 0 4px 14px rgba(0,0,0,0.55); min-width: 170px;">
                <div style="display: flex; items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
                  <span style="font-weight: 700; color: ${color}; font-size: 12px;">
                    ${catLayer.name}
                  </span>
                  <span style="font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 3px; background: ${color}20; color: ${color}; border: 1px solid ${color}40;">
                    ${catLayer.geometryType}
                  </span>
                </div>
                ${rowsHtml || '<span style="color: #94a3b8;">No attribute table found.</span>'}
                <div style="color: #64748b; font-size: 9px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 3px;">
                  ${coords.lat.toFixed(5)}° N, ${coords.lng.toFixed(5)}° E
                </div>
              </div>
            `)
            .addTo(map);
        });
      });
    });

    // 4. Extracted / Road Plan Lines (Option A / Option B roads)
    if (roadRuns.length > 0) {
      const planVisible = showRoadLines && (systemStyles?.roadPlan?.visible !== false);
      const planColor = systemStyles?.roadPlan?.color || '#10b981';
      const planOpacity = planVisible ? (systemStyles?.roadPlan?.opacity ?? 0.85) : 0;
      const planWidth = systemStyles?.roadPlan?.strokeWidth ?? 3.5;

      map.addSource('ra-roads', { type: 'geojson', data: extractLineStringRuns(roadRuns) });
      addedSourceIdsRef.current.add('ra-roads');
      map.addLayer({
        id: 'ra-roads',
        type: 'line',
        source: 'ra-roads',
        paint: {
          'line-color': planColor,
          'line-width': planWidth,
          'line-opacity': planOpacity
        }
      });
      map.setLayoutProperty('ra-roads', 'visibility', planVisible ? 'visible' : 'none');
    }

    // 5. Captured panotrack points (individual survey frames, colored by status).
    if (capturedPoints.length > 0) {
      const ptVisible = systemStyles?.capturedPoints?.visible !== false;
      const ptOpacity = ptVisible ? (systemStyles?.capturedPoints?.opacity ?? 0.95) : 0;
      const ptRadius = systemStyles?.capturedPoints?.pointRadius;

      map.addSource('ra-captured', {
        type: 'geojson',
        data: extractPointCollection(capturedPoints, catalogLayersRef.current)
      });
      addedSourceIdsRef.current.add('ra-captured');
      map.addLayer({
        id: 'ra-captured',
        type: 'circle',
        source: 'ra-captured',
        paint: {
          'circle-radius': ptRadius
            ? ptRadius
            : [
                'interpolate',
                ['linear'],
                ['zoom'],
                6, 3,
                11, 4.5,
                15, 7
              ],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-opacity': ptOpacity
        }
      });

      // Pointer cursor on hover
      map.on('mouseenter', 'ra-captured', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'ra-captured', () => {
        map.getCanvas().style.cursor = '';
      });

      // Click popup on panotrack point
      map.on('click', 'ra-captured', (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const coords = (feat.geometry as any).coordinates.slice();
        const p = feat.properties || {};
        if (p.subgrid || p.spatialSubgrid) {
          onSelectSubgrid?.(p.subgrid || p.spatialSubgrid);
        }
        const color = p.color || '#10b981';
        const isDef = color === '#ef4444' || p.status === 'defect';
        const isTransit = p.relationType === 'INTERSECT';
        const isMismatch = p.relationType === 'MISMATCH';

        const statusLabel = isDef
          ? 'DEFECT'
          : isMismatch
          ? 'DATA MISMATCH'
          : isTransit
          ? 'TRANSIT'
          : (p.status || 'ACTIVE');

        new maplibregl.Popup({ className: 'custom-panotrack-popup', offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 11px; line-height: 1.4; color: #f1f5f9; background: #0f172a; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 4px 14px rgba(0,0,0,0.6); min-width: 190px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 3px;">
                <span style="font-weight: 700; color: #f1f5f9; font-size: 12px; font-family: monospace;">
                  ${p.subgrid || 'Panotrack Point'}
                </span>
                <span style="font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1.5px 5px; border-radius: 3px; background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.15);">
                  ${statusLabel}
                </span>
              </div>
              ${p.filename ? `<div style="color: #94a3b8; font-family: monospace; font-size: 10px; word-break: break-all; margin-bottom: 3px;">${p.filename}</div>` : ''}

              ${p.transitNote ? `
                <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 10px; color: #cbd5e1;">
                  <div style="color: #94a3b8; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1px;">Transit Note</div>
                  <div style="line-height: 1.35;">${p.transitNote}</div>
                </div>
              ` : ''}

              ${p.spatialSubgrid && p.spatialSubgrid !== p.subgrid ? `
                <div style="margin-top: 3px; font-size: 10px; color: #94a3b8;">
                  Physical Grid: <span style="color: #f1f5f9; font-family: monospace; font-weight: 600;">${p.spatialSubgrid}</span>
                </div>
              ` : ''}

              <div style="color: #64748b; font-size: 9px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 3px;">
                ${Number(coords[1]).toFixed(5)}° N, ${Number(coords[0]).toFixed(5)}° E
              </div>
            </div>
          `)
          .addTo(map);
      });
    }

    // 6. Persistent selected-feature highlight source (all geometry types via filter).
    //    Data is updated via setData() in a dedicated effect — no full rebuild needed.
    const selSrcId = 'ra-selected-feature';
    map.addSource(selSrcId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    addedSourceIdsRef.current.add(selSrcId);
    dynamicSourcesRef.current.push(selSrcId);

    map.addLayer({
      id: 'ra-sel-fill', type: 'fill', source: selSrcId,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: { 'fill-color': '#facc15', 'fill-opacity': 0.35 }
    });
    map.addLayer({
      id: 'ra-sel-poly-line', type: 'line', source: selSrcId,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: { 'line-color': '#facc15', 'line-width': 4.5, 'line-opacity': 1 }
    });
    map.addLayer({
      id: 'ra-sel-casing', type: 'line', source: selSrcId,
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      paint: { 'line-color': '#ca8a04', 'line-width': 8, 'line-opacity': 0.6 }
    });
    map.addLayer({
      id: 'ra-sel-line', type: 'line', source: selSrcId,
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      paint: { 'line-color': '#facc15', 'line-width': 4.5, 'line-opacity': 1 }
    });
    map.addLayer({
      id: 'ra-sel-glow', type: 'circle', source: selSrcId,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      paint: { 'circle-radius': 14, 'circle-color': '#facc15', 'circle-opacity': 0.45 }
    });
    map.addLayer({
      id: 'ra-sel-point', type: 'circle', source: selSrcId,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      paint: {
        'circle-radius': 7.5, 'circle-color': '#facc15',
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5
      }
    });
    dynamicLayersRef.current.push(
      'ra-sel-fill', 'ra-sel-poly-line', 'ra-sel-casing',
      'ra-sel-line', 'ra-sel-glow', 'ra-sel-point'
    );

    // Immediately populate with the current selection (if any)
    if (selectedFeatureRef.current?.geometry) {
      (map.getSource(selSrcId) as any).setData({
        type: 'FeatureCollection',
        features: [selectedFeatureRef.current]
      });
    }

    // Record catalog structural fingerprint so the catalog effect can decide
    // between a full rebuild and an in-place style update.
    prevCatalogFingerprintRef.current = computeStructuralFingerprint(catalogLayers);

    // Fit the map to the region or panotracks only when the spatial extent actually changes.
    const fitBounds = () => {
      const bboxKey = bbox ? bbox.join(',') : '';
      if (bbox && bboxKey !== lastFittedBboxRef.current) {
        lastFittedBboxRef.current = bboxKey;
        map.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: 28, maxZoom: 15 }
        );
        return;
      }
      if (!bbox && lastFittedBboxRef.current === '') {
        const allCoords: Array<[number, number]> = [];
        roadRuns.forEach((r) => r.forEach((p) => allCoords.push(p)));
        capturedPoints.forEach((p) => {
          const lng = Array.isArray(p) ? p[0] : (p.lng ?? p.lon ?? p.longitude);
          const lat = Array.isArray(p) ? p[1] : (p.lat ?? p.latitude);
          if (Number.isFinite(lng) && Number.isFinite(lat)) {
            allCoords.push([lng, lat]);
          }
        });
        if (allCoords.length > 0) {
          const [minLng, maxLng] = minMaxOf(allCoords.map((p) => p[0]));
          const [minLat, maxLat] = minMaxOf(allCoords.map((p) => p[1]));
          lastFittedBboxRef.current = 'points-fitted';
          map.fitBounds(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: 36, maxZoom: 15 }
          );
        }
      }
    };
    fitBounds();

    // 7. Re-apply the3D building layer whenever the basemap is rebuilt (a style
    //    swap recreates the Map, so the previous fill-extrusion layer is gone).
    applyBuildingLayer(map, show3DRef.current);

    // 8. Everything (style + boundary + points + roads) is now painted.
    overlayBuiltRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, districtGeojson, dimmedRegionsGeojson, capturedPoints, roadRuns, showRoadLines]);
  // catalogLayers, systemStyles, selectedFeature intentionally omitted — they are
  // read from refs inside the callback and handled by dedicated effects below.

  // ── Selected feature: update the persistent source via setData (zero flash) ──
  useEffect(() => {
    if (selectedPopupRef.current) {
      selectedPopupRef.current.remove();
      selectedPopupRef.current = null;
    }
    const map = mapRef.current;
    const selSrc = map?.getSource?.('ra-selected-feature') as any;
    if (!selSrc?.setData) return;
    selSrc.setData({
      type: 'FeatureCollection' as const,
      features: selectedFeature?.geometry ? [selectedFeature] : []
    });
  }, [selectedFeature]);

  // ── Catalog layers: full rebuild only on structural changes; setPaintProperty otherwise ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const fingerprint = computeStructuralFingerprint(catalogLayers);
    if (fingerprint !== prevCatalogFingerprintRef.current) {
      // Structural change (layer added/removed, visibility toggled, geomType changed):
      // trigger a full rebuild which will also reset prevCatalogFingerprintRef.
      prevCatalogFingerprintRef.current = fingerprint;
      buildOverlayRef.current?.();
      return;
    }

    // Style-only change → update paint/layout properties in place (no flash)
    for (const catLayer of catalogLayers) {
      if (!catLayer.geojson) continue;
      updateCatalogLayerStyle(map, catLayer, `ra-cat-${catLayer.id}`);
    }
  }, [catalogLayers]);

  // ── System styles: setPaintProperty only (never tears down layers) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    applySystemStyles(map, systemStyles, showRoadLines);
  }, [systemStyles, showRoadLines]);

  // Zoom to layer bounding box when requested by catalog
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusBbox) return;
    const [minLng, minLat, maxLng, maxLat] = focusBbox;
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) return;
    if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) return;

    if (minLng === maxLng && minLat === maxLat) {
      map.easeTo({ center: [minLng, minLat], zoom: 14 });
    } else {
      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 40, maxZoom: 16 }
      );
    }
  }, [focusBbox]);

function areStylesEqual(a?: string | StyleSpecification, b?: string | StyleSpecification): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

  buildOverlayRef.current = buildOverlay;

  const initMap = useCallback((container: HTMLDivElement, styleVal?: string | StyleSpecification) => {
    const map = new maplibregl.Map({
      container,
      style: styleVal || DEFAULT_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false
    });
    mapRef.current = map;
    if (mapInstanceRef) mapInstanceRef.current = map;
    map.on('load', () => {
      styleLoadedRef.current = true;
      lastLoadProgressAtRef.current = Date.now();
      buildOverlayRef.current?.();
    });
    // Every tile/data request arrival or start is latched — the polling
    // readiness check (`verifyAndDismiss`) only dismisses the overlay once the
    // map has been fully clean (no requests) for a sustained window, and the
    // stall failsafe stays inert while ANY tile traffic is making progress, so
    // OSM tiles for a large fitted district keep the spinner up until they
    // actually paint.
    const markProgress = () => {
      const now = Date.now();
      lastDataLoadAtRef.current = now;
      lastLoadProgressAtRef.current = now;
    };
    map.on('dataloading', markProgress);
    map.on('sourcedataloading', markProgress);
    map.on('sourcedata', (e) => {
      if ((e as { isSourceLoaded?: boolean }).isSourceLoaded === false) {
        markProgress();
      }
    });
    map.on('error', (e) => {
      // Non-fatal warning for individual missing tiles / network drops
      console.warn('[RoadAnalysisMap] MapLibre warning/error:', e);
    });
    return map;
  }, [mapInstanceRef]);

  // Create the map once on mount with the initial style.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = initMap(containerRef.current, style);
    mapRef.current = map;
    return () => {
      // Always remove the currently-active map. The basemap-change effect may
      // have recreated mapRef.current after this effect mounted, so read the
      // live reference rather than the one captured at initialization to avoid
      // leaking the replaced map.
      const current = mapRef.current;
      if (current) {
        current.remove();
        mapRef.current = null;
        if (mapInstanceRef) mapInstanceRef.current = null;
      }
      styleLoadedRef.current = false;
    };
    // Init with the initial style only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild overlay when the underlying data / toggle changes.
  useEffect(() => {
    if (mapRef.current) buildOverlay();
  }, [buildOverlay]);

  // When the basemap choice changes, recreate the Map with the new style.
  // Recreating (rather than setStyle) reliably restores the overlay layers on
  // the next 'load', so the region boundary and road lines never get lost.
  const prevStyleRef = useRef(style);
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    if (areStylesEqual(prevStyleRef.current, style)) return;
    const camera = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch()
    };
    prevStyleRef.current = style;
    map.remove();
    mapRef.current = null;
    styleLoadedRef.current = false;
    overlayBuiltRef.current = false;
    cleanPollsRef.current = 0;
    lastLoadProgressAtRef.current = Date.now();
    mountStartAtRef.current = Date.now();
    setReady(false);
    const next = initMap(container, style);
    next.jumpTo(camera);
    mapRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, initMap]);

  // Continuously observe container resizing (sidebar toggle, layout reflow, window resize)
  // Debounced to avoid rapid canvas redraws / white flashes during CSS transitions
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastW = container.clientWidth;
    let lastH = container.clientHeight;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Ignore small changes (< 10px) to filter out CSS transition noise
      if (Math.abs(width - lastW) < 10 && Math.abs(height - lastH) < 10) return;
      lastW = width;
      lastH = height;

      if (resizeTimer !== null) clearTimeout(resizeTimer);
      // Debounce: wait 150ms after last resize event before calling map.resize()
      resizeTimer = setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.resize();
        }
        resizeTimer = null;
      }, 150);
    });
    ro.observe(container);
    return () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      ro.disconnect();
    };
  }, []);

  // Resize when the surface becomes visible from a hidden state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (active) {
      requestAnimationFrame(() => map.resize());
    }
  }, [active]);

  // ── 3D Buildings: add/remove fill-extrusion layer on toggle ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    applyBuildingLayer(map, show3D);
  }, [show3D]);

  // ── 2D↔3D Camera FLIGHT: swoop down to / up from the 3D surface view ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const stop = startCameraFlight(map, show3D
      ? { targetPitch: 60, targetBearing: map.getBearing(), duration: 2600 }
      : { targetPitch: 0, targetBearing: 0, duration: 2200 }
    );

    // Let the user's own gestures take over if they drag mid-flight.
    const interrupt = () => stop();
    map.on('movestart', interrupt);
    map.on('dragstart', interrupt);

    return () => {
      map.off('movestart', interrupt);
      map.off('dragstart', interrupt);
      stop();
    };
  }, [show3D]);

  return (
    <div
      className="absolute inset-0 w-full h-full z-0 bg-slate-950"
      style={{ backgroundColor: 'var(--bg-app, #0f172a)' }}
    >
      {/* Map container keeps being populated by MapLibre, but the parent renders
          it inside a 0-sized wrapper while hidden — so the ref'd div is absolute. */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Loading overlay: shown while the style + OSM points + geometry render */}
      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-app/70 backdrop-blur-[2px] pointer-events-none select-none">
          <div className="flex flex-col items-center gap-3">
            <div className="relative h-10 w-10">
              <div className="absolute inset-0 rounded-full border-2 border-sky-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-sky-400 animate-spin" />
            </div>
            <div className="text-center px-6">
              <div className="text-xs sm:text-sm font-semibold text-text-base">Preparing road analysis map…</div>
              <div className="text-[11px] text-text-muted mt-0.5">Loading OSM data &amp; district geometry</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const RoadAnalysisMap = React.memo(RoadAnalysisMapComponent);

