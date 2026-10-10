import { describe, it, expect } from 'vitest';
import {
  generateSubstationFootprints,
  generateSubstationBadgePoints
} from '../substationFootprint';
import { SUBSTATION_3D_PRESETS } from '../substationTypes';

const pointGeojson: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'pe-1',
      geometry: { type: 'Point', coordinates: [101.6869, 3.139] },
      properties: { name: 'PE BUKIT BINTANG', voltage: '11kV' }
    }
  ]
};

const polyGeojson: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'ppu-compound',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [101.5, 3.0],
            [101.51, 3.0],
            [101.51, 3.01],
            [101.5, 3.01],
            [101.5, 3.0]
          ]
        ]
      },
      properties: { name: 'PPU SHAH ALAM' }
    }
  ]
};

const multiPointGeojson: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'pe-multi',
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [101.6869, 3.139],
          [101.7, 3.15]
        ]
      },
      properties: { name: 'PE MULTI' }
    }
  ]
};

const collectionGeojson: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'gc-1',
      geometry: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [101.0, 3.0] },
          {
            type: 'Polygon',
            coordinates: [
              [
                [101.1, 3.0],
                [101.11, 3.0],
                [101.11, 3.01],
                [101.1, 3.01],
                [101.1, 3.0]
              ]
            ]
          }
        ]
      },
      properties: { name: 'GC COMPOUND' }
    }
  ]
};

describe('substationFootprint', () => {
  it('converts point features into rectangular polygon footprints in meters', () => {
    const config = { enabled: true, ...SUBSTATION_3D_PRESETS.PE };
    const result = generateSubstationFootprints(pointGeojson, config);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features.length).toBe(1);

    const feat = result.features[0];
    const props = feat.properties as Record<string, unknown>;
    const geom = feat.geometry as GeoJSON.Polygon;

    expect(props.substation_type).toBe('PE');
    expect(props.substation_voltage).toBe('11kV');
    expect(props.substation_height).toBe(4.5);
    expect(String(props.display_label)).toContain('PE BUKIT BINTANG');

    const ring = geom.coordinates[0];
    expect(ring.length).toBe(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(ring[0][0]).toBeLessThan(101.6869);
    expect(ring[2][0]).toBeGreaterThan(101.6869);
    expect(ring[0][1]).toBeLessThan(3.139);
    expect(ring[2][1]).toBeGreaterThan(3.139);
  });

  it('preserves existing polygons and annotates them with substation properties', () => {
    const config = { enabled: true, ...SUBSTATION_3D_PRESETS.PPU };
    const result = generateSubstationFootprints(polyGeojson, config);

    expect(result.features.length).toBe(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
    const props = result.features[0].properties as Record<string, unknown>;
    expect(props.substation_type).toBe('PPU');
    expect(props.substation_height).toBe(10);
  });

  it('generates rooftop badge points floating at station centroid', () => {
    const config = { enabled: true, ...SUBSTATION_3D_PRESETS.SSU };
    const badges = generateSubstationBadgePoints(pointGeojson, config);

    expect(badges.features.length).toBe(1);
    const geom = badges.features[0].geometry as GeoJSON.Point;
    expect(geom.type).toBe('Point');
    expect(geom.coordinates).toEqual([101.6869, 3.139]);
    const props = badges.features[0].properties as Record<string, unknown>;
    expect(String(props.display_label)).toContain('PE BUKIT BINTANG');
  });

  it('gracefully handles empty or null geojson', () => {
    const config = { enabled: true, ...SUBSTATION_3D_PRESETS.PE };
    expect(generateSubstationFootprints(null, config).features).toEqual([]);
    expect(generateSubstationBadgePoints(undefined, config).features).toEqual([]);
  });

  it('expands MultiPoint into one footprint and one badge per point', () => {
    const config = { enabled: true, ...SUBSTATION_3D_PRESETS.PE };
    const footprints = generateSubstationFootprints(multiPointGeojson, config);
    expect(footprints.features.length).toBe(2);
    expect(footprints.features.every((f) => f.geometry.type === 'Polygon')).toBe(true);

    const badges = generateSubstationBadgePoints(multiPointGeojson, config);
    expect(badges.features.length).toBe(2);
    expect((badges.features[0].geometry as GeoJSON.Point).coordinates).toEqual([101.6869, 3.139]);
    expect((badges.features[1].geometry as GeoJSON.Point).coordinates).toEqual([101.7, 3.15]);
  });

  it('recurses into GeometryCollection members', () => {
    const config = { enabled: true, ...SUBSTATION_3D_PRESETS.SSU };
    const gcFootprints = generateSubstationFootprints(collectionGeojson, config);
    expect(gcFootprints.features.length).toBe(2);
    expect(gcFootprints.features[0].geometry.type).toBe('Polygon');
    expect(gcFootprints.features[1].geometry.type).toBe('Polygon');

    const gcBadges = generateSubstationBadgePoints(collectionGeojson, config);
    expect(gcBadges.features.length).toBe(2);
    expect((gcBadges.features[0].geometry as GeoJSON.Point).coordinates).toEqual([101.0, 3.0]);
  });
});
