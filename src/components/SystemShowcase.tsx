import React, { useState, useEffect } from 'react';
import {
    Compass,
    Camera,
    Database,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    Cpu,
    Shield,
    FolderKanban
} from 'lucide-react';
import { usePanoramaViewer } from '../hooks/usePanoramaViewer';

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

    return (
        <div className="relative w-full h-[100dvh] max-h-[100dvh] text-white font-sans overflow-hidden select-none flex flex-col justify-between" style={{ backgroundColor: 'transparent' }}>

            {/* 1. Background Image – onboarding.jpg displayed directly, no video */}
            <div className="absolute inset-0 pointer-events-none z-0" aria-hidden="true">
                <img
                    src="/screenshots/onboarding.jpg"
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ opacity: 0.35 }}
                />
                {/* Subtle bottom fade so footer text stays readable */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            </div>

            {/* 2. Top Header Navbar (Clean two-line system title, zero blue tint) */}
            <header className="relative z-30 px-4 sm:px-8 py-3 flex items-center justify-between border-b border-white/10 bg-black/90 backdrop-blur-md shrink-0">
                <div className="min-w-0 pr-2">
                    <span className="text-xs sm:text-sm font-semibold tracking-tight text-white block leading-tight truncate">
                        Mobile Mapping Data Management System
                    </span>
                    <span className="text-[10px] sm:text-xs text-neutral-400 font-medium hidden xs:block truncate">
                        Spatial Trajectory Processing &amp; Quality Assurance Pipeline
                    </span>
                </div>

                {/* Module Navigation (Clean text links, no enclosing box or pill background) */}
                <nav aria-label="System Modules" className="hidden lg:flex items-center gap-6 xl:gap-8 shrink-0">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => handleModuleChange(idx)}
                            className={`text-xs font-medium transition-colors cursor-pointer py-1 ${activeIndex === idx
                                ? 'text-white font-semibold'
                                : 'text-neutral-400 hover:text-white'
                                }`}
                        >
                            {mod.title.split('&')[0].trim()}
                        </button>
                    ))}
                </nav>

                {/* Action Buttons (Clean text, no enclosing box) */}
                <div className="flex items-center gap-5 sm:gap-6 shrink-0">
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
            <main className="relative z-20 flex-1 w-full px-4 sm:px-8 py-4 sm:py-6 overflow-y-auto lg:overflow-hidden flex items-start lg:items-center justify-start lg:justify-center" style={{ backgroundColor: 'transparent' }}>
                <div className="w-full max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-10 items-center">

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

            {/* 4. Pinned Footer Navigation Controls (Pure solid black, neutral gray dots, no blue) */}
            <footer className="relative z-30 w-full px-4 sm:px-8 py-3 flex items-center justify-between border-t border-white/10 bg-black shrink-0">
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

        </div>
    );
};