import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  createCircleCoords,
  createInvertedMaskGeoJson,
  createInvertedPolygonMaskGeoJson,
  createPolygonOutlineGeoJson,
  createCircleOutlineGeoJson,
  calculateBufferAnalytics,
  getCatchmentTabData,
  getDensityChoroplethColor,
  buildMaplibreChoroplethExpression,
  buildMaplibreChoroplethMeshExpression,
  clipPolygonRingToBbox,
  clipDistrictToCellBbox,
  buildMeshRoadChoroplethGeojson,
  ATLAS_PALETTES
} from '../projectExplorerGeometry';

describe('projectExplorerGeometry', () => {
  it('computes accurate haversine distance', () => {
    // Distance between 2 points 0.01 deg latitude apart (~1113 meters)
    const d = haversineMeters([101.0, 4.0], [101.0, 4.01]);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);

    // Distance to same point is 0
    expect(haversineMeters([101.0, 4.0], [101.0, 4.0])).toBe(0);
  });

  it('generates closed circle coordinates', () => {
    const coords = createCircleCoords([101.0, 4.0], 1000, 32);
    expect(coords.length).toBe(33); // 32 steps + closing vertex
    expect(coords[0][0]).toBeCloseTo(coords[32][0], 4);
    expect(coords[0][1]).toBeCloseTo(coords[32][1], 4);
  });

  it('generates inverted mask geojson with hole', () => {
    const mask = createInvertedMaskGeoJson([101.0, 4.0], 1500, 32);
    expect(mask.type).toBe('FeatureCollection');
    expect(mask.features.length).toBe(1);
    const geom = mask.features[0].geometry as GeoJSON.Polygon;
    expect(geom.type).toBe('Polygon');
    expect(geom.coordinates.length).toBe(2); // Outer ring + inner hole ring
  });

  it('generates circle outline geojson', () => {
    const outline = createCircleOutlineGeoJson([101.0, 4.0], 800, 32);
    expect(outline.type).toBe('FeatureCollection');
    const geom = outline.features[0].geometry as GeoJSON.LineString;
    expect(geom.type).toBe('LineString');
    expect(geom.coordinates.length).toBe(33);
  });

  it('computes density analytics and demographic profile', () => {
    const center: [number, number] = [101.0, 4.0];
    const roadRuns = [
      [
        [100.995, 4.0],
        [101.005, 4.0]
      ],
      [
        [101.0, 3.995],
        [101.0, 4.005]
      ]
    ] as any;
    const capturedPoints = [
      [101.0, 4.0],
      [101.001, 4.0],
      [101.002, 4.0],
      [105.0, 5.0] // Outside buffer
    ];

    const analytics = calculateBufferAnalytics(center, 1000, roadRuns, capturedPoints);
    expect(analytics.radiusMeters).toBe(1000);
    expect(analytics.areaKm2).toBeCloseTo(Math.PI, 1);
    expect(analytics.roadLengthKm).toBeGreaterThan(0);
    expect(analytics.panoCount).toBe(3); // 3 inside, 1 outside
    expect(analytics.demographic.urbanDensityScore).toBeGreaterThanOrEqual(0);
    expect(analytics.demographic.urbanDensityScore).toBeLessThanOrEqual(100);
    expect(analytics.urbanClassification).toBeDefined();
  });

  it('interpolates colors from Atlas sequential palette correctly', () => {
    const col0 = getDensityChoroplethColor(0, 'viridis');
    const colHigh = getDensityChoroplethColor(12, 'viridis');
    expect(col0).toBe('#440154');
    expect(colHigh).toBe('#fde725');
  });

  it('dynamically impacts analytics and charts when radius changes', () => {
    const center: [number, number] = [101.0, 4.0];
    const roadRuns = [
      [
        [100.995, 4.0],
        [101.005, 4.0]
      ],
      [
        [101.0, 3.995],
        [101.0, 4.005]
      ]
    ] as any;
    const capturedPoints = [
      [101.0, 4.0],
      [101.002, 4.0], // ~222m
      [101.015, 4.0]  // ~1.6km
    ];

    const smallBuffer = calculateBufferAnalytics(center, 500, roadRuns, capturedPoints);
    const largeBuffer = calculateBufferAnalytics(center, 3000, roadRuns, capturedPoints);

    // Area scales quadratically
    expect(largeBuffer.areaKm2).toBeGreaterThan(smallBuffer.areaKm2);
    // Panos inside small buffer is 2, while large buffer includes the third point
    expect(smallBuffer.panoCount).toBe(2);
    expect(largeBuffer.panoCount).toBe(3);

    // Verify all 5 system tabs return structured sections
    const tabs = ['roads', 'density', 'complexity', 'panotrack', 'coverage'] as const;
    for (const t of tabs) {
      const data = getCatchmentTabData(largeBuffer, t);
      expect(data.key).toBe(t);
      expect(data.sections.length).toBe(2);
      expect(data.sections[0].rows.length).toBeGreaterThan(0);
      expect(data.sections[1].rows.length).toBeGreaterThan(0);
    }
  });

  it('supports all Atlas choropleth palettes including greens', () => {
    expect(ATLAS_PALETTES.greens).toBeDefined();
    expect(ATLAS_PALETTES.viridis).toBeDefined();
    expect(ATLAS_PALETTES.blues).toBeDefined();
    expect(ATLAS_PALETTES.magma).toBeDefined();
    expect(ATLAS_PALETTES.pastel).toBeDefined();
  });

  it('builds valid MapLibre GL choropleth expressions for road lines and mesh fills', () => {
    const greensLineExpr = buildMaplibreChoroplethExpression('greens', 'density');
    expect(greensLineExpr[0]).toBe('step');
    expect(greensLineExpr[2]).toBe('#edf8e9');
    expect(greensLineExpr[10]).toBe('#006d2c');

    const viridisLineExpr = buildMaplibreChoroplethExpression('viridis', 'density');
    expect(viridisLineExpr[0]).toBe('step');
    expect(viridisLineExpr[1]).toEqual(['coalesce', ['get', 'density'], 0]);
    // 5 categories: base color + 4 (threshold, color) pairs
    expect(viridisLineExpr[2]).toBe('#440154');
    expect(viridisLineExpr[3]).toBe(1.5);
    expect(viridisLineExpr[10]).toBe('#fde725');

    const bluesLineExpr = buildMaplibreChoroplethExpression('blues', 'density');
    expect(bluesLineExpr[0]).toBe('step');
    expect(bluesLineExpr[2]).toBe('#eff3ff');
    expect(bluesLineExpr[10]).toBe('#08519c');

    const magmaMeshExpr = buildMaplibreChoroplethMeshExpression('magma', 'density', 0.28);
    expect(magmaMeshExpr[0]).toBe('case');
    expect(magmaMeshExpr[1]).toEqual(['<=', ['coalesce', ['get', 'density'], 0], 0]);
    expect(magmaMeshExpr[2]).toBe('rgba(0, 0, 0, 0)');
    expect(magmaMeshExpr[3][0]).toBe('step');
    expect(magmaMeshExpr[3][2]).toContain('rgba(');
    expect(magmaMeshExpr[3][2]).toContain('0.28');
  });

  it('clips polygon rings strictly to cell bbox via Sutherland-Hodgman', () => {
    const ring: [number, number][] = [
      [101.0, 4.0],
      [101.2, 4.0],
      [101.2, 4.2],
      [101.0, 4.2],
      [101.0, 4.0]
    ];
    // Cell overlapping top-right corner
    const cellBbox: [number, number, number, number] = [101.15, 4.15, 101.3, 4.3];
    const clipped = clipPolygonRingToBbox(ring, cellBbox);
    expect(clipped.length).toBeGreaterThanOrEqual(4);
    // All vertices must be <= 101.2 and <= 4.2
    for (const [lng, lat] of clipped) {
      expect(lng).toBeLessThanOrEqual(101.200001);
      expect(lat).toBeLessThanOrEqual(4.200001);
      expect(lng).toBeGreaterThanOrEqual(101.149999);
      expect(lat).toBeGreaterThanOrEqual(4.149999);
    }
  });

  it('clips district to cell bbox and returns empty for cells outside district', () => {
    const districtGeojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [101.0, 4.0],
                [101.2, 4.0],
                [101.2, 4.2],
                [101.0, 4.2],
                [101.0, 4.0]
              ]
            ]
          }
        }
      ]
    };

    // Inside/overlapping cell
    const insideCell: [number, number, number, number] = [101.05, 4.05, 101.15, 4.15];
    const ringsInside = clipDistrictToCellBbox(districtGeojson, insideCell);
    expect(ringsInside.length).toBe(1);

    // Completely outside cell
    const outsideCell: [number, number, number, number] = [105.0, 6.0, 105.1, 6.1];
    const ringsOutside = clipDistrictToCellBbox(districtGeojson, outsideCell);
    expect(ringsOutside.length).toBe(0);
  });

  it('builds mesh road choropleth GeoJSON with density values strictly bounded by district', () => {
    const districtGeojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [101.0, 4.0],
                [101.2, 4.0],
                [101.2, 4.2],
                [101.0, 4.2],
                [101.0, 4.0]
              ]
            ]
          }
        }
      ]
    };

    const subgridMetrics = [
      {
        subgrid: 'SG01',
        bbox: [101.05, 4.05, 101.15, 4.15],
        planKm: 12.5
      },
      {
        subgrid: 'SG_OUTSIDE',
        bbox: [105.0, 6.0, 105.1, 6.1], // Outside district
        planKm: 8.0
      }
    ];

    const roadRuns = [
      [
        [101.06, 4.06],
        [101.14, 4.14]
      ]
    ] as any;

    const result = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, subgridMetrics);
    expect(result.meshGeojson.type).toBe('FeatureCollection');
    // SG01 should be included, SG_OUTSIDE should be excluded because it is outside the district boundary
    expect(result.meshGeojson.features.length).toBe(1);
    expect(result.meshGeojson.features[0].properties?.subgrid).toBe('SG01');
    expect(result.meshGeojson.features[0].properties?.density).toBeGreaterThan(0);

    // Road features annotated with density
    expect(result.annotatedRoadsGeojson.type).toBe('FeatureCollection');
    expect(result.annotatedRoadsGeojson.features.length).toBe(1);
    expect(result.annotatedRoadsGeojson.features[0].properties?.density).toBeGreaterThan(0);
    expect(result.annotatedRoadsGeojson.features[0].properties?.subgrid).toBe('SG01');
  });

  it('returns un-ring-expanded cells carrying the per-cell breakdown the card aggregates', () => {
    const districtGeojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [101.0, 4.0],
                [101.2, 4.0],
                [101.2, 4.2],
                [101.0, 4.2],
                [101.0, 4.0]
              ]
            ]
          }
        }
      ]
    };

    const subgridMetrics = [
      { subgrid: 'SG01', bbox: [101.05, 4.05, 101.15, 4.15], planKm: 12.5 },
      { subgrid: 'SG02', bbox: [101.06, 4.06, 101.16, 4.16], planKm: 7.5 }
    ];

    // Four runs meeting at one shared node, so the cell has a 4-way junction to
    // classify. Degree counts segment ends, so four arms from one point.
    const hub: [number, number] = [101.1, 4.1];
    const roadRuns = [
      [
        hub,
        [101.06, 4.06]
      ],
      [
        hub,
        [101.14, 4.14]
      ],
      [
        hub,
        [101.06, 4.14]
      ],
      [
        hub,
        [101.14, 4.06]
      ]
    ] as any;

    const capturedPoints = [
      [101.1, 4.1],
      [101.11, 4.11]
    ] as any;

    const result = buildMeshRoadChoroplethGeojson(
      roadRuns,
      districtGeojson,
      subgridMetrics,
      capturedPoints
    );

    expect(result.cells).toHaveLength(2);
    expect(new Set(result.cells.map((c) => c.subgrid))).toEqual(new Set(['SG01', 'SG02']));

    for (const c of result.cells) {
      expect(c.corridor).toBeDefined();
      expect(c.junctions).toBeDefined();
      expect(c.frames).toBeDefined();
      expect(typeof c.coverageKm).toBe('number');
      expect(c.coverageKm).toBeGreaterThanOrEqual(0);
      expect(c.coverageKm).toBeLessThanOrEqual(c.planKm);
    }

    const corridorTotal = result.cells.reduce(
      (acc, c) =>
        acc +
        c.corridor.shortKm +
        c.corridor.mediumKm +
        c.corridor.arterialKm +
        c.corridor.trunkKm,
      0
    );
    expect(corridorTotal).toBeGreaterThan(0);

    // Junction nodes are counted, not invented.
    const nodeTotal = result.cells.reduce(
      (acc, c) => acc + c.junctions.threeWay + c.junctions.fourWay + c.junctions.fivePlus,
      0
    );
    expect(nodeTotal).toBeGreaterThan(0);

    // Frame counts match the captured points that fall inside each cell.
    const frameTotal = result.cells.reduce((acc, c) => acc + c.panotrack, 0);
    expect(frameTotal).toBeGreaterThanOrEqual(2);
  });

  it('derives corridor km from the clipped length, so a clipped segment never exceeds its cell', () => {
    const districtGeojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [101.0, 4.0],
                [101.2, 4.0],
                [101.2, 4.2],
                [101.0, 4.2],
                [101.0, 4.0]
              ]
            ]
          }
        }
      ]
    };

    const subgridMetrics = [
      { subgrid: 'SMALL', bbox: [101.05, 4.05, 101.06, 4.06], planKm: 4 }
    ];

    // A run much longer than the tiny cell: the corridor split must use the
    // clipped length, so the totals stay inside the cell.
    const roadRuns = [
      [
        [101.0, 4.0],
        [101.2, 4.2]
      ]
    ] as any;

    const result = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, subgridMetrics);
    const cell = result.cells.find((c) => c.subgrid === 'SMALL');
    expect(cell).toBeDefined();
    const corridorTotal =
      cell!.corridor.shortKm +
      cell!.corridor.mediumKm +
      cell!.corridor.arterialKm +
      cell!.corridor.trunkKm;
    expect(corridorTotal).toBeLessThan(cell!.planKm + 0.01);
  });

  it('generates inverted polygon mask and outline for selected grid focus', () => {
    const ring: [number, number][] = [
      [101.0, 4.0],
      [101.1, 4.0],
      [101.1, 4.1],
      [101.0, 4.1],
      [101.0, 4.0]
    ];

    const mask = createInvertedPolygonMaskGeoJson([ring]);
    expect(mask.type).toBe('FeatureCollection');
    expect(mask.features.length).toBe(1);
    const polyGeom = mask.features[0].geometry as GeoJSON.Polygon;
    expect(polyGeom.type).toBe('Polygon');
    expect(polyGeom.coordinates.length).toBe(2); // Global outer ring + grid hole ring

    const outline = createPolygonOutlineGeoJson([ring]);
    expect(outline.type).toBe('FeatureCollection');
    expect(outline.features.length).toBe(1);
    const lineGeom = outline.features[0].geometry as GeoJSON.LineString;
    expect(lineGeom.type).toBe('LineString');
    expect(lineGeom.coordinates.length).toBe(5);
  });
});
