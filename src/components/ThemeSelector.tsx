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
    Maximize2,
    RectangleHorizontal,
    LayoutGrid,
    LayoutTemplate,
    Columns3
} from 'lucide-react';

export type ThemeKey =
    | 'graphite'
    | 'monochrome'
    | 'neumorph-dark'
    | 'geodetic-sage'
    | 'naval-steel'
    | 'industrial-basalt'
    | 'alabaster'
    | 'daylight'
    | 'neumorph-clay';

export const resolveThemeKey = (value: unknown): ThemeKey => {
    switch (value) {
        case 'monochrome':
        case 'obsidian':
            return 'monochrome';
        case 'neumorph-dark':
            return 'neumorph-dark';
        case 'geodetic-sage':
            return 'geodetic-sage';
        case 'naval-steel':
        case 'midnight':
            return 'naval-steel';
        case 'industrial-basalt':
            return 'industrial-basalt';
        case 'alabaster':
            return 'alabaster';
        case 'daylight':
            return 'daylight';
        case 'neumorph-clay':
            return 'neumorph-clay';
        case 'teal-slate':
            return 'geodetic-sage';
        default:
            return 'graphite';
    }
};

export interface ThemeDefinition {
    id: ThemeKey;
    mode: 'light' | 'dark';
    name: string;
    badge: string;
    tagline: string;
    bgApp: string;
    bgCard: string;
    innerCard: string;
    borderSubtle: string;
    accent: string;
    accentBg: string;
    accentForeground: string;
    textPrimary: string;
    textMuted: string;
    mapTileUrl: string;
    mapStyle: string;
}

export const isLightTheme = (value: unknown): boolean =>
    THEME_PRESETS.find((theme) => theme.id === resolveThemeKey(value))?.mode === 'light';

