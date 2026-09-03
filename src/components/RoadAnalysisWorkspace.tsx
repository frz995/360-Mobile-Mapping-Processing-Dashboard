import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Route,
  Map,
  Layers,
  Upload,
  RefreshCw,
  FileJson,
  ScanLine
} from 'lucide-react';
import { Masthead, UnderlineTabStrip, Surface, StatusDot, type ChromeTab } from './production/chrome';
import {
  MALAYSIA_DISTRICTS,
  DISTRICT_STATES,
  districtsToGeoJSON,
  pointInDistricts,
  clipLineStringsToDistricts,
  linesLengthKm,
  type MalaysiaDistrict
} from './boundary/malaysiaDistricts';
import { RoadAnalysisMap } from './roadAnalysis/RoadAnalysisMap';
import { getRoadExtractionAdapter, type ExtractedRoadLine } from '../services/roadExtraction';
import { SUBGRID_COORDINATES } from '../services/supabase';

export interface RoadAnalysisWorkspaceProps {
  projectSettings?: any;
  batchLogs?: any[];
  dailyData?: any[];
  onRefreshData?: () => void;
  translate?: (key: string) => string;
  onBackToDashboard?: () => void;
}

type RoadTab = 'region' | 'plan' | 'compare';
type PlanSource = 'system' | 'manual' | 'extracted';

const TABS: ChromeTab<RoadTab>[] = [
  { key: 'region', icon: <Map size={14} /> },
  { key: 'plan', icon: <Route size={14} /> },
  { key: 'compare', icon: <Layers size={14} /> }
];

const TAB_LABEL: Record<RoadTab, string> = {
  region: 'Region',
  plan: 'Plan',
  compare: 'Compare'
};

function haversineKm(p1: [number, number], p2: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(p2[1] - p1[1]);
  const dLng = toRad(p2[0] - p1[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1[1])) * Math.cos(toRad(p2[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pathLengthKm(coords: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineKm(coords[i - 1], coords[i]);
  }
  return total;
}

function extractLineCoords(geojson: any): Array<[number, number]> {
  const geom = geojson?.geometry;
  if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) return [];
  return geom.coordinates
    .filter((c: any) => Array.isArray(c) && c.length >= 2)
    .map((c: any) => [Number(c[0]), Number(c[1])] as [number, number]);
}

/**
 * Map the dashboard's basemap key (projectSettings.defaultBasemap) to a
 * MapLibre style so the Road Analysis map matches the main dashboard.
 * OpenFreeMap (the dashboard default) serves vector tiles via style URLs, so
 * 'ofm-*' keys resolve to OpenFreeMap style URLs (positron/bright/liberty/
 * dark/fiord) — exactly the basemap the dashboard renders. Non-OFM keys fall
 * back to a minimal raster MapLibre style.
 */
function rasterStyle(tiles: string): any {
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [tiles], tileSize: 256 }
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  };
}

