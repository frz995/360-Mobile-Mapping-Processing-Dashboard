// =====================================================================
// Printable Road Analysis map export.
//
// Hosts a dedicated print-preview map (reusing <RoadAnalysisMap /> for
// 100% identical overlays) that the user can fit to:
//   1. The CURRENT MAP EXTENT  (reads the live map bounds via a ref)
//   2. A USER-DRAWN BOUNDING BOX   (custom pointer interaction + temp layer)
//   3. THE FULL SELECTED REGION    (district / points / roads union)
// Then captures the preview canvas at A4-landscape resolution and opens a
// print / save-as-PDF window styled like the Executive PDF report.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StyleSpecification, Map as MaplibreMap, LngLat } from 'maplibre-gl';
import { Crosshair, Maximize2, Printer, Loader2, Info, PanelsTopLeft } from 'lucide-react';
import { RoadAnalysisMap } from './RoadAnalysisMap';
import type { CatalogVectorLayer } from '../../utils/gisImportParser';
import type { SystemLayerStyles } from './RoadCatalogPanel';
import { minMaxOf } from '../../utils/arrayBounds';
import type { ExplorerChoroplethPalette } from '../../utils/projectExplorerGeometry';
import {
  classRangeLabel,
  resolveSetting,
  METRIC_UNIT,
  type ChoroplethSetting,
  type ChoroplethSettingsMap
} from '../../utils/choroplethSettings';
import { brandTitle } from '../../config/branding';

export interface RoadAnalysisPrintPointsSummary {
  published: number;
  staging: number;
  defect: number;
  total: number;
}

export interface RoadAnalysisPrintPanelProps {
  style?: string | StyleSpecification;
  districtGeojson?: any;
  dimmedRegionsGeojson?: any;
  capturedPoints?: Array<[number, number] | any>;
  roadRuns?: Array<Array<[number, number]>>;
  catalogLayers?: CatalogVectorLayer[];
  systemStyles?: SystemLayerStyles;
  showRoadLines?: boolean;
  /** Ref to the LIVE main workspace map (for the "Current extent" mode). */
  liveMapRef: React.MutableRefObject<MaplibreMap | null>;
  /** Ref into the print-preview <RoadAnalysisMap /> instance. */
  mapInstanceRef: React.MutableRefObject<MaplibreMap | null>;
  pointsSummary?: RoadAnalysisPrintPointsSummary;
  planDistanceKm?: number;
  capturedDistanceKm?: number;
  coverageRatio?: string | null;
  selectedStateName?: string;
  districtNames?: string[];
  basemapName?: string;
  /** Whether this panel is currently visible (active tab = print). */
  isActive?: boolean;
  onNotify?: (item: any) => void;
  /** Print subject: road-analysis overlays (default) or the Project Explorer choropleth. */
  variant?: 'road' | 'explorer';
  /** Explorer: currently colouring metric id (e.g. 'density'). */
  explorerMetric?: string;
  /** Explorer: human label for the active metric. */
  explorerMetricLabel?: string;
  /** Explorer: observed scope label (district grid or focused subgrid). */
  scopeLabel?: string;
  /** Explorer: number of mesh cells in scope. */
  explorerCellCount?: number;
  /** Explorer: palette used when no explicit class settings are supplied. */
  projectExplorerPalette?: ExplorerChoroplethPalette;
  /** Explorer: all metric class settings fed to the print map. */
  choroplethSettings?: ChoroplethSettingsMap;
  /** Explorer: subgrid metrics used to build the choropleth mesh. */
  subgridMetrics?: any[];
}

type ExtentMode = 'region' | 'live' | 'draw';
type LegendSwatch = 'line' | 'dot' | 'fill';
interface PrintLegendRow {
  color: string;
  label: string;
  swatch: LegendSwatch;
}

const BBOX_SOURCE_ID = 'print-bbox-source';
const BBOX_FILL_ID = 'print-bbox-fill';
const BBOX_LINE_ID = 'print-bbox-line';
const PRINT_W = 1100;
const PRINT_H = 760;

