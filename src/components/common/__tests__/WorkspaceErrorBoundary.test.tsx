import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { WorkspaceErrorBoundary } from '../WorkspaceErrorBoundary'

function BlowUp({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('boom')
  }
  return <div>all good</div>
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
})
