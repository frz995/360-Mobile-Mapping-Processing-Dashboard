import type { Map as MaplibreMap } from 'maplibre-gl';
import type { Substation3DConfig } from '../../utils/substationTypes';
import {
  generateSubstationFootprints,
  generateSubstationBadgePoints
} from '../../utils/substationFootprint';

/**
 * Adds the 3D substation fill-extrusion (and its optional overhead voltage badge)
 * for a single catalog layer.
 *
 * Extracted from RoadAnalysisMap so that god file stays within its size budget,
 * and so the geometry-resolution fix (geojson OR rehydrated geojsonJson) lives in
 * one place. The caller resolves `geojson` before calling — never pass a layer
 * whose geometry only exists as a serialized string.
 *
 * @returns the layer ids that should receive feature-click popups.
 */
export function addSubstationLayers(
  map: MaplibreMap,
  srcId: string,
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | null | undefined,
  config: Substation3DConfig,
  visible: boolean,
  fallbackColor: string,
  dynamicSources: string[],
  dynamicLayers: string[]
): string[] {
  const clickable: string[] = [];

  const subExtSrcId = `${srcId}-substation-ext-src`;
  const subExtLayerId = `${srcId}-substation-extrusion`;

  map.addSource(subExtSrcId, {
    type: 'geojson',
    data: generateSubstationFootprints(geojson, config)
  });
  dynamicSources.push(subExtSrcId);

  map.addLayer({
    id: subExtLayerId,
    type: 'fill-extrusion',
    source: subExtSrcId,
    layout: {
      visibility: visible ? 'visible' : 'none'
    },
    paint: {
      'fill-extrusion-color': config.wallColor || fallbackColor || '#2563eb',
      'fill-extrusion-height': config.height || 4.5,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.95
    }
  });
  dynamicLayers.push(subExtLayerId);
  clickable.push(subExtLayerId);

  if (config.showVoltageBadge !== false) {
    const badgeSrcId = `${srcId}-substation-badge-src`;
    const badgeLayerId = `${srcId}-substation-badge-symbol`;

    map.addSource(badgeSrcId, {
      type: 'geojson',
      data: generateSubstationBadgePoints(geojson, config)
    });
    dynamicSources.push(badgeSrcId);

    map.addLayer({
      id: badgeLayerId,
      type: 'symbol',
      source: badgeSrcId,
      layout: {
        visibility: visible ? 'visible' : 'none',
        'text-field': ['to-string', ['get', 'display_label']],
        'text-size': 10.5,
        'text-font': ['Noto Sans Bold'],
        'text-offset': [0, -1.2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
        'text-ignore-placement': false
      },
      paint: {
        'text-color': '#fef08a',
        'text-halo-color': '#090d16',
        'text-halo-width': 2.5
      }
    });
    dynamicLayers.push(badgeLayerId);
  }

  return clickable;
}

/** The HTML banner shown at the top of a substation feature popup. */
export function buildSubstationPopupBadge(props: Record<string, unknown>): string {
  if (!props.substation_type) return '';
  return `<div style="display: flex; align-items: center; justify-content: space-between; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 4px; padding: 4px 6px; margin-bottom: 6px;">
                 <span style="font-weight: 700; color: #fef08a; font-size: 11px;">⚡ ${props.substation_type} (${props.substation_voltage || '11kV'})</span>
                 <span style="font-size: 9px; color: #fde047; font-family: monospace;">H: ${props.substation_height || 4.5}m</span>
               </div>`;
}
