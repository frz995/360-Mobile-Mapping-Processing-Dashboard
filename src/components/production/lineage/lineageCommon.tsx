// =====================================================================
// Shared helpers for the Data Lineage workspace tabs.
// =====================================================================

import type { ReactNode } from 'react';
import type { TranslateFn } from '../common';

export type { TranslateFn };

export const LINEAGE_TAB_LABELS: Record<string, string> = {
  graph: 'lineageTabGraph',
  trace: 'lineageTabTrace',
  survey: 'lineageTabSurvey',
  registry: 'lineageTabRegistry'
};

export function statusTone(status?: string | null): string {
  const s = (status || '').toUpperCase();
  if (['COMPLETED', 'APPROVED', 'CAPTURED', 'READY', 'IMPORTED'].includes(s)) {
    return 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40';
  }
  if (['FAILED', 'REJECTED', 'ERROR'].includes(s)) {
    return 'text-rose-300 border-rose-500/40 bg-rose-950/40';
  }
  if (['IN_PROGRESS', 'QUEUED', 'QA_PENDING', 'REVIEW_REQUIRED', 'PENDING'].includes(s)) {
    return 'text-sky-300 border-sky-500/40 bg-sky-950/40';
  }
  if (['CANCELLED'].includes(s)) {
    return 'text-text-base border-subtle/40 bg-accent-bg';
  }
  return 'text-text-base border-subtle/40 bg-accent-bg';
}

export function qaBadge(
  qaDecision?: string | null,
  translate: TranslateFn = (k) => k
): ReactNode {
  if (!qaDecision) {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border border-subtle/60 bg-accent-bg text-text-muted">
        {translate('lineageQaPending')}
      </span>
    );
  }
  if (qaDecision === 'APPROVED') {
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border border-emerald-500/40 bg-emerald-950/40 text-emerald-300">
        {translate('lineageQaApproved')}
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border border-rose-500/40 bg-rose-950/40 text-rose-300">
      {translate('lineageQaRejected')}
    </span>
  );
}
