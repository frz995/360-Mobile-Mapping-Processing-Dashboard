import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import type { DailyTimeSeries, BatchLog } from '../../types/dashboard'
import { deleteFromSupabase, fetchStagingPanoramasFromSupabase, publishToSupabase, saveDeletionRequestToSupabase, verifyCsvImageFilenamesInStorage } from '../../services/supabase'

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
    publishToSupabase: vi.fn(async () => ({ success: true, message: 'Published' })),
    saveToStagingSupabase: vi.fn(async () => ({})),
    deleteFromStagingSupabase: vi.fn(async () => ({})),
    fetchSupabaseData: vi.fn(async () => ({ dailyData: [], batchLogs: [] })),
    deleteFromSupabase: vi.fn(async () => ({})),
    deletePointsFromSupabase: vi.fn(async () => ({})),
    verifyCsvImageFilenamesInStorage: vi.fn(async () => ({ availableCount: 0, verifiedFilenames: [] })),
    fetchDatasetsFromSupabase: vi.fn(stub),
    fetchProcessingJobsFromSupabase: vi.fn(stub),
    fetchStagingPanoramasFromSupabase: vi.fn(stub),
    saveToRecycleBinInSupabase: vi.fn(async () => ({})),
    fetchRecycleBinFromSupabase: vi.fn(stub),
    saveDeletionRequestToSupabase: vi.fn(async () => true),
    saveAuditLogToSupabase: vi.fn(async () => true),
    persistBatchLogToSupabase: vi.fn(async () => true),
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
      projectSettings={props.projectSettings}
      addNotification={props.addNotification}
      addAuditLog={props.addAuditLog}
      canHandleApprovals={props.canHandleApprovals}
    />
  )
}

