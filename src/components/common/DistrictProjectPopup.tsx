import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import { DISTRICT_METADATA } from '../boundary/districtMetadata';
import type { PanotrackPoint } from '../../utils/panotrackExtractor';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Setup MapLibre web worker (same as the standalone boundary dashboard)
const effectiveWorkerUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPLIBRE_WORKER_URL) || workerUrl;
maplibregl.setWorkerUrl(effectiveWorkerUrl);

// OpenFreeMap style tiles — embedded display-only
const OFM_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const OFM_LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export interface DistrictGalleryItem {
  id?: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  totalFrames?: number;
  totalPoi?: number;
  surveyMileage?: number;
  pipelineSla?: string;
  subgrids?: string[];
  trackPoints?: Array<[number, number]>;
}

export interface PanotrackPopupData {
  regionName: string;
  stateName: string;
  latitude: number;
  longitude: number;
  totalFrames: number;
  totalPoi: number;
  surveyMileage: number;
  pipelineSla: string;
  publishedCount?: number;
  stagingCount?: number;
  defectCount?: number;
  subgrids?: string[];
  trackPoints?: Array<[number, number]>;
  /** Actual project boundary FeatureCollection (one Feature per selected district). */
  boundaryGeojson?: any;
  /** [minLng, minLat, maxLng, maxLat] of the committed boundary. */
  boundaryBbox?: [number, number, number, number];
  /** Status-coloured panotrack points available on the project (boundary-scoped). */
  panotrackPoints?: PanotrackPoint[];
}

export interface DistrictProjectPopupProps {
  data: PanotrackPopupData;
  districts?: DistrictGalleryItem[];
  activeDistrictIndex?: number;
  onSelectDistrict?: (index: number) => void;
  onClose: () => void;
  className?: string;
}

/** Find a feature inside the boundary FeatureCollection by district name fuzzy match. */
function findFeature(geojson: any, name: string): any | null {
  if (!geojson || !Array.isArray(geojson.features)) return null;
  const target = (name || '').toLowerCase().trim();
  if (!target) return null;
  return (
    geojson.features.find((f: any) => {
      const n = String(f.properties?.name || '').toLowerCase();
      const id = String(f.id || '').toLowerCase();
      return n === target || id === target || n.includes(target) || target.includes(n);
    }) || null
  );
}

/** Normalized feature identity used to merge boundary polygons from different sources. */
function featureNameOf(f: any): string {
  return String(f?.properties?.name || f?.id || '').trim().toLowerCase();
}

/**
 * Merge the committed boundary features with district outlines derived from the
 * master district geojson by the committed district names. Every committed district
 * that appears in ANY source is kept (deduped by name), so nothing the user saved
 * in project settings is ever dropped from the HUD card map.
 */
export function mergeCommittedBoundaryFeatures(
  boundaryFeatures: any[],
  districtNames: string[],
  allFeatures: any[]
): any[] {
  const names = (districtNames || []).map((n) => String(n || '').toLowerCase().trim()).filter(Boolean);
  const committed = (boundaryFeatures || []).filter((f: any) => f?.geometry);
  const derived = (allFeatures || []).filter((f: any) => {
    const n = featureNameOf(f);
    return n && names.includes(n);
  });
  const byName = new Map<string, any>();
  committed.forEach((f: any) => {
    const k = featureNameOf(f);
    if (k) byName.set(k, f);
  });
  derived.forEach((f: any) => {
    const k = featureNameOf(f);
    if (k && !byName.has(k)) byName.set(k, f);
  });
  return Array.from(byName.values());
}

