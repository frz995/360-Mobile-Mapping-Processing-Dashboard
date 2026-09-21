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
  Share2,
  Search,
  Cuboid,
  X
} from 'lucide-react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { UnderlineTabStrip, StatusDot, type ChromeTab } from './production/chrome';
import {
  MALAYSIA_DISTRICTS,
  DISTRICT_STATES,
  districtsToGeoJSON,
  clipLineStringsToDistrictsWithIds,
  linesLengthKm,
  ensureDistrictGeometriesLoaded,
  isDistrictGeometriesLoaded,
  type MalaysiaDistrict
} from './boundary/malaysiaDistricts';
import { RoadAnalysisMap } from './roadAnalysis/RoadAnalysisMap';
import { RoadImportPanel, type ImportPreview } from './roadAnalysis/RoadImportPanel';
import { RoadAnalysisPrintPanel } from './roadAnalysis/RoadAnalysisPrintPanel';
import { ShareMapDialog } from '../share/ShareMapDialog';
import { buildRoadSnapshot } from '../utils/mapShares';
import { RoadCatalogPanel, RoadAttributeTableDrawer, resolveLayerFeatures, type SystemLayerStyles } from './roadAnalysis/RoadCatalogPanel';
import type { CatalogVectorLayer } from '../utils/gisImportParser';
import {
  saveCatalogLayerGeometries,
  loadCatalogLayerGeometries,
  deleteCatalogLayerGeometry
} from '../utils/catalogGeometryStore';
import { getRoadExtractionAdapter, type ExtractedRoadLine } from '../services/roadExtraction';
import { parseRoadPlanFile, extractLineRunsWithIds } from '../utils/roadPlanParser';
import { extractPanotrackPoints, filterPanotrackByDistricts } from '../utils/panotrackExtractor';
import { pathLengthLngLatKm } from '../utils/geo';
import {
  computeSubgridMetrics,
  type SubgridMetric,
  type SubgridRelationNotice
} from '../utils/subgridComparison';
import { buildTracePlans, finalizeSubgridResult, type SubgridTraceResult, type LonLat } from '../utils/roadNetworkTrace';
import { useCoverageSegmentation } from '../hooks/useCoverageSegmentation';
import type { RoadPlanStitchInput } from '../hooks/useRoadPlanStitcher';
import { extractSubgridName } from '../utils/subgrid';
import {
  saveRoadAnalysisStateToSupabase,
  fetchRoadAnalysisStateFromSupabase,
  fetchSupabaseData,
  type RoadAnalysisProductionState
} from '../services/supabase';
import { getActiveProjectId } from '../services/projectContext';
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
  /** Static red coverage-gap overlay toggle (replaced the animated trace). */
  showCoverage?: boolean;
  manualGeoJson?: any;
  extractedLines?: ExtractedRoadLine[];
  catalogLayers?: CatalogVectorLayer[];
  systemStyles?: SystemLayerStyles;
  planDistanceKm?: number;
  totalSubgrids?: number;
  /** Catalog layer currently promoted to the Option B plan, if any. Persisted so
   *  the Plan Source panel can label the plan "Added from data catalog". */
  catalogPlanLayerId?: string | null;
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
  /** Project id this state belongs to, scoped per-project. */
  projectId?: string;
  /** True when catalog geometry was too large to persist in the local cache. */
  catalogGeometryDropped?: boolean;
}

export const ROAD_ANALYSIS_CACHE_VERSION = 3;

