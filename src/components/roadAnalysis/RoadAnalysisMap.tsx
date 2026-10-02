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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification, Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Let Vite resolve & serve maplibre's worker as a proper asset instead of
// maplibre self-constructing its own worker path (which Vite dev serves with
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { CatalogVectorLayer } from '../../utils/gisImportParser';
import { estimateGeometryBytes, stripEnvelopeFeatures } from '../../utils/gisImportParser';
import type { ImportPreview } from './RoadImportPanel';
import { type SystemLayerStyles } from './RoadCatalogPanel';
import { resolveSpatialSubgrid } from '../../utils/subgridComparison';
import { getCatalogSamplePropKeys, pickCatalogLabelField } from '../../utils/catalogLayerLabels';
import { extractSubgridName } from '../../utils/subgrid';
import { minMaxOf } from '../../utils/arrayBounds';
import type { LonLat } from '../../utils/roadNetworkTrace';
import {
  type LightingPreset,
  type ColorThemePreset,
  applyLightingToMap,
  applyAtmosphereTintToMap,
  toggleMapLabelsVisibility,
  findFirstSymbolLayerId,
  buildBuildingColorExpression,
  buildBuildingHeightExpression
} from '../../utils/map3DLighting';
import {
  buildMeshRoadChoroplethGeojson,
  hexToRgba,
  type ExplorerChoroplethPalette,
  type ExplorerGridSpec,
  type MeshCellData,
  type MeshGridInfo
} from '../../utils/projectExplorerGeometry';
import {
  buildMeshExpression,
  colorForValue,
  resolveSetting,
  type ChoroplethSettingsMap
} from '../../utils/choroplethSettings';

const effectiveWorkerUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPLIBRE_WORKER_URL) || workerUrl;
maplibregl.setWorkerUrl(effectiveWorkerUrl);

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const EMPTY_COVERAGE_RUNS: LonLat[][] = [];

// Catalog layers at/above this feature count (or estimated serialized size)
// are registered on the map immediately with empty data and fed to MapLibre
// asynchronously at idle. A full-country road network can otherwise block the
// main thread for seconds while the geojson source builds its index/tile tree.
const HEAVY_CATALOG_FEATURE_COUNT = 4000;
const HEAVY_CATALOG_BYTES = 1_500_000;

/** Live import-preview overlay (Original vs Clipped dataset) during clip-confirmation. */
const PREVIEW_SRC = 'ra-cat-preview';
const PREVIEW_LAYER_IDS = [
  'ra-preview-fill',
  'ra-preview-poly-line',
  'ra-preview-casing',
  'ra-preview-line',
  'ra-preview-point'
] as const;

/**
 * Pushes a large catalog layer's geometry into an already-registered geojson
 * source off the critical path, so the first committed frame paints before
 * MapLibre ingests the dataset on its worker + main-thread clone.
 */
/**
 * Pushes a large catalog layer's geometry into an already-registered geojson
 * source off the critical path, so the first committed frame paints before
 * MapLibre ingests the dataset. When the geometry is heavy we hand MapLibre a
 * blob URL *string* instead of the raw object: maplibre fetches the blob and
 * parses the JSON in its own web worker, so the 20k-feature / 39 MB graph is
 * never structured-cloned on the main thread (which is what froze the page).
 */
function scheduleCatalogGeometryLoad(
  map: MaplibreMap,
  pending: Array<{ srcId: string; geojson: any; geojsonJson?: string; isPolyType?: boolean }>
): void {
  const blobUrls: string[] = [];
  const flush = () => {
    for (const { srcId, geojson, geojsonJson, isPolyType } of pending) {
      const src = map.getSource(srcId);
      if (src && typeof (src as any).setData === 'function') {
        let json = geojsonJson;
        if (isPolyType) {
          try {
            const parsed = geojson || (geojsonJson ? JSON.parse(geojsonJson) : null);
            if (parsed) {
              const stripped = stripEnvelopeFeatures(parsed);
              json = JSON.stringify(stripped);
            }
          } catch {}
        }
        if (!json && geojson) {
          json = JSON.stringify(geojson);
        }
        const url = URL.createObjectURL(new Blob([json || '{"type":"FeatureCollection","features":[]}'], { type: 'application/geo+json' }));
        blobUrls.push(url);
        (src as any).setData(url);
      }
    }
    if (blobUrls.length > 0 && typeof window.setTimeout === 'function') {
      window.setTimeout(() => blobUrls.forEach((u) => URL.revokeObjectURL(u)), 20000);
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(flush, { timeout: 3000 });
  } else {
    let frames = 0;
    const afterPaint = () => {
      frames++;
      if (frames >= 2) flush();
      else requestAnimationFrame(afterPaint);
    };
    requestAnimationFrame(afterPaint);
  }
}



function stitchConnectedRuns(runs: LonLat[][]): LonLat[][] {
  if (!runs || runs.length <= 1) return runs || [];
  const valid = runs.filter((r) => Array.isArray(r) && r.length >= 2);
  if (valid.length <= 1) return valid;

  const coordKey = (p: LonLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const pool = valid.map((r) => r.slice());
  const used = new Uint8Array(pool.length);

  const endpointMap = new Map<string, number[]>();
  for (let i = 0; i < pool.length; i++) {
    const sKey = coordKey(pool[i][0]);
    const eKey = coordKey(pool[i][pool[i].length - 1]);
    const sList = endpointMap.get(sKey);
    if (sList) sList.push(i);
    else endpointMap.set(sKey, [i]);
    const eList = endpointMap.get(eKey);
    if (eList) eList.push(i);
    else endpointMap.set(eKey, [i]);
  }

  const stitched: LonLat[][] = [];

  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = pool[i];

    // Extend forward
    let extended = true;
    while (extended) {
      extended = false;
      const endKey = coordKey(chain[chain.length - 1]);
      const matches = endpointMap.get(endKey);
      if (matches) {
        for (const j of matches) {
          if (used[j]) continue;
          const cand = pool[j];
          if (coordKey(cand[0]) === endKey) {
            used[j] = 1;
            for (let k = 1; k < cand.length; k++) chain.push(cand[k]);
            extended = true;
            break;
          } else if (coordKey(cand[cand.length - 1]) === endKey) {
            used[j] = 1;
            for (let k = cand.length - 2; k >= 0; k--) chain.push(cand[k]);
            extended = true;
            break;
          }
        }
      }
    }

    // Extend backward
    extended = true;
    while (extended) {
      extended = false;
      const startKey = coordKey(chain[0]);
      const matches = endpointMap.get(startKey);
      if (matches) {
        for (const j of matches) {
          if (used[j]) continue;
          const cand = pool[j];
          if (coordKey(cand[cand.length - 1]) === startKey) {
            used[j] = 1;
            const newChain = cand.slice();
            for (let k = 1; k < chain.length; k++) newChain.push(chain[k]);
            chain = newChain;
            extended = true;
            break;
          } else if (coordKey(cand[0]) === startKey) {
            used[j] = 1;
            const newChain: LonLat[] = [];
            for (let k = cand.length - 1; k >= 0; k--) newChain.push(cand[k]);
            for (let k = 1; k < chain.length; k++) newChain.push(chain[k]);
            chain = newChain;
            extended = true;
            break;
          }
        }
      }
    }

    stitched.push(chain);
  }

  return stitched;
}

function coverageLineFc(runs: LonLat[][]): GeoJSON.FeatureCollection {
  const stitched = stitchConnectedRuns(runs);
  return {
    type: 'FeatureCollection',
    features: (stitched || [])
      .filter((r) => Array.isArray(r) && r.length >= 2)
      .map((r) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: r.map((p) => p.slice() as [number, number]) }
      }))
  };
}

/** Coverage overlay ids (rebuilt with the base layers, raised above them). */
const COVERAGE_LAYER_IDS = ['ra-coverage-casing', 'ra-coverage-line'] as const;

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
  /**
   * Live import-preview overlay (Original vs Clipped dataset) shown while the
   * user decides whether to clip a file that exceeds the selected region.
   */
  catalogPreview?: ImportPreview | null;
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
  /** Active 3D lighting preset ('dawn' | 'day' | 'dusk' | 'night'). */
  lightingPreset?: LightingPreset;
  /** Active 3D building color theme ('default' | 'faded' | 'mono' | 'ocean' | 'warm' | 'vivid'). */
  colorTheme?: ColorThemePreset;
  /** Building height scale multiplier (e.g. 1.0, 1.5, 2.0). */
  heightScale?: number;
  /** Cinematic camera orbit active. */
  isOrbiting?: boolean;
  /** Callback notifying parent of current pitch changes. */
  onPitchChange?: (pitch: number) => void;
  /**
   * Optional ref filled with the live MapLibre map instance so parent
   * workspace panels (e.g. Print) can read the current camera/extent or
   * capture the canvas.
   */
  mapInstanceRef?: React.MutableRefObject<MaplibreMap | null>;
  /** Uncovered plan stretches (no panotrack within tolerance) drawn in red. */
  coverageRuns?: LonLat[][];
  /** Toggle the red coverage-segmentation overlay. */
  showCoverage?: boolean;
  /** Toggle visibility of basemap place names, street names, and POIs. Defaults to true. */
  showLabels?: boolean;
  /** Toggle atmospheric ground tinting for Dawn/Dusk/Night lighting. Defaults to true. */
  atmosphereTint?: boolean;
  /** Project Explorer: whether the buffer spotlight and density analysis is active */
  projectExplorerActive?: boolean;
  /** Project Explorer: center coordinate [lng, lat] of the buffer pin A */
  projectExplorerCenter?: [number, number] | null;
  /** Project Explorer: optional center coordinate [lng, lat] of buffer pin B in compare mode */
  projectExplorerCenterB?: [number, number] | null;
  /** Project Explorer: radius in meters */
  projectExplorerRadius?: number;
  /** Project Explorer: clipped road GeoJSON with density colors */
  projectExplorerRoadsGeojson?: GeoJSON.FeatureCollection | null;
  /** Project Explorer: callback when pin A is dragged or map is clicked */
  onProjectExplorerCenterChange?: (center: [number, number]) => void;
  /** Project Explorer: callback when pin B is dragged */
  onProjectExplorerCenterBChange?: (center: [number, number]) => void;
  /** Project Explorer: compare mode toggle */
  isCompareMode?: boolean;
  /** Project Explorer: active choropleth palette */
  projectExplorerPalette?: ExplorerChoroplethPalette;
  /** Subgrid metrics for mesh road density attribution */
  subgridMetrics?: any[];
  /** Project Explorer: Currently focused/selected subgrid cell data */
  selectedExplorerGrid?: MeshCellData | any | null;
  /** Project Explorer: Callback when user clicks a subgrid cell to focus and dim other areas */
  onSelectExplorerGrid?: (grid: any | null) => void;
  /** Project Explorer: active choropleth metric ('density' | 'complexity' | 'panotrack' | 'roads' | 'coverage') */
  projectExplorerColorByMetric?: string;
  /**
   * Project Explorer: operator-defined class breaks per metric. When supplied
   * these drive the map fill/legend/charts; otherwise the component falls back
   * to the built-in palette + threshold defaults.
   */
  choroplethSettings?: ChoroplethSettingsMap;
  /**
   * Reports the mesh cells upward so the Details card aggregates real values and
   * the settings editor can compute data-driven class breaks (natural / equal /
   * quantile) from them. Fires only when the measurements change, not on palette
   * or class edits.
   */
  /**
 * Publishes the measured mesh cells, plus the grid they were measured over.
 * Both come from one memoized build, so the provenance always describes the
 * data it accompanies.
 */
  onExplorerMeshCells?: (cells: MeshCellData[] | null, grid?: MeshGridInfo) => void;
  /**
   * Operator-declared grid geometry. Part of the mesh memo deps, so changing a
   * declared size rebuilds the cells rather than relabelling stale ones.
   */
  explorerGridSpec?: ExplorerGridSpec;
}

