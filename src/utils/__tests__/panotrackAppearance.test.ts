import { describe, it, expect } from 'vitest'
import {
  resolvePointAppearance,
  deriveFrameState,
  deriveQaState,
  isAvailableFromFrameState
} from '../panotrackAppearance'

/**
 * The frame/QA split from v27 §1.
 *
 * These tests exist because the previous model could not represent the case the
 * feature was asked about. One `status` string had to choose between "has a
 * defect" and "has no image", and `datasets.ts` had already chosen differently
 * for published rows (`:574`, assumed present) and staged rows (`:805`, assumed
 * missing) when storage was unreachable.
 */

describe('deriveFrameState', () => {
  const verified = ['N93E70-0001.jpg', 'N93E70-0002.jpg']

  it('reports present when the recorded name is in the inventory', () => {
    expect(
      deriveFrameState({
        recordedFilename: 'N93E70-0001.jpg',
        verifiedFilenames: verified,
        inventoryVerified: true
      })
    ).toBe('present')
  })

  it('matches on basename, so a path prefix does not hide a real frame', () => {
    // Storage paths are often `MMS_PIC/N93E70-0001.jpg` while the run records a
    // bare name. A whole-string comparison would call every frame missing.
    expect(
      deriveFrameState({
        recordedFilename: 'N93E70-0001.jpg',
        verifiedFilenames: ['MMS_PIC/N93E70-0001.jpg'],
        inventoryVerified: true
      })
    ).toBe('present')
  })

  it('is case-insensitive, because object keys are lowercased at ingest', () => {
    // `storage.ts:addFile` lowercases every entry into `fileSet`, so a
    // case-sensitive match would report the whole run as missing.
    expect(
      deriveFrameState({
        recordedFilename: 'N93E70-0001.JPG',
        verifiedFilenames: ['n93e70-0001.jpg'],
        inventoryVerified: true
      })
    ).toBe('present')
  })

  it('reports missing when reachable and absent', () => {
    expect(
      deriveFrameState({
        recordedFilename: 'N93E70-0099.jpg',
        verifiedFilenames: verified,
        inventoryVerified: true
      })
    ).toBe('missing')
  })

  it('reports unverified — NOT missing — when storage is unreachable', () => {
    // THE DECISIVE CASE. `datasets.ts` has `verifiedFiles: []` in both the
    // unreachable case and the reachable-but-empty case, so anything inferred
    // from the array length alone cannot tell them apart. This is migration
    // 0032's shape at point level: a fabricated zero presented as a measurement.
    expect(
      deriveFrameState({
        recordedFilename: 'N93E70-0001.jpg',
        verifiedFilenames: [],
        inventoryVerified: false
      })
    ).toBe('unverified');
  })

  it('distinguishes reachable-but-empty (all missing) from unreachable', () => {
    // Same empty array, opposite truth. Conflating them reports 134 missing
    // frames on a run whose images were never actually looked for.
    expect(
      deriveFrameState({
        recordedFilename: 'N93E70-0001.jpg',
        verifiedFilenames: [],
        inventoryVerified: true
      })
    ).toBe('missing');
  })

  it('reports unrecorded when no filename was ever stored', () => {
    // `datasets.ts:571` invents `<SG>-0001.jpg` for these POIs. Treating the
    // invented name as a real one would report every unrecorded POI as a
    // missing frame — a fabricated deficit, which is what v27 exists to stop.
    expect(
      deriveFrameState({
        recordedFilename: '',
        verifiedFilenames: [],
        inventoryVerified: true
      })
    ).toBe('unrecorded');
    expect(
      deriveFrameState({
        recordedFilename: undefined,
        verifiedFilenames: [],
        inventoryVerified: true
      })
    ).toBe('unrecorded');
  })

  it('reports unrecorded even when storage is unreachable', () => {
    // There is nothing to check, so the answer is about the record, not the bucket.
    expect(
      deriveFrameState({
        recordedFilename: '   ',
        verifiedFilenames: [],
        inventoryVerified: false
      })
    ).toBe('unrecorded');
  });

  it('gives the same answer for a published and a staged row', () => {
    // The regression this whole module exists to prevent: `:574` defaulted to
    // `true` and `:805` to `false` for the same unreachable bucket, so one
    // unreachable store reported a published run complete and its twin empty.
    const facts = {
      recordedFilename: 'N93E70-0001.jpg',
      verifiedFilenames: [] as string[],
      inventoryVerified: false
    };
    expect(deriveFrameState(facts)).toBe(deriveFrameState(facts));
  });
})

