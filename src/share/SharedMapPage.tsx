import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { AlertTriangle, ChevronLeft, ChevronRight, Compass, Eye, MapPinned } from 'lucide-react';
import { GeoSphereIcon } from '../components/common/GeoSphereLogo';
import { PhotoSphereViewerComponent } from '../components/PhotoSphereViewerComponent';
import { getHeading, subscribeHeading } from '../utils/headingStore';
import {
  fetchShareByToken,
  parseShareToken,
  recallShareUnlock,
  rememberShareUnlock,
  resolveSegmentPanorama,
  touchShare,
  verifySharePassword,
  type MapShare,
  type ShareSegment
} from '../utils/mapShares';
import { SharePasswordGate } from './SharePasswordGate';

const effectiveWorkerUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPLIBRE_WORKER_URL) || workerUrl;
if (typeof (maplibregl as any).setWorkerUrl === 'function') {
  (maplibregl as any).setWorkerUrl(effectiveWorkerUrl);
}

type BasemapStyle = string | maplibregl.StyleSpecification;

const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const googleHybridStyle: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: OFM_GLYPHS,
  sources: {
    google: {
      type: 'raster',
      tiles: ['https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'],
      tileSize: 256,
      attribution: '© Google'
    }
  },
  layers: [{ id: 'google', type: 'raster', source: 'google' }]
};

const esriStyle: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: OFM_GLYPHS,
  sources: {
    esri: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri'
    }
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }]
};

const BASEMAPS: Record<string, { label: string; style: BasemapStyle }> = {
  'ofm-positron': { label: 'Positron', style: 'https://tiles.openfreemap.org/styles/positron' },
  'ofm-bright': { label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
  'google-hybrid': { label: 'Google Hybrid', style: googleHybridStyle },
  'ofm-dark': { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
  esri: { label: 'Esri', style: esriStyle }
};

// Legacy share records may have saved 'light'/'dark' keys that pointed at the
// same positron URL; map them to real styles so old links still get a working map.
const LEGACY_BASEMAP_ALIASES: Record<string, string> = {
  light: 'ofm-positron',
  dark: 'ofm-dark',
  'ofm-liberty': 'google-hybrid'
};

const COLOR_ROAD = '#047857';

function styleUrlFor(basemap: string): BasemapStyle {
  return (BASEMAPS[basemap] || BASEMAPS['ofm-positron']).style;
}

function safeCenter(c?: [number, number] | number[] | null): [number, number] {
  if (!Array.isArray(c) || c.length < 2) return [101.9758, 4.2105]; // [lng, lat] for Malaysia
  const [a, b] = c;
  if (!isFinite(a) || !isFinite(b)) return [101.9758, 4.2105];
  // If a is lat (~1..85) and b is lng (~90..180 for Malaysia/Asia), flip them to [lng, lat]
  if (Math.abs(a) <= 85 && Math.abs(b) > 85) {
    return [b, a];
  }
  // If a is lng (> 85) and b is lat (<= 85), it's already [lng, lat]
  if (Math.abs(a) > 85 && Math.abs(b) <= 85) {
    return [a, b];
  }
  return [a, Math.max(-85, Math.min(85, b))];
}

function featureCollection(coordsLists: Array<Array<[number, number]>>, props: Record<string, unknown>[]) {
  return {
    type: 'FeatureCollection' as const,
    features: coordsLists.map((coords, i) => ({
      type: 'Feature' as const,
      properties: props[i] || {},
      geometry: { type: 'LineString' as const, coordinates: coords.map(([lat, lng]) => [lng, lat]) }
    }))
  };
}

function pointCollection(points: Array<{ lat: number; lng: number }>, props: Record<string, unknown>[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p, i) => ({
      type: 'Feature' as const,
      properties: props[i] || {},
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }
    }))
  };
}


