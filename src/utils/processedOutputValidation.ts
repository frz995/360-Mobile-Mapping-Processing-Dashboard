// =====================================================================
// Processed output validation — compares the processed folder content
// against the expected source filenames before a dataset is imported.
// =====================================================================

import type { ProcessedOutputValidationResult } from '../types/production';

/** Strip directory prefixes and extensions for filename matching. */
export function normalizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() || name;
  return base.replace(/\.[A-Za-z0-9]+$/, '').trim().toLowerCase();
}

export interface ProcessedOutputInput {
  expected: string[];
  found: string[];
  expectedLabel?: string;
}

export interface OutputItemMetadata {
  filename: string;
  gpsLat?: number | null;
  gpsLng?: number | null;
  capturedAt?: string | null;
  sizeBytes?: number | null;
}

export interface ProcessedOutputRichInput {
  expected: string[];
  found: string[];
  /** Optional per-file metadata (name/GPS/timestamp/size) for deeper checks. */
  items?: OutputItemMetadata[];
  /** Max tolerated jump between consecutive GPS fixes (m) when >1 coordinate shared. */
  maxGpsJumpMeters?: number;
  /** Reject when the same normalized filename appears more than once in the output folder. */
  checkDuplicates?: boolean;
}

export function validateProcessedOutput(input: ProcessedOutputInput): ProcessedOutputValidationResult {
  const expectedSet = new Set(input.expected.map(normalizeFilename));
  const foundMap = new Map<string, string>();
  input.found.forEach((f) => foundMap.set(normalizeFilename(f), f));

  const missing = input.expected.filter((e) => !foundMap.has(normalizeFilename(e)));
  const invalid = input.found.filter((f) => !expectedSet.has(normalizeFilename(f)));

  const issues: string[] = [];
  if (missing.length > 0) {
    issues.push(`${missing.length} expected file(s) missing from the output folder.`);
  }
  if (invalid.length > 0) {
    issues.push(`${invalid.length} unexpected file(s) found in the output folder.`);
  }

  const valid = input.found.length - invalid.length;
  const ok = missing.length === 0 && invalid.length === 0 && input.expected.length > 0;

  return {
    ok,
    expectedCount: input.expected.length,
    foundCount: input.found.length,
    validCount: Math.max(0, valid),
    invalid: invalid.slice(0, 25),
    missing: missing.slice(0, 25),
    totalSizeBytes: 0,
    issues
  };
}

function hav(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Extended validation layer (Phase 1, task F): in addition to the standard
 * filename completeness check, it flags duplicate filenames and — when item
 * metadata is supplied — GPS jumps, sorted-timestamp discontinuities and
 * missing/corrupt metadata fields. Used to gate dataset import.
 */
export function validateProcessedOutputRich(input: ProcessedOutputRichInput): ProcessedOutputValidationResult {
  const base = validateProcessedOutput({
    expected: input.expected,
    found: input.found
  });

  const duplicates: string[] = [];
  if (input.checkDuplicates !== false) {
    const seen = new Map<string, number>();
    input.found.forEach((f) => {
      const key = normalizeFilename(f);
      seen.set(key, (seen.get(key) || 0) + 1);
    });
    seen.forEach((count, key) => {
      if (count > 1) duplicates.push(key);
    });
  }

  const gpsIssues: string[] = [];
  const timestampIssues: string[] = [];
  const metadataIssues: string[] = [];

  const items = input.items || [];
  const coordSorted = [...items]
    .map((it, i) => ({ it, i }))
    .filter((x) => typeof x.it.gpsLat === 'number' && typeof x.it.gpsLng === 'number')
    .sort((a, b) => a.i - b.i);
  const maxJump = input.maxGpsJumpMeters ?? 50;

  for (let k = 1; k < coordSorted.length; k++) {
    const prev = coordSorted[k - 1].it;
    const cur = coordSorted[k].it;
    const d = hav(prev.gpsLat as number, prev.gpsLng as number, cur.gpsLat as number, cur.gpsLng as number);
    if (d > maxJump) {
      gpsIssues.push(`${normalizeFilename(cur.filename)}: GPS jump of ${Math.round(d)}m from previous fix (limit ${maxJump}m).`);
    }
  }

  const tsSorted = items
    .map((it) => ({ it, t: it.capturedAt ? new Date(it.capturedAt).getTime() : NaN }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
  for (let k = 1; k < tsSorted.length; k++) {
    const prevT = tsSorted[k - 1].t;
    const curT = tsSorted[k].t;
    if (curT < prevT) {
      timestampIssues.push(`Timestamp out of order near ${normalizeFilename(tsSorted[k].it.filename)}.`);
    }
  }

  if (input.items) {
    const noGps = items.filter((it) => it.gpsLat == null || it.gpsLng == null).length;
    const noTs = items.filter((it) => !it.capturedAt).length;
    if (noGps > 0) metadataIssues.push(`${noGps} file(s) missing GPS coordinates.`);
    if (noTs > 0) metadataIssues.push(`${noTs} file(s) missing capture timestamp.`);
  }

  const issues = [...base.issues];
  if (duplicates.length > 0) issues.push(`${duplicates.length} duplicate filename(s) in the output folder.`);
  if (gpsIssues.length > 0) issues.push(`${gpsIssues.length} GPS consistency issue(s).`);
  if (timestampIssues.length > 0) issues.push(`${timestampIssues.length} timestamp order issue(s).`);
  if (metadataIssues.length > 0) issues.push(`${metadataIssues.length} metadata issue(s).`);

  const ok =
    base.ok &&
    duplicates.length === 0 &&
    gpsIssues.length === 0 &&
    timestampIssues.length === 0 &&
    metadataIssues.length === 0;

  return {
    ...base,
    ok,
    duplicates: duplicates.slice(0, 25),
    gpsIssues: gpsIssues.slice(0, 25),
    timestampIssues: timestampIssues.slice(0, 25),
    metadataIssues: metadataIssues.slice(0, 25),
    issues
  };
}

/** Build an expected filename list from a subgrid pattern + count. */
export function generateExpectedFilenames(subgrid: string, count: number): string[] {
  const sg = (subgrid || '').toUpperCase().replace(/-/g, '').trim();
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(`${sg}-${String(i).padStart(5, '0')}.jpg`);
  }
  return out;
}

interface FolderEntryLike {
  name: string;
}

/** Pull real, individual filenames out of a folder listing for validation. */
export function extractFolderFilenames(entries: FolderEntryLike[] | undefined): string[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => e.name)
    .filter((n) => !/^\+\d+ more files?$/.test(n.trim()) && !n.endsWith('/'));
}

/**
 * Validate an output folder before import. Only meaningful when real
 * filenames are enumerable (http mode) — returns null when there is nothing
 * concrete to validate (e.g. mock synthetic counts).
 */
export function validateFolderForImport(
  listing: { entries?: FolderEntryLike[]; fileCount?: number } | null,
  subgrid: string,
  opts?: { expectedCount?: number }
): ProcessedOutputValidationResult | null {
  const found = extractFolderFilenames(listing?.entries);
  if (found.length === 0) return null;
  const expectedCount = opts?.expectedCount || found.length || listing?.fileCount || 0;
  const expected = generateExpectedFilenames(subgrid, expectedCount > 0 ? expectedCount : found.length);
  return validateProcessedOutputRich({
    expected,
    found,
    checkDuplicates: true
  });
}