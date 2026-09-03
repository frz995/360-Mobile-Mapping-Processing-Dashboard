import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { CubemapTilesAdapter } from '@photo-sphere-viewer/cubemap-tiles-adapter';
import '@photo-sphere-viewer/core/index.css';
import { setHeading } from '../utils/headingStore';

export interface PhotoSphereViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  toggleFullscreen: () => void;
  getPosition: () => { yaw: number; pitch: number; fov: number } | null;
  /** Orient the camera to a heading in degrees (radians internally). */
  setPosition: (position: { yaw?: number; pitch?: number; fov?: number }) => void;
}

export interface PhotoSphereViewerProps {
  panoramaUrl?: string;
  configUrl?: string;
  caption?: string;
  className?: string;
  /** Initial view heading (bearing) in degrees — orients the first frame. */
  initialYaw?: number;
  /** Initial field of view in degrees — sets the starting zoom (clamped to min/max FOV). */
  initialFov?: number;
  onPositionChange?: (position: { yaw: number; pitch: number; fov?: number }) => void;
}

const DEFAULT_MIN_FOV = 30;
const DEFAULT_MAX_FOV = 110;

// Map a requested FOV (degrees) to PSV's zoom level (0..100). PSV zooms linearly
// from maxFov (zoom 0) down to minFov (zoom 100).
function fovToZoomLevel(fov: number, minFov: number, maxFov: number): number {
  const clamped = Math.min(maxFov, Math.max(minFov, fov));
  return ((maxFov - clamped) / (maxFov - minFov)) * 100;
}

const FACE_MAP: Record<string, string> = {
  front: 'b',
  back: 'f',
  left: 'r',
  right: 'l',
  top: 'u',
  bottom: 'd',
};

function buildCubemapPanorama(configUrl: string) {
  const cleanConfigUrl = configUrl.trim();
  const rawBasePath = cleanConfigUrl.substring(0, cleanConfigUrl.lastIndexOf('/') + 1).trim();
  const cleanBasePath = rawBasePath.replace(/([^:]\/)\/+/g, '$1').replace(/\/+$/, '');

  return {
    baseUrl: {
      front: `${cleanBasePath}/fallback/b.jpg`,
      back: `${cleanBasePath}/fallback/f.jpg`,
      left: `${cleanBasePath}/fallback/r.jpg`,
      right: `${cleanBasePath}/fallback/l.jpg`,
      top: `${cleanBasePath}/fallback/u.jpg`,
      bottom: `${cleanBasePath}/fallback/d.jpg`,
    },
    levels: [
      { faceSize: 512, nbTiles: 1 },
      { faceSize: 1024, nbTiles: 2 },
      { faceSize: 2048, nbTiles: 4 },
    ],
    tileUrl: (face: string, col: number, row: number, level: number) => {
      const faceKey = FACE_MAP[face] || face[0];
      const levelNum = (typeof level === 'number' ? level : 0) + 1;
      return `${cleanBasePath}/${levelNum}/${faceKey}${row}_${col}.jpg`;
    },
  };
}

