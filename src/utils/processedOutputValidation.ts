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

/** Build an expected filename list from a subgrid pattern + count. */
export function generateExpectedFilenames(subgrid: string, count: number): string[] {
  const sg = (subgrid || '').toUpperCase().replace(/-/g, '').trim();
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(`${sg}-${String(i).padStart(5, '0')}.jpg`);
  }
  return out;
}