import { describe, it, expect } from 'vitest';
import { getCatalogSamplePropKeys, pickCatalogLabelField } from '../catalogLayerLabels';
import type { CatalogVectorLayer } from '../gisImportParser';

function makeLayer(over: Partial<CatalogVectorLayer> & { id: string }): CatalogVectorLayer {
  return {
    name: 'test',
    format: 'GEOJSON',
        geojson: undefined,
    color: '#38bdf8',
    opacity: 0.85,
    strokeWidth: 3,
    visible: true,
    featureCount: 2,
    geometryType: 'Polygon',
    bbox: null,
    uploadedAt: '',
    hasRoadLines: false,
    ...over
  } as CatalogVectorLayer;
}

const gridJson =
  '{"type":"FeatureCollection","features":[' +
  '{"type":"Feature","properties":{"ID":2030,"GRID":"4","NAME":"N102E73","STATE":"JOHOR"},"geometry":{"type":"Polygon","coordinates":[[[102,2],[103,2],[103,3],[102,2]]]}},' +
  '{"type":"Feature","properties":{"ID":2031,"GRID":"4","NAME":"N102E74","STATE":"JOHOR"},"geometry":{"type":"Polygon","coordinates":[[[103,2],[104,2],[104,3],[103,2]]]}}' +
  ']}';

describe('getCatalogSamplePropKeys', () => {
  it('reads keys from the parsed geojson object', () => {
    const layer = makeLayer({
      id: 'l-parsed',
      geojson: JSON.parse(gridJson)
    });
    expect(getCatalogSamplePropKeys(layer)).toEqual(['ID', 'GRID', 'NAME', 'STATE']);
  });

  it('head-scans keys from the serialized geojsonJson (rehydrated heavy layer)', () => {
    const layer = makeLayer({ id: 'l-serialized', geojsonJson: gridJson });
    expect(getCatalogSamplePropKeys(layer)).toEqual(['ID', 'GRID', 'NAME', 'STATE']);
  });

  it('skips features whose properties are null', () => {
    const json =
      '{"type":"FeatureCollection","features":[' +
      '{"type":"Feature","properties":null,"geometry":{"type":"Point","coordinates":[1,2]}},' +
      '{"type":"Feature","properties":{"ROAD_NAME":"Jln Muar"},"geometry":{"type":"Point","coordinates":[3,4]}}' +
      ']}';
    const layer = makeLayer({ id: 'l-nullprops', geojsonJson: json });
    expect(getCatalogSamplePropKeys(layer)).toEqual(['ROAD_NAME']);
  });

  it('returns empty and stays cached-safe when no properties exist at all', () => {
    const layer = makeLayer({ id: 'l-noprops', geojsonJson: '{"type":"FeatureCollection","features":[]}' });
    expect(getCatalogSamplePropKeys(layer)).toEqual([]);
    expect(getCatalogSamplePropKeys(layer)).toEqual([]);
  });
});

describe('pickCatalogLabelField', () => {
  it('prefers NAME over ID even when ID comes first in feature order', () => {
    const layer = makeLayer({ id: 'p-name', geojsonJson: gridJson, showLabels: true });
    expect(pickCatalogLabelField(layer)).toBe('NAME');
  });

  it('honors an explicit labelField override', () => {
    const layer = makeLayer({ id: 'p-explicit', geojsonJson: gridJson, labelField: 'GRID' });
    expect(pickCatalogLabelField(layer)).toBe('GRID');
  });

  it('uses road-street names for linear layers, falling back to legacy keyword scan', () => {
    const layer = makeLayer({
      id: 'p-road',
      geojsonJson: JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { OBJECTID: 1, FCLASS: 'residential', ROAD_NAME: 'Jln Bukit' }, geometry: { type: 'LineString', coordinates: [] } }
        ]
      })
    });
    expect(pickCatalogLabelField(layer)).toBe('ROAD_NAME');
  });

  it('falls back to the first key when nothing matches', () => {
    const layer = makeLayer({
      id: 'p-fallback',
      geojsonJson: JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { ZZZ_WEIRD: 1 }, geometry: { type: 'Point', coordinates: [1, 2] } }]
      })
    });
    expect(pickCatalogLabelField(layer)).toBe('ZZZ_WEIRD');
  });
});
