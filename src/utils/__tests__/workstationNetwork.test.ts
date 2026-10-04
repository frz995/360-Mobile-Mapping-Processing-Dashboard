import { describe, it, expect } from 'vitest';
import {
  RDP_DEFAULT_PORT,
  STATION_AGENT_DEFAULT_PORT,
  countConfiguredStations,
  isValidStationHost,
  normalizeWorkstations,
  parsePortInput,
  stationIsConfigured,
  withStationPatch
} from '../workstationNetwork';
import { DEFAULT_4_WORKSTATIONS } from '../../types/production';

describe('normalizeWorkstations', () => {
  it('seeds the four shipped stations when nothing is stored', () => {
    const stations = normalizeWorkstations(null);
    expect(stations).toHaveLength(4);
    expect(stations.map(s => s.id)).toEqual(['blur', 'stitch', 'lightroom', 'photoshop']);
    // The shipped topology must not invent addresses.
    expect(stations.every(s => s.ipAddress === undefined)).toBe(true);
  });

  it('overlays stored addresses onto the shipped topology', () => {
    const stations = normalizeWorkstations([
      { id: 'blur', ipAddress: '10.0.0.5', port: 8000 } as never
    ]);
    const blur = stations.find(s => s.id === 'blur');
    expect(blur?.ipAddress).toBe('10.0.0.5');
    expect(blur?.port).toBe(8000);
    expect(stations.find(s => s.id === 'stitch')?.ipAddress).toBeUndefined();
  });

  it('drops blank strings so an emptied field is absent, not empty', () => {
    const stations = normalizeWorkstations([
      { id: 'blur', ipAddress: '   ', agentToken: '' } as never
    ]);
    const blur = stations.find(s => s.id === 'blur');
    expect('ipAddress' in (blur || {})).toBe(false);
    expect('agentToken' in (blur || {})).toBe(false);
  });

  it('strips stale live telemetry rather than persisting it', () => {
    const stations = normalizeWorkstations([
      {
        id: 'blur',
        ipAddress: '10.0.0.5',
        isOnline: true,
        cpuUsage: 42,
        lastHeartbeat: '2026-01-01T00:00:00Z'
      } as never
    ]);
    const blur = stations.find(s => s.id === 'blur') || {};
    expect(blur).not.toHaveProperty('isOnline');
    expect(blur).not.toHaveProperty('cpuUsage');
    expect(blur).not.toHaveProperty('lastHeartbeat');
  });

  it('preserves a station id outside the shipped topology', () => {
    const stations = normalizeWorkstations([
      { id: 'extra-qc', name: 'Extra QC', stepNumber: 5, ipAddress: '10.0.0.9' } as never
    ]);
    expect(stations).toHaveLength(5);
    expect(stations.find(s => (s.id as string) === 'extra-qc')?.ipAddress).toBe('10.0.0.9');
  });

  it('respects a stored enabled:false', () => {
    const stations = normalizeWorkstations([{ id: 'photoshop', enabled: false } as never]);
    expect(stations.find(s => s.id === 'photoshop')?.enabled).toBe(false);
  });
});

describe('withStationPatch', () => {
  it('changes only the targeted station', () => {
    const base = normalizeWorkstations(null);
    const next = withStationPatch(base, 'stitch', { ipAddress: '10.1.1.1' });
    expect(next.find(s => s.id === 'stitch')?.ipAddress).toBe('10.1.1.1');
    expect(next.find(s => s.id === 'blur')?.ipAddress).toBeUndefined();
    // original untouched
    expect(base.find(s => s.id === 'stitch')?.ipAddress).toBeUndefined();
  });

  it('preserves enabled:false, which compaction would otherwise drop', () => {
    const base = normalizeWorkstations([{ id: 'blur', enabled: false } as never]);
    const next = withStationPatch(base, 'blur', { ipAddress: '10.2.2.2' });
    expect(next.find(s => s.id === 'blur')?.enabled).toBe(false);
    expect(next.find(s => s.id === 'blur')?.ipAddress).toBe('10.2.2.2');
  });

  it('clears a field when patched with an empty string', () => {
    const base = withStationPatch(normalizeWorkstations(null), 'blur', { ipAddress: '10.3.3.3' });
    const next = withStationPatch(base, 'blur', { ipAddress: '' });
    expect(next.find(s => s.id === 'blur')).not.toHaveProperty('ipAddress');
  });

  it('keeps topology fields when patching network fields', () => {
    const base = normalizeWorkstations(null);
    const next = withStationPatch(base, 'lightroom', { ipAddress: '10.4.4.4', port: 8000 });
    const l = next.find(s => s.id === 'lightroom');
    expect(l?.name).toBe(DEFAULT_4_WORKSTATIONS[2].name);
    expect(l?.software).toBe(DEFAULT_4_WORKSTATIONS[2].software);
    expect(l?.outputFolderTemplate).toBe(DEFAULT_4_WORKSTATIONS[2].outputFolderTemplate);
  });
});

describe('parsePortInput', () => {
  it('treats blank as unset', () => {
    expect(parsePortInput('')).toBeUndefined();
    expect(parsePortInput('   ')).toBeUndefined();
  });

  it('parses valid TCP ports', () => {
    expect(parsePortInput('8000')).toBe(8000);
    expect(parsePortInput(' 3389 ')).toBe(3389);
    expect(parsePortInput('65535')).toBe(65535);
  });

  it('rejects non-numeric and out-of-range values', () => {
    expect(parsePortInput('80a')).toBeUndefined();
    expect(parsePortInput('-1')).toBeUndefined();
    expect(parsePortInput('0')).toBeUndefined();
    expect(parsePortInput('65536')).toBeUndefined();
  });
});

describe('isValidStationHost', () => {
  it('accepts IPv4 literals', () => {
    expect(isValidStationHost('10.20.30.11')).toBe(true);
    expect(isValidStationHost('192.168.1.1')).toBe(true);
  });

  it('rejects malformed IPv4', () => {
    expect(isValidStationHost('10.20.30')).toBe(false);
    expect(isValidStationHost('10.20.30.300')).toBe(false);
    expect(isValidStationHost('10.20.30.011')).toBe(false);
  });

  it('accepts hostnames and rejects blank or spaced input', () => {
    expect(isValidStationHost('pc1-agent.internal')).toBe(true);
    expect(isValidStationHost('')).toBe(false);
    expect(isValidStationHost('10.0.0.1 x')).toBe(false);
  });
});

describe('station readiness', () => {
  it('treats an address as the readiness signal', () => {
    expect(stationIsConfigured({ ipAddress: '10.0.0.5' } as never)).toBe(true);
    expect(stationIsConfigured({} as never)).toBe(false);
    expect(stationIsConfigured({ ipAddress: '  ' } as never)).toBe(false);
  });

  it('counts configured stations', () => {
    const stations = withStationPatch(
      withStationPatch(normalizeWorkstations(null), 'blur', { ipAddress: '10.0.0.1' }),
      'stitch',
      { ipAddress: '10.0.0.2' }
    );
    expect(countConfiguredStations(stations)).toBe(2);
  });
});

describe('documented defaults', () => {
  it('matches the station-agent and mstsc defaults', () => {
    expect(STATION_AGENT_DEFAULT_PORT).toBe(8000);
    expect(RDP_DEFAULT_PORT).toBe(3389);
  });
});
