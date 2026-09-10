import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// Track a CSS media query from JS (fallback for jsdom test env without matchMedia).
const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState<boolean>(() =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query).matches
            : false
    );
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        onChange();
        mql.addEventListener?.('change', onChange);
        return () => mql.removeEventListener?.('change', onChange);
    }, [query]);
    return matches;
};
import {
    Compass,
    Camera,
    Database,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    Cpu,
    Shield,
    FolderKanban,
    MapPin,
    Loader2,
} from 'lucide-react';
import { usePanoramaViewer } from '../hooks/usePanoramaViewer';
import { StarsBackground } from './common/StarsBackground';
import { SparklesCore } from './common/Sparkles';
import { HoverBorderGradient } from './common/HoverBorderGradient';
import { EarthGlobe, type GlobeMarker } from './common/EarthGlobe';
import { AtomicGlobeHost, type AtomicGlobeMarker } from './common/AtomicGlobeHost';
import { ProjectBoundaryMap } from './common/ProjectBoundaryMap';
import { DISTRICT_METADATA } from './boundary/districtMetadata';
import { MALAYSIA_REGIONS } from './boundary/malaysiaRegions';
import { MALAYSIA_DISTRICTS, districtsToGeoJSON, ensureDistrictGeometriesLoaded } from './boundary/malaysiaDistricts';
import { extractPanotrackPoints, filterPanotrackByBBoxes } from '../utils/panotrackExtractor';
import { getImagesProcessedCount, getPOICount } from '../utils/dashboardData';
import { DistrictProjectPopup, type PanotrackPopupData } from './common/DistrictProjectPopup';

/** Fallback so a WebGL/runtime hiccup inside the vendored AtomicGlobe can never
 *  leave the showcase blank — errors degrade back to the vector SVG EarthGlobe. */
class AtomicGlobeBoundary extends React.Component<
    { markers: GlobeMarker[]; children: React.ReactNode },
    { failed: boolean }
> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: unknown) {
        console.error('[AtomicGlobe] runtime error — falling back to vector globe:', error);
    }
    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <EarthGlobe
                autoRotate
                autoRotateSpeed={1.8}
                markers={this.props.markers}
                oceanColor="#0f1318"
                landFill="#262c34"
                landStroke="#3b434d"
                strokeWidth={0.5}
                glowColor="rgba(255, 255, 255, 0.18)"
                glowIntensity={0.65}
            />
        );
    }
}

/** Load the district (and its state) that a survey coordinate falls in, so the
 *  geodetic card & HUD always have a real district to show even without a committed
 *  boundary. Smallest containing district wins; nearest centre as last resort. */
function findDistrictAt(lat: number, lng: number): { id: string; name: string; state: string; lat: number; lng: number } | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    let best: { meta: typeof DISTRICT_METADATA[number]; area: number } | null = null;
    for (const m of DISTRICT_METADATA) {
        const b = m.bbox;
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
        const area = (b[2] - b[0]) * (b[3] - b[1]);
        if (!best || area < best.area) best = { meta: m, area };
    }
    if (best) {
        return { id: best.meta.id, name: best.meta.name, state: best.meta.stateName, lat: best.meta.center[0], lng: best.meta.center[1] };
    }
    let nearest: { meta: typeof DISTRICT_METADATA[number]; d2: number } | null = null;
    for (const m of DISTRICT_METADATA) {
        const dx = lng - m.center[1];
        const dy = lat - m.center[0];
        const d2 = dx * dx + dy * dy;
        if (!nearest || d2 < nearest.d2) nearest = { meta: m, d2 };
    }
    if (!nearest) return null;
    return { id: nearest.meta.id, name: nearest.meta.name, state: nearest.meta.stateName, lat: nearest.meta.center[0], lng: nearest.meta.center[1] };
}

export interface SystemShowcaseProps {
    onEnterDashboard?: (targetView?: string) => void;
    dailyData?: any[];
    batchLogs?: any[];
    projectSettings?: any;
    activeProject?: any;
}

export interface SectionHotspot {
    id: string;
    x: number; // percentage (0 - 100)
    y: number; // percentage (0 - 100)
    title: string;
    tag: string;
    description: string;
    tip: string;
    stepNumber?: number;
}

interface WorkflowStep {
    step: string;
    action: string;
}

interface SystemModule {
    id: string;
    category: string;
    title: string;
    subtitle: string;
    description: string;
    metricLabel: string;
    metricValue: string;
    statusBadge: string;
    images: string[];
    icon: React.ElementType;
    workflow: WorkflowStep[];
    specs: { label: string; value: string }[];
    hotspots: SectionHotspot[];
}

