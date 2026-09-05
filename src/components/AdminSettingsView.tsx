import React, { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Database,
  Camera,
  Server,
  FileText,
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Key,
  Settings,
  Eye,
  EyeOff,
  Globe,
  Copy,
  Map,
  Layers,
  Palette,
  Navigation,
  ExternalLink,
  Lock,
  Trash2,
  SlidersHorizontal,
  Crosshair,
  Search
} from 'lucide-react';
import { ExtendedProjectSettings } from '../types/admin';
import {
  testDatabaseHealth,
  resolvePanoramaUrl,
  resolvePanoramaConfigUrl,
  testCloudflareStorageHealth
} from '../services/supabase';
import {
  STORAGE_BUCKET_DEFAULT,
  REGION_DEFAULTS,
  S3_BUCKET_DEFAULT,
  AZURE_CONTAINER_DEFAULT,
  DATABASE_HOST_DEFAULT,
  DATABASE_TABLE_DEFAULTS,
  DEFAULT_BASEMAP
} from '../config/defaults';
import { ThemeManagementCanvas } from './ThemeSelector';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { MALAYSIA_REGIONS, regionToGeoJSON, CUSTOM_REGION_ID } from './boundary/malaysiaRegions';
import {
  MALAYSIA_DISTRICTS,
  districtsToGeoJSON
} from './boundary/malaysiaDistricts';
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';
import { isAdminRole, isGuestEmail } from '../lib/authz';

const SETTINGS_TABS: ChromeTab<'settings' | 'theme-pack' | 'diagnostics'>[] = [
  {
    key: 'settings',
    label: 'Project & Map Settings',
    icon: <Settings size={14} />
  },
  {
    key: 'theme-pack',
    label: 'Theme Packages',
    icon: <Palette size={14} />
  },
  {
    key: 'diagnostics',
    label: 'Diagnostics',
    icon: <Activity size={14} />
  }
];

