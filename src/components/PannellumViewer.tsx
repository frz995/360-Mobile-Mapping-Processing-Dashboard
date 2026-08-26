import React, { useEffect, useRef, useCallback, useState } from 'react';

// Import Pannellum CSS and JS
import 'pannellum/build/pannellum.css';

// Pannellum attaches to window when loaded
declare global {
  interface Window {
    pannellum: {
      viewer: (container: HTMLElement | string, config: any) => PannellumViewerInstance;
    };
  }
}

interface PannellumViewerInstance {
  getYaw: () => number;
  getPitch: () => number;
  getHfov: () => number;
  setYaw: (yaw: number, animated?: boolean) => void;
  setPitch: (pitch: number, animated?: boolean) => void;
  setHfov: (hfov: number) => void;
  lookAt: (pitch: number, yaw: number, hfov?: number, animated?: boolean) => void;
  loadScene: (sceneId: string) => void;
  destroy: () => void;
  on: (event: string, callback: (...args: any[]) => void) => void;
  isLoaded: () => boolean;
}

interface PannellumViewerProps {
  /** Full URL to config.json for multi-res tiles */
  configUrl?: string;
  /** Fallback equirectangular image URL (used if configUrl is not provided) */
  panoramaUrl?: string;
  /** Initial yaw in degrees */
  initialYaw?: number;
  /** Initial pitch in degrees */
  initialPitch?: number;
  /** Initial horizontal field of view */
  initialHfov?: number;
  /** Callback when camera position changes */
  onPositionChange?: (pos: { yaw: number; pitch: number; hfov: number }) => void;
  /** CSS class */
  className?: string;
  /** Whether to show default Pannellum controls */
  showControls?: boolean;
  /** Auto-rotate speed (0 = disabled) */
  autoRotate?: number;
  /** Show compass */
  compass?: boolean;
}

let pannellumLoaded = false;
let pannellumLoadPromise: Promise<void> | null = null;

