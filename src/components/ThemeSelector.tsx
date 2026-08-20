import React, { useState, useEffect, useRef } from 'react';
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
    Maximize2
} from 'lucide-react';

export type ThemeKey = 'midnight' | 'obsidian' | 'graphite' | 'teal-slate' | 'daylight';

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
    accentBg: string;
    textPrimary: string;
    textMuted: string;
    mapTileUrl: string;
    mapStyle: string;
}

export const THEME_PRESETS: ThemeDefinition[] = [
    {
        id: 'midnight',
        name: 'Midnight Navy',
        badge: 'System Default',
        tagline: 'Default production theme with deep navy card layers and clear sky-blue telemetry accents.',
        bgApp: '#080e1a',
        bgCard: '#0f172a',
        innerCard: '#162138',
        borderSubtle: '#1e2e4a',
        accent: '#38bdf8',
        accentBg: 'rgba(56, 189, 248, 0.12)',
        textPrimary: '#f8fafc',
        textMuted: '#94a3b8',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        mapStyle: 'Positron Carto Light'
    },
    {
        id: 'obsidian',
        name: 'Obsidian Pure Dark',
        badge: 'OLED Contrast',
        tagline: 'Monochromatic pitch-black carbon surfaces for darkroom surveying and minimal eye fatigue.',
        bgApp: '#030305',
        bgCard: '#0a0b10',
        innerCard: '#12131a',
        borderSubtle: '#1e202c',
        accent: '#818cf8',
        accentBg: 'rgba(129, 140, 248, 0.14)',
        textPrimary: '#f8fafc',
        textMuted: '#8b949e',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        mapStyle: 'Carto Dark Matter'
    },
    {
        id: 'graphite',
        name: 'Titanium Graphite',
        badge: 'Neutral Studio',
        tagline: 'Balanced matte charcoal surfaces with soft metallic borders for technical inspection.',
        bgApp: '#121418',
        bgCard: '#181b22',
        innerCard: '#21252f',
        borderSubtle: '#2d3340',
        accent: '#cbd5e1',
        accentBg: 'rgba(203, 213, 225, 0.12)',
        textPrimary: '#f1f5f9',
        textMuted: '#94a3b8',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        mapStyle: 'Carto Voyager'
    },
    {
        id: 'teal-slate',
        name: 'Precision Teal',
        badge: 'GIS Telemetry',
        tagline: 'Cool dark maritime slate with muted teal trajectory highlights.',
        bgApp: '#030d12',
        bgCard: '#071924',
        innerCard: '#0d2737',
        borderSubtle: '#13394d',
        accent: '#14b8a6',
        accentBg: 'rgba(20, 184, 166, 0.14)',
        textPrimary: '#f0fdfa',
        textMuted: '#7ba4b8',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        mapStyle: 'Dark Telemetry'
    },
    {
        id: 'daylight',
        name: 'Daylight Clean',
        badge: 'Clean Light',
        tagline: 'Crisp high-luminance workspace with navy typography and soft borders.',
        bgApp: '#f4f6f9',
        bgCard: '#ffffff',
        innerCard: '#f8fafc',
        borderSubtle: '#e2e8f0',
        accent: '#2563eb',
        accentBg: '#eff6ff',
        textPrimary: '#0f172a',
        textMuted: '#64748b',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        mapStyle: 'Positron Clean'
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

// Leaflet Map Component
const LiveLeafletMapContainer: React.FC<{ tileUrl: string }> = ({ tileUrl }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<any>(null);
    const tileLayerRef = useRef<any>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        const L = (window as any).L;

        if (L && !mapRef.current) {
            const map = L.map(containerRef.current, {
                center: [2.55313, 102.81319],
                zoom: 14,
                zoomControl: false,
                attributionControl: false
            });

            const layer = L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
            tileLayerRef.current = layer;

            const points: [number, number][] = [
                [2.5492, 102.8120],
                [2.5501, 102.8135],
                [2.5512, 102.8148],
                [2.5520, 102.8155],
                [2.5528, 102.8164],
                [2.5535, 102.8172],
                [2.5548, 102.8190],
                [2.5560, 102.8215]
            ];

            L.polyline(points, {
                color: '#f59e0b',
                weight: 3.5,
                opacity: 0.9,
                dashArray: '4, 4'
            }).addTo(map);

            points.forEach(pt => {
                L.circleMarker(pt, {
                    radius: 4,
                    fillColor: '#f59e0b',
                    color: '#ffffff',
                    weight: 1,
                    fillOpacity: 1
                }).addTo(map);
            });

            mapRef.current = map;
        }
    }, []);

    useEffect(() => {
        if (tileLayerRef.current) {
            tileLayerRef.current.setUrl(tileUrl);
        }
    }, [tileUrl]);

    return <div ref={containerRef} className="absolute inset-0 w-full h-full z-0" />;
};

