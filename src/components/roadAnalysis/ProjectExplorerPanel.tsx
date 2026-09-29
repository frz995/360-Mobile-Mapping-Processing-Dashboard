// =====================================================================
// Project Explorer / Catchment Visualizer Component
// Modeled directly on the Sydney Catchment Demographic Explorer:
// - Left floating "Catchment" card with category pills, pin badge [A]/[B],
//   primary metric, and dual animated demographic horizontal bar charts.
// - Bottom floating pill toolbar: [Buffer] preset toggle, live radius slider,
//   and sleek glassmorphic "Colour by" custom dropdown menu.
// - Bottom-left continuous choropleth gradient spectrum bar with quantile ticks.
// - Top-left branding pill badge.
// =====================================================================

import React, { useState, useEffect, useRef } from 'react';
import { X, RotateCcw, ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import {
  type BufferAnalytics,
  type ExplorerChoroplethPalette,
  type CatchmentTabKey,
  ATLAS_PALETTES,
  getCatchmentTabData
} from '../../utils/projectExplorerGeometry';

export interface ProjectExplorerPanelProps {
  active: boolean;
  onClose: () => void;
  center?: [number, number] | null;
  centerA?: [number, number] | null;
  onCenterAChange?: (center: [number, number]) => void;
  centerB?: [number, number] | null;
  onCenterBChange?: (center: [number, number]) => void;
  radius: number; // meters
  onRadiusChange: (radius: number) => void;
  analytics?: BufferAnalytics;
  analyticsA?: BufferAnalytics;
  analyticsB?: BufferAnalytics | null;
  palette: ExplorerChoroplethPalette;
  onPaletteChange: (palette: ExplorerChoroplethPalette) => void;
  colorByMetric?: string;
  onColorByMetricChange?: (metric: string) => void;
  isCompareMode?: boolean;
  onToggleCompareMode?: (compare: boolean) => void;
  activePinFocus?: 'A' | 'B';
  onSelectPinFocus?: (pin: 'A' | 'B') => void;
  onReset?: () => void;
  onExploreUrbanArea?: () => void;
  hasExplored?: boolean;
  selectedGrid?: {
    subgrid: string;
    density: number;
    planKm: number;
    areaKm2: number;
    bbox?: [number, number, number, number];
  } | null;
  onClearGridSelection?: () => void;
}

export const CATCHMENT_TABS: Array<{ key: CatchmentTabKey; label: string }> = [
  { key: 'roads', label: 'Roads' },
  { key: 'density', label: 'Density' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'panotrack', label: 'Panotrack' },
  { key: 'coverage', label: 'Coverage' }
];

export interface BufferMetricOption {
  value: string;
  label: string;
  tabKey: CatchmentTabKey;
  palette: ExplorerChoroplethPalette;
  accentColor: string;
  unit: string;
  description: string;
}

export const BUFFER_METRIC_OPTIONS: BufferMetricOption[] = [
  {
    value: 'density',
    label: 'Road density',
    tabKey: 'density',
    palette: 'greens',
    accentColor: '#31a354',
    unit: 'km/km²',
    description: 'Road network density (5 sequential categories)'
  },
  {
    value: 'complexity',
    label: 'Urban complexity',
    tabKey: 'complexity',
    palette: 'purples',
    accentColor: '#756bb1',
    unit: 'index / 100',
    description: 'Intersection topology & urban grid (5 sequential categories)'
  },
  {
    value: 'panotrack',
    label: 'Panotrack survey',
    tabKey: 'panotrack',
    palette: 'oranges',
    accentColor: '#fd8d3c',
    unit: 'frames / grid',
    description: 'Survey frame coverage & capture status (5 sequential categories)'
  },
  {
    value: 'roads',
    label: 'Road corridors',
    tabKey: 'roads',
    palette: 'ylgnbu',
    accentColor: '#41b6c4',
    unit: 'km length',
    description: 'Corridor hierarchy & total road length (5 sequential categories)'
  },
  {
    value: 'coverage',
    label: 'Network coverage',
    tabKey: 'coverage',
    palette: 'teal',
    accentColor: '#1c9099',
    unit: '% covered',
    description: 'Survey vs plan network integrity (5 sequential categories)'
  }
];

export const BUFFER_PRESETS = [
  { radius: 1000, label: '1 km', hint: 'Walking buffer' },
  { radius: 3000, label: '3 km', hint: 'Neighborhood' },
  { radius: 5000, label: '5 km', hint: 'District standard' },
  { radius: 8000, label: '8 km', hint: 'Sub-regional' },
  { radius: 10000, label: '10 km', hint: 'Macro corridor' }
];

/**
 * Curated pastel color palette from reference specification:
 * - Mint Cyan:      #66E3C3
 * - Soft Lime:      #D3EEA5
 * - Warm Yellow:    #FFDD84
 * - Pastel Coral:   #FA897B
 * - Lilac Lavender: #CCADD8
 * - Cobalt Blue:    #5573EB
 * - Coral Rose:     #FF8890
 * - Pastel Peach:   #FDC094
 *
 * Tab Configurations (Primary Section 1 & Secondary Section 2):
 * - Roads:      Mint Cyan (#66E3C3) + Soft Lime (#D3EEA5)
 * - Density:    Cobalt Blue (#5573EB) + Pastel Coral (#FA897B)
 * - Complexity: Lilac Lavender (#CCADD8) + Warm Yellow (#FFDD84)
 * - Panotrack:  Coral Rose (#FF8890) + Pastel Peach (#FDC094)
 * - Coverage:   Soft Lime (#D3EEA5) + Lilac Lavender (#CCADD8)
 */
export const TAB_PASTEL_COLORS: Record<CatchmentTabKey, { primaryBar: string; secondaryBar: string }> = {
  roads: {
    primaryBar: '#66E3C3',   // Mint Cyan
    secondaryBar: '#D3EEA5'  // Soft Lime
  },
  density: {
    primaryBar: '#5573EB',   // Cobalt Blue (matches reference screenshot)
    secondaryBar: '#FA897B'  // Pastel Coral (matches reference screenshot)
  },
  complexity: {
    primaryBar: '#CCADD8',   // Lilac Lavender
    secondaryBar: '#FFDD84'  // Warm Yellow
  },
  panotrack: {
    primaryBar: '#FF8890',   // Coral Rose
    secondaryBar: '#FDC094'  // Pastel Peach
  },
  coverage: {
    primaryBar: '#D3EEA5',   // Soft Lime
    secondaryBar: '#CCADD8'  // Lilac Lavender
  }
};

export const DONUT_PALETTES: Record<CatchmentTabKey, string[]> = {
  roads: ['#2dd4bf', '#38bdf8', '#818cf8', '#c084fc'],        // Teal, Sky, Indigo, Purple
  density: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],      // Blue, Green, Amber, Red
  complexity: ['#a855f7', '#6366f1', '#ec4899', '#f97316'],   // Violet, Indigo, Pink, Orange
  panotrack: ['#10b981', '#38bdf8', '#f59e0b', '#ef4444'],    // Green, Sky, Amber, Red
  coverage: ['#10b981', '#64748b', '#38bdf8', '#818cf8']      // Green, Slate, Sky, Indigo
};

