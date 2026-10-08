import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reachable/unreachable distinction.
 *
 * `verifyCsvImageFilenamesInStorage` used to return only a count and a list.
 * Both are empty when the bucket was never reached AND when it was read and
 * held none of the frames, so every caller had to guess which happened. That
 * guess is where "0 images missing" came from during an outage.
 */

const inventoryRows = vi.fn();
const storageList = vi.fn();

vi.mock('../api/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ limit: () => inventoryRows() })
      })
    }),
    storage: {
      from: () => ({ list: (...args: unknown[]) => storageList(...args) })
    }
  },
  scoped: (q: unknown) => q,
  scopedIncludingUnassigned: (q: unknown) => q,
  getServiceProjectId: () => 'project-1',
  fetchProjectSettingsFromSupabase: async () => null
}));

const { verifyCsvImageFilenamesInStorage, listSubgridFilenamesFromInventory } = await import(
  '../api/storage'
);

type Inventory = Parameters<typeof listSubgridFilenamesFromInventory>[0];

function inventory(over: Partial<NonNullable<Inventory>> = {}): NonNullable<Inventory> {
  return {
    fromInventory: true,
    fileSet: new Set<string>(),
    countsBySubgrid: new Map(),
    totalFiles: 0,
    listingOk: true,
    ...over
  };
}

describe('verifyCsvImageFilenamesInStorage — verified flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // `resolveStorageFiles` memoises per bucket:path for 45s, so each test uses a
  // bucket name of its own. Without that, a reachable result from one test is
  // served to the next and the unreachable case silently reads as reachable.

  it('reports verified when the bucket was read and matched some frames', async () => {
    inventoryRows.mockResolvedValue({
      data: [{ filename: 'n93e70-0001.jpg' }],
      error: null
    });

    const res = await verifyCsvImageFilenamesInStorage(
      ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
      { supabaseBucket: 'bucket-match' }
    );

    expect(res.verified).toBe(true);
    expect(res.availableCount).toBe(1);
    expect(res.verifiedFilenames).toEqual(['N93E70-0001.jpg']);
  });

  it('reports verified even when the bucket was read and held none of them', async () => {
    // Reachable-but-empty. This is the case that was indistinguishable from an
    // outage, and it is a real measurement: the run genuinely has no frames.
    inventoryRows.mockResolvedValue({
      data: [{ filename: 'other-0001.jpg' }],
      error: null
    });

    const res = await verifyCsvImageFilenamesInStorage(['N93E70-0001.jpg'], {
      supabaseBucket: 'bucket-empty'
    });

    expect(res.verified).toBe(true);
    expect(res.availableCount).toBe(0);
    expect(res.verifiedFilenames).toEqual([]);
  });

  it('does NOT report verified when storage could not be reached at all', async () => {
    inventoryRows.mockRejectedValue(new Error('network down'));
    storageList.mockRejectedValue(new Error('network down'));

    const res = await verifyCsvImageFilenamesInStorage(['N93E70-0001.jpg'], {
      supabaseBucket: 'bucket-down'
    });

    expect(res.verified).toBe(false);
    expect(res.availableCount).toBe(0);
  });

  it('does not claim a clean result when there was nothing to check', async () => {
    // No filenames means no measurement was taken, not that everything passed.
    const res = await verifyCsvImageFilenamesInStorage([], { supabaseBucket: 'MMS_PIC' });

    expect(res.verified).toBe(false);
  });
});

describe('listSubgridFilenamesFromInventory — orphan attribution', () => {
  it('returns only the names carrying that subgrid code', () => {
    const resolved = inventory({
      fileSet: new Set([
        'n93e70-0001.jpg',
        'n93e70-0002.jpg',
        'n94e71-0001.jpg',
        'notes.txt'
      ])
    });

    expect(listSubgridFilenamesFromInventory(resolved, 'N93E70')?.sort()).toEqual([
      'n93e70-0001.jpg',
      'n93e70-0002.jpg'
    ]);
  });

  it('matches path-prefixed bucket keys too', () => {
    const resolved = inventory({
      fileSet: new Set(['mms_pic/n93e70-0001.jpg', 'mms_pic/n94e71-0001.jpg'])
    });

    expect(listSubgridFilenamesFromInventory(resolved, 'N93E70')).toEqual(['n93e70-0001.jpg']);
  });

  it('collapses the duplicate path/basename tokens the inventory stores', () => {
    // addFile puts both the full path and the basename into fileSet. One
    // physical file must come back once, or it is counted and listed as two.
    const resolved = inventory({
      fileSet: new Set(['mms_pic/n93e70-0001.jpg', 'n93e70-0001.jpg'])
    });

    expect(listSubgridFilenamesFromInventory(resolved, 'N93E70')).toEqual(['n93e70-0001.jpg']);
  });

  it('returns unknown rather than empty for a manifest-sourced inventory', () => {
    // A public provider manifest is a flat frame list with no folder structure,
    // so there is no honest way to say "this subgrid has no orphans".
    const resolved = inventory({
      fromManifest: true,
      fileSet: new Set(['n93e70-0001.jpg'])
    });

    expect(listSubgridFilenamesFromInventory(resolved, 'N93E70')).toBeNull();
  });

  it('returns unknown rather than empty when storage was unreachable', () => {
    expect(listSubgridFilenamesFromInventory(inventory({ listingOk: false }), 'N93E70')).toBeNull();
    expect(listSubgridFilenamesFromInventory(null, 'N93E70')).toBeNull();
  });

  it('returns unknown rather than empty for a blank subgrid', () => {
    const resolved = inventory({ fileSet: new Set(['n93e70-0001.jpg']) });

    expect(listSubgridFilenamesFromInventory(resolved, '')).toBeNull();
    expect(listSubgridFilenamesFromInventory(resolved, 'N/A')).toBeNull();
  });

  it('returns an empty list for a subgrid genuinely holding no files', () => {
    // Reachable, attributable, and genuinely absent. Zero orphans is a
    // measurement here, not an excuse.
    const resolved = inventory({ fileSet: new Set(['n94e71-0001.jpg']) });

    expect(listSubgridFilenamesFromInventory(resolved, 'N93E70')).toEqual([]);
  });
});