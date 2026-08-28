// =====================================================================
// BoundaryEditor — local Leaflet editor for the Project Geographic
// Boundary. Lets an admin draw a polygon by clicking vertices, upload a
// GeoJSON / KML / GPX / CSV file, or paste GeoJSON. Emits a GeoJSON
// FeatureCollection + bbox that is persisted to projectSettings.
// =====================================================================

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Upload, Trash2, Undo2, Crosshair } from 'lucide-react';

export interface ProjectBoundaryData {
  geojson: any;
  bbox?: [number, number, number, number];
}

interface BoundaryEditorProps {
  initialBoundary?: ProjectBoundaryData;
  defaultCenter?: [number, number] | number[];
  onChange: (data: ProjectBoundaryData) => void;
}

const DEFAULT_CENTER: [number, number] = [4.2105, 101.9758];

function computeBbox(coords: number[][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  coords.forEach((c) => {
    if (!Array.isArray(c) || c.length < 2) return;
    const [lng, lat] = c;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  return [minLng, minLat, maxLng, maxLat];
}

function extractRing(geojson: any): [number, number][] {
  if (!geojson) return [];
  const feat = geojson.type === 'FeatureCollection'
    ? geojson.features?.[0]
    : geojson.type === 'Feature'
      ? geojson
      : null;
  const geometry = feat ? feat.geometry || geojson : geojson;
  const coords = geometry?.coordinates;
  let ring: any[] = [];
  if (geometry?.type === 'Polygon') ring = Array.isArray(coords?.[0]) ? coords[0] : [];
  else if (geometry?.type === 'MultiPolygon') ring = Array.isArray(coords?.[0]?.[0]) ? coords[0][0] : [];
  else if (geometry?.type === 'LineString') ring = Array.isArray(coords) ? coords : [];
  // Convert [lng, lat] -> Leaflet [lat, lng]
  return ring
    .filter((c: any) => Array.isArray(c) && c.length >= 2)
    .map((c: any) => [Number(c[1]), Number(c[0])] as [number, number]);
}

export const BoundaryEditor: React.FC<BoundaryEditorProps> = ({
  initialBoundary,
  defaultCenter,
  onChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);
  const markerRefs = useRef<L.Marker[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const verticesRef = useRef<[number, number][]>(extractRing(initialBoundary?.geojson));
  const didInitRef = useRef(false);

  const [vertices, setVertices] = useState<[number, number][]>(extractRing(initialBoundary?.geojson));
  const [drawing, setDrawing] = useState(false);
  const [geojsonText, setGeojsonText] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const setVerts = (pts: [number, number][]) => {
    verticesRef.current = pts;
    setVertices(pts);
  };

  const emit = (pts: [number, number][]) => {
    if (pts.length < 3) return;
    const ring = pts.map((p) => [p[1], p[0]] as [number, number]);
    ring.push(ring[0]);
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'project-boundary' },
          geometry: { type: 'Polygon', coordinates: [ring] }
        }
      ]
    };
    onChange({ geojson, bbox: computeBbox(ring) });
  };

  // Draw the current polygon + markers on the map.
  const renderOverlay = (map: L.Map, pts: [number, number][]) => {
    polygonRef.current?.remove();
    polygonRef.current = null;
    markerRefs.current.forEach((m) => m.remove());
    markerRefs.current = [];
    if (pts.length === 0) return;
    polygonRef.current = L.polygon(pts, {
      color: '#f59e0b',
      weight: 2.5,
      fillColor: '#f59e0b',
      fillOpacity: 0.18,
      dashArray: '4, 4'
    }).addTo(map);
    pts.forEach((p, i) => {
      const m = L.marker(p, {
        draggable: true
      }).addTo(map);
      m.bindTooltip(`V${i + 1}`, { permanent: true, direction: 'top', offset: [0, -14], className: 'leaflet-tooltip-boundary' });
      m.on('dragend', () => {
        const pos = m.getLatLng();
        const next = [...pts];
        next[i] = [pos.lat, pos.lng];
        setVerts(next);
      });
      markerRefs.current.push(m);
    });
    try {
      map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 17 });
    } catch (_) { /* ignore invalid bounds */ }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) {
      // already initialized
      return;
    }
    const center: [number, number] = defaultCenter && Array.isArray(defaultCenter)
      ? [Number(defaultCenter[0]), Number(defaultCenter[1])]
      : DEFAULT_CENTER;
    const map = L.map(containerRef.current, {
      center,
      zoom: 12,
      zoomControl: false,
      attributionControl: false
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);
    mapRef.current = map;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!drawing) return;
      const pt: [number, number] = [e.latlng.lat, e.latlng.lng];
      setVerts([...verticesRef.current, pt]);
    });

    // Restore initial polygon if provided.
    if (extractRing(initialBoundary?.geojson).length > 0) {
      renderOverlay(map, extractRing(initialBoundary?.geojson));
    }
    didInitRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep overlay in sync when vertices change from drags (skip initial mount,
  // which the init effect already rendered).
  useEffect(() => {
    if (!didInitRef.current) return;
    if (mapRef.current && vertices.length > 0) {
      renderOverlay(mapRef.current, vertices);
      emit(vertices);
    } else if (mapRef.current) {
      polygonRef.current?.remove();
      polygonRef.current = null;
      markerRefs.current.forEach((m) => m.remove());
      markerRefs.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vertices]);

  const clear = () => {
    setVerts([]);
    setMessage({ ok: true, text: 'Boundary cleared.' });
    onChange({ geojson: null, bbox: undefined });
  };

  const undo = () => {
    setVerts(verticesRef.current.slice(0, -1));
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        let geojson: any = null;
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
          geojson = JSON.parse(text);
        } else if (lower.endsWith('.kml')) {
          const lines = text
            .split('<coordinates>')
            .slice(1)
            .join('')
            .split('</coordinates>')[0]
            .trim();
          const pts = lines.split(/\s+/).filter(Boolean).map((tok) => {
            const [lng, lat] = tok.split(',').map(Number);
            return [lng, lat];
          });
          geojson = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } }]
          };
        } else {
          throw new Error('Unsupported file. Use GeoJSON, KML or pasted GeoJSON.');
        }
        const ring = extractRing(geojson);
        if (ring.length < 3) throw new Error('Boundary needs at least 3 points.');
        setVerts(ring);
        setMessage({ ok: true, text: `Boundary loaded (${ring.length} vertices).` });
      } catch (err: any) {
        setMessage({ ok: false, text: err?.message || 'Failed to parse boundary file.' });
      }
    };
    reader.readAsText(file);
  };

  const applyGeojsonText = () => {
    try {
      const geojson = JSON.parse(geojsonText);
      const ring = extractRing(geojson);
      if (ring.length < 3) throw new Error('Boundary needs at least 3 points.');
      setVerts(ring);
      setMessage({ ok: true, text: `Boundary applied from text (${ring.length} vertices).` });
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Invalid GeoJSON text.' });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDrawing((d) => !d)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${drawing
            ? 'bg-sky-500/25 border-sky-500/60 text-sky-200'
            : 'bg-inner border-subtle text-text-base hover:border-sky-500/40'
          }`}
        >
          <Crosshair size={13} /> {drawing ? 'Drawing… click map (done ↑)' : 'Draw Boundary'}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-inner border border-subtle text-text-base text-[11px] font-semibold hover:border-sky-500/40 transition-colors cursor-pointer"
        >
          <Upload size={13} /> Upload GeoJSON/KML
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={vertices.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-inner border border-subtle text-text-base text-[11px] font-semibold hover:border-sky-500/40 transition-colors cursor-pointer disabled:opacity-40"
        >
          <Undo2 size={13} /> Undo
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={vertices.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px] font-semibold hover:bg-rose-500/25 transition-colors cursor-pointer disabled:opacity-40"
        >
          <Trash2 size={13} /> Clear
        </button>
        <span className="text-[11px] text-text-muted font-mono">
          {vertices.length} vertex{vertices.length === 1 ? '' : 'es'}
        </span>
      </div>

      <div className="relative rounded-xl overflow-hidden border border-subtle" style={{ height: 360 }}>
        <div ref={containerRef} className="absolute inset-0 z-0" />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          Or paste GeoJSON
        </label>
        <div className="flex gap-2">
          <textarea
            rows={2}
            value={geojsonText}
            onChange={(e) => setGeojsonText(e.target.value)}
            placeholder='{"type":"Polygon","coordinates":[[[102.2,4.2],[102.3,4.2],[102.3,4.3],[102.2,4.3],[102.2,4.2]]]}'
            className="flex-1 bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted resize-y"
          />
          <button
            type="button"
            onClick={applyGeojsonText}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/15 border border-sky-500/40 text-sky-300 text-[11px] font-semibold transition-colors cursor-pointer"
          >
            <MapPin size={13} /> Apply
          </button>
        </div>
        {message && (
          <p className={`text-[11px] ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json,.kml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};

export default BoundaryEditor;