export const THEME_PRESETS: ThemeDefinition[] = [
    {
        id: 'graphite',
        mode: 'dark',
        name: 'Titanium Graphite',
        badge: 'Soft Graphite',
        tagline: 'Quiet graphite surfaces with a softened mint-teal accent for focused GIS work.',
        bgApp: '#14191D',
        bgCard: '#1A2125',
        innerCard: '#222B30',
        borderSubtle: '#303B40',
        accent: '#7CBBAE',
        accentBg: 'rgba(124, 187, 174, 0.12)',
        accentForeground: '#17211F',
        textPrimary: '#EEF2F1',
        textMuted: '#9BAAA9',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        mapStyle: 'Muted Dark'
    },
    {
        id: 'monochrome',
        mode: 'light',
        name: 'Monochrome Slate',
        badge: 'Soft Light',
        tagline: 'A calm, light slate canvas with gentle blue-gray contrast and a muted teal accent.',
        bgApp: '#F1F4F2',
        bgCard: '#FAFBF9',
        innerCard: '#E8EEEA',
        borderSubtle: '#D3DDD8',
        accent: '#5B7880',
        accentBg: 'rgba(91, 120, 128, 0.12)',
        accentForeground: '#F9FBFA',
        textPrimary: '#263330',
        textMuted: '#64736F',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        mapStyle: 'Muted Light'
    },
    {
        id: 'neumorph-dark',
        mode: 'dark',
        name: 'Neumorph Cyber Dark',
        badge: 'Soft UI Dark',
        tagline: 'Soft charcoal depth with restrained mint-teal highlights instead of neon color.',
        bgApp: '#20252A',
        bgCard: '#20252A',
        innerCard: '#191F23',
        borderSubtle: '#323B40',
        accent: '#83BFAF',
        accentBg: 'rgba(131, 191, 175, 0.13)',
        accentForeground: '#17211F',
        textPrimary: '#EDF2F0',
        textMuted: '#9AA8A5',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        mapStyle: 'Muted Dark'
    },
    {
        id: 'geodetic-sage',
        mode: 'dark',
        name: 'Geodetic Sage',
        badge: 'Field Survey',
        tagline: 'Deep botanical slate with soft sage and mint tones for field-survey work.',
        bgApp: '#151D1A',
        bgCard: '#1C2722',
        innerCard: '#26342D',
        borderSubtle: '#37473F',
        accent: '#9AB58D',
        accentBg: 'rgba(154, 181, 141, 0.13)',
        accentForeground: '#1C281F',
        textPrimary: '#EEF2EC',
        textMuted: '#A0ADA0',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        mapStyle: 'Muted Topographic'
    },
    {
        id: 'naval-steel',
        mode: 'dark',
        name: 'Naval Steel',
        badge: 'Cool Slate',
        tagline: 'Cool steel-blue graphite with softened blue and teal highlights.',
        bgApp: '#171D22',
        bgCard: '#1D252B',
        innerCard: '#273239',
        borderSubtle: '#37464D',
        accent: '#8EAFB9',
        accentBg: 'rgba(142, 175, 185, 0.13)',
        accentForeground: '#182226',
        textPrimary: '#EEF2F2',
        textMuted: '#9EACB0',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        mapStyle: 'Muted Dark Steel'
    },
    {
        id: 'industrial-basalt',
        mode: 'dark',
        name: 'Industrial Basalt',
        badge: 'Earthy Dark',
        tagline: 'Warm basalt surfaces with quiet sand, ochre, and dusty-coral accents.',
        bgApp: '#211D19',
        bgCard: '#28231E',
        innerCard: '#342E27',
        borderSubtle: '#494138',
        accent: '#D2AD75',
        accentBg: 'rgba(210, 173, 117, 0.14)',
        accentForeground: '#30271D',
        textPrimary: '#F2EEE8',
        textMuted: '#B1A79A',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        mapStyle: 'Muted Basalt'
    },
    {
        id: 'alabaster',
        mode: 'light',
        name: 'Alabaster Warm Light',
        badge: 'Warm Paper',
        tagline: 'Soft cream canvas, warm stone panels, and muted earthy accents.',
        bgApp: '#F5F1EA',
        bgCard: '#FCFAF6',
        innerCard: '#ECE7DE',
        borderSubtle: '#DDD3C4',
        accent: '#947F66',
        accentBg: 'rgba(148, 127, 102, 0.12)',
        accentForeground: '#FFFCF7',
        textPrimary: '#302D28',
        textMuted: '#71695E',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        mapStyle: 'Warm Light'
    },
    {
        id: 'daylight',
        mode: 'light',
        name: 'Daylight Clean',
        badge: 'Cool Light',
        tagline: 'A clear mist-gray canvas with gentle blue-green accents and crisp text.',
        bgApp: '#F3F6F7',
        bgCard: '#FBFCFC',
        innerCard: '#E7EEF0',
        borderSubtle: '#D4E0E3',
        accent: '#648C95',
        accentBg: 'rgba(100, 140, 149, 0.12)',
        accentForeground: '#F9FCFC',
        textPrimary: '#263438',
        textMuted: '#627277',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        mapStyle: 'Muted Light'
    },
    {
        id: 'neumorph-clay',
        mode: 'light',
        name: 'Neumorph Soft Clay',
        badge: 'Soft UI Light',
        tagline: 'Soft clay-gray surfaces with gentle bevels and subdued lavender-blue accents.',
        bgApp: '#E7EBEF',
        bgCard: '#E7EBEF',
        innerCard: '#DDE3E8',
        borderSubtle: '#CDD5DD',
        accent: '#687E97',
        accentBg: 'rgba(104, 126, 151, 0.13)',
        accentForeground: '#F8FAFC',
        textPrimary: '#2A333C',
        textMuted: '#65727D',
        mapTileUrl: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        mapStyle: 'Soft Clay Light'
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

const DotOption: React.FC<{ label: string; selected: boolean; onSelect: () => void }> = ({ label, selected, onSelect }) => (
    <button type="button" onClick={onSelect} className="group flex items-center gap-1.5 cursor-pointer">
        <span className={`w-3 h-3 rounded-full border flex items-center justify-center transition-colors ${
            selected ? 'bg-accent border-accent' : 'border-subtle group-hover:border-slate-500'
        }`}>
            {selected && <Check className="w-2 h-2" strokeWidth={4} style={{ color: 'var(--accent-foreground)' }} />}
        </span>
        <span className={`text-[10px] transition-colors ${selected ? 'font-medium text-text-base' : 'text-text-muted group-hover:text-text-base'}`}>
            {label}
        </span>
    </button>
);

export const ThemeManagementCanvas: React.FC<ThemeCanvasProps> = ({
    cardBg = 'bg-card',
    dailyData = [],
    batchLogs = [],
    projectSettings
}) => {
    const [stagedTheme, setStagedTheme] = useState<ThemeKey>('graphite');
    const [activeTheme, setActiveTheme] = useState<ThemeKey>('graphite');
    const [isSavedBanner, setIsSavedBanner] = useState(false);

    // ── Style Widget State ──
    type RadiusKey = 'sharp' | 'default' | 'rounded' | 'pill';
    type DensityKey = 'compact' | 'default' | 'spacious';
    type SplitKey = 'map-focus' | 'balanced' | 'panel-focus';
    type SurfaceKey = 'card' | 'flat' | 'neumorphism';

    const SURFACE_OPTIONS: { key: SurfaceKey; label: string }[] = [
        { key: 'card', label: 'Card' },
        { key: 'flat', label: 'Flat' },
        { key: 'neumorphism', label: 'Neumorphism' }
    ];

    const RADIUS_OPTIONS: { key: RadiusKey; label: string; value: string }[] = [
        { key: 'sharp',   label: 'Sharp',   value: '4px' },
        { key: 'default', label: 'Default', value: '12px' },
        { key: 'rounded', label: 'Rounded', value: '16px' },
        { key: 'pill',    label: 'Pill',    value: '24px' }
    ];
    const DENSITY_OPTIONS: { key: DensityKey; label: string; gap: string; padding: string }[] = [
        { key: 'compact',  label: 'Compact',   gap: '8px',  padding: '10px' },
        { key: 'default',  label: 'Default',   gap: '12px', padding: '14px' },
        { key: 'spacious', label: 'Spacious',  gap: '16px', padding: '18px' }
    ];
    const SPLIT_OPTIONS: { key: SplitKey; label: string; mapCols: string; panelCols: string }[] = [
        { key: 'map-focus',   label: 'Map Focus',    mapCols: '8', panelCols: '4' },
        { key: 'balanced',    label: 'Balanced',     mapCols: '7', panelCols: '5' },
        { key: 'panel-focus', label: 'Panel Focus',  mapCols: '6', panelCols: '6' }
    ];

    const [cardRadius, setCardRadius] = useState<RadiusKey>('default');
    const [uiDensity, setUiDensity] = useState<DensityKey>('default');
    const [mapSplit, setMapSplit]   = useState<SplitKey>('balanced');
    const [surfaceStyle, setSurfaceStyle] = useState<SurfaceKey>('card');

    // Apply CSS custom properties to :root for global cascade
    const applyStyleWidgets = (radius: RadiusKey, density: DensityKey, split: SplitKey, surface: SurfaceKey) => {
        const root = document.documentElement;
        const r = RADIUS_OPTIONS.find(o => o.key === radius) || RADIUS_OPTIONS[1];
        const d = DENSITY_OPTIONS.find(o => o.key === density) || DENSITY_OPTIONS[1];
        const s = SPLIT_OPTIONS.find(o => o.key === split) || SPLIT_OPTIONS[1];
        root.style.setProperty('--card-radius', r.value);
        root.style.setProperty('--ui-gap', d.gap);
        root.style.setProperty('--ui-padding', d.padding);
        root.style.setProperty('--map-cols', s.mapCols);
        root.style.setProperty('--panel-cols', s.panelCols);
        root.setAttribute('data-surface', surface);
    };

    useEffect(() => {
        const saved = resolveThemeKey(localStorage.getItem('app_dashboard_theme'));
        setActiveTheme(saved);
        setStagedTheme(saved);

        // Restore style widget state
        const savedRadius = (localStorage.getItem('app_style_radius') as RadiusKey) || 'default';
        const savedDensity = (localStorage.getItem('app_style_density') as DensityKey) || 'default';
        const savedSplit = (localStorage.getItem('app_style_split') as SplitKey) || 'balanced';
        const savedSurface = (localStorage.getItem('app_style_surface') as SurfaceKey) || 'card';
        setCardRadius(savedRadius);
        setUiDensity(savedDensity);
        setMapSplit(savedSplit);
        setSurfaceStyle(savedSurface);
        applyStyleWidgets(savedRadius, savedDensity, savedSplit, savedSurface);
    }, []);

    const handleSelectPreset = (id: ThemeKey) => {
        setStagedTheme(id);
        setIsSavedBanner(false);
    };

    const handleApplyTheme = () => {
        setActiveTheme(stagedTheme);
        document.documentElement.setAttribute('data-theme', stagedTheme);
        document.documentElement.classList.toggle('light-mode', isLightTheme(stagedTheme));
        try {
            localStorage.setItem('app_dashboard_theme', stagedTheme);
            // Persist style widgets
            localStorage.setItem('app_style_radius', cardRadius);
            localStorage.setItem('app_style_density', uiDensity);
            localStorage.setItem('app_style_split', mapSplit);
            localStorage.setItem('app_style_surface', surfaceStyle);
        } catch { }

        applyStyleWidgets(cardRadius, uiDensity, mapSplit, surfaceStyle);
        window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: stagedTheme }));
        window.dispatchEvent(new CustomEvent('app-style-changed', {
            detail: { radius: cardRadius, density: uiDensity, split: mapSplit, surface: surfaceStyle }
        }));

        setIsSavedBanner(true);
        setTimeout(() => setIsSavedBanner(false), 3500);
    };

    const handleResetToCurrent = () => {
        setStagedTheme(activeTheme);
        // Reset style widgets to saved
        const savedRadius = (localStorage.getItem('app_style_radius') as RadiusKey) || 'default';
        const savedDensity = (localStorage.getItem('app_style_density') as DensityKey) || 'default';
        const savedSplit = (localStorage.getItem('app_style_split') as SplitKey) || 'balanced';
        const savedSurface = (localStorage.getItem('app_style_surface') as SurfaceKey) || 'card';
        setCardRadius(savedRadius);
        setUiDensity(savedDensity);
        setMapSplit(savedSplit);
        setSurfaceStyle(savedSurface);
        applyStyleWidgets(savedRadius, savedDensity, savedSplit, savedSurface);
    };

    const isStyleDirty =
        cardRadius !== ((localStorage.getItem('app_style_radius') as RadiusKey) || 'default') ||
        uiDensity !== ((localStorage.getItem('app_style_density') as DensityKey) || 'default') ||
        mapSplit !== ((localStorage.getItem('app_style_split') as SplitKey) || 'balanced') ||
        surfaceStyle !== ((localStorage.getItem('app_style_surface') as SurfaceKey) || 'card');

    const stagedObj = THEME_PRESETS.find((t) => t.id === stagedTheme) || THEME_PRESETS[0];

    // Staged style-widget tokens — previewed live inside the sandbox before Apply
    const stagedRadiusValue = RADIUS_OPTIONS.find(o => o.key === cardRadius)?.value || '12px';
    const stagedDensity = DENSITY_OPTIONS.find(o => o.key === uiDensity) || DENSITY_OPTIONS[1];

    const totalDistance = dailyData.reduce((acc, item) => acc + (Number(item.kmProcessed || item.distance) || 0), 0);
    const totalFrames = dailyData.reduce((acc, item) => acc + (Number(item.availableImagesCount || item.panoramas?.length || item.imagesProcessed || item.images) || 0), 0);
    const totalDefects = dailyData.reduce((acc, item) => acc + (Number(item.imagesDefected || item.defectCount) || 0), 0);
    const activeJobs = batchLogs.filter((b: any) => b.status === 'In Progress' || b.status === 'Ongoing').length;
    const targetDistance = Number(projectSettings?.targetKm) || Number(projectSettings?.targetDistanceKm) || (totalDistance > 0 ? totalDistance : 0);
    const pctTarget = targetDistance > 0 ? Math.min(100, (totalDistance / targetDistance) * 100).toFixed(1) : '0.0';
    const qualitySlaPercent = totalFrames > 0
        ? Math.max(0, ((totalFrames - totalDefects) / totalFrames) * 100).toFixed(1)
        : '100.0';

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
                        <div
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                            style={{
                                backgroundColor: 'color-mix(in srgb, var(--palette-sage) 12%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--palette-sage) 30%, transparent)',
                                color: 'var(--palette-sage)'
                            }}
                        >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Theme Applied
                        </div>
                    )}
                    <button
                        onClick={handleApplyTheme}
                        disabled={(stagedTheme === activeTheme && !isStyleDirty) && !isSavedBanner}
                        style={stagedTheme !== activeTheme || isStyleDirty ? { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' } : undefined}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${stagedTheme !== activeTheme || isStyleDirty
                            ? 'opacity-95 hover:opacity-100 shadow-sm cursor-pointer'
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
                            disabled={stagedTheme === activeTheme && !isStyleDirty}
                            className="text-[11px] text-text-muted hover:text-text-base disabled:opacity-30 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                            <RotateCcw className="w-2.5 h-2.5" />
                            Reset
                        </button>
                    </div>

                    <div className="flex flex-col gap-2.5">
                        {THEME_PRESETS.map((preset) => {
                            const isStaged = stagedTheme === preset.id;
                            const isCurrentlyActive = activeTheme === preset.id;

                            return (
                                <button
                                    type="button"
                                    key={preset.id}
                                    onClick={() => handleSelectPreset(preset.id)}
                                    className={`w-full group flex items-center gap-3 px-3.5 py-2.5 rounded-xl cursor-pointer select-none text-left transition-all duration-150 ${
                                        isStaged
                                            ? 'bg-inner border border-subtle/80 shadow-xs'
                                            : 'border border-transparent hover:bg-inner/60 hover:border-subtle/40'
                                    }`}
                                >
                                    <span
                                        className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all ${
                                            isStaged
                                                ? 'shadow-xs border-0'
                                                : 'border'
                                        }`}
                                        style={{
                                            backgroundColor: isStaged ? preset.accent : 'transparent',
                                            borderColor: isStaged ? preset.accent : `${preset.borderSubtle}`
                                        }}
                                    >
                                        {isStaged ? (
                                            <Check className="w-2.5 h-2.5" strokeWidth={3.5} style={{ color: preset.accentForeground }} />
                                        ) : (
                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: preset.accent }} />
                                        )}
                                    </span>

                                    <h4 className={`text-xs truncate ${isStaged ? 'font-semibold text-text-base' : 'font-medium text-text-muted group-hover:text-text-base'}`}>
                                        {preset.name}
                                    </h4>

                                    <span className="ml-auto flex items-center gap-2 shrink-0">
                                        {isCurrentlyActive && !isStaged && (
                                            <span className="text-[9px] font-medium" style={{ color: 'var(--palette-sage)' }}>Active</span>
                                        )}
                                        {isStaged && !isCurrentlyActive && (
                                            <span className="text-[9px] text-text-muted">Previewing</span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* ── Style Widgets ── */}
                    <div className="mt-4 pt-3 border-t border-subtle space-y-3">
                        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 px-1">
                            <Sliders className="w-3 h-3 text-text-muted" />
                            Style Overrides
                        </div>

                        {/* Widget 1: Surface Style */}
                        <div className="px-1 space-y-1.5">
                            <div className="flex items-center gap-2">
                                <LayoutTemplate className="w-3.5 h-3.5 text-text-muted" />
                                <span className="text-[11px] font-semibold text-text-base">Surface Style</span>
                            </div>
                            <div className="flex items-center flex-wrap gap-x-3.5 gap-y-1">
                                {SURFACE_OPTIONS.map((opt) => (
                                    <DotOption
                                        key={opt.key}
                                        label={opt.label}
                                        selected={surfaceStyle === opt.key}
                                        onSelect={() => {
                                            setSurfaceStyle(opt.key);
                                            applyStyleWidgets(cardRadius, uiDensity, mapSplit, opt.key);
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Widget 2: Card Radius */}
                        <div className="px-1 pt-3 border-t border-subtle space-y-1.5">
                            <div className="flex items-center gap-2">
                                <RectangleHorizontal className="w-3.5 h-3.5 text-text-muted" />
                                <span className="text-[11px] font-semibold text-text-base">Card Radius</span>
                            </div>
                            <div className="flex items-center flex-wrap gap-x-3.5 gap-y-1">
                                {RADIUS_OPTIONS.map((opt) => (
                                    <DotOption
                                        key={opt.key}
                                        label={opt.label}
                                        selected={cardRadius === opt.key}
                                        onSelect={() => {
                                            setCardRadius(opt.key);
                                            applyStyleWidgets(opt.key, uiDensity, mapSplit, surfaceStyle);
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Widget 3: UI Density */}
                        <div className="px-1 pt-3 border-t border-subtle space-y-1.5">
                            <div className="flex items-center gap-2">
                                <LayoutGrid className="w-3.5 h-3.5 text-text-muted" />
                                <span className="text-[11px] font-semibold text-text-base">UI Density</span>
                            </div>
                            <div className="flex items-center flex-wrap gap-x-3.5 gap-y-1">
                                {DENSITY_OPTIONS.map((opt) => (
                                    <DotOption
                                        key={opt.key}
                                        label={opt.label}
                                        selected={uiDensity === opt.key}
                                        onSelect={() => {
                                            setUiDensity(opt.key);
                                            applyStyleWidgets(cardRadius, opt.key, mapSplit, surfaceStyle);
                                        }}
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Widget 4: Map–Panel Split */}
                        <div className="px-1 pt-3 border-t border-subtle space-y-1.5">
                            <div className="flex items-center gap-2">
                                <Columns3 className="w-3.5 h-3.5 text-text-muted" />
                                <span className="text-[11px] font-semibold text-text-base">Map–Panel Split</span>
                            </div>
                            <div className="flex items-center flex-wrap gap-x-3.5 gap-y-1">
                                {SPLIT_OPTIONS.map((opt) => (
                                    <DotOption
                                        key={opt.key}
                                        label={opt.label}
                                        selected={mapSplit === opt.key}
                                        onSelect={() => {
                                            setMapSplit(opt.key);
                                            applyStyleWidgets(cardRadius, uiDensity, opt.key, surfaceStyle);
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Live Dashboard Viewport */}
                <div className="xl:col-span-8 space-y-2">
                    <div className="flex items-center justify-between px-1">
                        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stagedObj.accent }} />
                            Dashboard Preview
                        </div>
                    </div>

                    {/* Staged Sandbox Container */}
                    <div
                        data-theme={stagedTheme}
                        data-surface={surfaceStyle}
                        className={`p-3.5 rounded-xl border transition-all duration-200 space-y-3 shadow-sm staged-sandbox ${isLightTheme(stagedTheme) ? 'light-mode' : ''}`}
                        style={{
                            backgroundColor: stagedObj.bgApp,
                            borderColor: stagedObj.borderSubtle,
                            color: stagedObj.textPrimary,
                            '--card-radius': stagedRadiusValue,
                            '--ui-gap': stagedDensity.gap,
                            '--ui-padding': stagedDensity.padding
                        } as React.CSSProperties}
                    >
                    <div className="dashboard-density-grid flex flex-col">
                        {/* 1. Header Bar Simulation */}
                        <div
                            className="p-3.5 rounded-xl border flex items-center justify-between style-radius style-surface dashboard-density-pad"
                            style={{
                                backgroundColor: stagedObj.bgCard,
                                borderColor: stagedObj.borderSubtle
                            }}
                        >
                            <div className="flex items-center gap-2.5">
                                <div
                                    className="w-6 h-6 rounded flex items-center justify-center text-[11px]"
                                    style={{ backgroundColor: stagedObj.accent, color: stagedObj.accentForeground }}
                                >
                                    <Layers className="w-3.5 h-3.5" />
                                </div>
                                <div>
                                    <span className="text-xs font-bold block" style={{ color: stagedObj.textPrimary }}>
                                        {projectSettings?.projectName || 'GeoSphere 360 Operations Hub'}
                                    </span>
                                    <span className="text-[10px] block" style={{ color: stagedObj.textMuted }}>
                                        Contract: {projectSettings?.contractCode || 'MMS-2026-TNB-01'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* 2. Mini KPI Cards Row */}
                        <div className="dashboard-density-grid grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div
                                className="p-2.5 rounded-lg border flex flex-col justify-between style-radius style-surface dashboard-density-pad"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[8.5px] uppercase font-semibold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>SURVEY PROGRESS</span>
                                    <Navigation className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-0.5">
                                    <span className="text-sm font-bold" style={{ color: stagedObj.textPrimary }}>
                                        {totalDistance.toFixed(1)} km
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>{pctTarget}% of Target</div>
                            </div>

                            <div
                                className="p-2.5 rounded-lg border flex flex-col justify-between style-radius style-surface dashboard-density-pad"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[8.5px] uppercase font-semibold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>PANORAMAS</span>
                                    <Camera className="w-3 h-3" style={{ color: stagedObj.accent }} />
                                </div>
                                <div className="my-0.5">
                                    <span className="text-sm font-bold" style={{ color: stagedObj.textPrimary }}>
                                        {totalFrames.toLocaleString()}
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>Images Processed</div>
                            </div>

                            <div
                                className="p-2.5 rounded-lg border flex flex-col justify-between style-radius style-surface dashboard-density-pad"
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
                                className="p-2.5 rounded-lg border flex flex-col justify-between style-radius style-surface dashboard-density-pad"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="flex items-center justify-between text-[8.5px] uppercase font-semibold tracking-wider" style={{ color: stagedObj.textMuted }}>
                                    <span>QUALITY SLA</span>
                                    <Activity className="w-3 h-3" style={{ color: 'var(--palette-sage)' }} />
                                </div>
                                <div className="my-0.5">
                                    <span className="text-sm font-bold" style={{ color: 'var(--palette-sage)' }}>
                                        {qualitySlaPercent}%
                                    </span>
                                </div>
                                <div className="text-[8px]" style={{ color: stagedObj.textMuted }}>{totalDefects} Defect Flags</div>
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 px-0.5" aria-label="Theme accent palette">
                            {['--palette-mint', '--palette-sage', '--palette-butter', '--palette-coral', '--palette-lavender', '--palette-slateblue'].map((token) => (
                                <span key={token} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: `var(${token})` }} />
                            ))}
                        </div>

                        {/* 3. Map & Data Columns */}
                        <div data-split={mapSplit} className="dashboard-split-grid dashboard-density-grid grid grid-cols-12 gap-2.5">
                            {/* Live Leaflet Map */}
                            <div
                                className="map-column col-span-12 lg:col-span-7 h-80 rounded-lg border relative overflow-hidden flex flex-col justify-between style-radius style-surface"
                                style={{
                                    backgroundColor: stagedObj.bgCard,
                                    borderColor: stagedObj.borderSubtle
                                }}
                            >
                                <div className="absolute inset-0" style={{ backgroundColor: stagedObj.innerCard }} />

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
                                <div className="p-2.5 flex items-center justify-between z-10 pointer-events-none text-[8px] font-sans">
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
                            <div className="panel-column col-span-12 lg:col-span-5 flex flex-col gap-2 dashboard-density-grid">
                                {/* Table */}
                                <div
                                    className="p-2.5 rounded-lg border flex-1 flex flex-col min-h-0 style-radius style-surface dashboard-density-pad"
                                    style={{
                                        backgroundColor: stagedObj.bgCard,
                                        borderColor: stagedObj.borderSubtle
                                    }}
                                >
                                    <div className="flex-1 flex flex-col min-h-0">
                                        <div className="flex items-center justify-between pb-1.5 border-b" style={{ borderColor: stagedObj.borderSubtle }}>
                                            <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: stagedObj.textPrimary }}>
                                                Processing Admin
                                            </span>
                                            <span className="text-[8px] font-sans" style={{ color: stagedObj.textMuted }}>
                                                {batchLogs.length} Batches
                                            </span>
                                        </div>

                                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-1 justify-evenly my-1 text-[8px]">
                                            {batchLogs.length > 0 ? (
                                                batchLogs.slice(0, 6).map((row: any, idx: number) => {
                                                    const frameCount = row.availableImagesCount ?? row.panoramas?.length ?? row.images ?? 0;
                                                    return (
                                                        <div
                                                            key={row.id || idx}
                                                            className="flex items-center justify-between p-1.5 rounded style-surface-inner"
                                                            style={{
                                                                backgroundColor: stagedObj.innerCard
                                                            }}
                                                        >
                                                            <span className="font-sans font-medium" style={{ color: stagedObj.textPrimary }}>{row.subgrid || `SG-${idx + 1}`}</span>
                                                            <span style={{ color: stagedObj.textMuted }}>{frameCount} frames</span>
                                                            <span className="font-medium" style={{ color: 'var(--palette-butter)' }}>{row.status || 'Ongoing'}</span>
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div className="flex-1 flex items-center justify-center text-text-muted text-[8px]">
                                                    No batches registered
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="pt-1 border-t flex items-center justify-between text-[7.5px]" style={{ borderColor: stagedObj.borderSubtle, color: stagedObj.textMuted }}>
                                        <span>Pipeline Status</span>
                                        <span className="font-sans" style={{ color: 'var(--palette-sage)' }}>Operational</span>
                                    </div>
                                </div>

                                {/* 360 QA Box */}
                                <div
                                    className="p-2.5 rounded-lg border flex items-center justify-between style-radius style-surface dashboard-density-pad"
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
        </div>
    );
};
