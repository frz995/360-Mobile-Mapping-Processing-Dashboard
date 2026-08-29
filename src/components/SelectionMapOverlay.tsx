// =====================================================================
// SelectionMapOverlay — selection layer rendered on top of a MapComponent
// (embedded map-dashboard iframe) canvas. In delete mode the operator can:
//   • Drag a bounding box to select subgrids
//   • Click a station point (the map app emits MAP_POINT_SELECTED) to add it
// Uses a screen↔geo linear-fit calibration sampled from MAP_COORDS events
// gated to the specific iframe this overlay belongs to.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MousePointerClick, MoveUpRight, Crosshair } from 'lucide-react';
import { extractSubgridName } from '../services/supabase';
import type { SelectedPointInfo, SubgridPointRow } from './DeletionSelectionMap';

interface GeoPoint { lat: number; lng: number; }
interface ScreenPoint { x: number; y: number; }
interface CalibrationSample extends GeoPoint { x: number; y: number; }
interface BBoxDraw { x1: number; y1: number; x2: number; y2: number; }

const EPS = 1e-6;

function buildLinearFit(samples: CalibrationSample[]) {
  if (samples.length < 2) return null;
  const origin = samples[0];
  let sy = 0, sy2 = 0, sx = 0, sx2 = 0, sLatDy = 0, sLngDx = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const dy = samples[i].y - origin.y;
    const dx = samples[i].x - origin.x;
    sy2 += dy * dy;
    sx2 += dx * dx;
    sLatDy += (samples[i].lat - origin.lat) * dy;
    sLngDx += (samples[i].lng - origin.lng) * dx;
    sy += dy;
    sx += dx;
  }
  if (sy2 === 0 && sx2 === 0) return null;
  const dLatDy = sy2 > 0 ? sLatDy / sy2 : 0;
  const dLngDx = sx2 > 0 ? sLngDx / sx2 : 0;
  if (Math.abs(dLatDy) < EPS && Math.abs(dLngDx) < EPS) return null;
  return {
    toGeo(p: ScreenPoint): GeoPoint {
      return { lat: origin.lat + dLatDy * (p.y - origin.y), lng: origin.lng + dLngDx * (p.x - origin.x) };
    }
  };
}

export interface SelectionMapOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  deletionMode: boolean;
  mode?: 'navigate' | 'select';
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAddSubgrids: (subgrids: string[], points?: SelectedPointInfo[]) => void;
  subgridPoints: SubgridPointRow[];
  availableSubgrids?: string[];
  selectedSubgrids: string[];
  onFlyTo?: (subgrid: string, points?: SelectedPointInfo[]) => void;
}

