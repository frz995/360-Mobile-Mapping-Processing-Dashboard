import { describe, it, expect, vi } from 'vitest';
import {
  createIntegritySources,
  toSubgridNames,
  verifyImportedRun,
  markPanoramaAvailability,
  resolveSubgrid,
  siblingFilenamesFor,
  buildDailySubject,
  buildIntegritySubject,
  collectSubgridSubjects,
  revalidateSubjects,
  type IntegritySources,
  type StorageVerification
} from '../integritySubjects';
import { computeSurveyIntegrity, checkIntegrityIdentities } from '../surveyIntegrity';
import type { BatchLog, DailyTimeSeries } from '../../types/dashboard';

/**
 * The wiring between a data-management row and the integrity model.
 *
 * Three fields used to be hardcoded at the call site — `metadataFilenames`,
 * `bucketFilenames`, and no `poiCoordinates` at all — and each one silently
 * disabled a row of the panel. These tests pin the wiring, since nothing about a
 * hardcoded `null` is visible from the model.
 */

function run(over: Partial<DailyTimeSeries> = {}): DailyTimeSeries {
  return {
    id: 'run-1',
    date: '2026-09-25',
    grid: 'G1',
    subgrid: 'N93E70',
    kmProcessed: 1,
    imagesProcessed: 2,
    defectCount: 0,
    captureEquipment: 'MMS',
    imagesDefected: 0,
    publishToWebGIS: 'no',
    action: '',
    panoramas: [
      { filename: 'N93E70-0001.jpg', latitude: 3.1, longitude: 101.1 },
      { filename: 'N93E70-0002.jpg', latitude: 3.2, longitude: 101.2 }
    ],
    ...over
  };
}

function sources(over: Partial<IntegritySources> = {}): IntegritySources {
  return {
    verify: async () => ({
      availableCount: 0,
      verifiedFilenames: [],
      verified: true,
      fileSet: new Set<string>()
    }),
    metadata: async () => null,
    ...over
  };
}

/** A storage verification where every listed file was matched by a POI. */
const stored = (files: string[], verified = true): StorageVerification => ({
  availableCount: files.length,
  verifiedFilenames: files,
  verified,
  fileSet: new Set(files.map((f) => f.toLowerCase()))
});

describe('resolveSubgrid', () => {
  it('normalises the code a model subject expects', () => {
    expect(resolveSubgrid({ subgrid: 'n93e70' })).toBe('N93E70');
    expect(resolveSubgrid({ imageFilename: 'N93E70-0002.jpg' })).toBe('N93E70');
  });
});

describe('createIntegritySources', () => {
  it('turns a rejected metadata read into "not captured"', async () => {
    // A transport failure must land on the same answer as a pre-0034 run, or the
    // panel would distinguish two states that mean the same thing to the operator.
    const s = createIntegritySources(
      async () => stored([]),
      async () => {
        throw new Error('PGRST204 relation missing');
      }
    );

    await expect(s.metadata('N93E70', 'run-1')).resolves.toBeNull();
  });

  it('passes an uncaptured result through untouched', async () => {
    const s = createIntegritySources(async () => stored([]), async () => ['a.jpg']);
    await expect(s.metadata('N93E70', 'run-1')).resolves.toEqual(['a.jpg']);
  });
});

describe('buildIntegritySubject', () => {
  it('reads the metadata set instead of hardcoding it away', async () => {
    const subject = await buildIntegritySubject(
      run(),
      '',
      sources({ metadata: async () => ['N93E70-0001.jpg', 'N93E70-0002.jpg'] })
    );

    expect(subject.metadataFilenames).toEqual(['N93E70-0001.jpg', 'N93E70-0002.jpg']);
    // Which means the model can finally evaluate the row.
    expect(computeSurveyIntegrity(subject).metadataCaptured).toBe(true);
  });

  it('supplies coordinates so the POI figure is a count of locations', async () => {
    const subject = await buildIntegritySubject(run(), '', sources());
    expect(subject.poiCoordinates).toHaveLength(2);

    const report = computeSurveyIntegrity({ ...subject, inventoryVerified: true });
    expect(report.poiCount).toBe(2);
    expect(report.expectedImages).toBe(2);
  });

  it('carries the storage-verified flag rather than inferring it from a list', async () => {
    // An empty availableFilenames with no flag is the ambiguous pair the whole
    // module exists to keep apart.
    const unverified = await buildIntegritySubject(
      run({ availableFilenames: [] }),
      '',
      sources()
    );
    expect(unverified.inventoryVerified).toBe(false);

    const verified = await buildIntegritySubject(
      run({ availableFilenames: [], imagesStorageVerified: true }),
      '',
      sources()
    );
    expect(verified.inventoryVerified).toBe(true);
  });

  it('keeps an uncaptured metadata read as unknown', async () => {
    const subject = await buildIntegritySubject(run(), '', sources());
    expect(subject.metadataFilenames).toBeNull();
  });
});

