import React, { useState, useEffect } from 'react';
import {
    Layers,
    Compass,
    Camera,
    Database,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    FileText
} from 'lucide-react';

export interface SystemShowcaseProps {
    onEnterDashboard?: (targetView?: string) => void;
    dailyData?: any[];
    batchLogs?: any[];
    projectSettings?: any;
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
    const totalDistance = computedDistance > 0 ? computedDistance : 315.2;

    const computedFrames = dailyData.reduce((acc, item) => acc + (Number(item.images || item.imagesProcessed) || 0), 0);
    const totalFrames = computedFrames > 0 ? computedFrames : 12480;

    const activeJobs = batchLogs.length > 0
        ? batchLogs.filter((b: any) => b.status === 'In Progress' || b.status === 'Ongoing').length
        : 3;

    const targetDistance = projectSettings?.targetDistanceKm || projectSettings?.targetKm || 315.2;
    const pctTarget = Math.min(100, (totalDistance / targetDistance) * 100).toFixed(1);

    const SYSTEM_MODULES: SystemModule[] = [
        {
            id: 'webgis',
            category: 'Spatial Telemetry & Coverage',
            title: 'Interactive Coverage Map & WebGIS',
            subtitle: 'Real-Time Trajectory Tracing & Geospatial Clustering',
            description: 'Continuous spatial trajectory mapping across surveyed corridors with EPSG:4326 coordinate alignment, automated subgrid bounding box projection, and multi-layer basemap visualization.',
            metricLabel: 'Total Distance Mapped',
            metricValue: `${totalDistance.toFixed(1)} km (${pctTarget}%)`,
            statusBadge: 'Active WebGIS',
            accentColor: '#38bdf8',
            images: [
                '/screenshots/Dashboard_UI_1.png',
                '/screenshots/Dashboard_UI_13.png'
            ],
            icon: Compass,
            specs: [
                { label: 'Map Dashboard', value: 'Interactive WebGIS' },
                { label: 'Processing Table', value: 'Batch Run & Status' },
                { label: '360° Viewer & QA', value: 'Spherical Inspector' },
            ],
        },
        {
            id: 'processing',
            category: 'Pipeline Automation & Batch Control',
            title: 'Batch Processing & Ingestion Pipeline',
            subtitle: 'Multi-Batch Ledger & Automated Subgrid Reconciliation',
            description: 'Distributed data pipelines aggregating spherical panoramic imagery across active survey grids with automated progress tracking, metadata parsing, and status logging.',
            metricLabel: 'Processed Imagery',
            metricValue: `${totalFrames.toLocaleString()} Frames (${activeJobs} Active)`,
            statusBadge: 'Pipeline Ready',
            accentColor: '#34d399',
            images: [
                '/screenshots/Dashboard_UI_17.png',
                '/screenshots/Dashboard_UI_2.png',
                '/screenshots/Dashboard_UI_4.png',
                '/screenshots/Dashboard_UI_18.png'
            ],
            icon: Layers,
            specs: [
                { label: 'Pipeline Engine', value: 'Automated Batch Ingest' },
                { label: 'Queue Status', value: 'Dynamic Subgrid Stream' },
                { label: 'Defect Filtering', value: 'Pre-flight Verification' }
            ]
        },
        {
            id: 'qa-inspector',
            category: 'Quality Assurance & 360° Inspection',
            title: 'Panoramic StreetView & Defect Inspector',
            subtitle: 'Frame-by-Frame Equirectangular QA Verification',
            description: 'High-definition 360° spherical imagery auditing with real-time camera telemetry monitoring and instant defect flagging for optical blur, lens obstructions, and GPS drift.',
            metricLabel: 'Quality SLA Health',
            metricValue: '100.0% Normal',
            statusBadge: '100% Pass Rate',
            accentColor: '#818cf8',
            images: [
                '/screenshots/Dashboard_UI_3.png',
                '/screenshots/Dashboard_UI_5.png',
                '/screenshots/Dashboard_UI_6.png',
                '/screenshots/Dashboard_UI_7.png',
                '/screenshots/Dashboard_UI_8.png'
            ],
            icon: Camera,
            specs: [
                { label: 'Sensor Matrix', value: '360° Equirectangular' },
                { label: 'Camera Telemetry', value: 'Real-Time Pitch / Yaw' },
                { label: 'Defect Auditing', value: 'Automated + Manual Lock' }
            ]
        },
        {
            id: 'postgis',
            category: 'Enterprise Spatial Cloud Infrastructure',
            title: 'Supabase & PostGIS Spatial Hub',
            subtitle: 'Supabase Realtime Cloud Sync & PostGIS Vector Management',
            description: 'Centralized spatial database powered by Supabase PostgreSQL and PostGIS, facilitating realtime CSV trajectory ingestion, automated duplicate subgrid verification, vector layer staging, and secure cloud storage.',
            metricLabel: 'Production Datasets',
            metricValue: `${batchLogs.length || 3} Master Batches`,
            statusBadge: 'Supabase Connected',
            accentColor: '#fbbf24',
            images: [
                '/screenshots/Dashboard_UI_9.png',
                '/screenshots/Dashboard_UI_10.png',
                '/screenshots/Dashboard_UI_11.png',
                '/screenshots/Dashboard_UI_12.png'
            ],
            icon: Database,
            specs: [
                { label: 'Cloud Engine', value: 'Supabase PostgreSQL + PostGIS' },
                { label: 'Data Security', value: 'Supabase RBAC & Auth Gate' },
                { label: 'Storage & Stream', value: 'Realtime Sync & Storage API' }
            ]
        },
        {
            id: 'analytics-audit',
            category: 'Analytics & Audit Compliance',
            title: 'Executive Reports & Audit Trail',
            subtitle: 'Project Survey Progress Ledgers & Real-Time Security Logs',
            description: 'Automated executive reporting engine compiling contract survey milestones, QA/QC SLA threshold compliance, daily operational progress ledgers, and immutable security audit trails.',
            metricLabel: 'Security Events Logged',
            metricValue: '50 Events (100% Compliant)',
            statusBadge: 'Audit Trail Active',
            accentColor: '#a855f7',
            images: [
                '/screenshots/Dashboard_UI_14.png',
                '/screenshots/Dashboard_UI_15.png',
                '/screenshots/Dashboard_UI_19.png',
                '/screenshots/Dashboard_UI_20.png',
                '/screenshots/Dashboard_UI_21.png'
            ],
            icon: FileText,
            specs: [
                { label: 'Report Format', value: 'Executive PDF / CSV Export' },
                { label: 'Audit Security', value: 'Immutable Activity Trail' },
                { label: 'QA Compliance', value: '0.00% Defect Tolerance' }
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
            <header className="relative z-30 px-4 sm:px-8 py-2.5 sm:py-3 flex items-center justify-between border-b border-slate-800/80 bg-[#070b14]/90 backdrop-blur-md shrink-0">
                <div>
                    <span className="text-xs sm:text-sm font-semibold tracking-tight text-white block leading-tight">
                        Mobile Mapping Data Management System
                    </span>
                    <span className="text-[10px] sm:text-xs text-slate-400 font-medium hidden xs:block">
                        Spatial Trajectory Processing &amp; Quality Assurance Pipeline
                    </span>
                </div>

                {/* Single Clean Desktop Navigation Pills */}
                <div className="hidden lg:flex items-center gap-1 p-1 rounded-xl bg-slate-900/80 border border-slate-800">
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
                <div className="flex items-center gap-2 sm:gap-3">
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard('auth')}
                        className="px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard('general-launch')}
                        className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-200 text-slate-950 transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5"
                    >
                        <span>Launch</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-950 hidden sm:inline" />
                    </button>
                </div>
            </header>

            {/* 3. Main Showcase Section */}
            <main className="relative z-20 flex-1 w-full px-4 sm:px-8 py-3 sm:py-4 overflow-y-auto lg:overflow-hidden flex items-center justify-center">
                <div className="w-full max-w-[1700px] mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">

                    {/* MOBILE TITLE */}
                    <div className="block lg:hidden col-span-1 space-y-1 text-center shrink-0 px-2">
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                            GeoSphere 360° Mobile Mapping Platform
                        </h1>
                        <p className="text-xs text-slate-400 font-normal leading-relaxed max-w-md mx-auto">
                            Centralizing spatial data pipelines with high-precision corridor tracking, PostGIS cloud synchronization, and frame-by-frame spherical QA auditing.
                        </p>
                    </div>

                    {/* NARRATIVE PANEL & MODULE CONTROLS (Left 5 cols on Desktop) */}
                    <div className={`w-full lg:col-span-5 space-y-5 sm:space-y-6 text-left flex flex-col justify-center order-3 lg:order-1 pb-4 lg:pb-0 transition-all duration-300 ease-out ${isAnimating ? 'opacity-0 translate-y-1.5' : 'opacity-100 translate-y-0'}`}>

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
                        <div className="space-y-3 pt-1">
                            <div className="flex items-center justify-between">
                                <span
                                    className="text-xs sm:text-sm font-bold uppercase tracking-wider block"
                                    style={{ color: current.accentColor }}
                                >
                                    {current.category}
                                </span>
                                <span className="text-[11px] sm:text-xs font-semibold tracking-wider text-slate-300 bg-slate-800/80 px-2.5 py-0.5 rounded-full border border-slate-700/60 tabular-nums">
                                    Module 0{activeIndex + 1} / 05
                                </span>
                            </div>

                            <div className="space-y-1">
                                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-100 leading-tight">
                                    {current.title}
                                </h2>
                                <p className="text-xs sm:text-sm text-slate-300/90 font-normal leading-relaxed line-clamp-3">
                                    {current.description}
                                </p>
                            </div>

                            {/* Micro Specs HUD */}
                            <div className="grid grid-cols-3 gap-2 pt-0.5">
                                {current.specs.map((spec, i) => (
                                    <div
                                        key={i}
                                        className="p-2 sm:p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 backdrop-blur-md"
                                    >
                                        <span className="text-[10px] sm:text-[11px] font-medium text-slate-400 block truncate">
                                            {spec.label}
                                        </span>
                                        <span className="text-xs sm:text-sm font-semibold text-slate-200 block mt-0.5 truncate">
                                            {spec.value}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Launch Action Button */}
                            <div className="pt-1">
                                <button
                                    onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                                    className="w-full sm:w-auto px-6 py-3 rounded-xl font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all transform hover:opacity-95 active:scale-95 cursor-pointer shadow-lg"
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
                        <div className="pt-1.5 text-left">
                            <p className="text-[11.5px] sm:text-xs text-slate-400 font-normal leading-relaxed">
                                <span className="text-slate-200 font-medium">Get started quickly with</span> our high-precision WebGIS coverage map, automated batch ingestion pipelines, frame-by-frame 360° equirectangular defect auditing, and cloud-synchronized PostGIS spatial intelligence.
                            </p>

                            {/* Minimal System Metadata Footer */}
                            <div className="pt-3 border-t border-slate-800/50 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-500">Coordinate System:</span>
                                    <span className="font-mono text-slate-300">EPSG:4326</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-500">Database:</span>
                                    <span className="font-mono text-slate-300">PostGIS/PostgreSQL + Supabase</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-slate-500">Renderer:</span>
                                    <span className="font-mono text-slate-300">MapLibre GL + Panellum Viewer</span>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* SCREENSHOT DECK (Right 7 cols on Desktop) */}
                    <div
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                        className={`w-full lg:col-span-7 flex flex-col justify-center group relative order-2 lg:order-2 transition-all duration-300 ease-out touch-pan-y ${isAnimating ? 'opacity-0 scale-[0.995]' : 'opacity-100 scale-100'}`}
                    >
                        {/* Ambient Underglow */}
                        <div className="absolute -inset-4 sm:-inset-6 rounded-3xl overflow-hidden pointer-events-none opacity-40 group-hover:opacity-90 blur-2xl sm:blur-3xl transition-all duration-500 ease-out -z-10">
                            <img
                                src={activeImage}
                                alt="Underglow"
                                loading="eager"
                                decoding="async"
                                className="w-full h-full object-cover scale-110"
                            />
                        </div>

                        {/* Preview Frame Container */}
                        <div className="relative w-full aspect-[16/10] p-3 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800/90 shadow-2xl flex flex-col justify-between overflow-hidden">

                            {/* Top Subtitle Bar */}
                            <div className="flex items-center justify-between px-1 pb-2 border-b border-slate-800/80">
                                <span className="text-[11px] sm:text-xs font-semibold text-slate-300 truncate pr-2">
                                    {current.subtitle}
                                </span>
                                <span className="text-[10px] sm:text-xs font-medium text-slate-400 shrink-0">
                                    {activePhotoIdx + 1} / {current.images.length}
                                </span>
                            </div>

                            {/* Viewport Image */}
                            <div className="relative w-full flex-1 rounded-xl bg-[#090d16] border border-slate-800/90 overflow-hidden flex items-center justify-center my-2 sm:my-3">
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
                                <div className="flex items-center gap-2 pt-1 overflow-x-auto pb-0.5">
                                    {current.images.map((imgUrl, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setActivePhotoIdx(idx)}
                                            className={`relative h-10 w-16 sm:h-12 sm:w-20 rounded-lg overflow-hidden border transition-all cursor-pointer shrink-0 ${activePhotoIdx === idx
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
            <footer className="relative z-30 w-full px-4 sm:px-8 py-2.5 sm:py-3 flex items-center justify-between border-t border-slate-800/80 bg-[#070b14]/95 backdrop-blur-md shrink-0">
                <button
                    onClick={() => handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-2 sm:gap-3 opacity-80 hover:opacity-100 transition-all cursor-pointer"
                >
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center">
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
                            className={`h-2 rounded-full transition-all cursor-pointer ${activeIndex === idx
                                ? 'w-5 sm:w-6 bg-slate-200'
                                : 'w-2 bg-slate-700 hover:bg-slate-500'
                                }`}
                            title={mod.title}
                        />
                    ))}
                </div>

                <button
                    onClick={() => handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-2 sm:gap-3 opacity-80 hover:opacity-100 transition-all cursor-pointer"
                >
                    <div className="hidden sm:block text-right">
                        <span className="text-[10px] text-slate-400 block">Next</span>
                        <span className="text-xs font-semibold text-slate-200">{nextModule.title.split('&')[0]}</span>
                    </div>
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center">
                        <ChevronRight className="w-4 h-4 text-white" />
                    </div>
                </button>
            </footer>

        </div>
    );
};