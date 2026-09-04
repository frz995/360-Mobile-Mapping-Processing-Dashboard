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

import React, { useCallback, useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification, Map as MaplibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Let Vite resolve & serve maplibre's worker as a proper asset instead of
// maplibre self-constructing its own worker path (which Vite dev serves with
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { CatalogVectorLayer } from '../../utils/gisImportParser';
import { type SystemLayerStyles } from './RoadCatalogPanel';

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

function extractPointCollection(points: Array<[number, number] | any>): GeoJSON.FeatureCollection {
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
      return {
        type: 'Feature' as const,
        properties: {
          id: !Array.isArray(p) ? (p.id || `pt-${idx}`) : `pt-${idx}`,
          subgrid: !Array.isArray(p) ? (p.subgrid || '') : '',
          filename: !Array.isArray(p) ? (p.filename || '') : '',
          status: !Array.isArray(p) ? (isDefect ? 'defect' : (p.status || (p.isPublished ? 'published' : 'staging'))) : 'published',
          color
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
  selectedFeature
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  const buildOverlayRef = useRef<(() => void) | null>(null);
  const dynamicLayersRef = useRef<string[]>([]);
  const dynamicSourcesRef = useRef<string[]>([]);
  const lastFittedBboxRef = useRef<string>('');
  const selectedPopupRef = useRef<maplibregl.Popup | null>(null);

  // Refs for values that should NOT trigger a full overlay rebuild
  // (style-only changes are applied via setPaintProperty in separate effects)
  const catalogLayersRef        = useRef<CatalogVectorLayer[]>(catalogLayers);
  const systemStylesRef         = useRef<SystemLayerStyles | undefined>(systemStyles);
  const selectedFeatureRef      = useRef<any>(selectedFeature);
  const prevCatalogFingerprintRef = useRef<string>('');

  catalogLayersRef.current   = catalogLayers;
  systemStylesRef.current    = systemStyles;
  selectedFeatureRef.current = selectedFeature;


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

      map.addSource('ra-captured', { type: 'geojson', data: extractPointCollection(capturedPoints) });
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
        const color = p.color || '#10b981';
        const isDef = color === '#ef4444' || p.status === 'defect';
        new maplibregl.Popup({ className: 'custom-panotrack-popup', offset: 8 })
          .setLngLat(coords)
          .setHTML(`
            <div style="font-family: system-ui, sans-serif; font-size: 11px; line-height: 1.4; color: #f1f5f9; background: #0f172a; padding: 6px 10px; border-radius: 8px; border: 1px solid ${isDef ? '#ef444480' : 'rgba(255,255,255,0.12)'}; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 3px;">
                <span style="font-weight: 700; color: ${isDef ? '#f87171' : '#38bdf8'}; font-size: 12px;">
                  ${p.subgrid || 'Panotrack Point'}
                </span>
                <span style="font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 1.5px 6px; border-radius: 4px; background: ${color}25; color: ${color}; border: 1px solid ${color}60;">
                  ${isDef ? 'DEFECT / FLAGGED' : (p.status || 'ACTIVE')}
                </span>
              </div>
              ${p.filename ? `<div style="color: #94a3b8; word-break: break-all; margin-bottom: 3px;">${p.filename}</div>` : ''}
              <div style="color: #cbd5e1; font-size: 10px;">
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
          const lngs = allCoords.map((p) => p[0]);
          const lats = allCoords.map((p) => p[1]);
          lastFittedBboxRef.current = 'points-fitted';
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 36, maxZoom: 15 }
          );
        }
      }
    };
    fitBounds();
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
    map.on('load', () => {
      styleLoadedRef.current = true;
      buildOverlayRef.current?.();
    });
    map.on('error', (e) => {
      // Non-fatal warning for individual missing tiles / network drops
      console.warn('[RoadAnalysisMap] MapLibre warning/error:', e);
    });
    return map;
  }, []);

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
    const next = initMap(container, style);
    next.jumpTo(camera);
    mapRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, initMap]);

  // Continuously observe container resizing (sidebar toggle, layout reflow, window resize)
  // Throttled via requestAnimationFrame to avoid rapid canvas redraws / white flashes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let rafId: number | null = null;
    let lastW = container.clientWidth;
    let lastH = container.clientHeight;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (Math.abs(width - lastW) < 2 && Math.abs(height - lastH) < 2) return;
      lastW = width;
      lastH = height;

      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (mapRef.current) {
          mapRef.current.resize();
        }
      });
    });
    ro.observe(container);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
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

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full z-0 bg-slate-950"
      style={{ backgroundColor: 'var(--bg-app, #0f172a)' }}
    />
  );
};

export const RoadAnalysisMap = React.memo(RoadAnalysisMapComponent);

