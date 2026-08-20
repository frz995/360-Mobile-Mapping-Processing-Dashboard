import React, { useState, useEffect } from 'react';
import { Palette, Check, Sparkles, Monitor, Eye, RotateCcw, Sliders, CheckCircle2 } from 'lucide-react';

export type ThemeKey = 'midnight' | 'obsidian' | 'slate' | 'nordic-light' | 'emerald-cyber';

export interface ThemeDefinition {
    id: ThemeKey;
    name: string;
    badge: string;
    tagline: string;
    bgApp: string;
    bgCard: string;
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
        bgApp: '#0a0f1d',
        bgCard: '#131b2e',
        borderSubtle: '#1e293b',
        accent: '#38bdf8',
        accentGlow: 'rgba(56, 189, 248, 0.25)',
        textPrimary: '#f8fafc',
        textMuted: '#94a3b8',
        mapStyle: 'Positron / Carto Dark'
    },
    {
        id: 'obsidian',
        name: 'Obsidian OLED',
        badge: 'Ultra Deep Contrast',
        tagline: 'Pitch-black glass surfaces with electric indigo accents for OLED displays.',
        bgApp: '#030407',
        bgCard: '#0f1117',
        borderSubtle: '#1e2330',
        accent: '#6366f1',
        accentGlow: 'rgba(99, 102, 241, 0.3)',
        textPrimary: '#ffffff',
        textMuted: '#848e9f',
        mapStyle: 'Alidade Smooth Dark'
    },
    {
        id: 'slate',
        name: 'Titanium Slate',
        badge: 'Industrial Studio',
        tagline: 'Modern matte graphite surfaces paired with high-clarity emerald green telemetry.',
        bgApp: '#14171d',
        bgCard: '#212734',
        borderSubtle: '#323a4b',
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
        bgApp: '#080e14',
        bgCard: '#0d1824',
        borderSubtle: '#142a3e',
        accent: '#06b6d4',
        accentGlow: 'rgba(6, 182, 212, 0.35)',
        textPrimary: '#f0fdfa',
        textMuted: '#7dd3fc',
        mapStyle: 'Dark Matter Cyber'
    },
    {
        id: 'nordic-light',
        name: 'Nordic Clean Light',
        badge: 'Daylight Ops',
        tagline: 'High-luminance daytime spatial view with crisp navy typography and soft borders.',
        bgApp: '#f1f5f9',
        bgCard: '#ffffff',
        borderSubtle: '#cbd5e1',
        accent: '#0284c7',
        accentGlow: 'rgba(2, 132, 199, 0.15)',
        textPrimary: '#0f172a',
        textMuted: '#64748b',
        mapStyle: 'Positron Carto Light'
    }
];

interface ThemeCanvasProps {
    cardBg?: string;
    innerCardBg?: string;
    themeMode?: string;
}

