/**
 * Assembling survey-integrity subjects from data-management rows.
 *
 * WHY THIS IS A MODULE AND NOT PART OF THE PAGE
 *
 * The integrity panel is only trustworthy if every field it is handed means what
 * the model thinks it means, and three of those fields used to be hardcoded:
 *
 *   - `metadataFilenames: null` made "Metadata mismatch" read "not captured at
 *     import" for every run, including the ones migration 0034 did capture.
 *   - `bucketFilenames: null` made "Unlinked images" permanently unknown, which
 *     also disabled the orphan reconciliation note.
 *   - no `poiCoordinates` made "Total survey POI" a second spelling of the
 *     filename count while claiming to be a count of coordinate locations.
 *
 * Those decisions are easy to get wrong and impossible to see from the call
 * site, so they live here with the reasoning attached, and the storage and
 * database access arrives as injected functions. That keeps this file free of
 * service imports and makes it testable with plain objects.
 *
 * THE RULE THIS ENCODES
 *
 * Never pass a value that was not measured. `null` means "nobody looked" and
 * renders as unknown; `[]` means "looked, found nothing" and renders as zero.
 * Collapsing the two is how a storage outage becomes a clean bill of health.
 */

import type { BatchLog, DailyTimeSeries } from '../types/dashboard';
import { listSubgridFilenamesFromInventory, type FileInventoryResult } from '../services/api/storage';
import { extractSubgridName } from './subgrid';
import type { IntegritySubject } from './surveyIntegrity';

/** What a storage verification resolved to, including whether it ran at all. */
export interface StorageVerification {
  availableCount: number;
  verifiedFilenames: string[];
  /** False when storage could not be reached, as opposed to holding nothing. */
  verified: boolean;
  fileSet: Set<string>;
}

/** The two I/O dependencies, injected so this module stays pure. */
export interface IntegritySources {
  verify(filenames: string[], settings: unknown): Promise<StorageVerification>;
  /** Resolves `null` — never `[]` — when the metadata set was not captured. */
  metadata(subgrid: string, runId: string | null): Promise<string[] | null>;
  settings?: unknown;
}

/**
 * Wrap the raw service functions so a failed read reads as "not captured".
 *
 * `fetchSurveyMetadataFilenames` already returns `null` for an unreadable table,
 * but a rejection (offline, RLS error, PostgREST cache miss after the migration)
 * must land on the same answer. Anything else would make a transport failure
 * look different from a run that was never captured, which is the distinction
 * the panel exists to preserve.
 */
export function createIntegritySources(
  verify: IntegritySources['verify'],
  metadata: IntegritySources['metadata'],
  settings?: unknown
): IntegritySources {
  return {
    settings,
    verify,
    metadata: async (subgrid, runId) => {
      try {
        return await metadata(subgrid, runId);
      } catch {
        // An unreadable table is "not captured", which is what it is.
        return null;
      }
    }
  };
}

/**
 * Reshape a verification result into the inventory shape the subgrid-attribution
 * helper reads.
 *
 * `countsBySubgrid` is left empty on purpose: nothing here consumes it, and
 * inventing counts from one run's filenames would be wrong.
 */
export function toInventoryResult(res: {
  verified: boolean;
  fileSet: Set<string>;
}): FileInventoryResult {
  return {
    fromInventory: false,
    fileSet: res.fileSet,
    countsBySubgrid: new Map(),
    totalFiles: res.fileSet.size,
    listingOk: res.verified
  };
}

/** The subgrid code a row belongs to, normalised the way the model expects. */
export function resolveSubgrid(row: { subgrid?: string; imageFilename?: string }): string {
  return (
    extractSubgridName(row.subgrid || row.imageFilename) || row.subgrid || ''
  )
    .toUpperCase()
    .trim();
}

/** The subgrid's own bucket files, or `null` when they cannot be attributed. */
export function toSubgridNames(
  res: { verified: boolean; fileSet: Set<string> },
  subgrid: string
): string[] | null {
  return listSubgridFilenamesFromInventory(toInventoryResult(res), subgrid);
}

