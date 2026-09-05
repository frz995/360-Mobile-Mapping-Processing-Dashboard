import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Route,
  Map,
  Layers,
  RefreshCw,
  FileJson,
  ScanLine,
  Save,
  Check,
  Loader2,
  Upload,
  GitCompare,
  ArrowRightLeft,
  Printer,
  Search
} from 'lucide-react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { UnderlineTabStrip, StatusDot, type ChromeTab } from './production/chrome';
import {
  MALAYSIA_DISTRICTS,
  DISTRICT_STATES,
  districtsToGeoJSON,
  clipLineStringsToDistricts,
  linesLengthKm,
  ensureDistrictGeometriesLoaded,
  isDistrictGeometriesLoaded,
  type MalaysiaDistrict
} from './boundary/malaysiaDistricts';
import { RoadAnalysisMap } from './roadAnalysis/RoadAnalysisMap';
import { RoadImportPanel } from './roadAnalysis/RoadImportPanel';
import { RoadAnalysisPrintPanel } from './roadAnalysis/RoadAnalysisPrintPanel';
import { RoadCatalogPanel, RoadAttributeTableDrawer, type SystemLayerStyles } from './roadAnalysis/RoadCatalogPanel';
import type { CatalogVectorLayer } from '../utils/gisImportParser';
import { getRoadExtractionAdapter, type ExtractedRoadLine } from '../services/roadExtraction';
import { parseRoadPlanFile, extractLineRuns } from '../utils/roadPlanParser';
import { extractPanotrackPoints, filterPanotrackByDistricts } from '../utils/panotrackExtractor';
import { pathLengthLngLatKm } from '../utils/geo';
import { computeSubgridMetrics, type SubgridMetric, type SubgridRelationNotice } from '../utils/subgridComparison';
import { extractSubgridName } from '../utils/subgrid';
import {
  saveRoadAnalysisStateToSupabase,
  fetchRoadAnalysisStateFromSupabase,
  fetchSupabaseData,
  type RoadAnalysisProductionState
} from '../services/supabase';
import type { AuditLogItem } from '../types/dashboard';

export interface RoadAnalysisWorkspaceProps {
  projectSettings?: any;
  batchLogs?: any[];
  dailyData?: any[];
  defectsList?: any[];
  onRefreshData?: () => void;
  translate?: (key: string) => string;
  onBackToDashboard?: () => void;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: AuditLogItem['type'], title: string, details: string, status?: AuditLogItem['status']) => void;
}

type RoadTab = 'region' | 'plan' | 'import' | 'catalog' | 'compare' | 'allocation' | 'print';
type PlanSource = 'system' | 'manual' | 'extracted';

export function getAuthStorageUserKey(authSession?: any, isGuestUser?: boolean): string {
  if (isGuestUser) return 'guest';
  const sessionUser = authSession?.user;
  if (sessionUser?.id) return String(sessionUser.id);
  if (sessionUser?.email) return String(sessionUser.email).toLowerCase().trim();

  try {
    const sbKey = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    if (sbKey) {
      const raw = localStorage.getItem(sbKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const user = parsed?.user;
        if (user?.id) return String(user.id);
        if (user?.email) return String(user.email).toLowerCase().trim();
      }
    }
  } catch {
    // ignore
  }

  return 'anonymous';
}

export interface RoadAnalysisSavedState {
  activeTab?: RoadTab;
  selectedStateCode?: string;
  selectedDistrictIds?: string[];
  planSource?: PlanSource;
  mapBasemap?: string;
  showRoadLines?: boolean;
  manualGeoJson?: any;
  extractedLines?: ExtractedRoadLine[];
  catalogLayers?: CatalogVectorLayer[];
  systemStyles?: SystemLayerStyles;
  planDistanceKm?: number;
  totalSubgrids?: number;
  /** Cache schema version, bumped whenever the stored shape changes. */
  schemaVersion?: number;
  /** True once this snapshot has been pushed to Supabase. */
  savedToCloud?: boolean;
  /** ISO timestamp of the last local edit made in this browser (monotonic). */
  lastLocalEditAt?: string;
  /** ISO updatedAt of the cloud snapshot this cache currently mirrors. */
  cloudUpdatedAt?: string;
  /** ISO timestamp of the saved snapshot (cloud authoritative time). */
  updatedAt?: string;
}

export const ROAD_ANALYSIS_CACHE_VERSION = 3;

export function getRoadAnalysisStorageKey(userKey: string): string {
  return `geosphere_road_analysis_state_${userKey}`;
}

export function computeRoadAnalysisFingerprint(
  stateCode: string,
  districtIds: string[],
  plan: PlanSource,
  basemap: string,
  roadLines: boolean,
  manual: any,
  extracted: ExtractedRoadLine[],
  catalogLayers?: CatalogVectorLayer[],
  systemStyles?: SystemLayerStyles
): string {
  return JSON.stringify({
    stateCode: stateCode || '',
    districts: [...(districtIds || [])].sort(),
    plan: plan || 'system',
    basemap: basemap || '',
    roadLines: !!roadLines,
    hasManual: !!manual,
    manualGeoJson: manual ? JSON.stringify(manual) : null,
    extractedCount: extracted?.length || 0,
    extractedSample: (extracted || []).slice(0, 3).map((l) => l.coordinates.length),
    catalogCount: catalogLayers?.length || 0,
    catalogIds: (catalogLayers || []).map(
      (l) =>
        `${l.id}:${l.visible}:${l.color}:${l.opacity}:${l.strokeWidth}:${l.fillColor || ''}:${l.fillOpacity ?? ''}:${l.strokeStyle || ''}:${l.pointRadius ?? ''}:${l.pointStrokeColor || ''}:${l.pointStrokeWidth ?? ''}`
    ),
    systemStyles: systemStyles ? JSON.stringify(systemStyles) : null
  });
}

