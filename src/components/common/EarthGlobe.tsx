import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

export interface GlobeMarker {
  label?: string;
  description?: string;
  latitude: number;
  longitude: number;
  color?: string;
}

export interface EarthGlobeProps {
  className?: string;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  centerLatitude?: number;
  centerLongitude?: number;
  flyTo?: {
    latitude: number;
    longitude: number;
    zoom?: number;
    timestamp: number;
  };
  enableDrag?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
  dragSensitivity?: number;
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  panOffset?: { x: number; y: number };
  onZoomChange?: (zoom: number) => void;
  onPanChange?: (pan: { x: number; y: number }) => void;
  markers?: GlobeMarker[];
  showGraticule?: boolean;
  showLabels?: boolean;
  oceanColor?: string;
  landFill?: string;
  landStroke?: string;
  strokeWidth?: number;
  glowColor?: string;
  glowIntensity?: number;
  onZoomIn?: () => void;
  onMarkerClick?: (marker: GlobeMarker) => void;
}

const RAD = Math.PI / 180;
const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

function projectPoint(
  lng: number,
  lat: number,
  lambda: number,
  phi: number,
  gamma: number,
  radius: number,
  cx: number,
  cy: number
) {
  const dLng = (lng - lambda) * RAD;
  const radLat = lat * RAD;
  const cosLat = Math.cos(radLat);
  const x = cosLat * Math.cos(dLng);
  const y = cosLat * Math.sin(dLng);
  const z = Math.sin(radLat);

  const cosPhi = Math.cos(phi * RAD);
  const sinPhi = Math.sin(phi * RAD);
  const x1 = x * cosPhi + z * sinPhi;
  const y1 = y;
  const z1 = -x * sinPhi + z * cosPhi;

  const cosGamma = Math.cos(gamma * RAD);
  const sinGamma = Math.sin(gamma * RAD);
  const rx = x1;
  const ry = y1 * cosGamma - z1 * sinGamma;
  const rz = y1 * sinGamma + z1 * cosGamma;

  return {
    sx: cx + radius * ry,
    sy: cy - radius * rz,
    rx,
    ry,
    rz,
    v: rx >= 0,
  };
}

function horizonIntersect(
  p1: { rx: number; ry: number; rz: number },
  p2: { rx: number; ry: number; rz: number },
  radius: number,
  cx: number,
  cy: number
) {
  const d = p1.rx - p2.rx;
  if (Math.abs(d) < 1e-12) return null;
  const t = p1.rx / d;
  if (t < 0 || t > 1) return null;
  let ry = p1.ry + t * (p2.ry - p1.ry);
  let rz = p1.rz + t * (p2.rz - p1.rz);
  const len = Math.sqrt(ry * ry + rz * rz);
  if (len < 1e-9) return null;
  ry /= len;
  rz /= len;
  return {
    sx: cx + radius * ry,
    sy: cy - radius * rz,
    rx: 0,
    ry,
    rz,
    v: true,
  };
}

function clipPolygonRing(
  ring: number[][],
  lambda: number,
  phi: number,
  gamma: number,
  radius: number,
  cx: number,
  cy: number
) {
  const n = ring.length;
  if (n < 3) return [];
  const projected = new Array(n);
  let visCount = 0;
  for (let i = 0; i < n; i++) {
    projected[i] = projectPoint(ring[i][0], ring[i][1], lambda, phi, gamma, radius, cx, cy);
    if (projected[i].v) visCount++;
  }
  if (visCount === 0) return [];
  if (visCount === n) return [projected.slice()];

  let startIdx = -1;
  for (let i = 0; i < n; i++) {
    if (!projected[i].v && projected[(i + 1) % n].v) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return [projected.slice()];

  const segments: any[][] = [];
  let current: any[] = [];
  for (let i = 0; i < n; i++) {
    const curr = projected[(startIdx + i) % n];
    const next = projected[(startIdx + i + 1) % n];
    if (curr.v && next.v) {
      current.push(next);
    } else if (curr.v && !next.v) {
      const hit = horizonIntersect(curr, next, radius, cx, cy);
      if (hit) current.push(hit);
      if (current.length >= 2) segments.push(current);
      current = [];
    } else if (!curr.v && next.v) {
      const hit = horizonIntersect(curr, next, radius, cx, cy);
      if (hit) current.push(hit);
      current.push(next);
    }
  }
  return segments;
}

function pointsToSvgPath(rings: any[][]): string {
  if (!rings || rings.length === 0) return '';
  let d = '';
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      d += (i === 0 ? 'M' : 'L') + p.sx.toFixed(1) + ',' + p.sy.toFixed(1);
    }
    d += 'Z';
  }
  return d;
}

