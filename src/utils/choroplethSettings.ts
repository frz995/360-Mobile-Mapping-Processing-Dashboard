/**
 * Choropleth class-break settings: the single source of truth for how a metric
 * is split into classes and what colour each class gets.
 *
 * Before this module the map, the legend, the donut and the stacked bar each
 * carried their own copy of the classification:
 *
 *   - `buildMaplibreChoroplethMeshExpression` hard-coded thresholds per metric
 *     in a `switch` statement (density 1.5/3.5/6/9, complexity 20/40/60/80, …).
 *   - `getDensityChoroplethColor` hard-coded the *same* density thresholds a
 *     second time, and only ever for density.
 *   - `ProjectExplorerPanel` had its own `DONUT_PALETTES` / `TAB_PASTEL_COLORS`
 *     constants that ignored the map palette entirely.
 *
 * So editing a class break changed the map but not the charts, and the two
 * never had to agree. Everything now resolves through here: one setting per
 * metric, one classifier, and every consumer reads the resulting class colours.
 */

import {
  ATLAS_PALETTES,
  hexToRgba,
  type ExplorerChoroplethPalette
} from './projectExplorerGeometry';

export type { ExplorerChoroplethPalette };

/** Class-break methods offered by the settings editor. */
export type BreakMethod = 'natural' | 'equal' | 'quantile' | 'manual';

export const BREAK_METHOD_LABELS: Record<BreakMethod, string> = {
  natural: 'Natural breaks (Jenks)',
  equal: 'Equal interval',
  quantile: 'Quantile (equal count)',
  manual: 'Manual'
};

export const BREAK_METHOD_HINTS: Record<BreakMethod, string> = {
  natural: 'Groups similar values together. Best for skewed data.',
  equal: 'Splits the value range into equal-width bands.',
  quantile: 'Each class holds the same number of features.',
  manual: 'Type your own upper bound for each class.'
};

/**
 * A single class: features with `value <= upperBound` fall in this class.
 * `upperBound: null` on the last class means "everything above the previous
 * bound", which also keeps a manual break list honest when values grow.
 */
export interface ChoroplethClass {
  upperBound: number | null;
  color: string;
}

/** Everything needed to render and re-classify one metric. */
export interface ChoroplethSetting {
  metric: string;
  method: BreakMethod;
  classes: ChoroplethClass[];
  alpha: number;
  reverse: boolean;
}

export type ChoroplethSettingsMap = Record<string, ChoroplethSetting>;

/**
 * Default thresholds per metric. These are the values that were previously
 * hard-coded in `buildMaplibreChoroplethMeshExpression`, preserved exactly so
 * the default rendering is unchanged.
 */
export const DEFAULT_METRIC_BREAKS: Record<string, number[]> = {
  // Rural/Sparse, Light Suburban, Moderate Urban, Dense Urban, Core Urban
  density: [1.5, 3.5, 6.0, 9.0],
  // Very Low, Low, Moderate, High, Very High (index 0-100)
  complexity: [20, 40, 60, 80],
  // Trace, Low, Moderate, High, Very High
  panotrack: [15, 45, 90, 180],
  // Short, Medium, Arterial, Primary, Highway/Major (km)
  roads: [5, 15, 30, 50],
  // Minimal, Partial, Half, Substantial, Complete (%)
  coverage: [20, 40, 60, 80]
};

/** Every metric the Project Explorer can colour by, in panel order. */
export const EXPLORER_METRICS = ['roads', 'density', 'complexity', 'panotrack', 'coverage'] as const;

export type ExplorerMetric = (typeof EXPLORER_METRICS)[number];

/**
 * GeoJSON property each metric is read from. This MUST match the property the
 * map expression uses, otherwise the editor would classify numbers the map
 * never sees.
 */
export const METRIC_PROPERTY: Record<string, string> = {
  roads: 'roads',
  density: 'density',
  complexity: 'complexity',
  panotrack: 'panotrack',
  coverage: 'coverage'
};

/** Display unit per metric, reused by the legend and the editor. */
export const METRIC_UNIT: Record<string, string> = {
  roads: 'km length',
  density: 'km/km²',
  complexity: 'index / 100',
  panotrack: 'frames / grid',
  coverage: '% covered'
};

/** A mesh cell property bag, whether it arrives as a cell or as GeoJSON properties. */
export type MeshValueSource =
  | (Record<string, unknown> & { subgrid?: string; properties?: Record<string, unknown> })
  | { subgrid?: string; properties?: Record<string, unknown> };

