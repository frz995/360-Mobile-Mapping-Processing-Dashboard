import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Copy, Database, Info, Search } from 'lucide-react';
import { InspectorDrawer } from './common/InspectorDrawer';
import { toast } from './common/toast';
import {
  computeSurveyIntegrity,
  aggregateSubgridIntegrity,
  checkIntegrityIdentities,
  type IntegrityReport,
  type IntegritySubject
} from '../utils/surveyIntegrity';
import type { FrameState } from '../utils/panotrackAppearance';

/**
 * Survey integrity detail for one subgrid or one run.
 *
 * WHY THIS IS A VERIFICATION SURFACE AND NOT A REPORT
 *
 * Every figure is either derived from a measured source or states why it could
 * not be. The rule is v26's: a number that cannot be computed renders as
 * unknown, never as zero. Two independent things can be unknown, and the panel
 * distinguishes both:
 *
 *   - the storage inventory was unreachable, so nothing was confirmed present
 *     OR absent;
 *   - the run predates migration 0034, so the metadata filename set was never
 *     persisted.
 *
 * Rendering either as `0` would tell an operator their survey is complete on
 * the strength of a connectivity failure.
 *
 * WHY MISSING IS NOT `expected - found`
 *
 * See `checkIntegrityIdentities`. An orphan image in the bucket inflates
 * "found" without filling any POI, so subtracting found from expected
 * understates the real gap by exactly the unlinked count. The panel shows the
 * true figure and flags the reconciliation gap rather than quietly picking one.
 */

/** Which figure a filename list belongs to. */
type ListKey =
  | 'missingImages'
  | 'duplicates'
  | 'invalidFilenames'
  | 'metadataMismatches'
  | 'unlinkedImages';

export interface SurveyIntegrityPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Run reports to aggregate, or a single report already computed. */
  reports: IntegrityReport[];
  title: string;
  subtitle?: string;
  /** True when every child run could read the storage inventory. */
  inventoryVerified?: boolean;
}

interface RowSpec {
  label: string;
  /** Rendered right-aligned. `null` renders as the unknown treatment. */
  value: number | null;
  /** Why the value is null. Shown in place of a number. */
  unknownReason?: string;
  /** A list this figure can open. Absent means not clickable. */
  listKey?: ListKey;
  /** Emphasis for the figures that matter most. */
  tone?: 'default' | 'warn' | 'bad';
  hint?: string;
}

