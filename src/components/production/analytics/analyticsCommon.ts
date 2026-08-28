// =====================================================================
// Shared helpers for the Analytics workspace tabs.
// =====================================================================

import type { TranslateFn } from '../common';

export type { TranslateFn };

export const ANALYTICS_TAB_LABELS: Record<string, string> = {
  overview: 'analyticsTabOverview',
  distance: 'analyticsTabDistance',
  coverage: 'analyticsTabCoverage',
  density: 'analyticsTabDensity',
  quality: 'analyticsTabQuality'
};

export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(digits, 2)
  });
}

export function publishTone(state: string): string {
  if (state === 'published') return 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40';
  if (state === 'partial') return 'text-amber-300 border-amber-500/40 bg-amber-950/40';
  if (state === 'staged') return 'text-sky-300 border-sky-500/40 bg-sky-950/40';
  return 'text-slate-300 border-slate-600/60 bg-slate-800/40';
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}