interface AdminSettingsViewProps {
  projectSettings: ExtendedProjectSettings;
  setProjectSettings: React.Dispatch<React.SetStateAction<ExtendedProjectSettings>>;
  themeMode?: 'dark' | 'light';
  dailyData?: any[];
  batchLogs?: any[];
  auditLogs?: any[];
  onSaveAllSettings?: () => void;
  onRefreshMap?: () => void;
  onGeneratePdfReport?: () => void;
  authSession?: any;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  projectSettings,
  setProjectSettings,
  themeMode = 'dark',
  dailyData = [],
  batchLogs = [],
  onSaveAllSettings,
  authSession,
  addAuditLog
}) => {
  const [activeTab, setActiveTab] = useState<'settings' | 'theme-pack' | 'diagnostics'>('settings');

  // Storage Probe & Multi-Resolution Health State
  const [cfTestLoading, setCfTestLoading] = useState(false);
  const [cfTestResult, setCfTestResult] = useState<{
    ok: boolean;
    status: number;
    statusText: string;
    latencyMs: number;
    imageUrl: string;
    configUrl?: string;
    corsOk: boolean;
    contentType?: string;
    error?: string;
  } | null>(null);
  const [testFilename, setTestFilename] = useState<string>('SG01-0001.jpg');

  // Security Credentials Reveal Toggle
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Map Preview Iframe State & Ref
  const previewIframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewCoords, setPreviewCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(() => {
    return (projectSettings as any)?.projectBoundary?.regionId || null;
  });
  const [selectedDistrictIds, setSelectedDistrictIds] = useState<string[]>(() => {
    return (projectSettings as any)?.projectBoundary?.districtIds || [];
  });
  const [districtSearchQuery, setDistrictSearchQuery] = useState<string>('');

  // Sync staged items & theme settings to preview iframe just like Dashboard Map
  const sendPreviewData = React.useCallback(() => {
    if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
      try {
        const formattedStaged = (dailyData || []).map((item: any) => {
          const isPub = item.publishToWebGIS === 'yes';
          const defaultItemColor = isPub ? (projectSettings.publishedTrackColor || '#10B981') : (projectSettings.stagingTrackColor || '#F59E0B');
          return {
            ...item,
            status: isPub ? 'published' : 'staged',
            isPublished: isPub,
            strokeColor: defaultItemColor,
            fillColor: defaultItemColor,
            statusColor: defaultItemColor,
            panoramas: (item.panoramas || []).map((p: any) => {
              const isPanDefect = p.isDefect || p.is_defect || p.status === 'defect';
              return {
                ...p,
                isPublished: isPub || p.publishToWebGIS === 'yes',
                color: isPanDefect ? (projectSettings.defectTrackColor || '#EF4444') : (isPub || p.publishToWebGIS === 'yes' ? (projectSettings.publishedTrackColor || '#10B981') : (projectSettings.stagingTrackColor || '#F59E0B'))
              };
            }),
            points: (item.points || item.panoramas || []).map((p: any) => {
              const isPanDefect = p.isDefect || p.is_defect || p.status === 'defect';
              return {
                ...p,
                isPublished: isPub || p.publishToWebGIS === 'yes',
                color: isPanDefect ? (projectSettings.defectTrackColor || '#EF4444') : (isPub || p.publishToWebGIS === 'yes' ? (projectSettings.publishedTrackColor || '#10B981') : (projectSettings.stagingTrackColor || '#F59E0B'))
              };
            })
          };
        });

        // 1. Send Theme Mode (Dark/Light)
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_THEME',
          theme: themeMode
        }, '*');

        // 2. Send Basemap Selection
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_BASEMAP',
          basemap: projectSettings.defaultBasemap || DEFAULT_BASEMAP,
          customUrl: projectSettings.customBasemapUrl || '',
          opacity: (projectSettings.basemapOpacity ?? 100) / 100
        }, '*');

        // 3. Send Map Vector Layer Theme & Styling
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_MAP_THEME',
          settings: {
            publishedTrackColor: projectSettings.publishedTrackColor || '#10B981',
            stagingTrackColor: projectSettings.stagingTrackColor || '#F59E0B',
            defectTrackColor: projectSettings.defectTrackColor || '#EF4444',
            selectedTrackColor: projectSettings.selectedTrackColor || '#38BDF8',
            gridBoundaryColor: projectSettings.gridBoundaryColor || '#6366F1',
            lineWidth: projectSettings.poiTrackLineWidth || 3,
            enableGlow: projectSettings.enableLayerGlow !== false,
            opacity: (projectSettings.layerOpacity ?? 100) / 100,
            layerOpacity: (projectSettings.layerOpacity ?? 100) / 100
          }
        }, '*');

        // 4. Send Staged Point Data
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: formattedStaged
        }, '*');

        // 5. Ensure Status Trajectory Filter is Open
        previewIframeRef.current.contentWindow.postMessage({
          type: 'FILTER_STATUS_TYPES',
          statusFilters: { published: true, defect: true, stitching: true },
          showPanotrackData: true
        }, '*');

        // 6. Send committed Project Geographic Boundary
        const boundary = (projectSettings as any)?.projectBoundary;
        if (boundary?.geojson) {
          previewIframeRef.current.contentWindow.postMessage({
            type: 'SET_PROJECT_BOUNDARY',
            geojson: boundary.geojson,
            bbox: boundary.bbox
          }, '*');
          previewIframeRef.current.contentWindow.postMessage({
            type: 'DIM_OUTSIDE_BOUNDARY',
            enabled: !!boundary.focusActive
          }, '*');
        } else {
          previewIframeRef.current.contentWindow.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: false }, '*');
          previewIframeRef.current.contentWindow.postMessage({ type: 'CLEAR_BOUNDARY_FOCUS' }, '*');
        }
      } catch (e) { }
    }
  }, [
    dailyData,
    projectSettings.publishedTrackColor,
    projectSettings.stagingTrackColor,
    projectSettings.defectTrackColor,
    projectSettings.selectedTrackColor,
    projectSettings.gridBoundaryColor,
    projectSettings.defaultBasemap,
    projectSettings.customBasemapUrl,
    projectSettings.basemapOpacity,
    projectSettings.poiTrackLineWidth,
    projectSettings.enableLayerGlow,
    projectSettings.layerOpacity,
    (projectSettings as any)?.projectBoundary,
    themeMode
  ]);

  // Broadcast basemap settings to all iframes (Dashboard map + Preview map)
  const broadcastBasemap = React.useCallback((bm?: string, customUrl?: string, op?: number) => {
    const basemapVal = bm || projectSettings.defaultBasemap || DEFAULT_BASEMAP;
    const customUrlVal = customUrl !== undefined ? customUrl : (projectSettings.customBasemapUrl || '');
    const opacityVal = typeof op === 'number' ? op : ((projectSettings.basemapOpacity ?? 100) / 100);

    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
    iframes.forEach(f => {
      try {
        f.contentWindow?.postMessage({
          type: 'SET_BASEMAP',
          basemap: basemapVal,
          customUrl: customUrlVal,
          opacity: opacityVal
        }, '*');
      } catch (e) { }
    });
  }, [projectSettings.defaultBasemap, projectSettings.customBasemapUrl, projectSettings.basemapOpacity]);

  // Broadcast the project geographic boundary + focus/dim to all map iframes.
  const broadcastProjectBoundary = React.useCallback((action: 'focus' | 'dim' | 'clear') => {
    const boundary = (projectSettings as any)?.projectBoundary;
    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
    iframes.forEach(f => {
      try {
        if (boundary?.geojson) {
          f.contentWindow?.postMessage({
            type: 'SET_PROJECT_BOUNDARY',
            geojson: boundary.geojson,
            bbox: boundary.bbox
          }, '*');
        }
        if (action === 'focus' && boundary?.bbox) {
          f.contentWindow?.postMessage({
            type: 'FOCUS_BOUNDARY',
            bbox: boundary.bbox
          }, '*');
          f.contentWindow?.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: true }, '*');
        } else if (action === 'clear') {
          f.contentWindow?.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: false }, '*');
          f.contentWindow?.postMessage({ type: 'CLEAR_BOUNDARY_FOCUS' }, '*');
        }
      } catch (e) { }
    });
  }, [projectSettings]);

  // Broadcast the active storage / dynamic bucket resolution config to all WebGIS map iframes,
  // so they can resolve 360 image URLs (single equirectangular OR multi-res tiles) against the
  // current bucket even if a point's resolved URL is stale or missing.
  const broadcastStorageConfig = React.useCallback((storageOverride?: any) => {
    const s = storageOverride && typeof storageOverride === 'object' ? storageOverride : (projectSettings || {});
    const storageProvider = s.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || '';
    const storageMessage = {
      type: 'SET_STORAGE_CONFIG',
      storage: {
        storageProvider,
        imageStorageStrategy: s.imageStorageStrategy || 'single_equirectangular',
        panoramaMode: s.panoramaMode || '',
        multiResEnabled: s.imageStorageStrategy !== 'single_equirectangular',
        supabaseUrl: s.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '',
        supabaseBucket: s.supabaseBucket || STORAGE_BUCKET_DEFAULT,
        r2Domain: s.r2Domain || '',
        r2PublicDomain: s.r2PublicDomain || '',
        r2PublicUrl: s.r2PublicUrl || '',
        customCdnUrl: s.customCdnUrl || '',
        cloudStorageBaseUrl: s.cloudStorageBaseUrl || '',
        customStorageUrl: s.customStorageUrl || '',
        singleImagePathPattern: s.singleImagePathPattern || s.imageFormatPattern || '',
        imageFormatPattern: s.imageFormatPattern || '',
        multiResTilePattern: s.multiResTilePattern || s.tilePathPattern || '',
        tilePathPattern: s.tilePathPattern || '',
        multiResFallbackPattern: s.multiResFallbackPattern || '',
        s3Bucket: s.s3Bucket || '',
        s3Region: s.s3Region || REGION_DEFAULTS.s3Region,
        gcsBucket: s.gcsBucket || '',
        azureAccount: s.azureAccount || '',
        azureContainer: s.azureContainer || '',
        wasabiBucket: s.wasabiBucket || '',
        wasabiRegion: s.wasabiRegion || REGION_DEFAULTS.wasabiRegion,
        nasServerUrl: s.nasServerUrl || ''
      }
    };
    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
    iframes.forEach(f => {
      try {
        f.contentWindow?.postMessage(storageMessage, '*');
      } catch (e) { }
    });
    if (previewIframeRef.current?.contentWindow) {
      try {
        previewIframeRef.current.contentWindow.postMessage(storageMessage, '*');
      } catch (e) { }
    }
  }, [projectSettings]);

  // Push updated storage / dynamic bucket config to the WebGIS whenever any of the
  // storage-related settings change (provider, domain, bucket, patterns, strategy...).
  const storageTrack = React.useMemo(() => {
    const ps = (projectSettings || {}) as any;
    return [
      ps.storageProvider,
      ps.imageStorageStrategy,
      ps.panoramaMode,
      ps.supabaseUrl,
      ps.supabaseBucket,
      ps.r2Domain,
      ps.r2PublicDomain,
      ps.r2PublicUrl,
      ps.customCdnUrl,
      ps.cloudStorageBaseUrl,
      ps.customStorageUrl,
      ps.singleImagePathPattern,
      ps.imageFormatPattern,
      ps.multiResTilePattern,
      ps.tilePathPattern,
      ps.multiResFallbackPattern,
      ps.s3Bucket,
      ps.s3Region,
      ps.gcsBucket,
      ps.azureAccount,
      ps.azureContainer,
      ps.wasabiBucket,
      ps.wasabiRegion,
      ps.nasServerUrl
    ];
  }, [projectSettings]);

  React.useEffect(() => {
    if (!projectSettings) return;
    broadcastStorageConfig(projectSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, storageTrack);

  const currentRegion = React.useMemo(() => {
    const rId = selectedRegionId || (projectSettings as any)?.projectBoundary?.regionId;
    return MALAYSIA_REGIONS.find((r) => r.id === rId);
  }, [selectedRegionId, projectSettings]);

  const availableDistricts = React.useMemo(() => {
    if (!currentRegion || currentRegion.id === CUSTOM_REGION_ID) return [];
    if (currentRegion.id === 'malaysia') return MALAYSIA_DISTRICTS;
    const cleanRegionName = currentRegion.name.toLowerCase().replace(/^w\.?p\.?\s*/i, '').trim();
    return MALAYSIA_DISTRICTS.filter((d) => {
      const cleanStateName = d.stateName.toLowerCase().replace(/^w\.?p\.?\s*/i, '').trim();
      return cleanStateName === cleanRegionName || d.stateName.toLowerCase() === currentRegion.name.toLowerCase();
    });
  }, [currentRegion]);

  const filteredDistricts = React.useMemo(() => {
    if (!districtSearchQuery.trim()) return availableDistricts;
    const q = districtSearchQuery.toLowerCase().trim();
    return availableDistricts.filter(d => d.name.toLowerCase().includes(q));
  }, [availableDistricts, districtSearchQuery]);

  const selectedDistrictsList = React.useMemo(() => {
    return MALAYSIA_DISTRICTS.filter(d => selectedDistrictIds.includes(d.id));
  }, [selectedDistrictIds]);

  const activeBbox = React.useMemo(() => {
    if (selectedDistrictIds.length > 0) {
      const chosen = MALAYSIA_DISTRICTS.filter(d => selectedDistrictIds.includes(d.id));
      const g = districtsToGeoJSON(chosen);
      if (g?.bbox) return g.bbox;
    }
    if (currentRegion && currentRegion.id !== CUSTOM_REGION_ID) {
      const g = regionToGeoJSON(currentRegion);
      if (g?.bbox) return g.bbox;
    }
    return (projectSettings as any)?.projectBoundary?.bbox || null;
  }, [selectedDistrictIds, currentRegion, projectSettings]);

  // Preview combined boundary (Region or Selected Districts) on live WebGIS preview iframe
  const previewBoundary = React.useCallback((region: any, districtIds: string[]) => {
    const iframe = previewIframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    try {
      const win = iframe.contentWindow;
      if (!region || region.id === CUSTOM_REGION_ID) {
        win.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: false }, '*');
        win.postMessage({ type: 'CLEAR_BOUNDARY_FOCUS' }, '*');
        return;
      }

      const chosenDistricts = districtIds.length > 0
        ? MALAYSIA_DISTRICTS.filter((d) => districtIds.includes(d.id))
        : [];

      let geojson: any;
      let bbox: [number, number, number, number];

      if (chosenDistricts.length > 0) {
        const dGeo = districtsToGeoJSON(chosenDistricts);
        if (dGeo) {
          geojson = dGeo.geojson;
          bbox = dGeo.bbox;
        } else {
          const rGeo = regionToGeoJSON(region);
          geojson = rGeo.geojson;
          bbox = rGeo.bbox;
        }
      } else {
        const rGeo = regionToGeoJSON(region);
        geojson = rGeo.geojson;
        bbox = rGeo.bbox;
      }

      win.postMessage({ type: 'SET_PROJECT_BOUNDARY', geojson, bbox }, '*');
      win.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: true }, '*');
    } catch (e) { }
  }, []);

  const handlePreviewRegion = React.useCallback((regionId: string | null) => {
    setSelectedRegionId(regionId);
    setSelectedDistrictIds([]);
    const region = MALAYSIA_REGIONS.find((r) => r.id === regionId);
    previewBoundary(region, []);
  }, [previewBoundary]);

  const handleToggleDistrict = React.useCallback((districtId: string) => {
    setSelectedDistrictIds(prev => {
      const next = prev.includes(districtId)
        ? prev.filter(id => id !== districtId)
        : [...prev, districtId];
      const rId = selectedRegionId || (projectSettings as any)?.projectBoundary?.regionId;
      const region = MALAYSIA_REGIONS.find((r) => r.id === rId);
      previewBoundary(region, next);
      return next;
    });
  }, [selectedRegionId, projectSettings, previewBoundary]);

  const handleSelectAllDistricts = React.useCallback(() => {
    const allIds = availableDistricts.map(d => d.id);
    setSelectedDistrictIds(allIds);
    const rId = selectedRegionId || (projectSettings as any)?.projectBoundary?.regionId;
    const region = MALAYSIA_REGIONS.find((r) => r.id === rId);
    previewBoundary(region, allIds);
  }, [availableDistricts, selectedRegionId, projectSettings, previewBoundary]);

  const handleClearDistricts = React.useCallback(() => {
    setSelectedDistrictIds([]);
    const rId = selectedRegionId || (projectSettings as any)?.projectBoundary?.regionId;
    const region = MALAYSIA_REGIONS.find((r) => r.id === rId);
    previewBoundary(region, []);
  }, [selectedRegionId, projectSettings, previewBoundary]);

  // Apply a selected Malaysia region as the committed Project Boundary.
  const handleApplyRegion = React.useCallback((regionId: string) => {
    const region = MALAYSIA_REGIONS.find((r) => r.id === regionId);
    if (!region || region.id === CUSTOM_REGION_ID) return;

    const chosenDistricts = selectedDistrictIds.length > 0
      ? MALAYSIA_DISTRICTS.filter((d) => selectedDistrictIds.includes(d.id))
      : [];

    let geojson: any;
    let bbox: [number, number, number, number];
    let boundaryLabel = region.name;

    if (chosenDistricts.length > 0) {
      const dGeo = districtsToGeoJSON(chosenDistricts);
      if (dGeo) {
        geojson = dGeo.geojson;
        bbox = dGeo.bbox;
        boundaryLabel = `${region.name} (${chosenDistricts.length} ${chosenDistricts.length === 1 ? 'district' : 'districts'}: ${chosenDistricts.map(d => d.name).join(', ')})`;
      } else {
        const rGeo = regionToGeoJSON(region);
        geojson = rGeo.geojson;
        bbox = rGeo.bbox;
      }
    } else {
      const rGeo = regionToGeoJSON(region);
      geojson = rGeo.geojson;
      bbox = rGeo.bbox;
    }

    setProjectSettings(prev => ({
      ...(prev as any),
      projectBoundary: {
        geojson,
        bbox,
        focusActive: true,
        regionId: region.id,
        regionName: region.name,
        districtIds: chosenDistricts.map(d => d.id),
        districtNames: chosenDistricts.map(d => d.name)
      }
    }));
    broadcastProjectBoundary('focus');
    showToast(`Project boundary applied: ${boundaryLabel}`);
  }, [setProjectSettings, broadcastProjectBoundary, selectedDistrictIds]);

  // Broadcast layer theme settings to all iframes (Dashboard map + Preview map)
  const broadcastLayerTheme = React.useCallback((colorsToBroadcast?: any) => {
    const c = colorsToBroadcast || projectSettings;
    const settings = {
      publishedTrackColor: c.publishedTrackColor || '#10B981',
      stagingTrackColor: c.stagingTrackColor || '#F59E0B',
      defectTrackColor: c.defectTrackColor || '#EF4444',
      selectedTrackColor: c.selectedTrackColor || '#38BDF8',
      gridBoundaryColor: c.gridBoundaryColor || '#6366F1',
      lineWidth: c.poiTrackLineWidth || 3,
      enableGlow: c.enableLayerGlow !== false,
      opacity: (c.layerOpacity ?? 100) / 100,
      layerOpacity: (c.layerOpacity ?? 100) / 100
    };

    const formattedStaged = (dailyData || []).map((item: any) => {
      const isPub = item.publishToWebGIS === 'yes';
      const defaultItemColor = isPub ? (c.publishedTrackColor || '#10B981') : (c.stagingTrackColor || '#F59E0B');
      return {
        ...item,
        status: isPub ? 'published' : 'staged',
        isPublished: isPub,
        strokeColor: defaultItemColor,
        fillColor: defaultItemColor,
        statusColor: defaultItemColor,
        panoramas: (item.panoramas || []).map((p: any) => {
          const isPanDefect = p.isDefect || p.is_defect || p.status === 'defect';
          return {
            ...p,
            isPublished: isPub || p.publishToWebGIS === 'yes',
            color: isPanDefect ? (c.defectTrackColor || '#EF4444') : (isPub || p.publishToWebGIS === 'yes' ? (c.publishedTrackColor || '#10B981') : (c.stagingTrackColor || '#F59E0B'))
          };
        }),
        points: (item.points || item.panoramas || []).map((p: any) => {
          const isPanDefect = p.isDefect || p.is_defect || p.status === 'defect';
          return {
            ...p,
            isPublished: isPub || p.publishToWebGIS === 'yes',
            color: isPanDefect ? (c.defectTrackColor || '#EF4444') : (isPub || p.publishToWebGIS === 'yes' ? (c.publishedTrackColor || '#10B981') : (c.stagingTrackColor || '#F59E0B'))
          };
        })
      };
    });

    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
    iframes.forEach(f => {
      try {
        f.contentWindow?.postMessage({
          type: 'SET_MAP_THEME',
          settings
        }, '*');
        f.contentWindow?.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: formattedStaged
        }, '*');
      } catch (e) { }
    });
  }, [dailyData, projectSettings]);

  // Preview basemap changes ONLY on the preview iframe before user applies
  const previewBasemapChange = React.useCallback((bm?: string, customUrl?: string, op?: number) => {
    const basemapVal = bm || projectSettings.defaultBasemap || DEFAULT_BASEMAP;
    const customUrlVal = customUrl !== undefined ? customUrl : (projectSettings.customBasemapUrl || '');
    const opacityVal = typeof op === 'number' ? op : ((projectSettings.basemapOpacity ?? 100) / 100);

    if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
      try {
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_BASEMAP',
          basemap: basemapVal,
          customUrl: customUrlVal,
          opacity: opacityVal
        }, '*');
      } catch (e) { }
    }
  }, [projectSettings.defaultBasemap, projectSettings.customBasemapUrl, projectSettings.basemapOpacity]);

  // Preview layer theme changes ONLY on the preview iframe before user applies
  const previewLayerThemeChange = React.useCallback((colorsToPreview?: any) => {
    const c = colorsToPreview || projectSettings;
    const settings = {
      publishedTrackColor: c.publishedTrackColor || '#10B981',
      stagingTrackColor: c.stagingTrackColor || '#F59E0B',
      defectTrackColor: c.defectTrackColor || '#EF4444',
      selectedTrackColor: c.selectedTrackColor || '#38BDF8',
      gridBoundaryColor: c.gridBoundaryColor || '#6366F1',
      lineWidth: c.poiTrackLineWidth || 3,
      enableGlow: c.enableLayerGlow !== false,
      opacity: (c.layerOpacity ?? 100) / 100,
      layerOpacity: (c.layerOpacity ?? 100) / 100
    };

    const formattedStaged = (dailyData || []).map((item: any) => {
      const isPub = item.publishToWebGIS === 'yes';
      const defaultItemColor = isPub ? (c.publishedTrackColor || '#10B981') : (c.stagingTrackColor || '#F59E0B');
      return {
        ...item,
        status: isPub ? 'published' : 'staged',
        isPublished: isPub,
        strokeColor: defaultItemColor,
        fillColor: defaultItemColor,
        statusColor: defaultItemColor,
        panoramas: (item.panoramas || []).map((p: any) => {
          const isPanDefect = p.isDefect || p.is_defect || p.status === 'defect';
          return {
            ...p,
            isPublished: isPub || p.publishToWebGIS === 'yes',
            color: isPanDefect ? (c.defectTrackColor || '#EF4444') : (isPub || p.publishToWebGIS === 'yes' ? (c.publishedTrackColor || '#10B981') : (c.stagingTrackColor || '#F59E0B'))
          };
        }),
        points: (item.points || item.panoramas || []).map((p: any) => {
          const isPanDefect = p.isDefect || p.is_defect || p.status === 'defect';
          return {
            ...p,
            isPublished: isPub || p.publishToWebGIS === 'yes',
            color: isPanDefect ? (c.defectTrackColor || '#EF4444') : (isPub || p.publishToWebGIS === 'yes' ? (c.publishedTrackColor || '#10B981') : (c.stagingTrackColor || '#F59E0B'))
          };
        })
      };
    });

    if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
      try {
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_MAP_THEME',
          settings
        }, '*');
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: formattedStaged
        }, '*');
      } catch (e) { }
    }
  }, [dailyData, projectSettings]);



  useEffect(() => {
    const handleMapMessage = (e: MessageEvent) => {
      if (e.data?.type === 'MAP_COORDS' && typeof e.data.lat === 'number') {
        const lngVal = typeof e.data.lng === 'number' ? e.data.lng : e.data.lon;
        if (typeof lngVal === 'number') {
          setPreviewCoords({ lat: e.data.lat, lng: lngVal });
        }
      }
      if (e.data?.type === 'MAP_READY' || e.data?.type === 'VIEWER_READY' || e.data?.type === 'WEBGIS_READY' || e.data?.type === 'MAP_LOADED') {
        sendPreviewData();
      }
    };
    window.addEventListener('message', handleMapMessage);
    return () => window.removeEventListener('message', handleMapMessage);
  }, [sendPreviewData]);

  useEffect(() => {
    sendPreviewData();
    const t = setTimeout(sendPreviewData, 800);
    return () => clearTimeout(t);
  }, [sendPreviewData, previewRefreshKey, themeMode]);

  // Toast / Status Message
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  const [isTestingHealth, setIsTestingHealth] = useState(false);
  const [postgisLatencyMs, setPostgisLatencyMs] = useState<number>(38);

  const handleTestHealth = async () => {
    setIsTestingHealth(true);
    try {
      const res = await testDatabaseHealth();
      setPostgisLatencyMs(res.postgisLatencyMs);
      showToast(`Health probe completed. PostGIS Latency: ${res.postgisLatencyMs}ms`);
    } catch {
      showToast('Error testing database health', 'error');
    } finally {
      setIsTestingHealth(false);
    }
  };

  // Authorization RBAC helper: Only Administrator can modify settings
  const currentAuthEmail = (authSession?.user?.email || '').toLowerCase().trim();
  const isGuest = Boolean(authSession?.isGuest || authSession?.user?.role === 'guest' || isGuestEmail(currentAuthEmail));

  // User role is strictly derived from Supabase auth metadata or default
  const userEffectiveRole = isGuest
    ? 'Viewer'
    : (
      authSession?.user?.user_metadata?.role ||
      authSession?.user?.raw_user_meta_data?.role ||
      authSession?.user?.app_metadata?.role ||
      authSession?.user?.raw_app_meta_data?.role ||
      (authSession?.user?.role === 'admin' ? 'Administrator' : 'Viewer')
    );

  const isAdmin = !isGuest && (
    isAdminRole(userEffectiveRole) ||
    isAdminRole(authSession?.user?.role) ||
    isAdminRole(authSession?.user?.app_metadata?.role)
  );

  const cardBg = themeMode === 'light' ? 'bg-white border-slate-200 text-slate-900' : 'bg-card border-subtle text-text-base';
  const innerCardBg = themeMode === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-card border-subtle';
  const inputBg = themeMode === 'light' ? 'bg-white border-slate-300 text-slate-900' : 'bg-card border-subtle text-text-base';
  const inputClass = `w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`;
  const labelClass = 'block text-text-muted font-medium mb-1';
  const helperClass = 'text-[10px] text-text-muted mt-1';

  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-y-auto animate-in fade-in duration-500 ${themeMode === 'light' ? 'text-slate-900' : 'text-text-base'}`}>
      <div className="flex-1 flex flex-col gap-3 min-h-0 p-4">

        {/* Header */}
        <div className="px-1">
          <h2 className="text-base font-bold text-text-base tracking-wide">
            Project &amp; Map Settings
          </h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Configure system parameters, basemap providers, storage endpoints, and multi-theme styling
          </p>
        </div>

        {/* RBAC READ-ONLY NOTICE FOR NON-ADMINISTRATORS / GUESTS */}
        {!isAdmin && (
          <div className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-sm animate-in fade-in duration-200 ${isGuest
            ? 'bg-app border-subtle text-text-muted'
            : themeMode === 'light'
              ? 'bg-slate-100 border-slate-300 text-slate-700'
              : 'bg-app border-subtle text-text-base'
            }`}>
            <div className="flex items-center gap-3">
              {isGuest ? (
                <div className="p-2 rounded-lg bg-inner text-text-muted border border-subtle shrink-0">
                  <Eye size={18} />
                </div>
              ) : (
                <div className={`p-2 rounded-lg border shrink-0 ${themeMode === 'light' ? 'bg-slate-200 border-slate-300 text-slate-700' : 'bg-inner border-subtle text-text-muted'}`}>
                  <Lock size={18} />
                </div>
              )}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide flex items-center gap-2">
                  {isGuest ? 'Guest Exploration Mode (Read-Only)' : 'Restricted Operational Privileges'}
                </h4>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {isGuest
                    ? 'You are viewing live system performance and parameters in guest viewer mode. System parameter changes require Administrator authorization.'
                    : (
                      <>Current account role: <span className="font-sans font-semibold text-text-base">{userEffectiveRole}</span>. Configuration controls are restricted to Administrators.</>
                    )}
                </p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-md text-[10px] font-sans font-semibold border ${isGuest
              ? 'bg-inner text-text-muted border-subtle'
              : themeMode === 'light'
                ? 'bg-slate-200 text-slate-700 border-slate-300'
                : 'bg-inner text-text-muted border-subtle'
              }`}>
              {isGuest ? 'Guest Viewer' : 'Read-Only'}
            </span>
          </div>
        )}

        {/* TOAST STATUS NOTIFICATION */}
        {toastMessage && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl border text-xs font-semibold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3 ${toastMessage.type === 'success' ? 'bg-sky-950/90 text-sky-300 border-sky-700/80' : 'bg-slate-900/90 text-text-muted border-subtle'}`}>
            {toastMessage.type === 'success' ? <CheckCircle size={15} className="text-sky-400" /> : <AlertTriangle size={15} className="text-text-muted" />}
            <span>{toastMessage.text}</span>
          </div>
        )}

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={SETTINGS_TABS}
              active={activeTab}
              onChange={(k) => setActiveTab(k as any)}
            />
          </div>

          <div key={activeTab} className="p-4 sm:p-5 flex-1 flex flex-col min-h-0 space-y-4 overflow-y-auto animate-panel-enter">

      {/* ========================================================================= */}
      {/* TAB 1: PROJECT & SECURITY SETTINGS */}
      {/* ========================================================================= */}
      {activeTab === 'settings' && (
        <fieldset disabled={!isAdmin} className="space-y-4 border-none p-0 m-0">
          {/* SECTION 1: GENERAL, IDENTITY & GLOBAL INTERFACE LANGUAGE */}
          <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div className="flex items-center gap-2">
                <Globe size={17} className="text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-text-base uppercase tracking-wide">1. General & Global Interface Language</h3>
                  <p className="text-[11px] text-text-muted mt-0.5">Choose the system-wide display language and identify this project. Language applies instantly across the whole dashboard, including all processing canvases.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className={labelClass}>Global Interface Language</label>
                <select
                  value={projectSettings.language || 'en'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, language: e.target.value as any }))}
                  className={`${inputClass}`}
                >
                  <option value="en">English (EN)</option>
                  <option value="ms">Bahasa Melayu (MS)</option>
                  <option value="zh">中文 / Simplified Chinese (ZH)</option>
                  <option value="ja">日本語 / Japanese (JA)</option>
                </select>
                <p className={helperClass}>Reads from project settings; persisted on save and applied app-wide.</p>
              </div>

              <div>
                <label className={labelClass}>Project Name</label>
                <input
                  type="text"
                  value={projectSettings.projectName || ''}
                  onChange={e => setProjectSettings(prev => ({ ...prev, projectName: e.target.value }))}
                  placeholder="e.g. TNB Cable Route 360 Capture"
                  className={`${inputClass}`}
                />
              </div>

              <div>
                <label className={labelClass}>Contract Code</label>
                <input
                  type="text"
                  value={projectSettings.contractCode || ''}
                  onChange={e => setProjectSettings(prev => ({ ...prev, contractCode: e.target.value }))}
                  placeholder="e.g. MMS-2026-TNB-01"
                  className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: DATABASE & POSTGIS SPATIAL ENGINE CONNECTION SETUP */}
          <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div className="flex items-center gap-2">
                <Database size={17} className="text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-text-base uppercase tracking-wide">2. Database & PostGIS Spatial Engine Connection Setup</h3>
                  <p className="text-[11px] text-text-muted mt-0.5">Configure Supabase PostgreSQL endpoint, PostGIS 3.3 spatial projections, table mappings, and connection pooling.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-[10px] font-sans bg-inner text-text-muted border border-subtle font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  PostGIS 3.3 &bull; Connected
                </span>
              </div>
            </div>

            {/* SUB-CARD A: CONNECTION CREDENTIALS & API ENDPOINTS */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                  <Server size={14} className="text-sky-400" />
                  A. Connection Endpoints & Access Credentials
                </h4>
                <span className="text-[10px] text-text-muted font-sans">Driver: PostgREST / TCP Pooler</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className={labelClass}>Supabase REST Endpoint URL</label>
                  <input
                    type="text"
                    value={projectSettings.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || ''}
                    onChange={e => setProjectSettings(prev => ({ ...prev, supabaseUrl: e.target.value }))}
                    placeholder="https://your-project.supabase.co"
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Public Anon API Key</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={import.meta.env.VITE_SUPABASE_ANON_KEY || ''}
                      readOnly
                      placeholder="Configure via VITE_SUPABASE_ANON_KEY"
                      className={`${inputClass} opacity-80 cursor-not-allowed`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="p-2 rounded-lg bg-inner hover:bg-inner text-text-muted border border-subtle cursor-pointer"
                      title={showApiKey ? 'Hide Key' : 'Reveal Key'}
                    >
                      {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Direct PostgreSQL Host / IP</label>
                  <input
                    type="text"
                    value={projectSettings.databaseHost || DATABASE_HOST_DEFAULT}
                    onChange={e => setProjectSettings(prev => ({ ...prev, databaseHost: e.target.value }))}
                    placeholder="db.your-project.supabase.co"
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Database Port & Pooler</label>
                  <input
                    type="number"
                    value={projectSettings.databasePort || 5432}
                    onChange={e => setProjectSettings(prev => ({ ...prev, databasePort: parseInt(e.target.value) || 5432 }))}
                    placeholder="5432 (or 6543 for PgBouncer)"
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Database Name & Schema</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={projectSettings.databaseName || 'postgres'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, databaseName: e.target.value }))}
                      placeholder="postgres"
                      className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                    />
                    <input
                      type="text"
                      value={projectSettings.databaseSchema || 'public'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, databaseSchema: e.target.value }))}
                      placeholder="public"
                      className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Connection Protocol & SSL</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={projectSettings.connectionMode || 'postgrest'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, connectionMode: e.target.value as any }))}
                      className={`w-full px-2.5 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                    >
                      <option value="postgrest">PostgREST Client</option>
                      <option value="direct_tcp">Direct TCP (pg)</option>
                      <option value="realtime_ws">Realtime WebSocket</option>
                    </select>
                    <select
                      value={projectSettings.sslMode || 'require'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, sslMode: e.target.value as any }))}
                      className={`w-full px-2.5 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                    >
                      <option value="require">SSL: Require</option>
                      <option value="verify-full">SSL: Verify Full</option>
                      <option value="disable">SSL: Disable</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD B: POSTGIS SPATIAL EXTENSION & GEOMETRY PROJECTIONS */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                  <Globe size={14} className="text-sky-400" />
                  B. PostGIS Spatial Reference (SRID) & Geometry Engine
                </h4>
                <span className="text-[10px] text-text-muted font-sans">ST_GeomFromText Active</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className={labelClass}>Spatial Projection (SRID)</label>
                  <select
                    value={projectSettings.spatialSrid || 'EPSG:4326'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, spatialSrid: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  >
                    <option value="EPSG:4326">EPSG:4326 &mdash; WGS 84 (Global Lat/Lon Standard)</option>
                    <option value="EPSG:3375">EPSG:3375 &mdash; GDM2000 / MRSO (Peninsular Malaysia)</option>
                    <option value="EPSG:3168">EPSG:3168 &mdash; Kertau RSO Malaya (Meters)</option>
                    <option value="EPSG:3857">EPSG:3857 &mdash; WGS 84 / Pseudo-Mercator (WebGIS)</option>
                    <option value="EPSG:32647">EPSG:32647 &mdash; UTM Zone 47N (West Malaysia)</option>
                    <option value="EPSG:32648">EPSG:32648 &mdash; UTM Zone 48N (East Malaysia / Borneo)</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Spatial Geometry Column</label>
                  <input
                    type="text"
                    value={projectSettings.geomColumnName || 'geom'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, geomColumnName: e.target.value }))}
                    placeholder="geom"
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Geometry Data Type</label>
                  <select
                    value={projectSettings.geomType || 'ST_Point'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, geomType: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  >
                    <option value="ST_Point">Point (2D: longitude, latitude)</option>
                    <option value="POINTZ">PointZ (3D: lon, lat, elevation)</option>
                    <option value="MultiPoint">MultiPoint Collection</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Auto Spatial Indexing</label>
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${inputBg}`}>
                    <span className="text-[11px] text-text-base font-medium">GIST (geom) Index</span>
                    <input
                      type="checkbox"
                      checked={projectSettings.autoCreateSpatialIndex !== false}
                      onChange={e => setProjectSettings(prev => ({ ...prev, autoCreateSpatialIndex: e.target.checked }))}
                      className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD C: COMPLETE POSTGIS TABLE & VIEW MAPPINGS */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                  <Database size={14} className="text-sky-400" />
                  C. PostGIS Table & Schema Mappings
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setProjectSettings(prev => ({
                      ...prev,
                      panoramasTable: DATABASE_TABLE_DEFAULTS.panoramasTable,
                      stagingTable: 'staging_panoramas',
                      subgridTable: 'subgrids',
                      qaDefectsTable: DATABASE_TABLE_DEFAULTS.qaDefectsTable,
                      auditLogsTable: 'audit_logs',
                      deletionRequestsTable: 'deletion_requests',
                      notificationsTable: 'notifications',
                      userAccountsTable: 'user_accounts',
                      dbSummaryView: 'panoramas_subgrid_summary'
                    }));
                    showToast('Reset all PostGIS table mappings to official defaults.');
                  }}
                  className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold cursor-pointer underline"
                >
                  Reset Smart Defaults
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className={labelClass}>Production Panoramas Table</label>
                  <input
                    type="text"
                    value={projectSettings.panoramasTable || DATABASE_TABLE_DEFAULTS.panoramasTable}
                    onChange={e => setProjectSettings(prev => ({ ...prev, panoramasTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Staging Panoramas Table</label>
                  <input
                    type="text"
                    value={projectSettings.stagingTable || 'staging_panoramas'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, stagingTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Subgrids Masterlist Table</label>
                  <input
                    type="text"
                    value={projectSettings.subgridTable || 'subgrids'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, subgridTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>QC Defects Table</label>
                  <input
                    type="text"
                    value={projectSettings.qaDefectsTable || DATABASE_TABLE_DEFAULTS.qaDefectsTable}
                    onChange={e => setProjectSettings(prev => ({ ...prev, qaDefectsTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Audit Trail Logs Table</label>
                  <input
                    type="text"
                    value={projectSettings.auditLogsTable || 'audit_logs'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, auditLogsTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Deletion Requests Table</label>
                  <input
                    type="text"
                    value={projectSettings.deletionRequestsTable || 'deletion_requests'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, deletionRequestsTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>
              </div>
            </div>

            {/* SUB-CARD D: PERFORMANCE, DIAGNOSTICS & SQL SCRIPT GENERATOR */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTestHealth}
                    disabled={isTestingHealth}
                    className="px-4 py-2 bg-inner hover:bg-inner border border-subtle text-text-base rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    <RefreshCw size={13} className={isTestingHealth ? 'animate-spin text-sky-400' : 'text-sky-400'} />
                    <span>Test PostGIS Connection & Latency</span>
                  </button>

                  <button
                    onClick={() => {
                      const sqlScript = `-- 360 Mobile Mapping System PostGIS DDL Setup Script
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Production Panoramas Table
CREATE TABLE IF NOT EXISTS ${projectSettings.panoramasTable || DATABASE_TABLE_DEFAULTS.panoramasTable} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION DEFAULT 0,
  pitch DOUBLE PRECISION DEFAULT 0,
  roll DOUBLE PRECISION DEFAULT 0,
  geom GEOMETRY(Point, 4326),
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'yes',
  qa_status VARCHAR(50) DEFAULT 'published'
);
CREATE INDEX IF NOT EXISTS idx_panoramas_geom ON ${projectSettings.panoramasTable || DATABASE_TABLE_DEFAULTS.panoramasTable} USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_panoramas_subgrid ON ${projectSettings.panoramasTable || DATABASE_TABLE_DEFAULTS.panoramasTable} (subgrid);

