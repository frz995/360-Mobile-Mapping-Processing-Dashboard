import React, { useEffect, useRef } from 'react';
import AtomicGlobe from './AtomicGlobe';

export interface AtomicGlobeMarker {
  label?: string;
  lat: number;
  lng: number;
  description?: string;
  image?: string;
  buttonText?: string;
  buttonLink?: string;
}

interface AtomicGlobeHostProps {
  markers: AtomicGlobeMarker[];
  className?: string;
  style?: React.CSSProperties;
  activeMarkerLabel?: string | null;
  onActiveMarkerProjected?: (pos: { x: number; y: number; visible: boolean }) => void;
  /** When set, rotates the globe to face this coordinate and dives in (mirrors
   *  the vector globe's `flyTo`). Pass `null` to release back to overview. */
  focusTarget?: { lat: number; lng: number } | null;
  /** Reference coordinate projected to screen each frame for the HUD leader
   *  line — reported through `onActiveMarkerProjected` (mirrors the vector
   *  globe's `activeTargetCoord`). */
  activeTargetCoord?: { lat: number; lng: number } | null;
  /** Camera zoom multiplier (1.05 baseline), mirrors the vector globe's `zoom`. */
  zoom?: number;
  /** Report zoom changes (mirrors EarthGlobe's `onZoomChange`). */
  onZoomChange?: (zoom: number) => void;
  /** Allow mouse-wheel zoom over the globe. */
  enableZoom?: boolean;
  /** Called when the user starts dragging the globe (pointer down on canvas). */
  onDragStart?: () => void;

  // AtomicGlobe tuning (flattened for readability)
  backgroundColor?: string;
  dotColor?: string;
  dotDensity?: number;
  baseSize?: number;
  backParticleOpacity?: number;
  rotationSpeed?: number;
  centerLng?: number;
  tilt?: number;
  globeScale?: number;
  positionX?: number;
  positionY?: number;
  introDuration?: number;
  persistentAssembly?: boolean;
  reformOnScroll?: boolean;
  allowVerticalDrag?: boolean;
  verticalDragLimit?: number;
  enableHover?: boolean;
  markerType?: 'beacon' | 'pin';
  pinColor?: string;
  markerBgColor?: string;
  markerTextColor?: string;
  markerActiveBgColor?: string;
  markerActiveIconColor?: string;
  showArcs?: boolean;
  arcColor?: string;
  arcSpeed?: number;
  arcMode?: 'chain' | 'all';
  arcHeight?: number;
  performanceMode?: 'auto' | 'high' | 'low';
}

