import { describe, it, expect, vi } from 'vitest';
import {
  LIGHTING_PRESETS,
  COLOR_THEMES,
  buildBuildingColorExpression,
  buildBuildingHeightExpression,
  applyLightingToMap,
  GROUND_ATMOSPHERE_TINTS,
  applyAtmosphereTintToMap,
  findFirstSymbolLayerId,
  toggleMapLabelsVisibility,
  ATMOSPHERE_TINT_LAYER_ID,
  ATMOSPHERE_TINT_SOURCE_ID
} from '../map3DLighting';

describe('map3DLighting utility', () => {
  it('defines all 4 core lighting presets with valid coordinates', () => {
    const presets = ['dawn', 'day', 'dusk', 'night'] as const;
    presets.forEach((p) => {
      const config = LIGHTING_PRESETS[p];
      expect(config).toBeDefined();
      expect(config.light.anchor).toBe('viewport');
      expect(config.light.intensity).toBeGreaterThan(0);
      expect(config.light.position.length).toBe(3);
      expect(config.light.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it('defines ground atmosphere tints with valid colors and opacities', () => {
    const presets = ['dawn', 'day', 'dusk', 'night'] as const;
    presets.forEach((p) => {
      const tint = GROUND_ATMOSPHERE_TINTS[p];
      expect(tint).toBeDefined();
      expect(tint.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(tint.opacity).toBeGreaterThanOrEqual(0);
      expect(tint.opacity).toBeLessThanOrEqual(1);
    });
    expect(GROUND_ATMOSPHERE_TINTS.day.opacity).toBe(0);
    expect(GROUND_ATMOSPHERE_TINTS.night.opacity).toBeGreaterThan(0.4);
  });

  it('defines all 6 color themes with preview dots and stops', () => {
    const themes = ['default', 'faded', 'mono', 'ocean', 'warm', 'vivid'] as const;
    themes.forEach((t) => {
      const config = COLOR_THEMES[t];
      expect(config).toBeDefined();
      expect(config.previewDots.length).toBe(3);
      expect(config.stops.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('builds a valid MapLibre interpolation expression for building colors', () => {
    const expr = buildBuildingColorExpression('warm');
    expect(expr[0]).toBe('interpolate');
    expect(expr[1]).toEqual(['linear']);
    expect(expr[2]).toEqual(['coalesce', ['get', 'render_height'], ['get', 'height'], 0]);
    // Checks that warm terracotta colors are included in the stops
    expect(expr).toContain('#ffedd5');
    expect(expr).toContain('#ea580c');
  });

  it('builds building height expression with scale multiplier', () => {
    const normal = buildBuildingHeightExpression(1.0);
    expect(normal).toEqual(['coalesce', ['get', 'render_height'], ['get', 'height'], 10]);

    const scaled = buildBuildingHeightExpression(1.5);
    expect(scaled).toEqual(['*', ['coalesce', ['get', 'render_height'], ['get', 'height'], 10], 1.5]);
  });

  it('calls map.setLight with the requested preset', () => {
    const mockMap: any = {
      setLight: vi.fn(),
      setSky: vi.fn()
    };

    applyLightingToMap(mockMap, 'dusk');
    expect(mockMap.setLight).toHaveBeenCalledWith(LIGHTING_PRESETS.dusk.light);
    expect(mockMap.setSky).toHaveBeenCalledWith({
      'sky-color': LIGHTING_PRESETS.dusk.skyColor,
      'atmosphere-blend': 0.8
    });
  });

  it('applies ground atmosphere tint layer and updates paint properties', () => {
    const mockMap: any = {
      getStyle: vi.fn().mockReturnValue({ layers: [] }),
      getSource: vi.fn().mockReturnValue(null),
      addSource: vi.fn(),
      getLayer: vi.fn().mockReturnValue(null),
      addLayer: vi.fn(),
      setPaintProperty: vi.fn()
    };

    applyAtmosphereTintToMap(mockMap, 'dusk', true, 'first-symbol-id');
    expect(mockMap.addSource).toHaveBeenCalledWith(ATMOSPHERE_TINT_SOURCE_ID, expect.any(Object));
    expect(mockMap.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ATMOSPHERE_TINT_LAYER_ID,
        type: 'fill'
      }),
      'first-symbol-id'
    );

    // When layer exists, updates paint properties
    mockMap.getLayer.mockReturnValue({ id: ATMOSPHERE_TINT_LAYER_ID });
    applyAtmosphereTintToMap(mockMap, 'night', true);
    expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
      ATMOSPHERE_TINT_LAYER_ID,
      'fill-color',
      GROUND_ATMOSPHERE_TINTS.night.color
    );
    expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
      ATMOSPHERE_TINT_LAYER_ID,
      'fill-opacity',
      GROUND_ATMOSPHERE_TINTS.night.opacity
    );
  });

  it('finds the first symbol layer id in a style', () => {
    const mockMap: any = {
      getStyle: vi.fn().mockReturnValue({
        layers: [
          { id: 'background', type: 'background' },
          { id: 'roads', type: 'line' },
          { id: 'place-city', type: 'symbol' },
          { id: 'poi-marker', type: 'symbol' }
        ]
      })
    };

    expect(findFirstSymbolLayerId(mockMap)).toBe('place-city');
  });

  it('toggles vector basemap symbol layers while preserving analysis layers', () => {
    const mockMap: any = {
      getStyle: vi.fn().mockReturnValue({
        layers: [
          { id: 'place-city', type: 'symbol' },
          { id: 'poi-amenity', type: 'symbol' },
          { id: 'panotrack-points', type: 'symbol' },
          { id: 'road-labels', type: 'symbol' }
        ]
      }),
      setLayoutProperty: vi.fn()
    };

    toggleMapLabelsVisibility(mockMap, false);
    expect(mockMap.setLayoutProperty).toHaveBeenCalledWith('place-city', 'visibility', 'none');
    expect(mockMap.setLayoutProperty).toHaveBeenCalledWith('poi-amenity', 'visibility', 'none');
    // Analysis layers should be untouched
    expect(mockMap.setLayoutProperty).not.toHaveBeenCalledWith('panotrack-points', 'visibility', 'none');
    expect(mockMap.setLayoutProperty).not.toHaveBeenCalledWith('road-labels', 'visibility', 'none');
  });
});
