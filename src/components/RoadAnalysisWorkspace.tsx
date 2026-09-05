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
  GitCompare
} from 'lucide-react';
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
import { RoadCatalogPanel, RoadAttributeTableDrawer, type SystemLayerStyles } from './roadAnalysis/RoadCatalogPanel';
import type { CatalogVectorLayer } from '../utils/gisImportParser';
import { getRoadExtractionAdapter, type ExtractedRoadLine } from '../services/roadExtraction';
import { parseRoadPlanFile, extractLineRuns } from '../utils/roadPlanParser';
import { extractPanotrackPoints, filterPanotrackByDistricts } from '../utils/panotrackExtractor';
import { pathLengthLngLatKm } from '../utils/geo';
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

type RoadTab = 'region' | 'plan' | 'import' | 'catalog' | 'compare';
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
  { key: 'compare', icon: <GitCompare size={14} /> }
];

const TAB_LABEL: Record<RoadTab, string> = {
  region: 'Region',
  plan: 'Plan',
  import: 'Import Data',
  catalog: 'Data Catalog',
  compare: 'Compare'
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
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (activeTableLayer && !catalogLayers.some((l) => l.id === activeTableLayer.id)) {
      setActiveTableLayer(null);
      setSelectedTableFeature(null);
    }
  }, [catalogLayers, activeTableLayer]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  }, [userKey, refreshTick, extractedLines, planSource, manualGeoJson, catalogLayers, systemStyles]);

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
        message: `Configuration saved to Supabase (State: ${selectedStateCode || 'All'}, Districts: ${selectedDistrictIds.length}, Basemap: ${mapBasemap}, Plan: ${planSource}).`,
        category: 'SUCCESS',
        read: false
      });

      addAuditLog?.(
        'EDIT',
        'Road Analysis State Saved',
        `Region ${selectedStateCode || 'N/A'} (${selectedDistrictIds.length} districts), basemap ${mapBasemap}, plan ${planSource} saved by ${userEmail}`,
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
    userKey,
    currentFingerprint,
    addNotification,
    addAuditLog
  ]);

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

  const capturedDistanceKm = useMemo(() => {
    if (capturedTracks.length > 0) {
      return capturedTracks.reduce((sum, trk) => sum + pathLengthLngLatKm(trk), 0);
    }
    return pathLengthLngLatKm(capturedCoords);
  }, [capturedTracks, capturedCoords]);

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
                                onClick={() => { setPlanSource('extracted'); setShowRoadLines(true); }}
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
                                onClick={() => { setPlanSource('manual'); setShowRoadLines(true); }}
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
                  onUpdateSystemStyles={setSystemStyles}
                  onUpdateCatalogLayer={handleUpdateCatalogLayer}
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
                      {/* Actual — system-derived baseline */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Actual captured points</span>
                        <span className="font-semibold text-text-base">{capturedPoints.length.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-muted">Actual captured tracks</span>
                        <span className="font-semibold text-text-base">
                          {capturedTracks.length > 0 ? capturedTracks.length.toLocaleString() : (capturedPoints.length > 0 ? '1' : '0')}
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
                    </>
                  )}
                </>
              )}
            </aside>

            <div className="flex-1 min-w-0 bg-app overflow-hidden relative flex flex-col">
              {/* Main Map View Area */}
              <div className="flex-1 min-h-0 relative overflow-hidden">
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
                      onChange={(e) => setMapBasemap(e.target.value)}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoadAnalysisWorkspace;
