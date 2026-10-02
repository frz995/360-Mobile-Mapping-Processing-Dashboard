import { describe, it, expect } from 'vitest';
import {
  DEFAULT_METRIC_BREAKS,
  EXPLORER_METRICS,
  applyMethod,
  applyPalette,
  buildMeshExpression,
  classColors,
  classIndex,
  classIndexFor,
  classRangeLabel,
  colorForValue,
  computeBreaks,
  computeEqualBreaks,
  computeNaturalBreaks,
  computeQuantileBreaks,
  countByClass,
  createDefaultSetting,
  createDefaultSettings,
  legendGradient,
  normalizeSetting,
  normalizeSettings,
  resolveSetting,
  toggleReverse,
  valuesFromMesh
} from '../choroplethSettings';

describe('choroplethSettings defaults', () => {
  it('preserves the previously hard-coded density thresholds', () => {
    const s = createDefaultSetting('density', 'greens');
    expect(s.classes.map(c => c.upperBound)).toEqual([1.5, 3.5, 6.0, 9.0, null]);
    expect(s.classes).toHaveLength(5);
    expect(s.method).toBe('manual');
  });

  it('exposes a default setting for every explorer metric', () => {
    for (const m of EXPLORER_METRICS) {
      expect(DEFAULT_METRIC_BREAKS[m]).toBeDefined();
      const s = createDefaultSetting(m);
      expect(s.classes).toHaveLength(DEFAULT_METRIC_BREAKS[m].length + 1);
    }
  });

  it('falls back to generic breaks for an unknown metric', () => {
    expect(createDefaultSetting('mystery').classes.map(c => c.upperBound))
      .toEqual([1.5, 3.5, 6.0, 9.0, null]);
  });

  it('re-synthesises a default when the stored blob is missing a metric', () => {
    const settings = createDefaultSettings(EXPLORER_METRICS, 'greens');
    const partial = { density: settings.density };
    const resolved = resolveSetting(normalizeSettings(partial, EXPLORER_METRICS), 'coverage');
    expect(resolved.classes).toHaveLength(5);
  });
});

