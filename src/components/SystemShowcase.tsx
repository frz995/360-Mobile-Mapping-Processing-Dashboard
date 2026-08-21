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
                { label: 'Coordinate System', value: 'EPSG:4326 (WGS 84)' },
                { label: 'GPS Precision', value: 'High-Accuracy RTK' },
                { label: 'Coverage Type', value: 'Continuous Trajectory' }
            ]
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
                '/screenshots/Dashboard_UI_4.png'
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
                '/screenshots/Dashboard_UI_15.png'
            ],
            icon: FileText,
            specs: [
                { label: 'Report Format', value: 'Executive PDF / CSV Export' },
                { label: 'Audit Security', value: 'Immutable Activity Trail' },
                { label: 'QA Compliance', value: '0.00% Defect Tolerance' }
            ]
        }
    ];

    // 1. Background Preload: caches every screenshot into memory on mount
    useEffect(() => {
        SYSTEM_MODULES.forEach((mod) => {
            mod.images.forEach((src) => {
                const img = new Image();
                img.src = src;
            });
        });
    }, []);

    // Reset photo index when switching modules
    useEffect(() => {
        setActivePhotoIdx(0);
    }, [activeIndex]);

    const current = SYSTEM_MODULES[activeIndex];
    const prevModule = SYSTEM_MODULES[(activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length];
    const nextModule = SYSTEM_MODULES[(activeIndex + 1) % SYSTEM_MODULES.length];
    const activeImage = current.images[activePhotoIdx] || current.images[0];

    return (
        <div className="relative w-screen h-screen bg-[#070b14] text-slate-100 font-sans overflow-hidden select-none flex flex-col justify-between">

            {/* 1. Full-Screen Ambient Blurred Background */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
                <img
                    src={activeImage}
                    alt="Ambient Base Blur"
                    loading="eager"
                    decoding="async"
                    className="w-full h-full object-cover scale-125 blur-[140px] opacity-25 transition-all duration-500 ease-in-out"
                />
                <div className="absolute inset-0 bg-[#070b14]/75 backdrop-blur-2xl" />
            </div>

            {/* 2. Top Header Navbar */}
            <header className="relative z-30 px-6 sm:px-8 py-3 flex items-center justify-between border-b border-slate-800/80 bg-[#070b14]/85 backdrop-blur-md">
                <div>
                    <span className="text-sm font-semibold tracking-tight text-white block leading-tight">
                        Mobile Mapping Data Management System
                    </span>
                    <span className="text-xs text-slate-400 font-medium">
                        Spatial Trajectory Processing &amp; Quality Assurance Pipeline
                    </span>
                </div>

                {/* Navigation Pills */}
                <div className="hidden md:flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/90 border border-slate-800">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => setActiveIndex(idx)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${activeIndex === idx
                                    ? 'bg-slate-800 text-white font-semibold shadow-sm border border-slate-700'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                        >
                            {mod.title.split('&')[0].trim()}
                        </button>
                    ))}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard()}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-slate-200 text-slate-950 transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-2"
                    >
                        <span>Launch Operations</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-950" />
                    </button>
                </div>
            </header>

            {/* 3. Main Full-Screen Layout */}
            <main className="relative z-20 flex-1 w-full px-6 sm:px-8 py-2 flex items-center justify-center">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center w-full h-full">

                    {/* Left Narrative Panel */}
                    <div className="lg:col-span-4 xl:col-span-3.5 space-y-4 text-left flex flex-col justify-center">
                        <div className="space-y-1.5">
                            <span
                                className="text-xs font-semibold uppercase tracking-wider block"
                                style={{ color: current.accentColor }}
                            >
                                {current.category}
                            </span>
                            <h1 className="text-2xl sm:text-3xl xl:text-4xl font-bold tracking-tight text-white leading-tight">
                                {current.title}
                            </h1>
                            <p className="text-xs sm:text-sm text-slate-400 font-normal leading-relaxed">
                                {current.description}
                            </p>
                        </div>

                        {/* Micro Specs HUD */}
                        <div className="grid grid-cols-3 gap-2 pt-1">
                            {current.specs.map((spec, i) => (
                                <div
                                    key={i}
                                    className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 backdrop-blur-md"
                                >
                                    <span className="text-[10.5px] font-medium text-slate-400 block truncate">
                                        {spec.label}
                                    </span>
                                    <span className="text-xs font-semibold text-slate-200 block mt-0.5 truncate">
                                        {spec.value}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Launch Action */}
                        <div className="pt-2">
                            <button
                                onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                                className="px-6 py-3 rounded-xl font-semibold text-sm flex items-center gap-2.5 transition-all transform hover:opacity-95 active:scale-95 cursor-pointer shadow-lg"
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

                    {/* Right Full-Canvas Screenshot Deck */}
                    <div className="lg:col-span-8 xl:col-span-8.5 h-full flex flex-col justify-center group relative">

                        {/* Ambient Underglow */}
                        <div className="absolute -inset-2 rounded-3xl overflow-hidden pointer-events-none opacity-40 group-hover:opacity-75 transition-opacity duration-500 blur-2xl">
                            <img
                                src={activeImage}
                                alt="Underglow"
                                loading="eager"
                                decoding="async"
                                className="w-full h-full object-cover scale-110"
                            />
                        </div>

                        {/* Screen Container */}
                        <div className="relative h-[calc(100vh-175px)] w-full p-3 rounded-2xl bg-slate-900/90 border border-slate-800/90 shadow-2xl flex flex-col justify-between backdrop-blur-xl">

                            {/* Top Subtitle Bar */}
                            <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-800/80">
                                <span className="text-xs font-semibold text-slate-300">
                                    {current.subtitle}
                                </span>
                                <span className="text-xs font-medium text-slate-400">
                                    View {activePhotoIdx + 1} of {current.images.length}
                                </span>
                            </div>

                            {/* Full-Frame Dashboard Viewport */}
                            <div className="relative flex-1 w-full rounded-xl bg-[#090d16] border border-slate-800/90 overflow-hidden flex items-center justify-center my-2">
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
                                <div className="flex items-center gap-2 pt-1 overflow-x-auto">
                                    {current.images.map((imgUrl, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setActivePhotoIdx(idx)}
                                            className={`relative h-12 w-20 rounded-lg overflow-hidden border transition-all cursor-pointer shrink-0 ${activePhotoIdx === idx
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

            {/* 4. Footer Navigation Controls */}
            <footer className="relative z-20 w-full px-6 sm:px-8 py-3 flex items-center justify-between border-t border-slate-800/80 bg-[#070b14]/90 backdrop-blur-md">
                <button
                    onClick={() => setActiveIndex((prev) => (prev - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-3 opacity-75 hover:opacity-100 transition-all cursor-pointer"
                >
                    <div className="w-7 h-7 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center">
                        <ChevronLeft className="w-4 h-4 text-white" />
                    </div>
                    <div className="hidden sm:block text-left">
                        <span className="text-[11px] text-slate-400 block">Previous Module</span>
                        <span className="text-xs font-semibold text-slate-200">{prevModule.title}</span>
                    </div>
                </button>

                {/* Step Indicator Dots */}
                <div className="flex items-center gap-2">
                    {SYSTEM_MODULES.map((mod, idx) => (
                        <button
                            key={mod.id}
                            onClick={() => setActiveIndex(idx)}
                            className={`h-2 rounded-full transition-all cursor-pointer ${activeIndex === idx
                                    ? 'w-6 bg-slate-200'
                                    : 'w-2 bg-slate-700 hover:bg-slate-500'
                                }`}
                            title={mod.title}
                        />
                    ))}
                </div>

                <button
                    onClick={() => setActiveIndex((prev) => (prev + 1) % SYSTEM_MODULES.length)}
                    className="flex items-center gap-3 opacity-75 hover:opacity-100 transition-all cursor-pointer"
                >
                    <div className="hidden sm:block text-right">
                        <span className="text-[11px] text-slate-400 block">Next Module</span>
                        <span className="text-xs font-semibold text-slate-200">{nextModule.title}</span>
                    </div>
                    <div className="w-7 h-7 rounded-lg border border-slate-800 bg-slate-900 flex items-center justify-center">
                        <ChevronRight className="w-4 h-4 text-white" />
                    </div>
                </button>
            </footer>

        </div>
    );
};