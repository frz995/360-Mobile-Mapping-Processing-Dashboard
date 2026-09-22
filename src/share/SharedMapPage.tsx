import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { AlertTriangle, Compass, Eye, MapPinned } from 'lucide-react';
import { GeoSphereIcon } from '../components/common/GeoSphereLogo';
import {
  fetchShareByToken,
  parseShareToken,
  recallShareUnlock,
  rememberShareUnlock,
  touchShare,
  verifySharePassword,
  type MapShare
} from '../utils/mapShares';
import { SharePasswordGate } from './SharePasswordGate';

const effectiveWorkerUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPLIBRE_WORKER_URL) || workerUrl;
if (typeof (maplibregl as any).setWorkerUrl === 'function') {
  (maplibregl as any).setWorkerUrl(effectiveWorkerUrl);
}

const BASEMAPS: Record<string, { label: string; url: string }> = {
  'ofm-positron': { label: 'Positron', url: 'https://tiles.openfreemap.org/styles/positron' },
  'ofm-bright': { label: 'Bright', url: 'https://tiles.openfreemap.org/styles/bright' },
  'ofm-liberty': { label: 'Liberty', url: 'https://tiles.openfreemap.org/styles/liberty' },
  'ofm-dark': { label: 'Dark', url: 'https://tiles.openfreemap.org/styles/positron' },
  'dark': { label: 'Dark', url: 'https://tiles.openfreemap.org/styles/positron' },
  'light': { label: 'Light', url: 'https://tiles.openfreemap.org/styles/positron' }
};

const COLOR_PUBLISHED = '#1d4ed8';
const COLOR_INPROCESS = '#d97706';
const COLOR_ROAD = '#047857';

function styleUrlFor(basemap: string): string {
  return (BASEMAPS[basemap] || BASEMAPS['ofm-positron']).url;
}

function safeCenter(c?: [number, number] | number[] | null): [number, number] {
  if (!Array.isArray(c) || c.length < 2) return [101.9758, 4.2105]; // [lng, lat] for Malaysia
  const [a, b] = c;
  if (!isFinite(a) || !isFinite(b)) return [101.9758, 4.2105];
  // If a is lat (~1..85) and b is lng (~90..180 for Malaysia/Asia), flip them to [lng, lat]
  if (Math.abs(a) <= 85 && Math.abs(b) > 85) {
    return [b, a];
  }
  // If a is lng (> 85) and b is lat (<= 85), it's already [lng, lat]
  if (Math.abs(a) > 85 && Math.abs(b) <= 85) {
    return [a, b];
  }
  return [a, Math.max(-85, Math.min(85, b))];
}

function featureCollection(coordsLists: Array<Array<[number, number]>>, props: Record<string, unknown>[]) {
  return {
    type: 'FeatureCollection' as const,
    features: coordsLists.map((coords, i) => ({
      type: 'Feature' as const,
      properties: props[i] || {},
      geometry: { type: 'LineString' as const, coordinates: coords.map(([lat, lng]) => [lng, lat]) }
    }))
  };
}

function pointCollection(points: Array<{ lat: number; lng: number }>, props: Record<string, unknown>[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((p, i) => ({
      type: 'Feature' as const,
      properties: props[i] || {},
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }
    }))
  };
}

