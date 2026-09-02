import React, { useState, useEffect } from 'react';
import {
    Compass,
    Camera,
    Database,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    Workflow,
    Cpu,
    Shield,
    Lightbulb,
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
    accentColor: string;
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

        // 50px swipe threshold
        if (diff > 50) {
            handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length);
        } else if (diff < -50) {
            handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length);
        }
        setTouchStartX(null);
    };

    // Smooth navigation helper function
    const handleModuleChange = (newIndex: number) => {
        if (newIndex === activeIndex) return;
        setIsAnimating(true);
        setActiveHotspotId(null);
        setTimeout(() => {
            setActiveIndex(newIndex);
            setIsAnimating(false);
        }, 320);
    };

    // Dynamic telemetry calculations
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
            title: 'Main Executive Dashboard & Spatial Telemetry',
            subtitle: 'Geodetic Telemetry, Trajectory Tracking & Live Status Stream',
            description: 'The central operational hub of the platform. Features high-precision MapLibre GL trajectory rendering, executive KPI telemetry meters, live workstation pipeline streams, and direct workspace navigation.',
            metricLabel: 'Total Distance Mapped',
            metricValue: `${computedDistance.toFixed(1)} km (${pctTarget}% · ${activeJobs} Active)`,
            statusBadge: 'Telemetry Active',
            accentColor: '#38bdf8',
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
                    tip: 'Click the direct action button (e.g. "Review 84 QA issues") to jump straight to the required defect table.'
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
            accentColor: '#34d399',
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

        // MODULE 3: PRODUCTION WORKSPACE & PROCESSING CENTER (NEW)
        {
            id: 'production',
            category: 'Multi-Station & GPU Worker Pipeline',
            title: 'Production Workspace, NAS Storage & Lineage',
            subtitle: '4-Station Desktop Pipeline, GPU Worker & Asset Lineage',
            description: 'End-to-end multi-PC production routing and automated GPU worker dispatch. Coordinates sequential desktop handoffs across Station 1 (Blur), Station 2 (Stitching), Station 3 (Lightroom), and Station 4 (Photoshop), with real-time NAS storage tracking and immutable lineage tracing.',
            metricLabel: 'Pipeline Architecture',
            metricValue: '4-Station + NAS GPU Worker',
            statusBadge: 'Pipeline Connected',
            accentColor: '#f59e0b',
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
                    title: '4-Station Multi-PC & Engine Configuration',
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
            accentColor: '#818cf8',
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
            accentColor: '#10b981',
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
            accentColor: '#ec4899',
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
                { step: '01. Record', action: 'Log all user edits, imports & sign-offs' },
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
                    title: 'Survey Operations Analytics & Publication Status',
                    tag: 'Operations KPI',
                    description: 'Realtime charts of road capture analytics, publication status distribution (Published vs Partial), and daily throughput trends.',
                    tip: 'Recharts visualizes live database metrics without modifying raw imagery.'
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
                    tip: 'Audit logs cannot be altered or deleted, ensuring full accountability for quality compliance.'
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

    // Preload screenshot assets into memory for instant transitions
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

    const current = SYSTEM_MODULES[activeIndex];
    const prevModule = SYSTEM_MODULES[(activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length];
    const nextModule = SYSTEM_MODULES[(activeIndex + 1) % SYSTEM_MODULES.length];
    const activeImage = current.images[activePhotoIdx] || current.images[0];
    const activeHotspot = current.hotspots.find((h) => h.id === activeHotspotId);

    return (
        <div className="relative w-full h-[100dvh] max-h-[100dvh] bg-[var(--bg-app,#080e1a)] text-[var(--text-primary,#f8fafc)] font-sans overflow-hidden select-none flex flex-col justify-between transition-colors duration-200">

            {/* 1. Fluid Cross-Fading Ambient Blurred Background */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <img
                    key={activeImage}
                    src={activeImage}
                    alt="Ambient Base Blur"
                    loading="eager"
                    decoding="async"
                    className="w-full h-full object-cover scale-125 blur-[120px] sm:blur-[150px] opacity-25 sm:opacity-35 transition-all duration-1000 ease-in-out"
                />
                <div className="absolute inset-0 bg-[var(--bg-app,#080e1a)]/85 backdrop-blur-xl transition-colors duration-300" />
            </div>

            {/* 2. Top Header Navbar */}
            <header className="relative z-30 px-3 sm:px-8 py-2.5 sm:py-3 flex items-center justify-between border-b border-[var(--border-subtle,#1e2e4a)] bg-[var(--bg-card,#0f172a)]/90 backdrop-blur-md shrink-0 transition-colors duration-200">
                <div className="min-w-0 pr-2">
                    <span className="text-xs sm:text-sm font-semibold tracking-tight text-[var(--text-primary,#f8fafc)] block leading-tight truncate">
                        Mobile Mapping Data Management System
                    </span>
                    <span className="text-[10px] sm:text-xs text-[var(--text-muted,#94a3b8)] font-medium hidden xs:block truncate">
                        Spatial Trajectory Processing &amp; Quality Assurance Pipeline
                    </span>
                </div>

                {/* 6 Desktop Navigation Pills */}
                <div className="hidden lg:flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-inner,#162138)] border border-[var(--border-subtle,#1e2e4a)] shrink-0">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => handleModuleChange(idx)}
                            className={`px-2.5 xl:px-3 py-1.5 rounded-lg text-[11px] xl:text-xs font-medium transition-all cursor-pointer ${activeIndex === idx
                                ? 'bg-[var(--bg-card,#0f172a)] text-[var(--text-primary,#f8fafc)] font-semibold shadow-sm border border-[var(--border-subtle,#1e2e4a)]'
                                : 'text-[var(--text-muted,#94a3b8)] hover:text-[var(--text-primary,#f8fafc)]'
                                }`}
                        >
                            {mod.title.split('&')[0].trim()}
                        </button>
                    ))}
                </div>

                {/* Header Action Buttons */}
                <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard('auth')}
                        className="px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted,#94a3b8)] hover:text-[var(--text-primary,#f8fafc)] transition-colors cursor-pointer"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                        className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-semibold bg-[var(--accent,#38bdf8)] hover:brightness-110 text-slate-950 transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5"
                    >
                        <span>Launch</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-950 hidden sm:inline" />
                    </button>
                </div>
            </header>

            {/* 3. Main Showcase Section */}
            <main className="relative z-20 flex-1 w-full px-3 sm:px-8 py-3 sm:py-4 overflow-y-auto lg:overflow-hidden flex items-start lg:items-center justify-start lg:justify-center">
                <div className="w-full max-w-[1700px] mx-auto my-0 lg:my-auto grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 lg:gap-10 items-center">

                    {/* MOBILE HERO TITLE */}
                    <div className="block lg:hidden col-span-1 space-y-1 text-center shrink-0 px-1 pt-1">
                        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white leading-tight">
                            GeoSphere 360° Mobile Mapping Platform
                        </h1>
                        <p className="text-[11px] sm:text-xs text-slate-400 font-normal leading-relaxed max-w-md mx-auto">
                            Centralizing spatial data pipelines with high-precision trajectory tracking, PostGIS cloud synchronization, and frame-by-frame spherical QA auditing.
                        </p>
                    </div>

                    {/* NARRATIVE PANEL & MODULE CONTROLS (Left 5 cols on Desktop) */}
                    <div className={`w-full lg:col-span-5 space-y-3.5 sm:space-y-5 text-left flex flex-col justify-center order-3 lg:order-1 pb-6 lg:pb-0 transition-all duration-300 ease-out ${isAnimating ? 'opacity-0 translate-y-1.5' : 'opacity-100 translate-y-0'}`}>

                        {/* Desktop Hero Section */}
                        <div className="hidden lg:block space-y-2 pb-2 border-b border-[var(--border-subtle,#1e2e4a)]">
                            <h1 className="text-2xl lg:text-3xl xl:text-4xl font-extrabold tracking-tight text-[var(--text-primary,#f8fafc)] leading-[1.1]">
                                GeoSphere 360° Mobile Mapping Platform
                            </h1>

                            <p className="text-xs text-[var(--text-muted,#94a3b8)] font-normal leading-relaxed">
                                Centralizing spatial data pipelines with high-precision trajectory tracking, PostGIS cloud synchronization, and frame-by-frame spherical QA auditing.
                            </p>
                        </div>

                        {/* Active Module Details */}
                        <div className="space-y-2.5 pt-0.5">
                            <div className="flex items-center justify-between">
                                <span
                                    className="text-xs sm:text-sm font-bold uppercase tracking-wider block"
                                    style={{ color: current.accentColor }}
                                >
                                    {current.category}
                                </span>
                                <span className="text-[10px] sm:text-xs font-semibold tracking-wider text-[var(--text-muted,#94a3b8)] bg-[var(--bg-inner,#162138)] px-2 sm:px-2.5 py-0.5 rounded-full border border-[var(--border-subtle,#1e2e4a)] tabular-nums">
                                    Module 0{activeIndex + 1} / 06
                                </span>
                            </div>

                            <div className="space-y-1">
                                <h2 className="text-lg sm:text-2xl font-extrabold tracking-tight text-[var(--text-primary,#f8fafc)] leading-tight">
                                    {current.title}
                                </h2>
                                <p className="text-[11px] sm:text-xs text-[var(--text-muted,#94a3b8)] font-normal leading-relaxed line-clamp-3 sm:line-clamp-none">
                                    {current.description}
                                </p>
                            </div>

                            {/* Technical Workflow Flow (3-Step Pipeline) */}
                            {current.workflow && current.workflow.length > 0 && (
                                <div className="space-y-1 pt-0.5">
                                    <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold text-[var(--text-muted,#94a3b8)]">
                                        <Workflow className="w-3 h-3 text-[var(--text-muted,#94a3b8)]" />
                                        <span>Technical Execution Flow</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                                        {current.workflow.map((wf, idx) => (
                                            <div
                                                key={idx}
                                                className="p-1.5 sm:p-2 rounded-xl bg-[var(--bg-inner,#162138)] border border-[var(--border-subtle,#1e2e4a)] text-left min-w-0"
                                            >
                                                <span className="text-[9.5px] font-sans font-bold block" style={{ color: current.accentColor }}>
                                                    {wf.step}
                                                </span>
                                                <span className="text-[10px] sm:text-[11px] font-medium text-[var(--text-primary,#f8fafc)] block mt-0.5 line-clamp-2 leading-tight">
                                                    {wf.action}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Technical Specifications HUD */}
                            <div className="grid grid-cols-3 gap-1.5 sm:gap-2 pt-0.5">
                                {current.specs.map((spec, i) => (
                                    <div
                                        key={i}
                                        className="p-1.5 sm:p-2 rounded-xl bg-[var(--bg-inner,#162138)] border border-[var(--border-subtle,#1e2e4a)] backdrop-blur-md min-w-0"
                                    >
                                        <span className="text-[9px] xs:text-[10px] font-medium text-[var(--text-muted,#94a3b8)] block truncate">
                                            {spec.label}
                                        </span>
                                        <span className="text-[10.5px] xs:text-xs font-semibold text-[var(--text-primary,#f8fafc)] block mt-0.5 truncate">
                                            {spec.value}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Launch Action Button */}
                            <div className="pt-1">
                                <button
                                    onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                                    className="w-full sm:w-auto px-5 sm:px-6 py-2.5 rounded-xl font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all transform hover:brightness-110 active:scale-95 cursor-pointer shadow-lg bg-[var(--accent,#38bdf8)] text-slate-950"
                                >
                                    <span>Enter System Module</span>
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Bottom Professional WebGIS Introduction */}
                        <div className="pt-1 text-left space-y-1.5">
                            <p className="text-[11px] sm:text-xs text-[var(--text-muted,#94a3b8)] font-normal leading-relaxed">
                                <span className="text-[var(--text-primary,#f8fafc)] font-medium">Get started quickly with</span> our high-precision WebGIS coverage map, automated batch ingestion pipelines, frame-by-frame 360° equirectangular defect auditing, and cloud-synchronized PostGIS spatial intelligence.
                            </p>

                            {/* Minimal System Metadata Footer */}
                            <div className="pt-2 border-t border-[var(--border-subtle,#1e2e4a)] flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--text-muted,#94a3b8)] text-[10px] sm:text-xs">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[var(--text-muted,#94a3b8)] opacity-70">Platform:</span>
                                    <span className="font-semibold text-[var(--text-primary,#f8fafc)]">Mobile Mapping System</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[var(--text-muted,#94a3b8)] opacity-70">DB:</span>
                                    <span className="font-semibold text-[var(--text-primary,#f8fafc)]">PostGIS + Supabase</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[var(--text-muted,#94a3b8)] opacity-70">Renderer:</span>
                                    <span className="font-semibold text-[var(--text-primary,#f8fafc)]">MapLibre GL + {viewerDisplayName}</span>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* SCREENSHOT DECK & INTERACTIVE SECTION HOTSPOTS (Right 7 cols on Desktop) */}
                    <div
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className={`w-full lg:col-span-7 flex flex-col justify-center group relative order-2 lg:order-2 transition-all duration-300 ease-out touch-pan-y ${isAnimating ? 'opacity-0 scale-[0.995]' : 'opacity-100 scale-100'}`}
                    >
                        {/* Ambient Underglow */}
                        <div className="absolute -inset-3 sm:-inset-6 rounded-3xl overflow-hidden pointer-events-none opacity-30 group-hover:opacity-50 blur-xl sm:blur-3xl transition-all duration-500 ease-out -z-10">
                            <img
                                src={activeImage}
                                alt="Underglow"
                                loading="eager"
                                decoding="async"
                                className="w-full h-full object-cover scale-110"
                            />
                        </div>

                        {/* Preview Frame Container */}
                        <div className="relative w-full aspect-[16/10] p-2.5 sm:p-3.5 rounded-2xl bg-[var(--bg-card,#0f172a)] border border-[var(--border-subtle,#1e2e4a)] shadow-2xl flex flex-col justify-between overflow-hidden transition-colors duration-200">

                            {/* Top Subtitle Bar */}
                            <div className="flex items-center justify-between px-1 pb-1.5 border-b border-[var(--border-subtle,#1e2e4a)]">
                                <span className="text-[10px] sm:text-xs font-semibold text-[var(--text-primary,#f8fafc)] truncate pr-2">
                                    {current.subtitle}
                                </span>
                                <span className="text-[9px] sm:text-xs font-medium text-[var(--text-muted,#94a3b8)] shrink-0">
                                    {activePhotoIdx + 1} / {current.images.length}
                                </span>
                            </div>

                            {/* Viewport Image (Clean Unobstructed Screenshot) */}
                            <div className="relative w-full flex-1 rounded-xl bg-[var(--bg-inner,#162138)] border border-[var(--border-subtle,#1e2e4a)] overflow-hidden flex items-center justify-center my-1.5 sm:my-2">
                                <img
                                    key={activeImage}
                                    src={activeImage}
                                    alt={current.title}
                                    loading="eager"
                                    decoding="async"
                                    fetchPriority="high"
                                    className="w-full h-full object-contain object-center transition-opacity duration-200"
                                />
                            </div>

                            {/* Active Section Tip Details (Clean Text Only) */}
                            {activeHotspot && (
                                <div className="mb-1.5 p-2 sm:p-2.5 rounded-xl bg-[var(--bg-inner,#162138)] border border-[var(--border-subtle,#1e2e4a)] text-left animate-in fade-in duration-150">
                                    <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--border-subtle,#1e2e4a)]/50">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-[10.5px] font-bold text-[var(--text-primary,#f8fafc)] truncate">
                                                {activeHotspot.title}
                                            </span>
                                            <span className="text-[9.5px] text-[var(--text-muted,#94a3b8)]">
                                                • {activeHotspot.tag}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => setActiveHotspotId(null)}
                                            className="text-[9px] text-[var(--text-muted,#94a3b8)] hover:text-[var(--text-primary,#f8fafc)] cursor-pointer"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                    <p className="text-[10.5px] text-[var(--text-muted,#94a3b8)] mt-1 leading-relaxed">
                                        {activeHotspot.description}
                                    </p>
                                    <div className="mt-1 flex items-start gap-1 text-[10px] text-[var(--text-primary,#f8fafc)] font-medium">
                                        <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                                        <span><strong className="text-amber-300 font-semibold">Tip: </strong>{activeHotspot.tip}</span>
                                    </div>
                                </div>
                            )}

                            {/* Section Explorer Tabs (Clean Text Only, No Numbers) */}
                            <div className="pt-1 border-t border-[var(--border-subtle,#1e2e4a)]">
                                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                                    <span className="text-[9.5px] font-semibold uppercase tracking-wider text-[var(--text-muted,#94a3b8)] shrink-0 mr-0.5">
                                        Sections:
                                    </span>
                                    {current.hotspots.map((spot) => {
                                        const isSelected = activeHotspotId === spot.id;
                                        return (
                                            <button
                                                key={spot.id}
                                                onMouseEnter={() => setActiveHotspotId(spot.id)}
                                                onClick={() => setActiveHotspotId(isSelected ? null : spot.id)}
                                                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-medium transition-all cursor-pointer shrink-0 border ${isSelected
                                                    ? 'bg-[var(--accent,#38bdf8)] text-slate-950 font-semibold border-white/20 shadow-sm'
                                                    : 'bg-[var(--bg-inner,#162138)] text-[var(--text-muted,#94a3b8)] hover:text-[var(--text-primary,#f8fafc)] border-[var(--border-subtle,#1e2e4a)]'
                                                    }`}
                                            >
                                                <span>{spot.title.split(':')[0].replace(/Station \d+: /, '')}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Thumbnail Selector Bar */}
                            {current.images.length > 1 && (
                                <div className="flex items-center gap-1.5 sm:gap-2 pt-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                                    {current.images.map((imgUrl, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setActivePhotoIdx(idx)}
                                            className={`relative h-7 w-12 sm:h-10 sm:w-16 rounded-lg overflow-hidden border transition-all cursor-pointer shrink-0 ${activePhotoIdx === idx
                                                ? 'border-[var(--accent,#38bdf8)] ring-2 ring-[var(--accent,#38bdf8)]/30 opacity-100'
                                                : 'border-[var(--border-subtle,#1e2e4a)] opacity-60 hover:opacity-100'
                                                }`}
                                        >
                                            <img
                                                src={imgUrl}
                                                alt={`Preview ${idx + 1}`}
                                                loading="eager"
                                                decoding="async"
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

            {/* 4. Pinned Footer Navigation Controls */}
            <footer className="relative z-30 w-full px-3 sm:px-8 py-2 sm:py-2.5 flex items-center justify-between border-t border-[var(--border-subtle,#1e2e4a)] bg-[var(--bg-card,#0f172a)]/95 backdrop-blur-md shrink-0 transition-colors duration-200">
                <button
                    onClick={() => handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-1.5 sm:gap-3 opacity-80 hover:opacity-100 transition-all cursor-pointer p-1 -m-1"
                >
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-[var(--border-subtle,#1e2e4a)] bg-[var(--bg-inner,#162138)] flex items-center justify-center">
                        <ChevronLeft className="w-4 h-4 text-[var(--text-primary,#f8fafc)]" />
                    </div>
                    <div className="hidden sm:block text-left">
                        <span className="text-[10px] text-[var(--text-muted,#94a3b8)] block">Previous</span>
                        <span className="text-xs font-semibold text-[var(--text-primary,#f8fafc)]">{prevModule.title.split('&')[0]}</span>
                    </div>
                </button>

                {/* Step Indicator Dots with Tooltip */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => handleModuleChange(idx)}
                            className={`h-2 rounded-full transition-all cursor-pointer p-1 -my-1 ${activeIndex === idx
                                ? 'w-5 sm:w-6 bg-[var(--accent,#38bdf8)]'
                                : 'w-2 bg-[var(--border-subtle,#1e2e4a)] hover:bg-[var(--text-muted,#94a3b8)]'
                                }`}
                            title={`Module 0${idx + 1}: ${mod.title}`}
                        />
                    ))}
                </div>

                <button
                    onClick={() => handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-1.5 sm:gap-3 opacity-80 hover:opacity-100 transition-all cursor-pointer p-1 -m-1"
                >
                    <div className="hidden sm:block text-right">
                        <span className="text-[10px] text-[var(--text-muted,#94a3b8)] block">Next</span>
                        <span className="text-xs font-semibold text-[var(--text-primary,#f8fafc)]">{nextModule.title.split('&')[0]}</span>
                    </div>
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-[var(--border-subtle,#1e2e4a)] bg-[var(--bg-inner,#162138)] flex items-center justify-center">
                        <ChevronRight className="w-4 h-4 text-[var(--text-primary,#f8fafc)]" />
                    </div>
                </button>
            </footer>

        </div>
    );
};