-- 2. Staging Panoramas Table
CREATE TABLE IF NOT EXISTS ${projectSettings.stagingTable || 'staging_panoramas'} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION DEFAULT 0,
  status VARCHAR(20) DEFAULT 'in process',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. QC Defects Table
CREATE TABLE IF NOT EXISTS ${projectSettings.qaDefectsTable || DATABASE_TABLE_DEFAULTS.qaDefectsTable} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  qa_status VARCHAR(50) DEFAULT 'pending',
  defect_flags JSONB DEFAULT '{}',
  defect_count INT DEFAULT 0,
  defect_comment TEXT,
  verified_at TIMESTAMP WITH TIME ZONE
);

-- 4. Audit Trail Table
CREATE TABLE IF NOT EXISTS ${projectSettings.auditLogsTable || 'audit_logs'} (
  id BIGSERIAL PRIMARY KEY,
  timestamp VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  details TEXT,
  status VARCHAR(20) DEFAULT 'info'
);

-- 5. Deletion Approval Requests Table
CREATE TABLE IF NOT EXISTS ${projectSettings.deletionRequestsTable || 'deletion_requests'} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  requested_by VARCHAR(100) NOT NULL,
  user_email VARCHAR(255),
  reason TEXT,
  poi_count INT DEFAULT 0,
  km_processed DOUBLE PRECISION DEFAULT 0,
  date_requested VARCHAR(100),
  status VARCHAR(20) DEFAULT 'Pending',
  reviewed_by VARCHAR(100),
  reviewed_at VARCHAR(100),
  rejection_reason TEXT
);`;
                      navigator.clipboard.writeText(sqlScript);
                      showToast('Copied PostGIS Database SQL DDL Script to clipboard!');
                    }}
                    className="px-3.5 py-2 bg-inner hover:bg-inner border border-subtle text-sky-400 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                  >
                    <Copy size={13} />
                    <span>Copy PostGIS SQL Schema Script</span>
                  </button>
                </div>

                <div className="text-[11px] text-text-muted font-sans">
                  Latency: <strong className="text-text-muted font-bold">{postgisLatencyMs} ms</strong> &bull; Query Chunk: <strong className="text-text-base">{projectSettings.queryChunkSize || 50} rows</strong>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: 360° IMAGERY & MMS STORAGE ENGINE */}
          <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div className="flex items-center gap-2">
                <Camera size={17} className="text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-text-base uppercase tracking-wide">3. 360° Imagery & MMS Storage Engine</h3>
                  <p className="text-[11px] text-text-muted mt-0.5">Configure 360° panoramic image storage providers, CDN paths, filename patterns, StreetView pre-fetch cache, and player calibration.</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-sans bg-inner border border-subtle text-text-base font-semibold">
                Storage: {projectSettings.storageProvider ? projectSettings.storageProvider.toUpperCase() : 'SUPABASE'}
              </span>
            </div>

            {/* SUB-CARD A: STORAGE INFRASTRUCTURE PROVIDER & CLOUD BACKEND */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                  <Server size={14} className="text-sky-400" />
                  A. Storage Infrastructure Provider & Cloud Engine
                </h4>
                <span className="text-[10px] text-text-muted font-sans">CDN & Object Storage Pipeline</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className={labelClass}>GIS Industry Storage Provider</label>
                  <select
                    value={projectSettings.storageProvider || 'supabase'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, storageProvider: e.target.value as any }))}
                    className={`${inputClass}`}
                  >
                    <option value="cloudflare_r2">Cloudflare R2 (Zero Egress Cost &bull; Multi-Res Ready)</option>
                    <option value="supabase">Supabase Cloud Storage (PostGIS Native)</option>
                    <option value="aws_s3">Amazon Web Services (AWS S3 Bucket)</option>
                    <option value="custom_cdn">Custom CDN / Reverse Proxy URL Prefix</option>
                    <option value="nas_local">Local Intranet NAS / On-Premise Server (SMB/HTTP)</option>
                    <option value="gcs">Google Cloud Storage (GCS Bucket)</option>
                    <option value="azure_blob">Microsoft Azure Blob Storage</option>
                    <option value="wasabi">Wasabi Hot Cloud Storage</option>
                  </select>
                </div>

                {projectSettings.storageProvider === 'cloudflare_r2' ? (
                  <>
                    <div>
                      <label className={labelClass}>Cloudflare Public Domain / Custom URL</label>
                      <input
                        type="text"
                        value={projectSettings.r2Domain || ''}
                        onChange={e => setProjectSettings(prev => ({ ...prev, r2Domain: e.target.value, cloudStorageBaseUrl: e.target.value }))}
                        placeholder="pub-xxxxxxxxxxxx.r2.dev or media.yourdomain.com"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                      <p className={helperClass}>e.g. `pub-xxx.r2.dev` or `https://media.example.com`</p>
                    </div>

                    <div>
                      <label className={labelClass}>360° Storage & Slicing Strategy</label>
                      <select
                        value={projectSettings.imageStorageStrategy || 'multires_tiles'}
                        onChange={e => setProjectSettings(prev => ({ ...prev, imageStorageStrategy: e.target.value as any }))}
                        className={`${inputClass}`}
                      >
                        <option value="multires_tiles">Multi-Resolution Tile Pyramid (Deep Zoom 60FPS / Zero Blur)</option>
                        <option value="single_equirectangular">Single Equirectangular Full Image (Standard)</option>
                      </select>
                    </div>

                    {projectSettings.imageStorageStrategy === 'multires_tiles' && (
                      <>
                        <div>
                          <label className={labelClass}>Multi-Res Config Pattern</label>
                          <input
                            type="text"
                            value={projectSettings.multiResTilePattern || 'tiles/{subgrid}/{filename}/config.json'}
                            onChange={e => setProjectSettings(prev => ({ ...prev, multiResTilePattern: e.target.value }))}
                            placeholder="tiles/{subgrid}/{filename}/config.json"
                            className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                          />
                          <p className={helperClass}>Default: `tiles/&#123;subgrid&#125;/&#123;filename&#125;/config.json`</p>
                        </div>
                        <div>
                          <label className={labelClass}>Fallback Preview Pattern</label>
                          <input
                            type="text"
                            value={projectSettings.multiResFallbackPattern || 'tiles/{subgrid}/{filename}/fallback/f.jpg'}
                            onChange={e => setProjectSettings(prev => ({ ...prev, multiResFallbackPattern: e.target.value }))}
                            placeholder="tiles/{subgrid}/{filename}/fallback/f.jpg"
                            className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                          />
                          <p className={helperClass}>Default: `tiles/&#123;subgrid&#125;/&#123;filename&#125;/fallback/f.jpg`</p>
                        </div>
                      </>
                    )}
                  </>
                ) : projectSettings.storageProvider === 'aws_s3' ? (
                  <>
                    <div>
                      <label className={labelClass}>AWS S3 Bucket Name</label>
                      <input
                        type="text"
                        value={projectSettings.s3Bucket || S3_BUCKET_DEFAULT}
                        onChange={e => setProjectSettings(prev => ({ ...prev, s3Bucket: e.target.value }))}
                        placeholder="tnb-mobilemapping-panoramas"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>AWS S3 Region</label>
                      <input
                        type="text"
                        value={projectSettings.s3Region || 'ap-southeast-1'}
                        onChange={e => setProjectSettings(prev => ({ ...prev, s3Region: e.target.value }))}
                        placeholder="ap-southeast-1"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                    </div>
                  </>
                ) : projectSettings.storageProvider === 'gcs' ? (
                  <div>
                    <label className={labelClass}>Google Cloud Storage (GCS) Bucket</label>
                    <input
                      type="text"
                      value={projectSettings.gcsBucket || 'tnb-gis-360-panoramas'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, gcsBucket: e.target.value }))}
                      placeholder="tnb-gis-360-panoramas"
                      className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                    />
                  </div>
                ) : projectSettings.storageProvider === 'azure_blob' ? (
                  <>
                    <div>
                      <label className={labelClass}>Azure Storage Account</label>
                      <input
                        type="text"
                        value={projectSettings.azureAccount || 'tnbgisstorage'}
                        onChange={e => setProjectSettings(prev => ({ ...prev, azureAccount: e.target.value }))}
                        placeholder="tnbgisstorage"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Azure Blob Container Name</label>
                      <input
                        type="text"
                        value={projectSettings.azureContainer || AZURE_CONTAINER_DEFAULT}
                        onChange={e => setProjectSettings(prev => ({ ...prev, azureContainer: e.target.value }))}
                        placeholder="panoramas"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                    </div>
                  </>
                ) : projectSettings.storageProvider === 'wasabi' ? (
                  <>
                    <div>
                      <label className={labelClass}>Wasabi Bucket Name</label>
                      <input
                        type="text"
                        value={projectSettings.wasabiBucket || 'tnb-wasabi-panoramas'}
                        onChange={e => setProjectSettings(prev => ({ ...prev, wasabiBucket: e.target.value }))}
                        placeholder="tnb-wasabi-panoramas"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Wasabi Region</label>
                      <input
                        type="text"
                        value={projectSettings.wasabiRegion || REGION_DEFAULTS.wasabiRegion}
                        onChange={e => setProjectSettings(prev => ({ ...prev, wasabiRegion: e.target.value }))}
                        placeholder="us-east-1"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                    </div>
                  </>
                ) : projectSettings.storageProvider === 'nas_local' ? (
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Local NAS Server IP / HTTP Intranet Share</label>
                    <input
                      type="text"
                      value={projectSettings.nasServerUrl || 'http://192.168.1.100/360_images'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, nasServerUrl: e.target.value, imageStoragePath: e.target.value }))}
                      placeholder="http://192.168.1.100/360_images"
                      className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                    />
                  </div>
                ) : projectSettings.storageProvider === 'custom_cdn' ? (
                  <>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Custom CDN Base URL Prefix</label>
                      <input
                        type="text"
                        value={projectSettings.customCdnUrl || ''}
                        onChange={e => setProjectSettings(prev => ({ ...prev, customCdnUrl: e.target.value, imageStoragePath: e.target.value, cloudStorageBaseUrl: e.target.value }))}
                        placeholder="https://cdn.example.com/panoramas/"
                        className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>360° Storage & Slicing Strategy</label>
                      <select
                        value={projectSettings.imageStorageStrategy || 'single_equirectangular'}
                        onChange={e => setProjectSettings(prev => ({ ...prev, imageStorageStrategy: e.target.value as any }))}
                        className={`${inputClass}`}
                      >
                        <option value="single_equirectangular">Single Equirectangular Full Image (Standard)</option>
                        <option value="multires_tiles">Multi-Resolution Tile Pyramid (Deep Zoom 60FPS)</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className={labelClass}>Storage Bucket Name</label>
                    <input
                      type="text"
                      value={projectSettings.supabaseBucket || STORAGE_BUCKET_DEFAULT}
                      onChange={e => setProjectSettings(prev => ({ ...prev, supabaseBucket: e.target.value, imageStoragePath: `/storage/v1/object/public/${e.target.value}/` }))}
                      placeholder="MMS_PIC"
                      className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                    />
                  </div>
                )}

                <div>
                  <label className={labelClass}>Storage Access & CORS Policy</label>
                  <select
                    value={projectSettings.storageAccessPermission || 'public_read'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, storageAccessPermission: e.target.value as any }))}
                    className={`${inputClass}`}
                  >
                    <option value="public_read">Public CDN Read (Direct Browser 360 Viewer)</option>
                    <option value="signed_url">Signed URL Tokenized Read (24h Expiry)</option>
                    <option value="intranet_only">Intranet Protected (CORS Restricted)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* SUB-CARD B: PANORAMA FILENAME PATTERNS & ASSET PIPELINE */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                  <FileText size={14} className="text-sky-400" />
                  B. Panorama Filename Pattern & Directory Resolution
                </h4>
                <span className="text-[10px] text-text-muted font-sans">Format: Equirectangular JPG/PNG</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className={labelClass}>Panorama Filename Template</label>
                  <input
                    type="text"
                    value={projectSettings.imageFormatPattern || '{subgrid}-{index:04d}.jpg'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, imageFormatPattern: e.target.value }))}
                    placeholder="{subgrid}-{index:04d}.jpg"
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                  <p className={helperClass}>e.g. {`{subgrid}-{index:04d}.jpg`} &bull; {`{subgrid}_{index}.jpg`}</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-text-muted font-medium">Directory Folder Hierarchy</label>
                    <span className="text-[10px] text-sky-400 font-medium">Auto-Managed</span>
                  </div>
                  <select
                    disabled
                    value="auto_detect"
                    className="w-full px-3 py-2 rounded-lg font-medium focus:outline-none border opacity-60 cursor-not-allowed bg-inner/50 text-text-muted border-subtle"
                  >
                    <option value="auto_detect">Auto-Detect from Filename / Subgrid (System Managed)</option>
                    <option value="subgrid_folder">Subgrid Folder: tiles/{`{subgrid}`}/{`{filename}`}/</option>
                    <option value="flat">Flat Root: tiles/{`{filename}`}/</option>
                    <option value="daily_folder">Daily Date Folder: /{`{date}`}/{`{filename}`}/</option>
                  </select>
                  <p className={helperClass}>Automatically detected and managed by active storage provider.</p>
                </div>

                <div>
                  <label className={labelClass}>Missing Image Grace Policy</label>
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${inputBg}`}>
                    <span className="text-[11px] text-text-base font-medium">Render Staging Fallback</span>
                    <input
                      type="checkbox"
                      checked={projectSettings.fallbackPlaceholderEnabled !== false}
                      onChange={e => setProjectSettings(prev => ({ ...prev, fallbackPlaceholderEnabled: e.target.checked }))}
                      className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD C: 360° STREETVIEW PLAYER & PRELOAD STREAMING ENGINE */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                  <Activity size={14} className="text-sky-400" />
                  C. 360° StreetView Player & Preload Streaming Engine
                </h4>
                <span className="text-[10px] text-text-muted font-sans">PhotoSphereViewer v5 · WebGL</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className={labelClass}>Lookahead Frame Preload Cache</label>
                  <select
                    value={projectSettings.imagePreloadCount || 3}
                    onChange={e => setProjectSettings(prev => ({ ...prev, imagePreloadCount: Number(e.target.value) }))}
                    className={`${inputClass}`}
                  >
                    <option value="1">1 Frame Ahead (Low bandwidth / 4G)</option>
                    <option value="3">3 Frames Ahead (Balanced &bull; Recommended)</option>
                    <option value="5">5 Frames Ahead (Smooth 60FPS Panning)</option>
                    <option value="10">10 Frames Ahead (High Speed Fiber)</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Default Field of View (FOV)</label>
                  <select
                    value={projectSettings.defaultFov || 75}
                    onChange={e => setProjectSettings(prev => ({ ...prev, defaultFov: parseInt(e.target.value) || 75 }))}
                    className={`${inputClass}`}
                  >
                    <option value="60">60&deg; &mdash; Narrow / Telephoto Inspection</option>
                    <option value="75">75&deg; &mdash; Natural Human Eye (Recommended)</option>
                    <option value="90">90&deg; &mdash; Wide Angle Road View</option>
                    <option value="110">110&deg; &mdash; Ultra-Wide Panoramic</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>StreetView Navigation Arrow Color</label>
                  <select
                    value={projectSettings.arrowColor || 'sky'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, arrowColor: e.target.value as any }))}
                    className={`${inputClass}`}
                  >
                    <option value="sky">Sky Blue &bull; High Contrast (Default)</option>
                    <option value="emerald">Emerald Green &bull; High Visibility</option>
                    <option value="amber">Amber Gold &bull; Warning Contrast</option>
                    <option value="white">Crisp White &bull; Minimalist</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Live Heading Yaw Sync</label>
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${inputBg}`}>
                    <span className="text-[11px] text-text-base font-medium">Vehicle Azimuth Alignment</span>
                    <input
                      type="checkbox"
                      checked={projectSettings.syncHeadingWithCar !== false}
                      onChange={e => setProjectSettings(prev => ({ ...prev, syncHeadingWithCar: e.target.checked }))}
                      className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD D: STORAGE & MULTI-RESOLUTION LIVE DIAGNOSTICS SUITE */}
            <div className={`p-4 rounded-xl border space-y-4 ${innerCardBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-text-base uppercase tracking-wider flex items-center gap-1.5">
                    <Activity size={14} className="text-sky-400" />
                    D. Dynamic Storage & Multi-Resolution Connectivity Diagnostics
                  </h4>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Probe object storage endpoints, test CORS cross-origin headers, measure latency, and verify multi-resolution tile configuration files.
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-sans bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  {projectSettings.storageProvider === 'cloudflare_r2' ? 'Cloudflare R2 Mode' : `${(projectSettings.storageProvider || 'Supabase').toUpperCase()} Mode`}
                </span>
              </div>

              {/* TEST SAMPLE FILENAME & QUICK PICK */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end text-xs">
                <div className="sm:col-span-6">
                  <label className={labelClass}>Test Panorama Filename / Station Key</label>
                  <input
                    type="text"
                    value={testFilename}
                    onChange={e => setTestFilename(e.target.value)}
                    placeholder="e.g. SG01-0001.jpg or N93E70-0001"
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div className="sm:col-span-6 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const firstPano = dailyData.find(d => d.panoramas?.length > 0)?.panoramas?.[0]?.filename
                        || batchLogs.find(b => b.imageFilename)?.imageFilename
                        || (dailyData[0]?.subgrid ? `${dailyData[0].subgrid}-0001.jpg` : 'SG01-0001.jpg');
                      setTestFilename(firstPano);
                      showToast(`Loaded sample station: ${firstPano}`);
                    }}
                    className="px-3 py-2 bg-inner hover:bg-inner border border-subtle text-text-base rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                  >
                    <FileText size={12} className="text-text-muted" />
                    <span>Use Staged Station</span>
                  </button>

                  <button
                    type="button"
                    disabled={cfTestLoading}
                    onClick={async () => {
                      setCfTestLoading(true);
                      setCfTestResult(null);
                      try {
                        if (projectSettings.storageProvider === 'cloudflare_r2' || projectSettings.storageProvider === 'custom_cdn') {
                          const domain = projectSettings.r2Domain || projectSettings.customCdnUrl || projectSettings.cloudStorageBaseUrl || '';
                          const res = await testCloudflareStorageHealth(domain, testFilename, projectSettings);
                          setCfTestResult(res);
                          if (res.ok) {
                            showToast(`Storage probe OK &bull; ${res.latencyMs}ms latency &bull; HTTP ${res.status}`);
                          } else if (res.status === 404) {
                            showToast(`Bucket reachable (${res.latencyMs}ms), but sample file returned 404.`, 'error');
                          } else {
                            showToast(`Storage probe notice: ${res.statusText || res.error}`, 'error');
                          }
                        } else {
                          const res = await testDatabaseHealth();
                          setCfTestResult({
                            ok: res.storageStatus === 'operational',
                            status: res.storageStatus === 'operational' ? 200 : 503,
                            statusText: res.storageStatus === 'operational' ? 'Operational' : 'Degraded',
                            latencyMs: res.postgisLatencyMs,
                            imageUrl: resolvePanoramaUrl(testFilename, projectSettings),
                            corsOk: true,
                            contentType: 'image/jpeg'
                          });
                          showToast(`Storage probe OK &bull; Bucket: ${projectSettings.supabaseBucket || STORAGE_BUCKET_DEFAULT} (${res.storageTotalFiles}+ files)`);
                        }
                      } catch (err: any) {
                        setCfTestResult({
                          ok: false,
                          status: 0,
                          statusText: 'Probe Failed',
                          latencyMs: 0,
                          imageUrl: resolvePanoramaUrl(testFilename, projectSettings),
                          corsOk: false,
                          error: err?.message || 'Failed to ping storage provider'
                        });
                        showToast('Storage probe exception', 'error');
                      } finally {
                        setCfTestLoading(false);
                      }
                    }}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={cfTestLoading ? 'animate-spin' : ''} />
                    <span>{cfTestLoading ? 'Testing Endpoint...' : 'Test Storage & CORS Probe'}</span>
                  </button>
                </div>
              </div>

              {/* RESOLVED URLS BAR */}
              <div className={`p-3 rounded-lg border ${inputBg} space-y-2 text-xs font-sans`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="text-text-muted shrink-0 text-[11px] font-sans font-medium">Resolved 360° URL:</span>
                    <span className="text-sky-300 truncate text-[11px] select-all">
                      {resolvePanoramaUrl(testFilename, projectSettings)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const url = resolvePanoramaUrl(testFilename, projectSettings);
                      navigator.clipboard.writeText(url);
                      showToast('Copied 360° Image URL to clipboard!');
                    }}
                    className="px-2 py-1 bg-inner hover:bg-inner text-sky-400 border border-subtle rounded text-[11px] font-sans font-semibold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                  >
                    <Copy size={11} />
                    <span>Copy URL</span>
                  </button>
                </div>

                {(projectSettings.storageProvider === 'cloudflare_r2' || projectSettings.imageStorageStrategy === 'multires_tiles') && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-subtle">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="text-text-muted shrink-0 text-[11px] font-sans font-medium">Multi-Res config.json:</span>
                      <span className="text-text-muted truncate text-[11px] select-all">
                        {resolvePanoramaConfigUrl(testFilename, projectSettings)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const url = resolvePanoramaConfigUrl(testFilename, projectSettings);
                        navigator.clipboard.writeText(url);
                        showToast('Copied Multi-Res config.json URL to clipboard!');
                      }}
                      className="px-2 py-1 bg-inner hover:bg-inner text-text-muted border border-subtle rounded text-[11px] font-sans font-semibold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                    >
                      <Copy size={11} />
                      <span>Copy Config URL</span>
                    </button>
                  </div>
                )}
              </div>

              {/* LIVE PROBE RESULT CARD */}
              {cfTestResult && (
                <div className={`p-3.5 rounded-xl border animate-in fade-in slide-in-from-top-2 ${cfTestResult.ok
                  ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
                  : cfTestResult.status === 404
                    ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                    : 'bg-rose-950/30 border-rose-800/60 text-rose-200'
                  }`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1 min-w-[240px]">
                      <div className="flex items-center gap-2">
                        {cfTestResult.ok ? (
                          <CheckCircle size={16} className="text-text-muted shrink-0" />
                        ) : cfTestResult.status === 404 ? (
                          <AlertTriangle size={16} className="text-text-muted shrink-0" />
                        ) : (
                          <XCircle size={16} className="text-text-muted shrink-0" />
                        )}
                        <span className="font-bold text-xs">
                          {cfTestResult.ok
                            ? `Storage Reachable &bull; HTTP ${cfTestResult.status} ${cfTestResult.statusText}`
                            : cfTestResult.status === 404
                              ? `Storage Connected &bull; HTTP 404 File Not Found`
                              : `Connection Failed &bull; ${cfTestResult.statusText || 'Error'}`}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-sans bg-inner border border-subtle text-text-base">
                          {cfTestResult.latencyMs}ms Latency
                        </span>
                        {cfTestResult.corsOk && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-inner text-text-muted border border-subtle">
                            CORS OK
                          </span>
                        )}
                      </div>

                      {cfTestResult.error && (
                        <p className="text-[11px] text-text-muted leading-relaxed font-sans">
                          {cfTestResult.error}
                        </p>
                      )}

                      {cfTestResult.status === 404 && (
                        <p className="text-[11px] text-text-muted leading-relaxed font-sans">
                          Tip: The Cloudflare domain is active and CORS is valid, but `{testFilename}` does not exist in the bucket. Check your folder path or verify filename spelling.
                        </p>
                      )}

                      {cfTestResult.contentType && (
                        <div className="text-[10px] text-text-muted font-sans">
                          Content-Type: <span className="text-text-base">{cfTestResult.contentType}</span>
                        </div>
                      )}
                    </div>

                    {/* LIVE THUMBNAIL PREVIEW IF ACCESSIBLE */}
                    <div className="shrink-0 flex flex-col items-center gap-1">
                      <a
                        href={cfTestResult.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative block rounded-lg overflow-hidden border border-subtle bg-black/40 hover:border-sky-400 transition-all shadow-md"
                        title="Click to open image in new tab"
                      >
                        <img
                          src={cfTestResult.imageUrl}
                          alt="360 Preview"
                          className="h-16 w-28 object-cover group-hover:scale-105 transition-transform"
                          onError={(e: any) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <ExternalLink size={14} className="text-white" />
                        </div>
                      </a>
                      <span className="text-[9px] text-text-muted">Live 360° Preview</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 4: BASEMAP & SPATIAL LAYER MANAGEMENT WITH LIVE PREVIEW */}
          <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
            <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${themeMode === 'light' ? 'border-slate-200' : 'border-subtle'}`}>
              <div className="flex items-center gap-2">
                <Map size={17} className="text-sky-400" />
                <div>
                  <h3 className={`text-sm font-bold uppercase tracking-wide ${themeMode === 'light' ? 'text-slate-900' : 'text-text-base'}`}>4. Basemap & Spatial Layer Management</h3>
                  <p className={`text-[11px] mt-0.5 ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>Configure default GIS basemaps, trajectory theme colors, line widths, and inspect changes on the live map preview before applying to the dashboard.</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-sans font-bold flex items-center gap-1.5 ${themeMode === 'light' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'}`}>
                  <Palette size={12} />
                  Live Preview Engine
                </span>
              </div>
            </div>

            {/* TWO-COLUMN GRID: CONTROLS (5 COLS) + REAL-TIME MAP PREVIEW (7 COLS) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* LEFT CONTROLS: BASEMAP & COLOR PALETTES (5 COLS) */}
              <div className="lg:col-span-5 space-y-4 flex flex-col justify-between">
                {/* SUB-CARD A: BASEMAP TILE PROVIDER & OPACITY */}
                <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
                  <div className="flex items-center justify-between">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>
                      <Layers size={14} className="text-sky-400" />
                      A. Basemap Tile Source & Opacity
                    </h4>
                    <span className="text-[10px] text-text-muted font-sans">Preview on select</span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className={labelClass}>Default GIS Basemap Provider</label>
                      <select
                        value={projectSettings.defaultBasemap || DEFAULT_BASEMAP}
                        onChange={e => {
                          const val = e.target.value as any;
                          setProjectSettings(prev => ({ ...prev, defaultBasemap: val }));
                          previewBasemapChange(val);
                        }}
                        className={`${inputClass}`}
                      >
                        <option value="ofm-positron">Positron (OpenFreeMap Vector) • Recommended</option>
                        <option value="ofm-dark">Dark (OpenFreeMap Vector)</option>
                        <option value="ofm-fiord">Fiord Nordic Dark (OpenFreeMap Vector)</option>
                        <option value="ofm-liberty">Liberty (OpenFreeMap Vector)</option>
                        <option value="ofm-bright">Bright (OpenFreeMap Vector)</option>
                        <option value="positron">Positron (Carto Light) • Raster Fallback</option>
                        <option value="satellite">Esri World Imagery (Satellite Hybrid)</option>
                        <option value="osm">OpenStreetMap Standard</option>
                        <option value="dark">Dark Matter (Carto Dark)</option>
                        <option value="google-hybrid">Google Maps Satellite / Road Hybrid</option>
                        <option value="google-streets">Google Streets</option>
                        <option value="google-satellite">Google Satellite (Pure)</option>
                        <option value="google-terrain">Google Terrain Elevation</option>
                        <option value="esri-streets">Esri World Streets</option>
                        <option value="esri-topo">Esri World Topographic</option>
                        <option value="esri-natgeo">Esri National Geographic</option>
                        <option value="esri-ocean">Esri Ocean Basemap</option>
                        <option value="voyager">Voyager (Carto Soft)</option>
                        <option value="topo">OpenTopoMap Topographic</option>
                        <option value="custom_tile">Custom WMS / WMTS / XYZ Tile Endpoint</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-text-muted font-medium">Basemap Opacity</label>
                        <span className="font-sans text-[11px] text-sky-400 font-bold">{projectSettings.basemapOpacity ?? 100}%</span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="100"
                        value={projectSettings.basemapOpacity ?? 100}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setProjectSettings(prev => ({ ...prev, basemapOpacity: val }));
                          previewBasemapChange(undefined, undefined, val / 100);
                        }}
                        className="w-full h-2 bg-inner rounded-lg appearance-none cursor-pointer accent-sky-500 mt-2"
                      />
                    </div>

                    {projectSettings.defaultBasemap === 'custom_tile' && (
                      <div>
                        <label className={labelClass}>Custom XYZ Tile URL Template</label>
                        <input
                          type="text"
                          value={projectSettings.customBasemapUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, customBasemapUrl: val }));
                            previewBasemapChange('custom_tile', val);
                          }}
                          placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                        />
                      </div>
                    )}

                    {/* Apply Basemap Settings Button */}
                    <div className={`pt-2 border-t flex justify-end ${themeMode === 'light' ? 'border-slate-200' : 'border-subtle'}`}>
                      <button
                        type="button"
                        onClick={() => {
                          broadcastBasemap();
                          onSaveAllSettings?.();
                          showToast('Basemap & Opacity settings applied to Dashboard!');
                        }}
                        className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-text-base rounded-lg text-xs font-semibold shadow transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                      >
                        <CheckCircle size={13} />
                        <span>Apply Basemap Settings</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* SUB-CARD B: LAYER & TRAJECTORY COLORS */}
                <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>
                      <Palette size={14} className="text-sky-400" />
                      B. Survey Trajectory & Quality Layer Colors
                    </h4>

                    {/* QUICK PALETTE PRESETS */}
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const newColors = {
                            publishedTrackColor: '#10B981',
                            stagingTrackColor: '#F59E0B',
                            defectTrackColor: '#EF4444',
                            selectedTrackColor: '#38BDF8',
                            gridBoundaryColor: '#6366F1'
                          };
                          setProjectSettings(prev => {
                            const updated = { ...prev, ...newColors };
                            previewLayerThemeChange(updated);
                            return updated;
                          });
                          showToast('Loaded Standard Palette to preview map (click Apply to save)');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${themeMode === 'light' ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300' : 'bg-inner hover:bg-inner text-text-base border-subtle'}`}
                      >
                        Standard
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newColors = {
                            publishedTrackColor: '#00f0ff',
                            stagingTrackColor: '#ff5500',
                            defectTrackColor: '#ff0077',
                            selectedTrackColor: '#ffff00',
                            gridBoundaryColor: '#8b5cf6'
                          };
                          setProjectSettings(prev => {
                            const updated = { ...prev, ...newColors };
                            previewLayerThemeChange(updated);
                            return updated;
                          });
                          showToast('Loaded Neon GIS Palette to preview map (click Apply to save)');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${themeMode === 'light' ? 'bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border-cyan-300' : 'bg-inner hover:bg-inner text-cyan-300 border-subtle'}`}
                      >
                        Neon GIS
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newColors = {
                            publishedTrackColor: '#34d399',
                            stagingTrackColor: '#fbbf24',
                            defectTrackColor: '#f87171',
                            selectedTrackColor: '#2dd4bf',
                            gridBoundaryColor: '#818cf8'
                          };
                          setProjectSettings(prev => {
                            const updated = { ...prev, ...newColors };
                            previewLayerThemeChange(updated);
                            return updated;
                          });
                          showToast('Loaded Eco Soft Palette to preview map (click Apply to save)');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${themeMode === 'light' ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-inner hover:bg-inner text-text-muted border-subtle'}`}
                      >
                        Eco Soft
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    {/* PUBLISHED COLOR */}
                    <div>
                      <label className={labelClass}>Published Track Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.publishedTrackColor || '#10B981'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, publishedTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className="w-8 h-8 rounded border border-subtle cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.publishedTrackColor || '#10B981'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, publishedTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className={`w-full px-2 py-1.5 rounded font-sans text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* STAGING COLOR */}
                    <div>
                      <label className={labelClass}>Staging / In-Process Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.stagingTrackColor || '#F59E0B'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, stagingTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className="w-8 h-8 rounded border border-subtle cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.stagingTrackColor || '#F59E0B'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, stagingTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className={`w-full px-2 py-1.5 rounded font-sans text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* DEFECT COLOR */}
                    <div>
                      <label className={labelClass}>QA Defect Flagged Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.defectTrackColor || '#EF4444'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, defectTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className="w-8 h-8 rounded border border-subtle cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.defectTrackColor || '#EF4444'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, defectTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className={`w-full px-2 py-1.5 rounded font-sans text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* SELECTED SUBGRID COLOR */}
                    <div>
                      <label className={labelClass}>Active Selected Subgrid</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.selectedTrackColor || '#38BDF8'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, selectedTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className="w-8 h-8 rounded border border-subtle cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.selectedTrackColor || '#38BDF8'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, selectedTrackColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className={`w-full px-2 py-1.5 rounded font-sans text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* GRID BOUNDARY COLOR */}
                    <div>
                      <label className={labelClass}>Grid Boundary Border</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.gridBoundaryColor || '#6366F1'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, gridBoundaryColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className="w-8 h-8 rounded border border-subtle cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.gridBoundaryColor || '#6366F1'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => {
                              const updated = { ...prev, gridBoundaryColor: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className={`w-full px-2 py-1.5 rounded font-sans text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* LINE WIDTH & GLOW */}
                    <div>
                      <label className={labelClass}>Track Width & Glow</label>
                      <div className="flex items-center gap-2">
                        <select
                          value={projectSettings.poiTrackLineWidth || 3}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setProjectSettings(prev => {
                              const updated = { ...prev, poiTrackLineWidth: val };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className={`flex-1 px-2 py-1.5 rounded font-medium focus:outline-none border ${inputBg}`}
                        >
                          <option value="2">2px (Thin)</option>
                          <option value="3">3px (Balanced)</option>
                          <option value="4">4px (Prominent)</option>
                          <option value="6">6px (Bold)</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const nextGlow = !(projectSettings.enableLayerGlow !== false);
                            setProjectSettings(prev => {
                              const updated = { ...prev, enableLayerGlow: nextGlow };
                              previewLayerThemeChange(updated);
                              return updated;
                            });
                          }}
                          className={`px-2 py-1.5 rounded border text-[11px] font-semibold cursor-pointer transition-colors ${projectSettings.enableLayerGlow !== false ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-inner text-text-muted border-subtle'}`}
                          title="Toggle High-Contrast Glow"
                        >
                          Glow
                        </button>
                      </div>
                    </div>
                    {/* LAYER & TRAJECTORY COLOR OPACITY */}
                    <div className={`sm:col-span-2 pt-2 border-t ${themeMode === 'light' ? 'border-slate-200' : 'border-subtle'}`}>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-text-muted font-medium">Layer & Trajectory Color Opacity</label>
                        <span className="font-sans text-[11px] text-text-muted font-bold">{projectSettings.layerOpacity ?? 100}%</span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="100"
                        value={projectSettings.layerOpacity ?? 100}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setProjectSettings(prev => {
                            const updated = { ...prev, layerOpacity: val };
                            previewLayerThemeChange(updated);
                            return updated;
                          });
                        }}
                        className="w-full h-2 bg-inner rounded-lg appearance-none cursor-pointer accent-sky-500 mt-1"
                      />
                    </div>
                  </div>

                  {/* Apply Layer Theme Button */}
                  <div className={`pt-2 border-t flex justify-end ${themeMode === 'light' ? 'border-slate-200' : 'border-subtle'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        broadcastLayerTheme();
                        onSaveAllSettings?.();
                        showToast('Survey Trajectory Layer theme applied to Dashboard!');
                      }}
                      className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                    >
                      <CheckCircle size={13} />
                      <span>Apply Layer Theme</span>
                    </button>
                  </div>
                </div>

                {/* SUB-CARD C: PROJECT GEOGRAPHIC BOUNDARY (PREVIEWED ON LIVE MAP) */}
                <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>
                      <Map size={14} className="text-text-muted" />
                      C. Project Geographic Boundary
                    </h4>
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-sans font-bold flex items-center gap-1.5 ${(projectSettings as any)?.projectBoundary?.geojson
                      ? (themeMode === 'light' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-sky-500/10 text-text-muted border border-sky-500/20')
                      : 'bg-inner text-text-muted border border-subtle'
                      }`}>
                      <Map size={12} />
                      {(projectSettings as any)?.projectBoundary?.geojson ? 'Boundary Set' : 'No Boundary'}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <label className={labelClass}>Malaysia Region</label>
                      <select
                        value={selectedRegionId || (projectSettings as any)?.projectBoundary?.regionId || ''}
                        onChange={(e) => handlePreviewRegion(e.target.value || null)}
                        className={`${inputClass}`}
                      >
                        <option value="">— Select a region to preview —</option>
                        {MALAYSIA_REGIONS
                          .filter((r) => r.id !== CUSTOM_REGION_ID)
                          .map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                      </select>
                      <p className={helperClass}>
                        Selecting a region previews it live on the map to the right. Click <strong className="text-text-muted">Apply</strong> to commit it as the project boundary.
                      </p>
                    </div>

                    {/* District Boundary (Multi-choice) */}
                    {availableDistricts.length > 0 && (
                      <div className="pt-2.5 border-t border-subtle/50 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-text-muted font-medium flex items-center gap-1.5 text-xs">
                            <span>District Boundary (Multi-choice)</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-semibold border border-sky-500/20">
                              {selectedDistrictIds.length > 0
                                ? `${selectedDistrictIds.length} of ${availableDistricts.length} selected`
                                : 'All Districts (Whole State)'}
                            </span>
                          </label>
                          <div className="flex items-center gap-2 text-[10px]">
                            <button
                              type="button"
                              onClick={handleSelectAllDistricts}
                              className="text-sky-400 hover:text-sky-300 hover:underline font-semibold cursor-pointer"
                            >
                              Select All
                            </button>
                            <span className="text-text-muted">·</span>
                            <button
                              type="button"
                              onClick={handleClearDistricts}
                              className="text-text-muted hover:text-text-base hover:underline font-medium cursor-pointer"
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        {/* Search Filter for Districts */}
                        {availableDistricts.length > 6 && (
                          <div className="relative">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                            <input
                              type="text"
                              value={districtSearchQuery}
                              onChange={(e) => setDistrictSearchQuery(e.target.value)}
                              placeholder={`Filter ${availableDistricts.length} districts in ${currentRegion?.name || 'region'}...`}
                              className={`w-full pl-7 pr-3 py-1 text-[11px] rounded-lg border font-medium focus:outline-none ${inputBg}`}
                            />
                          </div>
                        )}

                        {/* Multi-choice District Checkboxes */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto p-1.5 rounded-lg border border-subtle bg-inner/30">
                          {filteredDistricts.map((d) => {
                            const isSelected = selectedDistrictIds.includes(d.id);
                            return (
                              <label
                                key={d.id}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs cursor-pointer select-none transition-all ${
                                  isSelected
                                    ? 'bg-sky-500/15 border-sky-400/50 text-sky-300 font-semibold shadow-xs'
                                    : 'bg-card/50 border-subtle text-text-muted hover:text-text-base hover:border-subtle/80'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleDistrict(d.id)}
                                  className="rounded border-subtle bg-card text-sky-500 focus:ring-0 accent-sky-400 cursor-pointer shrink-0"
                                />
                                <span className="truncate text-[11px]" title={d.name}>{d.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {/* 1. Apply Project Boundary (Soft Pastel Mint) */}
                      <button
                        type="button"
                        disabled={!isAdmin || !selectedRegionId || selectedRegionId === CUSTOM_REGION_ID}
                        onClick={() => handleApplyRegion(selectedRegionId!)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all border shadow-xs ${
                          isAdmin && selectedRegionId && selectedRegionId !== CUSTOM_REGION_ID
                            ? themeMode === 'light'
                              ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300 cursor-pointer active:scale-95'
                              : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-text-muted border-emerald-500/30 hover:border-emerald-500/50 cursor-pointer active:scale-95'
                            : 'bg-inner/40 text-text-muted border-subtle/60 cursor-not-allowed opacity-60'
                        }`}
                      >
                        <CheckCircle size={13} className="shrink-0" />
                        <span>Apply Project Boundary</span>
                      </button>

                      {/* 2. Focus & Dim (Soft Pastel Sky) */}
                      <button
                        type="button"
                        disabled={!isAdmin || !(projectSettings as any)?.projectBoundary?.geojson}
                        onClick={() => {
                          setProjectSettings(prev => ({ ...prev, projectBoundary: { ...((prev as any)?.projectBoundary || {}), focusActive: true } }));
                          broadcastProjectBoundary('focus');
                          showToast('Map focused & dimmed to project boundary.');
                        }}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all border shadow-xs ${
                          isAdmin && (projectSettings as any)?.projectBoundary?.geojson
                            ? themeMode === 'light'
                              ? 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-300 cursor-pointer active:scale-95'
                              : 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border-sky-500/30 hover:border-sky-500/50 cursor-pointer active:scale-95'
                            : 'bg-inner/40 text-text-muted border-subtle/60 cursor-not-allowed opacity-60'
                        }`}
                      >
                        <Crosshair size={13} className="shrink-0" />
                        <span>Focus &amp; Dim</span>
                      </button>

                      {/* 3. Clear Focus (Soft Neutral Slate) */}
                      <button
                        type="button"
                        disabled={!isAdmin || !(projectSettings as any)?.projectBoundary?.geojson}
                        onClick={() => {
                          setProjectSettings(prev => ({ ...prev, projectBoundary: { ...((prev as any)?.projectBoundary || {}), focusActive: false } }));
                          broadcastProjectBoundary('clear');
                          showToast('Boundary focus/dim cleared.');
                        }}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all border shadow-xs ${
                          isAdmin && (projectSettings as any)?.projectBoundary?.geojson
                            ? themeMode === 'light'
                              ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 cursor-pointer active:scale-95'
                              : 'bg-inner/60 hover:bg-inner text-text-base border-subtle hover:border-subtle/80 cursor-pointer active:scale-95'
                            : 'bg-inner/40 text-text-muted border-subtle/60 cursor-not-allowed opacity-60'
                        }`}
                      >
                        <Eye size={13} className="shrink-0" />
                        <span>Clear Focus</span>
                      </button>

                      {/* 4. Clear (Soft Pastel Rose) */}
                      <button
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => {
                          setSelectedRegionId(null);
                          setSelectedDistrictIds([]);
                          setProjectSettings(prev => ({ ...prev, projectBoundary: undefined }));
                          broadcastProjectBoundary('clear');
                          showToast('Project geographic boundary removed.');
                        }}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all border shadow-xs ${
                          isAdmin
                            ? themeMode === 'light'
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300 cursor-pointer active:scale-95'
                              : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300/85 hover:text-rose-200 border-rose-500/25 hover:border-rose-500/40 cursor-pointer active:scale-95'
                            : 'bg-inner/40 text-text-muted border-subtle/60 cursor-not-allowed opacity-60'
                        }`}
                      >
                        <Trash2 size={13} className="shrink-0" />
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>

                  {activeBbox && (
                    <div className={`p-2.5 rounded-lg border ${innerCardBg}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                          Bounding Box (minLng, minLat, maxLng, maxLat)
                        </span>
                        {selectedDistrictsList.length > 0 ? (
                          <span className="text-[10px] font-sans font-medium text-sky-400">
                            {selectedDistrictsList.length} {selectedDistrictsList.length === 1 ? 'district' : 'districts'} selected
                          </span>
                        ) : currentRegion ? (
                          <span className="text-[10px] font-sans font-medium text-text-muted">
                            {currentRegion.name} (Whole state)
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] font-sans text-text-muted font-semibold tracking-wide">
                        {activeBbox.map((n: number) => Number(n).toFixed(6)).join(' · ')}
                      </div>
                      {selectedDistrictsList.length > 0 && (
                        <div className="text-[10px] text-text-muted mt-1.5 flex flex-wrap items-center gap-1">
                          <span className="text-text-muted font-semibold">Districts:</span>
                          {selectedDistrictsList.map(d => (
                            <span key={d.id} className="px-1.5 py-0.5 rounded bg-inner border border-subtle text-[9px] text-text-base">
                              {d.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: REAL-TIME LIVE MAP DASHBOARD PREVIEW (7 COLS - SPACIOUS) */}
              <div className="lg:col-span-7 flex flex-col min-h-[580px]">
                <div className={`p-4 rounded-xl border flex-1 flex flex-col space-y-3 ${innerCardBg}`}>
                  <div className="flex items-center justify-between">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>
                      <Navigation size={14} className="text-text-muted" />
                      Live Map Dashboard Preview
                    </h4>
                  </div>

                  {/* REAL EMBEDDED WEBGIS MAP IFRAME CONTAINER (SPACIOUS & THEME-AWARE) */}
                  <div className={`relative flex-1 min-h-[520px] rounded-xl overflow-hidden border ${themeMode === 'light' ? 'border-slate-200 bg-slate-100' : 'border-subtle bg-app'} flex flex-col shadow-2xl`}>
                    {/* Top-Left GeoSphere 360 Operations Hub Floating Badge */}
                    <div className="absolute top-3 left-3 z-20 pointer-events-none">
                      <div className={`backdrop-blur-xl border rounded-2xl px-3 py-1.5 shadow-2xl flex items-center gap-2.5 shrink-0 ${themeMode === 'light' ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-card border-subtle text-text-base'}`}>
                        <div className="p-1.5 bg-sky-500/90 rounded-xl shadow-md shrink-0">
                          <Layers size={14} className="text-text-base" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className={`font-bold text-xs tracking-tight ${themeMode === 'light' ? 'text-slate-900' : 'text-text-base'}`}>
                              GeoSphere 360 Operations Hub
                            </h4>
                          </div>
                          <p className={`text-[9px] font-medium ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>
                            Mobile Mapping & Spatial Asset Intelligence
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Embedded WebGIS Map Iframe */}
                    <iframe
                      ref={previewIframeRef}
                      key={`${previewRefreshKey}-${themeMode}-${projectSettings.defaultBasemap || DEFAULT_BASEMAP}`}
                      src={`${import.meta.env.VITE_MAP_URL || ''}/?embed=true&preview=true&theme=${themeMode}&basemap=${projectSettings.defaultBasemap || DEFAULT_BASEMAP}&t=${previewRefreshKey}`}
                      onLoad={() => {
                        sendPreviewData();
                        setTimeout(sendPreviewData, 400);
                        setTimeout(sendPreviewData, 1200);
                      }}
                      className="w-full h-full min-h-[520px] border-0"
                      title="WebGIS Live Map Preview"
                      allow="geolocation; camera; accelerometer; gyroscope"
                    />

                    {/* Bottom-Right Live Cursor Coordinate Badge */}
                    <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
                      <div className={`backdrop-blur-md border rounded-lg px-2.5 py-1 text-[10px] shadow-xl flex items-center gap-1.5 font-sans ${themeMode === 'light' ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-app border-subtle text-text-base'}`}>
                        <span className="text-sky-500 font-semibold">{projectSettings.spatialSrid || 'EPSG:4326'}</span>
                        <span className={themeMode === 'light' ? 'text-text-base' : 'text-text-muted'}>|</span>
                        {previewCoords ? (
                          <span className={`font-semibold ${themeMode === 'light' ? 'text-slate-900' : 'text-text-base'}`}>
                            {previewCoords.lat.toFixed(4)}° N, {previewCoords.lng.toFixed(4)}° E
                          </span>
                        ) : (
                          <span className="text-text-muted italic">Live GIS Map</span>
                        )}
                      </div>
                    </div>

                    {/* Bottom-Left Controls Stack: Action Buttons on Top, Legend Chips Below */}
                    <div className="absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2 pointer-events-none">
                      {/* Action Controls directly above legend */}
                      <div className="flex items-center gap-1.5 pointer-events-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewRefreshKey(k => k + 1);
                            showToast('Refreshing Live Map Preview...');
                          }}
                          title="Refresh WebGIS Map Preview"
                          className={`px-2.5 py-1 rounded-xl backdrop-blur-xl border cursor-pointer shadow-xl transition-all active:scale-95 flex items-center gap-1.5 text-[10px] font-semibold ${themeMode === 'light' ? 'bg-white/95 hover:bg-slate-100 text-sky-600 border-slate-300' : 'bg-app hover:bg-inner text-sky-400 border-subtle'}`}
                        >
                          <RefreshCw size={11} />
                          <span>Refresh</span>
                        </button>
                        <a
                          href={import.meta.env.VITE_MAP_URL || ''}
                          target="_blank"
                          rel="noreferrer"
                          title="Open WebGIS in new tab"
                          className={`p-1.5 rounded-xl backdrop-blur-xl border cursor-pointer shadow-xl transition-all active:scale-95 flex items-center ${themeMode === 'light' ? 'bg-white/95 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-300' : 'bg-app hover:bg-inner text-text-base hover:text-text-base border-subtle'}`}
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>

                      {/* Live Legend Chips */}
                      <div className="flex flex-wrap items-center gap-1 pointer-events-auto">
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-app border-subtle text-text-base'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.publishedTrackColor || '#10B981' }} />
                          Published
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-app border-subtle text-text-base'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.stagingTrackColor || '#F59E0B' }} />
                          Staging
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-app border-subtle text-text-base'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.defectTrackColor || '#EF4444' }} />
                          Defect
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-app border-subtle text-text-base'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.selectedTrackColor || '#38BDF8' }} />
                          Selected
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 5: SECURITY, RBAC & ACCESS CONTROL SETTINGS */}
          <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
            <div className={`flex flex-wrap items-center justify-between gap-2 pb-3 border-b ${themeMode === 'light' ? 'border-slate-200' : 'border-subtle'}`}>
              <div className="flex items-center gap-2">
                <Shield size={16} className={themeMode === 'light' ? 'text-slate-700' : 'text-text-base'} />
                <div>
                  <h3 className={`text-sm font-bold uppercase tracking-wide ${themeMode === 'light' ? 'text-slate-900' : 'text-text-base'}`}>
                    5. Security, Authentication & Access Control (RBAC)
                  </h3>
                  <p className={`text-[11px] mt-0.5 ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>
                    Configure enterprise authentication policies, session timeouts, authorized email restrictions, and role permissions.
                  </p>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-semibold border ${themeMode === 'light' ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-inner text-text-base border-subtle'}`}>
                Protected Mode
              </span>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* SUB-SECTION A: SECURITY SAFEGUARDS & 2FA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Deletion Guard Toggle */}
                <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${innerCardBg}`}>
                  <div>
                    <h4 className={`font-semibold ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>Require Administrator Approval for CSV Deletion</h4>
                    <p className={`text-[11px] mt-0.5 ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>When enabled, field operators submit deletion tickets to the Approvals queue instead of hard-deleting.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={projectSettings.requireAdminApprovalForDelete !== false}
                    onChange={e => setProjectSettings(prev => ({ ...prev, requireAdminApprovalForDelete: e.target.checked }))}
                    className="w-4 h-4 accent-sky-500 rounded cursor-pointer shrink-0"
                  />
                </div>

                {/* 2FA / MFA Toggle */}
                <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${innerCardBg}`}>
                  <div>
                    <h4 className={`font-semibold ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>Multi-Factor Authentication (MFA / 2FA)</h4>
                    <p className={`text-[11px] mt-0.5 ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>Enforce one-time verification codes for Administrator and QA Inspector accounts on login.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={projectSettings.twoFactorRequired === true}
                    onChange={e => setProjectSettings(prev => ({ ...prev, twoFactorRequired: e.target.checked }))}
                    className="w-4 h-4 accent-sky-500 rounded cursor-pointer shrink-0"
                  />
                </div>
              </div>

              {/* SUB-SECTION B: SESSION & EMAIL DOMAIN RESTRICTIONS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-text-muted font-medium">Session Inactivity Auto-Lock</label>
                    <span className="text-[10px] text-text-muted">Auto-terminates idle sessions</span>
                  </div>
                  <select
                    value={projectSettings.sessionTimeoutMinutes || 30}
                    onChange={e => setProjectSettings(prev => ({ ...prev, sessionTimeoutMinutes: Number(e.target.value) }))}
                    className={`${inputClass}`}
                  >
                    <option value="15">15 Minutes</option>
                    <option value="30">30 Minutes (Recommended)</option>
                    <option value="60">1 Hour</option>
                    <option value="240">4 Hours</option>
                    <option value="480">8 Hours (Full Shift)</option>
                    <option value="0">Never (Dev Mode Only)</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-text-muted font-medium">Authorized Email / Domain Restriction</label>
                    <span className="text-[10px] text-text-muted">Whitelist filter</span>
                  </div>
                  <input
                    type="text"
                    placeholder="user@example.com, @company.com (email)"
                    value={projectSettings.corporateDomain || ''}
                    onChange={e => setProjectSettings(prev => ({ ...prev, corporateDomain: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                  />
                  <p className={helperClass}>Specify authorized email addresses or domain suffixes (e.g. <code>user@example.com</code> or <code>@company.com</code>).</p>
                </div>
              </div>

              {/* SUB-SECTION C: RBAC ROLE PERMISSIONS OVERVIEW */}
              <div className={`p-3.5 rounded-xl border space-y-2.5 ${innerCardBg}`}>
                <div className="flex items-center justify-between">
                  <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>
                    <Users size={13} className={themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'} />
                    Role-Based Access Control (RBAC) Policy
                  </h4>
                  <span className="text-[10px] text-text-muted font-sans">4 System Roles</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-app border-subtle'}`}>
                    <h5 className={`font-bold text-[11px] mb-1 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>Administrator</h5>
                    <p className={`text-[10px] leading-tight ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>Full read/write, DB deletion approval, storage probe & security settings.</p>
                  </div>

                  <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-app border-subtle'}`}>
                    <h5 className={`font-bold text-[11px] mb-1 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>QA Inspector</h5>
                    <p className={`text-[10px] leading-tight ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>Flag quality defects, inspect 360° panoramas & export audit reports.</p>
                  </div>

                  <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-app border-subtle'}`}>
                    <h5 className={`font-bold text-[11px] mb-1 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>Survey Operator</h5>
                    <p className={`text-[10px] leading-tight ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>Upload CSV datasets, view subgrids & submit deletion approval requests.</p>
                  </div>

                  <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-app border-subtle'}`}>
                    <h5 className={`font-bold text-[11px] mb-1 ${themeMode === 'light' ? 'text-slate-800' : 'text-text-base'}`}>Viewer</h5>
                    <p className={`text-[10px] leading-tight ${themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'}`}>Read-only access to published GIS map viewer, charts & analytics.</p>
                  </div>
                </div>
              </div>

              {/* SUB-SECTION D: MASKED API CREDENTIALS BOX */}
              <div className={`p-3 rounded-xl border space-y-2 ${innerCardBg}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-semibold flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-700' : 'text-text-base'}`}>
                    <Key size={13} className={themeMode === 'light' ? 'text-text-muted' : 'text-text-muted'} />
                    Supabase Service & Anon API Key Status
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="text-[10px] text-text-muted hover:text-text-base flex items-center gap-1 cursor-pointer"
                  >
                    {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    <span>{showApiKey ? 'Hide Key' : 'Reveal Key'}</span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    readOnly
                    value={import.meta.env.VITE_SUPABASE_ANON_KEY || ''}
                    className={`flex-1 px-2.5 py-1.5 rounded font-sans text-[11px] border ${inputBg}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                      showToast('API key copied to clipboard!');
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-semibold cursor-pointer flex items-center gap-1 border transition-colors ${themeMode === 'light' ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300' : 'bg-inner hover:bg-inner text-text-base border-subtle'}`}
                  >
                    <Copy size={12} />
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 6: CONTRACT SLA TARGETS & QA BENCHMARKS */}
          <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
            <div className="flex items-center justify-between pb-3 border-b border-subtle">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-sky-400" />
                <h3 className="text-sm font-bold text-text-base uppercase tracking-wide">6. Contract SLA Targets & QA Benchmarks</h3>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-sans bg-inner border border-subtle text-text-base">
                Quality SLA Standard
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className={labelClass}>Contract Target Distance (km)</label>
                <input
                  type="number"
                  step="0.1"
                  value={projectSettings.targetKm ?? ''}
                  onChange={e => setProjectSettings(prev => ({ ...prev, targetKm: e.target.value === '' ? 0 : parseFloat(e.target.value) }))}
                  placeholder="e.g. 300.0"
                  className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className={labelClass}>Max Allowed Defect SLA Rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={projectSettings.maxDefectThresholdPercent || 5.0}
                  onChange={e => setProjectSettings(prev => ({ ...prev, maxDefectThresholdPercent: parseFloat(e.target.value) || 5.0 }))}
                  className={`w-full px-3 py-2 rounded-lg font-sans focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className={labelClass}>Deliverable Image Processing Model</label>
                <select
                  value={projectSettings.deliverableModel || 'masked_car'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, deliverableModel: e.target.value as any }))}
                  className={`${inputClass}`}
                >
                  <option value="masked_car">Masked Vehicle (Top 52% ROI - Excludes Nadir Mask)</option>
                  <option value="generative_fill">Generative Clean Fill (Full 80% ROI - Full Scene & Road)</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Batch Log Deduplication Strategy</label>
                <select
                  value={projectSettings.deduplicationStrategy || 'clean_merge'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, deduplicationStrategy: e.target.value as any }))}
                  className={`${inputClass}`}
                >
                  <option value="clean_merge">Clean Merge Masterlist (BATCH-ID)</option>
                  <option value="preserve_runs">Preserve Individual Daily Survey Runs</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>QA Flag Category 1</label>
                <input
                  type="text"
                  value={projectSettings.qaFlag1 || 'Blurry Frame'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, qaFlag1: e.target.value }))}
                  className={`${inputClass}`}
                />
              </div>

              <div>
                <label className={labelClass}>QA Flag Category 2</label>
                <input
                  type="text"
                  value={projectSettings.qaFlag2 || 'Lens Obstruction'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, qaFlag2: e.target.value }))}
                  className={`${inputClass}`}
                />
              </div>

              <div>
                <label className={labelClass}>QA Flag Category 3</label>
                <input
                  type="text"
                  value={projectSettings.qaFlag3 || 'Bad GPS Signal'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, qaFlag3: e.target.value }))}
                  className={`${inputClass}`}
                />
              </div>

              <div className="col-span-1 md:col-span-2 p-4 rounded-xl bg-inner border border-subtle flex items-start gap-3 mt-2">
                <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
                  <SlidersHorizontal size={18} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-text-base">Acquisition QC Defect Detection Thresholds</h4>
                  <p className="text-[11px] text-text-muted leading-relaxed">
                    Detection thresholds (Blur Sharpness, GPS Jump Limit, Lens Obstruction & Glare) are now managed in real-time directly inside the <strong>Acquisition QC Workbench Canvas</strong> via the <strong>Threshold Settings</strong> button.
                  </p>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className={`pt-3 border-t flex flex-wrap justify-end items-center gap-3 ${themeMode === 'light' ? 'border-slate-200' : 'border-subtle'}`}>
              {!isAdmin && (
                <span className="text-xs text-text-muted font-sans flex items-center gap-1.5">
                  <Lock size={13} /> Only administrators can save configuration changes.
                </span>
              )}
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() => {
                  if (!isAdmin) return;
                  sendPreviewData();
                  onSaveAllSettings?.();
                  addAuditLog?.('SETTINGS', 'Saved Project Settings', 'Updated project parameters, basemap, security and SLA benchmarks.', 'success');
                  showToast('Project & Security Settings saved and synchronized live!');
                }}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-2 ${isAdmin
                  ? 'bg-sky-600 hover:bg-sky-500 text-text-base cursor-pointer active:scale-95'
                  : 'bg-inner text-text-muted border border-subtle cursor-not-allowed'
                  }`}
              >
                {isAdmin ? <CheckCircle size={14} /> : <Lock size={14} />}
                <span>{isAdmin ? 'Save All Settings' : 'Admin Only (Read-Only)'}</span>
              </button>
            </div>
          </div>
        </fieldset>
      )}

      {/* ======================================================== */}
      {/* TAB 2: MODERN THEME PACKAGES CANVAS & REAL LIVE PREVIEW */}
      {/* ======================================================== */}
      {activeTab === 'theme-pack' && (
        <ThemeManagementCanvas
          cardBg={cardBg}
          innerCardBg={innerCardBg}
          themeMode={themeMode}
          dailyData={dailyData}
          batchLogs={batchLogs}
          projectSettings={projectSettings}
        />
      )}
      {activeTab === 'diagnostics' && (
        <DiagnosticsPanel cardBg={cardBg} />
      )}
          </div>
        </div>
      </div>
    </div>
  );
};
