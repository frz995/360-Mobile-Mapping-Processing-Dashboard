import { describe, it, expect } from 'vitest';
import {
  buildSubgridWalk,
  buildTracePlans,
  chainConnector,
  chainRunsOrder,
  compareSubgridGridNames,
  computePlanCoverage,
  densifyRun,
  finalizeSubgridResult,
  polylineInterpolateAt,
  polylineSliceByFraction,
  surveyCoordsFromRun,
  walkSegmentsToRuns,
  type LonLat,
  type SubgridTracePlan,
  type TraceSurvey
} from '../roadNetworkTrace';

const BASE_LNG = 101.5;
const BASE_LAT = 3.1;

/** Dense capture line: `n` points from lng 0..spanDeg at fixed lat. */
function denseLine(lat: number, lngStart: number, lngEnd: number, n: number): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    pts.push([lngStart + ((lngEnd - lngStart) * i) / (n - 1), lat]);
  }
  return pts;
}

function makeRun(subgrid: string, date: string, coords: LonLat[], id?: string): any {
  return {
    id: id || `${subgrid}-${date}`,
    subgrid,
    date,
    panoramas: coords.map((c, i) => ({
      filename: `${subgrid}-${String(i).padStart(4, '0')}.jpg`,
      longitude: c[0],
      latitude: c[1]
    }))
  };
}

