import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckSquare,
  Database,
  Info,
  Search,
  Copy,
  AlertTriangle,
  X
} from 'lucide-react';
import { InspectorDrawer } from './common/InspectorDrawer';
import { toast } from './common/toast';
import {
  computeSurveyIntegrity,
  aggregateSubgridIntegrity,
  checkIntegrityIdentities,
  MISSING_ROW_DEFINITION,
  type IntegrityReport,
  type IntegritySubject
} from '../utils/surveyIntegrity';
import { parseFlexibleDate, formatDisplayDate } from '../utils/dashboardData';

/** Which figure a filename list belongs to. */
type ListKey =
  | 'missingImages'
  | 'duplicates'
  | 'invalidFilenames'
  | 'metadataMismatches'
  | 'unlinkedImages';

/** What the survey-date check concluded, and why. */
interface DateVerdict {
  state: 'valid' | 'invalid' | 'unknown';
  /** Copy for the Result cell. */
  result: string;
  /** Copy for the Details cell. */
  detail: string;
}

export interface SurveyIntegrityPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Run reports to aggregate, or a single report already computed. */
  reports: IntegrityReport[];
  /** Fixed heading, e.g. "Survey Integrity". */
  title: string;
  /** Shown on its own line directly beneath the title — the subgrid name. */
  subtitle?: string;
  /** Secondary line beneath the subgrid: date, run count, CSV name. */
  detail?: string;
  /**
   * Re-read the storage inventory and the persisted metadata set, then push the
   * refreshed reports in through `reports`.
   *
   * The button that calls this is the only way the panel may claim it validated
   * anything, which is why `lastChecked` is stamped after it resolves rather than
   * when it is clicked.
   */
  onRevalidate?: () => Promise<void> | void;
}

/**
 * Decide whether a run's survey date is usable.
 *
 * The check used to be a hardcoded "Valid" beside whatever string the row held,
 * with a literal 2022 date as the fallback — so a run with no date rendered a
 * green tick next to a fabricated one. This actually parses, and reports
 * "Not recorded" rather than inventing a value.
 */
