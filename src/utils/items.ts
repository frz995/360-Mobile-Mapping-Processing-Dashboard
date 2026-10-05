/**
 * Shared item-identity utilities.
 * Extracted from App.tsx so that extracted components can import them
 * without creating circular dependencies.
 */

// Helper: Unique ID generator for daily runs and batch items
export function getItemId(item: any): string {
  if (!item) return '';
  if (item.id) return String(item.id);
  if (item._id) return String(item._id);
  if (item.runId) return String(item.runId);
  const poi = item.poiCount || item.imagesProcessed || item.images || (item.panoramas ? item.panoramas.length : 0);
  const km = item.kmProcessed || 0;
  return `row-${item.date || 'nodate'}-${item.subgrid || item.imageFilename || 'nosub'}-${poi}-${km}`;
}

/**
 * Resolve a QA/QC audit record for ONE survey run out of the audit cache, which
 * is keyed `${SUBGRID}_${runId}`.
 *
 * Resolution order:
 *   1. Exact `${sg}_${runId}` — this run's own audit.
 *   2. `${sg}_default`, but only when it is the subgrid's SOLE audit. A run-less
 *      (masterlist) audit describes the whole subgrid, so it is safe to read only
 *      when nothing more specific competes with it.
 *   3. Otherwise `undefined`.
 *
 * Step 3 is the bug fix. The previous prefix scan (`key.startsWith(sg + '_')`)
 * let a run with no audit of its own adopt a SIBLING run's record, so two runs of
 * one subgrid reported the same defect count — and a 0-frame run that can never
 * be audited still displayed an inherited total.
 */
export function resolveAuditForRun<T>(
  cache: Record<string, T> | null | undefined,
  subgrid: string | null | undefined,
  runId?: string | null
): T | undefined {
  if (!cache) return undefined;
  const sg = (subgrid || '').toString().toUpperCase().trim();
  if (!sg) return undefined;

  const rid = (runId || '').toString().trim();
  if (!rid) return cache[`${sg}_default`];

  const exact = cache[`${sg}_${rid}`];
  if (exact) return exact;

  // A run-less audit speaks for the whole subgrid, so it only reaches a run that
  // has no run-scoped sibling competing for the slot.
  const subgridAuditKeys = Object.keys(cache).filter(k => k.startsWith(`${sg}_`));
  if (subgridAuditKeys.length === 1 && subgridAuditKeys[0] === `${sg}_default`) {
    return cache[`${sg}_default`];
  }

  return undefined;
}
