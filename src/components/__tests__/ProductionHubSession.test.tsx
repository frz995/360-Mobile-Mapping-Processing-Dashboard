import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { ProductionHubWorkspace } from '../production/hub/ProductionHubWorkspace'

vi.mock('../../services/api/hubSession', () => ({
  fetchHubSessionFromSupabase: vi.fn(),
  saveHubSessionToSupabase: vi.fn(),
  purgeHubSession: vi.fn()
}))

import {
  fetchHubSessionFromSupabase,
  saveHubSessionToSupabase,
  purgeHubSession
} from '../../services/api/hubSession'

const mockedFetchSession = vi.mocked(fetchHubSessionFromSupabase)
const mockedSaveSession = vi.mocked(saveHubSessionToSupabase)
const mockedPurgeSession = vi.mocked(purgeHubSession)

const LEGACY_PAIRED_RECORD = {
  index: 1,
  sourceFilename: 'a.jpg',
  targetFilename: 'N93E70-0001.jpg',
  timestamp: '2022-09-04T09:00:00Z',
  latitude: 3.1,
  longitude: 101.6,
  heading: null,
  isMatched: true
}

describe('ProductionHubWorkspace session restore (last activity)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockedSaveSession.mockResolvedValue(true)
    mockedPurgeSession.mockResolvedValue(undefined)
  })

  afterEach(cleanup)

  it('restores subgrid and active tab from the saved session', async () => {
    mockedFetchSession.mockResolvedValue({
      activeStation: 'intake',
      subgrid: 'N93E70',
      surveyDate: '2022-09-04',
      selectedFolderId: '20220904',
      customFolderName: ''
    })
    render(
      <ProductionHubWorkspace
        projectSettings={{}}
        setProjectSettings={vi.fn()}
        authSession={{ user: { email: 'qa@tnb.com.my' } }}
        addNotification={vi.fn()}
        addAuditLog={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByDisplayValue('N93E70')).toBeInTheDocument()
    })
    expect(screen.getByText('Survey Source')).toBeInTheDocument()
    expect(screen.getByText('Pairing Summary')).toBeInTheDocument()
  })

  it('does not present a cached metadata CSV name before the NAS confirms it', async () => {
    // The scan cannot run here, so the cached CSV name must not be shown:
    // it would name a file the worker was never able to list.
    mockedFetchSession.mockResolvedValue({
      activeStation: 'intake',
      subgrid: 'N93E70',
      surveyDate: '2022-09-04',
      selectedFolderId: '20220904',
      csvFileName: '20220904.csv',
      customFolderName: ''
    })
    render(
      <ProductionHubWorkspace
        projectSettings={{}}
        setProjectSettings={vi.fn()}
        authSession={{ user: { email: 'qa@tnb.com.my' } }}
        addNotification={vi.fn()}
        addAuditLog={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByDisplayValue('N93E70')).toBeInTheDocument()
    })
    expect(screen.queryByDisplayValue('20220904.csv')).not.toBeInTheDocument()
  })

  it('purges and ignores a legacy session that cached NAS-derived pairing rows', async () => {
    mockedFetchSession.mockResolvedValue({
      activeStation: 'intake',
      subgrid: 'N93E70',
      surveyDate: '2022-09-04',
      totalFrames: 92,
      pairedRecords: [LEGACY_PAIRED_RECORD],
      selectedFolderId: '20220904',
      csvFileName: '20220904.csv',
      customFolderName: ''
    })
    render(
      <ProductionHubWorkspace
        projectSettings={{}}
        setProjectSettings={vi.fn()}
        authSession={{ user: { email: 'qa@tnb.com.my' } }}
        addNotification={vi.fn()}
        addAuditLog={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(mockedPurgeSession).toHaveBeenCalled()
    })
    // Neither the cached row nor the cached total may reappear.
    expect(screen.queryByText('92 panoramas')).not.toBeInTheDocument()
    expect(screen.queryByText(/1 of 92/)).not.toBeInTheDocument()
    // The saved snapshot must not carry them forward again.
    await waitFor(() => {
      expect(mockedSaveSession).toHaveBeenCalled()
    })
    const payload = mockedSaveSession.mock.calls[mockedSaveSession.mock.calls.length - 1][0]
    expect(payload).not.toHaveProperty('pairedRecords')
    expect(payload).not.toHaveProperty('totalFrames')
  })

  it('persists new activity after the session bootstrap (debounced save)', async () => {
    mockedFetchSession.mockResolvedValue(null)
    render(
      <ProductionHubWorkspace
        projectSettings={{}}
        setProjectSettings={vi.fn()}
        authSession={{ user: { email: 'qa@tnb.com.my' } }}
        addNotification={vi.fn()}
        addAuditLog={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(mockedSaveSession).toHaveBeenCalled()
    })
    const payload = mockedSaveSession.mock.calls[mockedSaveSession.mock.calls.length - 1][0]
    expect(payload.activeStation).toBe('stations')
  })
})
