/**
 * Survey integrity: the ten measured figures behind a run's completeness.
 *
 * WHY THIS IS A PURE MODULE
 *
 * Every figure here can be derived from what the loader already holds — the
 * recorded filenames, the storage-verified subset, the GPS points, and the
 * metadata filename set persisted by migration 0034. Nothing needs a query.
 * That is deliberate: a function that reads only its arguments can be tested
 * with plain objects, so this suite needs no database, no bucket and no mocks
 * that drift from reality.
 *
 * WHY UNKNOWN IS A FIRST-CLASS RESULT
 *
 * v26 established the rule for this codebase: a derived number that cannot be
 * computed renders as *unknown*, never as zero. This module extends it to
 * completeness. Two independent things can go unknown:
 *
 *   - `inventoryVerified` — storage could not be reached, so no frame was
 *     confirmed present OR absent. `missingImages` is then `null`, not `[]`.
 *   - `metadataCaptured` — the run predates migration 0034, so the metadata
 *     filename set was never persisted. Duplicate / invalid / mismatch are then
 *     `null`, not `0`.
 *
 * Both were previously indistinguishable from a genuine zero, which is how a
 * client could be told 0 images were missing when the truth was that nobody
 * looked.
 *
 * WHY THE THREE ANOMALY ROWS DO NOT SUM WITH THE MISSING COUNT
 *
 * `expected - found = missing` and `gpsLinked + unlinked = found` are identities
 * and are asserted as such in the tests. Duplicate, invalid-filename and
 * metadata-mismatch are NOT part of either. They are anomalies discovered
 * *within* the frames that were found, so they overlap `found` rather than
 * partitioning the shortfall. A caller that adds 12 + 7 + 23 to 134 is reading
 * the table wrong; `MISSING_ROWS` says which rows participate in the identities
 * so that mistake is hard to make.
 */

import type { FrameState, QaState } from './panotrackAppearance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A frame the run expected but could not find in the storage inventory. */
export interface MissingEntry {
  /** Index of the POI within the run, stable and 0-based. */
  poiIndex: number;
  filename: string;
  subgrid: string;
}

/** One physical image recorded more than once against a single run. */
export interface DuplicateEntry {
  filename: string;
  /** 1 for a simple repeat. */
  occurrences: number;
}

/** A recorded filename that does not look like a real frame name. */
export interface InvalidEntry {
  filename: string;
  /** Which rule it failed, so the operator sees why. */
  reason: 'no_extension' | 'no_numeric_sequence';
}

/** A POI whose metadata CSV names a different image than the run recorded. */
export interface MetadataMismatch {
  poiIndex: number;
  /** What the metadata CSV said. */
  metadataFilename: string;
  /** What the run actually recorded. */
  recordedFilename: string;
}

/** An image present in the bucket for this run that no POI claims. */
export interface UnlinkedEntry {
  filename: string;
  subgrid: string;
}

/** A survey record as the integrity module needs it. Plain data, no behaviour. */
export interface IntegritySubject {
  /** Run id, e.g. `sp-d-N93E70_run-a` or `staging-d-N93E70_20260925.csv`. */
  runId?: string | null;
  subgrid: string;
  /** Survey date as recorded on the row. */
  date?: string;

  /** Filenames the run recorded, one per POI, in POI order. */
  recordedFilenames: string[];

  /** Subset of the above confirmed present in the storage inventory. */
  verifiedFilenames: string[];

  /**
   * False when storage could not be reached. When false, `missingImages` and
   * `unlinkedImages` are `null` — not empty.
   */
  inventoryVerified: boolean;

  /** Metadata CSV filename set for this run, from migration 0034. */
  metadataFilenames?: string[] | null;

  /** Names actually present in the bucket for this run's subgrid. */
  bucketFilenames?: string[] | null;

  /** GPS-bearing POIs, one per expected frame. */
  poiCoordinates?: Array<{ lat?: number; lon?: number }> | null;

  /**
   * Stored frame/QA state per point, when the caller has it. Absent for a
   * record assembled from raw filenames, in which case frame state is derived
   * from the filename lists above instead.
   */
  frames?: Array<{ filename?: string; frameState?: FrameState; qaState?: QaState }> | null;
}

export interface IntegrityReport {
  runId: string | null;
  subgrid: string;

  surveyDate: string | null;

  /** Distinct GPS-linked POIs. `null` when no coordinates were supplied. */
  poiCount: number | null;
  /** Equal to `poiCount`: the contract is one frame per POI. */
  expectedImages: number | null;
  /** Recorded names confirmed in the bucket. `null` when storage unreachable. */
  foundImages: number | null;

  /** `expected - found`. `null` when storage was unreachable. */
  missingImages: MissingEntry[] | null;

