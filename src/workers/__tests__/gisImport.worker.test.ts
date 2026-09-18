import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The worker module is a plain module that wires itself to the global `self`.
// jsdom has no `Worker` constructor, so we drive it like the qaqc worker test:
// invoke `self.onmessage` directly and capture output through `self.postMessage`.

type WorkerReply =
  | { id: number; status: 'progress'; stage: string }
  | { id: number; status: 'ok'; result: any }
  | { id: number; status: 'error'; error: string }

describe('gisImport.worker message flow', () => {
  let postMessageMock: ReturnType<typeof vi.fn>

  const send = async (data: { id: number; file: File }): Promise<WorkerReply[]> => {
    const handler = (self as any).onmessage as (ev: { data: typeof data }) => Promise<void>
    await handler({ data })
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
    await import('../../workers/gisImport.worker')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('parses a GeoJSON file in the worker', async () => {
    const file = new File(
      [
        JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [101.2, 3.2],
                  [101.4, 3.4]
                ]
              },
              properties: { route: 'Federal Highway' }
            }
          ]
        })
      ],
      'federal_highway.geojson',
      { type: 'application/geo+json' }
    )

    const replies = await send({ id: 1, file })
    const reply = replies[replies.length - 1]
    expect(reply.status).toBe('ok')
    if (reply.status !== 'ok') throw new Error('expected sucess reply')
    expect(reply.id).toBe(1)
    expect(reply.result.format).toBe('geojson')
    expect(reply.result.featureCount).toBe(1)
    expect(reply.result.geometryType).toBe('LineString')
    expect(reply.result.hasRoadLines).toBe(true)
    expect(reply.result.bbox).toEqual([101.2, 3.2, 101.4, 3.4])

    // Live progress stages must be streamed before the final result.
    expect(replies.slice(0, -1).some((m) => m.status === 'progress' && typeof m.stage === 'string')).toBe(true)
  })

  it('parses CSV coordinates in the worker', async () => {
    const file = new File(['id,name,lat,lon\n1,Point A,3.139,101.686\n'], 'points.csv', {
      type: 'text/csv'
    })

    const replies = await send({ id: 2, file })
    const reply = replies[replies.length - 1]
    expect(reply.status).toBe('ok')
    if (reply.status !== 'ok') throw new Error('expected sucess reply')
    expect(reply.result.format).toBe('csv')
    expect(reply.result.featureCount).toBe(1)
    expect(reply.result.geometryType).toBe('Point')
  })

  it('reports unsupported formats via an error reply', async () => {
    const file = new File(['dummy'], 'test.txt', { type: 'text/plain' })

    const replies = await send({ id: 3, file })
    const reply = replies[replies.length - 1]
    expect(reply.status).toBe('error')
    if (reply.status !== 'error') throw new Error('expected failure reply')
    expect(reply.id).toBe(3)
    expect(reply.error).toMatch(/unsupported file format/i)
  })
})