function basemapToMapStyle(basemap?: string, customUrl?: string): any {
  switch (basemap) {
    case 'ofm-dark':
      return 'https://tiles.openfreemap.org/styles/dark';
    case 'ofm-fiord':
      return 'https://tiles.openfreemap.org/styles/fiord';
    case 'ofm-liberty':
      return 'https://tiles.openfreemap.org/styles/liberty';
    case 'ofm-bright':
      return 'https://tiles.openfreemap.org/styles/bright';
    case 'ofm-positron':
    default:
      // Positron is the OpenFreeMap default and dashboard default.
      return 'https://tiles.openfreemap.org/styles/positron';
    case 'esri_satellite':
      return rasterStyle('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
    case 'osm_standard':
      return rasterStyle('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    case 'carto_dark':
      return rasterStyle('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png');
    case 'carto_light':
      return rasterStyle('https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png');
    case 'google-streets':
      return rasterStyle('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}');
    case 'google-satellite':
      return rasterStyle('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}');
    case 'google-hybrid':
      return rasterStyle('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}');
    case 'google-terrain':
      return rasterStyle('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}');
    case 'custom_tile':
      return rasterStyle(customUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  }
}

export const RoadAnalysisWorkspace: React.FC<RoadAnalysisWorkspaceProps> = ({
  translate = (k) => k,
  onBackToDashboard: _onBackToDashboard,
  projectSettings,
  onRefreshData
}) => {
  const [activeTab, setActiveTab] = useState<RoadTab>('region');
  const [selectedStateCode, setSelectedStateCode] = useState<string>('');
  const [selectedDistrictIds, setSelectedDistrictIds] = useState<string[]>([]);
  const [planSource, setPlanSource] = useState<PlanSource>('system');
  const [manualGeoJson, setManualGeoJson] = useState<any>(null);
  const [manualError, setManualError] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [extractedLines, setExtractedLines] = useState<ExtractedRoadLine[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string>('');
  const [showRoadLines, setShowRoadLines] = useState(true);
  const [mapBasemap, setMapBasemap] = useState<string | undefined>(
    projectSettings?.defaultBasemap || 'ofm-positron'
  );

  const stateOptions = useMemo(() => DISTRICT_STATES.filter((s) => s.name !== 'Unknown'), []);

  const districtsOfState = useMemo(() => {
    if (!selectedStateCode) return [];
    return MALAYSIA_DISTRICTS.filter((d) => d.state === selectedStateCode);
  }, [selectedStateCode]);

  const selectedDistricts = useMemo(
    () => MALAYSIA_DISTRICTS.filter((d) => selectedDistrictIds.includes(d.id)),
    [selectedDistrictIds]
  );

  const regionGeo = useMemo(() => districtsToGeoJSON(selectedDistricts), [selectedDistricts]);

  // All districts EXCEPT the selected ones, so the map can dim the rest and
  // make the selected region stand out.
  const dimmedRegionsGeojson = useMemo(() => {
    if (selectedDistricts.length === 0) return undefined;
    const features = MALAYSIA_DISTRICTS.filter((d) => !selectedDistrictIds.includes(d.id))
      .flatMap((d) => d.geojson?.features ?? []);
    if (features.length === 0) return undefined;
    return { type: 'FeatureCollection', features };
  }, [selectedDistricts, selectedDistrictIds]);

  const onStateChange = (code: string) => {
    setSelectedStateCode(code);
    setSelectedDistrictIds([]);
  };

  const toggleDistrict = (id: string) => {
    setSelectedDistrictIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const capturedPoints = useMemo(() => {
    if (selectedDistricts.length === 0) return [] as Array<{ subgrid: string; lng: number; lat: number }>;
    const pts: Array<{ subgrid: string; lng: number; lat: number }> = [];
    Object.entries(SUBGRID_COORDINATES).forEach(([key, coord]) => {
      const lng = Number(coord?.[0]);
      const lat = Number(coord?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (pointInDistricts([lng, lat], selectedDistricts)) {
        pts.push({ subgrid: key, lng, lat });
      }
    });
    return pts;
  }, [selectedDistricts, refreshTick]);

  const planCoords: Array<[number, number]> = useMemo(() => {
    if (planSource === 'manual') return extractLineCoords(manualGeoJson);
    const pts = capturedPoints
      .map((p) => [p.lng, p.lat] as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return pts;
  }, [planSource, manualGeoJson, capturedPoints]);

  const capturedDistanceKm = useMemo(() => pathLengthKm(capturedPoints.map((p) => [p.lng, p.lat] as [number, number])), [capturedPoints]);
  const planDistanceKm = useMemo(() => pathLengthKm(planCoords), [planCoords]);
  const ratio = useMemo(() => {
    if (planDistanceKm <= 0) return null;
    return Math.min(100, Math.round((capturedDistanceKm / planDistanceKm) * 100));
  }, [capturedDistanceKm, planDistanceKm]);

  const extractedRuns = useMemo(
    () => clipLineStringsToDistricts(extractedLines, selectedDistricts),
    [extractedLines, selectedDistricts]
  );
  const capturedCoords = useMemo(
    () => capturedPoints.map((p) => [p.lng, p.lat] as [number, number]),
    [capturedPoints]
  );
  const extractedLengthKm = useMemo(() => linesLengthKm(extractedRuns), [extractedRuns]);
  const extractedRatio = useMemo(() => {
    if (extractedLengthKm <= 0) return null;
    return Math.min(100, Math.round((capturedDistanceKm / extractedLengthKm) * 100));
  }, [capturedDistanceKm, extractedLengthKm]);

  const handleExtract = useCallback(async () => {
    setExtractError('');
    if (selectedDistricts.length === 0) {
      setExtractError('Select a state and at least one district to extract roads.');
      return;
    }
    const b = regionGeo?.bbox;
    if (!b) {
      setExtractError('No region geometry available to extract roads.');
      return;
    }
    setExtracting(true);
    try {
      const adapter = getRoadExtractionAdapter();
      const result = await adapter.extract({ minLng: b[0], minLat: b[1], maxLng: b[2], maxLat: b[3] });
      setExtractedLines(result.lines);
      setPlanSource('extracted');
      setShowRoadLines(true);
      if (result.lines.length === 0) {
        setExtractError(
          `No roads found in the selected area (${result.source}). Try a road basemap or a wider region.`
        );
      }
    } catch (err) {
      setExtractedLines([]);
      setExtractError(String(err instanceof Error ? err.message : err));
    } finally {
      setExtracting(false);
    }
  }, [regionGeo, selectedDistricts]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    onRefreshData?.();
    setRefreshTick((t) => t + 1);
    window.setTimeout(() => setIsRefreshing(false), 600);
  }, [onRefreshData]);

  const handleFile = useCallback((file?: File | null) => {
    setManualError('');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const line = extractLineCoords(parsed);
        if (line.length < 2) {
          setManualError('GeoJSON must contain a LineString with at least 2 points.');
          setManualGeoJson(null);
          return;
        }
        setManualGeoJson(parsed);
      } catch {
        setManualError('Invalid GeoJSON file.');
        setManualGeoJson(null);
      }
    };
    reader.readAsText(file);
  }, []);

  const mapStyle = useMemo(
    () => basemapToMapStyle(mapBasemap, projectSettings?.customBasemapUrl),
    [mapBasemap, projectSettings?.customBasemapUrl]
  );

  const selectedDistrictsList = selectedDistricts.length > 0 ? selectedDistricts : [];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-panel-enter">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto md:overflow-hidden p-3">
        <Masthead
          icon={<Route size={18} />}
          context="SURVEY QA / ROAD"
          title={translate('workspaceRoadAnalysis')}
          badge={
            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/30">
              Captured vs Plan
            </span>
          }
          subtitle={translate('workspaceRoadAnalysisDesc')}
          actions={
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-inner border border-subtle text-[11px] font-semibold text-text-base hover:text-sky-400 transition-colors cursor-pointer"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              Refresh from map
            </button>
          }
        />

        <Surface className="flex-1 flex flex-col min-h-0">
          <UnderlineTabStrip tabs={TABS} active={activeTab} onChange={setActiveTab} tabLabel={(k) => TAB_LABEL[k]} />

          <div className="flex flex-1 min-h-0">
            <aside className="w-72 shrink-0 border-r border-divider overflow-y-auto p-3 flex flex-col gap-3 bg-app/40">
              {activeTab === 'region' && (
                <>
                  <div>
                    <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">State</h3>
                    <select
                      value={selectedStateCode}
                      onChange={(e) => onStateChange(e.target.value)}
                      className="w-full bg-inner border border-subtle rounded-lg px-2.5 py-2 text-xs text-text-base outline-none"
                    >
                      <option value="">Select state…</option>
                      {stateOptions.map((s) => (
                        <option key={s.code} value={s.code}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1">
                    <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">
                      Districts (multi-select)
                    </h3>
                    {districtsOfState.length === 0 ? (
                      <p className="text-[11px] text-text-muted leading-relaxed">
                        Choose a state to list its districts.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {districtsOfState.map((d: MalaysiaDistrict) => {
                          const on = selectedDistrictIds.includes(d.id);
                          return (
                            <label
                              key={d.id}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                                on
                                  ? 'border-sky-500/40 bg-sky-500/10 text-text-base'
                                  : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleDistrict(d.id)}
                                className="accent-sky-400"
                              />
                              <span className="truncate">{d.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-divider pt-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-muted">Districts selected</span>
                      <span className="font-semibold text-text-base">{selectedDistricts.length}</span>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'plan' && (
                <>
                  <div>
                    <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">Plan source</h3>
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={() => setPlanSource('system')}
                        className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left text-xs transition-colors ${
                          planSource === 'system'
                            ? 'border-sky-500/40 bg-sky-500/10 text-text-base'
                            : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                        }`}
                      >
                        <StatusDot tone={planSource === 'system' ? 'bg-sky-400' : 'bg-text-muted/60'} />
                        <span className="leading-snug">
                          <span className="block font-semibold">System-derived baseline</span>
                          <span className="block text-[10px] text-text-muted mt-0.5">
                            Built from real captured subgrid points in the selected area.
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => setPlanSource('manual')}
                        className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left text-xs transition-colors ${
                          planSource === 'manual'
                            ? 'border-sky-500/40 bg-sky-500/10 text-text-base'
                            : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                        }`}
                      >
                        <StatusDot tone={planSource === 'manual' ? 'bg-sky-400' : 'bg-text-muted/60'} />
                        <span className="leading-snug">
                          <span className="block font-semibold">Manual override</span>
                          <span className="block text-[10px] text-text-muted mt-0.5">
                            Load a GeoJSON LineString as the road-plan line.
                          </span>
                        </span>
                      </button>
                    </div>
                  </div>

                  {planSource === 'manual' && (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.geojson,application/json"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0])}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-inner border border-subtle text-[11px] font-semibold text-text-base hover:text-sky-400 transition-colors cursor-pointer w-full"
                      >
                        <Upload size={13} /> Upload GeoJSON plan line
                      </button>
                      {manualGeoJson && (
                        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-300">
                          <FileJson size={13} /> LineString loaded
                        </div>
                      )}
                      {manualError && (
                        <div className="mt-2 text-[11px] text-rose-400">{manualError}</div>
                      )}
                    </div>
                  )}

                  <div className="border-t border-divider pt-2 mt-2 flex flex-col gap-1.5">
                    <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-0.5">
                      Road extraction (Option A)
                    </h3>
                    <button
                      onClick={handleExtract}
                      disabled={extracting || selectedDistricts.length === 0}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:border-sky-500/40 cursor-pointer bg-inner/40 border-subtle text-text-base"
                    >
                      <ScanLine size={14} className="text-sky-400" />
                      <span className="leading-snug">
                        <span className="block font-semibold">
                          {extracting ? 'Extracting road network…' : 'Extract road network'}
                        </span>
                        <span className="block text-[10px] text-text-muted mt-0.5">
                          Pull real OSM road lines within the selected district(s).
                        </span>
                      </span>
                    </button>
                    {selectedDistricts.length === 0 && (
                      <p className="text-[10px] text-text-muted">Select state districts first.</p>
                    )}
                    {extractedLines.length > 0 && (
                      <button
                        onClick={() => { setPlanSource('extracted'); setShowRoadLines(true); }}
                        className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left text-xs transition-colors ${
                          planSource === 'extracted'
                            ? 'border-sky-500/40 bg-sky-500/10 text-text-base'
                            : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                        }`}
                      >
                        <StatusDot tone={planSource === 'extracted' ? 'bg-sky-400' : 'bg-text-muted/60'} />
                        <span className="leading-snug">
                          <span className="block font-semibold">Extracted network</span>
                          <span className="block text-[10px] text-text-muted mt-0.5">
                            {extractedRuns.length} road segment(s) · {extractedLengthKm.toFixed(2)} km
                          </span>
                        </span>
                      </button>
                    )}
                    {extractError && (
                      <div className="text-[11px] text-rose-400 leading-snug">{extractError}</div>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'compare' && (
                <>
                  {selectedDistrictsList.length === 0 ? (
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      Select region districts to compute captured vs plan.
                    </p>
                  ) : planSource !== 'extracted' && planCoords.length < 2 ? (
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      Select a plan source to compare captured vs plan.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Captured points</span>
                        <span className="font-semibold text-text-base">{capturedPoints.length}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Captured length</span>
                        <span className="font-semibold text-text-base">{capturedDistanceKm.toFixed(2)} km</span>
                      </div>
                      {planSource === 'extracted' ? (
                        <>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-muted">Extracted (OSM) length</span>
                            <span className="font-semibold text-text-base">{extractedLengthKm.toFixed(2)} km</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-muted">Extracted segments</span>
                            <span className="font-semibold text-text-base">{extractedRuns.length}</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-muted">Captured / extracted</span>
                            <span className="font-semibold text-sky-400">
                              {extractedRatio === null ? '—' : `${extractedRatio}%`}
                            </span>
                          </div>
                          <div className="border-t border-divider pt-2 text-[10px] text-text-muted leading-relaxed">
                            Road network extracted from OSM within the selected district(s).
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-muted">Plan length</span>
                            <span className="font-semibold text-text-base">{planDistanceKm.toFixed(2)} km</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-text-muted">Captured / plan</span>
                            <span className="font-semibold text-sky-400">
                              {ratio === null ? '—' : `${ratio}%`}
                            </span>
                          </div>
                          <div className="border-t border-divider pt-2 text-[10px] text-text-muted leading-relaxed">
                            {planSource === 'system'
                              ? 'Plan is a system-derived baseline from real captured subgrid points.'
                              : 'Plan is a manual GeoJSON override.'}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </aside>

            <div className="flex-1 min-w-0 bg-app overflow-hidden relative">
              <div className="absolute top-3 left-3 z-[1000] flex items-center gap-1 p-1 rounded-lg bg-card/90 border border-subtle backdrop-blur shadow-sm">
                <button
                  onClick={() => setShowRoadLines((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                    showRoadLines ? 'bg-sky-500/15 text-sky-300' : 'text-text-muted hover:text-text-base'
                  }`}
                >
                  <ScanLine size={13} /> {showRoadLines ? 'Hide road lines' : 'Show road lines'}
                </button>
                <label className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-text-muted cursor-pointer">
                  <Layers size={13} />
                  <select
                    value={mapBasemap}
                    onChange={(e) => setMapBasemap(e.target.value)}
                    className="bg-transparent text-[11px] font-semibold text-text-base focus:outline-none cursor-pointer"
                    title="Map basemap"
                  >
                    <option value="ofm-positron">Positron (OpenFreeMap)</option>
                    <option value="ofm-bright">Bright (OpenFreeMap)</option>
                    <option value="ofm-liberty">Liberty (OpenFreeMap)</option>
                    <option value="ofm-dark">Dark (OpenFreeMap)</option>
                    <option value="ofm-fiord">Fiord (OpenFreeMap)</option>
                    <option value="esri_satellite">Esri Satellite</option>
                    <option value="osm_standard">OpenStreetMap</option>
                    <option value="carto_light">Carto Light</option>
                    <option value="carto_dark">Carto Dark</option>
                    <option value="google-satellite">Google Satellite</option>
                    <option value="google-streets">Google Streets</option>
                    <option value="google-hybrid">Google Hybrid</option>
                    <option value="google-terrain">Google Terrain</option>
                    <option value="custom_tile">Custom XYZ</option>
                  </select>
                </label>
              </div>

              <RoadAnalysisMap
                active
                showRoadLines={showRoadLines}
                style={mapStyle}
                bbox={regionGeo?.bbox ?? null}
                districtGeojson={regionGeo?.geojson}
                dimmedRegionsGeojson={dimmedRegionsGeojson}
                capturedPoints={capturedCoords}
                roadRuns={extractedRuns}
              />
              {extracting && (
                <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
                  <p className="px-3 py-2 rounded-lg bg-card/90 border border-subtle text-[11px] text-text-muted backdrop-blur">
                    Extracting road network…
                  </p>
                </div>
              )}
              {selectedDistricts.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="px-3 py-2 rounded-lg bg-card/90 border border-subtle text-[11px] text-text-muted backdrop-blur">
                    Select state districts to focus the map.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Surface>
      </div>
    </div>
  );
};

export default RoadAnalysisWorkspace;
