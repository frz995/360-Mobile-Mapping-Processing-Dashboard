// =====================================================================
// DeletionSelectionMap — embedded WebGIS coverage map used for spatial
// safe-deletion selection with Dual View (Current vs After Delete).
// In deletion mode the user can:
//   • Click station points or drag a bounding box to select subgrids
//   • Validate selections against existing masterlist/daily data
//   • Toggle Dual View to preview Current vs After Deletion projected state
// =====================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  MousePointerClick,
  MoveUpRight,
  Split,
  Eye,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Layers,
  Navigation
} from 'lucide-react';
import { extractSubgridName } from '../services/supabase';

export interface SelectedPointInfo {
  subgrid: string;
  filename?: string;
  pointId?: string;
  lat?: number;
  lng?: number;
  status?: string;
  statusColor?: string;
  color?: string;
  isPublished?: boolean;
}

export interface SubgridPointRow {
  subgrid: string;
  totalPoi?: number;
  status?: string;
  statusColor?: string;
  color?: string;
  isPublished?: boolean;
  points: Array<{
    lat: number;
    lng: number;
    filename?: string;
    pointId?: string;
    status?: string;
    statusColor?: string;
    color?: string;
    isPublished?: boolean;
    opacity?: number;
  }>;
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

export interface DeletionSelectionMapProps {
  deletionMode: boolean;
  selectedSubgrids: string[];
  selectedPoints?: SelectedPointInfo[];
  onAddSubgrids: (subgrids: string[], points?: SelectedPointInfo[]) => void;
  onRemoveSubgrid: (subgrid: string) => void;
  onClear: () => void;
  subgridPoints: SubgridPointRow[];
  availableSubgrids?: string[];
  focusSubgrid?: string | null;
  className?: string;
  dailyData?: any[];
  qaSubgridRecords?: Record<string, any>;
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
  selectedPoints = [],
  onAddSubgrids,
  onRemoveSubgrid,
  onClear,
  subgridPoints,
  availableSubgrids = [],
  focusSubgrid = null,
  className = 'w-full h-full',
  dailyData = [],
  qaSubgridRecords
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const afterIframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // View Mode: 'single' | 'dual' (Current vs After Delete)
  const [viewMode, setViewMode] = useState<'single' | 'dual'>('single');
  const [validationToast, setValidationToast] = useState<string | null>(null);

  const staticSrc = useRef(
    `${import.meta.env.VITE_MAP_URL || 'https://mobilemapping-nine.vercel.app'}/?embed=true&dashboard=true&basemap=ofm-positron`
  ).current;

  const afterDeleteSrc = useRef(
    `${import.meta.env.VITE_MAP_URL || 'https://mobilemapping-nine.vercel.app'}/?embed=true&dashboard=true&basemap=ofm-positron`
  ).current;

  const mousePosRef = useRef<ScreenPoint | null>(null);
  const coordsRef = useRef<GeoPoint | null>(null);
  const samplesRef = useRef<CalibrationSample[]>([]);
  const draggingRef = useRef(false);
  const isMiddlePanningRef = useRef(false);
  const lastPanPosRef = useRef<ScreenPoint | null>(null);
  const currentCenterRef = useRef<{ lat: number; lng: number }>({ lat: 2.54866, lng: 102.815835 });
  const currentZoomRef = useRef<number>(16);
  const [isPanningState, setIsPanningState] = useState(false);

  const [box, setBox] = useState<BBoxDraw | null>(null);
  const [calibrationReadyState, setCalibrationReadyState] = useState(false);

  const availableSubgridsSet = useMemo(() => {
    return new Set(availableSubgrids.map((s) => s.toUpperCase().trim()));
  }, [availableSubgrids]);

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

