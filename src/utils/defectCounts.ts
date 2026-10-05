/**
 * Canonical defect-count derivation for a survey run.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * `src/services/api/datasets.ts` and `src/hooks/useAppData.ts` both computed a
 * run's defect count, from overlapping but different inputs. They disagreed:
 * datasets.ts resolved the audit cache per RUN, while useAppData fell back to a
 * subgrid-wide `qa_defects` tally. Whichever ran last won, so the same run could
 * show different numbers in the Dashboard and in Data Management — and the
 * subgrid-wide fallback reintroduced exactly the cross-run bleed that
 * `resolveAuditForRun` exists to prevent.
 *
 * Two implementations of an audit number is the same failure mode as two
 * implementations of an audit cache key: they drift, and nothing catches it.
 * There is now one derivation, here, and both call sites use it.
 */

export interface DefectCountSources {
  /** Normalised subgrid code, e.g. 'N93E70'. */
  subgrid: string;
  /** Run identity. Null/absent means a masterlist-level (subgrid-wide) audit. */
  runId?: string | null;

  /**
   * Defect count already resolved per run by the data layer, from run-scoped
   * `qa_defects` rows. This is the most specific source available.
   */
  fromRunRows?: number | null;

  /** This run's own persisted audit summary (`qaqc_audit_runs.defect_count`). */
  fromRunAudit?: number | null;

  /**
   * Subgrid-wide fallback from `qa_defects` rows with a NULL `run_id`, which
   * predate run-scoped auditing. Only used when nothing run-specific exists.
   */
  fromSubgridRows?: number | null;

  /** Frame/POI ceiling for this run; a defect count can never exceed it. */
  ceiling?: number | null;
}

function present(n: number | null | undefined): number | null {
  // 0 is a MEANINGFUL value, not an absent one: a run audited with zero defects
  // must read 0 rather than fall through to a coarser source. The original
  // truthiness chain (`d.defectCount && d.defectCount > 0`) could not tell the
  // difference, so a clean audit silently inherited the subgrid-wide total.
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Resolve one run's defect count.
 *
 * Precedence, most specific first:
 *   1. run-scoped `qa_defects` rows
 *   2. this run's persisted audit summary
 *   3. subgrid-wide `qa_defects` rows (pre-run-scoped legacy data)
 *   4. zero
 *
 * The result is clamped to `ceiling` when one is known, which is what stops a
 * 0-frame run from advertising a defect count it could never have produced.
 */
export function resolveRunDefectCount(sources: DefectCountSources): number {
  const count =
    present(sources.fromRunRows) ??
    present(sources.fromRunAudit) ??
    present(sources.fromSubgridRows) ??
    0;

  const ceiling = positive(sources.ceiling);
  return ceiling === null ? count : Math.min(count, ceiling);
}

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export type QaqcVerdict = 'verified' | 'flagged' | 'ready' | 'flagged_staging';

export interface QaqcStatusInput {
  defectCount: number;
  isPublished: boolean;
  /** True when a persisted audit summary exists for this run. */
  hasAudit: boolean;
  /** Status string already on the row; preserved when there is no audit yet. */
  existing?: string | null;
}

/**
 * Build the human-readable QA/QC status for a run.
 *
 * A row with no audit keeps whatever status it already carried rather than
 * being relabelled "passed" — absence of evidence is not evidence of quality.
 */
export function buildQaqcStatus({ defectCount, isPublished, hasAudit, existing }: QaqcStatusInput): string | undefined {
  const plural = defectCount === 1 ? '' : 's';

  if (hasAudit) {
    if (isPublished) {
      return defectCount === 0
        ? 'Published (QAQC Verified)'
        : `Published (${defectCount} Defect${plural} Found)`;
    }
    return defectCount === 0
      ? 'QAQC Passed (Ready to Publish)'
      : `QAQC Flagged (${defectCount} Defect${plural} Found)`;
  }

  if (existing) return existing;
  return isPublished ? 'Published' : undefined;
}
