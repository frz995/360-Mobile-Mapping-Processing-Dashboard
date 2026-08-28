// =====================================================================
// Dataset Versioning helpers.
// A dataset version chain is modelled via `version` (int) and
// `parent_dataset_id`. When a new version is created the prior version
// is marked `superseded_by = <new id>` so "current/latest" is a real,
// persisted concept rather than a client-side cosmetic badge.
// =====================================================================

import type { DatasetRecord } from '../types/production';

/** Build the metadata for the new version record that supersedes `prior`. */
export function createNextVersion(prior: DatasetRecord): Partial<DatasetRecord> {
  return {
    version: (prior.version || 1) + 1,
    parent_dataset_id: prior.id ?? null,
    superseded_by: null
  };
}

/** True when the dataset is the live/latest version of its chain (not superseded). */
export function isLatestVersion(ds: DatasetRecord): boolean {
  return !ds.superseded_by;
}

/**
 * Compute current/latest + full version chain state for a set of records.
 * A chain is keyed by walking `parent_dataset_id` to the chain root, then
 * collecting all descendants of that root.
 */
export interface DatasetVersionState {
  /** id -> the set of ids in the same version chain as that dataset. */
  chainByDataset: Map<string, DatasetRecord[]>;
  /** id -> true if that dataset is the current/latest of its own chain. */
  latestByDataset: Map<string, boolean>;
  /** id -> the current/latest dataset of that dataset's chain. */
  currentByDataset: Map<string, DatasetRecord | undefined>;
}

export function computeDatasetVersionState(records: DatasetRecord[]): DatasetVersionState {
  const byId = new Map<string, DatasetRecord>();
  records.forEach((d) => d.id && byId.set(d.id, d));

  const rootId = (ds: DatasetRecord): string => {
    let cur: DatasetRecord | undefined = ds;
    const seen = new Set<string>();
    while (cur?.parent_dataset_id && cur.parent_dataset_id !== cur.id && !seen.has(cur.parent_dataset_id)) {
      seen.add(cur.parent_dataset_id);
      cur = byId.get(cur.parent_dataset_id);
    }
    return cur?.id ?? ds.id ?? '';
  };

  const chainByDataset = new Map<string, DatasetRecord[]>();
  const latestByDataset = new Map<string, boolean>();
  const currentByDataset = new Map<string, DatasetRecord | undefined>();

  records.forEach((d) => {
    if (!d.id) return;
    const root = rootId(d);
    const chain = chainByDataset.get(root) || [];
    chain.push(d);
    chainByDataset.set(root, chain);
  });

  chainByDataset.forEach((chain) => {
    const latest = chain
      .filter((c) => isLatestVersion(c))
      .sort((a, b) => (b.version || 1) - (a.version || 1))[0];
    chain.forEach((c) => {
      if (!c.id) return;
      latestByDataset.set(c.id, c.id === latest?.id);
      currentByDataset.set(c.id, latest);
    });
  });

  return { chainByDataset, latestByDataset, currentByDataset };
}

/**
 * Resolve a record reference to its current/latest dataset inside a version
 * chain. Falls back to the record itself when no chain info is available.
 */
export function resolveCurrentDataset(
  ds: DatasetRecord | null | undefined,
  state?: DatasetVersionState
): DatasetRecord | null | undefined {
  if (!ds) return ds;
  if (!ds.id || !state) return ds;
  return state.currentByDataset.get(ds.id) ?? ds;
}
