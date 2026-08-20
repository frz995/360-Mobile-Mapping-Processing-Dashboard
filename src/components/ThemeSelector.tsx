import React, { useState, useEffect } from 'react';
import {
    Palette,
    Check,
    RotateCcw,
    Sliders,
    CheckCircle2,
    Navigation,
    Camera,
    Layers,
    Activity,
    Search,
    Sun,
    HelpCircle
} from 'lucide-react';

export type ThemeKey = 'midnight' | 'obsidian' | 'slate' | 'nordic-light' | 'emerald-cyber';

export interface ThemeDefinition {
    id: ThemeKey;
    name: string;
    badge: string;
    tagline: string;
    bgApp: string;
    bgCard: string;
    innerCard: string;
    borderSubtle: string;
    accent: string;
    accentGlow: string;
    textPrimary: string;
    textMuted: string;
    mapTileUrl: string;
    mapStyle: string;
}

export const THEME_PRESETS: ThemeDefinition[] = [
    {
        id: 'midnight',
        name: 'Midnight Navy',
        badge: 'Enterprise Default',
        tagline: 'Deep navy telemetry interface tuned for standard darkroom GIS control operations.',
        bgApp: '#080d19',
        bgCard: '#111c33',
        innerCard: '#0b1324',
        borderSubtle: '#1d2d4f',
        accent: '#38bdf8',
        accentGlow: 'rgba(56, 189, 248, 0.25)',
        textPrimary: '#f8fafc',
        textMuted: '#94a3b8',
        mapTileUrl: 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/13/6435/4078.png',
        mapStyle: 'Positron (Carto Light)'
    },
    {
        id: 'obsidian',
        name: 'Obsidian OLED',
        badge: 'Ultra Deep Contrast',
        tagline: 'Deep-space black surfaces with electric indigo highlights designed for OLED displays.',
        bgApp: '#030407',
        bgCard: '#0d1017',
        innerCard: '#07090e',
        borderSubtle: '#1e2433',
        accent: '#6366f1',
        accentGlow: 'rgba(99, 102, 241, 0.3)',
        textPrimary: '#ffffff',
        textMuted: '#848e9f',
        mapTileUrl: 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/13/6435/4078.png',
        mapStyle: 'Carto Dark Matter'
    },
    {
        id: 'slate',
        name: 'Titanium Slate',
        badge: 'Industrial Studio',
        tagline: 'Modern matte graphite surfaces paired with high-clarity emerald green telemetry.',
        bgApp: '#10141a',
        bgCard: '#1f2734',
        innerCard: '#141a23',
        borderSubtle: '#2c3749',
        accent: '#10b981',
        accentGlow: 'rgba(16, 185, 129, 0.25)',
        textPrimary: '#f1f5f9',
        textMuted: '#94a3b8',
        mapTileUrl: 'https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/voyager/13/6435/4078.png',
        mapStyle: 'Carto Voyager'
    },
    {
        id: 'emerald-cyber',
        name: 'Cyberpunk Neon',
        badge: 'High-Vis Operations',
        tagline: 'Cyber-teal borders with neon amber indicators for high-speed spatial auditing.',
        bgApp: '#050c13',
        bgCard: '#0d1f30',
        innerCard: '#07131e',
        borderSubtle: '#143652',
        accent: '#06b6d4',
        accentGlow: 'rgba(6, 182, 212, 0.35)',
        textPrimary: '#ecfeff',
        textMuted: '#67e8f9',
        mapTileUrl: 'https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/13/6435/4078.png',
        mapStyle: 'High-Contrast Dark'
    },
    {
        id: 'nordic-light',
        name: 'Nordic Clean Light',
        badge: 'Daylight Ops',
        tagline: 'High-luminance daytime spatial view with crisp navy typography and soft borders.',
        bgApp: '#f1f5f9',
        bgCard: '#ffffff',
        innerCard: '#f8fafc',
        borderSubtle: '#cbd5e1',
        accent: '#0284c7',
        accentGlow: 'rgba(2, 132, 199, 0.15)',
        textPrimary: '#0f172a',
        textMuted: '#64748b',
        mapTileUrl: 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/13/6435/4078.png',
        mapStyle: 'Positron Carto Light'
    }
];