/**
 * Verify one freshly imported run's filenames against storage.
 *
 * Returns the count, the matched names, and — the part that was missing entirely —
 * whether the inventory was READ at all. A caller that keeps only the count
 * cannot tell a completed run with no frames uploaded from an outage, and will
 * publish the outage as a zero.
 *
 * `bucketFilenames` is `null` rather than `[]` when the inventory could not be
 * split by subgrid, so a caller cannot mistake "cannot tell" for "no orphans".
 */
export async function verifyImportedRun(
  filenames: string[],
  subgrid: string,
  sources: IntegritySources
): Promise<{
  verifiedCount: number;
  verifiedFilenames: string[];
  storageVerified: boolean;
  bucketFilenames: string[] | null;
}> {
  if (filenames.length === 0) {
    return {
      verifiedCount: 0,
      verifiedFilenames: [],
      storageVerified: false,
      bucketFilenames: null
    };
  }
  try {
    const res = await sources.verify(filenames, sources.settings);
    return {
      verifiedCount: res.availableCount,
      verifiedFilenames: res.verifiedFilenames,
      storageVerified: res.verified,
      bucketFilenames: res.verified ? toSubgridNames(res, subgrid) : null
    };
  } catch {
    // A thrown verification is an outage, not an empty bucket.
    return {
      verifiedCount: 0,
      verifiedFilenames: [],
      storageVerified: false,
      bucketFilenames: null
    };
  }
}

/**
 * Flag each panorama with whether its image was confirmed present.
 *
 * An UNVERIFIED inventory leaves every frame marked available, because the
 * alternative is asserting that every image is missing when nobody managed to
 * look. That is the same outage-as-verdict mistake one level up.
 */
export function markPanoramaAvailability<T extends { filename?: string }>(
  panoramas: T[],
  verifiedFilenames: string[],
  storageVerified: boolean
): Array<T & { isAvailable: boolean }> {
  if (!storageVerified) return panoramas.map((p) => ({ ...p, isAvailable: true }));
  const verified = new Set(verifiedFilenames.map((f) => f.toLowerCase().trim()));
  return panoramas.map((p) => ({
    ...p,
    isAvailable: p.filename ? verified.has(p.filename.toLowerCase().trim()) : false
  }));
}

/**
 * Build one subject from a run row, reading the parts that need a query.
 *
 * Coordinates come straight from the panoramas. A panorama without a position
 * contributes nothing, which is the point: the model counts distinct located
 * POIs, so a run whose rows lack coordinates reports an unknown POI figure
 * rather than borrowing the filename count.
 */
export async function buildIntegritySubject(
  row: DailyTimeSeries,
  fallbackSubgrid: string,
  sources: IntegritySources,
  siblingFilenames: string[] | null = []
): Promise<IntegritySubject> {
  const panoramas = row.panoramas ?? [];
  const subgrid = resolveSubgrid(row) || fallbackSubgrid.toUpperCase().trim();
  return {
    runId: row.id ?? null,
    subgrid,
    date: row.date,
    recordedFilenames: panoramas.map((p) => p.filename).filter((fn): fn is string => Boolean(fn)),
    verifiedFilenames: row.availableFilenames ?? [],
    inventoryVerified: row.imagesStorageVerified === true,
    metadataFilenames: (await sources.metadata(subgrid, row.id ?? null)) ?? null,
    bucketFilenames: row.bucketFilenames ?? null,
    siblingFilenames,
    poiCoordinates: panoramas.map((p) => ({ lat: p.latitude, lon: p.longitude }))
  };
}

