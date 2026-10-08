import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The silent-fallback trap.
 *
 * `hub_session_state` and `station_board_items` had no `authenticated` grant
 * until migration 0035. Every read and write therefore failed — and every
 * failure was swallowed, falling back to a `localStorage` mirror. Both features
 * looked healthy while never touching the database.
 *
 * These tests pin the reporting that makes the next such failure visible. They
 * assert the FAILURE path specifically: a swallowed error is invisible by
 * construction, which is exactly why it needs a test.
 */

const { fromMock, scopedMock, getServiceProjectIdMock, maybeSingleMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  scopedMock: vi.fn(),
  getServiceProjectIdMock: vi.fn(),
  maybeSingleMock: vi.fn()
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return {
    ...actual,
    supabase: { from: fromMock },
    scoped: scopedMock,
    getServiceProjectId: getServiceProjectIdMock
  }
})

import {
  fetchHubSessionFromSupabase,
  saveHubSessionToSupabase,
  HUB_WRITE_OPS
} from '../hubSession'
import { fetchStationBoardItemsFromSupabase, upsertStationBoardItemInSupabase, STATION_WRITE_OPS } from '../stationBoard'
import { getWriteFailures, clearWriteFailures } from '../../../lib/writeFailures'

const DENIED = { message: 'permission denied for table hub_session_state' }

// The mirror key is project-scoped; `getServiceProjectId` is mocked to
// 'project-1', so seeding the guest-mode key would leave the cache empty.
function seedLocalSession(state: Record<string, unknown>) {
  localStorage.setItem('geosphere_hub_session_project-1', JSON.stringify(state))
}

function seedLocalBoard(rows: unknown[]) {
  localStorage.setItem('geosphere_station_board_project-1', JSON.stringify(rows))
}

beforeEach(() => {
  vi.clearAllMocks()
  clearWriteFailures()
  localStorage.clear()
  getServiceProjectIdMock.mockReturnValue('project-1')
  scopedMock.mockImplementation((q: unknown) => q)
})

describe('hubSession — a failed read is reported, not absorbed', () => {
  it('reports the error and still serves the local mirror', async () => {
    seedLocalSession({ lastSubgrid: 'N93E70' })
    maybeSingleMock.mockResolvedValue({ data: null, error: DENIED })
    fromMock.mockReturnValue({ select: () => ({ maybeSingle: maybeSingleMock }) })

    const result = await fetchHubSessionFromSupabase()

    // The offline cache still answers, so the feature keeps working...
    expect(result).toEqual({ lastSubgrid: 'N93E70' })
    // ...but the outage is now on screen instead of invisible.
    const failures = getWriteFailures()
    expect(failures.map((f) => f.op)).toContain(HUB_WRITE_OPS.sessionRead)
    expect(failures[0].detail).toContain('permission denied')
    expect(failures[0].severity).toBe('warning')
  })

  it('clears the report once the read succeeds', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: JSON.stringify({ lastSubgrid: 'N94E71' }) },
      error: null
    })
    fromMock.mockReturnValue({ select: () => ({ maybeSingle: maybeSingleMock }) })

    await fetchHubSessionFromSupabase()
    await fetchHubSessionFromSupabase()
    expect(getWriteFailures().map((f) => f.op)).not.toContain(HUB_WRITE_OPS.sessionRead)
  })
})

describe('hubSession — a rejected write is reported', () => {
  it('reports the permission error the upsert resolved with', async () => {
    // A PostgREST builder is thenable: a rejected write RESOLVES with
    // `{ error }` and never throws, so a `catch` alone would never see this.
    const upsertMock = vi.fn().mockResolvedValue({ error: DENIED })
    fromMock.mockReturnValue({ upsert: upsertMock })

    const ok = await saveHubSessionToSupabase({ lastSubgrid: 'N93E70' }, 'operator')

    expect(ok).toBe(false)
    expect(getWriteFailures().map((f) => f.op)).toContain(HUB_WRITE_OPS.sessionWrite)
  })

  it('returns true and clears the report on success', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    fromMock.mockReturnValue({ upsert: upsertMock })

    const ok = await saveHubSessionToSupabase({ lastSubgrid: 'N93E70' }, 'operator')

    expect(ok).toBe(true)
    expect(getWriteFailures()).toHaveLength(0)
  })
})

describe('stationBoard — a failed read is reported, not absorbed', () => {
  it('reports the error and serves the cached rows', async () => {
    seedLocalBoard([{ subgrid: 'N93E70', station_id: 's1' }])
    const thenable = Promise.resolve({ data: null, error: DENIED })
    fromMock.mockReturnValue({ select: () => thenable })

    const rows = await fetchStationBoardItemsFromSupabase('N93E70')

    expect(rows).toHaveLength(1)
    const failures = getWriteFailures()
    expect(failures.map((f) => f.op)).toContain(STATION_WRITE_OPS.boardRead)
    expect(failures[0].severity).toBe('warning')
  })

  it('reports a rejected write instead of returning false silently', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: DENIED })
    fromMock.mockReturnValue({ upsert: upsertMock })

    const ok = await upsertStationBoardItemInSupabase({
      subgrid: 'N93E70',
      station_id: 's1'
    } as never)

    expect(ok).toBe(false)
    expect(getWriteFailures().map((f) => f.op)).toContain(STATION_WRITE_OPS.boardWrite)
  })

  it('does not report when the read succeeds', async () => {
    const thenable = Promise.resolve({ data: [{ subgrid: 'N93E70', station_id: 's1' }], error: null })
    fromMock.mockReturnValue({ select: () => thenable })

    const rows = await fetchStationBoardItemsFromSupabase('N93E70')

    expect(rows).toHaveLength(1)
    expect(getWriteFailures()).toHaveLength(0)
  })
})