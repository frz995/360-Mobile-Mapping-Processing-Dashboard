import React, { useEffect, useRef, useState } from 'react';

interface WebGISViewerIframeProps {
  panoramaUrl?: string;
  configUrl?: string;
  filename?: string;
  subgrid?: string;
  bearing?: number;
  pitch?: number;
  themeMode?: 'dark' | 'light';
  isQAQCRunning?: boolean;
  qaqcSubgrid?: string;
  qaqcPic?: string;
  className?: string;
}

export const WebGISViewerIframe: React.FC<WebGISViewerIframeProps> = ({
  panoramaUrl = '',
  configUrl = '',
  filename = '',
  subgrid = '',
  bearing = 0,
  pitch = 0,
  themeMode = 'dark',
  isQAQCRunning = false,
  qaqcSubgrid = '',
  qaqcPic = '',
  className = 'w-full h-full'
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const webGisBaseUrl = import.meta.env.VITE_MAP_URL || window.location.origin;

  // Static iframe URL created ONCE on mount so iframe never reloads on prop updates
  const staticSrc = useRef(`${webGisBaseUrl}/?embed=true&viewerOnly=true&dashboard=true`).current;

  const postData = React.useCallback(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        if (panoramaUrl || configUrl || filename) {
          const resolvedFilename = filename || (panoramaUrl ? panoramaUrl.split('/').pop() : '');
          iframeRef.current.contentWindow.postMessage({
            type: 'SET_PANORAMA',
            point: {
              image_url: panoramaUrl,
              config_url: configUrl,
              filename: resolvedFilename,
              point_id: resolvedFilename,
              subgrid: subgrid,
              bearing: bearing,
              pitch: pitch
            }
          }, '*');
        }
        iframeRef.current.contentWindow.postMessage({
          type: 'SET_THEME',
          theme: themeMode
        }, '*');
      } catch (err) {
        console.warn('Failed to postMessage to WebGIS viewer iframe:', err);
      }
    }
  }, [panoramaUrl, configUrl, filename, subgrid, bearing, pitch, themeMode]);

  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [lockPic, setLockPic] = useState<string>('');

  // Handle external QA/QC lock state from parent props
  useEffect(() => {
    const isSubgridMatch = !qaqcSubgrid || !subgrid || qaqcSubgrid.toUpperCase().trim() === subgrid.toUpperCase().trim();
    if (isQAQCRunning && isSubgridMatch) {
      setIsLocked(true);
      setLockPic(qaqcPic || 'Inspector');
      if (iframeRef.current && iframeRef.current.contentWindow) {
        try {
          iframeRef.current.contentWindow.postMessage({
            type: 'LOCK_SUBGRID',
            subgrid: qaqcSubgrid || subgrid,
            pic: qaqcPic
          }, '*');
        } catch (_) { }
      }
    } else if (!isQAQCRunning && isLocked) {
      setIsLocked(false);
      setLockPic('');
      if (iframeRef.current && iframeRef.current.contentWindow) {
        try {
          iframeRef.current.contentWindow.postMessage({
            type: 'UNLOCK_SUBGRID',
            subgrid: qaqcSubgrid || subgrid
          }, '*');
        } catch (_) { }
      }
    }
  }, [isQAQCRunning, qaqcSubgrid, subgrid, qaqcPic, isLocked]);

  // Listen for iframe onLoad and VIEWER_READY / LOCK_SUBGRID messages
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'VIEWER_READY') {
        postData();
      } else if (e.data?.type === 'LOCK_SUBGRID') {
        if (!subgrid || (e.data.subgrid && e.data.subgrid.toUpperCase() === subgrid.toUpperCase())) {
          setIsLocked(true);
          setLockPic(e.data.pic || '');
        }
      } else if (e.data?.type === 'UNLOCK_SUBGRID') {
        setIsLocked(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [postData, subgrid]);

  // Send SET_PANORAMA whenever panoramaUrl, configUrl, filename, subgrid, or bearing changes
  useEffect(() => {
    if (!panoramaUrl && !configUrl && !filename) return;

    postData();

    // Retry sending at 150ms, 400ms, and 800ms to guarantee initial cold load delivery
    const t1 = setTimeout(postData, 150);
    const t2 = setTimeout(postData, 400);
    const t3 = setTimeout(postData, 800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [panoramaUrl, configUrl, filename, subgrid, bearing, postData]);

  const handleIframeLoad = () => {
    postData();
    setTimeout(postData, 300);
  };

  return (
    <div className={`relative overflow-hidden rounded-lg bg-card ${className}`}>
      <iframe
        ref={iframeRef}
        src={staticSrc}
        onLoad={handleIframeLoad}
        title="WebGIS 360 Viewer"
        className={`w-full h-full border-0 rounded-lg transition-opacity duration-300 ${isLocked ? 'opacity-35 pointer-events-none' : 'opacity-100'
          }`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      />
      {isLocked && (
        <div className="absolute inset-0 bg-app/40 backdrop-blur-[2px] flex flex-col items-center justify-center pointer-events-none z-20 animate-in fade-in duration-200">
          <div className="bg-card/95 border border-subtle rounded-md px-3.5 py-2 shadow-lg flex items-center gap-2 text-xs font-medium text-text-base">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span>Acquisition QC Lockout Active {lockPic ? `(${lockPic})` : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default WebGISViewerIframe;