function clampLng(v: number) {
  return Math.max(-180, Math.min(180, v));
}
function clampLat(v: number) {
  return Math.max(-85, Math.min(85, v));
}

function rectToBbox(p: LngLat, q: LngLat): [number, number, number, number] {
  return [
    clampLng(Math.min(p.lng, q.lng)),
    clampLat(Math.min(p.lat, q.lat)),
    clampLng(Math.max(p.lng, q.lng)),
    clampLat(Math.max(p.lat, q.lat))
  ];
}

function bboxPolygon(bbox: [number, number, number, number]) {
  const [w, s, e, n] = bbox;
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            [
              [w, s], [e, s], [e, n], [w, n], [w, s]
            ]
          ]
        }
      }
    ]
  };
}

function unionBboxOf(
  districtGeojson?: any,
  capturedPoints: Array<[number, number] | any> = [],
  roadRuns: Array<Array<[number, number]>> = []
): [number, number, number, number] | null {
  const xs: number[] = [];
  const ys: number[] = [];

  if (districtGeojson?.features) {
    districtGeojson.features.forEach((f: any) => {
      const ring = f?.geometry?.coordinates;
      const walk = (coords: any) => {
        if (typeof coords?.[0] === 'number') {
          xs.push(coords[0]);
          ys.push(coords[1]);
        } else if (Array.isArray(coords)) {
          coords.forEach(walk);
        }
      };
      if (Array.isArray(ring)) walk(ring);
    });
  }
  capturedPoints.forEach((p) => {
    const lng = Array.isArray(p) ? p[0] : Number(p?.lng ?? p?.lon ?? p?.longitude);
    const lat = Array.isArray(p) ? p[1] : Number(p?.lat ?? p?.latitude);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      xs.push(lng);
      ys.push(lat);
    }
  });
  roadRuns.forEach((r) => r.forEach((pt) => {
    if (Array.isArray(pt) && pt.length >= 2) {
      xs.push(pt[0]);
      ys.push(pt[1]);
    }
  }));

  if (xs.length === 0 || ys.length === 0) return null;
  const [minX, maxX] = minMaxOf(xs);
  const [minY, maxY] = minMaxOf(ys);
  return [minX, minY, maxX, maxY];
}

function makeLegendRows(
  systemStyles?: SystemLayerStyles,
  catalogLayers: CatalogVectorLayer[] = [],
  points?: RoadAnalysisPrintPointsSummary
): PrintLegendRow[] {
  const rows: PrintLegendRow[] = [];
  if (systemStyles?.districtBoundary) {
    rows.push({ color: systemStyles.districtBoundary.color || '#94a3b8', label: 'District boundary', swatch: 'line' });
  }
  if (systemStyles?.roadPlan) {
    rows.push({ color: systemStyles.roadPlan.color || '#10b981', label: 'Road plan lines', swatch: 'line' });
  }
  catalogLayers.filter((l) => l.visible && (l.geojson || l.geojsonJson)).forEach((l) => {
    rows.push({ color: l.color || '#38bdf8', label: l.name, swatch: 'line' });
  });
  if (points) {
    rows.push({ color: '#10b981', label: `Panotrack published (${points.published})`, swatch: 'dot' });
    rows.push({ color: '#f59e0b', label: `Panotrack staging (${points.staging})`, swatch: 'dot' });
    if (points.defect > 0) {
      rows.push({ color: '#ef4444', label: `Panotrack defect (${points.defect})`, swatch: 'dot' });
    }
  }
  return rows;
}

/** Class-break legend for the Project Explorer choropleth. */
function makeExplorerLegendRows(setting?: ChoroplethSetting, metric?: string): PrintLegendRow[] {
  if (!setting?.classes?.length) return [];
  const unit = (metric && METRIC_UNIT[metric]) || '';
  return setting.classes.map((c, i) => ({
    color: c.color,
    label: classRangeLabel(i, setting.classes, unit),
    swatch: 'fill'
  }));
}

