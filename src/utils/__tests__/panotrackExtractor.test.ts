import { describe, it, expect } from 'vitest';
import { extractPanotrackPoints, filterPanotrackByDistricts, filterPanotrackByBBoxes, getPanotrackStatusColor } from '../panotrackExtractor';

describe('panotrackExtractor', () => {
  it('correctly maps status colors to published, staging, and defect', () => {
    expect(getPanotrackStatusColor({ isPublished: true })).toBe('#10b981');
    expect(getPanotrackStatusColor({ status: 'published' })).toBe('#10b981');
    expect(getPanotrackStatusColor({ status: 'yes' })).toBe('#10b981');
    expect(getPanotrackStatusColor({ status: 'staging' })).toBe('#f59e0b');
    expect(getPanotrackStatusColor({ status: 'defect' })).toBe('#ef4444');
    expect(getPanotrackStatusColor({ status: 'need to recheck' })).toBe('#ef4444');
    expect(getPanotrackStatusColor({ defectCount: 2 })).toBe('#ef4444');
  });

  it('treats available-on-project frames as staging', () => {
    // The system tracks only Published, Staging, and Defect.
    expect(getPanotrackStatusColor({ status: 'available' })).toBe('#f59e0b');
    expect(getPanotrackStatusColor({ isAvailable: true })).toBe('#f59e0b');
    // Published and defect still outrank
    expect(getPanotrackStatusColor({ status: 'available', isPublished: true })).toBe('#10b981');
    expect(getPanotrackStatusColor({ status: 'available', isDefect: true })).toBe('#ef4444');
  });

  it('extracts available frames as staging with isAvailable flag retained', () => {
    const dailyData = [
      {
        subgrid: 'N93E70',
        panoramas: [
          { id: 'p1', filename: 'N93E70-0001.jpg', longitude: 101.5, latitude: 3.1, status: 'available' },
          { id: 'p2', filename: 'N93E70-0002.jpg', longitude: 101.6, latitude: 3.2, isAvailable: true },
          { id: 'p3', filename: 'N93E70-0003.jpg', longitude: 101.7, latitude: 3.3, isAvailable: false }
        ]
      }
    ];

    const res = extractPanotrackPoints(dailyData, []);
    const byId = Object.fromEntries(res.points.map((p) => [p.id, p]));
    expect(byId['p1'].status).toBe('staging');
    expect(byId['p1'].color).toBe('#f59e0b');
    expect(byId['p1'].isAvailable).toBe(true);
    expect(byId['p2'].status).toBe('staging');
    expect(byId['p2'].color).toBe('#f59e0b');
    expect(byId['p2'].isAvailable).toBe(true);
    expect(byId['p3'].status).toBe('staging');
    expect(byId['p3'].isAvailable).toBeFalsy();
  });

  it('extracts points and tracks from dailyData panoramas with status colors', () => {
    const dailyData = [
      {
        subgrid: 'N93E70',
        publishToWebGIS: 'yes',
        panoramas: [
          { id: 'p1', filename: 'N93E70-0001.jpg', longitude: 101.5, latitude: 3.1, status: 'yes' },
          { id: 'p2', filename: 'N93E70-0002.jpg', longitude: 101.6, latitude: 3.2, status: 'defect' }
        ]
      }
    ];

    const res = extractPanotrackPoints(dailyData, []);
    expect(res.points.length).toBe(2);
    expect(res.points[0].lng).toBe(101.5);
    expect(res.points[0].lat).toBe(3.1);
    expect(res.points[0].color).toBe('#10b981'); // published
    expect(res.points[1].color).toBe('#ef4444'); // defect
    expect(res.tracks.length).toBe(1);
    expect(res.tracks[0]).toEqual([[101.5, 3.1], [101.6, 3.2]]);
  });

  it('extracts points from points array and deduplicates identical records', () => {
    const dailyData = [
      {
        subgrid: 'N94E70',
        points: [
          { lon: 102.1, lat: 2.2 },
          { lon: 102.2, lat: 2.3 }
        ]
      },
      {
        subgrid: 'N94E70',
        points: [
          { lon: 102.1, lat: 2.2 } // duplicate
        ]
      }
    ];

    const res = extractPanotrackPoints(dailyData, []);
    expect(res.points.length).toBe(2);
  });

  it('filters points and tracks by district polygon', () => {
    const points = [
      { id: '1', subgrid: 'A', lng: 101.5, lat: 3.1 },
      { id: '2', subgrid: 'B', lng: 115.0, lat: 4.5 }
    ];
    const tracks: Array<Array<[number, number]>> = [[[101.5, 3.1], [101.6, 3.2]]];

    // District covering peninsular points around (101.5, 3.1)
    const mockDistrict: any = {
      id: 'mock-1',
      name: 'Central District',
      state: 'SEL',
      bbox: [101.0, 3.0, 102.0, 4.0],
      geojson: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [[101.0, 3.0], [102.0, 3.0], [102.0, 4.0], [101.0, 4.0], [101.0, 3.0]]
              ]
            }
          }
        ]
      }
    };

    const res = filterPanotrackByDistricts(points, tracks, [mockDistrict]);
    expect(res.filteredPoints.length).toBe(1);
    expect(res.filteredPoints[0].id).toBe('1');
    expect(res.filteredTracks.length).toBe(1);
  });

  it('returns all points if no districts are selected', () => {
    const points = [
      { id: '1', subgrid: 'A', lng: 101.5, lat: 3.1 },
      { id: '2', subgrid: 'B', lng: 115.0, lat: 4.5 }
    ];
    const tracks: Array<Array<[number, number]>> = [[[101.5, 3.1], [101.6, 3.2]]];

    const res = filterPanotrackByDistricts(points, tracks, []);
    expect(res.filteredPoints.length).toBe(2);
    expect(res.filteredTracks.length).toBe(1);
  });

  it('filters points and tracks by bounding boxes', () => {
    const points = [
      { id: '1', subgrid: 'A', lng: 101.5, lat: 3.1 },
      { id: '2', subgrid: 'B', lng: 115.0, lat: 4.5 }
    ];
    const tracks: Array<Array<[number, number]>> = [
      [[101.5, 3.1], [101.6, 3.2]],
      [[115.0, 4.5], [115.1, 4.6]]
    ];

    const res = filterPanotrackByBBoxes(points, tracks, [[101.0, 3.0, 102.0, 4.0]]);
    expect(res.filteredPoints.length).toBe(1);
    expect(res.filteredPoints[0].id).toBe('1');
    expect(res.filteredTracks.length).toBe(1);
    expect(res.filteredTracks[0]).toEqual([[101.5, 3.1], [101.6, 3.2]]);
  });

  it('returns all points when no bboxes are provided', () => {
    const points = [
      { id: '1', subgrid: 'A', lng: 101.5, lat: 3.1 }
    ];
    const tracks: Array<Array<[number, number]>> = [[[101.5, 3.1], [101.6, 3.2]]];

    const res = filterPanotrackByBBoxes(points, tracks, []);
    expect(res.filteredPoints.length).toBe(1);
    expect(res.filteredTracks.length).toBe(1);
  });

  it('correctly flags defects when matched against defectsList', () => {
    const dailyData = [
      {
        subgrid: 'N93E70',
        publishToWebGIS: 'yes',
        panoramas: [
          { id: 'p1', filename: 'N93E70-0001.jpg', longitude: 101.5, latitude: 3.1, status: 'yes' },
          { id: 'p2', filename: 'N93E70-0002.jpg', longitude: 101.6, latitude: 3.2, status: 'yes' }
        ]
      }
    ];

    const defectsList = [
      { filename: 'N93E70-0002.jpg', defect_type: 'blur' }
    ];

    const res = extractPanotrackPoints(dailyData, [], defectsList);
    expect(res.points.length).toBe(2);
    expect(res.points[0].color).toBe('#10b981'); // non-defect published
    expect(res.points[0].status).toBe('published');
    expect(res.points[1].color).toBe('#ef4444'); // matched defect
    expect(res.points[1].status).toBe('defect');
  });
});
