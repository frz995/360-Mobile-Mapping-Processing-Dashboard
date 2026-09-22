import { describe, it, expect } from 'vitest';
import { computeSurveyAnalytics } from '../surveyAnalytics';

describe('computeSurveyAnalytics - Road Plan & Actual Coverage', () => {
  const sampleBatches = [
    {
      grid: '1',
      subgrid: 'N93E70',
      kmProcessed: 2.71,
      poiCount: 164,
      availableImagesCount: 105,
      defects: 0,
      runsCount: 3
    },
    {
      grid: '1',
      subgrid: 'N94E70',
      kmProcessed: 0.63,
      poiCount: 100,
      availableImagesCount: 0,
      defects: 0,
      runsCount: 2
    },
    {
      grid: '1',
      subgrid: 'N94E71',
      kmProcessed: 0.03,
      poiCount: 9,
      availableImagesCount: 0,
      defects: 0,
      runsCount: 1
    }
  ];

  it('marks subgrids as having no plan source when road plan is not loaded/extracted', () => {
    const analytics = computeSurveyAnalytics({
      batches: sampleBatches,
      hasRoadPlanSource: false
    });

    expect(analytics.totals.hasRoadPlanSource).toBe(false);
    expect(analytics.totals.actualCoveragePct).toBeNull();
    expect(analytics.totals.totalPlanKm).toBe(0);

    for (const sg of analytics.perSubgrid) {
      expect(sg.hasPlanSource).toBe(false);
      expect(sg.planKm).toBeNull();
      expect(sg.remainingKm).toBeNull();
      expect(sg.actualCoveragePct).toBeNull();
    }
  });

  it('computes actual coverage % (current capture vs road plan) when road plan source exists', () => {
    const analytics = computeSurveyAnalytics({
      batches: sampleBatches,
      hasRoadPlanSource: true,
      roadPlanKm: 3.5,
      subgridPlanKm: {
        'N93E70': 3.2,
        'N94E70': 1.0,
        'N94E71': 0.1
      }
    });

    expect(analytics.totals.hasRoadPlanSource).toBe(true);
    expect(analytics.totals.totalPlanKm).toBe(4.3);
    // Total captured km: 2.71 + 0.63 + 0.03 = 3.37 km
    expect(analytics.totals.km).toBe(3.37);
    // 3.37 / 4.3 = 78%
    expect(analytics.totals.actualCoveragePct).toBe(78);
    // Remaining km: 4.3 - 3.37 = 0.93 km
    expect(analytics.totals.totalRemainingKm).toBe(0.93);

    const n93 = analytics.perSubgrid.find((s) => s.subgrid === 'N93E70')!;
    expect(n93.hasPlanSource).toBe(true);
    expect(n93.planKm).toBe(3.2);
    // Remaining: 3.2 - 2.71 = 0.49 km
    expect(n93.remainingKm).toBe(0.49);
    // Actual Coverage: 2.71 / 3.2 = 85%
    expect(n93.actualCoveragePct).toBe(85);

    const n94 = analytics.perSubgrid.find((s) => s.subgrid === 'N94E70')!;
    expect(n94.planKm).toBe(1.0);
    // Remaining: 1.0 - 0.63 = 0.37 km
    expect(n94.remainingKm).toBe(0.37);
    // Actual Coverage: 0.63 / 1.0 = 63%
    expect(n94.actualCoveragePct).toBe(63);
  });

  it('does not report a false 0 km remaining when a global road plan exists but per-subgrid plans are missing', () => {
    const analytics = computeSurveyAnalytics({
      batches: sampleBatches,
      hasRoadPlanSource: true,
      roadPlanKm: 100
    });

    // Campaign totals still use the global road plan.
    expect(analytics.totals.hasRoadPlanSource).toBe(true);
    expect(analytics.totals.totalPlanKm).toBe(100);
    expect(analytics.totals.totalRemainingKm).toBe(100 - 3.37);

    // Without per-subgrid plan attribution, rows must NOT claim 0 km remaining.
    for (const sg of analytics.perSubgrid) {
      expect(sg.hasPlanSource).toBe(true);
      expect(sg.planKm).toBeNull();
      expect(sg.remainingKm).toBeNull();
      expect(sg.actualCoveragePct).toBeNull();
    }
  });

  it('does not report a false 0 km remaining when the saved subgrid plan map is present but zero-filled', () => {
    // Road Analysis writes a subgridPlanKm entry per surveyed subgrid even
    // when no plan geometry was clipped to the cell (e.g. imported catalog /
    // system road plan). The values are all 0, so per-subgrid remaining must
    // be unknown, not "0 km".
    const analytics = computeSurveyAnalytics({
      batches: sampleBatches,
      hasRoadPlanSource: true,
      roadPlanKm: 4868.54,
      subgridPlanKm: {
        'N93E70': 0,
        'N94E70': 0,
        'N94E71': 0
      }
    });

    expect(analytics.totals.hasRoadPlanSource).toBe(true);
    expect(analytics.totals.totalPlanKm).toBe(4868.54);
    expect(analytics.totals.totalRemainingKm).toBeGreaterThan(0);

    for (const sg of analytics.perSubgrid) {
      expect(sg.hasPlanSource).toBe(true);
      expect(sg.planKm).toBeNull();
      expect(sg.remainingKm).toBeNull();
      expect(sg.actualCoveragePct).toBeNull();
    }
  });
});
