import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { CubemapTilesAdapter } from '@photo-sphere-viewer/cubemap-tiles-adapter';
import '@photo-sphere-viewer/core/index.css';

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
  onPositionChange?: (position: { yaw: number; pitch: number; fov?: number }) => void;
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
  ({ panoramaUrl, configUrl, caption, className = 'w-full h-full min-h-[300px]', onPositionChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Viewer | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [progress, setProgress] = useState<number | null>(null);

    const onPositionChangeRef = useRef(onPositionChange);
    useEffect(() => {
      onPositionChangeRef.current = onPositionChange;
    }, [onPositionChange]);

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
          if (isMounted) setIsLoading(false);
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
              setIsLoading(false);
              setProgress(null);
            }
          })
          .catch((err) => {
            console.warn('Fast panorama swap notice:', err);
            if (isMounted) setIsLoading(false);
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
          defaultYaw: '0deg',
          defaultPitch: '0deg',
          touchmoveTwoFingers: false,
          mousewheel: true,
          mousewheelCtrlKey: false,
          loadingImg: undefined,
          loadingTxt: '',
        });

        viewerInstance.addEventListener('ready', () => {
          if (isMounted) setIsLoading(false);
        });

        viewerInstance.addEventListener('panorama-loaded', () => {
          if (isMounted) setIsLoading(false);
        });

        viewerInstance.addEventListener('load-progress' as any, ({ progress: p }: any) => {
          if (isMounted && typeof p === 'number') {
            setProgress(Math.round(p));
            if (p >= 100) setIsLoading(false);
          }
        });

        viewerInstance.addEventListener('position-updated', ({ position }) => {
          onPositionChangeRef.current?.({
            yaw: (position.yaw * 180) / Math.PI,
            pitch: (position.pitch * 180) / Math.PI,
            fov: viewerInstance?.getZoomLevel() ?? 50,
          });
        });

        viewerInstance.addEventListener('zoom-updated', ({ zoomLevel }) => {
          const pos = viewerInstance?.getPosition();
          if (pos) {
            onPositionChangeRef.current?.({
              yaw: (pos.yaw * 180) / Math.PI,
              pitch: (pos.pitch * 180) / Math.PI,
              fov: zoomLevel,
            });
          }
        });

        viewerRef.current = viewerInstance;
      } catch (err) {
        console.error('Failed to initialize PhotoSphereViewer:', err);
        if (isMounted) setIsLoading(false);
      }

      // Guaranteed timeout safeguard: Ensures progress overlay always dismisses once loaded
      const safetyTimer = setTimeout(() => {
        if (isMounted) setIsLoading(false);
      }, 700);

      return () => {
        isMounted = false;
        clearTimeout(safetyTimer);
      };
    }, [panoramaUrl, configUrl, caption]);

    // Unmount cleanup
    useEffect(() => {
      return () => {
        if (viewerRef.current) {
          viewerRef.current.destroy();
          viewerRef.current = null;
        }
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
      </div>
    );
  }
);

PhotoSphereViewerComponent.displayName = 'PhotoSphereViewerComponent';

export default PhotoSphereViewerComponent;