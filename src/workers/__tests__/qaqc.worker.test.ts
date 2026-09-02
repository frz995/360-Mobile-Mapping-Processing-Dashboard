import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The worker module is a plain module that wires itself to the global `self`.
// We drive it by invoking `self.onmessage` directly (jsdom has no `Worker`
// constructor), and capture its output through `self.postMessage`. The heavy
// image-analysis module is fully mocked so the real WebGL/GPU singleton never
// loads in jsdom.

const controllable = vi.hoisted(() => {
  const resolvers: Array<(r: any) => void> = []
  return {
    analyzeImageSharpness: vi.fn(() => {
      return new Promise((resolve) => {
        resolvers.push(resolve)
      })
    }),
    // Helper to resolve the next pending image-analysis call.
    resolveNext: (result: any) => {
      resolvers.shift()?.(result)
    },
    resolvers
  }
})

vi.mock('../../utils/qaqcAnalyzer', () => ({
  analyzeImageSharpness: controllable.analyzeImageSharpness
}))

// Shared payload builders for the worker request.
function makeThresholds(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    blurVarianceThreshold: 60,
    gpsMaxJumpDistanceMeters: 100,
    deliverableModel: 'masked_car',
    obstructionMinBrightness: 40,
    glareLuminanceThreshold: 200,
    ...overrides
  } as any
}

function makeConfig(overrides: Partial<Record<string, boolean>> = {}) {
  return {
    checkBlur: false,
    checkObstruction: false,
    checkGps: true,
    pic: 'test-pic',
    ...overrides
  }
}

const CLEAN_ANALYSIS = {
  isBlurry: false,
  minScore: 75,
  meanScore: 75,
  worstSector: 'Front',
  sectorScores: [],
  avgBrightness: 128,
  clippedRatio: 0,
  isObstruction: false,
  reason: '',
  status: 'analyzed'
}

type AnyMessage = { type: string; [k: string]: any }

describe('qaqc.worker message flow', () => {
  let postMessageMock: any
  let messages: AnyMessage[] = []

  const send = (data: { type: string; payload?: any }) => {
    // Re-read the current onmessage from self each time so state changes apply.
    const handler = (self as any).onmessage
    handler({ data })
  }

  beforeEach(async () => {
    messages = []
    postMessageMock = vi.fn((msg: AnyMessage) => {
      messages.push(msg)
    })
    // jsdom's `self === window`; reassign postMessage to capture worker output.
    Object.defineProperty(self, 'postMessage', {
      value: postMessageMock,
      configurable: true,
      writable: true
    })
    controllable.analyzeImageSharpness.mockClear()

    vi.resetModules()
    await import('../../workers/qaqc.worker')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('emits one STATION per input station and a final COMPLETE (GPS-only path)', async () => {
    send({
      type: 'START',
      payload: {
        subgrid: 'block-a',
        runId: 'run-1',
        pic: 'test-pic',
        config: makeConfig(),
        thresholds: makeThresholds(),
        stations: [
          { lat: 10.0, lng: 20.0, __pointId: 'a.jpg' },
          { lat: 10.001, lng: 20.0, __pointId: 'b.jpg' },
          { lat: 10.002, lng: 20.0, __pointId: 'c.jpg' }
        ]
      }
    })

    await new Promise((r) => setTimeout(r, 0))

    expect(controllable.analyzeImageSharpness).not.toHaveBeenCalled()

    const stations = messages.filter((m) => m.type === 'STATION')
    expect(stations.length).toBe(3)
    expect(stations.map((s) => s.pointId)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(stations[0].index).toBe(0)
    expect(stations[0].total).toBe(3)

    const complete = messages.find((m) => m.type === 'COMPLETE')
    expect(complete).toBeTruthy()
    expect(complete!.totalInspected).toBe(3)
    expect(complete!.subgrid).toBe('BLOCK-A')
    expect(complete!.runId).toBe('run-1')
    expect(complete!.history.length).toBe(3)
  })

  it('flags a GPS jump as a defect between consecutive stations', async () => {
    send({
      type: 'START',
      payload: {
        subgrid: 'block-b',
        runId: null,
        pic: 'test-pic',
        config: makeConfig(),
        thresholds: makeThresholds({ gpsMaxJumpDistanceMeters: 100 }),
        stations: [
          { lat: 10.0, lng: 20.0, __pointId: 'a.jpg' },
          { lat: 10.5, lng: 20.0, __pointId: 'b.jpg' }
        ]
      }
    })

    await new Promise((r) => setTimeout(r, 0))

    const stations = messages.filter((m) => m.type === 'STATION')
    expect(stations[0].liveCheckStatus.gps.status).toBe('passed')
    expect(stations[1].liveCheckStatus.gps.status).toBe('flagged')
    expect(stations[1].defectCount).toBe(1)
    expect(stations[1].defect.defect_type).toContain('Bad GPS Signal')

    const complete = messages.find((m) => m.type === 'COMPLETE')
    expect(complete?.defectsCount).toBe(1)
  })

  it('skips the GPS check and marks gps inactive when checkGps is off', async () => {
    send({
      type: 'START',
      payload: {
        subgrid: 'c',
        runId: null,
        pic: 'test-pic',
        config: makeConfig({ checkGps: false }),
        thresholds: makeThresholds(),
        stations: [
          { lat: 10.0, lng: 20.0, __pointId: 'a.jpg' },
          { lat: 10.001, lng: 20.0, __pointId: 'b.jpg' }
        ]
      }
    })

    await new Promise((r) => setTimeout(r, 0))

    const stations = messages.filter((m) => m.type === 'STATION')
    expect(stations[0].liveCheckStatus.gps.active).toBe(false)
    expect(stations[0].liveCheckStatus.gps.status).toBe('skipped')
    // No GPS defects should be recorded.
    expect(messages.find((m) => m.type === 'COMPLETE')?.defectsCount).toBe(0)
  })

  it('sends ABORTED (not COMPLETE) when ABORT interrupts an in-flight image analysis', async () => {
    send({
      type: 'START',
      payload: {
        subgrid: 'd',
        runId: null,
        pic: 'test-pic',
        config: makeConfig({ checkGps: false, checkBlur: true }),
        thresholds: makeThresholds(),
        // Second station keeps the worker suspended; abort then resolve.
        stations: [
          { lat: 10.0, lng: 20.0, __pointId: 'a.jpg', __imageUrl: 'a.jpg' },
          { lat: 10.001, lng: 20.0, __pointId: 'b.jpg', __imageUrl: 'b.jpg' }
        ]
      }
    })

    // Let the first station's pending image analysis suspend the loop.
    await new Promise((r) => setTimeout(r, 0))
    expect(controllable.analyzeImageSharpness).toHaveBeenCalled()

    send({ type: 'ABORT' })

    // Release the suspended image analysis; the loop should break before COMPLETE.
    controllable.resolveNext(CLEAN_ANALYSIS)
    await new Promise((r) => setTimeout(r, 20))

    expect(messages.some((m) => m.type === 'COMPLETE')).toBe(false)
    expect(messages.some((m) => m.type === 'ABORTED')).toBe(true)
  })
})
