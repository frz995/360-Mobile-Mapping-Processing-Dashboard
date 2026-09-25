// =====================================================================
// Shared helpers + prop types for the Image Production workspace tabs.
// =====================================================================

import type { ExtendedProjectSettings } from '../../types/admin';
import type { ProductionApiSettings } from '../../types/production';

export type TranslateFn = (key: string) => string;

export interface ProductionWorkspaceProps {
  projectSettings: ExtendedProjectSettings;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  translate: TranslateFn;
}

export function getProductionApiSettings(
  projectSettings: ExtendedProjectSettings
): ProductionApiSettings {
  return {
    mode: projectSettings?.productionApiMode || 'http',
    baseUrl:
      projectSettings?.productionApiUrl ||
      import.meta.env.VITE_PRODUCTION_API_URL ||
      '',
    concurrency: projectSettings?.productionConcurrency || 4,
    nasWorkBasePath:
      projectSettings?.nasWorkBasePath ||
      import.meta.env.VITE_NAS_WORK_BASE_PATH ||
      '',
    apiKey:
      projectSettings?.productionApiKey ||
      import.meta.env.VITE_PRODUCTION_API_KEY ||
      ''
  };
}

/** Build a preview URL for a NAS folder + filename using the resolved nasServerUrl / local worker. */
export function productionNasUrlFor(
  projectSettings: ExtendedProjectSettings,
  folder?: string,
  filename?: string
): string {
  const base = (
    projectSettings?.nasServerUrl ||
    projectSettings?.productionApiUrl ||
    import.meta.env.VITE_NAS_SERVER_URL ||
    import.meta.env.VITE_PRODUCTION_API_URL ||
    ''
  ).replace(/\/+$/, '');

  const pfx = [folder || '', filename || '']
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '');

  if (!pfx || !base) return '';

  if (base.endsWith('/api/images')) {
    return `${base}/${pfx}`;
  }
  return `${base}/api/images/${pfx}`;
}

const IMAGE_NAME_RE = /\.(jpe?g|png|webp|tiff?|bmp)$/i;

/** Resolve the first usable image under a NAS folder, returning its path
 * relative to `folder` (or just the filename when the image sits directly
 * there). Drills down shallowly so a dataset pointing at a container folder
 * (e.g. `04_Enhanced/Project-OUT/Grid 1`) still yields a preview frame
 * found at `N93E70/20220904/N93E70-0001.jpg`. */
export async function pickFirstNasImage(
  api: { listFolder: (path: string) => Promise<any> },
  folder: string,
  depth = 4
): Promise<string> {
  try {
    const listing = await api.listFolder(folder || '');
    const entries = (listing?.entries || []) as Array<{
      name: string;
      path?: string;
      isDirectory: boolean;
      fileCount?: number;
    }>;
    const direct = entries.find((e) => !e.isDirectory && IMAGE_NAME_RE.test(e.name));
    if (direct) return direct.name;
    if (depth <= 0) return '';
    for (const e of entries) {
      if (!e.isDirectory) continue;
      const inner = await pickFirstNasImage(api, e.path || '', depth - 1);
      if (inner) return `${e.name}/${inner}`;
    }
  } catch {
    return '';
  }
  return '';
}

/** Pipeline stage folders -> their successor (worker batch outputs). */
const STAGE_OUTPUT_NEXT: Record<string, string> = {
  '00_Raw_data': '02_Blurring',
  '02_Blurring': '04_Enhanced',
  '03_Stitching': '04_Enhanced',
  '04_Enhanced': '05_Final',
  '05_Final': '05_Final'
};

/** Designated stage folder for each job type (system-level outputs). */
const JOB_TYPE_STAGE: Record<string, string> = {
  BLUR: '02_Blurring',
  STITCH: '03_Stitching',
  ENHANCE: '04_Enhanced',
  MASK: '05_Final'
};

const STAGE_ROOTS = [
  '00_Raw_data',
  '01_Metadata',
  '02_Blurring',
  '03_Stitching',
  '04_Enhanced',
  '05_Final',
  '06_Image_Manifest',
  '07_Others'
];

const STAGE_ROOT_SET = new Set(STAGE_ROOTS);

function findStageIndex(parts: string[]): number {
  return parts.findIndex((p) => STAGE_ROOT_SET.has(p));
}

/** Derive the output folder from the JOB TYPE (not the source stage).
 * ENHANCE always writes into the `04_Enhanced` stage, MASK into `05_Final`.
 * The target stage replaces whatever stage segment exists anywhere in the
 * source path (`04_Enhanced/<rest>` or `Project/04_Enhanced/<rest>`, Windows
 * backslash paths, arbitrary prefixes), so a custom folder layout maps
 * cleanly onto the correct stage output instead of stacking stages. */
export function pipelineOutputFolder(
  jobType: string,
  sourceFolder: string | undefined,
  fallback: string
): string {
  const stage = JOB_TYPE_STAGE[jobType];
  if (!stage) return derivePipelineOutputFolder(sourceFolder, fallback);
  const s = (sourceFolder || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const parts = s ? s.split('/') : [];
  if (parts.length === 0) return fallback;
  const idx = findStageIndex(parts);
  if (idx >= 0) {
    if (parts.length === 1) return fallback;
    parts[idx] = stage;
    return parts.join('/');
  }
  return [stage, ...parts].join('/');
}

/** Derive the next-stage output folder from a source folder path
 * (e.g. `03_Stitching/Grid 1/20220904` -> `04_Enhanced/Grid 1/20220904`,
 * and `Project/04_Enhanced/<rest>` -> `Project/05_Final/<rest>`).
 * Falls back to `fallback` when the source has no recognizable stage segment. */
export function derivePipelineOutputFolder(sourceFolder: string | undefined, fallback: string): string {
  const s = (sourceFolder || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!s) return fallback;
  const parts = s.split('/');
  const idx = findStageIndex(parts);
  if (idx < 0) return fallback;
  const next = STAGE_OUTPUT_NEXT[parts[idx]];
  if (!next) return fallback;
  parts[idx] = next;
  return parts.join('/');
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

const EARTH_RADIUS_M = 6371008.8;
const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres, or null when a coordinate is unusable. */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number | null {
  if (![aLat, aLon, bLat, bLon].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Summed track length over an ordered coordinate list, in metres. Returns null
 * when fewer than two usable points exist, so callers can report "not
 * computable" instead of a per-frame distance constant.
 */
export function trackLengthMeters(
  points: Array<{ latitude: number; longitude: number }>
): number | null {
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const leg = haversineMeters(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude
    );
    if (leg !== null) total += leg;
  }
  return total;
}

export const PRODUCTION_TAB_LABELS: Record<string, string> = {
  pipeline: 'productionTabPipeline',
  datasets: 'productionTabDatasets',
  providers: 'productionTabProviders',
  preview: 'productionTabPreview',
  enhance: 'productionTabEnhance',
  masking: 'productionTabMasking',
  release: 'productionTabRelease'
};

export const JOB_TYPE_OPTIONS = [
  'ENHANCE',
  'MASK',
  'STITCH',
  'BLUR',
  'QAQC',
  'REPORT',
  'EXPORT',
  'AI_DETECT'
] as const;

export const DATASET_TYPE_OPTIONS = ['RAW', 'PROCESSED', 'DELIVERABLE'] as const;
export const PIPELINE_STAGE_OPTIONS = ['STITCH', 'BLUR', 'ENHANCE', 'MASK', 'QAQC'] as const;