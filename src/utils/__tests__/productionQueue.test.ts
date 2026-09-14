import { describe, it, expect, vi } from 'vitest';
import {
  jobStartTime,
  estimateEtaSeconds,
  isWorkerAlive,
  isJobActive,
  isJobTerminal
} from '../productionQueue';
import type { ProcessingJobRecord } from '../../types/production';

function baseJob(overrides: Partial<ProcessingJobRecord> = {}): ProcessingJobRecord {
  return {
    job_type: 'ENHANCE',
    status: 'IN_PROGRESS',
    progress: 50,
    ...overrides
  } as ProcessingJobRecord;
}

describe('productionQueue job clock helpers', () => {
  it('baselines ETA against started_at, not created_at', () => {
    // Job queued 100 minutes ago but only running for the last 20 minutes at 50%.
    const now = Date.now();
    const created = new Date(now - 100 * 60 * 1000).toISOString();
    const started = new Date(now - 20 * 60 * 1000).toISOString();
    const job = baseJob({ created_at: created, started_at: started, progress: 50 });

    const eta = estimateEtaSeconds(job);
    // 50% done in 20min => ~20min remaining (never the 100min of queue time).
    expect(eta).toBeGreaterThan(19 * 60);
    expect(eta).toBeLessThan(21 * 60);
  });

  it('falls back to created_at when started_at is missing', () => {
    const now = Date.now();
    const created = new Date(now - 10 * 60 * 1000).toISOString();
    const job = baseJob({ created_at: created, started_at: null, progress: 25 });
    const eta = estimateEtaSeconds(job);
    expect(eta).toBeGreaterThan(29 * 60);
    expect(eta).toBeLessThan(31 * 60);
  });

  it('returns null for non-active, zero-progress, or finished jobs', () => {
    expect(estimateEtaSeconds(baseJob({ status: 'QUEUED', progress: 0 }))).toBeNull();
    expect(estimateEtaSeconds(baseJob({ created_at: new Date().toISOString(), progress: 0 }))).toBeNull();
    expect(estimateEtaSeconds(baseJob({ created_at: new Date().toISOString(), progress: 100 }))).toBeNull();
    expect(estimateEtaSeconds(baseJob({ status: 'COMPLETED', created_at: new Date().toISOString() }))).toBeNull();
  });

  it('jobStartTime prefers started_at and still falls back', () => {
    expect(jobStartTime({ started_at: 'A', created_at: 'B' } as any)).toBe('A');
    expect(jobStartTime({ created_at: 'B' } as any)).toBe('B');
    expect(jobStartTime({} as any)).toBeUndefined();
  });

  it('isWorkerAlive accepts recent heartbeats and rejects stale/missing ones', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      expect(isWorkerAlive(baseJob({ last_heartbeat: new Date(Date.now() - 30 * 1000).toISOString() }))).toBe(true);
      expect(isWorkerAlive(baseJob({ last_heartbeat: new Date(Date.now() - 5 * 60 * 1000).toISOString() }))).toBe(false);
      expect(isWorkerAlive(baseJob({ last_heartbeat: undefined }))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies active and terminal statuses', () => {
    expect(isJobActive('QUEUED')).toBe(true);
    expect(isJobActive('IN_PROGRESS')).toBe(true);
    expect(isJobActive('COMPLETED')).toBe(false);
    expect(isJobTerminal('COMPLETED')).toBe(true);
    expect(isJobTerminal('IN_PROGRESS')).toBe(false);
  });
});