import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary'

function BlowUp({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('boom')
  }
  return <div>all good</div>
}

function FlakyChunk({ getShouldThrow }: { getShouldThrow: () => boolean }) {
  if (getShouldThrow()) {
    throw new TypeError('Failed to fetch dynamically imported module: https://example.com/assets/Workspace.js')
  }
  return <div>recovered</div>
}

function renderBoundary({ resetKey }: { resetKey?: string } = {}) {
  return render(
    <WorkspaceErrorBoundary resetKey={resetKey}>
      <BlowUp shouldThrow={false} />
    </WorkspaceErrorBoundary>
  )
}

describe('WorkspaceErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders children when there is no error', () => {
    renderBoundary()
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('catches a throwing child and shows a retry card', () => {
    // Suppress the expected console.error from componentDidCatch
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <WorkspaceErrorBoundary>
        <BlowUp shouldThrow />
      </WorkspaceErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/could not be rendered/)).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByText('Retry workspace')).toBeInTheDocument()
    expect(screen.getByText('Reload dashboard')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('resets on retry when the error clears', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <WorkspaceErrorBoundary>
        <BlowUp shouldThrow />
      </WorkspaceErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Retry workspace'))
    // Even after retry, the child still throws because it is same element => still error.
    expect(screen.getByRole('alert')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('resets the error when resetKey changes after an error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <WorkspaceErrorBoundary resetKey="a">
        <BlowUp shouldThrow />
      </WorkspaceErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(
      <WorkspaceErrorBoundary resetKey="b">
        <BlowUp shouldThrow={false} />
      </WorkspaceErrorBoundary>
    )
    // resetKey change clears hasError, and the child no longer throws
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('all good')).toBeInTheDocument()
    spy.mockRestore()
  })

  it('auto-retries a failed dynamic import and recovers without user action', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()

    let failure = true
    render(
      <WorkspaceErrorBoundary>
        <FlakyChunk getShouldThrow={() => failure} />
      </WorkspaceErrorBoundary>
    )
    // First render threw a chunk-import error → boundary engages auto-retry.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/reconnecting workspace/i)).toBeInTheDocument()

    // The transient failure clears; the re-keyed subtree re-runs the import.
    failure = false
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('recovered')).toBeInTheDocument()

    vi.useRealTimers()
    spy.mockRestore()
  })

  it('stops auto-retrying after MAX_CHUNK_RETRIES and shows the error card', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()

    render(
      <WorkspaceErrorBoundary>
        <FlakyChunk getShouldThrow={() => true} />
      </WorkspaceErrorBoundary>
    )

    // 3 auto-retry attempts, then the hard error card with manual actions.
    for (let i = 0; i < 3; i++) {
      expect(screen.getByRole('status')).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(800 * (i + 1))
      })
    }
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/could not be rendered/)).toBeInTheDocument()

    vi.useRealTimers()
    spy.mockRestore()
  })

  it('does not auto-retry non-chunk errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()

    render(
      <WorkspaceErrorBoundary>
        <BlowUp shouldThrow />
      </WorkspaceErrorBoundary>
    )
    // No retrying status — the plain error card shows immediately.
    expect((screen.queryByRole('status'))).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    vi.useRealTimers()
    spy.mockRestore()
  })
})