export const SelectionMapOverlay: React.FC<SelectionMapOverlayProps> = ({
  iframeRef,
  deletionMode,
  mode = 'select',
  containerRef,
  onAddSubgrids,
  subgridPoints,
  availableSubgrids = [],
  selectedSubgrids,
  onFlyTo
}) => {
  const [box, setBox] = useState<BBoxDraw | null>(null);
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const mousePosRef = useRef<ScreenPoint | null>(null);
  const coordsRef = useRef<GeoPoint | null>(null);
  const samplesRef = useRef<CalibrationSample[]>([]);
  const draggingRef = useRef(false);
  const isMiddlePanningRef = useRef(false);
  const lastPanPosRef = useRef<ScreenPoint | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  const availableSet = useMemo(() => {
    return new Set(availableSubgrids.map((s) => s.toUpperCase().trim()));
  }, [availableSubgrids]);

  const toLocal = useCallback(
    (clientX: number, clientY: number): ScreenPoint => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef]
  );

  const pushSample = useCallback(() => {
    const pos = mousePosRef.current;
    const geo = coordsRef.current;
    if (!pos || !geo) return;
    const next = [...samplesRef.current];
    const idx = next.findIndex((s) => Math.abs(s.x - pos.x) < 1 && Math.abs(s.y - pos.y) < 1);
    if (idx >= 0) next.splice(idx, 1);
    next.push({ ...pos, ...geo });
    if (next.length > 500) next.splice(0, next.length - 500);
    samplesRef.current = next;
    setCalibrationReady(next.length >= 2);
  }, []);

  const seedFromBounds = useCallback((bounds: { north: number; south: number; east: number; west: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    if (!Number.isFinite(bounds.north) || !Number.isFinite(bounds.south) || !Number.isFinite(bounds.east) || !Number.isFinite(bounds.west)) return;
    const w = rect.width;
    const h = rect.height;
    samplesRef.current = [
      { x: 0, y: 0, lat: bounds.north, lng: bounds.west },
      { x: w, y: 0, lat: bounds.north, lng: bounds.east },
      { x: w, y: h, lat: bounds.south, lng: bounds.east },
      { x: 0, y: h, lat: bounds.south, lng: bounds.west }
    ];
    setCalibrationReady(true);
    console.log('[SelectionOverlay] seedFromBounds', { bounds, w, h, samples: samplesRef.current.length });
  }, [containerRef]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!deletionMode) return;
      if (mode !== 'select') return;
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;

      if (e.data?.type === 'MAP_COORDS') {
        const lat = Number(e.data.lat);
        const lng = Number(typeof e.data.lng === 'number' ? e.data.lng : e.data.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coordsRef.current = { lat, lng };
          if (!isMiddlePanningRef.current && mousePosRef.current) pushSample();
        }
      } else if (e.data?.type === 'MAP_POINT_SELECTED') {
        const pt = e.data.point || e.data.payload;
        const rawSub = pt?.subgrid || pt?.filename || pt?.point_id || pt?.grid + pt?.cell || '';
        const sg = (extractSubgridName(rawSub) || rawSub || '').toUpperCase().trim();
        const filename = pt?.filename || pt?.imageFilename || pt?.image_url;
        const lat = Number(pt?.lat ?? pt?.latitude);
        const lng = Number(pt?.lng ?? pt?.longitude ?? pt?.lon);
        if (sg) {
          if (availableSet.size > 0 && !availableSet.has(sg)) {
            setToast(`Subgrid ${sg} does not exist in masterlist or daily survey data.`);
            setTimeout(() => setToast(null), 3500);
          } else {
            onAddSubgrids([sg], [{ subgrid: sg, filename, lat, lng }]);
            if (onFlyTo) onFlyTo(sg);
          }
        }
      } else if (e.data?.type === 'MAP_VIEW_STATE' && e.data.bounds) {
        seedFromBounds(e.data.bounds);
      } else if (e.data?.type === 'MAP_VIEW_STATE') {
        console.log('[SelectionOverlay] MAP_VIEW_STATE received without bounds', e.data);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [deletionMode, iframeRef, pushSample, availableSet, onAddSubgrids, onFlyTo, mode, seedFromBounds]);

  const finalizeBox = useCallback(
    (up?: ScreenPoint | null) => {
      draggingRef.current = false;
      const b = up && box ? { ...box, x2: up.x, y2: up.y } : box;
      setBox(null);
      if (!b) return;
      const fit = buildLinearFit(samplesRef.current);
      if (!fit) {
        console.log('[SelectionOverlay] bbox: buildLinearFit null, calibrationReady=', calibrationReady, 'samples=', samplesRef.current.length);
        setToast('Hover over the map first to calibrate, then draw a bounding box.');
        setTimeout(() => setToast(null), 3500);
        return;
      }
      const tl = fit.toGeo({ x: b.x1, y: b.y1 });
      const br = fit.toGeo({ x: b.x2, y: b.y2 });
      const latMin = Math.min(tl.lat, br.lat);
      const latMax = Math.max(tl.lat, br.lat);
      const lngMin = Math.min(tl.lng, br.lng);
      const lngMax = Math.max(tl.lng, br.lng);

      const matchedSubgrids = new Set<string>();
      const matchedPoints: SelectedPointInfo[] = [];
      (subgridPoints || []).forEach((row) => {
        const norm = row.subgrid.toUpperCase().trim();
        if (availableSet.size === 0 || availableSet.has(norm)) {
          (row.points || []).forEach((p) => {
            if (p.lat >= latMin - EPS && p.lat <= latMax + EPS && p.lng >= lngMin - EPS && p.lng <= lngMax + EPS) {
              matchedSubgrids.add(norm);
              matchedPoints.push({ subgrid: norm, filename: p.filename, pointId: p.pointId, lat: p.lat, lng: p.lng });
            }
          });
        }
      });

      console.log('[SelectionOverlay] bbox finalizeBox', { matchedSubgrids: Array.from(matchedSubgrids), subgridPoints: (subgridPoints || []).length, box: b });
      if (matchedSubgrids.size > 0) {
        const arr = Array.from(matchedSubgrids);
        onAddSubgrids(arr, matchedPoints);
        if (onFlyTo) onFlyTo(arr[0] || '', matchedPoints);
      } else {
        setToast('No existing subgrid records found inside the drawn boundary box.');
        setTimeout(() => setToast(null), 3500);
      }
    },
    [box, subgridPoints, onAddSubgrids, availableSet, onFlyTo]
  );

  const selectNearestAt = useCallback(
    (p: ScreenPoint) => {
      const fit = buildLinearFit(samplesRef.current);
      if (!fit) {
        console.log('[SelectionOverlay] click: buildLinearFit null, calibrationReady=', calibrationReady, 'samples=', samplesRef.current.length);
        setToast('Hover over the map first to calibrate, then click a station.');
        setTimeout(() => setToast(null), 3500);
        return;
      }
      const geo = fit.toGeo(p);
      const maxDist = 0.0004;
      const candidates = (subgridPoints || []).flatMap((row) => {
        const norm = row.subgrid.toUpperCase().trim();
        if (availableSet.size > 0 && !availableSet.has(norm)) return [];
        return (row.points || [])
          .filter((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lng))
          .map((pt) => ({
            subgrid: norm,
            filename: pt.filename,
            pointId: pt.pointId,
            lat: pt.lat,
            lng: pt.lng,
            dist: (pt.lat - geo.lat) * (pt.lat - geo.lat) + (pt.lng - geo.lng) * (pt.lng - geo.lng)
          }));
      });
      const best = candidates.filter((c) => c.dist < maxDist).sort((a, b) => a.dist - b.dist)[0];
      console.log('[SelectionOverlay] click selectNearestAt', { geo, candidates: candidates.length, subgridPoints: (subgridPoints || []).length, bestDist: best?.dist, bestSubgrid: best?.subgrid });
      if (!best) {
        setToast('No station point found near the click position.');
        setTimeout(() => setToast(null), 3500);
        return;
      }
      onAddSubgrids([best.subgrid], [{ subgrid: best.subgrid, filename: best.filename, pointId: best.pointId, lat: best.lat, lng: best.lng }]);
      if (onFlyTo) onFlyTo(best.subgrid);
    },
    [subgridPoints, availableSet, onAddSubgrids, onFlyTo]
  );

  const boxStyle = useMemo(() => {
    if (!box) return undefined;
    return {
      left: Math.min(box.x1, box.x2),
      top: Math.min(box.y1, box.y2),
      width: Math.abs(box.x2 - box.x1),
      height: Math.abs(box.y2 - box.y1)
    };
  }, [box]);

  if (!deletionMode) return null;

  return (
    <>
      <div
        className={`absolute inset-0 z-10 select-none ${mode === 'navigate' ? 'pointer-events-none' : ''} ${isPanning ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button === 1 || (e.button === 0 && (e.altKey || e.shiftKey))) {
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            isMiddlePanningRef.current = true;
            setIsPanning(true);
            lastPanPosRef.current = { x: e.clientX, y: e.clientY };
            setBox(null);
            return;
          }
          if (e.button === 0) {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            draggingRef.current = true;
            const p = toLocal(e.clientX, e.clientY);
            mousePosRef.current = p;
            startPointRef.current = { x: p.x, y: p.y };
            setBox({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
          }
        }}
        onPointerMove={(e) => {
          const p = toLocal(e.clientX, e.clientY);
          mousePosRef.current = p;
          if (draggingRef.current && !isMiddlePanningRef.current) {
            setBox((prev) => (prev ? { ...prev, x2: p.x, y2: p.y } : prev));
          }
        }}
        onPointerUp={(e) => {
          const p = toLocal(e.clientX, e.clientY);
          mousePosRef.current = p;
          if (isMiddlePanningRef.current) {
            isMiddlePanningRef.current = false;
            setIsPanning(false);
            return;
          }
          if (draggingRef.current) {
            draggingRef.current = false;
            const start = startPointRef.current;
            finalizeBox(p);
            // A drag with essentially no movement is treated as a plain click
            // (MAP_POINT_SELECTED from the map handles actual point clicks).
            if (start && Math.abs(p.x - start.x) < 4 && Math.abs(p.y - start.y) < 4) {
              selectNearestAt(p);
            }
          }
        }}
      >
        {box && (
          <div
            className="absolute z-20 border-2 border-rose-400 bg-rose-500/15 pointer-events-none rounded-sm animate-in fade-in duration-100 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
            style={boxStyle}
          />
        )}
      </div>

      {/* Status hint + selection chips (bottom-left) */}
      <div className="absolute bottom-2 left-2 z-30 pointer-events-none flex flex-col gap-1.5">
        {mode === 'navigate' ? (
          <span className="px-2.5 py-1.5 rounded-md text-[11px] font-medium text-white bg-slate-900/90 border border-white/15 flex items-center gap-1.5 shadow-md backdrop-blur-sm">
            <MoveUpRight size={11} className="text-white/80" /> Navigate mode - drag / wheel to pan & zoom
          </span>
        ) : (
          <>
            {calibrationReady ? (
              <span className="px-2.5 py-1.5 rounded-md text-[11px] font-medium text-white bg-slate-900/90 border border-white/15 flex items-center gap-1.5 shadow-md backdrop-blur-sm">
                <MoveUpRight size={11} className="text-white/80" /> Drag bbox or click station
              </span>
            ) : (
              <span className="px-2.5 py-1.5 rounded-md text-[11px] font-medium text-white bg-slate-900/90 border border-white/15 flex items-center gap-1.5 shadow-md backdrop-blur-sm">
                <MousePointerClick size={11} className="text-white/80" /> Hover to calibrate
              </span>
            )}
          </>
        )}
        <span className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white bg-slate-900/90 border border-white/15 flex items-center gap-1.5 shadow-md backdrop-blur-sm">
          <Crosshair size={11} className="text-white/80" /> Select Target
        </span>
        <span className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white bg-slate-900/90 border border-white/15 shadow-md backdrop-blur-sm">
          {selectedSubgrids.length} Selected
        </span>
      </div>

      {/* Validation toast */}
      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-lg bg-slate-900/95 text-white border border-white/15 text-[11px] font-semibold shadow-2xl pointer-events-none whitespace-nowrap backdrop-blur-sm">
          {toast}
        </div>
      )}
    </>
  );
};

export default SelectionMapOverlay;