export const SystemShowcase: React.FC<SystemShowcaseProps> = ({
    onEnterDashboard,
    dailyData = [],
    batchLogs = [],
    projectSettings,
    activeProject
}) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [activePhotoIdx, setActivePhotoIdx] = useState(0);
    const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const isMobile = useMediaQuery('(max-width: 640px)');
    const [viewMode, setViewMode] = useState<'globe' | 'modules'>('modules');
    const [viewTransitioning, setViewTransitioning] = useState(false);
    const [titleSparklesReady, setTitleSparklesReady] = useState(false);
    const [autoRotate, setAutoRotate] = useState(true);
    const [customCenter, setCustomCenter] = useState<{ lat: number; lng: number } | null>(null);
    const [flyTarget, setFlyTarget] = useState<{
        latitude: number;
        longitude: number;
        zoom?: number;
        timestamp: number;
    } | null>(null);
    const [atomicGlobeFocus, setAtomicGlobeFocus] = useState<{ lat: number; lng: number } | null>(null);
    const [isZoomedToDistrict, setIsZoomedToDistrict] = useState(false);
    const [isFlyingIn, setIsFlyingIn] = useState(false);
    const [globeZoom, setGlobeZoom] = useState(1.05);
    const [globePan, setGlobePan] = useState({ x: 0, y: 0 });
    const [showAtomicGlobe, setShowAtomicGlobe] = useState(true);

    // While the globe container animates between the corner park and full-screen (700ms),
    // hold the globe's rotation off so the two animations don't fight and stall.
    const prevViewModeRef = useRef(viewMode);
    useEffect(() => {
        if (prevViewModeRef.current !== viewMode) {
            prevViewModeRef.current = viewMode;
            if (viewMode === 'globe') {
                setViewTransitioning(true);
                const t = window.setTimeout(() => setViewTransitioning(false), 850);
                return () => window.clearTimeout(t);
            }
        }
    }, [viewMode]);

    // Defer mounting the title tsParticles canvas until the view-switch transition has
    // settled, so its one-time engine load + particle spawn doesn't stall the crossfade.
    useEffect(() => {
        if (viewMode !== 'modules') {
            setTitleSparklesReady(false);
            return;
        }
        const t = window.setTimeout(() => setTitleSparklesReady(true), 400);
        return () => window.clearTimeout(t);
    }, [viewMode]);

    // Dynamic Viewer Selection
    const { viewerDisplayName } = usePanoramaViewer(projectSettings);

    // Mobile swipe handlers
    const [touchStartX, setTouchStartX] = useState<number | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        setTouchStartX(e.targetTouches[0].clientX);
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (!touchStartX) return;
        const touchEndX = e.changedTouches[0].clientX;
        const diff = touchStartX - touchEndX;

        if (diff > 50) {
            handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length);
        } else if (diff < -50) {
            handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length);
        }
        setTouchStartX(null);
    };

    // Smooth navigation helper
    const handleModuleChange = (newIndex: number) => {
        setViewMode('modules');
        if (newIndex === activeIndex) return;
        setIsAnimating(true);
        setActiveHotspotId(null);
        setTimeout(() => {
            setActiveIndex(newIndex);
            setIsAnimating(false);
        }, 220);
    };

    // Keyboard arrow navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') {
                handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length);
            } else if (e.key === 'ArrowLeft') {
                handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeIndex]);

    // Telemetry calculations
    const computedDistance = dailyData.reduce((acc, item) => acc + (Number(item.distance || item.kmProcessed) || 0), 0);
    const computedFrames = dailyData.reduce((acc, item) => acc + getImagesProcessedCount(item), 0);
    const computedDefects = dailyData.reduce((acc, item) => acc + (Number(item.imagesDefected || item.defectCount) || 0), 0);
    const computedPoi = dailyData.reduce((acc, item) => acc + getPOICount(item), 0);
    const activeJobs = batchLogs.filter((b: any) => b.status === 'In Progress' || b.status === 'Ongoing').length;
    const targetDistance = Number(projectSettings?.targetKm) || Number(projectSettings?.targetDistanceKm) || (computedDistance > 0 ? computedDistance : 0);
    const pctTarget = targetDistance > 0 ? Math.min(100, (computedDistance / targetDistance) * 100).toFixed(1) : '0.0';
    const slaPercent = computedFrames > 0
        ? Math.max(0, ((computedFrames - computedDefects) / computedFrames) * 100).toFixed(1)
        : '100.0';

    const projectCreatedLabel = activeProject?.createdAt && !isNaN(new Date(activeProject.createdAt).getTime())
        ? new Date(activeProject.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';

    const SYSTEM_MODULES: SystemModule[] = [
        // MODULE 1: MAIN DASHBOARD
        {
            id: 'webgis',
            category: 'Executive Command Center',
            title: 'Executive Dashboard & Spatial Telemetry',
            subtitle: 'Geodetic Telemetry, Trajectory Tracking & Live Status Stream',
            description: 'The central operational hub of the platform. Features high-precision MapLibre GL trajectory rendering, executive KPI telemetry meters, live workstation pipeline streams, and direct workspace navigation.',
            metricLabel: 'Total Distance Mapped',
            metricValue: `${computedDistance.toFixed(1)} km (${pctTarget}% · ${activeJobs} Active)`,
            statusBadge: 'Telemetry Active',
            images: [
                '/screenshots/Dashboard_UI_1.png',
                '/screenshots/Dashboard_UI_13.png',
                '/screenshots/Dashboard_UI_5.png',
                '/screenshots/Dashboard_UI_6.png',
                '/screenshots/Dashboard_UI_7.png',
                '/screenshots/Dashboard_UI_8.png'
            ],
            icon: Compass,
            workflow: [
                { step: '01. Ingest', action: 'Parse GPS/GNSS trajectory coordinates' },
                { step: '02. Project', action: 'Cluster points into subgrid boundaries' },
                { step: '03. Verify', action: 'Calculate geodesic road mileage (KM)' }
            ],
            specs: [
                { label: 'Spatial Tracking', value: 'High-Precision GNSS' },
                { label: 'Map Engine', value: 'MapLibre GL Vector Basemap' },
                { label: 'Action Stream', value: 'Operational Action Center' }
            ],
            hotspots: [
                {
                    id: 'm1-kpi',
                    x: 25,
                    y: 12,
                    title: 'Executive Telemetry KPI Cards',
                    tag: 'Metrics HUD',
                    description: 'Real-time meters showing Total Distance Mapped (KM), Processed 360 Panoramas, Active Processing Jobs, and Overall Pipeline Health SLA.',
                    tip: 'Hover or click any metric card to inspect its underlying subgrid completion breakdown.'
                },
                {
                    id: 'm1-action',
                    x: 50,
                    y: 22,
                    title: 'Operational Action Center',
                    tag: 'Live Work Stream',
                    description: 'Live monitoring bar displaying ongoing workstation batches, QA defect flags requiring attention, and pending staging subgrids.',
                    tip: 'Click the direct action button to jump straight to the required defect table.'
                },
                {
                    id: 'm1-map',
                    x: 35,
                    y: 56,
                    title: 'Interactive Vector WebGIS Map',
                    tag: 'Spatial Trajectory',
                    description: 'Hardware-accelerated MapLibre GL canvas rendering road trajectory geometries, subgrid boundaries, and station point nodes.',
                    tip: 'Click any station node along the route to load that frame in the 360° spherical viewer.'
                },
                {
                    id: 'm1-admin',
                    x: 82,
                    y: 52,
                    title: 'Subgrid Processing & Admin Table',
                    tag: 'Batch Queue',
                    description: 'Subgrid batch ledger showing active processing status, station progress percentage, and frame counts.',
                    tip: 'Filter by subgrid code (e.g. N94E70) to inspect specific regional processing batches.'
                },
                {
                    id: 'm1-qa',
                    x: 82,
                    y: 84,
                    title: '360 View & QA Mini-Inspector',
                    tag: 'Spherical Preview',
                    description: 'Embedded spherical panorama preview displaying heading orientation, coordinates, and optical quality status.',
                    tip: 'Click the maximize icon to open the full-screen 8K panoramic defect workspace.'
                }
            ]
        },

        // MODULE 2: DATA MANAGEMENT PANEL
        {
            id: 'data',
            category: 'Field Ingestion & Subgrid Ledgers',
            title: 'Data Management & Masterlist Ledgers',
            subtitle: 'Subgrid Masterlist, Daily Collections & Folder Verification',
            description: 'Unified field survey data management canvas. Validates raw CSV trajectory logs against NAS storage, organizes records into Subgrid Masterlists and Daily Ledgers, and manages staging status.',
            metricLabel: 'Surveyed Records',
            metricValue: `${computedFrames.toLocaleString()} Frames`,
            statusBadge: 'Storage Verified',
            images: [
                '/screenshots/Dashboard_UI_17.png',
                '/screenshots/Dashboard_UI_2.png',
                '/screenshots/Dashboard_UI_4.png',
                '/screenshots/Dashboard_UI_18.png'
            ],
            icon: FolderKanban,
            workflow: [
                { step: '01. Collect', action: 'Upload field CSV & raw panorama sets' },
                { step: '02. Verify', action: 'Cross-check files against storage bucket' },
                { step: '03. Reconcile', action: 'Update masterlist & daily progress records' }
            ],
            specs: [
                { label: 'File Validation', value: 'NAS & Bucket Verification' },
                { label: 'Ledger Types', value: 'Subgrid Masterlist & Daily Logs' },
                { label: 'Inline Editing', value: 'Subgrid / Date / Equipment' }
            ],
            hotspots: [
                {
                    id: 'm2-switcher',
                    x: 30,
                    y: 18,
                    title: 'Masterlist vs Daily Switcher',
                    tag: 'Ledger Navigation',
                    description: 'Toggle between Subgrid Masterlist (contract boundaries) and Daily Collection Logs (contractor field survey runs).',
                    tip: 'Masterlist aggregates all daily survey runs into singular subgrid deliverables.'
                },
                {
                    id: 'm2-table',
                    x: 25,
                    y: 52,
                    title: 'Subgrid Registry & Metadata Table',
                    tag: 'Registry Ledger',
                    description: 'Tabular view with subgrid codes, survey dates, camera equipment types, and frame counts with inline editing.',
                    tip: 'Press Enter after renaming subgrids or dates to save changes immediately.'
                },
                {
                    id: 'm2-verify',
                    x: 75,
                    y: 52,
                    title: 'Folder Verification & NAS Intake',
                    tag: 'File Validation',
                    description: 'Automated verifier checking NAS drive folders (/RAW/, /BLURRED/) against registered database entries.',
                    tip: 'Run folder verification prior to dispatching batches to station pipelines.'
                },
                {
                    id: 'm2-importer',
                    x: 82,
                    y: 20,
                    title: 'CSV Trajectory Importer',
                    tag: 'Ingestion Tool',
                    description: 'Parses csvpanotrack files, validates lat/lng coordinates and timestamps, and creates staging panorama points.',
                    tip: 'Drag and drop field CSVs directly into the importer for instant batch ingestion.'
                }
            ]
        },

        // MODULE 3: PRODUCTION WORKSPACE & PROCESSING CENTER
        {
            id: 'production',
            category: 'Multi-Station & GPU Worker Pipeline',
            title: 'Production Workspace, NAS & Lineage',
            subtitle: '4-Station Desktop Pipeline, GPU Worker & Asset Lineage',
            description: 'End-to-end multi-PC production routing and automated GPU worker dispatch. Coordinates sequential desktop handoffs across Station 1 (Blur), Station 2 (Stitching), Station 3 (Lightroom), and Station 4 (Photoshop), with real-time NAS storage tracking and immutable lineage tracing.',
            metricLabel: 'Pipeline Architecture',
            metricValue: '4-Station + NAS GPU Worker',
            statusBadge: 'Pipeline Connected',
            images: [
                '/screenshots/Dashboard_UI_29.png',
                '/screenshots/Dashboard_UI_30.png',
                '/screenshots/Dashboard_UI_34.png',
                '/screenshots/Dashboard_UI_31.png',
                '/screenshots/Dashboard_UI_32.png',
                '/screenshots/Dashboard_UI_33.png',
                '/screenshots/Dashboard_UI_35.png'
            ],
            icon: Cpu,
            workflow: [
                { step: '01. Blur', action: 'PC 1: YOLOv8 face & license plate blur' },
                { step: '02. Stitch', action: 'PC 2: PTGui / Creator 6 360° stitching' },
                { step: '03. Enhance', action: 'PC 3: Lightroom preset color grading' }
            ],
            specs: [
                { label: '4-Station Flow', value: 'PC1 Blur → PC2 Stitch → PC3 LR → PC4 PS' },
                { label: 'FastAPI Daemon', value: 'Headless PyTorch CUDA Worker' },
                { label: 'Lineage Engine', value: 'Asset Transformation Trace DAG' }
            ],
            hotspots: [
                {
                    id: 'm3-pipeline',
                    x: 20,
                    y: 40,
                    title: 'Production Pipeline & Subgrid Matrix',
                    tag: 'Subgrid Matrix',
                    description: 'Central pipeline matrix tracking subgrid processing stages from RAW Intake through PC1 Blur, PC2 Stitch, PC3 Lightroom, and PC4 Photoshop.',
                    tip: 'Click any subgrid row to inspect its active workstation stage.'
                },
                {
                    id: 'm3-workstations',
                    x: 40,
                    y: 35,
                    title: '4-Station Multi-PC Configuration',
                    tag: 'Station Routing',
                    description: 'Configures LAN IP addresses, default operators, and NAS input/output directory routes for each physical station.',
                    tip: 'Toggle between 4-Station Multi-PC workflow and automated NAS GPU Workers.'
                },
                {
                    id: 'm3-handoff',
                    x: 60,
                    y: 35,
                    title: 'Workstation Handoff Kanban Board',
                    tag: 'Handoff Board',
                    description: 'Real-time board tracking subgrids moving sequentially across Blurring, Stitching, Lightroom, and Photoshop workstations.',
                    tip: 'Track subgrids moving across physical PCs in real-time.'
                },
                {
                    id: 'm3-lightroom',
                    x: 75,
                    y: 40,
                    title: 'Station 3 Lightroom Preset Enhancer',
                    tag: 'Color & Tone',
                    description: 'Live interactive designer to test exposure, contrast, shadows, and dehaze adjustments before running batch Lightroom presets.',
                    tip: 'Use "Copy LR Preset Recipe" to apply identical settings in Adobe Lightroom Classic.'
                },
                {
                    id: 'm3-nas',
                    x: 50,
                    y: 25,
                    title: 'NAS Storage Manager & Worker Telemetry',
                    tag: 'NAS Storage',
                    description: 'Monitors NAS volume health, capacity quotas, GPU worker daemon connectivity, and indexed dataset catalogs.',
                    tip: 'Click "Check Connectivity" to verify high-speed 10GbE network mounts.'
                },
                {
                    id: 'm3-lineage',
                    x: 50,
                    y: 75,
                    title: 'Data Lineage & Transformation Trace Graph',
                    tag: 'Lineage Graph',
                    description: 'Visual DAG tree mapping raw input datasets through intermediate transformations to final deliverable outputs.',
                    tip: 'Every deliverable can be traced back to its exact operator, software version, and parameters.'
                }
            ]
        },

        // MODULE 4: QA/QC WORKSPACE
        {
            id: 'qaqc',
            category: 'Optical & Spherical Quality Assurance',
            title: 'Panoramic StreetView & QA/QC Defect Workspace',
            subtitle: 'Automated Optical Sharpness, Tenengrad Analysis & Defect Flags',
            description: 'Dedicated high-throughput quality control workspace. Computes frame sharpness using Tenengrad gradient variance, identifies camera pitch/yaw errors, flags vehicle nadir obstructions, and allows instant side-by-side verification.',
            metricLabel: 'Quality SLA Health',
            metricValue: `${slaPercent}% Compliance`,
            statusBadge: `${slaPercent}% Quality`,
            images: [
                '/screenshots/Dashboard_UI_26.png',
                '/screenshots/Dashboard_UI_27.png',
                '/screenshots/Dashboard_UI_28.png',
                '/screenshots/Dashboard_UI_3.png'
            ],
            icon: Camera,
            workflow: [
                { step: '01. Sequence', action: 'Load trajectory nodes in travel order' },
                { step: '02. Compute', action: 'Run multi-thread Tenengrad analysis' },
                { step: '03. Classify', action: 'Flag Blur, Obstruction & Bad GPS' }
            ],
            specs: [
                { label: 'Sensor Format', value: '8K 360° Equirectangular' },
                { label: 'Sharpness Metric', value: 'Tenengrad Variance (Min 12.0)' },
                { label: 'Defect Classes', value: 'Blur, Obstruction, Bad GPS' }
            ],
            hotspots: [
                {
                    id: 'm4-viewer',
                    x: 35,
                    y: 45,
                    title: '360° Panoramic Viewer Canvas',
                    tag: 'Equirectangular Sphere',
                    description: 'Hardware-accelerated viewer canvas supporting spherical pan, tilt, pitch, and zoom with compass heading.',
                    tip: 'Press Spacebar on your keyboard to auto-advance through trajectory frames in driving sequence.'
                },
                {
                    id: 'm4-matrix',
                    x: 75,
                    y: 25,
                    title: 'Defect Classification Matrix',
                    tag: 'Defect Tagger',
                    description: 'Classifies optical and positional anomalies into Blur, Nadir Obstruction, Horizon Leveling, or GPS Drift with confidence scores.',
                    tip: 'Defects are permanently tagged and exported into contractor re-survey lists.'
                },
                {
                    id: 'm4-tenengrad',
                    x: 75,
                    y: 58,
                    title: 'Tenengrad Sharpness Analyzer',
                    tag: 'Edge Gradient Math',
                    description: 'Evaluates image focus using Tenengrad gradient variance in the middle horizon ROI (10% to 52% height).',
                    tip: 'Adjust variance threshold in QAQC Studio to adapt to cloudy vs sunny conditions.'
                },
                {
                    id: 'm4-strip',
                    x: 50,
                    y: 88,
                    title: 'Trajectory Frame Sequence Strip',
                    tag: 'Sequence Timeline',
                    description: 'Timeline scrubber displaying all frames along the surveyed street with color-coded pass/fail status pins.',
                    tip: 'Use Left/Right arrow keys for rapid keyboard navigation across hundreds of frames.'
                }
            ]
        },

        // MODULE 5: POSTGIS SPATIAL HUB & CLOUD STAGING
        {
            id: 'postgis',
            category: 'Spatial Relational Database & Cloud Sync',
            title: 'PostGIS Spatial Hub & Vector Layer Staging',
            subtitle: 'Relational Spatial Staging, GIST Indexing & Map Sync',
            description: 'Centralized spatial database architecture backed by PostgreSQL and PostGIS. Handles realtime GPS trajectory ingestion, automated duplicate subgrid prevention, spatial GIST indexing, vector layer staging, and cloud synchronization.',
            metricLabel: 'Spatial Infrastructure',
            metricValue: 'PostGIS + GIST Index',
            statusBadge: 'PostGIS Connected',
            images: [
                '/screenshots/Dashboard_UI_9.png',
                '/screenshots/Dashboard_UI_10.png',
                '/screenshots/Dashboard_UI_11.png',
                '/screenshots/Dashboard_UI_12.png'
            ],
            icon: Database,
            workflow: [
                { step: '01. Stage', action: 'Write imported rows to staging tables' },
                { step: '02. Index', action: 'Apply spatial GIST index on geometry' },
                { step: '03. Publish', action: 'Synchronize verified rows to production' }
            ],
            specs: [
                { label: 'Spatial Database', value: 'PostgreSQL + PostGIS Extension' },
                { label: 'Spatial Index', value: 'GIST on Point Geometry (lat/lng)' },
                { label: 'Staging Pipeline', value: 'csvpanotrack → staging → production' }
            ],
            hotspots: [
                {
                    id: 'm5-schema',
                    x: 30,
                    y: 35,
                    title: 'PostGIS Spatial Tables & Schema',
                    tag: 'Relational Engine',
                    description: 'Inspect tables (panoramas, staging_panoramas, subgrids) with geometry(Point, 4326) columns and spatial bounds.',
                    tip: 'Spatial tables support standard ST_DWithin and ST_Contains SQL queries.'
                },
                {
                    id: 'm5-gist',
                    x: 70,
                    y: 35,
                    title: 'GIST Spatial Index Optimization',
                    tag: 'Spatial Indexing',
                    description: 'R-Tree index structures on latitude/longitude geometry for sub-millisecond bounding box lookups.',
                    tip: 'GIST indexes ensure smooth map panning even with over 500,000 surveyed points.'
                },
                {
                    id: 'm5-staging',
                    x: 50,
                    y: 70,
                    title: 'Staging Gate & Production Sync',
                    tag: 'Publish Pipeline',
                    description: 'Two-tier staging architecture ensuring unverified field points never reach client-facing WebGIS layers.',
                    tip: 'Only QA-approved subgrids can be published to the deliverable layers.'
                },
                {
                    id: 'm5-storage',
                    x: 80,
                    y: 80,
                    title: 'Cloud Storage Bucket Sync',
                    tag: 'Object Storage',
                    description: 'Manages object storage buckets for high-resolution 8K panoramas with automatic signed URL generation.',
                    tip: 'Pre-signed URLs protect raw unblurred imagery from unauthorized public access.'
                }
            ]
        },

        // MODULE 6: REPORTS, AUDIT & RBAC GOVERNANCE
        {
            id: 'reports',
            category: 'Governance, Compliance & Security',
            title: 'Executive Reports, Audit Trail & RBAC Governance',
            subtitle: 'Immutable Event Logging, Milestone Ledgers & Role-Based Access',
            description: 'Enterprise governance, audit trail, and security suite. Generates formal PDF/CSV milestone reports, records all dataset transformations in an immutable audit ledger, and enforces granular Role-Based Access Control (RBAC).',
            metricLabel: 'Governance Status',
            metricValue: `${dailyData.length} Survey Records`,
            statusBadge: 'Audit Trail Locked',
            images: [
                '/screenshots/Dashboard_UI_39.png',
                '/screenshots/Dashboard_UI_37.png',
                '/screenshots/Dashboard_UI_36.png',
                '/screenshots/Dashboard_UI_38.png',
                '/screenshots/Dashboard_UI_14.png',
                '/screenshots/Dashboard_UI_15.png'
            ],
            icon: Shield,
            workflow: [
                { step: '01. Record', action: 'Log user edits, imports & sign-offs' },
                { step: '02. Audit', action: 'Verify SLA defect rates per contractor' },
                { step: '03. Export', action: 'Generate executive summary reports' }
            ],
            specs: [
                { label: 'Audit Trail', value: 'Immutable Event Timestamping' },
                { label: 'Reporting', value: 'Formal Executive PDF / CSV Milestones' },
                { label: 'Security', value: 'Role-Based Access Control (RBAC)' }
            ],
            hotspots: [
                {
                    id: 'm6-executive',
                    x: 30,
                    y: 35,
                    title: 'Executive Progress & Quality Audit Report',
                    tag: 'Formal Export',
                    description: 'Project-wide KPI summary over all surveyed subgrids covering distance, coverage, QA quality, and capture gaps in a print-ready document.',
                    tip: 'Click "Generate & Print" to auto-open print dialog and export client-ready PDF.'
                },
                {
                    id: 'm6-analytics',
                    x: 70,
                    y: 35,
                    title: 'Project Survey Reports & Progress Ledger',
                    tag: 'Survey Ledger',
                    description: 'Live contract progress tracking against total mileage targets with subgrid summaries and daily operation records.',
                    tip: 'Tracks contractor SLA defect rates against allowed threshold percentages.'
                },
                {
                    id: 'm6-operations',
                    x: 50,
                    y: 35,
                    title: 'Survey Operations Analytics',
                    tag: 'Operations KPI',
                    description: 'Realtime charts of road capture analytics, publication status distribution (Published vs Partial), and daily throughput trends.',
                    tip: 'Visualizes live database metrics without modifying raw imagery.'
                },
                {
                    id: 'm6-coverage',
                    x: 50,
                    y: 65,
                    title: 'Survey Coverage & Capture Gaps Analysis',
                    tag: 'Gap Detection',
                    description: 'Detects incomplete subgrids, survey frame shortages, and unpublished capture risks across regional grid zones.',
                    tip: 'Flagged capture gaps automatically generate field re-survey work orders.'
                },
                {
                    id: 'm6-audit',
                    x: 70,
                    y: 75,
                    title: 'Immutable Audit Trail Ledger',
                    tag: 'Event Logging',
                    description: 'Cryptographically verified event logs recording every file upload, QA rejection, parameter edit, and user sign-in.',
                    tip: 'Audit logs cannot be altered or deleted, ensuring full accountability.'
                },
                {
                    id: 'm6-rbac',
                    x: 50,
                    y: 85,
                    title: 'Role-Based Access Control (RBAC)',
                    tag: 'Security Matrix',
                    description: 'Granular role management for Admins, Operators, QA Reviewers, and Guests with permission restrictions.',
                    tip: 'Guest mode allows safe read-only browsing without risk of modifying survey data.'
                }
            ]
        }
    ];

    // Preload screenshot assets into memory
    useEffect(() => {
        SYSTEM_MODULES.forEach((mod) => {
            mod.images.forEach((src) => {
                const img = new Image();
                img.src = src;
            });
        });
    }, []);

    useEffect(() => {
        setActivePhotoIdx(0);
        setActiveHotspotId(null);
    }, [activeIndex]);

    // Toggle html class so themes.css !important rules don't block the background image
    useEffect(() => {
        document.documentElement.classList.add('showcase-active');
        return () => {
            document.documentElement.classList.remove('showcase-active');
        };
    }, []);

    const current = SYSTEM_MODULES[activeIndex];
    const prevModule = SYSTEM_MODULES[(activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length];
    const nextModule = SYSTEM_MODULES[(activeIndex + 1) % SYSTEM_MODULES.length];
    const activeImage = current.images[activePhotoIdx] || current.images[0];
    const activeHotspot = current.hotspots.find((h) => h.id === activeHotspotId);

    // Derive overall current project location dynamically
    const projectLocation = useMemo(() => {
        let sumLat = 0;
        let sumLng = 0;
        let count = 0;

        if (Array.isArray(dailyData) && dailyData.length > 0) {
            for (const day of dailyData) {
                if (Array.isArray(day?.points)) {
                    for (const pt of day.points) {
                        const lat = Number(pt?.lat ?? pt?.latitude);
                        const lng = Number(pt?.lon ?? pt?.longitude ?? pt?.lng);
                        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
                            sumLat += lat;
                            sumLng += lng;
                            count++;
                            if (count >= 100) break;
                        }
                    }
                }
                if (count >= 100) break;
            }
        }

        if (count > 0) {
            const avgLat = sumLat / count;
            const avgLng = sumLng / count;
            return {
                latitude: avgLat,
                longitude: avgLng,
                name: projectSettings?.projectName || 'Active Survey Area',
                subtext: `${avgLat.toFixed(4)}° N, ${avgLng.toFixed(4)}° E • Peninsular Malaysia`
            };
        }

        // Default: center of the committed project boundary bbox, or global Malaysia center
        const bnd = projectSettings?.projectBoundary as any;
        if (bnd?.bbox && Array.isArray(bnd.bbox) && bnd.bbox.length === 4) {
            const cLat = (bnd.bbox[1] + bnd.bbox[3]) / 2;
            const cLng = (bnd.bbox[0] + bnd.bbox[2]) / 2;
            return {
                latitude: cLat,
                longitude: cLng,
                name: bnd.regionName || projectSettings?.projectName || 'Active Survey Area',
                subtext: `${cLat.toFixed(4)}° N, ${cLng.toFixed(4)}° E • ${bnd.regionName || 'Malaysia'}`
            };
        }
        return {
            latitude: 3.8,
            longitude: 109.5,
            name: projectSettings?.projectName || 'Active Survey Area',
            subtext: 'Peninsular Malaysia'
        };
    }, [dailyData, projectSettings]);
    // Available districts/projects for inspection — derived entirely from the
    // user's committed project boundary (never hardcoded). All THREE saved signals are
    // merged (ids, names, geojson features) so nothing the user saved is ever dropped:
    // e.g. a boundary saved with districtIds:['segamat'] but a geojson that also carries
    // Tangkak still exposes Tangkak in the HUD card.
    const inspectableDistricts = useMemo(() => {
        const boundary = projectSettings?.projectBoundary as any;
        const list: Array<{ id: string; name: string; state: string; lat: number; lng: number }> = [];

        // 1. districtIds array (written by both AdminSettingsView & ProjectOnboarding)
        if (Array.isArray(boundary?.districtIds) && boundary.districtIds.length > 0) {
            boundary.districtIds.forEach((id: string) => {
                const meta = DISTRICT_METADATA.find(d => d.id.toLowerCase() === String(id).toLowerCase());
                if (meta) {
                    list.push({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] });
                }
            });
        }

        // 2. districtNames (AdminSettings writes both, Onboarding may omit districtNames)
        if (Array.isArray(boundary?.districtNames) && boundary.districtNames.length > 0) {
            boundary.districtNames.forEach((name: string) => {
                const meta = DISTRICT_METADATA.find(d => d.name.toLowerCase() === String(name).toLowerCase());
                if (meta) {
                    list.push({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] });
                }
            });
        }

        // 3. Derive districts from the committed geojson FeatureCollection itself
        if (boundary?.geojson && Array.isArray(boundary.geojson.features)) {
            boundary.geojson.features.forEach((f: any) => {
                const name = f?.properties?.name || '';
                const id = String(f?.id || '');
                const meta = name
                    ? DISTRICT_METADATA.find(d => d.name.toLowerCase() === String(name).toLowerCase())
                    : DISTRICT_METADATA.find(d => d.id.toLowerCase() === id.toLowerCase());
                if (meta) {
                    list.push({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] });
                }
            });
        }

        // Keep the list free of duplicates (same district may appear via multiple writers)
        const seen = new Set<string>();
        const deduped = list.filter(d => {
            const key = d.id.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return deduped;
    }, [projectSettings]);

    // Districts the globe overview & HUD actually show. Bound to the project boundary:
    // a boundary committed with specific districts (e.g. Johor with Segamat + Tangkak)
    // exposes exactly those; a whole-state/region boundary (regionId/regionName set but
    // no per-district ids) expands to EVERY district in that state, so the overview
    // reflects the full data footprint committed for the project. Always dynamic per
    // project — nothing here is hardcoded. With no boundary at all, a single district
    // loads from the surveyed coords so the State / District rows still show real info.
    const resolvedDistricts = useMemo(() => {
        if (inspectableDistricts.length > 0) return inspectableDistricts;

        // Whole-state/region boundary (single region plan): list every district in that state
        const boundary = projectSettings?.projectBoundary as any;
        const regionName = boundary?.regionName as string | undefined;
        if (regionName) {
            const stateDists = DISTRICT_METADATA.filter(d => d.stateName.toLowerCase() === regionName.toLowerCase());
            if (stateDists.length > 0) {
                return stateDists.map(meta => ({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] }));
            }
        }

        // Last resort only: load the district under the surveyed location
        const loaded = findDistrictAt(projectLocation.latitude, projectLocation.longitude);
        return loaded ? [loaded] : [];
    }, [inspectableDistricts, projectSettings, projectLocation.latitude, projectLocation.longitude]);

    // Prefer the surveyed district as the default selected chip (when listing a whole state)
    const defaultDistrictIdx = useMemo(() => {
        if (resolvedDistricts.length <= 1) return 0;
        const loaded = findDistrictAt(projectLocation.latitude, projectLocation.longitude);
        if (!loaded) return 0;
        const i = resolvedDistricts.findIndex(d => d.id.toLowerCase() === loaded.id.toLowerCase());
        return i >= 0 ? i : 0;
    }, [resolvedDistricts, projectLocation.latitude, projectLocation.longitude]);

    const [selectedDistrictIdx, setSelectedDistrictIdx] = useState(0);
    const [showProjectPicker, setShowProjectPicker] = useState(false);
    const [showDistrictPopup, setShowDistrictPopup] = useState(false);
    // Real MultiPolygon district geometries load eagerly in the background; flip this
    // flag when they arrive so the committed boundary can be rebuilt with true shapes.
    const [districtGeomReady, setDistrictGeomReady] = useState(false);
    useEffect(() => {
        let alive = true;
        ensureDistrictGeometriesLoaded()
            .then(() => { if (alive) setDistrictGeomReady(true); })
            .catch(() => { if (alive) setDistrictGeomReady(true); });
        return () => { alive = false; };
    }, []);

    // The strict committed boundary for the HUD card: each committed district drawn as
    // its own polygon (real geometry once loaded, metadata bbox otherwise). Falls back to
    // the stored project-settings boundary when nothing is committed. Independent of POI.
    const committedBoundary = useMemo(() => {
        const ids = resolvedDistricts.map(d => d.id.toLowerCase());
        if (districtGeomReady && ids.length > 0) {
            const chosen = MALAYSIA_DISTRICTS.filter(d => ids.includes(d.id.toLowerCase()));
            const geo = districtsToGeoJSON(chosen);
            if (geo) return geo;
        }
        const stored = (projectSettings?.projectBoundary as any)?.geojson;
        const storedBbox = (projectSettings?.projectBoundary as any)?.bbox;
        if (stored) return { geojson: stored, bbox: storedBbox };
        return null;
    }, [resolvedDistricts, projectSettings, districtGeomReady]);

    // Stable identity for the committed boundary handed to ProjectBoundaryMap — the
    // inspect view must NOT receive a fresh object every render (that re-triggers its
    // layer rebuilds → boundary flashes while any other state updates).
    const activeProjectBoundary = useMemo(
        () => (committedBoundary ? { geojson: committedBoundary.geojson, bbox: committedBoundary.bbox } : undefined),
        [committedBoundary]
    );

    // When the district list was loaded from state metadata (no committed boundary),
    // default the selection to the district the survey actually sits in.
    useEffect(() => {
        if (selectedDistrictIdx === 0 && defaultDistrictIdx > 0) {
            setSelectedDistrictIdx(defaultDistrictIdx);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultDistrictIdx]);
    // Globe targeting marker — when no districts are committed, center on the project area itself.
    // (This fallback is used for globe focusing only; the card gallery stays boundary-driven.)
    const activeDistrict =
        resolvedDistricts[selectedDistrictIdx] ||
        resolvedDistricts[defaultDistrictIdx] || {
            id: 'project-area',
            name: projectLocation.name,
            state: (projectSettings?.projectBoundary as any)?.regionName || '—',
            lat: projectLocation.latitude,
            lng: projectLocation.longitude
        };

    // Extract panotrack survey telemetry
    const panotrackData = useMemo(() => {
        return extractPanotrackPoints(dailyData, batchLogs);
    }, [dailyData, batchLogs]);

    // Committed district metadata bboxes — the data-driven filter scope for the project's
    // available panotrack frames (dynamic per project, no hardcoding).
    const districtBBoxes = useMemo<Array<[number, number, number, number]>>(() => {
        const seen = new Set<string>();
        const boxes: Array<[number, number, number, number]> = [];
        resolvedDistricts.forEach((d) => {
            const meta = DISTRICT_METADATA.find((m) => m.id.toLowerCase() === d.id.toLowerCase());
            if (meta?.bbox && !seen.has(meta.id.toLowerCase())) {
                seen.add(meta.id.toLowerCase());
                boxes.push(meta.bbox);
            }
        });
        return boxes;
    }, [resolvedDistricts]);

    // Panotrack points that are actually available within the project's committed area.
    const panotrackInProject = useMemo(() => {
        const { filteredPoints } = filterPanotrackByBBoxes(panotrackData.points, panotrackData.tracks, districtBBoxes);
        return filteredPoints;
    }, [panotrackData, districtBBoxes]);

    // The single zoomed district's bbox (for the MapLibre inspect view) — defaults to the
    // whole committed area when the active district has no metadata entry.
    const activeDistrictBbox = useMemo<[number, number, number, number] | null>(() => {
        if (!activeDistrict) return null;
        const meta = DISTRICT_METADATA.find((m) => m.id.toLowerCase() === activeDistrict.id.toLowerCase());
        return meta?.bbox || null;
    }, [activeDistrict]);

    const activeDistrictPanotrack = useMemo(() => {
        if (!activeDistrictBbox) return panotrackInProject;
        const { filteredPoints } = filterPanotrackByBBoxes(panotrackData.points, panotrackData.tracks, [activeDistrictBbox]);
        return filteredPoints;
    }, [panotrackData, activeDistrictBbox, panotrackInProject]);

    const activePopupData = useMemo<PanotrackPopupData | null>(() => {
        if (!showDistrictPopup) return null;

        // Project region identity comes from the user's committed project boundary
        const boundary = projectSettings?.projectBoundary as any;
        const regionName = (boundary?.regionName) || activeDistrict?.state || 'Malaysia';
        const regionMeta = MALAYSIA_REGIONS.find((r) => r.id === boundary?.regionId);
        const zoneLabel =
            regionMeta?.group === 'Borneo'
                ? 'Borneo, Malaysia'
                : (regionMeta?.group === 'Peninsular' ? 'Peninsular Malaysia' : (boundary?.regionName || activeDistrict?.state || 'Malaysia'));

        // If no committed boundary (no districts configured), this popup shows simply the project area
        const relevantPoints = panotrackInProject.length > 0 ? panotrackInProject : panotrackData.points;
        const publishedCount = relevantPoints.filter(p => p.isPublished || p.status === 'published' || p.status === 'yes').length;
        const defectCount = relevantPoints.filter(p => p.status === 'defect' || p.color === '#ef4444' || p.qa_status === 'defect').length;
        const stagingCount = Math.max(0, relevantPoints.length - publishedCount - defectCount);

        const subgrids = Array.from(new Set(relevantPoints.map(p => p.subgrid).filter(Boolean)));
        const trackPoints: Array<[number, number]> = relevantPoints.slice(0, 60).map(p => [p.lng, p.lat]);

        // Frame & POI counts reported from REAL data only — frame count follows the app's
        // canonical getImagesProcessedCount logic (storage-verified frames), POI follows
        // getPOICount (survey track points). No location-point substitutions or estimates.
        const frames = computedFrames;
        const poi = computedPoi;

        return {
            regionName,
            stateName: activeDistrict?.state || zoneLabel,
            latitude: activeDistrict?.lat ?? 0,
            longitude: activeDistrict?.lng ?? 0,
            totalFrames: frames,
            totalPoi: poi,
            surveyMileage: computedDistance,
            pipelineSla: slaPercent,
            publishedCount,
            stagingCount,
            defectCount: defectCount > 0 ? defectCount : computedDefects,
            subgrids,
            trackPoints: trackPoints.length >= 2 ? trackPoints : undefined,
            boundaryGeojson: committedBoundary?.geojson,
            boundaryBbox: committedBoundary?.bbox,
            panotrackPoints: panotrackInProject,
        };
    }, [showDistrictPopup, activeDistrict, panotrackInProject, panotrackData, computedFrames, computedPoi, computedDistance, computedDefects, slaPercent, projectSettings, committedBoundary]);

    // Track active marker projected 2D position from EarthGlobe
    const [markerProjectedPos, setMarkerProjectedPos] = useState<{ x: number; y: number; visible: boolean } | null>(null);
    const lastProjectedPosRef = useRef<{ x: number; y: number } | null>(null);

    // Measured popup card size (drives the leader-line anchors so the line never
    // runs past the real card edge / bottom of screen)
    const [cardSize, setCardSize] = useState<{ w: number; h: number } | null>(null);
    const cardSizeRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = cardSizeRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            const r = entries[0]?.contentRect;
            if (r && Math.round(r.width) > 0 && Math.round(r.height) > 0) {
                setCardSize({ w: Math.round(r.width), h: Math.round(r.height) });
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [showDistrictPopup]);

    const handleActiveMarkerProjected = useCallback((pos: { x: number; y: number; visible: boolean }) => {
        const last = lastProjectedPosRef.current;
        if (!last || Math.abs(pos.x - last.x) > 2.5 || Math.abs(pos.y - last.y) > 2.5) {
            lastProjectedPosRef.current = { x: pos.x, y: pos.y };
            setMarkerProjectedPos(pos);
        }
    }, []);

    // Calculate responsive popup card and angled leader line coordinates
    const popupScreenLayout = useMemo(() => {
        const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const screenH = typeof window !== 'undefined' ? window.innerHeight : 800;
        const cardW = Math.min(cardSize?.w || 360, Math.max(220, screenW - 16));
        const cardH = cardSize?.h || Math.min(430, Math.max(300, screenH - 120));

        const rawMX = markerProjectedPos ? markerProjectedPos.x : (screenW / 2);
        const rawMY = markerProjectedPos ? markerProjectedPos.y : (screenH / 2);
        // Clamp to the viewport so the leader line never draws off-screen / down past the card
        const mX = Number.isFinite(rawMX) ? Math.min(Math.max(rawMX, 16), screenW - 16) : (screenW / 2);
        const mY = Number.isFinite(rawMY) ? Math.min(Math.max(rawMY, 16), screenH - 16) : (screenH / 2);
        const isVis = markerProjectedPos ? markerProjectedPos.visible : true;

        // Try placing card to the right of the marker first (as requested by user)
        const canPlaceRight = (mX + 45 + cardW <= screenW - 24);

        // Try placing card ABOVE the marker first (as requested by user)
        // Top navbar height is ~56px, keep top margin >= 64px
        const canPlaceAbove = (mY - 30 - cardH >= 64);
        let cardX = canPlaceRight
            ? Math.min(screenW - cardW - 20, mX + 45)
            : Math.max(20, mX - 45 - cardW);
        let cardY = canPlaceAbove
            ? Math.max(64, mY - 30 - cardH)
            : (mY + 30 + cardH <= screenH - 70 ? mY + 30 : Math.max(64, screenH - cardH - 80));

        const isRight = cardX >= mX;
        const isAbove = cardY < mY;

        // Cap leader-line length: pull the card toward the marker so the dashed
        // line never stretches across most of the screen (e.g. tall card forced
        // to the top while the marker sits mid-screen).
        const MAX_LEAD = 180;
        const TOP_MARGIN = 64;
        if (isAbove) {
            // Card bottom edge (anchor) must stay within MAX_LEAD below the marker
            cardY = Math.max(TOP_MARGIN, Math.min(cardY, mY + MAX_LEAD - cardH + 24));
        } else {
            // Card top edge (anchor) must stay within MAX_LEAD below the marker
            cardY = Math.max(TOP_MARGIN, Math.min(cardY, mY + MAX_LEAD - 24));
        }

        // Anchor on card edge closest to marker
        const anchorX = isRight ? cardX : (cardX + cardW);
        const anchorY = isAbove ? (cardY + cardH - 24) : (cardY + 24);

        // Angled elbow dogleg
        const elbowX = isRight ? (anchorX - 24) : (anchorX + 24);
        const elbowY = anchorY;

        const leaderPath = `M ${mX.toFixed(1)} ${mY.toFixed(1)} L ${elbowX.toFixed(1)} ${elbowY.toFixed(1)} L ${anchorX.toFixed(1)} ${anchorY.toFixed(1)}`;

        return {
            cardX,
            cardY,
            markerX: mX,
            markerY: mY,
            visible: isVis,
            leaderPath
        };
    }, [markerProjectedPos, cardSize]);

    const globeMarkers = useMemo<GlobeMarker[]>(() => {
        // The globe shows ONLY the committed state — a single region pin. District-level
        // granularity (Segamat / Tangkak) lives in the HUD card, not on the globe.
        const stateName = activeDistrict?.state ||
            (projectSettings?.projectBoundary as any)?.regionName ||
            'Malaysia';
        const stateSlug = stateName.trim().toLowerCase();

        // Prefer the real region geometry centre (MALAYSIA_REGIONS)…
        const region = MALAYSIA_REGIONS.find((r) => r.name.trim().toLowerCase() === stateSlug);
        let lat = region?.center ? region.center[0] : NaN;
        let lng = region?.center ? region.center[1] : NaN;

        // …then the centre of the actually-committed boundary geometry (bbox),
        // the authoritative "where the state is" that survives name mismatches.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            const cb = committedBoundary?.bbox;
            if (Array.isArray(cb) && cb.length === 4 && Number.isFinite(cb[0]) && Number.isFinite(cb[1]) && Number.isFinite(cb[2]) && Number.isFinite(cb[3])) {
                lat = (cb[1] + cb[3]) / 2;
                lng = (cb[0] + cb[2]) / 2;
            }
        }

        // …fall back to the average of the committed districts' centres
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            if (resolvedDistricts.length > 0) {
                lat = resolvedDistricts.reduce((acc, d) => acc + d.lat, 0) / resolvedDistricts.length;
                lng = resolvedDistricts.reduce((acc, d) => acc + d.lng, 0) / resolvedDistricts.length;
            }
        }

        // …then to the fixed state metadata (guaranteed to sit inside the state),
        // so a label like "JOHOR" is never pinned to the project location outside it.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            const stateMetas = DISTRICT_METADATA.filter(
                (m) => (m.stateName || m.group || '').trim().toLowerCase() === stateSlug
            );
            if (stateMetas.length > 0) {
                lat = stateMetas.reduce((acc, m) => acc + m.center[0], 0) / stateMetas.length;
                lng = stateMetas.reduce((acc, m) => acc + m.center[1], 0) / stateMetas.length;
            }
        }

        // Last resort: the project location.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            lat = projectLocation.latitude;
            lng = projectLocation.longitude;
        }

        const n = resolvedDistricts.length;
        const description = `${stateName} • ${n} ${n === 1 ? 'district' : 'districts'} committed`;
        return [{
            kind: 'district',
            label: stateName,
            description,
            latitude: Number.isFinite(lat) ? lat : 3.8,
            longitude: Number.isFinite(lng) ? lng : 109.5,
            color: '#ef4444',
        }];
    }, [activeDistrict, resolvedDistricts, projectSettings, projectLocation.latitude, projectLocation.longitude, committedBoundary]);

    // Anchor for the HUD leader line / beacon ring. Never let a degenerate
    // fallback coordinate ((0,0) → Gulf of Guinea) drive it — if the active
    // district has no real location, point at the committed state pin instead.
    const activeLat = customCenter
        ? customCenter.lat
        : Number.isFinite(activeDistrict.lat) && (activeDistrict.lat !== 0 || activeDistrict.lng !== 0)
            ? activeDistrict.lat
            : (globeMarkers[0]?.latitude ?? activeDistrict.lat);
    const activeLng = customCenter
        ? customCenter.lng
        : Number.isFinite(activeDistrict.lng) && (activeDistrict.lat !== 0 || activeDistrict.lng !== 0)
            ? activeDistrict.lng
            : (globeMarkers[0]?.longitude ?? activeDistrict.lng);

    // Atomic Globe (vendored Framer) markers — reuses the same committed-state pins.
    const atomicGlobeMarkers = useMemo<AtomicGlobeMarker[]>(() => {
        return globeMarkers.map((m) => ({
            label: m.label,
            lat: m.latitude,
            lng: m.longitude,
            description: m.description,
        }));
    }, [globeMarkers]);

    // Focus camera directly onto active project location with smooth flight
    const handleFocusProject = useCallback((target?: { lat: number; lng: number } | React.MouseEvent | React.KeyboardEvent) => {
        const isCoord = target && typeof target === 'object' && 'lat' in target && 'lng' in target;
        const lat = isCoord ? (target as { lat: number; lng: number }).lat : activeDistrict.lat;
        const lng = isCoord ? (target as { lat: number; lng: number }).lng : activeDistrict.lng;
        setAutoRotate(false);
        setFlyTarget({
            latitude: lat,
            longitude: lng,
            zoom: 1.05,
            timestamp: Date.now(),
        });
        if (Number.isFinite(lat) && Number.isFinite(lng)) setAtomicGlobeFocus({ lat, lng });
    }, [activeDistrict]);

    // Cinematic planetary camera dive handler
    const handleInspectDistrict = useCallback((districtNameOverride?: string) => {
        if (isFlyingIn || isZoomedToDistrict) return;
        setAutoRotate(false);
        if (typeof districtNameOverride === 'string') {
            const idx = inspectableDistricts.findIndex(d => d.name.toLowerCase() === districtNameOverride.toLowerCase());
            if (idx >= 0) setSelectedDistrictIdx(idx);
        }
        setShowProjectPicker(false);
        // Align globe directly over target survey coordinates
        setCustomCenter({ lat: activeDistrict.lat, lng: activeDistrict.lng });
        setIsFlyingIn(true);

        // Planetary camera dive sequence
        setTimeout(() => {
            setIsZoomedToDistrict(true);
            setIsFlyingIn(false);
        }, 650);
    }, [isFlyingIn, isZoomedToDistrict, activeDistrict, inspectableDistricts]);

    const handleReturnToGlobe = useCallback(() => {
        setIsZoomedToDistrict(false);
        setAtomicGlobeFocus(null);
        setAutoRotate(true);
    }, []);

    // Select a district: deep-zoom the globe onto it (smooth 60 FPS fly) and open the details card
    const handleSelectDistrict = useCallback((idx: number) => {
        const d = inspectableDistricts[idx] || activeDistrict;
        if (!d) return;
        setSelectedDistrictIdx(idx);
        setShowProjectPicker(false);
        setAutoRotate(false);
        setCustomCenter({ lat: d.lat, lng: d.lng });
        // No zoom/pan snap here: the flight interpolates from the CURRENT camera
        // state to the target, avoiding any one-frame jump (stutter/shake).
        setFlyTarget({
            latitude: d.lat,
            longitude: d.lng,
            zoom: 6.0,
            timestamp: Date.now(),
        });
        if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) setAtomicGlobeFocus({ lat: d.lat, lng: d.lng });
        setShowDistrictPopup(true);
    }, [inspectableDistricts, activeDistrict]);

    // Deselect: close the details card and glide the globe back out to the project overview
    const handleDeselectDistrict = useCallback(() => {
        setSelectedDistrictIdx(0);
        setShowDistrictPopup(false);
        setCustomCenter(null);
        setAutoRotate(false);
        setFlyTarget({
            latitude: projectLocation.latitude,
            longitude: projectLocation.longitude,
            zoom: 1.05,
            timestamp: Date.now(),
        });
        setAtomicGlobeFocus(null);
        window.setTimeout(() => setAutoRotate(true), 1500);
    }, [projectLocation]);

    return (
        <div className={`relative w-full showcase-landing text-white font-sans select-none flex flex-col justify-between bg-black ${viewMode === 'modules' ? 'max-lg:overflow-y-auto max-lg:!h-auto max-lg:!max-h-none' : 'overflow-hidden'}`}>

            {/* 1. Animate UI Stars Background, 3D Earth Globe & Clean Ambient Lighting */}
            <div className={`absolute inset-0 z-0 overflow-hidden isolate ${viewMode === 'globe' ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                <div className="absolute inset-0 bg-[#05070a]" />

                {/* Animate UI Stars Background (multi-depth starfield with slow, relaxed rotation) */}
                <div className={`absolute inset-0 z-0 pointer-events-none transition-transform duration-700 ease-out ${isFlyingIn ? 'scale-125' : 'scale-100'
                    }`}>
                    <div className="w-full h-full animate-spin-slow">
                        <StarsBackground
                            factor={0.035}
                            speed={55}
                            starColor="#ffffff"
                            className="w-full h-full opacity-80"
                        />
                    </div>
                </div>

                {/* The 3D Interactive Globe (vector Globe by default, switchable to the Atomic point-cloud Globe) */}
                <div className={`absolute inset-0 flex items-center justify-center z-10 ${viewMode === 'globe' ? 'pointer-events-auto' : 'pointer-events-none'
                    }`}>
                    {showAtomicGlobe ? (
                        <div className={`w-full h-full flex items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${isFlyingIn
                                ? 'scale-[1.7] opacity-0 blur-[2px]'
                                : viewMode === 'globe'
                                    ? 'translate-x-0 translate-y-0 scale-100 opacity-100'
                                    : 'max-sm:translate-y-[14%] lg:-translate-x-[36%] lg:translate-y-[22%] lg:scale-[1.95] opacity-85'
                            }`}>
                            <AtomicGlobeBoundary markers={globeMarkers}>
                            <AtomicGlobeHost
                                markers={atomicGlobeMarkers}
                                className="w-full h-full"
                                focusTarget={atomicGlobeFocus}
                                activeTargetCoord={{ lat: activeLat, lng: activeLng }}
                                zoom={globeZoom}
                                onZoomChange={setGlobeZoom}
                                enableZoom
                                activeMarkerLabel={activeDistrict.name}
                                onActiveMarkerProjected={handleActiveMarkerProjected}
                                backgroundColor="transparent"
                                dotColor="#cfe0ff"
                                dotDensity={80000}
                                baseSize={4.5}
                                backParticleOpacity={0.12}
                                rotationSpeed={autoRotate && !viewTransitioning ? 0.06 : 0}
                                centerLng={activeLng}
                                tilt={18}
                                globeScale={isMobile ? 0.59 : 1.05}
                                introDuration={2.2}
                                persistentAssembly={false}
                                reformOnScroll={false}
                                allowVerticalDrag
                                verticalDragLimit={70}
                                enableHover
                                markerType="beacon"
                                pinColor="#4da6ff"
                                markerBgColor="#0b1020"
                                markerTextColor="#ffffff"
                                markerActiveBgColor="#4da6ff"
                                markerActiveIconColor="#0b1020"
                                showArcs
                                arcColor="#4da6ff"
                                arcSpeed={0.25}
                                arcMode="chain"
                                arcHeight={0.4}
                                performanceMode="auto"
                            />
                            </AtomicGlobeBoundary>
                        </div>
                    ) : (
                        <div className={`w-full h-full flex items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${isFlyingIn
                                ? 'scale-[2.5] opacity-0 blur-[2px]'
                                : viewMode === 'globe'
                                    ? 'translate-x-0 translate-y-0 scale-100 opacity-100'
                                    : 'max-sm:translate-y-[14%] lg:-translate-x-[36%] lg:translate-y-[22%] lg:scale-[1.95] opacity-85'
                            }`}>
                            <EarthGlobe
                                autoRotate={autoRotate && !viewTransitioning}
                                autoRotateSpeed={1.8}
                                centerLatitude={activeLat}
                                centerLongitude={activeLng}
                                flyTo={flyTarget || undefined}
                                enableDrag={true}
                                enableZoom={true}
                                enablePan={true}
                                zoom={globeZoom}
                                onZoomChange={setGlobeZoom}
                                panOffset={globePan}
                                onPanChange={setGlobePan}
                                oceanColor="#0f1318"
                                landFill="#262c34"
                                landStroke="#3b434d"
                                strokeWidth={0.5}
                                glowColor="rgba(255, 255, 255, 0.18)"
                                glowIntensity={0.65}
                                markers={globeMarkers}
                                activeTargetCoord={{ lat: activeDistrict.lat, lng: activeDistrict.lng }}
                                onActiveMarkerProjected={handleActiveMarkerProjected}
                                onZoomIn={() => handleInspectDistrict()}
                                onMarkerClick={(marker) => {
                                    const idx = inspectableDistricts.findIndex(d => d.name.toLowerCase() === marker.label?.toLowerCase());
                                    if (idx >= 0) {
                                        // Toggle: clicking the already-selected district again → deselect + zoom out
                                        if (showDistrictPopup && idx === selectedDistrictIdx) {
                                            handleDeselectDistrict();
                                        } else {
                                            handleSelectDistrict(idx);
                                        }
                                    } else {
                                        // Available survey data marker → fly the camera to that cluster
                                        handleFocusProject({ lat: marker.latitude, lng: marker.longitude });
                                    }
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Atmospheric Entry HUD Badge during planetary camera dive — text only, no box or dot */}
                {isFlyingIn && (
                    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center animate-in fade-in duration-200">
                        <div className="flex items-center gap-3 text-center select-none">
                            <Loader2 size={16} className="text-white/70 animate-spin shrink-0" />
                            <div>
                                <div className="text-xs font-bold text-white uppercase tracking-widest">
                                    Atmospheric Descent Vector
                                </div>
                                <div className="text-[10px] text-white/60 font-mono tracking-wide mt-0.5">
                                    Approaching to {activeDistrict.name} area
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Subtle vignette only in modules mode to maintain high readability */}
                {viewMode === 'modules' && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
                )}
            </div>

            {/* 2. Top Header Navbar (Module navigation centered, balanced left & right) */}
            <header className="relative z-30 px-3 sm:px-8 py-2 sm:py-3 flex items-center justify-between border-b border-white/10 bg-black/90 backdrop-blur-md shrink-0 gap-3 sm:gap-4">
                {/* Left: System Title */}
                <div className="flex items-center gap-3 min-w-0 z-10">
                    <div className="max-w-[140px] xs:max-w-[190px] sm:max-w-[240px] 2xl:max-w-none min-w-0 pr-1 sm:pr-2">
                        <span className="text-xs sm:text-sm font-semibold tracking-tight text-white block leading-tight truncate">
                            Mobile Mapping Data Management System
                        </span>
                        <span className="text-[10px] sm:text-xs text-neutral-400 font-medium hidden xs:block truncate">
                            Spatial Trajectory Processing &amp; Quality Assurance Pipeline
                        </span>
                    </div>
                </div>

                {/* Center: Module Navigation (Strictly Centered horizontally & vertically) */}
                <nav
                    aria-label="System Modules"
                    className="hidden xl:flex items-center gap-3 2xl:gap-5 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-10"
                >
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => handleModuleChange(idx)}
                            className={`text-[11px] 2xl:text-xs font-medium transition-colors cursor-pointer py-1 whitespace-nowrap ${activeIndex === idx && viewMode === 'modules'
                                    ? 'text-white font-semibold'
                                    : 'text-neutral-400 hover:text-white'
                                }`}
                        >
                            {mod.title.split('&')[0].trim()}
                        </button>
                    ))}
                </nav>

                {/* Right: View Mode Switcher + Action Buttons */}
                <div className="flex items-center gap-3 sm:gap-4 shrink-0 z-10">
                    {/* Vertical divider separating module navigation / system links from the 3D Earth view mode switcher */}
                    <div className="h-4 w-px bg-white/20 hidden xl:block" />

                    {/* View Mode Switcher: Clean monochromatic text tabs with Google font icons, no box button */}
                    <div className="flex items-center gap-1.5 sm:gap-4 text-[11px] sm:text-xs">
                        <button
                            onClick={() => setViewMode('globe')}
                            className={`py-1 transition-colors cursor-pointer flex items-center gap-1 sm:gap-1.5 border-b-2 ${viewMode === 'globe'
                                    ? 'text-white font-semibold border-white'
                                    : 'text-neutral-400 hover:text-white border-transparent'
                                }`}
                        >
                            <span className="material-symbols-outlined text-[13px] sm:text-[15px] leading-none">public</span>
                            <span>3D Earth</span>
                        </button>
                        <button
                            onClick={() => setViewMode('modules')}
                            className={`py-1 transition-colors cursor-pointer flex items-center gap-1 sm:gap-1.5 border-b-2 ${viewMode === 'modules'
                                    ? 'text-white font-semibold border-white'
                                    : 'text-neutral-400 hover:text-white border-transparent'
                                }`}
                        >
                            <span className="material-symbols-outlined text-[13px] sm:text-[15px] leading-none">grid_view</span>
                            <span>Modules</span>
                        </button>
                    </div>

                    <div className="h-4 w-px bg-white/10 hidden sm:block" />

                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard('auth')}
                        className="hidden sm:block text-xs font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer py-1"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                        className="text-xs font-medium text-white hover:text-neutral-300 transition-colors cursor-pointer flex items-center gap-1 sm:gap-1.5 py-1"
                    >
                        <span className="hidden sm:inline">Launch Workspace</span>
                        <span className="sm:hidden text-[10px]">Launch</span>
                        <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
                    </button>
                </div>
            </header>

            {/* Centered Platform Title & Subtitle (Top of Showcase) */}
            {viewMode === 'modules' && (
                <div className="relative z-30 w-full text-center shrink-0 pt-6 sm:pt-10">
                    {/* Title & Subtitle — stacked above the sparkles */}
                    <div className="w-full flex flex-col items-center justify-center overflow-hidden px-4 sm:px-8">
                        <h1 className="text-lg sm:text-3xl xl:text-4xl font-extrabold tracking-tight text-white leading-[1.15] text-center">
                            GeoSphere 360° Mobile Mapping Platform
                        </h1>
                        <p className="text-[11px] sm:text-sm text-neutral-400 font-normal leading-relaxed max-w-2xl mt-2 sm:mt-2.5">
                            An integrated WebGIS workspace where survey rigs, GPU processing workers, NAS storage, and PostGIS databases collaborate to transform mobile mapping data into trustworthy, published infrastructure assets.
                        </p>
                    </div>

                    {/* Sparkles container — below the subtitle */}
                    <div className="w-full max-w-lg sm:max-w-2xl mx-auto h-20 sm:h-28 relative mt-0.5">
                        {/* Gradients */}
                        <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-indigo-500 to-transparent h-px w-3/4" />
                        <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-indigo-500 to-transparent h-px w-3/4" />
                        <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-sky-500 to-transparent h-[2px] w-1/4" />
                        <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-sky-500 to-transparent h-px w-1/4" />

                        {/* Soft light glow below the cyan line */}
                        <div aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-80 h-52 pointer-events-none">
                            {/* soft glow dropping below the line */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-40 h-16 rounded-full bg-sky-400/30 blur-xl" />
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-64 h-24 rounded-full bg-sky-500/15 blur-2xl" />
                        </div>

                        {/* Core component — mounted after the view-switch transition so tsParticles init
                            (~500 particles) doesn't collide with the globe park animation / panel crossfade */}
                        {titleSparklesReady && (
                            <div className="absolute inset-0 w-full h-full [mask-image:radial-gradient(ellipse_48%_175%_at_50%_0%,black_42%,transparent_78%)]">
                                <SparklesCore
                                    id="tsparticlesfullpage"
                                    background="transparent"
                                minSize={0.4}
                                maxSize={1}
                                particleDensity={1200}
                                className="w-full h-full"
                                particleColor="#FFFFFF"
                                    />
                                </div>
                            )}
                    </div>
                </div>
            )}

            {/* 3. Main Showcase Section */}
            <main
                className={`relative z-20 flex-1 min-h-0 w-full px-4 sm:px-8 py-4 sm:py-6 overflow-y-auto lg:overflow-hidden flex flex-col items-center justify-center ${viewMode === 'globe' ? 'pointer-events-none' : 'pointer-events-auto'
                    }`}
                style={{ backgroundColor: 'transparent' }}
            >

                {/* 3D Globe Telemetry HUD & Interactive Controls (Active when viewMode === 'globe') */}
                {viewMode === 'globe' && (
                    <div className={`absolute inset-0 pointer-events-none p-2 sm:p-8 flex flex-col justify-between z-20 transition-opacity duration-300 ${isFlyingIn || isZoomedToDistrict ? 'opacity-0 pointer-events-none' : 'opacity-100'
                        }`}>
                        {/* Top Center Minimal Orientation Badge */}
                        <div className="w-full flex flex-col items-center pt-1 gap-1">
                            <div className="px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-neutral-900/80 backdrop-blur-md border border-white/10 shadow-xl flex items-center gap-1.5 sm:gap-2">
                                <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full transition-colors duration-300 ${showDistrictPopup ? 'bg-red-500' : 'bg-white/40'
                                    }`} />
                                <span className="text-[9px] sm:text-[11px] font-mono uppercase tracking-wider text-neutral-200 font-semibold">
                                    EXPLORE AVAILABLE PROJECT AREA
                                </span>
                            </div>
                            <span className="text-[10px] text-neutral-400 font-mono tracking-wide hidden sm:block">
                                Left-drag: Rotate • Right-drag / Shift: Pan • Scroll: Zoom • Double-click: Reset
                            </span>
                        </div>

                        {/* Bottom Row: Geodetic HUD (Left) & Controls (Right) */}
                        <div className="w-full flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 pb-2">
                            {/* Geodetic Telemetry Card - Click to focus and display location on 3D globe */}
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                    setViewMode('globe');
                                    if (showDistrictPopup) {
                                        handleDeselectDistrict();
                                    } else if (activeDistrict) {
                                        handleSelectDistrict(selectedDistrictIdx);
                                    }
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        setViewMode('globe');
                                        if (showDistrictPopup) {
                                            handleDeselectDistrict();
                                        } else if (activeDistrict) {
                                            handleSelectDistrict(selectedDistrictIdx);
                                        }
                                    }
                                }}
                                className={`p-2.5 sm:p-4 rounded-2xl bg-black/75 hover:bg-black/90 backdrop-blur-xl border text-left max-w-[260px] sm:max-w-[320px] pointer-events-auto shadow-2xl space-y-1 sm:space-y-1.5 cursor-pointer transition-all duration-200 group active:scale-[0.98] outline-none ${showDistrictPopup
                                        ? 'border-red-500/70 ring-1 ring-red-500/30 shadow-[0_0_24px_rgba(239,68,68,0.25)]'
                                        : 'border-white/10 hover:border-red-500/50'
                                    }`}
                                title="Click to rotate globe and center on project location (Toggle Panotrack Popup)"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 sm:gap-2 truncate">
                                        <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 transition-colors duration-300 ${showDistrictPopup ? 'bg-red-500' : 'bg-white/40'
                                            }`} />
                                        <span className="text-[11px] sm:text-xs font-semibold text-white tracking-wide truncate group-hover:text-red-400 transition-colors">
                                            {projectLocation.name}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                                        {showDistrictPopup && (
                                            <span className="text-[9px] sm:text-[10px] font-semibold text-emerald-400/90 uppercase tracking-wider shrink-0">
                                                Active
                                            </span>
                                        )}
                                        <span className={`material-symbols-outlined text-[13px] sm:text-[15px] leading-none transition-colors shrink-0 ${showDistrictPopup ? 'text-red-400' : 'text-neutral-400 group-hover:text-white'
                                            }`} title="Toggle Panotrack District Popup">
                                            location_on
                                        </span>
                                    </div>
                                </div>
                                <p className="text-[10px] sm:text-[11px] text-neutral-400 font-mono">
                                    {projectLocation.subtext}
                                </p>
                                <div className="pt-1.5 sm:pt-2 border-t border-white/10 flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                    <span>Target Distance</span>
                                    <span className="text-white font-mono font-semibold">{targetDistance.toLocaleString()} km</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                    <span>Survey Mileage</span>
                                    <span className="text-white font-mono font-semibold">{computedDistance.toFixed(1)} km</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                    <span>State</span>
                                    <span className="text-white font-mono font-semibold">{activeDistrict?.state || '—'}</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                    <span>District</span>
                                    <span className="text-white font-mono font-semibold">{activeDistrict?.name || '—'}</span>
                                </div>
                                <div className="hidden sm:flex items-center justify-between text-[11px] text-neutral-400">
                                    <span>Project Created</span>
                                    <span className="text-white font-mono font-semibold">{projectCreatedLabel}</span>
                                </div>
                            </div>

                            {/* Quick Action Navigation Buttons */}
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pointer-events-auto">
                                {/* Globe Renderer Choice: Classic Vector Globe ↔ Atomic Point-Cloud Globe */}
                                <div className="flex items-center bg-neutral-900/80 backdrop-blur-md px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl border border-white/10 shadow-md">
                                    <button
                                        onClick={() => setShowAtomicGlobe(false)}
                                        title="Switch to the classic vector globe"
                                        className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-semibold transition-colors cursor-pointer ${showAtomicGlobe ? 'text-neutral-400 hover:text-white' : 'bg-white/10 text-white'
                                            }`}
                                    >
                                        Vector
                                    </button>
                                    <button
                                        onClick={() => setShowAtomicGlobe(true)}
                                        title="Switch to the photorealistic point-cloud globe"
                                        className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-semibold transition-colors cursor-pointer ${showAtomicGlobe ? 'bg-sky-500/80 text-white' : 'text-neutral-400 hover:text-white'
                                            }`}
                                    >
                                        <span className="material-symbols-outlined text-[10px] sm:text-[11px] leading-none align-[-2px]">
                                            blur_on
                                        </span>
                                        Atomic
                                    </button>
                                </div>

                                {/* Interactive 3D Zoom Controls */}
                                <div className="flex items-center bg-neutral-900/80 backdrop-blur-md px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl border border-white/10 shadow-md">
                                    <button
                                        onClick={() => setGlobeZoom(z => Math.max(0.5, +(z / 1.25).toFixed(2)))}
                                        title="Zoom Out (Scroll Down)"
                                        className="w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white flex items-center justify-center font-bold text-xs sm:text-sm cursor-pointer transition-colors"
                                    >
                                        -
                                    </button>
                                    <span className="text-[10px] sm:text-[11px] font-mono px-1 sm:px-2 text-neutral-300 select-none min-w-[30px] sm:min-w-[38px] text-center">
                                        {Math.round(globeZoom * 100)}%
                                    </span>
                                    <button
                                        onClick={() => setGlobeZoom(z => Math.min(8.0, +(z * 1.25).toFixed(2)))}
                                        title="Zoom In (Scroll Up)"
                                        className="w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white flex items-center justify-center font-bold text-xs sm:text-sm cursor-pointer transition-colors"
                                    >
                                        +
                                    </button>
                                    {(Math.abs(globeZoom - 1.0) > 0.05 || globePan.x !== 0 || globePan.y !== 0) && (
                                        <button
                                            onClick={() => { setGlobeZoom(1.05); setGlobePan({ x: 0, y: 0 }); }}
                                            title="Reset View (Double-click)"
                                            className="ml-1 px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-[10px] rounded-md bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>

                                <div className="relative">
                                    <div className="flex items-center rounded-lg sm:rounded-xl bg-red-600/90 hover:bg-red-500 shadow-lg text-white font-medium text-[11px] sm:text-xs transition-all active:scale-95">
                                        <button
                                            onClick={() => handleInspectDistrict()}
                                            className="px-2.5 sm:px-3.5 py-1 sm:py-1.5 flex items-center gap-1 sm:gap-1.5 cursor-pointer"
                                            title={`Inspect ${activeDistrict ? activeDistrict.name : 'District'} Boundary`}
                                        >
                                            <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                            <span className="hidden min-[420px]:inline">Inspect {inspectableDistricts.length > 1 ? activeDistrict.name : (resolvedDistricts.length > 0 ? (activeDistrict?.name || 'District') : 'District')}</span>
                                            <span className="min-[420px]:hidden">Inspect</span>
                                        </button>
                                        {inspectableDistricts.length > 1 && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowProjectPicker(prev => !prev);
                                                }}
                                                className="pr-2 pl-1.5 sm:pr-2.5 sm:pl-1.5 py-1 sm:py-1.5 border-l border-white/20 hover:bg-white/10 rounded-r-lg sm:rounded-r-xl cursor-pointer flex items-center"
                                                title="Choose project district to inspect"
                                            >
                                                <span className="material-symbols-outlined text-[13px] sm:text-[14px] leading-none">
                                                    {showProjectPicker ? 'arrow_drop_up' : 'arrow_drop_down'}
                                                </span>
                                            </button>
                                        )}
                                    </div>

                                    {/* Multi-Project District Popover */}
                                    {showProjectPicker && inspectableDistricts.length > 1 && (
                                        <div className="absolute bottom-full mb-2 right-0 w-60 rounded-2xl bg-black/90 backdrop-blur-xl border border-white/15 shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                                            <div className="px-2.5 py-1 text-[10px] font-mono text-neutral-400 uppercase tracking-wider border-b border-white/10 mb-1 flex items-center justify-between">
                                                <span>Select Project</span>
                                                <span className="text-white/60">{inspectableDistricts.length} Districts</span>
                                            </div>
                                            {inspectableDistricts.map((d, idx) => (
                                                <button
                                                    key={d.id}
                                                    onClick={() => {
                                                        setSelectedDistrictIdx(idx);
                                                        setShowProjectPicker(false);
                                                        handleFocusProject({ lat: d.lat, lng: d.lng });
                                                    }}
                                                    className={`w-full px-2.5 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${idx === selectedDistrictIdx
                                                            ? 'bg-red-500/20 text-white font-semibold'
                                                            : 'text-neutral-300 hover:bg-white/10 hover:text-white'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2 truncate">
                                                        <MapPin className={`w-3.5 h-3.5 shrink-0 ${idx === selectedDistrictIdx ? 'text-red-400' : 'text-neutral-400'}`} />
                                                        <span className="truncate">{d.name}</span>
                                                    </div>
                                                    <span className="text-[10px] text-neutral-400 font-mono shrink-0">{d.state}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => setAutoRotate(!autoRotate)}
                                    className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-neutral-900/80 hover:bg-neutral-800 text-[11px] sm:text-xs font-medium text-white border border-white/10 transition-colors cursor-pointer shadow-md active:scale-95 flex items-center gap-1 sm:gap-1.5"
                                >
                                    <span className="material-symbols-outlined text-[13px] sm:text-[14px] leading-none">{autoRotate ? 'pause' : 'play_arrow'}</span>
                                    <span>{autoRotate ? 'Pause' : 'Rotate'}</span>
                                </button>
                                <button
                                    onClick={() => setViewMode('modules')}
                                    className="px-3 sm:px-4 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-white text-black font-semibold text-[11px] sm:text-xs transition-all hover:bg-neutral-200 cursor-pointer shadow-lg flex items-center gap-1 sm:gap-1.5 active:scale-95"
                                >
                                    <span className="material-symbols-outlined text-[13px] sm:text-[14px] leading-none">grid_view</span>
                                    <span>Modules</span>
                                    <ArrowRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className={`w-full max-w-[1600px] mx-auto my-auto lg:-translate-y-3 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch ${viewMode === 'globe' ? 'hidden' : 'grid'}`}>

                    {/* Left Narrative Panel (Spacious, Typography-Driven, No Card Boxes) */}
                    <div className={`w-full lg:col-span-5 space-y-4 text-left flex flex-col justify-center order-2 lg:order-1 pb-6 lg:pb-0 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform transform-gpu ${isAnimating ? 'opacity-0 -translate-y-2 scale-[0.99] blur-[2px]' : 'opacity-100 translate-y-0 scale-100 blur-none'}`}>

                        {/* Active Module Details */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-widest uppercase text-neutral-300 border border-white/10 bg-white/[0.03]">
                                    <span className="w-1 h-1 rounded-full bg-neutral-400" />
                                    {current.category}
                                </span>
                                <span className="text-[10px] font-mono text-neutral-600 tabular-nums tracking-wider">
                                    {String(activeIndex + 1).padStart(2, '0')}/{String(SYSTEM_MODULES.length).padStart(2, '0')}
                                </span>
                            </div>

                            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white leading-snug pt-0.5">
                                {current.title}
                            </h2>

                            <p className="text-xs sm:text-[13px] text-neutral-400 font-normal leading-relaxed max-w-lg">
                                {current.description}
                            </p>
                        </div>

                        {/* CTA & Metric */}
                        <div className="pt-1 flex flex-wrap items-center gap-3">
                            <HoverBorderGradient
                                onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                                containerClassName="group/btn rounded-lg cursor-pointer active:scale-[0.97]"
                                className="px-4 py-2 rounded-lg font-medium text-xs flex items-center justify-center gap-2 text-neutral-200"
                            >
                                <span>Enter {current.title.split('&')[0].trim()}</span>
                                <ArrowRight className="w-3.5 h-3.5 text-neutral-400 group-hover/btn:text-neutral-200 transition-colors group-hover/btn:translate-x-0.5 transition-transform" />
                            </HoverBorderGradient>

                            <div className="h-4 w-px bg-white/10" />

                            <div className="text-[11px] text-neutral-500 flex items-center gap-1.5">
                                <span>{current.metricLabel}</span>
                                <span className="font-semibold text-neutral-200">{current.metricValue}</span>
                            </div>
                        </div>

                        {/* System Metadata */}
                        <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] text-neutral-500">
                            <span className="flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-neutral-600" />
                                PostGIS + Supabase
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-neutral-600" />
                                MapLibre GL + {viewerDisplayName}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-neutral-600" />
                                Published &amp; Production
                            </span>
                        </div>

                        {/* Execution Flow - Horizontal Step Indicators (above footer) */}
                        {current.workflow && current.workflow.length > 0 && (
                            <div className="space-y-2.5 pt-3 mt-auto border-t border-white/[0.06]">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-500 block">
                                    Workflow
                                </span>
                                <div className="flex items-stretch gap-0">
                                    {current.workflow.map((wf, idx) => (
                                        <React.Fragment key={idx}>
                                            <div className="flex-1 py-1.5">
                                                <div className="text-[10px] font-mono font-semibold text-neutral-300 tracking-wide mb-0.5">
                                                    {wf.step}
                                                </div>
                                                <div className="text-[10px] text-neutral-500 leading-relaxed">
                                                    {wf.action}
                                                </div>
                                            </div>
                                            {idx < current.workflow.length - 1 && (
                                                <div className="flex items-center px-1">
                                                    <div className="w-px h-4 bg-white/10" />
                                                </div>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        )}

                    </div>

                    {/* Right Screenshot Preview Frame */}
                    <div
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className={`w-full lg:col-span-7 flex flex-col gap-2 order-1 lg:order-2 transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] touch-pan-y will-change-transform transform-gpu ${isAnimating ? 'opacity-0 scale-[0.985] translate-y-1 blur-[2px]' : 'opacity-100 scale-100 translate-y-0 blur-none'}`}
                    >
                        {/* Subtitle Bar */}
                        <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 shrink-0" />
                                <span className="text-[11px] sm:text-xs font-medium text-neutral-300 truncate">
                                    {current.subtitle}
                                </span>
                            </div>
                            <span className="text-[10px] font-mono text-neutral-600 shrink-0 ml-2 tabular-nums">
                                {activePhotoIdx + 1}/{current.images.length}
                            </span>
                        </div>

                        {/* Viewport Image */}
                        <div className="relative w-full flex-1 min-h-0 rounded-xl overflow-hidden flex items-center justify-center bg-black/50">
                            <img
                                key={activeImage}
                                src={activeImage}
                                alt={current.title}
                                loading="eager"
                                decoding="async"
                                className="w-full h-full object-contain object-center transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
                            />

                            {/* Gallery Navigation Arrows */}
                            {current.images.length > 1 && (
                                <>
                                    <button
                                        onClick={() => setActivePhotoIdx((activePhotoIdx - 1 + current.images.length) % current.images.length)}
                                        aria-label="Previous image"
                                        className="group/prev absolute left-2 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 rounded-full bg-black/60 hover:bg-black/80 text-neutral-200 hover:text-white border border-white/15 hover:border-white/30 cursor-pointer active:scale-90 transition-all backdrop-blur-sm"
                                    >
                                        <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M19 12H6" />
                                            <path d="M12 5l-7 7 7 7" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => setActivePhotoIdx((activePhotoIdx + 1) % current.images.length)}
                                        aria-label="Next image"
                                        className="group/next absolute right-2 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 rounded-full bg-black/60 hover:bg-black/80 text-neutral-200 hover:text-white border border-white/15 hover:border-white/30 cursor-pointer active:scale-90 transition-all backdrop-blur-sm"
                                    >
                                        <svg viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M5 12h13" />
                                            <path d="M12 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Active Section Tip Details */}
                        {activeHotspot && (
                            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-left animate-in fade-in duration-150">
                                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-semibold text-neutral-200">
                                            {activeHotspot.title}
                                        </span>
                                        <span className="text-[9px] text-neutral-600 uppercase tracking-wider">
                                            {activeHotspot.tag}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setActiveHotspotId(null)}
                                        className="text-[10px] text-neutral-600 hover:text-neutral-300 cursor-pointer transition-colors"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                                <p className="text-[11px] text-neutral-400 mt-1.5 leading-relaxed">
                                    {activeHotspot.description}
                                </p>
                                <div className="mt-1.5 text-[10px] text-neutral-400 font-normal">
                                    <span className="text-neutral-500">Tip: </span>
                                    {activeHotspot.tip}
                                </div>
                            </div>
                        )}

                        {/* Section Highlights Selector */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar flex-1">
                                <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-neutral-600 shrink-0 mr-1">
                                    Sections
                                </span>
                                {current.hotspots.map((spot) => {
                                    const isSelected = activeHotspotId === spot.id;
                                    return (
                                        <button
                                            key={spot.id}
                                            onClick={() => setActiveHotspotId(isSelected ? null : spot.id)}
                                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer shrink-0 ${isSelected
                                                    ? 'bg-white/10 text-neutral-200'
                                                    : 'text-neutral-600 hover:text-neutral-400 hover:bg-white/[0.04]'
                                                }`}
                                        >
                                            <span>{spot.title.split(':')[0].replace(/Station \d+: /, '')}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Thumbnail previews */}
                            {current.images.length > 1 && (
                                <div className="flex items-center gap-1 shrink-0">
                                    {current.images.map((imgUrl, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setActivePhotoIdx(idx)}
                                            className={`h-5 w-7 rounded-sm overflow-hidden transition-all cursor-pointer ${activePhotoIdx === idx
                                                    ? 'ring-1 ring-white/40 opacity-100'
                                                    : 'opacity-30 hover:opacity-60'
                                                }`}
                                        >
                                            <img
                                                src={imgUrl}
                                                alt={`Preview ${idx + 1}`}
                                                loading="eager"
                                                className="w-full h-full object-cover object-top"
                                            />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                    </div>

                </div>
            </main>

            {/* 4. Pinned Footer Navigation Controls (Active in modules mode) */}
            <footer className={`relative z-30 w-full px-2 sm:px-8 py-2 sm:py-3 items-center justify-between border-t border-white/10 bg-black shrink-0 ${viewMode === 'modules' ? 'flex' : 'hidden'}`}>
                <button
                    onClick={() => handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors cursor-pointer group"
                >
                    <ChevronLeft className="w-4 h-4 text-neutral-400 group-hover:text-white transition-colors" />
                    <div className="hidden sm:block text-left">
                        <span className="text-[10px] text-neutral-500 block uppercase tracking-wider font-semibold">Previous</span>
                        <span className="text-xs font-medium text-neutral-300 group-hover:text-white">{prevModule.title.split('&')[0]}</span>
                    </div>
                </button>

                {/* Step Indicator Dots (module navigation) */}
                <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
                    {SYSTEM_MODULES.map((m, i) => (
                        <button
                            key={m.id}
                            onClick={() => handleModuleChange(i)}
                            aria-label={`Go to module ${i + 1}: ${m.title}`}
                            className={`cursor-pointer p-1 rounded-full transition-all ${i === activeIndex ? '' : 'hover:bg-white/10'}`}
                        >
                            <span
                                className={`block rounded-full transition-all duration-300 ${i === activeIndex
                                    ? 'w-6 h-1.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                                    : 'w-1.5 h-1.5 bg-white/25'
                                    }`}
                            />
                        </button>
                    ))}
                </div>

                <button
                    onClick={() => handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors cursor-pointer group"
                >
                    <div className="hidden sm:block text-right">
                        <span className="text-[10px] text-neutral-500 block uppercase tracking-wider font-semibold">Next</span>
                        <span className="text-xs font-medium text-neutral-300 group-hover:text-white">{nextModule.title.split('&')[0]}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:text-white transition-colors" />
                </button>
            </footer>

            {/* 4. Floating 3D Panotrack District HUD Card & SVG Leader Line Overlay (Screen-space 1:1 with EarthGlobe) */}
            {viewMode === 'globe' && showDistrictPopup && activePopupData && !isFlyingIn && !isZoomedToDistrict && (
                <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden animate-in fade-in duration-500">
                    {/* Angled SVG Laser Leader Line connecting marker to card (Monochromatic) */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                        {/* Fade out the whole leader assembly when the marker is projected off-globe,
                            so the dashed line never strays off-screen / down past the card */}
                        <g
                            opacity={popupScreenLayout.visible ? 1 : 0}
                            style={{ transition: 'opacity 500ms ease' }}
                        >
                            {/* Pulsing beacon ring at marker location */}
                            <circle
                                cx={popupScreenLayout.markerX}
                                cy={popupScreenLayout.markerY}
                                r={14}
                                fill="none"
                                stroke="rgba(255, 255, 255, 0.85)"
                                strokeWidth={1.5}
                                className="globe-pulse"
                            />
                            <circle
                                cx={popupScreenLayout.markerX}
                                cy={popupScreenLayout.markerY}
                                r={4.5}
                                fill="#ffffff"
                            />
                            {/* Laser path */}
                            <path
                                d={popupScreenLayout.leaderPath}
                                fill="none"
                                stroke="rgba(255, 255, 255, 0.85)"
                                strokeWidth={1.5}
                                strokeDasharray="5 3"
                                filter="drop-shadow(0 0 4px rgba(255, 255, 255, 0.5))"
                            />
                        </g>
                    </svg>

                    {/* Floating Panotrack District HUD Card */}
                    <div
                        ref={cardSizeRef}
                        className="absolute pointer-events-auto transition-all duration-200"
                        style={{
                            left: `${popupScreenLayout.cardX}px`,
                            top: `${popupScreenLayout.cardY}px`,
                        }}
                    >
                        <DistrictProjectPopup
                            data={activePopupData}
                            districts={resolvedDistricts.map(d => ({
                                id: d.id,
                                name: d.name,
                                state: d.state,
                                lat: d.lat,
                                lng: d.lng,
                                totalFrames: computedFrames,
                                totalPoi: computedPoi,
                                surveyMileage: computedDistance,
                                pipelineSla: slaPercent,
                                subgrids: activePopupData.subgrids,
                                trackPoints: activePopupData.trackPoints,
                            }))}
                            activeDistrictIndex={selectedDistrictIdx}
                            onSelectDistrict={(idx) => {
                                // Switching districts inside the card must NOT move the globe —
                                // it only re-focuses the popup's map highlight
                                setSelectedDistrictIdx(idx);
                            }}
                            onClose={() => handleDeselectDistrict()}
                        />
                    </div>
                </div>
            )}

            {/* 5. MapLibre GL District Boundary View (Active when zoomed into project district) */}
            {isZoomedToDistrict && activeDistrict && (
                <div className="absolute inset-0 z-50 animate-in fade-in zoom-in-95 duration-500">
                    <ProjectBoundaryMap
                        projectLocation={{
                            latitude: activeDistrict.lat,
                            longitude: activeDistrict.lng,
                            name: activeDistrict.name,
                            subtext: `${activeDistrict.state} • ${activeDistrict.lat.toFixed(4)}° N, ${activeDistrict.lng.toFixed(4)}° E`
                        }}
                        districtName={activeDistrict.name}
                        stateName={activeDistrict.state}
                        dailyData={dailyData}
                        panotrackPoints={activeDistrictPanotrack}
                        projectBoundary={activeProjectBoundary}
                        onReturnToGlobe={handleReturnToGlobe}
                        onEnterWorkspace={() => onEnterDashboard && onEnterDashboard(current.id)}
                    />
                </div>
            )}

        </div>
    );
};