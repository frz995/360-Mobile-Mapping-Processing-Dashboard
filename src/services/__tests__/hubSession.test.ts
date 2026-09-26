import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, getServiceProjectIdMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getServiceProjectIdMock: vi.fn()
}))

vi.mock('../api/client', () => ({
  getServiceProjectId: getServiceProjectIdMock,
  scoped: (q: unknown) => q,
  supabase: { from: fromMock }
}))

import {
  fetchHubSessionFromSupabase,
  saveHubSessionToSupabase
} from '../api/hubSession'

type Res = { data?: unknown; error?: unknown }

const upsertStore: unknown[] = []

function chainable(res: Res, method: 'select' | 'upsert' | 'all') {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(res),
    upsert: (rows: unknown[]) => {
      upsertStore.push(...rows)
      if (method === 'upsert') return Promise.resolve(res)
      return chain
    },
    then: (resolve: any, reject: any) => Promise.resolve(res).then(resolve, reject)
  }
  return chain
}

describe('hubSession service', () => {
  beforeEach(() => {
    localStorage.clear()
    fromMock.mockReset()
    getServiceProjectIdMock.mockReset().mockReturnValue('proj-1')
  })

  it('saves the session to Supabase and mirrors it locally', async () => {
    fromMock.mockImplementation(() => chainable({ error: null }, 'upsert'))
    const ok = await saveHubSessionToSupabase({ subgrid: 'N93E70', activeStation: 'intake' }, 'QA Lead')
    expect(ok).toBe(true)
    expect(upsertStore[0]).toMatchObject({
      project_id: 'proj-1',
      updated_by: 'QA Lead',
      state: { subgrid: 'N93E70', activeStation: 'intake' }
    })
    const mirrored = localStorage.getItem('geosphere_hub_session_proj-1')
    expect(mirrored ? JSON.parse(mirrored) : null).toMatchObject({ subgrid: 'N93E70' })
  })

  it('falls back to the local mirror when the backend is unreachable', async () => {
    localStorage.setItem('geosphere_hub_session_proj-1', JSON.stringify({ subgrid: 'N93E70', totalFrames: 92 }))
    const state = await fetchHubSessionFromSupabase()
    expect(state).toMatchObject({ subgrid: 'N93E70', totalFrames: 92 })
  })

  it('returns null when nothing was saved yet', async () => {
    fromMock.mockImplementation(() => chainable({ data: null }, 'select'))
    const state = await fetchHubSessionFromSupabase()
    expect(state).toBeNull()
  })
})