function panotrackCardHtml(
  share: MapShare,
  subgrid: string,
  pointStatus?: string,
  coords?: [number, number]
): string {
  const cleanSubgrid = (subgrid || '').trim();
  const seg = (share.snapshot.segments || []).find(
    (s) => s.subgrid && cleanSubgrid && s.subgrid.toUpperCase() === cleanSubgrid.toUpperCase()
  );
  const status = seg?.status === 'published' ? 'published' : (pointStatus ? pointStatus.toLowerCase() : 'published');

  let badgeLabel = 'Published';
  let badgeBg = '#ecfdf5';
  let badgeColor = '#059669';
  let badgeBorder = '#a7f3d0';
  let dotColor = '#10b981';

  if (status === 'defect') {
    badgeLabel = 'Defect';
    badgeBg = '#fff1f2';
    badgeColor = '#e11d48';
    badgeBorder = '#fecdd3';
    dotColor = '#ef4444';
  } else if (status === 'staging' || status === 'in-process') {
    badgeLabel = 'Staging';
    badgeBg = '#fffbeb';
    badgeColor = '#d97706';
    badgeBorder = '#fde68a';
    dotColor = '#f59e0b';
  }

  const title = cleanSubgrid || 'Panotrack Station';

  return `
    <div style="background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;box-shadow:0 12px 30px -4px rgba(15,23,42,0.1),0 4px 6px -2px rgba(15,23,42,0.04);padding:14px 16px;min-width:210px;max-width:260px;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <!-- Header with Status Pill and Tag -->
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding-right:20px;">
        <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:2px 7px;border-radius:9999px;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};">
          <span style="width:5px;height:5px;border-radius:50%;background:${dotColor};"></span>
          ${badgeLabel}
        </span>
        <span style="font-size:9.5px;font-weight:700;letter-spacing:0.06em;color:#94a3b8;text-transform:uppercase;">Panotrack</span>
      </div>

      <!-- Station Name -->
      <div style="font-size:14.5px;font-weight:800;color:#0f172a;line-height:1.2;margin-bottom:10px;">
        ${title}
      </div>

      <!-- Subtle Divider -->
      <div style="height:1px;background:#f1f5f9;margin-bottom:9px;"></div>

      <!-- Field Rows -->
      <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
        ${coords ? `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#64748b;font-weight:500;">Coordinates</span>
          <span style="color:#0f172a;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;">${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</span>
        </div>` : ''}
        ${cleanSubgrid ? `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#64748b;font-weight:500;">Subgrid</span>
          <span style="color:#0f172a;font-weight:700;">${cleanSubgrid}</span>
        </div>` : ''}
        ${seg ? `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#64748b;font-weight:500;">Survey Distance</span>
          <span style="color:#0f172a;font-weight:600;">${seg.km.toFixed(2)} km</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#64748b;font-weight:500;">POI Points</span>
          <span style="color:#0f172a;font-weight:600;">${seg.poi.toLocaleString()}</span>
        </div>
        ${seg.defects > 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#e11d48;font-weight:500;">Defects</span>
          <span style="color:#e11d48;font-weight:700;">${seg.defects}</span>
        </div>` : ''}
        ${seg.date ? `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#64748b;font-weight:500;">Survey Date</span>
          <span style="color:#0f172a;font-weight:600;">${seg.date}</span>
        </div>` : ''}
        ` : ''}
      </div>
    </div>
  `;
}

// Pinned Panotrack station card shown at the upper-left of the map when a
// station is clicked, instead of a popup anchored to the clicked point.
function StationInfoCard({
  share,
  station,
  onClose
}: {
  share: MapShare;
  station: { subgrid: string; status: string; coords: [number, number] };
  onClose: () => void;
}) {
  return (
    <div className="absolute top-12 left-3 z-10">
      <div className="relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close station info"
          className="absolute top-[12px] right-[12px] z-10 w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center hover:bg-slate-200 hover:text-slate-900 cursor-pointer"
        >
          &#10005;
        </button>
        <div dangerouslySetInnerHTML={{ __html: panotrackCardHtml(share, station.subgrid, station.status, station.coords) }} />
      </div>
    </div>
  );
}

/**
 * Calculates a geodesically accurate field-of-view / camera heading cone polygon.
 * Heading 0° = North, 90° = East, 180° = South, 270° = West.
 */
function buildConePolygon(
  center: [number, number],
  headingDeg: number,
  fovDeg: number = 65,
  distanceMeters: number = 38
): any {
  const [lng, lat] = center;
  const R = 6371008.8;
  const d = distanceMeters / R;
  const latRad = (lat * Math.PI) / 180;
  const lngRad = (lng * Math.PI) / 180;

  const halfFov = fovDeg / 2;
  const startAngle = headingDeg - halfFov;
  const endAngle = headingDeg + halfFov;
  const steps = 16;
  const arcCoords: Array<[number, number]> = [];

  for (let i = 0; i <= steps; i++) {
    const bearing = (startAngle + (i / steps) * (endAngle - startAngle)) * (Math.PI / 180);
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
      Math.cos(latRad) * Math.sin(d) * Math.cos(bearing)
    );
    const pLng = lngRad + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(pLat)
    );
    arcCoords.push([(pLng * 180) / Math.PI, (pLat * 180) / Math.PI]);
  }

  const ring = [[lng, lat], ...arcCoords, [lng, lat]];

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [ring]
        },
        properties: { type: 'cone' }
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        properties: { type: 'center' }
      }
    ]
  };
}

function lineLengthKm(coords: Array<[number, number]>): number {
  // reuse the share util distance math
  const R = 6371.0088;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  return total;
}

function ShareMap({
  share,
  activeCoord,
  onCoords,
  onSelectSubgrid
}: {
  share: MapShare;
  activeCoord?: [number, number] | null;
  onCoords: (c: { lat: number; lng: number } | null) => void;
  onSelectSubgrid?: (subgrid: string, coords?: [number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activeCoordRef = useRef<[number, number] | null>(activeCoord || null);
  activeCoordRef.current = activeCoord || null;
  const currentHeadingRef = useRef<number>(getHeading());
  const [basemap, setBasemap] = useState<string>(() =>
    LEGACY_BASEMAP_ALIASES[share.basemap] || (BASEMAPS[share.basemap] ? share.basemap : 'ofm-positron')
  );
  const [selectedStation, setSelectedStation] = useState<{ subgrid: string; status: string; coords: [number, number] } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const snap = share?.snapshot || ({} as any);
    const center = safeCenter(snap.center);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleUrlFor(basemap),
        center,
        zoom: typeof snap.zoom === 'number' && isFinite(snap.zoom) ? snap.zoom : 10,
        attributionControl: { compact: true }
      });
    } catch (err) {
      console.error('[SharedMapPage] Map constructor error:', err);
      return;
    }

    if (map && typeof map.addControl === 'function') {
      try {
        const NavControl = maplibregl.NavigationControl;
        if (NavControl) {
          map.addControl(new NavControl({ showCompass: true }), 'top-right');
        }
      } catch { /* ignore nav control in tests */ }
    }

    if (map && typeof map.on === 'function') {
      map.on('load', () => {
        try {
          const lines = (snap.lines || []).filter((l: any) => l && Array.isArray(l.coords) && l.coords.length > 1);
          const pts = (snap.points || []).filter((p: any) => p && isFinite(p.lat) && isFinite(p.lng));

          // 1. Road lines (from extracted network or road plans)
          if (lines.length) {
            map.addSource('roads', {
              type: 'geojson',
              data: featureCollection(
                lines.map((l: any) => l.coords),
                lines.map((l: any) => ({ name: l.name || '', km: lineLengthKm(l.coords) }))
              )
            });
            map.addLayer({
              id: 'roads-casing', type: 'line', source: 'roads',
              paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.7 }
            });
            map.addLayer({
              id: 'roads-line', type: 'line', source: 'roads',
              paint: { 'line-color': COLOR_ROAD, 'line-width': 2.6 }
            });
          }

          // 2. Captured stations / survey points with clustering & dynamic zoom sizing
          if (pts.length) {
            map.addSource('stations', {
              type: 'geojson',
              data: pointCollection(pts, pts.map((p: any) => ({
                subgrid: p.subgrid || '',
                status: p.status || 'published',
                color: p.color
              }))),
              cluster: true,
              clusterMaxZoom: 13,
              clusterRadius: 45
            });

            // Cluster bubbles
            map.addLayer({
              id: 'stations-clusters',
              type: 'circle',
              source: 'stations',
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
                'circle-stroke-width': 2
              }
            });

            // Cluster count number
            map.addLayer({
              id: 'stations-cluster-count',
              type: 'symbol',
              source: 'stations',
              filter: ['has', 'point_count'],
              layout: {
                'text-field': '{point_count_abbreviated}',
                // OpenFreeMap's glyph endpoint serves only the Noto Sans family —
                // requesting "Open Sans Bold" 404s and the count silently drops out.
                'text-font': ['Noto Sans Bold'],
                'text-size': 12
              },
              paint: {
                'text-color': '#ffffff'
              }
            });

            // Individual unclustered points
            map.addLayer({
              id: 'stations-circle',
              type: 'circle',
              source: 'stations',
              filter: ['!', ['has', 'point_count']],
              paint: {
                'circle-radius': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  6, 3,
                  11, 4.5,
                  15, 7
                ],
                'circle-color': [
                  'match',
                  ['get', 'status'],
                  'published', '#10b981',
                  'defect', '#ef4444',
                  'staging', '#f59e0b',
                  'in-process', '#f59e0b',
                  '#10b981'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1.5
              }
            });

            // Cluster click: smooth expansion zoom
            map.on('click', 'stations-clusters', (e: maplibregl.MapLayerMouseEvent) => {
              const features = map.queryRenderedFeatures(e.point, { layers: ['stations-clusters'] });
              const clusterId = features[0]?.properties?.cluster_id;
              const source = map.getSource('stations') as any;
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
            map.on('mouseenter', 'stations-clusters', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'stations-clusters', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = '';
            });

            map.on('click', 'stations-circle', (e: maplibregl.MapLayerMouseEvent) => {
              const f = e.features && e.features[0];
              if (!f) return;
              const coords = e.lngLat.toArray() as [number, number];
              const subgrid = String(f.properties?.subgrid || '');
              const status = String(f.properties?.status || '');
              setSelectedStation({ subgrid, status, coords });
              if (onSelectSubgrid) onSelectSubgrid(subgrid, coords);
            });
            map.on('mouseenter', 'stations-circle', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'stations-circle', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = '';
            });
          }

          // 2b. Heading Cone Source & Layers (synchronized live from 360 viewer orientation)
          map.addSource('heading-cone', {
            type: 'geojson',
            data: activeCoordRef.current
              ? buildConePolygon(activeCoordRef.current, currentHeadingRef.current)
              : { type: 'FeatureCollection', features: [] }
          });

          map.addLayer({
            id: 'heading-cone-fill',
            type: 'fill',
            source: 'heading-cone',
            filter: ['==', '$type', 'Polygon'],
            paint: {
              'fill-color': '#0284c7',
              'fill-opacity': 0.32
            }
          });

          map.addLayer({
            id: 'heading-cone-line',
            type: 'line',
            source: 'heading-cone',
            filter: ['==', '$type', 'Polygon'],
            paint: {
              'line-color': '#0284c7',
              'line-width': 1.8,
              'line-opacity': 0.85
            }
          });

          map.addLayer({
            id: 'heading-cone-center',
            type: 'circle',
            source: 'heading-cone',
            filter: ['==', '$type', 'Point'],
            paint: {
              'circle-radius': 5,
              'circle-color': '#0284c7',
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2
            }
          });

          // Dismiss selected station card when clicking on empty map space
          map.on('click', (e: maplibregl.MapMouseEvent) => {
            const features = (typeof map.queryRenderedFeatures === 'function')
              ? map.queryRenderedFeatures(e.point, { layers: ['stations-circle', 'stations-clusters'] })
              : [];
            if (!features || features.length === 0) {
              setSelectedStation(null);
            }
          });

          // 3. User-imported catalog GIS layers (rendered cleanly without click popups)
          const catLayers = (snap.catalogLayers || []).filter((cl: any) => cl && cl.geojson && Array.isArray(cl.geojson.features) && cl.geojson.features.length > 0);
          catLayers.forEach((cl: any, ci: number) => {
            const srcId = `catalog-${ci}`;
            const color = cl.color || '#38bdf8';
            const fillColor = cl.fillColor || color;
            const fillOpacity = typeof cl.fillOpacity === 'number' ? cl.fillOpacity : (typeof cl.opacity === 'number' ? cl.opacity * 0.35 : 0.3);
            const opacity = typeof cl.opacity === 'number' ? Math.max(0.1, Math.min(1, cl.opacity)) : 0.85;
            const strokeWidth = typeof cl.strokeWidth === 'number' ? cl.strokeWidth : 3;
            const pointRadius = typeof cl.pointRadius === 'number' ? cl.pointRadius : 5;
            const geomType = cl.geometryType || 'Mixed';
            const linePaint: any = { 'line-color': color, 'line-opacity': opacity, 'line-width': strokeWidth };
            if (cl.strokeStyle === 'dashed') linePaint['line-dasharray'] = [3, 2];
            else if (cl.strokeStyle === 'dotted') linePaint['line-dasharray'] = [1, 2];

            try {
              map.addSource(srcId, { type: 'geojson', data: cl.geojson });
              if (geomType === 'Polygon' || geomType === 'Mixed') {
                map.addLayer({ id: `${srcId}-fill`, type: 'fill', source: srcId, paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity } });
                map.addLayer({ id: `${srcId}-outline`, type: 'line', source: srcId, paint: linePaint });
              }
              if (geomType === 'LineString' || geomType === 'Mixed') {
                map.addLayer({ id: `${srcId}-line`, type: 'line', source: srcId, paint: linePaint });
              }
              if (geomType === 'Point' || geomType === 'Mixed') {
                map.addLayer({
                  id: `${srcId}-point`,
                  type: 'circle',
                  source: srcId,
                  paint: {
                    'circle-radius': pointRadius,
                    'circle-color': color,
                    'circle-opacity': opacity,
                    'circle-stroke-color': cl.pointStrokeColor || '#ffffff',
                    'circle-stroke-width': cl.pointStrokeWidth ?? 1.5
                  }
                });
              }
            } catch (err) {
              console.warn('[SharedMapPage] Catalog layer render notice:', err);
            }
          });

          // 3b. Point cluster overlay re-raised above all other layers
          //     (roads, heading cone, imported catalog polygons/fills).
          //     moveLayer raises each id to the TOP in list order, so the
          //     count text must come LAST — otherwise the opaque bubble is
          //     re-raised over the number and the cluster count disappears.
          ['stations-circle', 'stations-clusters', 'stations-cluster-count'].forEach((id) => {
            if (map.getLayer(id)) map.moveLayer(id);
          });

          // 4. Safe bounding box zoom
          if (Array.isArray(snap.bbox) && snap.bbox.length === 4) {
            const [c0, c1, c2, c3] = snap.bbox;
            if (isFinite(c0) && isFinite(c1) && isFinite(c2) && isFinite(c3)) {
              const lats = [c0, c1, c2, c3].filter((v) => Math.abs(v) <= 90);
              const lngs = [c0, c1, c2, c3].filter((v) => Math.abs(v) > 90);
              let minLng: number, minLat: number, maxLng: number, maxLat: number;
              if (lats.length >= 2 && lngs.length >= 2) {
                minLat = Math.min(...lats);
                maxLat = Math.max(...lats);
                minLng = Math.min(...lngs);
                maxLng = Math.max(...lngs);
              } else {
                minLng = Math.min(c0, c2);
                maxLng = Math.max(c0, c2);
                minLat = Math.min(c1, c3);
                maxLat = Math.max(c1, c3);
              }
              if (maxLng > minLng && maxLat > minLat) {
                map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
                  padding: { top: 90, bottom: 110, left: 20, right: 20 },
                  duration: 0
                });
              }
            }
          }
        } catch (err) {
          console.warn('[SharedMapPage] MapLayer load notice:', err);
        }
      });

      map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
        if (e?.lngLat) onCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      map.on('mouseout', () => onCoords(null));
    }

    // Observe container resizing to prevent 0-sized canvas / blank white screen
    let ro: ResizeObserver | null = null;
    const container = containerRef.current;
    if (typeof ResizeObserver !== 'undefined' && container) {
      ro = new ResizeObserver(() => {
        if (mapRef.current) {
          mapRef.current.resize();
        }
      });
      ro.observe(container);
    }

    // Delayed trigger passes to ensure canvas adapts after layout settles
    requestAnimationFrame(() => map?.resize?.());
    const t1 = setTimeout(() => map?.resize?.(), 100);
    const t2 = setTimeout(() => map?.resize?.(), 500);

    // Live heading-cone synchronization: updates cone GeoJSON directly at 60fps with zero React re-render
    const unsubHeading = subscribeHeading((yawDeg) => {
      currentHeadingRef.current = yawDeg;
      if (activeCoordRef.current && mapRef.current) {
        const source = mapRef.current.getSource('heading-cone') as maplibregl.GeoJSONSource | undefined;
        if (source && typeof source.setData === 'function') {
          source.setData(buildConePolygon(activeCoordRef.current, yawDeg));
        }
      }
    });

    mapRef.current = map;
    return () => {
      unsubHeading();
      if (ro) ro.disconnect();
      clearTimeout(t1);
      clearTimeout(t2);
      try {
        map.remove();
      } catch { /* ignore */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, basemap]);

  // Synchronize heading cone position and map camera when activeCoord changes
  useEffect(() => {
    activeCoordRef.current = activeCoord || null;
    if (mapRef.current) {
      const source = mapRef.current.getSource('heading-cone') as maplibregl.GeoJSONSource | undefined;
      if (source && typeof source.setData === 'function') {
        if (activeCoord) {
          source.setData(buildConePolygon(activeCoord, currentHeadingRef.current));
          if (typeof mapRef.current.easeTo === 'function') {
            mapRef.current.easeTo({ center: activeCoord, duration: 600 });
          }
        } else {
          source.setData({ type: 'FeatureCollection', features: [] });
        }
      }
    }
  }, [activeCoord]);

  return (
    <div className="absolute inset-0">
      <style>{`
        .maplibregl-popup-content {
          padding: 0 !important;
          background: transparent !important;
          border-radius: 14px !important;
          box-shadow: 0 12px 30px -4px rgba(15, 23, 42, 0.1), 0 4px 6px -2px rgba(15, 23, 42, 0.04) !important;
          border: none !important;
        }
        .maplibregl-popup-tip {
          border-top-color: #ffffff !important;
        }
      `}</style>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow px-1 py-1">
        {Object.entries(BASEMAPS).map(([key, def]) => (
          <button
            key={key}
            onClick={() => setBasemap(key)}
            className={`px-2.5 py-1 rounded text-[10.5px] font-semibold transition-colors cursor-pointer ${
              basemap === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {def.label}
          </button>
        ))}
      </div>
      {selectedStation && (
        <StationInfoCard
          share={share}
          station={selectedStation}
          onClose={() => setSelectedStation(null)}
        />
      )}
    </div>
  );
}

