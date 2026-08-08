import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface InspectorMiniMapProps {
  lat?: number;
  lng?: number;
  subgrid?: string;
  zoom?: number;
  className?: string;
}

export const InspectorMiniMap: React.FC<InspectorMiniMapProps> = ({
  lat = 2.54866,
  lng = 102.815835,
  subgrid = 'KL_Drive_04',
  zoom = 18,
  className = 'w-full h-full'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const validLat = typeof lat === 'number' && !isNaN(lat) ? lat : 2.54866;
    const validLng = typeof lng === 'number' && !isNaN(lng) ? lng : 102.815835;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [validLat, validLng],
        zoom: zoom,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
      });

      // Standard OpenStreetMap base layer with maxNativeZoom to prevent missing tile errors
      const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxNativeZoom: 18,
        maxZoom: 21,
        attribution: 'OSM'
      });

      // CartoDB Voyager tiles (crisp & clean vector raster with high zoom support)
      const voyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxNativeZoom: 18,
        maxZoom: 21,
        subdomains: 'abcd',
        attribution: 'CartoDB'
      });

      // Add CartoDB voyager as default high-detail tile layer + fallback to OSM
      voyager.on('tileerror', () => {
        if (!map.hasLayer(osm)) {
          osm.addTo(map);
        }
      });

      voyager.addTo(map);

      // Add prominent pulsing point marker
      const marker = L.circleMarker([validLat, validLng], {
        radius: 9,
        fillColor: '#00f2ff',
        fillOpacity: 0.95,
        color: '#ffffff',
        weight: 3,
        className: 'animate-pulse shadow-lg'
      }).addTo(map);

      markerRef.current = marker;
      mapInstanceRef.current = map;

      const t1 = setTimeout(() => map.invalidateSize(), 200);
      const t2 = setTimeout(() => map.invalidateSize(), 500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    } else {
      const map = mapInstanceRef.current;
      map.setView([validLat, validLng], zoom, { animate: true });
      if (markerRef.current) {
        markerRef.current.setLatLng([validLat, validLng]);
      }
      setTimeout(() => map.invalidateSize(), 150);
    }
  }, [lat, lng, zoom]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`relative overflow-hidden rounded-lg bg-slate-950 ${className}`}>
      <div className="absolute top-1.5 left-1.5 bg-slate-900/90 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] text-slate-100 font-mono z-[1000] border border-slate-700/80 shadow-md flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
        {subgrid}
      </div>
      <div ref={mapContainerRef} className="w-full h-full min-h-[160px] z-0" />
    </div>
  );
};

export default InspectorMiniMap;
