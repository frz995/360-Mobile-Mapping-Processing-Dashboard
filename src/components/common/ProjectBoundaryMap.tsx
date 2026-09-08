import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, ArrowRight, Compass } from 'lucide-react';
import type { PanotrackPoint } from '../../utils/panotrackExtractor';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Setup MapLibre web worker
const effectiveWorkerUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPLIBRE_WORKER_URL) || workerUrl;
maplibregl.setWorkerUrl(effectiveWorkerUrl);

export interface ProjectBoundaryMapProps {
  projectLocation: {
    latitude: number;
    longitude: number;
    name?: string;
    subtext?: string;
  };
  districtName?: string;
  stateName?: string;
  onReturnToGlobe: () => void;
  onEnterWorkspace?: () => void;
  dailyData?: any[];
  /** Status-coloured panotrack points available on this project (district-scoped). */
  panotrackPoints?: PanotrackPoint[];
  /**
   * The committed project boundary from project settings (one Feature per selected
   * district). When provided, EVERY committed district is drawn as the red boundary —
   * independent of panotrack POI — so the view reflects exactly what the user saved.
   */
  projectBoundary?: {
    geojson?: any;
    bbox?: [number, number, number, number];
  };
}

const OFM_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';

export const ProjectBoundaryMap: React.FC<ProjectBoundaryMapProps> = ({
  projectLocation,
  districtName = 'Segamat',
  stateName = 'Johor',
  onReturnToGlobe,
  onEnterWorkspace,
  dailyData = [],
  panotrackPoints = [],
  projectBoundary,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [allDistrictsGeojson, setAllDistrictsGeojson] = useState<any>(null);
  const [districtFeature, setDistrictFeature] = useState<any>(null);
  const [showBoundary, setShowBoundary] = useState(true);
  const [isReturning, setIsReturning] = useState(false);

  // Compute total surveyed points from dailyData if present
  const totalSurveyFrames = dailyData.reduce(
    (sum, d) => sum + (Number(d.availableImagesCount || d.images || d.imagesProcessed || 0)),
    0
  );

  // Names of the committed districts (from project settings) shown in the header
  const committedDistrictsLabel = useMemo(() => {
    const feats = projectBoundary?.geojson?.features || [];
    const names: string[] = [];
    feats.forEach((f: any) => {
      const n = String(f?.properties?.name || f?.id || '').trim();
      if (n && !names.includes(n)) names.push(n);
    });
    return names.length > 0 ? names.join(', ') : `${districtName} District`;
  }, [projectBoundary, districtName]);

  // Initialize MapLibre GL instance with OpenFreeMap Dark style
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OFM_DARK_STYLE,
      center: [projectLocation.longitude, projectLocation.latitude],
      zoom: 6.8,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    map.on('load', () => {
      setIsMapLoaded(true);
      map.resize();

      // Smooth camera fly-to into balanced district overview (not too deep)
      setTimeout(() => {
        map.flyTo({
          center: [projectLocation.longitude, projectLocation.latitude],
          zoom: 9.0,
          pitch: 18,
          bearing: 0,
          speed: 0.85,
          curve: 1.2,
          essential: true,
        });
      }, 50);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [projectLocation.latitude, projectLocation.longitude]);

  // Load district boundaries from public/data/malaysia.district.geojson
  useEffect(() => {
    let cancelled = false;

    fetch('/data/malaysia.district.geojson')
      .then((res) => res.json())
      .then((geojson) => {
        if (cancelled || !geojson || !geojson.features) return;
        setAllDistrictsGeojson(geojson);
        const target = geojson.features.find((f: any) => {
          const name = f.properties?.name?.toLowerCase() || '';
          const id = String(f.id || '').toLowerCase();
          return name.includes(districtName.toLowerCase()) || id.includes(districtName.toLowerCase());
        });

        if (target) {
          setDistrictFeature(target);
        }
      })
      .catch((err) => {
        console.warn('Failed to load malaysia district geojson:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [districtName]);

  // Render District Boundary Layers and Zoom to Fit
  const applyDistrictLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;

    // 1. Regional / All Surrounding District Boundaries
    if (allDistrictsGeojson) {
      const allSourceId = 'all-districts-source';
      const allLineLayerId = 'all-districts-line';
      const allLabelLayerId = 'all-districts-label';

      if (!map.getSource(allSourceId)) {
        map.addSource(allSourceId, {
          type: 'geojson',
          data: allDistrictsGeojson,
        });
      }

      if (!map.getLayer(allLineLayerId)) {
        map.addLayer({
          id: allLineLayerId,
          type: 'line',
          source: allSourceId,
          paint: {
            'line-color': '#64748b',
            'line-width': 1.2,
            'line-opacity': showBoundary ? 0.6 : 0,
            'line-dasharray': [3, 2],
          },
        });
      } else {
        map.setPaintProperty(allLineLayerId, 'line-opacity', showBoundary ? 0.6 : 0);
      }

      if (!map.getLayer(allLabelLayerId)) {
        map.addLayer({
          id: allLabelLayerId,
          type: 'symbol',
          source: allSourceId,
          minzoom: 8.0,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10.5,
            'text-transform': 'uppercase',
            'text-letter-spacing': 0.08,
            'text-max-width': 8,
          },
          paint: {
            'text-color': '#94a3b8',
            'text-opacity': showBoundary ? 0.7 : 0,
            'text-halo-color': '#000000',
            'text-halo-width': 1.5,
          },
        });
      } else {
        map.setPaintProperty(allLabelLayerId, 'text-opacity', showBoundary ? 0.7 : 0);
      }
    }

    // 2. Committed project boundary — exactly what the user saved in project settings.
    //    Drawn regardless of panotrack POI so every committed district is always visible.
    const committedBoundarySourceId = 'committed-boundary-source';
    const committedBoundaryLineId = 'committed-boundary-line';
    const committedFeatures =
      projectBoundary?.geojson && Array.isArray(projectBoundary.geojson.features) && projectBoundary.geojson.features.length > 0
        ? projectBoundary.geojson.features
        : [];
    if (committedFeatures.length > 0) {
      const committedData = { type: 'FeatureCollection', features: committedFeatures } as any;
      if (!map.getSource(committedBoundarySourceId)) {
        map.addSource(committedBoundarySourceId, { type: 'geojson', data: committedData });
        map.addLayer({
          id: committedBoundaryLineId,
          type: 'line',
          source: committedBoundarySourceId,
          paint: {
            'line-color': '#ef4444',
            'line-width': showBoundary ? 2.5 : 0,
            'line-opacity': 0.95,
          },
        });
      } else {
        (map.getSource(committedBoundarySourceId) as maplibregl.GeoJSONSource).setData(committedData);
        map.setPaintProperty(committedBoundaryLineId, 'line-width', showBoundary ? 2.5 : 0);
      }
    } else if (map.getSource(committedBoundarySourceId)) {
      map.removeLayer(committedBoundaryLineId);
      map.removeSource(committedBoundarySourceId);
    }

    // 3. Active Target District (amber dashed outline — marks the selected chip).
    //    Add-once + setData (no source/layer teardown) so identity churn or re-renders
    //    never flash the boundary.
    if (districtFeature) {
      const sourceId = 'district-boundary-source';
      const fillLayerId = 'district-boundary-fill';
      const lineLayerId = 'district-boundary-line';

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: districtFeature as any });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(districtFeature as any);
      }

      if (!map.getLayer(fillLayerId)) {
        // District polygon (stroke/outline only, no fill color)
        map.addLayer({
          id: fillLayerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': 'transparent',
            'fill-opacity': 0,
          },
        });
      }

      if (!map.getLayer(lineLayerId)) {
        // Crisp amber dashed active-district outline (distinct from the red committed boundary)
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': '#fbbf24',
            'line-width': 2.4,
            'line-opacity': 0.95,
            'line-dasharray': [2.5, 1.5],
          },
        });
      }
      map.setPaintProperty(lineLayerId, 'line-width', showBoundary ? 2.4 : 0);
    }

    // Fit bounds to the committed boundary when present (shows every committed district,
    // e.g. Segamat + Tangkak together), otherwise the single active district.
    const committedBbox = committedFeatures.length > 0 ? projectBoundary?.bbox : null;
    if (committedBbox && committedBbox.length === 4) {
      map.fitBounds(
        [[committedBbox[0], committedBbox[1]], [committedBbox[2], committedBbox[3]]],
        {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
          maxZoom: 9.2,
          pitch: 18,
          duration: 1100,
        }
      );
    } else if (districtFeature?.geometry?.coordinates) {
      try {
        const getCoordinates = (coords: any[]): [number, number][] => {
          if (typeof coords[0] === 'number') return [coords as [number, number]];
          return coords.flatMap(getCoordinates);
        };
        const allPts = getCoordinates(districtFeature.geometry.coordinates);
        if (allPts.length > 0) {
          let minLng = allPts[0][0], maxLng = allPts[0][0];
          let minLat = allPts[0][1], maxLat = allPts[0][1];
          for (const [lng, lat] of allPts) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
            padding: { top: 80, bottom: 80, left: 80, right: 80 },
            maxZoom: 9.2,
            pitch: 18,
            duration: 1100,
          });
        }
      } catch (e) {
        console.warn('Could not fit bounds for district:', e);
      }
    }
}, [allDistrictsGeojson, districtFeature, isMapLoaded, showBoundary, projectBoundary]);

  useEffect(() => {
    applyDistrictLayers();
  }, [applyDistrictLayers]);

  // Add Project Core Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;

    // Custom DOM marker element with Google Font location_on marker icon
    const el = document.createElement('div');
    el.className = 'custom-project-marker';
    el.style.cursor = 'pointer';
    el.innerHTML = `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; transform: translateY(-2px);">
        <span class="material-symbols-outlined" style="font-size: 34px; color: #ef4444; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.9)) drop-shadow(0 0 12px rgba(239,68,68,0.7)); line-height: 1; user-select: none; display: block;">
          location_on
        </span>
        <div style="width: 10px; height: 3px; background: rgba(0,0,0,0.65); border-radius: 50%; margin-top: -3px; filter: blur(1px);"></div>
      </div>
    `;

    const popup = new maplibregl.Popup({ offset: [0, -34], closeButton: false }).setHTML(`
      <div style="background: #0f1217; color: #fff; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); font-family: sans-serif;">
        <div style="font-size: 11px; font-weight: bold; color: #f8fafc;">${projectLocation.name || 'TNB Project Core'}</div>
        <div style="font-size: 10px; color: #94a3b8; font-family: monospace;">${projectLocation.latitude.toFixed(4)}° N, ${projectLocation.longitude.toFixed(4)}° E</div>
        <div style="font-size: 9px; color: #ef4444; margin-top: 3px; font-weight: 600;">Active Field Operations Base</div>
      </div>
    `);

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([projectLocation.longitude, projectLocation.latitude])
      .setPopup(popup)
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [isMapLoaded, projectLocation]);

  // Add Panotrack Points Layer (status-coloured circles for the project's available frames)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapLoaded) return;
    if (panotrackPoints.length === 0) return;

    if (!map.getSource('pano-points')) {
      map.addSource('pano-points', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: panotrackPoints.map((p) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: { color: p.color || '#f59e0b', status: p.status || 'staging' },
          })),
        } as any,
      });
    } else {
      (map.getSource('pano-points') as maplibregl.GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: panotrackPoints.map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { color: p.color || '#f59e0b', status: p.status || 'staging' },
        })),
      } as any);
    }

    if (!map.getLayer('pano-points-circle')) {
      map.addLayer({
        id: 'pano-points-circle',
        type: 'circle',
        source: 'pano-points',
        paint: {
          'circle-radius': 3,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 0.6,
          'circle-stroke-color': '#0b0f16',
          'circle-stroke-opacity': 0.9,
        },
      });
    }
  }, [isMapLoaded, panotrackPoints]);

  const handleReturn = () => {
    if (isReturning) return;
    setIsReturning(true);
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        zoom: 4.8,
        pitch: 0,
        bearing: 0,
        speed: 1.3,
        curve: 1.2,
        essential: true,
      });
      setTimeout(() => {
        onReturnToGlobe();
      }, 550);
    } else {
      onReturnToGlobe();
    }
  };

  return (
    <div className="relative w-full h-full bg-[#05070a] select-none overflow-hidden animate-in fade-in zoom-in-95 duration-500">
      <style>{`
        @keyframes ping {
          75%, 100% {
            transform: scale(2.2);
            opacity: 0;
          }
        }
        .maplibregl-ctrl-group {
          background: rgba(15, 18, 23, 0.85) !important;
          border: 1px solid rgba(255, 255, 255, 0.12) !important;
          border-radius: 12px !important;
          backdrop-filter: blur(8px) !important;
        }
        .maplibregl-ctrl-group button {
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        }
        .maplibregl-ctrl-group button:last-child {
          border-bottom: none !important;
        }
        .maplibregl-ctrl-group button svg path {
          fill: #e2e8f0 !important;
        }
      `}</style>

      {/* MapLibre Canvas Viewport */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* Top Left Floating Header: Back to 3D Globe + District Meta */}
      <div className="absolute top-4 left-4 sm:left-8 z-30 flex flex-col gap-2 pointer-events-auto max-w-[calc(100vw-32px)] sm:max-w-md">
        <button
          onClick={handleReturn}
          className="self-start px-3.5 py-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-xs font-semibold text-white border border-white/15 transition-all shadow-2xl flex items-center gap-2 cursor-pointer active:scale-95 group backdrop-blur-md"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white transition-colors" />
          <span>Return to 3D Earth Globe</span>
        </button>

        <div className="p-3.5 sm:p-4 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 shadow-2xl text-left space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-bold text-white tracking-wide truncate">
              {committedDistrictsLabel} &bull; {stateName}
            </span>
          </div>
          <p className="text-[11px] text-neutral-400 font-mono">
            {projectLocation.subtext || `${projectLocation.latitude.toFixed(4)}° N, ${projectLocation.longitude.toFixed(4)}° E`}
          </p>
          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-neutral-400">
            <span>Committed Districts:</span>
            <span className="text-white font-semibold font-mono flex items-center gap-1.5 truncate">
              <span className="material-symbols-outlined text-[14px] text-neutral-300 leading-none">location_on</span>
              <span className="truncate">{committedDistrictsLabel}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Top Right Map Controls Overlay: Interactive Toggle Switch Button */}
      <div className="absolute top-4 right-14 sm:right-16 z-30 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={() => setShowBoundary(!showBoundary)}
          role="switch"
          aria-checked={showBoundary}
          title={showBoundary ? 'Toggle district boundaries off' : 'Toggle district boundaries on'}
          className="px-3 py-1.5 rounded-xl bg-black/85 backdrop-blur-md border border-white/15 shadow-xl hover:border-white/30 transition-all cursor-pointer flex items-center gap-2.5 text-xs text-white group select-none active:scale-95"
        >
          <span className="material-symbols-outlined text-[15px] leading-none text-neutral-300 group-hover:text-white transition-colors">
            layers
          </span>
          <span className="text-neutral-200 text-[11px] font-medium tracking-wide">
            {showBoundary ? 'District: Visible' : 'District: Hidden'}
          </span>
          {/* Toggle Switch Track & Knob */}
          <div
            className={`w-8 h-4 rounded-full p-0.5 transition-colors duration-200 ease-in-out flex items-center ${
              showBoundary ? 'bg-red-500 justify-end' : 'bg-neutral-700 justify-start'
            }`}
          >
            <div className="w-3 h-3 rounded-full bg-white shadow-md transition-all duration-200" />
          </div>
        </button>
      </div>

      {/* Bottom Floating Telemetry & Launch Bar */}
      <div className="absolute bottom-4 left-4 right-4 sm:left-8 sm:right-8 z-30 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-3 pointer-events-none">
        <div className="p-3 rounded-xl bg-black/75 backdrop-blur-xl border border-white/10 text-left pointer-events-auto shadow-xl flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-neutral-400" />
            <span className="text-xs text-neutral-300 font-medium">EPSG:4326 WGS84</span>
          </div>
          <span className="text-neutral-600">|</span>
          <div className="text-xs text-neutral-400">
            <span>Survey Records: </span>
            <span className="text-white font-semibold font-mono">
              {totalSurveyFrames > 0 ? totalSurveyFrames.toLocaleString() : 'Active Fleet'}
            </span>
          </div>
        </div>

        {onEnterWorkspace && (
          <button
            onClick={onEnterWorkspace}
            className="px-5 py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-xs sm:text-sm font-semibold transition-all shadow-2xl flex items-center gap-2 pointer-events-auto cursor-pointer active:scale-95"
          >
            <span>Launch Workspace</span>
            <ArrowRight className="w-4 h-4 text-black" />
          </button>
        )}
      </div>
    </div>
  );
};

export default ProjectBoundaryMap;
