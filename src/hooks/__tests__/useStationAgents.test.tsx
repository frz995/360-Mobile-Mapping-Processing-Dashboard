import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useStationAgents } from '../useStationAgents';
import type { WorkstationStationConfig } from '../../types/production';

const wsOnline: WorkstationStationConfig = {
  id: 'stitch',
  name: 'PC 2 — Stitching Station',
  stepNumber: 2,
  software: 'PTGui Pro',
  defaultOperator: 'Multi-PC',
  sourceFolderTemplate: '/02_Blurring/{subgrid}/',
  outputFolderTemplate: '/03_Stitching/{subgrid}/',
  description: '',
  enabled: true,
  ipAddress: '192.168.1.102'
};

const wsOffline: WorkstationStationConfig = {
  ...wsOnline,
  id: 'blur',
  name: 'PC 1 — Privacy Blur Station',
  stepNumber: 1,
  ipAddress: '192.168.1.199'
};

function mockFetchFor(health: any, report: any) {
  return vi.fn(async (url: string) => {
    if (String(url).includes('192.168.1.102')) {
      if (String(url).endsWith('/health')) return { ok: true, json: async () => health };
      return { ok: true, json: async () => report };
    }
    throw new TypeError('network down');
  });
}

const reportLive = {
  agent_version: '1.0.0',
  station_id: 'stitch',
  hostname: 'PC2',
  task: { started: true, processes: [{ name: 'ptgui.exe', pid: 42, started_at: '2026-09-26T08:00:00+00:00' }], first_started_at: '2026-09-26T08:00:00+00:00' },
  output: { root: '/nas', stage: '03_Stitching', subgrids: { N93E70: { files: 5, last_write_at: '2026-09-26T08:01:00+00:00', growing: true } } },
  watch_error: null
};

describe('useStationAgents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('skips stations with no IP configured (no observation emitted)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useStationAgents([{ ...wsOnline, ipAddress: undefined }], 50));
    // Stations without an address are filtered out entirely — no probe, no entry.
    expect(result.current.observations['stitch']).toBeUndefined();
    expect(result.current.lastTickAt).toBeUndefined();
    expect(vi.mocked(fetch as any)).not.toHaveBeenCalled();
  });

  it('probes /health and /api/station and reports online stations', async () => {
    vi.stubGlobal('fetch', mockFetchFor({ status: 'ok', uptime_sec: 10 }, reportLive));
    const { result } = renderHook(() => useStationAgents([wsOnline, wsOffline], 50));
    await waitFor(() => {
      expect(result.current.observations['stitch']?.online).toBe(true);
    });
    const obs = result.current.observations['stitch'];
    expect(obs.report?.task?.started).toBe(true);
    expect(obs.report?.output?.subgrids?.N93E70.files).toBe(5);
    expect(obs.health?.status).toBe('ok');
    expect(obs.lastProbeAt).toBeTruthy();
  });

  it('marks unreachable stations offline with probe timestamps', async () => {
    vi.stubGlobal('fetch', mockFetchFor({ status: 'ok' }, reportLive));
    const { result } = renderHook(() => useStationAgents([wsOffline], 50));
    await waitFor(() => {
      expect(result.current.observations['blur']?.lastProbeAt).toBeTruthy();
    });
    expect(result.current.observations['blur'].online).toBe(false);
    expect(result.current.observations['blur'].report).toBeNull();
  });

  it('clears observations when no workstation is configured', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { result } = renderHook(() => useStationAgents([], 50));
    await waitFor(() => {
      expect(Object.keys(result.current.observations)).toHaveLength(0);
    });
  });
});