describe('DataManagementPage smoke', () => {
  beforeEach(() => {
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.mocked(publishToSupabase).mockResolvedValue({ success: true, message: 'Published' })
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

  it('routes a whole-subgrid delete to the approval queue when the gate is enabled', async () => {
    const submitTicket = vi.mocked(saveDeletionRequestToSupabase)
    const hardDelete = vi.mocked(deleteFromSupabase)
    submitTicket.mockClear()
    hardDelete.mockClear()
    submitTicket.mockResolvedValue(true)

    renderPage({
      dailyData: [dailyFixture()],
      initialTab: 'daily',
      projectSettings: { requireAdminApprovalForDelete: true },
      addNotification: vi.fn(),
      addAuditLog: vi.fn()
    })

    // Open the single-delete modal for the daily record and confirm.
    fireEvent.click(screen.getAllByTitle(/Delete Record/)[0])
    fireEvent.change(screen.getByPlaceholderText('SURVEY'), { target: { value: 'SURVEY' } })
    fireEvent.change(screen.getByPlaceholderText('Enter account password'), { target: { value: 'ADMIN123' } })

    const confirmBtn = screen.getByRole('button', { name: /Authorize & Submit Deletion/ })
    await waitFor(() => expect(confirmBtn).toBeEnabled())
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(submitTicket).toHaveBeenCalled())
    expect(submitTicket).toHaveBeenCalledWith(
      expect.objectContaining({ subgrid: 'SURVEY', requestedBy: 'Operator', reason: expect.any(String) })
    )
    expect(hardDelete).not.toHaveBeenCalled()
  })

  it('hard-deletes directly when the approval gate is disabled', async () => {
    const submitTicket = vi.mocked(saveDeletionRequestToSupabase)
    const hardDelete = vi.mocked(deleteFromSupabase)
    submitTicket.mockClear()
    hardDelete.mockClear()

    renderPage({
      dailyData: [dailyFixture()],
      initialTab: 'daily',
      projectSettings: { requireAdminApprovalForDelete: false },
      addNotification: vi.fn(),
      addAuditLog: vi.fn()
    })

    fireEvent.click(screen.getAllByTitle(/Delete Record/)[0])
    fireEvent.change(screen.getByPlaceholderText('SURVEY'), { target: { value: 'SURVEY' } })
    fireEvent.change(screen.getByPlaceholderText('Enter account password'), { target: { value: 'ADMIN123' } })

    const confirmBtn = screen.getByRole('button', { name: /Authorize & Delete Permanently/ })
    await waitFor(() => expect(confirmBtn).toBeEnabled())
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(hardDelete).toHaveBeenCalled())
    expect(submitTicket).not.toHaveBeenCalled()
  })

  it('bypasses the approval gate for approvers (admin deletes directly)', async () => {
    const submitTicket = vi.mocked(saveDeletionRequestToSupabase)
    const hardDelete = vi.mocked(deleteFromSupabase)
    submitTicket.mockClear()
    hardDelete.mockClear()

    renderPage({
      dailyData: [dailyFixture()],
      initialTab: 'daily',
      projectSettings: { requireAdminApprovalForDelete: true },
      canHandleApprovals: true,
      addNotification: vi.fn(),
      addAuditLog: vi.fn()
    })

    fireEvent.click(screen.getAllByTitle(/Delete Record/)[0])
    fireEvent.change(screen.getByPlaceholderText('SURVEY'), { target: { value: 'SURVEY' } })
    fireEvent.change(screen.getByPlaceholderText('Enter account password'), { target: { value: 'ADMIN123' } })

    // Admins see the permanent-delete wording, not the submit-for-approval flow.
    const confirmBtn = screen.getByRole('button', { name: /Authorize & Delete Permanently/ })
    expect(screen.queryByRole('button', { name: /Authorize & Submit Deletion/ })).not.toBeInTheDocument()
    await waitFor(() => expect(confirmBtn).toBeEnabled())
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(hardDelete).toHaveBeenCalled())
    expect(submitTicket).not.toHaveBeenCalled()
  })

  it('reverts a blocked single-record publish', async () => {
    const setDailyData = vi.fn()
    vi.mocked(publishToSupabase).mockResolvedValue({
      success: false,
      message: 'Publication blocked: QA approval is required before handoff.'
    })

    renderPage({
      dailyData: [dailyFixture()],
      setDailyData,
      initialTab: 'daily'
    })

    fireEvent.click(screen.getByTitle('Click to publish to database'))

    await waitFor(() => expect(publishToSupabase).toHaveBeenCalled())
    await waitFor(() => {
      const latest = setDailyData.mock.calls[setDailyData.mock.calls.length - 1]?.[0] as DailyTimeSeries[] | undefined
      expect(latest?.[0]).toEqual(expect.objectContaining({
        publishToWebGIS: 'in process',
        isSyncedWithSupabase: false,
        action: 'Publish failed'
      }))
    })
    expect(screen.getByText(/Publication blocked: QA approval/)).toBeInTheDocument()
  })

  it('reverts a single publish when the publisher throws', async () => {
    const setDailyData = vi.fn()
    vi.mocked(publishToSupabase).mockRejectedValue(new Error('Publisher unavailable'))

    renderPage({
      dailyData: [dailyFixture()],
      setDailyData,
      initialTab: 'daily'
    })

    fireEvent.click(screen.getByTitle('Click to publish to database'))

    await waitFor(() => expect(publishToSupabase).toHaveBeenCalled())
    await waitFor(() => {
      const latest = setDailyData.mock.calls[setDailyData.mock.calls.length - 1]?.[0] as DailyTimeSeries[] | undefined
      expect(latest?.[0]).toEqual(expect.objectContaining({
        publishToWebGIS: 'in process',
        action: 'Publish failed'
      }))
    })
    expect(screen.getByText('Publisher unavailable')).toBeInTheDocument()
  })

  it('reverts a background auto-publish when an id-less daily record is saved', async () => {
    const setDailyData = vi.fn()
    const idlessDaily = { ...dailyFixture(), id: undefined, kmProcessed: 0 }
    vi.mocked(publishToSupabase).mockClear()
    vi.mocked(publishToSupabase).mockResolvedValue({
      success: false,
      message: 'Publication blocked: the release is not active.'
    })

    renderPage({
      dailyData: [idlessDaily],
      setDailyData,
      initialTab: 'daily'
    })

    fireEvent.click(screen.getByTitle('Edit Record'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'yes' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/ }))

    await waitFor(() => expect(publishToSupabase).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      const latest = setDailyData.mock.calls[setDailyData.mock.calls.length - 1]?.[0] as DailyTimeSeries[] | undefined
      expect(latest?.[0]).toEqual(expect.objectContaining({
        id: expect.any(String),
        publishToWebGIS: 'in process',
        isSyncedWithSupabase: false,
        action: 'Publish failed'
      }))
    })
    expect(screen.getByText(/Publication blocked: the release is not active/)).toBeInTheDocument()
  })

  it('reverts failed items during bulk publishing', async () => {
    const setDailyData = vi.fn()
    vi.mocked(publishToSupabase).mockResolvedValue({
      success: false,
      message: 'Publication blocked: the release is not active.'
    })

    renderPage({
      dailyData: [dailyFixture()],
      setDailyData,
      initialTab: 'daily'
    })

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByRole('button', { name: /Publish Selected/ }))

    await waitFor(() => expect(publishToSupabase).toHaveBeenCalled())
    await waitFor(() => {
      const latest = setDailyData.mock.calls[setDailyData.mock.calls.length - 1]?.[0] as DailyTimeSeries[] | undefined
      expect(latest?.[0]).toEqual(expect.objectContaining({
        publishToWebGIS: 'in process',
        isSyncedWithSupabase: false,
        action: 'Publish failed'
      }))
    })
    expect(screen.getByText(/0 published; 1 failed/)).toBeInTheDocument()
  })

  it('renders POI column header in both Masterlist and Daily tables', () => {
    // 1. Daily Tab
    const { unmount } = renderPage({ dailyData: [dailyFixture()], initialTab: 'daily' })
    const dailyPoiHeader = screen.getByRole('columnheader', { name: 'POI' })
    expect(dailyPoiHeader).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Frames' })).toBeNull()
    unmount()

    // 2. Masterlist Tab (batches)
    renderPage({ batchLogs: [batchFixture()], initialTab: 'batches' })
    const masterPoiHeader = screen.getByRole('columnheader', { name: 'POI' })
    expect(masterPoiHeader).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Frames' })).toBeNull()
  })

  describe('CSV import with raw survey filenames', () => {
    const CsvHeader = 'filename,latitude,longitude'
    const newRow = (name: string, lat: string) => `${name},${lat},101.5`

    const importFiles = async (
      files: { name: string; content: string }[],
      onPreview?: () => void
    ) => {
      const setDailyData = vi.fn()
      const addNotification = vi.fn()
      renderPage({ setDailyData, dailyData: [], addNotification })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      // jsdom's File has no text(), so mirror the slice of the File API the page uses.
      const fileLike = files.map((f) => ({ name: f.name, text: async () => f.content }))
      fireEvent.change(input, { target: { files: fileLike } })
      await screen.findByText(/Staging Subgrids Summary/)
      onPreview?.()
      fireEvent.click(screen.getByRole('button', { name: /Import Data/ }))
      await waitFor(() => expect(setDailyData).toHaveBeenCalled())
      const latest = setDailyData.mock.calls[setDailyData.mock.calls.length - 1]?.[0] as DailyTimeSeries[]
      // Imported records are keyed by their real raw CSV name, never a synthetic
      // `daily-csv-<timestamp>-…` id.
      return { records: latest.filter((d) => String(d.id).startsWith('csv-')), addNotification }
    }

    beforeEach(() => {
      vi.mocked(fetchStagingPanoramasFromSupabase).mockResolvedValue([])
      vi.mocked(verifyCsvImageFilenamesInStorage).mockResolvedValue({ availableCount: 0, verifiedFilenames: [] })
    })

    it('takes the subgrid from row filenames, not from date-only CSV names', async () => {
      const { records } = await importFiles([
        { name: '20220904.csv', content: `${CsvHeader}\n${newRow('N93E70-0001.jpg', '3.1')}\n${newRow('N93E70-0002.jpg', '3.2')}` }
      ])

      expect(records).toHaveLength(1)
      expect(records[0].subgrid).toBe('N93E70')
      expect(records[0].date).toBe('2022-09-04')
      expect(records[0].csvFileName).toBe('20220904.csv')
      expect(records[0].panoramas?.map((p) => p.filename)).toEqual(['N93E70-0001.jpg', 'N93E70-0002.jpg'])
    })

    it('records the real raw CSV name, not a synthetic import id', async () => {
      const { records } = await importFiles([
        { name: '20220904.csv', content: `${CsvHeader}\n${newRow('N93E70-0001.jpg', '3.1')}` }
      ])

      expect(records[0].id).toBe('csv-20220904.csv#0-N93E70')
      expect(records[0].csvFileName).toBe('20220904.csv')
    })

    it('reads Backpack and survey date from a prefixed CSV name', async () => {
      const { records } = await importFiles([
        { name: 'BP_20220630.csv', content: `${CsvHeader}\n${newRow('N93E70-0100.jpg', '3.3')}` }
      ])

      expect(records[0].subgrid).toBe('N93E70')
      expect(records[0].captureEquipment).toBe('Backpack')
      expect(records[0].date).toBe('2022-06-30')
    })

    it('keeps the same subgrid on different survey dates as separate runs', async () => {
      const { records } = await importFiles([
        { name: '20220904.csv', content: `${CsvHeader}\n${newRow('N93E70-0001.jpg', '3.1')}` },
        { name: 'BP_20220630.csv', content: `${CsvHeader}\n${newRow('N93E70-0900.jpg', '3.9')}` }
      ])

      expect(records).toHaveLength(2)
      expect(records.every((r) => r.subgrid === 'N93E70')).toBe(true)
      expect(records.every((r) => r.panoramas?.length === 1)).toBe(true)
      expect(records.map((r) => r.date).sort()).toEqual(['2022-06-30', '2022-09-04'])
    })

    it('skips image filenames already staged but still imports the new ones', async () => {
      vi.mocked(fetchStagingPanoramasFromSupabase).mockResolvedValue([
        { filename: 'N93E70-0001.jpg' } as { filename?: string }
      ])

      const { records, addNotification } = await importFiles(
        [{ name: '20220904.csv', content: `${CsvHeader}\n${newRow('N93E70-0001.jpg', '3.1')}\n${newRow('N93E70-0002.jpg', '3.2')}` }],
        () => expect(screen.getByText(/1 duplicate\(s\) will be skipped/)).toBeInTheDocument()
      )

      expect(records[0].panoramas?.map((p) => p.filename)).toEqual(['N93E70-0002.jpg'])
      await waitFor(() => expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Duplicate images skipped' })
      ))
    })

    it('skips a filename repeated across two selected CSVs', async () => {
      const { records, addNotification } = await importFiles([
        { name: '20220904.csv', content: `${CsvHeader}\n${newRow('N93E70-0001.jpg', '3.1')}` },
        { name: '20220905.csv', content: `${CsvHeader}\n${newRow('N93E70-0001.jpg', '3.1')}` }
      ])

      const kept = records.flatMap((r) => (r.panoramas || []).map((p) => p.filename))
      expect(kept).toEqual(['N93E70-0001.jpg'])
      await waitFor(() => expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Duplicate images skipped' })
      ))
    })

    it('imports every image when the subgrid repeats with different filenames', async () => {
      const { records, addNotification } = await importFiles([
        { name: '20220904.csv', content: `${CsvHeader}\n${newRow('N93E70-0001.jpg', '3.1')}` },
        { name: '20220905.csv', content: `${CsvHeader}\n${newRow('N93E70-0002.jpg', '3.1')}` }
      ])

      expect(records.flatMap((r) => (r.panoramas || []).map((p) => p.filename))).toEqual([
        'N93E70-0001.jpg',
        'N93E70-0002.jpg'
      ])
      expect(addNotification).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Duplicate images skipped' })
      )
    })
  })

  describe('CSV import merge notice for an existing subgrid', () => {
    const CsvHeader = 'filename,latitude,longitude'
    const existingRun = (): DailyTimeSeries => ({
      ...dailyFixture(),
      subgrid: 'N93E70',
      date: '2022-06-30',
      panoramas: [{ filename: 'N93E70-0001.jpg', latitude: 3.1, longitude: 101.5 }]
    })

    const openImport = (files: { name: string; content: string }[]) => {
      renderPage({ dailyData: [existingRun()], initialTab: 'batches' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, {
        target: { files: files.map((f) => ({ name: f.name, text: async () => f.content })) }
      })
      return screen.findByText(/Staging Subgrids Summary/)
    }

    it('announces a merge instead of a duplicate for the same subgrid', async () => {
      await openImport([
        { name: '20220904.csv', content: `${CsvHeader}\nN93E70-0042.jpg,3.4,101.6\nN93E70-0043.jpg,3.5,101.7` }
      ])

      expect(screen.getByText(/Data match as subgrid N93E70/)).toBeInTheDocument()
      expect(screen.getByText(/will be merged to parent subgrid N93E70/)).toBeInTheDocument()
      expect(screen.getByText('(merges into existing)')).toBeInTheDocument()
      expect(screen.queryByText(/Multiple data detected/)).toBeNull()
      expect(screen.queryByText(/Duplicate/)).toBeNull()
    })

    it('never lists the equipment or date part of a raw filename as a subgrid', async () => {
      await openImport([
        { name: 'BP_20220630.csv', content: `${CsvHeader}\nN93E70-0100.jpg,3.3,101.5` }
      ])

      expect(screen.queryByText('BP')).toBeNull()
      expect(screen.getAllByText('N93E70').length).toBeGreaterThan(0)
      // The raw name is kept as provenance under the resolved subgrid, never as one.
      expect(screen.getByTitle('BP_20220630.csv')).toBeInTheDocument()
    })

    it('merges a continuation CSV whose filenames carry no subgrid code', async () => {
      const setDailyData = vi.fn()
      renderPage({ dailyData: [existingRun()], setDailyData, initialTab: 'batches' })
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, {
        target: {
          files: [{ name: '20220904.csv', text: async () => `${CsvHeader}\nN93E70-0099.jpg,3.3,101.5` }]
        }
      })
      await screen.findByText(/Staging Subgrids Summary/)

      const subgridInput = screen.getByPlaceholderText(/Auto-detected from image filenames/)
      fireEvent.change(subgridInput, { target: { value: 'N93E70' } })
      expect(screen.getByText(/Data match as subgrid N93E70/)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Import Data/ }))
      await waitFor(() => expect(setDailyData).toHaveBeenCalled())
      const latest = setDailyData.mock.calls[setDailyData.mock.calls.length - 1]?.[0] as DailyTimeSeries[]
      const importedRecord = latest.find((d) => String(d.id).startsWith('csv-'))
      expect(importedRecord?.subgrid).toBe('N93E70')
      expect(importedRecord?.panoramas?.map((p) => p.filename)).toEqual(['N93E70-0099.jpg'])
      // The record keeps the real raw CSV name it came from.
      expect(importedRecord?.csvFileName).toBe('20220904.csv')
    })

    it('still reports real duplicate image filenames', async () => {
      vi.mocked(fetchStagingPanoramasFromSupabase).mockResolvedValue([
        { filename: 'N93E70-0042.jpg' } as { filename?: string }
      ])

      await openImport([
        { name: '20220904.csv', content: `${CsvHeader}\nN93E70-0042.jpg,3.4,101.6\nN93E70-0043.jpg,3.5,101.7` }
      ])

      expect(screen.getByText(/Duplicate images detected/)).toBeInTheDocument()
      expect(screen.getByText(/1 duplicate\(s\) will be skipped/)).toBeInTheDocument()
    })
  })
})