export function loadRoadAnalysisState(userKey: string): RoadAnalysisSavedState | null {
  try {
    const raw = localStorage.getItem(getRoadAnalysisStorageKey(userKey));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Persist a Road Analysis snapshot to the local (offline) cache. Used to make
 * freshly-extracted road networks and live edits survive a remount or a hard
 * reload without requiring an explicit Save State click first.
 *
 * Local edits are marked `savedToCloud: false` and flagged with a monotonic
 * `lastLocalEditAt` so, on reload, the cloud snapshot is treated as
 * authoritative EXCEPT when the cache holds newer unsaved local edits (which
 * must not be silently overwritten).
 */
export function persistRoadAnalysisCache(userKey: string, state: RoadAnalysisSavedState): boolean {
  try {
    if (!state) return false;
    const existing = loadRoadAnalysisState(userKey) || {};
    // Edits bump the local-edit clock and clear the cloud-synced marker.
    const lastLocalEditAt = new Date().toISOString();
    localStorage.setItem(
      getRoadAnalysisStorageKey(userKey),
      JSON.stringify({
        ...existing,
        ...state,
        schemaVersion: ROAD_ANALYSIS_CACHE_VERSION,
        lastLocalEditAt,
        savedToCloud: false
      })
    );
    return true;
  } catch (err) {
    // Quota / serialization errors: the cache write failed. Surface it so the
    // UI can keep the "unsaved edits" banner visible instead of lying.
    console.warn('[RoadAnalysis] persistRoadAnalysisCache failed (likely quota):', err);
    return false;
  }
}

/**
 * Mirror a successfully cloud-saved snapshot back into the local cache so the
 * cache becomes an exact, synced mirror of the DB (marked `savedToCloud: true`)
 * rather than a competing source of truth.
 */
export function mirrorRoadAnalysisToCache(userKey: string, state: RoadAnalysisSavedState): void {
  try {
    const cloudUpdatedAt = state.updatedAt;
    localStorage.setItem(
      getRoadAnalysisStorageKey(userKey),
      JSON.stringify({
        ...state,
        schemaVersion: ROAD_ANALYSIS_CACHE_VERSION,
        savedToCloud: true,
        cloudUpdatedAt: cloudUpdatedAt || null,
        updatedAt: cloudUpdatedAt
      })
    );
  } catch {
    // ignore quota / serialization errors
  }
}

const TABS: ChromeTab<RoadTab>[] = [
  { key: 'region', icon: <Map size={14} /> },
  { key: 'plan', icon: <Route size={14} /> },
  { key: 'import', icon: <Upload size={14} /> },
  { key: 'catalog', icon: <Layers size={14} /> },
  { key: 'compare', icon: <GitCompare size={14} /> },
  { key: 'allocation', icon: <ArrowRightLeft size={14} /> },
  { key: 'print', icon: <Printer size={14} /> }
];

const TAB_LABEL: Record<RoadTab, string> = {
  region: 'Region',
  plan: 'Plan',
  import: 'Import Data',
  catalog: 'Data Catalog',
  compare: 'Compare',
  allocation: 'Allocation',
  print: 'Print'
};

function rasterStyle(tilesUrl: string) {
  return {
    version: 8 as const,
    sources: {
      'raster-source': {
        type: 'raster' as const,
        tiles: [tilesUrl],
        tileSize: 256
      }
    },
    layers: [
      {
        id: 'raster-layer',
        type: 'raster' as const,
        source: 'raster-source',
        minzoom: 0,
        maxzoom: 19
      }
    ]
  };
}

function basemapToMapStyle(key?: string, customUrl?: string) {
  switch (key) {
    case 'ofm-dark':
      return 'https://tiles.openfreemap.org/styles/dark';
    case 'ofm-positron':
      return 'https://tiles.openfreemap.org/styles/positron';
    case 'ofm-bright':
      return 'https://tiles.openfreemap.org/styles/bright';
    case 'ofm-liberty':
      return 'https://tiles.openfreemap.org/styles/liberty';
    case 'ofm-fiord':
      return 'https://tiles.openfreemap.org/styles/fiord';
    case 'esri_satellite':
      return rasterStyle('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');
    case 'osm_standard':
      return rasterStyle('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    case 'carto_dark':
      return rasterStyle('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png');
    case 'carto_light':
      return rasterStyle('https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png');
    case 'google-satellite':
      return rasterStyle('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}');
    case 'google-streets':
      return rasterStyle('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}');
    case 'google-hybrid':
      return rasterStyle('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}');
    case 'google-terrain':
      return rasterStyle('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}');
    case 'custom_tile':
    default:
      return rasterStyle(customUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  }
}

export const RoadAnalysisWorkspace: React.FC<RoadAnalysisWorkspaceProps> = ({
  translate = (k) => k,
  onBackToDashboard: _onBackToDashboard,
  projectSettings,
  batchLogs = [],
  dailyData = [],
  defectsList = [],
  onRefreshData,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog
}) => {
  const userKey = useMemo(() => getAuthStorageUserKey(authSession, isGuestUser), [authSession, isGuestUser]);

  const defaultBasemapKey = useMemo(() => {
    if (projectSettings?.defaultBasemap) return projectSettings.defaultBasemap;
    if (projectSettings?.defaultBasemapStyle === 'dark') return 'ofm-dark';
    return 'ofm-positron';
  }, [projectSettings?.defaultBasemap, projectSettings?.defaultBasemapStyle]);

  const [activeTab, setActiveTab] = useState<RoadTab>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return saved?.activeTab || 'region';
  });

  const [selectedStateCode, setSelectedStateCode] = useState<string>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return saved?.selectedStateCode || '';
  });

  const [selectedDistrictIds, setSelectedDistrictIds] = useState<string[]>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return Array.isArray(saved?.selectedDistrictIds) ? saved.selectedDistrictIds : [];
  });

  const [planSource, setPlanSource] = useState<PlanSource>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return saved?.planSource || 'system';
  });

  const [manualGeoJson, setManualGeoJson] = useState<any>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return saved?.manualGeoJson || null;
  });

  const [manualError, setManualError] = useState<string>('');
  const [catalogLayers, setCatalogLayers] = useState<CatalogVectorLayer[]>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return Array.isArray(saved?.catalogLayers) ? saved.catalogLayers : [];
  });
  const [systemStyles, setSystemStyles] = useState<SystemLayerStyles>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return (
      saved?.systemStyles || {
        districtBoundary: { visible: true, color: '#000000', opacity: 1, strokeWidth: 2.5 },
        capturedPoints: { visible: true, opacity: 0.95, pointRadius: 5 },
        roadPlan: { visible: true, color: '#10b981', opacity: 0.85, strokeWidth: 3.5 }
      }
    );
  });
  const [focusBbox, setFocusBbox] = useState<[number, number, number, number] | null>(null);
  const [activePlanName, setActivePlanName] = useState<string>('');
  const [activeTableLayer, setActiveTableLayer] = useState<CatalogVectorLayer | null>(null);
  const [selectedTableFeature, setSelectedTableFeature] = useState<any | null>(null);
  const [, setGeometriesLoaded] = useState(() => isDistrictGeometriesLoaded());
  const [selectedSubgridId, setSelectedSubgridId] = useState<string | null>(null);
  const [subgridSearch, setSubgridSearch] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (activeTableLayer && !catalogLayers.some((l) => l.id === activeTableLayer.id)) {
      setActiveTableLayer(null);
      setSelectedTableFeature(null);
    }
  }, [catalogLayers, activeTableLayer]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeDetailNotice, setActiveDetailNotice] = useState<SubgridRelationNotice | null>(null);
  const [allocationSearch, setAllocationSearch] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState<boolean>(false);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [rulesModalTab, setRulesModalTab] = useState<'rules' | 'scenarios'>('rules');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Live main-map instance (for the Print panel's "Current map extent" mode).
  const liveMapRef = useRef<MaplibreMap | null>(null);
  // Print-preview map instance (owned by RoadAnalysisPrintPanel).
  const printMapRef = useRef<MaplibreMap | null>(null);

  // The print-preview map is lazily mounted on the first visit to the Print tab and
  // then KEPT alive. The live map stays permanently mounted. Switching Allocation <-> Print
  // toggles visibility (never unmount/remount), which eliminates the map flash / tile
  // reload / camera reset the old ternary remount caused.
  const [printPanelMounted, setPrintPanelMounted] = useState(false);

  useEffect(() => {
    if (activeTab === 'print') {
      setPrintPanelMounted(true);
      const id = requestAnimationFrame(() => {
        printMapRef.current?.resize();
      });
      return () => cancelAnimationFrame(id);
    }
    if (printPanelMounted) {
      const id = requestAnimationFrame(() => {
        liveMapRef.current?.resize();
      });
      return () => cancelAnimationFrame(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, printPanelMounted]);

  useEffect(() => {
    ensureDistrictGeometriesLoaded()
      .then(() => setGeometriesLoaded(true))
      .catch((err) => console.warn('[RoadAnalysis] Failed to load district geometries:', err));
  }, []);

  // Maintain operational panotrack datasets from dashboard / Supabase
  const [internalDailyData, setInternalDailyData] = useState<any[]>(() => dailyData || []);
  const [internalBatchLogs, setInternalBatchLogs] = useState<any[]>(() => batchLogs || []);
  const [internalDefectsList, setInternalDefectsList] = useState<any[]>(() => defectsList || []);
  const [isLoadingPanotrack, setIsLoadingPanotrack] = useState<boolean>(false);

  useEffect(() => {
    if (Array.isArray(dailyData) && dailyData.length > 0) {
      setInternalDailyData(dailyData);
    }
  }, [dailyData]);

  useEffect(() => {
    if (Array.isArray(batchLogs) && batchLogs.length > 0) {
      setInternalBatchLogs(batchLogs);
    }
  }, [batchLogs]);

  useEffect(() => {
    if (Array.isArray(defectsList) && defectsList.length > 0) {
      setInternalDefectsList(defectsList);
    }
  }, [defectsList]);

  // Automatically hydrate from Supabase if dailyData is initially empty or on refresh
  useEffect(() => {
    let cancelled = false;
    if (internalDailyData.length === 0 || refreshTick > 0) {
      setIsLoadingPanotrack(true);
      fetchSupabaseData(projectSettings)
        .then(({ dailyData: sDaily, batchLogs: sBatches, defectsList: sDefects }) => {
          if (cancelled) return;
          if (Array.isArray(sDaily) && sDaily.length > 0) {
            setInternalDailyData(sDaily);
          }
          if (Array.isArray(sBatches) && sBatches.length > 0) {
            setInternalBatchLogs(sBatches);
          }
          if (Array.isArray(sDefects) && sDefects.length > 0) {
            setInternalDefectsList(sDefects);
          }
        })
        .catch((err) => {
          console.warn('[RoadAnalysis] fetchSupabaseData error:', err);
        })
        .finally(() => {
          if (!cancelled) setIsLoadingPanotrack(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [refreshTick, projectSettings]);

  const [extractedLines, setExtractedLines] = useState<ExtractedRoadLine[]>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return Array.isArray(saved?.extractedLines) ? saved.extractedLines : [];
  });

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string>('');

  const [showRoadLines, setShowRoadLines] = useState<boolean>(() => {
    const saved = loadRoadAnalysisState(userKey);
    return typeof saved?.showRoadLines === 'boolean' ? saved.showRoadLines : true;
  });

  const [mapBasemap, setMapBasemap] = useState<string>(() => {
    const saved = loadRoadAnalysisState(userKey);
    if (saved?.mapBasemap) return saved.mapBasemap;
    return defaultBasemapKey;
  });

  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState<boolean>(false);

  // Reflect unsaved-edit state from the local cache whenever it changes.
  useEffect(() => {
    const cache = loadRoadAnalysisState(userKey);
    if (!cache) {
      setHasUnsavedEdits(false);
      return;
    }
    const localEditAt = cache.lastLocalEditAt ? Date.parse(cache.lastLocalEditAt) : 0;
    const cloudEditAt = cache.cloudUpdatedAt ? Date.parse(cache.cloudUpdatedAt) : 0;
    const dirty = cache.savedToCloud === false ||
      (Number.isFinite(localEditAt) && Number.isFinite(cloudEditAt) && localEditAt > cloudEditAt);
    setHasUnsavedEdits(!!dirty);
    // Region, districts, basemap, road-line visibility and active tab all touch
    // the saved fingerprint, so the banner must re-evaluate when they change.
  }, [userKey, refreshTick, extractedLines, planSource, manualGeoJson, catalogLayers, systemStyles,
    selectedStateCode, selectedDistrictIds, mapBasemap, showRoadLines, activeTab]);

  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(() => {
    const saved = loadRoadAnalysisState(userKey);
    if (saved) {
      return computeRoadAnalysisFingerprint(
        saved.selectedStateCode || '',
        saved.selectedDistrictIds || [],
        saved.planSource || 'system',
        saved.mapBasemap || defaultBasemapKey,
        typeof saved.showRoadLines === 'boolean' ? saved.showRoadLines : true,
        saved.manualGeoJson || null,
        saved.extractedLines || [],
        saved.catalogLayers || [],
        saved.systemStyles
      );
    }
    return null;
  });

  // Calculate current fingerprint across all configuration dimensions:
  // state, districts, plan source, basemap, road lines visibility, manual GeoJSON, road extraction, catalog layers & styles
  const currentFingerprint = useMemo(() => {
    return computeRoadAnalysisFingerprint(
      selectedStateCode,
      selectedDistrictIds,
      planSource,
      mapBasemap,
      showRoadLines,
      manualGeoJson,
      extractedLines,
      catalogLayers,
      systemStyles
    );
  }, [
    selectedStateCode,
    selectedDistrictIds,
    planSource,
    mapBasemap,
    showRoadLines,
    manualGeoJson,
    extractedLines,
    catalogLayers,
    systemStyles
  ]);

  // True only when current state strictly matches the last saved/remote state
  const isSaved = lastSavedFingerprint !== null && lastSavedFingerprint === currentFingerprint;

  // Track the updatedAt of the saved state most recently applied from storage.
  // Used to avoid clobbering a user's newer, in-progress (unsaved) edits —
  // e.g. a freshly-extracted road network — with an older saved state that
  // arrives async from Supabase moments later.
  const lastAppliedRemoteAtRef = useRef<string | null>(null);

  // Fetch and restore saved configuration from Supabase Cloud on mount.
  // Gates each restore by `updatedAt` so a stale saved snapshot (older than or
  // equal to the baseline already applied) never reverts the live workspace.
  useEffect(() => {
    let cancelled = false;

    async function restoreFromSupabase() {
      // Prefer fresh data straight from Supabase so a stale App-level
      // projectSettings snapshot (loaded before a recent save, e.g. when
      // navigating back in the same session) never overrides newer DB state.
      let remoteState = await fetchRoadAnalysisStateFromSupabase();
      if (!remoteState) remoteState = projectSettings?.roadAnalysisState;
      if (cancelled || !remoteState) return;

      // Only apply when the incoming remote state is strictly newer than the
      // baseline already applied. This prevents the async arrival of the last
      // saved (pre-extraction) snapshot from resetting the basemap and wiping
      // the freshly extracted road lines the user is currently viewing.
      const incomingAt = remoteState.updatedAt ? Date.parse(remoteState.updatedAt) : 0;
      const appliedAt = lastAppliedRemoteAtRef.current ? Date.parse(lastAppliedRemoteAtRef.current) : 0;
      if (Number.isFinite(incomingAt) && appliedAt >= incomingAt) return;

      lastAppliedRemoteAtRef.current = remoteState.updatedAt || null;

      // General merge rule: the cloud snapshot is authoritative UNLESS the
      // local cache holds newer state. Two cases are handled:
      //   a) The local cache has unsaved edits newer than the cloud snapshot
      //      (`lastLocalEditAt`). A stale/empty cloud snapshot must not delete
      //      work the user is still viewing.
      //   b) This device last synced to the cloud at a timestamp NEWER than
      //      the incoming snapshot's `updatedAt`. This happens when the
      //      App-level projectSettings snapshot is STALE (loaded before the
      //      user saved extraction, e.g. navigating back in the same session);
      //      trusting it would wipe a just-saved road extraction off the map.
      const localCache = loadRoadAnalysisState(userKey);
      const localEditAt = localCache?.lastLocalEditAt ? Date.parse(localCache.lastLocalEditAt) : 0;
      const localCloudAt = localCache?.cloudUpdatedAt ? Date.parse(localCache.cloudUpdatedAt) : 0;
      const localNewer =
        Number.isFinite(localEditAt) &&
        Number.isFinite(incomingAt) &&
        incomingAt > 0 &&
        localEditAt > incomingAt;
      const localSyncedNewer =
        Number.isFinite(localCloudAt) &&
        Number.isFinite(incomingAt) &&
        incomingAt > 0 &&
        localCloudAt > incomingAt;

      const preferLocal = localNewer || localSyncedNewer;

      const effectiveExtractedLines =
        preferLocal && Array.isArray(localCache?.extractedLines)
          ? localCache.extractedLines
          : Array.isArray(remoteState.extractedLines)
            ? remoteState.extractedLines
            : [];

      if (remoteState.activeTab) setActiveTab(remoteState.activeTab);
      if (remoteState.selectedStateCode !== undefined) setSelectedStateCode(remoteState.selectedStateCode);
      if (Array.isArray(remoteState.selectedDistrictIds)) setSelectedDistrictIds(remoteState.selectedDistrictIds);
      if (!preferLocal && remoteState.planSource) setPlanSource(remoteState.planSource);
      if (!preferLocal && remoteState.manualGeoJson !== undefined) setManualGeoJson(remoteState.manualGeoJson);
      setExtractedLines(effectiveExtractedLines);
      if (Array.isArray(remoteState.catalogLayers)) {
        setCatalogLayers(preferLocal && Array.isArray(localCache?.catalogLayers) ? localCache.catalogLayers : remoteState.catalogLayers);
      } else if (Array.isArray(localCache?.catalogLayers)) {
        setCatalogLayers(localCache.catalogLayers);
      }
      if (remoteState.systemStyles) {
        setSystemStyles(preferLocal && localCache?.systemStyles ? localCache.systemStyles : remoteState.systemStyles);
      } else if (localCache?.systemStyles) {
        setSystemStyles(localCache.systemStyles);
      }
      if (typeof remoteState.showRoadLines === 'boolean') setShowRoadLines(remoteState.showRoadLines);
      if (remoteState.mapBasemap) setMapBasemap(remoteState.mapBasemap);
      if (remoteState.updatedAt) setLastSavedAt(new Date(remoteState.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

      setLastSavedFingerprint(
        computeRoadAnalysisFingerprint(
          remoteState.selectedStateCode || '',
          remoteState.selectedDistrictIds || [],
          (!preferLocal && remoteState.planSource) || localCache?.planSource || 'system',
          remoteState.mapBasemap || defaultBasemapKey,
          typeof remoteState.showRoadLines === 'boolean' ? remoteState.showRoadLines : true,
          (!preferLocal && remoteState.manualGeoJson !== undefined) ? remoteState.manualGeoJson : (localCache?.manualGeoJson ?? null),
          effectiveExtractedLines,
          (preferLocal && localCache?.catalogLayers) || remoteState.catalogLayers || [],
          (preferLocal && localCache?.systemStyles) || remoteState.systemStyles
        )
      );
    }

    restoreFromSupabase();

    return () => {
      cancelled = true;
    };
  }, [projectSettings?.roadAnalysisState, defaultBasemapKey]);

  // Re-sync if the authenticated user changes
  useEffect(() => {
    const saved = loadRoadAnalysisState(userKey);
    if (saved) {
      if (saved.activeTab) setActiveTab(saved.activeTab);
      if (saved.selectedStateCode !== undefined) setSelectedStateCode(saved.selectedStateCode);
      if (Array.isArray(saved.selectedDistrictIds)) setSelectedDistrictIds(saved.selectedDistrictIds);
      if (saved.planSource) setPlanSource(saved.planSource);
      if (saved.manualGeoJson !== undefined) setManualGeoJson(saved.manualGeoJson);
      if (Array.isArray(saved.extractedLines)) setExtractedLines(saved.extractedLines);
      if (Array.isArray(saved.catalogLayers)) setCatalogLayers(saved.catalogLayers);
      if (saved.systemStyles) setSystemStyles(saved.systemStyles);
      if (typeof saved.showRoadLines === 'boolean') setShowRoadLines(saved.showRoadLines);
      if (saved.mapBasemap) setMapBasemap(saved.mapBasemap);
      setLastSavedFingerprint(
        computeRoadAnalysisFingerprint(
          saved.selectedStateCode || '',
          saved.selectedDistrictIds || [],
          saved.planSource || 'system',
          saved.mapBasemap || defaultBasemapKey,
          typeof saved.showRoadLines === 'boolean' ? saved.showRoadLines : true,
          saved.manualGeoJson || null,
          saved.extractedLines || [],
          saved.catalogLayers || [],
          saved.systemStyles
        )
      );
    }
  }, [userKey, defaultBasemapKey]);

  // Sync if project settings update dynamically from Supabase / Admin Settings
  useEffect(() => {
    if (projectSettings?.defaultBasemap) {
      setMapBasemap(projectSettings.defaultBasemap);
    }
  }, [projectSettings?.defaultBasemap]);



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

  const persistSnapshot = useCallback(
    (partial: RoadAnalysisSavedState) => {
      persistRoadAnalysisCache(userKey, {
        activeTab,
        selectedStateCode,
        selectedDistrictIds,
        planSource,
        mapBasemap,
        showRoadLines,
        manualGeoJson,
        extractedLines,
        catalogLayers,
        systemStyles,
        ...partial
      });
    },
    [
      userKey,
      activeTab,
      selectedStateCode,
      selectedDistrictIds,
      planSource,
      mapBasemap,
      showRoadLines,
      manualGeoJson,
      extractedLines,
      catalogLayers,
      systemStyles
    ]
  );

  const onStateChange = (code: string) => {
    setSelectedStateCode(code);
    setSelectedDistrictIds([]);
    persistSnapshot({ selectedStateCode: code, selectedDistrictIds: [] });
    setHasUnsavedEdits(true);
  };

  const toggleDistrict = (id: string) => {
    setSelectedDistrictIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      persistSnapshot({ selectedDistrictIds: next });
      setHasUnsavedEdits(true);
      return next;
    });
  };

  const handleBasemapChange = (value: string) => {
    setMapBasemap(value);
    persistSnapshot({ mapBasemap: value });
    setHasUnsavedEdits(true);
  };

  const handleSelectPlan = (source: PlanSource) => {
    setPlanSource(source);
    setShowRoadLines(true);
    persistSnapshot({ planSource: source, showRoadLines: true });
    setHasUnsavedEdits(true);
  };

  // Live-only system-style preview during slider drags: cheap state update,
  // no persistence, no dirty marking. The one-shot commit is done by
  // handleUpdateSystemStyles (invoked on slider release).
  const handlePreviewSystemStyles = useCallback(
    (updater: (prev: SystemLayerStyles) => SystemLayerStyles) => setSystemStyles(updater),
    []
  );

  // Commit a system-style change: applies it, persists the snapshot to the
  // local cache (marks it unsaved + bumps lastLocalEditAt) and flags the
  // workspace as dirty so the banner + Save button react exactly once.
  const handleUpdateSystemStyles = useCallback(
    (updater: (prev: SystemLayerStyles) => SystemLayerStyles) => {
      setSystemStyles((prev) => {
        const next = updater(prev);
        persistSnapshot({ systemStyles: next });
        return next;
      });
      setHasUnsavedEdits(true);
    },
    [persistSnapshot]
  );

  // Live-only catalog layer style preview during slider drags.
  const handlePreviewCatalogLayer = useCallback(
    (layerId: string, updates: Partial<CatalogVectorLayer>) => {
      setActiveTableLayer((prev) => (prev?.id === layerId ? { ...prev, ...updates } : prev));
      setCatalogLayers((prev) => prev.map((l) => (l.id === layerId ? { ...l, ...updates } : l)));
    },
    []
  );

  // Extract all panotrack survey points and tracks from operational dashboard data
  const rawPanotrack = useMemo(() => {
    return extractPanotrackPoints(internalDailyData, internalBatchLogs, internalDefectsList);
  }, [internalDailyData, internalBatchLogs, internalDefectsList, refreshTick]);

  // Active region filtering boundaries
  const activeRegionDistricts = useMemo(() => {
    if (selectedDistricts.length > 0) return selectedDistricts;
    if (districtsOfState.length > 0) return districtsOfState;
    return [];
  }, [selectedDistricts, districtsOfState]);

  const { capturedPoints, capturedTracks } = useMemo(() => {
    if (activeRegionDistricts.length > 0) {
      const res = filterPanotrackByDistricts(rawPanotrack.points, rawPanotrack.tracks, activeRegionDistricts);
      return {
        capturedPoints: res.filteredPoints,
        capturedTracks: res.filteredTracks
      };
    }
    // If no state or district is selected, show all panotracks across the entire dashboard
    return {
      capturedPoints: rawPanotrack.points,
      capturedTracks: rawPanotrack.tracks
    };
  }, [rawPanotrack, activeRegionDistricts]);

  const panotrackCounts = useMemo(() => {
    let published = 0;
    let staging = 0;
    let defect = 0;
    capturedPoints.forEach((p) => {
      if (p.color === '#ef4444' || p.status === 'defect') defect++;
      else if (p.color === '#10b981' || p.isPublished) published++;
      else staging++;
    });
    return { published, staging, defect, total: capturedPoints.length };
  }, [capturedPoints]);

  const capturedCoords = useMemo(
    () => capturedPoints.map((p) => [p.lng, p.lat] as [number, number]),
    [capturedPoints]
  );

  // Geometric line distance fallback
  const geometricDistanceKm = useMemo(() => {
    if (capturedTracks.length > 0) {
      return capturedTracks.reduce((sum, trk) => sum + pathLengthLngLatKm(trk), 0);
    }
    return pathLengthLngLatKm(capturedCoords);
  }, [capturedTracks, capturedCoords]);

  // Actual captured length is based on Masterlist total KM per project specification
  const masterlistTotalKm = useMemo(() => {
    if (!Array.isArray(internalBatchLogs) || internalBatchLogs.length === 0) {
      return geometricDistanceKm;
    }

    if (activeRegionDistricts.length > 0) {
      const regionSubgrids = new Set(
        capturedPoints
          .map((p) => (p.subgrid || '').toUpperCase().trim())
          .filter(Boolean)
      );

      const matchingBatches = internalBatchLogs.filter((b) => {
        const sg = (b.subgrid || '').toUpperCase().trim();
        return regionSubgrids.has(sg);
      });

      const sum = matchingBatches.reduce((acc, b) => {
        const km = Number(b.kmProcessed ?? (b as any).km_processed ?? (b as any).km ?? 0);
        return acc + (Number.isFinite(km) ? km : 0);
      }, 0);

      if (sum > 0) return sum;
    } else {
      const sum = internalBatchLogs.reduce((acc, b) => {
        const km = Number(b.kmProcessed ?? (b as any).km_processed ?? (b as any).km ?? 0);
        return acc + (Number.isFinite(km) ? km : 0);
      }, 0);
      if (sum > 0) return sum;
    }

    return geometricDistanceKm;
  }, [internalBatchLogs, activeRegionDistricts, capturedPoints, geometricDistanceKm]);

  const capturedDistanceKm = masterlistTotalKm;

  const extractedRuns = useMemo(
    () => clipLineStringsToDistricts(extractedLines, selectedDistricts),
    [extractedLines, selectedDistricts]
  );

  const manualRuns = useMemo(
    () => (planSource === 'manual' ? extractLineRuns(manualGeoJson) : []),
    [planSource, manualGeoJson]
  );

  const extractedLengthKm = useMemo(() => linesLengthKm(extractedRuns), [extractedRuns]);

  // Runs currently used as the plan (for map rendering and guards).
  const activePlanRuns = useMemo(() => {
    if (planSource === 'extracted') return extractedRuns;
    if (planSource === 'manual') return manualRuns;
    return [];
  }, [planSource, extractedRuns, manualRuns]);

  // Plan length is measured PER run (each disconnected road segment summed
  // independently). Flattening the runs into one array and measuring
  // consecutive points creates phantom distances between the end of one run
  // and the start of the next, inflating the plan length enormously.
  const planDistanceKm = useMemo(() => {
    if (planSource === 'extracted') return extractedLengthKm;
    if (planSource === 'manual') return linesLengthKm(manualRuns);
    return 0;
  }, [planSource, extractedLengthKm, manualRuns]);

  const ratio = useMemo(() => {
    if (planDistanceKm <= 0) return null;
    const pct = (capturedDistanceKm / planDistanceKm) * 100;
    if (pct === 0) return '0%';
    if (pct < 0.01) return '< 0.01%';
    if (pct < 10) return `${pct.toFixed(2)}%`;
    return `${pct.toFixed(1)}%`;
  }, [capturedDistanceKm, planDistanceKm]);

  const subgridMetrics = useMemo(() => {
    return computeSubgridMetrics(
      capturedPoints,
      internalDailyData,
      internalBatchLogs,
      activePlanRuns,
      capturedTracks.length,
      catalogLayers
    );
  }, [capturedPoints, internalDailyData, internalBatchLogs, activePlanRuns, capturedTracks.length, catalogLayers]);

  const activeSubgridsCount = useMemo(() => {
    return subgridMetrics.filter(
      (s) =>
        s.pointsCount > 0 ||
        s.masterlistKm > 0 ||
        s.tracksCount > 0 ||
        (s.mismatches && s.mismatches.length > 0) ||
        (s.outboundTransits && s.outboundTransits.length > 0)
    ).length;
  }, [subgridMetrics]);

  const filteredSubgridMetrics = useMemo(() => {
    let list = subgridMetrics;
    if (showActiveOnly) {
      list = list.filter(
        (s) =>
          s.pointsCount > 0 ||
          s.masterlistKm > 0 ||
          s.tracksCount > 0 ||
          (s.mismatches && s.mismatches.length > 0) ||
          (s.outboundTransits && s.outboundTransits.length > 0)
      );
    }
    if (!subgridSearch.trim()) return list;
    const q = subgridSearch.trim().toUpperCase();
    return list.filter((s) => s.subgrid.toUpperCase().includes(q));
  }, [subgridMetrics, subgridSearch, showActiveOnly]);

  // Explicit Save button action: persists to Supabase production database
  const handleSaveState = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);

    const userEmail = authSession?.user?.email || (isGuestUser ? 'guest@example.com' : 'authenticated-user');
    const statePayload: RoadAnalysisProductionState = {
      activeTab,
      selectedStateCode,
      selectedDistrictIds,
      planSource,
      mapBasemap,
      showRoadLines,
      manualGeoJson,
      extractedLines,
      catalogLayers,
      systemStyles,
      planDistanceKm: Number(planDistanceKm) || 0,
      totalSubgrids: subgridMetrics.length || 0,
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail
    };

    // 1. Primary: Save to Supabase Cloud Database (Auth Metadata & project_settings)
    const result = await saveRoadAnalysisStateToSupabase(statePayload, {
      id: authSession?.user?.id,
      email: authSession?.user?.email
    });

    setIsSaving(false);

    if (result.success) {
      // 2. Mirror the successfully-saved snapshot back into the local cache,
      //    marked as synced so the cache is a faithful mirror of the DB.
      const savedAt = result.updatedAt || statePayload.updatedAt || new Date().toISOString();
      mirrorRoadAnalysisToCache(userKey, { ...statePayload, updatedAt: savedAt });

      setHasUnsavedEdits(false);
      setLastSavedFingerprint(currentFingerprint);
      const timeStr = new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedAt(timeStr);

      addNotification?.({
        id: `road-saved-${Date.now()}`,
        title: 'Road Analysis Saved to Database',
        message: `Configuration saved to Supabase (State: ${selectedStateCode || 'All'}, Districts: ${selectedDistrictIds.length}, Basemap: ${mapBasemap}, Plan: ${planSource}, Plan Km: ${planDistanceKm.toFixed(2)} km).`,
        category: 'SUCCESS',
        read: false
      });

      addAuditLog?.(
        'EDIT',
        'Road Analysis State Saved',
        `Region ${selectedStateCode || 'N/A'} (${selectedDistrictIds.length} districts, ${planDistanceKm.toFixed(2)} km plan), basemap ${mapBasemap}, plan ${planSource} saved by ${userEmail}`,
        'success'
      );
    } else {
      addNotification?.({
        id: `road-error-${Date.now()}`,
        title: 'Database Notice',
        message: result.error || 'Failed to save configuration to Supabase database.',
        category: 'WARNING',
        read: false
      });
    }
  }, [
    isSaving,
    authSession,
    isGuestUser,
    activeTab,
    selectedStateCode,
    selectedDistrictIds,
    planSource,
    mapBasemap,
    showRoadLines,
    manualGeoJson,
    extractedLines,
    catalogLayers,
    systemStyles,
    planDistanceKm,
    subgridMetrics.length,
    userKey,
    currentFingerprint,
    addNotification,
    addAuditLog
  ]);

  const handleZoomToSubgrid = useCallback((sg: SubgridMetric) => {
    setSelectedSubgridId(sg.subgrid);
    if (sg.bbox && (sg.bbox[0] !== 0 || sg.bbox[1] !== 0)) {
      setFocusBbox([...sg.bbox]);
    }
  }, []);

  const handleReassignBatch = useCallback((fromSubgrid: string, toSubgrid: string) => {
    setInternalBatchLogs((prev) =>
      prev.map((b) => {
        if (extractSubgridName(b.subgrid) === fromSubgrid) {
          return { ...b, subgrid: toSubgrid };
        }
        return b;
      })
    );
    setInternalDailyData((prev) =>
      prev.map((d) => {
        if (extractSubgridName(d.subgrid) === fromSubgrid) {
          return {
            ...d,
            subgrid: toSubgrid,
            panoramas: Array.isArray(d.panoramas)
              ? d.panoramas.map((p: any) => ({ ...p, subgrid: toSubgrid }))
              : d.panoramas,
            points: Array.isArray(d.points)
              ? d.points.map((p: any) => ({ ...p, subgrid: toSubgrid }))
              : d.points
          };
        }
        return d;
      })
    );
    addNotification?.({
      id: `reassign-${Date.now()}`,
      title: 'Batch Reassigned',
      message: `Reassigned ${fromSubgrid} to ${toSubgrid}`,
      type: 'info'
    });
  }, [addNotification]);

  const allMismatches = useMemo(() => {
    return subgridMetrics.flatMap((s) => s.mismatches || []);
  }, [subgridMetrics]);

  const allTransits = useMemo(() => {
    return subgridMetrics.flatMap((s) => s.outboundTransits || []);
  }, [subgridMetrics]);

  const handleReassignAllMismatches = useCallback(() => {
    if (allMismatches.length === 0) return;
    allMismatches.forEach((m) => {
      handleReassignBatch(m.originSubgrid, m.spatialSubgrid);
    });
    addNotification?.({
      id: `reassign-all-${Date.now()}`,
      title: 'Bulk Reassignment Completed',
      message: `Successfully reassigned ${allMismatches.length} batch mismatch${allMismatches.length > 1 ? 'es' : ''}.`,
      type: 'info'
    });
  }, [allMismatches, handleReassignBatch, addNotification]);

  const filteredAllocationNotices = useMemo(() => {
    const list = [...allMismatches, ...allTransits];
    if (!allocationSearch.trim()) return list;
    const q = allocationSearch.trim().toUpperCase();
    return list.filter(
      (item) =>
        item.originSubgrid.toUpperCase().includes(q) ||
        item.spatialSubgrid.toUpperCase().includes(q) ||
        item.text.toUpperCase().includes(q)
    );
  }, [allMismatches, allTransits, allocationSearch]);

  const handleSelectSubgrid = useCallback((sgId: string) => {
    setSelectedSubgridId(sgId);
    setTimeout(() => {
      const el = document.getElementById(`subgrid-card-${sgId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);
  }, []);

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

      // Clip the raw OSM/Overpass response down to the selected district(s)
      // immediately, so we only ever store/render/persist the road runs that
      // actually fall inside the region. This keeps the saved payload small
      // enough to persist to Supabase / localStorage reliably.
      const clippedRuns = clipLineStringsToDistricts(result.lines, selectedDistricts);
      const clippedLines: ExtractedRoadLine[] = clippedRuns.map((run, i) => ({
        id: `clip-${i}`,
        coordinates: run,
        highway: 'extracted'
      }));

      setExtractedLines(clippedLines);
      setPlanSource('extracted');
      setShowRoadLines(true);
      persistRoadAnalysisCache(userKey, {
        activeTab,
        selectedStateCode,
        selectedDistrictIds,
        planSource: 'extracted',
        mapBasemap,
        showRoadLines: true,
        manualGeoJson,
        extractedLines: clippedLines
      });
      if (clippedLines.length === 0) {
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
  }, [regionGeo, selectedDistricts, userKey, activeTab, selectedStateCode, selectedDistrictIds, mapBasemap, manualGeoJson]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    onRefreshData?.();
    setRefreshTick((t) => t + 1);
    window.setTimeout(() => setIsRefreshing(false), 600);
  }, [onRefreshData]);

  const [manualFileMeta, setManualFileMeta] = useState<{ filename: string; format: string; count: number } | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);

  const handleFile = useCallback(async (file?: File | null) => {
    setManualError('');
    if (!file) return;
    setIsParsingFile(true);
    try {
      const result = await parseRoadPlanFile(file);
      setManualGeoJson(result.geojson);
      setManualFileMeta({
        filename: result.filename,
        format: result.format.toUpperCase(),
        count: result.featureCount
      });
      setPlanSource('manual');
      setShowRoadLines(true);
      persistRoadAnalysisCache(userKey, {
        activeTab,
        selectedStateCode,
        selectedDistrictIds,
        planSource: 'manual',
        mapBasemap,
        showRoadLines: true,
        manualGeoJson: result.geojson,
        extractedLines
      });
    } catch (err: any) {
      setManualError(err?.message || 'Failed to parse file. For Shapefile, please upload a .zip containing .shp, .dbf, and .shx.');
      setManualGeoJson(null);
      setManualFileMeta(null);
    } finally {
      setIsParsingFile(false);
    }
  }, [userKey, activeTab, selectedStateCode, selectedDistrictIds, mapBasemap, extractedLines]);

  // Unload the current plan's road lines. For Option A this clears the
  // extracted OSM network; for Option B it clears the manual GeoJSON.
  const handleClearRoads = useCallback(
    (target: 'extracted' | 'manual') => {
      let nextExtracted = extractedLines;
      let nextManual = manualGeoJson;
      let nextPlan = planSource;

      if (target === 'extracted') {
        nextExtracted = [];
        if (nextPlan === 'extracted') nextPlan = 'system';
      } else {
        nextManual = null;
        setManualFileMeta(null);
        if (nextPlan === 'manual') nextPlan = 'system';
      }

      setExtractedLines(nextExtracted);
      setManualGeoJson(nextManual);
      setPlanSource(nextPlan);
      setShowRoadLines(false);

      persistRoadAnalysisCache(userKey, {
        selectedStateCode,
        selectedDistrictIds,
        planSource: nextPlan,
        mapBasemap,
        showRoadLines: false,
        manualGeoJson: nextManual,
        extractedLines: nextExtracted
      });
      setHasUnsavedEdits(true);
    },
    [userKey, extractedLines, manualGeoJson, planSource, selectedStateCode, selectedDistrictIds, mapBasemap]
  );

  const handleLayerImported = useCallback(
    (layer: CatalogVectorLayer) => {
      setCatalogLayers((prev) => {
        const next = [layer, ...prev];
        persistRoadAnalysisCache(userKey, {
          activeTab: 'catalog',
          selectedStateCode,
          selectedDistrictIds,
          planSource,
          mapBasemap,
          showRoadLines,
          manualGeoJson,
          extractedLines,
          catalogLayers: next,
          systemStyles
        });
        return next;
      });
      setHasUnsavedEdits(true);
      setActiveTab('catalog');
      if (layer.bbox) {
        setFocusBbox(layer.bbox);
      }
      addNotification?.({
        id: `layer-imported-${Date.now()}`,
        title: 'GIS Layer Imported',
        message: `"${layer.name}" (${layer.featureCount} features) added to catalog.`,
        category: 'SUCCESS',
        read: false
      });
    },
    [
      userKey,
      selectedStateCode,
      selectedDistrictIds,
      planSource,
      mapBasemap,
      showRoadLines,
      manualGeoJson,
      extractedLines,
      systemStyles,
      addNotification
    ]
  );

  const handleUpdateCatalogLayer = useCallback(
    (layerId: string, updates: Partial<CatalogVectorLayer>) => {
      setActiveTableLayer((prev) => (prev?.id === layerId ? { ...prev, ...updates } : prev));
      setCatalogLayers((prev) => {
        const next = prev.map((l) => (l.id === layerId ? { ...l, ...updates } : l));
        persistRoadAnalysisCache(userKey, {
          activeTab,
          selectedStateCode,
          selectedDistrictIds,
          planSource,
          mapBasemap,
          showRoadLines,
          manualGeoJson,
          extractedLines,
          catalogLayers: next,
          systemStyles
        });
        return next;
      });
      setHasUnsavedEdits(true);
    },
    [
      userKey,
      activeTab,
      selectedStateCode,
      selectedDistrictIds,
      planSource,
      mapBasemap,
      showRoadLines,
      manualGeoJson,
      extractedLines,
      systemStyles
    ]
  );

  const handleRemoveCatalogLayer = useCallback(
    (layerId: string) => {
      setActiveTableLayer((prev) => (prev?.id === layerId ? null : prev));
      setCatalogLayers((prev) => {
        const next = prev.filter((l) => l.id !== layerId);
        persistRoadAnalysisCache(userKey, {
          activeTab,
          selectedStateCode,
          selectedDistrictIds,
          planSource,
          mapBasemap,
          showRoadLines,
          manualGeoJson,
          extractedLines,
          catalogLayers: next,
          systemStyles
        });
        return next;
      });
      setHasUnsavedEdits(true);
    },
    [
      userKey,
      activeTab,
      selectedStateCode,
      selectedDistrictIds,
      planSource,
      mapBasemap,
      showRoadLines,
      manualGeoJson,
      extractedLines,
      systemStyles
    ]
  );

  const handleZoomToLayer = useCallback((bbox: [number, number, number, number]) => {
    setFocusBbox([...bbox]);
  }, []);

  const handleSetAsActivePlan = useCallback(
    (layer: CatalogVectorLayer) => {
      if (!layer.geojson) return;
      setManualGeoJson(layer.geojson);
      setPlanSource('manual');
      setShowRoadLines(true);
      setActivePlanName(layer.name);
      persistRoadAnalysisCache(userKey, {
        activeTab,
        selectedStateCode,
        selectedDistrictIds,
        planSource: 'manual',
        mapBasemap,
        showRoadLines: true,
        manualGeoJson: layer.geojson,
        extractedLines,
        catalogLayers,
        systemStyles
      });
      setHasUnsavedEdits(true);
      addNotification?.({
        id: `plan-active-${Date.now()}`,
        title: 'Active Plan Promoted',
        message: `"${layer.name}" is now the active road comparison plan.`,
        category: 'INFO',
        read: false
      });
    },
    [
      userKey,
      activeTab,
      selectedStateCode,
      selectedDistrictIds,
      mapBasemap,
      extractedLines,
      catalogLayers,
      systemStyles,
      addNotification
    ]
  );

  const mapStyle = useMemo(
    () => basemapToMapStyle(mapBasemap, projectSettings?.customBasemapUrl),
    [mapBasemap, projectSettings?.customBasemapUrl]
  );

  const selectedDistrictsList = selectedDistricts.length > 0 ? selectedDistricts : [];

  const selectedStateName = useMemo(() => {
    if (!selectedStateCode) return 'All Malaysia';
    const s = DISTRICT_STATES.find((st) => st.code === selectedStateCode);
    return s?.name || selectedStateCode;
  }, [selectedStateCode]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto md:overflow-hidden p-4">
        {/* Header */}
        <div className="px-1 flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-text-base tracking-wide">
              {translate('workspaceRoadAnalysis')}
            </h2>
            <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
              {translate('workspaceRoadAnalysisDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lastSavedAt && (
              <span className="text-[10px] text-text-muted hidden sm:inline-block">
                Saved {lastSavedAt}
              </span>
            )}
            <button
              type="button"
              onClick={handleSaveState}
              disabled={isSaving || isSaved}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all shadow-sm ${
                isSaved
                  ? 'bg-sky-600 opacity-60 text-white cursor-default'
                  : 'bg-sky-600 hover:bg-sky-500 text-white opacity-100 cursor-pointer active:scale-95'
              } disabled:cursor-not-allowed`}
              title={isSaved ? 'All changes saved to database' : 'Save region, plan source, basemap and road extraction to database'}
            >
              {isSaving ? (
                <Loader2 size={13} className="animate-spin" />
              ) : isSaved ? (
                <Check size={13} />
              ) : (
                <Save size={13} />
              )}
              <span>{isSaving ? 'Saving…' : isSaved ? 'Saved' : 'Save State'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('print')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-inner border border-subtle text-[11px] font-semibold text-text-base hover:text-sky-400 transition-colors cursor-pointer shrink-0"
              title="Generate a printable Road Analysis map from the current extent or a drawn bbox"
            >
              <Printer size={13} />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-inner border border-subtle text-[11px] font-semibold text-text-base hover:text-sky-400 transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              <span>Refresh from map</span>
            </button>
          </div>
        </div>

        {/* Unsaved local edits notice */}
        {hasUnsavedEdits && (
          <div
            className="px-3 py-2 rounded-lg border flex items-center gap-2 text-[11px] font-medium"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-inner/40)' }}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            <span className="text-text-base">
              You have unsaved edits not yet pushed to the cloud — click <b>Save State</b> to sync this workspace.
            </span>
          </div>
        )}

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col flex-1 min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card shrink-0">
            <UnderlineTabStrip tabs={TABS} active={activeTab} onChange={setActiveTab} tabLabel={(k) => TAB_LABEL[k]} />
          </div>

          <div className="flex flex-1 min-h-0">
            <aside className="w-80 shrink-0 border-r border-divider overflow-y-auto p-3 flex flex-col gap-3 bg-app/40">
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

                  <div className="border-t border-divider pt-2 mt-auto">
                    <div className="flex flex-col gap-1 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-text-muted">Districts selected</span>
                        <span className="font-semibold text-text-base">{selectedDistricts.length}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Panotrack points</span>
                        <span className="font-semibold text-sky-400">
                          {isLoadingPanotrack ? 'Loading…' : capturedPoints.length.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'plan' && (
                <>
                  {/* Actual — system-derived baseline (the captured reference) */}
                  <div>
                    <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">Actual</h3>
                    <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-subtle bg-inner/40">
                      <StatusDot tone="bg-emerald-400" />
                      <span className="leading-snug">
                        <span className="block text-xs font-semibold">System-derived baseline</span>
                        <span className="block text-[10px] text-text-muted mt-0.5">
                          {capturedPoints.length > 0
                            ? `${capturedPoints.length.toLocaleString()} captured points · ${capturedDistanceKm.toFixed(2)} km`
                            : 'Built from real captured subgrid points in the selected area.'}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Plan Source — the plan to compare against (Option A or Option B) */}
                  <div className="border-t border-divider pt-2 mt-2 flex flex-col gap-2.5">
                    <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-0.5">
                      Plan Source
                    </h3>

                    {/* Option A */}
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={handleExtract}
                        disabled={extracting || selectedDistricts.length === 0}
                        className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:border-sky-500/40 cursor-pointer ${
                          planSource === 'extracted'
                            ? 'border-sky-500/40 bg-sky-500/10 text-text-base'
                            : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                        }`}
                      >
                        <StatusDot tone={planSource === 'extracted' ? 'bg-emerald-400' : 'bg-text-muted/60'} />
                        <span className="leading-snug">
                          <span className="block font-semibold">
                            {extracting ? 'Extracting road network…' : 'Option A — Extracted road network'}
                          </span>
                          <span className="block text-[10px] text-text-muted mt-0.5">
                            Pull real OSM road lines within the selected district(s).
                          </span>
                        </span>
                      </button>
                      {selectedDistricts.length === 0 && (
                        <p className="text-[10px] text-text-muted">Select state districts first.</p>
                      )}
                      {extractError ? (
                        <div className="text-[11px] text-rose-400 leading-snug">{extractError}</div>
                      ) : extractedLines.length > 0 ? (
                        <div
                          className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] ${
                            planSource === 'extracted'
                              ? 'bg-sky-500/10 border border-sky-500/30 text-sky-300'
                              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <ScanLine size={13} className="shrink-0" />
                            <span className="truncate">
                              {extractedRuns.length} road segment(s) · {extractedLengthKm.toFixed(2)} km
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {planSource !== 'extracted' && (
                              <button
                                type="button"
                                onClick={() => handleSelectPlan('extracted')}
                                className="text-[10px] text-sky-400 hover:underline cursor-pointer shrink-0"
                              >
                                Select as plan
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleClearRoads('extracted')}
                              className="text-[10px] text-rose-400 hover:underline cursor-pointer shrink-0"
                              title="Reset / unload the extracted road network"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-text-muted">
                          No plan loaded yet — click above to extract the road network.
                        </p>
                      )}
                    </div>

                    {/* Option B */}
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => {
                          setPlanSource('manual');
                          fileInputRef.current?.click();
                        }}
                        disabled={isParsingFile}
                        className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border text-left text-xs transition-colors hover:border-sky-500/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          planSource === 'manual'
                            ? 'border-sky-500/40 bg-sky-500/10 text-text-base'
                            : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                        }`}
                      >
                        <StatusDot tone={planSource === 'manual' ? 'bg-emerald-400' : 'bg-text-muted/60'} />
                        <span className="leading-snug">
                          <span className="block font-semibold">
                            {isParsingFile ? 'Parsing road file…' : 'Option B — Manual GeoJSON'}
                          </span>
                          <span className="block text-[10px] text-text-muted mt-0.5">
                            Load a GeoJSON, KML, or Shapefile ZIP (with .shp, .dbf, .shx).
                          </span>
                        </span>
                      </button>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".geojson,.json,.kml,.zip,.shp,application/json,application/zip,application/x-zip-compressed,application/vnd.google-earth.kml+xml"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFile(f);
                          e.target.value = '';
                        }}
                      />

                      {manualGeoJson ? (
                        <div
                          className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] ${
                            planSource === 'manual'
                              ? 'bg-sky-500/10 border border-sky-500/30 text-sky-300'
                              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <FileJson size={13} className="shrink-0" />
                            <span className="truncate">
                              {manualFileMeta ? `${manualFileMeta.filename} (${manualFileMeta.format})` : 'Road-plan LineString loaded'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {planSource !== 'manual' && (
                              <button
                                type="button"
                                onClick={() => handleSelectPlan('manual')}
                                className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                              >
                                Select as plan
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="text-[10px] text-sky-400 hover:underline cursor-pointer"
                            >
                              Replace
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClearRoads('manual')}
                              className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                              title="Reset / unload the manual road plan"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-text-muted">
                          No plan loaded yet — click above to upload a plan file.
                        </p>
                      )}

                      {manualError && (
                        <div className="text-[11px] text-rose-400 leading-snug p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                          {manualError}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'import' && (
                <RoadImportPanel
                  onLayerImported={handleLayerImported}
                  onNavigateToCatalog={() => setActiveTab('catalog')}
                />
              )}

              {activeTab === 'catalog' && (
                <RoadCatalogPanel
                  catalogLayers={catalogLayers}
                  systemStyles={systemStyles}
                  onUpdateSystemStyles={handleUpdateSystemStyles}
                  onPreviewSystemStyles={handlePreviewSystemStyles}
                  onUpdateCatalogLayer={handleUpdateCatalogLayer}
                  onLiveUpdateCatalogLayer={handlePreviewCatalogLayer}
                  onRemoveCatalogLayer={handleRemoveCatalogLayer}
                  onZoomToLayer={handleZoomToLayer}
                  onSetAsActivePlan={handleSetAsActivePlan}
                  onNavigateToImport={() => setActiveTab('import')}
                  panotrackCount={capturedPoints.length}
                  planDistanceKm={planDistanceKm}
                  activePlanName={activePlanName}
                  activeTableLayer={activeTableLayer}
                  onOpenAttributeTable={setActiveTableLayer}
                />
              )}

              {activeTab === 'compare' && (
                <>
                  {selectedDistrictsList.length === 0 ? (
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      Select region districts to compute actual vs plan.
                    </p>
                  ) : activePlanRuns.length < 1 ? (
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      Select a plan (Option A or Option B) to compare actual captured vs plan.
                    </p>
                  ) : (
                    <>
                      {/* Overall Progress — system-derived baseline */}
                      <div className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">
                        Overall Progress
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Actual captured points</span>
                        <span className="font-semibold text-text-base">{capturedPoints.length.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Actual captured tracks</span>
                        <span className="font-semibold text-text-base">
                          {capturedTracks.length.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Actual captured length</span>
                        <span className="font-semibold text-text-base">{capturedDistanceKm.toFixed(2)} km</span>
                      </div>

                      {/* Plan — Option A or Option B */}
                      <div className="border-t border-divider pt-2 mt-2">
                        <div className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">
                          Plan ({planSource === 'extracted' ? 'Option A' : 'Option B'})
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Plan road segments</span>
                          <span className="font-semibold text-text-base">{activePlanRuns.length.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Plan length</span>
                          <span className="font-semibold text-text-base">{planDistanceKm.toFixed(2)} km</span>
                        </div>
                      </div>

                      {/* Actual vs Plan Calculation Details */}
                      <div className="border-t border-divider pt-2 mt-2">
                        <div className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">
                          Actual vs Plan Calculation
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Actual captured / plan</span>
                          <span className="font-semibold text-text-base">
                            {ratio === null ? '—' : ratio}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Difference length</span>
                          <span className="font-semibold text-text-base">
                            {(capturedDistanceKm - planDistanceKm).toFixed(2)} km
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-text-muted">Remaining to capture</span>
                          <span className="font-semibold text-text-base">
                            {Math.max(0, planDistanceKm - capturedDistanceKm).toFixed(2)} km
                          </span>
                        </div>
                        <div className="border-t border-divider pt-2 mt-2 text-[10px] text-text-muted leading-relaxed">
                          {planSource === 'extracted'
                            ? 'Plan is the OSM-extracted road network (Option A) within the selected district(s).'
                            : 'Plan is a manual GeoJSON override (Option B).'}
                        </div>
                      </div>

                      {/* By Subgrid Comparison (5x5 km) */}
                      <div className="border-t border-divider pt-2 mt-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[9px] uppercase tracking-widest text-text-muted font-bold">
                            By Subgrid Comparison (5×5 km)
                          </div>
                          <span className="text-[10px] text-text-muted font-mono font-medium">
                            {filteredSubgridMetrics.length}
                            {filteredSubgridMetrics.length !== subgridMetrics.length ? ` of ${subgridMetrics.length}` : ''}{' '}
                            subgrid{subgridMetrics.length === 1 ? '' : 's'}
                          </span>
                        </div>

                        {/* Filter pills: All vs Active in Data Management */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <button
                            type="button"
                            onClick={() => setShowActiveOnly(false)}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors border ${
                              !showActiveOnly
                                ? 'bg-inner border-subtle text-text-base font-bold shadow-sm'
                                : 'bg-transparent border-transparent text-text-muted hover:text-text-base'
                            }`}
                          >
                            All ({subgridMetrics.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowActiveOnly(true)}
                            className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-colors border flex items-center gap-1.5 ${
                              showActiveOnly
                                ? 'bg-inner border-subtle text-text-base font-bold shadow-sm ring-1 ring-subtle/50'
                                : 'bg-transparent border-transparent text-text-muted hover:text-text-base'
                            }`}
                            title="Show only subgrids with active data available in Data Management"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                showActiveOnly ? 'bg-sky-400' : 'bg-text-muted/60'
                              }`}
                            />
                            Active Dataset ({activeSubgridsCount})
                          </button>
                        </div>

                        {subgridMetrics.length > 2 && (
                          <input
                            type="text"
                            placeholder="Filter subgrid NxxExx..."
                            value={subgridSearch}
                            onChange={(e) => setSubgridSearch(e.target.value)}
                            className="w-full px-2 py-1 rounded bg-inner border border-subtle text-[11px] text-text-base mb-2 font-mono placeholder:text-text-muted focus:outline-none"
                          />
                        )}

                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-0.5">
                          {filteredSubgridMetrics.length === 0 ? (
                            <p className="text-[10px] text-text-muted py-1.5">
                              No subgrids found in this area.
                            </p>
                          ) : (
                            filteredSubgridMetrics.map((sg) => {
                              const isSelected = selectedSubgridId === sg.subgrid;
                              return (
                                <div
                                  key={sg.subgrid}
                                  id={`subgrid-card-${sg.subgrid}`}
                                  className={`p-2.5 rounded-lg border transition-all ${
                                    isSelected
                                      ? 'bg-inner border-subtle/80 ring-1 ring-subtle'
                                      : 'bg-inner/40 border-subtle hover:bg-inner/70'
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-subtle/40">
                                    <span className="font-mono font-bold text-xs text-text-base tracking-wide">
                                      {sg.subgrid}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleZoomToSubgrid(sg)}
                                      className="text-[10px] text-text-muted hover:text-text-base cursor-pointer underline decoration-dotted"
                                      title={`Focus map to 5×5 km extent of ${sg.subgrid}`}
                                    >
                                      Focus 5×5 km
                                    </button>
                                  </div>

                                  <div className="space-y-1 text-[11px]">
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-muted">Captured points</span>
                                      <span className="font-semibold text-text-base">{sg.pointsCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-muted">Captured tracks</span>
                                      <span className="font-semibold text-text-base">{sg.tracksCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-muted">Captured length (Masterlist)</span>
                                      <span className="font-semibold text-text-base">{sg.masterlistKm.toFixed(2)} km</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-muted">Plan length (5×5 km)</span>
                                      <span className="font-semibold text-text-base">{sg.planKm.toFixed(2)} km</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-muted">Captured / plan</span>
                                      <span className="font-semibold text-text-base">{sg.completionRatio ?? '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-muted">Difference length</span>
                                      <span className="font-semibold text-text-base">{sg.differenceKm.toFixed(2)} km</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-text-muted">Remaining to capture</span>
                                      <span className="font-semibold text-text-base">{sg.remainingKm.toFixed(2)} km</span>
                                    </div>
                                  </div>

                                  {/* Outbound Continuous Road Transits & Mismatches */}
                                  {((sg.outboundTransits && sg.outboundTransits.length > 0) ||
                                    (sg.inboundTransits && sg.inboundTransits.length > 0) ||
                                    (sg.mismatches && sg.mismatches.length > 0)) && (
                                    <div className="mt-2 pt-2 border-t border-subtle/50 space-y-1.5 text-[10px]">
                                      {sg.outboundTransits?.map((tr, idx) => (
                                        <div key={`out-${idx}`} className="p-1.5 rounded bg-inner border border-subtle text-text-muted">
                                          <div className="flex items-center justify-between">
                                            <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">Transit Outbound</div>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveDetailNotice(tr);
                                              }}
                                              className="w-3.5 h-3.5 rounded-full border border-subtle flex items-center justify-center font-mono text-[9px] leading-none font-bold text-text-muted hover:text-text-base hover:border-text-muted transition-colors cursor-pointer"
                                              title="Open detail explanation"
                                              aria-label="Open transit detail"
                                            >
                                              !
                                            </button>
                                          </div>
                                          <div className="text-text-base font-mono leading-tight mt-0.5">{tr.text} ({tr.pointsCount} pts)</div>
                                        </div>
                                      ))}
                                      {sg.inboundTransits?.map((inTr, idx) => (
                                        <div key={`in-${idx}`} className="p-1.5 rounded bg-inner border border-subtle text-text-muted">
                                          <div className="flex items-center justify-between">
                                            <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">Transit Inbound</div>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveDetailNotice(inTr);
                                              }}
                                              className="w-3.5 h-3.5 rounded-full border border-subtle flex items-center justify-center font-mono text-[9px] leading-none font-bold text-text-muted hover:text-text-base hover:border-text-muted transition-colors cursor-pointer"
                                              title="Open detail explanation"
                                              aria-label="Open inbound transit detail"
                                            >
                                              !
                                            </button>
                                          </div>
                                          <div className="text-text-base font-mono leading-tight mt-0.5">{inTr.text} ({inTr.pointsCount} pts)</div>
                                        </div>
                                      ))}
                                      {sg.mismatches?.map((m, idx) => (
                                        <div key={`mis-${idx}`} className="p-1.5 rounded bg-inner border border-subtle text-text-muted">
                                          <div className="flex items-center justify-between">
                                            <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">Data Mismatch</div>
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setActiveDetailNotice(m);
                                              }}
                                              className="w-3.5 h-3.5 rounded-full border border-subtle flex items-center justify-center font-mono text-[9px] leading-none font-bold text-text-muted hover:text-text-base hover:border-text-muted transition-colors cursor-pointer"
                                              title="Open detail explanation"
                                              aria-label="Open mismatch detail"
                                            >
                                              !
                                            </button>
                                          </div>
                                          <div className="text-text-base font-mono leading-tight mt-0.5">{m.text}</div>
                                          <button
                                            type="button"
                                            onClick={() => handleReassignBatch(m.originSubgrid, m.spatialSubgrid)}
                                            className="mt-1 px-2 py-0.5 rounded border border-subtle bg-inner hover:bg-inner/80 text-[10px] text-text-base font-mono cursor-pointer"
                                          >
                                            Reassign {m.originSubgrid} to {m.spatialSubgrid}
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {activeTab === 'allocation' && (
                <div className="flex flex-col gap-3">
                  {/* Allocation Header */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-[10px] uppercase tracking-wider text-text-muted font-bold font-mono">
                        Subgrid Allocation & Diagnostics
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setRulesModalTab('rules');
                          setShowRulesModal(true);
                        }}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-subtle bg-inner hover:bg-inner/80 text-[10px] font-mono text-text-base cursor-pointer transition-colors shrink-0 shadow-sm group"
                        title="View allocation rules & operational scenarios"
                      >
                        <span className="font-semibold text-text-muted group-hover:text-text-base transition-colors">Rule</span>
                        <span className="w-3.5 h-3.5 rounded-full border border-subtle flex items-center justify-center font-mono text-[9px] leading-none font-bold text-text-muted group-hover:text-text-base group-hover:border-text-muted transition-colors">!</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      Cross-boundary transits and batch allocation mismatches across active subgrid polygons.
                    </p>
                  </div>

                  {/* Summary Metric Chips */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-inner border border-subtle">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">Mismatches</div>
                      <div className="text-sm font-bold text-text-base font-mono mt-0.5">
                        {allMismatches.length}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-inner border border-subtle">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">Transits Outbound</div>
                      <div className="text-sm font-bold text-text-base font-mono mt-0.5">
                        {allTransits.length}
                      </div>
                    </div>
                  </div>

                  {/* Bulk Reassign Action */}
                  {allMismatches.length > 0 ? (
                    <button
                      type="button"
                      onClick={handleReassignAllMismatches}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-inner hover:bg-inner/80 text-text-base border border-subtle text-xs font-mono font-semibold cursor-pointer transition-colors shadow-sm"
                    >
                      <ArrowRightLeft size={13} className="text-sky-400" />
                      Reassign All Mismatches ({allMismatches.length})
                    </button>
                  ) : (
                    <div className="p-2 rounded-lg bg-inner border border-subtle text-center text-[11px] text-text-muted font-mono">
                      ✓ No pending data mismatches detected
                    </div>
                  )}

                  {/* Filter / Search input */}
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                    <input
                      type="text"
                      placeholder="Filter by subgrid..."
                      value={allocationSearch}
                      onChange={(e) => setAllocationSearch(e.target.value)}
                      className="w-full pl-7 pr-2.5 py-1.5 rounded-lg bg-inner border border-subtle text-xs text-text-base font-mono placeholder:text-text-muted/60 outline-none focus:border-subtle/80"
                    />
                  </div>

                  {/* Diagnostic List */}
                  <div className="space-y-2 mt-1">
                    {filteredAllocationNotices.length === 0 ? (
                      <div className="p-3 rounded-lg bg-inner/40 border border-subtle text-center text-[11px] text-text-muted">
                        No allocation issues found.
                      </div>
                    ) : (
                      filteredAllocationNotices.map((item, idx) => {
                        const isMismatch = item.type === 'MISMATCH';
                        return (
                          <div
                            key={`alloc-${idx}`}
                            className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5 text-[11px]"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">
                                {isMismatch ? 'Data Mismatch' : 'Transit Outbound'}
                              </span>
                              <button
                                type="button"
                                onClick={() => setActiveDetailNotice(item)}
                                className="w-3.5 h-3.5 rounded-full border border-subtle flex items-center justify-center font-mono text-[9px] leading-none font-bold text-text-muted hover:text-text-base hover:border-text-muted transition-colors cursor-pointer"
                                title="Open detail explanation"
                                aria-label="Open diagnostic detail"
                              >
                                !
                              </button>
                            </div>

                            <div className="space-y-0.5 font-mono text-[10.5px]">
                              <div className="flex items-center justify-between">
                                <span className="text-text-muted">Assigned:</span>
                                <span className="font-semibold text-text-base">{item.originSubgrid}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-text-muted">Physical GPS:</span>
                                <span className="font-semibold text-text-base">{item.spatialSubgrid}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-text-muted">Affected:</span>
                                <span className="font-semibold text-text-base">{item.pointsCount} pts</span>
                              </div>
                            </div>

                            <div className="text-text-muted text-[10px] font-mono leading-tight pt-1 border-t border-subtle/40">
                              {item.text}
                            </div>

                            <div className="flex items-center gap-1.5 pt-1.5">
                              {isMismatch && (
                                <button
                                  type="button"
                                  onClick={() => handleReassignBatch(item.originSubgrid, item.spatialSubgrid)}
                                  className="flex-1 px-2 py-1 rounded border border-subtle bg-inner hover:bg-inner/80 text-[10px] text-text-base font-mono cursor-pointer transition-colors text-center"
                                >
                                  Reassign {item.originSubgrid} to {item.spatialSubgrid}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  const sgMetric = subgridMetrics.find((s) => s.subgrid === item.originSubgrid || s.subgrid === item.spatialSubgrid);
                                  if (sgMetric) handleZoomToSubgrid(sgMetric);
                                }}
                                className="px-2 py-1 rounded border border-subtle bg-inner hover:bg-inner/80 text-[10px] text-text-muted hover:text-text-base font-mono cursor-pointer transition-colors"
                              >
                                Focus 5×5 km
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'print' && (
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-[10px] uppercase tracking-wider text-text-muted font-bold font-mono">
                        Printable Map Export
                      </h3>
                      <Printer size={13} className="text-sky-400" />
                    </div>
                    <p className="text-[11px] text-text-muted leading-relaxed">
                      Generate a print / save-as-PDF road analysis map from the current map extent or a drawn
                      bounding box on the preview surface.
                    </p>
                  </div>

                  {/* Print Region Summary */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-inner border border-subtle col-span-2">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">State</div>
                      <div className="text-sm font-bold text-text-base mt-0.5 truncate">{selectedStateName}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-inner border border-subtle col-span-2">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">Districts</div>
                      <div className="text-[11px] font-semibold text-text-base mt-0.5 leading-snug">
                        {selectedDistrictsList.length > 0
                          ? selectedDistrictsList.map((d) => d.name).join(', ')
                          : 'All Malaysia / none selected'}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-inner border border-subtle">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">Plan Km</div>
                      <div className="text-sm font-bold text-text-base font-mono mt-0.5">
                        {planDistanceKm.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-inner border border-subtle">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">Captured Km</div>
                      <div className="text-sm font-bold text-text-base font-mono mt-0.5">
                        {capturedDistanceKm.toFixed(2)}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-inner border border-subtle">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">Coverage</div>
                      <div className="text-sm font-bold text-sky-400 font-mono mt-0.5">{ratio ?? '—'}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-inner border border-subtle">
                      <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono">Points</div>
                      <div className="text-sm font-bold text-text-base font-mono mt-0.5">
                        {capturedPoints.length.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Legend hint */}
                  <div className="p-2.5 rounded-lg bg-inner/40 border border-subtle flex flex-col gap-1.5 text-[10px] text-text-muted">
                    <div className="text-[9px] uppercase tracking-widest text-text-muted font-bold">
                      Map Legend
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-0.5 rounded" style={{ background: systemStyles.districtBoundary.color }} />
                      <span>District boundary</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-0.5 rounded" style={{ background: systemStyles.roadPlan.color }} />
                      <span>Road plan lines</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Panotrack published</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Panotrack staging</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>Panotrack defect</span>
                    </div>
                    {catalogLayers.filter((l) => l.visible).map((l) => (
                      <div key={l.id} className="flex items-center gap-2">
                        <span className="w-4 h-0.5 rounded" style={{ background: l.color }} />
                        <span className="truncate">{l.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>

            <div className="flex-1 min-w-0 bg-app overflow-hidden relative flex flex-col">
              {/* Live map — always mounted; hidden (not unmounted) while on the Print tab */}
              <div
                className="flex-1 min-h-0 relative"
                style={{
                  visibility: activeTab === 'print' ? 'hidden' : 'visible',
                  pointerEvents: activeTab === 'print' ? 'none' : 'auto'
                }}
              >
              <div className="absolute inset-0 overflow-hidden">
                {/* Top-Left Floating Map Controls Box Card */}
                <div
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-subtle)',
                    boxShadow: 'var(--card-shadow)'
                  }}
                  className="absolute top-3 left-3 z-[1000] flex items-center gap-1.5 p-1.5 rounded-xl border backdrop-blur-md shadow-lg transition-colors"
                >

                  <div className="flex items-center gap-1.5 px-1">
                    <Layers size={13} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
                    <select
                      value={mapBasemap}
                      onChange={(e) => handleBasemapChange(e.target.value)}
                      style={{
                        backgroundColor: 'var(--bg-inner)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-primary)'
                      }}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border focus:outline-none focus:ring-1 focus:ring-sky-400/50 cursor-pointer shadow-sm transition-colors"
                      title="Map basemap"
                    >
                      <option value="ofm-dark" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Dark (OpenFreeMap)</option>
                      <option value="ofm-positron" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Positron (OpenFreeMap)</option>
                      <option value="ofm-bright" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Bright (OpenFreeMap)</option>
                      <option value="ofm-liberty" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Liberty (OpenFreeMap)</option>
                      <option value="ofm-fiord" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Fiord (OpenFreeMap)</option>
                      <option value="esri_satellite" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Esri Satellite</option>
                      <option value="osm_standard" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>OpenStreetMap</option>
                      <option value="carto_dark" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Carto Dark</option>
                      <option value="carto_light" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Carto Light</option>
                      <option value="google-satellite" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Google Satellite</option>
                      <option value="google-streets" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Google Streets</option>
                      <option value="google-hybrid" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Google Hybrid</option>
                      <option value="google-terrain" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Google Terrain</option>
                      <option value="custom_tile" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>Custom XYZ</option>
                    </select>
                  </div>
                </div>

                <RoadAnalysisMap
                  active
                  showRoadLines={showRoadLines}
                  style={mapStyle}
                  bbox={regionGeo?.bbox ?? null}
                  districtGeojson={regionGeo?.geojson}
                  dimmedRegionsGeojson={dimmedRegionsGeojson}
                  capturedPoints={capturedPoints}
                  roadRuns={activePlanRuns}
                  catalogLayers={catalogLayers}
                  systemStyles={systemStyles}
                  focusBbox={focusBbox}
                  selectedFeature={selectedTableFeature}
                  onSelectSubgrid={handleSelectSubgrid}
                  mapInstanceRef={liveMapRef}
                />

                {/* Panotrack Operational Status Legend */}
                {capturedPoints.length > 0 && (
                  <div
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                      boxShadow: 'var(--card-shadow)',
                      color: 'var(--text-primary)'
                    }}
                    className="absolute bottom-6 right-6 z-[1000] flex items-center gap-3 px-3 py-1.5 rounded-xl border backdrop-blur-md shadow-lg text-[11px] font-medium animate-in fade-in duration-200"
                  >
                    <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted mr-0.5">Panotrack:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
                      <span className="text-text-muted">Published ({panotrackCounts.published})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 shadow-sm" />
                      <span className="text-text-muted">Staging ({panotrackCounts.staging})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500 shadow-sm" />
                      <span className={panotrackCounts.defect > 0 ? "text-rose-400 font-bold" : "text-text-muted"}>
                        Defect ({panotrackCounts.defect})
                      </span>
                    </div>
                  </div>
                )}

                {extracting && (
                  <div className="absolute inset-0 z-[1000] flex items-center justify-center pointer-events-none">
                    <div
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                        boxShadow: 'var(--card-shadow)',
                        color: 'var(--text-primary)'
                      }}
                      className="px-4 py-2.5 rounded-xl border flex items-center gap-2.5 backdrop-blur-md shadow-xl animate-in fade-in duration-200"
                    >
                      <RefreshCw size={14} className="text-sky-400 animate-spin shrink-0" />
                      <span className="text-xs font-semibold">
                        Extracting road network…
                      </span>
                    </div>
                  </div>
                )}

                {selectedDistricts.length === 0 && capturedPoints.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                        boxShadow: 'var(--card-shadow)',
                        color: 'var(--text-primary)'
                      }}
                      className="px-4 py-2.5 rounded-xl border flex items-center gap-2.5 backdrop-blur-md shadow-xl animate-in fade-in duration-200"
                    >
                      <Map size={14} className="text-sky-400 shrink-0" />
                      <span className="text-xs font-medium text-text-muted">
                        Select state districts to focus the map.
                      </span>
                    </div>
                  </div>
                )}
                </div>
                </div>

                {/* Print preview — lazily mounted on first Print visit, then kept alive so
                    Allocation <-> Print switching never remounts (and flashes) a map. */}
                {printPanelMounted && (
                  <div
                    className="absolute inset-0 flex flex-col"
                    style={{
                      visibility: activeTab === 'print' ? 'visible' : 'hidden',
                      pointerEvents: activeTab === 'print' ? 'auto' : 'none'
                    }}
                  >
                    <RoadAnalysisPrintPanel
                      style={mapStyle}
                      districtGeojson={regionGeo?.geojson}
                      dimmedRegionsGeojson={dimmedRegionsGeojson}
                      capturedPoints={capturedPoints}
                      roadRuns={activePlanRuns}
                      catalogLayers={catalogLayers}
                      systemStyles={systemStyles}
                      showRoadLines={showRoadLines}
                      liveMapRef={liveMapRef}
                      mapInstanceRef={printMapRef}
                      pointsSummary={panotrackCounts}
                      planDistanceKm={planDistanceKm}
                      capturedDistanceKm={capturedDistanceKm}
                      coverageRatio={ratio}
                      selectedStateName={selectedStateName}
                      districtNames={selectedDistrictsList.map((d) => d.name)}
                      basemapName={mapBasemap}
                      onNotify={addNotification}
                    />
                  </div>
                )}

              {/* Bottom Docked Attribute Table Drawer */}
              {activeTableLayer && (
                <RoadAttributeTableDrawer
                  layer={activeTableLayer}
                  onClose={() => {
                    setActiveTableLayer(null);
                    setSelectedTableFeature(null);
                  }}
                  onZoomToFeature={(bbox) => setFocusBbox([...bbox])}
                  onSelectFeature={(feat, _idx, bbox) => {
                    setSelectedTableFeature(feat);
                    if (bbox) setFocusBbox([...bbox]);
                  }}
                  selectedFeature={selectedTableFeature}
                />
              )}

              {/* Technical Diagnostic Detail Modal Dialog */}
              {activeDetailNotice && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Diagnostic Detail"
                  className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-sm animate-in fade-in duration-150"
                  onClick={() => setActiveDetailNotice(null)}
                >
                  <div
                    className="bg-card border border-subtle rounded-xl p-5 max-w-md w-full flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="flex justify-between items-center pb-3 mb-3 border-b border-subtle shrink-0">
                      <div>
                        <div className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">
                          {activeDetailNotice.type === 'MISMATCH' ? 'Allocation Diagnostic' : 'Transit Diagnostic'}
                        </div>
                        <h2 className="text-sm font-bold text-text-base tracking-wide font-mono mt-0.5">
                          {activeDetailNotice.type === 'MISMATCH' ? 'Data Mismatch Detail' : 'Transit Diagnostic Detail'}
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveDetailNotice(null)}
                        className="w-6 h-6 rounded border border-subtle flex items-center justify-center text-text-muted hover:text-text-base hover:bg-inner cursor-pointer transition-colors font-mono text-xs"
                        aria-label="Close detail dialog"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Metadata Table */}
                    <div className="bg-inner border border-subtle rounded-lg p-3 space-y-1.5 font-mono text-[11px] mb-3">
                      <div className="flex items-center justify-between">
                        <span className="text-text-muted">Assigned Subgrid</span>
                        <span className="font-semibold text-text-base">{activeDetailNotice.originSubgrid}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-text-muted">Physical Subgrid (GPS)</span>
                        <span className="font-semibold text-text-base">{activeDetailNotice.spatialSubgrid}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-text-muted">Affected Survey Frames</span>
                        <span className="font-semibold text-text-base">{activeDetailNotice.pointsCount.toLocaleString()} pts</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-text-muted">Diagnostic Reason</span>
                        <span className="font-semibold text-text-base">{activeDetailNotice.reason || (activeDetailNotice.type === 'MISMATCH' ? 'data missmatch with subgrid assign' : 'cross-boundary continuous transit')}</span>
                      </div>
                    </div>

                    {/* Technical Detail Explanation */}
                    <div className="space-y-2.5 text-xs text-text-muted">
                      <div>
                        <div className="text-[10px] uppercase font-mono tracking-wider font-semibold text-text-base mb-1">
                          Why this occurred
                        </div>
                        <p className="leading-relaxed font-sans text-[11.5px]">
                          {activeDetailNotice.type === 'MISMATCH'
                            ? `All ${activeDetailNotice.pointsCount} survey frames in this batch are labeled as ${activeDetailNotice.originSubgrid} in the manifest/filename, but ray-casting against catalog subgrid boundary polygons places them physically inside ${activeDetailNotice.spatialSubgrid}. This typically occurs when a collection survey was organized under the wrong folder or subgrid label before upload.`
                            : `The survey vehicle recorded a continuous road run that originated in ${activeDetailNotice.originSubgrid} and continued across the boundary into adjacent ${activeDetailNotice.spatialSubgrid}. ${activeDetailNotice.pointsCount} captured frames are located across the subgrid boundary polygon.`}
                        </p>
                      </div>

                      <div>
                        <div className="text-[10px] uppercase font-mono tracking-wider font-semibold text-text-base mb-1">
                          Operational Rule & Impact
                        </div>
                        <p className="leading-relaxed font-sans text-[11.5px]">
                          {activeDetailNotice.type === 'MISMATCH'
                            ? `Per system rules, WebGIS sequence originality is strictly preserved: photo filenames (e.g. ${activeDetailNotice.originSubgrid}-XXXX.jpg) are never altered. Reassigning updates the database indexing pointer so mileage and point totals correctly attribute to ${activeDetailNotice.spatialSubgrid} without breaking raw media lineage.`
                            : `Continuous road surveys naturally span across artificial 5×5 km grid boundaries. Frames remain linked to their original survey track to maintain continuous road geometry without fragmentation. Length within the 5×5 km cell is accounted for in plan completion.`}
                        </p>
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="pt-3 mt-4 border-t border-subtle flex items-center justify-between shrink-0">
                      <span className="text-[10px] text-text-muted font-mono">
                        {activeDetailNotice.type === 'MISMATCH' ? 'Original filenames preserved' : 'Continuous road geometry'}
                      </span>
                      <div className="flex items-center gap-2">
                        {activeDetailNotice.type === 'MISMATCH' && (
                          <button
                            type="button"
                            onClick={() => {
                              handleReassignBatch(activeDetailNotice.originSubgrid, activeDetailNotice.spatialSubgrid);
                              setActiveDetailNotice(null);
                            }}
                            className="px-3 py-1.5 bg-inner hover:bg-inner/80 text-text-base border border-subtle rounded-lg text-xs font-mono font-medium cursor-pointer transition-colors"
                          >
                            Reassign {activeDetailNotice.originSubgrid} to {activeDetailNotice.spatialSubgrid}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActiveDetailNotice(null)}
                          className="px-3.5 py-1.5 bg-inner hover:bg-inner/80 text-text-muted hover:text-text-base border border-subtle rounded-lg text-xs font-mono cursor-pointer transition-colors"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Allocation Rules & Scenarios Guide Modal */}
              {showRulesModal && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Allocation Rules and Scenarios Guide"
                  className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-sm animate-in fade-in duration-150"
                  onClick={() => setShowRulesModal(false)}
                >
                  <div
                    className="bg-card border border-subtle rounded-xl p-5 max-w-xl w-full flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 max-h-[90vh]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="flex justify-between items-start pb-3 mb-3 border-b border-subtle shrink-0">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] uppercase tracking-wider text-text-muted font-mono font-semibold">
                            Allocation & Diagnostic Guide
                          </span>
                          <span className="px-1.5 py-0.5 rounded border border-subtle bg-inner text-[9px] font-mono text-text-muted">
                            Rule Reference
                          </span>
                        </div>
                        <h2 className="text-sm font-bold text-text-base tracking-wide font-mono mt-1">
                          Subgrid Allocation Rules & Scenarios
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowRulesModal(false)}
                        className="w-6 h-6 rounded border border-subtle flex items-center justify-center text-text-muted hover:text-text-base hover:bg-inner cursor-pointer transition-colors font-mono text-xs"
                        aria-label="Close rules dialog"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Segmented Tab Switch */}
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-inner border border-subtle mb-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => setRulesModalTab('rules')}
                        className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-medium transition-colors cursor-pointer text-center ${
                          rulesModalTab === 'rules'
                            ? 'bg-card text-text-base shadow-sm border border-subtle'
                            : 'text-text-muted hover:text-text-base'
                        }`}
                      >
                        Operational Rules (4)
                      </button>
                      <button
                        type="button"
                        onClick={() => setRulesModalTab('scenarios')}
                        className={`flex-1 py-1.5 px-3 rounded text-xs font-mono font-medium transition-colors cursor-pointer text-center ${
                          rulesModalTab === 'scenarios'
                            ? 'bg-card text-text-base shadow-sm border border-subtle'
                            : 'text-text-muted hover:text-text-base'
                        }`}
                      >
                        Survey Scenarios (3)
                      </button>
                    </div>

                    {/* Scrollable Content Body */}
                    <div className="overflow-y-auto pr-1 space-y-3 text-xs flex-1">
                      {rulesModalTab === 'rules' ? (
                        <div className="space-y-2.5">
                          {/* Rule 1 */}
                          <div className="p-3 rounded-lg bg-inner border border-subtle">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-mono font-bold text-text-base">
                                Rule 1: GNSS Ground Truth (Spatial Attribution)
                              </span>
                              <span className="px-1.5 py-0.5 rounded border border-subtle text-[9px] font-mono text-text-muted">
                                GPS Coordinates
                              </span>
                            </div>
                            <p className="text-[11.5px] text-text-muted leading-relaxed font-sans">
                              Physical coordinates recorded by the vehicle's GNSS receiver determine true geographic positioning. When frame coordinates fall inside a 5×5 km subgrid boundary polygon, the frame is spatially attributed to that cell regardless of the folder name or initial upload batch label.
                            </p>
                          </div>

                          {/* Rule 2 */}
                          <div className="p-3 rounded-lg bg-inner border border-subtle">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-mono font-bold text-text-base">
                                Rule 2: Filename & Raw Storage Immutability
                              </span>
                              <span className="px-1.5 py-0.5 rounded border border-subtle text-[9px] font-mono text-text-muted">
                                Lineage Intact
                              </span>
                            </div>
                            <p className="text-[11.5px] text-text-muted leading-relaxed font-sans">
                              Original camera frame filenames (e.g. <span className="font-mono text-text-base">N94E70-0066.jpg</span>) and cloud storage bucket keys are <strong className="text-text-base font-medium">never renamed or moved</strong>. WebGIS sequence integrity, frame timestamps, and raw media provenance are strictly preserved. Reassignment only updates the database indexing pointers and spatial attribution records.
                            </p>
                          </div>

                          {/* Rule 3 */}
                          <div className="p-3 rounded-lg bg-inner border border-subtle">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-mono font-bold text-text-base">
                                Rule 3: Non-Destructive Additive Merging
                              </span>
                              <span className="px-1.5 py-0.5 rounded border border-subtle text-[9px] font-mono text-text-muted">
                                Additive
                              </span>
                            </div>
                            <p className="text-[11.5px] text-text-muted leading-relaxed font-sans">
                              When a batch is reassigned to its physical destination subgrid, points and mileage are seamlessly merged into the destination's active dataset. Existing survey runs in the destination subgrid are never overwritten or displaced, correctly accumulating towards total plan completion.
                            </p>
                          </div>

                          {/* Rule 4 */}
                          <div className="p-3 rounded-lg bg-inner border border-subtle">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-mono font-bold text-text-base">
                                Rule 4: Workspace Analytical Scope
                              </span>
                              <span className="px-1.5 py-0.5 rounded border border-subtle text-[9px] font-mono text-text-muted">
                                Real-Time Session
                              </span>
                            </div>
                            <p className="text-[11.5px] text-text-muted leading-relaxed font-sans">
                              Reassignments performed in this workspace update the analytical working session in real time. Road completion rates, captured distance, and diagnostic counters recalculate instantly across all tabs without altering production database tables until permanently committed by an administrator.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {/* Scenario 1 */}
                          <div className="p-3 rounded-lg bg-inner border border-subtle">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-mono font-bold text-text-base">
                                Scenario 1: Normal In-Grid Survey (Matched)
                              </span>
                              <span className="px-1.5 py-0.5 rounded border border-subtle text-[9px] font-mono text-text-muted">
                                100% In Polygon
                              </span>
                            </div>
                            <div className="space-y-1 text-[11.5px] text-text-muted leading-relaxed font-sans">
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Condition:</strong> The survey vehicle operated strictly within the designated subgrid. 100% of recorded GPS points fall inside the cell polygon.
                              </p>
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Action:</strong> No adjustment needed. Captured road distance is 100% credited against the subgrid plan length.
                              </p>
                            </div>
                          </div>

                          {/* Scenario 2 */}
                          <div className="p-3 rounded-lg bg-inner border border-subtle">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-mono font-bold text-text-base">
                                Scenario 2: Cross-Boundary Transit (Transit Outbound)
                              </span>
                              <span className="px-1.5 py-0.5 rounded border border-subtle text-[9px] font-mono text-text-muted">
                                Continuous Corridor
                              </span>
                            </div>
                            <div className="space-y-1 text-[11.5px] text-text-muted leading-relaxed font-sans">
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Condition:</strong> The vehicle surveyed a continuous highway or arterial corridor that crosses the 5×5 km boundary into an adjacent subgrid.
                              </p>
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Behavior:</strong> Points across the boundary line are recorded as <span className="font-mono text-text-base">Transit Outbound</span> in origin and <span className="font-mono text-text-base">Transit Inbound</span> in destination. Track sequence is preserved to avoid line fragmentation.
                              </p>
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Action:</strong> Do not reassign. Points inside each subgrid polygon automatically contribute to that respective cell's plan completion.
                              </p>
                            </div>
                          </div>

                          {/* Scenario 3 */}
                          <div className="p-3 rounded-lg bg-inner border border-subtle">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-mono font-bold text-text-base">
                                Scenario 3: Batch Allocation Mismatch (Data Mismatch)
                              </span>
                              <span className="px-1.5 py-0.5 rounded border border-subtle text-[9px] font-mono text-text-muted">
                                100% Out of Polygon
                              </span>
                            </div>
                            <div className="space-y-1 text-[11.5px] text-text-muted leading-relaxed font-sans">
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Condition:</strong> An entire survey batch labeled under Subgrid A (e.g. <span className="font-mono text-text-base">N94E70</span>) is physically located 100% inside Subgrid B (e.g. <span className="font-mono text-text-base">N93E70</span>) due to pre-survey folder misnaming or vehicle task configuration.
                              </p>
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Impact:</strong> Origin subgrid displays unearned frames while the physical destination subgrid shows missing progress.
                              </p>
                              <p>
                                <strong className="text-text-base font-mono text-[10.5px]">Action:</strong> Click <strong className="text-text-base font-mono text-[10.5px]">[Reassign]</strong> (or <strong className="text-text-base font-mono text-[10.5px]">[Reassign All Mismatches]</strong>). The batch is re-indexed to its true physical subgrid without renaming photo files.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="pt-3 mt-3 border-t border-subtle flex items-center justify-between shrink-0">
                      <span className="text-[10px] text-text-muted font-mono">
                        360° WebGIS Mobile Mapping Specification
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRulesModal(false)}
                        className="px-3.5 py-1.5 bg-inner hover:bg-inner/80 text-text-base border border-subtle rounded-lg text-xs font-mono cursor-pointer transition-colors"
                      >
                        Close Guide
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoadAnalysisWorkspace;
