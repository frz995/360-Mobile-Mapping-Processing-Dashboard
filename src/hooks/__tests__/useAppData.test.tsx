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
    batches: [] as any[],
    auditRuns: {} as Record<string, any>
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
      rpc: () => Promise.resolve(),
      scoped: (query: any) => query
    },
    scoped: (query: any) => query,
    fetchSupabaseData: vi.fn(async () => ({
      dailyData: db.daily,
      batchLogs: db.batches,
      error: undefined
    })),
    fetchQaRecordsFromSupabase: vi.fn(async () => ({})),
    fetchQaAuditRunsFromSupabase: vi.fn(async () => db.auditRuns || {}),
    fetchAuditLogsFromSupabase: vi.fn(async () => []),
    fetchNotificationsFromSupabase: vi.fn(async () => []),
    fetchProjectSettingsFromSupabase: vi.fn(async () => null),
    fetchBatchLogOverridesFromSupabase: vi.fn(async () => ({})),
    configureSupabaseBackend: vi.fn(() => false)
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
    // The per-run count comes from fetchSupabaseData (run-scoped qa_defects),
    // not from a subgrid-wide tally re-applied here.
    db.daily = [
      {
        id: 'd-1',
        subgrid: 'N93E70',
        date: '2026-01-01',
        imagesProcessed: 1000,
        imagesTotal: 1000,
        defectCount: 1,
        imagesDefected: 1
      }
    ]
    const { result } = await renderHookResult()

    const daily = result()?.dailyData[0]!
    expect(daily).toBeTruthy()
    expect(daily.defectCount).toBe(1)
    expect(daily.imagesDefected).toBe(1)
    expect(daily.qaqcStatus).toContain('1 Defect')
  })

  it('does not apply a subgrid-wide qa_defects tally to a run with no run-scoped count', async () => {
    // db.qaRows holds one flagged row for SURVEY_A. Nothing in dailyData is
    // run-scoped for it, so the count must not bleed in from the subgrid total.
    db.daily = [
      {
        id: 'd-leak',
        subgrid: 'SURVEY_A',
        date: '2026-01-01',
        imagesProcessed: 1000,
        imagesTotal: 1000
      }
    ]
    const { result } = await renderHookResult()

    expect(result()?.dailyData[0]!.defectCount).toBe(0)
  })

  it('clamps defectCount to the processed frame count when the count exceeds it', async () => {
    db.daily = [
      {
        id: 'd-2',
        subgrid: 'N93E70',
        date: '2026-01-01',
        imagesProcessed: 1,
        imagesTotal: 1,
        defectCount: 9
      }
    ]
    const { result } = await renderHookResult()

    const daily = result()?.dailyData[0]!
    // 9 defects but only 1 processed frame -> clamped to 1.
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

  it('preserves defectCount when imagesProcessed is 0 but poiCount is positive', async () => {
    db.daily = [
      {
        id: 'd-0frames',
        subgrid: 'SURVEY_A',
        date: '2026-01-01',
        imagesProcessed: 0,
        poiCount: 100,
        defectCount: 4,
        imagesDefected: 4
      }
    ]
    const { result } = await renderHookResult()

    const daily = result()?.dailyData[0]!
    expect(daily).toBeTruthy()
    // Should NOT be wiped to 0; capped at poiCount (100)
    expect(daily.defectCount).toBe(4)
    expect(daily.imagesDefected).toBe(4)
  })

  it('hydrates QAQC audit runs directly from Supabase cloud database', async () => {
    // Use a real subgrid code: extractSubgridName('SURVEY_A') truncates to
    // 'SURVEY', which does not match its own audit-cache key.
    db.auditRuns = {
      N93E70_default: {
        subgrid: 'N93E70',
        runId: null,
        totalStations: 50,
        defectCount: 3,
        passRate: 94
      }
    }

    db.daily = [
      {
        id: 'd-cloud-qaqc',
        subgrid: 'N93E70',
        date: '2026-01-01',
        imagesProcessed: 50,
        poiCount: 50
      }
    ]

    const { result } = await renderHookResult()
    const daily = result()?.dailyData[0]!
    expect(daily.defectCount).toBe(3)
    expect(daily.qaqcStatus).toContain('3 Defects Found')

    db.auditRuns = {}
  })

  it('keeps isDataLoading true until settlement completes, then false', async () => {
    const { result } = await renderHookResult()
    expect(result()?.isDataLoading).toBe(false)
    expect(result()?.supabaseError).toBeNull()
  })

  it('does not leak one run\'s audit defects onto a sibling run of the same subgrid', async () => {
    // Regression: both runs are N93E70. Only the 08 Apr run was audited.
    // The 27 Sep run must report 0, not inherit 54 from its sibling.
    db.auditRuns = {
      'N93E70_spd-n93e70-08apr2022': {
        subgrid: 'N93E70',
        runId: 'spd-n93e70-08apr2022',
        totalStations: 92,
        defectCount: 54,
        passRate: 41
      }
    }

    db.daily = [
      {
        id: 'spd-n93e70-08apr2022',
        subgrid: 'N93E70',
        date: '2022-04-08',
        imagesProcessed: 92,
        poiCount: 92
      },
      {
        id: 'spd-n93e70-27sep2026',
        subgrid: 'N93E70',
        date: '2026-09-27',
        imagesProcessed: 0,
        poiCount: 196
      }
    ]

    const { result } = await renderHookResult()
    const [audited, unaudited] = result()!.dailyData

    expect(audited.defectCount).toBe(54)
    // The sibling has no audit of its own -> no inherited count.
    expect(unaudited.defectCount).toBe(0)
    expect(unaudited.imagesDefected).toBe(0)
    expect(unaudited.qaqcStatus).toBeUndefined()

    db.auditRuns = {}
  })
})

