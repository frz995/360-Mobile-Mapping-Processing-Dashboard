/**
 * Single-pass min/max scan over any (finite) numeric iterable.
 *
 * Avoids `Math.min(...arr)` / `Math.max(...arr)` spread-apply, which forwards
 * every element as a function argument and throws
 * `RangeError: Maximum call stack size exceeded` once the dataset is large
 * enough (e.g. tens of thousands of survey-frame coordinates).
 */
export function minMaxOf(values: Iterable<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  let found = false;
  for (const v of values) {
    if (Number.isFinite(v)) {
      found = true;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return found ? [min, max] : [0, 0];
}