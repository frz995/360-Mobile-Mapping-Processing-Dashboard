import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  Check,
  ArrowRight,
  ArrowLeft,
  X,
  Loader2,
  Search
} from 'lucide-react';
import type { UserProject, ProjectDraft } from '../services/projects';
import {
  MALAYSIA_REGIONS,
  regionToGeoJSON,
  ENTIRE_MALAYSIA_ID,
  CUSTOM_REGION_ID,
  type MalaysiaRegion
} from './boundary/malaysiaRegions';
import {
  MALAYSIA_DISTRICTS,
  districtsToGeoJSON,
  ensureDistrictGeometriesLoaded,
  isDistrictGeometriesLoaded
} from './boundary/malaysiaDistricts';
import { THEME_PRESETS, type ThemeKey } from './ThemeSelector';
import { pushWorkspace } from '../utils/urlRouter';

export type GateStage = 'idle' | 'welcome' | 'pick' | 'loading';

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

interface ProjectOnboardingProps {
  stage: GateStage;
  userName?: string;
  projects: UserProject[];
  projectsLoaded: boolean;
  activeProject?: UserProject | null;
  translate?: (key: string) => string;
  onContinue: (project: UserProject) => void;
  onCreateProject: (draft: ProjectDraft) => Promise<{ success: boolean; value?: UserProject; message?: string }>;
  onBackToLanding?: () => void;
  onRefreshProjects?: () => Promise<UserProject[]>;
}

const LOADING_STEPS = [
  'onboardingStepProjects',
  'onboardingStepScope',
  'onboardingStepInit',
  'onboardingStepFinalize'
];

interface RegionPreset {
  id: string;
  name: string;
  tag: string;
  crs: string;
  crsLabel: string;
  bbox: [number, number, number, number];
  bboxLabel: string;
  description: string;
}

const REGION_PRESETS: RegionPreset[] = [
  {
    id: 'peninsular_malaysia',
    name: 'Peninsular Malaysia',
    tag: 'Primary Corridor',
    crs: 'EPSG:3168',
    crsLabel: 'Kertau 1948 RSO Malaya (EPSG:3168)',
    bbox: [99.6, 1.2, 104.6, 6.8],
    bboxLabel: '99.6°E, 1.2°N → 104.6°E, 6.8°N',
    description: 'Federal trunk highways, PLUS expressways, and urban Klang Valley spatial corridors.'
  },
  {
    id: 'sabah',
    name: 'Sabah & Labuan',
    tag: 'Borneo Region',
    crs: 'EPSG:29873',
    crsLabel: 'Timbalai 1948 RSO Borneo (EPSG:29873)',
    bbox: [115.2, 3.9, 119.3, 7.4],
    bboxLabel: '115.2°E, 3.9°N → 119.3°E, 7.4°N',
    description: 'Pan-Borneo highway Sabah corridor, coastal routes, and mountainous Crocker Range trajectories.'
  },
  {
    id: 'sarawak',
    name: 'Sarawak',
    tag: 'Borneo Region',
    crs: 'EPSG:29874',
    crsLabel: 'Timbalai 1948 RSO Sarawak (EPSG:29874)',
    bbox: [109.6, 0.8, 115.6, 5.0],
    bboxLabel: '109.6°E, 0.8°N → 115.6°E, 5.0°N',
    description: 'Extensive Pan-Borneo Sarawak coastal trunk roads, river crossings, and rural interior networks.'
  }
];

const BASEMAP_OPTIONS = [
  { id: 'dark', label: 'Dark Studio' },
  { id: 'satellite', label: 'Satellite Hybrid' },
  { id: 'topo', label: 'Topographic Terrain' },
  { id: 'osm', label: 'OpenStreetMap' }
];

const AUTHORITY_PRESETS = [
  'JKR Malaysia',
  'LLM Expressway',
  'DBKL City Council',
  'State JKR',
  'Highway Concessionaire'
];

/**
 * Ambient 3D Digital Twin Video Backdrop
 * Renders an optimized, looping ambient digital twin city visualization
 * with radial gradient masks for text contrast and poster fallback.
 */
const OnboardingVideoBackground: React.FC<{ opacity?: number; blur?: boolean; brightness?: number }> = ({
  opacity = 0.55,
  blur = false,
  brightness = 1.22
}) => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
    <video
      autoPlay
      loop
      muted
      playsInline
      poster="/screenshots/onboarding.jpg"
      className={`w-full h-full object-cover transition-opacity duration-1000 ${blur ? 'blur-[1px]' : ''}`}
      style={{
        opacity,
        filter: `brightness(${brightness}) contrast(1.05)`
      }}
    >
      <source src="/screenshots/video%20onboarding.mp4?v=3" type="video/mp4" />
    </video>
    {/* Atmospheric gradient overlay for contrast */}
    <div className="absolute inset-0 bg-gradient-to-t from-app/75 via-transparent to-app/20" />
    <div
      className="absolute inset-0"
      style={{
        background: 'radial-gradient(ellipse at center, transparent 35%, var(--bg-app) 88%)'
      }}
    />
  </div>
);

/**
 * Embedded Map Dashboard Component
 * Embeds the WebGIS map application via iframe with postMessage synchronization.
 * Includes a clean Leaflet OpenStreetMap fallback (no watermark, no API key required).
 */
