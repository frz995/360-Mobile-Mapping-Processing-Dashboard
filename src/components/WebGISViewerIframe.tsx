import React, { useEffect, useRef } from 'react';

interface WebGISViewerIframeProps {
  panoramaUrl: string;
  subgrid?: string;
  bearing?: number;
  themeMode?: 'dark' | 'light';
  className?: string;
}

export const WebGISViewerIframe: React.FC<WebGISViewerIframeProps> = ({
  panoramaUrl,
  subgrid = '',
  bearing = 0,
  themeMode = 'dark',
  className = 'w-full h-full'
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const webGisBaseUrl = import.meta.env.VITE_MAP_URL || (
    typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname.startsWith('10.')
    )
      ? 'http://localhost:5173'
      : window.location.origin
  );

  // Static iframe URL created ONCE on mount so iframe never reloads on prop updates
  const staticSrc = useRef(`${webGisBaseUrl}/?embed=true&viewerOnly=true`).current;

  const postData = React.useCallback(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        if (panoramaUrl) {
          iframeRef.current.contentWindow.postMessage({
            type: 'SET_PANORAMA',
            point: {
              image_url: panoramaUrl,
              subgrid: subgrid,
              bearing: bearing
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
  }, [panoramaUrl, subgrid, bearing, themeMode]);

  // Listen for iframe onLoad and VIEWER_READY message to re-post SET_PANORAMA when iframe is ready
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'VIEWER_READY') {
        postData();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [postData]);

  // Send SET_PANORAMA whenever panoramaUrl, subgrid, or bearing changes
  useEffect(() => {
    if (!panoramaUrl) return;

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
  }, [panoramaUrl, subgrid, bearing, postData]);

  const handleIframeLoad = () => {
    postData();
    setTimeout(postData, 300);
  };

  return (
    <div className={`relative overflow-hidden rounded-lg bg-black ${className}`}>
      <iframe
        ref={iframeRef}
        src={staticSrc}
        onLoad={handleIframeLoad}
        title="WebGIS 360 Viewer"
        className="w-full h-full border-0 rounded-lg"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      />
    </div>
  );
};

export default WebGISViewerIframe;
