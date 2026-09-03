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
// a disallowed MIME type, blocking Worker creation and leaving a blank map).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

maplibregl.setWorkerUrl(workerUrl);

export interface RoadAnalysisMapProps {
  bbox?: [number, number, number, number] | null;
  districtGeojson?: any;
  /**
   * Non-selected region geometry (all districts minus the selected ones).
   * Rendered as a dimmed shade so the selected region stands out.
   */
  dimmedRegionsGeojson?: any;
  capturedPoints?: Array<[number, number]>;
  /** Clipped road-runs from the extraction service. */
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
const SOURCE_IDS = ['ra-dim', 'ra-districts', 'ra-captured', 'ra-captured-track', 'ra-roads'] as const;

/** Layer ids created by this component. */
const LAYER_IDS = [
  'ra-dim',
  'ra-districts',
  'ra-districts-line',
  'ra-captured',
  'ra-captured-track',
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

function extractPointCollection(points: Array<[number, number]>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.slice(0, 800).map((p) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'Point' as const, coordinates: [p[0], p[1]] }
    }))
  };
}

function extractTrackLine(points: Array<[number, number]>): GeoJSON.Feature | null {
  if (points.length < 2) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: points.slice(0, 800).map((p) => [p[0], p[1]] as [number, number])
    }
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

    // Captured points + track.
    if (capturedPoints.length > 0) {
      map.addSource('ra-captured', { type: 'geojson', data: extractPointCollection(capturedPoints) });
      map.addLayer({
        id: 'ra-captured',
        type: 'circle',
        source: 'ra-captured',
        paint: {
          'circle-radius': 3,
          'circle-color': '#f59e0b',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.6
        }
      });
      const track = extractTrackLine(capturedPoints);
      if (track) {
        map.addSource('ra-captured-track', { type: 'geojson', data: track });
        map.addLayer({
          id: 'ra-captured-track',
          type: 'line',
          source: 'ra-captured-track',
          paint: { 'line-color': '#f59e0b', 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [2, 4] }
        });
      }
    }

    // Extracted road lines (toggleable).
    map.addSource('ra-roads', { type: 'geojson', data: extractLineStringRuns(roadRuns) });
    map.addLayer({
      id: 'ra-roads',
      type: 'line',
      source: 'ra-roads',
      paint: { 'line-color': '#6b7280', 'line-width': 3, 'line-opacity': 0.6 }
    });
    // Initial visibility from the toggle.
    map.setLayoutProperty('ra-roads', 'visibility', showRoadLines ? 'visible' : 'none');

    // Fit the map to the region.
    const fitBounds = () => {
      if (bbox) {
        map.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: 28, maxZoom: 15 }
        );
        return;
      }
      if (roadRuns.length > 0 || capturedPoints.length > 0) {
        const pts: Array<[number, number]> = [];
        roadRuns.forEach((r) => r.forEach((p) => pts.push(p)));
        capturedPoints.forEach((p) => pts.push(p));
        if (pts.length > 0) {
          const lngs = pts.map((p) => p[0]);
          const lats = pts.map((p) => p[1]);
          map.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 28 }
          );
        }
      }
    };
    fitBounds();
  }, [bbox, districtGeojson, dimmedRegionsGeojson, capturedPoints, roadRuns, showRoadLines]);

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
    if (prevStyleRef.current === style) return;
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
