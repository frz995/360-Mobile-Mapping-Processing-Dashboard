import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Layers,
  Eye,
  EyeOff,
  Trash2,
  Maximize2,
  Minimize2,
  Route,
  Upload,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Table,
  Palette,
  Search,
  Download,
  X,
  Edit2,
  Check,
  MapPin,
  Tag,
  GripHorizontal
} from 'lucide-react';
import type { CatalogVectorLayer } from '../../utils/gisImportParser';

export interface SystemLayerStyles {
  districtBoundary: {
    visible: boolean;
    color: string;
    opacity: number;
    strokeWidth: number;
  };
  capturedPoints: {
    visible: boolean;
    opacity: number;
    pointRadius: number;
  };
  roadPlan: {
    visible: boolean;
    color: string;
    opacity: number;
    strokeWidth: number;
  };
}

export interface RoadCatalogPanelProps {
  catalogLayers: CatalogVectorLayer[];
  systemStyles: SystemLayerStyles;
  onUpdateSystemStyles: (updater: (prev: SystemLayerStyles) => SystemLayerStyles) => void;
  onUpdateCatalogLayer: (layerId: string, updates: Partial<CatalogVectorLayer>) => void;
  onRemoveCatalogLayer: (layerId: string) => void;
  onZoomToLayer: (bbox: [number, number, number, number]) => void;
  onSetAsActivePlan?: (layer: CatalogVectorLayer) => void;
  onNavigateToImport?: () => void;
  panotrackCount?: number;
  planDistanceKm?: number;
  activePlanName?: string;
  activeTableLayer?: CatalogVectorLayer | null;
  onOpenAttributeTable?: (layer: CatalogVectorLayer | null) => void;
}

// Curated 10-color GIS symbology palette with high map contrast
const PALETTE = [
  '#38bdf8', // Sky Blue
  '#10b981', // Emerald Green
  '#f59e0b', // Amber / Gold
  '#ef4444', // Red / Crimson
  '#8b5cf6', // Violet / Purple
  '#ec4899', // Pink / Magenta
  '#06b6d4', // Cyan / Teal
  '#f97316', // Orange
  '#f1f5f9', // Light Slate
  '#0f172a'  // Dark Navy
];

/**
 * Computes bounding box for a single GeoJSON feature.
 */
