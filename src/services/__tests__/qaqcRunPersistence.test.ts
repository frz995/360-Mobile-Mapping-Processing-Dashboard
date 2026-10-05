import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, upsertMock, getServiceProjectIdMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
  getServiceProjectIdMock: vi.fn()
}))

vi.mock('../api/client', () => ({
  supabase: { from: fromMock },
  scoped: (query: unknown) => query,
  getServiceProjectId: getServiceProjectIdMock
}))

vi.mock('../api/admin', () => ({
  saveAuditLogToSupabase: vi.fn()
}))

import { saveQaAuditRunToSupabase, updateDefectStatusInSupabase } from '../api/qaqc'

function installTable() {
  fromMock.mockImplementation(() => ({ upsert: upsertMock }))
  return upsertMock
}

describe('QA/QC run persistence conflict targets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertMock.mockResolvedValue({ error: null })
  })

  // Migration 0016 replaced UNIQUE (subgrid, run_id) with
  // UNIQUE (project_id, subgrid, run_id). An ON CONFLICT target with no matching
  // index is rejected by Postgres, so a stale 2-column target made every write
  // fail silently and defect counts reset to 0 on refresh.
  it('upserts the audit run on the project-scoped constraint when a project is active', async () => {
    installTable()
    getServiceProjectIdMock.mockReturnValue('project-1')

    const ok = await saveQaAuditRunToSupabase({
      subgrid: 'N93E70',
      runId: 'spd-n93e70-08apr2022',
      totalStations: 92,
      defectCount: 54,
      passRate: 41,
      meanTenengradScore: 88.2,
      defectsList: [],
      history: [],
      pic: 'Operator'
    })

    expect(ok).toBe(true)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'project-1', run_id: 'spd-n93e70-08apr2022' }),
      { onConflict: 'project_id,subgrid,run_id' }
    )
  })

  it('falls back to the legacy constraint when no project is active', async () => {
    installTable()
    getServiceProjectIdMock.mockReturnValue(null)

    await saveQaAuditRunToSupabase({
      subgrid: 'N93E70',
      runId: 'run-a',
      totalStations: 10,
      defectCount: 1,
      passRate: 90,
      meanTenengradScore: 70,
      defectsList: [],
      history: [],
      pic: 'Operator'
    })

    expect(upsertMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ project_id: expect.anything() }),
      { onConflict: 'subgrid,run_id' }
    )
  })

  it('persists the defect row on the project-scoped qa_defects constraint', async () => {
    installTable()
    getServiceProjectIdMock.mockReturnValue('project-1')

    await updateDefectStatusInSupabase('N93E70-0001.jpg', 1, 'flagged', {
      subgrid: 'N93E70',
      point_id: 'N93E70-0001.jpg'
    })

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'project-1', subgrid: 'N93E70' }),
      { onConflict: 'project_id,subgrid,run_id,point_id' }
    )
  })

  // Migration 0032 widened the qa_defects key with run_id. Without it, a defect
  // recorded by one run of a subgrid overwrote the same filename in every other
  // run of that subgrid.
  it('stamps run_id on the defect row so runs do not overwrite each other', async () => {
    installTable()
    getServiceProjectIdMock.mockReturnValue('project-1')

    await updateDefectStatusInSupabase('N93E70-0001.jpg', 1, 'flagged', {
      subgrid: 'N93E70',
      point_id: 'N93E70-0001.jpg',
      run_id: 'spd-n93e70-08apr2022'
    })

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'spd-n93e70-08apr2022' }),
      { onConflict: 'project_id,subgrid,run_id,point_id' }
    )
  })

  it('leaves run_id null for a defect recorded without a run', async () => {
    installTable()
    getServiceProjectIdMock.mockReturnValue('project-1')

    await updateDefectStatusInSupabase('N93E70-0002.jpg', 1, 'flagged', {
      subgrid: 'N93E70',
      point_id: 'N93E70-0002.jpg'
    })

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.run_id).toBeNull()
  })

  // item_key is NOT NULL on installs carrying the column, but no migration
  // created it and no writer set it, so every qa_defects row was rejected with
  // `null value in column "item_key" ... violates not-null constraint`.
  it('mirrors point_id into the NOT NULL item_key column', async () => {
    installTable()
    getServiceProjectIdMock.mockReturnValue('project-1')

    await updateDefectStatusInSupabase('N93E70-0001.jpg', 1, 'flagged', {
      subgrid: 'N93E70',
      point_id: 'N93E70-0001.jpg'
    })

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.item_key).toBe('N93E70-0001.jpg')
  })

  it('never writes a null or undefined item_key', async () => {
    installTable()
    getServiceProjectIdMock.mockReturnValue('project-1')

    // point_id falls back to the item key, which the function rejects when
    // blank, so item_key is always populated and can never trip NOT NULL.
    await updateDefectStatusInSupabase('N93E70-0001.jpg', 1, 'flagged', { subgrid: 'N93E70' })

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.item_key).toBe('N93E70-0001.jpg')
    expect(payload.item_key).not.toBeNull()
    expect(payload.item_key).not.toBeUndefined()
  })
})
