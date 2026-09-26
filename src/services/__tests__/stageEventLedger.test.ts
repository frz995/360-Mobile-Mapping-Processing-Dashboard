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
  appendStageEventToSupabase,
  fetchStageEventLedgerFromSupabase
} from '../api/stageEventLedger'

type Res = { data?: unknown; error?: { message: string } | null }

const insertCalls: any[] = []

function chainable(res: Res) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    insert: (row: any) => {
      insertCalls.push(row)
      return chain
    },
    upsert: () => chain,
    then: (resolve: any, reject: any) => Promise.resolve(res).then(resolve, reject)
  }
  return chain
}

describe('stageEventLedger service', () => {
  beforeEach(() => {
    localStorage.clear()
    insertCalls.length = 0
    fromMock.mockReset()
    getServiceProjectIdMock.mockReset().mockReturnValue('proj-1')
  })

  it('appends one event and clears the offline queue on success', async () => {
    fromMock.mockImplementation(() => chainable({ error: null }))
    const ok = await appendStageEventToSupabase({
      subgrid: 'n93e70',
      stage: 'stitch',
      event: 'STARTED',
      via: 'agent',
      detail: 'ptgui.exe'
    })
    expect(ok).toBe(true)
    expect(fromMock).toHaveBeenCalledWith('stage_event_ledger')
    expect(insertCalls[0][0]).toMatchObject({
      subgrid: 'N93E70',
      stage: 'stitch',
      event: 'STARTED',
      via: 'agent',
      project_id: 'proj-1'
    })
    expect(localStorage.getItem('geosphere_stage_events_proj-1')).toBe('[]')
  })

  it('keeps a pending offline copy when the insert fails and serves it on fetch', async () => {
    fromMock.mockImplementation(() => chainable({ error: { message: 'offline' } }))
    const ok = await appendStageEventToSupabase({
      subgrid: 'N93E70',
      stage: 'qa',
      event: 'FLAGGED',
      via: 'operator',
      detail: 'bad GPS'
    })
    expect(ok).toBe(false)
    expect(insertCalls.length).toBeGreaterThan(0)
    // fetch: flush insert fails again, select fails -> the pending row is served
    const rows = await fetchStageEventLedgerFromSupabase('N93E70')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ stage: 'qa', event: 'FLAGGED', subgrid: 'N93E70' })
  })

  it('flushes pending rows on the next fetch once Supabase answers', async () => {
    fromMock.mockImplementationOnce(() => chainable({ error: { message: 'offline' } }))
    await appendStageEventToSupabase({ subgrid: 'N93E70', stage: 'intake', event: 'COMPLETED', via: 'operator' })
    // service healthy again: the queued row is flushed on fetch, queue drains
    fromMock.mockImplementation(() => chainable({ data: [], error: null }))
    const rows = await fetchStageEventLedgerFromSupabase('N93E70')
    expect(rows).toEqual([])
    expect(insertCalls.length).toBe(2)
    expect(localStorage.getItem('geosphere_stage_events_proj-1')).toBe('[]')
  })
})
