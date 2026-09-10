import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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
      totalKm={props.totalKm}
      projectSettings={props.projectSettings}
      onLoadProject={props.onLoadProject ?? vi.fn()}
      onCreateProject={props.onCreateProject ?? vi.fn()}
      onUpdateProject={props.onUpdateProject}
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

  it('does not label non-loaded projects as Current even when their status is active', () => {
    const projA = projectFixture({ id: 'proj-a', name: 'Alpha' })
    const projB = projectFixture({ id: 'proj-b', name: 'Beta' })
    renderPage({ projectList: [projA, projB], activeProject: projA })
    expect(screen.getAllByText('projectCurrent')).toHaveLength(1)
  })

  it('shows 0 km for an empty new project instead of inheriting the previous project target', () => {
    const proj = projectFixture({
      id: 'proj-new',
      name: 'Fresh Area',
      scope: { crs: 'EPSG:4326', region: 'peninsular_malaysia', bbox: [99.6, 1.2, 104.6, 6.8], basemap: 'dark', equipment: 'MMS', targetKm: 0 }
    })
    renderPage({ projectList: [proj], activeProject: proj, projectSettings: { targetKm: 4886.3 }, totalKm: 0 })
    expect(screen.queryByText(/4886/)).not.toBeInTheDocument()
    expect(screen.getByText('0.0 km')).toBeInTheDocument()
  })

  it('invokes onLoadProject when the Load button is clicked', () => {
    const onLoadProject = vi.fn()
    renderPage({ projectList: [projectFixture()], onLoadProject })
    fireEvent.click(screen.getByText('projectLoad'))
    expect(onLoadProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj-1' }))
  })

  it('displays contract code, client name, and allows editing the project', async () => {
    const onUpdateProject = vi.fn().mockResolvedValue({ success: true, value: projectFixture({ name: 'Selangor Updated' }) })
    renderPage({
      projectList: [projectFixture({
        contractCode: 'MMS-2026-GEO-01',
        clientName: 'Spatial Asset Operations',
        description: 'Road analysis mapping project'
      })],
      onUpdateProject
    })

    expect(screen.getByText('MMS-2026-GEO-01')).toBeInTheDocument()
    expect(screen.getByText('Spatial Asset Operations')).toBeInTheDocument()
    expect(screen.getByText('Road analysis mapping project')).toBeInTheDocument()

    // Click edit button
    const editBtn = screen.getByTitle('Edit Project')
    expect(editBtn).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(editBtn)
    })

    // Edit modal should be visible
    expect(screen.getByText('Edit Project')).toBeInTheDocument()
    const nameInput = screen.getByDisplayValue('Selangor Phase 3')
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Selangor Updated' } })
    })

    // Save changes
    const saveBtn = screen.getByText('Save Changes')
    await act(async () => {
      fireEvent.click(saveBtn)
    })

    expect(onUpdateProject).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ name: 'Selangor Updated' })
    )
  })

  it('computes and displays actual KM, target KM, and percentage synced with projectSettings', () => {
    const proj = projectFixture({
      id: 'proj-1',
      scope: { crs: 'EPSG:4326', region: 'peninsular_malaysia', bbox: [99.6, 1.2, 104.6, 6.8], targetKm: 100 }
    })
    renderPage({
      activeProject: proj,
      projectList: [proj],
      totalKm: 42.5,
      projectSettings: { targetKm: 100 }
    })

    // Should display 42.5% progress
    expect(screen.getByText('42.5%')).toBeInTheDocument()
    // Should display actual and target distance
    expect(screen.getByText('42.5 / 100.0 km')).toBeInTheDocument()
  })
})
