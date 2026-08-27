import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { CubemapTilesAdapter } from '@photo-sphere-viewer/cubemap-tiles-adapter';
import '@photo-sphere-viewer/core/index.css';

export interface PhotoSphereViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  toggleFullscreen: () => void;
  getPosition: () => { yaw: number; pitch: number; fov: number } | null;
}

export interface PhotoSphereViewerProps {
  panoramaUrl?: string;
  configUrl?: string;
  caption?: string;
  className?: string;
  onPositionChange?: (position: { yaw: number; pitch: number; fov?: number }) => void;
}

export const PhotoSphereViewerComponent = forwardRef<PhotoSphereViewerHandle, PhotoSphereViewerProps>(
  ({ panoramaUrl, configUrl, caption, className = 'w-full h-full min-h-[300px]', onPositionChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Viewer | null>(null);

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
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }

      let isMounted = true;
      let viewerInstance: Viewer | null = null;

      const initViewer = async () => {
        try {
          if (configUrl) {
            const cleanConfigUrl = configUrl.trim();
            const rawBasePath = cleanConfigUrl.substring(0, cleanConfigUrl.lastIndexOf('/') + 1).trim();
            const cleanBasePath = rawBasePath.replace(/([^:]\/)\/+/g, '$1').replace(/\/+$/, '');

            try {
              await fetch(cleanConfigUrl, { cache: 'no-cache' });
              if (!isMounted) return;

              const FACE_MAP: Record<string, string> = {
                front: 'b',
                back: 'f',
                left: 'r',
                right: 'l',
                top: 'u',
                bottom: 'd',
              };

              viewerInstance = new Viewer({
                container: containerRef.current!,
                adapter: CubemapTilesAdapter,
                sphereCorrection: { pan: '180deg' },
                navbar: false,
                panorama: {
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
                },
                caption: caption || '360° Multi-Res Inspection',
                defaultYaw: '0deg',
                defaultPitch: '0deg',
                touchmoveTwoFingers: false,
                mousewheel: true,
                mousewheelCtrlKey: false,
              });
            } catch (fetchErr) {
              console.warn('Config fetch failed, using fallback cubemap:', fetchErr);
              if (!isMounted) return;

              viewerInstance = new Viewer({
                container: containerRef.current!,
                sphereCorrection: { pan: '180deg' },
                navbar: false,
                panorama: {
                  front: `${cleanBasePath}/fallback/b.jpg`,
                  back: `${cleanBasePath}/fallback/f.jpg`,
                  left: `${cleanBasePath}/fallback/r.jpg`,
                  right: `${cleanBasePath}/fallback/l.jpg`,
                  top: `${cleanBasePath}/fallback/u.jpg`,
                  bottom: `${cleanBasePath}/fallback/d.jpg`,
                },
                caption: caption || '360° Panorama Inspection',
                defaultYaw: '0deg',
                defaultPitch: '0deg',
                touchmoveTwoFingers: false,
                mousewheel: true,
                mousewheelCtrlKey: false,
              });
            }
          } else if (panoramaUrl) {
            if (!isMounted) return;
            viewerInstance = new Viewer({
              container: containerRef.current!,
              navbar: false,
              panorama: panoramaUrl.trim(),
              caption: caption || '360° Panorama Inspection',
              defaultYaw: '0deg',
              defaultPitch: '0deg',
              touchmoveTwoFingers: false,
              mousewheel: true,
              mousewheelCtrlKey: false,
            });
          }

          if (viewerInstance) {
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
          }
        } catch (err) {
          console.error('Failed to initialize PhotoSphereViewer:', err);
        }
      };

      initViewer();

      return () => {
        isMounted = false;
        if (viewerRef.current) {
          viewerRef.current.destroy();
          viewerRef.current = null;
        }
      };
    }, [panoramaUrl, configUrl, caption]);

    return <div ref={containerRef} className={className} />;
  }
);

PhotoSphereViewerComponent.displayName = 'PhotoSphereViewerComponent';

export default PhotoSphereViewerComponent;