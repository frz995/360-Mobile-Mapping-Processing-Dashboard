import { describe, expect, it } from 'vitest';
import {
  buildExplorerBlock,
  buildRoadSnapshot,
  buildWebgisSnapshot,
  generateShareToken,
  hashSharePassword,
  lineDistanceKm,
  parseShareToken,
  pickStorageResolveSettings,
  resolveSegmentPanorama,
  serializeExplorerMesh,
  verifySharePassword
} from '../mapShares';
import type { ChoroplethSetting } from '../choroplethSettings';

describe('mapShares token + password', () => {
  it('generates unique 32-char hex tokens', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('hashes passwords with SHA-256 (known vectors)', async () => {
    expect(await hashSharePassword('password')).toBe(
      '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
    );
    expect(await hashSharePassword('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('verifies share passwords against the stored digest', async () => {
    const digest = await hashSharePassword('survey2026');
    expect(await verifySharePassword({ password_hash: digest }, 'survey2026')).toBe(true);
    expect(await verifySharePassword({ password_hash: digest.toUpperCase() }, 'survey2026')).toBe(true);
    expect(await verifySharePassword({ password_hash: digest }, 'wrong')).toBe(false);
    expect(await verifySharePassword({ password_hash: null }, '')).toBe(true);
  });

  it('parses share tokens from /share/<token> paths only', () => {
    expect(parseShareToken('/share/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
    expect(parseShareToken('/share/')).toBeNull();
    expect(parseShareToken('/dashboard')).toBeNull();
  });
});

describe('mapShares geometry', () => {
  it('computes great-circle line distance', () => {
    const oneDegreeLat = lineDistanceKm([[1, 100], [2, 100]]);
    expect(oneDegreeLat).toBeGreaterThan(110);
    expect(oneDegreeLat).toBeLessThan(113);
    expect(lineDistanceKm([])).toBe(0);
  });
});

describe('snapshot builders', () => {
  const dailyData = [
    {
      id: 'd1',
      subgrid: 'N93E70',
      date: '2026-09-01',
      kmProcessed: 1.25,
      poiCount: 50,
      availableImagesCount: 48,
      defects: 1,
      pic: 'Ali',
      isSyncedWithSupabase: true,
      panoramas: [
        { latitude: 2.5528812345, longitude: 102.8164198765 },
        { latitude: 2.5531, longitude: 102.8167 },
        { latitude: 0, longitude: 0 }
      ]
    },
    {
      id: 'd2',
      subgrid: 'N94E70',
      kmProcessed: 0.5,
      addImageCount: 10,
      images: 10,
      status: 'Ongoing',
      panoramas: [{ lat: 3.1, lng: 101.7 }]
    }
  ];

  it('builds a rounded, capped webgis snapshot with stats + tracks', () => {
    const snap = buildWebgisSnapshot(dailyData, { projectName: 'MM Test', contractCode: 'MMS-TEST' });
    expect(snap.stats.subgrids).toBe(2);
    expect(snap.stats.km).toBe(1.75);
    const pts = snap.points ?? [];
    const trk = snap.tracks ?? [];
    expect(pts.every((p) => String(p.lat).length <= 11 + 2)).toBe(true);
    expect(pts.find((p) => p.subgrid === 'N93E70' && p.status === 'published')).toBeTruthy();
    expect(pts.find((p) => p.lat === 0 && p.lng === 0)).toBeFalsy();
    expect(trk.find((t) => t.subgrid === 'N93E70')?.coords.length).toBe(2);
    expect(snap.stats.passRate).toBeGreaterThan(0);
    expect(snap.contractCode).toBe('MMS-TEST');
    expect(snap.bbox).toBeTruthy();
  });

  it('handles empty inputs safely', () => {
    const empty = buildWebgisSnapshot([]);
    expect(empty.center.length).toBe(2);
    expect(empty.points).toEqual([]);
    const road = buildRoadSnapshot([]);
    expect(road.stats.lines).toBe(0);
  });

  it('builds a road snapshot from extracted lines', () => {
    const road = buildRoadSnapshot(
      [
        { coordinates: [[2.5, 102.8], [2.51, 102.81]], highway: 'E2' },
        { coordinates: [[2.52, 102.82]], highway: 'short-drop' }
      ],
      { planName: 'Plan A', projectSettings: { contractCode: 'X-1' } }
    );
    expect(road.lines?.length).toBe(1);
    expect(road.stats.lines).toBe(1);
    expect(road.stats.km).toBeGreaterThan(0);
    expect(road.planName).toBe('Plan A');
  });

  it('builds a road snapshot with captured survey points, tracks, and region stats when lines are empty', () => {
    const road = buildRoadSnapshot([], {
      planName: 'Region: Segamat, Tangkak',
      capturedPoints: [
        { lat: 2.505, lng: 102.81, subgrid: 'SG01', status: 'published', isPublished: true },
        { lat: 2.506, lng: 102.82, subgrid: 'SG01', status: 'staging' },
        { lat: 2.507, lng: 102.83, subgrid: 'SG02', status: 'defect', color: '#ef4444' }
      ],
      capturedTracks: [
        [[102.81, 2.505], [102.82, 2.506], [102.83, 2.507]]
      ],
      stats: {
        km: 3.37,
        subgrids: 3,
        poi: 273,
        lines: 0
      },
      bbox: [102.7, 2.4, 103.0, 2.6]
    });

    expect(road.points?.length).toBe(3);
    expect(road.tracks?.length).toBe(1);
    expect(road.stats.km).toBe(3.37);
    expect(road.stats.subgrids).toBe(3);
    expect(road.stats.poi).toBe(273);
    expect(road.planName).toBe('Region: Segamat, Tangkak');
    expect(road.center[0]).toBeCloseTo(2.5, 1);
    expect(road.center[1]).toBeCloseTo(102.8, 1);
  });

  it('builds a road snapshot including serialized catalog layers and survey detail segments', () => {
    const road = buildRoadSnapshot(
      [{ coordinates: [[2.5, 102.8], [2.51, 102.81]] }],
      {
        segments: [
          { subgrid: 'SG01', km: 3.37, poi: 273, frames: 260, defects: 2, date: '2026-09-01', status: 'published' }
        ],
        catalogLayers: [
          {
            id: 'cat-1',
            name: 'Road Centerline',
            visible: true,
            color: '#ff0000',
            strokeStyle: 'dashed',
            geometryType: 'LineString',
            geojson: {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  properties: { road: 'E2' },
                  geometry: { type: 'LineString', coordinates: [[102.800001234, 2.500001234], [102.810009999, 2.510000001]] }
                }
              ]
            }
          },
          {
            id: 'cat-2',
            name: 'Hidden Layer',
            visible: false,
            geometryType: 'Polygon',
            geojson: { type: 'FeatureCollection', features: [] }
          }
        ]
      }
    );

    expect(road.segments?.[0]).toMatchObject({ subgrid: 'SG01', km: 3.37, poi: 273, status: 'published' });
    expect(road.catalogLayers?.length).toBe(1);
    const cl = road.catalogLayers![0];
    expect(cl).toMatchObject({ id: 'cat-1', name: 'Road Centerline', color: '#ff0000', strokeStyle: 'dashed', geometryType: 'LineString', featureCount: 1 });
    const coords = cl.geojson.features[0].geometry.coordinates;
    expect(coords[0][0]).toBeCloseTo(102.8, 4);
    expect(coords[0][1]).toBeCloseTo(2.5, 4);
    expect(cl.opacity).toBeGreaterThanOrEqual(0);
    expect(cl.opacity).toBeLessThanOrEqual(1);
  });

  it('caps catalog geometry feature count for portability', () => {
    const features = Array.from({ length: 20000 }, (_, i) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [102.8 + i * 0.0001, 2.5] }
    }));
    const road = buildRoadSnapshot([], {
      catalogLayers: [{ id: 'huge', name: 'Huge', geometryType: 'Point', geojson: { type: 'FeatureCollection', features } }]
    });
    expect(road.catalogLayers?.[0]?.featureCount).toBeLessThanOrEqual(25000);
  });
});

