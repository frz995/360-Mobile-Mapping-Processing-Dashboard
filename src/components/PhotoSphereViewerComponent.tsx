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

/**
 * Turn a panorama load failure into something the operator can act on.
 *
 * WHY NOT ONE GENERIC MESSAGE
 *   Every failure previously read "request failed or file missing". That is a
 *   claim about the filesystem that the browser never checks: a 401 means the
 *   credentials were refused, a 404/400 means the key is absent, a 502 means
 *   the image service is down, and a blocked request means the status is
 *   genuinely unknown. Telling an operator their file is missing when the file
 *   is fine and the request was merely unauthorised sends them to the wrong
 *   machine.
 *
 * `three` raises `HttpError`, which carries the real `status`; a bare
 * `Image.onerror` and an opaque CORS rejection carry none, and those are
 * reported as unknown rather than guessed at.
 */
function describePanoramaFailure(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status > 0) {
    if (status === 400 || status === 404) {
      return `Storage has no object at this URL (HTTP ${status}). The panorama key is wrong — check the tenant folder the URL resolves to.`;
    }
    if (status === 401 || status === 403) {
      return `Access refused (HTTP ${status}). The image URL requires credentials an image tag cannot send.`;
    }
    if (status >= 500) {
      return `The image service failed (HTTP ${status}). The file was not checked.`;
    }
    return `The image request failed (HTTP ${status}).`;
  }
  return 'No response arrived — CORS, network, or mixed-content block. Whether the file exists is unknown.';
}

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

function deriveAlternatePanoramaUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = url.trim();
  if (clean.includes('/storage/v1/object/public/')) {
    const [baseUrl, rest] = clean.split('/storage/v1/object/public/');
    const parts = rest.split('/');
    if (parts.length > 2) {
      // If path has a subfolder (e.g. MMS_PIC/DevTest/N93E70-0001.jpg), fallback to root MMS_PIC/N93E70-0001.jpg
      const bucket = parts[0];
      const filename = parts[parts.length - 1];
      return `${baseUrl}/storage/v1/object/public/${bucket}/${filename}`;
    }
  } else {
    try {
      const u = new URL(clean);
      const segments = u.pathname.split('/').filter(Boolean);
      if (segments.length > 1) {
        u.pathname = `/${segments[segments.length - 1]}`;
        return u.toString();
      }
    } catch {}
  }
  return null;
}

function deriveAlternateConfigUrl(url?: string | null): string | null {
  if (!url) return null;
  const clean = url.trim();
  try {
    const u = new URL(clean);
    const prefixedMatch = u.pathname.match(/^\/[^/]+(\/tiles\/.+)$/i);
    if (prefixedMatch) {
      u.pathname = prefixedMatch[1];
      return u.toString();
    }
  } catch {}
  return null;
}

const configProbeCache = new Map<string, boolean>();

async function probeConfigUrl(url?: string | null): Promise<string | null> {
  if (!url) return null;
  const clean = url.trim();
  if (configProbeCache.get(clean) === true) return clean;

  const alt = deriveAlternateConfigUrl(clean);
  if (configProbeCache.get(clean) === false && alt && configProbeCache.get(alt) === true) {
    return alt;
  }

  try {
    const res = await fetch(clean, { method: 'HEAD' });
    if (res.ok) {
      configProbeCache.set(clean, true);
      return clean;
    }
  } catch {
    try {
      const res = await fetch(clean, { method: 'GET' });
      if (res.ok) {
        configProbeCache.set(clean, true);
        return clean;
      }
    } catch {}
  }
  configProbeCache.set(clean, false);

  if (alt && alt !== clean) {
    if (configProbeCache.get(alt) === true) return alt;
    try {
      const res = await fetch(alt, { method: 'HEAD' });
      if (res.ok) {
        configProbeCache.set(alt, true);
        return alt;
      }
    } catch {
      try {
        const res = await fetch(alt, { method: 'GET' });
        if (res.ok) {
          configProbeCache.set(alt, true);
          return alt;
        }
      } catch {}
    }
    configProbeCache.set(alt, false);
  }

  return null;
}

