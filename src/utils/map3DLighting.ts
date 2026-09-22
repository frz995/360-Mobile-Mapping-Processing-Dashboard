import type { Map as MaplibreMap } from 'maplibre-gl';

export type LightingPreset = 'dawn' | 'day' | 'dusk' | 'night';

export type ColorThemePreset = 'default' | 'faded' | 'mono' | 'ocean' | 'warm' | 'vivid';

export interface LightingConfig {
  name: string;
  description: string;
  icon: 'dawn' | 'day' | 'dusk' | 'night';
  light: {
    anchor: 'map' | 'viewport';
    color: string;
    intensity: number;
    position: [number, number, number]; // [radial coordinate, azimuthal angle, polar angle]
  };
  skyColor?: string;
  fogColor?: string;
  ambientTint?: string;
}

export interface ColorThemeConfig {
  name: string;
  previewDots: [string, string, string];
  /** Palette interpolation stops [height, hexColor] */
  stops: Array<[number, string]>;
  roofHighlight: string;
  baseOpacity: number;
}

export const LIGHTING_PRESETS: Record<LightingPreset, LightingConfig> = {
  dawn: {
    name: 'Dawn',
    description: 'Golden-rose morning sunlight with long atmospheric shadows',
    icon: 'dawn',
    light: {
      anchor: 'viewport',
      color: '#ffe5cc',
      intensity: 0.65,
      position: [1.3, 75, 58] // Low eastern morning sun
    },
    skyColor: '#fdba74',
    fogColor: '#ffedd5',
    ambientTint: 'rgba(251, 146, 60, 0.08)'
  },
  day: {
    name: 'Day',
    description: 'Crisp overhead daylight with clean architectural contrast',
    icon: 'day',
    light: {
      anchor: 'viewport',
      color: '#ffffff',
      intensity: 0.58,
      position: [1.15, 210, 32] // High midday sun
    },
    skyColor: '#bae6fd',
    fogColor: '#f0f9ff',
    ambientTint: 'transparent'
  },
  dusk: {
    name: 'Dusk',
    description: 'Dramatic sunset golden-hour with warm amber facade reflections',
    icon: 'dusk',
    light: {
      anchor: 'viewport',
      color: '#fdba74',
      intensity: 0.75,
      position: [1.4, 255, 68] // Low western horizon sun
    },
    skyColor: '#fb923c',
    fogColor: '#7c2d12',
    ambientTint: 'rgba(234, 88, 12, 0.12)'
  },
  night: {
    name: 'Night',
    description: 'Deep indigo moonlight with high-contrast nocturnal atmosphere',
    icon: 'night',
    light: {
      anchor: 'viewport',
      color: '#93c5fd',
      intensity: 0.28,
      position: [1.1, 180, 24] // Overhead cool moonlight
    },
    skyColor: '#0f172a',
    fogColor: '#020617',
    ambientTint: 'rgba(15, 23, 42, 0.35)'
  }
};

export const COLOR_THEMES: Record<ColorThemePreset, ColorThemeConfig> = {
  default: {
    name: 'Default',
    previewDots: ['#93c5fd', '#3b82f6', '#1e3a8a'],
    stops: [
      [0,   '#c8d6e5'],
      [15,  '#9cb6ce'],
      [35,  '#7498b8'],
      [70,  '#517ba1'],
      [120, '#325e86']
    ],
    roofHighlight: '#dbeafe',
    baseOpacity: 0.78
  },
  faded: {
    name: 'Faded',
    previewDots: ['#cbd5e1', '#94a3b8', '#64748b'],
    stops: [
      [0,   '#f8fafc'],
      [15,  '#e2e8f0'],
      [35,  '#cbd5e1'],
      [70,  '#94a3b8'],
      [120, '#64748b']
    ],
    roofHighlight: '#f1f5f9',
    baseOpacity: 0.70
  },
  mono: {
    name: 'Mono',
    previewDots: ['#f8fafc', '#94a3b8', '#1e293b'],
    stops: [
      [0,   '#ffffff'],
      [15,  '#e2e8f0'],
      [35,  '#94a3b8'],
      [70,  '#475569'],
      [120, '#1e293b']
    ],
    roofHighlight: '#ffffff',
    baseOpacity: 0.85
  },
  ocean: {
    name: 'Ocean',
    previewDots: ['#67e8f9', '#06b6d4', '#0f766e'],
    stops: [
      [0,   '#cffafe'],
      [15,  '#67e8f9'],
      [35,  '#06b6d4'],
      [70,  '#0891b2'],
      [120, '#0e7490']
    ],
    roofHighlight: '#a5f3fc',
    baseOpacity: 0.80
  },
  warm: {
    name: 'Warm',
    previewDots: ['#fde047', '#fb923c', '#b45309'],
    stops: [
      [0,   '#ffedd5'],
      [15,  '#fdba74'],
      [35,  '#fb923c'],
      [70,  '#ea580c'],
      [120, '#9a3412']
    ],
    roofHighlight: '#fed7aa',
    baseOpacity: 0.82
  },
  vivid: {
    name: 'Vivid',
    previewDots: ['#f472b6', '#c084fc', '#38bdf8'],
    stops: [
      [0,   '#f472b6'],
      [15,  '#c084fc'],
      [35,  '#818cf8'],
      [70,  '#38bdf8'],
      [120, '#34d399']
    ],
    roofHighlight: '#fbcfe8',
    baseOpacity: 0.86
  }
};

/**
 * Builds the MapLibre fill-extrusion-color interpolation expression for a theme.
 */
