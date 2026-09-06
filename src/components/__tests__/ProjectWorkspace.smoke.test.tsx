import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { UserProject } from '../../services/projects'

vi.mock('../../services/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
    channel: () => ({ on: () => ({}), subscribe: () => Promise.resolve() }),
    removeChannel: () => {}
  }
}));

import { ProjectWorkspace } from '../ProjectWorkspace'

const projectFixture = (over: Partial<UserProject> = {}): UserProject => ({
  id: 'proj-1',
  name: 'Selangor Phase 3',
  description: '',
  contractCode: 'MMS-2026-GEO-01',
  clientName: 'Spatial Asset Operations',
  region: 'peninsular_malaysia',
  status: 'active',
  scope: { crs: 'EPSG:4326', region: 'peninsular_malaysia', bbox: [99.6, 1.2, 104.6, 6.8], basemap: 'dark', equipment: 'MMS' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-02T00:00:00.000Z',
  ...over
})

function renderPage(props: Partial<Parameters<typeof ProjectWorkspace>[0]> = {}) {
  return render(
    <ProjectWorkspace
      translate={props.translate ?? ((k: string) => k)}
      isGuestUser={props.isGuestUser}
      activeProject={props.activeProject}
      projectList={props.projectList ?? []}
      projectsLoaded={props.projectsLoaded ?? true}
      onLoadProject={props.onLoadProject ?? vi.fn()}
      onCreateProject={props.onCreateProject ?? vi.fn()}
      onRefreshProjects={props.onRefreshProjects ?? vi.fn()}
      onBackToDashboard={props.onBackToDashboard ?? vi.fn()}
    />
  )
}

describe('ProjectWorkspace smoke', () => {
  beforeEach(() => {
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('mounts without throwing and never calls alert()', () => {
    expect(() => renderPage()).not.toThrow()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('shows skeleton while projects are loading', () => {
    renderPage({ projectsLoaded: false })
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('renders an empty state when there are no projects', () => {
    renderPage({ projectsLoaded: true, projectList: [] })
    expect(screen.getByText('projectNoProjects')).toBeInTheDocument()
  })

  it('renders a project row when projectList is populated', () => {
    renderPage({ projectList: [projectFixture()] })
    expect(screen.getByText('Selangor Phase 3')).toBeInTheDocument()
    expect(screen.getByText('peninsular_malaysia')).toBeInTheDocument()
  })

  it('marks the active project with the current badge', () => {
    renderPage({ projectList: [projectFixture()], activeProject: projectFixture() })
    expect(screen.getByText('projectCurrent')).toBeInTheDocument()
  })

  it('invokes onLoadProject when the Load button is clicked', () => {
    const onLoadProject = vi.fn()
    renderPage({ projectList: [projectFixture()], onLoadProject })
    fireEvent.click(screen.getByText('projectLoad'))
    expect(onLoadProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj-1' }))
  })
})
