/**
 * MapLibre GL Vector Layer & Style Load Helpers
 * Solves silent tile load drops and z-index ordering issues when rendering 50,000+ panorama points and trajectories.
 */

export interface AddVectorSourceOptions {
  sourceId: string;
  geojson: any;
  lineColor?: string;
  lineWidth?: number;
  circleColor?: string;
  circleRadius?: number;
  beforeLayerId?: string;
}

/**
 * Safely adds vector sources and layers to a MapLibre GL map instance.
 * Guarantees that actions execute strictly AFTER the map style has finished loading (`style.load`).
 * Automatically splits GeoJSON into separate line ('LineString') and circle ('Point') layers with proper z-indexing.
 */
export function addVectorSourceWithGuards(
  map: any,
  options: AddVectorSourceOptions
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!map) {
      resolve(false);
      return;
    }

    const applyLayers = () => {
      try {
        const {
          sourceId,
          geojson,
          lineColor = '#38bdf8',
          lineWidth = 4,
          circleColor = '#f43f5e',
          circleRadius = 5,
          beforeLayerId
        } = options;

        // 1. Remove existing source/layers if present
        if (map.getLayer(`${sourceId}-line`)) map.removeLayer(`${sourceId}-line`);
        if (map.getLayer(`${sourceId}-circle`)) map.removeLayer(`${sourceId}-circle`);
        if (map.getSource(sourceId)) map.removeSource(sourceId);

        // 2. Add GeoJSON source
        map.addSource(sourceId, {
          type: 'geojson',
          data: geojson
        });

        // 3. Add Line layer (renders trajectory routes underneath point markers)
        map.addLayer({
          id: `${sourceId}-line`,
          type: 'line',
          source: sourceId,
          filter: ['==', '$type', 'LineString'],
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': lineColor,
            'line-width': lineWidth,
            'line-opacity': 0.85
          }
        }, beforeLayerId);

        // 4. Add Circle layer (renders point markers above trajectory lines)
        map.addLayer({
          id: `${sourceId}-circle`,
          type: 'circle',
          source: sourceId,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': circleRadius,
            'circle-color': circleColor,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff'
          }
        });

        resolve(true);
      } catch (err) {
        console.warn(`MapLibre GL addVectorSourceWithGuards warning for ${options.sourceId}:`, err);
        resolve(false);
      }
    };

    // Style load guard: ensure map style is completely loaded
    if (map.isStyleLoaded && map.isStyleLoaded()) {
      applyLayers();
    } else {
      map.once('style.load', () => {
        applyLayers();
      });
    }
  });
}
