import { describe, it, expect } from 'vitest';
import {
  pointInBbox,
  clipLineRunsToBbox,
  connectRunsByEndpoints,
  getSubgridBbox,
  computeSubgridMetrics,
  isPointInPolygonRing,
  isPointInPolygonGeometry,
  resolveSpatialSubgrid,
  evaluatePointSpatialRelation,
  bboxOfFeatureCollection,
  bboxContainsBbox,
  geoJsonExceedsRegion,
  clipGeoJsonToRegions
} from '../subgridComparison';

describe('subgridComparison utility', () => {
  it('correctly detects points inside a bounding box', () => {
    const bbox: [number, number, number, number] = [100.0, 3.0, 101.0, 4.0];
    expect(pointInBbox([100.5, 3.5], bbox)).toBe(true);
    expect(pointInBbox([99.9, 3.5], bbox)).toBe(false);
    expect(pointInBbox([100.5, 4.1], bbox)).toBe(false);
  });

  it('clips line runs to a bounding box and interpolates the edge crossing', () => {
    const bbox: [number, number, number, number] = [10.0, 10.0, 20.0, 20.0];
    const runs: Array<Array<[number, number]>> = [
      // Line passing through bbox
      [[5.0, 15.0], [12.0, 15.0], [18.0, 15.0], [25.0, 15.0]],
      // Line completely outside
      [[1.0, 1.0], [2.0, 2.0]]
    ];

    const clipped = clipLineRunsToBbox(runs, bbox);
    expect(clipped.length).toBe(1);
    expect(clipped[0]).toEqual([[10.0, 15.0], [12.0, 15.0], [18.0, 15.0], [20.0, 15.0]]);
  });

  it('stitches plan runs whose endpoints are within the snap tolerance', () => {
    const runs: Array<Array<[number, number]>> = [
      [[100.0, 3.0], [100.01, 3.0]],
      [[100.0101, 3.0], [100.02, 3.0]]
    ];
    const stitched = connectRunsByEndpoints(runs, 15);
    expect(stitched[0][1]).toEqual(stitched[1][0]);
    expect(stitched[0][1][0]).toBeCloseTo(100.01005, 6);
    expect(stitched[0][1][1]).toBeCloseTo(3.0, 6);
  });

  it('does not stitch endpoints that are farther apart than the tolerance', () => {
    const runs: Array<Array<[number, number]>> = [
      [[100.0, 3.0], [100.01, 3.0]],
      [[100.011, 3.0], [100.02, 3.0]]
    ];
    const stitched = connectRunsByEndpoints(runs, 5, 5);
    expect(stitched[0][1]).toEqual([100.01, 3.0]);
    expect(stitched[1][0]).toEqual([100.011, 3.0]);
  });

  it('splices a T-junction stub onto the road it nearly meets', () => {
    const main: Array<[number, number]> = [[100.0, 3.0], [100.02, 3.0]];
    const stub: Array<[number, number]> = [[100.01, 3.0001], [100.01, 3.001]];
    const stitched = connectRunsByEndpoints([main, stub], 15, 25);

    expect(stitched[0].length).toBe(3);
    expect(stitched[0][1][0]).toBeCloseTo(100.01, 6);
    expect(stitched[0][1][1]).toBeCloseTo(3.0, 6);
    expect(stitched[1][0]).toEqual(stitched[0][1]);
  });

  it('keeps a short parallel road from collapsing when both ends snap to one road', () => {
    const main: Array<[number, number]> = [[100.0, 3.0], [100.02, 3.0]];
    const side: Array<[number, number]> = [[100.005, 3.0001], [100.0055, 3.0001]];
    const stitched = connectRunsByEndpoints([main, side], 15, 25);

    expect(stitched[1][0]).not.toEqual(stitched[1][1]);
    expect(Math.abs(stitched[1][0][0] - stitched[1][1][0])).toBeCloseTo(0.0005, 5);
    expect(stitched[0].length).toBe(4);
  });

  it('snaps T-junctions within expanded 40m tolerance (e.g. 33m gap)', () => {
    const main: Array<[number, number]> = [[100.0, 3.0], [100.02, 3.0]];
    // 0.0003 deg lat is ~33.2 meters
    const stub: Array<[number, number]> = [[100.01, 3.0003], [100.01, 3.002]];
    // With 40m tolerance, stub snaps onto main:
    const stitched = connectRunsByEndpoints([main, stub], 25, 40);
    expect(stitched[0].length).toBe(3);
    expect(stitched[0][1][0]).toBeCloseTo(100.01, 5);
    expect(stitched[0][1][1]).toBeCloseTo(3.0, 5);
    expect(stitched[1][0]).toEqual(stitched[0][1]);
  });

  it('planarizes and splits runs at T-junctions when planarize is true', () => {
    const main: Array<[number, number]> = [[100.0, 3.0], [100.02, 3.0]];
    const stub: Array<[number, number]> = [[100.01, 3.0002], [100.01, 3.002]];
    const stitched = connectRunsByEndpoints([main, stub], 25, 40, true);

    // main is split into 2 runs, stub is 1 run -> 3 runs total
    expect(stitched.length).toBe(3);
    const junction = stitched[0][1];
    expect(junction[0]).toBeCloseTo(100.01, 5);
    expect(junction[1]).toBeCloseTo(3.0, 5);
    // All 3 edges share the exact junction coordinate:
    expect(stitched[1][0]).toEqual(junction);
    expect(stitched[2][0]).toEqual(junction);
  });

  it('inserts multiple side roads on the same segment in strictly ordered sequence', () => {
    const main: Array<[number, number]> = [[100.0, 3.0], [100.04, 3.0]];
    const side1: Array<[number, number]> = [[100.03, 3.0001], [100.03, 3.002]];
    const side2: Array<[number, number]> = [[100.01, 3.0001], [100.01, 3.002]];
    const stitched = connectRunsByEndpoints([main, side1, side2], 25, 40, false);

    // main should have 4 vertices in ascending longitude: 100.0 -> 100.01 -> 100.03 -> 100.04
    expect(stitched[0].length).toBe(4);
    expect(stitched[0][0][0]).toBeCloseTo(100.00, 5);
    expect(stitched[0][1][0]).toBeCloseTo(100.01, 5);
    expect(stitched[0][2][0]).toBeCloseTo(100.03, 5);
    expect(stitched[0][3][0]).toBeCloseTo(100.04, 5);
  });

  it('does not collapse parallel cul-de-sacs or lanes into each other', () => {
    // Two parallel streets 16m apart heading West to East
    const lane1: Array<[number, number]> = [[100.0, 3.0], [100.02, 3.0]];
    const lane2: Array<[number, number]> = [[100.0, 3.00015], [100.02, 3.00015]];
    const stitched = connectRunsByEndpoints([lane1, lane2], 25, 25);

    // Endpoints must NOT snap together (must maintain lateral separation)
    expect(stitched[0][0][1]).not.toEqual(stitched[1][0][1]);
    expect(stitched[0][1][1]).not.toEqual(stitched[1][1][1]);
    expect(Math.abs(stitched[0][0][1] - stitched[1][0][1])).toBeGreaterThan(0.0001);
  });

  it('extends T-junction stubs along their heading vector via ray intersection', () => {
    // Vertical road along lng 100.01 from lat 3.00 to 3.02
    const main: Array<[number, number]> = [[100.01, 3.00], [100.01, 3.02]];
    // Horizontal stub pointing directly East towards main, stopping ~33m short (lng 100.0097)
    const stub: Array<[number, number]> = [[100.0, 3.01], [100.0097, 3.01]];
    const stitched = connectRunsByEndpoints([main, stub], 20, 45, true);

    // main is split into 2 runs, stub is 1 run -> 3 runs total
    expect(stitched.length).toBe(3);
    // Stub endpoint must extend East to reach lng 100.01 at lat 3.01
    const stubEnd = stitched[2][stitched[2].length - 1];
    expect(stubEnd[0]).toBeCloseTo(100.01, 5);
    expect(stubEnd[1]).toBeCloseTo(3.01, 5);
  });

  it('bridges a long collinear gap by merging the two facing runs', () => {
    // One road whose middle chunk (~67 m) is missing from OSM.
    const west: Array<[number, number]> = [[100.0, 3.0], [100.01, 3.0]];
    const east: Array<[number, number]> = [[100.0106, 3.0], [100.02, 3.0]];
    const stitched = connectRunsByEndpoints([west, east]);

    expect(stitched.length).toBe(1);
    expect(stitched[0].length).toBe(4);
    expect(stitched[0][0]).toEqual([100.0, 3.0]);
    expect(stitched[0][3]).toEqual([100.02, 3.0]);
  });

  it('does not bridge dead ends that meet at a right angle', () => {
    const west: Array<[number, number]> = [[100.0, 3.0], [100.01, 3.0]];
    const north: Array<[number, number]> = [[100.0106, 3.0], [100.0106, 3.01]];
    const stitched = connectRunsByEndpoints([west, north]);

    expect(stitched.length).toBe(2);
    expect(stitched[0].length).toBe(2);
    expect(stitched[1].length).toBe(2);
  });

  it('does not bridge collinear dead ends farther apart than the bridge cap', () => {
    const west: Array<[number, number]> = [[100.0, 3.0], [100.01, 3.0]];
    const far: Array<[number, number]> = [[100.012, 3.0], [100.02, 3.0]];
    const stitched = connectRunsByEndpoints([west, far]);

    expect(stitched.length).toBe(2);
  });

  it('snaps a bent-end stub that finishes within tolerance of the through road', () => {
    const main: Array<[number, number]> = [[100.0, 3.0], [100.02, 3.0]];
    // Last vertex bends east, so the heading no longer points at the main road,
    // but the dead end is ~30 m from it.
    const stub: Array<[number, number]> = [
      [100.01, 3.004],
      [100.01, 3.002],
      [100.01, 3.00008],
      [100.0103, 3.00027]
    ];
    const stitched = connectRunsByEndpoints([main, stub]);

    expect(stitched.length).toBe(2);
    expect(stitched[0].length).toBe(3);
    expect(stitched[1][3][0]).toBeCloseTo(100.0103, 6);
    expect(stitched[1][3][1]).toBeCloseTo(3.0, 6);
  });

  it('does not weld parallel carriageways via the close-range snap', () => {
    const laneA: Array<[number, number]> = [[100.0, 3.0], [100.01, 3.0], [100.02, 3.0]];
    const laneB: Array<[number, number]> = [
      [100.0, 3.00012],
      [100.01, 3.00012],
      [100.02, 3.00012]
    ];
    const stitched = connectRunsByEndpoints([laneA, laneB]);

    expect(stitched.length).toBe(2);
    expect(stitched[0][2]).toEqual([100.02, 3.0]);
    expect(stitched[1][2]).toEqual([100.02, 3.00012]);
  });

  it('generates a 5x5 km bounding box centered at points', () => {
    const points = [
      { lng: 101.5, lat: 3.1 },
      { lng: 101.5, lat: 3.1 }
    ];
    const bbox = getSubgridBbox('N93E70', points);
    expect(bbox[0]).toBeCloseTo(101.5 - 0.0225, 4);
    expect(bbox[1]).toBeCloseTo(3.1 - 0.0225, 4);
    expect(bbox[2]).toBeCloseTo(101.5 + 0.0225, 4);
    expect(bbox[3]).toBeCloseTo(3.1 + 0.0225, 4);
  });

  it('computes point in polygon geometry correctly', () => {
    const ring: [number, number][] = [[100, 2], [101, 2], [101, 3], [100, 3], [100, 2]];
    const squarePoly = {
      type: 'Polygon',
      coordinates: [ring]
    };
    expect(isPointInPolygonRing([100.5, 2.5], ring)).toBe(true);
    expect(isPointInPolygonGeometry([100.5, 2.5], squarePoly)).toBe(true);
    expect(isPointInPolygonGeometry([99.5, 2.5], squarePoly)).toBe(false);
  });

  it('resolves spatial subgrid against catalog grid polygon layer', () => {
    const catalogLayers = [
      {
        id: 'cat-grid',
        name: 'Grid_5km_tangkak_segamat',
        geojson: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { NAME: 'N93E70' },
              geometry: {
                type: 'Polygon',
                coordinates: [[[100, 2], [101, 2], [101, 3], [100, 3], [100, 2]]]
              }
            },
            {
              type: 'Feature',
              properties: { NAME: 'N93E71' },
              geometry: {
                type: 'Polygon',
                coordinates: [[[101, 2], [102, 2], [102, 3], [101, 3], [101, 2]]]
              }
            }
          ]
        }
      }
    ];

    expect(resolveSpatialSubgrid([100.5, 2.5], catalogLayers)).toBe('N93E70');
    expect(resolveSpatialSubgrid([101.5, 2.5], catalogLayers)).toBe('N93E71');
    expect(resolveSpatialSubgrid([105.0, 5.0], catalogLayers)).toBeNull();
  });

  it('classifies continuous cross-boundary survey as Intersect without defect reason', () => {
    const point = { subgrid: 'N93E70', filename: 'N93E70-0066.jpg', lng: 101.5, lat: 2.5 };
    const catalogLayers = [
      {
        geojson: {
          features: [
            {
              properties: { NAME: 'N93E71' },
              geometry: {
                type: 'Polygon',
                coordinates: [[[101, 2], [102, 2], [102, 3], [101, 3], [101, 2]]]
              }
            }
          ]
        }
      }
    ];

    // Origin batch has 50 points in N93E70, and this point crossed into N93E71
    const rel = evaluatePointSpatialRelation(point, 50, 1, catalogLayers);
    expect(rel.type).toBe('INTERSECT');
    expect(rel.originSubgrid).toBe('N93E70');
    expect(rel.spatialSubgrid).toBe('N93E71');
    expect(rel.text).toBe('Intersect with N93E70 — Track starts in N93E70, ends in N93E71');
    expect(rel.reason).toBeUndefined();
  });

  it('classifies complete misassignment with exact reason: data missmatch with subgrid assign', () => {
    const point = { subgrid: 'N94E70', filename: 'N94E70-0001.jpg', lng: 100.5, lat: 2.5 };
    const catalogLayers = [
      {
        geojson: {
          features: [
            {
              properties: { NAME: 'N93E70' },
              geometry: {
                type: 'Polygon',
                coordinates: [[[100, 2], [101, 2], [101, 3], [100, 3], [100, 2]]]
              }
            }
          ]
        }
      }
    ];

    // 0 points in N94E70, all points in N93E70
    const rel = evaluatePointSpatialRelation(point, 0, 50, catalogLayers);
    expect(rel.type).toBe('MISMATCH');
    expect(rel.reason).toBe('data missmatch with subgrid assign');
    expect(rel.originSubgrid).toBe('N94E70');
    expect(rel.spatialSubgrid).toBe('N93E70');
  });

  it('computes subgrid metrics correctly with tracks from dailyData and length from batchLogs', () => {
    const capturedPoints = [
      { subgrid: 'N93E70', lng: 101.5, lat: 3.1 },
      { subgrid: 'N93E70', lng: 101.505, lat: 3.105 }
    ];

    const dailyData = [
      {
        subgrid: 'N93E70',
        panoramas: [
          { longitude: 101.5, latitude: 3.1 },
          { longitude: 101.505, latitude: 3.105 }
        ]
      }
    ];

    const batchLogs = [
      {
        subgrid: 'N93E70',
        kmProcessed: 3.37
      }
    ];

    const planRuns: Array<Array<[number, number]>> = [
      [[101.5, 3.1], [101.51, 3.11]]
    ];

    const metrics = computeSubgridMetrics(capturedPoints, dailyData, batchLogs, planRuns, 1);
    expect(metrics.length).toBe(1);
    expect(metrics[0].subgrid).toBe('N93E70');
    expect(metrics[0].pointsCount).toBe(2);
    expect(metrics[0].tracksCount).toBe(1);
    expect(metrics[0].masterlistKm).toBe(3.37);
    expect(metrics[0].planKm).toBeGreaterThan(0);
    expect(metrics[0].completionRatio).not.toBeNull();
  });

  it('calculates plan length for empty subgrid (e.g. N93E71) using catalog layer polygon bbox', () => {
    const catalogLayers = [
      {
        id: 'grid-5km',
        geojson: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { NAME: 'N93E71' },
              geometry: {
                type: 'Polygon',
                coordinates: [[[102.0, 2.0], [102.045, 2.0], [102.045, 2.045], [102.0, 2.045], [102.0, 2.0]]]
              }
            }
          ]
        }
      }
    ];

    // Subgrid has 0 captured points, but road plan passes through its catalog polygon
    const planRuns: Array<Array<[number, number]>> = [
      [[102.01, 2.01], [102.03, 2.03]]
    ];

    const metrics = computeSubgridMetrics([], [], [], planRuns, 0, catalogLayers);
    const sg71 = metrics.find((m) => m.subgrid === 'N93E71');
    expect(sg71).toBeDefined();
    expect(sg71!.pointsCount).toBe(0);
    expect(sg71!.planKm).toBeGreaterThan(0);
  });
});