  // Listen to WebGIS iframe messages
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      if (e.data?.type === 'MAP_COORDS') {
        const lat = Number(e.data.lat);
        const lng = Number(typeof e.data.lng === 'number' ? e.data.lng : e.data.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          coordsRef.current = { lat, lng };
          if (!isMiddlePanningRef.current) {
            currentCenterRef.current = { lat, lng };
          }
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
        const filename = pt?.filename || pt?.imageFilename || pt?.image_url;
        const lat = Number(pt?.lat ?? pt?.latitude);
        const lng = Number(pt?.lng ?? pt?.longitude ?? pt?.lon);
        if (sg) {
          if (availableSubgridsSet.size > 0 && !availableSubgridsSet.has(sg)) {
            setValidationToast(`Subgrid ${sg} does not exist in masterlist or daily survey data.`);
            setTimeout(() => setValidationToast(null), 3500);
          } else {
            const pInfo: SelectedPointInfo = { subgrid: sg, filename, lat, lng };
            onAddSubgrids([sg], [pInfo]);
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [deletionMode, onAddSubgrids, pushSample, availableSubgridsSet]);

  const formattedStagedItems = useMemo(() => {
    if (dailyData && dailyData.length > 0) {
      return dailyData.map((d: any) => {
        const isPub = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;
        const normSg = (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim();
        const pans = (d.panoramas && d.panoramas.length > 0) ? d.panoramas : (d.points || []);
        return {
          ...d,
          subgrid: normSg,
          isPublished: isPub,
          status: isPub ? 'yes' : (d.publishToWebGIS || 'in process'),
          opacity: isPub ? 1.0 : 0.7,
          statusColor: isPub ? '#10b981' : '#f59e0b',
          panoramas: pans.map((p: any, pIdx: number) => {
            const actualFn = p.filename || p.image_url || p.point_id || d.availableFilenames?.[pIdx] || `${normSg}-${String(pIdx + 1).padStart(4, '0')}.jpg`;
            const fnClean = (actualFn || '').split('/').pop()?.toUpperCase().trim();
            const isPtDefect = Boolean(
              p.isDefect ||
              p.is_defect ||
              p.qa_status === 'defect' ||
              p.status === 'defect' ||
              p.color === '#ef4444' ||
              p.color === '#EF4444' ||
              (p.defect_flags && typeof p.defect_flags === 'object' && Object.values(p.defect_flags).some(Boolean)) ||
              (d.defects && d.defects > 0 && pIdx < d.defects) ||
              (qaSubgridRecords && (
                (fnClean && qaSubgridRecords[fnClean]?.flags && (qaSubgridRecords[fnClean].flags.blurry || qaSubgridRecords[fnClean].flags.obstruction || qaSubgridRecords[fnClean].flags.badGps)) ||
                (qaSubgridRecords[normSg]?.flags && (qaSubgridRecords[normSg].flags.blurry || qaSubgridRecords[normSg].flags.obstruction || qaSubgridRecords[normSg].flags.badGps))
              ))
            );
            return {
              ...p,
              id: p.id || `pt-${normSg}-${pIdx}`,
              subgrid: normSg,
              filename: actualFn,
              image_url: p.image_url || actualFn,
              lat: p.lat ?? p.latitude ?? p.y,
              lon: p.lon ?? p.longitude ?? p.lng ?? p.x,
              latitude: p.latitude ?? p.lat ?? p.y,
              longitude: p.longitude ?? p.lon ?? p.lng ?? p.x,
              isPublished: isPub && !isPtDefect,
              status: isPtDefect ? 'defect' : (isPub ? 'yes' : 'in process'),
              isDefect: isPtDefect,
              is_defect: isPtDefect,
              color: isPtDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b'),
              opacity: isPtDefect ? 1.0 : (isPub ? 1.0 : 0.7)
            };
          })
        };
      });
    }

    return subgridPoints.map((row) => {
      const isPub = row.isPublished ?? (row.status === 'yes');
      const sColor = row.statusColor || (isPub ? '#10b981' : '#f59e0b');
      return {
        subgrid: row.subgrid,
        status: row.status || (isPub ? 'yes' : 'in process'),
        isPublished: isPub,
        statusColor: sColor,
        color: sColor,
        opacity: isPub ? 1.0 : 0.7,
        panoramas: (row.points || []).map((p, pIdx) => ({
          id: p.pointId || `pt-${row.subgrid}-${pIdx}`,
          subgrid: row.subgrid,
          filename: p.filename || `${row.subgrid}-${String(pIdx + 1).padStart(4, '0')}.jpg`,
          lat: p.lat,
          lng: p.lng,
          lon: p.lng,
          latitude: p.lat,
          longitude: p.lng,
          status: p.status || row.status || (isPub ? 'yes' : 'in process'),
          isPublished: isPub,
          color: p.color || sColor,
          statusColor: p.statusColor || sColor,
          opacity: p.opacity ?? (isPub ? 1.0 : 0.7)
        }))
      };
    });
  }, [dailyData, qaSubgridRecords, subgridPoints]);

  const flyToSelection = useCallback((subgrid: string, pts?: SelectedPointInfo[]) => {
    const norm = (subgrid || '').toUpperCase().trim();
    const iframes = [iframeRef.current, afterIframeRef.current].filter(Boolean) as HTMLIFrameElement[];

    if (norm) {
      const targetPoints = (pts && pts.length > 0)
        ? pts
        : (subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm)?.points || []);

      const validPts = targetPoints.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng));

      let centerLat = 0;
      let centerLng = 0;
      let bMinLat = 0, bMaxLat = 0, bMinLng = 0, bMaxLng = 0;

      if (validPts.length > 0) {
        const minLat = Math.min(...validPts.map((p) => p.lat!));
        const maxLat = Math.max(...validPts.map((p) => p.lat!));
        const minLng = Math.min(...validPts.map((p) => p.lng!));
        const maxLng = Math.max(...validPts.map((p) => p.lng!));

        centerLat = (minLat + maxLat) / 2;
        centerLng = (minLng + maxLng) / 2;

        const padLat = Math.max(0.0015, (maxLat - minLat) * 0.15);
        const padLng = Math.max(0.0015, (maxLng - minLng) * 0.15);
        bMinLat = minLat - padLat;
        bMaxLat = maxLat + padLat;
        bMinLng = minLng - padLng;
        bMaxLng = maxLng + padLng;
      }

      iframes.forEach((ifr) => {
        if (!ifr || !ifr.contentWindow) return;
        try {
          ifr.contentWindow.postMessage(
            {
              type: 'SET_STAGED_DATA',
              stagedItems: formattedStagedItems,
              isSingleRun: false,
              runId: null
            },
            '*'
          );

          // Exactly matching Processing Control Masterlist filter click
          ifr.contentWindow.postMessage(
            {
              type: 'SET_MAP_VIEW_STATE',
              viewMode: 'SUBGRID',
              subgrid: norm,
              date: '',
              runId: null,
              points: targetPoints
            },
            '*'
          );

          ifr.contentWindow.postMessage(
            {
              type: 'FILTER_SUBGRID',
              subgrid: norm,
              date: '',
              isSingleRun: false,
              runId: null
            },
            '*'
          );

          ifr.contentWindow.postMessage(
            {
              type: 'SET_SUBGRID_FILTER',
              subgrid: norm,
              date: '',
              isSingleRun: false,
              runId: null
            },
            '*'
          );

          if (validPts.length > 0) {
            ifr.contentWindow.postMessage(
              {
                type: 'FOCUS_BOUNDARY',
                bbox: [bMinLng, bMinLat, bMaxLng, bMaxLat]
              },
              '*'
            );

            ifr.contentWindow.postMessage(
              {
                type: 'FLY_TO',
                lat: centerLat,
                lng: centerLng,
                lon: centerLng,
                zoom: 17
              },
              '*'
            );
          }
        } catch {
          /* ignore */
        }
      });
    } else {
      // Exactly matching Processing Control reset to ALL & restore default view
      const allPoints = (pts && pts.length > 0)
        ? pts
        : subgridPoints.flatMap((r) => r.points || []);
      const validAll = allPoints.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng));

      let centerLat = 0;
      let centerLng = 0;
      let bMinLat = 0, bMaxLat = 0, bMinLng = 0, bMaxLng = 0;

      if (validAll.length > 0) {
        const minLat = Math.min(...validAll.map((p) => p.lat!));
        const maxLat = Math.max(...validAll.map((p) => p.lat!));
        const minLng = Math.min(...validAll.map((p) => p.lng!));
        const maxLng = Math.max(...validAll.map((p) => p.lng!));

        centerLat = (minLat + maxLat) / 2;
        centerLng = (minLng + maxLng) / 2;

        const padLat = Math.max(0.003, (maxLat - minLat) * 0.2);
        const padLng = Math.max(0.003, (maxLng - minLng) * 0.2);
        bMinLat = minLat - padLat;
        bMaxLat = maxLat + padLat;
        bMinLng = minLng - padLng;
        bMaxLng = maxLng + padLng;
      }

      iframes.forEach((ifr) => {
        if (!ifr || !ifr.contentWindow) return;
        try {
          ifr.contentWindow.postMessage(
            {
              type: 'SET_STAGED_DATA',
              stagedItems: formattedStagedItems,
              isSingleRun: false,
              runId: null
            },
            '*'
          );

          ifr.contentWindow.postMessage(
            {
              type: 'SET_MAP_VIEW_STATE',
              viewMode: 'ALL',
              subgrid: '',
              date: '',
              runId: null,
              points: allPoints
            },
            '*'
          );

          ifr.contentWindow.postMessage(
            {
              type: 'FILTER_SUBGRID',
              subgrid: '',
              date: '',
              isSingleRun: false,
              runId: null
            },
            '*'
          );

          ifr.contentWindow.postMessage(
            {
              type: 'SET_SUBGRID_FILTER',
              subgrid: '',
              date: '',
              isSingleRun: false,
              runId: null
            },
            '*'
          );

          if (validAll.length > 0) {
            ifr.contentWindow.postMessage(
              {
                type: 'FOCUS_BOUNDARY',
                bbox: [bMinLng, bMinLat, bMaxLng, bMaxLat]
              },
              '*'
            );

            ifr.contentWindow.postMessage(
              {
                type: 'FLY_TO',
                lat: centerLat,
                lng: centerLng,
                lon: centerLng,
                zoom: 14
              },
              '*'
            );
          } else {
            ifr.contentWindow.postMessage({ type: 'CLEAR_BOUNDARY_FOCUS' }, '*');
          }
        } catch {
          /* ignore */
        }
      });
    }
  }, [subgridPoints, formattedStagedItems]);

