import React, { useState, useEffect } from 'react';
import {
    Layers,
    Compass,
    Camera,
    Database,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    FileText,
    Workflow
} from 'lucide-react';

export interface SystemShowcaseProps {
    onEnterDashboard?: (targetView?: string) => void;
    dailyData?: any[];
    batchLogs?: any[];
    projectSettings?: any;
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
}

export const SystemShowcase: React.FC<SystemShowcaseProps> = ({
    onEnterDashboard,
    dailyData = [],
    batchLogs = [],
    projectSettings
}) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [activePhotoIdx, setActivePhotoIdx] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);

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
        setTimeout(() => {
            setActiveIndex(newIndex);
            setIsAnimating(false);
        }, 350); // Relaxed, buttery-smooth 350ms duration
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
        {
            id: 'webgis',
            category: 'Corridor Spatial Telemetry',
            title: 'Interactive Coverage Map & WebGIS',
            subtitle: 'Trajectory Geometries & Subgrid Coverage Tracking',
            description: 'Monitors vehicle survey trajectories along road corridors. Synchronizes high-precision GNSS positioning coordinates, groups surveyed points into regional grid boundaries, and visualizes route coverage across standard GIS basemaps.',
            metricLabel: 'Total Distance Mapped',
            metricValue: `${computedDistance.toFixed(1)} km (${pctTarget}%)`,
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
                { label: 'Corridor Metric', value: 'Geodesic Distance (KM)' },
            ],
        },
        {
            id: 'processing',
            category: 'Data Ingestion & Reconciliation',
            title: 'Batch Processing & Ingestion Pipeline',
            subtitle: 'Subgrid Masterlist & Daily Progress Management',
            description: 'Manages multi-day field survey collections. Reconciles raw survey batches against storage buckets, verifies image file counts per subgrid, and maintains a structured ledger for daily contractor progress.',
            metricLabel: 'Processed Imagery',
            metricValue: `${computedFrames.toLocaleString()} Frames (${activeJobs} Active)`,
            statusBadge: 'Storage Verified',
            accentColor: '#34d399',
            images: [
                '/screenshots/Dashboard_UI_17.png',
                '/screenshots/Dashboard_UI_2.png',
                '/screenshots/Dashboard_UI_4.png',
                '/screenshots/Dashboard_UI_18.png'
            ],
            icon: Layers,
            workflow: [
                { step: '01. Collect', action: 'Upload field CSV & raw panorama sets' },
                { step: '02. Verify', action: 'Cross-check files against storage bucket' },
                { step: '03. Reconcile', action: 'Update masterlist & daily progress records' }
            ],
            specs: [
                { label: 'File Validation', value: 'MMS Storage Verification' },
                { label: 'Ledger Type', value: 'Masterlist & Daily Logs' },
                { label: 'Asset Storage', value: 'Supabase Object Bucket' }
            ]
        },
        {
            id: 'qa-inspector',
            category: 'Optical Quality Assurance',
            title: 'Panoramic StreetView & Defect Inspector',
            subtitle: 'Automated Optical Sharpness & Defect Auditing',
            description: 'Performs automated and manual inspection on equirectangular spherical panoramas. Evaluates image sharpness via Tenengrad gradient variance, identifies camera pitch/yaw anomalies, and flags lens obstructions before final publishing.',
            metricLabel: 'Quality SLA Health',
            metricValue: `${slaPercent}% Quality`,
            statusBadge: `${slaPercent}% Compliance`,
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
            ]
        },
        {
            id: 'postgis',
            category: 'Spatial Database & Layer Staging',
            title: 'Supabase & PostGIS Spatial Hub',
            subtitle: 'Relational Spatial Staging & Production Sync',
            description: 'Centralized spatial database powered by Supabase PostgreSQL and PostGIS, facilitating realtime CSV trajectory ingestion, automated duplicate subgrid verification, vector layer staging, and secure cloud storage.',
            metricLabel: 'Production Datasets',
            metricValue: `${batchLogs.length} Master Batches`,
            statusBadge: 'PostGIS Connected',
            accentColor: '#fbbf24',
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
                { label: 'Database Engine', value: 'PostgreSQL + PostGIS Extension' },
                { label: 'Spatial Index', value: 'GIST on Point Geometry (lat/lon)' },
                { label: 'Table Gate', value: 'Staging to Production Sync' }
            ]
        },
        {
            id: 'analytics-audit',
            category: 'Operational Auditing & Compliance',
            title: 'Executive Reports & Audit Trail',
            subtitle: 'Survey Milestone Ledgers & Timestamped Activity Logs',
            description: 'Generates operational ledgers and contract milestone summaries. Records all data edits, inspection completions, and publishing events into an immutable audit trail for quality compliance and project handover.',
            metricLabel: 'Operational Logs',
            metricValue: `${dailyData.length} Survey Records`,
            statusBadge: 'Audit Trail Locked',
            accentColor: '#a855f7',
            images: [
                '/screenshots/Dashboard_UI_14.png',
                '/screenshots/Dashboard_UI_15.png',
                '/screenshots/Dashboard_UI_19.png',
                '/screenshots/Dashboard_UI_20.png',
                '/screenshots/Dashboard_UI_21.png'
            ],
            icon: FileText,
            workflow: [
                { step: '01. Record', action: 'Log all user edits, imports & sign-offs' },
                { step: '02. Audit', action: 'Verify SLA defect rates per contractor' },
                { step: '03. Export', action: 'Generate executive summary reports' }
            ],
            specs: [
                { label: 'Audit Trail', value: 'Immutable Event Timestamping' },
                { label: 'Report Types', value: 'Contract Milestones & QA Logs' },
                { label: 'Data Export', value: 'Downloadable CSV / PDF Ledger' }
            ]
        }
    ];

    // Preload screenshot assets into memory for instant transitions[cite: 1]
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
    }, [activeIndex]);

    const current = SYSTEM_MODULES[activeIndex];
    const prevModule = SYSTEM_MODULES[(activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length];
    const nextModule = SYSTEM_MODULES[(activeIndex + 1) % SYSTEM_MODULES.length];
    const activeImage = current.images[activePhotoIdx] || current.images[0];

    return (
        <div className="relative w-full h-[100dvh] max-h-[100dvh] text-slate-100 font-sans overflow-hidden select-none flex flex-col justify-between">

            {/* 1. Fluid Cross-Fading Ambient Blurred Background */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <img
                    key={activeImage}
                    src={activeImage}
                    alt="Ambient Base Blur"
                    loading="eager"
                    decoding="async"
                    className="w-full h-full object-cover scale-125 blur-[120px] sm:blur-[150px] opacity-40 sm:opacity-50 transition-all duration-1000 ease-in-out"
                />
                <div className="absolute inset-0 bg-[#070b14]/70 backdrop-blur-xl transition-all duration-700" />
            </div>

            {/* 2. Top Header Navbar */}
            <header className="relative z-30 px-3 sm:px-8 py-2.5 sm:py-3 flex items-center justify-between border-b border-slate-800/80 bg-[#070b14]/90 backdrop-blur-md shrink-0">
                <div className="min-w-0 pr-2">
                    <span className="text-xs sm:text-sm font-semibold tracking-tight text-white block leading-tight truncate">
                        Mobile Mapping Data Management System
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-400 font-medium hidden xs:block truncate">
                        Spatial Trajectory Processing &amp; Quality Assurance Pipeline
                    </span>
                </div>

                {/* Single Clean Desktop Navigation Pills */}
                <div className="hidden lg:flex items-center gap-1 p-1 rounded-xl bg-slate-900/80 border border-slate-800 shrink-0">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => handleModuleChange(idx)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeIndex === idx
                                ? 'bg-slate-800 text-white font-semibold shadow-sm border border-slate-700'
                                : 'text-slate-400 hover:text-slate-200'
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
                        className="px-2 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard('general-launch')}
                        className="px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-200 text-slate-950 transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5"
                    >
                        <span>Launch</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-950 hidden sm:inline" />
                    </button>
                </div>
            </header>

            {/* 3. Main Showcase Section */}
            <main className="relative z-20 flex-1 w-full px-3 sm:px-8 py-3 sm:py-4 overflow-y-auto lg:overflow-hidden flex items-start lg:items-center justify-start lg:justify-center">
                <div className="w-full max-w-[1700px] mx-auto my-0 lg:my-auto grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-8 lg:gap-12 items-center">

                    {/* MOBILE HERO TITLE */}
                    <div className="block lg:hidden col-span-1 space-y-1 text-center shrink-0 px-1 pt-1">
                        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white leading-tight">
                            GeoSphere 360° Mobile Mapping Platform
                        </h1>
                        <p className="text-[11px] sm:text-xs text-slate-400 font-normal leading-relaxed max-w-md mx-auto">
                            Centralizing spatial data pipelines with high-precision corridor tracking, PostGIS cloud synchronization, and frame-by-frame spherical QA auditing.
                        </p>
                    </div>

                    {/* NARRATIVE PANEL & MODULE CONTROLS (Left 5 cols on Desktop) */}
                    <div className={`w-full lg:col-span-5 space-y-4 sm:space-y-6 text-left flex flex-col justify-center order-3 lg:order-1 pb-6 lg:pb-0 transition-all duration-300 ease-out ${isAnimating ? 'opacity-0 translate-y-1.5' : 'opacity-100 translate-y-0'}`}>

                        {/* Desktop Hero Section */}
                        <div className="hidden lg:block space-y-2.5 pb-2 border-b border-slate-800/40">
                            <h1 className="text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-extrabold tracking-tight text-white leading-[1.1]">
                                GeoSphere 360° Mobile Mapping Platform
                            </h1>

                            <p className="text-xs sm:text-sm text-slate-400 font-normal leading-relaxed">
                                Centralizing spatial data pipelines with high-precision corridor tracking, PostGIS cloud synchronization, and frame-by-frame spherical QA auditing.
                            </p>
                        </div>

                        {/* Active Module Details */}
                        <div className="space-y-2.5 sm:space-y-3 pt-0.5">
                            <div className="flex items-center justify-between">
                                <span
                                    className="text-xs sm:text-sm font-bold uppercase tracking-wider block"
                                    style={{ color: current.accentColor }}
                                >
                                    {current.category}
                                </span>
                                <span className="text-[10px] sm:text-xs font-semibold tracking-wider text-slate-300 bg-slate-800/80 px-2 sm:px-2.5 py-0.5 rounded-full border border-slate-700/60 tabular-nums">
                                    Module 0{activeIndex + 1} / 05
                                </span>
                            </div>

                            <div className="space-y-1">
                                <h2 className="text-lg sm:text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-100 leading-tight">
                                    {current.title}
                                </h2>
                                <p className="text-[11px] sm:text-xs lg:text-sm text-slate-300/90 font-normal leading-relaxed line-clamp-3 sm:line-clamp-none">
                                    {current.description}
                                </p>
                            </div>

                            {/* Technical Workflow Flow (3-Step Pipeline) */}
                            {current.workflow && current.workflow.length > 0 && (
                                <div className="space-y-1 pt-0.5">
                                    <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-semibold text-slate-400">
                                        <Workflow className="w-3 h-3 text-slate-400" />
                                        <span>Technical Execution Flow</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                                        {current.workflow.map((wf, idx) => (
                                            <div
                                                key={idx}
                                                className="p-1.5 sm:p-2 rounded-xl bg-slate-900/90 border border-slate-800 text-left min-w-0"
                                            >
                                                <span className="text-[9.5px] font-mono font-bold block" style={{ color: current.accentColor }}>
                                                    {wf.step}
                                                </span>
                                                <span className="text-[10px] sm:text-[11px] font-medium text-slate-200 block mt-0.5 line-clamp-2 leading-tight">
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
                                        className="p-1.5 sm:p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 backdrop-blur-md min-w-0"
                                    >
                                        <span className="text-[9px] xs:text-[10px] sm:text-[11px] font-medium text-slate-400 block truncate">
                                            {spec.label}
                                        </span>
                                        <span className="text-[10.5px] xs:text-xs sm:text-sm font-semibold text-slate-200 block mt-0.5 truncate">
                                            {spec.value}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Launch Action Button */}
                            <div className="pt-1">
                                <button
                                    onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                                    className="w-full sm:w-auto px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all transform hover:opacity-95 active:scale-95 cursor-pointer shadow-lg"
                                    style={{
                                        backgroundColor: current.accentColor,
                                        color: '#070b14'
                                    }}
                                >
                                    <span>Enter System Module</span>
                                    <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Bottom Professional WebGIS Introduction */}
                        <div className="pt-1 text-left space-y-2">
                            <p className="text-[11px] sm:text-xs text-slate-400 font-normal leading-relaxed">
                                <span className="text-slate-200 font-medium">Get started quickly with</span> our high-precision WebGIS coverage map, automated batch ingestion pipelines, frame-by-frame 360° equirectangular defect auditing, and cloud-synchronized PostGIS spatial intelligence.
                            </p>

                            {/* Minimal System Metadata Footer */}
                            <div className="pt-2 sm:pt-3 border-t border-slate-800/50 flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-1.5 text-slate-400 text-[10px] sm:text-xs">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-500">Platform:</span>
                                    <span className="font-semibold text-slate-200">Mobile Mapping System</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-500">DB:</span>
                                    <span className="font-semibold text-slate-200">PostGIS + Supabase</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-500">Renderer:</span>
                                    <span className="font-semibold text-slate-200">MapLibre GL + Pannellum</span>
                                </div>
                            </div>

                            {/* Copyright Notice */}
                            <p className="pt-0.5 text-[8.5px] sm:text-[9.5px] text-slate-500/80 font-normal tracking-tight select-none">
                                © 2026 Mobile Mapping Data Management System. All rights reserved.
                            </p>
                        </div>

                    </div>

                    {/* SCREENSHOT DECK (Right 7 cols on Desktop) */}
                    <div
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className={`w-full lg:col-span-7 flex flex-col justify-center group relative order-2 lg:order-2 transition-all duration-300 ease-out touch-pan-y ${isAnimating ? 'opacity-0 scale-[0.995]' : 'opacity-100 scale-100'}`}
                    >
                        {/* Ambient Underglow */}
                        <div className="absolute -inset-3 sm:-inset-6 rounded-3xl overflow-hidden pointer-events-none opacity-40 group-hover:opacity-90 blur-xl sm:blur-3xl transition-all duration-500 ease-out -z-10">
                            <img
                                src={activeImage}
                                alt="Underglow"
                                loading="eager"
                                decoding="async"
                                className="w-full h-full object-cover scale-110"
                            />
                        </div>

                        {/* Preview Frame Container */}
                        <div className="relative w-full aspect-[16/10] p-2.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800/90 shadow-2xl flex flex-col justify-between overflow-hidden">

                            {/* Top Subtitle Bar */}
                            <div className="flex items-center justify-between px-1 pb-1.5 sm:pb-2 border-b border-slate-800/80">
                                <span className="text-[10px] sm:text-xs font-semibold text-slate-300 truncate pr-2">
                                    {current.subtitle}
                                </span>
                                <span className="text-[9px] sm:text-xs font-medium text-slate-400 shrink-0">
                                    {activePhotoIdx + 1} / {current.images.length}
                                </span>
                            </div>

                            {/* Viewport Image */}
                            <div className="relative w-full flex-1 rounded-xl bg-[#090d16] border border-slate-800/90 overflow-hidden flex items-center justify-center my-1.5 sm:my-3">
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

                            {/* Thumbnail Selector Bar */}
                            {current.images.length > 1 && (
                                <div className="flex items-center gap-1.5 sm:gap-2 pt-1 overflow-x-auto pb-0.5 no-scrollbar">
                                    {current.images.map((imgUrl, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setActivePhotoIdx(idx)}
                                            className={`relative h-8 w-13 sm:h-12 sm:w-20 rounded-lg overflow-hidden border transition-all cursor-pointer shrink-0 ${activePhotoIdx === idx
                                                ? 'border-sky-400 ring-2 ring-sky-400/30 opacity-100'
                                                : 'border-slate-800 opacity-60 hover:opacity-100'
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
            <footer className="relative z-30 w-full px-3 sm:px-8 py-2 sm:py-3 flex items-center justify-between border-t border-slate-800/80 bg-[#070b14]/95 backdrop-blur-md shrink-0">
                <button
                    onClick={() => handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-1.5 sm:gap-3 opacity-80 hover:opacity-100 transition-all cursor-pointer p-1 -m-1"
                >
                    <div className="w-8 h-8 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center">
                        <ChevronLeft className="w-4 h-4 text-white" />
                    </div>
                    <div className="hidden sm:block text-left">
                        <span className="text-[10px] text-slate-400 block">Previous</span>
                        <span className="text-xs font-semibold text-slate-200">{prevModule.title.split('&')[0]}</span>
                    </div>
                </button>

                {/* Step Indicator Dots */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => handleModuleChange(idx)}
                            className={`h-2 rounded-full transition-all cursor-pointer p-1 -my-1 ${activeIndex === idx
                                ? 'w-5 sm:w-6 bg-slate-200'
                                : 'w-2 bg-slate-700 hover:bg-slate-500'
                                }`}
                            title={mod.title}
                        />
                    ))}
                </div>

                <button
                    onClick={() => handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-1.5 sm:gap-3 opacity-80 hover:opacity-100 transition-all cursor-pointer p-1 -m-1"
                >
                    <div className="hidden sm:block text-right">
                        <span className="text-[10px] text-slate-400 block">Next</span>
                        <span className="text-xs font-semibold text-slate-200">{nextModule.title.split('&')[0]}</span>
                    </div>
                    <div className="w-8 h-8 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center">
                        <ChevronRight className="w-4 h-4 text-white" />
                    </div>
                </button>
            </footer>

        </div>
    );
};