function renderGeometryPath(
  type: string,
  coords: any,
  lambda: number,
  phi: number,
  gamma: number,
  radius: number,
  cx: number,
  cy: number
): string {
  if (!coords) return '';
  if (type === 'Polygon') {
    let path = '';
    for (const ring of coords) {
      path += pointsToSvgPath(clipPolygonRing(ring, lambda, phi, gamma, radius, cx, cy));
    }
    return path;
  }
  if (type === 'MultiPolygon') {
    let path = '';
    for (const poly of coords) {
      for (const ring of poly) {
        path += pointsToSvgPath(clipPolygonRing(ring, lambda, phi, gamma, radius, cx, cy));
      }
    }
    return path;
  }
  return '';
}

function renderGraticule(
  lambda: number,
  phi: number,
  gamma: number,
  radius: number,
  cx: number,
  cy: number
): string {
  let path = '';
  for (let lat = -60; lat <= 60; lat += 30) {
    let drawing = false;
    let prev = null;
    for (let lng = -180; lng <= 180; lng += 4) {
      const p = projectPoint(lng, lat, lambda, phi, gamma, radius, cx, cy);
      if (p.v) {
        if (!drawing || (prev && !prev.v)) {
          path += `M${p.sx.toFixed(1)},${p.sy.toFixed(1)}`;
          drawing = true;
        } else {
          path += `L${p.sx.toFixed(1)},${p.sy.toFixed(1)}`;
        }
      }
      prev = p;
    }
  }
  for (let lng = -180; lng < 180; lng += 30) {
    let drawing = false;
    let prev = null;
    for (let lat = -80; lat <= 80; lat += 4) {
      const p = projectPoint(lng, lat, lambda, phi, gamma, radius, cx, cy);
      if (p.v) {
        if (!drawing || (prev && !prev.v)) {
          path += `M${p.sx.toFixed(1)},${p.sy.toFixed(1)}`;
          drawing = true;
        } else {
          path += `L${p.sx.toFixed(1)},${p.sy.toFixed(1)}`;
        }
      }
      prev = p;
    }
  }
  return path;
}

// TopoJSON unpack helpers
function decodeArcs(topo: any) {
  const t = topo.transform;
  if (!t) return topo.arcs;
  const [kx, ky] = t.scale;
  const [dx, dy] = t.translate;
  return topo.arcs.map((arc: number[][]) => {
    let x = 0;
    let y = 0;
    return arc.map(([px, py]) => {
      x += px;
      y += py;
      return [x * kx + dx, y * ky + dy];
    });
  });
}

function unpackArcs(indices: number[], arcs: any[]) {
  const res: number[][] = [];
  for (const idx of indices) {
    const arc = idx >= 0 ? arcs[idx] : arcs[~idx].slice().reverse();
    for (let i = res.length > 0 ? 1 : 0; i < arc.length; i++) {
      res.push(arc[i]);
    }
  }
  return res;
}

function parseTopoJson(topo: any) {
  const arcs = decodeArcs(topo);
  const geometries = topo.objects.countries?.geometries;
  if (!geometries) return [];
  return geometries.map((geom: any) => {
    let coords: any = null;
    if (geom.type === 'Polygon') {
      coords = geom.arcs.map((arcIdxs: number[]) => unpackArcs(arcIdxs, arcs));
    } else if (geom.type === 'MultiPolygon') {
      coords = geom.arcs.map((polyIdxs: number[][]) =>
        polyIdxs.map((arcIdxs) => unpackArcs(arcIdxs, arcs))
      );
    }
    return {
      id: String(geom.id ?? ''),
      type: geom.type,
      coords,
    };
  });
}