function metricToTab(metric?: string): CatchmentTabKey {
  if (!metric) return 'roads';
  if (metric === 'complexity') return 'complexity';
  if (metric === 'panotrack') return 'panotrack';
  if (metric === 'roads') return 'roads';
  if (metric === 'coverage') return 'coverage';
  if (metric === 'density') return 'density';
  return 'roads';
}

export const ProjectExplorerPanel: React.FC<ProjectExplorerPanelProps> = ({
  active,
  onClose: _onClose,
  center: _center,
  centerA: _centerA,
  centerB: _centerB,
  radius: _radius,
  onRadiusChange: _onRadiusChange,
  analytics,
  analyticsA,
  analyticsB,
  palette,
  onPaletteChange,
  colorByMetric,
  onColorByMetricChange,
  isCompareMode: _isCompareMode = false,
  onToggleCompareMode: _onToggleCompareMode,
  activePinFocus = 'A',
  onSelectPinFocus: _onSelectPinFocus,
  onReset,
  onExploreUrbanArea: _onExploreUrbanArea,
  selectedGrid = null,
  onClearGridSelection
}) => {
  const [selectedTab, setSelectedTab] = useState<CatchmentTabKey>(() =>
    colorByMetric ? metricToTab(colorByMetric) : 'roads'
  );
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [localPinFocus] = useState<'A' | 'B'>('A');
  const [hoveredStackSegment, setHoveredStackSegment] = useState<{
    zone: string;
    label: string;
    pct: number;
  } | null>(null);
  const [tabAnimKey, setTabAnimKey] = useState(0);

  // Auto-expand Details Card when a new subgrid is clicked on the map
  const prevSubgridIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedGrid?.subgrid && selectedGrid.subgrid !== prevSubgridIdRef.current) {
      prevSubgridIdRef.current = String(selectedGrid.subgrid);
      setIsCollapsed(false);
    }
  }, [selectedGrid?.subgrid]);

  // Custom UI dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync selectedTab whenever parent colorByMetric changes
  useEffect(() => {
    if (colorByMetric) {
      const targetTab = metricToTab(colorByMetric);
      setSelectedTab(targetTab);
    }
  }, [colorByMetric]);

  // Click-outside and Escape key listener to close custom popovers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!active) return null;

  const effectivePinFocus = activePinFocus || localPinFocus;

  // Resolve analytics for active pin
  const activeAnalytics =
    effectivePinFocus === 'B' && analyticsB
      ? analyticsB
      : (analyticsA || analytics);

  if (!activeAnalytics) return null;

  const currentTabContent = getCatchmentTabData(activeAnalytics, selectedTab);
  const currentPalette = ATLAS_PALETTES[palette] || ATLAS_PALETTES.viridis;

  // Find active buffer metric option for display
  const currentMetricOption =
    BUFFER_METRIC_OPTIONS.find((o) => o.tabKey === selectedTab) ||
    BUFFER_METRIC_OPTIONS.find((o) => o.value === colorByMetric) ||
    BUFFER_METRIC_OPTIONS[0];

  // Handler for Catchment tab clicks
  const handleSelectTab = (tabKey: CatchmentTabKey) => {
    setSelectedTab(tabKey);
    setTabAnimKey((k) => k + 1);
    const matching = BUFFER_METRIC_OPTIONS.find((o) => o.tabKey === tabKey);
    if (matching) {
      onColorByMetricChange?.(matching.value);
      onPaletteChange(matching.palette);
    }
  };

  // Handler for dropdown selection
  const handleSelectMetricOption = (opt: BufferMetricOption) => {
    onColorByMetricChange?.(opt.value);
    onPaletteChange(opt.palette);
    setSelectedTab(opt.tabKey);
    setTabAnimKey((k) => k + 1);
    setIsDropdownOpen(false);
  };

  return (
    <>
      {/* ── Right Floating Details Card (Slidable to right panel) ── */}
      <div
        className={`absolute top-3 bottom-3 right-3 sm:right-4 z-[1001] w-[360px] sm:w-[385px] flex flex-col pointer-events-auto select-none transition-all duration-300 ease-in-out ${
          isCollapsed
            ? 'translate-x-[calc(100%+24px)] opacity-0 pointer-events-none'
            : 'translate-x-0 opacity-100'
        }`}
      >
        {/* Details Card */}
        <div
          className="w-full rounded-2xl border style-surface backdrop-blur-xl select-none overflow-hidden shadow-2xl flex flex-col flex-1 min-h-0 animate-explorer-spin-rise"
          style={{
            backgroundColor: 'var(--bg-card, rgba(12, 18, 30, 0.95))',
            borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.1))',
            color: 'var(--text-primary, #EEF2F1)',
            boxShadow: 'var(--card-shadow, 0 24px 50px -12px rgba(0, 0, 0, 0.8))'
          }}
        >
        {/* Card Header: Details Title + Collapse + Reset + Close */}
        <div className="p-3.5 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
              <span className="text-sm font-semibold tracking-tight text-[var(--text-primary,#EEF2F1)]">Details</span>
              {isCollapsed && selectedGrid && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-medium truncate max-w-[150px]">
                  Grid {selectedGrid.subgrid}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="p-1 rounded-md text-[var(--text-muted,#9BAAA9)] hover:text-[var(--text-primary,#EEF2F1)] hover:bg-white/10 transition-colors cursor-pointer"
                title="Collapse Details"
                aria-label="Collapse Details"
              >
                <ChevronRight size={15} />
              </button>

              <button
                type="button"
                onClick={() => {
                  onReset?.();
                  _onRadiusChange?.(5000);
                }}
                className="text-[11px] text-[var(--text-muted,#9BAAA9)] hover:text-[var(--text-primary,#EEF2F1)] cursor-pointer transition-colors flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/5"
                title="Reset Explorer focus"
              >
                <RotateCcw size={10} />
                <span>Reset</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="p-1 rounded-md text-[var(--text-muted,#9BAAA9)] hover:text-[var(--text-primary,#EEF2F1)] hover:bg-white/10 transition-colors cursor-pointer"
                title="Close Details"
                aria-label="Close Details"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="text-[11px] text-[var(--text-muted,#9BAAA9)] mt-0.5">
            {selectedGrid ? (
              <span className="flex items-center gap-1.5 text-sky-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                Subgrid {selectedGrid.subgrid} focused
              </span>
            ) : (
              'Click any subgrid box to focus & dim'
            )}
          </div>

              {selectedGrid && (
                <div
                  className="flex items-center justify-between mt-2 px-2.5 py-1.5 rounded-lg border text-[11px] animate-in fade-in duration-150"
                  style={{
                    backgroundColor: 'var(--accent-bg, rgba(56, 189, 248, 0.15))',
                    borderColor: 'var(--accent, rgba(56, 189, 248, 0.35))',
                    color: 'var(--text-primary, #EEF2F1)'
                  }}
                >
                  <div className="flex items-center gap-1.5 font-semibold truncate text-sky-300">
                    <span className="truncate">Grid {selectedGrid.subgrid}</span>
                    <span className="text-[10px] text-sky-300/80 font-normal">
                      ({selectedGrid.density} km/km² · {selectedGrid.planKm} km)
                    </span>
                  </div>
                  {onClearGridSelection && (
                    <button
                      type="button"
                      onClick={onClearGridSelection}
                      className="text-[10px] text-sky-300 hover:text-white underline cursor-pointer shrink-0 ml-2"
                      title="Clear grid focus and dimming"
                    >
                      Clear focus
                    </button>
                  )}
                </div>
              )}

              {/* Pill Tabs Row (Roads, Density, Complexity, Panotrack, Coverage) */}
              <div className="flex items-center gap-1 mt-2.5 overflow-x-auto no-scrollbar pb-1">
                {CATCHMENT_TABS.map((tab) => {
                  const activeTab = selectedTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => handleSelectTab(tab.key)}
                      style={
                        activeTab
                          ? {
                              backgroundColor: 'var(--accent, #ffffff)',
                              color: 'var(--accent-foreground, #000000)'
                            }
                          : undefined
                      }
                      className={`px-2.5 py-1 rounded-full text-[11px] transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                        activeTab
                          ? 'font-semibold shadow-sm'
                          : 'text-[var(--text-muted,#9BAAA9)] hover:text-[var(--text-primary,#EEF2F1)] hover:bg-white/5 font-medium'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

        {/* Card Body: Pin Badge [A] + Hero Metric + Clean Integrated Demographic Bar Charts */}
        {!isCollapsed && (
          <div key={tabAnimKey} className="px-3.5 pb-3.5 space-y-2.5 flex-1 min-h-0 overflow-y-auto custom-scrollbar animate-explorer-tab-flip">
            {/* Bento Tile: Hero Metric with Small Icon Size */}
            <div
              className="flex items-center justify-between p-2.5 rounded-xl border"
              style={{
                backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.05))',
                borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))'
              }}
            >
              <div className="flex items-center gap-2.5">
                {effectivePinFocus === 'A' ? (
                  <img
                    src="/Icon%20road%20analysis/pin.png"
                    alt="A"
                    className="w-5 h-5 object-contain drop-shadow-sm shrink-0 select-none pointer-events-none"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shadow-sm shrink-0 bg-sky-500 text-white">
                    {effectivePinFocus}
                  </div>
                )}

                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-[var(--text-primary,#EEF2F1)]">
                    {currentTabContent.primaryValue}
                  </span>
                  <span className="text-xs text-[var(--text-muted,#9BAAA9)] font-medium">
                    {currentTabContent.primaryUnit}
                  </span>
                </div>
              </div>

              {selectedGrid && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-semibold">
                  SUBGRID
                </span>
              )}
            </div>

            {/* Section 1 Breakdown: Donut Proportions Chart */}
            <div className="space-y-1.5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-xs pb-1 border-b border-[var(--divider,rgba(255,255,255,0.08))]">
                <span className="font-semibold text-[var(--text-primary,#EEF2F1)]">
                  {currentTabContent.sections[0].title}
                </span>
                <span className="text-[10px] text-[var(--text-muted,#9BAAA9)] font-mono">
                  {currentTabContent.sections[0].subtitleRight}
                </span>
              </div>

              {(() => {
                const rows = currentTabContent.sections[0].rows;
                const paletteColors = DONUT_PALETTES[selectedTab] || DONUT_PALETTES.roads;
                const totalPct = rows.reduce((acc, r) => acc + Math.max(0, r.percentage), 0) || 100;
                const R = 36;
                const C = 2 * Math.PI * R;
                let accumulatedOffset = 0;

                return (
                  <div
                    className="flex items-center gap-3 p-2.5 rounded-xl border style-surface-inner"
                    style={{
                      backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.03))',
                      borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))'
                    }}
                  >
                    {/* Donut SVG Ring */}
                    <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                      <svg className="w-full h-full -rotate-90 explorer-donut-ring" viewBox="0 0 100 100">
                        {/* Background track circle */}
                        <circle
                          cx="50"
                          cy="50"
                          r={R}
                          fill="transparent"
                          stroke="var(--bg-inner, rgba(255, 255, 255, 0.08))"
                          strokeWidth="11"
                        />
                        {rows.map((row, idx) => {
                          const sliceLen = (Math.max(0, row.percentage) / totalPct) * C;
                          if (sliceLen <= 0) return null;
                          const gap = rows.filter((r) => r.percentage > 0).length > 1 ? 1.5 : 0;
                          const dash = `${Math.max(0.5, sliceLen - gap)} ${C - Math.max(0.5, sliceLen - gap)}`;
                          const offset = -accumulatedOffset;
                          accumulatedOffset += sliceLen;
                          const color = paletteColors[idx % paletteColors.length];

                          return (
                            <circle
                              key={idx}
                              cx="50"
                              cy="50"
                              r={R}
                              fill="transparent"
                              stroke={color}
                              strokeWidth="11"
                              strokeDasharray={dash}
                              strokeDashoffset={offset}
                              className="transition-all duration-300 ease-out explorer-donut-slice"
                            />
                          );
                        })}
                      </svg>

                      {/* Center summary text */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-1">
                        <span className="text-[11px] font-bold font-mono tracking-tight text-[var(--text-primary,#EEF2F1)] leading-none truncate max-w-[56px]">
                          {currentTabContent.primaryValue}
                        </span>
                        <span className="text-[7.5px] text-[var(--text-muted,#9BAAA9)] font-mono uppercase tracking-wider mt-0.5 truncate max-w-[56px]">
                          {currentTabContent.primaryUnit}
                        </span>
                      </div>
                    </div>

                    {/* Donut Legend */}
                    <div className="flex-1 space-y-1.5 min-w-0">
                      {rows.map((row, idx) => {
                        const color = paletteColors[idx % paletteColors.length];
                        return (
                          <div key={idx} className="flex items-center justify-between text-[10.5px] gap-1.5 explorer-legend-row">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span
                                className="text-[var(--text-primary,#EEF2F1)] truncate"
                                title={row.label}
                              >
                                {row.label}
                              </span>
                            </div>
                            <span className="font-mono text-[var(--text-muted,#9BAAA9)] shrink-0 font-medium text-[10px]">
                              {row.displayValue ?? `${row.percentage}%`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Section 2 Breakdown: Stacked Column Bar Chart (Modeled on GIS reference example) */}
            <div className="space-y-1.5 pt-1 animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-xs pb-1 border-b border-[var(--divider,rgba(255,255,255,0.08))]">
                <span className="font-semibold text-[var(--text-primary,#EEF2F1)]">
                  {currentTabContent.sections[1].title}
                </span>
                <span className="text-[10px] text-[var(--text-muted,#9BAAA9)] font-mono">
                  {currentTabContent.sections[1].subtitleRight}
                </span>
              </div>

              {(() => {
                const ringRows = currentTabContent.sections[1].rows;
                const catRows = currentTabContent.sections[0].rows;
                const paletteColors = DONUT_PALETTES[selectedTab] || DONUT_PALETTES.roads;

                // Max Y calculation
                const maxPct = Math.max(...ringRows.map((r) => r.percentage), 10);
                let maxY = 100;
                let yTicks = [0, 25, 50, 75, 100];
                if (maxPct <= 25) {
                  maxY = 25;
                  yTicks = [0, 5, 10, 15, 20, 25];
                } else if (maxPct <= 50) {
                  maxY = 50;
                  yTicks = [0, 10, 20, 30, 40, 50];
                } else if (maxPct <= 80) {
                  maxY = 80;
                  yTicks = [0, 20, 40, 60, 80];
                }

                // Short zone labels for X-axis
                const shortLabels = ['Core (0–25%)', 'Inner (25–50%)', 'Mid (50–75%)', 'Outer (75–100%)'];

                // Dimensions
                const svgW = 330;
                const svgH = 158;
                const plotLeft = 28;
                const plotRight = 320;
                const plotW = plotRight - plotLeft; // 292
                const plotTop = 16;
                const plotBaseY = 102;
                const plotH = plotBaseY - plotTop; // 86
                const colWidth = 28;
                const slotW = plotW / Math.max(1, ringRows.length);

                return (
                  <div
                    className="p-2.5 rounded-xl border style-surface-inner flex flex-col gap-2"
                    style={{
                      backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.03))',
                      borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))'
                    }}
                  >
                    {/* Active hover info banner (fixed-slot to eliminate layout-shift stutter on hover) */}
                    <div
                      className={`flex items-center justify-between px-2 py-1 rounded-md text-[10px] min-h-[26px] transition-opacity duration-150 ${
                        hoveredStackSegment
                          ? 'bg-white/5 border border-white/10 opacity-100'
                          : 'opacity-0 border border-transparent pointer-events-none select-none'
                      }`}
                      aria-hidden={!hoveredStackSegment}
                    >
                      <span className="text-[var(--text-primary,#EEF2F1)] font-medium truncate max-w-[200px]">
                        {hoveredStackSegment ? `${hoveredStackSegment.zone} · ${hoveredStackSegment.label}` : ''}
                      </span>
                      <span className="font-mono font-bold text-sky-400">
                        {hoveredStackSegment ? `${hoveredStackSegment.pct.toFixed(1)}%` : ''}
                      </span>
                    </div>

                    {/* SVG Stacked Bar Chart */}
                    <div className="w-full overflow-hidden">
                      <svg
                        className="w-full h-auto select-none"
                        viewBox={`0 0 ${svgW} ${svgH}`}
                        style={{ overflow: 'visible' }}
                      >
                        {/* Horizontal Grid lines & Y-axis labels */}
                        {yTicks.map((tick) => {
                          const y = plotBaseY - (tick / maxY) * plotH;
                          return (
                            <g key={tick}>
                              <line
                                x1={plotLeft}
                                y1={y}
                                x2={plotRight}
                                y2={y}
                                stroke="var(--divider, rgba(255, 255, 255, 0.08))"
                                strokeDasharray={tick === 0 ? undefined : '3 3'}
                                strokeWidth={tick === 0 ? 1 : 0.75}
                              />
                              <text
                                x={plotLeft - 4}
                                y={y + 3}
                                textAnchor="end"
                                fontSize="7.5"
                                fill="var(--text-muted, #9BAAA9)"
                                fontFamily="monospace"
                              >
                                {tick}%
                              </text>
                            </g>
                          );
                        })}

                        {/* Y-axis title on the left rotated 90deg */}
                        <text
                          x={9}
                          y={(plotTop + plotBaseY) / 2}
                          transform={`rotate(-90 9 ${(plotTop + plotBaseY) / 2})`}
                          textAnchor="middle"
                          fontSize="7"
                          fill="var(--text-muted, #9BAAA9)"
                          fontWeight="500"
                        >
                          {currentTabContent.sections[1].subtitleRight}
                        </text>

                        {/* Stacked Columns */}
                        {ringRows.map((ringRow, colIdx) => {
                          const colTotal = Math.max(0, ringRow.percentage);
                          const cx = plotLeft + (colIdx + 0.5) * slotW;
                          const barX = cx - colWidth / 2;

                          // Compute weighted segment values for this radial ring
                          const weights = catRows.map((cat, catIdx) => {
                            const base = Math.max(1, cat.percentage);
                            // Concentrates urban blocks/core in ring 0, arterials/trunks in ring 3
                            const bias =
                              1 +
                              (colIdx === 0
                                ? (catRows.length - 1 - catIdx) * 0.45
                                : colIdx === 3
                                ? catIdx * 0.45
                                : colIdx === 2
                                ? catIdx * 0.2
                                : (catRows.length - 1 - catIdx) * 0.2);
                            return base * bias;
                          });
                          const sumW = weights.reduce((acc, w) => acc + w, 0) || 1;
                          const segments = catRows.map((cat, catIdx) => {
                            const segPct = (colTotal * weights[catIdx]) / sumW;
                            return {
                              label: cat.label,
                              pct: segPct,
                              color: paletteColors[catIdx % paletteColors.length]
                            };
                          });

                          let currY = plotBaseY;
                          const totalColH = (colTotal / maxY) * plotH;

                          return (
                            <g key={colIdx} className="transition-all duration-200 explorer-bar-column">
                              {/* Stacked Rectangles */}
                              {segments.map((seg, segIdx) => {
                                const segH = (seg.pct / maxY) * plotH;
                                if (segH <= 0.2) return null;
                                const segY = currY - segH;
                                currY = segY;
                                const isTopSeg = segIdx === segments.length - 1 || currY <= plotBaseY - totalColH + 0.5;

                                return (
                                  <rect
                                    key={segIdx}
                                    x={barX}
                                    y={segY}
                                    width={colWidth}
                                    height={segH}
                                    fill={seg.color}
                                    rx={isTopSeg ? 3 : 0}
                                    ry={isTopSeg ? 3 : 0}
                                    className="explorer-bar-segment"
                                    onMouseEnter={() =>
                                      setHoveredStackSegment({
                                        zone: ringRow.label,
                                        label: seg.label,
                                        pct: seg.pct
                                      })
                                    }
                                    onMouseLeave={() => setHoveredStackSegment(null)}
                                  >
                                    <title>{`${ringRow.label}: ${seg.label} (${seg.pct.toFixed(1)}%)`}</title>
                                  </rect>
                                );
                              })}

                              {/* Column Value on Top of Bar */}
                              <text
                                x={cx}
                                y={Math.max(11, plotBaseY - totalColH - 3)}
                                textAnchor="middle"
                                fontSize="8.5"
                                fontWeight="bold"
                                fontFamily="monospace"
                                fill="var(--text-primary, #EEF2F1)"
                              >
                                {colTotal}%
                              </text>

                              {/* Angled X-axis Label */}
                              <text
                                x={cx}
                                y={plotBaseY + 12}
                                transform={`rotate(-22 ${cx} ${plotBaseY + 12})`}
                                textAnchor="end"
                                fontSize="7.5"
                                fill="var(--text-muted, #9BAAA9)"
                                className="select-none"
                              >
                                {shortLabels[colIdx] ?? ringRow.label}
                              </text>
                            </g>
                          );
                        })}

                        {/* X-axis title below */}
                        <text
                          x={(plotLeft + plotRight) / 2}
                          y={svgH - 3}
                          textAnchor="middle"
                          fontSize="7.5"
                          fill="var(--text-muted, #9BAAA9)"
                          fontWeight="500"
                        >
                          Radial Buffer Zones
                        </text>
                      </svg>
                    </div>

                    {/* Bottom Legend (matching reference image) */}
                    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1.5 border-t border-[var(--divider,rgba(255,255,255,0.08))] text-[9.5px]">
                      {catRows.map((cat, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 shrink-0">
                          <span
                            className="w-2.5 h-1.5 rounded-sm shrink-0"
                            style={{ backgroundColor: paletteColors[idx % paletteColors.length] }}
                          />
                          <span
                            className="text-[var(--text-muted,#9BAAA9)] hover:text-[var(--text-primary,#EEF2F1)] transition-colors truncate max-w-[130px]"
                            title={cat.label}
                          >
                            {cat.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Footnote matching System Context */}
            <div className="pt-2 border-t border-[var(--divider,rgba(255,255,255,0.08))] text-[9px] text-[var(--text-muted,#9BAAA9)] leading-relaxed">
              <div>Drawn from active road network &amp; Panotrack survey data.</div>
              <div>Spatial buffer radius apportionment · Dynamic topology &amp; coverage analysis.</div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* ── Docked Slide Panel Toggle on Right Edge when collapsed (Arrow only) ── */}
      {isCollapsed && (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          style={{
            backgroundColor: 'var(--bg-card, rgba(12, 18, 30, 0.95))',
            borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
            boxShadow: 'var(--card-shadow, 0 16px 32px -8px rgba(0,0,0,0.7))',
            color: 'var(--text-primary, #EEF2F1)'
          }}
          className="absolute top-1/2 -translate-y-1/2 right-0 z-[1001] flex items-center justify-center p-2 rounded-l-xl border-y border-l backdrop-blur-xl cursor-pointer hover:bg-white/10 transition-all duration-200 shadow-xl group pointer-events-auto animate-in fade-in slide-in-from-right-2"
          title="Expand Details"
          aria-label="Expand Details"
        >
          <ChevronLeft size={18} className="text-sky-400 group-hover:-translate-x-0.5 transition-transform" />
          {selectedGrid && (
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse absolute top-1.5 right-1.5" />
          )}
        </button>
      )}

      {/* ── Left Floating Card Legend (5 Sequential Categories - Compact) ── */}
      <div className="absolute bottom-6 left-6 z-[1001] pointer-events-auto select-none">
        <div
          className="w-[215px] sm:w-[230px] rounded-xl border style-surface backdrop-blur-xl p-2.5 transition-all duration-300 shadow-xl select-none animate-in fade-in slide-in-from-left-3"
          style={{
            backgroundColor: 'var(--bg-card, rgba(12, 18, 30, 0.95))',
            borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
            color: 'var(--text-primary, #EEF2F1)',
            boxShadow: 'var(--card-shadow, 0 16px 32px -8px rgba(0,0,0,0.7))'
          }}
        >
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold tracking-tight text-[var(--text-primary,#EEF2F1)]">{currentMetricOption.label}</span>
            <span className="text-[var(--text-muted,#9BAAA9)] font-mono text-[9px]">{currentMetricOption.unit}</span>
          </div>

          {/* Stepped 5-Category Color Bar */}
          <div className="flex w-full h-2.5 rounded-md overflow-hidden border border-white/20 mt-1.5 shadow-inner neu-choropleth-bar">
            {currentPalette.stops.map((s, idx) => (
              <div
                key={idx}
                className="flex-1 h-full border-r last:border-r-0 border-black/30 transition-transform hover:scale-105 neu-choropleth-segment"
                style={{ backgroundColor: s.color }}
                title={`Category ${idx + 1}`}
              />
            ))}
          </div>

          {/* 5-Category Step Thresholds */}
          <div className="flex items-center justify-between text-[8px] font-mono text-[var(--text-muted,#9BAAA9)] mt-1 px-0.5">
            {currentMetricOption.value === 'complexity' ? (
              <>
                <span>0</span>
                <span>20</span>
                <span>40</span>
                <span>60</span>
                <span>80+</span>
              </>
            ) : currentMetricOption.value === 'panotrack' ? (
              <>
                <span>0</span>
                <span>15</span>
                <span>45</span>
                <span>90</span>
                <span>180+</span>
              </>
            ) : currentMetricOption.value === 'roads' ? (
              <>
                <span>0</span>
                <span>5</span>
                <span>15</span>
                <span>30</span>
                <span>50+</span>
              </>
            ) : currentMetricOption.value === 'coverage' ? (
              <>
                <span>0%</span>
                <span>20%</span>
                <span>40%</span>
                <span>60%</span>
                <span>80%+</span>
              </>
            ) : (
              <>
                <span>0.0</span>
                <span>1.5</span>
                <span>3.5</span>
                <span>6.0</span>
                <span>9.0+</span>
              </>
            )}
          </div>

          <div className="flex items-center justify-between text-[8px] text-[var(--text-muted,#9BAAA9)] mt-1.5 border-t border-[var(--divider,rgba(255,255,255,0.1))] pt-1.5">
            <span className="flex items-center gap-1.5 text-[var(--text-primary,#EEF2F1)]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              5 Sequential Categories
            </span>
            <span className="font-mono text-[var(--text-muted,#9BAAA9)]">Class 1–5</span>
          </div>
        </div>
      </div>

      {/* ── Bottom Floating Controls Bar (Sydney Explorer Style) ── */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1001] pointer-events-auto select-none">
        <div
          className="flex items-center gap-3 sm:gap-4 px-4 py-2 rounded-full border style-surface backdrop-blur-xl text-xs"
          style={{
            backgroundColor: 'var(--bg-card, rgba(12, 18, 30, 0.92))',
            borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.1))',
            color: 'var(--text-primary, #EEF2F1)',
            boxShadow: 'var(--card-shadow, 0 20px 40px -10px rgba(0,0,0,0.7))'
          }}
        >
          {/* Active Focused Subgrid Pill or Guidance */}
          {selectedGrid ? (
            <div
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border font-semibold text-[11px] shadow-sm text-sky-300"
              style={{
                backgroundColor: 'var(--accent-bg, rgba(56, 189, 248, 0.2))',
                borderColor: 'var(--accent, rgba(56, 189, 248, 0.4))'
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span>Subgrid: {selectedGrid.subgrid}</span>
              <span className="text-[10px] text-sky-200/80 font-normal font-mono">
                ({selectedGrid.density} km/km²)
              </span>
              {onClearGridSelection && (
                <button
                  type="button"
                  onClick={onClearGridSelection}
                  className="ml-1 p-0.5 rounded-full hover:bg-sky-400/20 text-slate-300 hover:text-white cursor-pointer transition-colors"
                  title="Clear grid focus and dimming"
                  aria-label="Clear focus"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ) : (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[11px]"
              style={{
                backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.05))',
                borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.1))',
                color: 'var(--text-muted, #9BAAA9)'
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span>Click subgrid to focus & dim</span>
            </div>
          )}

          {/* Colour by Custom Glassmorphic Dropdown */}
          <div className="flex items-center gap-2 border-l border-[var(--divider,rgba(255,255,255,0.1))] pl-3">
            <span className="text-[var(--text-muted,#9BAAA9)] text-[11px] font-medium hidden sm:inline">Colour by</span>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                aria-expanded={isDropdownOpen}
                aria-label="Colour by metric selection"
                className="flex items-center gap-2 px-2.5 py-1 rounded-full border transition-all cursor-pointer text-[11px] font-semibold shadow-sm"
                style={{
                  backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.1))',
                  borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
                  color: 'var(--text-primary, #EEF2F1)'
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 shadow-sm"
                  style={{
                    backgroundColor: currentMetricOption.accentColor,
                    boxShadow: `0 0 6px ${currentMetricOption.accentColor}`
                  }}
                />
                <span>{currentMetricOption.label}</span>
                <ChevronDown
                  size={12}
                  className={`text-[var(--text-muted,#9BAAA9)] transition-transform duration-200 ${
                    isDropdownOpen ? 'rotate-180 text-[var(--text-primary,#EEF2F1)]' : ''
                  }`}
                />
              </button>

              {isDropdownOpen && (
                <div
                  role="menu"
                  className="absolute bottom-[calc(100%+10px)] right-0 min-w-[230px] rounded-2xl border style-surface backdrop-blur-2xl p-1.5 z-[1002] animate-in fade-in zoom-in-95 duration-150"
                  style={{
                    backgroundColor: 'var(--bg-card, rgba(12, 18, 30, 0.95))',
                    borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
                    color: 'var(--text-primary, #EEF2F1)',
                    boxShadow: 'var(--card-shadow, 0 20px 40px -10px rgba(0,0,0,0.8))'
                  }}
                >
                  <div className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted,#9BAAA9)] border-b border-[var(--divider,rgba(255,255,255,0.08))] mb-1 flex items-center justify-between">
                    <span>Choropleth Metric</span>
                    <span className="font-mono text-[9px] text-[var(--text-muted,#9BAAA9)] opacity-70">{BUFFER_METRIC_OPTIONS.length} options</span>
                  </div>

                  <div className="space-y-0.5">
                    {BUFFER_METRIC_OPTIONS.map((opt) => {
                      const isSelected =
                        (colorByMetric === opt.value) ||
                        (!colorByMetric && selectedTab === opt.tabKey) ||
                        (colorByMetric === 'pastel' && opt.value === 'roads');
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="menuitem"
                          onClick={() => handleSelectMetricOption(opt)}
                          className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-xl text-left text-xs transition-all cursor-pointer ${
                            isSelected
                              ? 'font-semibold border'
                              : 'hover:bg-white/5'
                          }`}
                          style={
                            isSelected
                              ? {
                                  backgroundColor: 'var(--accent-bg, rgba(255, 255, 255, 0.15))',
                                  borderColor: 'var(--accent, rgba(255, 255, 255, 0.2))',
                                  color: 'var(--text-primary, #EEF2F1)'
                                }
                              : {
                                  color: 'var(--text-muted, #9BAAA9)'
                                }
                          }
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{
                                backgroundColor: opt.accentColor,
                                boxShadow: isSelected ? `0 0 8px ${opt.accentColor}` : undefined
                              }}
                            />
                            <div className="truncate">
                              <div className="text-[11px] font-medium leading-tight truncate text-[var(--text-primary,#EEF2F1)]">{opt.label}</div>
                              <div className="text-[9px] text-[var(--text-muted,#9BAAA9)] truncate font-normal">{opt.description}</div>
                            </div>
                          </div>
                          {isSelected && <Check size={13} className="text-[var(--text-primary,#EEF2F1)] shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
