// =====================================================================
// DeletionSelectionMap — embedded WebGIS coverage map used for spatial
// safe-deletion selection. In deletion mode the user can either:
//   • click a station point on the map (WebGIS broadcasts
//     MAP_POINT_SELECTED with a subgrid), or
//   • drag a bounding box over the map (app-side overlay; screen pixels
//     are mapped to lat/lng with a linear fit calibrated from the live
//     MAP_COORDS cursor stream) to select every subgrid in the box.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, MousePointerClick, MoveUpRight } from 'lucide-react';
import { extractSubgridName } from '../services/supabase';

export interface SubgridPointRow {
  subgrid: string;
  points: Array<{ lat: number; lng: number }>;
}

interface GeoPoint {
  lat: number;
  lng: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface CalibrationSample extends GeoPoint {
  x: number;
  y: number;
}

interface BBoxDraw {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface DeletionSelectionMapProps {
  deletionMode: boolean;
  selectedSubgrids: string[];
  onAddSubgrids: (subgrids: string[]) => void;
  onRemoveSubgrid: (subgrid: string) => void;
  onClear: () => void;
  subgridPoints: SubgridPointRow[];
  focusSubgrid?: string | null;
  className?: string;
}

const EPS = 1e-6;

function buildLinearFit(samples: CalibrationSample[]) {
  if (samples.length < 2) return null;
  const origin = samples[0];
  let sy = 0;
  let sy2 = 0;
  let sx = 0;
  let sx2 = 0;
  let sLatDy = 0;
  let sLngDx = 0;
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
      return {
        lat: origin.lat + dLatDy * (p.y - origin.y),
        lng: origin.lng + dLngDx * (p.x - origin.x)
      };
    }
  };
}