export const DistrictProjectPopup: React.FC<DistrictProjectPopupProps> = ({
  data,
  districts = [],
  activeDistrictIndex = 0,
  onSelectDistrict,
  onClose,
  className = '',
}) => {
  const regionName = data.regionName || districts[0]?.state || 'Malaysia';
  const districtCount = districts.length;
  const districtLabel = districtCount === 0 ? 'Project area' : districtCount === 1 ? '1 district' : `${districtCount} districts`;

  const [activeIdx, setActiveIdx] = useState(
    activeDistrictIndex >= 0 && activeDistrictIndex < districts.length ? activeDistrictIndex : 0
  );

  useEffect(() => {
    if (activeDistrictIndex >= 0 && activeDistrictIndex < districts.length) {
      setActiveIdx(activeDistrictIndex);
    }
  }, [activeDistrictIndex, districts.length]);

  const handleSelectDistrict = useCallback(
    (idx: number) => {
      setActiveIdx(idx);
      if (onSelectDistrict) onSelectDistrict(idx);
    },
    [onSelectDistrict]
  );

  // Region bounds: prefer the committed boundary bbox, else union of district metadata
  const regionBbox = useMemo<[number, number, number, number]>(() => {
    // 1. Use the actual committed boundary bbox
    if (data.boundaryBbox && Array.isArray(data.boundaryBbox) && data.boundaryBbox.length === 4) {
      return data.boundaryBbox;
    }
    // 2. Compute union from district metadata
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    districts.forEach((d) => {
      const meta = DISTRICT_METADATA.find((m) => m.name.toLowerCase() === d.name.toLowerCase());
      if (meta?.bbox) {
        minLng = Math.min(minLng, meta.bbox[0]);
        minLat = Math.min(minLat, meta.bbox[1]);
        maxLng = Math.max(maxLng, meta.bbox[2]);
        maxLat = Math.max(maxLat, meta.bbox[3]);
      } else if (d.lng && d.lat) {
        minLng = Math.min(minLng, d.lng);
        maxLng = Math.max(maxLng, d.lng);
        minLat = Math.min(minLat, d.lat);
        maxLat = Math.max(maxLat, d.lat);
      }
    });
    if (Number.isFinite(minLng)) return [minLng, minLat, maxLng, maxLat];
    // 3. Final fallback
    return [data.longitude - 0.5, data.latitude - 0.4, data.longitude + 0.5, data.latitude + 0.4];
  }, [data.boundaryBbox, districts, data.latitude, data.longitude]);

  const regionCenter = useMemo(() => ({
    lat: (regionBbox[1] + regionBbox[3]) / 2,
    lng: (regionBbox[0] + regionBbox[2]) / 2,
  }), [regionBbox]);

  const safeFrames = Number(data.totalFrames ?? 0);
  const safePoi = Number(data.totalPoi ?? 0);
  const safeMileage = Number(data.surveyMileage ?? 0);
  const pipelineSla = data.pipelineSla ?? '—';

  const subgrids = data.subgrids || [];
  const hasBoundary = Boolean(data.boundaryGeojson && Array.isArray(data.boundaryGeojson.features) && data.boundaryGeojson.features.length > 0);

  // Breathe the popup in/out: open animates on, close animates out before unmounting
  const [closing, setClosing] = useState(false);
  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose(), 500);
  }, [closing, onClose]);

  const scopeText = districtCount === 0 ? `the project area in ${regionName}` : `${districtLabel} in ${regionName}`;

  // Embedded display-only map dashboard default basemap (dark, matches the app)
  const [basemapStyle, setBasemapStyle] = useState<'light' | 'dark'>('dark');
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  const boundaryFeatures = hasBoundary && Array.isArray(data.boundaryGeojson?.features)
    ? (data.boundaryGeojson.features as any[])
    : [];
  const activeItem = districts[activeIdx];
  const activeFeature = activeItem ? findFeature(data.boundaryGeojson, activeItem.name) : null;
  const trackPoints = data.trackPoints || [];

  // Display-only embedded map (same OpenFreeMap tiles as the boundary dashboard):
  // project boundary outline (NO fill) + survey panotrack points. No interaction.
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let map: maplibregl.Map | null = null;
    try {
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: basemapStyle === 'dark' ? OFM_DARK_STYLE : OFM_LIGHT_STYLE,
        center: [regionCenter.lng, regionCenter.lat],
        zoom: 9,
        pitch: 0,
        bearing: 0,
        attributionControl: false,
        interactive: false,          // Display only
        scrollZoom: false,
        boxZoom: false,
        dragRotate: false,
        keyboard: false,
        touchZoomRotate: false,
        doubleClickZoom: false,
      });
    } catch (err) {
      console.warn('Embedded project map skipped:', err);
      return;
    }
    mapRef.current = map;

    map.on('load', () => {
      setIsMapReady(true);
      map.resize();
      if (regionBbox) {
        map.fitBounds(
          [[regionBbox[0], regionBbox[1]], [regionBbox[2], regionBbox[3]]],
          { padding: 12, duration: 0, maxZoom: 10 }
        );
      }

      // 1. Malaysia district context — faint structure lines, and derive the project
      //    boundary polygon from the same district file when no committed geojson exists
      fetch('/data/malaysia.district.geojson')
        .then((res) => (res.ok ? res.json() : null))
        .then((geo) => {
          if (!map) return;
          const allFeatures = geo?.features;
          if (allFeatures && !map.getSource('ctx-districts')) {
            map.addSource('ctx-districts', { type: 'geojson', data: geo });
            map.addLayer({
              id: 'ctx-districts-line',
              type: 'line',
              source: 'ctx-districts',
              paint: {
                'line-color': basemapStyle === 'dark' ? '#64748b' : '#94a3b8',
                'line-width': 0.8,
                'line-opacity': 0.45,
                'line-dasharray': [2, 2],
              },
            });
          }

          // Merge committed boundary features (with real geometry) + district outlines
          // matched by the committed district names
          const projectFeatures = mergeCommittedBoundaryFeatures(
            boundaryFeatures,
            districts.map((d) => d.name),
            allFeatures
          );
          if (projectFeatures.length === 0) return;

          const boundaryData = { type: 'FeatureCollection', features: projectFeatures } as any;
          if (!map.getSource('project-boundary')) {
            map.addSource('project-boundary', { type: 'geojson', data: boundaryData });
            map.addLayer({
              id: 'project-boundary-fill',
              type: 'fill',
              source: 'project-boundary',
              paint: { 'fill-color': 'transparent', 'fill-opacity': 0 },
            });
            map.addLayer({
              id: 'project-boundary-line',
              type: 'line',
              source: 'project-boundary',
              paint: { 'line-color': '#ef4444', 'line-width': 2.0, 'line-opacity': 0.95 },
            });
          } else {
            (map.getSource('project-boundary') as maplibregl.GeoJSONSource).setData(boundaryData);
          }
        })
        .catch(() => { /* silent */ });

      // 2. Committed boundary — immediate visible red outline (NO fill color)
      if (boundaryFeatures.length > 0 && !map.getSource('project-boundary')) {
        map.addSource('project-boundary', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: boundaryFeatures } as any,
        });
        map.addLayer({
          id: 'project-boundary-fill',
          type: 'fill',
          source: 'project-boundary',
          paint: { 'fill-color': 'transparent', 'fill-opacity': 0 },
        });
        map.addLayer({
          id: 'project-boundary-line',
          type: 'line',
          source: 'project-boundary',
          paint: { 'line-color': '#ef4444', 'line-width': 2.0, 'line-opacity': 0.95 },
        });
      }

      // 3. Active district — amber dashed outline (no fill)
      if (activeFeature && !map.getSource('active-district')) {
        map.addSource('active-district', { type: 'geojson', data: activeFeature });
        map.addLayer({
          id: 'active-district-line',
          type: 'line',
          source: 'active-district',
          paint: {
            'line-color': '#fbbf24',
            'line-width': 2.4,
            'line-opacity': 0.95,
            'line-dasharray': [2.5, 1.5],
          },
        });
      }

      // 4. Survey panotrack points — status-coloured when the project's panotrack
      //    points are provided, otherwise fall back to the plain route dots
      const panotrackPoints = data.panotrackPoints || [];
      const surveyFeatures =
        panotrackPoints.length > 0
          ? panotrackPoints.map((p) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
              properties: { color: p.color || '#f59e0b', status: p.status || 'staging' },
            }))
          : trackPoints.map(([lng, lat]) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [lng, lat] },
              properties: { color: basemapStyle === 'dark' ? '#f87171' : '#dc2626', status: 'route' },
            }));
      if (surveyFeatures.length > 0 && !map.getSource('survey-points')) {
        map.addSource('survey-points', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: surveyFeatures } as any,
        });
        map.addLayer({
          id: 'survey-points-circle',
          type: 'circle',
          source: 'survey-points',
          paint: {
            'circle-radius': 2.5,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.85,
          },
        });
      }
    });

    return () => {
      if (map) map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemapStyle, regionCenter.lng, regionCenter.lat]);

  // Keep the active-district red outline in sync with the selected district chip
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    try {
      if (!map.getSource('active-district')) {
        map.addSource('active-district', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      if (!map.getLayer('active-district-line')) {
        map.addLayer({
          id: 'active-district-line',
          type: 'line',
          source: 'active-district',
          paint: {
            'line-color': '#fbbf24',
            'line-width': 2.4,
            'line-opacity': 0.95,
            'line-dasharray': [2.5, 1.5],
          },
        });
      }
      (map.getSource('active-district') as maplibregl.GeoJSONSource | undefined)?.setData(
        activeFeature || { type: 'FeatureCollection', features: [] }
      );
    } catch { /* silent */ }
  }, [activeFeature, isMapReady]);

  // Keep the committed project-boundary in sync with the strict per-district boundary
  // (real geometries may arrive after the popup mounts, e.g. whole-state commits).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady) return;
    try {
      const strictFeatures = (data.boundaryGeojson?.features || []).filter((f: any) => f?.geometry);
      if (strictFeatures.length === 0) return;
      const source = map.getSource('project-boundary') as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData({ type: 'FeatureCollection', features: strictFeatures } as any);
    } catch { /* silent */ }
  }, [data.boundaryGeojson, isMapReady]);

  return (
    <div
      role="dialog"
      aria-label={`${regionName} Project Area`}
      className={`relative w-[330px] sm:w-[360px] rounded-2xl bg-[#090d14]/95 border border-white/15 backdrop-blur-2xl text-white p-3.5 space-y-2.5 pointer-events-auto select-none overflow-hidden ${
        closing
          ? 'animate-out fade-out-0 zoom-out-95 ease-in duration-500'
          : 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 ease-out duration-500'
      } ${className}`}
      style={{
        boxShadow:
          '0 24px 60px -10px rgba(0, 0, 0, 0.95), 0 0 30px -5px rgba(255, 255, 255, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
      }}
    >
      {/* Top highlight */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/40 to-transparent" />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-2">
        <div className="space-y-0.5 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-white" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-400 font-semibold">
              Project Area
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-white tracking-tight leading-tight truncate">
            {regionName}
          </h3>
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 font-mono">
            <span className="truncate">{data.stateName}</span>
            <span>•</span>
            <span className="text-neutral-300">{districtLabel}</span>
            <span>•</span>
            <span className="text-neutral-300">
              {regionCenter.lat.toFixed(3)}°N, {regionCenter.lng.toFixed(3)}°E
            </span>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="w-7 h-7 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-neutral-400 hover:text-white transition-all flex items-center justify-center cursor-pointer shrink-0 active:scale-90"
          title="Close"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* District chips (all districts of the state are listed & selectable) */}
      {districts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 max-h-28 overflow-y-auto no-scrollbar">
          {districts.map((d, idx) => {
            const meta = DISTRICT_METADATA.find((m) => m.name.toLowerCase() === d.name.toLowerCase());
            const isActive = idx === activeIdx;
            return (
              <button
                key={d.id || d.name}
                onClick={() => handleSelectDistrict(idx)}
                title={meta ? `${d.name}, ${meta.stateName}` : d.state}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-black border-white font-semibold'
                    : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/15 hover:text-white'
                }`}
              >
                {d.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Embedded project map (display-only dashboard: boundary outline + survey points) */}
      <div className="rounded-xl bg-[#0e121a] border border-white/10 overflow-hidden shadow-lg text-left">
        <div className={`relative w-full h-[180px] overflow-hidden ${basemapStyle === 'dark' ? 'bg-[#0b0f16]' : 'bg-[#eceff3]'}`}>
          <div ref={mapContainerRef} className="w-full h-full" />

          {/* Light / Dark toggle */}
          <div className="absolute top-2 right-2 z-10 flex items-center bg-black/75 backdrop-blur-md rounded-md border border-white/15 p-0.5 text-[9px] font-mono">
            <button
              onClick={() => setBasemapStyle('light')}
              className={`px-1.5 py-0.5 rounded ${
                basemapStyle === 'light' ? 'bg-white text-black font-semibold' : 'text-neutral-400 hover:text-white'
              } transition-colors cursor-pointer`}
            >
              Light
            </button>
            <button
              onClick={() => setBasemapStyle('dark')}
              className={`px-1.5 py-0.5 rounded ${
                basemapStyle === 'dark' ? 'bg-white text-black font-semibold' : 'text-neutral-400 hover:text-white'
              } transition-colors cursor-pointer`}
            >
              Dark
            </button>
          </div>

          {/* Panotrack status legend (only when project panotrack points are shown) */}
          {(data.panotrackPoints || []).length > 0 && (
            <div className="absolute bottom-2 left-2 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-black/75 backdrop-blur-md rounded-md border border-white/15 px-2 py-1 text-[8px] font-mono text-neutral-300 pointer-events-none">
              {[
                { label: 'Published', color: '#10b981' },
                { label: 'Staging', color: '#f59e0b' },
                { label: 'Defect', color: '#ef4444' }
              ].map((s) => (
                <span key={s.label} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Metrics */}
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-white tracking-tight leading-snug">
              {regionName} Region · Survey
            </h4>
            <span className="text-[10px] font-mono text-neutral-500">
              {districtCount === 0 ? 'Project area' : `${districtCount} ${districtCount === 1 ? 'district' : 'districts'}`}
            </span>
          </div>

          {/* Overall project details (text summary, no KPI cards) */}
          <p className="text-[11px] leading-relaxed text-neutral-300">
            This project captures{' '}
            <span className="text-white font-semibold">{safeFrames.toLocaleString()} mapping frames</span>{' '}
            and <span className="text-white font-semibold">{safePoi.toLocaleString()} platform POIs</span>{' '}
            across {scopeText}, covering{' '}
            <span className="text-white font-semibold">{safeMileage.toFixed(1)} km</span> of surveyed route
            with a pipeline SLA of <span className="text-white font-semibold">{pipelineSla}%</span>.
          </p>

          {subgrids.length > 0 && (
            <div className="pt-1.5 mt-0.5 border-t border-white/10 flex items-center justify-between text-[10px] font-mono text-neutral-400">
              <span>Survey region</span>
              <span className="text-neutral-200 font-medium truncate pl-2">{regionName}</span>
            </div>
          )}

          <div className="pt-1.5 mt-0.5 border-t border-white/10 flex items-center justify-between text-[10px] font-mono text-neutral-400">
            <span>State · District</span>
            <span className="text-neutral-200 font-medium truncate pl-2">
              {districts[activeIdx]?.state && districts[activeIdx]?.name
                ? `${districts[activeIdx].state} — ${districts[activeIdx].name}`
                : districtLabel === 'Project area'
                  ? `${regionName} — ${districtLabel}`
                  : scopeText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DistrictProjectPopup;