describe('mapShares project explorer block', () => {
  const setting: ChoroplethSetting = {
    metric: 'density',
    method: 'manual',
    alpha: 0.85,
    reverse: false,
    classes: [
      { upperBound: 3.5, color: '#edf8e9' },
      { upperBound: null, color: '#31a354' }
    ]
  };

  /** Mirrors the property bag the mesh builder emits, heavy fields included. */
  function meshFeature(subgrid: string) {
    return {
      type: 'Feature',
      id: 1,
      properties: {
        subgrid,
        density: 2.5,
        complexity: 40,
        panotrack: 120,
        roads: 9.1,
        coverage: 66,
        coverageKm: 6,
        planKm: 9.1,
        areaKm2: 3.6,
        corridor: { shortKm: 1, mediumKm: 3, arterialKm: 2, trunkKm: 1 },
        junctions: { deadEnd: 6, threeWay: 8, fourWay: 4, fivePlus: 2 },
        frames: { verified: 150, defect: 60, transit: 50, mismatch: 40 },
        bbox: [101.4, 2.9, 101.44, 2.94],
        bbox_str: '[101.4,2.9,101.44,2.94]'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[101.4, 2.9], [101.44, 2.9], [101.44, 2.94], [101.4, 2.94], [101.4, 2.9]]]
      }
    };
  }

  it('keeps only the properties the choropleth classifier reads', () => {
    const mesh = serializeExplorerMesh({
      type: 'FeatureCollection',
      features: [meshFeature('GRID-001')]
    });

    expect(mesh.features).toHaveLength(1);
    expect(Object.keys(mesh.features[0].properties).sort()).toEqual(
      ['complexity', 'coverage', 'density', 'panotrack', 'roads', 'subgrid']
    );
    // The per-cell breakdowns are stamped onto every ring of a cell, so they
    // are the bulk of the payload and the viewer never reads them.
    expect(mesh.features[0].properties).not.toHaveProperty('corridor');
    expect(mesh.features[0].properties).not.toHaveProperty('frames');
    expect(mesh.features[0].properties).not.toHaveProperty('bbox_str');
  });

  it('drops non-finite metric values so they cannot poison the step expression', () => {
    const f = meshFeature('GRID-002');
    (f.properties as Record<string, unknown>).density = null;
    f.properties.coverage = Number.NaN;
    const mesh = serializeExplorerMesh({ type: 'FeatureCollection', features: [f] });

    expect(mesh.features[0].properties).not.toHaveProperty('density');
    expect(mesh.features[0].properties).not.toHaveProperty('coverage');
    expect(mesh.features[0].properties.subgrid).toBe('GRID-002');
  });

  it('shrinks the payload by discarding the duplicated per-ring breakdowns', () => {
    const features = Array.from({ length: 200 }, (_, i) => meshFeature(`GRID-${i}`));
    const raw = JSON.stringify({ type: 'FeatureCollection', features }).length;
    const lean = JSON.stringify(
      serializeExplorerMesh({ type: 'FeatureCollection', features })
    ).length;

    expect(lean).toBeLessThan(raw * 0.6);
  });

  it('sends every cell with no cap, so a share never silently loses the region', () => {
    const features = Array.from({ length: 5000 }, (_, i) => meshFeature(`GRID-${i}`));
    const block = buildExplorerBlock({
      metric: 'density',
      setting,
      mesh: { type: 'FeatureCollection', features }
    });

    expect(block?.cellCount).toBe(5000);
    expect(block?.mesh.features).toHaveLength(5000);
  });

  it('carries grid provenance so a public reader knows the cell size', () => {
    const block = buildExplorerBlock({
      metric: 'density',
      setting,
      mesh: { type: 'FeatureCollection', features: [meshFeature('GRID-001')] },
      grid: { source: 'imported', cellKm: 5, areaFloored: false }
    });

    expect(block?.grid).toEqual({ source: 'imported', cellKm: 5, areaFloored: false });
  });

  it('omits grid provenance rather than inventing it when none was measured', () => {
    const block = buildExplorerBlock({
      metric: 'density',
      setting,
      mesh: { type: 'FeatureCollection', features: [meshFeature('GRID-001')] }
    });

    expect(block?.grid).toBeUndefined();
  });

  it('flags a floored area so the viewer can qualify a low density', () => {
    const block = buildExplorerBlock({
      metric: 'density',
      setting,
      mesh: { type: 'FeatureCollection', features: [meshFeature('GRID-001')] },
      grid: { source: 'derived', cellKm: 1.2, areaFloored: true }
    });

    expect(block?.grid?.areaFloored).toBe(true);
  });

  it('freezes the resolved class breaks so the viewer reproduces manual edits', () => {
    const block = buildExplorerBlock({
      metric: 'density',
      metricLabel: 'Road density',
      scopeLabel: 'GRID-007',
      palette: 'greens',
      setting,
      mesh: { type: 'FeatureCollection', features: [meshFeature('GRID-007')] }
    });

    expect(block?.metricLabel).toBe('Road density');
    expect(block?.scopeLabel).toBe('GRID-007');
    expect(block?.palette).toBe('greens');
    expect(block?.setting.classes).toEqual(setting.classes);
  });

  it('returns no block when the explorer produced no mesh', () => {
    expect(buildExplorerBlock({ metric: 'density', setting, mesh: null })).toBeUndefined();
    expect(
      buildExplorerBlock({
        metric: 'density',
        setting,
        mesh: { type: 'FeatureCollection', features: [] }
      })
    ).toBeUndefined();
  });

  it('attaches the block to a road share, and leaves road shares untouched without one', () => {
    const block = buildExplorerBlock({
      metric: 'density',
      setting,
      mesh: { type: 'FeatureCollection', features: [meshFeature('GRID-001')] }
    });

    expect(buildRoadSnapshot([], { explorer: block }).explorer?.cellCount).toBe(1);
    expect(buildRoadSnapshot([]).explorer).toBeUndefined();
  });
});