export const PhotoSphereViewerComponent = forwardRef<PhotoSphereViewerHandle, PhotoSphereViewerProps>(
  ({ panoramaUrl, configUrl, caption, className = 'w-full h-full min-h-[260px]', initialYaw = 0, initialFov, onPositionChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Viewer | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [progress, setProgress] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const onPositionChangeRef = useRef(onPositionChange);
    useEffect(() => {
      onPositionChangeRef.current = onPositionChange;
    }, [onPositionChange]);

    const initialYawRef = useRef(initialYaw);
    useEffect(() => {
      initialYawRef.current = initialYaw;
    }, [initialYaw]);

    const initialFovRef = useRef(initialFov);
    useEffect(() => {
      initialFovRef.current = initialFov;
    }, [initialFov]);

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
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      const loadViewer = async () => {
        setIsLoading(true);
        setProgress(null);
        setLoadError(null);

        let validConfig: string | null = null;
        if (configUrl && (configUrl.startsWith('http://') || configUrl.startsWith('https://'))) {
          validConfig = await probeConfigUrl(configUrl);
        }

        if (!isMounted) return;

        const hasValidConfigUrl = Boolean(validConfig);
        const targetPanorama = hasValidConfigUrl
          ? buildCubemapPanorama(validConfig!)
          : (panoramaUrl ? panoramaUrl.trim() : null);

        if (!targetPanorama) {
          setIsLoading(false);
          return;
        }

        const alternatePanorama = !hasValidConfigUrl && typeof targetPanorama === 'string'
          ? deriveAlternatePanoramaUrl(targetPanorama)
          : null;

        // Instant preloader listener for single equirectangular images with fallback resilience
        if (panoramaUrl && !hasValidConfigUrl) {
          const tryPreload = (src: string, isFallback = false) => {
            const preloadImg = new Image();
            preloadImg.crossOrigin = 'anonymous';
            preloadImg.onload = () => {
              if (isMounted) {
                setIsLoading(false);
                setProgress(null);
                setLoadError(null);
                if (isFallback && viewerRef.current) {
                  viewerRef.current.setPanorama(src, { transition: false, showLoader: false }).catch(() => {});
                }
              }
            };
            preloadImg.onerror = () => {
              if (!isMounted) return;
              if (!isFallback && alternatePanorama && alternatePanorama !== src) {
                tryPreload(alternatePanorama, true);
                return;
              }
              setLoadError('No response arrived — CORS, network, or mixed-content block. Whether the file exists is unknown.');
              setIsLoading(false);
            };
            preloadImg.src = src;
          };

          tryPreload(panoramaUrl.trim());
        }

        // If existing viewer needs an adapter change (cubemap tiles vs equirectangular), recreate instance cleanly
        if (viewerRef.current) {
          const hasAdapter = Boolean((viewerRef.current as any).adapter);
          if (hasAdapter !== hasValidConfigUrl) {
            try {
              viewerRef.current.destroy();
            } catch (_) {}
            viewerRef.current = null;
          }
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
                const iy = initialYawRef.current;
                if (typeof iy === 'number' && isFinite(iy)) {
                  const curPos = viewerRef.current?.getPosition();
                  try {
                    viewerRef.current?.rotate({
                      yaw: (iy * Math.PI) / 180,
                      pitch: typeof curPos?.pitch === 'number' ? curPos.pitch : 0,
                    });
                  } catch (_) { }
                }
              }
            })
            .catch((err) => {
              console.warn('Fast panorama swap notice:', err);
              if (alternatePanorama && alternatePanorama !== targetPanorama) {
                viewerRef.current?.setPanorama(alternatePanorama, { transition: false, showLoader: false })
                  .then(() => {
                    if (isMounted) {
                      setLoadError(null);
                      setIsLoading(false);
                      setProgress(null);
                    }
                  })
                  .catch((altErr) => {
                    if (isMounted) {
                      setLoadError(describePanoramaFailure(altErr));
                      setIsLoading(false);
                    }
                  });
                return;
              }
              if (isMounted) {
                setLoadError(describePanoramaFailure(err));
                setIsLoading(false);
              }
            });
          return;
        }

        // Initial Mount: Build viewer instance once
        try {
          const viewerInstance = new Viewer({
            container: containerRef.current!,
            adapter: hasValidConfigUrl ? CubemapTilesAdapter : undefined,
            sphereCorrection: { pan: '180deg' },
            navbar: false,
            panorama: targetPanorama,
            caption: caption || '360° Panorama Inspection',
            defaultYaw: `${typeof initialYawRef.current === 'number' ? initialYawRef.current : 0}deg`,
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

          viewerInstance.addEventListener('panorama-error' as any, (event: any) => {
            if (isMounted) {
              if (alternatePanorama && alternatePanorama !== targetPanorama) {
                viewerInstance.setPanorama(alternatePanorama, { transition: false, showLoader: false })
                  .catch(() => {
                    const cause = event?.cause || event?.error || event?.content || event;
                    setLoadError(describePanoramaFailure(cause));
                    setIsLoading(false);
                  });
                return;
              }
              const cause = event?.cause || event?.error || event?.content || event;
              console.warn('Panorama load failed:', cause);
              setLoadError(describePanoramaFailure(cause));
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
      };

      void loadViewer();

      stallTimer = setTimeout(() => {
        if (isMounted) setIsLoading(false);
      }, 6000);

      return () => {
        isMounted = false;
        if (stallTimer) clearTimeout(stallTimer);
      };
    }, [panoramaUrl, configUrl, caption, queuePositionChange]);

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

        {/* Load Failure Placeholder (avoids a silent white canvas)

            Fully opaque on purpose. Photo Sphere Viewer renders its own error
            template inside the container below; at 80% opacity with a blur the
            two messages showed through each other and the operator read a single
            garbled failure. One surface, one reason. */}
        {!isLoading && loadError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950">
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