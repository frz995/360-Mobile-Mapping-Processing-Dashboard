import type { CatalogVectorLayer } from './gisImportParser';

/**
 * Catalog feature-label helpers shared by the map renderer and the catalog
 * panel so both sides always agree on which property becomes the map label.
 */

// ── Sample property keys ─────────────────────────────────────────────────────
// Layers rehydrated from IndexedDB/cloud carry only the serialized
// `geojsonJson` (the parsed graph is dropped for heavy imports), so scanning
// `layer.geojson` alone misses them entirely — which used to silently skip the
// map label layer. Head-scan the first feature's `properties` object out of
// the raw string instead of JSON.parsing tens of megabytes, and memoize the
// result per layer id (properties never change for a given import).

const sampleKeysCache = new Map<string, string[]>();

/** Property keys of the layer's first feature (works for `geojsonJson`-only layers). */
export function getCatalogSamplePropKeys(layer: CatalogVectorLayer): string[] {
  const direct = (layer.geojson?.features?.[0] as { properties?: unknown } | undefined)?.properties;
  if (direct && typeof direct === 'object') return Object.keys(direct as object);
  const json = layer.geojsonJson;
  if (!json) return [];
  const cached = sampleKeysCache.get(layer.id);
  if (cached) return cached;
  const keys = scanFirstProperties(json);
  sampleKeysCache.set(layer.id, keys);
  return keys;
}

function scanFirstProperties(json: string): string[] {
  let from = 0;
  for (;;) {
    const propIdx = json.indexOf('"properties"', from);
    if (propIdx === -1) return [];
    let i = propIdx + '"properties"'.length;
    while (i < json.length && (json[i] === ' ' || json[i] === ':' || json[i] === '\n' || json[i] === '\r' || json[i] === '\t')) i++;
    if (json[i] === '{') {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let j = i; j < json.length; j++) {
        const ch = json[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(json.slice(i, j + 1));
              return obj && typeof obj === 'object' ? Object.keys(obj) : [];
            } catch {
              return [];
            }
          }
        }
      }
      return [];
    }
    // "properties": null (or any non-object value) — try the next feature.
    from = propIdx + '"properties"'.length;
  }
}

// ── Label field default ──────────────────────────────────────────────────────
// Priority list, most human-readable first. The old single-regex scan returned
// the first matching key in *feature property order*, so a grid layer whose
// columns start with ID labeled every cell with its row number ("2030")
// instead of its name ("N102E73").

const LABEL_FIELD_PRIORITY: RegExp[] = [
  /^name$/i,
  /^(street|road|route|highway)(_?name)?$/i,
  /^label$/i,
  /^title$/i,
  /^subgrid(_?id|_?name)?$/i,
  /^grid(_?id|_?name)?$/i,
  /^(fclass|feature_?type|type)$/i,
  /^station$/i,
  /^district$/i,
  /^code$/i,
  /^id$/i
];

/**
 * Resolves the property used for map labels: an explicit `layer.labelField`
 * wins, otherwise the first key matching the human-readable priority list,
 * otherwise the legacy keyword scan, otherwise the first property.
 */
export function pickCatalogLabelField(layer: CatalogVectorLayer, propKeys?: string[]): string | undefined {
  if (layer.labelField) return layer.labelField;
  const keys = propKeys || getCatalogSamplePropKeys(layer);
  for (const re of LABEL_FIELD_PRIORITY) {
    const hit = keys.find((k) => re.test(k));
    if (hit) return hit;
  }
  return keys.find((k) => /^(name|label|id|title|station|grid|district|code|road)/i.test(k)) || keys[0];
}