/**
 * Observed values for a metric, read from mesh cells. Accepts `MeshCellData[]`
 * or GeoJSON features with a `properties` bag; rings of the same subgrid repeat
 * in the GeoJSON form, so values are de-duplicated per subgrid before being fed
 * to a break algorithm — otherwise a cell with three rings counts three times
 * and quantile breaks come out skewed.
 */
export function valuesFromMesh(
  cells: Array<MeshValueSource> | undefined | null,
  metric: string
): number[] {
  const prop = METRIC_PROPERTY[metric] || metric;
  const bySubgrid = new Map<string, number>();
  for (const cell of cells || []) {
    if (!cell) continue;
    const props = (cell.properties || cell) as Record<string, unknown>;
    const raw = props[prop];
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!isFinite(v) || v <= 0) continue;
    const key = typeof props.subgrid === 'string' ? props.subgrid : String(bySubgrid.size);
    if (!bySubgrid.has(key)) bySubgrid.set(key, v);
  }
  return [...bySubgrid.values()];
}

/** Human label for a class, e.g. "≤ 1.5" / "> 9". */
export function classRangeLabel(
  index: number,
  classes: Array<{ upperBound: number | null }>,
  unit = ''
): string {
  const suffix = unit ? ` ${unit}` : '';
  const lower = index === 0 ? null : classes[index - 1]?.upperBound ?? null;
  const upper = classes[index]?.upperBound ?? null;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
  if (lower === null) return upper === null ? `all${suffix}` : `≤ ${fmt(upper)}${suffix}`;
  if (upper === null) return `> ${fmt(lower)}${suffix}`;
  return `${fmt(lower)} – ${fmt(upper)}${suffix}`;
}

/** Sensible fallback when an unknown metric is requested. */
const FALLBACK_BREAKS = [1.5, 3.5, 6.0, 9.0];
const DEFAULT_PALETTE: ExplorerChoroplethPalette = 'greens';

const paletteStops = (palette: ExplorerChoroplethPalette): string[] => {
  const cfg = ATLAS_PALETTES[palette] || ATLAS_PALETTES[DEFAULT_PALETTE];
  return cfg.stops.map(s => s.color);
};

/**
 * Build the default setting for a metric from a template palette.
 * Five classes is fixed by the ramp length and by the existing legend layout.
 */
export function createDefaultSetting(
  metric: string,
  palette: ExplorerChoroplethPalette = DEFAULT_PALETTE
): ChoroplethSetting {
  const colors = paletteStops(palette);
  const bounds = DEFAULT_METRIC_BREAKS[metric] || FALLBACK_BREAKS;
  // N bounds describe N+1 classes; the last class is open-ended.
  const classes: ChoroplethClass[] = bounds.map((upperBound, i) => ({
    upperBound,
    color: colors[i] || colors[colors.length - 1]
  }));
  classes.push({
    upperBound: null,
    color: colors[bounds.length] || colors[colors.length - 1]
  });
  return { metric, method: 'manual', alpha: 0.85, reverse: false, classes };
}

/** Build the settings map for a set of metrics sharing one palette. */
export function createDefaultSettings(
  metrics: readonly string[],
  palette: ExplorerChoroplethPalette = DEFAULT_PALETTE
): ChoroplethSettingsMap {
  const out: ChoroplethSettingsMap = {};
  for (const m of metrics) out[m] = createDefaultSetting(m, palette);
  return out;
}

/** Resolve the setting for a metric, synthesising a default when absent. */
export function resolveSetting(
  settings: ChoroplethSettingsMap | undefined | null,
  metric: string,
  palette: ExplorerChoroplethPalette = DEFAULT_PALETTE
): ChoroplethSetting {
  const found = settings?.[metric];
  if (found && Array.isArray(found.classes) && found.classes.length > 0) return found;
  return createDefaultSetting(metric, palette);
}

/**
 * Normalise anything loaded from Supabase into a valid setting. Guards against
 * a partial JSON blob (missing alpha, non-numeric bounds, wrong class count)
 * so a bad row degrades to defaults instead of producing an invalid style.
 */
