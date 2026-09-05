import { describe, it, expect } from 'vitest';
import {
  pointInBbox,
  clipLineRunsToBbox,
  getSubgridBbox,
  computeSubgridMetrics,
  isPointInPolygonRing,
  isPointInPolygonGeometry,
  resolveSpatialSubgrid,
  evaluatePointSpatialRelation
} from '../subgridComparison';

describe('subgridComparison utility', () => {
  it('correctly detects points inside a bounding box', () => {
    const bbox: [number, number, number, number] = [100.0, 3.0, 101.0, 4.0];
    expect(pointInBbox([100.5, 3.5], bbox)).toBe(true);
    expect(pointInBbox([99.9, 3.5], bbox)).toBe(false);
    expect(pointInBbox([100.5, 4.1], bbox)).toBe(false);
  });

  it('clips line runs to a bounding box', () => {
    const bbox: [number, number, number, number] = [10.0, 10.0, 20.0, 20.0];
    const runs: Array<Array<[number, number]>> = [
      // Line passing through bbox
      [[5.0, 15.0], [12.0, 15.0], [18.0, 15.0], [25.0, 15.0]],
      // Line completely outside
      [[1.0, 1.0], [2.0, 2.0]]
    ];

    const clipped = clipLineRunsToBbox(runs, bbox);
    expect(clipped.length).toBe(1);
    expect(clipped[0]).toEqual([[12.0, 15.0], [18.0, 15.0]]);
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


