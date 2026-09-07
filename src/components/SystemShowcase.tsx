import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'lucide-react';
import { usePanoramaViewer } from '../hooks/usePanoramaViewer';
import { StarsBackground } from './common/StarsBackground';
import { EarthGlobe } from './common/EarthGlobe';
import { ProjectBoundaryMap } from './common/ProjectBoundaryMap';
import { DISTRICT_METADATA } from './boundary/districtMetadata';

export interface SystemShowcaseProps {
    onEnterDashboard?: (targetView?: string) => void;
    dailyData?: any[];
    batchLogs?: any[];
    projectSettings?: any;
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
    projectSettings
}) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [activePhotoIdx, setActivePhotoIdx] = useState(0);
    const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [viewMode, setViewMode] = useState<'globe' | 'modules'>('modules');
    const [autoRotate, setAutoRotate] = useState(true);
    const [customCenter, setCustomCenter] = useState<{ lat: number; lng: number } | null>(null);
    const [flyTarget, setFlyTarget] = useState<{
        latitude: number;
        longitude: number;
        zoom?: number;
        timestamp: number;
    } | null>(null);
    const [isZoomedToDistrict, setIsZoomedToDistrict] = useState(false);
    const [isFlyingIn, setIsFlyingIn] = useState(false);
    const [globeZoom, setGlobeZoom] = useState(1.0);
    const [globePan, setGlobePan] = useState({ x: 0, y: 0 });

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
    const computedFrames = dailyData.reduce((acc, item) => acc + (Number(item.availableImagesCount || item.panoramas?.length || item.images || item.imagesProcessed || item.poiCount) || 0), 0);
    const computedDefects = dailyData.reduce((acc, item) => acc + (Number(item.imagesDefected || item.defectCount) || 0), 0);
    const activeJobs = batchLogs.filter((b: any) => b.status === 'In Progress' || b.status === 'Ongoing').length;
    const targetDistance = Number(projectSettings?.targetKm) || Number(projectSettings?.targetDistanceKm) || 0;
    const pctTarget = targetDistance > 0 ? Math.min(100, (computedDistance / targetDistance) * 100).toFixed(1) : '0.0';
    const slaPercent = computedFrames > 0
        ? Math.max(0, ((computedFrames - computedDefects) / computedFrames) * 100).toFixed(1)
        : '100.0';

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

        // Default: Active Survey at Jalan Jabi, Segamat, Johor (EPSG:4326 2.5458° N, 102.0873° E)
        return {
            latitude: 2.5458,
            longitude: 102.0873,
            name: 'Active Survey • Malaysia',
            subtext: 'Jalan Jabi • 2.546° N, 102.087° E'
        };
    }, [dailyData, projectSettings]);
    // Available districts/projects for inspection
    const inspectableDistricts = useMemo(() => {
        const boundary = projectSettings?.projectBoundary;
        const list: Array<{ id: string; name: string; state: string; lat: number; lng: number }> = [];

        if (Array.isArray(boundary?.districtNames) && boundary.districtNames.length > 0) {
            boundary.districtNames.forEach((name: string) => {
                const meta = DISTRICT_METADATA.find(d => d.name.toLowerCase() === name.toLowerCase());
                if (meta) {
                    list.push({
                        id: meta.id,
                        name: meta.name,
                        state: meta.stateName,
                        lat: meta.center[0],
                        lng: meta.center[1]
                    });
                } else {
                    list.push({
                        id: name.toLowerCase().replace(/\s+/g, '-'),
                        name,
                        state: boundary.regionName || 'Malaysia',
                        lat: projectLocation.latitude,
                        lng: projectLocation.longitude
                    });
                }
            });
        }

        if (list.length === 0) {
            list.push({
                id: 'segamat',
                name: 'Segamat',
                state: 'Johor',
                lat: 2.5458,
                lng: 102.0873
            });
        }

        return list;
    }, [projectSettings, projectLocation]);

    const [selectedDistrictIdx, setSelectedDistrictIdx] = useState(0);
    const [showProjectPicker, setShowProjectPicker] = useState(false);
    const activeDistrict = inspectableDistricts[selectedDistrictIdx] || inspectableDistricts[0];

    const activeLat = customCenter ? customCenter.lat : activeDistrict.lat;
    const activeLng = customCenter ? customCenter.lng : activeDistrict.lng;

    const globeMarkers = useMemo(() => {
        return inspectableDistricts.map((d, idx) => ({
            label: d.name,
            description: `${d.state} • ${d.lat.toFixed(3)}° N, ${d.lng.toFixed(3)}° E`,
            latitude: d.lat,
            longitude: d.lng,
            color: idx === selectedDistrictIdx ? '#ef4444' : '#94a3b8',
        }));
    }, [inspectableDistricts, selectedDistrictIdx]);

    // Focus camera directly onto active project location with smooth flight
    const handleFocusProject = useCallback((target?: { lat: number; lng: number } | React.MouseEvent | React.KeyboardEvent) => {
        const isCoord = target && typeof target === 'object' && 'lat' in target && 'lng' in target;
        const lat = isCoord ? (target as { lat: number; lng: number }).lat : activeDistrict.lat;
        const lng = isCoord ? (target as { lat: number; lng: number }).lng : activeDistrict.lng;
        setAutoRotate(false);
        setGlobePan({ x: 0, y: 0 });
        setGlobeZoom(1.0);
        setFlyTarget({
            latitude: lat,
            longitude: lng,
            zoom: 1.05,
            timestamp: Date.now(),
        });
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
        setAutoRotate(true);
    }, []);

    return (
        <div className="relative w-full h-[100dvh] max-h-[100dvh] text-white font-sans overflow-hidden select-none flex flex-col justify-between bg-black">

            {/* 1. Animate UI Stars Background, 3D Earth Globe & Clean Ambient Lighting */}
            <div className={`absolute inset-0 z-0 overflow-hidden ${viewMode === 'globe' ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                <div className="absolute inset-0 bg-[#05070a]" />

                {/* Animate UI Stars Background (multi-depth starfield with warp zoom during flight) */}
                <div className={`absolute inset-0 pointer-events-none transition-transform duration-700 ease-out ${
                    isFlyingIn ? 'scale-125' : 'scale-100'
                }`}>
                    <StarsBackground
                        factor={0.035}
                        speed={55}
                        starColor="#ffffff"
                        className="w-full h-full opacity-80"
                    />
                </div>

                {/* 3D Interactive Pure SVG Earth Globe Centered on Current Project Location with Fly-In Dive */}
                <div className={`absolute inset-0 flex items-center justify-center z-10 ${
                    viewMode === 'globe' ? 'pointer-events-auto' : 'pointer-events-none'
                }`}>
                    <div className={`w-full h-full flex items-center justify-center transform-gpu transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
                        isFlyingIn
                            ? 'scale-[2.5] opacity-0 blur-[2px]'
                            : viewMode === 'globe'
                                ? 'translate-x-0 translate-y-0 scale-100 opacity-100'
                                : 'lg:-translate-x-[36%] lg:translate-y-[22%] scale-[1.95] opacity-85'
                    }`}>
                        <EarthGlobe
                            autoRotate={autoRotate}
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
                            glowColor="rgba(255, 255, 255, 0.08)"
                            glowIntensity={0.5}
                            markers={globeMarkers}
                            onZoomIn={() => handleInspectDistrict()}
                            onMarkerClick={(marker) => {
                                const idx = inspectableDistricts.findIndex(d => d.name.toLowerCase() === marker.label?.toLowerCase());
                                if (idx >= 0) {
                                    setSelectedDistrictIdx(idx);
                                    handleFocusProject({ lat: marker.latitude, lng: marker.longitude });
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Atmospheric Entry HUD Badge during planetary camera dive */}
                {isFlyingIn && (
                    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center animate-in fade-in duration-200">
                        <div className="px-5 py-2.5 rounded-2xl bg-black/85 backdrop-blur-xl border border-red-500/50 text-center shadow-2xl space-y-1">
                            <div className="flex items-center justify-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                                <span className="text-xs font-bold text-white uppercase tracking-widest">
                                    Atmospheric Descent Vector
                                </span>
                            </div>
                            <p className="text-[10px] text-neutral-400 font-mono">
                                Approaching Segamat District • 2.5458° N, 102.0873° E
                            </p>
                        </div>
                    </div>
                )}

                {/* Subtle vignette only in modules mode to maintain high readability */}
                {viewMode === 'modules' && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
                )}
            </div>

            {/* 2. Top Header Navbar (Module navigation centered, balanced left & right) */}
            <header className="relative z-30 px-4 sm:px-8 py-3 flex items-center justify-between border-b border-white/10 bg-black/90 backdrop-blur-md shrink-0 gap-4">
                {/* Left: System Title */}
                <div className="flex items-center gap-3 min-w-0 shrink-0 z-10">
                    <div className="max-w-[240px] 2xl:max-w-none min-w-0 pr-2">
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
                            className={`text-[11px] 2xl:text-xs font-medium transition-colors cursor-pointer py-1 whitespace-nowrap ${
                                activeIndex === idx && viewMode === 'modules'
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
                    <div className="flex items-center gap-3 sm:gap-4 text-xs">
                        <button
                            onClick={() => setViewMode('globe')}
                            className={`py-1 transition-colors cursor-pointer flex items-center gap-1.5 border-b-2 ${
                                viewMode === 'globe'
                                    ? 'text-white font-semibold border-white'
                                    : 'text-neutral-400 hover:text-white border-transparent'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[15px] leading-none">public</span>
                            <span>3D Earth</span>
                        </button>
                        <button
                            onClick={() => setViewMode('modules')}
                            className={`py-1 transition-colors cursor-pointer flex items-center gap-1.5 border-b-2 ${
                                viewMode === 'modules'
                                    ? 'text-white font-semibold border-white'
                                    : 'text-neutral-400 hover:text-white border-transparent'
                            }`}
                        >
                            <span className="material-symbols-outlined text-[15px] leading-none">grid_view</span>
                            <span>Modules</span>
                        </button>
                    </div>

                    <div className="h-4 w-px bg-white/10 hidden sm:block" />

                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard('auth')}
                        className="text-xs font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer py-1"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                        className="text-xs font-medium text-white hover:text-neutral-300 transition-colors cursor-pointer flex items-center gap-1.5 py-1"
                    >
                        <span>Launch Workspace</span>
                        <ArrowRight className="w-3.5 h-3.5 text-neutral-400" />
                    </button>
                </div>
            </header>

            {/* 3. Main Showcase Section */}
            <main
                className={`relative z-20 flex-1 w-full px-4 sm:px-8 py-4 sm:py-6 overflow-y-auto lg:overflow-hidden flex items-start lg:items-center justify-start lg:justify-center ${
                    viewMode === 'globe' ? 'pointer-events-none' : 'pointer-events-auto'
                }`}
                style={{ backgroundColor: 'transparent' }}
            >

                {/* 3D Globe Telemetry HUD & Interactive Controls (Active when viewMode === 'globe') */}
                {viewMode === 'globe' && (
                    <div className={`absolute inset-0 pointer-events-none p-4 sm:p-8 flex flex-col justify-between z-20 transition-opacity duration-300 ${
                        isFlyingIn || isZoomedToDistrict ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    }`}>
                        {/* Top Center Minimal Orientation Badge */}
                        <div className="w-full flex flex-col items-center pt-1 gap-1">
                            <div className="px-3.5 py-1.5 rounded-full bg-neutral-900/80 backdrop-blur-md border border-white/10 shadow-xl flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-200 font-semibold">
                                    EXPLORE YOUR PROJECT AREA
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
                                onClick={handleFocusProject}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        handleFocusProject();
                                    }
                                }}
                                className="p-3.5 sm:p-4 rounded-2xl bg-black/75 hover:bg-black/90 hover:border-red-500/50 backdrop-blur-xl border border-white/10 text-left max-w-[320px] pointer-events-auto shadow-2xl space-y-1.5 cursor-pointer transition-all duration-200 group active:scale-[0.98] outline-none"
                                title="Click to rotate globe and center on project location"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 truncate">
                                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
                                        <span className="text-xs font-semibold text-white tracking-wide truncate group-hover:text-red-400 transition-colors">
                                            {projectLocation.name}
                                        </span>
                                    </div>
                                    <span className="material-symbols-outlined text-[15px] leading-none text-neutral-400 group-hover:text-white transition-colors shrink-0" title="Center on 3D Earth">
                                        location_on
                                    </span>
                                </div>
                                <p className="text-[11px] text-neutral-400 font-mono">
                                    {projectLocation.subtext}
                                </p>
                                <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-neutral-400">
                                    <span>Survey Mileage:</span>
                                    <span className="text-white font-mono font-semibold">{computedDistance.toFixed(1)} km</span>
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                                    <span>Pipeline SLA:</span>
                                    <span className="text-white font-mono font-semibold">{slaPercent}%</span>
                                </div>
                            </div>

                            {/* Quick Action Navigation Buttons */}
                            <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
                                {/* Interactive 3D Zoom Controls */}
                                <div className="flex items-center bg-neutral-900/80 backdrop-blur-md px-1.5 py-1 rounded-xl border border-white/10 shadow-md">
                                    <button
                                        onClick={() => setGlobeZoom(z => Math.max(0.5, +(z / 1.25).toFixed(2)))}
                                        title="Zoom Out (Scroll Down)"
                                        className="w-6 h-6 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer transition-colors"
                                    >
                                        -
                                    </button>
                                    <span className="text-[11px] font-mono px-2 text-neutral-300 select-none min-w-[38px] text-center">
                                        {Math.round(globeZoom * 100)}%
                                    </span>
                                    <button
                                        onClick={() => setGlobeZoom(z => Math.min(4.0, +(z * 1.25).toFixed(2)))}
                                        title="Zoom In (Scroll Up)"
                                        className="w-6 h-6 rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer transition-colors"
                                    >
                                        +
                                    </button>
                                    {(Math.abs(globeZoom - 1.0) > 0.05 || globePan.x !== 0 || globePan.y !== 0) && (
                                        <button
                                            onClick={() => { setGlobeZoom(1.0); setGlobePan({ x: 0, y: 0 }); }}
                                            title="Reset View (Double-click)"
                                            className="ml-1 px-1.5 py-0.5 text-[10px] rounded-md bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>

                                <div className="relative">
                                    <div className="flex items-center rounded-xl bg-red-600/90 hover:bg-red-500 shadow-lg text-white font-medium text-xs transition-all active:scale-95">
                                        <button
                                            onClick={() => handleInspectDistrict()}
                                            className="px-3.5 py-1.5 flex items-center gap-1.5 cursor-pointer"
                                            title={`Inspect ${activeDistrict.name} District Boundary`}
                                        >
                                            <MapPin className="w-3.5 h-3.5" />
                                            <span>Inspect {inspectableDistricts.length > 1 ? activeDistrict.name : 'District'}</span>
                                        </button>
                                        {inspectableDistricts.length > 1 && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowProjectPicker(prev => !prev);
                                                }}
                                                className="pr-2.5 pl-1.5 py-1.5 border-l border-white/20 hover:bg-white/10 rounded-r-xl cursor-pointer flex items-center"
                                                title="Choose project district to inspect"
                                            >
                                                <span className="material-symbols-outlined text-[14px] leading-none">
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
                                                    className={`w-full px-2.5 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                                        idx === selectedDistrictIdx
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
                                    className="px-3 py-1.5 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 text-xs font-medium text-white border border-white/10 transition-colors cursor-pointer shadow-md active:scale-95 flex items-center gap-1.5"
                                >
                                    <span className="material-symbols-outlined text-[14px] leading-none">{autoRotate ? 'pause' : 'play_arrow'}</span>
                                    <span>{autoRotate ? 'Pause' : 'Rotate'}</span>
                                </button>
                                <button
                                    onClick={() => setViewMode('modules')}
                                    className="px-4 py-1.5 rounded-xl bg-white text-black font-semibold text-xs transition-all hover:bg-neutral-200 cursor-pointer shadow-lg flex items-center gap-1.5 active:scale-95"
                                >
                                    <span className="material-symbols-outlined text-[14px] leading-none">grid_view</span>
                                    <span>Modules</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className={`w-full max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 items-center ${viewMode === 'globe' ? 'hidden' : 'grid'}`}>

                    {/* Left Narrative Panel (Spacious, Typography-Driven, No Card Boxes) */}
                    <div className={`w-full lg:col-span-5 space-y-5 text-left flex flex-col justify-center order-2 lg:order-1 pb-6 lg:pb-0 transition-all duration-200 ease-out ${isAnimating ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'}`}>

                        {/* Title & Overview */}
                        <div className="space-y-1.5 pb-2 border-b border-white/10">
                            <h1 className="text-2xl sm:text-3xl xl:text-4xl font-extrabold tracking-tight text-white leading-[1.1]">
                                GeoSphere 360° Mobile Mapping Platform
                            </h1>
                            <p className="text-xs text-neutral-400 font-normal leading-relaxed">
                                Centralizing spatial data pipelines with high-precision trajectory tracking, PostGIS cloud synchronization, and frame-by-frame spherical QA auditing.
                            </p>
                        </div>

                        {/* Active Module Details (Pure monochromatic text) */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold tracking-wider uppercase text-neutral-400">
                                    {current.category}
                                </span>
                                <span className="text-xs font-mono text-neutral-500 tabular-nums">
                                    0{activeIndex + 1} / 0{SYSTEM_MODULES.length}
                                </span>
                            </div>

                            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white leading-tight">
                                {current.title}
                            </h2>

                            <p className="text-xs sm:text-sm text-neutral-300 font-normal leading-relaxed">
                                {current.description}
                            </p>
                        </div>

                        {/* Clean Execution Pipeline (No colored text, clean monospace steps) */}
                        {current.workflow && current.workflow.length > 0 && (
                            <div className="space-y-2 pt-1">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 block">
                                    Execution Flow
                                </span>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                                    {current.workflow.map((wf, idx) => (
                                        <div key={idx} className="space-y-1">
                                            <div className="text-[11px] font-mono font-medium text-neutral-300 tracking-wide">
                                                {wf.step}
                                            </div>
                                            <div className="text-xs text-neutral-400 font-normal leading-relaxed">
                                                {wf.action}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Clean Specifications Row (No Boxes, Minimalist Definition Line) */}
                        <div className="pt-2 border-t border-white/10 space-y-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 block">
                                Architecture &amp; System Specs
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                                {current.specs.map((spec, i) => (
                                    <div key={i} className="space-y-0.5">
                                        <span className="text-[11px] text-neutral-500 block">
                                            {spec.label}
                                        </span>
                                        <span className="text-xs font-medium text-neutral-200 block truncate">
                                            {spec.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Button with grey outer box without filled color */}
                        <div className="pt-1 flex flex-wrap items-center gap-4">
                            <button
                                onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                                className="px-5 py-2.5 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-2 transition-all border border-neutral-700 hover:border-neutral-500 bg-transparent text-neutral-200 hover:text-white hover:bg-white/5 cursor-pointer shadow-sm active:scale-95"
                            >
                                <span>Enter {current.title.split('&')[0].trim()}</span>
                                <ArrowRight className="w-4 h-4 text-neutral-300" />
                            </button>

                            <div className="text-xs text-neutral-400 flex items-center gap-1.5">
                                <span>{current.metricLabel}:</span>
                                <span className="font-semibold text-white">{current.metricValue}</span>
                            </div>
                        </div>

                        {/* Minimal System Metadata Footer */}
                        <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-x-6 gap-y-1 text-neutral-400 text-xs">
                            <div>
                                <span className="text-neutral-500">Database: </span>
                                <span className="text-neutral-300 font-medium">PostGIS + Supabase</span>
                            </div>
                            <div>
                                <span className="text-neutral-500">Renderer: </span>
                                <span className="text-neutral-300 font-medium">MapLibre GL + {viewerDisplayName}</span>
                            </div>
                            <div>
                                <span className="text-neutral-500">Mode: </span>
                                <span className="text-neutral-300 font-medium">Published &amp; Production</span>
                            </div>
                        </div>

                    </div>

                    {/* Right Screenshot Preview Frame */}
                    <div
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className={`w-full lg:col-span-7 flex flex-col justify-center order-1 lg:order-2 transition-all duration-200 ease-out touch-pan-y ${isAnimating ? 'opacity-0 scale-[0.99]' : 'opacity-100 scale-100'}`}
                    >
                        <div className="w-full aspect-[16/10] p-3 sm:p-4 rounded-2xl bg-neutral-900/70 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col justify-between overflow-hidden">

                            {/* Subtitle & Image Counter */}
                            <div className="flex items-center justify-between px-1 pb-2 border-b border-white/10">
                                <span className="text-xs font-medium text-neutral-200 truncate pr-2">
                                    {current.subtitle}
                                </span>
                                <span className="text-xs font-mono text-neutral-400 shrink-0">
                                    {activePhotoIdx + 1} / {current.images.length}
                                </span>
                            </div>

                            {/* Viewport Image Frame */}
                            <div className="relative w-full flex-1 rounded-xl bg-black border border-white/10 overflow-hidden flex items-center justify-center my-2">
                                <img
                                    key={activeImage}
                                    src={activeImage}
                                    alt={current.title}
                                    loading="eager"
                                    decoding="async"
                                    className="w-full h-full object-contain object-center transition-opacity duration-200"
                                />
                            </div>

                            {/* Active Section Tip Details */}
                            {activeHotspot && (
                                <div className="mb-2 p-2.5 rounded-xl bg-neutral-900/95 border border-white/10 text-left animate-in fade-in duration-150">
                                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/10">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-white">
                                                {activeHotspot.title}
                                            </span>
                                            <span className="text-[11px] text-neutral-400">
                                                &bull; {activeHotspot.tag}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => setActiveHotspotId(null)}
                                            className="text-[11px] text-neutral-400 hover:text-white cursor-pointer"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                    <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
                                        {activeHotspot.description}
                                    </p>
                                    <div className="mt-1 text-[11px] text-neutral-300 font-normal">
                                        <span className="font-semibold text-white">Tip: </span>
                                        {activeHotspot.tip}
                                    </div>
                                </div>
                            )}

                            {/* Section Highlights Selector */}
                            <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar flex-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 shrink-0 mr-1">
                                        Sections:
                                    </span>
                                    {current.hotspots.map((spot) => {
                                        const isSelected = activeHotspotId === spot.id;
                                        return (
                                            <button
                                                key={spot.id}
                                                onClick={() => setActiveHotspotId(isSelected ? null : spot.id)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${isSelected
                                                    ? 'bg-white/20 text-white font-medium shadow-sm'
                                                    : 'text-neutral-400 hover:text-white hover:bg-white/10'
                                                    }`}
                                            >
                                                <span>{spot.title.split(':')[0].replace(/Station \d+: /, '')}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Thumbnail previews */}
                                {current.images.length > 1 && (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {current.images.map((imgUrl, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setActivePhotoIdx(idx)}
                                                className={`h-6 w-9 rounded-md overflow-hidden border transition-all cursor-pointer ${activePhotoIdx === idx
                                                    ? 'border-white ring-1 ring-white/40 opacity-100'
                                                    : 'border-white/10 opacity-50 hover:opacity-90'
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

                </div>
            </main>

            {/* 4. Pinned Footer Navigation Controls (Active in modules mode) */}
            <footer className={`relative z-30 w-full px-4 sm:px-8 py-3 items-center justify-between border-t border-white/10 bg-black shrink-0 ${viewMode === 'modules' ? 'flex' : 'hidden'}`}>
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

                {/* Step Indicator Dots */}
                <div className="flex items-center gap-2">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => handleModuleChange(idx)}
                            className={`h-2 rounded-full transition-all cursor-pointer ${activeIndex === idx
                                ? 'w-6 bg-white'
                                : 'w-2 bg-neutral-700 hover:bg-neutral-500'
                                }`}
                            title={`Module 0${idx + 1}: ${mod.title}`}
                        />
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

            {/* 5. MapLibre GL District Boundary View (Active when zoomed into project district) */}
            {isZoomedToDistrict && (
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
                        onReturnToGlobe={handleReturnToGlobe}
                        onEnterWorkspace={() => onEnterDashboard && onEnterDashboard(current.id)}
                    />
                </div>
            )}

        </div>
    );
};