export function normalizeSetting(
  raw: unknown,
  metric: string,
  palette: ExplorerChoroplethPalette = DEFAULT_PALETTE
): ChoroplethSetting {
  const fallback = createDefaultSetting(metric, palette);
  if (!raw || typeof raw !== 'object') return fallback;

  const r = raw as Partial<ChoroplethSetting>;
  const method: BreakMethod = (['natural', 'equal', 'quantile', 'manual'] as BreakMethod[])
    .includes(r.method as BreakMethod) ? (r.method as BreakMethod) : fallback.method;

  const alpha = typeof r.alpha === 'number' && r.alpha >= 0 && r.alpha <= 1
    ? r.alpha
    : fallback.alpha;

  const rawClasses = Array.isArray(r.classes) ? r.classes : [];
  const colors = paletteStops(palette);
  const classes: ChoroplethClass[] = rawClasses
    .map((c, i) => {
      const bound = c && typeof c === 'object' ? (c as ChoroplethClass).upperBound : null;
      const color = c && typeof c === 'object' ? (c as ChoroplethClass).color : undefined;
      return {
        upperBound: typeof bound === 'number' && isFinite(bound) ? bound : null,
        color: typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color)
          ? color
          : colors[i] || colors[colors.length - 1]
      };
    });

  if (classes.length < 2) return fallback;

  // Last class is always the open-ended top bin.
  classes[classes.length - 1] = { ...classes[classes.length - 1], upperBound: null };

  return {
    metric,
    method,
    alpha,
    reverse: Boolean(r.reverse),
    classes
  };
}

/** Normalise a whole settings blob from storage. */
export function normalizeSettings(
  raw: unknown,
  metrics: readonly string[],
  palette: ExplorerChoroplethPalette = DEFAULT_PALETTE
): ChoroplethSettingsMap {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: ChoroplethSettingsMap = {};
  for (const m of metrics) out[m] = normalizeSetting(src[m], m, palette);
  return out;
}

// ─────────────────────────── Classification ───────────────────────────

