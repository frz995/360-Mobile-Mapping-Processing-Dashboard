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
  buildGridInfoFromCells,
  kmToStepDeg,
  sanitizeGridKm,
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

  describe('grid provenance', () => {
    // ~0.2 deg on a side, so the compact-urban branch (stepDeg 0.018) applies.
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

    it('reports a derived grid with the cell size it chose', () => {
      const roadRuns = [[[101.05, 4.05], [101.15, 4.15]]] as any;
      const result = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, []);

      expect(result.grid.source).toBe('derived');
      expect(result.grid.cellCount).toBe(result.cells.length);
      // stepDeg 0.018 deg is ~2.0 km at the equator.
      expect(result.grid.cellKm).toBeCloseTo(2, 0);
    });

    it('reports an imported grid and never mixes it with the derived fallback', () => {
      const importedLayer = {
        hasFeatures: true,
        geojson: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { NAME: 'G5x5-01' },
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [101.0, 4.0],
                    [101.05, 4.0],
                    [101.05, 4.05],
                    [101.0, 4.05],
                    [101.0, 4.0]
                  ]
                ]
              }
            }
          ]
        }
      } as any;

      const roadRuns = [[[101.0, 4.0], [101.05, 4.05]]] as any;
      const result = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, [importedLayer]);

      expect(result.grid.source).toBe('imported');
      expect(result.cells.map((c) => c.subgrid)).toEqual(['G5x5-01']);
    });

    it('flags cells clamped up to the 0.5 km2 floor so a low density is not read as real', () => {
      // ~0.004 deg on a side is roughly 0.02 km2 — well under the floor.
      const tinyDistrict = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [101.0, 4.0],
                  [101.004, 4.0],
                  [101.004, 4.004],
                  [101.0, 4.004],
                  [101.0, 4.0]
                ]
              ]
            }
          }
        ]
      };
      const subgridMetrics = [{ subgrid: 'TINY', bbox: [101.0, 4.0, 101.004, 4.004], planKm: 1 }];
      const roadRuns = [[[101.0, 4.0], [101.004, 4.004]]] as any;

      const result = buildMeshRoadChoroplethGeojson(
        roadRuns,
        tinyDistrict,
        subgridMetrics
      );

      expect(result.cells).toHaveLength(1);
      // The floor is applied, so area is never the true sub-0.5 km2 value.
      expect(result.cells[0].areaKm2).toBeGreaterThanOrEqual(0.5);
      expect(result.grid.areaFloored).toBe(true);
    });

    it('does not flag the floor for a cell of ordinary size', () => {
      const subgridMetrics = [{ subgrid: 'NORMAL', bbox: [101.0, 4.0, 101.05, 4.05], planKm: 4 }];
      const roadRuns = [[[101.0, 4.0], [101.05, 4.05]]] as any;

      const result = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, subgridMetrics);

      expect(result.grid.areaFloored).toBe(false);
    });
  });

  it('derives a comparable cell size from cells alone, for callers without a descriptor', () => {
    const info = buildGridInfoFromCells([
      { areaKm2: 25 },
      { areaKm2: 25 },
      { areaKm2: 16 }
    ] as any);

    expect(info.cellCount).toBe(3);
    // Median area 25 km2 -> 5 km edge.
    expect(info.cellKm).toBe(5);
    expect(info.source).toBe('derived');
  });

  describe('operator-declared grid', () => {
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
                [101.7, 4.0],
                [101.7, 4.6],
                [101.0, 4.6],
                [101.0, 4.0]
              ]
            ]
          }
        }
      ]
    };
    const roadRuns = [[[101.1, 4.1], [101.6, 4.5]]] as any;

    it('defaults to the auto resolution when no spec is supplied', () => {
      const auto = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, []);
      const explicitNull = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, [], [], [], null);
      const emptySpec = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, [], [], [], {});

      expect(explicitNull.cells.length).toBe(auto.cells.length);
      expect(emptySpec.cells.length).toBe(auto.cells.length);
      expect(auto.grid.declared).toBe(false);
      expect(auto.grid.cellKmSource).toBe('auto');
    });

    it('builds a 5 km lattice when 5 km is declared for the derived grid', () => {
      const declared = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, [], [], [], {
        derivedCellKm: 5
      });
      const auto = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, []);

      expect(declared.grid.declared).toBe(true);
      expect(declared.grid.cellKmSource).toBe('declared');
      expect(declared.grid.cellKm).toBe(5);
      // Coarser cells must mean fewer of them.
      expect(declared.grid.cellCount).toBeLessThan(auto.grid.cellCount);
    });

    it('grows the cell count as the declared size shrinks', () => {
      const coarse = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, [], [], [], { derivedCellKm: 10 });
      const fine = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, [], [], [], { derivedCellKm: 2 });

      expect(fine.grid.cellCount).toBeGreaterThan(coarse.grid.cellCount);
    });

    it('gives a district-clipped edge cell the same area as an interior one when declared', () => {
      // One whole cell plus one clipped sliver, as a real clipped survey grid has.
      const subgridMetrics = [
        { subgrid: 'FULL', bbox: [101.1, 4.1, 101.15, 4.15], planKm: 4 },
        { subgrid: 'CLIPPED', bbox: [101.15, 4.1, 101.175, 4.15], planKm: 1 }
      ];

      const measured = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, subgridMetrics);
      const clippedMeasured = measured.cells.find((c) => c.subgrid === 'CLIPPED');
      const fullMeasured = measured.cells.find((c) => c.subgrid === 'FULL');
      // Measured areas differ, so the sliver reports a different density.
      expect(clippedMeasured!.areaKm2).not.toBe(fullMeasured!.areaKm2);

      const declared = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, subgridMetrics, [], [], {
        importedCellKm: 5
      });
      const clippedDeclared = declared.cells.find((c) => c.subgrid === 'CLIPPED');
      const fullDeclared = declared.cells.find((c) => c.subgrid === 'FULL');
      // Declared: one denominator for every cell, so the sliver is not penalised
      // nor rewarded by its clipped footprint.
      expect(clippedDeclared!.areaKm2).toBe(fullDeclared!.areaKm2);
      expect(clippedDeclared!.areaKm2).toBe(25);
      expect(declared.grid.declared).toBe(true);
      expect(declared.grid.cellKmSource).toBe('declared');
    });

    it('does not flag the area floor once a nominal area is declared', () => {
      const tinyDistrict = {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [101.0, 4.0],
                  [101.004, 4.0],
                  [101.004, 4.004],
                  [101.0, 4.004],
                  [101.0, 4.0]
                ]
              ]
            }
          }
        ]
      };
      const subgridMetrics = [{ subgrid: 'TINY', bbox: [101.0, 4.0, 101.004, 4.004], planKm: 1 }];
      const tinyRun = [[[101.0, 4.0], [101.004, 4.004]]] as any;

      const declared = buildMeshRoadChoroplethGeojson(tinyRun, tinyDistrict, subgridMetrics, [], [], {
        importedCellKm: 5
      });
      expect(declared.cells[0].areaKm2).toBe(25);
      expect(declared.grid.areaFloored).toBe(false);
    });

    it('rejects an unusable declared size and falls back to auto', () => {
      for (const bad of [0, -5, 500, Number.NaN, 'abc', null]) {
        const result = buildMeshRoadChoroplethGeojson(roadRuns, districtGeojson, [], [], [], {
          derivedCellKm: bad as any
        });
        expect(result.grid.declared).toBe(false);
        expect(result.grid.cellKmSource).toBe('auto');
      }
    });
  });

  describe('grid helpers', () => {
    it('sanitises a declared size and rejects out-of-range values', () => {
      expect(sanitizeGridKm(5)).toBe(5);
      expect(sanitizeGridKm('7.5')).toBe(7.5);
      expect(sanitizeGridKm(0.05)).toBeNull();
      expect(sanitizeGridKm(150)).toBeNull();
      expect(sanitizeGridKm('nope')).toBeNull();
      expect(sanitizeGridKm(undefined)).toBeNull();
    });

    it('converts km to a latitude-aware degree step', () => {
      // At the equator a degree is ~111 km, so 5 km is ~0.045 deg.
      expect(kmToStepDeg(5, 0)).toBeCloseTo(0.045, 3);
      // Away from the equator a degree of longitude is shorter, so the same km
      // needs a bigger step.
      expect(kmToStepDeg(5, 60)).toBeGreaterThan(kmToStepDeg(5, 0));
    });
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
