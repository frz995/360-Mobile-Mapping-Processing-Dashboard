import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { fromMock, upsertMock, getActiveProjectIdMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
  getActiveProjectIdMock: vi.fn()
}))

// The module pulls the Supabase client through the `services/supabase` barrel
// and the project id through `services/projectContext`, so both are mocked at
// those paths rather than at their defining modules.
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

// Mirrors QA_DEFECTS_BATCH_SIZE in the module under test; asserted indirectly by
// the chunking test.
const QAQC_DEFECT_BATCH_SIZE = 50

function defect(overrides: Partial<QADefectRecord> = {}): QADefectRecord {
  return {
    subgrid: 'N93E70',
    point_id: 'N93E70-0001.jpg',
    frame_index: 1,
    defect_flags: { blur: true },
    defect_type: 'Blur',
    pic: 'Operator',
    ...overrides
  }
}

describe('persistDefectBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertMock.mockResolvedValue({ error: null, data: null })
    fromMock.mockImplementation(() => ({ upsert: upsertMock }))
    getActiveProjectIdMock.mockReturnValue('project-1')
    clearWriteFailures()
  })

  afterEach(() => clearWriteFailures())

  // Regression: `item_key` is NOT NULL on installs carrying the column, is in
  // no migration, and was never written here. Every batch was rejected with
  // `null value in column "item_key" ... violates not-null constraint`, so a
  // completed audit looked saved and vanished on refresh.
  it('mirrors point_id into item_key on every row', async () => {
    await persistDefectBatch([defect(), defect({ point_id: 'N93E70-0002.jpg' })], 'qa_defects')

    const chunk = upsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(chunk).toHaveLength(2)
    expect(chunk[0].item_key).toBe('N93E70-0001.jpg')
    expect(chunk[1].item_key).toBe('N93E70-0002.jpg')
  })

  it('leaves no row with a null item_key', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      defect({ point_id: `N93E70-${String(i + 1).padStart(4, '0')}.jpg` })
    )
    await persistDefectBatch(many, 'qa_defects')

    const chunk = upsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    for (const row of chunk) {
      expect(row.item_key).toBeTruthy()
      expect(row.item_key).not.toBeNull()
    }
  })

  it('prefers an explicit item_key when the record carries one', async () => {
    await persistDefectBatch([defect({ item_key: 'legacy-0001' })], 'qa_defects')

    const chunk = upsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(chunk[0].item_key).toBe('legacy-0001')
  })

  it('stamps the run the audit is for', async () => {
    await persistDefectBatch([defect()], 'qa_defects', undefined, 'spd-n93e70-08apr2022')

    const chunk = upsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(chunk[0].run_id).toBe('spd-n93e70-08apr2022')
    expect(chunk[0].project_id).toBe('project-1')
  })

  it('lets a per-record run_id win over the run-wide one', async () => {
    await persistDefectBatch([defect({ run_id: 'run-from-record' })], 'qa_defects', undefined, 'run-wide')

    const chunk = upsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(chunk[0].run_id).toBe('run-from-record')
  })

  it('writes null run_id when the audit is subgrid-wide', async () => {
    await persistDefectBatch([defect()], 'qa_defects')

    const chunk = upsertMock.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(chunk[0].run_id).toBeNull()
  })

  it('targets the project-scoped conflict key', async () => {
    await persistDefectBatch([defect()], 'qa_defects')
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: 'project_id,subgrid,run_id,point_id' })

    upsertMock.mockClear()
    getActiveProjectIdMock.mockReturnValue(null)
    await persistDefectBatch([defect()], 'qa_defects')
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: 'subgrid,run_id,point_id' })
  })

  it('chunks large runs so no single statement is oversized', async () => {
    const total = QAQC_DEFECT_BATCH_SIZE + 5
    const many = Array.from({ length: total }, (_, i) =>
      defect({ point_id: `N93E70-${String(i + 1).padStart(4, '0')}.jpg` })
    )

    await persistDefectBatch(many, 'qa_defects')

    expect(upsertMock).toHaveBeenCalledTimes(2)
    expect((upsertMock.mock.calls[0][0] as unknown[]).length).toBe(QAQC_DEFECT_BATCH_SIZE)
    expect((upsertMock.mock.calls[1][0] as unknown[]).length).toBe(5)
  })

  // A constraint violation is deterministic, so `withRetry` does not retry it
  // (retry.ts only retries network-ish errors). One attempt, zero synced — and
  // the banner reports it, which is how the item_key rejection surfaced.
  it('does not retry a constraint violation and reports zero synced', async () => {
    upsertMock.mockResolvedValue({
      error: { message: 'null value in column "item_key" violates not-null constraint' },
      data: null
    })

    const synced = await persistDefectBatch([defect()], 'qa_defects')

    expect(synced).toBe(0)
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces the rejection through the write-failure banner', async () => {
    upsertMock.mockResolvedValue({
      error: { message: 'null value in column "item_key" violates not-null constraint' },
      data: null
    })

    await persistDefectBatch([defect()], 'qa_defects')

    const failures = getWriteFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0].op).toBe(QAQC_WRITE_OPS.defectBatch)
    expect(failures[0].detail).toContain('item_key')
  })

  it('does not throw when the write is rejected outright', async () => {
    upsertMock.mockRejectedValue(new Error('boom'))
    await expect(persistDefectBatch([defect()], 'qa_defects')).resolves.toBe(0)
  })

  it('retries a transient network failure', async () => {
    upsertMock.mockRejectedValue(new Error('Failed to fetch'))
    await persistDefectBatch([defect()], 'qa_defects')

    // Network errors are retryable, so more than the single initial attempt.
    expect(upsertMock.mock.calls.length).toBeGreaterThan(1)
  })
})
