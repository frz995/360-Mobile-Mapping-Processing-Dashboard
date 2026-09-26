import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { DailyProcessingRegistry } from '../hub/DailyProcessingRegistry'
import type { StationBoardRow } from '../../../types/production'

vi.mock('../../../services/api/stationBoard', () => ({
  fetchStationBoardItemsFromSupabase: vi.fn()
}))

import { fetchStationBoardItemsFromSupabase } from '../../../services/api/stationBoard'

const mockedFetchRows = vi.mocked(fetchStationBoardItemsFromSupabase)

const registryPayload = {
  success: true,
  registry: [
    {
      subgrid: 'N93E70',
      existsInStitching: true,
      totals: { surveys: 2, stitchedRuns: 2, metadataTotal: 288, imagesTotal: 288 },
      children: [
        { name: '20220904', date: '2022-09-04', stitched: true, images: 92, metadataRows: 92, csvName: '20220904.csv', hasMetadata: true, stitchingPath: '/03_Stitching/Project-OUT/Grid 1/N93E70/20220904/' },
        { name: 'BP_20220630', date: '2022-06-30', stitched: true, images: 196, metadataRows: 196, csvName: 'BP_20220630.csv', hasMetadata: true, stitchingPath: '/03_Stitching/Project-OUT/Grid 1/N93E70/BP_20220630/' }
      ]
    },
    {
      subgrid: 'N94E70',
      existsInStitching: false,
      totals: { surveys: 1, stitchedRuns: 0, metadataTotal: 40, imagesTotal: 0 },
      children: [
        { name: '20220807', date: '2022-08-07', stitched: false, images: 0, metadataRows: 40, csvName: '20220807.csv', hasMetadata: true, stitchingPath: '/03_Stitching/Project-OUT/Grid 1/N94E70/20220807/' }
      ]
    }
  ]
}

function boardRow(subgrid: string, station: string, status: StationBoardRow['status']): StationBoardRow {
  return { project_id: null, subgrid, station_id: station as any, status, total_frames: 92, completed_frames: status === 'COMPLETED' ? 92 : 0 }
}

const allDone: StationBoardRow[] = (['blur', 'stitch', 'lightroom', 'photoshop'] as const).map((s) => boardRow('N93E70', s, 'COMPLETED'))
const partial: StationBoardRow[] = [boardRow('N94E70', 'blur', 'FLAGGED'), boardRow('N94E70', 'stitch', 'IN_PROGRESS')]

describe('DailyProcessingRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetchRows.mockResolvedValue([...allDone, ...partial])
  })

  afterEach(cleanup)

  function mockRegistryFetch() {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('action=registry')) {
        return { ok: true, json: async () => registryPayload }
      }
      throw new TypeError('unmocked')
    }))
  }

  it('renders parent subgrids with totals and the 4-PC pipeline verdict', async () => {
    mockRegistryFetch()
    render(<DailyProcessingRegistry />)
    await waitFor(() => {
      expect(screen.getByText('N93E70')).toBeInTheDocument()
    })
    expect(screen.getByText('(2 runs)')).toBeInTheDocument()
    expect(screen.getAllByText('288').length).toBeGreaterThanOrEqual(3) // summary + parent totals
    expect(screen.getByText('Passed all 4 stages')).toBeInTheDocument()
    expect(screen.getByText('Not passed — 0/4 stages')).toBeInTheDocument()
    expect(screen.getByText(/PC 1 flagged \(early exit\) · PC 2 in progress/)).toBeInTheDocument()
  })

  it('expands a parent into its child survey runs', async () => {
    mockRegistryFetch()
    render(<DailyProcessingRegistry />)
    await waitFor(() => {
      expect(screen.getByText('N93E70')).toBeInTheDocument()
    })
    expect(screen.queryByText('BP_20220630')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Show 2 survey run(s)'))
    expect(screen.getByText('BP_20220630')).toBeInTheDocument()
    expect(screen.getByText('20220904')).toBeInTheDocument()
    expect(screen.getAllByText('196').length).toBe(2) // BP child meta + images
    expect(screen.getAllByText('92').length).toBe(2) // 20220904 child meta + images
    expect(screen.getByText('20220904.csv')).toBeInTheDocument()
  })

  it('shows the empty state when the registry is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down') }))
    render(<DailyProcessingRegistry />)
    await waitFor(() => {
      expect(screen.getByText(/No survey data found under the NAS working base yet/i)).toBeInTheDocument()
    })
    expect(mockedFetchRows).toHaveBeenCalled()
  })
})