export const PhotoSphereViewerComponent = forwardRef<PhotoSphereViewerHandle, PhotoSphereViewerProps>(
  ({ panoramaUrl, configUrl, caption, className = 'w-full h-full min-h-[300px]', initialYaw = 0, initialFov, onPositionChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Viewer | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [progress, setProgress] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const onPositionChangeRef = useRef(onPositionChange);
    useEffect(() => {
      onPositionChangeRef.current = onPositionChange;
    }, [onPositionChange]);

    // Keep the latest initial heading without re-running the (heavy) panorama effect
    // on every change — prevents the viewer from hot-swapping texture while rotating.
    const initialYawRef = useRef(initialYaw);
    useEffect(() => {
      initialYawRef.current = initialYaw;
    }, [initialYaw]);

    // Keep the latest desired FOV without re-running the (heavy) panorama effect.
    const initialFovRef = useRef(initialFov);
    useEffect(() => {
      initialFovRef.current = initialFov;
    }, [initialFov]);

    // rAF-batched onPositionChange: the host posts CAMERA_ROTATED to the map
    // iframe; coalesce per-frame position events into a single callback (max one
    // per animation frame) to avoid saturating the main thread with map updates.
    const throttleAccumRef = useRef<{ has: boolean; yaw: number; pitch: number; fov?: number }>({ has: false, yaw: 0, pitch: 0 });
    const throttleFrameRef = useRef<number | null>(null);

    const flushPositionChange = useCallback(() => {
      throttleFrameRef.current = null;
      const acc = throttleAccumRef.current;
      if (!acc.has) return;
      acc.has = false;
      onPositionChangeRef.current?.({
        yaw: acc.yaw,
        pitch: acc.pitch,
        fov: acc.fov,
      });
    }, []);

    const queuePositionChange = useCallback((pos: { yaw: number; pitch: number; fov?: number }) => {
      const acc = throttleAccumRef.current;
      acc.has = true;
      acc.yaw = pos.yaw;
      acc.pitch = pos.pitch;
      acc.fov = pos.fov;
      if (throttleFrameRef.current == null) {
        throttleFrameRef.current = requestAnimationFrame(flushPositionChange);
      }
    }, [flushPositionChange]);

    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        if (viewerRef.current) {
          viewerRef.current.zoom(viewerRef.current.getZoomLevel() + 15);
        }
      },
      zoomOut: () => {
        if (viewerRef.current) {
          viewerRef.current.zoom(viewerRef.current.getZoomLevel() - 15);
        }
      },
      toggleFullscreen: () => {
        if (viewerRef.current) {
          viewerRef.current.toggleFullscreen();
        }
      },
      getPosition: () => {
        if (!viewerRef.current) return null;
        const pos = viewerRef.current.getPosition();
        return {
          yaw: (pos.yaw * 180) / Math.PI,
          pitch: (pos.pitch * 180) / Math.PI,
          fov: viewerRef.current.getZoomLevel(),
        };
      },
      setPosition: ({ yaw, pitch, fov }) => {
        if (!viewerRef.current) return;
        if (typeof fov === 'number' && isFinite(fov) && fov > 0) viewerRef.current.zoom(fov);
        if (typeof yaw === 'number' && isFinite(yaw) && typeof pitch === 'number' && isFinite(pitch)) {
          viewerRef.current.rotate({ yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 });
        }
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;
      let isMounted = true;

      const targetPanorama = configUrl ? buildCubemapPanorama(configUrl) : (panoramaUrl ? panoramaUrl.trim() : null);
      if (!targetPanorama) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setProgress(null);
      setLoadError(null);

      // Instant preloader listener for single equirectangular images
      if (panoramaUrl) {
        const preloadImg = new Image();
        preloadImg.onload = () => {
          if (isMounted) {
            setIsLoading(false);
            setProgress(null);
          }
        };
        preloadImg.onerror = () => {
          if (isMounted) {
            setLoadError('Unable to load the 360° image (request failed or file missing).');
            setIsLoading(false);
          }
        };
        preloadImg.src = panoramaUrl.trim();
      }

      if (viewerRef.current) {
        // Hot-swap texture on existing GPU canvas
        viewerRef.current.setPanorama(targetPanorama, {
          transition: false,
          showLoader: false,
        })
          .then(() => {
            if (isMounted) {
              setLoadError(null);
              setIsLoading(false);
              setProgress(null);
              // Orient the first frame to the new point's heading (bearing).
              const iy = initialYawRef.current;
              if (typeof iy === 'number' && isFinite(iy)) {
                const curPos = viewerRef.current?.getPosition();
                try {
                  viewerRef.current?.rotate({
                    yaw: (iy * Math.PI) / 180,
                    pitch: curPos?.pitch ?? 0,
                  });
                } catch (_) { }
              }
            }
          })
          .catch((err) => {
            console.warn('Fast panorama swap notice:', err);
            if (isMounted) {
              setLoadError('Unable to load the 360° image (request failed or file missing).');
              setIsLoading(false);
            }
          });
        return;
      }

      // Initial Mount: Build viewer instance once
      try {
        const viewerInstance = new Viewer({
          container: containerRef.current,
          adapter: configUrl ? CubemapTilesAdapter : undefined,
          sphereCorrection: { pan: '180deg' },
          navbar: false,
          panorama: targetPanorama,
          caption: caption || '360° Panorama Inspection',
          defaultYaw: `${initialYawRef.current ?? 0}deg`,
          defaultPitch: '0deg',
          defaultZoomLvl: initialFovRef.current
            ? fovToZoomLevel(initialFovRef.current, DEFAULT_MIN_FOV, DEFAULT_MAX_FOV)
            : 0,
          minFov: DEFAULT_MIN_FOV,
          maxFov: DEFAULT_MAX_FOV,
          moveSpeed: 1,
          touchmoveTwoFingers: false,
          mousewheel: true,
          mousewheelCtrlKey: false,
          loadingImg: undefined,
          loadingTxt: '',
        });

        viewerInstance.addEventListener('panorama-loaded', () => {
          if (isMounted) {
            setLoadError(null);
            setIsLoading(false);
          }
        });

        viewerInstance.addEventListener('panorama-error' as any, () => {
          if (isMounted) {
            setLoadError('Unable to load the 360° image (request failed or file missing).');
            setIsLoading(false);
          }
        });

        viewerInstance.addEventListener('load-progress' as any, ({ progress: p }: any) => {
          if (isMounted && typeof p === 'number') {
            setProgress(Math.round(p));
            if (p >= 100) {
              setLoadError(null);
              setIsLoading(false);
            }
          }
        });

        viewerInstance.addEventListener('position-updated', ({ position }) => {
          setHeading((position.yaw * 180) / Math.PI);
          queuePositionChange({
            yaw: (position.yaw * 180) / Math.PI,
            pitch: (position.pitch * 180) / Math.PI,
            fov: viewerInstance?.getZoomLevel() ?? 50,
          });
        });

        viewerInstance.addEventListener('zoom-updated', ({ zoomLevel }) => {
          const pos = viewerInstance?.getPosition();
          if (pos) {
            setHeading((pos.yaw * 180) / Math.PI);
            queuePositionChange({
              yaw: (pos.yaw * 180) / Math.PI,
              pitch: (pos.pitch * 180) / Math.PI,
              fov: zoomLevel,
            });
          }
        });

        viewerRef.current = viewerInstance;
      } catch (err) {
        console.error('Failed to initialize PhotoSphereViewer:', err);
        if (isMounted) {
          setLoadError('Failed to initialize the 360° viewer.');
          setIsLoading(false);
        }
      }

      // Last-resort timeout for loads that neither complete nor error (e.g. stalled
      // cubemap tile fetch). Dismisses the spinner so the canvas isn't stuck forever.
      // Genuine failures are caught earlier by panorama-error and show the placeholder.
      const stallTimer = setTimeout(() => {
        if (isMounted) setIsLoading(false);
      }, 6000);

      return () => {
        isMounted = false;
        clearTimeout(stallTimer);
      };
    }, [panoramaUrl, configUrl, caption]);

    // Unmount cleanup
    useEffect(() => {
      return () => {
        if (throttleFrameRef.current != null) {
          cancelAnimationFrame(throttleFrameRef.current);
          throttleFrameRef.current = null;
        }
        if (viewerRef.current) {
          viewerRef.current.destroy();
          viewerRef.current = null;
        }
      };
    }, []);

    // Handle container resize cleanly (e.g. workspace switching or window resize)
    useEffect(() => {
      const container = containerRef.current;
      if (!container || typeof ResizeObserver === 'undefined') return;

      let rafId: number | null = null;
      const ro = new ResizeObserver(() => {
        if (rafId != null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (viewerRef.current && container.clientWidth > 0 && container.clientHeight > 0) {
            try {
              (viewerRef.current as any).autoSize?.();
            } catch (_) { }
          }
        });
      });

      ro.observe(container);
      return () => {
        if (rafId != null) cancelAnimationFrame(rafId);
        ro.disconnect();
      };
    }, []);

    return (
      <div className={`relative overflow-hidden ${className}`}>
        <div ref={containerRef} className="w-full h-full" />

        {/* Clean Centered 360 Loading Progress Card */}
        {isLoading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-sm transition-opacity duration-200 pointer-events-none select-none animate-in fade-in zoom-in-95">
            <div className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-card/90 border border-subtle shadow-2xl min-w-[220px] max-w-[260px] text-center">
              {/* Dual Concentric Ring Radar Spinner */}
              <div className="relative w-11 h-11 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-subtle/40" />
                <div className="absolute inset-0 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
                <span className="text-[10px] font-sans font-bold text-sky-300">
                  {progress !== null ? `${progress}%` : '360°'}
                </span>
              </div>

              <div className="space-y-0.5">
                <div className="text-xs font-bold tracking-wide text-text-base">
                  Buffering 360° Sphere
                </div>
                <div className="text-[10px] text-text-muted">
                  {progress !== null ? `Loading texture (${progress}%)` : 'Rendering projection matrix...'}
                </div>
              </div>

              {/* Minimalist Progress Track */}
              <div className="w-full h-1 bg-inner rounded-full overflow-hidden border border-subtle/50 mt-1">
                <div
                  className="h-full bg-sky-400 rounded-full transition-all duration-200"
                  style={{
                    width: progress !== null ? `${Math.max(10, progress)}%` : '100%',
                    animation: progress === null ? 'pulse 1.2s infinite ease-in-out' : undefined
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Load Failure Placeholder (avoids a silent white canvas) */}
        {!isLoading && loadError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity duration-200 pointer-events-none select-none animate-in fade-in">
            <div className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-card/90 border border-rose-500/30 shadow-2xl min-w-[240px] max-w-[300px] text-center">
              <div className="w-11 h-11 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                <span className="text-rose-400 font-bold text-lg leading-none">!</span>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-bold tracking-wide text-text-base">360° Image Unavailable</div>
                <div className="text-[10px] text-text-muted leading-relaxed">{loadError}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

PhotoSphereViewerComponent.displayName = 'PhotoSphereViewerComponent';

export default PhotoSphereViewerComponent;