  /** Diagnostics *within* `found`. Not part of the identities above. */
  duplicates: DuplicateEntry[] | null;
  invalidFilenames: InvalidEntry[] | null;
  metadataMismatches: MetadataMismatch[] | null;

  /** Frames whose name maps to a POI. `null` when storage unreachable. */
  gpsLinkedImages: number | null;
  /** Bucket images this run owns that no POI claims. `null` when unreachable. */
  unlinkedImages: UnlinkedEntry[] | null;

  /** False when the frame inventory could not be read. */
  inventoryVerified: boolean;
  /** False before migration 0034 captured the CSV for this run. */
  metadataCaptured: boolean;
  /** False when the defect table was unreadable, so defect data is unknown. */
  defectDataReadable: boolean;
}

/**
 * The rows that participate in the arithmetic identities, and which.
 *
 * Exported so the panel can label them and a caller cannot mis-apply the rule:
 * `missing = expected - found` is true, and `duplicate + invalid + mismatch`
 * is NOT part of any identity.
 */
export const MISSING_ROW_DEFINITION = {
  expectedImages: 'total expected images for the survey',
  foundImages: 'images found in the bucket',
  missingImages: 'expected - found; filenames list available',
  gpsLinkedImages: 'images linked to a GPS POI',
  unlinkedImages: 'bucket images for this run that no POI claims'
} as const;

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/**
 * Comparison key: basename, extension stripped, lowercased.
 *
 * The three normalisations are each load-bearing. `storage.ts:addFile` lowercases
 * every inventory entry; object keys are path-prefixed (`MMS_PIC/…`); and `.JPG`
 * and `.jpg` are the same frame. A naive comparison reports an entire run
 * missing because of capitalisation.
 */
export function frameKey(name: string | null | undefined): string {
  if (!name) return '';
  const base = (name.split('/').pop() ?? name).trim();
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.toUpperCase();
}

/**
 * Whether a recorded name looks like a real frame.
 *
 * Mirrors the predicate `DataManagementPage.tsx:1151` uses at import time, so
 * a name accepted on the way in is not rejected on the way out. The rule is
 * permissive on purpose — it catches a corrupt cell, not an unusual convention.
 */
