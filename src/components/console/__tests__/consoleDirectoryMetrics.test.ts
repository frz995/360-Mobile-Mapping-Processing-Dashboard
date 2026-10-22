import { describe, it, expect } from 'vitest';
import { computeConsoleMetrics, formatMetric } from '../consoleDirectoryMetrics';
import type { Organization } from '../../../services/tenantContext';

/**
 * The two rules that decide what the console is allowed to print.
 *
 * They are pure functions on purpose: `useConsoleDirectory` is a React hook
 * pinned by the file-size ratchet, and a rule that cannot be tested without a
 * renderer is a rule that will be broken quietly. Every figure the console
 * shows about the portfolio comes out of `computeConsoleMetrics`, so the tests
 * below are the contract for the whole surface.
 *
 * THE TWO KINDS OF NOT-A-NUMBER
 *   Unmeasured    the read failed. The figure does not exist.
 *   Unconfigured  the read succeeded and the company has no limit on file.
 *                 That is a real, known fact — "unlimited" — and it is NOT a
 *                 limit of zero.
 */

const org = (over: Partial<Organization> = {}): Organization => ({
  id: 'org-1',
  name: 'Apex Geospatial',
  slug: 'apex',
  clientCode: 'APEX-01',
  databaseType: 'cloud_shared',
  databaseConfig: {},
  status: 'active',
  licenseType: 'cloud_saas',
  licenseExpiresAt: null,
  settings: {},
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...over
});

describe('computeConsoleMetrics — a failed read', () => {
  it('reports every figure as unknown', () => {
    const metrics = computeConsoleMetrics([], 'connection reset by peer');

    // An empty array would sum and count to zero. Every figure therefore
    // inherits the error, not the array.
    expect(metrics.activeCount).toBeNull();
    expect(metrics.totalSeats).toBeNull();
    expect(metrics.totalQuota).toBeNull();
    expect(metrics.dedicatedCount).toBeNull();
    expect(metrics.unlimitedSeatCount).toBeNull();
    expect(metrics.unlimitedQuotaCount).toBeNull();
  });

  it('reports every figure as unknown even when the failed read returned rows', () => {
    const metrics = computeConsoleMetrics(
      [org({ settings: { allowedUserSeats: 10, storageQuotaGb: 100 } })],
      'permission denied for table organizations'
    );

    expect(metrics.activeCount).toBeNull();
    expect(metrics.totalSeats).toBeNull();
    expect(metrics.totalQuota).toBeNull();
  });
});

describe('computeConsoleMetrics — an unconfigured limit', () => {
  it('counts a company with no limit on file as unlimited, not as zero', () => {
    const metrics = computeConsoleMetrics(
      [
        org({ id: 'a', settings: { allowedUserSeats: 10, storageQuotaGb: 100 } }),
        org({ id: 'b', settings: {} })
      ],
      null
    );

    // The old code mapped "no limit configured" onto 0, so a company sold an
    // unlimited seat pool silently became a company sold no seats.
    expect(metrics.totalSeats).toBe(10);
    expect(metrics.unlimitedSeatCount).toBe(1);
    expect(metrics.totalQuota).toBe(100);
    expect(metrics.unlimitedQuotaCount).toBe(1);
  });

  it('treats a configured limit of zero as a limit, not as an absent one', () => {
    const metrics = computeConsoleMetrics(
      [org({ id: 'a', settings: { allowedUserSeats: 0, storageQuotaGb: 0 } })],
      null
    );

    // Zero seats is a decision. Unlimited is the absence of one.
    expect(metrics.totalSeats).toBe(0);
    expect(metrics.unlimitedSeatCount).toBe(0);
    expect(metrics.totalQuota).toBe(0);
    expect(metrics.unlimitedQuotaCount).toBe(0);
  });

  it('sums only the limits that are configured', () => {
    const metrics = computeConsoleMetrics(
      [
        org({ id: 'a', settings: { allowedUserSeats: 5, storageQuotaGb: 50 } }),
        org({ id: 'b', settings: { allowedUserSeats: 7, storageQuotaGb: 70 } }),
        org({ id: 'c', settings: {} })
      ],
      null
    );

    expect(metrics.totalSeats).toBe(12);
    expect(metrics.totalQuota).toBe(120);
    expect(metrics.unlimitedSeatCount).toBe(1);
    expect(metrics.unlimitedQuotaCount).toBe(1);
  });
});

describe('computeConsoleMetrics — counting the portfolio', () => {
  it('counts active and dedicated companies', () => {
    const metrics = computeConsoleMetrics(
      [
        org({ id: 'a', status: 'active' }),
        org({ id: 'b', status: 'trial' }),
        org({ id: 'c', status: 'active', databaseType: 'dedicated_external' })
      ],
      null
    );

    expect(metrics.activeCount).toBe(2);
    expect(metrics.dedicatedCount).toBe(1);
  });

  it('measures an empty but verified directory as zero companies', () => {
    const metrics = computeConsoleMetrics([], null);

    // Verified and empty is a measurement. Verified empty and unverified
    // empty are the two states the console has to keep apart.
    expect(metrics.activeCount).toBe(0);
    expect(metrics.totalSeats).toBe(0);
    expect(metrics.unlimitedSeatCount).toBe(0);
  });
});

describe('formatMetric', () => {
  it('renders an unmeasured figure as unknown', () => {
    expect(formatMetric(null)).toBe('—');
    expect(formatMetric(undefined)).toBe('—');
    expect(formatMetric(Number.NaN)).toBe('—');
  });

  it('renders a measured figure, including zero, as itself', () => {
    expect(formatMetric(0)).toBe('0');
    expect(formatMetric(7)).toBe('7');
    expect(formatMetric(7, ' seats')).toBe('7 seats');
  });
});