function resolveSurveyDate(reports: IntegrityReport[]): DateVerdict {
  const raw = reports.map((r) => r.surveyDate).filter((d): d is string => Boolean(d && d.trim()));
  if (raw.length === 0) {
    return { state: 'unknown', result: 'Not recorded', detail: 'No survey date on this run' };
  }

  const parsed = raw.map((d) => parseFlexibleDate(d));
  const valid = parsed.filter((d): d is Date => d !== null && !isNaN(d.getTime()));
  if (valid.length === 0) {
    return {
      state: 'invalid',
      result: 'Unparseable',
      detail: `Not a readable date: ${raw[0]}`
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const latest = valid.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
  if (latest.getTime() > today) {
    return {
      state: 'invalid',
      result: 'Future date',
      detail: `Survey dated ${formatDisplayDate(raw[valid.length - 1])}, after today`
    };
  }

  const earliest = valid.reduce((a, b) => (b.getTime() < a.getTime() ? b : a));
  const span =
    reports.length > 1 && earliest.getTime() !== latest.getTime()
      ? `${formatDisplayDate(earliest.toISOString())} to ${formatDisplayDate(latest.toISOString())}`
      : formatDisplayDate(raw[0]);

  const unparsed = raw.length - valid.length;
  return {
    state: 'valid',
    result: 'Valid',
    detail: unparsed > 0 ? `${span} (${unparsed} run${unparsed === 1 ? '' : 's'} unreadable)` : span
  };
}

export function SurveyIntegrityPanel({
  isOpen,
  onClose,
  reports,
  title,
  subtitle,
  detail,
  onRevalidate
}: SurveyIntegrityPanelProps): React.ReactElement | null {
  const [openList, setOpenList] = useState<ListKey | null>(null);
  const [filter, setFilter] = useState('');
  // Null until a validation has actually run. There is no seeded timestamp,
  // because a hardcoded one renders as proof that storage was read.
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const report = useMemo<IntegrityReport>(
    () => (reports.length === 1 ? reports[0] : aggregateSubgridIntegrity(reports[0]?.subgrid ?? '', reports)),
    [reports]
  );

  const identities = useMemo(() => checkIntegrityIdentities(report), [report]);

  // Storage and metadata failure reasons
  const storageUnknown = 'Frame inventory not verified (storage unreachable)';
  const bucketUnknown =
    report.unlinkedImages === null && report.inventoryVerified
      ? 'Bucket contents not supplied for this run'
      : storageUnknown;
  const metadataUnknown = 'Not captured at import (run predates migration 0034)';

  const missingCount = report.missingImages?.length ?? null;
  const duplicateCount = report.duplicates?.length ?? null;
  const duplicateOccurrences = report.duplicateOccurrences ?? null;
  const invalidCount = report.invalidFilenames?.length ?? null;
  const mismatchCount = report.metadataMismatches?.length ?? null;
  const unlinkedCount = report.unlinkedImages?.length ?? null;

  const expectedCount = report.expectedImages;

  // Total Issues adds three checks that are INDEPENDENTLY optional. Coercing an
  // unmeasured one to 0 let a run whose metadata was never captured read
  // "Total Issues 0" two rows above its own "Not evaluated" cell, and then be
  // declared clean. So the sum is only published when every term is known.
  const anomalies = useMemo(() => {
    const terms: Array<{ label: string; value: number | null }> = [
      { label: 'Duplicate', value: duplicateCount },
      { label: 'Invalid filename', value: invalidCount },
      { label: 'Metadata mismatch', value: mismatchCount }
    ];
    const unknownLabels = terms.filter((t) => t.value === null).map((t) => t.label);
    const total = unknownLabels.length === 0 ? terms.reduce((s, t) => s + (t.value ?? 0), 0) : null;
    return { total, unknownLabels };
  }, [duplicateCount, invalidCount, mismatchCount]);

  const totalIssuesCount = anomalies.total;

  // Every check must have been MEASURED before "clean" means anything. Missing
  // an unknown term is not a pass.
  const allAnomaliesKnown = totalIssuesCount !== null;

  const isClean =
    report.inventoryVerified &&
    missingCount === 0 &&
    totalIssuesCount === 0 &&
    report.metadataCaptured;

  const isWarning =
    report.inventoryVerified &&
    missingCount === 0 &&
    totalIssuesCount !== null &&
    totalIssuesCount > 0;

  const accentBorderColor = isClean
    ? 'border-emerald-500'
    : isWarning
    ? 'border-amber-400'
    : report.inventoryVerified && (missingCount ?? 0) > 0
    ? 'border-rose-500'
    : 'border-slate-500';

  const dateVerdict = useMemo(() => resolveSurveyDate(reports), [reports]);

  // Linked frames count and percentage.
  //
  // When the bucket contents are unknown, `found` is only the GPS-linked count,
  // so the percentage is a LOWER BOUND and is labelled as one. When storage could
  // not be reached there is no percentage at all: the previous code returned 0,
  // which prints "0% linked" for a run nobody looked at.
  const linkageKnown = report.foundImages !== null && report.gpsLinkedImages !== null;
  const linkageIsLowerBound = report.inventoryVerified && report.unlinkedImages === null;
  const linkedCount = report.gpsLinkedImages ?? 0;
  const percentLinked = useMemo(() => {
    if (!linkageKnown || expectedCount <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((linkedCount / expectedCount) * 100)));
  }, [linkageKnown, linkedCount, expectedCount]);

  // Filename drilldown list
  const listRows = useMemo<{ key: string; primary: string; secondary?: string }[]>(() => {
    if (!openList) return [];
    const source = report[openList] as unknown;
    if (!Array.isArray(source)) return [];

    return source.map((raw: unknown, index: number) => {
      const entry = raw as Record<string, unknown>;
      switch (openList) {
        case 'missingImages':
          return {
            key: `missing-${index}`,
            primary: `#${Number(entry.poiIndex) + 1}  ${String(entry.filename ?? '')}`
          };
        case 'duplicates':
          return { key: `dup-${index}`, primary: String(entry.filename ?? ''), secondary: `x${entry.occurrences}` };
        case 'invalidFilenames':
          return { key: `inv-${index}`, primary: String(entry.filename ?? ''), secondary: String(entry.reason ?? '') };
        case 'metadataMismatches':
          return {
            key: `mm-${index}`,
            primary: `#${Number(entry.poiIndex) + 1}  ${String(entry.recordedFilename ?? '')}`,
            secondary: `metadata: ${String(entry.metadataFilename || '(none)')}`
          };
        case 'unlinkedImages':
          return { key: `unl-${index}`, primary: String(entry.filename ?? '') };
        default:
          return { key: `x-${index}`, primary: String(raw) };
      }
    });
  }, [openList, report]);

  const visibleListRows = useMemo(() => {
    const q = filter.trim().toUpperCase();
    if (!q) return listRows;
    return listRows.filter((r) => r.primary.toUpperCase().includes(q));
  }, [listRows, filter]);

  const handleCopy = useCallback(() => {
    // The secondary column carries the reason (x3), the failing rule, and the
    // metadata name a frame disagrees with. Copying the name alone handed the
    // operator a list they could not act on.
    const text = visibleListRows
      .map((r) => (r.secondary ? `${r.primary}\t${r.secondary}` : r.primary))
      .join('\n');
    if (!text) return;
    void navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`Copied ${visibleListRows.length} filename(s)`))
      .catch(() => toast.error('Clipboard unavailable'));
  }, [visibleListRows]);

  const handleRunValidation = useCallback(async () => {
    if (isValidating) return;
    if (!onRevalidate) {
      toast.info('Re-validation needs a storage re-read; open this panel from a loaded run.');
      return;
    }
    setIsValidating(true);
    try {
      await onRevalidate();
      // Stamped only after the re-read resolves. The previous version stamped on
      // click and reported success, so the timestamp recorded intent, not a
      // measurement.
      const now = new Date();
      setLastChecked(
        `${now.getDate()} ${now.toLocaleString('en-GB', { month: 'short' })} ${now.getFullYear()} ${now
          .getHours()
          .toString()
          .padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      );
      toast.success('Storage inventory re-read');
    } catch (err) {
      toast.error(
        err instanceof Error ? `Validation failed: ${err.message}` : 'Validation failed'
      );
    } finally {
      setIsValidating(false);
    }
  }, [isValidating, onRevalidate]);

  const drawerDetailText =
    detail ??
    `Capture: ${dateVerdict.detail}, ${reports.length} run${reports.length === 1 ? '' : 's'}`;

  // Portalled to document.body to avoid clipping inside animated containers
  return typeof document !== 'undefined'
    ? createPortal(
        <InspectorDrawer
          isOpen={isOpen}
          onClose={onClose}
          mode="docked"
          widthMode="expanded"
          allowWidthToggle={false}
          title={title}
          subtitle={subtitle}
          detail={drawerDetailText}
          ariaLabel="Survey integrity detail"
          bodyClassName="flex flex-col gap-3 p-3.5 sm:p-4 overflow-y-auto"
        >
          {/* TOP CARD: Alert Banner, Metric Cards & Progress */}
          <div className="rounded-xl border border-subtle bg-inner/40 p-3 sm:p-3.5 space-y-3">
            {/* Left Callout */}
            <div className={`border-l-[3px] ${accentBorderColor} pl-3 py-0.5`}>
              {missingCount !== null && missingCount > 0 ? (
                <>
                  <h3 className="text-xs sm:text-sm font-bold text-text-base">
                    <span className="text-rose-400 tabular-nums">{missingCount.toLocaleString()}</span> of{' '}
                    {expectedCount.toLocaleString()} expected frames are missing
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                    The dataset is incomplete. Please check the storage source and re-run validation after resolving the issue.
                  </p>
                </>
              ) : isClean ? (
                <>
                  <h3 className="text-xs sm:text-sm font-bold text-text-base text-emerald-400">
                    All {expectedCount.toLocaleString()} expected frames verified and linked
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                    Metadata records and image filenames are completely linked, valid, and matched with storage inventory.
                  </p>
                </>
              ) : report.inventoryVerified && totalIssuesCount !== null && totalIssuesCount > 0 ? (
                <>
                  <h3 className="text-xs sm:text-sm font-bold text-text-base text-amber-400">
                    {totalIssuesCount} anomaly issue{totalIssuesCount === 1 ? '' : 's'} detected
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                    All expected frames are present, but review the anomaly checks below.
                  </p>
                </>
              ) : report.inventoryVerified ? (
                // Storage was read, nothing is missing, and at least one check
                // could not be evaluated. Silence here would read as a pass.
                <>
                  <h3 className="text-xs sm:text-sm font-bold text-text-base text-amber-400">
                    Anomaly checks incomplete
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                    All {expectedCount.toLocaleString()} expected frames are present. {anomalies.unknownLabels.join(' and ')}{' '}
                    could not be evaluated for this run, so this is not a clean result.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-xs sm:text-sm font-bold text-text-base text-slate-400">
                    Frame inventory unverified
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                    Storage could not be reached. Completeness cannot be confirmed.
                  </p>
                </>
              )}
            </div>

            {/* 4 Stat Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {/* Expected Frames */}
              <div className="rounded-lg border border-subtle/80 bg-inner/50 p-2 flex flex-col justify-between">
                <span className="text-[10px] font-medium text-text-muted">Expected Frames</span>
                <div className="my-0.5">
                  <span className="text-lg sm:text-xl font-bold text-text-base tabular-nums">
                    {expectedCount.toLocaleString()}
                  </span>
                </div>
                <span className="text-[9px] text-text-muted truncate">
                  One per recorded POI
                </span>
              </div>

              {/* Available Frames */}
              <div className="rounded-lg border border-subtle/80 bg-inner/50 p-2 flex flex-col justify-between">
                <span className="text-[10px] font-medium text-text-muted">Available Frames</span>
                <div className="my-0.5">
                  <span className="text-lg sm:text-xl font-bold text-text-base tabular-nums">
                    {report.foundImages !== null ? report.foundImages.toLocaleString() : '-'}
                  </span>
                </div>
                <span className="text-[9px] text-text-muted truncate">
                  {linkageIsLowerBound
                    ? 'Lower bound, bucket unread'
                    : (unlinkedCount ?? 0) > 0
                    ? 'Linked + unclaimed strays'
                    : 'POI-matched in storage'}
                </span>
              </div>

              {/* Missing Frames */}
              <div className="rounded-lg border border-subtle/80 bg-inner/50 p-2 flex flex-col justify-between">
                <span className="text-[10px] font-medium text-text-muted">Missing Frames</span>
                <div className="my-0.5">
                  <span
                    className={`text-lg sm:text-xl font-bold tabular-nums ${
                      (missingCount ?? 0) > 0 ? 'text-rose-400' : 'text-text-base'
                    }`}
                  >
                    {missingCount !== null ? missingCount.toLocaleString() : '-'}
                  </span>
                </div>
                <span className="text-[9px] text-text-muted truncate">
                  {missingCount === null
                    ? 'Not measured'
                    : (missingCount ?? 0) > 0
                    ? 'Expected minus GPS-linked'
                    : 'All accounted for'}
                </span>
              </div>

              {/* Total Issues */}
              <div className="rounded-lg border border-subtle/80 bg-inner/50 p-2 flex flex-col justify-between">
                <span className="text-[10px] font-medium text-text-muted">Total Issues</span>
                <div className="my-0.5">
                  <span
                    className={`text-lg sm:text-xl font-bold tabular-nums ${
                      totalIssuesCount !== null && totalIssuesCount > 0 ? 'text-amber-400' : 'text-text-base'
                    }`}
                  >
                    {totalIssuesCount !== null ? totalIssuesCount.toLocaleString() : '-'}
                  </span>
                </div>
                <span className="text-[9px] text-text-muted truncate">
                  {allAnomaliesKnown
                    ? '(excluding missing)'
                    : `not evaluated: ${anomalies.unknownLabels.join(', ')}`}
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="flex items-center gap-3 pt-0.5">
              <div className="flex-1 h-1.5 rounded-full bg-inner overflow-hidden border border-subtle/60">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    linkageKnown
                      ? 'bg-gradient-to-r from-sky-500 to-cyan-400 shadow-[0_0_8px_rgba(56,189,248,0.35)]'
                      : 'bg-slate-500/40'
                  }`}
                  style={{ width: `${linkageKnown ? percentLinked : 100}%` }}
                />
              </div>
              <span
                className={`text-[11px] font-semibold tabular-nums shrink-0 ${
                  linkageKnown ? 'text-text-base' : 'text-text-muted italic font-normal'
                }`}
              >
                {linkageKnown
                  ? `${percentLinked}% linked${linkageIsLowerBound ? ' (lower bound)' : ''}`
                  : 'Linkage not verified'}
              </span>
            </div>
          </div>

          {/* MIDDLE CARD: Validation Checks Table */}
          <div className="rounded-xl border border-subtle bg-inner/40 p-3 sm:p-3.5 space-y-2.5">
            {/* Table Header Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-subtle/60">
              <div className="flex items-center gap-1.5">
                <CheckSquare size={14} className="text-text-base" />
                <h3 className="text-xs sm:text-sm font-bold text-text-base">Validation Checks</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">
                  {lastChecked ? `Last checked: ${lastChecked}` : 'Not yet checked against storage'}
                </span>
                <button
                  onClick={() => void handleRunValidation()}
                  disabled={isValidating}
                  className="px-2 py-0.5 rounded border border-subtle bg-inner hover:bg-inner/80 hover:border-text-muted text-[10px] font-medium text-text-base transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isValidating ? 'Re-reading storage...' : 'Run validation'}
                </button>
              </div>
            </div>

            {/* Checks Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-subtle/80 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    <th className="text-left py-1.5 px-2 font-semibold">Check</th>
                    <th className="text-left py-1.5 px-2 font-semibold">Result</th>
                    <th className="text-left py-1.5 px-2 font-semibold">Details</th>
                    <th className="text-right py-1.5 px-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle/50">
                  {/* 1. Survey date */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            dateVerdict.state === 'valid'
                              ? 'bg-emerald-400'
                              : dateVerdict.state === 'invalid'
                              ? 'bg-rose-400'
                              : 'bg-slate-500'
                          }`}
                        />
                        <span>Survey date</span>
                        <span className="sr-only">Survey Date Capture</span>
                      </div>
                    </td>
                    <td
                      className={`py-1.5 px-2 font-semibold ${
                        dateVerdict.state === 'valid'
                          ? 'text-emerald-400'
                          : dateVerdict.state === 'invalid'
                          ? 'text-rose-400'
                          : 'text-text-muted'
                      }`}
                    >
                      {dateVerdict.result}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">{dateVerdict.detail}</td>
                    <td className="py-1.5 px-2 text-right text-text-muted">-</td>
                  </tr>

                  {/* 2. Total survey POI */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                        <span>Total survey POI</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-semibold tabular-nums text-text-base">
                      {report.poiCount !== null ? report.poiCount.toLocaleString() : 'No POI coordinates'}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {report.poiCount === null
                        ? 'Not measured for this run'
                        : identities.framesWithoutPoi === 0
                        ? 'Distinct coordinate locations'
                        : `${identities.framesWithoutPoi} of ${expectedCount} frames have no located POI`}
                    </td>
                    <td className="py-1.5 px-2 text-right text-text-muted">-</td>
                  </tr>

                  {/* 3. Expected images */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                        <span>Expected images</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-semibold tabular-nums text-text-base">
                      {report.expectedImages.toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {MISSING_ROW_DEFINITION.expectedImages}
                    </td>
                    <td className="py-1.5 px-2 text-right text-text-muted">-</td>
                  </tr>

                  {/* 4. Found images */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                        <span>Found images</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-semibold tabular-nums text-text-base">
                      {report.foundImages !== null ? (
                        report.foundImages.toLocaleString()
                      ) : (
                        <span className="text-text-muted italic font-normal">{storageUnknown}</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {MISSING_ROW_DEFINITION.foundImages}
                    </td>
                    <td className="py-1.5 px-2 text-right text-text-muted">-</td>
                  </tr>

                  {/* 5. Missing frames */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            (missingCount ?? 0) > 0 ? 'bg-rose-400' : 'bg-emerald-400'
                          }`}
                        />
                        <span>Missing frames</span>
                        <span className="sr-only">Missing</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      {missingCount === null ? (
                        <span className="text-text-muted italic">{storageUnknown}</span>
                      ) : missingCount === 0 ? (
                        <span aria-label="0" className="text-text-muted tabular-nums">0</span>
                      ) : (
                        <span className="font-bold tabular-nums text-rose-400">
                          {missingCount.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-[10px]">
                      {missingCount === null ? (
                        <span className="text-text-muted italic">{storageUnknown}</span>
                      ) : missingCount === 0 ? (
                        <span className="text-text-muted">All corresponding images found</span>
                      ) : (
                        <span className="text-rose-400">{MISSING_ROW_DEFINITION.missingImages}</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {missingCount === null ? (
                        <span className="text-text-muted">
                          <span className="sr-only">{storageUnknown}</span>
                          -
                        </span>
                      ) : missingCount > 0 ? (
                        <button
                          title="Click to list missing"
                          onClick={() => setOpenList('missingImages')}
                          className="text-rose-400 hover:text-rose-300 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer text-[10px]"
                        >
                          View details &gt;
                        </button>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>

                  {/* 6. Duplicate */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            (duplicateCount ?? 0) > 0 ? 'bg-amber-400' : 'bg-slate-500'
                          }`}
                        />
                        <span>Duplicate</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      {duplicateCount === 0 ? (
                        <span aria-label="0" className="text-text-muted tabular-nums">0</span>
                      ) : (
                        <span className="font-semibold tabular-nums text-amber-400">
                          {duplicateCount?.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {(duplicateCount ?? 0) === 0
                        ? 'No repeated filenames in the run metadata'
                        : `${duplicateCount} filename${duplicateCount === 1 ? '' : 's'} claimed by more than one POI, ${duplicateOccurrences} extra claim${duplicateOccurrences === 1 ? '' : 's'}`}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {(duplicateCount ?? 0) > 0 ? (
                        <button
                          title="Click to list duplicates"
                          onClick={() => setOpenList('duplicates')}
                          className="text-amber-400 hover:text-amber-300 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer text-[10px]"
                        >
                          View details &gt;
                        </button>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>

                  {/* 7. Invalid filename */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            (invalidCount ?? 0) > 0 ? 'bg-amber-400' : 'bg-slate-500'
                          }`}
                        />
                        <span>Invalid filename</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      {invalidCount === 0 ? (
                        <span aria-label="0" className="text-text-muted tabular-nums">0</span>
                      ) : (
                        <span className="font-semibold tabular-nums text-amber-400">
                          {invalidCount?.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {(invalidCount ?? 0) === 0 ? 'All filenames are valid' : `${invalidCount} invalid filename structures`}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {(invalidCount ?? 0) > 0 ? (
                        <button
                          title="Click to list invalid filenames"
                          onClick={() => setOpenList('invalidFilenames')}
                          className="text-amber-400 hover:text-amber-300 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer text-[10px]"
                        >
                          View details &gt;
                        </button>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>

                  {/* 8. Metadata mismatch */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            (mismatchCount ?? 0) > 0 ? 'bg-amber-400' : 'bg-slate-500'
                          }`}
                        />
                        <span>Metadata mismatch</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      {report.metadataCaptured ? (
                        mismatchCount === 0 ? (
                          <span aria-label="0" className="text-text-muted tabular-nums">0</span>
                        ) : (
                          <span className="font-semibold tabular-nums text-amber-400">
                            {mismatchCount?.toLocaleString()}
                          </span>
                        )
                      ) : (
                        <span className="text-text-muted italic">Not evaluated</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {report.metadataCaptured
                        ? (mismatchCount ?? 0) === 0
                          ? 'Metadata matches recorded frames'
                          : `${mismatchCount} mismatches against CSV`
                        : metadataUnknown}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {(mismatchCount ?? 0) > 0 ? (
                        <button
                          title="Click to list metadata mismatches"
                          onClick={() => setOpenList('metadataMismatches')}
                          className="text-amber-400 hover:text-amber-300 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer text-[10px]"
                        >
                          View details &gt;
                        </button>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>

                  {/* 9. GPS-linked images */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                        <span>GPS-linked images</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 font-semibold tabular-nums text-text-base">
                      {report.gpsLinkedImages !== null ? (
                        report.gpsLinkedImages.toLocaleString()
                      ) : (
                        <span className="text-text-muted italic font-normal">{storageUnknown}</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {report.gpsLinkedImages !== null
                        ? MISSING_ROW_DEFINITION.gpsLinkedImages
                        : storageUnknown}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {(report.gpsLinkedImages ?? 0) > 0 ? (
                        <button
                          onClick={() => toast.info(`${report.gpsLinkedImages} images mapped to trajectory`)}
                          className="text-text-muted hover:text-text-base font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer text-[10px]"
                        >
                          View details &gt;
                        </button>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>

                  {/* 10. Unlinked images */}
                  <tr className="hover:bg-inner/40 transition-colors">
                    <td className="py-1.5 px-2 font-medium text-text-base">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            (unlinkedCount ?? 0) > 0 ? 'bg-amber-400' : 'bg-slate-500'
                          }`}
                        />
                        <span>Unlinked images</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      {report.unlinkedImages === null ? (
                        <span className="text-text-muted italic">{bucketUnknown}</span>
                      ) : unlinkedCount === 0 ? (
                        <span aria-label="0" className="text-text-muted tabular-nums">0</span>
                      ) : (
                        <span className="font-semibold tabular-nums text-amber-400">
                          {unlinkedCount?.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-[10px] text-text-muted">
                      {report.unlinkedImages === null
                        ? bucketUnknown
                        : (unlinkedCount ?? 0) === 0
                        ? 'Every image here is claimed by some run'
                        : `${unlinkedCount} images no run of this subgrid claims`}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      {(unlinkedCount ?? 0) > 0 ? (
                        <button
                          title="Click to list unlinked images"
                          onClick={() => setOpenList('unlinkedImages')}
                          className="text-amber-400 hover:text-amber-300 font-semibold hover:underline inline-flex items-center gap-1 cursor-pointer text-[10px]"
                        >
                          View details &gt;
                        </button>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Identity failure. `checkIntegrityIdentities` returns these so the
                panel can show WHICH relationship broke; without this the rows
                could disagree with each other and nothing would say so. */}
            {(identities.missingEqualsExpectedMinusLinked === false ||
              identities.gpsPlusUnlinkedEqualsFound === false) && (
              <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-300">
                <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>Figures do not reconcile</span>
                </div>
                <div>
                  {identities.missingEqualsExpectedMinusLinked === false && (
                    <p>
                      Missing frames ({missingCount?.toLocaleString()}) does not equal expected minus
                      GPS-linked ({identities.actualPoiGap?.toLocaleString()}).
                    </p>
                  )}
                  {identities.gpsPlusUnlinkedEqualsFound === false && (
                    <p>
                      GPS-linked plus unlinked does not equal Found ({report.foundImages?.toLocaleString()}).
                    </p>
                  )}
                  The rows above cannot all be correct. Treat the counts as unreliable and re-read
                  storage before acting on them.
                </div>
              </div>
            )}

            {/* Reconciliation Note if orphans exist */}
            {identities.undercountedByUnlinked !== null && identities.undercountedByUnlinked > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
                <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  <span>Reconciliation note</span>
                </div>
                <div>
                  {identities.undercountedByUnlinked} image
                  {identities.undercountedByUnlinked === 1 ? '' : 's'} sit in the bucket that no run
                  of this subgrid claims, so {identities.undercountedByUnlinked === 1 ? 'it counts' : 'they count'}{' '}
                  toward <em>Found</em> while filling no gap. Expected minus Found reads{' '}
                  {identities.naiveGap?.toLocaleString()}; the number of POIs actually without an image is{' '}
                  <strong>{identities.actualPoiGap?.toLocaleString()}</strong>.
                </div>
              </div>
            )}
          </div>

          {/* FILENAME DRILLDOWN LIST (Integrated sub-section when a detail is clicked) */}
          {openList && (
            <div className="rounded-xl border border-subtle bg-inner/60 p-3 space-y-2.5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between gap-2 border-b border-subtle/80 pb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-text-base">
                  Filename List ({visibleListRows.length}
                  {listRows.length !== visibleListRows.length ? ` of ${listRows.length}` : ''})
                </span>
                <button
                  onClick={() => {
                    setOpenList(null);
                    setFilter('');
                  }}
                  className="p-1 rounded text-text-muted hover:text-text-base hover:bg-inner transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    size={11}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                  />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter filenames..."
                    className="w-full bg-inner border border-subtle rounded-md pl-7 pr-2 py-1 text-[11px] text-text-base placeholder:text-text-muted focus:outline-none focus:border-sky-400"
                  />
                </div>
                <button
                  onClick={handleCopy}
                  disabled={visibleListRows.length === 0}
                  className="px-2 py-1 text-[10px] bg-inner hover:bg-sky-950/60 border border-subtle rounded-md text-text-base font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  <Copy size={10} /> Copy ({visibleListRows.length})
                </button>
              </div>

              <div className="overflow-y-auto max-h-[190px] font-mono text-[10px] rounded border border-subtle/40 bg-inner/40 divide-y divide-subtle/30">
                {visibleListRows.length === 0 ? (
                  <p className="px-2 py-2.5 text-[10px] text-text-muted text-center">
                    {listRows.length === 0 ? 'Nothing to list.' : `No filename matches "${filter}".`}
                  </p>
                ) : (
                  visibleListRows.map((r) => (
                    <div
                      key={r.key}
                      className="px-2.5 py-1 hover:bg-inner/80 flex items-center justify-between gap-2 transition-colors"
                    >
                      <span className="text-text-base truncate">{r.primary}</span>
                      {r.secondary && (
                        <span className="text-amber-400 shrink-0 text-[10px]">{r.secondary}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* BOTTOM SECTION: Two Side-by-Side Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Data Source Card */}
            <div className="rounded-xl border border-subtle bg-inner/40 p-2.5 sm:p-3 space-y-2">
              <div className="flex items-center gap-1.5 border-b border-subtle/60 pb-1">
                <Database size={13} className="text-text-muted" />
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-base">Data Source</h4>
              </div>
              <div className="space-y-1 text-[10px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted">Storage bucket</span>
                  <span className="text-text-base font-medium">
                    {report.inventoryVerified ? 'Read successfully' : 'Unreachable'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted">Bucket contents</span>
                  <span className="text-text-base font-medium">
                    {report.unlinkedImages === null ? 'Not attributed to subgrid' : 'Attributed'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-text-muted">Metadata source</span>
                  <span className="text-text-base font-medium">
                    {report.metadataCaptured ? 'Import migration 0034' : 'Not captured for this run'}
                  </span>
                </div>
              </div>
            </div>

            {/* Validation Basis Card */}
            <div className="rounded-xl border border-subtle bg-inner/40 p-2.5 sm:p-3 flex flex-col justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 border-b border-subtle/60 pb-1">
                  <Info size={13} className="text-text-muted" />
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-base">Validation Basis</h4>
                </div>
                <p className="text-[10px] text-text-muted leading-relaxed">
                  Frame counts are based on the storage inventory. Missing frames is Expected minus
                  GPS-linked, not Expected minus Found: an unlinked image in the bucket counts as
                  Found while filling no gap. Duplicate, Invalid filename and Metadata mismatch are
                  anomalies found within the images that were found, and are not part of that
                  arithmetic. Metadata checks are only available for runs imported after migration
                  0034.
                </p>
              </div>
              <div className="flex justify-end pt-0.5">
                <button
                  onClick={() => toast.info('Integrity model verifies physical inventory against POI coordinates')}
                  className="px-2 py-0.5 text-[10px] rounded border border-subtle bg-inner hover:bg-inner/80 text-text-muted hover:text-text-base font-medium transition-colors cursor-pointer"
                >
                  Details &gt;
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Notice Banner */}
          <div className="rounded-xl border border-subtle/60 bg-inner/20 px-3 py-2 flex items-start gap-2 text-[10px] text-text-muted">
            <Info size={13} className="text-text-muted shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              This validation does not modify or delete any files. It only checks and reports discrepancies between MMS metadata and the actual files in storage.
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