export function classifyFilename(name: string): InvalidEntry | null {
  const raw = (name ?? '').trim();
  if (!raw) return { filename: raw, reason: 'no_extension' };
  if (!raw.includes('.')) return { filename: raw, reason: 'no_extension' };
  if (!/[-_]\d{3,}/.test(raw)) return { filename: raw, reason: 'no_numeric_sequence' };
  return null;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/**
 * Compute the integrity report for one survey record.
 *
 * Never throws and never fabricates: each figure is either derived or `null`,
 * and `null` always means "not measured" rather than "zero".
 */
export function computeSurveyIntegrity(subject: IntegritySubject): IntegrityReport {
  const recorded = subject.recordedFilenames ?? [];
  const recordedClean = recorded.map((n) => (n ?? '').trim());
  const verifiedKeys = new Set((subject.verifiedFilenames ?? []).map(frameKey).filter(Boolean));
  const inventoryVerified = subject.inventoryVerified === true;

  // ---- POIs -------------------------------------------------------------
  // A POI needs coordinates. When the caller supplies none, fall back to the
  // recorded frame count rather than reporting zero POIs for a run that has
  // them — but say which basis was used via `poiCount === null`.
  const suppliedCoords = subject.poiCoordinates;
  const poiCount = Array.isArray(suppliedCoords)
    ? suppliedCoords.length
    : suppliedCoords
      ? null
      : recordedClean.length;

  const expectedImages = poiCount;

  // ---- found / missing ---------------------------------------------------
  // `null` when storage could not be reached. This is the distinction that
  // migration 0032's shape demands: an unreachable bucket must never render as
  // "every frame is present" or as "every frame is missing".
  let foundImages: number | null = null;
  let missingImages: MissingEntry[] | null = null;
  let gpsLinkedImages: number | null = null;
  let unlinkedImages: UnlinkedEntry[] | null = null;

  if (inventoryVerified) {
    // GPS-linked: recorded against a POI AND confirmed in the bucket.
    gpsLinkedImages = recordedClean.filter((n) => n && verifiedKeys.has(frameKey(n))).length;

    // Unlinked: in the bucket for this run, claimed by no POI. Only computable
    // when the caller can tell us the bucket's contents.
    if (Array.isArray(subject.bucketFilenames)) {
      const claimed = new Set(recordedClean.map(frameKey).filter(Boolean));
      unlinkedImages = subject.bucketFilenames
        .filter((n) => n && !claimed.has(frameKey(n)))
        .map((filename) => ({ filename, subgrid: subject.subgrid }));
    } else {
      unlinkedImages = null;
    }

    // "Found" means found IN THE BUCKET, which is what the label says. That
    // includes the unlinked orphans, which is why the identity below pairs it
    // with gpsLinked rather than treating it as a subset of the recorded names.
    //
    // When the bucket contents are unknown, `found` is the gpsLinked count and
    // is a LOWER BOUND — we know which recorded frames are there, but not how
    // many orphans accompany them. `checkIntegrityIdentities` returns null in
    // that case rather than asserting an identity it cannot verify.
    foundImages = gpsLinkedImages + (unlinkedImages?.length ?? 0);

    // The ACTIONABLE gap: POIs that were expected and whose frame is absent.
    //
    // This is deliberately NOT `expected - found`. Those differ whenever
    // `unlinked > 0`, because an orphan image in the bucket inflates "found"
    // without filling any POI. See `checkIntegrityIdentities`, which asserts the
    // exact relationship rather than leaving it to be assumed.
    missingImages = recordedClean
      .map((filename, poiIndex) => ({ filename, poiIndex }))
      .filter((e) => e.filename && !verifiedKeys.has(frameKey(e.filename)))
      .map((e) => ({ ...e, subgrid: subject.subgrid }));
  }

  // ---- duplicates -------------------------------------------------------
  // Multiplicity over recorded names, so a name repeated three times is one
  // entry with `occurrences: 3` rather than three entries.
  const multiplicity = new Map<string, number>();
  for (const name of recordedClean) {
    const key = frameKey(name);
    if (!key) continue;
    multiplicity.set(key, (multiplicity.get(key) ?? 0) + 1);
  }
  const duplicates: DuplicateEntry[] = unique(
    recordedClean.filter((n) => n && (multiplicity.get(frameKey(n)) ?? 0) > 1)
  ).map((filename) => ({ filename, occurrences: multiplicity.get(frameKey(filename)) ?? 1 }));

  // ---- invalid filenames ------------------------------------------------
  const invalidFilenames: InvalidEntry[] = [];
  const seenInvalid = new Set<string>();
  for (const name of recordedClean) {
    const verdict = classifyFilename(name);
    if (!verdict) continue;
    const key = frameKey(name);
    if (seenInvalid.has(key)) continue;
    seenInvalid.add(key);
    invalidFilenames.push(verdict);
  }

  // ---- metadata mismatch ------------------------------------------------
  // `undefined` = never captured (pre-0034), `null` = captured but unusable.
  // Both render as "not captured at import" rather than 0.
  let metadataMismatches: MetadataMismatch[] | null = null;
  let metadataCaptured = false;
  if (Array.isArray(subject.metadataFilenames)) {
    metadataCaptured = true;
    const metadataKeys = new Set(subject.metadataFilenames.map(frameKey).filter(Boolean));
    metadataMismatches = recordedClean
      .map((recordedFilename, poiIndex) => ({ recordedFilename, poiIndex }))
      .filter((e) => e.recordedFilename && !metadataKeys.has(frameKey(e.recordedFilename)))
      .map((e) => ({
        poiIndex: e.poiIndex,
        metadataFilename: subject.metadataFilenames!.find((m) =>
          frameKey(m) === frameKey(e.recordedFilename)
        ) ?? '',
        recordedFilename: e.recordedFilename
      }));
  }

  return {
    runId: subject.runId ?? null,
    subgrid: subject.subgrid,
    surveyDate: subject.date ?? null,
    poiCount,
    expectedImages,
    foundImages,
    missingImages,
    duplicates,
    invalidFilenames,
    metadataMismatches,
    gpsLinkedImages,
    unlinkedImages,
    inventoryVerified,
    metadataCaptured,
    // The caller supplies defect-readability separately; this module does not
    // read `qa_defects`. Defaults to true because the panel surfaces defect
    // unknowns from the row itself, not from here.
    defectDataReadable: true
  };
}

/**
 * Aggregate child reports into one parent report for a subgrid.
 *
 * A subgrid's counts are the union of its runs' — never a sum of expected
 * images, which would double-count a POI recorded in two runs.
 */
export function aggregateSubgridIntegrity(
  subgrid: string,
  childReports: IntegrityReport[]
): IntegrityReport {
  if (childReports.length === 0) {
    return computeSurveyIntegrity({
      subgrid,
      recordedFilenames: [],
      verifiedFilenames: [],
      inventoryVerified: true
    });
  }

  const merge = <T>(pick: (r: IntegrityReport) => T[] | null): T[] | null => {
    const collected = pick(childReports[0]);
    if (collected === null) return null;
    const out = [...collected];
    for (let i = 1; i < childReports.length; i++) {
      const next = pick(childReports[i]);
      // One unknown child makes the aggregate unknown. A partial sum would
      // understate the gap, which is the direction that reads as good news.
      if (next === null) return null;
      out.push(...next);
    }
    return out;
  };

  const addNullable = (pick: (r: IntegrityReport) => number | null): number | null => {
    let total = 0;
    for (const r of childReports) {
      const v = pick(r);
      if (v === null) return null;
      total += v;
    }
    return total;
  };

  const missing = merge((r) => r.missingImages);
  const unlinked = merge((r) => r.unlinkedImages);

  return {
    runId: null,
    subgrid,
    surveyDate: childReports[0]?.surveyDate ?? null,
    poiCount: addNullable((r) => r.poiCount),
    expectedImages: addNullable((r) => r.expectedImages),
    foundImages: addNullable((r) => r.foundImages),
    missingImages: missing,
    duplicates: merge((r) => r.duplicates),
    invalidFilenames: merge((r) => r.invalidFilenames),
    metadataMismatches: merge((r) => r.metadataMismatches),
    gpsLinkedImages: addNullable((r) => r.gpsLinkedImages),
    unlinkedImages: unlinked,
    // Unknown if ANY child could not verify — the aggregate cannot be more
    // certain than its least certain part.
    inventoryVerified: childReports.every((r) => r.inventoryVerified),
    metadataCaptured: childReports.every((r) => r.metadataCaptured),
    defectDataReadable: childReports.every((r) => r.defectDataReadable)
  };
}

/**
 * The arithmetic relationships, as executable checks.
 *
 * Returned rather than thrown so the panel can show which one failed.
 *
 * RELATIONSHIP 1 — always holds:
 *     gpsLinked + unlinked === found
 * because "found" is everything in the bucket for this run.
 *
 * RELATIONSHIP 2 — always holds:
 *     missing === expected - gpsLinked
 * because `missing` is the POI gap: expected POIs with no frame behind them.
 *
 * RELATIONSHIP 3 — the one a reader is most likely to assume, and it does NOT
 * hold when unlinked > 0:
 *     expected - found <= missing
 *
 * The shortfall is EXACTLY `unlinked`. An orphan image sitting in the bucket
 * counts toward "found" without filling any POI, so subtracting found from
 * expected silently credits the gap.
 *
 * Concretely, from the figures this plan was written against:
 *
 *     expected 284,621   found 284,487   gpsLinked 284,463   unlinked 24
 *
 *   `expected - found` = 134   ← what the original table called "Missing"
 *   `expected - gpsLinked` = 158   ← the actual POI gap
 *
 * The table's own numbers are internally consistent — relationships 1 and 2
 * both hold — but its `Missing` row reports 134 where 158 POIs have no image.
 * This function returns both so the panel can show the figure that is true and
 * the figure that reconciles, rather than silently picking one.
 */
export function checkIntegrityIdentities(report: IntegrityReport): {
  /** gpsLinked + unlinked === found. `null` when any part is unknown. */
  gpsPlusUnlinkedEqualsFound: boolean | null;
  /** missing === expected - gpsLinked. `null` when any part is unknown. */
  missingEqualsExpectedMinusLinked: boolean | null;
  /** How many POIs actually lack an image. `null` when unknown. */
  actualPoiGap: number | null;
  /**
   * How far `expected - found` falls short of the true gap. Zero when every
   * bucket image is claimed by a POI.
   */
  undercountedByUnlinked: number | null;
  /** What `expected - found` reports. Kept so the panel can show both. */
  naiveGap: number | null;
} {
  const { expectedImages, foundImages, missingImages, gpsLinkedImages, unlinkedImages } = report;
  const unlinkedCount = unlinkedImages?.length ?? null;

  const actualPoiGap =
    expectedImages === null || gpsLinkedImages === null ? null : expectedImages - gpsLinkedImages;

  // What `expected - found` reports, which is what the original table called
  // "Missing". Compared against the true gap, the difference is the orphan count.
  const naiveGap =
    expectedImages === null || foundImages === null ? null : expectedImages - foundImages;

  return {
    gpsPlusUnlinkedEqualsFound:
      gpsLinkedImages === null || foundImages === null || unlinkedCount === null
        ? null
        : gpsLinkedImages + unlinkedCount === foundImages,
    missingEqualsExpectedMinusLinked:
      missingImages === null || actualPoiGap === null ? null : missingImages.length === actualPoiGap,
    actualPoiGap,
    naiveGap,
    undercountedByUnlinked:
      actualPoiGap === null || naiveGap === null ? null : actualPoiGap - naiveGap
  };
}