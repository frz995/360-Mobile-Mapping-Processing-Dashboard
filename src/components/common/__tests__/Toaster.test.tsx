import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'

// The real toast store is module-level global state that persists across tests
// in a file. Mock it with an isolated in-memory store so every test starts
// clean, sharing the same instance between the Toaster and the test helpers.
const store = vi.hoisted(() => {
  let toasts: { id: number; kind: 'success' | 'error' | 'info'; message: string }[] = []
  let nextId = 1
  const listeners = new Set<(t: any) => void>()
  const emit = () => {
    const snapshot = [...toasts]
    listeners.forEach((l) => l(snapshot))
  }
  const push = (kind: any, message: string, durationMs = 4200) => {
    const id = nextId++
    toasts = [...toasts, { id, kind, message }]
    emit()
    if (durationMs > 0) setTimeout(() => dismiss(id), durationMs)
    return id
  }
  const dismiss = (id: number) => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }
  return {
    toast: {
      success: (m: string) => push('success', m),
      error: (m: string) => push('error', m),
      info: (m: string) => push('info', m)
    },
    subscribeToasts: (listener: any) => {
      listeners.add(listener)
      listener([...toasts])
      return () => listeners.delete(listener)
    },
    dismissToast: (id: number) => dismiss(id),
    __reset: () => {
      toasts = []
      nextId = 1
      listeners.clear()
    }
  }
})

vi.mock('../toast', () => ({
  toast: store.toast,
  subscribeToasts: store.subscribeToasts,
  dismissToast: store.dismissToast
}))

import { Toaster } from '../Toaster'
import { toast, dismissToast } from '../toast'

describe('Toaster', () => {
  beforeEach(() => {
    store.__reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders an aria-live status region', () => {
    render(<Toaster />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('renders a toast pushed through the imperative API', () => {
    render(<Toaster />)
    act(() => {
      toast.success('Saved successfully')
    })
    expect(screen.getByText('Saved successfully')).toBeInTheDocument()
  })

  it('renders success and error toasts with kind labels', () => {
    render(<Toaster />)
    act(() => {
      toast.success('OK')
      toast.error('Failed')
    })
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getAllByText('Success:').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Error:').length).toBeGreaterThan(0)
  })

  it('auto-dismisses a toast after the default duration', () => {
    render(<Toaster />)
    act(() => {
      toast.info('Timed message')
    })
    expect(screen.getByText('Timed message')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(4300)
    })
    expect(screen.queryByText('Timed message')).not.toBeInTheDocument()
  })

  it('dismisses a toast when the dismiss button is clicked', () => {
    render(<Toaster />)
    act(() => {
      toast.info('Dismiss me')
    })
    expect(screen.getByText('Dismiss me')).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByLabelText('Dismiss notification'))
    })
    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()
  })

  it('unsubscribes on unmount without throwing on later pushes', () => {
    const { unmount } = render(<Toaster />)
    unmount()
    act(() => {
      toast.success('No listener')
    })
  })

  it('exposes dismissToast to remove a toast by id', () => {
    render(<Toaster />)
    act(() => {
      toast.success('By id')
    })
    expect(screen.getByText('By id')).toBeInTheDocument()
    act(() => {
      dismissToast(1)
    })
    expect(screen.queryByText('By id')).not.toBeInTheDocument()
  })
})