describe('mapShares imagery resolution seam', () => {
  it('falls back to the baked URLs when there is no panorama reference', () => {
    const media = resolveSegmentPanorama({ subgrid: 'SG01', km: 1, poi: 1, frames: 1, defects: 0, status: 'published', panoramaUrl: 'https://x/p.jpg', configUrl: 'https://x/tiles/p/config.json' });
    expect(media.panoramaUrl).toBe('https://x/p.jpg');
    expect(media.configUrl).toBe('https://x/tiles/p/config.json');
  });

  it('falls back to the baked URLs when storage prefs are missing', () => {
    const media = resolveSegmentPanorama(
      { subgrid: 'SG01', km: 1, poi: 1, frames: 1, defects: 0, status: 'published', panoramaRef: { filename: 'a.jpg', subgrid: 'SG01' }, panoramaUrl: 'https://baked/a.jpg' },
      undefined
    );
    expect(media.panoramaUrl).toBe('https://baked/a.jpg');
  });

  it('re-resolves a fresh panorama URL from the stored reference when storage prefs are present', () => {
    const media = resolveSegmentPanorama(
      { subgrid: 'SG01', km: 1, poi: 1, frames: 1, defects: 0, status: 'published', panoramaRef: { filename: 'SG01-0001.jpg', subgrid: 'SG01' }, panoramaUrl: 'https://stale/old.jpg' },
      { storageProvider: 'cloudflare_r2', r2Domain: 'https://cdn.example.com' }
    );
    expect(media.panoramaUrl).toBe('https://cdn.example.com/SG01-0001.jpg');
    expect(media.panoramaUrl).not.toBe('https://stale/old.jpg');
    expect(media.configUrl).toContain('config.json');
  });

  it('omits the multi-res config URL for single-equirectangular storage', () => {
    const media = resolveSegmentPanorama(
      { subgrid: 'SG01', km: 1, poi: 1, frames: 1, defects: 0, status: 'published', panoramaRef: { filename: 'SG01-0001.jpg', subgrid: 'SG01' } },
      { storageProvider: 'cloudflare_r2', r2Domain: 'https://cdn.example.com', imageStorageStrategy: 'single_equirectangular' }
    );
    expect(media.panoramaUrl).toContain('cdn.example.com');
    expect(media.configUrl).toBeUndefined();
  });

  it('embeds a resolvable panorama reference + frozen storage prefs in the snapshot', () => {
    const snap = buildWebgisSnapshot(
      [
        {
          id: 'd3',
          subgrid: 'N93E70',
          status: 'Complete',
          panoramas: [{ latitude: 2.55, longitude: 102.8, filename: 'N93E70-0001.jpg', image_url: 'https://cdn.example.com/N93E70-0001.jpg' }]
        }
      ],
      { projectName: 'LP1', storageProvider: 'cloudflare_r2', r2Domain: 'https://cdn.example.com' }
    );
    expect(snap.storage?.r2Domain).toBe('https://cdn.example.com');
    expect(snap.segments?.[0]?.panoramaRef).toEqual({ filename: 'N93E70-0001.jpg', subgrid: 'N93E70' });
    expect(snap.segments?.[0]?.panoramaUrl).toContain('cdn.example.com');
  });

  it('only ships the resolver subset of project settings into a share', () => {
    const picked = pickStorageResolveSettings({
      storageProvider: 'aws_s3',
      r2Domain: 'https://x.example.com',
      contractCode: 'SECRET-NOPE',
      apiKeys: 'should-never-leak'
    } as unknown as Record<string, unknown>);
    expect(picked?.r2Domain).toBe('https://x.example.com');
    expect(picked).not.toHaveProperty('contractCode');
    expect(picked).not.toHaveProperty('apiKeys');
    expect(pickStorageResolveSettings(null)).toBeUndefined();
  });
});
