import type { Map as MaplibreMap } from 'maplibre-gl';
import type { CatalogVectorLayer } from '../../utils/gisImportParser';
import { pickCatalogLabelField } from '../../utils/catalogLayerLabels';

/**
 * Style-spec properties that MapLibre only accepts via setLayoutProperty.
 * Passing one of these to setPaintProperty throws, which aborts the enclosing
 * style update and leaves the layer half-applied — this exact mistake previously
 * broke `text-size` on the catalog label layer.
 */
const LAYOUT_ONLY_PROPS = new Set([
  'text-field', 'text-size', 'text-font', 'text-anchor', 'text-offset',
  'text-max-width', 'text-transform', 'text-letter-spacing', 'text-justify',
  'text-radial-offset', 'text-variable-anchor', 'text-rotation-alignment',
  'text-pitch-alignment', 'symbol-placement', 'symbol-spacing',
  'symbol-sort-key', 'symbol-z-order', 'text-allow-overlap',
  'text-ignore-placement', 'text-optional', 'visibility', 'fill-pattern',
  'line-pattern', 'line-cap', 'line-join', 'line-miter-limit',
  'line-round-limit', 'line-offset', 'circle-sort-key', 'fill-sort-key',
  'icon-image', 'icon-size', 'icon-rotate', 'icon-offset',
  'icon-anchor', 'icon-allow-overlap', 'icon-ignore-placement', 'icon-padding'
]);

/** Updates paint / layout properties of an already-rendered catalog layer in-place. */
export function updateCatalogLayerStyle(
  map: MaplibreMap,
  catLayer: CatalogVectorLayer,
  srcId: string,
  isExplorerActive = false
): void {
  const sp = (id: string, prop: string, val: unknown) => {
    if (LAYOUT_ONLY_PROPS.has(prop)) {
      console.warn(
        `[RoadAnalysisMap] "${prop}" is a LAYOUT property on "${id}" — ` +
        `setPaintProperty would throw and abort the remaining style updates. ` +
        'Use sl() instead.'
      );
      if (map.getLayer(id)) (map as any).setLayoutProperty(id, prop, val);
      return;
    }
    if (map.getLayer(id)) (map as any).setPaintProperty(id, prop, val);
  };
  const sl = (id: string, prop: string, val: unknown) => {
    if (map.getLayer(id)) (map as any).setLayoutProperty(id, prop, val);
  };

  const color   = catLayer.color || '#38bdf8';
  const opacity  = Math.max(0.01, Math.min(1, catLayer.opacity ?? 0.85));
  const width    = catLayer.strokeWidth ?? 3;
  const pRadius  = catLayer.pointRadius ?? 5;

  // Polygon fill
  sp(`${srcId}-fill`, 'fill-color',   catLayer.fillColor || color);
  sp(`${srcId}-fill`, 'fill-opacity',  catLayer.fillOpacity !== undefined ? catLayer.fillOpacity : 0);

  // Visibility is applied in-place so toggling a layer's eye icon never triggers
  // a full overlay rebuild. Explorer suppresses polygon fill + outline so the
  // choropleth mesh displays cleanly; all other layers honour `catLayer.visible`.
  const baseVisible = catLayer.visible !== false;
  const polyVisible = baseVisible && !isExplorerActive;
  sl(`${srcId}-fill`, 'visibility', polyVisible ? 'visible' : 'none');
  sl(`${srcId}-poly-line`, 'visibility', polyVisible ? 'visible' : 'none');
  sl(`${srcId}-line`, 'visibility', baseVisible ? 'visible' : 'none');
  sl(`${srcId}-circle`, 'visibility', baseVisible ? 'visible' : 'none');
  sl(`${srcId}-labels`, 'visibility', baseVisible ? 'visible' : 'none');
  // The 3D substation layers are added separately; they must honour the same
  // eye-toggle or a turned-on model stays visible after its layer is hidden.
  sl(`${srcId}-substation-extrusion`, 'visibility', baseVisible ? 'visible' : 'none');
  sl(`${srcId}-substation-badge-symbol`, 'visibility', baseVisible ? 'visible' : 'none');

  // Polygon + standalone line
  for (const lid of [`${srcId}-poly-line`, `${srcId}-line`]) {
    sp(lid, 'line-color',   color);
    sp(lid, 'line-opacity', opacity);
    sp(lid, 'line-width',   width);
  }

  // Circle / point
  sp(`${srcId}-circle`, 'circle-color',        color);
  sp(`${srcId}-circle`, 'circle-opacity',       opacity);
  sp(`${srcId}-circle`, 'circle-radius',        pRadius);
  sp(`${srcId}-circle`, 'circle-stroke-color',  catLayer.pointStrokeColor  || '#ffffff');
  sp(`${srcId}-circle`, 'circle-stroke-width',  catLayer.pointStrokeWidth  ?? 1.5);

  // Labels
  // `text-size` is a LAYOUT property in the MapLibre style spec. Calling it via
  // setPaintProperty throws "text-size is a LAYOUT property, but it is being
  // set as a PAINT property", which aborts the rest of this function and leaves
  // the layer half-styled. Must go through sl().
  sp(`${srcId}-labels`, 'text-color',       catLayer.labelColor     || '#f8fafc');
  sp(`${srcId}-labels`, 'text-halo-color',  catLayer.labelHaloColor || '#090d16');
  sp(`${srcId}-labels`, 'text-halo-width',  catLayer.labelHaloWidth ?? 2);
  sl(`${srcId}-labels`, 'text-size',        catLayer.labelSize      || 11);
  const lf = pickCatalogLabelField(catLayer);
  if (lf) sl(`${srcId}-labels`, 'text-field', ['to-string', ['get', lf]]);
}