function segmentPopupHtml(share: MapShare, subgrid: string, pointStatus?: string): string {
  const seg = (share.snapshot.segments || []).find((s) => s.subgrid === subgrid);
  const row = (k: string, v: string) =>
    `<tr><td style="color:#64748b;padding:2px 10px 2px 0">${k}</td><td style="text-align:right;font-weight:700;color:#0f172a">${v}</td></tr>`;
  const displayStatus = seg
    ? (seg.status === 'published' ? 'Published' : 'In process')
    : (pointStatus ? (pointStatus.charAt(0).toUpperCase() + pointStatus.slice(1)) : 'Published');
  return `<div style="font-family:Arial,Helvetica,sans-serif;min-width:190px">
    <div style="font-weight:800;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:5px;margin-bottom:5px">${subgrid || 'Capture station'}</div>
    <table style="border-collapse:collapse;font-size:11px;width:100%">
      ${seg ? `
        ${row('Distance', `${seg.km.toFixed(2)} km`)}
        ${row('POI points', seg.poi.toLocaleString())}
        ${row('Panoramas', seg.frames.toLocaleString())}
        ${row('Defect flags', String(seg.defects))}
        ${row('Status', displayStatus)}
        ${seg.date ? row('Survey date', seg.date) : ''}
        ${seg.pic ? row('PIC', seg.pic) : ''}
      ` : `
        ${row('Status', displayStatus)}
        <tr><td colspan="2" style="color:#64748b;font-size:10px;padding-top:4px">Panotrack survey station</td></tr>
      `}
    </table>
  </div>`;
}