export function buildBuildingColorExpression(themeKey: ColorThemePreset): any[] {
  const theme = COLOR_THEMES[themeKey] || COLOR_THEMES.default;
  const expr: any[] = ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], ['get', 'height'], 0]];
  for (const [stopHeight, color] of theme.stops) {
    expr.push(stopHeight, color);
  }
  return expr;
}

/**
 * Builds the MapLibre fill-extrusion-height expression with optional height scale multiplier.
 */
export function buildBuildingHeightExpression(heightScale = 1.0): any[] {
  if (heightScale === 1.0) {
    return ['coalesce', ['get', 'render_height'], ['get', 'height'], 10];
  }
  return [
    '*',
    ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
    heightScale
  ];
}

export const ATMOSPHERE_TINT_LAYER_ID = 'map3d-atmosphere-tint';
export const ATMOSPHERE_TINT_SOURCE_ID = 'map3d-atmosphere-source';

export interface GroundAtmosphereConfig {
  color: string;
  opacity: number;
}

export const GROUND_ATMOSPHERE_TINTS: Record<LightingPreset, GroundAtmosphereConfig> = {
  dawn: { color: '#fdba74', opacity: 0.14 },
  day: { color: '#ffffff', opacity: 0.0 },
  dusk: { color: '#ea580c', opacity: 0.20 },
  night: { color: '#0a1026', opacity: 0.58 }
};

const WORLD_COVERAGE_GEOJSON: any = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-180, -85.051129],
            [180, -85.051129],
            [180, 85.051129],
            [-180, 85.051129],
            [-180, -85.051129]
          ]
        ]
      }
    }
  ]
};

/**
 * Applies a 3D lighting preset directly to an active MapLibre GL map instance.
 */
export function applyLightingToMap(map: MaplibreMap, presetKey: LightingPreset): void {
  if (!map || typeof map.setLight !== 'function') return;
  const config = LIGHTING_PRESETS[presetKey] || LIGHTING_PRESETS.day;

  try {
    map.setLight(config.light);
  } catch (err) {
    console.warn('[Map3DLighting] Error setting light:', err);
  }

  // Attempt atmospheric sky if supported by the style engine
  if (typeof (map as any).setSky === 'function' && config.skyColor) {
    try {
      (map as any).setSky({
        'sky-color': config.skyColor,
        'atmosphere-blend': presetKey === 'day' ? 0.3 : 0.8
      });
    } catch {
      // Sky is optional, silently fallback
    }
  }
}

/**
 * Finds the ID of the first symbol layer in the style,
 * useful for inserting 3D buildings and tints beneath place labels and POIs.
 */
export function findFirstSymbolLayerId(map: MaplibreMap): string | undefined {
  if (!map || typeof map.getStyle !== 'function') return undefined;
  try {
    const layers = map.getStyle()?.layers || [];
    for (const layer of layers) {
      if (layer.type === 'symbol') {
        return layer.id;
      }
    }
  } catch {
    // fallback
  }
  return undefined;
}

/**
 * Applies an atmospheric ground tint to the 2D basemap (placed below 3D buildings and symbols).
 * Synchronizes flat basemap lighting with Dawn, Day, Dusk, and Night presets.
 */
export function applyAtmosphereTintToMap(
  map: MaplibreMap,
  presetKey: LightingPreset,
  enabled = true,
  beforeId?: string
): void {
  if (!map || typeof map.getStyle !== 'function') return;
  const config = GROUND_ATMOSPHERE_TINTS[presetKey] || GROUND_ATMOSPHERE_TINTS.day;
  const targetOpacity = enabled ? config.opacity : 0;
  const targetColor = config.color;

  try {
    const existingSource = map.getSource(ATMOSPHERE_TINT_SOURCE_ID);
    if (!existingSource) {
      map.addSource(ATMOSPHERE_TINT_SOURCE_ID, {
        type: 'geojson',
        data: WORLD_COVERAGE_GEOJSON
      });
    }

    const existingLayer = map.getLayer(ATMOSPHERE_TINT_LAYER_ID);
    if (!existingLayer) {
      map.addLayer(
        {
          id: ATMOSPHERE_TINT_LAYER_ID,
          type: 'fill',
          source: ATMOSPHERE_TINT_SOURCE_ID,
          paint: {
            'fill-color': targetColor,
            'fill-opacity': targetOpacity,
            'fill-opacity-transition': { duration: 400 },
            'fill-color-transition': { duration: 400 }
          }
        },
        beforeId
      );
    } else {
      map.setPaintProperty(ATMOSPHERE_TINT_LAYER_ID, 'fill-color', targetColor);
      map.setPaintProperty(ATMOSPHERE_TINT_LAYER_ID, 'fill-opacity', targetOpacity);
    }
  } catch (err) {
    console.warn('[Map3DLighting] Failed to update ground atmosphere tint:', err);
  }
}

/**
 * Toggles the visibility of vector map label and POI symbol layers.
 */
export function toggleMapLabelsVisibility(map: MaplibreMap, visible: boolean): void {
  if (!map || typeof map.getStyle !== 'function') return;
  try {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    const visibility = visible ? 'visible' : 'none';
    for (const layer of style.layers) {
      if (layer.type === 'symbol') {
        // Protect user-created data/analysis layers if any (e.g., plan lines, panotrack pins)
        if (!layer.id.startsWith('panotrack-') && !layer.id.startsWith('road-') && !layer.id.startsWith('catalog-')) {
          map.setLayoutProperty(layer.id, 'visibility', visibility);
        }
      }
    }
  } catch (err) {
    console.warn('[Map3DLighting] Failed to toggle label visibility:', err);
  }
}

