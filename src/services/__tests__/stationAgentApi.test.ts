import { describe, it, expect, vi, afterEach } from 'vitest'
import { probeStationAgent, probeAllStationAgents } from '../stationAgentApi'
import type { WorkstationStationConfig } from '../../types/production'

/**
 * Vitest runs with import.meta.env.PROD === false, so these exercise the
 * local-dev path: agents are reached directly on the LAN.
 */

const baseWs: WorkstationStationConfig = {
  id: 'stitch',
  name: 'PC 2 — Stitching Station',
  stepNumber: 2,
  software: 'PTGui Pro',
  defaultOperator: 'Multi-PC',
  sourceFolderTemplate: '/02_Blurring/{subgrid}/',
  outputFolderTemplate: '/03_Stitching/{subgrid}/',
  description: '',
  enabled: true,
  ipAddress: '192.168.1.102',
  port: 8000
}

const liveReport = {
  agent_version: '1.0.0',
  station_id: 'stitch',
  hostname: 'PC2',
  task: { started: true, processes: [], first_started_at: '2026-09-26T08:00:00+00:00' },
  output: { root: '/nas', stage: '03_Stitching', subgrids: {}, growing: false },
  watch_error: null
}

/** Respond to /health and /api/station independently. */
function mockAgent(handlers: { health?: () => any; report?: () => any }) {
  return vi.fn(async (url: string) => {
    if (String(url).endsWith('/health')) {
      if (!handlers.health) throw new TypeError('network down')
      const r = await handlers.health()
      if (!r) throw new TypeError('network down')
      return { ok: true, json: async () => r }
    }
    if (!handlers.report) throw new TypeError('network down')
    const r = await handlers.report()
    if (!r) throw new TypeError('network down')
    return { ok: true, json: async () => r }
  })
}

const stub = (fn: ReturnType<typeof mockAgent>) => vi.stubGlobal('fetch', fn)

describe('probeStationAgent offline reasons', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a live agent as online with no reason', async () => {
    stub(mockAgent({ health: () => ({ agent_version: '1.0.0' }), report: () => liveReport }))
    const obs = await probeStationAgent(baseWs)
    expect(obs.online).toBe(true)
    expect(obs.reason).toBeUndefined()
  })

  it('distinguishes "disabled" from "unreachable"', async () => {
    stub(mockAgent({}))
    const obs = await probeStationAgent({ ...baseWs, enabled: false })
    expect(obs.online).toBe(false)
    expect(obs.reason).toBe('disabled')
  })

  it('distinguishes "no address configured" and never touches the network', async () => {
    const spy = mockAgent({ health: () => ({}), report: () => liveReport })
    stub(spy)
    const obs = await probeStationAgent({ ...baseWs, ipAddress: '' })
    expect(obs.online).toBe(false)
    expect(obs.reason).toBe('no-ip-configured')
    expect(obs.error).toMatch(/no workstation IP is configured/i)
    // The single most useful property: no doomed request is issued.
    expect(spy).not.toHaveBeenCalled()
  })

  it('distinguishes an agent that is alive but not reporting (NAS mount problem)', async () => {
    stub(mockAgent({ health: () => ({ agent_version: '1.0.0' }) }))
    const obs = await probeStationAgent(baseWs)
    expect(obs.online).toBe(false)
    expect(obs.reason).toBe('not-reporting')
    expect(obs.health).not.toBeNull()
    expect(obs.error).toMatch(/NAS mount/i)
  })

  it('reports a dead agent as unreachable', async () => {
    stub(mockAgent({}))
    const obs = await probeStationAgent(baseWs)
    expect(obs.online).toBe(false)
    expect(obs.reason).toBe('unreachable')
    expect(obs.error).toMatch(/unreachable/i)
  })
})

describe('probeAllStationAgents', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a reason for every enabled station instead of dropping it', async () => {
    stub(mockAgent({ health: () => ({}), report: () => liveReport }))
    const map = await probeAllStationAgents([
      baseWs,
      { ...baseWs, id: 'blur', ipAddress: '192.168.1.199' },
      { ...baseWs, id: 'lightroom', ipAddress: '' }
    ])
    expect(Object.keys(map).sort()).toEqual(['blur', 'lightroom', 'stitch'])
    expect(map.stitch.online).toBe(true)
    expect(map.lightroom.reason).toBe('no-ip-configured')
  })

  it('still omits disabled stations entirely', async () => {
    stub(mockAgent({ health: () => ({}), report: () => liveReport }))
    const map = await probeAllStationAgents([baseWs, { ...baseWs, id: 'blur', enabled: false }])
    expect(Object.keys(map)).toEqual(['stitch'])
  })
})