function roadPopupHtml(name: string, km: number): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif">
    <div style="font-weight:800;font-size:12.5px;color:#0f172a;margin-bottom:3px">${name || 'Road trace'}</div>
    <div style="font-size:11px;color:#475569">Segment length: <strong style="color:#0f172a">${km.toFixed(2)} km</strong></div>
  </div>`;
}

function lineLengthKm(coords: Array<[number, number]>): number {
  // reuse the share util distance math
  const R = 6371.0088;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  return total;
}

function ShareMap({ share, onCoords }: { share: MapShare; onCoords: (c: { lat: number; lng: number } | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [basemap, setBasemap] = useState<string>(BASEMAPS[share.basemap] ? share.basemap : 'ofm-positron');

  useEffect(() => {
    if (!containerRef.current) return;
    const snap = share?.snapshot || ({} as any);
    const center = safeCenter(snap.center);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: styleUrlFor(basemap),
        center,
        zoom: typeof snap.zoom === 'number' && isFinite(snap.zoom) ? snap.zoom : 10,
        attributionControl: { compact: true }
      });
    } catch (err) {
      console.error('[SharedMapPage] Map constructor error:', err);
      return;
    }

    if (map && typeof map.addControl === 'function') {
      try {
        const NavControl = maplibregl.NavigationControl;
        if (NavControl) {
          map.addControl(new NavControl({ showCompass: true }), 'top-right');
        }
      } catch { /* ignore nav control in tests */ }
    }

    if (map && typeof map.on === 'function') {
      map.on('load', () => {
        try {
          const lines = (snap.lines || []).filter((l: any) => l && Array.isArray(l.coords) && l.coords.length > 1);
          const tracks = (snap.tracks || []).filter((t: any) => t && Array.isArray(t.coords) && t.coords.length > 1);
          const pts = (snap.points || []).filter((p: any) => p && isFinite(p.lat) && isFinite(p.lng));

          // 1. Road lines (from extracted network or road plans)
          if (lines.length) {
            map.addSource('roads', {
              type: 'geojson',
              data: featureCollection(
                lines.map((l: any) => l.coords),
                lines.map((l: any) => ({ name: l.name || '', km: lineLengthKm(l.coords) }))
              )
            });
            map.addLayer({
              id: 'roads-casing', type: 'line', source: 'roads',
              paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.7 }
            });
            map.addLayer({
              id: 'roads-line', type: 'line', source: 'roads',
              paint: { 'line-color': COLOR_ROAD, 'line-width': 2.6 }
            });
            map.on('click', 'roads-line', (e: maplibregl.MapLayerMouseEvent) => {
              const f = e.features && e.features[0];
              if (!f) return;
              new maplibregl.Popup({ closeButton: false, offset: 10 })
                .setLngLat(e.lngLat.toArray() as [number, number])
                .setHTML(roadPopupHtml(String(f.properties?.name || ''), Number(f.properties?.km || 0)))
                .addTo(map);
            });
            map.on('mouseenter', 'roads-line', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'roads-line', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = '';
            });
          }

          // 2. Survey tracks / runs
          if (tracks.length) {
            const publishedTracks = tracks.filter((t: any) => (t.coords.length && pts.some((p: any) => p.subgrid === t.subgrid && (p.status === 'published' || p.isPublished))));
            const inProcessTracks = tracks.filter((t: any) => !publishedTracks.includes(t));
            const addTracks = (id: string, list: typeof tracks, color: string, dash?: boolean) => {
              if (!list.length) return;
              map.addSource(id, {
                type: 'geojson',
                data: featureCollection(list.map((t: any) => t.coords), list.map((t: any) => ({ subgrid: t.subgrid })))
              });
              map.addLayer({
                id: `${id}-line`, type: 'line', source: id,
                paint: { 'line-color': color, 'line-width': 2.2, 'line-opacity': 0.85 },
                layout: dash ? { 'line-dasharray': [2, 2] } : {}
              } as maplibregl.LayerSpecification);
            };
            addTracks('tracks-published', publishedTracks.length ? publishedTracks : tracks, COLOR_PUBLISHED);
            if (publishedTracks.length) addTracks('tracks-inprocess', inProcessTracks, COLOR_INPROCESS, true);
          }

          // 3. Panotrack stations / survey points
          if (pts.length) {
            map.addSource('stations', {
              type: 'geojson',
              data: pointCollection(pts, pts.map((p: any) => ({ subgrid: p.subgrid || '', status: p.status || 'published' })))
            });
            map.addLayer({
              id: 'stations-circle', type: 'circle', source: 'stations',
              paint: {
                'circle-radius': 3.4,
                'circle-color': [
                  'match',
                  ['get', 'status'],
                  'published', '#10b981',
                  'defect', '#ef4444',
                  'staging', '#f59e0b',
                  'in-process', '#f59e0b',
                  '#10b981'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1
              }
            });
            map.on('click', 'stations-circle', (e: maplibregl.MapLayerMouseEvent) => {
              const f = e.features && e.features[0];
              if (!f) return;
              new maplibregl.Popup({ closeButton: false, offset: 10 })
                .setLngLat(e.lngLat.toArray() as [number, number])
                .setHTML(segmentPopupHtml(share, String(f.properties?.subgrid || ''), String(f.properties?.status || '')))
                .addTo(map);
            });
            map.on('mouseenter', 'stations-circle', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'stations-circle', () => {
              if (map.getCanvas()) map.getCanvas().style.cursor = '';
            });
          }

          // 4. Safe bounding box zoom
          if (Array.isArray(snap.bbox) && snap.bbox.length === 4) {
            const [c0, c1, c2, c3] = snap.bbox;
            if (isFinite(c0) && isFinite(c1) && isFinite(c2) && isFinite(c3)) {
              let minLng: number, minLat: number, maxLng: number, maxLat: number;
              if (c0 > c1) {
                minLng = c0; minLat = c1; maxLng = c2; maxLat = c3;
              } else {
                minLat = c0; minLng = c1; maxLat = c2; maxLng = c3;
              }
              map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
                padding: { top: 90, bottom: 110, left: 20, right: 20 },
                duration: 0
              });
            }
          }
        } catch (err) {
          console.warn('[SharedMapPage] MapLayer load notice:', err);
        }
      });

      map.on('mousemove', (e: maplibregl.MapMouseEvent) => {
        if (e?.lngLat) onCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      map.on('mouseout', () => onCoords(null));
    }
    mapRef.current = map;
    return () => {
      try {
        map.remove();
      } catch { /* ignore */ }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, basemap]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow px-1 py-1">
        {Object.entries(BASEMAPS).map(([key, def]) => (
          <button
            key={key}
            onClick={() => setBasemap(key)}
            className={`px-2.5 py-1 rounded text-[10.5px] font-semibold transition-colors cursor-pointer ${
              basemap === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {def.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LegendCard({ share }: { share: MapShare }) {
  const st = share?.snapshot?.stats || { subgrids: 0, km: 0, poi: 0, frames: 0, defects: 0, passRate: 100, lines: 0 };
  const sw = (color: string, dashed?: boolean) => (
    <span className="inline-block w-4 h-[3px] rounded" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color }} />
  );
  return (
    <div className="absolute bottom-6 left-4 z-10 bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-lg p-3.5 w-[240px]">
      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        <MapPinned size={11} /> Legend
      </div>
      {share.kind === 'road' ? (
        <div className="space-y-1.5 text-[11px] text-slate-700">
          {(st.lines ?? 0) > 0 && (
            <div className="flex items-center gap-2">{sw(COLOR_ROAD)} Extracted road trace</div>
          )}
          {(st.poi > 0 || (share.snapshot?.points && share.snapshot.points.length > 0)) && (
            <>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#10b981' }} /> Published survey</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} /> Staging survey</div>
              {(st.defects ?? 0) > 0 && (
                <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} /> Defect</div>
              )}
            </>
          )}
          {share.snapshot?.tracks && share.snapshot.tracks.length > 0 && (
            <div className="flex items-center gap-2">{sw(COLOR_PUBLISHED)} Captured survey run</div>
          )}
          <div className="pt-1.5 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed">
            {(st.lines ?? 0) > 0 && <><strong className="text-slate-900">{st.lines}</strong> lines · </>}
            <strong className="text-slate-900">{typeof st.km === 'number' ? st.km.toFixed(2) : '0.00'} km</strong>
            {(st.poi ?? 0) > 0 && <> · <strong className="text-slate-900">{st.poi.toLocaleString()}</strong> survey points</>}
            {(st.subgrids ?? 0) > 0 && <> · <strong className="text-slate-900">{st.subgrids}</strong> subgrids</>}
            {share.snapshot?.planName ? <><br/><span className="text-slate-500">{share.snapshot.planName}</span></> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 text-[11px] text-slate-700">
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR_PUBLISHED }} /> Published capture</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR_INPROCESS }} /> In-process capture</div>
          <div className="flex items-center gap-2">{sw(COLOR_PUBLISHED)} Panotrack (published)</div>
          <div className="flex items-center gap-2">{sw(COLOR_INPROCESS, true)} Panotrack (in process)</div>
          <div className="pt-1.5 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed">
            <strong className="text-slate-900">{st.subgrids}</strong> subgrids · <strong className="text-slate-900">{typeof st.km === 'number' ? st.km.toFixed(2) : '0.00'} km</strong> · <strong className="text-slate-900">{(st.poi || 0).toLocaleString()}</strong> POIs
            <br /><strong className="text-slate-900">{(st.frames || 0).toLocaleString()}</strong> panoramas · QA pass <strong className="text-slate-900">{typeof st.passRate === 'number' ? st.passRate.toFixed(1) : '100'}%</strong>
          </div>
        </div>
      )}
      <div className="mt-2 text-[9.5px] text-slate-400">Click points or lines for details · read-only view</div>
    </div>
  );
}

