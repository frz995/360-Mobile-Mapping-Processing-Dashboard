import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { StageHistoryLedger } from '../hub/StageHistoryLedger'
import type { StageEventLedgerRow } from '../../../types/production'

vi.mock('../../../services/api/stageEventLedger', () => ({
  appendStageEventToSupabase: vi.fn(),
  fetchStageEventLedgerFromSupabase: vi.fn()
}))

import { fetchStageEventLedgerFromSupabase } from '../../../services/api/stageEventLedger'

const mockedFetch = vi.mocked(fetchStageEventLedgerFromSupabase)

const rows: StageEventLedgerRow[] = [
  {
    subgrid: 'N93E70',
    stage: 'intake',
    event: 'COMPLETED',
    via: 'operator',
    occurrence: '2026-09-26T06:00:00+00:00',
    detail: '92 coordinate record(s) parsed from master.csv',
    counts: { total: 92, matched: 92 },
    updated_by: 'Operator'
  },
  {
    subgrid: 'N93E70',
    stage: 'stitch',
    event: 'STARTED',
    via: 'agent',
    occurrence: '2026-09-26T06:30:00+00:00',
    detail: 'ptgui.exe · output in /03_Stitching/N93E70/ (PC2)',
    counts: { done: 0, total: 92 }
  },
  {
    subgrid: 'N93E70',
    stage: 'stitch',
    event: 'PROGRESS',
    via: 'agent',
    occurrence: '2026-09-26T07:10:00+00:00',
    detail: '61 frame(s) in /03_Stitching/N93E70/',
    counts: { done: 61, total: 92 }
  },
  {
    subgrid: 'N93E70',
    stage: 'lightroom',
    event: 'STARTED',
    via: 'agent',
    occurrence: '2026-09-26T07:15:00+00:00',
    detail: 'Lightroom.exe · output in /04_Lightroom/N93E70/ (PC3)',
    counts: { done: 0, total: 92 }
  },
  {
    subgrid: 'N93E70',
    stage: 'lightroom',
    event: 'FLAGGED',
    via: 'agent',
    occurrence: '2026-09-26T07:20:00+00:00',
    detail: 'Lightroom ended with 3 of 92 frames written',
    counts: { done: 3, total: 92 }
  }
]

describe('StageHistoryLedger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(cleanup)

  it('shows the empty state when nothing has happened for the subgrid', async () => {
    mockedFetch.mockResolvedValue([])
    render(<StageHistoryLedger subgrid="N93E70" totalFrames={92} />)
    await waitFor(() => {
      expect(screen.getByText('No Stage Events Yet for N93E70')).toBeInTheDocument()
    })
  })

  it('renders per-stage timelines with chips, counts and elapsed time', async () => {
    mockedFetch.mockResolvedValue(rows)
    render(<StageHistoryLedger subgrid="N93E70" totalFrames={92} />)
    await waitFor(() => {
      expect(screen.getByText('1/8')).toBeInTheDocument()
    })

    // Stage rollup: 1 of 8 stages completed (intake)
    expect(screen.getByText('Stages completed:')).toBeInTheDocument()
    expect(screen.getByText('1/8')).toBeInTheDocument()
    expect(screen.getByText('Events recorded:')).toBeInTheDocument()
    expect(screen.getByText(String(rows.length))).toBeInTheDocument()

    // stitch stage: started -> in progress chip, elapsed rendered
    const stitchChip = screen.getAllByText('In progress')
    expect(stitchChip.length).toBeGreaterThan(0)
    expect(await screen.findByText(/61 frame\(s\) in \/03_Stitching\/N93E70\//)).toBeInTheDocument()

    // lightroom flagged stage keeps its red state
    expect(screen.getAllByText('Flagged · re-runnable').length).toBeGreaterThan(0)

    // counts summary for stitch shows 61 / 92
    expect(screen.getByText('61 / 92')).toBeInTheDocument()
  })

  it('guards without a subgrid and supports refresh', async () => {
    render(<StageHistoryLedger subgrid="" totalFrames={0} />)
    expect(screen.getByText('No Subgrid Selected')).toBeInTheDocument()

    mockedFetch.mockResolvedValue([...rows])
    render(<StageHistoryLedger subgrid="N93E70" />)
    await waitFor(() => {
      expect(mockedFetch).toHaveBeenCalled()
    })
    fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => {
      expect(mockedFetch.mock.calls.length).toBeGreaterThan(1)
    })
  })
})
