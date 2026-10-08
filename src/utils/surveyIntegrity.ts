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
 * Two identities hold, and they are asserted as such in the tests:
 *
 *     missing === expected - gpsLinked
 *     gpsLinked + unlinked === found
 *
 * Note the first is NOT `expected - found`. `missing` is the POI gap: expected
 * frames whose POI has no image behind it. An orphan image in the bucket counts
 * toward `found` without filling any POI, so subtracting found from expected
 * silently credits the gap by exactly the orphan count. See
 * `checkIntegrityIdentities` and RELATIONSHIP 3 for the worked example.
 *
 * Duplicate, invalid-filename and metadata-mismatch are NOT part of either
 * identity. They are anomalies discovered *within* the frames that were found,
 * so they overlap `found` rather than partitioning the shortfall. A caller that
 * adds 12 + 7 + 23 to 134 is reading the table wrong; `MISSING_ROW_DEFINITION`
 * says which rows participate in the identities so that mistake is hard to make.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A frame the run expected but could not find in the storage inventory. */
export interface MissingEntry {
  /** Index of the POI within the run, stable and 0-based. */
  poiIndex: number;
  filename: string;
  subgrid: string;
  /** Which run contributed this entry, so an aggregate stays traceable. */
  runId?: string | null;
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

  /**
   * Names actually present in the bucket for this run's subgrid.
   *
   * `null` means "nobody could attribute bucket files to this subgrid" and is
   * materially different from `[]` ("the subgrid folder was read and holds
   * nothing nobody claims"). Supplying `[]` without having read the bucket would
   * manufacture a clean "0 orphans" reading.
   */
  bucketFilenames?: string[] | null;

  /**
   * Recorded filenames of every OTHER run in the same subgrid.
   *
   * `bucketFilenames` is subgrid-scoped but an orphan belongs to a RUN, so
   * without this the two scopes are silently mixed: a subgrid with two runs,
   * one holding 92 frames the other lacks, reports those 92 as orphans of the
   * run that has none. That run then reads "92 available" while its own figures
   * say zero, and its real gap is overstated by the sibling's file count.
   *
   * `null` means the sibling set is UNKNOWN, which makes `unlinkedImages`
   * unknown rather than a confident number — we genuinely cannot tell a peer's
   * image from a stray. `[]` means this is the subgrid's only run.
   */
  siblingFilenames?: string[] | null;

  /**
   * POI coordinates, one entry per expected frame.
   *
   * `undefined`/`null` means the caller holds no coordinates, which makes
   * `poiCount` unknown rather than zero. Entries with a missing or non-finite
   * lat/lon do not constitute a POI and are not counted.
   */
  poiCoordinates?: Array<{ lat?: number; lon?: number }> | null;
}

export interface IntegrityReport {
  runId: string | null;
  subgrid: string;

  surveyDate: string | null;

  /**
   * Distinct POIs that carry real coordinates. `null` when the caller supplied
   * none — unknown, not zero.
   *
   * Independent of `expectedImages`: a run can record a frame for a POI that
   * never received coordinates. The panel surfaces that disagreement rather
   * than reporting one figure under both names.
   */
  poiCount: number | null;
  /**
   * Expected images: one frame per recorded POI, so equal to the length of the
   * recorded filename list. Knowable without the bucket, so never `null`.
   */
  expectedImages: number;
  /** Recorded names confirmed in the bucket. `null` when storage unreachable. */
  foundImages: number | null;

  /** `expected - gpsLinked`. `null` when storage was unreachable. */
  missingImages: MissingEntry[] | null;