describe('roadNetworkTrace utility', () => {
  it('orders subgrids north-to-south then west-to-east', () => {
    const names = ['N92E70', 'N93E71', 'N93E70', 'ABC123', 'N93E69'];
    expect([...names].sort(compareSubgridGridNames)).toEqual([
      'N93E69',
      'N93E70',
      'N93E71',
      'N92E70',
      'ABC123'
    ]);
  });

  it('parses survey coords from panoramas or points, skipping null islands', () => {
    const fromPanos = surveyCoordsFromRun(
      makeRun('N93E70', '2026-01-01', [[BASE_LNG, BASE_LAT], [BASE_LNG + 0.001, BASE_LAT]])
    );
    expect(fromPanos).toEqual([
      [BASE_LNG, BASE_LAT],
      [BASE_LNG + 0.001, BASE_LAT]
    ]);

    const mixed = surveyCoordsFromRun({
      subgrid: 'N93E70',
      points: [
        { lon: BASE_LNG, lat: BASE_LAT },
        { lon: 0, lat: 0 },
        { lon: BASE_LNG + 0.002, lat: BASE_LAT }
      ]
    });
    expect(mixed.length).toBe(2);
  });

  describe('buildTracePlans', () => {
    const daily = [
      // Newer date listed first — must be re-ordered chronologically.
      makeRun('N93E70', '2026-01-05', [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.004, BASE_LAT]
      ]),
      makeRun('N93E70', '2026-01-02', [
        [BASE_LNG - 0.004, BASE_LAT],
        [BASE_LNG - 0.001, BASE_LAT]
      ]),
      // Single-point run must be discarded.
      makeRun('N93E70', '2026-01-03', [[BASE_LNG + 0.01, BASE_LAT]]),
      // Adjacent subgrid to the north (higher N row) — sorted first.
      makeRun('N92E70', '2026-01-04', [
        [BASE_LNG, BASE_LAT + 0.045],
        [BASE_LNG + 0.002, BASE_LAT + 0.045]
      ])
    ];

    it('groups by subgrid, chains surveys chronologically, orders the grid', () => {
      const plans = buildTracePlans(daily);
      expect(plans.map((p) => p.subgrid)).toEqual(['N93E70', 'N92E70']);

      const main = plans[0];
      expect(main.surveys.map((s) => s.date)).toEqual(['2026-01-02', '2026-01-05']);
      expect(main.surveys.every((s) => s.coords.length >= 2)).toBe(true);
      expect(main.capturedKm).toBeGreaterThan(0);
      // No plan runs supplied → 5x5 km bbox derived from captured points.
      expect(main.bbox[2] - main.bbox[0]).toBeCloseTo(0.045, 3);
    });

    it('clips the plan runs to each subgrid bbox and honors the filter', () => {
      const planRuns: LonLat[][] = [
        [
          [BASE_LNG - 0.03, BASE_LAT],
          [BASE_LNG - 0.01, BASE_LAT],
          [BASE_LNG + 0.01, BASE_LAT],
          [BASE_LNG + 0.03, BASE_LAT]
        ]
      ];
      const plans = buildTracePlans(daily, { planRuns });
      const main = plans[0];
      expect(main.planRuns.length).toBe(1);
      expect(main.planRuns[0].every((p) => p[0] >= main.bbox[0] && p[0] <= main.bbox[2])).toBe(true);
      expect(main.planKm).toBeGreaterThan(0);

      const filtered = buildTracePlans(daily, { planRuns, subgridFilter: new Set(['N93E70']) });
      expect(filtered.map((p) => p.subgrid)).toEqual(['N93E70']);
    });
  });

  describe('chainConnector', () => {
    const survey = (coords: LonLat[]): TraceSurvey => ({
      runId: 'r',
      subgrid: 'N93E70',
      date: '',
      coords,
      lengthKm: 0
    });

    it('links far-apart endpoints and skips near-adjacent jumps', () => {
      const far = chainConnector(
        survey([[BASE_LNG, BASE_LAT]]),
        survey([[BASE_LNG + 0.01, BASE_LAT]])
      );
      expect(far).toEqual([
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.01, BASE_LAT]
      ]);

      const near = chainConnector(
        survey([[BASE_LNG, BASE_LAT]]),
        survey([[BASE_LNG + 0.00002, BASE_LAT]])
      );
      expect(near).toBeNull();
    });
  });

  describe('chainRunsOrder', () => {
    it('chains runs by nearest endpoint and orients them into walk order', () => {
      const a: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.001, BASE_LAT]
      ];
      // Reversed so the walk must flip it to enter at its near endpoint.
      const b: LonLat[] = [
        [BASE_LNG + 0.011, BASE_LAT],
        [BASE_LNG + 0.010, BASE_LAT]
      ];
      const { ordered, links } = chainRunsOrder([a, b]);
      expect(ordered.length).toBe(2);
      // Second run oriented so it starts nearer the previous run's end.
      expect(ordered[1][0][0]).toBeCloseTo(BASE_LNG + 0.010, 5);
      // ~1 km joint is a cross-country jump → nothing drawn.
      expect(links.length).toBe(0);
    });

    it('emits a link only for short joins', () => {
      const a: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.001, BASE_LAT]
      ];
      const close: LonLat[] = [
        [BASE_LNG + 0.002, BASE_LAT],
        [BASE_LNG + 0.003, BASE_LAT]
      ];
      const { links } = chainRunsOrder([a, close]);
      expect(links.length).toBe(1);
      expect(links[0][0][0]).toBeCloseTo(BASE_LNG + 0.001, 5);
    });

    it('traverses a branched T-junction network without generating cross-country jump links', () => {
      // Main road split at junction (BASE_LNG + 0.005), side road branching north
      const mainWest: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.005, BASE_LAT]
      ];
      const mainEast: LonLat[] = [
        [BASE_LNG + 0.005, BASE_LAT],
        [BASE_LNG + 0.01, BASE_LAT]
      ];
      const sideNorth: LonLat[] = [
        [BASE_LNG + 0.005, BASE_LAT],
        [BASE_LNG + 0.005, BASE_LAT + 0.003]
      ];

      const { ordered, links } = chainRunsOrder([mainWest, mainEast, sideNorth]);
      expect(ordered.length).toBe(3);
      // All 3 edges connect at the junction -> zero jump links
      expect(links.length).toBe(0);
    });
  });

  describe('polyline helpers', () => {
    const line: LonLat[] = [
      [BASE_LNG, BASE_LAT],
      [BASE_LNG + 0.01, BASE_LAT]
    ];

    it('slices growing prefixes for animation frames', () => {
      expect(polylineSliceByFraction(line, 0)).toEqual([]);
      const half = polylineSliceByFraction(line, 0.5);
      expect(half.length).toBeGreaterThanOrEqual(2);
      expect(half[half.length - 1][0]).toBeCloseTo(BASE_LNG + 0.005, 5);
      expect(polylineSliceByFraction(line, 1)).toEqual(line);
    });

    it('interpolates coordinates at a target distance', () => {
      const mid = polylineInterpolateAt(line, 555.85);
      expect(mid![0]).toBeCloseTo(BASE_LNG + 0.005, 3);
    });

    it('densifies so no consecutive sample exceeds the step', () => {
      const dense = densifyRun(
        [
          [BASE_LNG, BASE_LAT],
          [BASE_LNG + 0.001, BASE_LAT]
        ],
        10
      );
      expect(dense.length).toBeGreaterThanOrEqual(11);
    });
  });

  describe('computePlanCoverage', () => {
    // ~111 m plan run at fixed latitude.
    const run: LonLat[] = [
      [BASE_LNG, BASE_LAT],
      [BASE_LNG + 0.001, BASE_LAT]
    ];

    it('reports full coverage with no gaps when captured densely on top', () => {
      const tracks = [denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.001, 25)];
      const res = computePlanCoverage([run], tracks, 25);
      expect(res.planKm).toBeCloseTo(0.111, 2);
      expect(res.coveredPct).toBeGreaterThanOrEqual(99);
      expect(res.uncoveredRuns.length).toBe(0);
    });

    it('flags unsurveyed stretches as uncovered gap runs', () => {
      const tracks = [denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.0005, 15)];
      const res = computePlanCoverage([run], tracks, 25);
      expect(res.coveredPct).toBeLessThan(80);
      expect(res.uncoveredRuns.length).toBe(1);
      expect(res.uncoveredRuns[0].length).toBeGreaterThanOrEqual(2);
      expect(res.planKm - res.coveredKm).toBeGreaterThan(0.03);
    });

    it('respects the tolerance distance', () => {
      const offsetLat = BASE_LAT + 0.0003; // ~33 m off the plan
      const tracks = [denseLine(offsetLat, BASE_LNG, BASE_LNG + 0.001, 25)];
      expect(computePlanCoverage([run], tracks, 25).coveredPct).toBeLessThan(10);
      expect(computePlanCoverage([run], tracks, 50).coveredPct).toBeGreaterThan(90);
    });

    it('returns zero coverage without tracks or plan', () => {
      expect(computePlanCoverage([run], [], 25).coveredPct).toBe(0);
      expect(computePlanCoverage([], [denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.001, 5)], 25).planKm).toBe(0);
    });

    it('leaves an entire isolated unsurveyed short road as uncovered', () => {
      // Short run ~22 meters
      const shortRun: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.0002, BASE_LAT]
      ];
      // Zero capture tracks
      const res = computePlanCoverage([shortRun], [], 25);
      expect(res.coveredPct).toBe(0);
      expect(res.uncoveredRuns.length).toBe(1);
      expect(res.uncoveredRuns[0].length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('finalizeSubgridResult', () => {
    const plan: SubgridTracePlan = {
      subgrid: 'N93E70',
      bbox: [BASE_LNG, BASE_LAT, BASE_LNG + 0.045, BASE_LAT + 0.045],
      surveys: [],
      planRuns: [
        [
          [BASE_LNG, BASE_LAT],
          [BASE_LNG + 0.001, BASE_LAT]
        ]
      ],
      planKm: 0.111,
      capturedKm: 0.5,
      totalTraceM: 500
    };

    it('applies the completion threshold', () => {
      const coverage = { planKm: 0.111, coveredKm: 0.106, coveredPct: 95.5, uncoveredRuns: [] as LonLat[][] };
      expect(finalizeSubgridResult(plan, coverage, 95).status).toBe('complete');
      expect(finalizeSubgridResult(plan, coverage, 96).status).toBe('incomplete');
      expect(finalizeSubgridResult(plan, coverage, 96).coveredPct).toBe(95.5);
    });

    it('marks subgrids without plan geometry as no-plan', () => {
      const empty = { ...plan, planRuns: [] as LonLat[][] };
      const coverage = { planKm: 0, coveredKm: 0, coveredPct: 0, uncoveredRuns: [] as LonLat[][] };
      const res = finalizeSubgridResult(empty, coverage, 95);
      expect(res.status).toBe('no-plan');
      expect(res.coveredPct).toBeNull();
      expect(res.gapKm).toBe(0);
    });
  });

  describe('buildSubgridWalk', () => {
    const run1: LonLat[] = [
      [BASE_LNG, BASE_LAT],
      [BASE_LNG + 0.001, BASE_LAT]
    ];
    const run2: LonLat[] = [
      [BASE_LNG + 0.01, BASE_LAT],
      [BASE_LNG + 0.011, BASE_LAT]
    ];

    it('chains disconnected runs, drawing only SHORT jump links', () => {
      // ~111 m apart → short joint, the dashed link is drawn.
      const closeRun: LonLat[] = [
        [BASE_LNG + 0.002, BASE_LAT],
        [BASE_LNG + 0.003, BASE_LAT]
      ];
      const walk = buildSubgridWalk('N93E70', [run1, closeRun], [], 25);
      expect(walk.orderedRuns.length).toBe(2);
      expect(walk.links.length).toBe(1);
      expect(walk.links[0][0][0]).toBeCloseTo(BASE_LNG + 0.001, 5);

      // ~1 km apart → cross-country jump is NOT drawn.
      const walkFar = buildSubgridWalk('N93E70', [run1, run2], [], 25);
      expect(walkFar.links.length).toBe(0);
      // Both ~111 m runs still counted in the walkable total.
      expect(walkFar.totalM).toBeGreaterThan(200);
      expect(walkFar.gapM).toBeCloseTo(walkFar.totalM, 0);
      expect(walkFar.coveredM).toBe(0);
    });

    it('orients the next run so the walk enters at its nearest endpoint', () => {
      const reversed: LonLat[] = [...run2].reverse() as LonLat[];
      const walk = buildSubgridWalk('N93E70', [run1, reversed], [], 25);
      expect(walk.orderedRuns[1][0][0]).toBeCloseTo(BASE_LNG + 0.01, 5);
    });

    it('flags plan slices as covered only where panotrack exists', () => {
      // Capture covers only the right half of run1.
      const captured = [denseLine(BASE_LAT, BASE_LNG + 0.0005, BASE_LNG + 0.001, 15)];
      const walk = buildSubgridWalk('N93E70', [run1], captured, 25);
      const covSegs = walk.segments.filter((s) => s.covered);
      const gapSegs = walk.segments.filter((s) => !s.covered);
      expect(covSegs.length).toBeGreaterThan(0);
      expect(gapSegs.length).toBeGreaterThan(0);
      expect(walk.coveredM).toBeGreaterThan(0);
      expect(walk.gapM).toBeGreaterThan(0);
      // All covered slices sit in the right (captured) half.
      const minCoveredLng = Math.min(...covSegs.map((s) => s.a[0]));
      expect(minCoveredLng).toBeGreaterThanOrEqual(BASE_LNG + 0.0003);
      // Gap slices exist in the left (uncaptured) half.
      const maxGapLng = Math.max(...gapSegs.map((s) => s.b[0]));
      expect(maxGapLng).toBeLessThanOrEqual(BASE_LNG + 0.0007);
    });

    it('prunes cross-street junction bleed so an unsurveyed side road gap extends to the junction', () => {
      // Side road from BASE_LNG (junction with main road) East to BASE_LNG + 0.002 (~220m)
      const sideRoad: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.002, BASE_LAT]
      ];
      // Capture survey only on the main road: passing through BASE_LNG at lat BASE_LAT - 0.0001 to BASE_LAT + 0.0001
      // (Bleeds ~11m into sideRoad at the junction mouth)
      const mainRoadCapture: LonLat[] = [
        [BASE_LNG, BASE_LAT - 0.0001],
        [BASE_LNG, BASE_LAT + 0.0001]
      ];
      const walk = buildSubgridWalk('N93E70', [sideRoad], [mainRoadCapture], 25);
      // Because sideRoad is predominantly unsurveyed, the junction bleed must be pruned
      // and the gap must start directly at BASE_LNG:
      const gapSegs = walk.segments.filter((s) => !s.covered);
      expect(gapSegs.length).toBeGreaterThan(0);
      expect(gapSegs[0].a[0]).toBeCloseTo(BASE_LNG, 5);
      expect(walk.gapM).toBeCloseTo(walk.totalM, 0);
    });

    it('returns an empty walk without plan geometry', () => {
      const walk = buildSubgridWalk('N93E70', [], [], 25);
      expect(walk.segments.length).toBe(0);
      expect(walk.totalM).toBe(0);
    });
  });

  describe('walkSegmentsToRuns', () => {
    it('groups contiguous walked segments per run and splits on jumps', () => {
      const segs = [
        { a: [0, 0] as LonLat, b: [1, 0] as LonLat, covered: false, lengthM: 1, runIndex: 0 },
        { a: [1, 0] as LonLat, b: [2, 0] as LonLat, covered: false, lengthM: 1, runIndex: 0 },
        { a: [5, 0] as LonLat, b: [6, 0] as LonLat, covered: false, lengthM: 1, runIndex: 1 }
      ];
      const runs = walkSegmentsToRuns(segs);
      expect(runs).toEqual([
        [
          [0, 0],
          [1, 0],
          [2, 0]
        ],
        [
          [5, 0],
          [6, 0]
        ]
      ]);
    });
  });
});
