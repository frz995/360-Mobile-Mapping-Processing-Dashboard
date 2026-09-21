import { describe, expect, it } from 'vitest';
import {
  buildRoadSnapshot,
  buildWebgisSnapshot,
  generateShareToken,
  hashSharePassword,
  lineDistanceKm,
  parseShareToken,
  verifySharePassword
} from '../mapShares';

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
});