export function SurveyIntegrityPanel({
  isOpen,
  onClose,
  reports,
  title,
  subtitle
}: SurveyIntegrityPanelProps): React.ReactElement | null {
  const [openList, setOpenList] = useState<ListKey | null>(null);
  const [filter, setFilter] = useState('');

  const report = useMemo<IntegrityReport>(
    () => (reports.length === 1 ? reports[0] : aggregateSubgridIntegrity(reports[0]?.subgrid ?? '', reports)),
    [reports]
  );

  const identities = useMemo(() => checkIntegrityIdentities(report), [report]);

  // ---- unknown reasons --------------------------------------------------
  // Stated per row rather than as one banner, because a banner is easy to skip
  // and the whole point is that these figures are not measurements.
  const storageUnknown = 'Frame inventory not verified — storage unreachable';

  // Unlinked has a THIRD distinct reason: we were never given the bucket's
  // contents at all. Saying "storage unreachable" there would blame a
  // connectivity failure for a missing argument.
  const bucketUnknown = report.unlinkedImages === null && report.inventoryVerified
    ? 'Bucket contents not supplied for this run'
    : storageUnknown;

  // Only Metadata mismatch genuinely requires migration 0034. Duplicate and
  // Invalid filename are derived from the run's own recorded filenames, which
  // every run has — claiming they are unknowable would hide two computable
  // figures behind a false excuse.
  const metadataUnknown = 'Not captured at import — run predates migration 0034';

  const missingCount = report.missingImages?.length ?? null;
  const duplicateCount = report.duplicates?.length ?? null;
  const invalidCount = report.invalidFilenames?.length ?? null;
  const mismatchCount = report.metadataMismatches?.length ?? null;
  const unlinkedCount = report.unlinkedImages?.length ?? null;

  const rows = useMemo<RowSpec[]>(() => {
    const list: RowSpec[] = [
      { label: 'Survey Date Capture', value: null, unknownReason: report.surveyDate ?? 'Not recorded' },
      {
        label: 'Total survey POI',
        value: report.poiCount,
        unknownReason: 'No POI coordinates recorded for this run'
      },
      {
        label: 'Expected images',
        value: report.expectedImages,
        unknownReason: 'Depends on POI count',
        hint: 'One frame per POI'
      },
      {
        label: 'Found images',
        value: report.foundImages,
        unknownReason: storageUnknown,
        hint: 'Present in the storage bucket'
      },
      {
        label: 'Missing',
        value: missingCount,
        unknownReason: storageUnknown,
        listKey: 'missingImages',
        tone: (missingCount ?? 0) > 0 ? 'bad' : 'default',
        hint: 'POIs with no image behind them'
      },
      {
        label: 'Duplicate',
        value: duplicateCount,
        listKey: 'duplicates',
        tone: (duplicateCount ?? 0) > 0 ? 'warn' : 'default',
        hint: 'Same image recorded more than once'
      },
      {
        label: 'Invalid filename',
        value: invalidCount,
        listKey: 'invalidFilenames',
        tone: (invalidCount ?? 0) > 0 ? 'warn' : 'default',
        hint: 'Not a usable frame name'
      },
      {
        label: 'Metadata mismatch',
        value: mismatchCount,
        unknownReason: metadataUnknown,
        listKey: 'metadataMismatches',
        tone: (mismatchCount ?? 0) > 0 ? 'warn' : 'default',
        hint: 'Metadata names a different image than the run recorded'
      },
      {
        label: 'GPS-linked images',
        value: report.gpsLinkedImages,
        unknownReason: storageUnknown,
        hint: 'Found in the bucket and claimed by a POI'
      },
      {
        label: 'Unlinked images',
        value: unlinkedCount,
        unknownReason: bucketUnknown,
        listKey: 'unlinkedImages',
        tone: (unlinkedCount ?? 0) > 0 ? 'warn' : 'default',
        hint: 'In the bucket, claimed by no POI'
      }
    ];
    return list;
  }, [
    report,
    missingCount,
    duplicateCount,
    invalidCount,
    mismatchCount,
    unlinkedCount,
    storageUnknown,
    bucketUnknown,
    metadataUnknown
  ]);

  // ---- filename list ----------------------------------------------------
  const listRows = useMemo<{ key: string; primary: string; secondary?: string }[]>(() => {
    if (!openList) return [];
    const source = report[openList] as unknown;
    if (!Array.isArray(source)) return [];

    return source.map((entry: any, index: number) => {
      switch (openList) {
        case 'missingImages':
          return {
            key: `missing-${index}`,
            primary: `#${entry.poiIndex + 1}  ${entry.filename}`
          };
        case 'duplicates':
          return { key: `dup-${index}`, primary: entry.filename, secondary: `×${entry.occurrences}` };
        case 'invalidFilenames':
          return { key: `inv-${index}`, primary: entry.filename, secondary: entry.reason };
        case 'metadataMismatches':
          return {
            key: `mm-${index}`,
            primary: `#${entry.poiIndex + 1}  ${entry.recordedFilename}`,
            secondary: `metadata: ${entry.metadataFilename || '(none)'}`
          };
        case 'unlinkedImages':
          return { key: `unl-${index}`, primary: entry.filename };
        default:
          return { key: `x-${index}`, primary: String(entry) };
      }
    });
  }, [openList, report]);

  const visibleListRows = useMemo(() => {
    const q = filter.trim().toUpperCase();
    if (!q) return listRows;
    return listRows.filter((r) => r.primary.toUpperCase().includes(q));
  }, [listRows, filter]);

  const handleCopy = useCallback(() => {
    const text = visibleListRows.map((r) => r.primary).join('\n');
    if (!text) return;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`Copied ${visibleListRows.length} filename(s)`))
      .catch(() => toast.error('Clipboard unavailable'));
  }, [visibleListRows]);

  const activeRowLabel = rows.find((r) => r.listKey === openList)?.label ?? '';

  // Portalled to `document.body`, NOT rendered in place.
  //
  // `InspectorDrawer` is `position: fixed`. Its mount point in
  // `DataManagementPage.tsx:2847` carries `.fade-in`, which `src/index.css:927`
  // gives a real rule with `will-change: opacity` — and `will-change` on a
  // paint property makes an element a containing block for fixed descendants.
  // The drawer then resolved against that div instead of the viewport, and the
  // same div's `overflow-hidden` clipped it away. The panel was invisible.
  //
  // `QCAuditModal.tsx:332` already solves this with `createPortal` to
  // `document.body`; this matches it. Nothing about the drawer changes — it is
  // still `fixed inset-0`, it is just no longer trapped in a subtree that
  // clips it.
  return typeof document !== 'undefined'
    ? createPortal(
        <InspectorDrawer
      isOpen={isOpen}
      onClose={onClose}
      widthMode="expanded"
      mode="docked"
      title={title}
      subtitle={subtitle}
      ariaLabel="Survey integrity detail"
      bodyClassName="flex flex-col gap-4 p-4"
    >
      {/* ---- the ten figures ---- */}
      <div className="rounded-xl border border-subtle bg-inner/40 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-subtle bg-inner/60">
              <th className="text-left font-semibold uppercase tracking-wider text-[10px] text-text-muted px-3 py-2">
                Check
              </th>
              <th className="text-right font-semibold uppercase tracking-wider text-[10px] text-text-muted px-3 py-2">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {rows.map((row) => (
              <tr key={row.label} className="align-top">
                <td className="px-3 py-2 text-text-base">
                  <div className="flex items-center gap-1.5">
                    {row.value === null ? (
                      <Info size={11} className="text-text-muted shrink-0" />
                    ) : row.value === 0 ? (
                      <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle
                        size={11}
                        className={row.tone === 'bad' ? 'text-rose-400 shrink-0' : 'text-amber-400 shrink-0'}
                      />
                    )}
                    <span>{row.label}</span>
                  </div>
                  {row.hint && (
                    <div className="text-[10px] text-text-muted mt-0.5 ml-4.5 pl-0.5">{row.hint}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {row.value === null ? (
                    <span
                      className="text-text-muted italic text-[11px]"
                      title={row.unknownReason}
                    >
                      {row.unknownReason}
                    </span>
                  ) : row.listKey ? (
                    <button
                      onClick={() => setOpenList(row.listKey!)}
                      className={`font-semibold tabular-nums cursor-pointer hover:underline inline-flex items-center gap-1 ${
                        row.value === 0
                          ? 'text-text-muted'
                          : row.tone === 'bad'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                      }`}
                      title={`Click to list ${row.label.toLowerCase()}`}
                    >
                      <span>{row.value.toLocaleString()}</span>
                    </button>
                  ) : (
                    <span
                      className={`font-semibold tabular-nums ${
                        row.value === 0 ? 'text-text-muted' : 'text-text-base'
                      }`}
                    >
                      {row.value.toLocaleString()}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- reconciliation ---- */}
      {/* The figure the operator is most likely to assume is `expected - found`.
          When orphans exist it disagrees with the true gap, by exactly their
          count. Saying so is the difference between a panel that is checked and
          one that is believed. */}
      {identities.undercountedByUnlinked !== null && identities.undercountedByUnlinked > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <div className="font-semibold mb-1">Reconciliation note</div>
          <div>
            {identities.undercountedByUnlinked} unlinked image
            {identities.undercountedByUnlinked === 1 ? '' : 's'} sit in the bucket without a POI, so they
            count toward <em>Found</em> while filling no gap.{' '}
            <strong>Expected − Found</strong> reads {identities.naiveGap?.toLocaleString()}; the number of POIs
            actually without an image is <strong>{identities.actualPoiGap?.toLocaleString()}</strong>.
          </div>
        </div>
      )}

      {/* ---- filename list ---- */}
      {openList && (
        <div className="rounded-xl border border-subtle bg-inner/40 flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-subtle">
            <span className="text-xs font-bold uppercase tracking-wide text-text-base">
              {activeRowLabel} ({visibleListRows.length}
              {listRows.length !== visibleListRows.length ? ` of ${listRows.length}` : ''})
            </span>
            <button
              onClick={() => {
                setOpenList(null);
                setFilter('');
              }}
              className="text-[11px] text-text-muted hover:text-text-base cursor-pointer"
            >
              Close
            </button>
          </div>

          {listRows.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-text-muted">Nothing to list.</p>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-subtle flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    size={11}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                  />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter filenames…"
                    className="w-full bg-inner border border-subtle rounded-lg pl-6 pr-2 py-1 text-[11px] text-text-base placeholder:text-text-muted focus:outline-none focus:border-sky-400"
                  />
                </div>
                <button
                  onClick={handleCopy}
                  disabled={visibleListRows.length === 0}
                  className="px-2 py-1 text-[11px] bg-inner hover:bg-sky-950/60 border border-subtle rounded-lg text-text-base font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Copy size={10} /> Copy ({visibleListRows.length})
                </button>
              </div>

              <div className="overflow-y-auto max-h-[320px] font-mono text-[11px]">
                {visibleListRows.length === 0 ? (
                  <p className="px-3 py-3 text-text-muted">No filename matches “{filter}”.</p>
                ) : (
                  visibleListRows.map((r) => (
                    <div
                      key={r.key}
                      className="px-3 py-1 hover:bg-inner/60 flex items-center justify-between gap-2"
                    >
                      <span className="text-text-base truncate">{r.primary}</span>
                      {r.secondary && (
                        <span className="text-amber-400 shrink-0">{r.secondary}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- provenance ---- */}
      <div className="text-[10px] text-text-muted flex items-start gap-1.5">
        <Database size={11} className="shrink-0 mt-0.5" />
        <span>
          Frame figures come from the storage inventory; metadata figures from the filename set recorded at
          import (migration 0034). Duplicate, Invalid filename and Metadata mismatch are anomalies found
          <em> within</em> the images that were found — they are not part of the Expected − Found arithmetic.
        </span>
      </div>
    </InspectorDrawer>,
        document.body
      )
    : null;
}

export default SurveyIntegrityPanel;

/** Build the child reports a panel needs from raw subjects. */
export function buildReports(subjects: IntegritySubject[]): IntegrityReport[] {
  return subjects.map((s) => computeSurveyIntegrity(s));
}

export type { FrameState };