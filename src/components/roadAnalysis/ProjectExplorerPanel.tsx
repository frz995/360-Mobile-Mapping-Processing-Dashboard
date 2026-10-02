// =====================================================================
// Project Explorer card.
//
// Reads its numbers from `categories`, aggregated over the mesh cells the map
// paints (see `utils/catchmentStats`). Idle covers every cell in the district
// grid; focusing a subgrid narrows the same aggregation to one cell. There is
// no buffer radius — the old circle geometry is gone, along with the pin A/B
// compare mode that depended on it.
//
// Layout:
// - Details card: category pills, hero metric, donut, class-share columns.
// - Bottom floating pill toolbar: focused-scope pill and "Colour by" dropdown.
// - Bottom-left choropleth class legend driven by `choroplethSettings`.
// =====================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, RotateCcw, ChevronDown, ChevronLeft, ChevronRight, Check, SlidersHorizontal, AlertTriangle } from 'lucide-react';
import {
  type ExplorerChoroplethPalette,
  type CatchmentTabKey,
  type ExplorerGridSpec,
  type MeshGridInfo,
  GRID_PRESETS_KM,
  GRID_MIN_KM,
  GRID_MAX_KM,
  sanitizeGridKm
} from '../../utils/projectExplorerGeometry';
import type { CatchmentCategory, CatchmentRow } from '../../utils/catchmentStats';
import {
  classColors,
  classRangeLabel,
  resolveSetting,
  type ChoroplethSetting,
  type ChoroplethSettingsMap
} from '../../utils/choroplethSettings';
import { ChoroplethSettingsEditor } from './ChoroplethSettingsEditor';
import {
  DonutChart,
  ClassShareColumns,
  EXPLORER_DONUT_COLORS
} from './ExplorerCharts';

export interface ProjectExplorerPanelProps {
  active: boolean;
  onClose: () => void;
  /** Every category, already aggregated over the current mesh scope. */
  categories: Record<CatchmentTabKey, CatchmentCategory>;
  /** What the numbers cover: the district grid, or one focused subgrid. */
  scopeLabel: string;
  /**
   * The grid the cells were measured over. Density and complexity are per-cell,
   * so their magnitude moves with cell size; stating the resolution keeps two
   * projects' numbers honestly comparable (or visibly not).
   */
  gridInfo?: MeshGridInfo | null;
  /** Operator-declared grid geometry; omit to hide the control entirely. */
  gridSpec?: ExplorerGridSpec | null;
  onGridSpecChange?: (spec: ExplorerGridSpec) => void;
  palette: ExplorerChoroplethPalette;
  onPaletteChange: (palette: ExplorerChoroplethPalette) => void;
  colorByMetric?: string;
  onColorByMetricChange?: (metric: string) => void;
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
  /** Operator-defined choropleth classes per metric (map + legend + charts). */
  choroplethSettings?: ChoroplethSettingsMap;
  /** Observed mesh values per metric, used to compute data-driven class breaks. */
  choroplethValues?: Record<string, number[]>;
  onChoroplethSettingsChange?: (metric: string, setting: ChoroplethSetting) => void;
  onChoroplethSettingsSave?: (metric: string, setting: ChoroplethSetting) => void;
}

export const CATCHMENT_TABS: Array<{ key: CatchmentTabKey; label: string }> = [
  { key: 'roads', label: 'Roads' },
  { key: 'density', label: 'Density' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'panotrack', label: 'Panotrack' },
  { key: 'coverage', label: 'Coverage' }
];

export interface ChoroplethMetricOption {
  value: string;
  label: string;
  tabKey: CatchmentTabKey;
  palette: ExplorerChoroplethPalette;
  accentColor: string;
  unit: string;
  description: string;
}

