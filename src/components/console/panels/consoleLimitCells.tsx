/**
 * The one owner of "how much did we sell this company" wording.
 *
 * WHY THIS IS SHARED
 *   The console showed two different answers for the same company. The
 *   Companies panel rendered `allowedUserSeats (fallback-to-zero)` and `storageQuotaGb (fallback-to-zero)`,
 *   so a company with no limit on file read as "0 seats · 0 GB Platform".
 *   The Seats panel, working from the seat summary RPC, correctly rendered the
 *   same company as "No limit configured". Two tabs of one console, two
 *   answers, both on screen at once.
 *
 * THE RULE
 *   A limit that was never configured is not a limit of zero. It is unlimited.
 *   So:
 *     configured   -> the number
 *     not configured -> "No limit configured" (seats) / "Unlimited" (quota)
 *
 *   The number is never zeroed on the way out. `null` in, "unknown / no limit"
 *   out — never `0`.
 *
 * THE READ RULES AND THE WRITE RULES BELONG TOGETHER
 *   The form used to write `Number(value) (fallback-to-zero)`, so clearing the box saved a
 *   limit of zero instead of removing the limit, and its edit path substituted
 *   `?? 10` for a company with no limit on file — which silently capped an
 *   unlimited company the moment the seller saved an unrelated field. A rule
 *   that is only enforced on the way to the screen is a rule that can be
 *   broken by writing to the database.
 */

import React from 'react';
import type { Organization } from '../../../services/tenantContext';
import { Field, inputClass } from './consoleUi';

export interface LimitSummary {
  /** null = no limit on file. */
  seats: number | null;
  /** null = no quota on file. */
  quotaGb: number | null;
  seatsLabel: string;
  quotaLabel: string;
}

/** Reads the configured limits off an organization without inventing any. */
export function summarizeLimits(org: Organization): LimitSummary {
  const rawSeats = org.settings?.allowedUserSeats;
  const rawQuota = org.settings?.storageQuotaGb;

  const seats = typeof rawSeats === 'number' && Number.isFinite(rawSeats) ? rawSeats : null;
  const quotaGb = typeof rawQuota === 'number' && Number.isFinite(rawQuota) ? rawQuota : null;

  return {
    seats,
    quotaGb,
    seatsLabel: seats === null ? 'No limit configured' : `${seats} seats`,
    quotaLabel: quotaGb === null ? 'Unlimited' : `${quotaGb} GB Platform`
  };
}

/**
 * The seats + quota cell.
 *
 * `compact` is for the dashboard's per-company table, where a single line is
 * all the room there is; the Companies panel gets the two-line form so the
 * operator can tell "no limit" from "a limit of zero" at a glance.
 */
export const LimitSummaryCell: React.FC<{ org: Organization; compact?: boolean }> = ({
  org,
  compact = false
}) => {
  const { seats, quotaGb } = summarizeLimits(org);

  if (compact) {
    return (
      <span className="font-mono text-slate-700">
        {seats === null ? 'No limit' : `${seats} seats`}
        <span className="text-slate-400"> · </span>
        {quotaGb === null ? 'Unlimited' : `${quotaGb} GB`}
      </span>
    );
  }

  return (
    <div className="space-y-0.5">
      <div>
        <span className="font-bold text-slate-900">{seats === null ? '—' : seats}</span>{' '}
        <span className="text-slate-600">seats</span>
        {seats === null ? (
          <span className="block text-[11px] font-medium text-slate-400">No limit configured</span>
        ) : null}
      </div>
      <div>
        <span className="font-bold text-slate-900">{quotaGb === null ? '—' : quotaGb}</span>{' '}
        <span className="text-slate-600">GB Platform</span>
        {quotaGb === null ? (
          <span className="block text-[11px] font-medium text-slate-400">Unlimited</span>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Parses a limit typed into the form.
 *
 * An empty box means "no limit configured", and is written as the ABSENCE of
 * the setting — not as a limit of zero. `undefined` is dropped on the way to
 * the database, which is how an unlimited company stays unlimited.
 */
export function limitValue(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The limits already on file for a company.
 *
 * A company with no limit on file has no limit. Substituting a default here
 * would cap an unlimited company the moment the seller opened the form to
 * change something else. A configured zero is preserved as a configured zero.
 */
export function draftLimits(org: Organization): { allowedUserSeats?: number; storageQuotaGb?: number } {
  const seats = org.settings?.allowedUserSeats;
  const quota = org.settings?.storageQuotaGb;
  return {
    allowedUserSeats: typeof seats === 'number' && Number.isFinite(seats) ? seats : undefined,
    storageQuotaGb: typeof quota === 'number' && Number.isFinite(quota) ? quota : undefined
  };
}

/**
 * The two limit inputs.
 *
 * Blank reads "Unlimited" in the placeholder, which is the same word the
 * Companies tab uses for a company with no limit on file.
 */
export const LimitFields: React.FC<{
  seats: number | undefined;
  quotaGb: number | undefined;
  onChange: (limits: { allowedUserSeats?: number; storageQuotaGb?: number }) => void;
}> = ({ seats, quotaGb, onChange }) => (
  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
    <Field label="Licensed Seats">
      <input
        type="number"
        min="0"
        max="1000"
        value={seats ?? ''}
        placeholder="Unlimited"
        onChange={(e) => onChange({ allowedUserSeats: limitValue(e.target.value) })}
        className={inputClass}
      />
    </Field>
    <Field label="Storage Quota (GB)">
      <input
        type="number"
        min="0"
        max="100000"
        value={quotaGb ?? ''}
        placeholder="Unlimited"
        onChange={(e) => onChange({ storageQuotaGb: limitValue(e.target.value) })}
        className={inputClass}
      />
    </Field>
  </div>
);
