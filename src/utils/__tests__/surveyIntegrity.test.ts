import { describe, it, expect } from 'vitest'
import {
  computeSurveyIntegrity,
  aggregateSubgridIntegrity,
  checkIntegrityIdentities,
  frameKey,
  classifyFilename,
  type IntegritySubject
} from '../surveyIntegrity'

/**
 * v27 §2. The two identities the requested figures satisfy, and the cases where
 * a figure must be unknown rather than zero.
 */

/** The operator's own example, reproduced exactly. */
function exampleSubject(overrides: Partial<IntegritySubject> = {}): IntegritySubject {
  return {
    subgrid: 'N93E70',
    date: '2026-09-25',
    runId: 'sp-d-N93E70_20260925.csv',
    recordedFilenames: [],
    verifiedFilenames: [],
    inventoryVerified: true,
    metadataFilenames: null,
    bucketFilenames: null,
    ...overrides
  };
}

/**
 * A run large enough to carry the example's numbers without allocating 284k
 * strings: 1000 POIs, 134 of which are missing.
 */
function bigRun(): IntegritySubject {
  const recorded = Array.from({ length: 1000 }, (_, i) => `N93E70-${String(i + 1).padStart(4, '0')}.jpg`);
  // 1000 - 134 = 866 found.
  const verified = recorded.slice(0, 866);
  return exampleSubject({ recordedFilenames: recorded, verifiedFilenames: verified });
}

describe('frameKey', () => {
  it('ignores a path prefix, because bucket keys carry one', () => {
    // storage.ts:addFile stores both the full path token and the basename.
    expect(frameKey('MMS_PIC/N93E70-0001.jpg')).toBe(frameKey('N93E70-0001.jpg'));
  });

  it('ignores case, because the inventory is lowercased at ingest', () => {
    expect(frameKey('n93e70-0001.jpg')).toBe(frameKey('N93E70-0001.JPG'));
  });

  it('strips the extension, so .jpg and .jpeg are one frame', () => {
    expect(frameKey('N93E70-0001.jpeg')).toBe(frameKey('N93E70-0001.jpg'));
  });

  it('returns empty for absent input rather than throwing', () => {
    expect(frameKey(null)).toBe('');
    expect(frameKey(undefined)).toBe('');
    expect(frameKey('')).toBe('');
  });
});

describe('classifyFilename', () => {
  it('accepts a conventional frame name', () => {
    expect(classifyFilename('N93E70-0001.jpg')).toBeNull();
  });

  it('rejects a name with no extension', () => {
    expect(classifyFilename('N93E70-0001')?.reason).toBe('no_extension');
  });

  it('rejects an extension with no numeric sequence', () => {
    // A corrupt CSV cell, which is what this row is meant to surface. Note
    // `IMG_4481.jpg` is ACCEPTED — the import predicate at
    // `DataManagementPage.tsx:1151` treats `_4481` as a sequence, so anything
    // this module flags must also have been flaggable on the way in.
    expect(classifyFilename('photo.jpg')?.reason).toBe('no_numeric_sequence');
    expect(classifyFilename('IMG_4481.jpg')).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(classifyFilename('  ')?.reason).toBe('no_extension');
  });
});

