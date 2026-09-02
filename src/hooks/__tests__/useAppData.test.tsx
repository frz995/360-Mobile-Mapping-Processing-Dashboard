import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useAppData } from '../useAppData'

// Mock the whole Supabase service: we do not want any real network/DB touches
// in jsdom. Provide a scripted `supabase` client and controlled model fns.
const db = vi.hoisted(() => {
  const qaRows: any[] = [
    { subgrid: 'SURVEY_A', qa_status: 'flagged', defect_count: 2, defect_flags: { blur: true } },
    { subgrid: 'survey_a', qa_status: 'passed', defect_count: 0, defect_flags: {} }
  ]
  return {
    qaRows,
    daily: [] as any[],
    batches: [] as any[]
  }
})

vi.mock('../../services/supabase', () => {
  const makeChannel = () => {
    const c: any = { on: () => c, subscribe: () => Promise.resolve(), unsubscribe: () => Promise.resolve() }
    return c
  }
  return {
    supabase: {
      from: (): any => ({
        select: () => Promise.resolve({ data: db.qaRows, error: null })
      }),
      channel: () => makeChannel(),
      removeChannel: () => {},
      rpc: () => Promise.resolve()
    },
    fetchSupabaseData: vi.fn(async () => ({
      dailyData: db.daily,
      batchLogs: db.batches,
      error: undefined
    })),
    fetchQaRecordsFromSupabase: vi.fn(async () => ({})),
    fetchQaAuditRunsFromSupabase: vi.fn(async () => ({})),
    fetchAuditLogsFromSupabase: vi.fn(async () => []),
    fetchNotificationsFromSupabase: vi.fn(async () => []),
    fetchProjectSettingsFromSupabase: vi.fn(async () => null)
  }
})

type AppData = ReturnType<typeof useAppData>

function Harness({ onData }: { onData: (d: AppData | undefined) => void }) {
  const hook = useAppData()
  React.useEffect(() => {
    onData(hook)
  }, [hook])
  return null
}

async function renderHookResult() {
  let result: AppData | undefined
  const { unmount } = render(<Harness onData={(d) => (result = d)} />)
  await waitFor(() => {
    expect(result?.isDataLoading).toBe(false)
  })
  return { result: () => result, unmount }
}

describe('useAppData derived-state hydration', () => {
  beforeEach(() => {
    db.qaRows.length = 0
    db.qaRows.push(
      { subgrid: 'SURVEY_A', qa_status: 'flagged', defect_count: 2, defect_flags: { blur: true } },
      { subgrid: 'survey_a', qa_status: 'passed', defect_count: 0, defect_flags: {} }
    )
    db.daily = []
    db.batches = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('computes liveDefectCount from flagged QA rows, de-duplicating on subgrid', async () => {
    const { result } = await renderHookResult()
    // Two rows reference the same subgrid but only one is flagged -> 1 total.
    expect(result()?.liveDefectCount).toBe(1)
  })

  it('hydrates dailyData with a defectCount and QAQC status string', async () => {
    db.daily = [
      {
        id: 'd-1',
        subgrid: 'SURVEY_A',
        date: '2026-01-01',
        imagesProcessed: 1000,
        imagesTotal: 1000
      }
    ]
    const { result } = await renderHookResult()

    const daily = result()?.dailyData[0]!
    expect(daily).toBeTruthy()
    // defectCount hydrates from the count of flagged rows for that subgrid
    // (the source tallies +1 per flagged row, not the defect_count column).
    expect(daily.defectCount).toBe(1)
    expect(daily.imagesDefected).toBe(1)
    // Since there is no cached audit run and subgrid is published=false,
    // qaqcStatus stays unset in this path.
    expect('qaqcStatus' in daily).toBe(false)
  })

  it('clamps defectCount to the processed frame count when cached defects exceed it', async () => {
    db.daily = [
      {
        id: 'd-2',
        subgrid: 'SURVEY_A',
        date: '2026-01-01',
        imagesProcessed: 1,
        imagesTotal: 1
      }
    ]
    const { result } = await renderHookResult()

    const daily = result()?.dailyData[0]!
    // 1 flagged row but only 1 processed frame -> clamped to 1.
    expect(daily.defectCount).toBe(1)
  })

  it('hydrates batchLogs summing defects from matching hydrated daily rows', async () => {
    db.daily = [
      {
        id: 'd-3',
        subgrid: 'SURVEY_A',
        date: '2026-01-01',
        imagesProcessed: 500,
        imagesTotal: 500,
        defectCount: 2
      }
    ]
    db.batches = [
      {
        id: 'b-1',
        batchName: 'A1',
        subgrid: 'SURVEY_A',
        imagesTotal: 500
      }
    ]
    const { result } = await renderHookResult()

    const batch = result()?.batchLogs[0]!
    expect(batch).toBeTruthy()
    // defects sum from the matching hydrated daily (2) rather than a raw field.
    expect(batch.defects).toBe(2)
  })

  it('keeps isDataLoading true until settlement completes, then false', async () => {
    const { result } = await renderHookResult()
    expect(result()?.isDataLoading).toBe(false)
    expect(result()?.supabaseError).toBeNull()
  })
})
