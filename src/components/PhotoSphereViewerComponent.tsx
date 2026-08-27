import React, { useEffect, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
import '@photo-sphere-viewer/core/index.css';

interface PhotoSphereViewerProps {
  /** Direct equirectangular panorama URL (e.g., Supabase Storage single image) */
  panoramaUrl?: string;
  /** Multi-res tile config.json URL (e.g., Cloudflare R2 with config.json) */
  configUrl?: string;
  caption?: string;
  onPositionChange?: (pos: { yaw: number; pitch: number; fov: number }) => void;
  className?: string;
}

export const PhotoSphereViewerComponent: React.FC<PhotoSphereViewerProps> = ({
  panoramaUrl,
  configUrl,
  caption,
  onPositionChange,
  className = 'w-full h-full'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    setHasError(false);
  }, [panoramaUrl, configUrl]);

  useEffect(() => {
    const activeSource = configUrl || panoramaUrl;
    if (!containerRef.current || !activeSource) {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch (_) { }
        viewerRef.current = null;
      }
      return;
    }

    let viewerInstance: Viewer | null = null;

    const initViewer = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        // Destroy previous instance
        if (viewerRef.current) {
          try {
            viewerRef.current.destroy();
          } catch (_) { }
          viewerRef.current = null;
        }

        // Multi-res tiles via config.json (Cloudflare R2 / Custom CDN)
        if (configUrl) {
          try {
            // Trim whitespace and spaces from configUrl string
            const cleanConfigUrl = configUrl.trim();
            const res = await fetch(cleanConfigUrl, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching config.json`);
            const config = await res.json();

            // Extract base directory path from cleanConfigUrl
            const rawBasePath = cleanConfigUrl.substring(0, cleanConfigUrl.lastIndexOf('/') + 1).trim();

            if (config.multiRes) {
              const multiRes = config.multiRes;

              // Sanitize multiRes JSON string properties directly
              let rawMultiBasePath = (multiRes.basePath || '').trim();
              let rawMultiPath = (multiRes.path || '').trim();

              // Remove stray underscores or non-path placeholder characters
              if (rawMultiPath === '_' || rawMultiPath === '%20') rawMultiPath = '';
              if (rawMultiBasePath === '_' || rawMultiBasePath === '%20') rawMultiBasePath = '';

              // Build tile URL resolver
              const tileBasePath = rawMultiBasePath
                ? (rawMultiBasePath.startsWith('http')
                  ? rawMultiBasePath
                  : `${rawBasePath}/${rawMultiBasePath.replace(/^\.\//, '')}`)
                : rawBasePath;

              // Clean base path: strip invalid path segments, spaces, underscores, and duplicate slashes
              const cleanBasePath = tileBasePath
                .replace(/%[a-zA-Z0-9]+/g, '')
                .replace(/[\s_]+/g, '')
                .replace(/([^:]\/)\/+/g, '$1')
                .replace(/\/+$/, '');

              const cleanTilePath = rawMultiPath
                .replace(/%[a-zA-Z0-9]+/g, '')
                .replace(/[\s_]+/g, '')
                .replace(/^\/+/, '')
                .replace(/\/+$/, '');

              const fullTilePrefix = cleanTilePath
                ? `${cleanBasePath}/${cleanTilePath}`.replace(/([^:]\/)\/+/g, '$1').replace(/\/+$/, '')
                : cleanBasePath;

              // Extract dimensions from config
              const width = multiRes.tileSize ? multiRes.tileSize * (multiRes.columns || 16) : 12000;
              const cols = multiRes.columns || 16;
              const rows = multiRes.rows || 8;

              // Build base URL for low-res preview
              const baseUrl = `${fullTilePrefix}/fallback/f.jpg`;

              viewerInstance = new Viewer({
                container: containerRef.current!,
                adapter: EquirectangularTilesAdapter,
                panorama: {
                  width: width,
                  cols: cols,
                  rows: rows,
                  baseUrl: baseUrl,
                  tileUrl: (col: number, row: number, level?: number) => {
                    const currentLevel = level || 1;
                    return `${fullTilePrefix}/${currentLevel}/${col}/${row}.jpg`;
                  },
                },
                caption: caption || '360° Multi-Res Tiles',
                navbar: ['zoom', 'move', 'download', 'fullscreen'],
                defaultYaw: '0deg',
                defaultPitch: '0deg',
                touchmoveTwoFingers: true,
                mousewheelCtrlKey: false,
              });
            } else if (config.panorama) {
              // Fallback: config.json has single panorama URL
              let panoUrl = (config.panorama || '').trim();
              if (!panoUrl.startsWith('http')) {
                panoUrl = rawBasePath + panoUrl;
              }

              viewerInstance = new Viewer({
                container: containerRef.current!,
                panorama: panoUrl,
                caption: caption || '360° Panorama Inspection',
                navbar: ['zoom', 'move', 'download', 'fullscreen'],
                defaultYaw: '0deg',
                defaultPitch: '0deg',
                touchmoveTwoFingers: true,
                mousewheelCtrlKey: false,
              });
            }
          } catch (fetchErr) {
            console.warn('PhotoSphereViewer: Multi-res config.json load failed, falling back to single image', fetchErr);

            // Fallback to single equirectangular
            const fallbackUrl = configUrl.trim().replace(/config\.json$/i, 'fallback/f.jpg');
            viewerInstance = new Viewer({
              container: containerRef.current!,
              panorama: fallbackUrl,
              caption: caption || '360° Panorama Inspection',
              navbar: ['zoom', 'move', 'download', 'fullscreen'],
              defaultYaw: '0deg',
              defaultPitch: '0deg',
              touchmoveTwoFingers: true,
              mousewheelCtrlKey: false,
            });
          }
        }
        // Single equirectangular image (Supabase Storage / S3)
        else if (panoramaUrl) {
          viewerInstance = new Viewer({
            container: containerRef.current!,
            panorama: panoramaUrl.trim(),
            caption: caption || '360° Panorama Inspection',
            navbar: ['zoom', 'move', 'download', 'fullscreen'],
            defaultYaw: '0deg',
            defaultPitch: '0deg',
            touchmoveTwoFingers: true,
            mousewheelCtrlKey: false,
          });
        }

        if (!viewerInstance) {
          throw new Error('No valid panorama source provided');
        }

        viewerRef.current = viewerInstance;

        if (onPositionChange) {
          viewerInstance.addEventListener('position-updated', ({ position }) => {
            if (viewerInstance) {
              onPositionChange({
                yaw: Math.round((position.yaw * 180) / Math.PI),
                pitch: Math.round((position.pitch * 180) / Math.PI),
                fov: Math.round(viewerInstance.getZoomLevel()),
              });
            }
          });
        }

        // Add panorama error listener
        (viewerInstance as unknown as { addEventListener: (evt: string, cb: () => void) => void }).addEventListener(
          'panorama-load-error',
          () => {
            console.warn('Panorama load error for:', configUrl || panoramaUrl);
            setHasError(true);
            setIsLoading(false);
          }
        );

        // Success - clear loading state
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize PhotoSphereViewer:', err);
        setHasError(true);
        setIsLoading(false);
      }
    };

    initViewer();

    return () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch (e) {
          // cleanup
        }
        viewerRef.current = null;
      }
    };
  }, [panoramaUrl, configUrl, caption, onPositionChange]);

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      <div ref={containerRef} className="w-full h-full min-h-[120px]" />

      {/* Loading overlay */}
      {isLoading && !hasError && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-[11px] text-slate-300 font-medium">
              {configUrl ? 'Loading Multi-Res Tiles...' : 'Loading Panorama...'}
            </span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {(!panoramaUrl && !configUrl) || hasError ? (
        <div className="absolute inset-0 bg-app backdrop-blur-md flex items-center justify-center p-4 text-center z-20">
          <span className="text-xs text-amber-400 font-medium">
            {hasError ? 'Panorama Load Failed' : 'No 360° Panorama Available'}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default PhotoSphereViewerComponent;