  /**
   * Distinct filenames the run recorded more than once. `null` when the
   * metadata rows are unknowable, which for these two is only when the run
   * recorded no filenames at all.
   */
  duplicates: DuplicateEntry[] | null;
  /**
   * Total extra occurrences behind `duplicates` — the number of POIs claimed by
   * an already-claimed image. Always >= `duplicates.length`.
   */
  duplicateOccurrences: number | null;
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
 * `missing = expected - GPS-linked` is true, `duplicate + invalid + mismatch`
 * is NOT part of any identity, and `found` is GPS-linked PLUS unlinked.
 */
export const MISSING_ROW_DEFINITION = {
  expectedImages: 'total expected images for the survey',
  foundImages: 'images found in the bucket: GPS-linked plus unlinked',
  missingImages: 'expected - GPS-linked; filenames list available',
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
 *
 * A leading-dot name (`.gitignore`, `.jpg` with no stem) yields `''` rather than
 * treating the extension as the stem, so it matches nothing instead of
 * accidentally matching a real frame called `JPG`.
 */
export function frameKey(name: string | null | undefined): string {
  if (!name) return '';
  const base = (name.split('/').pop() ?? name).trim();
  if (!base || base.startsWith('.')) return '';
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

/** Coordinates are compared at ~0.1 m, below which two rows are the same stop. */
const POI_COORD_PRECISION = 5;

/**
 * Count distinct POIs that actually carry coordinates.
 *
 * A POI needs both a finite lat and a finite lon. Duplicates are collapsed,
 * because the same stop captured twice is one location, not two. Returns `null`
 * when the caller supplied nothing at all, so the figure reads as unknown
 * rather than as a measured zero.
 */
function countDistinctPois(
  coords: Array<{ lat?: number; lon?: number }> | null | undefined
): number | null {
  if (!Array.isArray(coords)) return null;
  const seen = new Set<string>();
  for (const c of coords) {
    const lat = c?.lat;
    const lon = c?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    seen.add(`${lat.toFixed(POI_COORD_PRECISION)},${lon.toFixed(POI_COORD_PRECISION)}`);
  }
  return seen.size;
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

  // ---- POIs and expected frames -----------------------------------------
  // Two independent figures, deliberately not the same number:
  //
  //   `poiCount`       distinct coordinate-bearing POIs. Null when the caller
  //                    holds no coordinates, which is unknown rather than zero.
  //   `expectedImages` one frame per recorded POI. The recorded filename list IS
  //                    the POI list, so this is knowable without coordinates and
  //                    without the bucket.
  //
  // Aliasing the second to the first (as this module used to) made
  // `missing === expected - gpsLinked` a tautology and let the panel caption a
  // filename count as "survey coordinate locations". Where they disagree the run
  // has frames whose POIs lack coordinates, which is itself an integrity signal.
  const poiCount = countDistinctPois(subject.poiCoordinates);
  const expectedImages = recordedClean.length;

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

    // Unlinked: an image in the subgrid's bucket that NO run claims.
    //
    // Scoped by peer, not just by this run. `bucketFilenames` is subgrid-scoped,
    // so a two-run subgrid would otherwise hand every run its siblings' images
    // as orphans: the run that owns none of them reports the other run's whole
    // library as "unlinked", inflating `found` above its real frame count.
    //
    // So an orphan is a bucket file claimed by neither THIS run nor any SIBLING.
    // Both lists are required: with the peers unknown, a file that looks
    // unclaimed might simply belong to a run we were not told about, so the
    // honest answer is unknown rather than a number.
    //
    // Deduped by `frameKey` because a caller may hand us both the path-prefixed
    // bucket key and the bare basename for one physical file.
    if (Array.isArray(subject.bucketFilenames) && Array.isArray(subject.siblingFilenames)) {
      const claimed = new Set(recordedClean.map(frameKey).filter(Boolean));
      const claimedElsewhere = new Set(
        (subject.siblingFilenames ?? []).map(frameKey).filter(Boolean)
      );
      const seenOrphans = new Set<string>();
      unlinkedImages = [];
      for (const name of subject.bucketFilenames) {
        if (!name) continue;
        const key = frameKey(name);
        if (!key || claimed.has(key) || claimedElsewhere.has(key) || seenOrphans.has(key)) continue;
        seenOrphans.add(key);
        unlinkedImages.push({ filename: name, subgrid: subject.subgrid });
      }
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
      .map((e) => ({ ...e, subgrid: subject.subgrid, runId: subject.runId ?? null }));
  }

  // ---- duplicates -------------------------------------------------------
  // Multiplicity over recorded names, so a name repeated three times is one
  // entry with `occurrences: 3` rather than three entries.
  //
  // `duplicates.length` counts DISTINCT repeated filenames; the POIs competing
  // for them is a different number, which is what `duplicateOccurrences` carries.
  // Reporting the former as "occurrences" is how 3 files claimed 5 times gets
  // captioned as "5 duplicate occurrences" with 3 rows on screen.
  const multiplicity = new Map<string, number>();
  for (const name of recordedClean) {
    const key = frameKey(name);
    if (!key) continue;
    multiplicity.set(key, (multiplicity.get(key) ?? 0) + 1);
  }
  const duplicates: DuplicateEntry[] = unique(
    recordedClean.filter((n) => n && (multiplicity.get(frameKey(n)) ?? 0) > 1)
  ).map((filename) => ({ filename, occurrences: multiplicity.get(frameKey(filename)) ?? 1 }));
  const duplicateOccurrences = duplicates.reduce((sum, d) => sum + Math.max(0, d.occurrences - 1), 0);

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
  // `undefined` or `null` = never captured (pre-0034, or the read failed).
  // Both render as "not captured at import" rather than 0.
  //
  // An EMPTY ARRAY is also treated as never captured, which is the change that
  // migration 0035 forces to be explicit. A readable-but-empty table returns
  // `[]`, and treating that as "captured" reported every recorded name as a
  // mismatch — so a run whose metadata was never captured would show 196
  // phantom mismatches instead of "not captured". `saveSurveyMetadataFilenames`
  // returns early on a zero-length set, so a genuine capture always writes at
  // least one row; an empty array can only mean the capture never ran.
  let metadataMismatches: MetadataMismatch[] | null = null;
  let metadataCaptured = false;
  const metaFiles = subject.metadataFilenames;
  if (Array.isArray(metaFiles) && metaFiles.length > 0) {
    metadataCaptured = true;
    const metadataKeys = new Set(metaFiles.map(frameKey).filter(Boolean));
    metadataMismatches = recordedClean
      .map((recordedFilename, poiIndex) => ({ recordedFilename, poiIndex }))
      .filter((e) => e.recordedFilename && !metadataKeys.has(frameKey(e.recordedFilename)))
      .map((e) => ({
        poiIndex: e.poiIndex,
        metadataFilename: metaFiles.find((m) =>
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
    duplicateOccurrences,
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
 * COUNTS ARE ADDED, LISTS ARE CONCATENATED — deliberately, and the pairing is
 * what keeps `missing === expected - gpsLinked` true across an aggregate.
 *
 * The temptation is to union the lists, because a filename appearing in two
 * children "feels" like one frame. That breaks the identity. If runs A and B
 * each record a POI naming the same absent frame X, then `expected` sums to 2
 * and `gpsLinked` to 0, so the gap is 2 — two POIs, each of which lacks an
 * image. Deduplicating X out of `missing` would report 1 and silently disagree
 * with the two rows above it. Both POIs are real and both are missing something.
 *
 * A repeated filename across runs is therefore a *reported* condition (the
 * Duplicate row, plus the run id on each entry), not a silently collapsed one.
 */
export function aggregateSubgridIntegrity(
  subgrid: string,
  childReports: IntegrityReport[]
): IntegrityReport {
  if (childReports.length === 0) {
    // Nothing was measured. Returning a clean all-zero report here would tell
    // the operator a subgrid has zero missing frames because we had zero runs to
    // look at, which is the outage-as-clean-bill-of-health mistake this module
    // exists to prevent.
    return {
      runId: null,
      subgrid,
      surveyDate: null,
      poiCount: null,
      expectedImages: 0,
      foundImages: null,
      missingImages: null,
      duplicates: null,
      duplicateOccurrences: null,
      invalidFilenames: null,
      metadataMismatches: null,
      gpsLinkedImages: null,
      unlinkedImages: null,
      inventoryVerified: false,
      metadataCaptured: false,
      defectDataReadable: false
    };
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

  /**
   * Merge a shared list of bucket FILES across the runs.
   *
   * Same unknown-children rule as `merge`, but deduped by name — deliberately
   * different from `missingImages`, which concatenates.
   *
   * The asymmetry is load-bearing. A stray belongs to the SUBNGRID, so every run
   * that sees it reports it, and concatenating would list one file N times and
   * inflate `found` N times. A missing frame belongs to a specific POI of a
   * specific run, so two runs each missing the same filename are two POIs that
   * each lack an image, and deduping them would break
   * `missing === expected - gpsLinked`. See the module header.
   */
  const mergeFiles = (pick: (r: IntegrityReport) => string[] | null): string[] | null => {
    const collected = pick(childReports[0]);
    if (collected === null) return null;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of collected) {
      const key = frameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    for (let i = 1; i < childReports.length; i++) {
      const next = pick(childReports[i]);
      if (next === null) return null;
      for (const name of next) {
        const key = frameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
      }
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
  // Each child already excluded its own peers, so a filename appearing in two
  // children's orphan lists is ONE stray both saw, not two. Dedupe on name.
  const unlinked = mergeFiles((r) => r.unlinkedImages?.map((u) => u.filename) ?? null);
  const unlinkedEntries = unlinked?.map((filename) => ({ filename, subgrid })) ?? null;

  // `found` is RECOMPUTED from the merged parts rather than summed from the
  // children's own figures. The two denominators differ: `gpsLinked` counts
  // run-POIs, so summing it is right, whereas `unlinked` counts distinct FILES,
  // and summing it would count a stray once per run that saw it. Summing the
  // children's `found` therefore double-counts shared strays and breaks
  // `gpsLinked + unlinked = found`.
  //
  // Unknown orphans contribute 0 rather than poisoning the figure, which is the
  // same LOWER-BOUND treatment the single-run path gives `found`. The identity
  // check returns null in that state rather than asserting something it cannot
  // verify.
  const gpsLinked = addNullable((r) => r.gpsLinkedImages);
  const found = gpsLinked === null ? null : gpsLinked + (unlinked?.length ?? 0);

  return {
    runId: null,
    subgrid,
    surveyDate: childReports[0]?.surveyDate ?? null,
    poiCount: addNullable((r) => r.poiCount),
    expectedImages: addNullable((r) => r.expectedImages) ?? 0,
    foundImages: found,
    missingImages: missing,
    duplicates: merge((r) => r.duplicates),
    duplicateOccurrences: addNullable((r) => r.duplicateOccurrences),
    invalidFilenames: merge((r) => r.invalidFilenames),
    metadataMismatches: merge((r) => r.metadataMismatches),
    gpsLinkedImages: gpsLinked,
    unlinkedImages: unlinkedEntries,
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
  /**
   * Recorded frames whose POI carries no coordinates. `null` when no
   * coordinates were supplied, in which case there is nothing to compare.
   *
   * A healthy run has zero here: one frame per POI, every POI located. Non-zero
   * means the run and the trajectory disagree about how many stops there were,
   * which is worth showing rather than hiding behind one shared number.
   */
  framesWithoutPoi: number | null;
} {
  const {
    expectedImages,
    foundImages,
    missingImages,
    gpsLinkedImages,
    unlinkedImages,
    poiCount
  } = report;
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
      actualPoiGap === null || naiveGap === null ? null : actualPoiGap - naiveGap,
    framesWithoutPoi: poiCount === null ? null : expectedImages - poiCount
  };
}