describe('computeSurveyIntegrity — the arithmetic relationships', () => {
  it('satisfies gpsLinked + unlinked = found', () => {
    const s = bigRun();
    // 10 bucket images nobody claims. found splits 856 linked + 10 unlinked.
    const orphans = Array.from({ length: 10 }, (_, i) => `N93E70-ORPHAN-${i}.jpg`);
    const subject = { ...s, bucketFilenames: [...s.verifiedFilenames, ...orphans] };

    const r = computeSurveyIntegrity(subject);
    expect(r.gpsLinkedImages).toBe(866);
    expect(r.unlinkedImages).toHaveLength(10);
    expect(r.foundImages).toBe(876);
    expect(checkIntegrityIdentities(r).gpsPlusUnlinkedEqualsFound).toBe(true);
  });

  it('satisfies missing = expected - gpsLinked', () => {
    const r = computeSurveyIntegrity(bigRun());
    const ids = checkIntegrityIdentities(r);
    expect(ids.missingEqualsExpectedMinusLinked).toBe(true);
    expect(ids.actualPoiGap).toBe(134);
  });

  it('shows that expected - found UNDERCOUNTS the real gap by exactly the unlinked count', () => {
    // THE SUBTLETY. Reproduces the figures this plan was written against, scaled
    // down: expected 1000, found 890, gpsLinked 866, unlinked 24.
    // `expected - found` = 110, but 134 POIs have no image, because the 24
    // orphan images inflate "found" without filling any gap.
    const TOTAL = 1_000;
    const LINKED = 866;
    const UNLINKED = 24;
    const recorded = Array.from({ length: TOTAL }, (_, i) =>
      `N93E70-${String(i + 1).padStart(4, '0')}.jpg`
    );
    const verified = recorded.slice(0, LINKED);
    const orphans = Array.from({ length: UNLINKED }, (_, i) => `N93E70-ORPHAN-${i}.jpg`);

    const r = computeSurveyIntegrity({
      ...exampleSubject({ recordedFilenames: recorded, verifiedFilenames: verified }),
      bucketFilenames: [...verified, ...orphans]
    });

    // The naive subtraction the original table used.
    expect(r.expectedImages! - r.foundImages!).toBe(TOTAL - (LINKED + UNLINKED));

    const ids = checkIntegrityIdentities(r);
    expect(ids.missingEqualsExpectedMinusLinked).toBe(true);
    expect(ids.actualPoiGap).toBe(TOTAL - LINKED);
    expect(ids.naiveGap).toBe(TOTAL - (LINKED + UNLINKED));
    expect(r.missingImages).toHaveLength(TOTAL - LINKED);
    // And the naive figure understates it by precisely the orphan count.
    expect(ids.undercountedByUnlinked).toBe(UNLINKED);
  });

  it('has no undercount when every bucket image is claimed by a POI', () => {
    const s = bigRun();
    const r = computeSurveyIntegrity({ ...s, bucketFilenames: s.verifiedFilenames });
    const ids = checkIntegrityIdentities(r);

    expect(ids.undercountedByUnlinked).toBe(0);
    expect(ids.actualPoiGap).toBe(134);
  });

  it('does not fold the anomaly rows into the shortfall', () => {
    // The trap this module documents: 12 + 7 + 23 do not add to 134. They are
    // diagnostics within `found`, so they must not perturb the arithmetic.
    const r = computeSurveyIntegrity(bigRun());
    expect(r.missingImages).toHaveLength(134);
    expect(checkIntegrityIdentities(r).missingEqualsExpectedMinusLinked).toBe(true);
  });
});

describe('computeSurveyIntegrity — unknown is not zero', () => {
  it('reports every storage figure as null when the bucket is unreachable', () => {
    // THE CASE. The old model inferred this from an empty verified list, which
    // is what a reachable-but-empty bucket also produces — so an outage
    // rendered as "134 frames missing" on a run nobody had actually checked.
    const r = computeSurveyIntegrity(
      exampleSubject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        verifiedFilenames: [],
        inventoryVerified: false
      })
    );

    expect(r.inventoryVerified).toBe(false);
    expect(r.foundImages).toBeNull();
    expect(r.missingImages).toBeNull();
    expect(r.gpsLinkedImages).toBeNull();
    expect(r.unlinkedImages).toBeNull();
    // Expected is still knowable: it comes from the run, not the bucket.
    expect(r.expectedImages).toBe(2);
    // And the identities decline to pronounce on unknown parts.
    expect(checkIntegrityIdentities(r).missingEqualsExpectedMinusLinked).toBeNull();
  });

  it('distinguishes unreachable from reachable-but-empty', () => {
    const recorded = ['N93E70-0001.jpg', 'N93E70-0002.jpg'];
    const unreachable = computeSurveyIntegrity(
      exampleSubject({ recordedFilenames: recorded, verifiedFilenames: [], inventoryVerified: false })
    );
    const empty = computeSurveyIntegrity(
      exampleSubject({ recordedFilenames: recorded, verifiedFilenames: [], inventoryVerified: true })
    );

    expect(unreachable.missingImages).toBeNull();
    expect(empty.missingImages).toHaveLength(2);
    expect(empty.foundImages).toBe(0);
  });

  it('reports a genuinely clean run as zero, not null', () => {
    // Guards the guard: an unconditional null would make every healthy run look
    // unverified, which is the mirror image of the same mistake.
    const r = computeSurveyIntegrity(
      exampleSubject({
        recordedFilenames: ['N93E70-0001.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg']
      })
    );

    expect(r.foundImages).toBe(1);
    expect(r.missingImages).toEqual([]);
    expect(checkIntegrityIdentities(r).missingEqualsExpectedMinusLinked).toBe(true);
  });
});

