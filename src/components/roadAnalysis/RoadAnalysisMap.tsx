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
}

const DEFAULT_CENTER: [number, number] = [101.9758, 4.2105];
const DEFAULT_ZOOM = 7;
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** Source ids created by this component (for teardown/rebuild). */
const SOURCE_IDS = ['ra-dim', 'ra-districts', 'ra-captured', 'ra-roads'] as const;

/** Layer ids created by this component. */
const LAYER_IDS = [
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

export const RoadAnalysisMap: React.FC<RoadAnalysisMapProps> = ({
  bbox,
  districtGeojson,
  dimmedRegionsGeojson,
  capturedPoints = [],
  roadRuns = [],
  style,
  active = true,
  showRoadLines = true
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  const buildOverlayRef = useRef<(() => void) | null>(null);

  const buildOverlay = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    // Remove previous overlay layers/sources.
    LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    SOURCE_IDS.forEach((id) => {
      if (map.getSource(id)) map.removeSource(id);
    });

    // Dim the non-selected regions so the selected one stands out.
    if (dimmedRegionsGeojson?.features) {
      map.addSource('ra-dim', { type: 'geojson', data: dimmedRegionsGeojson });
      map.addLayer({
        id: 'ra-dim',
        type: 'fill',
        source: 'ra-dim',
        paint: { 'fill-color': '#0b1220', 'fill-opacity': 0.45 }
      });
    }

    // Selected region: no fill, black outer boundary line.
    if (districtGeojson?.features) {
      map.addSource('ra-districts', { type: 'geojson', data: districtGeojson });
      map.addLayer({
        id: 'ra-districts',
        type: 'fill',
        source: 'ra-districts',
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0 }
      });
      map.addLayer({
        id: 'ra-districts-line',
        type: 'line',
        source: 'ra-districts',
        paint: { 'line-color': '#000000', 'line-width': 2.5 }
      });
    }

    // 1. Captured panotrack points (individual survey frames, colored by status)
    if (capturedPoints.length > 0) {
      map.addSource('ra-captured', { type: 'geojson', data: extractPointCollection(capturedPoints) });
      map.addLayer({
        id: 'ra-captured',
        type: 'circle',
        source: 'ra-captured',
        paint: {
          'circle-radius': [
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
          'circle-opacity': 0.95
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

    // 2. Extracted / Road Plan Lines (only rendered for actual road networks from Option A or manual Option B)
    if (roadRuns.length > 0) {
      map.addSource('ra-roads', { type: 'geojson', data: extractLineStringRuns(roadRuns) });
      map.addLayer({
        id: 'ra-roads',
        type: 'line',
        source: 'ra-roads',
        paint: { 'line-color': '#10b981', 'line-width': 3.5, 'line-opacity': 0.85 }
      });
      map.setLayoutProperty('ra-roads', 'visibility', showRoadLines ? 'visible' : 'none');
    }

    // Fit the map to the region or panotracks.
    const fitBounds = () => {
      if (bbox) {
        map.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: 28, maxZoom: 15 }
        );
        return;
      }
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
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 36, maxZoom: 15 }
        );
      }
    };
    fitBounds();
  }, [bbox, districtGeojson, dimmedRegionsGeojson, capturedPoints, roadRuns, showRoadLines]);

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
      map.remove();
      mapRef.current = null;
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
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.resize();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Resize when the surface becomes visible from a hidden state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (active) {
      requestAnimationFrame(() => map.resize());
    }
  }, [active]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full z-0" />;
};
