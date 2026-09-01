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
    mode: projectSettings?.productionApiMode || 'mock',
    baseUrl:
      projectSettings?.productionApiUrl ||
      import.meta.env.VITE_PRODUCTION_API_URL ||
      '',
    concurrency: projectSettings?.productionConcurrency || 1,
    nasWorkBasePath:
      projectSettings?.nasWorkBasePath ||
      import.meta.env.VITE_NAS_WORK_BASE_PATH ||
      '//nas/360_images'
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
    'http://localhost:8000'
  ).replace(/\/+$/, '');

  const pfx = [folder || '', filename || '']
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '');

  if (!pfx) return '';

  if (base.endsWith('/api/images')) {
    return `${base}/${pfx}`;
  }
  return `${base}/api/images/${pfx}`;
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

export const PRODUCTION_TAB_LABELS: Record<string, string> = {
  pipeline: 'productionTabPipeline',
  datasets: 'productionTabDatasets',
  providers: 'productionTabProviders',
  preview: 'productionTabPreview',
  enhance: 'productionTabEnhance',
  masking: 'productionTabMasking'
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