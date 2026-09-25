import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, getServiceProjectIdMock, checkPublicationMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getServiceProjectIdMock: vi.fn(),
  checkPublicationMock: vi.fn()
}))

vi.mock('../api/client', () => ({
  supabase: { from: fromMock },
  getServiceProjectId: getServiceProjectIdMock,
  scoped: (query: unknown) => query
}))

vi.mock('../api/productionRuns', () => ({
  checkProductionPublicationEligibility: checkPublicationMock
}))

vi.mock('../api/storage', () => ({
  ensureManifestSettings: vi.fn(),
  resolveStorageFiles: vi.fn()
}))

import { publishToSupabase, saveToStagingSupabase } from '../api/datasets'

function installPanoramaTable() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const insert = vi.fn().mockResolvedValue({ error: null })
  fromMock.mockImplementation((table: string) => {
    if (table === 'panoramas' || table === 'staging_panoramas') return { upsert, insert }
    return { upsert, insert }
  })
  return { upsert, insert }
}

describe('dataset publication rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServiceProjectIdMock.mockReturnValue('project-1')
    checkPublicationMock.mockResolvedValue({
      managed: true,
      allowed: true,
      reason: 'ready',
      productionRunId: 'run-1',
      productionAttemptId: 'attempt-1',
      productionReleaseId: 'release-1'
    })
  })

  it('writes the schema-aligned panorama shape after approval', async () => {
    const { upsert } = installPanoramaTable()

    const result = await publishToSupabase({
      subgrid: 'N93E70',
      date: '2026-09-25',
      panoramas: [{
        filename: 'N93E70-0001.jpg',
        latitude: 1.25,
        longitude: 103.5,
        bearing: 90
      }]
    })

    expect(result.success).toBe(true)
    expect(checkPublicationMock).toHaveBeenCalledWith(expect.objectContaining({ subgrid: 'N93E70' }))
    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        project_id: 'project-1',
        subgrid: 'N93E70',
        filename: 'N93E70-0001.jpg',
        latitude: 1.25,
        longitude: 103.5,
        heading: 90,
        geom: { type: 'Point', coordinates: [103.5, 1.25] }
      })
    ], { onConflict: 'project_id,filename' })
    expect(upsert.mock.calls[0][0][0]).not.toHaveProperty('bearing')
  })

  it('does not write any panorama when the publication gate blocks', async () => {
    const { upsert } = installPanoramaTable()
    checkPublicationMock.mockResolvedValue({
      managed: true,
      allowed: false,
      reason: 'QA approval is required before handoff.'
    })

    const result = await publishToSupabase({
      subgrid: 'N93E70',
      date: '2026-09-25',
      panoramas: [{ filename: 'N93E70-0001.jpg', latitude: 1, longitude: 2 }]
    })

    expect(result).toEqual({
      success: false,
      message: 'Publication blocked: QA approval is required before handoff.'
    })
    expect(fromMock).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('fails before database writes when coordinates are missing', async () => {
    const { upsert } = installPanoramaTable()

    const result = await publishToSupabase({
      subgrid: 'N93E70',
      date: '2026-09-25',
      panoramas: [{ filename: 'N93E70-0001.jpg' }]
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('latitude and longitude are required')
    expect(upsert).not.toHaveBeenCalled()
  })

  it('uses the same coordinate contract for staging rows', async () => {
    const { upsert } = installPanoramaTable()

    const result = await saveToStagingSupabase({
      subgrid: 'N93E70',
      date: '2026-09-25',
      panoramas: [{
        filename: 'N93E70-0001.jpg',
        latitude: 1.25,
        longitude: 103.5,
        bearing: 90
      }]
    })

    expect(result.success).toBe(true)
    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        subgrid: 'N93E70',
        latitude: 1.25,
        longitude: 103.5,
        heading: 90,
        geom: { type: 'Point', coordinates: [103.5, 1.25] }
      })
    ], { onConflict: 'project_id,filename' })
  })
})