function colorWithAlpha(hexOrRgb: string, alpha: number): string {
  if (!hexOrRgb) return `rgba(0,0,0,${alpha})`;
  const str = hexOrRgb.trim();
  if (str.startsWith('#')) {
    const hex = str.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
    const r = parseInt(full.slice(0, 2), 16) || 0;
    const g = parseInt(full.slice(2, 4), 16) || 0;
    const b = parseInt(full.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return str;
}

// Default locations: Malaysia (Project Core) & Tokyo (Reference)
const DEFAULT_PROJECT_MARKERS: GlobeMarker[] = [
  {
    label: 'TNB Project Core • Malaysia',
    description: 'Active Mobile Mapping Fleet • 2.546° N, 102.087° E',
    latitude: 2.5458,
    longitude: 102.0873,
    color: '#e53e3e',
  },
  {
    label: 'Tokyo',
    description: 'Reference Station • 35.676° N, 139.650° E',
    latitude: 35.6762,
    longitude: 139.6503,
    color: '#e53e3e',
  }
];

export const EarthGlobe: React.FC<EarthGlobeProps> = ({
  className = '',
  autoRotate = true,
  autoRotateSpeed = 2.0,
  rotateX = 0,
  rotateY = 3.5, // Center on Malaysia latitude
  rotateZ = 101.9, // Center on Malaysia longitude
  centerLatitude,
  centerLongitude,
  flyTo,
  enableDrag = true,
  enableZoom = true,
  enablePan = true,
  dragSensitivity = 0.35,
  zoom,
  minZoom = 0.5,
  maxZoom = 4.0,
  panOffset,
  onZoomChange,
  onPanChange,
  markers = DEFAULT_PROJECT_MARKERS,
  showGraticule = true,
  showLabels = true,
  oceanColor = '#0f1318',
  landFill = '#262c34',
  landStroke = '#3b434d',
  strokeWidth = 0.5,
  glowColor: _glowColor = 'rgba(255, 255, 255, 0.08)',
  glowIntensity: _glowIntensity = 0.5,
  onZoomIn,
  onMarkerClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pathMapRef = useRef<Map<string, SVGPathElement>>(new Map());
  const graticuleRef = useRef<SVGPathElement>(null);
  const markerGroupRef = useRef<Map<number, SVGGElement>>(new Map());

  const [dimensions, setDimensions] = useState({ w: 800, h: 800 });
  const [countries, setCountries] = useState<any[]>([]);
  const [internalZoom, setInternalZoom] = useState(zoom ?? 1.0);
  const [internalPan, setInternalPan] = useState(panOffset ?? { x: 0, y: 0 });
  const [hoveredMarker, setHoveredMarker] = useState<{
    x: number;
    y: number;
    label?: string;
    description?: string;
  } | null>(null);

  useEffect(() => {
    if (zoom !== undefined) setInternalZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    if (panOffset !== undefined) setInternalPan(panOffset);
  }, [panOffset]);

  const currentZoom = zoom !== undefined ? zoom : internalZoom;
  const currentPan = panOffset !== undefined ? panOffset : internalPan;

  const updateZoom = useCallback((newZ: number) => {
    const clamped = clamp(newZ, minZoom, maxZoom);
    if (onZoomChange) onZoomChange(clamped);
    else setInternalZoom(clamped);
  }, [minZoom, maxZoom, onZoomChange]);

  const updatePan = useCallback((newPan: { x: number; y: number }) => {
    if (onPanChange) onPanChange(newPan);
    else setInternalPan(newPan);
  }, [onPanChange]);

  // Compute initial orientation based on project center or props
  const initLambda = centerLongitude !== undefined ? centerLongitude : rotateZ;
  const initPhi = centerLatitude !== undefined ? centerLatitude : rotateY;

  const rotRef = useRef({ lambda: initLambda, phi: initPhi, gamma: rotateX });
  const dragRef = useRef<{
    active: boolean;
    mode: 'rotate' | 'pan';
    startX: number;
    startY: number;
    startLambda: number;
    startPhi: number;
    startPanX: number;
    startPanY: number;
  }>({
    active: false,
    mode: 'rotate',
    startX: 0,
    startY: 0,
    startLambda: 0,
    startPhi: 0,
    startPanX: 0,
    startPanY: 0,
  });
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number; midX: number; midY: number; panX: number; panY: number } | null>(null);
  const lastInteractionRef = useRef(0);
  const flyAnimRef = useRef<{
    startLambda: number;
    startPhi: number;
    targetLambda: number;
    targetPhi: number;
    startZoom: number;
    targetZoom: number;
    startPanX: number;
    startPanY: number;
    startTime: number;
    duration: number;
  } | null>(null);

  // Synchronize when project center coordinates change
  useEffect(() => {
    if (centerLongitude !== undefined && centerLatitude !== undefined) {
      rotRef.current.lambda = centerLongitude;
      rotRef.current.phi = centerLatitude;
    }
  }, [centerLatitude, centerLongitude]);

  // Smooth camera flight trigger
  useEffect(() => {
    if (!flyTo || !flyTo.timestamp) return;

    const startLambda = rotRef.current.lambda;
    const startPhi = rotRef.current.phi;

    // Calculate shortest angular distance around the sphere
    const dLng = ((flyTo.longitude - (startLambda % 360) + 540) % 360) - 180;
    const targetLambda = startLambda + dLng;
    const targetPhi = clamp(flyTo.latitude, -85, 85);

    flyAnimRef.current = {
      startLambda,
      startPhi,
      targetLambda,
      targetPhi,
      startZoom: currentZoom,
      targetZoom: flyTo.zoom !== undefined ? flyTo.zoom : currentZoom,
      startPanX: currentPan.x,
      startPanY: currentPan.y,
      startTime: performance.now(),
      duration: 1100, // 1.1s smooth glide
    };

    lastInteractionRef.current = performance.now() + 4000;
  }, [flyTo]);

  // Measure container dimensions safely (using unscaled layout dimensions to prevent transform feedback loops)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setDimensions((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch Natural Earth 110m TopoJSON
  useEffect(() => {
    let cancelled = false;
    fetch(WORLD_ATLAS_URL)
      .then((res) => res.json())
      .then((topo) => {
        if (!cancelled) {
          const parsed = parseTopoJson(topo);
          setCountries(parsed);
        }
      })
      .catch((err) => {
        console.warn('Failed to load world atlas for 3D Earth Globe:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { w, h } = dimensions;
  const cx = w / 2 + currentPan.x;
  const cy = h / 2 + currentPan.y;
  const radius = Math.max(20, (Math.min(w, h, 800) / 2 - 20) * currentZoom);

  // Animation Loop for imperative 60 FPS rendering
  useEffect(() => {
    if (countries.length === 0 || radius <= 0) return;
    let reqId = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Camera Flight Animation
      if (flyAnimRef.current) {
        const anim = flyAnimRef.current;
        const elapsed = now - anim.startTime;
        const progress = Math.min(1, Math.max(0, elapsed / anim.duration));
        // Smooth cubic ease-out
        const ease = 1 - Math.pow(1 - progress, 3);

        rotRef.current.lambda = anim.startLambda + (anim.targetLambda - anim.startLambda) * ease;
        rotRef.current.phi = anim.startPhi + (anim.targetPhi - anim.startPhi) * ease;

        if (anim.startPanX !== 0 || anim.startPanY !== 0) {
          updatePan({
            x: anim.startPanX * (1 - ease),
            y: anim.startPanY * (1 - ease),
          });
        }

        if (anim.targetZoom !== anim.startZoom) {
          updateZoom(anim.startZoom + (anim.targetZoom - anim.startZoom) * ease);
        }

        if (progress >= 1) {
          flyAnimRef.current = null;
        }
      } else if (autoRotate && !dragRef.current.active && now - lastInteractionRef.current > 1200) {
        rotRef.current.lambda += autoRotateSpeed * dt;
      }

      const { lambda, phi, gamma } = rotRef.current;

      // Update country polygon paths directly
      for (const country of countries) {
        const pathEl = pathMapRef.current.get(country.id);
        if (pathEl) {
          const d = renderGeometryPath(country.type, country.coords, lambda, phi, gamma, radius, cx, cy);
          pathEl.setAttribute('d', d);
        }
      }

      // Update graticule
      if (showGraticule && graticuleRef.current) {
        graticuleRef.current.setAttribute('d', renderGraticule(lambda, phi, gamma, radius, cx, cy));
      }

      // Update markers
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        const g = markerGroupRef.current.get(i);
        if (!g) continue;
        const p = projectPoint(m.longitude, m.latitude, lambda, phi, gamma, radius, cx, cy);
        if (p.v) {
          const opacity = clamp(p.rx * 4, 0, 1);
          g.style.opacity = String(opacity);
          g.style.display = '';
          g.setAttribute('transform', `translate(${p.sx.toFixed(1)},${p.sy.toFixed(1)})`);
        } else {
          g.style.opacity = '0';
          g.style.display = 'none';
        }
      }

      reqId = requestAnimationFrame(frame);
    };

    reqId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(reqId);
  }, [countries, markers, radius, cx, cy, autoRotate, autoRotateSpeed, showGraticule]);

  // Pointer drag events for interactive globe rotation and panning
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!enableDrag && !enablePan) return;
    flyAnimRef.current = null;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Multi-touch pinch zoom & pan
    if (activePointersRef.current.size === 2) {
      const points = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;
      pinchStartRef.current = {
        dist,
        zoom: currentZoom,
        midX,
        midY,
        panX: currentPan.x,
        panY: currentPan.y,
      };
      dragRef.current.active = false;
      return;
    }

    const px = e.clientX - rect.left - cx;
    const py = e.clientY - rect.top - cy;
    const isInsideGlobe = px * px + py * py <= (radius + 20) * (radius + 20);

    // Right-click (button 2), middle-click (button 1), Shift+left-click, or click outside globe = Pan
    const isPanAction = enablePan && (e.button === 2 || e.button === 1 || e.shiftKey || !isInsideGlobe);

    dragRef.current = {
      active: true,
      mode: isPanAction ? 'pan' : 'rotate',
      startX: e.clientX,
      startY: e.clientY,
      startLambda: rotRef.current.lambda,
      startPhi: rotRef.current.phi,
      startPanX: currentPan.x,
      startPanY: currentPan.y,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 2-finger pinch/pan gesture
    if (activePointersRef.current.size === 2 && pinchStartRef.current) {
      const points = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;

      if (enableZoom && pinchStartRef.current.dist > 0) {
        const scale = dist / pinchStartRef.current.dist;
        updateZoom(pinchStartRef.current.zoom * scale);
      }
      if (enablePan) {
        const dx = midX - pinchStartRef.current.midX;
        const dy = midY - pinchStartRef.current.midY;
        updatePan({
          x: pinchStartRef.current.panX + dx,
          y: pinchStartRef.current.panY + dy,
        });
      }
      return;
    }

    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    if (dragRef.current.mode === 'pan') {
      if (enablePan) {
        updatePan({
          x: dragRef.current.startPanX + dx,
          y: dragRef.current.startPanY + dy,
        });
      }
    } else {
      if (enableDrag) {
        const sensitivity = dragSensitivity / Math.max(0.6, Math.sqrt(currentZoom));
        rotRef.current.lambda = dragRef.current.startLambda - dx * sensitivity;
        rotRef.current.phi = clamp(dragRef.current.startPhi + dy * sensitivity, -85, 85);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStartRef.current = null;
    }

    if (dragRef.current.active) {
      dragRef.current.active = false;
      lastInteractionRef.current = performance.now();
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // Unique IDs for SVG gradients and clip path
  const uid = useMemo(() => Math.random().toString(36).slice(2, 7), []);
  const clipId = `globe-clip-${uid}`;
  const specularId = `globe-specular-${uid}`;
  const ambientShadowId = `globe-ambient-shadow-${uid}`;
  const oceanGradientId = `globe-ocean-${uid}`;

  const handleWheel = (e: React.WheelEvent) => {
    if (!enableZoom) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    updateZoom(currentZoom * factor);
    lastInteractionRef.current = performance.now();
  };

  const handleDoubleClick = () => {
    updateZoom(1.0);
    updatePan({ x: 0, y: 0 });
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden select-none pointer-events-auto ${className}`}
      style={{ touchAction: 'none' }}
    >
      <style>{`
        @keyframes globe-pulse {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.7); opacity: 0.05; }
        }
        .globe-pulse {
          animation: globe-pulse 2.2s ease-out infinite;
          transform-box: fill-box;
          transform-origin: center;
        }
      `}</style>

      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: dragRef.current.active
            ? (dragRef.current.mode === 'pan' ? 'move' : 'grabbing')
            : (enableDrag ? 'grab' : 'default'),
        }}
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={radius} />
          </clipPath>

          {/* 1. Deep Ocean Spherical Shading Base (Neutral Dark Slate) */}
          <linearGradient id={oceanGradientId} x1="22%" y1="18%" x2="88%" y2="88%">
            <stop offset="0%" stopColor="#252b31" />
            <stop offset="42%" stopColor={oceanColor} />
            <stop offset="100%" stopColor="#080a0c" />
          </linearGradient>

          {/* 2. Soft Top-Left Ambient Sunlight (Smooth, Neutral White) */}
          <radialGradient id={specularId} cx="30%" cy="26%" r="85%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.15)" />
            <stop offset="35%" stopColor="rgba(255, 255, 255, 0.03)" />
            <stop offset="70%" stopColor="rgba(255, 255, 255, 0)" />
          </radialGradient>

          {/* 3. Natural 3D Spherical Shadow (Smooth Curvature Chiaroscuro) */}
          <radialGradient id={ambientShadowId} cx="32%" cy="30%" r="98%">
            <stop offset="0%" stopColor="rgba(0, 0, 0, 0)" />
            <stop offset="46%" stopColor="rgba(0, 0, 0, 0)" />
            <stop offset="68%" stopColor="rgba(0, 0, 0, 0.28)" />
            <stop offset="86%" stopColor="rgba(0, 0, 0, 0.62)" />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0.88)" />
          </radialGradient>
        </defs>

        {/* 1. Base Ocean Disc */}
        <circle cx={cx} cy={cy} r={radius} fill={`url(#${oceanGradientId})`} />

        {/* 2. Clipped Landmasses & Graticule */}
        <g clipPath={`url(#${clipId})`}>
          {/* Graticule Grid lines */}
          {showGraticule && (
            <path
              ref={graticuleRef}
              fill="none"
              stroke="#282e36"
              strokeWidth={0.4}
              strokeOpacity={0.35}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {/* Country Polygons */}
          {countries.map((country) => (
            <path
              key={country.id}
              ref={(el) => {
                if (el) pathMapRef.current.set(country.id, el);
                else pathMapRef.current.delete(country.id);
              }}
              fill={landFill}
              stroke={landStroke}
              strokeWidth={strokeWidth}
              vectorEffect="non-scaling-stroke"
              style={{ transition: 'fill 140ms ease' }}
            />
          ))}
        </g>

        {/* 3. Ambient Sunlight & Specular Highlight */}
        <circle cx={cx} cy={cy} r={radius} fill={`url(#${specularId})`} pointerEvents="none" />

        {/* 4. Natural Spherical Falloff Shadow (Smooth 3D Curvature) */}
        <circle cx={cx} cy={cy} r={radius} fill={`url(#${ambientShadowId})`} pointerEvents="none" />

        {/* 5. Projected Project Markers (Framer-style 3D Red Pin) */}
        {markers.map((m, idx) => {
          const color = m.color || '#e53e3e';
          return (
            <g
              key={idx}
              ref={(el) => {
                if (el) markerGroupRef.current.set(idx, el);
                else markerGroupRef.current.delete(idx);
              }}
              style={{ cursor: 'pointer', opacity: 0 }}
              onClick={() => {
                if (onMarkerClick) onMarkerClick(m);
                else if (onZoomIn) onZoomIn();
              }}
              onMouseEnter={(e) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) {
                  setHoveredMarker({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    label: m.label,
                    description: m.description,
                  });
                }
              }}
              onMouseLeave={() => setHoveredMarker(null)}
            >
              {/* Outer pulsing radar ring */}
              <circle className="globe-pulse" r={9} fill={colorWithAlpha(color, 0.4)} />
              {/* Secondary ring */}
              <circle r={11} fill={colorWithAlpha(color, 0.12)} />
              {/* Center 3D pin node */}
              <circle r={4.5} fill={color} />
              <circle cx={-1.2} cy={-1.2} r={1.3} fill="rgba(255,255,255,0.9)" />

              {/* Label */}
              {showLabels && m.label && (
                <text
                  x={12}
                  y={4}
                  fill="#ffffff"
                  fontSize={11}
                  fontWeight={600}
                  letterSpacing="0.02em"
                  stroke="#080a0d"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip on Marker Hover */}
      {hoveredMarker && (
        <div
          className="absolute pointer-events-none z-30 flex flex-col gap-1 px-3 py-2 rounded-lg bg-neutral-900/95 border border-neutral-700 text-neutral-100 shadow-2xl backdrop-blur-md"
          style={{
            left: hoveredMarker.x + 14,
            top: hoveredMarker.y - 14,
            transform: 'translateY(-100%)',
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <span className="text-xs font-bold tracking-tight text-white">{hoveredMarker.label}</span>
          </div>
          {hoveredMarker.description && (
            <span className="text-[10px] text-neutral-300 leading-tight">
              {hoveredMarker.description}
            </span>
          )}
          <span className="text-[9px] text-neutral-400 font-mono mt-0.5 pt-0.5 border-t border-neutral-800">
            Click or scroll to zoom into district →
          </span>
        </div>
      )}
    </div>
  );
};

export default EarthGlobe;
