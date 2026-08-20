import React, { useEffect, useRef, useState } from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import '@photo-sphere-viewer/core/index.css';

interface PhotoSphereViewerProps {
  panoramaUrl: string;
  caption?: string;
  onPositionChange?: (pos: { yaw: number; pitch: number; fov: number }) => void;
  className?: string;
}

const DEFAULT_PANORAMA = 'https://pannellum.org/images/alma.jpg';

export const PhotoSphereViewerComponent: React.FC<PhotoSphereViewerProps> = ({
  panoramaUrl,
  caption,
  onPositionChange,
  className = 'w-full h-full'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>(panoramaUrl || DEFAULT_PANORAMA);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    setCurrentUrl(panoramaUrl || DEFAULT_PANORAMA);
    setHasError(false);
  }, [panoramaUrl]);

  useEffect(() => {
    if (!containerRef.current) return;

    let viewerInstance: Viewer | null = null;
    const targetUrl = currentUrl;

    try {
      viewerInstance = new Viewer({
        container: containerRef.current,
        panorama: targetUrl,
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
          console.warn('Panorama load error for:', targetUrl);
          if (targetUrl !== DEFAULT_PANORAMA) {
            setCurrentUrl(DEFAULT_PANORAMA);
          } else {
            setHasError(true);
          }
        }
      );
    } catch (err) {
      console.error('Failed to initialize PhotoSphereViewer:', err);
      if (targetUrl !== DEFAULT_PANORAMA) {
        setCurrentUrl(DEFAULT_PANORAMA);
      } else {
        setHasError(true);
      }
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
  }, [currentUrl, caption, onPositionChange]);

  return (
    <div className={`relative overflow-hidden rounded-lg ${className}`}>
      <div ref={containerRef} className="w-full h-full min-h-[120px]" />
      {hasError && (
        <div className="absolute inset-0 bg-app backdrop-blur-md flex items-center justify-center p-4 text-center z-20">
          <span className="text-xs text-amber-400 font-medium">
            360° Image Preview Unavailable
          </span>
        </div>
      )}
    </div>
  );
};

export default PhotoSphereViewerComponent;
