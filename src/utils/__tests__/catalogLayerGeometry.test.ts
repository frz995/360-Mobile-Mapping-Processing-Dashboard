import { describe, it, expect } from 'vitest';
import { resolveLayerGeojson, resolveLayerFeatures } from '../catalogLayerGeometry';

const layerWithJsonOnly = {
  id: 'cat-1',
  name: 'Substations',
  type: 'substation',
  geometryType: 'Point',
  visible: true,
  geojsonJson: JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [101.5, 3.1] }, properties: { name: 'A' } }
    ]
  })
} as never;

describe('catalogLayerGeometry', () => {
  it('parses geojsonJson when the parsed geojson object is absent (post-reload)', () => {
    const geojson = resolveLayerGeojson(layerWithJsonOnly);
    expect(geojson).toBeTruthy();
    expect(geojson?.features.length).toBe(1);
  });

  it('memoizes the parsed result for the same serialized string', () => {
    const first = resolveLayerFeatures(layerWithJsonOnly);
    const second = resolveLayerFeatures(layerWithJsonOnly);
    expect(first).toBe(second);
    expect(first?.features.length).toBe(1);
  });

  it('prefers the in-memory geojson object when present', () => {
    const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature' }] };
    const layer = { id: 'x', geojson, geojsonJson: '{"type":"FeatureCollection","features":[]}' } as never;
    expect(resolveLayerGeojson(layer)).toBe(geojson);
  });

  it('returns undefined when neither geometry source exists', () => {
    expect(resolveLayerGeojson({ id: 'empty' } as never)).toBeUndefined();
  });
});
