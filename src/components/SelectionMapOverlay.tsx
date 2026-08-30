// =====================================================================
// SelectionMapOverlay — selection layer rendered on top of MapComponent
// In delete mode the operator can:
//   • Drag a bounding box to dynamically select subgrid stations / points
//   • Click a station point on the map (native MAP_POINT_SELECTED) to select it
//   • Points are queried strictly by geographic bounding box within the active subgrid
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MousePointerClick, MoveUpRight, Crosshair } from 'lucide-react';
import { extractSubgridName } from '../services/supabase';
import type { SelectedPointInfo, SubgridPointRow } from './DeletionSelectionMap';

interface GeoPoint { lat: number; lng: number; }
interface ScreenPoint { x: number; y: number; }
interface CalibrationSample extends GeoPoint { x: number; y: number; }
interface BBoxDraw { x1: number; y1: number; x2: number; y2: number; }
interface MapBounds { north: number; south: number; east: number; west: number; }

export interface SelectionMapOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  deletionMode: boolean;
  mode?: 'navigate' | 'select';
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAddSubgrids: (subgrids: string[], points?: SelectedPointInfo[]) => void;
  subgridPoints: SubgridPointRow[];
  availableSubgrids?: string[];
  selectedSubgrids: string[];
  selectedPoints?: SelectedPointInfo[];
  onFlyTo?: (subgrid: string, points?: SelectedPointInfo[]) => void;
  subgridFilter?: string;
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
  selectedPoints = [],
  onFlyTo,
  subgridFilter
}) => {
  const [box, setBox] = useState<BBoxDraw | null>(null);
  const [calibrationReady, setCalibrationReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const mousePosRef = useRef<ScreenPoint | null>(null);
  const coordsRef = useRef<GeoPoint | null>(null);
  const samplesRef = useRef<CalibrationSample[]>([]);
  const currentBoundsRef = useRef<MapBounds | null>(null);
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
    const idx = next.findIndex((s) => Math.abs(s.x - pos.x) < 3 && Math.abs(s.y - pos.y) < 3);
    if (idx >= 0) next.splice(idx, 1);
    next.push({ ...pos, ...geo });
    if (next.length > 100) next.splice(0, next.length - 100);
    samplesRef.current = next;
    setCalibrationReady(next.length >= 2 || currentBoundsRef.current !== null);
  }, []);

  const seedFromBounds = useCallback((bounds: MapBounds) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 800;
    const h = rect?.height || 640;
    if (w <= 0 || h <= 0) return;
    if (!Number.isFinite(bounds.north) || !Number.isFinite(bounds.south) || !Number.isFinite(bounds.east) || !Number.isFinite(bounds.west)) return;
    currentBoundsRef.current = bounds;
    samplesRef.current = [
      { x: 0, y: 0, lat: bounds.north, lng: bounds.west },
      { x: w, y: 0, lat: bounds.north, lng: bounds.east },
      { x: w, y: h, lat: bounds.south, lng: bounds.east },
      { x: 0, y: h, lat: bounds.south, lng: bounds.west }
    ];
    setCalibrationReady(true);
  }, [containerRef]);

  const seedFromSubgridPoints = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 800;
    const h = rect?.height || 640;
    if (w <= 0 || h <= 0) return;

    const filteredRows = (subgridPoints || []).filter((r) => {
      if (!subgridFilter) return true;
      return r.subgrid.toUpperCase().trim() === subgridFilter.toUpperCase().trim();
    });

    const allPts = (filteredRows.length > 0 ? filteredRows : subgridPoints || [])
      .flatMap((r) => r.points || [])
      .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (allPts.length === 0) return;

    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;

    allPts.forEach((p) => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    });

    if (minLat >= maxLat || minLng >= maxLng) {
      minLat -= 0.005;
      maxLat += 0.005;
      minLng -= 0.005;
      maxLng += 0.005;
    }

    const padLat = Math.max(0.001, (maxLat - minLat) * 0.12);
    const padLng = Math.max(0.001, (maxLng - minLng) * 0.12);

    const n = maxLat + padLat;
    const s = minLat - padLat;
    const e = maxLng + padLng;
    const wst = minLng - padLng;

    const b = { north: n, south: s, east: e, west: wst };
    currentBoundsRef.current = b;
    samplesRef.current = [
      { x: 0, y: 0, lat: n, lng: wst },
      { x: w, y: 0, lat: n, lng: e },
      { x: w, y: h, lat: s, lng: e },
      { x: 0, y: h, lat: s, lng: wst }
    ];
    setCalibrationReady(true);
  }, [containerRef, subgridPoints, subgridFilter]);

  useEffect(() => {
    seedFromSubgridPoints();
  }, [seedFromSubgridPoints, subgridFilter]);

  // Global mouse tracker over container
  useEffect(() => {
    const onGlobalMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        mousePosRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
      }
    };
    window.addEventListener('mousemove', onGlobalMove, { passive: true });
    return () => window.removeEventListener('mousemove', onGlobalMove);
  }, [containerRef]);

  // Handle messages from the iframe map
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!deletionMode) return;
      if (iframeRef.current && iframeRef.current.contentWindow && e.source !== iframeRef.current.contentWindow) {
        return;
      }

      if (e.data?.type === 'MAP_COORDS') {
        const lat = Number(e.data.lat);
        const lng = Number(typeof e.data.lng === 'number' ? e.data.lng : e.data.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coordsRef.current = { lat, lng };
          if (mousePosRef.current) pushSample();
        }
      } else if (e.data?.type === 'MAP_POINT_SELECTED' || e.data?.type === 'POINT_SELECTED' || e.data?.type === 'PANORAMA_SELECTED') {
        const pt = e.data.point || e.data.payload || e.data;
        const rawSub = pt?.subgrid || pt?.filename || pt?.point_id || pt?.grid + pt?.cell || '';
        const sg = (extractSubgridName(rawSub) || rawSub || '').toUpperCase().trim();
        const filename = pt?.filename || pt?.imageFilename || pt?.image_url;
        const pointId = pt?.pointId || pt?.point_id || pt?.id;
        const lat = Number(pt?.lat ?? pt?.latitude);
        const lng = Number(pt?.lng ?? pt?.longitude ?? pt?.lon);
        if (sg) {
          if (availableSet.size > 0 && !availableSet.has(sg)) {
            setToast(`Subgrid ${sg} does not exist in masterlist or daily survey data.`);
            setTimeout(() => setToast(null), 3500);
          } else {
            onAddSubgrids([sg], [{ subgrid: sg, filename, pointId, lat, lng }]);
            setToast(`Selected station in subgrid ${sg}`);
            setTimeout(() => setToast(null), 2500);
            if (onFlyTo) onFlyTo(sg);
          }
        }
      } else if (e.data?.bounds) {
        seedFromBounds(e.data.bounds);
      } else if (e.data?.type === 'BBOX_POINTS_SELECTED') {
        const points = e.data.points || [];
        if (points.length > 0) {
          const matchedSubgrids = new Set<string>();
          const matchedPoints: SelectedPointInfo[] = [];

          points.forEach((pt: any) => {
            const rawSub = pt?.subgrid || pt?.filename || pt?.point_id || pt?.grid + pt?.cell || '';
            const sg = (extractSubgridName(rawSub) || rawSub || '').toUpperCase().trim();
            if (sg) {
              if (availableSet.size === 0 || availableSet.has(sg)) {
                matchedSubgrids.add(sg);
                matchedPoints.push({
                  subgrid: sg,
                  filename: pt.filename || pt.imageFilename || pt.image_url,
                  pointId: pt.pointId || pt.point_id || pt.id,
                  lat: Number(pt.lat ?? pt.latitude),
                  lng: Number(pt.lng ?? pt.longitude ?? pt.lon)
                });
              }
            }
          });

          if (matchedPoints.length > 0) {
            const arr = Array.from(matchedSubgrids);
            onAddSubgrids(arr, matchedPoints);
            setToast(`Selected ${matchedPoints.length} point(s) in ${arr.join(', ')}`);
            setTimeout(() => setToast(null), 3000);
            if (onFlyTo) onFlyTo(arr[0] || '', matchedPoints);
          } else {
            setToast('No survey points found inside the drawn box.');
            setTimeout(() => setToast(null), 3500);
          }
        } else {
          setToast('No survey points found inside the drawn box.');
          setTimeout(() => setToast(null), 3500);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [deletionMode, iframeRef, pushSample, availableSet, onAddSubgrids, onFlyTo, mode, seedFromBounds, subgridPoints]);

  // Dynamic Geographic Bounding Box Selection
  const finalizeBox = useCallback(
    (up?: ScreenPoint | null) => {
      draggingRef.current = false;
      const b = up && box ? { ...box, x2: up.x, y2: up.y } : box;
      setBox(null);
      if (!b) return;

      if (Math.abs(b.x2 - b.x1) < 5 && Math.abs(b.y2 - b.y1) < 5) return;

      const bounds = currentBoundsRef.current;
      if (!bounds || !Number.isFinite(bounds.north) || !Number.isFinite(bounds.south) || !Number.isFinite(bounds.east) || !Number.isFinite(bounds.west)) {
        seedFromSubgridPoints();
      }

      const activeBounds = currentBoundsRef.current;
      if (!activeBounds) {
        setToast('Calibrating map bounds... please draw selection box again.');
        setTimeout(() => setToast(null), 3500);
        return;
      }

      const minX = Math.min(b.x1, b.x2);
      const maxX = Math.max(b.x1, b.x2);
      const minY = Math.min(b.y1, b.y2);
      const maxY = Math.max(b.y1, b.y2);

      if (iframeRef.current && iframeRef.current.contentWindow) {
        console.log('[SelectionOverlay] sending QUERY_RENDERED_FEATURES', [[minX, minY], [maxX, maxY]]);
        iframeRef.current.contentWindow.postMessage({
          type: 'QUERY_RENDERED_FEATURES',
          bbox: [[minX, minY], [maxX, maxY]]
        }, '*');
      } else {
        setToast('Map not ready for selection.');
        setTimeout(() => setToast(null), 3500);
      }
    },
    [box, subgridPoints, onAddSubgrids, availableSet, onFlyTo, seedFromSubgridPoints, subgridFilter, containerRef]
  );

  // Click nearest station in geographic space
  const selectNearestAt = useCallback(
    (p: ScreenPoint) => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'QUERY_CLICK_FEATURE',
          point: [p.x, p.y]
        }, '*');
      }
    },
    [subgridPoints, availableSet, onAddSubgrids, onFlyTo, seedFromSubgridPoints, subgridFilter, containerRef]
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

  useEffect(() => {
    if (mode === 'navigate') {
      setBox(null);
      draggingRef.current = false;
      isMiddlePanningRef.current = false;
      setIsPanning(false);
    }
  }, [mode]);

  if (!deletionMode) return null;

  return (
    <>      {/* Interactive Selection Canvas */}
      {mode === 'select' && (
        <div
          className={`absolute inset-0 z-10 select-none ${isPanning ? 'cursor-grabbing' : 'cursor-crosshair'}`}
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
              if (start && Math.abs(p.x - start.x) < 4 && Math.abs(p.y - start.y) < 4) {
                selectNearestAt(p);
              }
            }
          }}
        >
          {box && (
            <div
              className="absolute z-20 border-2 border-sky-400 bg-sky-500/20 pointer-events-none rounded-sm animate-in fade-in duration-100 shadow-[0_0_15px_rgba(56,189,248,0.4)]"
              style={boxStyle}
            />
          )}
        </div>
      )}

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
                <MousePointerClick size={11} className="text-white/80" /> Ready to select
              </span>
            )}
          </>
        )}
        {mode !== 'navigate' && (
          <>
            <span className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white bg-slate-900/90 border border-white/15 flex items-center gap-1.5 shadow-md backdrop-blur-sm">
              <Crosshair size={11} className="text-sky-400" /> Dynamic Selection Active
            </span>
            <span className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white bg-slate-900/90 border border-white/15 shadow-md backdrop-blur-sm">
              {selectedPoints && selectedPoints.length > 0
                ? `${selectedPoints.length} Point(s) Selected`
                : selectedSubgrids.length > 0
                  ? `${selectedSubgrids.length} Subgrid(s) Selected`
                  : 'No Point Selected'}
            </span>
          </>
        )}
      </div>

      {/* Validation toast */}
      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-lg bg-slate-900/95 text-white border border-sky-400/30 text-[11px] font-semibold shadow-2xl pointer-events-none whitespace-nowrap backdrop-blur-sm">
          {toast}
        </div>
      )}
    </>
  );
};

export default SelectionMapOverlay;