export const DeletionSelectionMap: React.FC<DeletionSelectionMapProps> = ({
  deletionMode,
  selectedSubgrids,
  onAddSubgrids,
  onRemoveSubgrid,
  onClear,
  subgridPoints,
  focusSubgrid = null,
  className = 'w-full h-full'
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const staticSrc = useRef(
    `${import.meta.env.VITE_MAP_URL || 'https://mobilemapping-nine.vercel.app'}/?embed=true&dashboard=true&deletionMode=1`
  ).current;

  const mousePosRef = useRef<ScreenPoint | null>(null);
  const coordsRef = useRef<GeoPoint | null>(null);
  const samplesRef = useRef<CalibrationSample[]>([]);
  const draggingRef = useRef(false);

  const [box, setBox] = useState<BBoxDraw | null>(null);
  const [calibrationReadyState, setCalibrationReadyState] = useState(false);

  const toLocal = useCallback((clientX: number, clientY: number): ScreenPoint => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const pushSample = useCallback(() => {
    const pos = mousePosRef.current;
    const geo = coordsRef.current;
    if (!pos || !geo) return;
    const next = [...samplesRef.current];
    next.push({ ...pos, ...geo });
    if (next.length > 500) next.splice(0, next.length - 500);
    samplesRef.current = next;
    setCalibrationReadyState(next.length >= 2);
  }, []);

  // Listen to the WebGIS iframe: cursor coords (for calibration) and
  // station-point clicks (for point selection).
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (e.data?.type === 'MAP_COORDS') {
        const lat = Number(e.data.lat);
        const lng = Number(typeof e.data.lng === 'number' ? e.data.lng : e.data.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coordsRef.current = { lat, lng };
          if (deletionMode && mousePosRef.current) pushSample();
        }
      } else if (e.data?.type === 'MAP_POINT_SELECTED' && deletionMode) {
        const pt = e.data.point || e.data.payload;
        const rawSub =
          pt?.subgrid ||
          pt?.filename ||
          pt?.point_id ||
          pt?.grid + pt?.cell ||
          '';
        const sg = (extractSubgridName(rawSub) || rawSub || '').toUpperCase().trim();
        if (sg) onAddSubgrids([sg]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [deletionMode, onAddSubgrids, pushSample]);

  const postFilter = useCallback((subgrid: string) => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'SET_SUBGRID_FILTER',
          subgrid: subgrid || '',
          isSingleRun: false,
          runId: null,
          date: ''
        },
        '*'
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (focusSubgrid) postFilter(focusSubgrid);
  }, [focusSubgrid, postFilter]);

  const finalizeBox = useCallback((up?: ScreenPoint | null) => {
    draggingRef.current = false;
    const b = up && box ? { ...box, x2: up.x, y2: up.y } : box;
    setBox(null);
    if (!b) return;
    const fit = buildLinearFit(samplesRef.current);
    if (!fit) return;
    const tl = fit.toGeo({ x: b.x1, y: b.y1 });
    const br = fit.toGeo({ x: b.x2, y: b.y2 });
    const latMin = Math.min(tl.lat, br.lat);
    const latMax = Math.max(tl.lat, br.lat);
    const lngMin = Math.min(tl.lng, br.lng);
    const lngMax = Math.max(tl.lng, br.lng);

    const matched = new Set<string>();
    (subgridPoints || []).forEach((row) => {
      const hit = (row.points || []).some(
        (p) =>
          p.lat >= latMin - EPS &&
          p.lat <= latMax + EPS &&
          p.lng >= lngMin - EPS &&
          p.lng <= lngMax + EPS
      );
      if (hit) matched.add(row.subgrid.toUpperCase().trim());
    });
    if (matched.size > 0) {
      onAddSubgrids(Array.from(matched));
    }
  }, [box, subgridPoints, onAddSubgrids]);

  const boxStyle = useMemo(() => {
    if (!box) return undefined;
    const left = Math.min(box.x1, box.x2);
    const top = Math.min(box.y1, box.y2);
    const width = Math.abs(box.x2 - box.x1);
    const height = Math.abs(box.y2 - box.y1);
    return { left, top, width, height };
  }, [box]);

  const handleIframeLoad = useCallback(() => {
    postFilter('');
  }, [postFilter]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden rounded-lg bg-card ${className}`}>
      <iframe
        ref={iframeRef}
        src={staticSrc}
        onLoad={handleIframeLoad}
        title="Deletion Selection Map"
        className="w-full h-full border-0 rounded-lg"
        allow="geolocation; camera; microphone"
      />

      {/* Drawn bbox rectangle */}
      {boxStyle && (
        <div
          className="absolute z-20 border-2 border-sky-400 bg-sky-500/10 pointer-events-none rounded-sm animate-in fade-in duration-100"
          style={boxStyle}
        />
      )}

      {/* Deletion overlay: intercept drag + click while deletion mode is active */}
      {deletionMode && (
        <div
          className="absolute inset-0 z-10 cursor-crosshair"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            draggingRef.current = true;
            const p = toLocal(e.clientX, e.clientY);
            mousePosRef.current = p;
            setBox({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
          }}
          onPointerMove={(e) => {
            const p = toLocal(e.clientX, e.clientY);
            mousePosRef.current = p;
            pushSample();
            if (draggingRef.current) {
              setBox((prev) => (prev ? { ...prev, x2: p.x, y2: p.y } : null));
            }
          }}
          onPointerUp={(e) => {
            const p = toLocal(e.clientX, e.clientY);
            mousePosRef.current = p;
            finalizeBox(p);
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
            setBox(null);
          }}
        />
      )}

      {/* Calibration + hint badge */}
      {deletionMode && (
        <div className="absolute top-3 left-3 right-3 z-30 flex flex-wrap items-center gap-2 pointer-events-none">
          <span className="bg-app/90 backdrop-blur-md border border-sky-500/40 text-sky-300 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg shadow-lg flex items-center gap-1.5">
            <Crosshair size={11} /> Deletion Select Mode
          </span>
          {calibrationReadyState ? (
            <span className="bg-app/90 backdrop-blur-md border border-emerald-500/40 text-emerald-300 text-[10px] font-medium px-2.5 py-1 rounded-lg shadow-lg flex items-center gap-1.5">
              <MoveUpRight size={11} /> Drag a box around subgrids
            </span>
          ) : (
            <span className="bg-app/90 backdrop-blur-md border border-amber-500/40 text-amber-300 text-[10px] font-medium px-2.5 py-1 rounded-lg shadow-lg flex items-center gap-1.5">
              <MousePointerClick size={11} /> Move cursor over the map to calibrate, then drag to select
            </span>
          )}
        </div>
      )}

      {/* Selected subgrid chips (quick remove) */}
      <div className="absolute bottom-3 left-3 right-3 z-30 flex flex-wrap items-center gap-1.5 pointer-events-auto">
        {selectedSubgrids.length === 0 && deletionMode && (
          <span className="bg-app/90 backdrop-blur-md border border-subtle text-text-muted text-[10px] px-2.5 py-1 rounded-lg">
            No subgrids selected yet — click a station or drag a box to add.
          </span>
        )}
        {selectedSubgrids.slice(0, 8).map((sg) => (
          <button
            key={sg}
            onClick={() => onRemoveSubgrid(sg)}
            title="Remove from selection"
            className="bg-sky-600/90 hover:bg-sky-500 text-text-base text-[10px] font-mono font-bold px-2 py-1 rounded-md border border-sky-400/40 transition-colors cursor-pointer"
          >
            {sg} ✕
          </button>
        ))}
        {selectedSubgrids.length > 8 && (
          <span className="bg-app/90 border border-subtle text-text-muted text-[10px] px-2 py-1 rounded-lg font-mono font-bold">
            +{selectedSubgrids.length - 8} more
          </span>
        )}
        {selectedSubgrids.length > 0 && (
          <button
            onClick={onClear}
            className="bg-rose-600/90 hover:bg-rose-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-md border border-rose-400/40 transition-colors cursor-pointer"
          >
            Clear ({selectedSubgrids.length})
          </button>
        )}
      </div>
    </div>
  );
};

export default DeletionSelectionMap;