describe('computeSurveyIntegrity — metadata rows', () => {
  it('reports "not captured" rather than zero for a pre-0034 run', () => {
    const r = computeSurveyIntegrity(
      exampleSubject({
        recordedFilenames: ['N93E70-0001.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg'],
        metadataFilenames: null
      })
    );

    expect(r.metadataCaptured).toBe(false);
    expect(r.metadataMismatches).toBeNull();
  });

  it('names the metadata entry a recorded frame disagrees with', () => {
    const r = computeSurveyIntegrity(
      exampleSubject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        verifiedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
        metadataFilenames: ['N93E70-0001.jpg', 'N93E70-0009.jpg']
      })
    );

    expect(r.metadataCaptured).toBe(true);
    expect(r.metadataMismatches).toHaveLength(1);
    expect(r.metadataMismatches![0].recordedFilename).toBe('N93E70-0002.jpg');
  });
});

describe('computeSurveyIntegrity — duplicates and invalid names', () => {
  it('collapses a repeated name into one entry with its multiplicity', () => {
    const r = computeSurveyIntegrity(
      exampleSubject({
        recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0001.jpg', 'N93E70-0002.jpg']
      })
    );

    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates![0].occurrences).toBe(2);
  });

  it('reports an invalid name once, not once per occurrence', () => {
    const r = computeSurveyIntegrity(
      exampleSubject({ recordedFilenames: ['BROKEN', 'BROKEN'] })
    );

    expect(r.invalidFilenames).toHaveLength(1);
    expect(r.invalidFilenames![0].filename).toBe('BROKEN');
  });

  it('flags a name that is both duplicated and invalid', () => {
    // The two rows are independent diagnostics and may overlap.
    const r = computeSurveyIntegrity(
      exampleSubject({ recordedFilenames: ['BROKEN', 'BROKEN'] })
    );

    expect(r.duplicates).toHaveLength(1);
    expect(r.invalidFilenames).toHaveLength(1);
  });
});

describe('aggregateSubgridIntegrity', () => {
  const child = (over: Partial<IntegritySubject>) =>
    computeSurveyIntegrity(exampleSubject(over));

  it('sums expected and found across runs', () => {
    const a = computeSurveyIntegrity(
      exampleSubject({ runId: 'run-a', recordedFilenames: ['A-0001.jpg'], verifiedFilenames: ['A-0001.jpg'] })
    );
    const b = computeSurveyIntegrity(
      exampleSubject({ runId: 'run-b', recordedFilenames: ['B-0001.jpg'], verifiedFilenames: [] })
    );

    const agg = aggregateSubgridIntegrity('N93E70', [a, b]);
    expect(agg.expectedImages).toBe(2);
    expect(agg.foundImages).toBe(1);
    expect(agg.missingImages).toHaveLength(1);
  });

  it('becomes unknown if ANY child is unknown', () => {
    // A partial sum understates the gap, and understating a shortfall is the
    // direction that reads as good news.
    const verified = child({ recordedFilenames: ['A-0001.jpg'], verifiedFilenames: ['A-0001.jpg'] });
    const unknown = child({ recordedFilenames: ['B-0001.jpg'], inventoryVerified: false });

    const agg = aggregateSubgridIntegrity('N93E70', [verified, unknown]);
    expect(agg.inventoryVerified).toBe(false);
    expect(agg.missingImages).toBeNull();
    expect(agg.foundImages).toBeNull();
  });

  it('unions the filename lists rather than concatenating duplicates', () => {
    const a = child({ recordedFilenames: ['A-0001.jpg'], verifiedFilenames: [] });
    const b = child({ recordedFilenames: ['A-0001.jpg'], verifiedFilenames: [] });
    const c = child({ recordedFilenames: ['B-0001.jpg'], verifiedFilenames: [] });

    const agg = aggregateSubgridIntegrity('N93E70', [a, b, c]);
    const names = agg.missingImages!.map((m) => m.filename);
    expect(new Set(names).size).toBe(2);
  });
});