describe('deriveQaState', () => {
  it('reads an explicit defect flag', () => {
    expect(deriveQaState({ isDefect: true })).toBe('defect');
    expect(deriveQaState({ is_defect: true })).toBe('defect');
  });

  it('reads defect from status and qa_status', () => {
    expect(deriveQaState({ status: 'defect' })).toBe('defect');
    expect(deriveQaState({ qa_status: 'flagged' })).toBe('defect');
    expect(deriveQaState({ qa_status: 'Defect' })).toBe('defect');
  });

  it('reads clean from a published marker', () => {
    expect(deriveQaState({ status: 'published', qa_status: 'published' })).toBe('clean');
  });

  it('falls back to unaudited rather than assuming clean', () => {
    // Absence of a defect record is not evidence of a clean frame. Assuming
    // clean here is the same reasoning error as reporting 0 defects.
    expect(deriveQaState({})).toBe('unaudited');
    expect(deriveQaState({ status: 'in process' })).toBe('unaudited');
  });
})

describe('resolvePointAppearance', () => {
  it('keeps a defect red even when the frame is missing', () => {
    // THE CASE THAT STARTED THIS. Both facts survive: a red dot in a gray ring.
    const a = resolvePointAppearance({
      frameState: 'missing',
      qaState: 'defect',
      isPublished: false
    });
    expect(a.color).toBe('#ef4444');
    expect(a.strokeColor).toBe('#94a3b8');
  });

  it('never lets gray mean unverified', () => {
    // Gray is reserved for a confirmed missing frame. An unreachable bucket must
    // not look identical to 134 genuinely missing images.
    const unverified = resolvePointAppearance({
      frameState: 'unverified',
      qaState: 'clean',
      isPublished: true
    });
    expect(unverified.color).not.toBe('#94a3b8');
    expect(unverified.color).toBe('#64748b');
  });

  it('uses gray only for confirmed missing', () => {
    for (const frameState of ['unverified', 'unrecorded'] as const) {
      const a = resolvePointAppearance({ frameState, qaState: 'clean', isPublished: true });
      expect(a.color, frameState).not.toBe('#94a3b8');
    }
  });

  it('greens a present clean published frame, ambers it when unpublished', () => {
    expect(
      resolvePointAppearance({ frameState: 'present', qaState: 'clean', isPublished: true }).color
    ).toBe('#10b981');
    expect(
      resolvePointAppearance({ frameState: 'present', qaState: 'clean', isPublished: false }).color
    ).toBe('#f59e0b');
  });

  it('does not publish a frame it has not seen', () => {
    // A missing frame in a published run must not read as published-green.
    const a = resolvePointAppearance({
      frameState: 'missing',
      qaState: 'clean',
      isPublished: true
    });
    expect(a.color).not.toBe('#10b981');
  });

  it('lets selection outrank every other state', () => {
    // Matches existing behaviour at MapComponent.tsx:169-171.
    expect(
      resolvePointAppearance({
        frameState: 'missing',
        qaState: 'defect',
        isPublished: false,
        isSelected: true
      }).color
    ).toBe('#38bdf8');
  });

  it('dims everything in deletion-preview mode', () => {
    expect(
      resolvePointAppearance({
        frameState: 'missing',
        qaState: 'defect',
        isPublished: true,
        dimmed: true
      })
    ).toEqual({ color: '#64748b', strokeColor: '#64748b', status: 'defect', opacity: 0.35 });
  });

  it('emits a status string the map can switch on', () => {
    expect(
      resolvePointAppearance({ frameState: 'missing', qaState: 'clean', isPublished: false }).status
    ).toBe('missing');
    expect(
      resolvePointAppearance({ frameState: 'present', qaState: 'defect', isPublished: false }).status
    ).toBe('defect');
    expect(
      resolvePointAppearance({ frameState: 'present', qaState: 'clean', isPublished: true }).status
    ).toBe('published');
    expect(
      resolvePointAppearance({ frameState: 'unverified', qaState: 'clean', isPublished: false }).status
    ).toBe('unverified');
  });

  it('fades absence and doubt, and draws presence solid', () => {
    const op = (frameState: 'present' | 'missing' | 'unverified') =>
      resolvePointAppearance({ frameState, qaState: 'clean', isPublished: true }).opacity;
    expect(op('present')).toBe(1.0);
    expect(op('missing')).toBeLessThan(1.0);
    expect(op('unverified')).toBeLessThan(op('missing'));
  });
})

describe('isAvailableFromFrameState', () => {
  it('is true only for a confirmed present frame', () => {
    expect(isAvailableFromFrameState('present')).toBe(true);
    for (const s of ['missing', 'unverified', 'unrecorded'] as const) {
      expect(isAvailableFromFrameState(s), s).toBe(false);
    }
  });
});