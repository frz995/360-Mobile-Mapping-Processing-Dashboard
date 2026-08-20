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
    Activity
} from 'lucide-react';
import { WebGISViewerIframe } from './WebGISViewerIframe';

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
    mapStyle: string;
}

export const THEME_PRESETS: ThemeDefinition[] = [
    {
        id: 'midnight',
        name: 'Midnight Navy',
        badge: 'Enterprise Default',
        tagline: 'Deep navy and sky blue telemetry interface tuned for darkroom control centres.',
        bgApp: '#080d19',
        bgCard: '#111c33',
        innerCard: '#0b1324',
        borderSubtle: '#1d2d4f',
        accent: '#38bdf8',
        accentGlow: 'rgba(56, 189, 248, 0.25)',
        textPrimary: '#f8fafc',
        textMuted: '#94a3b8',
        mapStyle: 'Positron Carto Light'
    },
    {
        id: 'obsidian',
        name: 'Obsidian OLED',
        badge: 'Ultra Deep Contrast',
        tagline: 'Pitch-black glass surfaces with electric indigo accents for OLED displays.',
        bgApp: '#030407',
        bgCard: '#0d1017',
        innerCard: '#07090e',
        borderSubtle: '#1d2333',
        accent: '#6366f1',
        accentGlow: 'rgba(99, 102, 241, 0.3)',
        textPrimary: '#ffffff',
        textMuted: '#848e9f',
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
        mapStyle: 'High-Contrast Cyber'
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

    const stagedObj = THEME_PRESETS.find(t => t.id === stagedTheme) || THEME_PRESETS[0];

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
                            ? 'bg-sky-500 hover:bg-sky-400 text-white ring-2 ring-sky-400/30 shadow-sky-500/20'
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
                            className="text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40 flex items-center gap-1 transition-colors"
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

                {/* Right Column: Complete Real Live Dashboard UI Viewport (8 cols) */}
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
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                                    ⚡ Live Telemetry
                                </span>
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

                        {/* 3. REAL 2-PANEL LAYOUT (MAP ON LEFT, CONTROL & QA ON RIGHT) */}
                        <div className="grid grid-cols-12 gap-3">

                            {/* REAL LIVE WEBGIS MAP ENGINE */}
                            <div
                                className="col-span-12 md:col-span-7 h-80 rounded-xl border relative overflow-hidden flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                {/* Embedded Live Map Component */}
                                <div className="absolute inset-0 z-0">
                                    <WebGISViewerIframe panoramaUrl="" />
                                </div>

                                <div className="p-2 z-10 flex items-center justify-between pointer-events-none">
                                    <div
                                        className="px-2.5 py-1 rounded-lg border shadow-lg backdrop-blur-md flex items-center gap-2 text-[10px] pointer-events-auto"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}ee`,
                                            borderColor: stagedObj.borderSubtle
                                        }}
                                    >
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                        <span className="font-bold" style={{ color: stagedObj.textPrimary }}>GeoSphere 360 Operations Hub</span>
                                        <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold text-teal-400 bg-teal-500/10">
                                            Live WebGIS
                                        </span>
                                    </div>

                                    <span
                                        className="text-[9px] px-2 py-0.5 rounded font-mono border pointer-events-auto"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}ee`,
                                            borderColor: stagedObj.borderSubtle,
                                            color: stagedObj.textMuted
                                        }}
                                    >
                                        {stagedObj.mapStyle}
                                    </span>
                                </div>

                                <div className="p-2 z-10 flex items-center justify-between text-[8px] font-mono pointer-events-none">
                                    <span
                                        className="px-2 py-0.5 rounded border pointer-events-auto"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}ee`,
                                            borderColor: stagedObj.borderSubtle,
                                            color: stagedObj.textPrimary
                                        }}
                                    >
                                        EPSG:4326 | 2.54936° N, 102.81716° E
                                    </span>
                                </div>
                            </div>

                            {/* REAL PROCESSING CONTROL & QA INSPECTOR TABLE */}
                            <div className="col-span-12 md:col-span-5 flex flex-col gap-2.5">
                                <div
                                    className="p-3 rounded-xl border flex-1 flex flex-col justify-between"
                                    style={{
                                        backgroundColor: stagedObj.bgCard,
                                        borderColor: stagedObj.borderSubtle
                                    }}
                                >
                                    <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: stagedObj.borderSubtle }}>
                                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: stagedObj.textPrimary }}>
                                            PROCESSING CONTROL & ADMIN
                                        </span>
                                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                                            Daily Progress ({dailyData.length || 6})
                                        </span>
                                    </div>

                                    {/* Real Data Rows */}
                                    <div className="space-y-1.5 my-2 text-[9px] max-h-48 overflow-y-auto">
                                        {(dailyData && dailyData.length > 0 ? dailyData.slice(0, 4) : [
                                            { subgrid: 'N93E70', images: 164, status: 'Ongoing' },
                                            { subgrid: 'N94E70', images: 100, status: 'Ongoing' },
                                            { subgrid: 'N94E71', images: 9, status: 'Ongoing' }
                                        ]).map((row: any, idx: number) => (
                                            <div
                                                key={idx}
                                                className="flex items-center justify-between p-1.5 rounded border"
                                                style={{
                                                    backgroundColor: stagedObj.innerCard,
                                                    borderColor: stagedObj.borderSubtle
                                                }}
                                            >
                                                <span className="font-mono font-bold" style={{ color: stagedObj.textPrimary }}>
                                                    {row.subgrid || `N9${idx}E7${idx}`}
                                                </span>
                                                <span style={{ color: stagedObj.textPrimary }}>{row.images || 0} frames</span>
                                                <span className="text-amber-400 font-semibold flex items-center gap-1">
                                                    ● {row.status || 'Ongoing'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    <div className="pt-2 border-t flex items-center justify-between text-[8px]" style={{ borderColor: stagedObj.borderSubtle, color: stagedObj.textMuted }}>
                                        <span>Live Telemetry Engine</span>
                                        <span className="font-mono text-emerald-400">Status: Operational</span>
                                    </div>
                                </div>

                                {/* 360 View Inspector & QA Box */}
                                <div
                                    className="p-2.5 rounded-xl border flex items-center justify-between"
                                    style={{
                                        backgroundColor: stagedObj.bgCard,
                                        borderColor: stagedObj.borderSubtle
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded flex items-center justify-center bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px]">
                                            <Camera className="w-3.5 h-3.5" />
                                        </div>
                                        <div>
                                            <div className="text-[9px] font-bold" style={{ color: stagedObj.textPrimary }}>
                                                360 View Inspector & QA
                                            </div>
                                            <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>
                                                Live spatial node inspector active
                                            </div>
                                        </div>
                                    </div>

                                    <span
                                        className="text-[8px] px-2 py-0.5 rounded font-bold border"
                                        style={{
                                            backgroundColor: `${stagedObj.accent}20`,
                                            color: stagedObj.accent,
                                            borderColor: `${stagedObj.accent}40`
                                        }}
                                    >
                                        Reviewing Active
                                    </span>
                                </div>
                            </div>

                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};