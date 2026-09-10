import { useEffect, useMemo, useRef, useState } from 'react';
import { Edit2, Trash2 } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { StatusDot } from '../production/chrome';
import { rehydrateDistrictBoundary } from '../boundary/malaysiaDistricts';
import type { UserProject, ProjectStatus } from '../../services/projects';

const effectiveWorkerUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPLIBRE_WORKER_URL) || workerUrl;
maplibregl.setWorkerUrl(effectiveWorkerUrl);

const OFM_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const OFM_LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

const PENINSULAR_BBOX: [number, number, number, number] = [99.6, 1.2, 104.6, 6.8];

export const STATUS_DOT_TONE: Record<ProjectStatus, string> = {
  planning: 'bg-amber-400',
  active: 'bg-emerald-400',
  paused: 'bg-sky-400',
  completed: 'bg-slate-400',
  archived: 'bg-slate-500'
};

export const STATUS_KEY: Record<ProjectStatus, string> = {
  planning: 'projectStatusPlanning',
  active: 'projectStatusActive',
  paused: 'projectStatusPaused',
  completed: 'projectStatusCompleted',
  archived: 'projectStatusArchived'
};

export function formatRelative(lastOpened?: string | null): string {
  if (!lastOpened) return '';
  const then = new Date(lastOpened).getTime();
  if (isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(lastOpened).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export type BasemapKey = 'dark' | 'light';

export interface ProjectPreviewData {
  geojson: any;
  bbox: [number, number, number, number];
  districtNames: string[];
  basemapKey: BasemapKey | null;
}

/** Resolve the preview extent for a project card: committed boundary → scope bbox → peninsular fallback. */
export function resolveProjectPreview(project: UserProject): ProjectPreviewData {
  const scope = project.scope ?? {};
  const boundary = rehydrateDistrictBoundary(scope.projectBoundary);
  const geojson =
    boundary?.geojson && Array.isArray(boundary.geojson.features) && boundary.geojson.features.length > 0
      ? boundary.geojson
      : null;

  let bbox: [number, number, number, number] | null = null;
  if (geojson && Array.isArray(boundary.bbox) && boundary.bbox.length === 4) {
    bbox = boundary.bbox;
  }
  if (!bbox && Array.isArray(scope.bbox) && scope.bbox.length === 4) {
    bbox = scope.bbox;
  }
  if (!bbox) bbox = PENINSULAR_BBOX;

  const districtNames =
    Array.isArray(boundary?.districtNames) && boundary.districtNames.length > 0
      ? boundary.districtNames
      : geojson
        ? Array.from(new Set((geojson.features as any[]).map((f) => f.properties?.name).filter(Boolean)))
        : [];

  const basemapRaw = scope.basemap ?? scope.theme;
  const basemapKey = typeof basemapRaw === 'string'
    ? (/dark/i.test(basemapRaw) ? 'dark' : 'light')
    : null;

  return { geojson, bbox, districtNames, basemapKey };
}

/** Derive the card preview basemap from the user's global basemap setting (defaultBasemap / defaultBasemapStyle). */
export function resolveUserBasemapKey(basemap?: unknown): BasemapKey | null {
  if (typeof basemap !== 'string' || basemap.length === 0) return null;
  if (/dark|fiord/i.test(basemap)) return 'dark';
  return 'light';
}

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') || canvas.getContext('webgl2') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

/** Non-interactive mini map fitted to the project extent. Falls back to a matte when WebGL is unavailable (e.g. tests). */
function ProjectPreviewMap({ geojson, bbox, basemapKey }: { geojson: any; bbox: [number, number, number, number]; basemapKey: BasemapKey }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (fallback) return;
    if (!supportsWebGL()) {
      setFallback(true);
      return;
    }

    let map: maplibregl.Map | null = null;
    let disposed = false;
    try {
      map = new maplibregl.Map({
        container: el,
        style: basemapKey === 'dark' ? OFM_DARK_STYLE : OFM_LIGHT_STYLE,
        center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
        zoom: 5.5,
        attributionControl: false,
        interactive: false,
        renderWorldCopies: false,
        fadeDuration: 0
      });
    } catch {
      setFallback(true);
      return;
    }

    const draw = () => {
      if (disposed || !map) return;
      if (geojson && Array.isArray(geojson.features) && geojson.features.length > 0) {
        const srcId = 'preview-boundary';
        const dark = basemapKey === 'dark';
        const lineColor = dark ? '#f1f5f9' : '#0a0a0a';
        const casingColor = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)';
        const fillColor = dark ? '#cbd5e1' : '#0f172a';
        if (!map.getSource(srcId)) {
          try {
            map.addSource(srcId, { type: 'geojson', data: geojson });
            map.addLayer({
              id: 'preview-boundary-fill',
              type: 'fill',
              source: srcId,
              paint: { 'fill-color': fillColor, 'fill-opacity': dark ? 0.12 : 0.06 }
            });
            map.addLayer({
              id: 'preview-boundary-casing',
              type: 'line',
              source: srcId,
              paint: {
                'line-color': casingColor,
                'line-width': 4,
                'line-opacity': 0.6
              }
            });
            map.addLayer({
              id: 'preview-boundary-line',
              type: 'line',
              source: srcId,
              paint: { 'line-color': lineColor, 'line-width': 1.5, 'line-opacity': 1 }
            });
          } catch {
            /* layer already added */
          }
        }
      }
      try {
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 12, animate: false });
      } catch {
        /* keep fallback center/zoom */
      }
    };

    if (map.isStyleLoaded()) {
      draw();
    } else {
      map.once('load', draw);
    }

    return () => {
      disposed = true;
      try {
        map?.remove();
      } catch {
        /* already removed */
      }
    };
  }, [geojson, bbox, basemapKey, fallback]);

  if (fallback) {
    return <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-inner to-emerald-500/10" />;
  }
  return <div ref={containerRef} className="absolute inset-0" />;
}

