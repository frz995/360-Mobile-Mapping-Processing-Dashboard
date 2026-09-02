import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { UnderlineTabStrip } from '../chrome'

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'ledger', label: 'Ledger' },
  { key: 'distance', label: 'Distance' }
]

function renderStrip(active = 'overview', onChange = vi.fn()) {
  return render(<UnderlineTabStrip tabs={tabs} active={active} onChange={onChange} />)
}

describe('UnderlineTabStrip', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a tablist with the correct number of tabs', () => {
    renderStrip()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })

  it('marks the active tab with aria-selected and tabIndex 0', () => {
    renderStrip('ledger')
    const ledger = screen.getByRole('tab', { name: 'Ledger' })
    const overview = screen.getByRole('tab', { name: 'Overview' })
    expect(ledger).toHaveAttribute('aria-selected', 'true')
    expect(ledger).toHaveAttribute('tabindex', '0')
    expect(overview).toHaveAttribute('aria-selected', 'false')
    expect(overview).toHaveAttribute('tabindex', '-1')
  })

  it('calls onChange when a tab button is clicked', () => {
    const onChange = vi.fn()
    renderStrip('overview', onChange)
    fireEvent.click(screen.getByRole('tab', { name: 'Distance' }))
    expect(onChange).toHaveBeenCalledWith('distance')
  })

  it('activates the next tab on ArrowRight (roving tabindex)', () => {
    const onChange = vi.fn()
    renderStrip('overview', onChange)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('ledger')
  })

  it('activates the previous tab on ArrowLeft', () => {
    const onChange = vi.fn()
    renderStrip('ledger', onChange)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ledger' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith('overview')
  })

  it('wraps from last to first on ArrowRight', () => {
    const onChange = vi.fn()
    renderStrip('distance', onChange)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Distance' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('overview')
  })

  it('moves to first tab on Home and last on End', () => {
    const onChange = vi.fn()
    renderStrip('ledger', onChange)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ledger' }), { key: 'Home' })
    expect(onChange).toHaveBeenCalledWith('overview')
    onChange.mockClear()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Ledger' }), { key: 'End' })
    expect(onChange).toHaveBeenCalledWith('distance')
  })

  it('uses tabLabel renderer when provided', () => {
    render(<UnderlineTabStrip tabs={tabs} active="overview" onChange={vi.fn()} tabLabel={(k) => `LBL-${k}`} />)
    expect(screen.getByRole('tab', { name: 'LBL-overview' })).toBeInTheDocument()
  })
})
