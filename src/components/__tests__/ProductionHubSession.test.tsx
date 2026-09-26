import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { ProductionHubWorkspace } from '../production/hub/ProductionHubWorkspace'

vi.mock('../../services/api/hubSession', () => ({
  fetchHubSessionFromSupabase: vi.fn(),
  saveHubSessionToSupabase: vi.fn()
}))

import {
  fetchHubSessionFromSupabase,
  saveHubSessionToSupabase
} from '../../services/api/hubSession'

const mockedFetchSession = vi.mocked(fetchHubSessionFromSupabase)
const mockedSaveSession = vi.mocked(saveHubSessionToSupabase)

describe('ProductionHubWorkspace session restore (last activity)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockedSaveSession.mockResolvedValue(true)
  })

  afterEach(cleanup)

  it('restores subgrid, survey source and active tab from the saved session', async () => {
    mockedFetchSession.mockResolvedValue({
      activeStation: 'intake',
      subgrid: 'N93E70',
      surveyDate: '2022-09-04',
      totalFrames: 92,
      pairedRecords: [{ index: 1, sourceFilename: 'a.jpg', targetFilename: 'N93E70-001.jpg', timestamp: '2022-09-04T09:00:00Z', latitude: 3.1, longitude: 101.6, heading: null, isMatched: true }],
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
    await waitFor(() => {
      expect(screen.getByText('20220904.csv')).toBeInTheDocument()
    })
    expect(screen.getByText('Survey Source')).toBeInTheDocument()
    expect(screen.getByText('Pairing Summary')).toBeInTheDocument()
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
