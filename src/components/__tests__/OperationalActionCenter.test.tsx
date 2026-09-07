import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { OperationalActionCenter } from '../OperationalActionCenter'
import { fetchProcessingJobsFromSupabase, fetchDeletionRequestsFromSupabase } from '../../services/supabase'
import { persistWorkspaceTab } from '../../utils/workspaceLocation'

vi.mock('../../services/supabase', () => ({
  fetchProcessingJobsFromSupabase: vi.fn(async () => []),
  fetchDeletionRequestsFromSupabase: vi.fn(async () => [])
}))

vi.mock('../../utils/workspaceLocation', () => ({
  persistWorkspaceTab: vi.fn()
}))

const pendingRequests = [
  { id: 'r1', subgrid: 'SURVEY_A', requestedBy: 'Fariz', status: 'Pending' },
  { id: 'r2', subgrid: 'SURVEY_B', requestedBy: 'Fariz', status: 'Pending' }
]

const baseProps = {
  batchLogs: [] as any[],
  dailyData: [] as any[],
  qaDefectsCount: 0,
  onNavigate: vi.fn()
}

describe('OperationalActionCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchProcessingJobsFromSupabase).mockResolvedValue([])
    vi.mocked(fetchDeletionRequestsFromSupabase).mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
  })

  it('shows idle pipeline and all-systems-nominal when nothing needs attention', async () => {
    render(<OperationalActionCenter {...baseProps} />)

    expect(await screen.findByText(/Pipeline Idle/)).toBeTruthy()
    expect(screen.getByText(/All Systems Nominal/)).toBeTruthy()
  })

  it('lists pending deletion approvals with a Review Approval action for approval-capable roles', async () => {
    vi.mocked(fetchDeletionRequestsFromSupabase).mockResolvedValue(pendingRequests)

    render(<OperationalActionCenter {...baseProps} canHandleApprovals />)

    await waitFor(() => expect(fetchDeletionRequestsFromSupabase).toHaveBeenCalled())
    expect(await screen.findByText('2 deletion approvals')).toBeTruthy()

    fireEvent.click(await screen.findByRole('button', { name: /Review Approval/ }))

    expect(persistWorkspaceTab).toHaveBeenCalledWith('administration', 'approvals')
    expect(baseProps.onNavigate).toHaveBeenCalledWith('administration')
  })

  it('does not surface approvals or query the DB when the user cannot approve deletions', async () => {
    vi.mocked(fetchDeletionRequestsFromSupabase).mockResolvedValue(pendingRequests)

    render(<OperationalActionCenter {...baseProps} canHandleApprovals={false} />)

    await waitFor(() => expect(fetchProcessingJobsFromSupabase).toHaveBeenCalled())
    expect(fetchDeletionRequestsFromSupabase).not.toHaveBeenCalled()
    expect(screen.queryByText(/deletion approval/)).toBeNull()
  })
})