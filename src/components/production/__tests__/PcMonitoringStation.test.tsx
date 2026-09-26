import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PcMonitoringStation } from '../hub/PcMonitoringStation'
import { DEFAULT_4_WORKSTATIONS } from '../../../types/production'

const stationMocks = vi.hoisted(() => ({ useStationAgents: vi.fn() }))

vi.mock('../../../hooks/useStationAgents', () => ({
  useStationAgents: stationMocks.useStationAgents
}))

function obsFor(id: string, online: boolean, health?: Record<string, unknown>) {
  return { stationId: id, online, lastProbeAt: new Date().toISOString(), health: online ? health : null, report: online ? { hostname: `pc-${id}` } : null }
}

const healthFull = {
  status: 'ok',
  agent_version: '1.0.0',
  cpu_usage: 34,
  cpu_cores: 16,
  cpu_percpu: [10, 90, 50],
  gpu_usage: 11,
  gpu_name: 'NVIDIA GeForce RTX 3080',
  ram_total_gb: 32,
  ram_used_gb: 12.8,
  storage_used_pct: 75.3,
  disk_total: 1024.0,
  disk_free_gb: 512.1,
  uptime_sec: 90000
}

function setup(opts: { vncStations?: number } = {}) {
  const workstationsConfig = DEFAULT_4_WORKSTATIONS.map((w, i) => ({
    ...w,
    vncPort: (opts.vncStations ?? 0) > i ? 6080 : undefined,
    remoteChannel: (opts.vncStations ?? 0) > i ? ('vnc' as const) : undefined
  }))
  const observations: Record<string, ReturnType<typeof obsFor>> = {}
  workstationsConfig.forEach((w) => {
    observations[w.id] = obsFor(w.id, true, healthFull)
  })
  stationMocks.useStationAgents.mockReturnValue({ observations, lastTickAt: '2026-09-26T09:00:00+00:00' })
  return workstationsConfig
}

describe('PcMonitoringStation', () => {
  beforeAll(() => {
    // jsdom lacks the blob URL API; the .rdp handoff uses it.
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:rdp') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
  })

  beforeEach(() => {
    stationMocks.useStationAgents.mockReset()
  })

  afterEach(cleanup)

  it('renders four live telemetry cards with agent metrics', () => {
    const ws = setup()
    render(<PcMonitoringStation userLabel="QA Lead" projectSettings={{ workstationsConfig: ws }} />)
    expect(screen.getByText(/4\/4 agents live/)).toBeInTheDocument()
    expect(screen.getAllByText('34%').length).toBe(4) // CPU on every card
    expect(screen.getAllByText('11%').length).toBe(4) // GPU
    expect(screen.getAllByText('40%').length).toBe(4) // RAM 12.8/32
    expect(screen.getAllByText('75%').length).toBe(4) // storage
    expect(screen.getAllByText('512.1 GB free of 1024 GB').length).toBe(4)
    expect(screen.getAllByText('agent 1.0.0').length).toBe(4)
    expect(screen.getAllByRole('button', { name: /Open RDP/i }).length).toBeGreaterThanOrEqual(4)
  })

  it('renders embedded VNC panes only for stations with a VNC channel configured', () => {
    const ws = setup({ vncStations: 2 })
    const { container } = render(
      <PcMonitoringStation userLabel="QA Lead" projectSettings={{ workstationsConfig: ws }} />
    )
    const iframes = container.querySelectorAll('iframe')
    expect(iframes).toHaveLength(2)
    expect(iframes[0].getAttribute('src')).toContain('192.168.1.101:6080/vnc.html')
    expect(screen.getAllByText(/Embedded live view is not enabled/i).length).toBe(2)
    expect(screen.getByText(/2\/4 VNC enabled/)).toBeInTheDocument()
  })

  it('downloads an .rdp handoff on Open RDP and audits the action', () => {
    const ws = setup()
    const addNotification = vi.fn()
    const addAuditLog = vi.fn()
    render(
      <PcMonitoringStation
        userLabel="QA Lead"
        projectSettings={{ workstationsConfig: ws }}
        addNotification={addNotification}
        addAuditLog={addAuditLog}
      />
    )
    fireEvent.click(screen.getAllByRole('button', { name: /Open RDP/i })[0])
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('RDP session prepared') })
    )
    expect(addAuditLog).toHaveBeenCalledWith('INFO', 'RDP Handoff Launched', expect.stringContaining('192.168.1.101'), 'info')
  })
})