export function getRoadAnalysisStorageKey(userKey: string): string {
  const pid = getActiveProjectId();
  return `geosphere_road_analysis_state_${userKey}${pid ? `_${pid}` : ''}`;
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
    const merged: RoadAnalysisSavedState = {
      ...existing,
      ...state,
      schemaVersion: ROAD_ANALYSIS_CACHE_VERSION,
      lastLocalEditAt,
      savedToCloud: false
    };
    // Guard: a full-country GeoJSON snapshot must never be JSON.stringify'd
    // synchronously on the main thread (freeze) or thrown at the localStorage
    // quota. Oversized catalog geometry is cached WITHOUT its coordinates in
    // localStorage — but its serialized `geojsonJson` bytes are mirrored to
    // IndexedDB (large quota, cheap string writes) so the geometry survives a
    // reload and can be rehydrated back onto the layer at startup.
    const originalLayers = Array.isArray(merged.catalogLayers) ? merged.catalogLayers : undefined;
    const { layers, dropped, totalBytes } = prepareCatalogLayersForPersistence(originalLayers);
    if (Array.isArray(merged.catalogLayers)) {
      merged.catalogLayers = layers;
      merged.catalogGeometryDropped = dropped;
    }
    // Fire-and-forget: never block the paint path on an async DB write.
    saveCatalogLayerGeometries(userKey, originalLayers).catch(() => {});
    if (dropped) {
      console.warn(
        `[RoadAnalysis] Catalog geometry (~${(totalBytes / 1024 / 1024).toFixed(1)} MB) exceeds the localStorage budget; ` +
          'coordinates were mirrored to IndexedDB and remain available after a reload.'
      );
    }
    localStorage.setItem(
      getRoadAnalysisStorageKey(userKey),
      JSON.stringify(merged)
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
 * Approximate serialized-geometry budget for the local cache (bytes).
 * `persistRoadAnalysisCache` stringifies the ENTIRE workspace snapshot on the
 * main thread; letting a full-country road network (tens of MB of GeoJSON) pass
 * through would freeze the UI for seconds and blow the ~5MB localStorage quota
 * anyway. Geometry above the budget is left out of the cached snapshot — the
 * live layer keeps rendering from memory until the page reloads.
 */
export const CATALOG_GEOMETRY_PERSIST_LIMIT_BYTES = 1_500_000;

/**
 * Drops catalog geometry once the combined serialized size of all catalog
 * geojsons exceeds the persistence budget. Layers are kept in full (colors,
 * styling, metadata) but flagged `geometryDropped: true` so the UI can explain
 * why the geometry is missing after a reload.
 */
export function prepareCatalogLayersForPersistence(
  layers: CatalogVectorLayer[] | undefined
): { layers?: CatalogVectorLayer[]; totalBytes: number; dropped: boolean } {
  const source = Array.isArray(layers) ? layers : [];
  let totalBytes = 0;
  for (const l of source) {
    if (l.geometryBytes !== undefined) {
      totalBytes += l.geometryBytes;
      continue;
    }
    if (l.geojson) totalBytes += JSON.stringify(l.geojson).length;
    else if (l.geojsonJson) totalBytes += l.geojsonJson.length * 2;
  }
  if (totalBytes <= CATALOG_GEOMETRY_PERSIST_LIMIT_BYTES) {
    return { layers, totalBytes, dropped: false };
  }
  const stripped = source.map((l) =>
    l.geojson || l.geojsonJson ? { ...l, geojson: undefined, geojsonJson: undefined, geometryDropped: true } : l
  );
  return { layers: stripped, totalBytes, dropped: true };
}

/**
 * Mirrors a successfully cloud-saved snapshot back into the local cache so the
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
        lastLocalEditAt: cloudUpdatedAt || null,
        cloudUpdatedAt: cloudUpdatedAt || null,
        updatedAt: cloudUpdatedAt
      })
    );
    // Mirror heavy layer bytes to IndexedDB too (the localStorage snapshot above
    // strips oversized geometry like persistRoadAnalysisCache does).
    saveCatalogLayerGeometries(userKey, Array.isArray(state.catalogLayers) ? state.catalogLayers : undefined).catch(() => {});
  } catch {
    // ignore quota / serialization errors
  }
}

const TABS: ChromeTab<RoadTab>[] = [
  { key: 'catalog', icon: <Layers size={14} /> },
  { key: 'region', icon: <Map size={14} /> },
  { key: 'plan', icon: <Route size={14} /> },
  { key: 'import', icon: <Upload size={14} /> },
  { key: 'compare', icon: <GitCompare size={14} /> },
  { key: 'allocation', icon: <ArrowRightLeft size={14} /> },
  { key: 'print', icon: <Printer size={14} /> }
];

const TAB_LABEL: Record<RoadTab, string> = {
  catalog: 'Data Catalog',
  region: 'Region',
  plan: 'Plan',
  import: 'Import Data',
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

const EMPTY_COVERAGE_RUNS: LonLat[][] = [];
const EMPTY_STITCH_INPUT: RoadPlanStitchInput = { runs: [], endpointIds: [] };

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

  // Read saved offline snapshot ONCE on mount, avoiding 12 redundant JSON.parse calls of large GeoJSON payloads
  const initialSavedStateRef = useRef<RoadAnalysisSavedState | null>(null);
  if (initialSavedStateRef.current === null) {
    initialSavedStateRef.current = loadRoadAnalysisState(userKey);
  }
  const initialSaved = initialSavedStateRef.current;

  const [activeTab, setActiveTab] = useState<RoadTab>(() => {
    return 'catalog';
  });

  const [selectedStateCode, setSelectedStateCode] = useState<string>(() => {
    return initialSaved?.selectedStateCode || '';
  });

  const [selectedDistrictIds, setSelectedDistrictIds] = useState<string[]>(() => {
    return Array.isArray(initialSaved?.selectedDistrictIds) ? initialSaved.selectedDistrictIds : [];
  });

  const [planSource, setPlanSource] = useState<PlanSource>(() => {
    return initialSaved?.planSource || 'system';
  });

  const [manualGeoJson, setManualGeoJson] = useState<any>(() => {
    return initialSaved?.manualGeoJson || null;
  });

  const [manualError, setManualError] = useState<string>('');
  const [catalogLayers, setCatalogLayers] = useState<CatalogVectorLayer[]>(() => {
    return Array.isArray(initialSaved?.catalogLayers) ? initialSaved.catalogLayers : [];
  });
  const [systemStyles, setSystemStyles] = useState<SystemLayerStyles>(() => {
    return (
      initialSaved?.systemStyles || {
        districtBoundary: { visible: true, color: '#000000', opacity: 1, strokeWidth: 2.5 },
        capturedPoints: { visible: true, opacity: 0.95, pointRadius: 5 },
        roadPlan: { visible: true, color: '#10b981', opacity: 0.85, strokeWidth: 3.5 }
      }
    );
  });
  const [focusBbox, setFocusBbox] = useState<[number, number, number, number] | null>(null);
  const [activePlanName, setActivePlanName] = useState<string>('');
  const [catalogPlanLayerId, setCatalogPlanLayerId] = useState<string | null>(() => {
    return initialSaved?.catalogPlanLayerId || null;
  });
  const [activeTableLayer, setActiveTableLayer] = useState<CatalogVectorLayer | null>(null);
  const [selectedTableFeature, setSelectedTableFeature] = useState<any | null>(null);
  const [, setGeometriesLoaded] = useState(() => isDistrictGeometriesLoaded());
  const [selectedSubgridId, setSelectedSubgridId] = useState<string | null>(null);
  const [showDetailsCard, setShowDetailsCard] = useState<boolean>(true);
  const [subgridSearch, setSubgridSearch] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (activeTableLayer && !catalogLayers.some((l) => l.id === activeTableLayer.id)) {
      setActiveTableLayer(null);
      setSelectedTableFeature(null);
    }
  }, [catalogLayers, activeTableLayer]);

  // Rehydrate heavy catalog-layer geometry from IndexedDB after a reload. The
  // localStorage snapshot strips oversized `geojsonJson` (quota + stringify
  // freeze), so those layers load as `geometryDropped` — this effect pulls the
  // mirrored bytes back and clears the flag, making reloads render as before.
  useEffect(() => {
    let cancelled = false;
    if (!catalogLayers.some((l) => l.geometryDropped)) return;
    loadCatalogLayerGeometries(userKey)
      .then((geometryByLayerId) => {
        if (cancelled || geometryByLayerId.size === 0) return;
        setCatalogLayers((prev) => {
          if (!prev.some((l) => l.geometryDropped)) return prev;
          return prev.map((l) => {
            if (!l.geometryDropped) return l;
            const geojsonJson = geometryByLayerId.get(l.id);
            if (!geojsonJson) return l;
            return { ...l, geojsonJson, geometryDropped: false };
          });
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [catalogLayers, userKey]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeDetailNotice, setActiveDetailNotice] = useState<SubgridRelationNotice | null>(null);
  const [allocationSearch, setAllocationSearch] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState<boolean>(false);
  const [showRulesModal, setShowRulesModal] = useState<boolean>(false);
  const [rulesModalTab, setRulesModalTab] = useState<'rules' | 'scenarios'>('rules');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Live main-map instance (for the Print panel's "Current map extent" mode).
  const liveMapRef = useRef<MaplibreMap | null>(null);
  // Road-coverage segmentation settings. The static red "coverage gap" overlay
  // replaced the animated Road Network Trace but keeps its semantics: a plan
  // stretch with no panotrack within tolerance stays uncovered, and a subgrid
  // is complete when the uncovered share stays at/below threshold.
  const TRACE_TOLERANCE_M = 12;
  const TRACE_THRESHOLD_PCT = 95;
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
    return Array.isArray(initialSaved?.extractedLines) ? initialSaved.extractedLines : [];
  });

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string>('');

  const [showRoadLines, setShowRoadLines] = useState<boolean>(() => {
    return typeof initialSaved?.showRoadLines === 'boolean' ? initialSaved.showRoadLines : true;
  });

  const [showCoverage, setShowCoverage] = useState<boolean>(() => {
    return typeof initialSaved?.showCoverage === 'boolean' ? initialSaved.showCoverage : false;
  });

  const [mapBasemap, setMapBasemap] = useState<string>(() => {
    if (initialSaved?.mapBasemap) return initialSaved.mapBasemap;
    return defaultBasemapKey;
  });

  const [show3D, setShow3D] = useState<boolean>(false);

  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState<boolean>(false);

  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(() => {
    if (initialSaved && initialSaved.savedToCloud === true) {
      return computeRoadAnalysisFingerprint(
        initialSaved.selectedStateCode || '',
        initialSaved.selectedDistrictIds || [],
        initialSaved.planSource || 'system',
        initialSaved.mapBasemap || defaultBasemapKey,
        typeof initialSaved.showRoadLines === 'boolean' ? initialSaved.showRoadLines : true,
        initialSaved.manualGeoJson || null,
        initialSaved.extractedLines || [],
        initialSaved.catalogLayers || [],
        initialSaved.systemStyles
      );
    }
    if (!initialSaved) {
      return computeRoadAnalysisFingerprint(
        '',
        [],
        'system',
        defaultBasemapKey,
        true,
        null,
        [],
        [],
        undefined
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

  // Reflect unsaved-edit state:
  // If the workspace matches the saved fingerprint, there are NO unsaved edits.
  // Otherwise, if fingerprints differ or the local cache holds unpushed edits,
  // flag hasUnsavedEdits = true.
  useEffect(() => {
    if (isSaved) {
      setHasUnsavedEdits(false);
      return;
    }
    const cache = loadRoadAnalysisState(userKey);
    if (!cache) {
      setHasUnsavedEdits(lastSavedFingerprint !== null && currentFingerprint !== lastSavedFingerprint);
      return;
    }
    const localEditAt = cache.lastLocalEditAt ? Date.parse(cache.lastLocalEditAt) : 0;
    const cloudEditAt = cache.cloudUpdatedAt ? Date.parse(cache.cloudUpdatedAt) : 0;
    const dirty =
      cache.savedToCloud === false ||
      (Number.isFinite(localEditAt) && Number.isFinite(cloudEditAt) && localEditAt > cloudEditAt) ||
      (lastSavedFingerprint !== null && currentFingerprint !== lastSavedFingerprint);
    setHasUnsavedEdits(!!dirty);
  }, [
    isSaved,
    userKey,
    refreshTick,
    lastSavedFingerprint,
    currentFingerprint
  ]);

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

      // Per-project isolation (v15): the cloud blob `roadAnalysisState` is a
      // shared project_settings row, so only apply it when it belongs to the
      // currently active project.
      const activePid = getActiveProjectId();
      if (activePid && remoteState.projectId && remoteState.projectId !== activePid) {
        // Only reject if it explicitly belongs to a different project
        return;
      }

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

      if (remoteState.selectedStateCode !== undefined) setSelectedStateCode(remoteState.selectedStateCode);
      if (Array.isArray(remoteState.selectedDistrictIds)) setSelectedDistrictIds(remoteState.selectedDistrictIds);
      if (!preferLocal && remoteState.planSource) setPlanSource(remoteState.planSource);
      if (!preferLocal && remoteState.manualGeoJson !== undefined) setManualGeoJson(remoteState.manualGeoJson);
      if (!preferLocal && remoteState.catalogPlanLayerId) setCatalogPlanLayerId(remoteState.catalogPlanLayerId);
      if (preferLocal && localCache?.catalogPlanLayerId) setCatalogPlanLayerId(localCache.catalogPlanLayerId);
      setExtractedLines(effectiveExtractedLines);
      let chosenCatalogLayers: CatalogVectorLayer[] | undefined = undefined;
      if (Array.isArray(remoteState.catalogLayers) || Array.isArray(localCache?.catalogLayers)) {
        const localLayers = Array.isArray(localCache?.catalogLayers) ? localCache.catalogLayers : undefined;
        const remoteLayers = Array.isArray(remoteState.catalogLayers) ? remoteState.catalogLayers : undefined;
        let chosen = preferLocal && localLayers
          ? localLayers
          : remoteLayers || localLayers || [];
        // The local cache strips oversized geometry (`geometryDropped`). When the
        // cloud snapshot (or a newer local edit) still carries the serialized
        // bytes, graft them back so a reload restores rendering instead of a
        // geometry-less catalog row.
        chosen = chosen.map((l) => {
          if (l.geojson || l.geojsonJson) return l;
          const donor = (remoteLayers || []).concat(localLayers || []).find((o) => o.id === l.id && (o.geojsonJson || o.geojson));
          if (!donor) return l;
          return { ...l, geojson: donor.geojson, geojsonJson: donor.geojsonJson, geometryDropped: false };
        });
        chosenCatalogLayers = chosen;
        setCatalogLayers(chosen);
      }
      if (remoteState.systemStyles) {
        setSystemStyles(preferLocal && localCache?.systemStyles ? localCache.systemStyles : remoteState.systemStyles);
      } else if (localCache?.systemStyles) {
        setSystemStyles(localCache.systemStyles);
      }
      if (typeof remoteState.showRoadLines === 'boolean') setShowRoadLines(remoteState.showRoadLines);
      if (typeof remoteState.showCoverage === 'boolean') setShowCoverage(remoteState.showCoverage);
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

      if (!preferLocal) {
        mirrorRoadAnalysisToCache(userKey, {
          ...remoteState,
          catalogLayers: chosenCatalogLayers || remoteState.catalogLayers,
          extractedLines: effectiveExtractedLines
        });
        setHasUnsavedEdits(false);
      }
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
      if (saved.selectedStateCode !== undefined) setSelectedStateCode(saved.selectedStateCode);
      if (Array.isArray(saved.selectedDistrictIds)) setSelectedDistrictIds(saved.selectedDistrictIds);
      if (saved.planSource) setPlanSource(saved.planSource);
      if (saved.manualGeoJson !== undefined) setManualGeoJson(saved.manualGeoJson);
      if (saved.catalogPlanLayerId) setCatalogPlanLayerId(saved.catalogPlanLayerId);
      if (Array.isArray(saved.extractedLines)) setExtractedLines(saved.extractedLines);
      if (Array.isArray(saved.catalogLayers)) setCatalogLayers(saved.catalogLayers);
      if (saved.systemStyles) setSystemStyles(saved.systemStyles);
      if (typeof saved.showRoadLines === 'boolean') setShowRoadLines(saved.showRoadLines);
      if (typeof saved.showCoverage === 'boolean') setShowCoverage(saved.showCoverage);
      if (saved.mapBasemap) setMapBasemap(saved.mapBasemap);
      if (saved.savedToCloud === true) {
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
        setHasUnsavedEdits(false);
      } else {
        setLastSavedFingerprint(null);
        setHasUnsavedEdits(true);
      }
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
        showCoverage,
        manualGeoJson,
        extractedLines,
        catalogLayers,
        systemStyles,
        catalogPlanLayerId,
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
      showCoverage,
      manualGeoJson,
      extractedLines,
      catalogLayers,
      systemStyles,
      catalogPlanLayerId
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
    if (!value.startsWith('ofm-')) setShow3D(false);
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
    () => clipLineStringsToDistrictsWithIds(extractedLines, selectedDistricts),
    [extractedLines, selectedDistricts]
  );

  const extractedLengthKm = useMemo(() => linesLengthKm(extractedRuns.runs), [extractedRuns]);

  const manualRuns = useMemo(
    () =>
      planSource === 'manual'
        ? extractLineRunsWithIds(manualGeoJson)
        : EMPTY_STITCH_INPUT,
    [planSource, manualGeoJson]
  );

  const roadPlanInput = useMemo(() => {
    if (planSource === 'extracted') return extractedRuns;
    if (planSource === 'manual') return manualRuns;
    return EMPTY_STITCH_INPUT;
  }, [planSource, extractedRuns, manualRuns]);

  // Runs currently used as the active road plan (for map rendering, metrics, and coverage).
  // Kept directly as the exact source line geometry without any geometric stitching,
  // welding, or snapping, so road geometries remain clean and faithful to the source data.
  const activePlanRuns = roadPlanInput.runs;

  // Plan length is measured PER run (each disconnected road segment summed
  // independently). Flattening the runs into one array and measuring
  // consecutive points creates phantom distances between the end of one run
  // and the start of the next, inflating the plan length enormously.
  const planDistanceKm = useMemo(() => {
    if (planSource === 'extracted') return extractedLengthKm;
    if (planSource === 'manual') return linesLengthKm(manualRuns.runs);
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

  // ── Road Network Trace: per-subgrid plan built from dailyData surveys.
  // When a region is selected, the trace walks only subgrids whose captured
  // points are visible; otherwise it spans the entire road analysis network.
  const tracePlans = useMemo(() => {
    const regionSubgrids =
      activeRegionDistricts.length > 0
        ? new Set(
            capturedPoints
              .map((p) => extractSubgridName(p.subgrid))
              .filter(Boolean)
          )
        : undefined;
    return buildTracePlans(internalDailyData, {
      catalogLayers,
      planRuns: activePlanRuns,
      planSourceRuns: roadPlanInput.runs,
      planSourceEndpointIds: roadPlanInput.endpointIds,
      subgridFilter: regionSubgrids
    });
  }, [internalDailyData, catalogLayers, activePlanRuns, roadPlanInput, capturedPoints, activeRegionDistricts]);

  // On-demand road-coverage segmentation. Does NOT auto-run on plan open.
  // Classified on-demand for the active subgrid clicked, or across all subgrids
  // when "Segment all" is explicitly triggered.
  const coverage = useCoverageSegmentation({
    capturedTracks,
    toleranceM: TRACE_TOLERANCE_M
  });

  // Clear coverage when plan source or district selection changes
  const prevCoverageContextRef = useRef<{ planSource: PlanSource; districtsKey: string; userKey: string }>({
    planSource,
    districtsKey: selectedDistrictIds.join(','),
    userKey
  });

  useEffect(() => {
    const districtsKey = selectedDistrictIds.join(',');
    const prev = prevCoverageContextRef.current;
    if (prev.planSource !== planSource || prev.districtsKey !== districtsKey || prev.userKey !== userKey) {
      prevCoverageContextRef.current = { planSource, districtsKey, userKey };
      coverage.clear();
    }
  }, [planSource, selectedDistrictIds, userKey, coverage.clear]);

  // Per-subgrid verdicts populated on-demand as subgrids are segmented.
  const traceVerdictBySubgrid = useMemo(() => {
    const byKey: Record<string, SubgridTraceResult> = {};
    tracePlans.forEach((plan) => {
      const cov = coverage.subgridResults[plan.subgrid];
      if (cov) {
        byKey[plan.subgrid] = finalizeSubgridResult(plan, cov, TRACE_THRESHOLD_PCT);
      }
    });
    return byKey;
  }, [tracePlans, coverage.subgridResults]);

  const selectedSubgridMetric = useMemo(() => {
    if (!selectedSubgridId) return null;
    return subgridMetrics.find((s) => s.subgrid === selectedSubgridId) || null;
  }, [subgridMetrics, selectedSubgridId]);

  const selectedTraceResult = useMemo(() => {
    if (!selectedSubgridId) return null;
    return traceVerdictBySubgrid[selectedSubgridId] || null;
  }, [traceVerdictBySubgrid, selectedSubgridId]);


  const isSegmentAllActive = coverage.activeScope === 'all' && coverage.phase !== 'error';

  // Explicit "Segment all" action across all subgrids with on/off toggle
  const handleToggleSegmentAll = useCallback(() => {
    if (isSegmentAllActive || (coverage.phase === 'running' && coverage.activeScope === 'all')) {
      coverage.clear();
      return;
    }
    if (planSource === 'system' || activePlanRuns.length === 0) return;
    setShowCoverage(true);
    coverage.segmentAll(activePlanRuns, tracePlans);
  }, [isSegmentAllActive, coverage.phase, coverage.activeScope, coverage.clear, planSource, activePlanRuns, tracePlans, coverage.segmentAll]);

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
      showCoverage,
      manualGeoJson,
      extractedLines,
      catalogLayers,
      systemStyles,
      catalogPlanLayerId,
      planDistanceKm: Number(planDistanceKm) || 0,
      totalSubgrids: subgridMetrics.length || 0,
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail,
      projectId: getActiveProjectId() || undefined
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
    catalogPlanLayerId,
    currentFingerprint,
    addNotification,
    addAuditLog
  ]);

  const handleFocusSubgrid = useCallback((sg: SubgridMetric) => {
    setSelectedSubgridId(sg.subgrid);
    if (sg.bbox && (sg.bbox[0] !== 0 || sg.bbox[1] !== 0)) {
      setFocusBbox([...sg.bbox]);
    }
  }, []);

  const handleToggleSegmentSubgrid = useCallback((sg: SubgridMetric) => {
    setSelectedSubgridId(sg.subgrid);
    const isThisSubgridActive = showCoverage && (
      (coverage.activeScope === 'subgrid' && coverage.activeSubgridId === sg.subgrid) ||
      (coverage.activeScope === 'all' && selectedSubgridId === sg.subgrid)
    );
    if (isThisSubgridActive) {
      setShowCoverage(false);
      return;
    }
    const plan = tracePlans.find((p) => p.subgrid === sg.subgrid);
    if (plan && plan.planRuns.length > 0) {
      coverage.segmentSubgrid(sg.subgrid, plan.planRuns);
      setShowCoverage(true);
    }
  }, [selectedSubgridId, showCoverage, coverage.activeScope, coverage.activeSubgridId, tracePlans, coverage.segmentSubgrid]);

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
    const plan = tracePlans.find((p) => p.subgrid === sgId);
    if (plan && plan.planRuns.length > 0) {
      coverage.segmentSubgrid(sgId, plan.planRuns);
      setShowCoverage(true);
    }
    setTimeout(() => {
      const el = document.getElementById(`subgrid-card-${sgId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);
  }, [tracePlans, coverage.segmentSubgrid]);

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
      const clipped = clipLineStringsToDistrictsWithIds(result.lines, selectedDistricts);
      const clippedLines: ExtractedRoadLine[] = clipped.runs.map((run, i) => ({
        id: `clip-${i}`,
        coordinates: run,
        highway: 'extracted',
        startNode:
          typeof clipped.endpointIds[i]?.start === 'number'
            ? (clipped.endpointIds[i].start as number)
            : undefined,
        endNode:
          typeof clipped.endpointIds[i]?.end === 'number'
            ? (clipped.endpointIds[i].end as number)
            : undefined
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
        extractedLines: clippedLines,
        catalogPlanLayerId
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
  }, [regionGeo, selectedDistricts, userKey, activeTab, selectedStateCode, selectedDistrictIds, mapBasemap, manualGeoJson, catalogPlanLayerId]);

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
      setCatalogPlanLayerId(null);
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
        extractedLines,
        catalogPlanLayerId: null
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
        setCatalogPlanLayerId(null);
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
        extractedLines: nextExtracted,
        catalogPlanLayerId: target === 'manual' ? null : catalogPlanLayerId
      });
      setHasUnsavedEdits(true);
    },
    [userKey, extractedLines, manualGeoJson, planSource, selectedStateCode, selectedDistrictIds, mapBasemap, catalogPlanLayerId]
  );

  // Live Original-vs-Clipped overlay while the Import tab reviews an oversized file.
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const handleImportPreviewChange = useCallback(
    (preview: ImportPreview | null) => setImportPreview(preview),
    []
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
          systemStyles,
          catalogPlanLayerId
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
      catalogPlanLayerId,
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
          systemStyles,
          catalogPlanLayerId
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
      systemStyles,
      catalogPlanLayerId
    ]
  );

  const handleRemoveCatalogLayer = useCallback(
    (layerId: string) => {
      setActiveTableLayer((prev) => (prev?.id === layerId ? null : prev));
      if (catalogPlanLayerId === layerId) setCatalogPlanLayerId(null);
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
          systemStyles,
          catalogPlanLayerId: catalogPlanLayerId === layerId ? null : catalogPlanLayerId
        });
        deleteCatalogLayerGeometry(userKey, layerId).catch(() => {});
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
      systemStyles,
      catalogPlanLayerId
    ]
  );

  const handleZoomToLayer = useCallback((bbox: [number, number, number, number]) => {
    setFocusBbox([...bbox]);
  }, []);

  const handleSetAsActivePlan = useCallback(
    (layer: CatalogVectorLayer) => {
      // If already active as the manual plan baseline, toggle it off back to system
      const isCurrentlyActive =
        planSource === 'manual' &&
        (catalogPlanLayerId === layer.id || activePlanName === layer.name);

      if (isCurrentlyActive) {
        setManualGeoJson(null);
        setPlanSource('system');
        setActivePlanName('');
        setCatalogPlanLayerId(null);
        persistRoadAnalysisCache(userKey, {
          activeTab,
          selectedStateCode,
          selectedDistrictIds,
          planSource: 'system',
          mapBasemap,
          showRoadLines,
          manualGeoJson: null,
          extractedLines,
          catalogLayers,
          systemStyles,
          catalogPlanLayerId: null
        });
        setHasUnsavedEdits(true);
        addNotification?.({
          id: `plan-active-${Date.now()}`,
          title: 'Road Plan Baseline Deactivated',
          message: `Reverted road comparison baseline to system default.`,
          category: 'INFO',
          read: false
        });
        return;
      }

      // Heavy imported layers carry only serialized `geojsonJson` (no `.geojson`).
      // Resolve whichever geometry is present so the promotion works for both.
      const sourceGeoJson =
        layer.geojson || resolveLayerFeatures(layer)?.geojson;
      if (!sourceGeoJson) return;
      // Keep only the LineString runs: the plan rendering + distance math only
      // need lines, and a compact payload persists within the localStorage budget
      // instead of re-serializing multi-MB full feature geometry. Start/end node
      // ids found on the source (OSM node refs / GIS node fields) are kept on
      // each feature so the identity-based stitching pass survives persistence.
      const { runs, endpointIds } = extractLineRunsWithIds(sourceGeoJson);
      const compactPlan = {
        type: 'FeatureCollection' as const,
        features: runs
          .filter((r) => r.length >= 2)
          .map((coords, i) => {
            const ids = endpointIds[i] || {};
            const properties: Record<string, unknown> = {};
            if (ids.start != null) properties.startNode = ids.start;
            if (ids.end != null) properties.endNode = ids.end;
            return {
              type: 'Feature',
              properties,
              geometry: { type: 'LineString', coordinates: coords }
            };
          }),
        _extracted: { runs, endpointIds }
      };
      if (compactPlan.features.length === 0) return;
      setManualGeoJson(compactPlan);
      setPlanSource('manual');
      setShowRoadLines(true);
      setActivePlanName(layer.name);
      setCatalogPlanLayerId(layer.id);
      setHasUnsavedEdits(true);
      // Defer serialization off the immediate click frame so the map paints instantly
      setTimeout(() => {
        persistRoadAnalysisCache(userKey, {
          activeTab,
          selectedStateCode,
          selectedDistrictIds,
          planSource: 'manual',
          mapBasemap,
          showRoadLines: true,
          manualGeoJson: compactPlan,
          extractedLines,
          catalogLayers,
          systemStyles,
          catalogPlanLayerId: layer.id
        });
      }, 50);
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
      showRoadLines,
      planSource,
      catalogPlanLayerId,
      activePlanName,
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
            {!isGuestUser && (
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-inner border border-subtle text-[11px] font-semibold text-text-base hover:text-sky-400 transition-colors cursor-pointer shrink-0"
                title="Create a public read-only share link for this road analysis map"
              >
                <Share2 size={13} />
                <span>Share Map</span>
              </button>
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

        <ShareMapDialog
          open={shareOpen}
          kind="road"
          defaultTitle={`${projectSettings?.projectName || 'GeoSphere 360'} — Road Analysis Map`}
          buildSnapshot={() => {
            if (extractedLines.length === 0) {
              throw new Error('Nothing to share yet — extract road lines (or Save State) before creating the link.');
            }
            return buildRoadSnapshot(extractedLines, { planName: activePlanName, projectSettings });
          }}
          basemap={defaultBasemapKey}
          createdBy={authSession?.user?.id || null}
          onClose={() => setShareOpen(false)}
        />

        {/* Unsaved local edits notice */}
        {hasUnsavedEdits && !isSaved && (
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
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col flex-1 min-h-fit md:min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card shrink-0">
            <UnderlineTabStrip tabs={TABS} active={activeTab} onChange={setActiveTab} tabLabel={(k) => TAB_LABEL[k]} />
          </div>

          <div className="flex flex-col lg:flex-row flex-1 min-h-0">
            <aside className="w-full lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-divider overflow-y-auto p-3 flex flex-col gap-3 bg-app/40 max-h-[38vh] md:max-h-[42vh] lg:max-h-none">
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
                              {extractedRuns.runs.length} road segment(s) · {extractedLengthKm.toFixed(2)} km
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
                              {catalogPlanLayerId
                                ? `Added from data catalog — ${activePlanName || catalogLayers.find((l) => l.id === catalogPlanLayerId)?.name || 'catalog layer'}`
                                : manualFileMeta
                                  ? `${manualFileMeta.filename} (${manualFileMeta.format})`
                                  : 'Road-plan LineString loaded'}
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
                  districtsGeo={regionGeo?.geojson ?? null}
                  onPreviewChange={handleImportPreviewChange}
                />
              )}

              {activeTab === 'catalog' && (
                <RoadCatalogPanel
                  catalogLayers={catalogLayers}
                  dailyData={internalDailyData}
                  batchLogs={internalBatchLogs}
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
                  planSource={planSource}
                  activePlanName={planSource === 'manual' ? activePlanName : ''}
                  catalogPlanLayerId={planSource === 'manual' ? catalogPlanLayerId : null}
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
                        {/* Header: Title and Count */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="text-[9px] uppercase tracking-widest text-text-muted font-bold">
                            By Subgrid Comparison (5×5 km)
                          </div>
                          <span className="text-[10px] text-text-muted font-mono font-medium shrink-0">
                            {filteredSubgridMetrics.length}
                            {filteredSubgridMetrics.length !== subgridMetrics.length ? ` of ${subgridMetrics.length}` : ''}{' '}
                            subgrid{subgridMetrics.length === 1 ? '' : 's'}
                          </span>
                        </div>

                        {/* Controls Bar: Filter pills on left, Actions on right */}
                        <div className="flex items-center justify-between gap-1.5 mb-2">
                          {/* Filter: All vs Active in Data Management (Text only, no box) */}
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setShowActiveOnly(false)}
                              className={`inline-flex items-center gap-1.5 text-[10px] font-mono cursor-pointer transition-colors ${
                                !showActiveOnly
                                  ? 'text-sky-400 font-bold'
                                  : 'text-text-muted hover:text-text-base'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  !showActiveOnly ? 'bg-sky-400' : 'bg-text-muted/60'
                                }`}
                              />
                              <span>All ({subgridMetrics.length})</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowActiveOnly(true)}
                              className={`inline-flex items-center gap-1.5 text-[10px] font-mono cursor-pointer transition-colors ${
                                showActiveOnly
                                  ? 'text-sky-400 font-bold'
                                  : 'text-text-muted hover:text-text-base'
                              }`}
                              title="Show only subgrids with active data available in Data Management"
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  showActiveOnly ? 'bg-sky-400' : 'bg-text-muted/60'
                                }`}
                              />
                              <span>Active ({activeSubgridsCount})</span>
                            </button>
                          </div>

                          {/* Actions: Segment all (Text button, no box) */}
                          {activePlanRuns.length > 0 && (
                            <div className="inline-flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={handleToggleSegmentAll}
                                className={`inline-flex items-center gap-1.5 text-[10px] font-mono cursor-pointer transition-colors ${
                                  isSegmentAllActive
                                    ? 'text-sky-400 font-bold'
                                    : 'text-text-muted hover:text-text-base'
                                }`}
                                title={
                                  isSegmentAllActive
                                    ? 'Click to turn off segmentation across all subgrids'
                                    : 'Segment all subgrids in the district against panotrack coverage'
                                }
                              >
                                {(isSegmentAllActive || (coverage.phase === 'running' && coverage.activeScope === 'all')) && (
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      coverage.phase === 'running' && coverage.activeScope === 'all'
                                        ? 'bg-sky-400 animate-pulse'
                                        : 'bg-sky-400'
                                    }`}
                                  />
                                )}
                                <span>Segment all</span>
                              </button>
                            </div>
                          )}
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

                        <div className="divide-y divide-subtle/40 max-h-[380px] overflow-y-auto pr-0.5">
                          {filteredSubgridMetrics.length === 0 ? (
                            <p className="text-[10px] text-text-muted py-1.5">
                              No subgrids found in this area.
                            </p>
                          ) : (
                            filteredSubgridMetrics.map((sg) => {
                              const isSelected = selectedSubgridId === sg.subgrid;
                              const traceResult = traceVerdictBySubgrid[sg.subgrid];
                              const hasPlan = sg.planKm > 0 || (!!traceResult && traceResult.status !== 'no-plan');
                              const isSubgridSegmentActive = showCoverage && (
                                (coverage.activeScope === 'subgrid' && coverage.activeSubgridId === sg.subgrid) ||
                                (coverage.activeScope === 'all' && isSelected)
                              );
                              const isSubgridRunning = coverage.phase === 'running' && (
                                coverage.activeSubgridId === sg.subgrid || (coverage.activeScope === 'all' && isSelected)
                              );
                              return (
                                <div
                                  key={sg.subgrid}
                                  id={`subgrid-card-${sg.subgrid}`}
                                  onClick={() => handleFocusSubgrid(sg)}
                                  className={`py-2.5 px-1.5 transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-sky-500/5 border-l-2 border-sky-400 pl-2'
                                      : 'hover:bg-white/[0.02]'
                                  }`}
                                >
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="font-mono font-bold text-xs text-text-base tracking-wide">
                                        {sg.subgrid}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleFocusSubgrid(sg);
                                        }}
                                        className="text-[10px] text-text-muted hover:text-text-base cursor-pointer underline decoration-dotted"
                                        title={`Focus map to 5×5 km extent of ${sg.subgrid}`}
                                      >
                                        Focus 5×5 km
                                      </button>
                                      {hasPlan && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleSegmentSubgrid(sg);
                                          }}
                                          className={`inline-flex items-center gap-1.5 text-[10px] font-mono cursor-pointer transition-colors ${
                                            isSubgridSegmentActive || isSubgridRunning
                                              ? 'text-sky-400 font-bold'
                                              : 'text-text-muted hover:text-text-base'
                                          }`}
                                          title={
                                            isSubgridSegmentActive
                                              ? `Click to hide coverage gaps of ${sg.subgrid}`
                                              : `Segment coverage for ${sg.subgrid}`
                                          }
                                        >
                                          {(isSubgridSegmentActive || isSubgridRunning) && (
                                            <span
                                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                                isSubgridRunning ? 'bg-sky-400 animate-pulse' : 'bg-sky-400'
                                              }`}
                                            />
                                          )}
                                          <span>{isSubgridRunning ? 'Segmenting…' : isSubgridSegmentActive ? 'Gaps' : 'Segment'}</span>
                                        </button>
                                      )}
                                    </div>
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
                                  if (sgMetric) handleFocusSubgrid(sgMetric);
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
                className="flex-1 min-h-0 max-md:min-h-[52vh] relative"
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

                  <button
                    type="button"
                    onClick={() => {
                      if (show3D) {
                        setShow3D(false);
                      } else {
                        if (!mapBasemap.startsWith('ofm-')) {
                          setMapBasemap('ofm-positron');
                          persistSnapshot({ mapBasemap: 'ofm-positron' });
                          setHasUnsavedEdits(true);
                        }
                        setShow3D(true);
                      }
                    }}
                    style={{
                      backgroundColor: show3D ? 'rgba(56, 189, 248, 0.18)' : 'var(--bg-inner)',
                      borderColor: show3D ? 'rgba(56, 189, 248, 0.45)' : 'var(--border-subtle)',
                      color: show3D ? 'var(--sky, #38bdf8)' : 'var(--text-muted)'
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer hover:border-sky-400/50"
                    title={show3D ? '3D Buildings: ON (back to 2D)' : '3D Buildings: OFF (smoothly tilt to 3D surface view)'}
                  >
                    <Cuboid size={13} className="shrink-0" />
                    {show3D ? '3D' : '2D'}
                  </button>
                </div>

                {/* Top-Right Floating Details Card (System Design, No Colored Text Box) */}
                {showDetailsCard ? (
                  <div
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                      boxShadow: 'var(--card-shadow)',
                      color: 'var(--text-primary)'
                    }}
                    className="absolute top-3 right-3 z-[1000] w-72 rounded-xl border backdrop-blur-md shadow-lg p-3 text-xs flex flex-col gap-2 transition-all animate-in fade-in duration-200"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between pb-1.5 border-b border-subtle/50">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Route size={13} className="shrink-0 text-text-muted" />
                        <span className="font-semibold text-xs text-text-base truncate">
                          {selectedSubgridMetric ? selectedSubgridMetric.subgrid : 'Road Analysis Details'}
                        </span>
                        {selectedSubgridMetric && (
                          <span className="text-[10px] text-text-muted font-normal">Subgrid</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {selectedSubgridMetric && (
                          <button
                            type="button"
                            onClick={() => setSelectedSubgridId(null)}
                            className="text-[10px] text-text-muted hover:text-text-base cursor-pointer px-1 py-0.5 rounded hover:bg-inner transition-colors"
                            title="Clear selection and view overview"
                          >
                            Overview
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowDetailsCard(false)}
                          className="p-1 rounded text-text-muted hover:text-text-base hover:bg-inner transition-colors cursor-pointer"
                          title="Minimize details card"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Body */}
                    {selectedSubgridMetric ? (
                      <div className="space-y-1.5 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Status</span>
                          <span className="font-semibold text-text-base flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                selectedTraceResult?.status === 'complete'
                                  ? 'bg-emerald-400'
                                  : selectedTraceResult
                                    ? 'bg-rose-400'
                                    : 'bg-slate-400'
                              }`}
                            />
                            {selectedTraceResult?.status === 'complete'
                              ? 'Complete'
                              : selectedTraceResult
                                ? 'Incomplete'
                                : (selectedSubgridMetric.planKm > 0 ? 'Not Analyzed' : 'No Plan')}
                          </span>
                        </div>

                        {selectedTraceResult && (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-text-muted">Coverage</span>
                              <span className="font-semibold text-text-base font-mono">
                                {selectedTraceResult.coveredPct != null
                                  ? `${selectedTraceResult.coveredPct.toFixed(1)}%`
                                  : selectedTraceResult.tracedPct != null
                                    ? `${selectedTraceResult.tracedPct.toFixed(1)}%`
                                    : '—'}
                              </span>
                            </div>
                            {selectedTraceResult.tracedKm != null && selectedTraceResult.tracedKm > 0 && (
                              <div className="flex items-center justify-between">
                                <span className="text-text-muted">Uncovered gaps</span>
                                <span className="font-semibold text-rose-400 font-mono">
                                  {selectedTraceResult.tracedKm.toFixed(2)} km
                                </span>
                              </div>
                            )}
                          </>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Plan length</span>
                          <span className="font-semibold text-text-base font-mono">
                            {selectedSubgridMetric.planKm.toFixed(2)} km
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Captured length</span>
                          <span className="font-semibold text-text-base font-mono">
                            {selectedSubgridMetric.masterlistKm.toFixed(2)} km
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Captured / Plan</span>
                          <span className="font-semibold text-text-base font-mono">
                            {selectedSubgridMetric.completionRatio ?? '—'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Remaining to capture</span>
                          <span className="font-semibold text-text-base font-mono">
                            {selectedSubgridMetric.remainingKm.toFixed(2)} km
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Survey points</span>
                          <span className="font-semibold text-text-base font-mono">
                            {selectedSubgridMetric.pointsCount.toLocaleString()}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Survey tracks</span>
                          <span className="font-semibold text-text-base font-mono">
                            {selectedSubgridMetric.tracksCount.toLocaleString()}
                          </span>
                        </div>

                        {/* Actions */}
                        {selectedSubgridMetric.planKm > 0 && (
                          <div className="pt-2 border-t border-subtle/40">
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedSubgridMetric) {
                                  handleToggleSegmentSubgrid(selectedSubgridMetric);
                                }
                              }}
                              className={`w-full py-1.5 px-2 rounded-lg border text-[11px] font-medium text-center cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                                showCoverage && selectedTraceResult
                                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                                  : 'bg-inner hover:bg-inner/80 border-subtle text-text-base'
                              }`}
                            >
                              <Route size={12} className="shrink-0" />
                              <span>{showCoverage && selectedTraceResult ? 'Hide Gaps' : 'Show Gaps'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Region</span>
                          <span className="font-semibold text-text-base truncate max-w-[140px]" title={selectedDistrictsList.map((d) => d.name).join(', ')}>
                            {selectedDistrictsList.map((d) => d.name).join(', ') || 'None'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Plan source</span>
                          <span className="font-semibold text-text-base truncate max-w-[140px]">
                            {planSource === 'extracted'
                              ? 'OSM Extracted'
                              : planSource === 'manual'
                                ? (activePlanName || 'Manual GeoJSON')
                                : 'None'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Total plan</span>
                          <span className="font-semibold text-text-base font-mono">
                            {planDistanceKm > 0 ? `${planDistanceKm.toFixed(2)} km` : '—'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Total captured</span>
                          <span className="font-semibold text-text-base font-mono">
                            {capturedDistanceKm > 0 ? `${capturedDistanceKm.toFixed(2)} km` : '—'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Captured / Plan</span>
                          <span className="font-semibold text-text-base font-mono">
                            {ratio ?? '—'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Active subgrids</span>
                          <span className="font-semibold text-text-base font-mono">
                            {activeSubgridsCount} / {subgridMetrics.length}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-text-muted">Total survey points</span>
                          <span className="font-semibold text-text-base font-mono">
                            {capturedPoints.length.toLocaleString()}
                          </span>
                        </div>

                        <div className="pt-1.5 border-t border-subtle/40 text-[10px] text-text-muted text-center">
                          Click any subgrid in the list to inspect its details.
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDetailsCard(true)}
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                      boxShadow: 'var(--card-shadow)',
                      color: 'var(--text-primary)'
                    }}
                    className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border backdrop-blur-md shadow-lg text-[11px] font-semibold cursor-pointer hover:border-sky-400/50 transition-colors"
                    title="Show Details Card"
                  >
                    <Route size={12} className="text-text-muted" />
                    Details
                  </button>
                )}

                <RoadAnalysisMap
                  active
                  showRoadLines={showRoadLines}
                  showCoverage={showCoverage}
                  show3D={show3D}
                  style={mapStyle}
                  bbox={regionGeo?.bbox ?? null}
                  districtGeojson={regionGeo?.geojson}
                  dimmedRegionsGeojson={dimmedRegionsGeojson}
                  capturedPoints={capturedPoints}
                  roadRuns={activePlanRuns}
                  coverageRuns={showCoverage && coverage.coverage ? coverage.coverage.uncoveredRuns : EMPTY_COVERAGE_RUNS}
                  catalogLayers={catalogLayers}
                  catalogPreview={importPreview}
                  systemStyles={systemStyles}
                  focusBbox={focusBbox}
                  selectedFeature={selectedTableFeature}
                  onSelectSubgrid={handleSelectSubgrid}
                  mapInstanceRef={liveMapRef}
                />

                {/* Coverage segmentation progress popup: dims + blurs the live map
                    while the worker classifies large plan networks against panotrack. */}
                {coverage.phase === 'running' && (
                  <div className="absolute inset-0 z-[1001] flex items-center justify-center bg-black/45 backdrop-blur-sm animate-in fade-in duration-150">
                    <div
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                        boxShadow: 'var(--card-shadow)',
                        color: 'var(--text-primary)'
                      }}
                      className="rounded-xl border shadow-2xl px-5 py-4 flex items-center gap-3"
                    >
                      <Loader2 size={16} className="text-sky-400 animate-spin shrink-0" />
                      <div className="min-w-[200px]">
                        <div className="text-[11px] font-bold font-mono text-text-base">
                          Segmenting road coverage…
                        </div>
                        <div className="text-[10px] text-text-muted mt-0.5 font-mono">
                          {coverage.progress
                            ? `${Math.round((coverage.progress.done / Math.max(1, coverage.progress.total)) * 100)}% · ${coverage.progress.done.toLocaleString()} / ${coverage.progress.total.toLocaleString()} plan roads analyzed`
                            : 'Analyzing panotrack vs road plan…'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Panotrack Operational Status Legend */}
                {capturedPoints.length > 0 && (
                  <div
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                      boxShadow: 'var(--card-shadow)',
                      color: 'var(--text-primary)'
                    }}
                    className="absolute bottom-3 right-3 lg:bottom-6 lg:right-6 z-[1000] flex flex-wrap items-center gap-x-3 gap-y-1 max-w-[92%] px-3 py-1.5 rounded-xl border backdrop-blur-md shadow-lg text-[11px] font-medium animate-in fade-in duration-200"
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