describe('siblingFilenamesFor', () => {
  it('returns the other runs of the same subgrid', () => {
    const a = run({ id: 'run-a' });
    const b = run({ id: 'run-b', subgrid: 'N94E71' });
    const peers = siblingFilenamesFor([a, b], a);

    // B is a different subgrid, so it is not a peer.
    expect(peers).toEqual([]);
  });

  it('returns a same-subgrid peer filenames', () => {
    const a = run({ id: 'run-a' });
    const b = run({ id: 'run-b' });
    const peers = siblingFilenamesFor([a, b], a);

    expect(peers).toEqual(['N93E70-0001.jpg', 'N93E70-0002.jpg']);
  });

  it('excludes the target itself', () => {
    // Load-bearing: a run listed as its own peer would have every name marked
    // "claimed elsewhere", zeroing its orphans AND masking a real stray.
    const a = run({ id: 'run-a' });
    const peers = siblingFilenamesFor([a], a);

    expect(peers).not.toContain('N93E70-0001.jpg');
    expect(peers).toEqual([]);
  });

  it('excludes an id-equal row even when it is a distinct object', () => {
    // A re-import can replace the object while keeping the id; identity is by id
    // when both rows carry one.
    const original = run({ id: 'run-a' });
    const refreshed = run({ id: 'run-a', panoramas: [] });

    expect(siblingFilenamesFor([original, refreshed], original)).toEqual([]);
  });

  it('falls back to reference identity when rows carry no id', () => {
    const a = run({ id: undefined });
    const b = run({ id: undefined });

    expect(siblingFilenamesFor([a, b], a)).toHaveLength(2);
  });
});

describe('buildDailySubject — peers reach the model', () => {
  it('carries the peer set so the run cannot adopt its sibling images', () => {
    // The reported case: September recorded 196 names and uploaded none; April
    // owns the only 92 files in the subgrid folder.
    const april = run({
      id: 'run-april',
      availableFilenames: ['N93E70-0001.jpg'],
      imagesStorageVerified: true,
      // April's RECORDED names are what September must not claim, and that is
      // the panoramas list rather than the verified subset.
      panoramas: [{ filename: 'N93E70-0001.jpg' }]
    });
    const september = run({
      id: 'run-sept',
      availableFilenames: [],
      imagesStorageVerified: true,
      panoramas: [
        { filename: 'N93E70-0093.jpg' },
        { filename: 'N93E70-0094.jpg' }
      ]
    });
    (september as { bucketFilenames?: string[] | null }).bucketFilenames = [
      'N93E70-0001.jpg'
    ];

    return buildDailySubject(september, [april, september], sources()).then((subject) => {
      expect(subject.siblingFilenames).toEqual(['N93E70-0001.jpg']);

      const report = computeSurveyIntegrity(subject);
      expect(report.gpsLinkedImages).toBe(0);
      expect(report.unlinkedImages).toEqual([]);
      expect(report.foundImages).toBe(0);
      expect(report.missingImages).toHaveLength(2);
    });
  });
});

describe('collectSubgridSubjects', () => {
  const batch: BatchLog = {
    date: '2026-09-27',
    grid: 'G1',
    subgrid: 'N93E70',
    imageFilename: 'N93E70-0002.jpg',
    images: 2,
    defects: 0,
    kmProcessed: 2,
    status: 'Complete'
  };

  it('emits one subject per run of the subgrid', async () => {
    const rows = [run({ id: 'run-1' }), run({ id: 'run-2', date: '2026-09-26' }), run({ id: 'run-3', subgrid: 'N94E71' })];

    const subjects = await collectSubgridSubjects(rows, batch, sources());

    expect(subjects).toHaveLength(2);
    expect(subjects.map((s) => s.runId)).toEqual(['run-1', 'run-2']);
  });

  it('falls back to the batch row when no staged run matches', async () => {
    const subjects = await collectSubgridSubjects([], batch, sources());
    expect(subjects).toHaveLength(1);
    expect(subjects[0].subgrid).toBe('N93E70');
  });

  it('keeps the identity intact across the aggregated runs', async () => {
    const rows = [
      run({ id: 'run-1', availableFilenames: ['N93E70-0001.jpg'], imagesStorageVerified: true }),
      run({ id: 'run-2', availableFilenames: [], imagesStorageVerified: true })
    ];

    const subjects = await collectSubgridSubjects(rows, batch, sources());
    const { aggregateSubgridIntegrity } = await import('../surveyIntegrity');
    const agg = aggregateSubgridIntegrity('N93E70', subjects.map(computeSurveyIntegrity));

    // 4 frames expected across two runs; 1 has its image, 3 do not.
    expect(agg.expectedImages).toBe(4);
    expect(agg.gpsLinkedImages).toBe(1);
    expect(agg.missingImages).toHaveLength(3);
    expect(checkIntegrityIdentities(agg).missingEqualsExpectedMinusLinked).toBe(true);
  });
});

