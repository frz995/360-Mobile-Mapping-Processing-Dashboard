import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { WorkspaceSidebarNav } from '../WorkspaceSidebarNav'
import type { WorkspaceKey } from '../../utils/hashRouter'

const translate = (k: string) => k

function renderNav(activeWorkspace: WorkspaceKey = 'dashboard') {
  return render(
    <WorkspaceSidebarNav
      translate={translate}
      activeWorkspace={activeWorkspace}
      isSidebarExpanded
      tourStep={null}
      onNavigate={vi.fn()}
      onRefresh={vi.fn()}
      onOpenAbout={vi.fn()}
      onToggleSidebar={vi.fn()}
    />
  )
}

describe('WorkspaceSidebarNav', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a workspace navigation landmark', () => {
    renderNav()
    expect(screen.getByRole('navigation', { name: 'Workspace navigation' })).toBeInTheDocument()
  })

  it('marks the active workspace with aria-current="page"', () => {
    renderNav('data')
    const data = screen.getAllByLabelText('data').find((el) =>
      el.getAttribute('aria-current') === 'page'
    )
    expect(data).toBeDefined()
    expect(data).toHaveAttribute('aria-current', 'page')
  })

  it('renders workspace nav items and action buttons', () => {
    renderNav()
    expect(screen.getByLabelText('refresh')).toBeInTheDocument()
    expect(screen.getByLabelText('about')).toBeInTheDocument()
    expect(screen.getByLabelText('Collapse navigation panel')).toBeInTheDocument()
  })

  it('calls onNavigate when a workspace button is clicked', () => {
    const onNavigate = vi.fn()
    render(
      <WorkspaceSidebarNav
        translate={translate}
        activeWorkspace="dashboard"
        isSidebarExpanded
        tourStep={null}
        onNavigate={onNavigate}
        onRefresh={vi.fn()}
        onOpenAbout={vi.fn()}
        onToggleSidebar={vi.fn()}
      />
    )
    fireEvent.click(screen.getByLabelText('dashboard'))
    expect(onNavigate).toHaveBeenCalledWith('dashboard')
  })

  it('calls onRefresh, onOpenAbout, and onToggleSidebar actions', () => {
    const onRefresh = vi.fn()
    const onOpenAbout = vi.fn()
    const onToggleSidebar = vi.fn()
    render(
      <WorkspaceSidebarNav
        translate={translate}
        activeWorkspace="dashboard"
        isSidebarExpanded
        tourStep={null}
        onNavigate={vi.fn()}
        onRefresh={onRefresh}
        onOpenAbout={onOpenAbout}
        onToggleSidebar={onToggleSidebar}
      />
    )
    fireEvent.click(screen.getByLabelText('refresh'))
    fireEvent.click(screen.getByLabelText('about'))
    fireEvent.click(screen.getByLabelText('Collapse navigation panel'))
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(onOpenAbout).toHaveBeenCalledOnce()
    expect(onToggleSidebar).toHaveBeenCalledOnce()
  })
})
