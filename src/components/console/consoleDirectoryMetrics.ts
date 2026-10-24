/**
 * The console's derived figures, as pure functions.
 *
 * WHY THESE ARE NOT IN THE HOOK
 *   `useConsoleDirectory` is pinned at 108 lines by the file-size ratchet, and
 *   the metric rules below are the part of it that has to be provable rather
 *   than merely present. A pure module can be unit-tested without React, and
 *   the two rules it encodes — "a failed read is null, not zero" and "an
 *   unconfigured limit is unlimited, not zero" — are the two ways this console
 *   has previously reported a number it never measured.
 *
 * THE TWO KINDS OF NOT-A-NUMBER
 *
 *   Unmeasured    the read failed. The figure does not exist. `null`, and it
 *                 renders as an em dash.
 *   Unconfigured  the read succeeded and the company has no limit on file. That
 *                 is a real, known fact — "unlimited" — and it is NOT the same
 *                 as a limit of zero. Summing it as zero under-reports the
 *                 portfolio, so it is counted separately and disclosed.
 *
 *   The old code conflated the two: `o.settings?.allowedUserSeats (fallback-to-zero)` mapped
 *   "no limit configured" onto 0, and a company sold an unlimited seat pool
 *   silently became a company sold no seats.
 */

import type { Organization, OrganizationStatus } from '../../services/tenantContext';

/** Renders an unmeasured figure as unknown. Never substitutes 0. */
export function formatMetric(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value}${suffix}`;
}

export interface ConsoleDirectoryMetrics {
  /** null = not measured (a failed read), not zero. */
  activeCount: number | null;
  /** Sum of the seat limits that ARE configured. Companies with no limit are counted separately. */
  totalSeats: number | null;
  /** Sum of the storage quotas that ARE configured. Companies with no quota are counted separately. */
  totalQuota: number | null;
  dedicatedCount: number | null;
  /** Companies with no seat limit on file. null when the read failed. */
  unlimitedSeatCount: number | null;
  /** Companies with no storage quota on file. null when the read failed. */
  unlimitedQuotaCount: number | null;
}

/**
 * Derive the console's portfolio figures from the directory.
 *
 * A failed read yields an empty array, which would sum and count to zero.
 * Every figure therefore inherits `directoryError` rather than the array.
 */
export function computeConsoleMetrics(
  organizations: Organization[],
  directoryError: string | null
): ConsoleDirectoryMetrics {
  if (directoryError) {
    return {
      activeCount: null,
      totalSeats: null,
      totalQuota: null,
      dedicatedCount: null,
      unlimitedSeatCount: null,
      unlimitedQuotaCount: null
    };
  }

  let totalSeats = 0;
  let totalQuota = 0;
  let unlimitedSeatCount = 0;
  let unlimitedQuotaCount = 0;

  for (const org of organizations) {
    const seats = org.settings?.allowedUserSeats;
    if (typeof seats === 'number' && Number.isFinite(seats)) totalSeats += seats;
    else unlimitedSeatCount += 1;

    const quota = org.settings?.storageQuotaGb;
    if (typeof quota === 'number' && Number.isFinite(quota)) totalQuota += quota;
    else unlimitedQuotaCount += 1;
  }

  return {
    activeCount: organizations.filter((o) => o.status === 'active').length,
    totalSeats,
    totalQuota,
    dedicatedCount: organizations.filter((o) => o.databaseType === 'dedicated_external').length,
    unlimitedSeatCount,
    unlimitedQuotaCount
  };
}

export const STATUS_LABEL: Record<OrganizationStatus, string> = {
  active: 'Active',
  trial: 'Trial / Pilot',
  suspended: 'Suspended',
  expired: 'Expired'
};

export const STATUS_TONE: Record<OrganizationStatus, string> = {
  active: 'text-emerald-600',
  trial: 'text-amber-600',
  suspended: 'text-rose-600',
  expired: 'text-slate-500'
};

/**
 * The status dot colour.
 *
 * Kept beside the label and the tone so the three cannot drift apart. It is a
 * dot rather than a coloured pill because the dashboard table stopped wearing
 * boxes: the dot carries the state, the word carries the meaning, and a pill
 * would say the same thing twice.
 */
export const STATUS_DOT: Record<OrganizationStatus, string> = {
  active: 'bg-emerald-500',
  trial: 'bg-amber-500',
  suspended: 'bg-rose-500',
  expired: 'bg-slate-400'
};
