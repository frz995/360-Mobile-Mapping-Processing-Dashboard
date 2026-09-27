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
  type PlanCoverage,
  type SubgridTracePlan,
  type TraceSurvey
} from '../roadNetworkTrace';

const BASE_LNG = 101.5;
const BASE_LAT = 3.1;

/** Metres per degree of longitude at BASE_LAT, matching the distM projection. */
const M_PER_DEG_LNG = 111320 * Math.cos((BASE_LAT * Math.PI) / 180);

/** Longitude `m` metres east of BASE_LNG, along BASE_LAT. */
function lngEast(m: number): number {
  return BASE_LNG + m / M_PER_DEG_LNG;
}

/** Metres east of BASE_LNG for a longitude, along BASE_LAT. */
function mEast(lng: number): number {
  return (lng - BASE_LNG) * M_PER_DEG_LNG;
}

/** Dense capture line: `n` points from lng 0..spanDeg at fixed lat. */
function denseLine(lat: number, lngStart: number, lngEnd: number, n: number): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    pts.push([lngStart + ((lngEnd - lngStart) * i) / (n - 1), lat]);
  }
  return pts;
}

/** Dense capture line: `n` points from latStart..latEnd at fixed lng. */
function denseLineNS(lng: number, latStart: number, latEnd: number, n: number): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i < n; i++) {
    pts.push([lng, latStart + ((latEnd - latStart) * i) / (n - 1)]);
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

    it('reports no traced stretches when captured densely on top', () => {
      const tracks = [denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.001, 25)];
      const res = computePlanCoverage([run], tracks, 25);
      expect(res.planKm).toBeCloseTo(0.111, 2);
      expect(res.tracedPct).toBeLessThanOrEqual(1);
      expect(res.uncoveredRuns.length).toBe(0);
    });

    it('flags unsurveyed stretches as trace (no-panotrack) runs', () => {
      const tracks = [denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.0005, 15)];
      const res = computePlanCoverage([run], tracks, 25);
      expect(res.tracedPct).toBeGreaterThan(20);
      expect(res.tracedPct).toBeLessThan(80);
      expect(res.uncoveredRuns.length).toBe(1);
      expect(res.uncoveredRuns[0].length).toBeGreaterThanOrEqual(2);
      // The capture ends 55.6 m along the 111 m run, so with tolerance 25 the
      // exact uncovered stretch is 111.1 - (55.6 + 25) = ~30.6 m.
      expect(res.tracedKm).toBeGreaterThan(0.025);
    });

    it('respects the tolerance distance', () => {
      const offsetLat = BASE_LAT + 0.0003; // ~33 m off the plan
      const tracks = [denseLine(offsetLat, BASE_LNG, BASE_LNG + 0.001, 25)];
      expect(computePlanCoverage([run], tracks, 25).tracedPct).toBeGreaterThan(90);
      expect(computePlanCoverage([run], tracks, 50).tracedPct).toBeLessThan(10);
    });

    it('returns full traced share without tracks or plan', () => {
      expect(computePlanCoverage([run], [], 25).tracedPct).toBe(100);
      expect(computePlanCoverage([], [denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.001, 5)], 25).planKm).toBe(0);
    });

    it('leaves an entire isolated unsurveyed short road as traced', () => {
      // Short run ~22 meters
      const shortRun: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.0002, BASE_LAT]
      ];
      // Zero capture tracks
      const res = computePlanCoverage([shortRun], [], 25);
      expect(res.tracedPct).toBe(100);
      expect(res.uncoveredRuns.length).toBe(1);
      expect(res.uncoveredRuns[0].length).toBeGreaterThanOrEqual(2);
    });

    it('streams per-run progress through the onRunProgress callback', () => {
      const runs: LonLat[][] = [
        denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.001, 3),
        denseLine(BASE_LAT, BASE_LNG + 0.002, BASE_LNG + 0.003, 3),
        denseLine(BASE_LAT, BASE_LNG + 0.004, BASE_LNG + 0.005, 3)
      ];
      const steps: Array<[number, number]> = [];
      computePlanCoverage(runs, [], 25, 10, (done, total) => steps.push([done, total]));
      expect(steps).toEqual([
        [1, 3],
        [2, 3],
        [3, 3]
      ]);
    });

    it('preserves junction-vertex continuity between two runs that share a vertex', () => {
      // One continuous road interrupted at a junction between runs (as the
      // plan stitcher produces): west leg, shared vertex, east leg. Both are
      // entirely uncovered, so the traced segments must stay vertex-joined —
      // no artificial gap from per-cell clipping.
      const junction: LonLat = [BASE_LNG + 0.001, BASE_LAT];
      const west: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        junction
      ];
      const east: LonLat[] = [
        junction,
        [BASE_LNG + 0.002, BASE_LAT]
      ];
      const res = computePlanCoverage([west, east], [], 25);
      expect(res.tracedPct).toBe(100);
      expect(res.planKm).toBeCloseTo(0.111 + 0.111, 1);
      expect(res.uncoveredRuns.length).toBe(2);
      // First run ends exactly at the shared vertex; second run starts there.
      expect(res.uncoveredRuns[0][res.uncoveredRuns[0].length - 1]).toEqual(junction);
      expect(res.uncoveredRuns[1][0]).toEqual(junction);
    });

    it('keeps genuinely disconnected fragments separate across a large gap', () => {
      const a: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.001, BASE_LAT]
      ];
      const b: LonLat[] = [
        [BASE_LNG + 0.02, BASE_LAT],
        [BASE_LNG + 0.021, BASE_LAT]
      ];
      const res = computePlanCoverage([a, b], [], 25);
      expect(res.uncoveredRuns.length).toBe(2);
      // ~2 km of un-traced ground stays between the fragments.
      expect(res.uncoveredRuns[1][0][0]).toBeGreaterThan(
        res.uncoveredRuns[0][res.uncoveredRuns[0].length - 1][0] + 0.01
      );
    });

    it('keeps a captured stretch crossing a hypothetical cell edge fully covered', () => {
      // ~222 m plan run; the "cell boundary" is imagined mid-run at
      // BASE_LNG + 0.001. Capture spans the whole run with the same overlap a
      // single whole-network pass would use — a per-cell clip would split the
      // run at the boundary and risk tolerance-edge artifacts on either side.
      const run: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.002, BASE_LAT]
      ];
      const track = denseLine(BASE_LAT, BASE_LNG - 0.0003, BASE_LNG + 0.0023, 80);
      const res = computePlanCoverage([run], [track], 25);
      expect(res.uncoveredRuns.length).toBe(0);
      expect(res.tracedPct).toBeLessThanOrEqual(1);
    });

    it('slices the exact input plan vertices without densifying extra points', () => {
      // 5-vertex polyline, segments 0 and 3 surveyed, segments 1-2 unsurveyed
      const p0: LonLat = [BASE_LNG, BASE_LAT];
      const p1: LonLat = [BASE_LNG + 0.001, BASE_LAT];
      const p2: LonLat = [BASE_LNG + 0.002, BASE_LAT];
      const p3: LonLat = [BASE_LNG + 0.003, BASE_LAT];
      const p4: LonLat = [BASE_LNG + 0.004, BASE_LAT];
      const multiRun: LonLat[] = [p0, p1, p2, p3, p4];

      // Tracks covering p0->p1 and p3->p4
      const tracks = [
        denseLine(BASE_LAT, BASE_LNG, BASE_LNG + 0.001, 15),
        denseLine(BASE_LAT, BASE_LNG + 0.003, BASE_LNG + 0.004, 15)
      ];
      const res = computePlanCoverage([multiRun], tracks, 25);
      // A single gap over the two middle segments. The 25 m capture buffer
      // reaches a little past p1 and stops a little short of p3, so the two gap
      // boundaries are interpolated ONTO the plan line instead of snapping to
      // the vertices: no off-plan geometry, no densified runs, no junction
      // welds — the red still recolors the exact drawn green plan line.
      expect(res.uncoveredRuns.length).toBe(1);
      const gap = res.uncoveredRuns[0];
      for (const pt of gap) {
        expect(pt[1]).toBeCloseTo(BASE_LAT, 9);
        expect(pt[0]).toBeGreaterThanOrEqual(p1[0]);
        expect(pt[0]).toBeLessThanOrEqual(p3[0]);
      }
      // Boundaries sit strictly inside the unsurveyed stretch, not on p1 / p3.
      expect(gap[0][0]).toBeGreaterThan(p1[0]);
      expect(gap[gap.length - 1][0]).toBeLessThan(p3[0]);
      // 1:1 — the buffer reaches exactly 25 m past p1 and stops 25 m short of
      // p3, and the bisected boundaries must land on those edges.
      expect(mEast(gap[0][0])).toBeGreaterThan(mEast(p1[0]) + 24.4);
      expect(mEast(gap[0][0])).toBeLessThan(mEast(p1[0]) + 25.6);
      expect(mEast(gap[gap.length - 1][0])).toBeLessThan(mEast(p3[0]) - 24.4);
      expect(mEast(gap[gap.length - 1][0])).toBeGreaterThan(mEast(p3[0]) - 25.6);
    });

    it('does not bleed coverage into perpendicular unsurveyed side streets at junctions', () => {
      // Side road running North-South, starting at junction with main road
      const sideRoad: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG, BASE_LAT + 0.001]
      ];
      // Vehicle surveyed ONLY the main road (running East-West through junction)
      const tracks = [denseLine(BASE_LAT, BASE_LNG - 0.001, BASE_LNG + 0.001, 20)];

      const res = computePlanCoverage([sideRoad], tracks, 12);
      // The side road should be 100% uncovered (traced)
      expect(res.tracedPct).toBe(100);
      expect(res.uncoveredRuns.length).toBe(1);
      // The uncovered gap line must start precisely at the junction [BASE_LNG, BASE_LAT]
      expect(res.uncoveredRuns[0][0]).toEqual([BASE_LNG, BASE_LAT]);
    });

    it('starts the gap at the tolerance edge where a diagonal pass covers the mouth', () => {
      // Side road running East from the junction, surveyed only by a 45-degree
      // cross-street pass. That pass genuinely runs within tolerance of the road
      // mouth, so 1:1 coverage keeps that stretch green and the red begins where
      // the pass leaves the tolerance band. Perpendicular passes are rejected by
      // the directional alignment test instead (see the T-junction case).
      const junction: LonLat = [BASE_LNG, BASE_LAT];
      const m8Deg = 8 / 111320;
      const m50Deg = 50 / 111320;
      const sideRoadWithMouth: LonLat[] = [
        junction,
        [BASE_LNG + m8Deg, BASE_LAT],
        [BASE_LNG + m50Deg, BASE_LAT]
      ];
      // Vehicle surveyed cross street at a 45-degree angle passing through junction
      const tracks: LonLat[][] = [
        [
          [BASE_LNG - 0.0005, BASE_LAT - 0.0005],
          junction,
          [BASE_LNG + 0.0005, BASE_LAT + 0.0005]
        ]
      ];

      const res = computePlanCoverage([sideRoadWithMouth], tracks, 15);
      expect(res.uncoveredRuns.length).toBe(1);
      const gap = res.uncoveredRuns[0];
      // Green mouth, then red for the rest of the unsurveyed side road.
      expect(mEast(gap[0][0])).toBeGreaterThan(15);
      expect(gap[gap.length - 1]).toEqual([BASE_LNG + m50Deg, BASE_LAT]);
    });

    it('connects the gap cleanly to the junction vertex at a T-junction', () => {
      // T-junction: the unsurveyed road terminates at the junction. The red line must
      // connect all the way to the junction vertex without leaving a 15m void.
      const junction: LonLat = [BASE_LNG, BASE_LAT];
      const m12Deg = 12 / 111320;
      const m60Deg = 60 / 111320;
      // Road coming from West and terminating at junction (T-junction)
      const terminatingRoad: LonLat[] = [
        [BASE_LNG - m60Deg, BASE_LAT],
        [BASE_LNG - m12Deg, BASE_LAT],
        junction
      ];
      // Surveyed track running North-South on the cross street. It must be a
      // real two-dimensional track: a degenerate run of identical points has no
      // direction, which makes `isCaptureCovering` accept it regardless of
      // alignment and marks the junction mouth covered.
      const tracks: LonLat[][] = [denseLineNS(BASE_LNG, BASE_LAT - 0.0005, BASE_LAT + 0.0005, 20)];

      const res = computePlanCoverage([terminatingRoad], tracks, 15);
      expect(res.uncoveredRuns.length).toBe(1);
      const gap = res.uncoveredRuns[0];
      // The perpendicular cross-street pass does not cover the terminating road,
      // so the gap reaches the junction vertex cleanly.
      expect(gap[gap.length - 1]).toEqual(junction);
    });

    it('keeps a short surveyed lead-in green instead of bleeding red into the track', () => {
      // 200 m road where the panotrack only clips the first metre, so coverage
      // is the 12 m tolerance pocket around it. That lead-in is genuinely
      // covered, so 1:1 coverage keeps it green and the red starts at the
      // tolerance edge. A 25 m "junction bleed" heuristic used to repaint it
      // red, drawing an uncovered line inside the driven stretch.
      const planRun: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [lngEast(100), BASE_LAT],
        [lngEast(200), BASE_LAT]
      ];
      const tracks: LonLat[][] = [[[BASE_LNG, BASE_LAT], [lngEast(1), BASE_LAT]]];

      const res = computePlanCoverage([planRun], tracks, 12);
      expect(res.uncoveredRuns).toHaveLength(1);
      const gapStart = mEast(res.uncoveredRuns[0][0][0]);
      expect(gapStart).toBeGreaterThan(11);
      expect(gapStart).toBeLessThan(15);
      expect(mEast(res.uncoveredRuns[0][res.uncoveredRuns[0].length - 1][0])).toBeCloseTo(200, 1);
    });

    it('keeps a short surveyed run-out green instead of bleeding red into the track', () => {
      // Mirror image: the panotrack only clips the final metre of the road.
      const planRun: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [lngEast(100), BASE_LAT],
        [lngEast(200), BASE_LAT]
      ];
      const tracks: LonLat[][] = [[[lngEast(199), BASE_LAT], [lngEast(200), BASE_LAT]]];

      const res = computePlanCoverage([planRun], tracks, 12);
      expect(res.uncoveredRuns).toHaveLength(1);
      const gap = res.uncoveredRuns[0];
      const gapEnd = mEast(gap[gap.length - 1][0]);
      expect(gapEnd).toBeGreaterThan(185);
      expect(gapEnd).toBeLessThan(189);
      expect(mEast(gap[0][0])).toBeCloseTo(0, 1);
    });

    it('does not speckle red dashes when a single capture sample drops out mid-run', () => {
      // ~111 m run, sampled every ~11 m at tolerance 12. The capture has a ~35 m
      // hole that leaves exactly ONE probe beyond tolerance, so a single GPS
      // dropout used to punch a red dash through the middle of driven road.
      const dropoutRun: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.001, BASE_LAT]
      ];
      const tracks = [
        denseLine(BASE_LAT, lngEast(0), lngEast(50), 11),
        denseLine(BASE_LAT, lngEast(85), lngEast(111), 6)
      ];
      const res = computePlanCoverage([dropoutRun], tracks, 12);
      expect(res.uncoveredRuns.length).toBe(0);
      expect(res.tracedPct).toBeLessThanOrEqual(1);
    });

    it('places the gap boundary where the capture coverage ends, with zero dead-zone gap', () => {
      // Vertices every 8 m. The capture stops at 30 m; with 12 m tolerance buffer,
      // coverage reaches 42 m, so the red line begins cleanly at ~42 m with zero dead zone.
      const shortSegRun: LonLat[] = [0, 8, 16, 24, 32, 40, 48, 56].map(
        (m): LonLat => [lngEast(m), BASE_LAT]
      );
      const tracks = [denseLine(BASE_LAT, lngEast(0), lngEast(30), 7)];
      const res = computePlanCoverage([shortSegRun], tracks, 12);
      expect(res.uncoveredRuns.length).toBe(1);
      const gap = res.uncoveredRuns[0];
      // Coverage buffer reaches 30 m + 12 m = 42 m; gap begins there and runs to the end
      expect(mEast(gap[0][0])).toBeCloseTo(42.25, 0);
      expect(mEast(gap[gap.length - 1][0])).toBeCloseTo(56, 1);
    });

    it('keeps a genuine gap between two captured stretches', () => {
      // ~111 m run with a real ~40 m unsurveyed stretch between two captured
      // halves. Capture A covers up to 40 + 12 = 52 m; Capture B covers from 80 - 12 = 68 m.
      // The gap is preserved with clean zero-gap handoff to both capture edges.
      const gappedRun: LonLat[] = [
        [BASE_LNG, BASE_LAT],
        [BASE_LNG + 0.001, BASE_LAT]
      ];
      const tracks = [
        denseLine(BASE_LAT, lngEast(0), lngEast(40), 9),
        denseLine(BASE_LAT, lngEast(80), lngEast(111), 7)
      ];
      const res = computePlanCoverage([gappedRun], tracks, 12);
      expect(res.uncoveredRuns.length).toBe(1);
      const gap = res.uncoveredRuns[0];
      // Zero-gap handoff to capture A buffer (~52 m) and capture B buffer (~68 m)
      expect(mEast(gap[0][0])).toBeCloseTo(52, 0);
      expect(mEast(gap[gap.length - 1][0])).toBeCloseTo(68, 0);
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

    it('marks complete when covered share hits the threshold and incomplete when gaps remain', () => {
      // 95.5% covered (0.106 km covered, 0.005 km uncovered gaps out of 0.111 km)
      const highCoverage: PlanCoverage = {
        planKm: 0.111,
        coveredKm: 0.106,
        coveredPct: 95.5,
        tracedKm: 0.005,
        tracedPct: 4.5,
        uncoveredRuns: [] as LonLat[][]
      };
      expect(finalizeSubgridResult(plan, highCoverage, 95).status).toBe('complete');
      expect(finalizeSubgridResult(plan, highCoverage, 96).status).toBe('incomplete');
      expect(finalizeSubgridResult(plan, highCoverage, 96).coveredPct).toBe(95.5);

      // Low coverage: mostly uncovered red lines (0.106 km gaps out of 0.111 km)
      const lowCoverage: PlanCoverage = {
        planKm: 0.111,
        coveredKm: 0.005,
        coveredPct: 4.5,
        tracedKm: 0.106,
        tracedPct: 95.5,
        uncoveredRuns: [] as LonLat[][]
      };
      expect(finalizeSubgridResult(plan, lowCoverage, 95).status).toBe('incomplete');
    });

    it('treats an entirely panotrack-saturated plan as complete (nothing uncovered)', () => {
      const coverage: PlanCoverage = {
        planKm: 0.111,
        coveredKm: 0.111,
        coveredPct: 100,
        tracedKm: 0,
        tracedPct: 0,
        uncoveredRuns: [] as LonLat[][]
      };
      expect(finalizeSubgridResult(plan, coverage, 95).status).toBe('complete');
    });

    it('marks subgrids without plan geometry as no-plan', () => {
      const empty = { ...plan, planRuns: [] as LonLat[][] };
      const coverage: PlanCoverage = {
        planKm: 0,
        coveredKm: 0,
        coveredPct: 0,
        tracedKm: 0,
        tracedPct: 0,
        uncoveredRuns: [] as LonLat[][]
      };
      const res = finalizeSubgridResult(empty, coverage, 95);
      expect(res.status).toBe('no-plan');
      expect(res.coveredPct).toBeNull();
      expect(res.tracedKm).toBe(0);
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