function StatusCard({ icon, title, message }: { icon: React.ReactNode; title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-lg p-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-5">
          <GeoSphereIcon size={24} colorful={false} className="text-slate-900" />
          <span className="text-[14px] font-extrabold text-slate-900">GeoSphere <span className="text-slate-500">360°</span></span>
        </div>
        <div className="mx-auto w-11 h-11 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">
          {icon}
        </div>
        <h1 className="mt-4 text-[15px] font-bold text-slate-900">{title}</h1>
        <p className="mt-1.5 text-[12px] text-slate-500 leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

export function SharedMapPage() {
  const token = useMemo(() => {
    return parseShareToken(window.location.pathname) || parseShareToken(window.location.hash);
  }, []);
  const [share, setShare] = useState<MapShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    fetchShareByToken(token)
      .then(async (s) => {
        if (cancelled) return;
        setShare(s);
        setLoading(false);
        if (!s) return;
        if (!s.password_hash) {
          setUnlocked(true);
        } else {
          const saved = recallShareUnlock(token);
          if (saved && (await verifySharePassword(s, saved))) setUnlocked(true);
        }
        touchShare(token);
      })
      .catch((err) => {
        console.error('[SharedMapPage] fetchShareByToken error:', err);
        if (!cancelled) {
          setShare(null);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-slate-500 text-[13px] font-semibold">
          <Compass size={18} className="animate-spin" />
          Loading shared map…
        </div>
      </div>
    );
  }

  if (!token || !share) {
    return (
      <StatusCard
        icon={<AlertTriangle size={20} />}
        title="This map link is no longer available"
        message="The link may have expired, been revoked by the project team, or was mistyped. Please ask the sender for a fresh share link."
      />
    );
  }

  if (!unlocked) {
    return (
      <SharePasswordGate
        shareTitle={share.title}
        onUnlock={async (pw) => {
          const ok = await verifySharePassword(share, pw);
          if (ok) {
            rememberShareUnlock(share.token, pw);
            setUnlocked(true);
          }
          return ok;
        }}
      />
    );
  }

  const st = share?.snapshot?.stats || { subgrids: 0, km: 0, poi: 0, frames: 0, defects: 0, passRate: 100, lines: 0 };
  const hasKm = typeof st.km === 'number' && st.km > 0;
  return (
    <div className="fixed inset-0 flex flex-col bg-white font-[Arial,Helvetica,sans-serif]">
      <header className="h-[52px] shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <GeoSphereIcon size={22} colorful={false} className="text-slate-900 shrink-0" />
          <span className="text-[13px] font-extrabold text-slate-900 whitespace-nowrap">GeoSphere <span className="text-slate-500">360°</span></span>
          <span className="hidden sm:block w-px h-5 bg-slate-200 mx-1" />
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold text-slate-900 truncate">{share.title}</div>
            <div className="text-[9.5px] text-slate-500 uppercase tracking-wide truncate">
              {share.kind === 'road' ? 'Road Analysis' : 'WebGIS Survey'}{hasKm ? ` · ${st.km.toFixed(2)} km` : ''}{share.snapshot?.contractCode ? ` · ${share.snapshot.contractCode}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-slate-500 border border-slate-200 rounded-full px-2.5 py-1">
            <Eye size={11} /> Read-only share
          </span>
          {share.password_hash && (
            <span className="hidden md:inline text-[9.5px] font-semibold text-slate-400 uppercase tracking-wider">Password protected</span>
          )}
        </div>
      </header>

      <main className="flex-1 relative min-h-0">
        <ShareMap share={share} onCoords={setCoords} />
        <LegendCard share={share} />
        <div className="absolute bottom-6 right-4 z-10 bg-white/95 backdrop-blur border border-slate-200 rounded-lg shadow px-3 py-1.5 text-[10.5px] font-semibold text-slate-600 tabular-nums">
          {coords ? `${Math.abs(coords.lat).toFixed(5)}° ${coords.lat >= 0 ? 'N' : 'S'}, ${Math.abs(coords.lng).toFixed(5)}° ${coords.lng >= 0 ? 'E' : 'W'}` : 'Move cursor to read coordinates'}
        </div>
      </main>

      <footer className="h-[26px] shrink-0 bg-white border-t border-slate-200 flex items-center justify-between px-4 text-[9px] text-slate-400 uppercase tracking-wider z-20">
        <span>GeoSphere 360 · Mobile Mapping Surveillance</span>
        <span>Shared {new Date(share.created_at).toLocaleDateString('en-GB')}</span>
      </footer>
    </div>
  );
}
