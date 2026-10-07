import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { fromMock, upsertMock, getActiveProjectIdMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
  getActiveProjectIdMock: vi.fn()
}))

vi.mock('../../services/supabase', () => ({
  supabase: { from: fromMock }
}))

vi.mock('../../services/projectContext', () => ({
  getActiveProjectId: getActiveProjectIdMock
}))

vi.mock('../../utils/qaqcAnalyzer', () => ({
  analyzeImageSharpness: vi.fn(),
  detectBlurAndObstruction: vi.fn()
}))

import { persistDefectBatch } from '../useQAQCWorker'
import { getWriteFailures, clearWriteFailures } from '../../lib/writeFailures'
import { WRITE_OPS as QAQC_WRITE_OPS } from '../../services/api/qaqc'
import type { QADefectRecord } from '../../types/admin'

/**
 * Partial success in a chunked batch write.
 *
 * `persistDefectBatch` splits a full audit into chunks of 50 and returns a
 * count of rows that landed. The failure mode this covers is not "the write
 * failed" — that is already tested in useQAQCWorker.persist.test.ts — it is
 * "SOME chunks failed and the operator cannot tell which".
 *
 * The batch is the write that records an operator's frame-by-frame verdicts. If
 * 45 of 50 rows persist and 5 do not, a silent total-success report claims an
 * audit trail that does not exist; a silent total-failure report discards work
 * that did land. Both are wrong, and both are what an unexamined counter does.
 *
 * Mirrors QA_DEFECTS_BATCH_SIZE in the module under test.
 */
const BATCH_SIZE = 50

function defect(overrides: Partial<QADefectRecord> = {}): QADefectRecord {
  return {
    subgrid: 'N93E70',
    point_id: 'N93E70-0001.jpg',
    frame_index: 1,
    defect_flags: { blur: true },
    defect_type: 'Blur',
    pic: 'Operator',
    ...overrides
  };
}

/** `total` distinct defects, so chunk boundaries are unambiguous. */
function manyDefects(total: number): QADefectRecord[] {
  return Array.from({ length: total }, (_, i) =>
    defect({ point_id: `N93E70-${String(i + 1).padStart(4, '0')}.jpg` })
  );
}

/**
 * Make a single chunk reject with a deterministic constraint violation.
 * `withRetry` does not retry these, so the chunk count stays predictable.
 */
function failChunkAt(chunkIndex: number, message = 'duplicate key value violates unique constraint') {
  // A closure counter, not an index into mock.calls: the call is already
  // recorded by the time the implementation runs, so reading mock.calls here
  // is an off-by-one at best.
  let callIndex = 0;
  upsertMock.mockImplementation(() => {
    const index = callIndex++;
    return Promise.resolve(
      index === chunkIndex ? { error: { message }, data: null } : { error: null, data: null }
    );
  });
}

describe('persistDefectBatch — partial success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertMock.mockResolvedValue({ error: null, data: null });
    fromMock.mockImplementation(() => ({ upsert: upsertMock }));
    getActiveProjectIdMock.mockReturnValue('project-1');
    clearWriteFailures();
  });

  afterEach(() => clearWriteFailures());

  it('reports the rows that landed, not total success', async () => {
    // 3 chunks: 50 + 50 + 10. The middle one is rejected.
    failChunkAt(1);
    const total = BATCH_SIZE * 2 + 10;

    const synced = await persistDefectBatch(manyDefects(total), 'qa_defects');

    // 50 from the first chunk plus 10 from the third. Claiming 110 would report
    // an audit trail that is missing a chunk; claiming 0 would discard two
    // chunks that did persist.
    expect(synced).toBe(BATCH_SIZE + 10);
  });

  it('still surfaces the failed chunk through the write-failure banner', async () => {
    // The count alone is not enough: a partial write that only shows up as a
    // lower number leaves the operator no way to know results were lost.
    failChunkAt(1);
    const total = BATCH_SIZE * 2 + 10;

    await persistDefectBatch(manyDefects(total), 'qa_defects');

    const failures = getWriteFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].op).toBe(QAQC_WRITE_OPS.defectBatch);
    expect(failures[0].detail).toContain('duplicate key');
  });

  it('identifies which chunk failed', async () => {
    failChunkAt(1);
    const total = BATCH_SIZE * 2 + 10;

    await persistDefectBatch(manyDefects(total), 'qa_defects');

    const failures = getWriteFailures();
    expect(failures[0].label).toContain('chunk 2');
  });

  it('attempts every chunk rather than stopping at the first failure', async () => {
    // Stopping early would be defensible for performance and indefensible here:
    // the remaining chunks are unrelated rows, and losing them silently turns
    // one constraint violation into wholesale data loss.
    failChunkAt(0);
    const total = BATCH_SIZE * 2 + 10;

    const synced = await persistDefectBatch(manyDefects(total), 'qa_defects');

    expect(upsertMock).toHaveBeenCalledTimes(3);
    // Chunks 2 and 3 still land, so only the first 50 are lost.
    expect(synced).toBe(BATCH_SIZE + 10);
  });

  it('reports zero and surfaces the failure when the only chunk fails', async () => {
    failChunkAt(0);

    const synced = await persistDefectBatch(manyDefects(10), 'qa_defects');

    expect(synced).toBe(0);
    expect(getWriteFailures()).toHaveLength(1);
  });

  it('reports full success and clears the banner when every chunk lands', async () => {
    const total = BATCH_SIZE * 2 + 10;

    const synced = await persistDefectBatch(manyDefects(total), 'qa_defects');

    expect(synced).toBe(total);
    expect(getWriteFailures()).toHaveLength(0);
  });

  it('does not clear an earlier failure because a later chunk succeeded', async () => {
    // The failure store clears an operation's entry on the next success. With
    // chunked writes that is wrong: chunk 2 failing and chunk 3 succeeding must
    // leave the operator still looking at a banner.
    let callIndex = 0;
    upsertMock.mockImplementation(() => {
      const index = callIndex++;
      return Promise.resolve(
        index === 0
          ? { error: { message: 'chunk 1 rejected' }, data: null }
          : { error: null, data: null }
      );
    });

    await persistDefectBatch(manyDefects(BATCH_SIZE * 3), 'qa_defects');

    const failures = getWriteFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toContain('chunk 1 rejected');
  });
});