export function getFeatureBbox(feature: any): [number, number, number, number] | null {
  if (!feature || !feature.geometry) return null;
  const geom = feature.geometry;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const traverse = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const x = coords[0];
      const y = coords[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else {
      coords.forEach(traverse);
    }
  };

  traverse(geom.coordinates);
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

/**
 * Dynamic CSS properties for range slider thumb circle to follow selected color
 */
export function getSliderStyle(color?: string): React.CSSProperties {
  if (!color) return {};
  const glow = color.startsWith('#') && color.length === 7 ? `${color}40` : color;
  return {
    '--slider-thumb-color': color,
    '--slider-thumb-glow': glow,
    accentColor: color
  } as React.CSSProperties;
}

/**
 * Exports layer features and properties to a downloaded CSV file.
 */
export function exportLayerToCsv(layer: CatalogVectorLayer) {
  const features = layer.geojson?.features || [];
  if (features.length === 0) return;

  const colSet = new Set<string>();
  features.forEach((f: any) => {
    if (f.properties && typeof f.properties === 'object') {
      Object.keys(f.properties).forEach((k) => colSet.add(k));
    }
  });

  const cols = Array.from(colSet);
  const rows: string[] = [];
  rows.push(['#', ...cols].map((c) => `"${c.replace(/"/g, '""')}"`).join(','));

  features.forEach((f: any, idx: number) => {
    const props = f.properties || {};
    const row = [
      String(idx + 1),
      ...cols.map((c) => {
        const val = props[c] !== undefined && props[c] !== null ? String(props[c]) : '';
        return `"${val.replace(/"/g, '""')}"`;
      })
    ];
    rows.push(row.join(','));
  });

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${layer.name.replace(/\.[^/.]+$/, '')}_attributes.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Bottom-docked ArcGIS Attribute Table Drawer
 */
export interface RoadAttributeTableDrawerProps {
  layer: CatalogVectorLayer;
  onClose: () => void;
  onZoomToFeature: (bbox: [number, number, number, number]) => void;
  onSelectFeature?: (feature: any, index: number, bbox: [number, number, number, number] | null) => void;
  selectedFeature?: any;
}

export const RoadAttributeTableDrawer: React.FC<RoadAttributeTableDrawerProps> = ({
  layer,
  onClose,
  onZoomToFeature,
  onSelectFeature,
  selectedFeature
}) => {
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [drawerHeight, setDrawerHeight] = useState<number>(310);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [selectedFeatureIndex, setSelectedFeatureIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedFeature || !layer.geojson?.features) return;
    const idx = layer.geojson.features.findIndex(
      (f: any) => f === selectedFeature || (f.id !== undefined && f.id === selectedFeature.id)
    );
    if (idx !== -1) setSelectedFeatureIndex(idx);
  }, [selectedFeature, layer]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startY = e.clientY;
    const startH = drawerHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const minH = 160;
      const maxH = Math.max(minH, Math.min(window.innerHeight * 0.75, 750));
      setDrawerHeight(Math.max(minH, Math.min(maxH, startH + delta)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [drawerHeight]);

  const handleRowClick = (feat: any, idx: number, bbox: [number, number, number, number] | null) => {
    setSelectedFeatureIndex(idx);
    if (bbox) onZoomToFeature(bbox);
    onSelectFeature?.(feat, idx, bbox);
  };

  const tableData = useMemo(() => {
    if (!layer || !layer.geojson?.features) {
      return { columns: [], features: [], totalCount: 0 };
    }
    const features: any[] = layer.geojson.features;
    const colSet = new Set<string>();

    for (let i = 0; i < Math.min(features.length, 100); i++) {
      const p = features[i]?.properties;
      if (p && typeof p === 'object') {
        Object.keys(p).forEach((k) => colSet.add(k));
      }
    }
    const columns = Array.from(colSet);

    const q = tableSearchQuery.trim().toLowerCase();
    const filteredFeatures = q
      ? features.filter((f) => {
          const p = f.properties;
          if (!p) return false;
          return Object.values(p).some((val) =>
            String(val).toLowerCase().includes(q)
          );
        })
      : features;

    return { columns, features: filteredFeatures, totalCount: features.length };
  }, [layer, tableSearchQuery]);

  return (
    <div
      className="border-t flex flex-col shrink-0 relative"
      style={{
        height: `${drawerHeight}px`,
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border-subtle)',
        boxShadow: 'var(--card-shadow)',
        transition: isDragging ? 'none' : 'height 160ms ease-out'
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        className="w-full h-3.5 -mt-1.5 cursor-row-resize flex items-center justify-center group z-30 touch-none select-none"
        title="Drag up or down to adjust table height"
      >
        <GripHorizontal size={16} className="text-slate-400/50 group-hover:text-sky-400 transition-colors" />
      </div>

      <div
        className="px-4 py-2 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap select-none"
        style={{
          backgroundColor: 'var(--bg-inner)',
          borderColor: 'var(--border-subtle)'
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-6 h-6 rounded border flex items-center justify-center text-sky-400 shrink-0"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          >
            <Table size={13} />
          </div>
          <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
            {layer.name}
          </span>
          <span className="text-xs uppercase font-medium shrink-0" style={{ color: 'var(--text-muted)' }}>
            {layer.geometryType}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search attributes..."
              value={tableSearchQuery}
              onChange={(e) => setTableSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 rounded-lg text-xs w-40 sm:w-56 transition-all border outline-none focus:border-sky-500"
              style={{ backgroundColor: 'var(--input-bg, var(--bg-card))', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            />
          </div>

          <button
            type="button"
            onClick={() => exportLayerToCsv(layer)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
          >
            <Download size={12} className="text-sky-400" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setDrawerHeight((prev) => (prev > 340 ? 220 : 460))}
            className="p-1 rounded-lg border cursor-pointer"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            {drawerHeight > 340 ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg border cursor-pointer"
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {tableData.columns.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <Table size={28} className="opacity-40" />
            <span className="text-xs font-medium">No tabular attributes found.</span>
          </div>
        ) : tableData.features.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <Search size={24} className="opacity-40" />
            <span className="text-xs font-medium">No features match &quot;{tableSearchQuery}&quot;</span>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead
              className="sticky top-0 z-10 shadow-sm border-b select-none"
              style={{ backgroundColor: 'var(--table-header-bg, var(--bg-card))', borderColor: 'var(--border-subtle)' }}
            >
              <tr>
                <th className="py-2 px-3 font-semibold uppercase text-xs tracking-wider w-12 border-r text-center" style={{ color: 'var(--text-muted)', borderColor: 'var(--divider)' }}>#</th>
                <th className="py-2 px-3 font-semibold uppercase text-xs tracking-wider w-20 border-r text-center" style={{ color: 'var(--text-muted)', borderColor: 'var(--divider)' }}>Actions</th>
                {tableData.columns.map((col) => (
                  <th key={col} className="py-2 px-3 font-semibold uppercase text-xs tracking-wider border-r whitespace-nowrap" style={{ color: 'var(--text-muted)', borderColor: 'var(--divider)' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--divider)' }}>
              {tableData.features.slice(0, 500).map((feat, idx) => {
                const props = feat.properties || {};
                const bbox = getFeatureBbox(feat);
                const isSelected = selectedFeatureIndex === idx;

                return (
                  <tr
                    key={idx}
                    onClick={() => handleRowClick(feat, idx, bbox)}
                    className={`transition-colors cursor-pointer select-none ${
                      isSelected
                        ? 'bg-amber-400/25 hover:bg-amber-400/30 border-l-4 border-l-yellow-400'
                        : 'hover:bg-sky-500/10'
                    }`}
                  >
                    <td className="py-1.5 px-3 text-xs font-mono text-center border-r font-medium" style={{ color: isSelected ? '#fef08a' : 'var(--text-muted)', borderColor: isSelected ? 'rgba(250, 204, 21, 0.3)' : 'var(--divider)' }}>{idx + 1}</td>
                    <td className="py-1.5 px-3 text-center border-r" style={{ borderColor: isSelected ? 'rgba(250, 204, 21, 0.3)' : 'var(--divider)' }}>
                      {bbox ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRowClick(feat, idx, bbox); }}
                          className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors inline-flex items-center gap-1 cursor-pointer ${
                            isSelected ? 'bg-yellow-400/30 text-yellow-200 border-yellow-400/60' : 'text-sky-400 border-subtle hover:bg-sky-500/20'
                          }`}
                        >
                          <MapPin size={10} />
                          <span>Zoom</span>
                        </button>
                      ) : <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.4 }}>—</span>}
                    </td>
                    {tableData.columns.map((col) => (
                      <td key={col} className={`py-1.5 px-3 text-xs border-r max-w-xs truncate ${isSelected ? 'font-semibold' : ''}`} style={{ color: isSelected ? '#fef08a' : 'var(--text-primary)', borderColor: isSelected ? 'rgba(250, 204, 21, 0.3)' : 'var(--divider)' }}>
                        {props[col] !== undefined && props[col] !== null ? String(props[col]) : '—'}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div
        className="px-4 py-1.5 border-t flex items-center justify-between text-xs shrink-0 select-none"
        style={{ backgroundColor: 'var(--bg-inner)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        <span>
          Showing {Math.min(tableData.features.length, 500)} of {tableData.totalCount.toLocaleString()} feature(s)
        </span>
        {selectedFeatureIndex !== null && (
          <span className="font-semibold text-yellow-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span>Row #{selectedFeatureIndex + 1} selected</span>
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-0.5 rounded border text-xs font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)'
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export const RoadCatalogPanel: React.FC<RoadCatalogPanelProps> = ({
  catalogLayers,
  systemStyles,
  onUpdateSystemStyles,
  onUpdateCatalogLayer,
  onRemoveCatalogLayer,
  onZoomToLayer,
  onSetAsActivePlan,
  onNavigateToImport,
  panotrackCount = 0,
  planDistanceKm = 0,
  activePlanName,
  activeTableLayer,
  onOpenAttributeTable
}) => {
  const [showSystemSection, setShowSystemSection] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedSymbologyLayerId, setExpandedSymbologyLayerId] = useState<string | null>(null);
  const [fallbackTableLayer, setFallbackTableLayer] = useState<CatalogVectorLayer | null>(null);

  const currentTableLayer = activeTableLayer !== undefined ? activeTableLayer : fallbackTableLayer;

  const handleToggleTable = (layer: CatalogVectorLayer) => {
    if (onOpenAttributeTable) {
      onOpenAttributeTable(currentTableLayer?.id === layer.id ? null : layer);
    } else {
      setFallbackTableLayer((prev) => (prev?.id === layer.id ? null : layer));
    }
  };

  const startRename = (layer: CatalogVectorLayer) => {
    setEditingLayerId(layer.id);
    setEditingName(layer.name);
  };

  const saveRename = (layerId: string) => {
    if (editingName.trim()) {
      onUpdateCatalogLayer(layerId, { name: editingName.trim() });
    }
    setEditingLayerId(null);
  };

  // Render mini symbol legend swatch in layer list
  const renderMiniSwatch = (layer: CatalogVectorLayer) => {
    if (layer.geometryType === 'Polygon') {
      const isFilled = (layer.fillOpacity ?? 0.35) > 0;
      return (
        <div
          className="w-4 h-3.5 rounded-sm border shrink-0 transition-all shadow-sm"
          style={{
            backgroundColor: isFilled ? (layer.fillColor || layer.color) : 'transparent',
            borderColor: layer.color,
            borderWidth: '1.5px',
            borderStyle:
              layer.strokeStyle === 'dashed'
                ? 'dashed'
                : layer.strokeStyle === 'dotted'
                ? 'dotted'
                : 'solid',
            opacity: layer.visible ? 1 : 0.35
          }}
          title="Polygon symbol swatch"
        />
      );
    }
    if (layer.geometryType === 'Point') {
      return (
        <div
          className="w-3.5 h-3.5 rounded-full border shrink-0 transition-all shadow-sm"
          style={{
            backgroundColor: layer.color,
            borderColor: layer.pointStrokeColor || '#ffffff',
            borderWidth: '1.5px',
            opacity: layer.visible ? (layer.opacity ?? 0.85) : 0.35
          }}
          title="Point symbol swatch"
        />
      );
    }
    // LineString or Mixed
    return (
      <div
        className="w-4 h-2 flex items-center shrink-0"
        title="Line symbol swatch"
      >
        <div
          className="w-full transition-all"
          style={{
            borderTopWidth: `${Math.min(layer.strokeWidth ?? 2.5, 3)}px`,
            borderColor: layer.color,
            borderStyle:
              layer.strokeStyle === 'dashed'
                ? 'dashed'
                : layer.strokeStyle === 'dotted'
                ? 'dotted'
                : 'solid',
            opacity: layer.visible ? (layer.opacity ?? 0.85) : 0.35
          }}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3.5 p-0.5 text-xs text-text-base animate-in fade-in duration-300">
      {/* ------------------------------------------------------------- */}
      {/* SECTION 1: System Baseline Layers                            */}
      {/* ------------------------------------------------------------- */}
      <div>
        <h3 className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-1.5 px-0.5">
          System Baseline Layers
        </h3>
        <div className="border border-subtle rounded-lg overflow-hidden bg-inner/30">
          <button
            type="button"
            onClick={() => setShowSystemSection((v) => !v)}
            className="w-full px-3 py-1.5 flex items-center justify-between bg-inner/60 hover:bg-inner/90 transition-colors text-left text-[10px] font-semibold text-text-base cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Layers size={13} className="text-sky-400" />
              <span>Boundary, Points & Plan</span>
            </div>
            {showSystemSection ? (
              <ChevronDown size={14} className="text-text-muted" />
            ) : (
              <ChevronRight size={14} className="text-text-muted" />
            )}
          </button>

          {showSystemSection && (
            <div className="p-2.5 flex flex-col gap-3 border-t border-subtle bg-app/20">
              {/* 1. District Boundary */}
              <div className="p-2.5 rounded-lg bg-inner/40 border border-subtle flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          districtBoundary: {
                            ...prev.districtBoundary,
                            visible: !prev.districtBoundary.visible
                          }
                        }))
                      }
                      className={`p-1 rounded transition-colors ${
                        systemStyles.districtBoundary.visible
                          ? 'text-sky-400 hover:text-sky-300'
                          : 'text-text-muted/40 hover:text-text-muted'
                      }`}
                      title={systemStyles.districtBoundary.visible ? 'Hide boundary' : 'Show boundary'}
                    >
                      {systemStyles.districtBoundary.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <span className="text-[10px] font-semibold text-text-base">District Boundary</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={systemStyles.districtBoundary.color}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          districtBoundary: {
                            ...prev.districtBoundary,
                            color: e.target.value
                          }
                        }))
                      }
                      className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                      title="Change boundary stroke color"
                    />
                  </div>
                </div>

                {/* Clean, dedicated rows without colored text boxes */}
                <div className="flex flex-col gap-2 pt-2 border-t border-subtle/50">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-text-muted font-medium">Boundary Opacity</span>
                      <span className="font-mono text-text-base font-semibold">
                        {Math.round(systemStyles.districtBoundary.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={systemStyles.districtBoundary.opacity}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          districtBoundary: {
                            ...prev.districtBoundary,
                            opacity: parseFloat(e.target.value)
                          }
                        }))
                      }
                      style={getSliderStyle(systemStyles.districtBoundary.color)}
                      className="slider-sm"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-text-muted font-medium">Stroke Width</span>
                      <span className="font-mono text-text-base font-semibold">
                        {systemStyles.districtBoundary.strokeWidth} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="0.5"
                      value={systemStyles.districtBoundary.strokeWidth}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          districtBoundary: {
                            ...prev.districtBoundary,
                            strokeWidth: parseFloat(e.target.value)
                          }
                        }))
                      }
                      style={getSliderStyle(systemStyles.districtBoundary.color)}
                      className="slider-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Captured Panotrack Points */}
              <div className="p-2.5 rounded-lg bg-inner/40 border border-subtle flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          capturedPoints: {
                            ...prev.capturedPoints,
                            visible: !prev.capturedPoints.visible
                          }
                        }))
                      }
                      className={`p-1 rounded transition-colors ${
                        systemStyles.capturedPoints.visible
                          ? 'text-emerald-400 hover:text-emerald-300'
                          : 'text-text-muted/40 hover:text-text-muted'
                      }`}
                      title={systemStyles.capturedPoints.visible ? 'Hide survey points' : 'Show survey points'}
                    >
                      {systemStyles.capturedPoints.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <span className="text-[10px] font-semibold text-text-base">Panotrack Points</span>
                  </div>
                  <span className="text-[9px] text-text-muted font-mono">
                    {panotrackCount.toLocaleString()} pts
                  </span>
                </div>

                {/* Clean, dedicated rows without colored text boxes */}
                <div className="flex flex-col gap-2 pt-2 border-t border-subtle/50">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-text-muted font-medium">Point Opacity</span>
                      <span className="font-mono text-text-base font-semibold">
                        {Math.round(systemStyles.capturedPoints.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={systemStyles.capturedPoints.opacity}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          capturedPoints: {
                            ...prev.capturedPoints,
                            opacity: parseFloat(e.target.value)
                          }
                        }))
                      }
                      style={getSliderStyle('#10b981')}
                      className="slider-sm slider-emerald"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-text-muted font-medium">Point Radius</span>
                      <span className="font-mono text-text-base font-semibold">
                        {systemStyles.capturedPoints.pointRadius} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="8"
                      step="0.5"
                      value={systemStyles.capturedPoints.pointRadius}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          capturedPoints: {
                            ...prev.capturedPoints,
                            pointRadius: parseFloat(e.target.value)
                          }
                        }))
                      }
                      style={getSliderStyle('#10b981')}
                      className="slider-sm slider-emerald"
                    />
                  </div>
                </div>
              </div>

              {/* 3. Road Plan Baseline Lines */}
              <div className="p-2.5 rounded-lg bg-inner/40 border border-subtle flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          roadPlan: {
                            ...prev.roadPlan,
                            visible: !prev.roadPlan.visible
                          }
                        }))
                      }
                      className={`p-1 rounded transition-colors ${
                        systemStyles.roadPlan.visible
                          ? 'text-sky-400 hover:text-sky-300'
                          : 'text-text-muted/40 hover:text-text-muted'
                      }`}
                      title={systemStyles.roadPlan.visible ? 'Hide road plan' : 'Show road plan'}
                    >
                      {systemStyles.roadPlan.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <span className="text-[10px] font-semibold text-text-base">Road Plan Baseline</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {planDistanceKm > 0 && (
                      <span className="text-[9px] text-text-muted font-mono">
                        {planDistanceKm.toFixed(2)} km
                      </span>
                    )}
                    <input
                      type="color"
                      value={systemStyles.roadPlan.color}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          roadPlan: {
                            ...prev.roadPlan,
                            color: e.target.value
                          }
                        }))
                      }
                      className="w-4 h-4 rounded cursor-pointer border-0 bg-transparent p-0"
                      title="Change road plan color"
                    />
                  </div>
                </div>

                {/* Clean, dedicated rows without colored text boxes */}
                <div className="flex flex-col gap-2 pt-2 border-t border-subtle/50">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-text-muted font-medium">Plan Opacity</span>
                      <span className="font-mono text-text-base font-semibold">
                        {Math.round(systemStyles.roadPlan.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={systemStyles.roadPlan.opacity}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          roadPlan: {
                            ...prev.roadPlan,
                            opacity: parseFloat(e.target.value)
                          }
                        }))
                      }
                      style={getSliderStyle(systemStyles.roadPlan.color || '#10b981')}
                      className="slider-sm"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-text-muted font-medium">Plan Stroke Width</span>
                      <span className="font-mono text-text-base font-semibold">
                        {systemStyles.roadPlan.strokeWidth} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="8"
                      step="0.5"
                      value={systemStyles.roadPlan.strokeWidth}
                      onChange={(e) =>
                        onUpdateSystemStyles((prev) => ({
                          ...prev,
                          roadPlan: {
                            ...prev.roadPlan,
                            strokeWidth: parseFloat(e.target.value)
                          }
                        }))
                      }
                      style={getSliderStyle(systemStyles.roadPlan.color || '#10b981')}
                      className="slider-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* SECTION 2: User Imported Vector Layers (ArcGIS Symbology)    */}
      {/* ------------------------------------------------------------- */}
      <div className="flex flex-col gap-2.5 border-t border-divider pt-3">
        <div className="flex items-center justify-between px-0.5">
          <h3 className="text-[9px] font-bold uppercase tracking-widest text-text-muted">
            Imported Layers ({catalogLayers.length})
          </h3>
          {catalogLayers.length > 0 && (
            <span className="text-[9px] text-text-muted font-mono">
              {catalogLayers.reduce((acc, l) => acc + l.featureCount, 0).toLocaleString()} features
            </span>
          )}
        </div>

        {catalogLayers.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-subtle bg-inner/20 flex flex-col items-center justify-center text-center gap-2.5">
            <div className="w-10 h-10 rounded-full bg-inner/80 border border-subtle flex items-center justify-center text-text-muted">
              <Layers size={18} />
            </div>
            <div>
              <span className="text-xs font-semibold text-text-base block">No custom layers yet</span>
              <span className="text-xs text-text-muted block mt-0.5 max-w-[230px] mx-auto">
                Import KML, Shapefile (.zip), GeoJSON, or GPX files to customize symbology and inspect attributes.
              </span>
            </div>
            {onNavigateToImport && (
              <button
                type="button"
                onClick={onNavigateToImport}
                className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
              >
                <Upload size={13} />
                <span>Go to Import Tab</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {catalogLayers.map((layer) => {
              const isActivePlan = activePlanName === layer.name;
              const isSymbologyOpen = expandedSymbologyLayerId === layer.id;
              const isTableActive = currentTableLayer?.id === layer.id;

              return (
                <div
                  key={layer.id}
                  className={`rounded-xl border transition-all flex flex-col overflow-hidden ${
                    layer.visible
                      ? 'border-subtle bg-inner/40 hover:border-sky-500/40 shadow-sm'
                      : 'border-subtle/40 bg-inner/15 opacity-70'
                  }`}
                >
                  {/* Layer Header Bar */}
                  <div className="p-2.5 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {/* Visibility toggle */}
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateCatalogLayer(layer.id, { visible: !layer.visible })
                          }
                          className={`p-1 rounded transition-colors cursor-pointer ${
                            layer.visible
                              ? 'text-sky-400 hover:text-sky-300'
                              : 'text-text-muted/40 hover:text-text-muted'
                          }`}
                          title={layer.visible ? 'Hide layer' : 'Show layer'}
                        >
                          {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                        </button>

                        {/* Mini ArcGIS Symbol Legend Swatch */}
                        {renderMiniSwatch(layer)}

                        {/* Editable layer title */}
                        {editingLayerId === layer.id ? (
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <input
                              type="text"
                              value={editingName}
                              autoFocus
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveRename(layer.id);
                                if (e.key === 'Escape') setEditingLayerId(null);
                              }}
                              className="text-[11px] font-semibold bg-inner border border-sky-500 rounded px-1.5 py-0.5 text-text-base outline-none w-full"
                            />
                            <button
                              type="button"
                              onClick={() => saveRename(layer.id)}
                              className="p-1 text-emerald-400 hover:text-emerald-300 cursor-pointer"
                              title="Save name"
                            >
                              <Check size={13} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 min-w-0 flex-1 group">
                            <span
                              onDoubleClick={() => startRename(layer)}
                              className="text-[11px] font-semibold text-text-base truncate cursor-pointer hover:text-sky-400"
                              title="Double-click to rename"
                            >
                              {layer.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => startRename(layer)}
                              className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-sky-400 transition-opacity cursor-pointer shrink-0"
                              title="Rename layer"
                            >
                              <Edit2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Metadata summary (Clean, without redundant SHP_ZIP / format data name) */}
                    <div className="flex items-center justify-between text-[9px] text-text-muted px-0.5">
                      <span>{layer.featureCount} feature(s)</span>
                      {layer.totalDistanceKm && layer.totalDistanceKm > 0 ? (
                        <span>{layer.totalDistanceKm.toFixed(2)} km</span>
                      ) : null}
                    </div>

                    {/* ArcGIS Action Ribbon: Symbology, Table, Labels, Zoom, Plan, Delete (Symbol-only) */}
                    <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-subtle/50">
                      <div className="flex items-center gap-1">
                        {/* Symbology Toggle Button (Symbol only) */}
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSymbologyLayerId((prev) =>
                              prev === layer.id ? null : layer.id
                            )
                          }
                          className={`p-1.5 rounded border transition-all cursor-pointer ${
                            isSymbologyOpen
                              ? 'bg-inner border-sky-500 text-sky-400 shadow-sm'
                              : 'bg-inner/60 hover:bg-inner text-text-muted hover:text-sky-400 border-subtle'
                          }`}
                          title={isSymbologyOpen ? 'Close symbology styling' : 'Open symbology styling'}
                        >
                          <SlidersHorizontal size={12} />
                        </button>

                        {/* Attribute Table Button (Symbol only) */}
                        <button
                          type="button"
                          onClick={() => handleToggleTable(layer)}
                          className={`p-1.5 rounded border transition-colors cursor-pointer ${
                            isTableActive
                              ? 'bg-inner border-sky-500 text-sky-400 shadow-sm'
                              : 'bg-inner/60 hover:bg-inner text-text-muted hover:text-sky-400 border-subtle'
                          }`}
                          title={isTableActive ? 'Close attribute table' : 'Open attribute table'}
                        >
                          <Table size={12} />
                        </button>

                        {/* Feature Labeling Toggle Button (Symbol only) */}
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateCatalogLayer(layer.id, {
                              showLabels: !layer.showLabels
                            })
                          }
                          className={`p-1.5 rounded border transition-colors cursor-pointer ${
                            layer.showLabels
                              ? 'bg-inner border-sky-500 text-sky-400 shadow-sm'
                              : 'bg-inner/60 hover:bg-inner text-text-muted hover:text-sky-400 border-subtle'
                          }`}
                          title={layer.showLabels ? 'Hide feature labels on map' : 'Display feature labels on map'}
                        >
                          <Tag size={12} />
                        </button>

                        {/* Zoom to layer (Symbol only) */}
                        {layer.bbox && (
                          <button
                            type="button"
                            onClick={() => layer.bbox && onZoomToLayer(layer.bbox)}
                            className="p-1.5 rounded bg-inner/60 hover:bg-inner text-text-muted hover:text-sky-400 border border-subtle transition-colors cursor-pointer"
                            title="Zoom map to layer extent"
                          >
                            <Maximize2 size={12} />
                          </button>
                        )}

                        {/* Use as Road Plan baseline (Symbol only) */}
                        {layer.hasRoadLines && onSetAsActivePlan && (
                          <button
                            type="button"
                            onClick={() => onSetAsActivePlan(layer)}
                            className={`p-1.5 rounded border transition-colors cursor-pointer ${
                              isActivePlan
                                ? 'bg-inner border-emerald-500 text-emerald-400 shadow-sm'
                                : 'bg-inner/60 hover:bg-inner text-text-muted hover:text-emerald-400 border-subtle'
                            }`}
                            title={isActivePlan ? 'Currently active road plan' : 'Set as road plan baseline'}
                          >
                            <Route size={12} />
                          </button>
                        )}
                      </div>

                      {/* Remove Layer (Symbol only) */}
                      <button
                        type="button"
                        onClick={() => onRemoveCatalogLayer(layer.id)}
                        className="p-1.5 rounded text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0"
                        title="Delete layer from catalog"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* --------------------------------------------------------- */}
                  {/* EXPANDED ARCGIS SYMBOLOGY CUSTOMIZATION DRAWER           */}
                  {/* --------------------------------------------------------- */}
                  {isSymbologyOpen && (
                    <div className="p-2.5 bg-app/40 border-t border-subtle flex flex-col gap-3 animate-in slide-in-from-top-2 duration-200">
                      {/* 1. Stroke / Outline Styling */}
                      <div className="flex flex-col gap-2">
                        <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">
                          Stroke & Outline Style
                        </span>

                        {/* Curated Color Swatches (sleek w-3 h-3) */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-text-muted font-medium">Color:</span>
                          <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                            {PALETTE.map((c) => {
                              const isSelected = (layer.color || '').toLowerCase() === c.toLowerCase();
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => onUpdateCatalogLayer(layer.id, { color: c })}
                                  style={{ backgroundColor: c }}
                                  className={`w-3 h-3 rounded-full transition-all border shrink-0 cursor-pointer ${
                                    isSelected
                                      ? 'ring-1.5 ring-sky-400 ring-offset-1 ring-offset-slate-900 border-white scale-110 shadow-sm'
                                      : 'border-white/20 hover:scale-110 hover:border-white/60 opacity-85'
                                  }`}
                                  title={`Select color ${c}`}
                                />
                              );
                            })}
                            {/* Custom Color Input with Palette icon */}
                            <label
                              className="relative flex items-center justify-center w-3 h-3 rounded-full border border-dashed border-subtle hover:border-sky-400 bg-inner/60 cursor-pointer transition-colors"
                              title="Custom Hex Color"
                            >
                              <Palette size={7} className="text-text-muted hover:text-sky-400" />
                              <input
                                type="color"
                                value={layer.color || '#38bdf8'}
                                onChange={(e) =>
                                  onUpdateCatalogLayer(layer.id, { color: e.target.value })
                                }
                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                              />
                            </label>
                          </div>
                        </div>

                        {/* Dedicated Stroke Opacity Slider (Clean text, NO colored text box) */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[9px]">
                            <span className="text-text-muted font-medium">Stroke Opacity</span>
                            <span className="font-mono text-text-base font-semibold">
                              {Math.round((layer.opacity ?? 0.85) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.05"
                            max="1"
                            step="0.05"
                            value={layer.opacity ?? 0.85}
                            onChange={(e) =>
                              onUpdateCatalogLayer(layer.id, {
                                opacity: parseFloat(e.target.value)
                              })
                            }
                            style={getSliderStyle(layer.color)}
                            className="slider-sm"
                          />
                        </div>

                        {/* Dedicated Stroke Width Slider (Clean text, NO colored text box) */}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between text-[9px]">
                            <span className="text-text-muted font-medium">Stroke Width</span>
                            <span className="font-mono text-text-base font-semibold">
                              {layer.strokeWidth ?? 3} px
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="10"
                            step="0.5"
                            value={layer.strokeWidth ?? 3}
                            onChange={(e) =>
                              onUpdateCatalogLayer(layer.id, {
                                strokeWidth: parseFloat(e.target.value)
                              })
                            }
                            style={getSliderStyle(layer.color)}
                            className="slider-sm"
                          />
                        </div>

                        {/* Stroke Pattern Dash Buttons */}
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-text-muted font-medium">Line Pattern</span>
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { id: 'solid', label: 'Solid', preview: '————' },
                              { id: 'dashed', label: 'Dashed', preview: '- - -' },
                              { id: 'dotted', label: 'Dotted', preview: '· · ·' }
                            ].map((pat) => {
                              const isSelected = (layer.strokeStyle || 'solid') === pat.id;
                              return (
                                <button
                                  key={pat.id}
                                  type="button"
                                  onClick={() =>
                                    onUpdateCatalogLayer(layer.id, {
                                      strokeStyle: pat.id as any
                                    })
                                  }
                                  className={`flex items-center justify-center gap-1 py-0.5 px-1.5 rounded-md border text-[9px] font-medium transition-all cursor-pointer ${
                                    isSelected
                                      ? 'bg-inner border-sky-500/70 text-sky-400 font-semibold shadow-sm'
                                      : 'bg-inner/40 border-subtle text-text-muted hover:text-text-base hover:bg-inner'
                                  }`}
                                >
                                  <span className="font-mono text-[9px]">{pat.preview}</span>
                                  <span>{pat.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* 2. Polygon Fill Styling (For Polygon & Mixed layers) */}
                      {(layer.geometryType === 'Polygon' || layer.geometryType === 'Mixed') && (
                        <div className="flex flex-col gap-2 pt-2.5 border-t border-subtle/60">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">
                              Polygon Fill
                            </span>
                            {/* Hollow vs Filled mode - compact buttons matching system size */}
                            <div className="flex items-center bg-inner/60 p-0.5 rounded-lg border border-subtle">
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateCatalogLayer(layer.id, { fillOpacity: 0.35 })
                                }
                                className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors cursor-pointer ${
                                  (layer.fillOpacity ?? 0.35) > 0
                                    ? 'bg-inner border border-subtle text-text-base font-semibold shadow-sm'
                                    : 'text-text-muted hover:text-text-base'
                                }`}
                              >
                                Filled
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateCatalogLayer(layer.id, { fillOpacity: 0 })
                                }
                                className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors cursor-pointer ${
                                  (layer.fillOpacity ?? 0.35) === 0
                                    ? 'bg-inner border border-subtle text-text-base font-semibold shadow-sm'
                                    : 'text-text-muted hover:text-text-base'
                                }`}
                              >
                                Hollow
                              </button>
                            </div>
                          </div>

                          {(layer.fillOpacity ?? 0.35) > 0 && (
                            <>
                              {/* Fill Color Swatches (sleek w-3 h-3) */}
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between text-[9px]">
                                  <span className="text-text-muted font-medium">Fill Color:</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdateCatalogLayer(layer.id, { fillColor: layer.color })
                                    }
                                    className="text-[9px] text-sky-400 hover:text-sky-300 underline cursor-pointer"
                                  >
                                    Match stroke
                                  </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 py-0.5">
                                  {PALETTE.map((c) => {
                                    const isSelected =
                                      ((layer.fillColor || layer.color) || '').toLowerCase() ===
                                      c.toLowerCase();
                                    return (
                                      <button
                                        key={c}
                                        type="button"
                                        onClick={() =>
                                          onUpdateCatalogLayer(layer.id, { fillColor: c })
                                        }
                                        style={{ backgroundColor: c }}
                                        className={`w-3 h-3 rounded-full transition-all border shrink-0 cursor-pointer ${
                                          isSelected
                                            ? 'ring-1.5 ring-sky-400 ring-offset-1 ring-offset-slate-900 border-white scale-110 shadow-sm'
                                            : 'border-white/20 hover:scale-110 opacity-85'
                                        }`}
                                        title={`Select fill color ${c}`}
                                      />
                                    );
                                  })}
                                  <label
                                    className="relative flex items-center justify-center w-3 h-3 rounded-full border border-dashed border-subtle hover:border-sky-400 bg-inner/60 cursor-pointer transition-colors"
                                    title="Custom Fill Color"
                                  >
                                    <Palette size={7} className="text-text-muted hover:text-sky-400" />
                                    <input
                                      type="color"
                                      value={layer.fillColor || layer.color || '#38bdf8'}
                                      onChange={(e) =>
                                        onUpdateCatalogLayer(layer.id, {
                                          fillColor: e.target.value
                                        })
                                      }
                                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                    />
                                  </label>
                                </div>
                              </div>

                              {/* Fill Opacity Slider (Clean text, NO colored text box) */}
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between text-[9px]">
                                  <span className="text-text-muted font-medium">Fill Opacity</span>
                                  <span className="font-mono text-text-base font-semibold">
                                    {Math.round((layer.fillOpacity ?? 0.35) * 100)}%
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0.05"
                                  max="1"
                                  step="0.05"
                                  value={layer.fillOpacity ?? 0.35}
                                  onChange={(e) =>
                                    onUpdateCatalogLayer(layer.id, {
                                      fillOpacity: parseFloat(e.target.value)
                                    })
                                  }
                                  style={getSliderStyle(layer.fillColor || layer.color)}
                                  className="slider-sm"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* 3. Point Marker Styling (For Point & Mixed layers) */}
                      {(layer.geometryType === 'Point' || layer.geometryType === 'Mixed') && (
                        <div className="flex flex-col gap-2 pt-2.5 border-t border-subtle/60">
                          <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">
                            Point Marker
                          </span>

                          {/* Point Radius Slider (Clean text, NO colored text box) */}
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="text-text-muted font-medium">Marker Radius</span>
                              <span className="font-mono text-text-base font-semibold">
                                {layer.pointRadius ?? 6} px
                              </span>
                            </div>
                            <input
                              type="range"
                              min="2"
                              max="16"
                              step="0.5"
                              value={layer.pointRadius ?? 6}
                              onChange={(e) =>
                                onUpdateCatalogLayer(layer.id, {
                                  pointRadius: parseFloat(e.target.value)
                                })
                              }
                              style={getSliderStyle(layer.color)}
                              className="slider-sm"
                            />
                          </div>

                          {/* Point Halo Outline */}
                          <div className="flex items-center justify-between text-[9px]">
                            <span className="text-text-muted font-medium">Halo Outline:</span>
                            <div className="flex items-center gap-1.5">
                              {['#ffffff', '#0f172a', '#38bdf8'].map((hc) => (
                                <button
                                  key={hc}
                                  type="button"
                                  onClick={() =>
                                    onUpdateCatalogLayer(layer.id, { pointStrokeColor: hc })
                                  }
                                  style={{ backgroundColor: hc }}
                                  className={`w-3 h-3 rounded-full border border-white/20 cursor-pointer ${
                                    (layer.pointStrokeColor || '#ffffff') === hc
                                      ? 'ring-1.5 ring-sky-400 ring-offset-1 ring-offset-slate-900 scale-110'
                                      : 'opacity-70 hover:opacity-100'
                                  }`}
                                  title={`Halo color ${hc}`}
                                />
                              ))}
                              <span className="font-mono text-[9px] text-text-muted">
                                {layer.pointStrokeWidth ?? 1.5} px
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 4. Feature Name Labels on Map */}
                      <div className="flex flex-col gap-2 pt-2.5 border-t border-subtle/60">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">
                            Feature Labels
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateCatalogLayer(layer.id, {
                                showLabels: !layer.showLabels
                              })
                            }
                            className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors cursor-pointer ${
                              layer.showLabels
                                ? 'bg-inner border border-sky-500/70 text-sky-400 font-semibold shadow-sm'
                                : 'text-text-muted hover:text-text-base border border-subtle'
                            }`}
                          >
                            {layer.showLabels ? 'Enabled' : 'Disabled'}
                          </button>
                        </div>

                        {layer.showLabels && (
                          <div className="flex flex-col gap-2 bg-inner/20 rounded-md p-2 border border-subtle/40">
                            {/* Label Field */}
                            {(() => {
                              const sampleFeat = layer.geojson?.features?.[0];
                              const propKeys = sampleFeat?.properties
                                ? Object.keys(sampleFeat.properties)
                                : [];
                              if (propKeys.length === 0) return null;
                              const currentField =
                                layer.labelField ||
                                propKeys.find((k) =>
                                  /^(name|label|id|title|station|grid|district|code)/i.test(k)
                                ) ||
                                propKeys[0];
                              return (
                                <div className="flex items-center justify-between text-[9px]">
                                  <span className="text-text-muted font-medium">Field</span>
                                  <select
                                    value={currentField}
                                    onChange={(e) =>
                                      onUpdateCatalogLayer(layer.id, { labelField: e.target.value })
                                    }
                                    className="bg-inner border border-subtle rounded px-1.5 py-0.5 text-[9px] text-text-base outline-none cursor-pointer focus:border-sky-500 max-w-[130px]"
                                  >
                                    {propKeys.map((pk) => (
                                      <option key={pk} value={pk}>{pk}</option>
                                    ))}
                                  </select>
                                </div>
                              );
                            })()}

                            {/* Font Size */}
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between text-[9px]">
                                <span className="text-text-muted font-medium">Font Size</span>
                                <span className="font-mono text-text-base font-semibold">{layer.labelSize ?? 11} px</span>
                              </div>
                              <input
                                type="range"
                                min="8" max="22" step="1"
                                value={layer.labelSize ?? 11}
                                onChange={(e) =>
                                  onUpdateCatalogLayer(layer.id, { labelSize: parseInt(e.target.value, 10) })
                                }
                                style={getSliderStyle(layer.labelColor || layer.color)}
                                className="slider-sm"
                              />
                            </div>

                            {/* Text Color */}
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="text-text-muted font-medium">Text Color</span>
                              <div className="flex items-center gap-1.5">
                                {['#f8fafc', '#facc15', '#38bdf8', '#34d399', '#f87171', '#c084fc', '#fb923c', '#0f172a'].map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => onUpdateCatalogLayer(layer.id, { labelColor: c })}
                                    style={{ backgroundColor: c, border: (layer.labelColor || '#f8fafc') === c ? '2px solid #38bdf8' : '1.5px solid rgba(255,255,255,0.15)' }}
                                    className={`w-3 h-3 rounded-full cursor-pointer transition-transform ${(layer.labelColor || '#f8fafc') === c ? 'scale-125' : 'opacity-70 hover:opacity-100'}`}
                                    title={c}
                                  />
                                ))}
                                <label className="w-3 h-3 rounded-full overflow-hidden cursor-pointer border border-white/20 flex items-center justify-center" title="Custom color">
                                  <input
                                    type="color"
                                    value={layer.labelColor || '#f8fafc'}
                                    onChange={(e) => onUpdateCatalogLayer(layer.id, { labelColor: e.target.value })}
                                    className="opacity-0 absolute w-0 h-0"
                                  />
                                  <Palette size={7} className="text-text-muted" />
                                </label>
                              </div>
                            </div>

                            {/* Halo Color */}
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="text-text-muted font-medium">Halo Color</span>
                              <div className="flex items-center gap-1.5">
                                {['#090d16', '#0f172a', '#ffffff', '#facc15', '#0ea5e9', '#000000'].map((c) => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => onUpdateCatalogLayer(layer.id, { labelHaloColor: c })}
                                    style={{ backgroundColor: c, border: (layer.labelHaloColor || '#090d16') === c ? '2px solid #38bdf8' : '1.5px solid rgba(255,255,255,0.15)' }}
                                    className={`w-3 h-3 rounded-full cursor-pointer transition-transform ${(layer.labelHaloColor || '#090d16') === c ? 'scale-125' : 'opacity-70 hover:opacity-100'}`}
                                    title={c}
                                  />
                                ))}
                                <label className="w-3 h-3 rounded-full overflow-hidden cursor-pointer border border-white/20 flex items-center justify-center" title="Custom halo">
                                  <input
                                    type="color"
                                    value={layer.labelHaloColor || '#090d16'}
                                    onChange={(e) => onUpdateCatalogLayer(layer.id, { labelHaloColor: e.target.value })}
                                    className="opacity-0 absolute w-0 h-0"
                                  />
                                  <Palette size={7} className="text-text-muted" />
                                </label>
                              </div>
                            </div>

                            {/* Halo Width */}
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between text-[9px]">
                                <span className="text-text-muted font-medium">Halo Width</span>
                                <span className="font-mono text-text-base font-semibold">{layer.labelHaloWidth ?? 2} px</span>
                              </div>
                              <input
                                type="range"
                                min="0" max="5" step="0.5"
                                value={layer.labelHaloWidth ?? 2}
                                onChange={(e) =>
                                  onUpdateCatalogLayer(layer.id, { labelHaloWidth: parseFloat(e.target.value) })
                                }
                                style={getSliderStyle(layer.labelHaloColor || '#090d16')}
                                className="slider-sm"
                              />
                            </div>

                            {/* Bold + Min Zoom row */}
                            <div className="flex items-center justify-between text-[9px]">
                              <button
                                type="button"
                                onClick={() => onUpdateCatalogLayer(layer.id, { labelBold: !layer.labelBold })}
                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer transition-colors ${
                                  layer.labelBold
                                    ? 'bg-sky-500/20 border-sky-500/60 text-sky-300 font-bold'
                                    : 'text-text-muted border-subtle hover:text-text-base'
                                }`}
                              >
                                <span className="font-bold text-[9px]">B</span>
                                <span>Bold</span>
                              </button>
                              <div className="flex items-center gap-1.5">
                                <span className="text-text-muted font-medium">Min Zoom</span>
                                <select
                                  value={layer.labelMinZoom ?? 0}
                                  onChange={(e) =>
                                    onUpdateCatalogLayer(layer.id, { labelMinZoom: Number(e.target.value) })
                                  }
                                  className="bg-inner border border-subtle rounded px-1 py-0.5 text-[9px] text-text-base outline-none cursor-pointer focus:border-sky-500"
                                >
                                  {[0, 5, 7, 9, 10, 11, 12, 13, 14, 15].map((z) => (
                                    <option key={z} value={z}>z{z}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fallback standalone attribute table drawer if not hosted by parent */}
      {!onOpenAttributeTable && fallbackTableLayer && (
        <div className="fixed bottom-0 left-0 right-0 z-[1200] shadow-2xl">
          <RoadAttributeTableDrawer
            layer={fallbackTableLayer}
            onClose={() => setFallbackTableLayer(null)}
            onZoomToFeature={onZoomToLayer}
          />
        </div>
      )}
    </div>
  );
};
