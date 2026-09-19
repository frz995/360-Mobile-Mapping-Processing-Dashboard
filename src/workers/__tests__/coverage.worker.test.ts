import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The worker module is a plain module wired to the global `self`. jsdom has no
// `Worker` constructor, so we drive it like the gisImport/qaqc worker tests:
// invoke `self.onmessage` directly and capture output via `self.postMessage`.

type WorkerReply =
  | { id: number; status: 'progress'; done: number; total: number }
  | { id: number; status: 'ok'; coverage: { planKm: number; tracedKm: number; tracedPct: number; uncoveredRuns: [number, number][][] } }
  | { id: number; status: 'error'; error: string }

const BASE_LNG = 101.5
const BASE_LAT = 3.1

function denseLine(lat: number, lngStart: number, lngEnd: number, n: number): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i < n; i++) {
    pts.push([lngStart + ((lngEnd - lngStart) * i) / (n - 1), lat])
  }
  return pts
}

describe('coverage.worker message flow', () => {
  let postMessageMock: ReturnType<typeof vi.fn>

  const send = async (data: { id: number; planRuns: [number, number][][]; capturedTracks: [number, number][][]; toleranceM: number }): Promise<WorkerReply[]> => {
    const handler = (self as any).onmessage as (ev: { data: typeof data }) => void
    handler({ data })
    const calls = postMessageMock.mock.calls as unknown as WorkerReply[][]
    return calls.map((c) => c[0])
  }

  beforeEach(async () => {
    postMessageMock = vi.fn()
    Object.defineProperty(self, 'postMessage', {
      value: postMessageMock,
      configurable: true,
      writable: true
    })
    vi.resetModules()
    await import('../../workers/coverage.worker')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('classifies uncovered plan roads and streams progress before the ok reply', async () => {
    const planRun: [number, number][] = [
      [BASE_LNG, BASE_LAT],
      [BASE_LNG + 0.001, BASE_LAT]
    ]
    const replies = await send({
      id: 7,
      planRuns: [planRun],
      capturedTracks: [],
      toleranceM: 25
    })

    const progress = replies.filter((r) => r.status === 'progress')
    expect(progress.length).toBe(1)
    if (progress[0].status !== 'progress') throw new Error('expected progress reply')
    expect(progress[0]).toEqual({ id: 7, status: 'progress', done: 1, total: 1 })

    const reply = replies[replies.length - 1]
    expect(reply.status).toBe('ok')
    if (reply.status !== 'ok') throw new Error('expected success reply')
    expect(reply.id).toBe(7)
    expect(reply.coverage.tracedPct).toBe(100)
    expect(reply.coverage.planKm).toBeCloseTo(0.111, 1)
    expect(reply.coverage.uncoveredRuns.length).toBe(1)
    expect(reply.coverage.uncoveredRuns[0].length).toBeGreaterThanOrEqual(2)
  })

  it('reports zero traced km when captured densely on top', async () => {
    const planRun: [number, number][] = [
      [BASE_LNG, BASE_LAT],
      [BASE_LNG + 0.001, BASE_LAT]
    ]
    const track = denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.001, 25)
    const replies = await send({
      id: 8,
      planRuns: [planRun],
      capturedTracks: [track],
      toleranceM: 25
    })

    const reply = replies[replies.length - 1]
    expect(reply.status).toBe('ok')
    if (reply.status !== 'ok') throw new Error('expected success reply')
    expect(reply.coverage.tracedPct).toBeLessThanOrEqual(1)
    expect(reply.coverage.uncoveredRuns.length).toBe(0)
  })

  it('posts per-run progress for multi-run networks', async () => {
    const planRuns: [number, number][][] = [
      [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.001, BASE_LAT]
      ],
      [
        [BASE_LNG + 0.002, BASE_LAT],
        [BASE_LNG + 0.003, BASE_LAT]
      ]
    ]
    const replies = await send({ id: 9, planRuns, capturedTracks: [], toleranceM: 25 })

    const progress = replies.filter((r) => r.status === 'progress')
    expect(progress.map((p) => (p.status === 'progress' ? [p.done, p.total] : null))).toEqual([
      [1, 2],
      [2, 2]
    ])

    const reply = replies[replies.length - 1]
    expect(reply.status).toBe('ok')
  })
})