// Ordered to mirror the Details card pill tabs (`CATCHMENT_TABS`) so the
// Choropleth Metric list reads in the same sequence as the on-card categories.
export const CHOROPLETH_METRIC_OPTIONS: ChoroplethMetricOption[] = [
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
    value: 'coverage',
    label: 'Network coverage',
    tabKey: 'coverage',
    palette: 'teal',
    accentColor: '#1c9099',
    unit: '% covered',
    description: 'Survey vs plan network integrity (5 sequential categories)'
  }
];



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
  categories,
  scopeLabel,
  gridInfo,
  gridSpec,
  onGridSpecChange,
  palette,
  onPaletteChange,
  colorByMetric,
  onColorByMetricChange,
  onReset,
  onExploreUrbanArea: _onExploreUrbanArea,
  selectedGrid = null,
  onClearGridSelection,
  choroplethSettings,
  choroplethValues,
  onChoroplethSettingsChange,
  onChoroplethSettingsSave
}) => {
  const [selectedTab, setSelectedTab] = useState<CatchmentTabKey>(() =>
    colorByMetric ? metricToTab(colorByMetric) : 'roads'
  );
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hoveredColumn, setHoveredColumn] = useState<CatchmentRow | null>(null);
  const [hoveredSlice, setHoveredSlice] = useState<CatchmentRow | null>(null);
  const [tabAnimKey, setTabAnimKey] = useState(0);

  // Grid-size control. The select mirrors the persisted spec so it survives a
  // remount; `customOpen` is local UI state because "Custom…" is a mode, not a
  // stored value.
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const declaredKm =
    gridInfo?.source === 'imported'
      ? sanitizeGridKm(gridSpec?.importedCellKm)
      : sanitizeGridKm(gridSpec?.derivedCellKm);
  const gridSelectValue = useMemo(() => {
    if (declaredKm === null) return 'auto';
    const match = GRID_PRESETS_KM.find((p) => Math.abs(p.value - declaredKm) < 0.05);
    return match ? String(match.value) : 'custom';
  }, [declaredKm]);

  // An unusable entry (blank, non-numeric, or outside the accepted range) is
  // rejected outright rather than applied, so a typo cannot skew every density.
  const commitCustomGrid = (forImported: boolean) => {
    const km = sanitizeGridKm(customDraft);
    if (km === null) {
      setCustomDraft('');
      setCustomOpen(false);
      return;
    }
    onGridSpecChange?.(
      forImported ? { derivedCellKm: null, importedCellKm: km } : { derivedCellKm: km, importedCellKm: null }
    );
    setCustomDraft('');
    setCustomOpen(false);
  };

  // Auto-expand Details Card when a new subgrid is clicked on the map. A remount
  // never fires mouseleave, so the hover readouts are cleared here too.
  const prevSubgridIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedGrid?.subgrid && selectedGrid.subgrid !== prevSubgridIdRef.current) {
      prevSubgridIdRef.current = String(selectedGrid.subgrid);
      setIsCollapsed(false);
    }
    setHoveredSlice(null);
    setHoveredColumn(null);
  }, [selectedGrid?.subgrid]);

  // Custom UI dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  // The class definition that drives the map, the legend and both charts.
  const activeMetric = colorByMetric || selectedTab;
  const activeSetting = resolveSetting(choroplethSettings, activeMetric, palette);
  const activeClassColors = classColors(activeSetting);

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
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsDropdownOpen(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(target)) {
        setIsSettingsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDropdownOpen(false);
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!active || !categories) return null;

  // Every number below comes from this category, already aggregated over the
  // current mesh scope (all cells when idle, one cell when a subgrid is focused).
  const currentTabContent = categories[selectedTab] || categories.roads;
  const cellCount = currentTabContent.cellCount || 0;
  // One key for both charts, and it is also their React `key`, so a tab switch,
  // a focused subgrid, a cleared subgrid and the "Colour by" dropdown each
  // remount them. Remounting seeds the reveal at zero instead of painting the
  // previous scope's finished geometry for one frame before it collapses.
  const chartAnimKey = `${selectedTab}-${tabAnimKey}-${scopeLabel}-${cellCount}`;

  // A hovered slice reports its label, from the arc or from its legend row.
  const handleSliceHover = (label: string | null) => {
    if (!label) {
      setHoveredSlice(null);
      return;
    }
    setHoveredSlice(currentTabContent.sections[0].rows.find((r) => r.label === label) ?? null);
  };
  const totalsHint = selectedGrid
    ? `subgrid ${selectedGrid.subgrid} (${cellCount} mesh ${cellCount === 1 ? 'cell' : 'cells'}).`
    : `all ${cellCount} mesh ${cellCount === 1 ? 'cell' : 'cells'} in ${scopeLabel}.`;

  // Find active buffer metric option for display
  const currentMetricOption =
    CHOROPLETH_METRIC_OPTIONS.find((o) => o.tabKey === selectedTab) ||
    CHOROPLETH_METRIC_OPTIONS.find((o) => o.value === colorByMetric) ||
    CHOROPLETH_METRIC_OPTIONS[0];

  // Handler for Catchment tab clicks
  const handleSelectTab = (tabKey: CatchmentTabKey) => {
    setSelectedTab(tabKey);
    setTabAnimKey((k) => k + 1);
    setHoveredSlice(null);
    setHoveredColumn(null);
    const matching = CHOROPLETH_METRIC_OPTIONS.find((o) => o.tabKey === tabKey);
    if (matching) {
      onColorByMetricChange?.(matching.value);
      onPaletteChange(matching.palette);
    }
  };

  // Handler for dropdown selection
  const handleSelectMetricOption = (opt: ChoroplethMetricOption) => {
    onColorByMetricChange?.(opt.value);
    onPaletteChange(opt.palette);
    setSelectedTab(opt.tabKey);
    setTabAnimKey((k) => k + 1);
    setHoveredSlice(null);
    setHoveredColumn(null);
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
                onClick={() => onReset?.()}
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

          {/* Scope line. The focused-subgrid name and its clear affordance also live
              in the bottom pill, so the card does not repeat them. */}
            <div className="text-[11px] text-[var(--text-muted,#9BAAA9)] mt-0.5 flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  selectedGrid ? 'bg-sky-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span className="truncate">Scope: {scopeLabel}</span>
              {gridInfo && gridInfo.cellCount > 0 && (
                <span
                  className="shrink-0 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono text-[var(--text-muted,#9BAAA9)] whitespace-nowrap"
                  title={
                    `Density and complexity are measured per cell, so their magnitude depends on cell size.\n\n` +
                    `Grid: ${gridInfo.source === 'imported' ? 'imported layer' : 'derived automatically'} · ` +
                    `~${gridInfo.cellKm} km cells · ${gridInfo.cellCount} cells in scope.\n\n` +
                    `Values are comparable within this grid. A finer grid measures the same roads as a higher density.`
                  }
                >
                  {gridInfo.declared
                    ? `Declared ${gridInfo.cellKm} × ${gridInfo.cellKm} km`
                    : `${gridInfo.source === 'imported' ? 'Imported' : 'Derived'} grid · ~${gridInfo.cellKm} km`}{' '}
                  · {gridInfo.cellCount} cells
                </span>
              )}
            </div>

            {/* Grid size control. Meaning depends on which grid is in play: with an
                imported layer the declared size becomes the authoritative cell
                AREA (so a district-clipped edge cell cannot report a fraction of
                the real denominator and double its own density); with the derived
                fallback it sets the lattice step. */}
            {onGridSpecChange && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className="text-[10px] text-[var(--text-muted,#9BAAA9)] shrink-0"
                  title="Sets the mesh cell size. Density and complexity are measured per cell, so changing this changes those values and any class breaks set for the previous size may need re-fitting."
                >
                  {gridInfo?.source === 'imported' ? 'Declared cell size' : 'Grid size'}
                </span>
                <select
                  value={gridSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'custom') {
                      setCustomOpen(true);
                      return;
                    }
                    if (v === 'auto') {
                      onGridSpecChange({ derivedCellKm: null, importedCellKm: null });
                      setCustomOpen(false);
                      return;
                    }
                    const km = Number(v);
                    onGridSpecChange(
                      gridInfo?.source === 'imported'
                        ? { derivedCellKm: null, importedCellKm: km }
                        : { derivedCellKm: km, importedCellKm: null }
                    );
                    setCustomOpen(false);
                  }}
                  className="bg-[var(--bg-inner,rgba(255,255,255,0.05))] border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono text-[var(--text-primary,#EEF2F1)] cursor-pointer outline-none focus:border-sky-500/60"
                  title="Sets the mesh cell size. Density and complexity are measured per cell, so changing this changes those values."
                  aria-label="Grid cell size"
                >
                  <option value="auto">Auto</option>
                  {GRID_PRESETS_KM.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
                {customOpen && (
                  <span className="flex items-center gap-1">
                    <input
                      type="number"
                      min={GRID_MIN_KM}
                      max={GRID_MAX_KM}
                      step="0.1"
                      value={customDraft}
                      onChange={(e) => setCustomDraft(e.target.value)}
                      onBlur={() => commitCustomGrid(gridInfo?.source === 'imported')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitCustomGrid(gridInfo?.source === 'imported');
                      }}
                      placeholder="km"
                      aria-label="Custom grid size in kilometres"
                      className="w-14 bg-[var(--bg-inner,rgba(255,255,255,0.05))] border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono text-[var(--text-primary,#EEF2F1)] outline-none focus:border-sky-500/60"
                    />
                    <span className="text-[10px] text-[var(--text-muted,#9BAAA9)]">km</span>
                  </span>
                )}
              </div>
            )}

            {/* Density is understated wherever a cell was clamped up to the 0.5 km²
                area floor. Say so rather than let the floor quietly bias the read. */}
            {gridInfo?.areaFloored && (
              <div
                className="flex items-start gap-1.5 mt-1.5 px-2 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[10px] leading-snug text-amber-300/90"
                title="One or more mesh cells fell below the 0.5 km² minimum area and were measured against that floor. Their density (and the complexity derived from it) reads lower than the true value."
              >
                <AlertTriangle size={11} className="shrink-0 mt-px" />
                <span>
                  Some cells are under 0.5 km² and were measured against that floor, so their density
                  reads low.
                </span>
              </div>
            )}

              {/* Pill Tabs Row (Roads, Density, Complexity, Panotrack, Coverage) */}
              <div
                className="flex items-center gap-1 mt-2.5 overflow-x-auto no-scrollbar pb-1"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
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
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-[var(--text-primary,#EEF2F1)]">
                    {currentTabContent.primaryValue}
                  </span>
                  <span className="text-xs text-[var(--text-muted,#9BAAA9)] font-medium">
                    {currentTabContent.primaryUnit}
                  </span>
                </div>
              </div>
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

              {/* Hover readout, kept at a fixed height so the card never reflows. */}
              <div
                className={`flex items-center justify-between px-2 py-1 rounded-md text-[10px] min-h-[24px] transition-opacity duration-150 ${
                  hoveredSlice
                    ? 'bg-white/5 border border-white/10 opacity-100'
                    : 'opacity-0 border border-transparent pointer-events-none select-none'
                }`}
                aria-hidden={!hoveredSlice}
              >
                <span className="text-[var(--text-primary,#EEF2F1)] font-medium truncate max-w-[220px]">
                  {hoveredSlice ? hoveredSlice.label : ''}
                </span>
                <span className="font-mono font-bold text-sky-400">
                  {hoveredSlice
                    ? (hoveredSlice.displayValue ?? `${hoveredSlice.percentage}%`)
                    : ''}
                </span>
              </div>

              <DonutChart
                key={chartAnimKey}
                rows={currentTabContent.sections[0].rows}
                colors={EXPLORER_DONUT_COLORS}
                animKey={chartAnimKey}
                onSliceHover={handleSliceHover}
              />
            </div>

            {/* Section 2 Breakdown: choropleth class share columns */}
            <div className="space-y-1.5 pt-1 animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-xs pb-1 border-b border-[var(--divider,rgba(255,255,255,0.08))]">
                <span className="font-semibold text-[var(--text-primary,#EEF2F1)]">
                  {currentTabContent.sections[1].title}
                </span>
                <span className="text-[10px] text-[var(--text-muted,#9BAAA9)] font-mono">
                  {currentTabContent.sections[1].subtitleRight}
                </span>
              </div>

              {/* Hover readout, kept at a fixed height so the card never reflows. */}
              <div
                className={`flex items-center justify-between px-2 py-1 rounded-md text-[10px] min-h-[24px] transition-opacity duration-150 ${
                  hoveredColumn
                    ? 'bg-white/5 border border-white/10 opacity-100'
                    : 'opacity-0 border border-transparent pointer-events-none select-none'
                }`}
                aria-hidden={!hoveredColumn}
              >
                <span className="text-[var(--text-primary,#EEF2F1)] font-medium truncate max-w-[220px]">
                  {hoveredColumn ? hoveredColumn.label : ''}
                </span>
                <span className="font-mono font-bold text-sky-400">
                  {hoveredColumn ? (hoveredColumn.displayValue ?? `${hoveredColumn.percentage}%`) : ''}
                </span>
              </div>

              <ClassShareColumns
                key={chartAnimKey}
                rows={currentTabContent.sections[1].rows}
                colors={classColors(
                  resolveSetting(choroplethSettings, currentTabContent.key, palette)
                )}
                animKey={chartAnimKey}
                measureLabel={currentTabContent.sections[1].subtitleRight}
                caption={`${currentTabContent.sections[1].title} · ${currentTabContent.sections[1].subtitleRight}`}
                onHover={setHoveredColumn}
              />
            </div>

            {/* Footnote: where the numbers come from */}
            <div className="pt-2 border-t border-[var(--divider,rgba(255,255,255,0.08))] text-[9px] text-[var(--text-muted,#9BAAA9)] leading-relaxed">
              <div>Drawn from the active road network &amp; Panotrack survey data.</div>
              <div>
                Aggregated over {totalsHint}
              </div>
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

          {/* Class colours. Position i shows the colour the map actually paints on
              class i (reverse included), so the bar always matches the grid. */}
          <div className="flex w-full h-2.5 rounded-md overflow-hidden border border-white/20 mt-1.5 shadow-inner neu-choropleth-bar">
            {activeClassColors.map((color, idx) => (
              <div
                key={idx}
                className="flex-1 h-full border-r last:border-r-0 border-black/30 transition-transform hover:scale-105 neu-choropleth-segment"
                style={{ backgroundColor: color, opacity: activeSetting.alpha }}
                title={classRangeLabel(idx, activeSetting.classes)}
              />
            ))}
          </div>

          {/* Class break labels — same order as the colours above */}
          <div className="flex items-center justify-between text-[8px] font-mono text-[var(--text-muted,#9BAAA9)] mt-1 px-0.5">
            <span>0</span>
            {activeSetting.classes
              .slice(0, -1)
              .map((c, idx) => (
                <span key={idx}>
                  {c.upperBound ?? '—'}
                  {idx === activeSetting.classes.length - 2 ? '+' : ''}
                </span>
              ))}
          </div>

          <div className="flex items-center justify-between text-[8px] text-[var(--text-muted,#9BAAA9)] mt-1.5 border-t border-[var(--divider,rgba(255,255,255,0.1))] pt-1.5">
            <span className="flex items-center gap-1.5 text-[var(--text-primary,#EEF2F1)] min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate">{activeSetting.method === 'manual' ? 'Manual breaks' : activeSetting.method}</span>
            </span>
            <span className="font-mono text-[var(--text-muted,#9BAAA9)] shrink-0 ml-1">
              Class 1–{activeSetting.classes.length}
            </span>
          </div>
        </div>
      </div>

      {/* ── Bottom Floating Controls Bar ── */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1001] pointer-events-auto select-none">
        <div
          className="flex items-center gap-2.5 sm:gap-3 px-3 py-1.5 rounded-full border style-surface backdrop-blur-xl text-[11px]"
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-semibold text-[10.5px] shadow-sm text-sky-300"
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
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10.5px]"
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
          <div className="flex items-center gap-1.5 border-l border-[var(--divider,rgba(255,255,255,0.1))] pl-2.5">
            <span className="text-[var(--text-muted,#9BAAA9)] text-[10.5px] font-medium hidden sm:inline">Colour by</span>
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                aria-expanded={isDropdownOpen}
                aria-label="Colour by metric selection"
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all cursor-pointer text-[10.5px] font-semibold shadow-sm"
                style={{
                  backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.1))',
                  borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
                  color: 'var(--text-primary, #EEF2F1)'
                }}
              >
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
                    <span className="font-mono text-[9px] text-[var(--text-muted,#9BAAA9)] opacity-70">{CHOROPLETH_METRIC_OPTIONS.length} options</span>
                  </div>

                  <div className="space-y-0.5">
                    {CHOROPLETH_METRIC_OPTIONS.map((opt) => {
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

            {/* Symbol settings: class breaks, colours, ramp, opacity, reverse */}
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                aria-expanded={isSettingsOpen}
                aria-label="Choropleth symbol settings"
                title="Choropleth symbol settings"
                className="flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all cursor-pointer text-[10.5px] font-semibold shadow-sm"
                style={{
                  backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.1))',
                  borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
                  color: isSettingsOpen ? 'var(--text-primary, #EEF2F1)' : 'var(--text-muted, #9BAAA9)'
                }}
              >
                <SlidersHorizontal size={12} />
                <span className="hidden md:inline">Classes</span>
              </button>

              {isSettingsOpen && (
                <div className="absolute bottom-[calc(100%+10px)] right-0 z-[1003]">
                  <ChoroplethSettingsEditor
                    metric={activeMetric}
                    palette={palette}
                    settings={choroplethSettings || {}}
                    metricValues={choroplethValues?.[activeMetric] || []}
                    onApply={(setting) => onChoroplethSettingsChange?.(activeMetric, setting)}
                    onSave={(setting) => onChoroplethSettingsSave?.(activeMetric, setting)}
                    onPaletteChange={onPaletteChange}
                    onClose={() => setIsSettingsOpen(false)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