/**
 * The recorded filenames of every OTHER run in the same subgrid.
 *
 * `bucketFilenames` is subgrid-scoped, so without this the model cannot tell a
 * peer's image from a stray file and reports the peer's whole library as
 * orphans of whichever run you happen to be looking at.
 *
 * SELF-EXCLUSION IS LOAD-BEARING. If a run's own filenames were passed as its
 * siblings, every one of its names would be "claimed elsewhere" and its orphans
 * would collapse to zero — including the run that genuinely has stray files.
 *
 * Identity is compared by `id` when both rows have one, else by reference, so a
 * caller passing a row it also included in `allRows` cannot accidentally treat
 * that row as its own peer.
 */
export function siblingFilenamesFor(
  allRows: DailyTimeSeries[],
  target: DailyTimeSeries
): string[] {
  const subgrid = resolveSubgrid(target);
  const targetId = target.id ?? null;
  return allRows
    .filter((r) => {
      if (resolveSubgrid(r) !== subgrid) return false;
      if (targetId && r.id) return r.id !== targetId;
      return r !== target;
    })
    .flatMap((r) => (r.panoramas ?? []).map((p) => p.filename).filter((fn): fn is string => Boolean(fn)));
}

/** Build one subject for a run row, resolving its peers from the loaded rows. */
export async function buildDailySubject(
  row: DailyTimeSeries,
  allRows: DailyTimeSeries[],
  sources: IntegritySources
): Promise<IntegritySubject> {
  return buildIntegritySubject(row, row.subgrid ?? '', sources, siblingFilenamesFor(allRows, row));
}

/**
 * One subject per run of a subgrid.
 *
 * A subgrid aggregates its runs, and aggregating stays inside `surveyIntegrity.ts`
 * rather than being summed here so the model's identities hold across the union.
 * Falls back to the batch row itself when no daily run matches, which is what a
 * published row with no staged children looks like.
 *
 * Each child receives the others as siblings. Inside an aggregate the peers are
 * redundant — the union claims them all — but each child is also a report in its
 * own right, and without peers each would report its siblings' images as orphans.
 */
export async function collectSubgridSubjects(
  allRows: DailyTimeSeries[],
  batchRow: BatchLog,
  sources: IntegritySources
): Promise<IntegritySubject[]> {
  const subgrid = resolveSubgrid(batchRow);
  const children = allRows.filter((d) => resolveSubgrid(d) === subgrid);
  const sourcesForRuns: DailyTimeSeries[] =
    children.length > 0 ? children : [batchRow as unknown as DailyTimeSeries];
  return Promise.all(
    sourcesForRuns.map((child) =>
      buildIntegritySubject(
        child,
        subgrid,
        sources,
        children.length > 0 ? siblingFilenamesFor(allRows, child) : []
      )
    )
  );
}

/**
 * Re-read storage and the metadata set for subjects already on screen.
 *
 * This is what makes the panel's "Run validation" a measurement rather than a
 * timestamp. Two things are deliberately refreshed: the verified filenames, and
 * the bucket contents. Carrying the previous orphan list forward would mean
 * re-reading storage while still reporting what it said last time.
 */
export async function revalidateSubjects(
  subjects: IntegritySubject[],
  sources: IntegritySources
): Promise<IntegritySubject[]> {
  return Promise.all(
    subjects.map(async (subject) => {
      if (subject.recordedFilenames.length === 0) {
        // Nothing to check is not a measurement. Report it unverified rather
        // than letting the caller read the empty result as "all present".
        return {
          ...subject,
          verifiedFilenames: [],
          inventoryVerified: false,
          bucketFilenames: null,
          metadataFilenames: (await sources.metadata(subject.subgrid, subject.runId ?? null)) ?? null
        };
      }

      const res = await sources.verify(subject.recordedFilenames, sources.settings);
      return {
        ...subject,
        verifiedFilenames: res.verifiedFilenames,
        inventoryVerified: res.verified,
        bucketFilenames: listSubgridFilenamesFromInventory(
          toInventoryResult(res),
          subject.subgrid
        ),
        metadataFilenames: (await sources.metadata(subject.subgrid, subject.runId ?? null)) ?? null
      };
    })
  );
}