export const RoadAnalysisPrintPanel: React.FC<RoadAnalysisPrintPanelProps> = ({
  style,
  districtGeojson,
  dimmedRegionsGeojson,
  capturedPoints = [],
  roadRuns = [],
  catalogLayers = [],
  systemStyles,
  showRoadLines = true,
  liveMapRef,
  mapInstanceRef,
  pointsSummary = { published: 0, staging: 0, defect: 0, total: 0 },
  planDistanceKm = 0,
  capturedDistanceKm = 0,
  coverageRatio = null,
  selectedStateName = 'Malaysia',
  districtNames = [],
  basemapName = 'basemap',
  isActive = false,
  onNotify,
  variant = 'road',
  explorerMetric,
  explorerMetricLabel,
  scopeLabel,
  explorerCellCount = 0,
  projectExplorerPalette,
  choroplethSettings,
  subgridMetrics = []
}) => {
  const [mode, setMode] = useState<ExtentMode>('region');
  const [printBbox, setPrintBbox] = useState<[number, number, number, number] | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [lastPrintedAt, setLastPrintedAt] = useState<string | null>(null);

  const regionBbox = useMemo(
    () => unionBboxOf(districtGeojson, capturedPoints, roadRuns),
    [districtGeojson, capturedPoints, roadRuns]
  );

  const explorerSetting = useMemo(
    () =>
      variant === 'explorer'
        ? resolveSetting(choroplethSettings, explorerMetric || 'density', projectExplorerPalette)
        : undefined,
    [variant, choroplethSettings, explorerMetric, projectExplorerPalette]
  );

  const legendRows = useMemo(
    () =>
      variant === 'explorer'
        ? makeExplorerLegendRows(explorerSetting, explorerMetric)
        : makeLegendRows(systemStyles, catalogLayers, pointsSummary),
    [variant, explorerSetting, explorerMetric, systemStyles, catalogLayers, pointsSummary]
  );

  // ── Refs mirroring live state so the map pointer handlers stay stable ──
  const modeRef = useRef<ExtentMode>(mode);
  modeRef.current = mode;
  const drawingRef = useRef(false);
  const dragStartRef = useRef<LngLat | null>(null);

  const ensureDrawLayers = useCallback((map: MaplibreMap) => {
    if (!map.getSource(BBOX_SOURCE_ID)) {
      map.addSource(BBOX_SOURCE_ID, { type: 'geojson', data: bboxPolygon([0, 0, 0, 0]) });
      map.addLayer({
        id: BBOX_FILL_ID,
        type: 'fill',
        source: BBOX_SOURCE_ID,
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.22 }
      });
      map.addLayer({
        id: BBOX_LINE_ID,
        type: 'line',
        source: BBOX_SOURCE_ID,
        paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [2, 1] }
      });
    }
  }, []);

  const setBboxData = useCallback((map: MaplibreMap, bbox: [number, number, number, number]) => {
    const src = map.getSource(BBOX_SOURCE_ID) as any;
    if (src?.setData) src.setData(bboxPolygon(bbox));
  }, []);

  const clearBbox = useCallback((map: MaplibreMap) => {
    const src = map.getSource(BBOX_SOURCE_ID) as any;
    if (src?.setData) {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
    const fill = map.getLayer(BBOX_FILL_ID);
    const line = map.getLayer(BBOX_LINE_ID);
    if (fill) map.setLayoutProperty(BBOX_FILL_ID, 'visibility', 'none');
    if (line) map.setLayoutProperty(BBOX_LINE_ID, 'visibility', 'none');
  }, []);

  const fitMapToBbox = useCallback((bbox: [number, number, number, number]) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 36, maxZoom: 16 });
  }, [mapInstanceRef]);

  const handleDrawStart = useCallback((e: any) => {
    if (modeRef.current !== 'draw' || !e?.lngLat) return;
    drawingRef.current = true;
    dragStartRef.current = e.lngLat;
    setDrawing(true);
    const map = mapInstanceRef.current;
    if (map) {
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'crosshair';
    }
  }, [mapInstanceRef]);

  const handleDrawMove = useCallback((e: any) => {
    if (!drawingRef.current || !dragStartRef.current || !e?.lngLat) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const bbox = rectToBbox(dragStartRef.current, e.lngLat);
    ensureDrawLayers(map);
    setBboxData(map, bbox);
    const fill = map.getLayer(BBOX_FILL_ID);
    const line = map.getLayer(BBOX_LINE_ID);
    if (fill) map.setLayoutProperty(BBOX_FILL_ID, 'visibility', 'visible');
    if (line) map.setLayoutProperty(BBOX_LINE_ID, 'visibility', 'visible');
  }, [ensureDrawLayers, setBboxData, mapInstanceRef]);

  const handleDrawEnd = useCallback((e: any) => {
    if (!drawingRef.current || !dragStartRef.current) return;
    drawingRef.current = false;
    dragStartRef.current = null;
    setDrawing(false);
    const map = mapInstanceRef.current;
    if (!map) return;
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    const bbox = e?.lngLat
      ? rectToBbox(dragStartRef.current ?? e.lngLat, e.lngLat)
      : null;
    if (bbox) {
      setPrintBbox(bbox);
      fitMapToBbox(bbox);
    }
  }, [fitMapToBbox, mapInstanceRef]);

  // Attach draw handlers + ready detection once the preview map exists.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const onLoaded = () => {
      setMapReady(true);
      ensureDrawLayers(map);
    };
    if (map.isStyleLoaded()) onLoaded();
    else map.once('load', onLoaded);

    map.on('mousedown', handleDrawStart);
    map.on('mousemove', handleDrawMove);
    map.on('mouseup', handleDrawEnd);
    map.on('touchstart', handleDrawStart);
    map.on('touchmove', handleDrawMove);
    map.on('touchend', handleDrawEnd);

    return () => {
      map.off('mousedown', handleDrawStart);
      map.off('mousemove', handleDrawMove);
      map.off('mouseup', handleDrawEnd);
      map.off('touchstart', handleDrawStart);
      map.off('touchmove', handleDrawMove);
      map.off('touchend', handleDrawEnd);
    };
  }, [mapInstanceRef, handleDrawStart, handleDrawMove, handleDrawEnd, ensureDrawLayers]);

  // Apply the full-region extent once the map is ready (default view).
  useEffect(() => {
    if (!mapReady || !regionBbox) return;
    if (mode === 'region' && !printBbox) {
      setPrintBbox(regionBbox);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, regionBbox]);

  // ── Auto-sync: when the Print tab becomes active, capture the live map's
  //    current extent so the print preview immediately reflects what the user
  //    was just looking at.
  const prevActiveRef = useRef(false);
  useEffect(() => {
    const wasInactive = !prevActiveRef.current;
    prevActiveRef.current = isActive;
    if (!isActive || !wasInactive) return;
    // Never clobber a bbox the operator drew by hand — they bounce back to the
    // map to compare, and losing the drawn extent on return was surprising.
    if (modeRef.current === 'draw') return;
    // Small delay to let the print map resize into its container first.
    const timer = window.setTimeout(() => {
      const liveMap = liveMapRef.current;
      const printMap = mapInstanceRef.current;
      if (!liveMap || !printMap) return;
      const bounds = liveMap.getBounds();
      const bbox: [number, number, number, number] = [
        bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()
      ];
      setMode('live');
      setPrintBbox(bbox);
      printMap.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 36, maxZoom: 16 });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isActive, liveMapRef, mapInstanceRef]);

  // Always clear the temp bbox rectangle when leaving draw mode.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (mode !== 'draw') clearBbox(map);
  }, [mode, clearBbox, mapInstanceRef]);

  const selectLiveExtent = useCallback(() => {
    const liveMap = liveMapRef.current;
    if (!liveMap) {
      onNotify?.({
        id: `print-live-missing-${Date.now()}`,
        title: 'Print Extent',
        message: 'The map is not ready yet. Wait a moment and try again.',
        category: 'WARNING',
        read: false
      });
      return;
    }
    const bounds = liveMap.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()
    ];
    setMode('live');
    setPrintBbox(bbox);
    fitMapToBbox(bbox);
    onNotify?.({
      id: `print-live-${Date.now()}`,
      title: 'Print Extent',
      message: `Using current map extent — ${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)} → ${bbox[2].toFixed(4)}, ${bbox[3].toFixed(4)}.`,
      category: 'INFO',
      read: false
    });
  }, [liveMapRef, fitMapToBbox, onNotify]);

  const selectRegionExtent = useCallback(() => {
    if (!regionBbox) {
      onNotify?.({
        id: `print-region-missing-${Date.now()}`,
        title: 'Print Extent',
        message: 'No district / points / roads available to frame. Draw a bbox instead.',
        category: 'WARNING',
        read: false
      });
      return;
    }
    setMode('region');
    setPrintBbox(regionBbox);
    fitMapToBbox(regionBbox);
  }, [regionBbox, fitMapToBbox, onNotify]);

  const startDraw = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    setMode('draw');
    map.getCanvas().style.cursor = 'crosshair';
  }, [mapInstanceRef]);

  // ── Print capture ──────────────────────────────────────────────────
  const waitForSettle = useCallback((map: MaplibreMap) => new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      map.off('idle', done);
      resolve();
    };
    map.once('idle', done);
    // Hard cap so remote basemap tiles can never block printing forever.
    window.setTimeout(done, 2500);
  }), []);

  const buildPrintHtml = useCallback((dataUrl: string) => {
    const isExplorer = variant === 'explorer';
    const now = new Date();
    const generatedAt =
      now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) +
      ' • ' +
      now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const docRef = `${isExplorer ? 'GEO-PE' : 'GEO-RA'}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const docTitle = isExplorer ? 'Project Explorer Map' : 'Road Analysis Map';

    const legendHtml = legendRows
      .map((row) => {
        const swatch =
          row.swatch === 'dot'
            ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${row.color};margin-right:7px;"></span>`
            : row.swatch === 'fill'
              ? `<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:${row.color};margin-right:7px;"></span>`
              : `<span style="display:inline-block;width:22px;height:4px;border-radius:2px;background:${row.color};margin-right:7px;vertical-align:middle;"></span>`;
        return `<div style="display:flex;align-items:center;font-size:12px;color:#334155;margin-bottom:6px;">${swatch}${row.label}</div>`;
      })
      .join('');

    const metaRowHtml = isExplorer
      ? `<span class="meta-chip">Region: <b>${selectedStateName}</b></span>
    <span class="meta-chip">Scope: <b>${scopeLabel || 'all district subgrids'}</b></span>
    <span class="meta-chip">Metric: <b>${explorerMetricLabel || explorerMetric || '—'}</b></span>
    <span class="meta-chip">Basemap: <b>${basemapName}</b></span>
    <span class="meta-chip">Doc Ref: <b>${docRef}</b></span>
    <span class="meta-chip">Generated: <b>${generatedAt}</b></span>`
      : `<span class="meta-chip">Region: <b>${selectedStateName}</b></span>
    <span class="meta-chip">Districts: <b>${districtNames.length ? districtNames.join(', ') : '—'}</b></span>
    <span class="meta-chip">Basemap: <b>${basemapName}</b></span>
    <span class="meta-chip">Doc Ref: <b>${docRef}</b></span>
    <span class="meta-chip">Generated: <b>${generatedAt}</b></span>`;

    const summaryCardsHtml = (isExplorer
      ? [
          { k: 'Metric', v: explorerMetricLabel || explorerMetric || '—' },
          { k: 'Mesh Cells', v: (explorerCellCount ?? 0).toLocaleString() },
          { k: 'Classes', v: String(explorerSetting?.classes.length ?? 0) },
          { k: 'Scope', v: scopeLabel || 'All subgrids' },
          { k: 'Basemap', v: basemapName },
          { k: 'Generated', v: generatedAt.split(' • ')[1] || generatedAt }
        ]
      : [
          { k: 'Plan Length', v: `${planDistanceKm.toFixed(2)} km` },
          { k: 'Captured Length', v: `${capturedDistanceKm.toFixed(2)} km` },
          { k: 'Coverage', v: coverageRatio ?? '—' },
          { k: 'Survey Points', v: pointsSummary.total.toLocaleString() },
          { k: 'Published / Staging', v: `${pointsSummary.published} / ${pointsSummary.staging}` },
          { k: 'Defects', v: String(pointsSummary.defect) }
        ]
    )
      .map((c) => `<div class="summary-card"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`)
      .join('');

    const notesHtml = isExplorer
      ? `Project Explorer choropleth mesh classified by <b>${explorerMetricLabel || explorerMetric || 'metric'}</b> over ${scopeLabel || 'all district subgrids'}. Class breaks and colours reflect the current workspace choropleth settings.`
      : `Road network plan compared against captured Panotrack survey points per subgrid allocation.
      Boundary, road-plan and imported-layer symbology reflects the current workspace style settings.`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${brandTitle()} — ${docTitle}</title>