/** Jenks natural breaks via the 1-D k-means style iterative approach. */
export function computeNaturalBreaks(values: number[], classCount: number): number[] {
  const sorted = values.filter(v => isFinite(v)).sort((a, b) => a - b);
  if (classCount < 2 || sorted.length === 0) return [];

  const k = Math.min(classCount, sorted.length);
  // Seed on quantiles — deterministic and usually close to the right answer.
  let centers: number[] = [];
  for (let i = 1; i <= k; i++) {
    centers.push(sorted[Math.floor((i * sorted.length) / (k + 1))] ?? sorted[sorted.length - 1]);
  }

  const maxIter = 100;
  for (let iter = 0; iter < maxIter; iter++) {
    const sums = new Array(k).fill(0);
    const counts = new Array(k).fill(0);

    for (const v of sorted) {
      let best = 0;
      let bestDist = Math.abs(v - centers[0]);
      for (let c = 1; c < k; c++) {
        const d = Math.abs(v - centers[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      sums[best] += v;
      counts[best] += 1;
    }

    let moved = false;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      const next = sums[c] / counts[c];
      if (next !== centers[c]) { centers[c] = next; moved = true; }
    }
    if (!moved) break;
  }

  centers.sort((a, b) => a - b);
  return centers.slice(0, k - 1).map(v => round4(v));
}

/** Equal-interval breaks across the observed range. */
export function computeEqualBreaks(values: number[], classCount: number): number[] {
  const finite = values.filter(v => isFinite(v));
  if (classCount < 2 || finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return new Array(classCount - 1).fill(min);

  const step = (max - min) / classCount;
  const out: number[] = [];
  for (let i = 1; i < classCount; i++) out.push(round4(min + step * i));
  return out;
}

/**
 * Quantile (equal-count) breaks.
 *
 * Quantiles can repeat when many features share a value (very common for
 * coverage %, where most cells are identical). Duplicates are collapsed and the
 * result forced strictly increasing so no class renders empty.
 */
export function computeQuantileBreaks(values: number[], classCount: number): number[] {
  const sorted = values.filter(v => isFinite(v)).sort((a, b) => a - b);
  if (classCount < 2 || sorted.length === 0) return [];
  const k = Math.min(classCount, sorted.length);
  const out: number[] = [];
  for (let i = 1; i < k; i++) {
    const q = round4(sorted[Math.ceil((i * sorted.length) / k) - 1]);
    if (out.length === 0 || q > out[out.length - 1]) out.push(q);
  }
  return out;
}

/**
 * Force bounds to be finite, strictly increasing and free of duplicates.
 * Any algorithm can emit a non-increasing bound when the data is degenerate
 * (a single distinct value, or fewer values than classes); MapLibre `step`
 * requires ascending thresholds, so this must hold before we build a style.
 */
function sanitizeBounds(bounds: number[]): number[] {
  const out: number[] = [];
  for (const b of bounds) {
    if (!isFinite(b)) continue;
    if (out.length === 0 || b > out[out.length - 1]) out.push(b);
  }
  return out;
}

/** Compute the break bounds for a method over an observed value set. */
export function computeBreaks(
  method: BreakMethod,
  values: number[],
  classCount: number,
  currentBounds: number[]
): number[] {
  switch (method) {
    case 'natural': return sanitizeBounds(computeNaturalBreaks(values, classCount));
    case 'equal': return sanitizeBounds(computeEqualBreaks(values, classCount));
    case 'quantile': return sanitizeBounds(computeQuantileBreaks(values, classCount));
    case 'manual':
    default: return currentBounds;
  }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Apply a method to a setting, keeping colours aligned with the new bounds.
 * `manual` is a no-op so the editor's live typing is not overwritten.
 *
 * When there are fewer observed values than classes (a very small buffer, or a
 * metric with one non-zero cell) the extra top classes are dropped rather than
 * left empty, so the legend and the map always show the same number of bins.
 */
export function applyMethod(
  setting: ChoroplethSetting,
  method: BreakMethod,
  values: number[]
): ChoroplethSetting {
  if (method === 'manual' || method === setting.method) return { ...setting, method };

  const bounds = computeBreaks(
    method,
    values,
    setting.classes.length,
    setting.classes.map(c => c.upperBound ?? Infinity)
  );

  if (bounds.length < 1) return { ...setting, method: 'manual' };

  const kept = setting.classes.slice(0, bounds.length + 1);
  return {
    ...setting,
    method,
    classes: kept.map((c, i) => ({
      upperBound: i < bounds.length ? bounds[i] : null,
      color: c.color
    }))
  };
}

/** Re-tint the classes from a template palette, preserving the break bounds. */
export function applyPalette(
  setting: ChoroplethSetting,
  palette: ExplorerChoroplethPalette
): ChoroplethSetting {
  const colors = paletteStops(palette);
  return {
    ...setting,
    classes: setting.classes.map((c, i) => ({
      upperBound: c.upperBound,
      color: colors[i] || colors[colors.length - 1]
    }))
  };
}

export const MIN_CLASSES = 2;
export const MAX_CLASSES = 5;

/**
 * Drop one class from a setting.
 *
 * `classes` is always ascending by `upperBound` and the last entry is the
 * open-ended top bin, so a class can only disappear by widening the class below
 * it: the survivor takes the removed class's upper bound and keeps its own
 * colour. That keeps MapLibre's `step` thresholds valid (still strictly
 * ascending) and keeps the class range labels honest, instead of leaving a hole
 * where the removed break used to be.
 *
 * Colours are re-seeded from the palette so survivors stay distinct and
 * ordered. Without this, removing a middle class left two adjacent swatches
 * sharing a colour and the edit looked like it had done nothing.
 */
export function removeClass(
  setting: ChoroplethSetting,
  index: number,
  palette: ExplorerChoroplethPalette = DEFAULT_PALETTE
): ChoroplethSetting {
  const classes = setting.classes;
  if (classes.length <= MIN_CLASSES) return setting;
  if (index < 0 || index >= classes.length) return setting;

  const survivors = classes.filter((_c, i) => i !== index);
  const kept = survivors.map((c, i) => {
    // The class directly below the removed one widens over its range.
    if (i === index - 1) return { ...c, upperBound: classes[index].upperBound ?? null };
    // Only the final entry stays open-ended; a second unbounded class would
    // never be reached by `classIndexFor` or drawn by the step expression.
    if (i === survivors.length - 1) return { ...c, upperBound: null };
    return c;
  });

  const colors = paletteStops(palette);
  return {
    ...setting,
    classes: kept.map((c, i) => ({
      upperBound: c.upperBound,
      color: colors[i] || colors[colors.length - 1]
    }))
  };
}

/**
 * Flip the ramp direction.
 *
 * `classes` always stays ordered by ascending `upperBound` — MapLibre `step`
 * requires ascending thresholds and the legend/labels depend on that order.
 * Only the *colour order* is flipped: with `reverse` on, the lowest class takes
 * the dark end of the ramp and the highest class the light end.
 */
export function toggleReverse(setting: ChoroplethSetting): ChoroplethSetting {
  return { ...setting, reverse: !setting.reverse };
}

// ─────────────────────────── Rendering ───────────────────────────

/**
 * Colours in ascending-value order, i.e. index i matches `classes[i]`.
 * `reverse` flips this order so high values get the light end of the ramp.
 */
export function classColors(setting: ChoroplethSetting): string[] {
  const colors = setting.classes.map(c => c.color);
  return setting.reverse ? [...colors].reverse() : colors;
}

/** Map a display index (0 = lowest class) to the backing `classes` index. */
export function classIndex(setting: ChoroplethSetting, displayIndex: number): number {
  if (!setting.reverse) return displayIndex;
  return setting.classes.length - 1 - displayIndex;
}

/** The class colours as CSS gradient stops for a legend. */
export function legendGradient(setting: ChoroplethSetting): string {
  const colors = classColors(setting);
  return `linear-gradient(90deg, ${colors.join(', ')})`;
}

/**
 * Index of the class a value falls into, in ascending-value order.
 * Always within [0, classes-1].
 */
export function classIndexFor(setting: ChoroplethSetting, value: number): number {
  if (!isFinite(value)) return 0;
  const classes = setting.classes;
  // Skip non-ascending bounds exactly as buildMeshExpression does, so a value
  // typed out of order is never counted into a class the map does not draw.
  let previous = -Infinity;
  for (let i = 0; i < classes.length; i++) {
    const upper = classes[i].upperBound;
    if (upper === null) return i;
    if (typeof upper !== 'number' || !isFinite(upper) || upper <= previous) continue;
    previous = upper;
    if (value <= upper) return i;
  }
  return classes.length - 1;
}

/** Colour for a single value, matching what the map draws. */
export function colorForValue(setting: ChoroplethSetting, value: number): string {
  const colors = classColors(setting);
  return colors[classIndexFor(setting, value)] || colors[0];
}

/**
 * MapLibre stepped fill expression driven by this setting.
 *
 * Mirrors the previous `buildMaplibreChoroplethMeshExpression`: values <= 0 stay
 * fully transparent so empty grid cells are never painted, then the observed
 * values step through the class colours.
 */
export function buildMeshExpression(setting: ChoroplethSetting, property: string): any[] {
  const colors = classColors(setting).map(c => hexToRgba(c, setting.alpha));

  const step: any[] = ['step', ['coalesce', ['get', property], 0], colors[0]];
  let previous = -Infinity;
  setting.classes.slice(0, -1).forEach((c, i) => {
    const bound = c.upperBound;
    if (typeof bound !== 'number' || !isFinite(bound) || bound <= previous) return;
    if (!colors[i + 1]) return;
    previous = bound;
    step.push(bound, colors[i + 1]);
  });

  return ['case', ['<=', ['coalesce', ['get', property], 0], 0], 'rgba(0, 0, 0, 0)', step];
}

/** MapLibre stepped expression for line geometries (no alpha, full opacity). */
export function buildLineExpression(setting: ChoroplethSetting, property: string): any[] {
  const colors = classColors(setting);

  const step: any[] = ['step', ['coalesce', ['get', property], 0], colors[0]];
  let previous = -Infinity;
  setting.classes.slice(0, -1).forEach((c, i) => {
    const bound = c.upperBound;
    if (typeof bound !== 'number' || !isFinite(bound) || bound <= previous) return;
    if (!colors[i + 1]) return;
    previous = bound;
    step.push(bound, colors[i + 1]);
  });
  return step;
}

/**
 * Count of features per class, for the donut and stacked bar. Values <= 0 are
 * excluded so empty cells do not inflate the "no data" share. Returned in
 * ascending-value order, with the colour that class is actually drawn in.
 */
export function countByClass(
  setting: ChoroplethSetting,
  values: number[]
): Array<{ color: string; count: number; lower: number | null; upper: number | null }> {
  const colors = classColors(setting);
  const classes = setting.classes;
  const counts = new Array(classes.length).fill(0);

  for (const v of values) {
    if (!isFinite(v) || v <= 0) continue;
    counts[classIndexFor(setting, v)]++;
  }

  return classes.map((c, i) => ({
    color: colors[i],
    count: counts[i],
    lower: i === 0 ? null : classes[i - 1].upperBound,
    upper: c.upperBound
  }));
}