export function AtomicGlobeHost({
  markers,
  className,
  style,
  activeMarkerLabel = null,
  onActiveMarkerProjected,
  focusTarget,
  activeTargetCoord,
  zoom,
  onZoomChange,
  enableZoom,
  onDragStart,
  ...tuning
}: AtomicGlobeHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeLabelRef = useRef(activeMarkerLabel);
  const onProjectedRef = useRef(onActiveMarkerProjected);

  useEffect(() => {
    activeLabelRef.current = activeMarkerLabel;
  }, [activeMarkerLabel]);

  useEffect(() => {
    onProjectedRef.current = onActiveMarkerProjected;
  }, [onActiveMarkerProjected]);

  // Track the active marker's DOM pill as AtomicGlobe repositions it every
  // frame, reporting viewport coords (same convention as the vector globe's
  // projection callback) so the HUD leader line can anchor on it.
  useEffect(() => {
    if (!hostRef.current || !onActiveMarkerProjected || activeTargetCoord) return;
    let raf = 0;
    const tick = () => {
      const callbacks = onProjectedRef.current;
      const label = activeLabelRef.current;
      const el = hostRef.current;
      if (callbacks && label && el) {
        const wraps = Array.from(el.querySelectorAll<HTMLElement>('.marker-beacon-wrap'));
        let reported = false;
        for (const wrap of wraps) {
          const labelEl = wrap.querySelector<HTMLElement>('span:last-of-type');
          const pillLabel = labelEl?.textContent?.trim();
          if (pillLabel !== label) continue;
          const posEl = wrap.parentElement;
          const cs = posEl ? window.getComputedStyle(posEl) : null;
          const visible = !!cs && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
          const r = wrap.getBoundingClientRect();
          callbacks({
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
            visible,
          });
          reported = true;
          break;
        }
        if (!reported) {
          callbacks({ x: 0, y: 0, visible: false });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onActiveMarkerProjected, activeTargetCoord]);

  // NOTE: AtomicGlobe merges its default group props (globe/points/assembly/
  // drag/lens/hotspots/paths) LAST over top-level props, so tuning values are
  // only honored when passed inside the matching nested group object. That
  // merge is SHALLOW (React defaultProps): once a group object is supplied,
  // any key missing from it stays `undefined` inside the component — NaN
  // position/props would make the whole globe invisible. So every group below
  // is always complete, with our tunings overriding the component defaults.
  const finite = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

  const safeMarkers = (markers ?? [])
    .map((m) => ({ ...m, lat: finite(m.lat, 0), lng: finite(m.lng, 0) }))
    .filter((m) => m.lat >= -90 && m.lat <= 90 && m.lng >= -180 && m.lng <= 180);

  const globeProps = {
    style: { width: '100%', height: '100%' },
    focusTarget: focusTarget ?? null,
    activeTargetCoord: activeTargetCoord ?? null,
    onActiveTargetProjected: onActiveMarkerProjected,
    onDragStart,
    zoom: zoom ?? 1,
    markers: safeMarkers,
    globe: {
      backgroundColor: tuning.backgroundColor ?? '#0A1730',
      globeScale: finite(tuning.globeScale, 1.1),
      rotationSpeed: finite(tuning.rotationSpeed, 0.06),
      tilt: finite(tuning.tilt, 18),
      centerLng: finite(tuning.centerLng, 0),
      positionX: finite(tuning.positionX, 0),
      positionY: finite(tuning.positionY, 0),
      performanceMode: tuning.performanceMode ?? 'auto',
    },
    points: {
      dotColor: tuning.dotColor ?? '#CFE0FF',
      dotDensity: finite(tuning.dotDensity, 13e4),
      baseSize: finite(tuning.baseSize, 5),
      sizeRandomness: 1,
      backParticleOpacity: finite(tuning.backParticleOpacity, 0.12),
    },
    assembly: {
      introDuration: finite(tuning.introDuration, 2.5),
      reformOnScroll: tuning.reformOnScroll ?? true,
      persistentAssembly: tuning.persistentAssembly ?? false,
    },
    drag: {
      allowVerticalDrag: tuning.allowVerticalDrag ?? true,
      verticalDragLimit: finite(tuning.verticalDragLimit, 70),
    },
    lens: {
      enableHover: tuning.enableHover ?? true,
      hoverDelay: 0,
      hoverParticleColor: '#EAF2FF',
      lensRadius: 0.45,
      lensMagnification: 0.02,
      lensBulge: 0.02,
      lensParticleScale: 1,
    },
    hotspots: {
      markerType: tuning.markerType ?? 'beacon',
      pinHeight: 0.12,
      pinColor: tuning.pinColor ?? '#60A5FA',
      markerBgColor: tuning.markerBgColor ?? '#141A2E',
      markerTextColor: tuning.markerTextColor ?? '#FFFFFF',
      markerActiveBgColor: tuning.markerActiveBgColor ?? '#60A5FA',
      markerActiveIconColor: tuning.markerActiveIconColor ?? '#08122B',
    },
    paths: {
      showArcs: tuning.showArcs ?? true,
      arcColor: tuning.arcColor ?? '#60A5FA',
      arcSpeed: finite(tuning.arcSpeed, 0.25),
      arcMode: tuning.arcMode ?? 'chain',
      arcHeight: finite(tuning.arcHeight, 0.4),
    },
  };

  return (
    <div
      ref={hostRef}
      className={className}
      style={{
        ...style,
        background: 'radial-gradient(circle at 50% 50%, rgba(96,165,250,0.12) 0%, rgba(96,165,250,0.04) 35%, transparent 65%)',
      }}
      onWheel={(e) => {
        if (!enableZoom || !onZoomChange) return;
        e.preventDefault();
        e.stopPropagation();
        const base = zoom ?? 1;
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        onZoomChange(Math.min(8, Math.max(0.5, base * factor)));
      }}
    >
      <AtomicGlobe {...globeProps} />
    </div>
  );
}

export default AtomicGlobeHost;