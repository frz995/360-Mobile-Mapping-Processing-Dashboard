import type { CatalogVectorLayer } from './gisImportParser';

/**
 * Parsed `geojsonJson` documents keyed by the exact serialized string, so
 * re-renders don't re-parse a multi-megabyte layer on every pass.
 */
const parsedFeatureCache = new Map<
  string,
  { geojson: GeoJSON.FeatureCollection; features: GeoJSON.Feature[] }
>();

/**
 * Resolves a catalog layer's geometry into features, regardless of how the layer
 * was transported.
 *
 * Layers carry geometry either as an in-memory `geojson` object or — after a
 * large import, a reload, or a cloud restore — only as the serialized
 * `geojsonJson` string. Consumers that read `layer.geojson` directly silently
 * degrade to "no geometry" in the second case (this is how the 3D substation
 * model disappeared after a refresh), so they must go through this resolver.
 */
export function resolveLayerFeatures(
  layer: CatalogVectorLayer
): { geojson: GeoJSON.FeatureCollection; features: GeoJSON.Feature[] } | null {
  const inMemory = layer.geojson as GeoJSON.FeatureCollection | undefined;
  if (inMemory?.features) return { geojson: inMemory, features: inMemory.features };
  if (!layer.geojsonJson) return null;
  const cached = parsedFeatureCache.get(layer.geojsonJson);
  if (cached) return cached;
  const parsed = JSON.parse(layer.geojsonJson) as GeoJSON.FeatureCollection;
  const result = { geojson: parsed, features: parsed.features || [] };
  parsedFeatureCache.set(layer.geojsonJson, result);
  return result;
}

/** Resolves just the GeoJSON document a consumer can hand to MapLibre/derivations. */
export function resolveLayerGeojson(layer: CatalogVectorLayer): GeoJSON.FeatureCollection | undefined {
  return resolveLayerFeatures(layer)?.geojson;
}