export interface ThemeCanvasProps {
    cardBg?: string;
    innerCardBg?: string;
    themeMode?: string;
    dailyData?: any[];
    batchLogs?: any[];
    projectSettings?: any;
}

export const ThemeManagementCanvas: React.FC<ThemeCanvasProps> = ({
    cardBg = 'bg-slate-900/60',
    dailyData = [],
    batchLogs = [],
    projectSettings
}) => {
    const [stagedTheme, setStagedTheme] = useState<ThemeKey>('midnight');
    const [activeTheme, setActiveTheme] = useState<ThemeKey>('midnight');
    const [isSavedBanner, setIsSavedBanner] = useState(false);

    useEffect(() => {
        const saved = (localStorage.getItem('app_dashboard_theme') as ThemeKey) || 'midnight';
        setActiveTheme(saved);
        setStagedTheme(saved);
    }, []);

    const handleSelectPreset = (id: ThemeKey) => {
        setStagedTheme(id);
        setIsSavedBanner(false);
    };

    const handleApplyTheme = () => {
        setActiveTheme(stagedTheme);
        document.documentElement.setAttribute('data-theme', stagedTheme);
        try {
            localStorage.setItem('app_dashboard_theme', stagedTheme);
        } catch { }
        setIsSavedBanner(true);
        setTimeout(() => setIsSavedBanner(false), 3500);
    };

    const handleResetToCurrent = () => {
        setStagedTheme(activeTheme);
    };

    const stagedObj = THEME_PRESETS.find((t) => t.id === stagedTheme) || THEME_PRESETS[0];

    // Calculate live operational metrics from props
    const totalDistance = dailyData.reduce((acc, item) => acc + (Number(item.distance) || 0), 0);
    const totalFrames = dailyData.reduce((acc, item) => acc + (Number(item.images) || 0), 0);
    const activeJobs = batchLogs.filter((b: any) => b.status === 'In Progress' || b.status === 'Ongoing').length || 3;
    const targetDistance = projectSettings?.targetDistanceKm || 315.2;
    const pctTarget = Math.min(100, (totalDistance / targetDistance) * 100).toFixed(1);

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Top Header Card */}
            <div className={`p-4 rounded-2xl border border-slate-800/80 ${cardBg} flex flex-wrap items-center justify-between gap-4`}>
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
                        <Palette className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                            Modern Enterprise Theme Packages
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono">
                                Real Dashboard Live Staging
                            </span>
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Select any theme on the left to test live UI rendering, spatial basemap styles, telemetry cards, and data tables before applying globally.
                        </p>
                    </div>
                </div>

                {/* Global Action Status */}
                <div className="flex items-center gap-3">
                    {isSavedBanner && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold animate-in fade-in">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            Theme Applied to Dashboard
                        </div>
                    )}
                    <button
                        onClick={handleApplyTheme}
                        disabled={stagedTheme === activeTheme && !isSavedBanner}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 ${stagedTheme !== activeTheme
                                ? 'bg-sky-500 hover:bg-sky-400 text-white ring-2 ring-sky-400/30 shadow-sky-500/20 cursor-pointer'
                                : 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700'
                            }`}
                    >
                        <Check className="w-4 h-4" />
                        Apply Theme Changes
                    </button>
                </div>
            </div>

            {/* Main 2-Column Canvas Layout */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

                {/* Left Column: Preset Package Catalog (4 cols) */}
                <div className="xl:col-span-4 space-y-3">
                    <div className="flex items-center justify-between px-1">
                        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Sliders className="w-3.5 h-3.5 text-sky-400" />
                            Theme Packages Catalog
                        </div>
                        <button
                            onClick={handleResetToCurrent}
                            disabled={stagedTheme === activeTheme}
                            className="text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                            <RotateCcw className="w-3 h-3" />
                            Reset
                        </button>
                    </div>

                    <div className="space-y-2.5">
                        {THEME_PRESETS.map((preset) => {
                            const isStaged = stagedTheme === preset.id;
                            const isCurrentlyActive = activeTheme === preset.id;

                            return (
                                <div
                                    key={preset.id}
                                    onClick={() => handleSelectPreset(preset.id)}
                                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${isStaged
                                            ? 'border-sky-500 bg-sky-950/30 shadow-lg shadow-sky-950/40 ring-1 ring-sky-500/40'
                                            : 'border-slate-800/80 bg-slate-900/40 hover:bg-slate-850 hover:border-slate-700'
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <div
                                                    className="w-8 h-8 rounded-lg border flex items-center justify-center shadow-inner"
                                                    style={{
                                                        backgroundColor: preset.bgCard,
                                                        borderColor: preset.borderSubtle
                                                    }}
                                                >
                                                    <span
                                                        className="w-3.5 h-3.5 rounded-full shadow-sm"
                                                        style={{ backgroundColor: preset.accent }}
                                                    />
                                                </div>
                                                {isCurrentlyActive && (
                                                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-900" title="Active on Dashboard" />
                                                )}
                                            </div>

                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-xs font-bold text-slate-100">{preset.name}</h4>
                                                    <span
                                                        className="text-[9px] px-1.5 py-0.5 rounded font-mono font-medium"
                                                        style={{
                                                            backgroundColor: `${preset.accent}15`,
                                                            color: preset.accent,
                                                            borderColor: `${preset.accent}30`
                                                        }}
                                                    >
                                                        {preset.badge}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{preset.tagline}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isStaged && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30">
                                                    Active Preview
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Column: Real Live Dashboard UI Viewport (8 cols) */}
                <div className="xl:col-span-8 space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            Real Live Dashboard Operational Canvas
                        </div>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700 font-mono">
                            Live Staging Theme: <strong style={{ color: stagedObj.accent }}>{stagedObj.name}</strong>
                        </span>
                    </div>

                    {/* Real Full Dashboard Frame Scoped with Staged Colors */}
                    <div
                        data-theme={stagedTheme}
                        className="p-3.5 sm:p-4 rounded-2xl border transition-all duration-300 shadow-2xl relative space-y-3.5 overflow-hidden"
                        style={{
                            backgroundColor: stagedObj.bgApp,
                            borderColor: stagedObj.borderSubtle,
                            color: stagedObj.textPrimary
                        }}
                    >
                        {/* 1. REAL TOP HEADER BAR */}
                        <div
                            className="px-3.5 py-2.5 rounded-xl border flex items-center justify-between"
                            style={{
                                backgroundColor: stagedObj.bgCard,
                                borderColor: stagedObj.borderSubtle
                            }}
                        >
                            <div className="flex items-center gap-2.5">
                                <div
                                    className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shadow text-white"
                                    style={{ backgroundColor: stagedObj.accent }}
                                >
                                    <Layers className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="text-xs font-bold tracking-tight" style={{ color: stagedObj.textPrimary }}>
                                        Mobile Mapping Data Management System
                                    </div>
                                    <div className="text-[9px]" style={{ color: stagedObj.textMuted }}>
                                        Spatial Trajectory Processing & Quality Assurance Pipeline
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 text-[10px]">
                                <div className="flex items-center gap-1.5 text-slate-400">
                                    <HelpCircle className="w-3.5 h-3.5" />
                                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-bold border border-slate-700">50</span>
                                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-rose-400 font-bold border border-slate-700">50</span>
                                    <Sun className="w-3.5 h-3.5 text-slate-400" />
                                </div>
                                <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold text-[9px] flex items-center justify-center border border-amber-500/40">
                                    G
                                </div>
                                <span
                                    className="px-2 py-0.5 rounded-full font-bold text-[9px] border"
                                    style={{
                                        backgroundColor: `${stagedObj.accent}15`,
                                        color: stagedObj.accent,
                                        borderColor: `${stagedObj.accent}40`
                                    }}
                                >
                                    Admin / Live
                                </span>
                            </div>
                        </div>

                        {/* 2. REAL 4 KPI METRICS ROW */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                            {/* Metric 1 */}
                            <div
                                className="p-3 rounded-xl border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[9px] uppercase font-bold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>TOTAL DISTANCE MAPPED</span>
                                    <Navigation className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-1 flex items-baseline gap-1.5">
                                    <span className="text-base font-extrabold" style={{ color: stagedObj.textPrimary }}>
                                        {totalDistance.toFixed(1)} km
                                    </span>
                                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                                        {pctTarget}% of {targetDistance}km Target
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>Cumulative Trajectory Distance • Live</div>
                            </div>

                            {/* Metric 2 */}
                            <div
                                className="p-3 rounded-xl border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[9px] uppercase font-bold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>PROCESSED PANORAMAS</span>
                                    <Camera className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-1">
                                    <span className="text-base font-extrabold" style={{ color: stagedObj.textPrimary }}>
                                        {totalFrames.toLocaleString()} Frames
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>Total 360° Image Frames Ingested</div>
                            </div>

                            {/* Metric 3 */}
                            <div
                                className="p-3 rounded-xl border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[9px] uppercase font-bold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>ACTIVE PROCESSING JOBS</span>
                                    <Layers className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-1">
                                    <span className="text-base font-extrabold" style={{ color: stagedObj.textPrimary }}>
                                        {activeJobs} Jobs In Progress
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>Subgrid batch stitching (3 active)</div>
                            </div>

                            {/* Metric 4 */}
                            <div
                                className="p-3 rounded-xl border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[9px] uppercase font-bold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>PIPELINE QUALITY SLA</span>
                                    <Activity className="w-3 h-3 text-emerald-400" />
                                </div>
                                <div className="my-1">
                                    <span className="text-base font-extrabold text-emerald-400">100.0% Normal</span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>0 Defect Frames Flagged</div>
                            </div>
                        </div>

                        {/* 3. REAL 2-PANEL LAYOUT (INTERACTIVE COVERAGE MAP ON LEFT, CONTROL & QA ON RIGHT) */}
                        <div className="grid grid-cols-12 gap-3">

                            {/* LEFT: INTERACTIVE COVERAGE MAP (7 COLS) */}
                            <div
                                className="col-span-12 lg:col-span-7 h-96 rounded-xl border relative overflow-hidden flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedTheme === 'nordic-light' ? '#f8fafc' : '#080d19',
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                {/* Real Carto Basemap Background Layer */}
                                <div
                                    className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-300"
                                    style={{
                                        backgroundImage: stagedTheme === 'obsidian' || stagedTheme === 'emerald-cyber'
                                            ? `radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.6) 0%, rgba(3, 4, 7, 0.95) 100%), url('https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/13/6435/4078.png')`
                                            : `url('https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/13/6435/4078.png')`,
                                        filter: stagedTheme === 'nordic-light' ? 'none' : 'contrast(1.05)'
                                    }}
                                >
                                    {/* Real Road Geometry & Trajectory Orange Vector Nodes */}
                                    <svg className="w-full h-full absolute inset-0 pointer-events-none" viewBox="0 0 500 320">
                                        <path
                                            d="M 40 310 Q 120 280, 160 270 T 260 210 T 360 160 T 480 60"
                                            fill="none"
                                            stroke={stagedTheme === 'nordic-light' ? '#cbd5e1' : '#334155'}
                                            strokeWidth="6"
                                            strokeLinecap="round"
                                        />
                                        <text x="140" y="250" fill={stagedObj.textMuted} fontSize="9" fontFamily="monospace" transform="rotate(-15 140,250)">
                                            Jalan Jabi
                                        </text>

                                        {/* Orange Trajectory Points */}
                                        <path
                                            d="M 50 310 Q 120 280, 160 270"
                                            fill="none"
                                            stroke="#f59e0b"
                                            strokeWidth="3.5"
                                            strokeDasharray="4 3"
                                        />
                                        {[
                                            { cx: 50, cy: 310 },
                                            { cx: 65, cy: 300 },
                                            { cx: 80, cy: 292 },
                                            { cx: 95, cy: 285 },
                                            { cx: 110, cy: 280 },
                                            { cx: 125, cy: 276 },
                                            { cx: 140, cy: 272 },
                                            { cx: 155, cy: 270 },
                                            { cx: 480, cy: 60 }
                                        ].map((pt, i) => (
                                            <circle key={i} cx={pt.cx} cy={pt.cy} r="4.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1" />
                                        ))}
                                    </svg>
                                </div>

                                {/* Map Floating Header Overlay */}
                                <div className="p-3 flex items-center justify-between z-10 pointer-events-none">
                                    <div
                                        className="p-2 rounded-xl border shadow-lg backdrop-blur-md flex items-center gap-2 pointer-events-auto"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}ee`,
                                            borderColor: stagedObj.borderSubtle
                                        }}
                                    >
                                        <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-teal-500/20 text-teal-400 text-xs">
                                            🌐
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-bold" style={{ color: stagedObj.textPrimary }}>
                                                GeoSphere 360 Operations Hub
                                            </div>
                                            <div className="text-[8px] text-teal-400 font-medium">● Live WebGIS</div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1.5 pointer-events-auto">
                                        <button className="p-1.5 rounded-lg border bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white shadow cursor-pointer">
                                            <Search className="w-3.5 h-3.5" />
                                        </button>
                                        <button className="p-1.5 rounded-lg border bg-slate-900/90 text-slate-300 border-slate-700 hover:text-white shadow cursor-pointer">
                                            <Layers className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Map Bottom Status Overlays */}
                                <div className="p-3 flex items-center justify-between z-10 pointer-events-none text-[8px] font-mono">
                                    <div
                                        className="px-2 py-1 rounded-lg border flex items-center gap-1.5 pointer-events-auto backdrop-blur-md shadow"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}ee`,
                                            borderColor: stagedObj.borderSubtle,
                                            color: stagedObj.textPrimary
                                        }}
                                    >
                                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                                        <span>Trajectory Status</span>
                                    </div>

                                    <span
                                        className="px-2 py-1 rounded-lg border pointer-events-auto backdrop-blur-md"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}ee`,
                                            borderColor: stagedObj.borderSubtle,
                                            color: stagedObj.textMuted
                                        }}
                                    >
                                        EPSG:4326 | 2.55288° N, 102.81641° E • Leaflet | © CARTO
                                    </span>
                                </div>
                            </div>

                            {/* RIGHT: PROCESSING CONTROL & 360 QA INSPECTOR (5 COLS) */}
                            <div className="col-span-12 lg:col-span-5 flex flex-col gap-2.5">

                                {/* 1. Processing Control Table */}
                                <div
                                    className="p-3 rounded-xl border flex flex-col justify-between"
                                    style={{
                                        backgroundColor: stagedObj.bgCard,
                                        borderColor: stagedObj.borderSubtle
                                    }}
                                >
                                    <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: stagedObj.borderSubtle }}>
                                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: stagedObj.textPrimary }}>
                                            PROCESSING CONTROL & ADMIN
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                                Overall Progress (3)
                                            </span>
                                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold">
                                                Daily Progress ({dailyData.length || 6})
                                            </span>
                                        </div>
                                    </div>

                                    {/* Batch Rows */}
                                    <div className="space-y-1.5 my-2 text-[8.5px]">
                                        {[
                                            { id: '21235-BATCH-N93E70', subgrid: 'N93E70', img: '0 frames', pic: 'fariz.farhan95', status: 'Ongoing' },
                                            { id: '21235-BATCH-N94E70', subgrid: 'N94E70', img: '0 frames', pic: 'fariz.farhan95', status: 'Ongoing' },
                                            { id: '21235-BATCH-N94E71', subgrid: 'N94E71', img: '0 frames', pic: 'fariz.farhan95', status: 'Ongoing' }
                                        ].map((row, idx) => (
                                            <div
                                                key={idx}
                                                className="flex items-center justify-between p-1.5 rounded border"
                                                style={{
                                                    backgroundColor: stagedObj.innerCard,
                                                    borderColor: stagedObj.borderSubtle
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-slate-400">{row.id.split('-')[2]}</span>
                                                    <span className="font-mono font-bold" style={{ color: stagedObj.textPrimary }}>{row.subgrid}</span>
                                                    <span style={{ color: stagedObj.textPrimary }}>{row.img}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span style={{ color: stagedObj.textMuted }}>{row.pic}</span>
                                                    <span className="text-amber-400 font-semibold flex items-center gap-1">
                                                        ● {row.status}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="pt-1.5 border-t flex items-center justify-between text-[8px]" style={{ borderColor: stagedObj.borderSubtle, color: stagedObj.textMuted }}>
                                        <span>Live Telemetry Engine</span>
                                        <span className="font-mono text-emerald-400">Status: Operational</span>
                                    </div>
                                </div>

                                {/* 2. REAL 360 VIEW INSPECTOR & OPERATOR QA */}
                                <div className="grid grid-cols-12 gap-2">
                                    {/* Left: 360 View Inspector with 4-way Expand Arrow */}
                                    <div
                                        className="col-span-7 p-3 rounded-xl border flex flex-col items-center justify-center text-center min-h-[140px]"
                                        style={{
                                            backgroundColor: stagedObj.bgCard,
                                            borderColor: stagedObj.borderSubtle
                                        }}
                                    >
                                        <div className="flex items-center gap-1.5 text-[9px] font-bold mb-3" style={{ color: stagedObj.textPrimary }}>
                                            <Camera className="w-3.5 h-3.5 text-sky-400" />
                                            <span>360 VIEW INSPECTOR & QA</span>
                                        </div>

                                        {/* 4-Way Expand Icon */}
                                        <div className="my-1 text-slate-500">
                                            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                                            </svg>
                                        </div>

                                        <div className="text-[8px] font-medium" style={{ color: stagedObj.textPrimary }}>
                                            Select a location on the map
                                        </div>
                                        <div className="text-[7.5px]" style={{ color: stagedObj.textMuted }}>
                                            to view 360° imagery
                                        </div>
                                    </div>

                                    {/* Right: Operator QA Details & Checklist */}
                                    <div
                                        className="col-span-5 p-2.5 rounded-xl border flex flex-col justify-between"
                                        style={{
                                            backgroundColor: stagedObj.bgCard,
                                            borderColor: stagedObj.borderSubtle
                                        }}
                                    >
                                        <div className="flex items-center justify-between pb-1 border-b" style={{ borderColor: stagedObj.borderSubtle }}>
                                            <span className="text-[8px] font-bold" style={{ color: stagedObj.textPrimary }}>OPERATOR QA</span>
                                            <span className="text-[7px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                                                Reviewing
                                            </span>
                                        </div>

                                        <div className="space-y-1 my-1 text-[7px]" style={{ color: stagedObj.textMuted }}>
                                            <div className="flex justify-between"><span>Subgrid:</span> <span className="font-mono text-slate-300">-</span></div>
                                            <div className="flex justify-between"><span>Equipment:</span> <span className="text-slate-300">-</span></div>
                                            <div className="flex justify-between"><span>Coordinates:</span> <span className="text-slate-300">-</span></div>
                                            <div className="flex justify-between"><span>PIC:</span> <span className="text-slate-300">-</span></div>
                                        </div>

                                        <div className="pt-1 border-t text-[7px] text-amber-400 font-medium text-center" style={{ borderColor: stagedObj.borderSubtle }}>
                                            QA editing disabled for guests
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};