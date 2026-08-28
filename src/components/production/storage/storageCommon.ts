// =====================================================================
// Shared helpers for the NAS Storage Manager workspace tabs.
// =====================================================================

import type { ExtendedProjectSettings } from '../../../types/admin';
import { getProductionApiSettings } from '../common';

export type { TranslateFn } from '../common';

export interface StorageWorkspaceProps {
  projectSettings: ExtendedProjectSettings;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  translate: (key: string) => string;
}

export { getProductionApiSettings };

export const STORAGE_TAB_LABELS: Record<string, string> = {
  overview: 'storageTabOverview',
  browser: 'storageTabBrowser',
  rawregistry: 'storageTabRawRegistry',
  validation: 'storageTabValidation',
  index: 'storageTabIndex'
};

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

export function pct(value: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

export function guessSubgridFromPath(path: string): string {
  const seg = (path || '').split(/[\\/]/).filter(Boolean);
  const hit = seg.find((s) => /^[nNsS]\d{2}[eEwW]\d{2,3}$/i.test(s));
  return hit ? hit.toUpperCase() : '';
}