describe('region-aware import extent helpers', () => {
  const districtSquare = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { NAME: 'Segamat' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[102.0, 2.0], [103.0, 2.0], [103.0, 3.0], [102.0, 3.0], [102.0, 2.0]]]
        }
      }
    ]
  };
  const districtBbox: [number, number, number, number] = [102.0, 2.0, 103.0, 3.0];

  it('computes the union bbox of mixed geometry types', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { geometry: { type: 'Point', coordinates: [100.5, 1.5] } },
        { geometry: { type: 'LineString', coordinates: [[102.0, 2.0], [103.5, 2.5]] } },
        { geometry: { type: 'Polygon', coordinates: [[[101.0, 0.5], [101.0, 0.6], [101.1, 0.6], [101.0, 0.5]]] } }
      ]
    };
    expect(bboxOfFeatureCollection(fc)).toEqual([100.5, 0.5, 103.5, 2.5]);
    expect(bboxOfFeatureCollection(null)).toBeNull();
  });

  it('recognises a contained bbox but not an overflowing one', () => {
    expect(bboxContainsBbox(districtBbox, [102.2, 2.2, 102.8, 2.8])).toBe(true);
    expect(bboxContainsBbox(districtBbox, [102.0, 2.0, 103.5, 3.0])).toBe(false);
    expect(bboxContainsBbox(districtBbox, [101.5, 2.0, 103.0, 3.0])).toBe(false);
    expect(bboxContainsBbox(districtBbox, [102.0, 2.0, 103.0, 3.00002], 1e-3)).toBe(true);
  });

  it('flags data that extends past the region but not data fully inside it', () => {
    const inside = { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [102.5, 2.5] } }] };
    const outside = { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [103.2, 2.5] } }] };
    expect(geoJsonExceedsRegion(inside, districtSquare)).toBe(false);
    expect(geoJsonExceedsRegion(outside, districtSquare)).toBe(true);
    expect(geoJsonExceedsRegion(outside, null)).toBe(false);
    expect(geoJsonExceedsRegion(outside, { type: 'FeatureCollection', features: [] })).toBe(false);
  });

  it('drops nothing and keeps the same features when there are no regions', () => {
    const fc = { type: 'FeatureCollection', features: [{ geometry: { type: 'Point', coordinates: [105.0, 5.0] } }] };
    expect(clipGeoJsonToRegions(fc, { type: 'FeatureCollection', features: [] })).toBe(fc);
  });

  it('clips a line crossing the region, interpolating the exact edge crossings', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'R1' },
          geometry: { type: 'LineString', coordinates: [[100.8, 2.5], [102.2, 2.5], [103.2, 2.5]] }
        }
      ]
    };
    const clipped = clipGeoJsonToRegions(fc, districtSquare);
    expect(clipped.features).toHaveLength(1);
    expect(clipped.features[0].properties).toEqual({ name: 'R1' });
    expect(clipped.features[0].geometry.coordinates[0]).toEqual([102.0, 2.5]);
    expect(clipped.features[0].geometry.coordinates.at(-1)).toEqual([103.0, 2.5]);
    expect(clipped.features[0].geometry.coordinates.length).toBe(3);
  });

  it('keeps a road that leaves and re-enters the region as multiple segments', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [[101.5, 2.5], [102.2, 2.5], [102.4, 1.5], [102.8, 2.5], [103.5, 2.5]]
          }
        }
      ]
    };
    const clipped = clipGeoJsonToRegions(fc, districtSquare);
    expect(clipped.features.length).toBeGreaterThan(1);
    clipped.features.forEach((f: any) => {
      f.geometry.coordinates.forEach((c: any) => expect(pointInBbox(c, districtBbox)).toBe(true));
    });
  });

  it('keeps points inside the polygon but drops points inside the bbox only', () => {
    const angled = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            // Triangle: covers lower-left of the bbox, so the top-left corner
            // (102.0, 3.0) is inside the bbox but outside the polygon.
            type: 'Polygon',
            coordinates: [[[102.0, 2.0], [103.0, 2.0], [102.0, 3.0], [102.0, 2.0]]]
          }
        }
      ]
    };
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'keep' }, geometry: { type: 'Point', coordinates: [102.4, 2.4] } },
        { type: 'Feature', properties: { kind: 'drop' }, geometry: { type: 'Point', coordinates: [102.05, 2.98] } }
      ]
    };
    const clipped = clipGeoJsonToRegions(fc, angled);
    expect(clipped.features).toHaveLength(1);
    expect(clipped.features[0].properties.kind).toBe('keep');
  });

  it('clips lines to the district polygon shape, not its bounding box', () => {
    const angled = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          // Triangle covering the lower-left of the bbox: the segment
          // (102.6, 2.9) -> (102.6, 2.1) sits entirely inside the bbox but its
          // top part (above the hypotenuse) pokes outside the district shape.
          geometry: {
            type: 'Polygon',
            coordinates: [[[102.0, 2.0], [103.0, 2.0], [102.0, 3.0], [102.0, 2.0]]]
          }
        }
      ]
    };
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[102.6, 2.9], [102.6, 2.1]] }
        }
      ]
    };
    const clipped = clipGeoJsonToRegions(fc, angled);
    expect(clipped.features).toHaveLength(1);
    const coords = clipped.features[0].geometry.coordinates;
    expect(coords).toHaveLength(2);
    // Entry point is interpolated at the hypotenuse crossing (y = 2.4), so the
    // bbox-only corner portion (y > 2.4) must be removed.
    expect(coords[0][0]).toBeCloseTo(102.6, 9);
    expect(coords[0][1]).toBeCloseTo(2.4, 9);
    expect(coords[0][1]).toBeLessThan(2.9);
    expect(coords[1]).toEqual([102.6, 2.1]);
  });

  it('clips every line of a MultiLineString individually', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [[101.0, 2.5], [102.5, 2.5]],
              [[102.5, 3.5], [102.5, 2.5]]
            ]
          }
        }
      ]
    };
    const clipped = clipGeoJsonToRegions(fc, districtSquare);
    expect(clipped.features.length).toBeGreaterThanOrEqual(2);
    clipped.features.forEach((f: any) => {
      expect(f.geometry.type).toBe('LineString');
      f.geometry.coordinates.forEach((c: any) => expect(pointInBbox(c, districtBbox)).toBe(true));
    });
  });

  it('keeps overlapping polygons and drops disjoint ones', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[102.5, 2.5], [102.6, 2.5], [102.6, 2.6], [102.5, 2.5]]] } },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[104.0, 4.0], [104.1, 4.0], [104.1, 4.1], [104.0, 4.0]]] } }
      ]
    };
    const clipped = clipGeoJsonToRegions(fc, districtSquare);
    expect(clipped.features).toHaveLength(1);
  });

  it('does not mutate the input feature collection', () => {
    const line = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[101.0, 2.5], [102.2, 2.5], [103.2, 2.5]] } }
      ]
    };
    clipGeoJsonToRegions(line, districtSquare);
    expect(line.features[0].geometry.coordinates).toHaveLength(3);
  });
});