  // Synchronize live staged items to both map viewports whenever formattedStagedItems or selections change
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          {
            type: 'SET_STAGED_DATA',
            stagedItems: formattedStagedItems,
            isSingleRun: false,
            runId: null
          },
          '*'
        );
      } catch {}
    }

    if (afterIframeRef.current?.contentWindow) {
      const allSubs = Array.from(new Set(subgridPoints.map((r) => r.subgrid.toUpperCase().trim()))).filter(Boolean);
      const remaining = allSubs.filter((s) => !selectedSubgrids.includes(s));
      const targetFilter = selectedSubgrids.length > 0 ? (remaining.length > 0 ? remaining.join(',') : '__NONE__') : '';
      const afterStaged = formattedStagedItems.filter(
        (item) => !selectedSubgrids.includes((item.subgrid || '').toUpperCase().trim())
      );

      try {
        afterIframeRef.current.contentWindow.postMessage(
          {
            type: 'SET_STAGED_DATA',
            stagedItems: afterStaged,
            isSingleRun: false,
            runId: null
          },
          '*'
        );
        afterIframeRef.current.contentWindow.postMessage(
          {
            type: 'SET_SUBGRID_FILTER',
            subgrid: targetFilter,
            isSingleRun: false,
            runId: null,
            date: ''
          },
          '*'
        );
        afterIframeRef.current.contentWindow.postMessage(
          {
            type: 'FILTER_SUBGRID',
            subgrid: targetFilter,
            date: '',
            isSingleRun: false,
            runId: null
          },
          '*'
        );
        afterIframeRef.current.contentWindow.postMessage(
          {
            type: 'SET_MAP_VIEW_STATE',
            viewMode: selectedSubgrids.length > 0 ? 'SUBGRID' : 'ALL',
            subgrid: targetFilter,
            date: '',
            runId: null
          },
          '*'
        );
      } catch {}
    }
  }, [formattedStagedItems, selectedSubgrids, subgridPoints]);

  const postFilter = useCallback((subgrid: string) => {
    flyToSelection(subgrid);
  }, [flyToSelection]);

  useEffect(() => {
    if (focusSubgrid) flyToSelection(focusSubgrid);
  }, [focusSubgrid, flyToSelection]);

  const finalizeBox = useCallback(
    (up?: ScreenPoint | null) => {
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

      const matchedSubgrids = new Set<string>();
      const matchedPoints: SelectedPointInfo[] = [];

      (subgridPoints || []).forEach((row) => {
        const norm = row.subgrid.toUpperCase().trim();
        if (availableSubgridsSet.size === 0 || availableSubgridsSet.has(norm)) {
          (row.points || []).forEach((p) => {
            if (
              p.lat >= latMin - EPS &&
              p.lat <= latMax + EPS &&
              p.lng >= lngMin - EPS &&
              p.lng <= lngMax + EPS
            ) {
              matchedSubgrids.add(norm);
              matchedPoints.push({
                subgrid: norm,
                filename: p.filename,
                pointId: p.pointId,
                lat: p.lat,
                lng: p.lng
              });
            }
          });
        }
      });

      if (matchedSubgrids.size > 0) {
        const arr = Array.from(matchedSubgrids);
        onAddSubgrids(arr, matchedPoints);
        flyToSelection(arr[0] || '', matchedPoints);
      } else {
        setValidationToast('No existing subgrid records found inside the drawn boundary box.');
        setTimeout(() => setValidationToast(null), 3500);
      }
    },
    [box, subgridPoints, onAddSubgrids, availableSubgridsSet, flyToSelection]
  );

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

  const handleToggleTrack = useCallback(
    (sg: string) => {
      const norm = sg.toUpperCase().trim();
      const isSelected = selectedSubgrids.includes(norm);
      if (isSelected) {
        onRemoveSubgrid(norm);
        const remaining = selectedSubgrids.filter((s) => s !== norm);
        if (remaining.length > 0) {
          flyToSelection(remaining[0]);
        } else {
          // Deselected the last active track -> restore default view of all data
          flyToSelection('');
        }
      } else {
        const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
        const pts: SelectedPointInfo[] = (sgRow?.points || []).map((p) => ({
          subgrid: norm,
          filename: p.filename,
          pointId: p.pointId,
          lat: p.lat,
          lng: p.lng
        }));
        onAddSubgrids([norm], pts);
        flyToSelection(norm, pts);
      }
    },
    [selectedSubgrids, subgridPoints, onRemoveSubgrid, onAddSubgrids, flyToSelection]
  );

  const handleToggleAllTracks = useCallback(() => {
    const validTracks = (subgridPoints || []).filter((r) => {
      const norm = r.subgrid.toUpperCase().trim();
      return availableSubgridsSet.size === 0 || availableSubgridsSet.has(norm);
    });

    const allSubgrids = validTracks.map((r) => r.subgrid.toUpperCase().trim());
    const areAllSelected =
      allSubgrids.length > 0 && allSubgrids.every((sg) => selectedSubgrids.includes(sg));

    if (areAllSelected) {
      onClear();
      flyToSelection('');
    } else {
      const allPoints: SelectedPointInfo[] = [];
      validTracks.forEach((r) => {
        const norm = r.subgrid.toUpperCase().trim();
        (r.points || []).forEach((p) => {
          allPoints.push({
            subgrid: norm,
            filename: p.filename,
            pointId: p.pointId,
            lat: p.lat,
            lng: p.lng
          });
        });
      });
      onAddSubgrids(allSubgrids, allPoints);
      flyToSelection('', allPoints);
    }
  }, [subgridPoints, availableSubgridsSet, selectedSubgrids, onClear, onAddSubgrids, flyToSelection]);

  return (
    <div className={`relative flex flex-col rounded-xl bg-card border border-subtle overflow-hidden ${className}`}>
      {/* Top Header & Dual View Toggle Bar */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-inner border-b border-subtle text-xs gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <Layers size={14} className="text-sky-400" />
          <span className="font-bold text-text-base text-xs">
            {viewMode === 'dual' ? 'Dual Map Comparison' : 'Interactive Map View'}
          </span>
          {deletionMode && (
            <>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1.5 shadow-sm">
                <Crosshair size={11} className="text-rose-400" /> SELECT TARGET
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-card text-text-muted border border-subtle flex items-center gap-1 shadow-sm">
                {calibrationReadyState ? (
                  <>
                    <MoveUpRight size={10} className="text-sky-400" /> Drag bbox or click station
                  </>
                ) : (
                  <>
                    <MousePointerClick size={10} className="text-amber-400" /> Hover to calibrate
                  </>
                )}
              </span>
            </>
          )}
        </div>

        {deletionMode && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setViewMode('single')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'single'
                  ? 'bg-card text-text-base border border-subtle shadow-sm font-semibold'
                  : 'text-text-muted hover:text-text-base bg-inner'
              }`}
            >
              <Eye size={12} />
              <span>Single Map</span>
            </button>
            <button
              onClick={() => setViewMode('dual')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === 'dual'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm font-semibold'
                  : 'text-text-muted hover:text-text-base bg-inner'
              }`}
            >
              <Split size={12} />
              <span>Dual View (Current vs After Delete)</span>
            </button>
          </div>
        )}
      </div>

      {/* Survey Tracks Selection Bar (Quick select/toggle across all survey tracks) */}
      {deletionMode && (subgridPoints || []).length > 0 && (
        <div className="px-3 py-1.5 bg-card/95 border-b border-subtle flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto py-0.5">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1 shrink-0 mr-1">
              <Navigation size={11} className="text-sky-400" />
              Tracks:
            </span>

            <button
              onClick={handleToggleAllTracks}
              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer shrink-0 border ${
                selectedSubgrids.length > 0 &&
                (subgridPoints || []).every((r) => selectedSubgrids.includes(r.subgrid.toUpperCase().trim()))
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-sm'
                  : 'bg-inner text-text-muted hover:text-text-base border-subtle'
              }`}
            >
              {selectedSubgrids.length > 0 &&
              (subgridPoints || []).every((r) => selectedSubgrids.includes(r.subgrid.toUpperCase().trim()))
                ? '✓ All Tracks'
                : 'Select All Tracks'}
            </button>

            <div className="h-3 w-[1px] bg-subtle shrink-0 mx-0.5" />

            {subgridPoints.map((row) => {
              const norm = row.subgrid.toUpperCase().trim();
              const isSelected = selectedSubgrids.includes(norm);
              const subPts = (selectedPoints || []).filter((p) => p.subgrid === norm);
              const totalPts = row.points?.length || row.totalPoi || 0;
              const isPartial = isSelected && subPts.length > 0 && totalPts > 0 && subPts.length < totalPts;

              return (
                  <button
                  key={norm}
                  onClick={() => handleToggleTrack(norm)}
                  title={`Toggle track ${norm} (${totalPts} points). Status: ${row.status === 'defect' ? 'Defect' : row.isPublished ? 'Published' : 'In Process'}.`}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium transition-all cursor-pointer shrink-0 border ${
                    isSelected
                      ? isPartial
                        ? 'bg-amber-500/20 text-amber-200 border-amber-500/40 shadow-sm font-bold'
                        : 'bg-rose-500/20 text-rose-200 border-rose-500/40 shadow-sm font-bold'
                      : 'bg-inner text-text-muted hover:text-text-base border-subtle hover:border-sky-500/30'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: row.statusColor || (row.isPublished ? '#10b981' : '#f59e0b') }}
                  />
                  <span>{isSelected ? '✓ ' : '+ '}{norm}</span>
                  {totalPts > 0 && (
                    <span className="text-[10px] font-sans font-normal opacity-70">
                      ({isPartial ? `${subPts.length}/${totalPts}` : totalPts})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-text-muted font-mono">
              {selectedSubgrids.length} of {subgridPoints.length} active
            </span>
          </div>
        </div>
      )}

      {/* Validation Toast */}
      {validationToast && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 backdrop-blur-md border border-amber-500/40 text-amber-200 text-xs px-3.5 py-1.5 rounded-lg shadow-xl flex items-center gap-2 animate-in fade-in">
          <AlertCircle size={14} className="text-amber-400 shrink-0" />
          <span>{validationToast}</span>
        </div>
      )}

      {/* Map Area */}
      <div
        ref={containerRef}
        className={`relative flex-1 min-h-0 w-full overflow-hidden ${
          viewMode === 'dual'
            ? 'grid grid-cols-1 md:grid-cols-2 gap-2 bg-inner/60 p-2'
            : 'bg-slate-950'
        }`}
      >
        {/* PANE 1: Current Live WebGIS Map (Selection Target) */}
        <div className="relative w-full h-full min-h-[260px] rounded-xl overflow-hidden bg-slate-950 border border-subtle flex flex-col">
          {viewMode === 'dual' && (
            <div className="px-3 py-1.5 bg-card border-b border-subtle flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-sky-400" />
                <span className="font-bold text-sky-300 text-[11px]">Current Production WebGIS</span>
              </div>
              <span className="text-[10px] text-text-muted font-mono">Interactive Selection</span>
            </div>
          )}

          <div className="relative flex-1 min-h-0 w-full overflow-hidden">
            <iframe
              ref={iframeRef}
              src={staticSrc}
              onLoad={handleIframeLoad}
              title="Current Live WebGIS"
              className="w-full h-[calc(100%+76px)] -mt-[76px] border-0"
              allow="geolocation; camera; microphone"
            />

            {/* Drawn bbox rectangle */}
            {boxStyle && (
              <div
                className="absolute z-20 border-2 border-rose-400 bg-rose-500/15 pointer-events-none rounded-sm animate-in fade-in duration-100 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
                style={boxStyle}
              />
            )}

            {/* Deletion overlay: intercept drag + click while deletion mode is active, supporting middle-click / mousewheel click panning and scroll-wheel zoom */}
            {deletionMode && (
              <div
                className={`absolute inset-0 z-10 select-none ${
                  isPanningState ? 'cursor-grabbing' : 'cursor-crosshair'
                }`}
                onContextMenu={(e) => e.preventDefault()}
                onWheel={(e) => {
                  e.preventDefault();
                  const delta = e.deltaY < 0 ? 1 : -1;
                  currentZoomRef.current = Math.min(20, Math.max(9, currentZoomRef.current + delta));
                  const iframes = [iframeRef.current, afterIframeRef.current].filter(Boolean) as HTMLIFrameElement[];
                  iframes.forEach((ifr) => {
                    try {
                      ifr.contentWindow?.postMessage(
                        {
                          type: 'FLY_TO',
                          lat: currentCenterRef.current.lat,
                          lng: currentCenterRef.current.lng,
                          lon: currentCenterRef.current.lng,
                          zoom: currentZoomRef.current
                        },
                        '*'
                      );
                      ifr.contentWindow?.postMessage(
                        {
                          type: 'SET_MAP_CENTER',
                          lat: currentCenterRef.current.lat,
                          lng: currentCenterRef.current.lng,
                          lon: currentCenterRef.current.lng,
                          zoom: currentZoomRef.current
                        },
                        '*'
                      );
                    } catch {}
                  });
                }}
                onPointerDown={(e) => {
                  // Middle click (button 1) or Alt/Shift left click -> pan map
                  if (e.button === 1 || (e.button === 0 && (e.altKey || e.shiftKey))) {
                    e.preventDefault();
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    isMiddlePanningRef.current = true;
                    setIsPanningState(true);
                    lastPanPosRef.current = { x: e.clientX, y: e.clientY };
                    setBox(null);
                    return;
                  }
                  if (e.button === 0) {
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    draggingRef.current = true;
                    const p = toLocal(e.clientX, e.clientY);
                    mousePosRef.current = p;
                    setBox({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
                  }
                }}
                onPointerMove={(e) => {
                  if (isMiddlePanningRef.current) {
                    const prevX = lastPanPosRef.current ? lastPanPosRef.current.x : e.clientX;
                    const prevY = lastPanPosRef.current ? lastPanPosRef.current.y : e.clientY;
                    const dx = e.clientX - prevX;
                    const dy = e.clientY - prevY;
                    lastPanPosRef.current = { x: e.clientX, y: e.clientY };

                    const zoomFactor = Math.pow(2, 17 - currentZoomRef.current);
                    const dLng = -dx * (0.0000045 * zoomFactor);
                    const dLat = dy * (0.0000045 * zoomFactor);
                    currentCenterRef.current.lat += dLat;
                    currentCenterRef.current.lng += dLng;

                    const iframes = [iframeRef.current, afterIframeRef.current].filter(Boolean) as HTMLIFrameElement[];
                    iframes.forEach((ifr) => {
                      try {
                        ifr.contentWindow?.postMessage(
                          {
                            type: 'FLY_TO',
                            lat: currentCenterRef.current.lat,
                            lng: currentCenterRef.current.lng,
                            lon: currentCenterRef.current.lng,
                            zoom: currentZoomRef.current
                          },
                          '*'
                        );
                        ifr.contentWindow?.postMessage(
                          {
                            type: 'SET_MAP_CENTER',
                            lat: currentCenterRef.current.lat,
                            lng: currentCenterRef.current.lng,
                            lon: currentCenterRef.current.lng,
                            zoom: currentZoomRef.current
                          },
                          '*'
                        );
                      } catch {}
                    });
                    return;
                  }

                  const p = toLocal(e.clientX, e.clientY);
                  mousePosRef.current = p;
                  pushSample();
                  if (draggingRef.current) {
                    setBox((prev) => (prev ? { ...prev, x2: p.x, y2: p.y } : null));
                  }
                }}
                onPointerUp={(e) => {
                  if (isMiddlePanningRef.current) {
                    isMiddlePanningRef.current = false;
                    setIsPanningState(false);
                    lastPanPosRef.current = null;
                    return;
                  }
                  if (draggingRef.current) {
                    draggingRef.current = false;
                    const p = toLocal(e.clientX, e.clientY);
                    mousePosRef.current = p;
                    finalizeBox(p);
                  }
                }}
                onPointerCancel={() => {
                  isMiddlePanningRef.current = false;
                  setIsPanningState(false);
                  draggingRef.current = false;
                  setBox(null);
                }}
              />
            )}
          </div>
        </div>

        {/* PANE 2: After Deletion Preview Map */}
        {viewMode === 'dual' && (
          <div className="relative w-full h-full min-h-[260px] rounded-xl overflow-hidden bg-slate-950 border border-subtle flex flex-col">
            <div className="px-3 py-1.5 bg-card border-b border-subtle flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center gap-1.5">
                <Trash2 size={12} className="text-rose-400" />
                <span className="font-bold text-rose-300 text-[11px]">Projected State (After Deletion)</span>
              </div>
              <span className="text-[10px] text-rose-400 font-mono font-bold bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded">
                {selectedSubgrids.length > 0 ? `${selectedSubgrids.length} Target(s) Purged` : '0 Selected'}
              </span>
            </div>

            <div className="relative flex-1 min-h-0 w-full overflow-hidden">
              <iframe
                ref={afterIframeRef}
                src={afterDeleteSrc}
                title="After Deletion Preview"
                className="w-full h-[calc(100%+76px)] -mt-[76px] border-0 opacity-90"
                allow="geolocation; camera; microphone"
              />

              {selectedSubgrids.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2 z-10 pointer-events-none flex justify-center">
                  <div className="bg-slate-950/90 backdrop-blur-md border border-rose-500/40 rounded-xl px-3 py-1.5 text-center shadow-2xl max-w-sm">
                    <p className="text-[11px] font-medium text-slate-200">
                      <strong className="font-mono text-rose-300">{selectedSubgrids.join(', ')}</strong> will be purged from active WebGIS layers.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected subgrid chips (Professional bottom bar) */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-inner border-t border-subtle text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedSubgrids.length === 0 && deletionMode && (
            <span className="text-text-muted text-[11px] flex items-center gap-1.5">
              <MousePointerClick size={12} className="text-sky-400" />
              Click a station point or drag a bounding box to select subgrid data for deletion.
            </span>
          )}
          {selectedSubgrids.map((sg) => {
            const subPts = selectedPoints.filter((p) => p.subgrid === sg);
            const totalPts = subgridPoints.find((r) => r.subgrid === sg)?.points?.length || 0;
            const isPartial = subPts.length > 0 && totalPts > 0 && subPts.length < totalPts;
            return (
              <span
                key={sg}
                className="inline-flex items-center gap-1.5 bg-card border border-rose-500/40 text-text-base text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg shadow-sm"
              >
                <span className="text-rose-300">{sg}</span>
                {isPartial ? (
                  <span className="text-[10px] font-sans font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 rounded">
                    {subPts.length} of {totalPts} points
                  </span>
                ) : totalPts > 0 ? (
                  <span className="text-[10px] font-sans font-normal text-text-muted">
                    ({totalPts} points)
                  </span>
                ) : null}
                <button
                  onClick={() => onRemoveSubgrid(sg)}
                  title={`Remove ${sg} from delete list`}
                  className="text-text-muted hover:text-rose-400 transition-colors p-0.5 cursor-pointer ml-1"
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>

        {selectedSubgrids.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-text-muted hover:text-rose-400 transition-colors cursor-pointer px-2 py-0.5 rounded"
          >
            Clear selection ({selectedSubgrids.length})
          </button>
        )}
      </div>
    </div>
  );
};

export default DeletionSelectionMap;