const DEFAULT_CENTER: [number, number] = [101.9758, 4.2105];
const DEFAULT_ZOOM = 7;
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** Base system source ids created by this component. */
const BASE_SOURCE_IDS = [
  'ra-dim',
  'ra-districts',
  'ra-captured',
  'ra-roads',
  'ra-coverage',
  'ra-explorer-mask',
  'ra-explorer-stroke',
  'ra-explorer-roads',
  'ra-explorer-mesh',
  'ra-explorer-selected-box'
] as const;

/** Base system layer ids created by this component. */
const BASE_LAYER_IDS = [
  'ra-dim',
  'ra-districts-line',
  'ra-explorer-mesh-fill',
  'ra-explorer-mesh-line',
  'ra-explorer-selected-fill',
  'ra-explorer-selected-line',
  'ra-captured-clusters',
  'ra-captured-cluster-count',
  'ra-captured',
  'ra-roads',
  'ra-coverage-casing',
  'ra-coverage-line',
  'ra-explorer-mask',
  'ra-explorer-roads',
  'ra-explorer-stroke'
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
 * Structural fingerprint: changes ONLY when layers are added/removed, or their
 * geometry type / dash pattern / label toggle changes.
 * Style-only changes (color, opacity, size, visibility …) do NOT change the
 * fingerprint — visibility is applied in-place via setLayoutProperty so toggling
 * a layer's eye icon never tears down and rebuilds the whole overlay (no blink).
 */
function computeStructuralFingerprint(layers: CatalogVectorLayer[]): string {
  return layers
    .map((l) =>
      [
        l.id,
        l.geometryType,
        l.showLabels ? '1' : '0',
        l.strokeStyle || 'solid',
        l.featureCount,
        // Geometry availability is structural: a layer rehydrated from IndexedDB
        // (or the cloud) after a reload arrives with `geojsonJson` filled in, and
        // must trigger a full rebuild so its source actually gets registered and
        // fed. Style-only edits never flip this bit.
        l.geojson || l.geojsonJson ? 'g1' : 'g0'
      ].join(':')
    )
    .join('|');
}

/**
 * Style-spec properties that MapLibre only accepts via setLayoutProperty.
 * Passing one of these to setPaintProperty throws, which aborts the enclosing
 * style update and leaves the layer half-applied — this exact mistake previously
 * broke `text-size` on the catalog label layer.
 */
const LAYOUT_ONLY_PROPS = new Set([
  'text-field', 'text-size', 'text-font', 'text-anchor', 'text-offset',
  'text-max-width', 'text-transform', 'text-letter-spacing', 'text-justify',
  'text-radial-offset', 'text-variable-anchor', 'text-rotation-alignment',
  'text-pitch-alignment', 'symbol-placement', 'symbol-spacing',
  'symbol-sort-key', 'symbol-z-order', 'text-allow-overlap',
  'text-ignore-placement', 'text-optional', 'visibility', 'fill-pattern',
  'line-pattern', 'line-cap', 'line-join', 'line-miter-limit',
  'line-round-limit', 'line-offset', 'circle-sort-key', 'fill-sort-key',
  'icon-image', 'icon-size', 'icon-rotate', 'icon-offset',
  'icon-anchor', 'icon-allow-overlap', 'icon-ignore-placement', 'icon-padding'
]);

/** Updates paint / layout properties of an already-rendered catalog layer in-place. */
function updateCatalogLayerStyle(
  map: MaplibreMap,
  catLayer: CatalogVectorLayer,
  srcId: string,
  isExplorerActive = false
): void {
  const sp = (id: string, prop: string, val: unknown) => {
    if (LAYOUT_ONLY_PROPS.has(prop)) {
      console.warn(
        `[RoadAnalysisMap] "${prop}" is a LAYOUT property on "${id}" — ` +
        `setPaintProperty would throw and abort the remaining style updates. ` +
        'Use sl() instead.'
      );
      if (map.getLayer(id)) (map as any).setLayoutProperty(id, prop, val);
      return;
    }
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
  sp(`${srcId}-fill`, 'fill-opacity',  catLayer.fillOpacity !== undefined ? catLayer.fillOpacity : 0);

  // Visibility is applied in-place so toggling a layer's eye icon never triggers
  // a full overlay rebuild. Explorer suppresses polygon fill + outline so the
  // choropleth mesh displays cleanly; all other layers honour `catLayer.visible`.
  const baseVisible = catLayer.visible !== false;
  const polyVisible = baseVisible && !isExplorerActive;
  sl(`${srcId}-fill`, 'visibility', polyVisible ? 'visible' : 'none');
  sl(`${srcId}-poly-line`, 'visibility', polyVisible ? 'visible' : 'none');
  sl(`${srcId}-line`, 'visibility', baseVisible ? 'visible' : 'none');
  sl(`${srcId}-circle`, 'visibility', baseVisible ? 'visible' : 'none');
  sl(`${srcId}-labels`, 'visibility', baseVisible ? 'visible' : 'none');

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
  // `text-size` is a LAYOUT property in the MapLibre style spec. Calling it via
  // setPaintProperty throws "text-size is a LAYOUT property, but it is being
  // set as a PAINT property", which aborts the rest of this function and leaves
  // the layer half-styled. Must go through sl().
  sp(`${srcId}-labels`, 'text-color',       catLayer.labelColor     || '#f8fafc');
  sp(`${srcId}-labels`, 'text-halo-color',  catLayer.labelHaloColor || '#090d16');
  sp(`${srcId}-labels`, 'text-halo-width',  catLayer.labelHaloWidth ?? 2);
  sl(`${srcId}-labels`, 'text-size',        catLayer.labelSize      || 11);
  const lf = pickCatalogLabelField(catLayer);
  if (lf) sl(`${srcId}-labels`, 'text-field', ['to-string', ['get', lf]]);
}

/** Detect whether the loaded style exposes the OpenMapTiles vector source. */
function styleHasVectorBuildings(map: MaplibreMap): boolean {
  try {
    const style = map.getStyle() as StyleSpecification;
    return !!style?.sources?.openmaptiles;
  } catch { return false; }
}

/** Toggle or update the 3D building fill-extrusion layer on/off. */
function applyBuildingLayer(
  map: MaplibreMap,
  show3D: boolean,
  colorTheme: ColorThemePreset = 'default',
  heightScale: number = 1.0
): void {
  const hasSource = styleHasVectorBuildings(map);
  const layerExists = Boolean(map.getLayer(BUILDING_LAYER_ID));

  if (show3D && hasSource) {
    const colorExpr = buildBuildingColorExpression(colorTheme);
    const heightExpr = buildBuildingHeightExpression(heightScale);

    if (!layerExists) {
      // Find the first symbol layer (place names, street labels, POIs)
      // so 3D buildings sit BENEATH them, allowing labels to float over rooftops.
      const firstSymbolId = findFirstSymbolLayerId(map);
      map.addLayer({
        id: BUILDING_LAYER_ID,
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': colorExpr as any,
          'fill-extrusion-height': heightExpr as any,
          'fill-extrusion-base': [
            'coalesce',
            ['get', 'render_min_height'],
            ['get', 'min_height'],
            0
          ],
          'fill-extrusion-opacity': 0.80
        }
      }, firstSymbolId);
    } else {
      map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-color', colorExpr as any);
      map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-height', heightExpr as any);
    }
  } else if ((!show3D || !hasSource) && layerExists) {
    map.removeLayer(BUILDING_LAYER_ID);
  }
}

/** Updates atmospheric basemap ground tint positioned below 3D buildings. */
function applyGroundAtmosphere(map: MaplibreMap, preset: LightingPreset, enabled: boolean): void {
  const beforeLayerId = map.getLayer(BUILDING_LAYER_ID)
    ? BUILDING_LAYER_ID
    : findFirstSymbolLayerId(map);
  applyAtmosphereTintToMap(map, preset, enabled, beforeLayerId);
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
  showRoadLines: boolean,
  isExplorerActive: boolean = false
): void {
  if (map.getLayer('ra-districts-line')) {
    const b = ss?.districtBoundary;
    map.setPaintProperty('ra-districts-line', 'line-color',   b?.color || '#000000');
    map.setPaintProperty('ra-districts-line', 'line-opacity',  b?.visible !== false ? (b?.opacity ?? 1) : 0);
    map.setPaintProperty('ra-districts-line', 'line-width',    b?.strokeWidth ?? 2.5);
  }
  if (map.getLayer('ra-roads')) {
    if (isExplorerActive) {
      // In explorer mode: road color gray (#9ca3af), opacity 30%
      map.setPaintProperty('ra-roads', 'line-color', '#9ca3af');
      map.setPaintProperty('ra-roads', 'line-opacity', 0.30);
      map.setPaintProperty('ra-roads', 'line-width', 1.8);
    } else {
      const rp = ss?.roadPlan;
      const vis = showRoadLines && (rp?.visible !== false);
      map.setPaintProperty('ra-roads', 'line-color',   rp?.color || '#10b981');
      map.setPaintProperty('ra-roads', 'line-opacity',  vis ? (rp?.opacity ?? 0.85) : 0);
      map.setPaintProperty('ra-roads', 'line-width',    rp?.strokeWidth ?? 3.5);
    }
  }
  if (map.getLayer('ra-captured')) {
    const cp = ss?.capturedPoints;
    map.setPaintProperty('ra-captured', 'circle-opacity', cp?.visible !== false ? (cp?.opacity ?? 0.95) : 0);
    if (cp?.pointRadius) map.setPaintProperty('ra-captured', 'circle-radius', cp.pointRadius);
  }
  if (map.getLayer('ra-captured-clusters')) {
    const cp = ss?.capturedPoints;
    map.setPaintProperty('ra-captured-clusters', 'circle-opacity', cp?.visible !== false ? (cp?.opacity ?? 0.95) : 0);
  }
  if (map.getLayer('ra-dim')) {
    const d = ss?.dimOutside;
    const dimVisible = d?.visible === true && !isExplorerActive;
    map.setPaintProperty('ra-dim', 'fill-color', d?.color || '#0b1220');
    map.setPaintProperty('ra-dim', 'fill-opacity', dimVisible ? (d?.opacity ?? 0.45) : 0);
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
  catalogPreview,
  systemStyles,
  focusBbox,
  selectedFeature,
  onSelectSubgrid,
  mapInstanceRef,
  show3D = false,
  lightingPreset = 'day',
  colorTheme = 'default',
  heightScale = 1.0,
  isOrbiting = false,
  onPitchChange,
  coverageRuns = EMPTY_COVERAGE_RUNS,
  showCoverage = true,
  showLabels = true,
  atmosphereTint = true,
  projectExplorerActive = false,
  projectExplorerCenter = null,
  projectExplorerCenterB = null,
  projectExplorerRadius = 1000,
  projectExplorerRoadsGeojson = null,
  onProjectExplorerCenterChange,
  onProjectExplorerCenterBChange,
  isCompareMode = false,
  projectExplorerPalette = 'viridis',
  subgridMetrics = [],
  selectedExplorerGrid = null,
  onSelectExplorerGrid,
  projectExplorerColorByMetric = 'density',
  choroplethSettings,
  onExplorerMeshCells,
  explorerGridSpec
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  const buildOverlayRef = useRef<(() => void) | null>(null);
  const dynamicLayersRef = useRef<string[]>([]);
  const dynamicSourcesRef = useRef<string[]>([]);
  // Cleanup callbacks for delegated per-layer listeners registered inside
  // buildOverlay. Removed before each rebuild so handlers never stack.
  const delegatedListenersRef = useRef<Array<() => void>>([]);
  // Source ids captured once per overlay build; the readiness poll iterates this
  // instead of calling map.getStyle() (a deep style serialization) every tick.
  const trackedSourceIdsRef = useRef<string[]>([]);
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
  // Timestamp of the most recent tile-load failure. A basemap whose tiles keep
  // erroring (blocked / throttled / dead custom or Google tile source) can never
  // satisfy areTilesLoaded(), so once a real error has been latched the overlay
  // concedes the basemap instead of waiting for tiles that will never paint.
  const lastTileErrorAtRef = useRef(0);

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
    // A basemap whose tiles keep erroring must not block the overlay forever.
    // After a short grace (mount + 8s) with no fresh tile error in the last
    // 800ms, tile sources are conceded — the "no progress" window below still
    // prevents dismissing an actively-streaming basemap, because any in-flight
    // request keeps lastDataLoadAtRef fresh.
    const toleratedTileErrors =
      lastTileErrorAtRef.current > 0 &&
      now - mountStartAtRef.current > 8000 &&
      now - lastTileErrorAtRef.current > 800;
    if (!map.areTilesLoaded() && !toleratedTileErrors) { cleanPollsRef.current = 0; return; }
    if (now - lastDataLoadAtRef.current < 650) { cleanPollsRef.current = 0; return; }

    // Iterate the cached source id list captured at build time — no per-tick
    // map.getStyle() serialization.
    let allLoaded = true;
    try {
      for (const id of trackedSourceIdsRef.current) {
        const src = map.getSource(id);
        if (!src) continue;
        // Geojson/canvas overlay sources (district, roads, captured points) are
        // always waited on; tile-based basemap sources bow to the error grace.
        if (src.type === 'raster' || src.type === 'vector') {
          if (!map.isSourceLoaded(id) && !toleratedTileErrors) {
            allLoaded = false;
            break;
          }
        } else if (!map.isSourceLoaded(id)) {
          allLoaded = false;
          break;
        }
      }
    } catch {
      allLoaded = false;
    }
    if (!allLoaded) { cleanPollsRef.current = 0; return; }

    // Sustained-clean window required so late tile batches reset the counter.
    cleanPollsRef.current += 1;
    if (cleanPollsRef.current >= 3) setReady(true);
  }, []);

  useEffect(() => {
    // Once ready the overlay is finished; while hidden (`!active`, e.g. the
    // print map) there is nothing to dismiss — don't poll at all.
    if (ready || !active) return;
    const poll = window.setInterval(verifyAndDismiss, 300);
    // Absolute escape hatch (background tabs / paused renderer): the overlay can
    // never outlast this, regardless of stalled state.
    const failsafe = window.setTimeout(() => setReady(true), 120000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(failsafe);
    };
  }, [verifyAndDismiss, ready, active]);

  // Refs for values that should NOT trigger a full overlay rebuild
  // (style-only changes are applied via setPaintProperty in separate effects)
  const catalogLayersRef        = useRef<CatalogVectorLayer[]>(catalogLayers);
  const systemStylesRef         = useRef<SystemLayerStyles | undefined>(systemStyles);
  const selectedFeatureRef      = useRef<any>(selectedFeature);
  const catalogPreviewRef       = useRef<ImportPreview | null | undefined>(catalogPreview);
  const prevCatalogFingerprintRef = useRef<string>('');
  const show3DRef = useRef(show3D);
  const lightingPresetRef = useRef<LightingPreset>(lightingPreset);
  const colorThemeRef     = useRef<ColorThemePreset>(colorTheme);
  const heightScaleRef    = useRef<number>(heightScale);
  const onPitchChangeRef  = useRef(onPitchChange);
  const coverageRunsRef = useRef<LonLat[][]>(coverageRuns);
  const showCoverageRef = useRef<boolean>(showCoverage ?? true);
  const showLabelsRef   = useRef<boolean>(showLabels ?? true);
  const atmosphereTintRef = useRef<boolean>(atmosphereTint ?? true);
  const explorerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const explorerMarkerBRef = useRef<maplibregl.Marker | null>(null);
  const projectExplorerActiveRef = useRef<boolean>(projectExplorerActive ?? false);
  const projectExplorerCenterRef = useRef<[number, number] | null>(projectExplorerCenter ?? null);
  const projectExplorerCenterBRef = useRef<[number, number] | null>(projectExplorerCenterB ?? null);
  const projectExplorerRadiusRef = useRef<number>(projectExplorerRadius ?? 1000);
  const projectExplorerRoadsGeojsonRef = useRef<GeoJSON.FeatureCollection | null>(projectExplorerRoadsGeojson ?? null);
  const projectExplorerPaletteRef = useRef<ExplorerChoroplethPalette>(projectExplorerPalette ?? 'viridis');
  const projectExplorerColorByMetricRef = useRef<string>(projectExplorerColorByMetric ?? 'density');
  const choroplethSettingsRef = useRef<ChoroplethSettingsMap | undefined>(choroplethSettings);
  const subgridMetricsRef = useRef<any[]>(subgridMetrics ?? []);
  const onProjectExplorerCenterChangeRef = useRef(onProjectExplorerCenterChange);
  const onProjectExplorerCenterBChangeRef = useRef(onProjectExplorerCenterBChange);
  const isCompareModeRef = useRef<boolean>(isCompareMode ?? false);
  const selectedExplorerGridRef = useRef<any | null>(selectedExplorerGrid ?? null);
  const onSelectExplorerGridRef = useRef(onSelectExplorerGrid);
  const explorerMeshResultRef = useRef<any | null>(null);
  // Read by the map-load build, which runs before the first memo can supply it.
  const explorerGridSpecRef = useRef<ExplorerGridSpec | undefined>(explorerGridSpec);

  catalogLayersRef.current   = catalogLayers;
  systemStylesRef.current    = systemStyles;
  selectedFeatureRef.current = selectedFeature;
  catalogPreviewRef.current  = catalogPreview;
  show3DRef.current          = show3D;
  lightingPresetRef.current  = lightingPreset;
  colorThemeRef.current      = colorTheme;
  heightScaleRef.current     = heightScale;
  onPitchChangeRef.current   = onPitchChange;
  coverageRunsRef.current    = coverageRuns;
  showCoverageRef.current    = showCoverage ?? true;
  showLabelsRef.current      = showLabels ?? true;
  atmosphereTintRef.current  = atmosphereTint ?? true;
  projectExplorerActiveRef.current = projectExplorerActive ?? false;
  projectExplorerCenterRef.current = projectExplorerCenter ?? null;
  projectExplorerCenterBRef.current = projectExplorerCenterB ?? null;
  projectExplorerRadiusRef.current = projectExplorerRadius ?? 1000;
  projectExplorerRoadsGeojsonRef.current = projectExplorerRoadsGeojson ?? null;
  projectExplorerPaletteRef.current = projectExplorerPalette ?? 'viridis';
  projectExplorerColorByMetricRef.current = projectExplorerColorByMetric ?? 'density';
  choroplethSettingsRef.current = choroplethSettings;
  subgridMetricsRef.current = subgridMetrics ?? [];
  onProjectExplorerCenterChangeRef.current = onProjectExplorerCenterChange;
  onProjectExplorerCenterBChangeRef.current = onProjectExplorerCenterBChange;
  isCompareModeRef.current = isCompareMode ?? false;
  selectedExplorerGridRef.current = selectedExplorerGrid ?? null;
  explorerGridSpecRef.current = explorerGridSpec;
  onSelectExplorerGridRef.current = onSelectExplorerGrid;

  const buildOverlay = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const catalogLayers = catalogLayersRef.current;
    const systemStyles  = systemStylesRef.current;
    // selectedFeature is read from selectedFeatureRef.current later where needed

    // Drop the previous build's delegated layer listeners before registering new
    // ones — otherwise every rebuild stacks duplicate popup/cursor handlers.
    delegatedListenersRef.current.forEach((off) => off());
    delegatedListenersRef.current = [];
    const onLayer = (event: string, layerId: string, handler: (...args: any[]) => void) => {
      map.on(event as any, layerId, handler as any);
      delegatedListenersRef.current.push(() => map.off(event as any, layerId, handler as any));
    };
    // Every tracked source is re-added below, so reset the readiness set.
    addedSourceIdsRef.current.clear();

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

    // 1. Optionally dim the non-selected regions so the selected one stands
    //    out. Off by default — the operator opts in via System Baseline.
    if (dimmedRegionsGeojson?.features) {
      const dim = systemStyles?.dimOutside;
      const dimVisible = dim?.visible === true && !projectExplorerActiveRef.current;
      map.addSource('ra-dim', { type: 'geojson', data: dimmedRegionsGeojson });
      addedSourceIdsRef.current.add('ra-dim');
      map.addLayer({
        id: 'ra-dim',
        type: 'fill',
        source: 'ra-dim',
        paint: {
          'fill-color': dim?.color || '#0b1220',
          'fill-opacity': dimVisible ? (dim?.opacity ?? 0.45) : 0
        }
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
      // Removed transparent fill layer (was used only for clipping, not needed)
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

    // 2b. Project Explorer: mesh polygon blocks clipped strictly to district boundary
    if (!map.getSource('ra-explorer-mesh')) {
      map.addSource('ra-explorer-mesh', { type: 'geojson', data: EMPTY_FC });
    }
    addedSourceIdsRef.current.add('ra-explorer-mesh');
    if (!map.getLayer('ra-explorer-mesh-fill')) {
      map.addLayer(
        {
          id: 'ra-explorer-mesh-fill',
          type: 'fill',
          source: 'ra-explorer-mesh',
          layout: {
            visibility: projectExplorerActiveRef.current ? 'visible' : 'none'
          },
          paint: {
            'fill-color': buildMeshExpression(
              resolveSetting(
                choroplethSettingsRef.current,
                projectExplorerColorByMetricRef.current || 'density',
                projectExplorerPaletteRef.current
              ),
              projectExplorerColorByMetricRef.current || 'density'
            ) as any,
            'fill-opacity': 0.85
          }
        },
        map.getLayer('ra-districts-line') ? 'ra-districts-line' : undefined
      );
    }
    if (!map.getLayer('ra-explorer-mesh-line')) {
      map.addLayer(
        {
          id: 'ra-explorer-mesh-line',
          type: 'line',
          source: 'ra-explorer-mesh',
          layout: {
            visibility: projectExplorerActiveRef.current ? 'visible' : 'none',
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#ffffff', // Clean crisp white border separating each grid box
            'line-width': 1.2,
            'line-opacity': 0.85
          }
        },
        map.getLayer('ra-districts-line') ? 'ra-districts-line' : undefined
      );
    }

    // 2c. Dedicated Selected Grid Box (Bold Orange Highlight Border & Subtle Wash)
    if (!map.getSource('ra-explorer-selected-box')) {
      map.addSource('ra-explorer-selected-box', { type: 'geojson', data: EMPTY_FC });
    }
    addedSourceIdsRef.current.add('ra-explorer-selected-box');
    if (!map.getLayer('ra-explorer-selected-fill')) {
      map.addLayer(
        {
          id: 'ra-explorer-selected-fill',
          type: 'fill',
          source: 'ra-explorer-selected-box',
          layout: {
            visibility: projectExplorerActiveRef.current ? 'visible' : 'none'
          },
          paint: {
            'fill-color': '#f97316',
            'fill-opacity': 0.15
          }
        },
        map.getLayer('ra-districts-line') ? 'ra-districts-line' : undefined
      );
    }
    if (!map.getLayer('ra-explorer-selected-line')) {
      map.addLayer(
        {
          id: 'ra-explorer-selected-line',
          type: 'line',
          source: 'ra-explorer-selected-box',
          layout: {
            visibility: projectExplorerActiveRef.current ? 'visible' : 'none',
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': '#f97316', // Bold vibrant ORANGE selection box
            'line-width': 4.0,
            'line-opacity': 1.0
          }
        },
        map.getLayer('ra-districts-line') ? 'ra-districts-line' : undefined
      );
    }

    // 3. User Catalog Vector Layers (rendered below baseline lines so road analysis remains clear)
    const pendingCatalogGeometry: Array<{ srcId: string; geojson: any; geojsonJson?: string; isPolyType?: boolean }> = [];
    catalogLayers.forEach((catLayer) => {
      // Register even hidden layers (with visibility:none) so toggling a layer's
      // eye icon can be applied in-place without a full overlay rebuild.
      if (!catLayer.geojson && !catLayer.geojsonJson) return;

      const srcId = `ra-cat-${catLayer.id}`;
      const heavy =
        (catLayer.featureCount ?? 0) >= HEAVY_CATALOG_FEATURE_COUNT ||
        (catLayer.geometryBytes ?? 0) > HEAVY_CATALOG_BYTES;

      // Determine initial data for the source. When geometry was rehydrated from
      // IndexedDB (reload path), only `geojsonJson` is set — `geojson` is undefined.
      // For non-heavy layers we parse the string immediately so the map renders;
      // heavy layers defer through the blob-URL idle-time loader.
      let initialData: any = EMPTY_FC;
      const isPolyType = catLayer.geometryType === 'Polygon' || catLayer.geometryType === 'Mixed';
      if (heavy) {
        // Will be loaded via scheduleCatalogGeometryLoad below
        initialData = EMPTY_FC;
      } else if (catLayer.geojson) {
        initialData = isPolyType ? stripEnvelopeFeatures(catLayer.geojson) : catLayer.geojson;
      } else if (catLayer.geojsonJson) {
        try {
          const parsed = JSON.parse(catLayer.geojsonJson);
          initialData = isPolyType ? stripEnvelopeFeatures(parsed) : parsed;
        } catch { initialData = EMPTY_FC; }
      }
      map.addSource(srcId, { type: 'geojson', data: initialData });
      if (heavy) pendingCatalogGeometry.push({ srcId, geojson: catLayer.geojson, geojsonJson: catLayer.geojsonJson, isPolyType });
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
        const fillOpacity = catLayer.fillOpacity !== undefined ? catLayer.fillOpacity : 0;
        const isExplorerActive = projectExplorerActiveRef.current;

        map.addLayer({
          id: fillId,
          type: 'fill',
          source: srcId,
          layout: {
            visibility: isExplorerActive || !catLayer.visible ? 'none' : 'visible'
          },
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
          layout: {
            visibility: isExplorerActive || !catLayer.visible ? 'none' : 'visible'
          },
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
          layout: {
            visibility: catLayer.visible ? 'visible' : 'none'
          },
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
          layout: {
            visibility: catLayer.visible ? 'visible' : 'none'
          },
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
        const propKeys = getCatalogSamplePropKeys(catLayer);
        const labelField = pickCatalogLabelField(catLayer, propKeys);

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
              visibility: catLayer.visible ? 'visible' : 'none',
              'text-field': ['to-string', ['get', labelField]],
              'text-size': catLayer.labelSize || 11,
              // OpenFreeMap basemaps serve only the Noto Sans family; the
              // MapLibre default (Open Sans) 404s the glyph request.
              'text-font': isBold ? ['Noto Sans Bold'] : ['Noto Sans Regular'],
              'symbol-placement': geomType === 'LineString' ? 'line-center' : 'point',
              'text-offset': geomType === 'Point' ? [0, 1.2] : [0, 0],
              'text-anchor': geomType === 'Point' ? 'top' : 'center',
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-max-width': 10
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
        onLayer('mouseenter', layerId, () => {
          if (projectExplorerActiveRef.current) return;
          map.getCanvas().style.cursor = 'pointer';
        });
        onLayer('mouseleave', layerId, () => {
          if (projectExplorerActiveRef.current) return;
          map.getCanvas().style.cursor = '';
        });
        onLayer('click', layerId, (e) => {
          if (projectExplorerActiveRef.current) return;
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
                `<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
                   <span style="color: var(--text-muted, #94a3b8); font-size: 10px; text-transform: uppercase; font-weight: 500;">${k}:</span>
                   <span style="font-weight: 500; font-family: monospace; color: var(--text-primary, #f1f5f9); text-align: right; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${String(props[k])}</span>
                 </div>`
            )
            .join('');

          if (selectedPopupRef.current) {
            selectedPopupRef.current.remove();
          }

          const popup = new maplibregl.Popup({
            className: 'custom-panotrack-popup',
            offset: 8,
            closeButton: true,
            closeOnClick: true
          })
            .setLngLat(coords)
            .setHTML(`
              <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 11px; line-height: 1.4; color: var(--text-primary, #f1f5f9); padding: 10px 12px; min-width: 200px; max-width: 280px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; padding-bottom: 5px; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); padding-right: 22px;">
                  <span style="font-weight: 600; color: var(--text-primary, #f1f5f9); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${catLayer.name.replace(/"/g, '&quot;')}">
                    ${catLayer.name}
                  </span>
                  <span style="font-size: 9px; font-weight: 600; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-muted, #94a3b8); border: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); flex-shrink: 0;">
                    ${catLayer.geometryType}
                  </span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px;">
                  ${rowsHtml || '<span style="color: var(--text-muted, #94a3b8);">No attribute table found.</span>'}
                </div>
                <div style="color: var(--text-muted, #64748b); font-size: 9px; font-family: monospace; border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); padding-top: 4px;">
                  ${coords.lat.toFixed(5)}° N, ${coords.lng.toFixed(5)}° E
                </div>
              </div>
            `)
            .addTo(map);

          selectedPopupRef.current = popup;
        });
      });
    });

    // 4. Extracted / Road Plan Lines (Option A / Option B roads)
    //    Always register the source & layer so subsequent updates can call .setData()
    //    with zero flicker, zero lag, and without tearing down other map layers.
    const isExplorerActive = projectExplorerActiveRef.current && showRoadLines;
    let initialRoadsData = EMPTY_FC;
    if (isExplorerActive) {
      const { meshGeojson, annotatedRoadsGeojson } = buildMeshRoadChoroplethGeojson(
        roadRuns,
        districtGeojson,
        catalogLayersRef.current,
        subgridMetricsRef.current,
        capturedPoints,
        explorerGridSpecRef.current
      );
      initialRoadsData = annotatedRoadsGeojson;
      // Populate mesh source immediately so clipped grid displays on frame 1 with zero lag
      (map.getSource('ra-explorer-mesh') as any)?.setData(meshGeojson);
    } else if (roadRuns.length > 0) {
      initialRoadsData = extractLineStringRuns(roadRuns);
    }

    const planVisible = showRoadLines && (systemStyles?.roadPlan?.visible !== false);
    const planColor = systemStyles?.roadPlan?.color || '#10b981';
    const planOpacity = planVisible ? (systemStyles?.roadPlan?.opacity ?? 0.85) : 0;
    const planWidth = systemStyles?.roadPlan?.strokeWidth ?? 3.5;

    map.addSource('ra-roads', { type: 'geojson', data: initialRoadsData });
    addedSourceIdsRef.current.add('ra-roads');
    map.addLayer({
      id: 'ra-roads',
      type: 'line',
      source: 'ra-roads',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        visibility: planVisible && roadRuns.length > 0 ? 'visible' : 'none'
      },
      paint: {
        'line-color': isExplorerActive ? '#9ca3af' : planColor,
        'line-width': isExplorerActive ? 1.8 : planWidth,
        'line-opacity': isExplorerActive ? 0.30 : planOpacity
      }
    });

    // 4b. Coverage segmentation: plan stretches WITHOUT any panotrack within
    //     tolerance, drawn in red directly on the plan geometry. Always register
    //     the source & layers so subsequent updates can call .setData() with zero
    //     flicker / teardown.
    const initialCoverageData = (showCoverageRef.current && coverageRunsRef.current.length > 0)
      ? coverageLineFc(coverageRunsRef.current)
      : EMPTY_FC;
    map.addSource('ra-coverage', { type: 'geojson', data: initialCoverageData });
    addedSourceIdsRef.current.add('ra-coverage');
    map.addLayer({
      id: 'ra-coverage-casing',
      type: 'line',
      source: 'ra-coverage',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#0b1220',
        'line-width': 6.5,
        'line-opacity': 0.7
      }
    });
    map.addLayer({
      id: 'ra-coverage-line',
      type: 'line',
      source: 'ra-coverage',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ef4444',
        'line-width': 3.6,
        'line-opacity': 0.95
      }
    });

    // 5. Captured panotrack points (individual survey frames, colored by status).
    if (capturedPoints.length > 0) {
      const ptVisible = systemStyles?.capturedPoints?.visible !== false;
      const ptOpacity = ptVisible ? (systemStyles?.capturedPoints?.opacity ?? 0.95) : 0;
      const ptRadius = systemStyles?.capturedPoints?.pointRadius;

      map.addSource('ra-captured', {
        type: 'geojson',
        data: extractPointCollection(capturedPoints, catalogLayersRef.current),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 50
      });
      addedSourceIdsRef.current.add('ra-captured');

      // Cluster bubbles (zoom < 14)
      map.addLayer({
        id: 'ra-captured-clusters',
        type: 'circle',
        source: 'ra-captured',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#0284c7',
            20, '#0369a1',
            100, '#0f172a'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16,
            20, 22,
            100, 28
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': ptOpacity
        }
      });

      // Cluster count number
      map.addLayer({
        id: 'ra-captured-cluster-count',
        type: 'symbol',
        source: 'ra-captured',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          // OpenFreeMap's glyph endpoint serves only the Noto Sans family —
          // requesting "Open Sans Bold" 404s the glyph fetch.
          'text-font': ['Noto Sans Bold'],
          'text-size': 12
        },
        paint: {
          'text-color': '#ffffff'
        }
      });

      // Individual unclustered points (zoom >= 14 or single nodes)
      map.addLayer({
        id: 'ra-captured',
        type: 'circle',
        source: 'ra-captured',
        filter: ['!', ['has', 'point_count']],
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

      // Cluster click: smooth expansion zoom
      onLayer('click', 'ra-captured-clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['ra-captured-clusters'] });
        const clusterId = features[0]?.properties?.cluster_id;
        const source = map.getSource('ra-captured') as any;
        if (source && typeof source.getClusterExpansionZoom === 'function') {
          source.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
            if (err) return;
            map.easeTo({
              center: (features[0].geometry as any).coordinates,
              zoom
            });
          });
        }
      });
      onLayer('mouseenter', 'ra-captured-clusters', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      onLayer('mouseleave', 'ra-captured-clusters', () => {
        map.getCanvas().style.cursor = '';
      });

      // Pointer cursor on hover
      onLayer('mouseenter', 'ra-captured', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      onLayer('mouseleave', 'ra-captured', () => {
        map.getCanvas().style.cursor = '';
      });

      // Click popup on panotrack point
      onLayer('click', 'ra-captured', (e) => {
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

        if (selectedPopupRef.current) {
          selectedPopupRef.current.remove();
        }

        const popup = new maplibregl.Popup({
          className: 'custom-panotrack-popup',
          offset: 8,
          closeButton: true,
          closeOnClick: true
        })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 11px; line-height: 1.4; color: var(--text-primary, #f1f5f9); padding: 10px 12px; min-width: 200px; max-width: 280px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); padding-right: 22px;">
                <span style="font-weight: 600; color: var(--text-primary, #f1f5f9); font-size: 12px; font-family: monospace;">
                  ${p.subgrid || 'Panotrack Point'}
                </span>
                <span style="font-size: 9px; font-weight: 600; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-muted, #94a3b8); border: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); flex-shrink: 0;">
                  ${statusLabel}
                </span>
              </div>
              ${p.filename ? `<div style="color: var(--text-muted, #94a3b8); font-family: monospace; font-size: 10px; word-break: break-all; margin-bottom: 5px;">${p.filename}</div>` : ''}

              ${p.transitNote ? `
                <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); font-size: 10px; color: var(--text-primary, #cbd5e1);">
                  <div style="color: var(--text-muted, #94a3b8); font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1px;">Transit Note</div>
                  <div style="line-height: 1.35;">${p.transitNote}</div>
                </div>
              ` : ''}

              ${p.spatialSubgrid && p.spatialSubgrid !== p.subgrid ? `
                <div style="margin-top: 4px; font-size: 10px; color: var(--text-muted, #94a3b8);">
                  Physical Grid: <span style="color: var(--text-primary, #f1f5f9); font-family: monospace; font-weight: 600;">${p.spatialSubgrid}</span>
                </div>
              ` : ''}

              <div style="color: var(--text-muted, #64748b); font-size: 9px; font-family: monospace; margin-top: 5px; border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); padding-top: 4px;">
                ${Number(coords[1]).toFixed(5)}° N, ${Number(coords[0]).toFixed(5)}° E
              </div>
            </div>
          `)
          .addTo(map);

        selectedPopupRef.current = popup;
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

    // 6b. Live import preview (Original vs Clipped) — persistent source whose
    //     data is pushed via setData() from a dedicated effect. Oversized
    //     previews defer to the idle-time catalog loader so toggling modes never
    //     freezes the main thread.
    const preview = catalogPreviewRef.current;
    const previewColor = preview?.color || '#38bdf8';
    map.addSource(PREVIEW_SRC, { type: 'geojson', data: EMPTY_FC });
    addedSourceIdsRef.current.add(PREVIEW_SRC);
    dynamicSourcesRef.current.push(PREVIEW_SRC);

    map.addLayer({
      id: 'ra-preview-fill', type: 'fill', source: PREVIEW_SRC,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: { 'fill-color': previewColor, 'fill-opacity': 0 }
    });
    map.addLayer({
      id: 'ra-preview-poly-line', type: 'line', source: PREVIEW_SRC,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: { 'line-color': previewColor, 'line-width': 2, 'line-opacity': 1 }
    });
    map.addLayer({
      id: 'ra-preview-casing', type: 'line', source: PREVIEW_SRC,
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      paint: { 'line-color': '#0b1220', 'line-width': 8, 'line-opacity': 0.6 }
    });
    map.addLayer({
      id: 'ra-preview-line', type: 'line', source: PREVIEW_SRC,
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': previewColor, 'line-width': 3.5, 'line-opacity': 0.95 }
    });
    map.addLayer({
      id: 'ra-preview-point', type: 'circle', source: PREVIEW_SRC,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      paint: {
        'circle-radius': 6, 'circle-color': previewColor, 'circle-opacity': 0.95,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5
      }
    });
    dynamicLayersRef.current.push(...PREVIEW_LAYER_IDS);

    // 6c. Project Explorer spotlight inverted mask, perimeter stroke, and choropleth roads
    // 6c. Project Explorer spotlight inverted mask and boundary stroke
    map.addSource('ra-explorer-mask', { type: 'geojson', data: EMPTY_FC });
    map.addSource('ra-explorer-stroke', { type: 'geojson', data: EMPTY_FC });
    addedSourceIdsRef.current.add('ra-explorer-mask');
    addedSourceIdsRef.current.add('ra-explorer-stroke');

    map.addLayer({
      id: 'ra-explorer-mask',
      type: 'fill',
      source: 'ra-explorer-mask',
      paint: {
        'fill-color': '#030712',
        'fill-opacity': 0
      }
    });

    map.addLayer({
      id: 'ra-explorer-stroke',
      type: 'line',
      source: 'ra-explorer-stroke',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#38bdf8',
        'line-width': 2.8,
        'line-opacity': 0
      }
    });

    const rawPreviewFc = preview?.geojson;
    const previewFc = rawPreviewFc && Array.isArray(rawPreviewFc.features) ? stripEnvelopeFeatures(rawPreviewFc) : rawPreviewFc;
    if (previewFc && Array.isArray(previewFc.features) && previewFc.features.length > 0) {
      const heavy =
        previewFc.features.length >= HEAVY_CATALOG_FEATURE_COUNT ||
        estimateGeometryBytes(previewFc) > HEAVY_CATALOG_BYTES;
      if (heavy) {
        pendingCatalogGeometry.push({ srcId: PREVIEW_SRC, geojson: previewFc, geojsonJson: preview?.geojsonJson, isPolyType: true });
      } else {
        (map.getSource(PREVIEW_SRC) as maplibregl.GeoJSONSource | undefined)?.setData(previewFc);
      }
    } else if (preview?.geojsonJson) {
      // Heavyweight original previews arrive as serialized bytes (no object
      // graph on the UI thread). Feed the blob-URL ingest path directly.
      pendingCatalogGeometry.push({ srcId: PREVIEW_SRC, geojson: previewFc, geojsonJson: preview.geojsonJson });
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

    // Feed oversized catalog geometry to the map sources after the frame
    // commits (see HEAVY_CATALOG_* / scheduleCatalogGeometryLoad).
    if (pendingCatalogGeometry.length > 0) {
      scheduleCatalogGeometryLoad(map, pendingCatalogGeometry);
    }

    // 7. Re-apply 3D buildings, ground atmosphere tint, lighting, and label visibility
    applyBuildingLayer(map, show3DRef.current, colorThemeRef.current, heightScaleRef.current);
    applyLightingToMap(map, lightingPresetRef.current);
    applyGroundAtmosphere(map, lightingPresetRef.current, atmosphereTintRef.current);
    toggleMapLabelsVisibility(map, showLabelsRef.current);

    // 7b. Coverage overlays (red uncovered lines) are re-raised above the
    //     re-added base layers so they stay on top of the green road plan.
    COVERAGE_LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.moveLayer(id);
    });

    // 8. Everything (style + boundary + points + roads) is now painted.
    overlayBuiltRef.current = true;

    // Cache the live source id list once per build. The readiness poll reads this
    // instead of calling map.getStyle() (deep serialization) every 300ms.
    try {
      const style = map.getStyle();
      trackedSourceIdsRef.current = style?.sources ? Object.keys(style.sources) : [];
    } catch {
      trackedSourceIdsRef.current = [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox, districtGeojson, dimmedRegionsGeojson, capturedPoints]);
  // catalogLayers, systemStyles, roadRuns, selectedFeature intentionally omitted — they are
  // read from refs or handled by dedicated fast-path effects below.

  // ── Road plan overlay: update source via setData (zero flicker, zero lag, zero teardown) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const roadSrc = map.getSource('ra-roads') as maplibregl.GeoJSONSource | undefined;
    if (!roadSrc?.setData) return;
    if (projectExplorerActiveRef.current) {
      // In explorer mode, road lines are managed by the explorer choropleth effect
      return;
    }
    const planVisible = showRoadLines && (systemStyles?.roadPlan?.visible !== false);
    const data = roadRuns.length > 0 ? extractLineStringRuns(roadRuns) : EMPTY_FC;
    roadSrc.setData(data);
    if (map.getLayer('ra-roads')) {
      map.setLayoutProperty('ra-roads', 'visibility', planVisible && roadRuns.length > 0 ? 'visible' : 'none');
    }
  }, [roadRuns, showRoadLines, systemStyles?.roadPlan?.visible]);

  // ── Coverage overlay: update source via setData (zero flicker, zero teardown) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const covSrc = map.getSource('ra-coverage') as maplibregl.GeoJSONSource | undefined;
    if (!covSrc?.setData) return;
    const data = (showCoverage && coverageRuns.length > 0)
      ? coverageLineFc(coverageRuns)
      : EMPTY_FC;
    covSrc.setData(data);
  }, [coverageRuns, showCoverage]);

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

  // ── Import preview: live update via setData / setPaintProperty (no rebuild) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const src = map?.getSource?.(PREVIEW_SRC) as maplibregl.GeoJSONSource | undefined;
    const preview = catalogPreview;
    const rawGeojson = preview?.geojson;
    const geojson = rawGeojson && Array.isArray(rawGeojson.features) ? stripEnvelopeFeatures(rawGeojson) : rawGeojson;

    if (src?.setData) {
      const heavy =
        geojson &&
        Array.isArray(geojson.features) &&
        (geojson.features.length >= HEAVY_CATALOG_FEATURE_COUNT ||
          estimateGeometryBytes(geojson) > HEAVY_CATALOG_BYTES);
      if (heavy) {
        scheduleCatalogGeometryLoad(map, [{ srcId: PREVIEW_SRC, geojson, isPolyType: true }]);
      } else {
        src.setData(geojson && Array.isArray(geojson.features) ? geojson : EMPTY_FC);
      }
    }

    const color = preview?.color || '#38bdf8';
    if (map.getLayer('ra-preview-line')) map.setPaintProperty('ra-preview-line', 'line-color', color);
    if (map.getLayer('ra-preview-point')) map.setPaintProperty('ra-preview-point', 'circle-color', color);
    if (map.getLayer('ra-preview-fill')) {
      map.setPaintProperty('ra-preview-fill', 'fill-color', color);
      map.setPaintProperty('ra-preview-fill', 'fill-opacity', 0);
    }
    if (map.getLayer('ra-preview-poly-line')) map.setPaintProperty('ra-preview-poly-line', 'line-color', color);
  }, [catalogPreview]);

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

    // Style-only change → update paint/layout properties in place (no flash).
    // Both `geojson` layers and `geojsonJson`-only layers (heavy imports carry
    // the geometry as serialized bytes) get live paint updates so color/stroke/
    // opacity sliders respond instantly instead of waiting for a full rebuild.
    for (const catLayer of catalogLayers) {
      if (!catLayer.geojson && !catLayer.geojsonJson) continue;
      updateCatalogLayerStyle(map, catLayer, `ra-cat-${catLayer.id}`, projectExplorerActiveRef.current);
    }
  }, [catalogLayers]);

  // ── System styles: setPaintProperty only (never tears down layers) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    applySystemStyles(map, systemStyles, showRoadLines, projectExplorerActiveRef.current);
  }, [systemStyles, showRoadLines]);

  // Zoom to layer bounding box when requested by catalog
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusBbox) return;
    const [minLng, minLat, maxLng, maxLat] = focusBbox;
    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) return;
    if (minLng < -180 || maxLng > 180 || minLat < -90 || maxLat > 90) return;

    if (minLng === maxLng && minLat === maxLat) {
      map.flyTo({ center: [minLng, minLat], zoom: 14, duration: 1600, essential: true });
    } else {
      const camera = typeof map.cameraForBounds === 'function'
        ? map.cameraForBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 48, maxZoom: 15.5 })
        : null;
      if (camera) {
        map.flyTo({
          ...camera,
          duration: 1800,
          curve: 1.42,
          speed: 0.9,
          essential: true
        });
      } else {
        map.fitBounds(
          [[minLng, minLat], [maxLng, maxLat]],
          { padding: 48, maxZoom: 15.5, duration: 1800, essential: true }
        );
      }
    }
  }, [focusBbox]);

  // ── 1. Memoize mesh and road GeoJSON so switching palettes or metrics NEVER re-runs heavy spatial clipping ──
  // Geometry-only signature of the catalog layers. Style edits (color/opacity/
  // stroke) leave it unchanged, so moving an Explorer slider does not re-run the
  // heavy O(cells × road segments) mesh clip. Reads the live ref (not the prop)
  // so the memo body always sees the current geometry.
  const catalogGeometryKey = useMemo(
    () =>
      catalogLayers
        .map((l) => `${l.id}:${l.geometryType}:${l.featureCount ?? 0}:${l.geojson ? 'g' : ''}${l.geojsonJson ? 'j' : ''}`)
        .join('|'),
    [catalogLayers]
  );
  const explorerMeshResult = useMemo(() => {
    if (!projectExplorerActive || !showRoadLines) {
      return null;
    }
    return buildMeshRoadChoroplethGeojson(
      roadRuns,
      districtGeojson,
      catalogLayersRef.current,
      subgridMetrics,
      capturedPoints,
      explorerGridSpec
    );
  }, [
    projectExplorerActive,
    showRoadLines,
    roadRuns,
    districtGeojson,
    catalogGeometryKey,
    subgridMetrics,
    capturedPoints,
    explorerGridSpec
  ]);
  explorerMeshResultRef.current = explorerMeshResult;

  // ── 1b. Publish mesh cells so the Explorer card and class editor share one source ──
  // Publishes `cells`, not the ring-expanded GeoJSON features: the card needs the
  // per-cell corridor/junction/frame breakdowns, which ring expansion duplicates.
  // The signature covers the measured values, so a rebuild that changes geometry
  // but not measurements does not re-notify the parent.
  const onExplorerMeshCellsRef = useRef(onExplorerMeshCells);
  onExplorerMeshCellsRef.current = onExplorerMeshCells;
  // The grid descriptor is read from the same memoized result as the cells, so
  // provenance can never describe a different build than the data it labels.
  const meshCellSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const cells = explorerMeshResult?.cells || null;
    const sig = cells
      ? cells
          .map((c) =>
            [
              c.subgrid,
              c.planKm,
              c.areaKm2,
              c.density,
              c.coverage,
              c.panotrack,
              c.corridor?.shortKm,
              c.corridor?.mediumKm,
              c.corridor?.arterialKm,
              c.corridor?.trunkKm,
              c.junctions?.deadEnd,
              c.junctions?.threeWay,
              c.junctions?.fourWay,
              c.junctions?.fivePlus,
              c.frames?.verified,
              c.frames?.defect,
              c.frames?.transit,
              c.frames?.mismatch
            ].join(':')
          )
          .join('|')
      : null;
    // Grid provenance is part of the identity: the same cells measured over a
    // different grid describe different numbers, so it must invalidate the cache.
    const gridSig = `${explorerMeshResult?.grid?.source}|${explorerMeshResult?.grid?.cellCount}|${explorerMeshResult?.grid?.cellKm}|${explorerMeshResult?.grid?.areaFloored}|${explorerMeshResult?.grid?.declared}`;
    const fullSig = `${sig}|${gridSig}`;
    if (fullSig === meshCellSignatureRef.current) return;
    meshCellSignatureRef.current = fullSig;
    onExplorerMeshCellsRef.current?.(cells, explorerMeshResult?.grid);
  }, [explorerMeshResult]);

  // ── 2. Update mesh and road data ONLY when underlying geometry actually changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const meshSrc = map.getSource('ra-explorer-mesh') as maplibregl.GeoJSONSource | undefined;
    const roadsLineSrc = map.getSource('ra-roads') as maplibregl.GeoJSONSource | undefined;

    if (!projectExplorerActive || !showRoadLines || !explorerMeshResult) {
      meshSrc?.setData?.(EMPTY_FC);
      if (map.getLayer('ra-explorer-mesh-fill')) {
        map.setLayoutProperty('ra-explorer-mesh-fill', 'visibility', 'none');
      }
      if (map.getLayer('ra-explorer-mesh-line')) {
        map.setLayoutProperty('ra-explorer-mesh-line', 'visibility', 'none');
      }
      return;
    }

    meshSrc?.setData?.(explorerMeshResult.meshGeojson);
    roadsLineSrc?.setData?.(explorerMeshResult.annotatedRoadsGeojson);

    // Road network lines set to gray with 30% opacity per user specification
    if (map.getLayer('ra-roads')) {
      map.setPaintProperty('ra-roads', 'line-color', '#9ca3af');
      map.setPaintProperty('ra-roads', 'line-width', 1.8);
      map.setPaintProperty('ra-roads', 'line-opacity', 0.30);
    }

    if (map.getLayer('ra-explorer-mesh-fill')) {
      map.setLayoutProperty('ra-explorer-mesh-fill', 'visibility', 'visible');
    }
    if (map.getLayer('ra-explorer-mesh-line')) {
      map.setPaintProperty('ra-explorer-mesh-line', 'line-color', '#ffffff');
      map.setPaintProperty('ra-explorer-mesh-line', 'line-width', 1.2);
      map.setPaintProperty('ra-explorer-mesh-line', 'line-opacity', 0.85);
      map.setLayoutProperty('ra-explorer-mesh-line', 'visibility', 'visible');
    }

    // Suppress catalog layer polygon outlines and fills so they don't double-render over choropleth mesh outlines
    catalogLayersRef.current.forEach((catLayer) => {
      const outlineId = `ra-cat-${catLayer.id}-poly-line`;
      const fillId = `ra-cat-${catLayer.id}-fill`;
      if (map.getLayer(outlineId)) map.setLayoutProperty(outlineId, 'visibility', 'none');
      if (map.getLayer(fillId)) map.setLayoutProperty(fillId, 'visibility', 'none');
    });
  }, [explorerMeshResult, projectExplorerActive, showRoadLines, catalogGeometryKey]);

  // ── 3. Dedicated Ultra-Fast Palette & Metric Choropleth Switcher (< 1ms GPU update, zero data re-parsing) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (!projectExplorerActive || !showRoadLines) return;
    if (!map.getLayer('ra-explorer-mesh-fill')) return;

    const activePalette = projectExplorerPalette || 'greens';
    const activeMetric = projectExplorerColorByMetric || 'density';

    // Instant native GPU paint update - no GeoJSON transfer, no Web Worker re-tessellation
    map.setPaintProperty(
      'ra-explorer-mesh-fill',
      'fill-color',
      buildMeshExpression(
        resolveSetting(choroplethSettings, activeMetric, activePalette),
        activeMetric
      ) as any
    );
  }, [projectExplorerPalette, projectExplorerColorByMetric, choroplethSettings, projectExplorerActive, showRoadLines]);

  // ── Helper: Compute Full Extent of the Active Grid ──
  const getFullGridExtent = useCallback((): [number, number, number, number] | null => {
    const meshResult = explorerMeshResultRef.current;
    if (meshResult?.meshGeojson?.features && meshResult.meshGeojson.features.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const f of meshResult.meshGeojson.features) {
        let b = f.properties?.bbox;
        if (!b && f.properties?.bbox_str) {
          try { b = JSON.parse(f.properties.bbox_str); } catch {}
        }
        if (Array.isArray(b) && b.length === 4) {
          if (b[0] < minX) minX = b[0];
          if (b[1] < minY) minY = b[1];
          if (b[2] > maxX) maxX = b[2];
          if (b[3] > maxY) maxY = b[3];
        } else if (f.geometry?.coordinates?.[0]) {
          f.geometry.coordinates[0].forEach((pt: [number, number]) => {
            if (pt[0] < minX) minX = pt[0];
            if (pt[1] < minY) minY = pt[1];
            if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] > maxY) maxY = pt[1];
          });
        }
      }
      if (Number.isFinite(minX) && Number.isFinite(maxX)) {
        return [minX, minY, maxX, maxY];
      }
    }
    if (districtGeojson?.bbox && Array.isArray(districtGeojson.bbox) && districtGeojson.bbox.length === 4) {
      return districtGeojson.bbox as [number, number, number, number];
    }
    if (bbox && Array.isArray(bbox) && bbox.length === 4) {
      return bbox as [number, number, number, number];
    }
    return null;
  }, [districtGeojson, bbox]);

  // ── Breathable Smooth Camera Zoom In (Selected Subgrid) & Zoom Out (Full Grid Extent) ──
  const prevSelectedSubgridRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current || !projectExplorerActive) return;

    const currentSubgrid = selectedExplorerGrid?.subgrid ? String(selectedExplorerGrid.subgrid) : null;
    const prevSubgrid = prevSelectedSubgridRef.current;
    prevSelectedSubgridRef.current = currentSubgrid;

    if (currentSubgrid === prevSubgrid) return;

    const canvasWidth = map.getCanvas().clientWidth || 1000;
    const rightPad = canvasWidth < 768 ? 40 : canvasWidth < 1200 ? 320 : 420;

    if (currentSubgrid) {
      // Zoom IN to the focused subgrid with breathable smooth camera
      let targetBbox = selectedExplorerGrid.bbox;
      if (!targetBbox && selectedExplorerGrid.bbox_str) {
        try { targetBbox = JSON.parse(selectedExplorerGrid.bbox_str); } catch {}
      }
      if (!targetBbox && selectedExplorerGrid.rings?.[0]) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectedExplorerGrid.rings[0].forEach((pt: [number, number]) => {
          if (pt[0] < minX) minX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] > maxY) maxY = pt[1];
        });
        if (Number.isFinite(minX) && Number.isFinite(maxX)) {
          targetBbox = [minX, minY, maxX, maxY];
        }
      }

      if (targetBbox && Array.isArray(targetBbox) && targetBbox.length === 4) {
        const bounds: [[number, number], [number, number]] = [
          [Math.min(targetBbox[0], targetBbox[2]), Math.min(targetBbox[1], targetBbox[3])],
          [Math.max(targetBbox[0], targetBbox[2]), Math.max(targetBbox[1], targetBbox[3])]
        ];

        const camera = typeof map.cameraForBounds === 'function'
          ? map.cameraForBounds(bounds, {
              padding: { top: 80, bottom: 80, left: 60, right: rightPad },
              maxZoom: 14.8
            })
          : null;

        if (camera) {
          map.flyTo({
            center: camera.center,
            zoom: Math.min(camera.zoom ?? 14.8, 14.8),
            duration: 1500,
            curve: 1.42,
            speed: 0.85,
            essential: true
          });
        } else {
          map.fitBounds(bounds, {
            padding: { top: 80, bottom: 80, left: 60, right: rightPad },
            duration: 1500,
            maxZoom: 14.8,
            essential: true
          });
        }
      }
    } else if (prevSubgrid && !currentSubgrid) {
      // User unclicked the subgrid -> Zoom OUT back to the full extent of the grid!
      const fullGridBbox = getFullGridExtent();
      if (fullGridBbox) {
        const bounds: [[number, number], [number, number]] = [
          [Math.min(fullGridBbox[0], fullGridBbox[2]), Math.min(fullGridBbox[1], fullGridBbox[3])],
          [Math.max(fullGridBbox[0], fullGridBbox[2]), Math.max(fullGridBbox[1], fullGridBbox[3])]
        ];

        const camera = typeof map.cameraForBounds === 'function'
          ? map.cameraForBounds(bounds, {
              padding: { top: 70, bottom: 70, left: 60, right: rightPad },
              maxZoom: 13.5
            })
          : null;

        if (camera) {
          map.flyTo({
            center: camera.center,
            zoom: Math.min(camera.zoom ?? 13.5, 13.5),
            duration: 1600,
            curve: 1.42,
            speed: 0.85,
            essential: true
          });
        } else {
          map.fitBounds(bounds, {
            padding: { top: 70, bottom: 70, left: 60, right: rightPad },
            duration: 1600,
            maxZoom: 13.5,
            essential: true
          });
        }
      }
    }
  }, [selectedExplorerGrid, projectExplorerActive, getFullGridExtent]);

  // ── 3b. Focus selected subgrid with ORANGE box, NO DIMMING ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    if (!projectExplorerActive || !showRoadLines) return;
    if (!map.getLayer('ra-explorer-mesh-fill')) return;

    // Ensure all grid cells remain fully visible with their choropleth colors (NO DIMMING)
    map.setPaintProperty('ra-explorer-mesh-fill', 'fill-opacity', 0.85);

    // Keep base grid mesh lines crisp white
    if (map.getLayer('ra-explorer-mesh-line')) {
      map.setPaintProperty('ra-explorer-mesh-line', 'line-width', 1.2);
      map.setPaintProperty('ra-explorer-mesh-line', 'line-color', '#ffffff');
      map.setPaintProperty('ra-explorer-mesh-line', 'line-opacity', 0.85);
    }

    // Ensure ra-dim is never active
    if (map.getLayer('ra-dim')) {
      map.setPaintProperty('ra-dim', 'fill-opacity', 0);
    }

    // Update dedicated Orange selection box
    const selectedSrc = map.getSource('ra-explorer-selected-box') as maplibregl.GeoJSONSource | undefined;
    if (!selectedSrc) return;

    if (selectedExplorerGrid) {
      let rings = selectedExplorerGrid.rings;
      if (!rings || rings.length === 0) {
        let bbox = selectedExplorerGrid.bbox;
        if (!bbox && selectedExplorerGrid.bbox_str) {
          try { bbox = JSON.parse(selectedExplorerGrid.bbox_str); } catch {}
        }
        if (bbox && Array.isArray(bbox) && bbox.length === 4) {
          rings = [[[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]]];
        }
      }

      if (rings && rings.length > 0) {
        selectedSrc.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { subgrid: selectedExplorerGrid.subgrid },
            geometry: {
              type: 'Polygon',
              coordinates: rings
            }
          }]
        });
        if (map.getLayer('ra-explorer-selected-line')) {
          map.setLayoutProperty('ra-explorer-selected-line', 'visibility', 'visible');
        }
        if (map.getLayer('ra-explorer-selected-fill')) {
          map.setLayoutProperty('ra-explorer-selected-fill', 'visibility', 'visible');
        }
        return;
      }
    }

    selectedSrc.setData(EMPTY_FC);
    if (map.getLayer('ra-explorer-selected-line')) {
      map.setLayoutProperty('ra-explorer-selected-line', 'visibility', 'none');
    }
    if (map.getLayer('ra-explorer-selected-fill')) {
      map.setLayoutProperty('ra-explorer-selected-fill', 'visibility', 'none');
    }
  }, [selectedExplorerGrid, projectExplorerActive, showRoadLines]);

  // ── 4. Deactivation cleanup & standard styling restore ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const maskSrc = map.getSource('ra-explorer-mask') as maplibregl.GeoJSONSource | undefined;
    const strokeSrc = map.getSource('ra-explorer-stroke') as maplibregl.GeoJSONSource | undefined;
    const roadsSrc = map.getSource('ra-explorer-roads') as maplibregl.GeoJSONSource | undefined;
    const meshSrc = map.getSource('ra-explorer-mesh') as maplibregl.GeoJSONSource | undefined;
    const roadsLineSrc = map.getSource('ra-roads') as maplibregl.GeoJSONSource | undefined;

    const planColor = systemStylesRef.current?.roadPlan?.color || '#10b981';
    const planWidth = systemStylesRef.current?.roadPlan?.strokeWidth ?? 3.5;
    const planOpacity = systemStylesRef.current?.roadPlan?.opacity ?? 0.85;

    maskSrc?.setData?.(EMPTY_FC);
    strokeSrc?.setData?.(EMPTY_FC);
    roadsSrc?.setData?.(EMPTY_FC);

    if (!projectExplorerActive || !showRoadLines) {
      meshSrc?.setData?.(EMPTY_FC);

      // Revert roads layer to standard line styling
      if (map.getLayer('ra-roads')) {
        const rp = systemStyles?.roadPlan;
        const vis = showRoadLines && (rp?.visible !== false);
        map.setPaintProperty('ra-roads', 'line-color', rp?.color || planColor);
        map.setPaintProperty('ra-roads', 'line-width', rp?.strokeWidth ?? planWidth);
        map.setPaintProperty('ra-roads', 'line-opacity', vis ? (rp?.opacity ?? planOpacity) : 0);
      }
      if (roadsLineSrc && roadRuns.length > 0) {
        roadsLineSrc.setData(extractLineStringRuns(roadRuns));
      }

      // Hide mesh & selected box layers
      if (map.getLayer('ra-explorer-mesh-fill')) {
        map.setLayoutProperty('ra-explorer-mesh-fill', 'visibility', 'none');
      }
      if (map.getLayer('ra-explorer-mesh-line')) {
        map.setLayoutProperty('ra-explorer-mesh-line', 'visibility', 'none');
      }
      if (map.getLayer('ra-explorer-selected-line')) {
        map.setLayoutProperty('ra-explorer-selected-line', 'visibility', 'none');
      }
      if (map.getLayer('ra-explorer-selected-fill')) {
        map.setLayoutProperty('ra-explorer-selected-fill', 'visibility', 'none');
      }
      const selectedSrc = map.getSource('ra-explorer-selected-box') as maplibregl.GeoJSONSource | undefined;
      selectedSrc?.setData?.(EMPTY_FC);

      // Restore catalog polygon outlines and fills, but only the layers the
      // operator still has switched on. Forcing every polygon back to 'visible'
      // here overrode a layer whose eye icon was toggled off, so the hide
      // button appeared to do nothing for imported polygon layers.
      catalogLayers.forEach((catLayer) => {
        const layerVisible = catLayer.visible !== false;
        const outlineId = `ra-cat-${catLayer.id}-poly-line`;
        const fillId = `ra-cat-${catLayer.id}-fill`;
        if (map.getLayer(outlineId)) {
          map.setLayoutProperty(outlineId, 'visibility', layerVisible ? 'visible' : 'none');
        }
        if (map.getLayer(fillId)) {
          map.setLayoutProperty(fillId, 'visibility', layerVisible ? 'visible' : 'none');
        }
      });

      // Restore the dim overlay to the operator's chosen System Baseline setting
      // (it was forced off while the Project Explorer was active).
      if (map.getLayer('ra-dim')) {
        const dim = systemStylesRef.current?.dimOutside;
        map.setPaintProperty('ra-dim', 'fill-color', dim?.color || '#0b1220');
        map.setPaintProperty('ra-dim', 'fill-opacity', dim?.visible === true ? (dim?.opacity ?? 0.45) : 0);
      }
      if (map.getLayer('ra-explorer-mask')) {
        map.setPaintProperty('ra-explorer-mask', 'fill-opacity', 0);
      }
      if (map.getLayer('ra-explorer-stroke')) {
        map.setPaintProperty('ra-explorer-stroke', 'line-opacity', 0);
      }
    }
  }, [projectExplorerActive, showRoadLines, roadRuns, catalogLayers, systemStyles]);

  // ── Project Explorer Marker Cleanup (No circular buffer pins in subgrid focus mode) ──
  useEffect(() => {
    if (explorerMarkerRef.current) {
      explorerMarkerRef.current.remove();
      explorerMarkerRef.current = null;
    }
    if (explorerMarkerBRef.current) {
      explorerMarkerBRef.current.remove();
      explorerMarkerBRef.current = null;
    }
  }, [projectExplorerActive]);

  // ── Project Explorer Grid Click, Hover Tooltip & Focus Interaction ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !projectExplorerActive) return;

    let hoverPopup: maplibregl.Popup | null = null;

    const processMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!projectExplorerActiveRef.current) {
        map.getCanvas().style.cursor = '';
        if (hoverPopup) {
          hoverPopup.remove();
          hoverPopup = null;
        }
        return;
      }
      if (!map.getLayer('ra-explorer-mesh-fill')) {
        map.getCanvas().style.cursor = '';
        return;
      }

      const meshLayers = ['ra-explorer-mesh-fill', 'ra-explorer-mesh-line'].filter((id) => map.getLayer(id));
      if (meshLayers.length === 0) {
        map.getCanvas().style.cursor = '';
        return;
      }

      const features = map.queryRenderedFeatures(e.point, { layers: meshLayers });
      if (!features || features.length === 0) {
        map.getCanvas().style.cursor = '';
        if (hoverPopup) {
          hoverPopup.remove();
          hoverPopup = null;
        }
        return;
      }

      // Over a grid cell -> change cursor to pointer
      map.getCanvas().style.cursor = 'pointer';

      const p = features[0].properties || {};
      const subgrid = p.subgrid || 'GRID CELL';
      const density = Number(p.density || 0).toFixed(2);
      const planKm = Number(p.planKm || 0).toFixed(1);
      const areaKm2 = Number(p.areaKm2 || 0).toFixed(1);
      const complexity = Number(p.complexity || 0);
      const panotrack = Number(p.panotrack || 0);
      const coverage = Number(p.coverage || 0);

      const activeMetric = projectExplorerColorByMetricRef.current || 'density';
      let metricBadge = `${density} km/km²`;
      let metricValue = Number(p.density || 0);

      if (activeMetric === 'complexity') {
        metricBadge = `${complexity}/100 complexity`;
        metricValue = complexity;
      } else if (activeMetric === 'panotrack') {
        metricBadge = `${panotrack} survey frames`;
        metricValue = panotrack;
      } else if (activeMetric === 'roads') {
        metricBadge = `${planKm} km roads`;
        metricValue = Number(p.planKm || 0);
      } else if (activeMetric === 'coverage') {
        metricBadge = `${coverage}% covered`;
        metricValue = coverage;
      }

      // Badge colour tracks the cell's choropleth class so the tooltip and the
      // map can never disagree after a class break is edited.
      const activeSetting = resolveSetting(
        choroplethSettingsRef.current,
        activeMetric,
        projectExplorerPaletteRef.current
      );
      const metricBadgeColor = colorForValue(activeSetting, metricValue);
      const metricBadgeBg = hexToRgba(metricBadgeColor, 0.22);

      if (!hoverPopup) {
        hoverPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          className: 'explorer-grid-tooltip'
        });
      }

      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 7px 10px; background: rgba(12, 18, 30, 0.95); border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 9px; color: #fff; font-size: 11px; backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(0,0,0,0.6); pointer-events: none;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 3px;">
              <span style="font-weight: 700; color: #34d399; font-size: 11px;">${subgrid}</span>
              <span style="font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: ${metricBadgeBg}; color: ${metricBadgeColor};">${metricBadge}</span>
            </div>
            <div style="color: #94a3b8; font-size: 10px; display: flex; gap: 10px;">
              <span>Roads: <strong style="color: #f1f5f9;">${planKm} km</strong></span>
              <span>Area: <strong style="color: #f1f5f9;">${areaKm2} km²</strong></span>
            </div>
            <div style="margin-top: 5px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 9.5px; color: #38bdf8; font-weight: 500;">
              Click grid to focus & dim other area
            </div>
          </div>
        `)
        .addTo(map);
    };

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      if (hoverPopup) {
        hoverPopup.remove();
        hoverPopup = null;
      }
    };

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!projectExplorerActiveRef.current) return;
      if (!map.getLayer('ra-explorer-mesh-fill')) return;

      const meshLayers = ['ra-explorer-mesh-fill', 'ra-explorer-mesh-line'].filter((id) => map.getLayer(id));
      if (meshLayers.length === 0) return;

      const features = map.queryRenderedFeatures(e.point, { layers: meshLayers });
      if (features && features.length > 0) {
        const feat = features[0];
        const p = feat.properties || {};
        const subgridName = String(p.subgrid || '');
        if (!subgridName) return;

        // Find genuine cell data from the memoized explorerMeshResult GeoJSON (real WGS84 coordinates)
        const meshResult = explorerMeshResultRef.current;
        let matchedFeature: any = null;
        if (meshResult?.meshGeojson?.features) {
          matchedFeature = meshResult.meshGeojson.features.find(
            (f: any) => String(f.properties?.subgrid || '') === subgridName
          );
          // Fallback spatial point test if subgrid name property differed
          if (!matchedFeature) {
            matchedFeature = meshResult.meshGeojson.features.find((f: any) => {
              const geom = f.geometry;
              if (geom?.type === 'Polygon' && Array.isArray(geom.coordinates?.[0])) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                geom.coordinates[0].forEach((pt: [number, number]) => {
                  if (pt[0] < minX) minX = pt[0];
                  if (pt[1] < minY) minY = pt[1];
                  if (pt[0] > maxX) maxX = pt[0];
                  if (pt[1] > maxY) maxY = pt[1];
                });
                return e.lngLat.lng >= minX && e.lngLat.lng <= maxX && e.lngLat.lat >= minY && e.lngLat.lat <= maxY;
              }
              return false;
            });
          }
        }

        let bbox: [number, number, number, number] | null = null;
        let rings: [number, number][][] = [];

        if (matchedFeature) {
          const mp = matchedFeature.properties || {};
          if (Array.isArray(mp.bbox) && mp.bbox.length === 4) {
            bbox = mp.bbox as [number, number, number, number];
          }
          const mgeom = matchedFeature.geometry;
          if (mgeom?.type === 'Polygon' && Array.isArray(mgeom.coordinates)) {
            rings = mgeom.coordinates;
          }
        }

        if (!bbox && p.bbox_str) {
          try {
            const parsed = JSON.parse(p.bbox_str);
            if (Array.isArray(parsed) && parsed.length === 4) bbox = parsed as any;
          } catch {}
        }
        if (!bbox && Array.isArray(p.bbox) && p.bbox.length === 4) {
          bbox = p.bbox as any;
        }

        // If still no bbox, compute from rings
        if (!bbox && rings.length > 0 && rings[0].length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          rings[0].forEach((pt: [number, number]) => {
            if (pt[0] < minX) minX = pt[0];
            if (pt[1] < minY) minY = pt[1];
            if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] > maxY) maxY = pt[1];
          });
          if (Number.isFinite(minX) && Number.isFinite(maxX)) {
            bbox = [minX, minY, maxX, maxY];
          }
        }

        // Validate that bbox is valid WGS84 coordinates (-180..180, -90..90)
        if (
          bbox &&
          (Math.abs(bbox[0]) > 180 || Math.abs(bbox[2]) > 180 || Math.abs(bbox[1]) > 90 || Math.abs(bbox[3]) > 90)
        ) {
          bbox = null;
        }

        const cellData = {
          subgrid: subgridName,
          density: Number(matchedFeature?.properties?.density ?? p.density ?? 0),
          planKm: Number(matchedFeature?.properties?.planKm ?? p.planKm ?? 0),
          areaKm2: Number(matchedFeature?.properties?.areaKm2 ?? p.areaKm2 ?? 0),
          complexity: Number(matchedFeature?.properties?.complexity ?? p.complexity ?? 0),
          panotrack: Number(matchedFeature?.properties?.panotrack ?? p.panotrack ?? 0),
          coverage: Number(matchedFeature?.properties?.coverage ?? p.coverage ?? 0),
          bbox,
          rings
        };

        // If clicking the currently selected grid, toggle it OFF (deselect)
        if (selectedExplorerGridRef.current && String(selectedExplorerGridRef.current.subgrid) === cellData.subgrid) {
          onSelectExplorerGridRef.current?.(null);
          onProjectExplorerCenterChangeRef.current?.(null as any);
        } else {
          // Select and focus on the grid!
          onSelectExplorerGridRef.current?.(cellData);
          if (bbox) {
            const centerLng = (bbox[0] + bbox[2]) / 2;
            const centerLat = (bbox[1] + bbox[3]) / 2;
            onProjectExplorerCenterChangeRef.current?.([centerLng, centerLat]);
          }
        }
        return;
      }

      // If clicked outside all grid cells -> deselect
      if (selectedExplorerGridRef.current) {
        onSelectExplorerGridRef.current?.(null);
        onProjectExplorerCenterChangeRef.current?.(null as any);
      }
    };

    // Coalesce raw mousemove events into at most one tooltip update per frame —
    // queryRenderedFeatures + DOM popup churn is the hot path when hovering.
    let pendingMove: maplibregl.MapMouseEvent | null = null;
    let moveRaf: number | null = null;
    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      pendingMove = e;
      if (moveRaf !== null) return;
      moveRaf = requestAnimationFrame(() => {
        moveRaf = null;
        const ev = pendingMove;
        pendingMove = null;
        if (ev) processMouseMove(ev);
      });
    };

    map.on('mousemove', handleMouseMove);
    map.on('mouseout', handleMouseLeave);
    map.on('click', handleMapClick);

    return () => {
      map.getCanvas().style.cursor = '';
      if (moveRaf !== null) cancelAnimationFrame(moveRaf);
      map.off('mousemove', handleMouseMove);
      map.off('mouseout', handleMouseLeave);
      map.off('click', handleMapClick);
      if (hoverPopup) {
        hoverPopup.remove();
        hoverPopup = null;
      }
    };
  }, [projectExplorerActive, ready]);

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
    map.on('pitch', () => {
      onPitchChangeRef.current?.(map.getPitch());
    });
    map.on('load', () => {
      styleLoadedRef.current = true;
      lastLoadProgressAtRef.current = Date.now();
      applyLightingToMap(map, lightingPresetRef.current);
      applyGroundAtmosphere(map, lightingPresetRef.current, atmosphereTintRef.current);
      toggleMapLabelsVisibility(map, showLabelsRef.current);
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
      // Non-fatal: individual missing tiles / network drops. Latch tile-load
      // errors so the readiness pass can concede a failing basemap instead of
      // waiting on tiles that will never paint.
      const err = e as { tile?: unknown; status?: number };
      if (err.tile || err.status != null) {
        lastTileErrorAtRef.current = Date.now();
      }
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
      if (explorerMarkerRef.current) {
        explorerMarkerRef.current.remove();
        explorerMarkerRef.current = null;
      }
      if (explorerMarkerBRef.current) {
        explorerMarkerBRef.current.remove();
        explorerMarkerBRef.current = null;
      }
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
    if (explorerMarkerRef.current) {
      explorerMarkerRef.current.remove();
      explorerMarkerRef.current = null;
    }
    if (explorerMarkerBRef.current) {
      explorerMarkerBRef.current.remove();
      explorerMarkerBRef.current = null;
    }
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

  // ── 3D Buildings: add/remove or update fill-extrusion layer on toggle, theme, or scale change ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    applyBuildingLayer(map, show3D, colorTheme, heightScale);
  }, [show3D, colorTheme, heightScale]);

  // ── Dynamic 3D Lighting & Ground Atmosphere Tint ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    applyLightingToMap(map, lightingPreset);
    applyGroundAtmosphere(map, lightingPreset, atmosphereTint);
  }, [lightingPreset, atmosphereTint]);

  // ── Place Labels & POIs Visibility ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    toggleMapLabelsVisibility(map, showLabels);
  }, [showLabels]);

  // ── Cinematic Camera Orbit ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isOrbiting || !active) return;
    let animFrame: number;
    let lastTime = performance.now();
    const orbitSpeed = 4.0; // degrees per second

    const orbitLoop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const nextBearing = (map.getBearing() + orbitSpeed * dt) % 360;
      map.setBearing(nextBearing);
      animFrame = requestAnimationFrame(orbitLoop);
    };
    animFrame = requestAnimationFrame(orbitLoop);

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [isOrbiting, active]);

  // ── 2D↔3D Camera FLIGHT: swoop down to / up from the 3D surface view ──
  const didMountFlightRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !active) return;

    const targetPitch = show3D ? 60 : 0;
    const targetBearing = show3D ? map.getBearing() : 0;
    const firstRun = !didMountFlightRef.current;
    didMountFlightRef.current = true;
    // On mount the camera is already flat: a 2.2s no-op flight only burns frames
    // and competes with the initial tile/overlay paint.
    if (firstRun && Math.abs(map.getPitch() - targetPitch) < 1) return;

    const stop = startCameraFlight(map, {
      targetPitch,
      targetBearing,
      duration: show3D ? 2600 : 2200
    });

    // Let the user's own gestures take over if they drag mid-flight.
    const interrupt = () => stop();
    map.on('movestart', interrupt);
    map.on('dragstart', interrupt);

    return () => {
      map.off('movestart', interrupt);
      map.off('dragstart', interrupt);
      stop();
    };
  }, [show3D, active]);

  return (
    <div
      className="absolute inset-0 w-full h-full z-0 bg-slate-950"
      style={{ backgroundColor: 'var(--bg-app, #0f172a)' }}
    >
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