export interface ProjectGalleryCardProps {
  project: UserProject;
  active?: boolean;
  actualKm?: number;
  targetKm?: number;
  progressPct?: number;
  canWrite?: boolean;
  basemapKey?: BasemapKey;
  translate?: (key: string) => string;
  onLoadProject?: (project: UserProject) => void;
  onEdit?: (project: UserProject) => void;
  onDelete?: (project: UserProject) => void;
}

export function ProjectGalleryCard({
  project,
  active = false,
  actualKm,
  targetKm,
  progressPct,
  canWrite = true,
  basemapKey,
  translate = (k) => k,
  onLoadProject,
  onEdit,
  onDelete
}: ProjectGalleryCardProps) {
  const preview = useMemo(() => resolveProjectPreview(project), [project]);
  const mapBasemapKey = basemapKey ?? preview.basemapKey ?? 'light';

  const resolvedActual = typeof actualKm === 'number' && !isNaN(actualKm)
    ? actualKm
    : (Number(project.scope?.actualKm) || 0);
  const resolvedTarget = typeof targetKm === 'number' && targetKm > 0
    ? targetKm
    : (Number(project.scope?.targetKm) || 0);
  const progress = typeof progressPct === 'number' && !isNaN(progressPct)
    ? progressPct
    : resolvedTarget > 0
      ? Math.min(100, Math.round(((resolvedActual / resolvedTarget) * 100) * 10) / 10)
      : (resolvedActual > 0 ? 100 : 0);

  const districtNames = preview.districtNames;

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl bg-card border transition-all duration-300 ${
        active
          ? 'border-emerald-500/40 shadow-md'
          : 'border-subtle hover:border-sky-400/40 hover:shadow-lg'
      }`}
    >
      {/* Map preview: project boundary on the user's basemap */}
      <div className="relative h-40 sm:h-44 shrink-0 overflow-hidden rounded-t-2xl bg-inner">
        <ProjectPreviewMap geojson={preview.geojson} bbox={preview.bbox} basemapKey={mapBasemapKey} />
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent pointer-events-none" />

        {/* Card actions */}
        {canWrite && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            {onLoadProject && !active && (
              <button
                onClick={() => onLoadProject(project)}
                className="px-2 py-1 text-[10px] font-semibold text-text-base bg-black/40 hover:bg-black/60 border border-white/10 rounded-lg backdrop-blur-md transition-all cursor-pointer"
              >
                {translate('projectLoad')}
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(project)}
                aria-label="Edit project"
                title="Edit Project"
                className="p-1.5 text-text-muted hover:text-sky-400 hover:bg-sky-500/15 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg transition-all cursor-pointer"
              >
                <Edit2 size={13} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(project)}
                aria-label="Delete project"
                title={translate('projectDelete')}
                className="p-1.5 text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/15 bg-black/40 backdrop-blur-md border border-white/10 rounded-lg transition-all cursor-pointer"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}

        {/* District chips */}
        {districtNames.length > 0 && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1 flex-wrap">
            {districtNames.slice(0, 3).map((n) => (
              <span key={n} className="px-1.5 py-0.5 bg-black/45 backdrop-blur-md border border-white/10 rounded-md text-[9px] font-medium text-text-base">
                {n}
              </span>
            ))}
            {districtNames.length > 3 && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-medium text-text-base/80">
                +{districtNames.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Content (divider separates map from below) */}
      <div className="flex flex-col gap-2 p-3 min-w-0 flex-1 border-t border-subtle/70">
        {/* Title + status (green dot at active text) */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className="text-sm font-bold text-text-base truncate">{project.name}</span>
          {active ? (
            <span className="inline-flex items-center gap-1.5 shrink-0 text-[10px] font-semibold capitalize text-emerald-400">
              <StatusDot tone="bg-emerald-400" />
              {translate('projectCurrent')}
            </span>
          ) : project.status !== 'active' ? (
            <span className="inline-flex items-center gap-1.5 shrink-0 text-[10px] font-semibold capitalize text-text-muted">
              <StatusDot tone={STATUS_DOT_TONE[project.status]} />
              {translate(STATUS_KEY[project.status])}
            </span>
          ) : null}
        </div>

        {/* Compact meta line */}
        <div className="flex items-center gap-x-1.5 gap-y-0.5 text-[10px] text-text-muted flex-wrap">
          <span className="font-mono text-text-base">{project.contractCode || '—'}</span>
          <span className="text-text-muted/40">·</span>
          <span>{project.clientName || '—'}</span>
          <span className="text-text-muted/40">·</span>
          <span>{project.region || '—'}</span>
        </div>

        {/* Single-line description */}
        {project.description ? (
          <p className="text-[10px] text-text-muted leading-relaxed truncate">{project.description}</p>
        ) : null}

        {/* Footer: progress + distance */}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2 border-t border-subtle/40">
          <div className="flex-1 h-1.5 bg-card border border-subtle rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
          <span className="font-mono text-[10px] font-bold text-text-base shrink-0">{progress}%</span>
          <span className="font-mono text-[10px] text-text-muted whitespace-nowrap shrink-0">
            {resolvedActual.toFixed(1)}
            {resolvedTarget > 0 ? ` / ${resolvedTarget.toFixed(1)}` : ''} km
          </span>
        </div>
      </div>
    </div>
  );
}