export const ThemeManagementCanvas: React.FC<ThemeCanvasProps> = ({ cardBg = 'bg-slate-900/60' }) => {
    // Staged theme in the live preview
    const [stagedTheme, setStagedTheme] = useState<ThemeKey>('midnight');
    // Currently applied global active theme
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

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Top Header Card */}
            <div className={`p-5 rounded-2xl border border-slate-800/80 ${cardBg} flex flex-wrap items-center justify-between gap-4`}>
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
                        <Palette className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                            Modern Enterprise Theme Packages
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono">
                                5 Pro Presets
                            </span>
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Customize dashboard aesthetic, card contrast, accent highlights, and preview before applying.
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* Left Column: Preset Package Catalog (5 cols) */}
                <div className="lg:col-span-5 space-y-3">
                    <div className="flex items-center justify-between px-1">
                        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Sliders className="w-3.5 h-3.5 text-sky-400" />
                            Select Theme Package
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
                                        ? 'border-sky-500 bg-sky-950/20 shadow-lg shadow-sky-950/40 ring-1 ring-sky-500/30'
                                        : 'border-slate-800/80 bg-slate-900/40 hover:bg-slate-850 hover:border-slate-700'
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            {/* Color Dot swatch Preview */}
                                            <div className="relative">
                                                <div
                                                    className="w-8 h-8 rounded-lg border flex items-center justify-center shadow-inner"
                                                    style={{
                                                        backgroundColor: preset.bgCard,
                                                        borderColor: preset.borderSubtle
                                                    }}
                                                >
                                                    <span
                                                        className="w-3 h-3 rounded-full shadow-sm"
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

                                        <div className="flex items-center gap-2 shrink-0">
                                            {isStaged && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30 flex items-center gap-1">
                                                    <Eye className="w-3 h-3" /> Previewing
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Swatch chips */}
                                    <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-400">
                                        <div className="flex items-center gap-2">
                                            <span className="flex items-center gap-1">
                                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: preset.bgApp }} /> BG: {preset.bgApp}
                                            </span>
                                            <span className="flex items-center gap-1">
                                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: preset.accent }} /> Accent: {preset.accent}
                                            </span>
                                        </div>
                                        <span>{preset.mapStyle}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Column: Live Interactive Dashboard Mockup Preview (7 cols) */}
                <div className="lg:col-span-7 space-y-3">
                    <div className="flex items-center justify-between px-1">
                        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Monitor className="w-3.5 h-3.5 text-sky-400" />
                            Live Dashboard UI Mockup Preview
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            Interactive Preview Engine
                        </span>
                    </div>

                    {/* Staged Sandbox Container */}
                    <div
                        className="p-5 rounded-2xl border transition-all duration-300 shadow-2xl relative space-y-4"
                        style={{
                            backgroundColor: stagedObj.bgApp,
                            borderColor: stagedObj.borderSubtle,
                            color: stagedObj.textPrimary
                        }}
                    >
                        {/* Top Mock Header */}
                        <div
                            className="p-3 rounded-xl border flex items-center justify-between"
                            style={{
                                backgroundColor: stagedObj.bgCard,
                                borderColor: stagedObj.borderSubtle
                            }}
                        >
                            <div className="flex items-center gap-2.5">
                                <div
                                    className="w-6 h-6 rounded-lg flex items-center justify-center shadow-sm"
                                    style={{ backgroundColor: stagedObj.accent }}
                                >
                                    <Sparkles className="w-3.5 h-3.5 text-white" />
                                </div>
                                <div>
                                    <div className="text-xs font-bold tracking-tight" style={{ color: stagedObj.textPrimary }}>
                                        GeoSphere 360 Operations Hub
                                    </div>
                                    <div className="text-[9px]" style={{ color: stagedObj.textMuted }}>
                                        Spatial Trajectory Processing & QA Pipeline
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span
                                    className="text-[9px] px-2 py-0.5 rounded-full font-semibold border"
                                    style={{
                                        backgroundColor: `${stagedObj.accent}15`,
                                        color: stagedObj.accent,
                                        borderColor: `${stagedObj.accent}40`
                                    }}
                                >
                                    ● Live WebGIS
                                </span>
                            </div>
                        </div>

                        {/* KPI Metric Cards Row */}
                        <div className="grid grid-cols-3 gap-2.5">
                            <div
                                className="p-3 rounded-xl border"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    Total Distance
                                </div>
                                <div className="text-base font-extrabold mt-0.5" style={{ color: stagedObj.textPrimary }}>
                                    315.2 km
                                </div>
                                <div className="text-[9px] mt-1 flex items-center gap-1" style={{ color: stagedObj.accent }}>
                                    <span>↑ 100% Target Met</span>
                                </div>
                            </div>

                            <div
                                className="p-3 rounded-xl border"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    Processed Frames
                                </div>
                                <div className="text-base font-extrabold mt-0.5" style={{ color: stagedObj.textPrimary }}>
                                    14,892
                                </div>
                                <div className="text-[9px] mt-1" style={{ color: stagedObj.textMuted }}>
                                    360° Panoramas Ingested
                                </div>
                            </div>

                            <div
                                className="p-3 rounded-xl border"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="text-[9px] uppercase tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    Quality SLA
                                </div>
                                <div className="text-base font-extrabold mt-0.5" style={{ color: stagedObj.accent }}>
                                    99.8%
                                </div>
                                <div className="text-[9px] mt-1" style={{ color: stagedObj.textMuted }}>
                                    0 Defect Flags
                                </div>
                            </div>
                        </div>

                        {/* Mock Map Viewport & Data Table */}
                        <div className="grid grid-cols-12 gap-3">
                            {/* Map Preview Graphic */}
                            <div
                                className="col-span-7 h-44 rounded-xl border relative overflow-hidden flex flex-col justify-between p-3"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between z-10">
                                    <span
                                        className="text-[9px] px-2 py-0.5 rounded font-mono font-medium border"
                                        style={{
                                            backgroundColor: `${stagedObj.bgApp}dd`,
                                            color: stagedObj.textPrimary,
                                            borderColor: stagedObj.borderSubtle
                                        }}
                                    >
                                        EPSG:4326 • 2.5531° N, 102.8131° E
                                    </span>
                                    <span
                                        className="w-2 h-2 rounded-full animate-ping"
                                        style={{ backgroundColor: stagedObj.accent }}
                                    />
                                </div>

                                {/* Simulated Trajectory Path Lines */}
                                <div className="absolute inset-0 flex items-center justify-center opacity-70 pointer-events-none">
                                    <svg className="w-full h-full" viewBox="0 0 200 120">
                                        <path
                                            d="M 10 90 Q 60 20, 110 70 T 190 30"
                                            fill="none"
                                            stroke={stagedObj.accent}
                                            strokeWidth="3.5"
                                            strokeDasharray="4 2"
                                        />
                                        <circle cx="110" cy="70" r="5" fill={stagedObj.accent} />
                                        <circle cx="190" cy="30" r="4" fill="#10b981" />
                                    </svg>
                                </div>

                                <div className="text-[9px] z-10 flex items-center justify-between" style={{ color: stagedObj.textMuted }}>
                                    <span>Basemap: {stagedObj.mapStyle}</span>
                                    <span className="font-mono text-emerald-400">● 6 Active Subgrids</span>
                                </div>
                            </div>

                            {/* Mini Table Preview */}
                            <div
                                className="col-span-5 h-44 rounded-xl border p-2.5 flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="text-[10px] font-bold pb-1.5 border-b" style={{ borderColor: stagedObj.borderSubtle, color: stagedObj.textPrimary }}>
                                    Recent Subgrid Batches
                                </div>
                                <div className="space-y-1.5 my-auto">
                                    {['N94E71', 'N93E70', 'N94E70'].map((subgrid, idx) => (
                                        <div
                                            key={subgrid}
                                            className="flex items-center justify-between text-[10px] p-1 rounded"
                                            style={{ backgroundColor: `${stagedObj.bgApp}80` }}
                                        >
                                            <span className="font-mono" style={{ color: stagedObj.textPrimary }}>{subgrid}</span>
                                            <span
                                                className="text-[9px] px-1.5 py-0.2 rounded font-semibold"
                                                style={{
                                                    backgroundColor: idx === 0 ? `${stagedObj.accent}20` : '#10b98120',
                                                    color: idx === 0 ? stagedObj.accent : '#10b981'
                                                }}
                                            >
                                                {idx === 0 ? 'In-Progress' : 'Published'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={handleApplyTheme}
                                    className="w-full py-1 rounded text-[10px] font-bold text-center transition-colors"
                                    style={{
                                        backgroundColor: stagedObj.accent,
                                        color: stagedTheme === 'nordic-light' ? '#ffffff' : '#040d1a'
                                    }}
                                >
                                    Apply {stagedObj.name}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};