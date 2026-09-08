import { describe, it, expect } from 'vitest';
import { mergeCommittedBoundaryFeatures } from '../common/DistrictProjectPopup';

const segamatFeature = {
  id: 'segamat',
  type: 'Feature',
  properties: { name: 'Segamat' },
  geometry: { type: 'MultiPolygon', coordinates: [[[[102.6, 2.4], [102.7, 2.4], [102.7, 2.6], [102.6, 2.6], [102.6, 2.4]]]] },
};

const tangkakFeature = {
  id: 'tangkak',
  type: 'Feature',
  properties: { name: 'Tangkak' },
  geometry: { type: 'MultiPolygon', coordinates: [[[[102.7, 2.45], [102.9, 2.45], [102.9, 2.6], [102.7, 2.6], [102.7, 2.45]]]] },
};

const unrelatedFeature = {
  id: 'johor-bahru',
  type: 'Feature',
  properties: { name: 'Johor Bahru' },
  geometry: { type: 'MultiPolygon', coordinates: [] },
};

describe('mergeCommittedBoundaryFeatures', () => {
  it('keeps every committed district even when the geojson only carries part of them', () => {
    // User's real situation: committed geojson carries Segamat, but Tangkak is also
    // part of the saved boundary — derived from the master district file by name.
    const merged = mergeCommittedBoundaryFeatures(
      [segamatFeature],
      ['Segamat', 'Tangkak'],
      [segamatFeature, tangkakFeature, unrelatedFeature]
    );
    const names = merged.map((f: any) => f.properties.name).sort();
    expect(names).toEqual(['Segamat', 'Tangkak']);
  });

  it('dedupes districts that appear in both the committed geojson and the master file', () => {
    const merged = mergeCommittedBoundaryFeatures(
      [segamatFeature, tangkakFeature],
      ['Segamat', 'Tangkak'],
      [segamatFeature, tangkakFeature]
    );
    const ids = merged.map((f: any) => f.id).sort();
    expect(ids).toEqual(['segamat', 'tangkak']);
  });

  it('returns an empty list when no district matches', () => {
    const merged = mergeCommittedBoundaryFeatures([], ['Unknown'], [unrelatedFeature]);
    expect(merged).toEqual([]);
  });
});