import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { DailyTimeSeries, BatchLog } from '../../types/dashboard'

// Mock the Supabase service so DataManagementPage never opens a real DB client
// or makes network calls in jsdom. Every named import used by the page is
// stubbed to no-op / empty responses.
vi.mock('../../services/supabase', () => {
  const stub = () => Promise.resolve([])
  return {
    supabase: {
      from: () => ({ select: stub, insert: stub, update: stub, delete: stub }),
      channel: () => ({ on: () => ({}), subscribe: () => Promise.resolve() }),
      removeChannel: () => {}
    },
    publishToSupabase: vi.fn(async () => ({})),
    saveToStagingSupabase: vi.fn(async () => ({})),
    deleteFromStagingSupabase: vi.fn(async () => ({})),
    fetchSupabaseData: vi.fn(async () => ({ dailyData: [], batchLogs: [] })),
    deleteFromSupabase: vi.fn(async () => ({})),
    deletePointsFromSupabase: vi.fn(async () => ({})),
    verifyCsvImageFilenamesInStorage: vi.fn(async () => ({ verified: 0, missing: [], available: [] })),
    fetchDatasetsFromSupabase: vi.fn(stub),
    fetchProcessingJobsFromSupabase: vi.fn(stub),
    fetchStagingPanoramasFromSupabase: vi.fn(stub),
    saveToRecycleBinInSupabase: vi.fn(async () => ({})),
    fetchRecycleBinFromSupabase: vi.fn(stub),
    formatPIC: (raw: string, fallback: string) => (raw && raw.trim() ? raw.trim() : fallback),
    RecycleBinItem: {}
  }
})

import { DataManagementPage } from '../DataManagementPage'

const dailyFixture = (): DailyTimeSeries => ({
  id: 'd-1',
  date: '2026-01-05',
  grid: '1',
  subgrid: 'SURVEY_A',
  kmProcessed: 12.5,
  imagesProcessed: 1000,
  poiCount: 1000,
  defectCount: 2,
  captureEquipment: 'MMS',
  imagesDefected: 2,
  publishToWebGIS: 'in process',
  action: 'Imported',
  pic: 'Fariz'
})

const batchFixture = (): BatchLog => ({
  id: 'b-1',
  date: '2026-01-05',
  grid: '1',
  subgrid: 'SURVEYA',
  imageFilename: 'SURVEYA-0001.jpg',
  images: 1000,
  defects: 0,
  kmProcessed: 12.5,
  status: 'Ongoing'
})

function renderPage(props: Partial<Parameters<typeof DataManagementPage>[0]> = {}) {
  return render(
    <DataManagementPage
      dailyData={props.dailyData ?? []}
      setDailyData={props.setDailyData ?? (() => {})}
      batchLogs={props.batchLogs ?? []}
      setBatchLogs={props.setBatchLogs ?? (() => {})}
      layerCatalog={props.layerCatalog ?? []}
      setLayerCatalog={props.setLayerCatalog ?? (() => {})}
      onBackToDashboard={props.onBackToDashboard ?? (() => {})}
      initialTab={props.initialTab}
      isGuestUser={props.isGuestUser}
    />
  )
}

describe('DataManagementPage smoke', () => {
  beforeEach(() => {
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('mounts without throwing and never calls alert()', () => {
    expect(() => renderPage()).not.toThrow()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('renders a daily data row when dailyData is populated (initialTab=Daily)', () => {
    renderPage({ dailyData: [dailyFixture()], initialTab: 'daily' })
    expect(screen.getByText('SURVEY_A')).toBeInTheDocument()
    // getImagesProcessedCount returns 1000, rendered via toLocaleString -> "1,000".
    expect(screen.getByText('1,000 frames')).toBeInTheDocument()
  })

  it('renders the empty state when dailyData is empty (initialTab=Daily)', () => {
    renderPage({ dailyData: [], initialTab: 'daily' })
    expect(screen.getByText('No daily data available')).toBeInTheDocument()
  })

  it('renders a batch row when batchLogs is populated (default Batches tab)', () => {
    // reconcileBatchLogs only emits rows keyed from dailyData, so a matching
    // daily record is required for the batch row to appear.
    renderPage({ dailyData: [dailyFixture()], batchLogs: [batchFixture()] })
    // Batch rows render the normalized subgrid (extractSubgridName of SURVEY_A -> SURVEY).
    expect(screen.getByText('SURVEY')).toBeInTheDocument()
  })

  it('renders the empty state when batchLogs is empty (default Batches tab)', () => {
    renderPage({ batchLogs: [] })
    expect(screen.getByText('No batch logs available')).toBeInTheDocument()
  })
})