describe('revalidateSubjects', () => {
  it('refreshes both the verified names and the bucket contents', async () => {
    // Carrying the previous orphan list forward would mean re-reading storage
    // while still reporting what it said last time.
    const subject = {
      runId: 'run-1',
      subgrid: 'N93E70',
      date: '2026-09-25',
      recordedFilenames: ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
      verifiedFilenames: [],
      inventoryVerified: false,
      metadataFilenames: null,
      bucketFilenames: null,
      poiCoordinates: null
    };

    const refreshed = await revalidateSubjects(
      [subject],
      sources({
        verify: async () => ({
          availableCount: 1,
          // The bucket holds two files; only one is claimed by a POI.
          verifiedFilenames: ['n93e70-0001.jpg'],
          verified: true,
          fileSet: new Set(['n93e70-0001.jpg', 'n93e70-orphan.jpg'])
        }),
        metadata: async () => ['N93E70-0001.jpg', 'N93E70-0002.jpg']
      })
    );

    expect(refreshed[0].inventoryVerified).toBe(true);
    expect(refreshed[0].verifiedFilenames).toEqual(['n93e70-0001.jpg']);
    // The bucket holds every file in the subgrid's folder, linked or not. The
    // orphan is the one no POI claims; both are needed to derive that.
    expect(refreshed[0].bucketFilenames).toEqual(['n93e70-0001.jpg', 'n93e70-orphan.jpg']);
    expect(refreshed[0].metadataFilenames).toEqual([
      'N93E70-0001.jpg',
      'N93E70-0002.jpg'
    ]);
  });

  it('reports an outage as unverified rather than as an empty result', async () => {
    const subject = {
      runId: 'run-1',
      subgrid: 'N93E70',
      date: '2026-09-25',
      recordedFilenames: ['N93E70-0001.jpg'],
      verifiedFilenames: [],
      inventoryVerified: true,
      metadataFilenames: null,
      bucketFilenames: null,
      poiCoordinates: null
    };

    const refreshed = await revalidateSubjects(
      [subject],
      sources({ verify: async () => stored([], false) })
    );

    expect(refreshed[0].inventoryVerified).toBe(false);
    expect(refreshed[0].bucketFilenames).toBeNull();
  });

  it('does not claim a measurement for a run that recorded no filenames', async () => {
    const verify = vi.fn();
    const subject = {
      runId: 'run-1',
      subgrid: 'N93E70',
      date: '2026-09-25',
      recordedFilenames: [],
      verifiedFilenames: [],
      inventoryVerified: true,
      metadataFilenames: null,
      bucketFilenames: [],
      poiCoordinates: null
    };

    const refreshed = await revalidateSubjects([subject], sources({ verify }));

    expect(verify).not.toHaveBeenCalled();
    expect(refreshed[0].inventoryVerified).toBe(false);
    expect(refreshed[0].bucketFilenames).toBeNull();
  });
});

describe('verifyImportedRun', () => {
  it('returns the count, the names, and the fact the inventory was read', async () => {
    const res = await verifyImportedRun(
      ['N93E70-0001.jpg', 'N93E70-0002.jpg'],
      'N93E70',
      sources({ verify: async () => stored(['N93E70-0001.jpg']) })
    );

    expect(res.verifiedCount).toBe(1);
    expect(res.storageVerified).toBe(true);
    expect(res.bucketFilenames).toEqual(['n93e70-0001.jpg']);
  });

  it('treats a thrown verification as an outage, not an empty bucket', async () => {
    const res = await verifyImportedRun(
      ['N93E70-0001.jpg'],
      'N93E70',
      sources({
        verify: async () => {
          throw new Error('network down');
        }
      })
    );

    expect(res.storageVerified).toBe(false);
    expect(res.verifiedCount).toBe(0);
    expect(res.bucketFilenames).toBeNull();
  });

  it('does not call storage when the run recorded no filenames', async () => {
    const verify = vi.fn();
    const res = await verifyImportedRun([], 'N93E70', sources({ verify }));

    expect(verify).not.toHaveBeenCalled();
    expect(res.storageVerified).toBe(false);
  });
});

describe('markPanoramaAvailability', () => {
  it('marks a frame unavailable when the inventory was read and lacks it', () => {
    const out = markPanoramaAvailability(run().panoramas!, ['N93E70-0001.jpg'], true);
    expect(out.map((p) => p.isAvailable)).toEqual([true, false]);
  });

  it('matches case-insensitively, because the inventory is lowercased at ingest', () => {
    const out = markPanoramaAvailability(run().panoramas!, ['n93e70-0001.jpg'], true);
    expect(out[0].isAvailable).toBe(true);
  });

  it('leaves every frame available when the inventory was never read', () => {
    // The alternative asserts every image is missing because nobody could look.
    const out = markPanoramaAvailability(run().panoramas!, [], false);
    expect(out.every((p) => p.isAvailable)).toBe(true);
  });
});

describe('toSubgridNames', () => {
  it('returns unknown for an unverified inventory', () => {
    expect(toSubgridNames({ verified: false, fileSet: new Set(['n93e70-0001.jpg']) }, 'N93E70')).toBeNull();
  });

  it('returns an empty list for a subgrid that genuinely holds nothing', () => {
    expect(toSubgridNames({ verified: true, fileSet: new Set(['n94e71-0001.jpg']) }, 'N93E70')).toEqual([]);
  });
});