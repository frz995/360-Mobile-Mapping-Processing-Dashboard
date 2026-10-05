/**
 * Persistent surfacing of failed Supabase writes.
 *
 * WHY THIS EXISTS
 *
 * Most write paths in this app report failure with `console.warn` and continue.
 * For a system whose value is an audit trail, that is the worst possible
 * default: a rejected write looks exactly like a successful one until the page
 * is refreshed, at which point the count silently reverts. The `onConflict`
 * mismatch fixed in `src/services/api/qaqc.ts` hid for months for exactly this
 * reason — Postgres rejected every audit write, the app carried on, and nothing
 * looked wrong.
 *
 * `console.warn` is the right level for a degraded-but-working read. It is the
 * wrong level for a write that was meant to persist an audit decision, because
 * the operator has no other way to learn it failed.
 *
 * WHAT THIS DOES
 *
 * A tiny observable store. `reportWriteFailure` records a failed write and
 * de-duplicates repeats of the same operation so a failing retry loop cannot
 * produce an unbounded list. `WriteFailureBanner` subscribes and stays visible
 * until the failure is acknowledged or a subsequent write to the same operation
 * succeeds.
 *
 * Deliberately a banner rather than a toast: a toast auto-dismisses in 4.2s,
 * which is the same "failure you might miss" problem in smaller form.
 */

export type WriteFailureSeverity = 'error' | 'warning';

export interface WriteFailure {
  /** Stable operation key, e.g. 'qaqc.audit_run'. Repeats collapse onto it. */
  op: string;
  /** Short human label, e.g. 'QA/QC audit summary'. */
  label: string;
  /** Underlying error message, shown on hover / in the detail line. */
  detail?: string;
  severity: WriteFailureSeverity;
  /** Times this operation has failed since the last success. */
  count: number;
  firstFailedAt: number;
  lastFailedAt: number;
  /**
   * Monotonic ordering key. `Date.now()` collides when two operations fail in
   * the same millisecond, which left the newest-first ordering to insertion
   * order and made the banner jump around.
   */
  seq: number;
}

type Listener = (failures: WriteFailure[]) => void;

const failures = new Map<string, WriteFailure>();
const listeners = new Set<Listener>();
let seqCounter = 0;

/**
 * Newest-first snapshot. Shared by `emit` and `getWriteFailures` so a
 * subscriber and a direct read can never disagree about ordering.
 */
function snapshot(): WriteFailure[] {
  return Array.from(failures.values()).sort((a, b) => b.seq - a.seq);
}

function emit(): void {
  const snap = snapshot();
  listeners.forEach((listener) => {
    try {
      listener(snap);
    } catch {
      // A misbehaving listener must never break the write path that reported.
    }
  });
}

/**
 * Record a failed write. Safe to call from a catch block: it never throws.
 */
export function reportWriteFailure(
  op: string,
  label: string,
  detail?: string,
  severity: WriteFailureSeverity = 'error'
): void {
  const key = (op || 'unknown').trim() || 'unknown';
  const now = Date.now();
  const existing = failures.get(key);

  if (existing) {
    existing.count += 1;
    existing.lastFailedAt = now;
    existing.detail = detail ?? existing.detail;
    existing.severity = severity;
    existing.seq = ++seqCounter;
  } else {
    failures.set(key, {
      op: key,
      label: (label || key).trim(),
      detail,
      severity,
      count: 1,
      firstFailedAt: now,
      lastFailedAt: now,
      seq: ++seqCounter
    });
  }
  emit();
}

/**
 * Clear an operation's failure after a later write succeeds. A repeat failure
 * of the same operation re-raises a fresh entry, so a long-standing problem
 * does not permanently pin a stale error on screen.
 */
export function reportWriteSuccess(op: string): void {
  const key = (op || 'unknown').trim() || 'unknown';
  if (failures.delete(key)) emit();
}

/** Subscribe to the current failure list. Fires immediately with a snapshot. */
export function subscribeWriteFailures(listener: Listener): () => void {
  listeners.add(listener);
  // Guarded for the same reason emit() is: a misbehaving subscriber must not
  // throw out of the subscribe call itself.
  try {
    listener(snapshot());
  } catch {
    // ignore
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getWriteFailures(): WriteFailure[] {
  return snapshot();
}

/** Dismiss one operation's failure without implying it was fixed. */
export function dismissWriteFailure(op: string): void {
  if (failures.delete((op || '').trim())) emit();
}

/** Dismiss everything. Used by the "Dismiss all" control and by tests. */
export function clearWriteFailures(): void {
  if (failures.size === 0) return;
  failures.clear();
  emit();
}
