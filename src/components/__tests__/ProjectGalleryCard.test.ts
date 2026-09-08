import { describe, it, expect } from 'vitest';
import { resolveProjectPreview, resolveUserBasemapKey } from '../common/ProjectGalleryCard';
import type { UserProject } from '../../services/projects';

const baseProject: UserProject = {
  id: 'proj-1',
  name: 'Johor Mobile Mapping',
  description: '',
  contractCode: 'MMS-2026-GEO-01',
  clientName: 'Spatial Asset Operations',
  region: 'peninsular_malaysia',
  status: 'active',
  scope: { crs: 'EPSG:4326', region: 'peninsular_malaysia', basemap: 'dark' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-02T00:00:00.000Z'
};

describe('resolveProjectPreview', () => {
  it('uses the committed project boundary geojson, bbox and district names when present', () => {
    const project: UserProject = {
      ...baseProject,
      scope: {
        ...baseProject.scope,
        projectBoundary: {
          districtIds: ['segamat', 'tangkak'],
          districtNames: ['Segamat', 'Tangkak'],
          regionId: 'state:MY01',
          regionName: 'Johor',
          geojson: {
            type: 'FeatureCollection',
            features: [
              { id: 'segamat', type: 'Feature', properties: { name: 'Segamat' }, geometry: { type: 'MultiPolygon', coordinates: [] } },
              { id: 'tangkak', type: 'Feature', properties: { name: 'Tangkak' }, geometry: { type: 'MultiPolygon', coordinates: [] } }
            ]
          },
          bbox: [102.6, 2.4, 102.9, 2.6]
        }
      }
    };

    const preview = resolveProjectPreview(project);
    expect(preview.geojson).toBeTruthy();
    expect(preview.geojson.features.length).toBeGreaterThan(0);
    expect(preview.bbox).toBeTruthy();
    expect(preview.bbox[0]).toBeLessThan(preview.bbox[2]);
    expect(preview.bbox[1]).toBeLessThan(preview.bbox[3]);
    expect(preview.districtNames).toEqual(['Segamat', 'Tangkak']);
    expect(preview.basemapKey).toBe('dark');
  });

  it('falls back to the scope bbox when no project boundary is saved', () => {
    const preview = resolveProjectPreview({
      ...baseProject,
      scope: { ...baseProject.scope, bbox: [99.6, 1.2, 104.6, 6.8] }
    });
    expect(preview.geojson).toBeNull();
    expect(preview.bbox).toEqual([99.6, 1.2, 104.6, 6.8]);
    expect(preview.districtNames).toEqual([]);
  });

  it('derives the light basemap key from a light-mapped scope', () => {
    const preview = resolveProjectPreview({
      ...baseProject,
      scope: { ...baseProject.scope, basemap: 'light' }
    });
    expect(preview.basemapKey).toBe('light');
  });

  it('returns a null basemap key when the scope does not declare basemap/theme (falls back to user setting)', () => {
    const preview = resolveProjectPreview({
      ...baseProject,
      scope: { crs: 'EPSG:4326', region: 'peninsular_malaysia', bbox: [99.6, 1.2, 104.6, 6.8] }
    });
    expect(preview.basemapKey).toBeNull();
  });
});

describe('resolveUserBasemapKey', () => {
  it('follows the user basemap setting (dark and ofm-dark)', () => {
    expect(resolveUserBasemapKey('dark')).toBe('dark');
    expect(resolveUserBasemapKey('ofm-dark')).toBe('dark');
    expect(resolveUserBasemapKey('positron')).toBe('light');
    expect(resolveUserBasemapKey('light')).toBe('light');
  });

  it('returns null when the setting is missing', () => {
    expect(resolveUserBasemapKey(undefined)).toBeNull();
    expect(resolveUserBasemapKey(null)).toBeNull();
  });
});