describe('normalizeSetting', () => {
  it('keeps valid stored values intact', () => {
    const raw = {
      method: 'quantile',
      alpha: 0.6,
      reverse: true,
      classes: [
        { upperBound: 2, color: '#111111' },
        { upperBound: 4, color: '#222222' },
        { upperBound: null, color: '#333333' }
      ]
    };
    const s = normalizeSetting(raw, 'density');
    expect(s.method).toBe('quantile');
    expect(s.alpha).toBe(0.6);
    expect(s.reverse).toBe(true);
    expect(s.classes.map(c => c.color)).toEqual(['#111111', '#222222', '#333333']);
  });

  it('falls back to defaults for junk input', () => {
    expect(normalizeSetting(null, 'density').classes).toHaveLength(5);
    expect(normalizeSetting('nope', 'density').classes).toHaveLength(5);
    expect(normalizeSetting({ classes: [] }, 'density').classes).toHaveLength(5);
    expect(normalizeSetting({ classes: [{ upperBound: 1 }] }, 'density').classes).toHaveLength(5);
  });

  it('rejects an out-of-range alpha and an unknown method', () => {
    const s = normalizeSetting(
      { alpha: 7, method: 'wat', classes: [{ upperBound: 1, color: '#abc' }, { upperBound: null, color: '#def' }] },
      'density'
    );
    expect(s.alpha).toBe(0.85);
    expect(s.method).toBe('manual');
  });

  it('replaces a malformed colour with the palette stop', () => {
    const s = normalizeSetting(
      { classes: [{ upperBound: 1, color: 'not-a-colour' }, { upperBound: null, color: '#000000' }] },
      'density'
    );
    expect(s.classes[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('always leaves the top class open-ended', () => {
    const s = normalizeSetting(
      { classes: [{ upperBound: 1, color: '#111111' }, { upperBound: 999, color: '#222222' }] },
      'density'
    );
    expect(s.classes[s.classes.length - 1].upperBound).toBeNull();
  });
});

describe('break algorithms', () => {
  it('equal interval splits the observed range', () => {
    expect(computeEqualBreaks([0, 10], 5)).toEqual([2, 4, 6, 8]);
  });

  it('equal interval collapses to a single bound when min === max', () => {
    const out = computeEqualBreaks([7, 7, 7], 5);
    expect(out.every(b => b === 7)).toBe(true);
  });

  it('quantile yields strictly increasing bounds', () => {
    const bounds = computeQuantileBreaks([1, 1, 1, 1, 1, 1, 9, 9], 5);
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i]).toBeGreaterThan(bounds[i - 1]);
    }
  });

  it('natural breaks cluster values and stay in range', () => {
    const values = [1, 1.2, 1.1, 40, 42, 41, 41.5];
    const bounds = computeNaturalBreaks(values, 3);
    expect(bounds.length).toBeLessThanOrEqual(2);
    for (const b of bounds) {
      expect(b).toBeGreaterThanOrEqual(Math.min(...values));
      expect(b).toBeLessThanOrEqual(Math.max(...values));
    }
  });

  it('never emits a non-increasing bound for degenerate data', () => {
    for (const method of ['natural', 'equal', 'quantile'] as const) {
      const bounds = computeBreaks(method, [5, 5, 5, 5], 5, []);
      for (let i = 1; i < bounds.length; i++) {
        expect(bounds[i]).toBeGreaterThan(bounds[i - 1]);
      }
    }
  });

  it('manual leaves the current bounds untouched', () => {
    expect(computeBreaks('manual', [1, 2, 3], 5, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('keeps the class count consistent when applying a method', () => {
    const base = createDefaultSetting('density');
    const q = applyMethod(base, 'quantile', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(q.method).toBe('quantile');
    expect(q.classes).toHaveLength(q.classes.length);
    expect(q.classes[q.classes.length - 1].upperBound).toBeNull();
  });

  it('shrinks the class list when there is less data than classes', () => {
    const base = createDefaultSetting('density');
    const q = applyMethod(base, 'quantile', [3, 9]);
    expect(q.classes.length).toBeLessThanOrEqual(base.classes.length);
    expect(q.classes[q.classes.length - 1].upperBound).toBeNull();
  });
});

describe('palette and reverse', () => {
  it('re-tints from a palette while preserving bounds', () => {
    const base = createDefaultSetting('density', 'greens');
    const purple = applyPalette(base, 'purples');
    expect(purple.classes.map(c => c.upperBound)).toEqual(base.classes.map(c => c.upperBound));
    expect(purple.classes.map(c => c.color)).not.toEqual(base.classes.map(c => c.color));
  });

  it('reverse flips only the colour order, leaving bounds ascending', () => {
    const base = createDefaultSetting('density');
    const rev = toggleReverse(base);
    expect(rev.reverse).toBe(true);
    // The backing class list is untouched...
    expect(rev.classes.map(c => c.upperBound)).toEqual(base.classes.map(c => c.upperBound));
    expect(rev.classes.map(c => c.color)).toEqual(base.classes.map(c => c.color));
    // ...but the rendered colours are mirrored.
    expect(classColors(rev)).toEqual([...classColors(base)].reverse());
    expect(toggleReverse(rev).reverse).toBe(false);
  });

  it('maps a display index through reverse to the backing class index', () => {
    const base = createDefaultSetting('density');
    expect(classIndex(base, 0)).toBe(0);
    expect(classIndex(toggleReverse(base), 0)).toBe(4);
    expect(classIndex(toggleReverse(base), 4)).toBe(0);
  });
});

describe('classification', () => {
  const s = createDefaultSetting('density', 'greens');

  it('assigns values to ascending classes', () => {
    expect(classIndexFor(s, 1)).toBe(0);
    expect(classIndexFor(s, 1.5)).toBe(0);
    expect(classIndexFor(s, 2)).toBe(1);
    expect(classIndexFor(s, 9)).toBe(3);
    expect(classIndexFor(s, 9.01)).toBe(4);
    expect(classIndexFor(s, 999)).toBe(4);
  });

  it('maps NaN and zero to the first class instead of throwing', () => {
    expect(classIndexFor(s, NaN)).toBe(0);
    expect(classIndexFor(s, 0)).toBe(0);
  });

  it('colour lookup matches the class colours', () => {
    const colors = classColors(s);
    expect(colorForValue(s, 0.5)).toBe(colors[0]);
    expect(colorForValue(s, 20)).toBe(colors[4]);
  });

  it('counts values per class and skips empty cells', () => {
    const counts = countByClass(s, [0.5, 2, 4, 7, 20, 0, NaN]);
    expect(counts.map(c => c.count)).toEqual([1, 1, 1, 1, 1]);
    expect(counts[0].lower).toBeNull();
    expect(counts[4].upper).toBeNull();
  });

  it('reports counts in value order but reversed colours', () => {
    const rev = toggleReverse(s);
    const counts = countByClass(rev, [0.5, 20]);
    expect(counts.map(c => c.count)).toEqual([1, 0, 0, 0, 1]);
    // counts[i].color is the colour actually used for class i
    expect(counts.map(c => c.color)).toEqual(classColors(rev));
  });

  it('builds a legend gradient from the class colours', () => {
    const colors = classColors(s);
    expect(legendGradient(s)).toBe(`linear-gradient(90deg, ${colors.join(', ')})`);
  });

  it('labels class ranges readably', () => {
    expect(classRangeLabel(0, s.classes)).toBe('≤ 1.5');
    expect(classRangeLabel(1, s.classes)).toBe('1.5 – 3.5');
    expect(classRangeLabel(4, s.classes)).toBe('> 9');
  });
});

describe('valuesFromMesh', () => {
  it('de-duplicates repeated rings of the same subgrid', () => {
    const features = [
      { properties: { subgrid: 'N01E01', density: 2 } },
      { properties: { subgrid: 'N01E01', density: 2 } },
      { properties: { subgrid: 'N01E02', density: 4 } }
    ];
    expect(valuesFromMesh(features, 'density')).toEqual([2, 4]);
  });

  it('drops zero, negative and non-numeric values', () => {
    const features = [
      { properties: { subgrid: 'a', density: 0 } },
      { properties: { subgrid: 'b', density: -3 } },
      { properties: { subgrid: 'c', density: 'x' } },
      { properties: { subgrid: 'd', density: 5 } }
    ];
    expect(valuesFromMesh(features, 'density')).toEqual([5]);
  });

  it('returns an empty array for missing features', () => {
    expect(valuesFromMesh(null, 'density')).toEqual([]);
    expect(valuesFromMesh(undefined, 'coverage')).toEqual([]);
  });
});

describe('buildMeshExpression', () => {
  const s = createDefaultSetting('density', 'greens');

  it('keeps non-positive values fully transparent', () => {
    const expr = buildMeshExpression(s, 'density') as any[];
    expect(expr[0]).toBe('case');
    expect(expr[1]).toEqual(['<=', ['coalesce', ['get', 'density'], 0], 0]);
    expect(expr[2]).toBe('rgba(0, 0, 0, 0)');
  });

  it('steps through the class colours in ascending bound order', () => {
    const step = buildMeshExpression(s, 'density')[3] as any[];
    expect(step[0]).toBe('step');
    const pairs = step.slice(3);
    const bounds = pairs.filter((_, i) => i % 2 === 0);
    const colors = pairs.filter((_, i) => i % 2 === 1);
    expect(bounds).toEqual([1.5, 3.5, 6.0, 9.0]);
    expect(colors).toHaveLength(4);
    expect(step[2]).toMatch(/^rgba\(/);
  });

  it('keeps bounds ascending when the ramp is reversed', () => {
    const rev = toggleReverse(s);
    const step = buildMeshExpression(rev, 'density')[3] as any[];
    const bounds = step.slice(3).filter((_: unknown, i: number) => i % 2 === 0);
    expect(bounds).toEqual([1.5, 3.5, 6.0, 9.0]);
  });

  it('drops a non-increasing bound rather than emitting an invalid step', () => {
    const step = buildMeshExpression(
      {
        ...s,
        method: 'manual',
        classes: [
          { upperBound: 5, color: '#111111' },
          { upperBound: 5, color: '#222222' },
          { upperBound: 2, color: '#333333' },
          { upperBound: 9, color: '#444444' },
          { upperBound: null, color: '#555555' }
        ]
      },
      'density'
    )[3] as any[];
    const bounds = step.slice(3).filter((_: unknown, i: number) => i % 2 === 0);
    expect(bounds).toEqual([5, 9]);
  });

  it('classifies a value into the same class the map paints when bounds are out of order', () => {
    const messy = {
      ...s,
      method: 'manual' as const,
      classes: [
        { upperBound: 5, color: '#111111' },
        { upperBound: 5, color: '#222222' },
        { upperBound: 2, color: '#333333' },
        { upperBound: null, color: '#444444' }
      ]
    };
    // Bound 5 (first class) is kept; the duplicate 5 and the out-of-order 2 are
    // ignored, so 2 must land in class 0, not in the class painted as 2.
    expect(classIndexFor(messy, 2)).toBe(0);
    expect(classIndexFor(messy, 4)).toBe(0);
    expect(classIndexFor(messy, 50)).toBe(3);
  });

  it('applies the alpha to the base colour and every step colour', () => {
    const step = buildMeshExpression({ ...s, alpha: 0.5 }, 'density')[3] as any[];
    expect(step[2]).toMatch(/rgba\([^)]*,\s*0\.5\)/);
    // step[3..] is [bound, color, bound, color, ...]
    const colors = step.slice(3).filter((_: unknown, i: number) => i % 2 === 1);
    expect(colors).toHaveLength(4);
    for (const c of colors) expect(c).toMatch(/rgba\([^)]*,\s*0\.5\)/);
  });
});
