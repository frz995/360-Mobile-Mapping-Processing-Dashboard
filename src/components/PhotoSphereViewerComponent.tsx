import React, { useEffect, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import '@photo-sphere-viewer/core/index.css';

interface PhotoSphereViewerProps {
  panoramaUrl: string;
  caption?: string;
  onPositionChange?: (pos: { yaw: number; pitch: number; fov: number }) => void;
  className?: string;
}

export const PhotoSphereViewerComponent: React.FC<PhotoSphereViewerProps> = ({
  panoramaUrl,
  caption,
  onPositionChange,
  className = 'w-full h-full'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    setHasError(false);
  }, [panoramaUrl]);

  useEffect(() => {
    if (!containerRef.current || !panoramaUrl) {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch (_) { }
        viewerRef.current = null;
      }
      return;
    }

    let viewerInstance: Viewer | null = null;

    try {
      viewerInstance = new Viewer({
        container: containerRef.current,
        panorama: panoramaUrl,
        caption: caption || '360° Panorama Inspection',
        navbar: [
          'zoom',
          'move',
          'download',
          'fullscreen',
        ],
        defaultYaw: '0deg',
        defaultPitch: '0deg',
        touchmoveTwoFingers: true,
        mousewheelCtrlKey: false,
      });

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

      // Add panorama error listener safely
      (viewerInstance as unknown as { addEventListener: (evt: string, cb: () => void) => void }).addEventListener(
        'panorama-load-error',
        () => {
          console.warn('Panorama load error for:', panoramaUrl);
          setHasError(true);
        }
      );
    } catch (err) {
      console.error('Failed to initialize PhotoSphereViewer:', err);
      setHasError(true);
    }

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
  }, [panoramaUrl, caption, onPositionChange]);

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      <div ref={containerRef} className="w-full h-full min-h-[120px]" />
      {(!panoramaUrl || hasError) && (
        <div className="absolute inset-0 bg-app backdrop-blur-md flex items-center justify-center p-4 text-center z-20">
          <span className="text-xs text-amber-400 font-medium">
            No 360° Panorama Available
          </span>
        </div>
      )}
    </div>
  );
};

export default PhotoSphereViewerComponent;