export const ThemeManagementCanvas: React.FC<ThemeCanvasProps> = ({
    cardBg = 'bg-card',
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

        window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: stagedTheme }));

        setIsSavedBanner(true);
        setTimeout(() => setIsSavedBanner(false), 3500);
    };

    const handleResetToCurrent = () => {
        setStagedTheme(activeTheme);
    };

    const stagedObj = THEME_PRESETS.find((t) => t.id === stagedTheme) || THEME_PRESETS[0];

    const totalDistance = dailyData.reduce((acc, item) => acc + (Number(item.distance) || 0), 0);
    const totalFrames = dailyData.reduce((acc, item) => acc + (Number(item.images) || 0), 0);
    const activeJobs = batchLogs.filter((b: any) => b.status === 'In Progress' || b.status === 'Ongoing').length || 3;
    const targetDistance = projectSettings?.targetDistanceKm || 315.2;
    const pctTarget = Math.min(100, (totalDistance / targetDistance) * 100).toFixed(1);

    return (
        <div className="space-y-5">
            {/* 1. Header Toolbar */}
            <div className={`p-4 rounded-xl border border-subtle ${cardBg} flex flex-wrap items-center justify-between gap-4`}>
                <div className="flex items-center gap-3">
                    <div
                        className="p-2 rounded-lg border flex items-center justify-center transition-colors"
                        style={{
                            backgroundColor: stagedObj.accentBg,
                            borderColor: `${stagedObj.accent}40`,
                            color: stagedObj.accent
                        }}
                    >
                        <Palette className="w-4 h-4" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-text-base">Theme System Engine</h3>
                        <p className="text-xs text-text-muted mt-0.5">
                            Select a palette to inspect typography contrast, basemap rendering, and dashboard density.
                        </p>
                    </div>
                </div>

                {/* Global Save Action */}
                <div className="flex items-center gap-3">
                    {isSavedBanner && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Theme Applied
                        </div>
                    )}
                    <button
                        onClick={handleApplyTheme}
                        disabled={stagedTheme === activeTheme && !isSavedBanner}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${stagedTheme !== activeTheme
                                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm cursor-pointer'
                                : 'bg-inner text-text-muted cursor-not-allowed border border-subtle'
                            }`}
                    >
                        <Check className="w-3.5 h-3.5" />
                        Apply Theme Changes
                    </button>
                </div>
            </div>

            {/* 2. Workspace Columns */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                {/* Left Column: Subtle Theme Cards */}
                <div className="xl:col-span-4 space-y-2.5">
                    <div className="flex items-center justify-between px-1">
                        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                            <Sliders className="w-3 h-3 text-text-muted" />
                            Available Themes
                        </div>
                        <button
                            onClick={handleResetToCurrent}
                            disabled={stagedTheme === activeTheme}
                            className="text-[11px] text-text-muted hover:text-text-base disabled:opacity-30 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                            <RotateCcw className="w-2.5 h-2.5" />
                            Reset
                        </button>
                    </div>

                    <div className="space-y-2">
                        {THEME_PRESETS.map((preset) => {
                            const isStaged = stagedTheme === preset.id;
                            const isCurrentlyActive = activeTheme === preset.id;

                            return (
                                <div
                                    key={preset.id}
                                    onClick={() => handleSelectPreset(preset.id)}
                                    className={`p-3 rounded-lg border transition-all cursor-pointer ${isStaged
                                            ? 'border-blue-500 bg-inner shadow-sm ring-1 ring-blue-500/40'
                                            : 'border-subtle bg-card hover:border-slate-500'
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2.5">
                                            <div
                                                className="w-5 h-5 rounded border mt-0.5 shrink-0 flex items-center justify-center"
                                                style={{
                                                    backgroundColor: preset.bgCard,
                                                    borderColor: isStaged ? preset.accent : preset.borderSubtle
                                                }}
                                            >
                                                <span
                                                    className="w-2 h-2 rounded-full"
                                                    style={{ backgroundColor: preset.accent }}
                                                />
                                            </div>

                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h4 className="text-xs font-semibold text-text-base">{preset.name}</h4>
                                                    <span
                                                        className="text-[9px] px-1.5 py-0.2 rounded font-mono border"
                                                        style={{
                                                            backgroundColor: preset.accentBg,
                                                            color: preset.accent,
                                                            borderColor: `${preset.accent}30`
                                                        }}
                                                    >
                                                        {preset.badge}
                                                    </span>
                                                    {isCurrentlyActive && (
                                                        <span className="text-[9px] text-emerald-400 font-medium font-mono">
                                                            (Active)
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{preset.tagline}</p>
                                            </div>
                                        </div>

                                        {isStaged && (
                                            <span
                                                className="text-[9px] px-1.5 py-0.5 rounded border font-medium shrink-0"
                                                style={{
                                                    backgroundColor: preset.accentBg,
                                                    color: preset.accent,
                                                    borderColor: `${preset.accent}40`
                                                }}
                                            >
                                                Previewing
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right Column: Live Dashboard Viewport */}
                <div className="xl:col-span-8 space-y-2">
                    <div className="flex items-center justify-between px-1">
                        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stagedObj.accent }} />
                            Live Dashboard Preview
                        </div>
                        <span
                            className="text-[10px] px-2 py-0.5 rounded border font-mono"
                            style={{
                                backgroundColor: stagedObj.accentBg,
                                color: stagedObj.accent,
                                borderColor: `${stagedObj.accent}30`
                            }}
                        >
                            Theme: {stagedObj.name}
                        </span>
                    </div>

                    {/* Staged Scope Container */}
                    <div
                        data-theme={stagedTheme}
                        className="p-3.5 rounded-xl border transition-all duration-200 space-y-3 shadow-sm"
                        style={{
                            backgroundColor: stagedObj.bgApp,
                            borderColor: stagedObj.borderSubtle,
                            color: stagedObj.textPrimary
                        }}
                    >
                        {/* 1. App Header */}
                        <div
                            className="px-3 py-2 rounded-lg border flex items-center justify-between"
                            style={{
                                backgroundColor: stagedObj.bgCard,
                                borderColor: stagedObj.borderSubtle
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-6 h-6 rounded flex items-center justify-center text-white text-[11px]"
                                    style={{ backgroundColor: stagedObj.accent }}
                                >
                                    <Layers className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                    <div className="text-xs font-semibold tracking-tight" style={{ color: stagedObj.textPrimary }}>
                                        Mobile Mapping Data Management System
                                    </div>
                                    <div className="text-[9px]" style={{ color: stagedObj.textMuted }}>
                                        Spatial Trajectory Processing & QA Pipeline
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 2. 4 KPI Metrics */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div
                                className="p-2.5 rounded-lg border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[8.5px] uppercase font-semibold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>DISTANCE MAPPED</span>
                                    <Navigation className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-0.5 flex items-baseline gap-1">
                                    <span className="text-sm font-bold" style={{ color: stagedObj.textPrimary }}>
                                        {totalDistance.toFixed(1)} km
                                    </span>
                                    <span className="text-[8px] font-mono" style={{ color: stagedObj.accent }}>
                                        ({pctTarget}%)
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>Target: {targetDistance} km</div>
                            </div>

                            <div
                                className="p-2.5 rounded-lg border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[8.5px] uppercase font-semibold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>PROCESSED FRAMES</span>
                                    <Camera className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-0.5">
                                    <span className="text-sm font-bold" style={{ color: stagedObj.textPrimary }}>
                                        {totalFrames.toLocaleString()}
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>360° Images Ingested</div>
                            </div>

                            <div
                                className="p-2.5 rounded-lg border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[8.5px] uppercase font-semibold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>ACTIVE JOBS</span>
                                    <Layers className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-0.5">
                                    <span className="text-sm font-bold" style={{ color: stagedObj.textPrimary }}>
                                        {activeJobs} Active
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>Subgrid Stitching</div>
                            </div>

                            <div
                                className="p-2.5 rounded-lg border flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[8.5px] uppercase font-semibold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>QUALITY SLA</span>
                                    <Activity className="w-3 h-3 text-emerald-400" />
                                </div>
                                <div className="my-0.5">
                                    <span className="text-sm font-bold text-emerald-400">
                                        100.0%
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>0 Defect Flags</div>
                            </div>
                        </div>

                        {/* 3. Map & Data Columns */}
                        <div className="grid grid-cols-12 gap-2.5">
                            {/* Live Leaflet Map */}
                            <div
                                className="col-span-12 lg:col-span-7 h-80 rounded-lg border relative overflow-hidden flex flex-col justify-between"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <LiveLeafletMapContainer tileUrl={stagedObj.mapTileUrl} />

                                {/* Map Floating Bar */}
                                <div className="p-2.5 flex items-center justify-between z-10 pointer-events-none">
                                    <div
                                        className="px-2 py-1 rounded border backdrop-blur-md flex items-center gap-1.5 pointer-events-auto"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}f0`,
                                            borderColor: stagedObj.borderSubtle
                                        }}
                                    >
                                        <div className="text-[9px] font-semibold" style={{ color: stagedObj.textPrimary }}>
                                            GeoSphere 360 Hub
                                        </div>
                                        <span className="text-[8px] font-medium" style={{ color: stagedObj.accent }}>• WebGIS</span>
                                    </div>

                                    <div className="flex items-center gap-1 pointer-events-auto">
                                        <button
                                            className="p-1 rounded border"
                                            style={{
                                                backgroundColor: stagedObj.innerCard,
                                                borderColor: stagedObj.borderSubtle,
                                                color: stagedObj.textMuted
                                            }}
                                        >
                                            <Search className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {/* Map Bottom Status */}
                                <div className="p-2.5 flex items-center justify-between z-10 pointer-events-none text-[8px] font-mono">
                                    <span
                                        className="px-2 py-0.5 rounded border pointer-events-auto"
                                        style={{
                                            backgroundColor: `${stagedObj.bgCard}f0`,
                                            borderColor: stagedObj.borderSubtle,
                                            color: stagedObj.textMuted
                                        }}
                                    >
                                        EPSG:4326 • 2.55288° N, 102.81641° E
                                    </span>
                                </div>
                            </div>

                            {/* Processing Control & 360 QA */}
                            <div className="col-span-12 lg:col-span-5 flex flex-col gap-2">
                                {/* Table */}
                                <div
                                    className="p-2.5 rounded-lg border flex-1 flex flex-col justify-between"
                                    style={{
                                        backgroundColor: stagedObj.bgCard,
                                        borderColor: stagedObj.borderSubtle
                                    }}
                                >
                                    <div>
                                        <div className="flex items-center justify-between pb-1.5 border-b" style={{ borderColor: stagedObj.borderSubtle }}>
                                            <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: stagedObj.textPrimary }}>
                                                Processing Admin
                                            </span>
                                            <span className="text-[8px] font-mono" style={{ color: stagedObj.textMuted }}>
                                                {dailyData.length || 3} Batches
                                            </span>
                                        </div>

                                        <div className="space-y-1 my-1 text-[8px]">
                                            {[
                                                { subgrid: 'N93E70', img: '0 frames', status: 'Ongoing' },
                                                { subgrid: 'N94E70', img: '0 frames', status: 'Ongoing' },
                                                { subgrid: 'N94E71', img: '0 frames', status: 'Ongoing' }
                                            ].map((row, idx) => (
                                                <div
                                                    key={idx}
                                                    className="flex items-center justify-between p-1.5 rounded"
                                                    style={{
                                                        backgroundColor: stagedObj.innerCard
                                                    }}
                                                >
                                                    <span className="font-mono font-medium" style={{ color: stagedObj.textPrimary }}>{row.subgrid}</span>
                                                    <span style={{ color: stagedObj.textMuted }}>{row.img}</span>
                                                    <span className="font-medium text-amber-500">{row.status}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-1 border-t flex items-center justify-between text-[7.5px]" style={{ borderColor: stagedObj.borderSubtle, color: stagedObj.textMuted }}>
                                        <span>Pipeline Status</span>
                                        <span className="font-mono text-emerald-500">Operational</span>
                                    </div>
                                </div>

                                {/* 360 QA Box */}
                                <div
                                    className="p-2.5 rounded-lg border flex items-center justify-between"
                                    style={{
                                        backgroundColor: stagedObj.bgCard,
                                        borderColor: stagedObj.borderSubtle
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        <Camera className="w-3.5 h-3.5" style={{ color: stagedObj.accent }} />
                                        <div>
                                            <div className="text-[8.5px] font-semibold" style={{ color: stagedObj.textPrimary }}>
                                                360 View & QA Inspector
                                            </div>
                                            <div className="text-[7.5px]" style={{ color: stagedObj.textMuted }}>
                                                Select node on map to inspect frame
                                            </div>
                                        </div>
                                    </div>
                                    <Maximize2 className="w-3.5 h-3.5" style={{ color: stagedObj.textMuted }} />
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
};