function LegendCard({ share }: { share: MapShare }) {
  const st = share?.snapshot?.stats || { subgrids: 0, km: 0, poi: 0, frames: 0, defects: 0, passRate: 100, lines: 0 };
  const sw = (color: string, dashed?: boolean) => (
    <span className="inline-block w-4 h-[3px] rounded" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }} />
  );
  return (
    <div className="absolute bottom-6 left-4 z-10 bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-lg p-3.5 w-[240px]">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        <MapPinned size={11} /> Legend
      </div>
      {share.kind === 'road' ? (
        <div className="space-y-1.5 text-[11px] text-slate-700">
          {Array.isArray(share.snapshot?.lines) && share.snapshot.lines.length > 0 && (
            <div className="flex items-center gap-2">{sw(COLOR_ROAD)} Extracted road trace</div>
          )}
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#10b981' }} /> Published survey</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} /> Staging survey</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} /> Defect panorama</div>
          {Array.isArray(share.snapshot?.catalogLayers) && share.snapshot.catalogLayers.length > 0 && (
            <>
              <div className="pt-1.5 border-t border-slate-100">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Imported layers</div>
                <div className="space-y-1.5">
                  {share.snapshot.catalogLayers.map((cl, i) => (
                    <div key={`${cl.id || 'cat'}-${i}`} className="flex items-center gap-2 text-[11px] text-slate-700">
                      {sw(cl.color || '#38bdf8', cl.strokeStyle === 'dashed')} {cl.name || 'Imported layer'}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="pt-1.5 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed">
            {(st.lines ?? 0) > 0 && (
              <>
                <strong className="text-slate-900">{(st.lines || 0).toLocaleString()}</strong>{' '}
                {Array.isArray(share.snapshot?.catalogLayers) && share.snapshot.catalogLayers.length > 0 && (!share.snapshot?.lines || share.snapshot.lines.length === 0)
                  ? 'features'
                  : 'lines'}{' '}
                ·{' '}
              </>
            )}
            <strong className="text-slate-900">{typeof st.km === 'number' ? st.km.toFixed(2) : '0.00'} km</strong>
            {(st.poi ?? 0) > 0 && <> · <strong className="text-slate-900">{st.poi.toLocaleString()}</strong> survey points</>}
            {(st.subgrids ?? 0) > 0 && <> · <strong className="text-slate-900">{st.subgrids}</strong> subgrids</>}
            {share.snapshot?.planName ? <><br/><span className="text-slate-500">{share.snapshot.planName}</span></> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 text-[11px] text-slate-700">
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#10b981' }} /> Published survey</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} /> Staging survey</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} /> Defect panorama</div>
          <div className="pt-1.5 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed">
            <strong className="text-slate-900">{st.subgrids}</strong> subgrids · <strong className="text-slate-900">{typeof st.km === 'number' ? st.km.toFixed(2) : '0.00'} km</strong> · <strong className="text-slate-900">{(st.poi || 0).toLocaleString()}</strong> POIs
            <br /><strong className="text-slate-900">{(st.frames || 0).toLocaleString()}</strong> panoramas · QA pass <strong className="text-slate-900">{typeof st.passRate === 'number' ? st.passRate.toFixed(1) : '100'}%</strong>
          </div>
        </div>
      )}
      <div className="mt-2 text-[9.5px] text-slate-400">Click markers for details · read-only view</div>
    </div>
  );
}

function StatusCard({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-lg p-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-5">
          <GeoSphereIcon size={24} colorful={false} className="text-slate-900" />
          <span className="text-[14px] font-extrabold text-slate-900">GeoSphere <span className="text-slate-500">360°</span></span>
        </div>
        <div className="mx-auto w-11 h-11 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">
          {icon}
        </div>
        <h1 className="mt-4 text-[15px] font-bold text-slate-900">{title}</h1>
        <p className="mt-1.5 text-[12px] text-slate-500 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}


/** Small picture-in-picture 360° panorama viewer pinned to the bottom-right corner with frame navigation. */
function PipPanoramaViewer({
  segment,
  media,
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  onClose
}: {
  segment: ShareSegment;
  media?: { panoramaUrl?: string; configUrl?: string } | null;
  currentIndex?: number;
  totalCount?: number;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const [pinned, setPinned] = useState(true);
  const panoramaUrl = media?.panoramaUrl || segment.panoramaUrl;
  const configUrl = media?.configUrl || segment.configUrl;
  return (
    <div className="absolute bottom-[66px] right-4 z-20 w-[270px] sm:w-[325px] bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 min-w-0">
          <Eye size={11} className="shrink-0 text-sky-600" />
          <span className="truncate text-slate-800">360° · {segment.subgrid}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Minimal Prev / Next Frame Controls */}
          {typeof totalCount === 'number' && totalCount > 1 && (
            <div className="flex items-center gap-0.5 bg-slate-100/90 border border-slate-200/80 rounded-md p-0.5 text-[10px] font-bold text-slate-600">
              <button
                type="button"
                disabled={typeof currentIndex === 'number' && currentIndex <= 0}
                onClick={onPrev}
                title="Previous frame"
                aria-label="Previous frame"
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:hover:bg-transparent transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="px-1 text-[9.5px] tabular-nums text-slate-500 select-none">
                {(currentIndex ?? 0) + 1}/{totalCount}
              </span>
              <button
                type="button"
                disabled={typeof currentIndex === 'number' && currentIndex >= totalCount - 1}
                onClick={onNext}
                title="Next frame"
                aria-label="Next frame"
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:hover:bg-transparent transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setPinned((v) => !v)}
            aria-label={pinned ? 'Pause 360° viewer' : 'Resume 360° viewer'}
            className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer"
          >
            {pinned ? <Eye size={12} /> : <Eye size={12} className="opacity-40" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close 360 viewer"
            className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-800 flex items-center justify-center cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>
      </div>
      {pinned ? (
        <PhotoSphereViewerComponent
          panoramaUrl={panoramaUrl}
          configUrl={configUrl}
          caption={`360° · ${segment.subgrid}`}
          className="w-full h-[172px]"
        />
      ) : (
        <div className="h-[172px] flex items-center justify-center bg-slate-50 text-[11px] text-slate-400 font-semibold">
          360° viewer paused
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-slate-100 text-[9.5px] text-slate-400">
        {segment.frames.toLocaleString()} panoramas · {segment.km.toFixed(2)} km
      </div>
    </div>
  );
}

type ShareCoords = { lat: number; lng: number } | null;

/**
 * Live-reference mode (`VITE_SHARE_LIVE_MODE=1`): embeds the actual WebGIS map
 * application instead of reconstructing the snapshot on a static map. Only
 * reaches full usefulness once the embedded map app honors the `share=<token>`
 * read-only scope and the postMessage protocol below. Off by default; the
 * snapshot renderer remains the stable product behavior.
 */
function liveShareUrl(share: MapShare): string {
  const base = (import.meta.env.VITE_MAP_URL as string | undefined) || '';
  const p = new URLSearchParams({
    embed: 'true',
    preview: 'true',
    noSonar: '1',
    share: share.token,
    basemap: share.basemap || 'ofm-positron'
  });
  return `${base.replace(/\/+$/, '')}/?${p.toString()}`;
}

function LiveMapReference({
  share,
  subgrid,
  onCoords,
  onSelectSubgrid
}: {
  share: MapShare;
  subgrid: string | null;
  onCoords: (c: ShareCoords) => void;
  onSelectSubgrid: (sg: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const src = useMemo(() => liveShareUrl(share), [share]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; coords?: { lat?: number; lng?: number } | null; subgrid?: string } | null;
      if (!d) return;
      if (d.type === 'SHARE_COORDS') {
        const c = d.coords;
        onCoords(c && typeof c.lat === 'number' && typeof c.lng === 'number' ? { lat: c.lat, lng: c.lng } : null);
      } else if (d.type === 'SHARE_FOCUS_SEGMENT' && typeof d.subgrid === 'string') {
        onSelectSubgrid(d.subgrid);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onCoords, onSelectSubgrid]);

  useEffect(() => {
    if (!subgrid) return;
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'SHARE_FOCUS', subgrid }, '*');
    } catch { /* cross-origin iframe may reject; ignore */ }
  }, [subgrid]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={`Shared ${share.kind === 'road' ? 'Road Analysis' : 'WebGIS'} map · live reference`}
      className="absolute inset-0 w-full h-full border-0"
      allowFullScreen
    />
  );
}

export function SharedMapPage() {
  const token = useMemo(() => {
    return parseShareToken(window.location.pathname) || parseShareToken(window.location.hash);
  }, []);
  const [share, setShare] = useState<MapShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pipSubgrid, setPipSubgrid] = useState<string | null>(null);
  const [activeCoord, setActiveCoord] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    fetchShareByToken(token)
      .then(async (s) => {
        if (cancelled) return;
        setShare(s);
        setLoading(false);
        if (!s) return;
        if (!s.password_hash) {
          setUnlocked(true);
        } else {
          const saved = recallShareUnlock(token);
          if (saved && (await verifySharePassword(s, saved))) setUnlocked(true);
        }
        touchShare(token);
      })
      .catch((err) => {
        console.error('[SharedMapPage] fetchShareByToken error:', err);
        if (!cancelled) {
          setShare(null);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  // Compile full navigable frames list from segments and survey points
  const framesList = useMemo(() => {
    if (!share) return [];
    const segs = share.snapshot.segments || [];
    if (segs.length > 0) {
      return segs.map((s, idx) => {
        const pt = (share.snapshot.points || []).find(
          (p) => p.subgrid && s.subgrid && p.subgrid.toUpperCase() === s.subgrid.toUpperCase()
        );
        const c: [number, number] = pt
          ? [pt.lng, pt.lat]
          : (Array.isArray(share.snapshot.center) && share.snapshot.center.length >= 2
              ? [share.snapshot.center[1], share.snapshot.center[0]]
              : [101.6869, 3.139]);
        return {
          id: `seg-${idx}`,
          subgrid: s.subgrid,
          segment: s,
          coords: c,
          media: resolveSegmentPanorama(s, share.snapshot.storage)
        };
      });
    }

    const pts = (share.snapshot.points || []).filter((p) => isFinite(p.lat) && isFinite(p.lng));
    if (pts.length > 0) {
      return pts.map((p, idx) => ({
        id: `pt-${idx}`,
        subgrid: p.subgrid || `Station ${idx + 1}`,
        segment: {
          subgrid: p.subgrid || `Station ${idx + 1}`,
          km: 0,
          poi: 1,
          frames: 1,
          defects: p.status === 'defect' ? 1 : 0,
          status: p.status === 'defect' || p.status === 'staging' || p.status === 'in-process' ? 'in-process' : 'published',
          panoramaUrl: undefined
        } as ShareSegment,
        coords: [p.lng, p.lat] as [number, number],
        media: null
      }));
    }
    return [];
  }, [share]);

  const currentFrameIndex = useMemo(() => {
    if (!pipSubgrid || framesList.length === 0) return 0;
    const idx = framesList.findIndex(
      (f) => f.subgrid && pipSubgrid && f.subgrid.toUpperCase() === pipSubgrid.toUpperCase()
    );
    return idx >= 0 ? idx : 0;
  }, [pipSubgrid, framesList]);

  const activeFrame = framesList[currentFrameIndex] || null;

  const handlePrevFrame = () => {
    if (currentFrameIndex > 0) {
      const prev = framesList[currentFrameIndex - 1];
      setPipSubgrid(prev.subgrid);
      setActiveCoord(prev.coords);
    }
  };

  const handleNextFrame = () => {
    if (currentFrameIndex < framesList.length - 1) {
      const next = framesList[currentFrameIndex + 1];
      setPipSubgrid(next.subgrid);
      setActiveCoord(next.coords);
    }
  };

  const handleCloseViewer = () => {
    setPipSubgrid(null);
    setActiveCoord(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500 text-[13px] font-semibold">
          <Compass size={18} className="animate-spin" />
          Loading shared map…
        </div>
      </div>
    );
  }

  if (!token || !share) {
    return (
      <StatusCard
        icon={<AlertTriangle size={20} />}
        title="This map link is no longer available"
        message="The link may have expired, been revoked by the project team, or was mistyped. Please ask the sender for a fresh share link."
      />
    );
  }

  if (!unlocked) {
    return (
      <SharePasswordGate
        shareTitle={share.title}
        onUnlock={async (pw) => {
          const ok = await verifySharePassword(share, pw);
          if (ok) {
            rememberShareUnlock(share.token, pw);
            setUnlocked(true);
          }
          return ok;
        }}
      />
    );
  }

  const st = share?.snapshot?.stats || { subgrids: 0, km: 0, poi: 0, frames: 0, defects: 0, passRate: 100, lines: 0 };
  const hasKm = typeof st.km === 'number' && st.km > 0;
  return (
    <div className="fixed inset-0 flex flex-col bg-white font-[Arial,Helvetica,sans-serif]">
      <header className="h-[52px] shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <GeoSphereIcon size={22} colorful={false} className="text-slate-900 shrink-0" />
          <span className="text-[13px] font-extrabold text-slate-900 whitespace-nowrap">GeoSphere <span className="text-slate-500">360°</span></span>
          <span className="hidden sm:block w-px h-5 bg-slate-200 mx-1" />
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold text-slate-900 truncate">{share.title}</div>
            <div className="text-[9.5px] text-slate-500 uppercase tracking-wide truncate">
              {share.kind === 'road' ? 'Road Analysis' : 'WebGIS Survey'}{hasKm ? ` · ${st.km.toFixed(2)} km` : ''}{share.snapshot?.contractCode ? ` · ${share.snapshot.contractCode}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-500 border border-slate-200 rounded-full px-2.5 py-1">
            <Eye size={11} /> Read-only share
          </span>
          {share.password_hash && (
            <span className="hidden md:inline text-[9.5px] font-semibold text-slate-400 uppercase tracking-wider">Password protected</span>
          )}
        </div>
      </header>

      <main className="flex-1 relative min-h-0">
        {(import.meta.env.VITE_SHARE_LIVE_MODE as string | undefined) === '1' ? (
          <LiveMapReference share={share} subgrid={pipSubgrid} onCoords={setCoords} onSelectSubgrid={setPipSubgrid} />
        ) : (
          <ShareMap
            share={share}
            activeCoord={activeCoord}
            onCoords={setCoords}
            onSelectSubgrid={(sg, c) => {
              setPipSubgrid(sg);
              if (c) {
                setActiveCoord(c);
              } else {
                const matched = framesList.find(
                  (f) => f.subgrid && sg && f.subgrid.toUpperCase() === sg.toUpperCase()
                );
                if (matched) setActiveCoord(matched.coords);
              }
            }}
          />
        )}
        <LegendCard share={share} />
        {activeFrame && (activeFrame.media?.panoramaUrl || activeFrame.segment.panoramaUrl) && (
          <PipPanoramaViewer
            segment={activeFrame.segment}
            media={activeFrame.media}
            currentIndex={currentFrameIndex}
            totalCount={framesList.length}
            onPrev={handlePrevFrame}
            onNext={handleNextFrame}
            onClose={handleCloseViewer}
          />
        )}
        <div className="absolute bottom-6 right-4 z-10 bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow px-3 py-1.5 text-[10.5px] font-semibold text-slate-600 tabular-nums">
          {coords ? `${Math.abs(coords.lat).toFixed(5)}° ${coords.lat >= 0 ? 'N' : 'S'}, ${Math.abs(coords.lng).toFixed(5)}° ${coords.lng >= 0 ? 'E' : 'W'}` : 'Move cursor to read coordinates'}
        </div>
      </main>

      <footer className="h-[26px] shrink-0 bg-white border-t border-slate-200 flex items-center justify-between px-4 text-[9px] text-slate-400 uppercase tracking-wider z-20">
        <span>GeoSphere 360 · Mobile Mapping Surveillance</span>
        <span>Shared {new Date(share.created_at).toLocaleDateString('en-GB')}</span>
      </footer>
    </div>
  );
}
