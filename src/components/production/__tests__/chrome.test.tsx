import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { UnderlineTabStrip, TabContentTransition } from '../chrome'

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

  it('renders an animated indicator line inside the active tab', () => {
    renderStrip('ledger')
    const ledger = screen.getByRole('tab', { name: 'Ledger' })
    const indicator = screen.getByTestId('animated-tab-indicator')
    expect(ledger).toContainElement(indicator)
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

describe('TabContentTransition', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders tabpanel with correct role and attributes', () => {
    render(
      <TabContentTransition activeKey="overview">
        <div>Overview Content</div>
      </TabContentTransition>
    )
    const panel = screen.getByRole('tabpanel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('id', 'tabpanel-overview')
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-overview')
    expect(screen.getByText('Overview Content')).toBeInTheDocument()
  })

  it('renders activeKey content appropriately', () => {
    render(
      <TabContentTransition activeKey="ledger">
        <div>Ledger Content</div>
      </TabContentTransition>
    )
    expect(screen.getByText('Ledger Content')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'tabpanel-ledger')
  })
})