<style>
  @page { size: A4 landscape; margin: 10mm 12mm 12mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #ffffff; margin: 0; padding: 22px; font-size: 12px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .action-bar { display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: #fff; padding: 12px 20px; margin: -22px -22px 20px -22px; border-bottom: 1px solid #334155; }
  .action-bar-title { font-weight: 700; font-size: 13px; letter-spacing: 0.5px; }
  .print-btn { background: #ffffff; color: #0f172a; border: none; padding: 7px 16px; font-size: 11px; font-weight: 700; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; }
  .print-btn:hover { background: #e2e8f0; }
  .meta-row { display: flex; flex-wrap: wrap; gap: 8px 26px; margin-bottom: 14px; }
  .meta-chip { font-size: 11px; color: #475569; }
  .meta-chip b { color: #0f172a; }
  .map-frame { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #f8fafc; }
  .map-frame img { display: block; width: 100%; height: auto; }
  .summary-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin: 16px 0; }
  .summary-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
  .summary-card .k { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; }
  .summary-card .v { font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .lower-row { display: flex; gap: 28px; margin-top: 16px; }
  .legend-box { flex: 0 0 240px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
  .legend-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; margin-bottom: 10px; }
  .notes-box { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; font-size: 11px; color: #475569; }
  .notes-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; margin-bottom: 8px; }
  .footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="action-bar">
    <div class="action-bar-title">${brandTitle()} — ${docTitle}</div>
    <button class="print-btn" onclick="window.print()">PRINT / SAVE AS PDF</button>
  </div>

  <div class="meta-row">
    ${metaRowHtml}
  </div>

  <div class="map-frame">
    <img src="${dataUrl}" alt="${docTitle}" />
  </div>

  <div class="summary-grid">
    ${summaryCardsHtml}
  </div>

  <div class="lower-row">
    <div class="legend-box">
      <div class="legend-title">Map Legend</div>
      ${legendHtml}
    </div>
    <div class="notes-box">
      <div class="notes-title">Project Notes</div>
      ${notesHtml}
    </div>
  </div>

  <div class="footer">
    <span>${brandTitle()} ${isExplorer ? 'Project Explorer Module' : 'Road Analysis Module'}</span>
    <span>Generated by GIS Engineer — ${generatedAt}</span>
  </div>
</body>
</html>`;
  }, [
    variant,
    legendRows,
    selectedStateName,
    districtNames,
    basemapName,
    planDistanceKm,
    capturedDistanceKm,
    coverageRatio,
    pointsSummary,
    scopeLabel,
    explorerMetric,
    explorerMetricLabel,
    explorerCellCount,
    explorerSetting
  ]);

  const handlePrint = useCallback(async () => {
    const map = mapInstanceRef.current;
    if (!map) {
      onNotify?.({ id: `print-err-${Date.now()}`, title: 'Print Failed', message: 'Print map is not ready yet.', category: 'WARNING', read: false });
      return;
    }
    // Draw mode keeps the last dragged bbox; fall back to region.
    const targetBbox = printBbox ?? regionBbox;
    if (!targetBbox) {
      onNotify?.({ id: `print-nobb-${Date.now()}`, title: 'Print Failed', message: 'Define an extent first (current view, full region, or draw a bbox).', category: 'WARNING', read: false });
      return;
    }

    setCapturing(true);
    const container = map.getContainer();
    const origW = container.style.width;
    const origH = container.style.height;
    try {
      container.style.width = `${PRINT_W}px`;
      container.style.height = `${PRINT_H}px`;
      map.resize();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      fitMapToBbox(targetBbox);
      await waitForSettle(map);

      const dataUrl = map.getCanvas().toDataURL('image/png');

      const printWindow = window.open('', '_blank', 'width=1050,height=900');
      if (!printWindow) {
        onNotify?.({ id: `print-pop-${Date.now()}`, title: 'Print Blocked', message: 'Allow pop-ups to open the printable map window.', category: 'WARNING', read: false });
        setCapturing(false);
        return;
      }
      printWindow.document.write(buildPrintHtml(dataUrl));
      printWindow.document.close();

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastPrintedAt(timeStr);
      onNotify?.({
        id: `print-ok-${Date.now()}`,
        title: variant === 'explorer' ? 'Project Explorer Map Ready' : 'Road Analysis Map Ready',
        message: variant === 'explorer'
          ? `Printable explorer map generated (${selectedStateName}, ${scopeLabel || 'all subgrids'}, ${explorerMetricLabel || explorerMetric || 'metric'}). Use PRINT / SAVE AS PDF in the new window.`
          : `Printable map generated (${selectedStateName}, ${planDistanceKm.toFixed(2)} km plan). Use PRINT / SAVE AS PDF in the new window.`,
        category: 'SUCCESS',
        read: false
      });
    } catch (err) {
      console.warn('[RoadAnalysisPrint] capture failed:', err);
      onNotify?.({ id: `print-err-${Date.now()}`, title: 'Print Failed', message: String(err instanceof Error ? err.message : err), category: 'WARNING', read: false });
    } finally {
      container.style.width = origW || '';
      container.style.height = origH || '';
      map.resize();
      setCapturing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printBbox, regionBbox, fitMapToBbox, waitForSettle, buildPrintHtml, mapInstanceRef, onNotify, selectedStateName, planDistanceKm, variant, scopeLabel, explorerMetric, explorerMetricLabel]);

  const activeModeButton = (label: string, active: boolean, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer shadow-sm ${
        active
          ? 'bg-sky-500/20 border-sky-500/60 text-sky-300'
          : 'bg-card border-subtle text-text-base hover:border-sky-500/40 hover:text-sky-400'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
      {/* Print Preview Map (reuses the same overlay renderer as the main map) */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <RoadAnalysisMap
          active={isActive}
          showRoadLines={variant === 'explorer' ? true : showRoadLines}
          style={style}
          districtGeojson={districtGeojson}
          dimmedRegionsGeojson={dimmedRegionsGeojson}
          capturedPoints={capturedPoints}
          roadRuns={roadRuns}
          catalogLayers={catalogLayers}
          systemStyles={systemStyles}
          focusBbox={printBbox}
          mapInstanceRef={mapInstanceRef}
          projectExplorerActive={variant === 'explorer'}
          projectExplorerPalette={projectExplorerPalette}
          projectExplorerColorByMetric={explorerMetric}
          choroplethSettings={choroplethSettings}
          subgridMetrics={subgridMetrics}
        />

        {/* Extent Mode Toolbar */}
        <div
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--card-shadow)' }}
          className="absolute top-3 left-3 z-[1000] flex items-center gap-1.5 p-1.5 rounded-xl border backdrop-blur-md shadow-lg"
        >
          {activeModeButton('Full Region', mode === 'region', selectRegionExtent, <PanelsTopLeft size={12} />)}
          {activeModeButton('Current View', mode === 'live', selectLiveExtent, <Maximize2 size={12} />)}
          {activeModeButton('Draw BBox', mode === 'draw', startDraw, <Crosshair size={12} />)}
        </div>

        {/* Capturing badge */}
        {capturing && (
          <div className="absolute inset-0 z-[1100] flex items-center justify-center pointer-events-none">
            <div
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              className="px-4 py-2.5 rounded-xl border flex items-center gap-2.5 backdrop-blur-md shadow-xl"
            >
              <Loader2 size={14} className="text-sky-400 animate-spin shrink-0" />
              <span className="text-xs font-semibold">Rendering printable map…</span>
            </div>
          </div>
        )}

        {/* Draw mode hint */}
        {mode === 'draw' && (
          <div
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000] px-3 py-1.5 rounded-lg border backdrop-blur-md shadow-lg text-[10px] font-medium"
          >
            {drawing ? 'Release to finish the bounding box' : 'Drag on the map to draw the print bounding box'}
          </div>
        )}

        {/* Extent info pill */}
        {printBbox && (
          <div
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            className="absolute bottom-8 left-3 z-[1000] flex items-center gap-2 px-3 py-1.5 rounded-lg border backdrop-blur-md shadow-lg text-[10px] font-mono"
          >
            <Info size={11} className="text-sky-400 shrink-0" />
            <span>
              {mode === 'live' ? 'Current extent' : mode === 'draw' ? 'Drawn bbox' : 'Full region'} ·{' '}
              {printBbox[0].toFixed(4)}, {printBbox[1].toFixed(4)} → {printBbox[2].toFixed(4)}, {printBbox[3].toFixed(4)}
            </span>
          </div>
        )}

        {/* Legend overlay */}
        {legendRows.length > 0 && (
          <div
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
            className="absolute bottom-3 right-3 z-[1000] px-3 py-2 rounded-xl border backdrop-blur-md shadow-lg text-[10px]"
          >
            <div className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">Legend</div>
            {legendRows.map((row, i) => (
              <div key={`${row.label}-${i}`} className="flex items-center gap-2 py-0.5">
                {row.swatch === 'dot' ? (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                ) : row.swatch === 'fill' ? (
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: row.color }} />
                ) : (
                  <span className="w-4 h-0.5 rounded shrink-0" style={{ backgroundColor: row.color }} />
                )}
                <span className="text-text-muted">{row.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="shrink-0 px-3 py-2 border-t border-subtle bg-card flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] text-text-muted min-w-0">
          {/* The subject is derived from the Project Explorer, not chosen here, so
              state it outright — otherwise the preview silently changes subject
              depending on whether that panel happens to be open. */}
          <span
            className="shrink-0 px-1.5 py-0.5 rounded font-mono text-[9px] font-semibold uppercase tracking-wider border border-sky-500/40 bg-sky-500/10 text-sky-300"
            title={
              variant === 'explorer'
                ? 'Printing the Project Explorer choropleth (close the Explorer for the road-analysis map)'
                : 'Printing the road-analysis overlays'
            }
          >
            {variant === 'explorer' ? `Explorer · ${explorerMetricLabel || explorerMetric || 'metric'}` : 'Road Analysis'}
          </span>
          {lastPrintedAt ? (
            <span className="text-emerald-400 font-medium">Printed {lastPrintedAt}</span>
          ) : (
            <span className="truncate">
              Extent: {printBbox ? `${printBbox[0].toFixed(4)}, ${printBbox[1].toFixed(4)} → ${printBbox[2].toFixed(4)}, ${printBbox[3].toFixed(4)}` : 'Select an extent to print'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handlePrint}
          disabled={capturing || !mapReady}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold transition-all shadow-sm cursor-pointer ${
            capturing || !mapReady
              ? 'bg-sky-600 opacity-50 cursor-not-allowed text-white'
              : 'bg-sky-600 hover:bg-sky-500 text-white active:scale-95'
          }`}
        >
          {capturing ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
          <span>{capturing ? 'Rendering…' : 'Print / Save as PDF'}</span>
        </button>
      </div>
    </div>
  );
};

export default RoadAnalysisPrintPanel;