function loadPannellumScript(): Promise<void> {
  if (pannellumLoaded && window.pannellum) return Promise.resolve();
  if (pannellumLoadPromise) return pannellumLoadPromise;

  pannellumLoadPromise = new Promise<void>((resolve, reject) => {
    // Check if already loaded
    if (window.pannellum) {
      pannellumLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = new URL('pannellum/build/pannellum.js', import.meta.url).href;
    script.async = true;
    script.onload = () => {
      pannellumLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Pannellum'));
    document.head.appendChild(script);
  });

  return pannellumLoadPromise;
}

export const PannellumViewer: React.FC<PannellumViewerProps> = ({
  configUrl,
  panoramaUrl,
  initialYaw = 0,
  initialPitch = 0,
  initialHfov = 100,
  onPositionChange,
  className = 'w-full h-full',
  showControls = true,
  autoRotate = 0,
  compass = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PannellumViewerInstance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const prevUrlRef = useRef<string>('');

  const destroyViewer = useCallback(() => {
    if (viewerRef.current) {
      try {
        viewerRef.current.destroy();
      } catch (_) { /* cleanup */ }
      viewerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const activeUrl = configUrl || panoramaUrl || '';
    if (!activeUrl || !containerRef.current) {
      destroyViewer();
      return;
    }

    // Skip if same URL
    if (activeUrl === prevUrlRef.current && viewerRef.current) return;
    prevUrlRef.current = activeUrl;

    setIsLoading(true);
    setHasError(false);
    setErrorMsg('');

    const initViewer = async () => {
      try {
        await loadPannellumScript();

        // Destroy previous instance
        destroyViewer();

        if (!containerRef.current || !window.pannellum) return;

        let viewerConfig: any;

        if (configUrl) {
          // Multi-resolution tile mode: fetch config.json
          try {
            const res = await fetch(configUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const config = await res.json();
            const basePath = configUrl.substring(0, configUrl.lastIndexOf('/') + 1);

            if (config.multiRes) {
              const multiRes = { ...config.multiRes };

              // If basePath in config is relative, prepend the config URL base
              if (multiRes.basePath && !multiRes.basePath.startsWith('http')) {
                multiRes.basePath = basePath + multiRes.basePath.replace(/^\.\//, '');
              } else if (!multiRes.basePath) {
                multiRes.basePath = basePath;
              }

              viewerConfig = {
                type: 'multires',
                multiRes,
                autoLoad: true,
                showZoomCtrl: showControls,
                showFullscreenCtrl: false,
                mouseZoom: true,
                keyboardZoom: true,
                compass,
                yaw: initialYaw,
                pitch: initialPitch,
                hfov: initialHfov,
                minHfov: 30,
                maxHfov: 120,
                autoRotate: autoRotate || 0,
                friction: 0.15,
                crossOrigin: 'anonymous'
              };
            } else if (config.panorama) {
              // Single equirectangular from config
              let panoUrl = config.panorama;
              if (!panoUrl.startsWith('http')) {
                panoUrl = basePath + panoUrl;
              }
              viewerConfig = {
                type: 'equirectangular',
                panorama: panoUrl,
                autoLoad: true,
                showZoomCtrl: showControls,
                showFullscreenCtrl: false,
                compass,
                yaw: initialYaw,
                pitch: initialPitch,
                hfov: initialHfov,
                minHfov: 30,
                maxHfov: 120,
                crossOrigin: 'anonymous'
              };
            }
          } catch (fetchErr) {
            console.warn('PannellumViewer: Failed to fetch config.json:', fetchErr);
            // Fallback to panoramaUrl if available
            if (panoramaUrl) {
              viewerConfig = {
                type: 'equirectangular',
                panorama: panoramaUrl,
                autoLoad: true,
                showZoomCtrl: showControls,
                showFullscreenCtrl: false,
                compass,
                yaw: initialYaw,
                pitch: initialPitch,
                hfov: initialHfov,
                minHfov: 30,
                maxHfov: 120,
                crossOrigin: 'anonymous'
              };
            } else {
              setHasError(true);
              setErrorMsg('Failed to load multi-resolution tiles');
              setIsLoading(false);
              return;
            }
          }
        } else if (panoramaUrl) {
          // Standard equirectangular mode
          viewerConfig = {
            type: 'equirectangular',
            panorama: panoramaUrl,
            autoLoad: true,
            showZoomCtrl: showControls,
            showFullscreenCtrl: false,
            compass,
            yaw: initialYaw,
            pitch: initialPitch,
            hfov: initialHfov,
            minHfov: 30,
            maxHfov: 120,
            crossOrigin: 'anonymous'
          };
        }

        if (!viewerConfig || !containerRef.current) {
          setHasError(true);
          setErrorMsg('No valid panorama source');
          setIsLoading(false);
          return;
        }

        const viewer = window.pannellum.viewer(containerRef.current, viewerConfig);
        viewerRef.current = viewer;

        viewer.on('load', () => {
          setIsLoading(false);
        });

        viewer.on('error', (msg: string) => {
          console.warn('PannellumViewer error:', msg);
          setHasError(true);
          setErrorMsg(msg || 'Panorama load error');
          setIsLoading(false);
        });

        if (onPositionChange) {
          const reportPosition = () => {
            if (viewerRef.current) {
              try {
                onPositionChange({
                  yaw: Math.round(viewerRef.current.getYaw()),
                  pitch: Math.round(viewerRef.current.getPitch()),
                  hfov: Math.round(viewerRef.current.getHfov())
                });
              } catch (_) { /* viewer may be destroyed */ }
            }
          };

          viewer.on('mouseup', reportPosition);
          viewer.on('touchend', reportPosition);
          viewer.on('zoomchange', reportPosition);
        }

        // If load event doesn't fire within 3s, clear loading state anyway
        setTimeout(() => setIsLoading(false), 3000);

      } catch (err) {
        console.error('PannellumViewer init error:', err);
        setHasError(true);
        setErrorMsg((err as Error).message || 'Failed to initialize viewer');
        setIsLoading(false);
      }
    };

    initViewer();

    return () => {
      destroyViewer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configUrl, panoramaUrl]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ minHeight: '200px' }}
      />

      {/* Loading overlay */}
      {isLoading && !hasError && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] text-slate-300 font-medium">Loading Multi-Res Tiles...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {hasError && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-10 p-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-amber-400 text-sm font-semibold">Panorama Unavailable</span>
            <span className="text-[10px] text-slate-400 max-w-[260px]">{errorMsg || 'Failed to load 360° panorama'}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default PannellumViewer;
