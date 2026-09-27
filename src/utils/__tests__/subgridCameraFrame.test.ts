import { describe, it, expect } from 'vitest';
import { rowsForSubgrid, framableSubgridPoints, subgridCode } from '../subgridCameraFrame';

const daily = (subgrid: string, extra: Record<string, unknown> = {}) => ({
  subgrid,
  ...extra
});

const batch = (subgrid: string, extra: Record<string, unknown> = {}) => ({
  subgrid,
  ...extra
});

const pickSubgrid = (r: { subgrid?: string; imageFilename?: string }) => r.subgrid || r.imageFilename;

describe('subgridCode', () => {
  it('normalises raw codes, filenames and casing', () => {
    expect(subgridCode('n93e70')).toBe('N93E70');
    expect(subgridCode('N93E70-0099.jpg')).toBe('N93E70');
    expect(subgridCode('  N93E70 ')).toBe('N93E70');
  });

  it('returns empty for missing input', () => {
    expect(subgridCode(undefined)).toBe('');
    expect(subgridCode('')).toBe('');
  });
});

describe('rowsForSubgrid', () => {
  const dailyRows = [daily('N93E70'), daily('N93E71')];
  const batchRows = [batch('N93E70'), batch('N93E72')];

  it('returns only the selected subgrid rows (never the whole project)', () => {
    const rows = rowsForSubgrid('N93E70', dailyRows, batchRows, pickSubgrid);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(dailyRows[0]);
  });

  it('falls back to masterlist rows when no daily run has landed', () => {
    const rows = rowsForSubgrid('N93E72', dailyRows, batchRows, pickSubgrid);
    expect(rows).toEqual([batchRows[1]]);
  });

  it('prefers daily rows when both sources have the subgrid', () => {
    const rows = rowsForSubgrid('N93E70', dailyRows, batchRows, pickSubgrid);
    expect(rows).toContain(dailyRows[0]);
    expect(rows).not.toContain(batchRows[0]);
  });

  it('matches a subgrid taken from imageFilename', () => {
    const rows = rowsForSubgrid('N93E72', [], [{ imageFilename: 'N93E72-0001.jpg' }], pickSubgrid);
    expect(rows).toHaveLength(1);
  });

  it('returns nothing for an empty subgrid instead of everything', () => {
    expect(rowsForSubgrid('', dailyRows, batchRows, pickSubgrid)).toEqual([]);
  });

  it('returns nothing when the subgrid is unknown', () => {
    expect(rowsForSubgrid('N99E99', dailyRows, batchRows, pickSubgrid)).toEqual([]);
  });
});

describe('framableSubgridPoints', () => {
  it('collects every frame of the subgrid so the camera zooms out to it', () => {
    const points = framableSubgridPoints([
      daily('N93E70', {
        panoramas: [
          { filename: 'N93E70-0001.jpg', latitude: 2.1, longitude: 102.1 },
          { filename: 'N93E70-0002.jpg', latitude: 2.2, longitude: 102.3 }
        ]
      })
    ], 'N93E70');

    expect(points).toHaveLength(2);
    expect(points.map(p => p.filename)).toEqual(['N93E70-0001.jpg', 'N93E70-0002.jpg']);
    expect(points[0].lat).toBeCloseTo(2.1);
    expect(points[0].lon).toBeCloseTo(102.1);
  });

  it('drops frames without coordinates so the map cannot fit a single stray point', () => {
    const points = framableSubgridPoints([
      daily('N93E70', {
        panoramas: [
          { filename: 'N93E70-0001.jpg' },
          { filename: 'N93E70-0002.jpg', lat: 2.1, lon: 102.1 },
          { filename: 'N93E70-0003.jpg', lat: 'nope', lon: 'nope' }
        ]
      })
    ], 'N93E70');

    expect(points).toHaveLength(1);
    expect(points[0].filename).toBe('N93E70-0002.jpg');
  });

  it('accepts string coordinates and alternate key names', () => {
    const points = framableSubgridPoints([
      daily('N93E70', { points: [{ point_id: 'a', y: '2.5', x: '102.5' }] })
    ], 'N93E70');

    expect(points).toHaveLength(1);
    expect(points[0].lat).toBeCloseTo(2.5);
    expect(points[0].lon).toBeCloseTo(102.5);
  });

  it('keeps zero coordinates — 0,0 is a real position, not a missing one', () => {
    const points = framableSubgridPoints([
      daily('N93E70', { panoramas: [{ filename: 'N93E70-0001.jpg', lat: 0, lon: 0 }] })
    ], 'N93E70');

    expect(points).toHaveLength(1);
  });

  it('stamps the canonical subgrid code and filename fallback onto every point', () => {
    const points = framableSubgridPoints([
      daily('n93e70', { panoramas: [{ image_url: '/MMS_PIC/N93E70-0009.jpg', lat: 2, lon: 102 }] })
    ], 'N93E70');

    expect(points[0].subgrid).toBe('N93E70');
    expect(points[0].filename).toBe('/MMS_PIC/N93E70-0009.jpg');
  });

  it('returns an empty list when the subgrid has no frames', () => {
    expect(framableSubgridPoints([daily('N93E70')], 'N93E70')).toEqual([]);
  });
});