const EmbeddedMapDashboard: React.FC<{
  region: MalaysiaRegion;
  selectedDistrictIds: string[];
  geoJson: any;
  bbox: [number, number, number, number];
  themeMode: string;
  basemap: string;
}> = ({ region, selectedDistrictIds, geoJson, bbox, themeMode, basemap }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const geoLayerRef = useRef<any>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  const mapUrl = useMemo(() => {
    return `${import.meta.env.VITE_MAP_URL || ''}/?embed=true&preview=true&previewMode=true&no3D=true&hide3D=true&theme=${themeMode}&basemap=${basemap}`;
  }, [themeMode, basemap]);

  // Broadcast boundary to the embedded map dashboard iframe
  const sendBoundaryToIframe = useCallback(() => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_PROJECT_BOUNDARY',
        geojson: geoJson,
        bbox
      }, '*');
      iframeRef.current.contentWindow.postMessage({
        type: 'DIM_OUTSIDE_BOUNDARY',
        enabled: false
      }, '*');
    } catch {}
  }, [geoJson, bbox]);

  // Synchronize cleanly on boundary change or iframe load (without interrupted retries)
  useEffect(() => {
    if (iframeLoaded) {
      sendBoundaryToIframe();
    }
  }, [iframeLoaded, sendBoundaryToIframe]);

  // Fallback Leaflet map using OpenStreetMap (100% free, NO watermark, NO API key required)
  useEffect(() => {
    let isMounted = true;
    const initFallback = async () => {
      if (iframeLoaded || !containerRef.current || typeof window === 'undefined') return;
      let L = (window as any).L;
      if (!L) {
        try {
          const mod = await import('leaflet');
          L = mod.default || mod;
        } catch {
          return;
        }
      }
      if (!isMounted || !containerRef.current) return;

      if (!mapRef.current) {
        const center: [number, number] = region.center || [
          (bbox[1] + bbox[3]) / 2,
          (bbox[0] + bbox[2]) / 2
        ];
        try {
          const map = L.map(containerRef.current, {
            center,
            zoom: region.zoom || 6,
            zoomControl: false,
            attributionControl: false
          });

          // Standard OpenStreetMap tiles - completely clean with zero API key watermark
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18,
            opacity: 0.9
          }).addTo(map);

          mapRef.current = map;
        } catch {
          return;
        }
      }

      if (mapRef.current && geoJson) {
        if (geoLayerRef.current) {
          try {
            mapRef.current.removeLayer(geoLayerRef.current);
          } catch {}
          geoLayerRef.current = null;
        }

        try {
          const layer = L.geoJSON(geoJson, {
            style: {
              color: '#38bdf8',
              weight: 2,
              fillColor: '#38bdf8',
              fillOpacity: 0.16
            }
          }).addTo(mapRef.current);

          geoLayerRef.current = layer;
          const bounds = layer.getBounds();
          if (bounds.isValid()) {
            mapRef.current.fitBounds(bounds, { padding: [25, 25], maxZoom: 14, animate: true, duration: 0.5 });
          } else if (Array.isArray(bbox) && bbox.length === 4) {
            mapRef.current.fitBounds([
              [bbox[1], bbox[0]],
              [bbox[3], bbox[2]]
            ], { padding: [25, 25], maxZoom: 14, animate: true, duration: 0.5 });
          }
        } catch {}
      }
    };

    initFallback();

    return () => {
      isMounted = false;
    };
  }, [iframeLoaded, region, geoJson, bbox]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {}
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full h-64 sm:h-72 rounded-xl border border-subtle overflow-hidden bg-inner flex items-center justify-center">
      {/* Primary: Embedded WebGIS Map Iframe */}
      {import.meta.env.VITE_MAP_URL ? (
        <iframe
          ref={iframeRef}
          src={mapUrl}
          onLoad={() => {
            setIframeLoaded(true);
            sendBoundaryToIframe();
            setTimeout(sendBoundaryToIframe, 400);
            setTimeout(sendBoundaryToIframe, 1200);
          }}
          className="w-full h-full border-0"
          title="Embedded WebGIS Map Dashboard"
          allow="geolocation; camera; accelerometer; gyroscope"
        />
      ) : (
        /* Fallback: Clean Leaflet Map without any watermark */
        <div ref={containerRef} className="absolute inset-0 w-full h-full z-0" />
      )}

      {/* Floating Status Badge */}
      <div className="absolute top-2.5 left-2.5 z-20 pointer-events-none flex items-center gap-2">
        <div className="px-2.5 py-1 rounded-md bg-card/90 backdrop-blur border border-subtle shadow-sm flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-[11px] font-semibold text-text-base">{region.name}</span>
          {selectedDistrictIds.length > 0 && (
            <span className="text-[10px] text-text-muted">
              ({selectedDistrictIds.length} district{selectedDistrictIds.length > 1 ? 's' : ''})
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const ProjectOnboarding: React.FC<ProjectOnboardingProps> = ({
  stage,
  userName,
  projects,
  projectsLoaded,
  activeProject,
  translate = (k) => k,
  onContinue,
  onCreateProject,
  onBackToLanding,
  onRefreshProjects
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  // Smooth 0→~100 continuous progress for the telemetry loading bar (driven by
  // elapsed time, so the bar visibly animates even between checklist steps).
  const [loadingProgress, setLoadingProgress] = useState(0);

  // Submode: 'resume' for returning users, 'wizard' for StartGlobal multi-step
  const [mode, setMode] = useState<'resume' | 'wizard'>('resume');
  const [wizardStep, setWizardStep] = useState<number>(1);

  // Form state
  const [campaignName, setCampaignName] = useState('');
  const [contractCode, setContractCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('peninsular_malaysia');
  const [selectedBasemap, setSelectedBasemap] = useState('dark');

  // Step 3: Project Boundary & District state
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string>(ENTIRE_MALAYSIA_ID);
  const [selectedDistrictIds, setSelectedDistrictIds] = useState<string[]>([]);
  const [districtSearchQuery, setDistrictSearchQuery] = useState('');

  // Step 4: Theme Selection state (synced with current system theme)
  const [selectedTheme, setSelectedTheme] = useState<ThemeKey>(() => {
    try {
      return (localStorage.getItem('app_dashboard_theme') as ThemeKey) || 'graphite';
    } catch {
      return 'graphite';
    }
  });

  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [geometriesLoaded, setGeometriesLoaded] = useState(isDistrictGeometriesLoaded());

  // Load full district MultiPolygon geometries on wizard step 3
  useEffect(() => {
    if (wizardStep === 3) {
      ensureDistrictGeometriesLoaded()
        .then(() => setGeometriesLoaded(true))
        .catch(() => {});
    }
  }, [wizardStep]);

  // Animated loading step ticker + continuous progress bar. Progress advances
  // on a smooth elapsed-time curve, reaching 100% (and ticking every checklist
  // step) so the loading screen always visibly completes before dismissal.
  useEffect(() => {
    if (stage !== 'loading') return;
    setStepIndex(0);
    setLoadingProgress(0);
    const t0 = Date.now();
    // Time (ms) for the bar to reach full completion. Kept in sync with the
    // gate dismissal window in App.tsx so the "complete" state is seen first.
    const DURATION_MS = 3000;
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - t0;
      const pct = Math.min(1, (elapsed / DURATION_MS) ** 0.62);
      setLoadingProgress(pct);
      const next = Math.min(LOADING_STEPS.length, Math.floor(pct * LOADING_STEPS.length));
      setStepIndex(next);
      if (pct < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  // Auto-refresh projects when pick stage opens
  useEffect(() => {
    if (stage === 'pick' && !projectsLoaded && onRefreshProjects) {
      onRefreshProjects();
    }
  }, [stage, projectsLoaded, onRefreshProjects]);

  const recent = useMemo(() => projects.slice(0, 6), [projects]);
  const lastProject = activeProject || recent[0] || null;

  // If user has zero projects, start directly in wizard mode
  useEffect(() => {
    if (projectsLoaded && recent.length === 0) {
      setMode('wizard');
    }
  }, [projectsLoaded, recent.length]);

  const activeRegionData = useMemo(() => {
    return REGION_PRESETS.find((r) => r.id === selectedRegion) || REGION_PRESETS[0];
  }, [selectedRegion]);

  const activeBoundaryData = useMemo(() => {
    return (
      MALAYSIA_REGIONS.find((r) => r.id === selectedBoundaryId) ||
      MALAYSIA_REGIONS.find((r) => r.id === ENTIRE_MALAYSIA_ID) ||
      MALAYSIA_REGIONS[0]
    );
  }, [selectedBoundaryId]);

  // Districts available inside the currently selected region
  const availableDistricts = useMemo(() => {
    if (!activeBoundaryData || activeBoundaryData.id === CUSTOM_REGION_ID) return [];
    if (activeBoundaryData.id === 'malaysia') return MALAYSIA_DISTRICTS;
    const cleanRegionName = activeBoundaryData.name.toLowerCase().replace(/^w\.?p\.?\s*/i, '').trim();
    return MALAYSIA_DISTRICTS.filter((d) => {
      const cleanStateName = d.stateName.toLowerCase().replace(/^w\.?p\.?\s*/i, '').trim();
      return cleanStateName === cleanRegionName || d.stateName.toLowerCase() === activeBoundaryData.name.toLowerCase();
    });
  }, [activeBoundaryData]);

  const filteredDistricts = useMemo(() => {
    if (!districtSearchQuery.trim()) return availableDistricts;
    const q = districtSearchQuery.toLowerCase().trim();
    return availableDistricts.filter((d) => d.name.toLowerCase().includes(q));
  }, [availableDistricts, districtSearchQuery]);

  // Combined GeoJSON & bbox (Region or Selected Districts)
  const activeBoundaryGeo = useMemo(() => {
    if (selectedDistrictIds.length > 0) {
      const chosen = MALAYSIA_DISTRICTS.filter((d) => selectedDistrictIds.includes(d.id));
      const dGeo = districtsToGeoJSON(chosen);
      if (dGeo) return dGeo;
    }
    return regionToGeoJSON(activeBoundaryData);
  }, [activeBoundaryData, selectedDistrictIds, geometriesLoaded]);

  const activeThemeData = useMemo(() => {
    return THEME_PRESETS.find((t) => t.id === selectedTheme) || THEME_PRESETS[0];
  }, [selectedTheme]);

  const cleanName = useMemo(() => {
    if (!userName) return '';
    let raw = userName.includes('@') ? userName.split('@')[0] : userName;
    raw = raw.replace(/[._-]+/g, ' ').trim();
    if (!raw) return '';
    return raw
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }, [userName]);

  const displayName = cleanName || 'there';

  const handleSelectTheme = (themeId: ThemeKey) => {
    setSelectedTheme(themeId);
    document.documentElement.setAttribute('data-theme', themeId);
    try {
      localStorage.setItem('app_dashboard_theme', themeId);
    } catch {}
    window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: themeId }));
  };

  const handleCreateAndLaunch = async () => {
    if (!campaignName.trim() || creating) return;
    setCreating(true);
    setErrorMsg(null);
    try {
      const res = await onCreateProject({
        name: campaignName.trim(),
        description: description.trim(),
        contractCode: contractCode.trim() || undefined,
        clientName: clientName.trim() || undefined,
        region: selectedRegion,
        status: 'active',
        scope: {
          crs: activeRegionData.crs,
          region: selectedRegion,
          bbox: activeBoundaryGeo.bbox,
          basemap: selectedBasemap,
          theme: selectedTheme,
          enableBBoxFilter: true,
          projectBoundary: {
            regionId: activeBoundaryData.id,
            regionName: activeBoundaryData.name,
            districtIds: selectedDistrictIds,
            geojson: activeBoundaryGeo.geojson,
            bbox: activeBoundaryGeo.bbox,
            focusActive: true
          }
        }
      });
      if (res.success && res.value) {
        onContinue(res.value);
      } else if (!res.success) {
        setErrorMsg(res.message || 'Failed to create campaign project.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'An unexpected error occurred.');
    } finally {
      setCreating(false);
    }
  };

  if (stage === 'idle') return null;

  return (
    <div className="fixed inset-0 z-[5000] bg-app flex flex-col justify-between overflow-hidden select-none text-text-base">
      {/* STAGE 1: WELCOME SCREEN */}
      {stage === 'welcome' && (
        <div className="relative h-full w-full flex flex-col items-center justify-center px-6">
          <OnboardingVideoBackground opacity={0.4} />

          <div className="relative z-10 p-8 rounded-2xl bg-card/75 backdrop-blur-md border border-subtle/80 shadow-2xl flex flex-col items-center max-w-md text-center">
            <div className="w-12 h-12 rounded-xl bg-card border border-subtle flex items-center justify-center mb-5 text-text-base shadow-sm">
              <span className="font-bold text-sm">360</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-text-base tracking-tight text-center">
              {translate('onboardingWelcome').replace('{name}', displayName)}
            </h1>
            <p className="mt-2 text-xs sm:text-sm text-text-muted max-w-sm text-center leading-relaxed">
              {translate('onboardingWelcomeSub')}
            </p>
            <div className="mt-8 w-36 h-1 bg-inner rounded-full overflow-hidden">
              <div className="h-full w-1/2 bg-text-muted/60 rounded-full animate-pulse" />
            </div>
            <button
              onClick={() => {
                setMode('wizard');
              }}
              className="mt-6 text-xs text-text-muted hover:text-text-base transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>Proceed to Workspace</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* STAGE 2: PICK OR STARTGLOBAL WIZARD */}
      {stage === 'pick' && (
        <div className="relative h-full w-full flex flex-col overflow-hidden">
          {/* CLEAN TOP BAR */}
          <header className="relative h-14 px-6 sm:px-8 border-b border-subtle bg-card flex items-center justify-between shrink-0 z-10">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-text-base tracking-tight">GeoSphere 360</span>
            </div>

            {/* Stepper Progress (Clean, restrained StartGlobal 5-step centered in header) */}
            {mode === 'wizard' && (
              <div className="hidden md:flex items-center gap-1.5 text-xs text-text-muted absolute left-1/2 -translate-x-1/2">
                {[
                  { step: 1, label: translate('onboardingStepIdentity') || 'Define Project' },
                  { step: 2, label: translate('onboardingStepGeodetic') || 'Spatial Scope' },
                  { step: 3, label: translate('onboardingStepBoundary') || 'Project Boundary' },
                  { step: 4, label: translate('onboardingStepTheme') || 'Theme & Style' },
                  { step: 5, label: translate('onboardingStepReview') || 'Review' }
                ].map((item, idx) => {
                  const isActive = wizardStep === item.step;
                  const isDone = wizardStep > item.step;
                  return (
                    <React.Fragment key={item.step}>
                      {idx > 0 && <span className="text-subtle mx-1">/</span>}
                      <button
                        onClick={() => {
                          if (item.step < wizardStep || campaignName.trim()) {
                            setWizardStep(item.step);
                          }
                        }}
                        className={`px-2 py-1 rounded text-[11px] transition-colors ${
                          isActive
                            ? 'font-semibold text-text-base'
                            : isDone
                            ? 'text-text-muted hover:text-text-base cursor-pointer'
                            : 'text-text-muted/40 cursor-not-allowed'
                        }`}
                      >
                        {item.step}. {item.label}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* Top Right Actions */}
            <div className="flex items-center gap-3">
              {mode === 'wizard' && recent.length > 0 && (
                <button
                  onClick={() => setMode('resume')}
                  className="text-xs text-text-muted hover:text-text-base transition-colors px-2.5 py-1 rounded hover:bg-inner flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft size={12} />
                  <span className="hidden sm:inline">{translate('onboardingBackToProjects') || 'Back to Projects'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (onBackToLanding) {
                    onBackToLanding();
                  } else {
                    pushWorkspace('landing');
                  }
                }}
                className="text-xs text-text-muted hover:text-text-base transition-colors px-2 py-1 rounded hover:bg-inner flex items-center gap-1.5 cursor-pointer"
                title="Back to Landing Page"
              >
                <ArrowLeft size={13} />
                <span>Back</span>
              </button>
            </div>
          </header>

          {/* MAIN BODY AREA */}
          <div className="relative flex-1 overflow-y-auto px-4 sm:px-8 py-8 flex justify-center">
            {/* Ambient full screen back canvas (brightened for clear visibility) */}
            <OnboardingVideoBackground opacity={0.55} blur={false} />

            {/* ---------------- SUB-MODE A: FAST RESUME SCREEN ---------------- */}
            {mode === 'resume' && recent.length > 0 && (
              <div className="relative z-10 w-full max-w-xl flex flex-col gap-5 my-auto animate-step-in">
                  <div className="text-center">
                    <h1 className="text-xl sm:text-2xl font-semibold text-text-base tracking-tight text-center">
                      {cleanName
                        ? translate('onboardingPickTitle').replace('{name}', cleanName)
                        : translate('onboardingResumeTitle') || 'Welcome Back to GeoSphere 360'}
                    </h1>
                    <p className="mt-1.5 text-xs text-text-muted text-center max-w-md mx-auto">
                      {translate('onboardingResumeSub') || 'Jump directly into your active spatial trajectory project or initialize a new campaign.'}
                    </p>
                  </div>

                  {/* Last Opened Project Card */}
                  {lastProject && (
                    <button
                      onClick={() => onContinue(lastProject)}
                      className="w-full p-4 bg-card/85 backdrop-blur-md border border-subtle/80 hover:border-text-muted/80 shadow-2xl rounded-xl transition-all cursor-pointer text-left flex items-center justify-between gap-4 group"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                            {translate('onboardingLastOpened') || 'Active Project'}
                          </span>
                          {lastProject.lastOpenedAt && (
                            <span className="text-[10px] text-text-muted/70">
                              • {formatRelativeTime(lastProject.lastOpenedAt)}
                            </span>
                          )}
                        </div>
                        <h2 className="text-sm font-semibold text-text-base truncate">
                          {lastProject.name}
                        </h2>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                          {lastProject.contractCode && (
                            <span className="font-mono">{lastProject.contractCode}</span>
                          )}
                          {lastProject.contractCode && <span>•</span>}
                          <span className="capitalize">{lastProject.region.replace(/_/g, ' ')}</span>
                          {lastProject.scope?.crs && (
                            <>
                              <span>•</span>
                              <span className="font-mono">{lastProject.scope.crs}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-text-muted group-hover:text-text-base shrink-0 font-medium text-xs transition-colors">
                        <span className="hidden sm:inline">Launch Workspace</span>
                        <ArrowRight size={14} />
                      </div>
                    </button>
                  )}

                  {/* Other recent projects */}
                  {recent.length > 1 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[11px] font-semibold text-text-muted">
                        Recent Projects
                      </span>
                      <div className="flex flex-col gap-2">
                        {recent
                          .filter((p) => p.id !== lastProject?.id)
                          .slice(0, 4)
                          .map((p) => (
                            <button
                              key={p.id}
                              onClick={() => onContinue(p)}
                              className="w-full p-3 bg-card/85 backdrop-blur-md border border-subtle/80 hover:border-text-muted/80 shadow-md rounded-lg transition-all cursor-pointer text-left flex items-center justify-between gap-3 group"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-text-base truncate group-hover:text-text-base">
                                  {p.name}
                                </div>
                                <div className="text-[10px] text-text-muted truncate">
                                  {p.contractCode || p.region.replace(/_/g, ' ')}
                                </div>
                              </div>
                              <span className="text-text-muted/40 group-hover:text-text-base text-xs transition-colors shrink-0">
                                →
                              </span>
                            </button>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Primary Action Button to Enter Wizard */}
                  <div className="pt-2 flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('wizard');
                        setWizardStep(1);
                      }}
                      className="w-full py-2.5 px-4 bg-inner/80 backdrop-blur-md hover:bg-card/90 border border-subtle/80 hover:border-text-muted/60 text-text-base text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                    >
                      <span>{translate('onboardingNewCampaignBtn') || '+ Create Project'}</span>
                      <ArrowRight size={13} />
                    </button>
                    <p className="text-[11px] text-text-muted text-center">
                      Launch the guided campaign setup space to configure boundary envelope, themes, and geodetic CRS.
                    </p>
                  </div>
                </div>
            )}

            {/* ---------------- SUB-MODE B: CLEAN STARTGLOBAL 2-COLUMN WIZARD ---------------- */}
            {mode === 'wizard' && (
              <div className="relative z-10 w-full max-w-4xl grid lg:grid-cols-[1.3fr_1fr] gap-8 items-start my-auto animate-step-in">
                {/* LEFT COLUMN: Clean Minimal Form */}
                <div className="flex flex-col gap-5">
                  <div>
                    <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                      Step {wizardStep} of 5 • {
                        wizardStep === 1 ? 'Define Project' :
                        wizardStep === 2 ? 'Spatial Scope' :
                        wizardStep === 3 ? 'Project Boundary' :
                        wizardStep === 4 ? 'Theme & Appearance' : 'Review'
                      }
                    </span>
                    <h2 className="text-xl sm:text-2xl font-bold text-text-base tracking-tight">
                      {wizardStep === 1 && 'Define Project'}
                      {wizardStep === 2 && 'Geodetic Spatial Scope'}
                      {wizardStep === 3 && 'Map Project Boundary'}
                      {wizardStep === 4 && 'Workspace Theme & Style'}
                      {wizardStep === 5 && 'Review Campaign Manifest'}
                    </h2>
                    <p className="mt-1 text-xs text-text-muted leading-relaxed">
                      {wizardStep === 1 && (translate('onboardingStep1Sub') || 'Set the official project name, procurement reference code, and procuring authority.')}
                      {wizardStep === 2 && (translate('onboardingStep2Sub') || 'Select the Malaysian geodetic coordinate reference system (CRS) and geographic coverage bounds.')}
                      {wizardStep === 3 && (translate('onboardingStep3Sub') || 'Select project geographic boundary limits and operational coverage area.')}
                      {wizardStep === 4 && (translate('onboardingStep4Sub') || 'Choose your preferred visual theme for the spatial processing dashboard and map interface.')}
                      {wizardStep === 5 && (translate('onboardingStep5Sub') || 'Verify campaign GIS parameters before initializing the spatial workspace.')}
                    </p>
                  </div>

                  {errorMsg && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                      <X size={14} className="shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  {/* ---------------- STEP 1: IDENTITY ---------------- */}
                  {wizardStep === 1 && (
                    <div className="flex flex-col gap-4 animate-step-in">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-text-muted">
                          Campaign / Project Name <span className="text-text-base">*</span>
                        </label>
                        <input
                          type="text"
                          value={campaignName}
                          onChange={(e) => setCampaignName(e.target.value)}
                          placeholder="e.g. Federal Route 1 MMS Survey 2025"
                          className="w-full px-3.5 py-2.5 bg-inner border border-subtle rounded-xl text-xs text-text-base placeholder:text-text-muted/40 focus:outline-none focus:border-text-muted transition-colors"
                        />
                        <span className="text-[11px] text-text-muted/70">
                          Official title displayed across WebGIS map, batch exports, and QA ledgers.
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-text-muted">
                          Contract / Job Reference
                        </label>
                        <input
                          type="text"
                          value={contractCode}
                          onChange={(e) => setContractCode(e.target.value)}
                          placeholder="e.g. JKR/IP/RSO/2025-04"
                          className="w-full px-3.5 py-2.5 bg-inner border border-subtle rounded-xl text-xs text-text-base placeholder:text-text-muted/40 focus:outline-none focus:border-text-muted transition-colors"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-text-muted">
                          Procuring Client / Department Authority
                        </label>
                        <input
                          type="text"
                          value={clientName}
                          onChange={(e) => setClientName(e.target.value)}
                          placeholder="e.g. Jabatan Kerja Raya (JKR) Malaysia"
                          className="w-full px-3.5 py-2.5 bg-inner border border-subtle rounded-xl text-xs text-text-base placeholder:text-text-muted/40 focus:outline-none focus:border-text-muted transition-colors"
                        />
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[10px] text-text-muted/70 mr-1">Quick Select:</span>
                          {AUTHORITY_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setClientName(preset)}
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-md border transition-all cursor-pointer ${
                                clientName === preset
                                  ? 'bg-inner border-text-base text-text-base'
                                  : 'bg-card border-subtle text-text-muted hover:text-text-base'
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-text-muted">
                          Survey Description / Objective
                        </label>
                        <textarea
                          rows={2}
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="e.g. High-density 360 mobile mapping pavement condition assessment."
                          className="w-full px-3.5 py-2.5 bg-inner border border-subtle rounded-xl text-xs text-text-base placeholder:text-text-muted/40 focus:outline-none focus:border-text-muted resize-none transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  {/* ---------------- STEP 2: GEODETIC SCOPE & REGION ---------------- */}
                  {wizardStep === 2 && (
                    <div className="flex flex-col gap-4 animate-step-in">
                      <label className="text-xs font-medium text-text-muted">
                        Select Regional Spatial Bounds &amp; Coordinate Reference System
                      </label>

                      <div className="flex flex-col gap-2.5">
                        {REGION_PRESETS.map((region) => {
                          const isSelected = selectedRegion === region.id;
                          return (
                            <div
                              key={region.id}
                              onClick={() => setSelectedRegion(region.id)}
                              className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                                isSelected
                                  ? 'bg-inner border-text-base text-text-base'
                                  : 'bg-card border-subtle hover:border-text-muted/50 text-text-muted'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-xs sm:text-sm font-semibold text-text-base">
                                    {region.name}
                                  </h3>
                                  <span className="text-[10px] text-text-muted border border-subtle px-1.5 py-0.5 rounded">
                                    {region.tag}
                                  </span>
                                </div>
                                <p className="text-[11px] text-text-muted leading-relaxed mt-1">
                                  {region.description}
                                </p>
                                <div className="mt-1.5 text-[10px] font-mono text-text-muted">
                                  {region.crsLabel}
                                </div>
                              </div>

                              <div
                                className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 transition-all ${
                                  isSelected
                                    ? 'border-text-base bg-text-base text-app'
                                    : 'border-subtle bg-inner'
                                }`}
                              >
                                {isSelected && <Check size={10} strokeWidth={3} />}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="pt-2 flex flex-col gap-2">
                        <label className="text-xs font-medium text-text-muted">
                          Basemap Layer
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {BASEMAP_OPTIONS.map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSelectedBasemap(opt.id)}
                              className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                                selectedBasemap === opt.id
                                  ? 'bg-inner border-text-base text-text-base'
                                  : 'bg-card border-subtle text-text-muted hover:text-text-base'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ---------------- STEP 3: MAP PROJECT BOUNDARY (REGION & DISTRICT ONLY) ---------------- */}
                  {wizardStep === 3 && (
                    <div className="flex flex-col gap-4 animate-step-in">
                      {/* Region Choice */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-text-muted">
                          Malaysia Region
                        </label>
                        <select
                          value={selectedBoundaryId}
                          onChange={(e) => {
                            setSelectedBoundaryId(e.target.value);
                            setSelectedDistrictIds([]);
                          }}
                          className="w-full px-3.5 py-2.5 bg-inner border border-subtle rounded-xl text-xs text-text-base focus:outline-none focus:border-text-muted transition-colors cursor-pointer"
                        >
                          <option value={ENTIRE_MALAYSIA_ID}>Whole Malaysia (All States &amp; Federal Territories)</option>
                          {MALAYSIA_REGIONS.filter((r) => r.id !== CUSTOM_REGION_ID && r.id !== ENTIRE_MALAYSIA_ID).map((region) => (
                            <option key={region.id} value={region.id} className="bg-card text-text-base">
                              {region.name} ({region.group})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* District Choice (Multi-choice) */}
                      {availableDistricts.length > 0 && (
                        <div className="flex flex-col gap-2 pt-1 border-t border-subtle/50">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-xs font-medium text-text-muted flex items-center gap-1.5">
                              <span>District Boundary</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-semibold border border-sky-500/20">
                                {selectedDistrictIds.length > 0
                                  ? `${selectedDistrictIds.length} of ${availableDistricts.length} selected`
                                  : 'All Districts (Whole State)'}
                              </span>
                            </label>
                            <div className="flex items-center gap-2 text-[10px]">
                              <button
                                type="button"
                                onClick={() => setSelectedDistrictIds(availableDistricts.map((d) => d.id))}
                                className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
                              >
                                Select All
                              </button>
                              <span className="text-text-muted">·</span>
                              <button
                                type="button"
                                onClick={() => setSelectedDistrictIds([])}
                                className="text-text-muted hover:text-text-base font-medium cursor-pointer"
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
                                placeholder={`Filter ${availableDistricts.length} districts in ${activeBoundaryData.name}...`}
                                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-subtle bg-inner text-text-base placeholder:text-text-muted/40 focus:outline-none focus:border-text-muted"
                              />
                            </div>
                          )}

                          {/* District Multi-choice Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-1.5 rounded-lg border border-subtle bg-inner/40">
                            {filteredDistricts.map((d) => {
                              const isSelected = selectedDistrictIds.includes(d.id);
                              return (
                                <label
                                  key={d.id}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs cursor-pointer select-none transition-all ${
                                    isSelected
                                      ? 'bg-sky-500/15 border-sky-400/50 text-sky-300 font-semibold'
                                      : 'bg-card border-subtle text-text-muted hover:text-text-base hover:border-subtle/80'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      setSelectedDistrictIds((prev) =>
                                        prev.includes(d.id) ? prev.filter((id) => id !== d.id) : [...prev, d.id]
                                      );
                                    }}
                                    className="rounded border-subtle bg-card text-sky-500 focus:ring-0 accent-sky-400 cursor-pointer shrink-0"
                                  />
                                  <span className="truncate text-[11px]" title={d.name}>{d.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Embedded Map Dashboard */}
                      <EmbeddedMapDashboard
                        region={activeBoundaryData}
                        selectedDistrictIds={selectedDistrictIds}
                        geoJson={activeBoundaryGeo.geojson}
                        bbox={activeBoundaryGeo.bbox}
                        themeMode={selectedTheme === 'daylight' || selectedTheme === 'alabaster' ? 'light' : 'dark'}
                        basemap={selectedBasemap}
                      />
                    </div>
                  )}

                  {/* ---------------- STEP 4: WORKSPACE THEME SELECTION ---------------- */}
                  {wizardStep === 4 && (
                    <div className="flex flex-col gap-4 animate-step-in">
                      <label className="text-xs font-medium text-text-muted">
                        Select Workspace Visual Palette &amp; Map Appearance
                      </label>

                      <div className="grid sm:grid-cols-2 gap-2.5">
                        {THEME_PRESETS.map((preset) => {
                          const isSelected = selectedTheme === preset.id;
                          return (
                            <div
                              key={preset.id}
                              onClick={() => handleSelectTheme(preset.id)}
                              className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                                isSelected
                                  ? 'bg-inner border-text-base text-text-base shadow-sm'
                                  : 'bg-card border-subtle hover:border-text-muted/50 text-text-muted'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-xs sm:text-sm font-semibold text-text-base">
                                      {preset.name}
                                    </h4>
                                    <span className="text-[10px] text-text-muted border border-subtle px-1.5 py-0.5 rounded">
                                      {preset.badge}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-text-muted leading-relaxed mt-1 line-clamp-2">
                                    {preset.tagline}
                                  </p>
                                </div>

                                <div
                                  className={`w-4 h-4 rounded-full border mt-0.5 flex items-center justify-center shrink-0 transition-all ${
                                    isSelected
                                      ? 'border-text-base bg-text-base text-app'
                                      : 'border-subtle bg-inner'
                                  }`}
                                >
                                  {isSelected && <Check size={10} strokeWidth={3} />}
                                </div>
                              </div>

                              <div className="pt-2 border-t border-subtle flex items-center justify-between">
                                {/* 4 Color Swatch circles */}
                                <div className="flex items-center gap-1.5">
                                  <div
                                    className="w-3.5 h-3.5 rounded-full border border-subtle shadow-inner"
                                    style={{ backgroundColor: preset.bgApp }}
                                    title="Canvas Background"
                                  />
                                  <div
                                    className="w-3.5 h-3.5 rounded-full border border-subtle shadow-inner"
                                    style={{ backgroundColor: preset.bgCard }}
                                    title="Surface Card"
                                  />
                                  <div
                                    className="w-3.5 h-3.5 rounded-full border border-subtle shadow-inner"
                                    style={{ backgroundColor: preset.accent }}
                                    title="Accent Highlight"
                                  />
                                  <div
                                    className="w-3.5 h-3.5 rounded-full border border-subtle shadow-inner"
                                    style={{ backgroundColor: preset.textPrimary }}
                                    title="Text Primary"
                                  />
                                </div>

                                <span className="text-[10px] text-text-muted font-mono">
                                  {preset.mapStyle}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <p className="text-[11px] text-text-muted/70 leading-relaxed">
                        Selecting a theme dynamically applies the operational contrast and map styling across your entire workspace in real time.
                      </p>
                    </div>
                  )}

                  {/* ---------------- STEP 5: REVIEW & LAUNCH ---------------- */}
                  {wizardStep === 5 && (
                    <div className="flex flex-col gap-4 animate-step-in">
                      {/* 3D Digital Twin Environment Preview Card */}
                      <div className="relative rounded-xl border border-subtle overflow-hidden bg-card/60 shadow-sm aspect-[16/9] flex flex-col justify-between p-3.5 group">
                        <video
                          autoPlay
                          loop
                          muted
                          playsInline
                          poster="/screenshots/onboarding.jpg"
                          className="absolute inset-0 w-full h-full object-cover"
                        >
                          <source src="/screenshots/video%20onboarding.mp4?v=3" type="video/mp4" />
                        </video>
                        {/* High-contrast gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/50 pointer-events-none" />

                        {/* Top indicator badge */}
                        <div className="relative z-10 flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-md border border-white/15 text-[10px] font-mono text-cyan-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            SPATIAL DIGITAL TWIN
                          </span>
                          <span className="text-[10px] font-mono text-white/80 bg-black/55 px-2 py-0.5 rounded border border-white/10 backdrop-blur-sm">
                            {activeRegionData.crsLabel}
                          </span>
                        </div>

                        {/* Bottom preview summary */}
                        <div className="relative z-10 flex items-end justify-between">
                          <div>
                            <span className="text-[10px] uppercase font-semibold tracking-wider text-white/70 block">
                              Target Spatial Environment
                            </span>
                            <span className="text-xs font-semibold text-white">
                              {activeBoundaryData.name} ({activeRegionData.name})
                            </span>
                          </div>
                          <span className="text-[10px] text-cyan-300 font-mono bg-black/40 px-2 py-0.5 rounded backdrop-blur-xs">
                            Ready to Initialize
                          </span>
                        </div>
                      </div>

                      <div className="bg-card border border-subtle rounded-xl p-5 flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-subtle pb-3">
                          <div>
                            <span className="text-[10px] uppercase font-semibold text-text-muted">
                              Ready to Launch
                            </span>
                            <h3 className="text-base font-semibold text-text-base">{campaignName}</h3>
                          </div>
                          <button
                            onClick={() => setWizardStep(1)}
                            className="text-xs text-text-muted hover:text-text-base underline cursor-pointer"
                          >
                            Edit
                          </button>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-[10px] text-text-muted block">
                              Procuring Authority
                            </span>
                            <span className="font-medium text-text-base">
                              {clientName || '—'}
                            </span>
                            {contractCode && (
                              <div className="text-[10px] font-mono text-text-muted mt-0.5">
                                Ref: {contractCode}
                              </div>
                            )}
                          </div>

                          <div>
                            <span className="text-[10px] text-text-muted block">
                              Geodetic Spatial Scope
                            </span>
                            <span className="font-medium text-text-base">{activeRegionData.name}</span>
                            <div className="text-[10px] font-mono text-text-muted mt-0.5">
                              {activeRegionData.crsLabel}
                            </div>
                          </div>

                          <div>
                            <span className="text-[10px] text-text-muted block">
                              Project Geographic Boundary
                            </span>
                            <span className="font-medium text-text-base">
                              {activeBoundaryData.name}
                              {selectedDistrictIds.length > 0 && ` (${selectedDistrictIds.length} districts)`}
                            </span>
                            <div className="text-[10px] font-mono text-text-muted mt-0.5">
                              {activeBoundaryGeo.bbox[0].toFixed(2)}°E → {activeBoundaryGeo.bbox[2].toFixed(2)}°E
                            </div>
                          </div>

                          <div>
                            <span className="text-[10px] text-text-muted block">
                              Workspace Theme &amp; Style
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: activeThemeData.accent }}
                              />
                              <span className="font-medium text-text-base">{activeThemeData.name}</span>
                            </div>
                            <div className="text-[10px] text-text-muted mt-0.5">
                              {activeThemeData.badge} • Basemap: {selectedBasemap}
                            </div>
                          </div>
                        </div>

                        {description && (
                          <div className="border-t border-subtle pt-3 text-xs text-text-muted">
                            <span className="font-medium text-text-base block mb-0.5">Scope Notes:</span>
                            {description}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={creating || !campaignName.trim()}
                        onClick={handleCreateAndLaunch}
                        className="w-full py-3 px-5 bg-text-base hover:bg-text-base/90 text-app font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {creating ? (
                          <span className="flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" />
                            <span>Initializing Campaign...</span>
                          </span>
                        ) : (
                          <>
                            <span>{translate('onboardingLaunchWorkspace') || 'Initialize & Launch Workspace'}</span>
                            <ArrowRight size={14} />
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* BOTTOM STEPPER CONTROLS */}
                  {wizardStep < 5 && (
                    <div className="pt-4 border-t border-subtle flex items-center justify-between gap-4">
                      {wizardStep > 1 ? (
                        <button
                          type="button"
                          onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
                          className="px-3.5 py-2 rounded-lg border border-subtle text-xs font-medium text-text-muted hover:text-text-base hover:bg-inner transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <ArrowLeft size={13} />
                          <span>Back</span>
                        </button>
                      ) : (
                        <div />
                      )}

                      <button
                        type="button"
                        disabled={wizardStep === 1 && !campaignName.trim()}
                        onClick={() => setWizardStep((s) => Math.min(5, s + 1))}
                        className="px-4 py-2 rounded-lg bg-inner hover:bg-card border border-subtle hover:border-text-muted/50 text-text-base text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
                      >
                        <span>Continue</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN: Clean, Restrained Project Overview */}
                <div className="bg-card/90 backdrop-blur-md rounded-2xl border border-subtle p-5 sm:p-6 flex flex-col gap-5 self-center my-auto w-full shadow-2xl">
                  <div className="flex items-center justify-between border-b border-subtle pb-3">
                    <h3 className="text-xs font-bold text-text-base uppercase tracking-wider">
                      Project Overview
                    </h3>
                    <span className="text-[10px] text-text-muted font-mono">
                      Draft
                    </span>
                  </div>

                  {/* Key-Value Summary */}
                  <div className="flex flex-col gap-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Project Title</span>
                      <span className="font-medium text-text-base text-right truncate max-w-[180px]">
                        {campaignName.trim() || 'Untitled Project'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Contract Reference</span>
                      <span className="font-mono text-text-base text-right text-[11px]">
                        {contractCode.trim() || '—'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Procuring Authority</span>
                      <span className="font-medium text-text-base text-right truncate max-w-[180px]">
                        {clientName.trim() || '—'}
                      </span>
                    </div>

                    <div className="h-[1px] bg-subtle my-1" />

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Regional Corridor</span>
                      <span className="font-medium text-text-base text-right">
                        {activeRegionData.name}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Geodetic CRS</span>
                      <span className="font-mono text-text-base text-right text-[11px]">
                        {activeRegionData.crs}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Project Boundary</span>
                      <span className="font-medium text-text-base text-right truncate max-w-[180px]">
                        {activeBoundaryData.name}
                        {selectedDistrictIds.length > 0 && ` (${selectedDistrictIds.length})`}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Workspace Theme</span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: activeThemeData.accent }}
                        />
                        <span className="font-medium text-text-base text-right">
                          {activeThemeData.name}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-text-muted text-[11px]">Basemap Layer</span>
                      <span className="font-medium text-text-base text-right capitalize">
                        {selectedBasemap}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-subtle pt-3 flex items-center justify-between text-[11px] text-text-muted">
                    <span>System Status</span>
                    <span className="flex items-center gap-1.5 text-text-muted">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>Ready to Initialize</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STAGE 3: TELEMETRY LOADING SCREEN */}
      {stage === 'loading' && (
        <div className="relative h-full w-full flex items-center justify-center px-6">
          <OnboardingVideoBackground opacity={0.3} blur={true} />

          <div className="relative z-10 w-full max-w-sm flex flex-col gap-6 animate-step-in">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-inner/80 backdrop-blur-md border border-subtle mb-3 text-text-base shadow-sm">
                <Loader2 size={20} className="animate-spin" />
              </div>
              <h1 className="text-base font-semibold text-text-base tracking-tight">
                {translate('onboardingLoadingTitle')}
              </h1>
              <p className="mt-1 text-xs text-text-muted leading-relaxed">
                {translate('onboardingLoadingSub')}
              </p>
            </div>

            {/* Checklist items */}
            <div className="flex flex-col gap-1.5 bg-card/85 backdrop-blur-md p-4 rounded-xl border border-subtle shadow-xl">
              {LOADING_STEPS.map((key, i) => {
                const done = i < stepIndex;
                const active = i === stepIndex;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors ${
                      active
                        ? 'bg-inner text-text-base'
                        : done
                        ? 'text-text-muted'
                        : 'text-text-muted/30'
                    }`}
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
                        done
                          ? 'text-emerald-400'
                          : active
                          ? 'text-text-base'
                          : 'text-text-muted/20'
                      }`}
                    >
                      {done ? <Check size={11} strokeWidth={2.5} /> : <span className="w-1 h-1 rounded-full bg-current" />}
                    </span>
                    <span className="text-xs">{translate(key)}</span>
                  </div>
                );
              })}
            </div>

            {/* Animated progress bar */}
            <div className="h-1 rounded-full overflow-hidden bg-inner/60 backdrop-blur-sm relative">
              <div
                className="h-full bg-text-base/80 rounded-full transition-all duration-200 loading-bar-shimmer overflow-hidden"
                style={{ width: `${Math.round(loadingProgress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};