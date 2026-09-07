import { describe, it, expect } from 'vitest';
import { minMaxOf } from '../arrayBounds';

describe('minMaxOf', () => {
  it('returns [min, max] for a normal numeric list', () => {
    expect(minMaxOf([3, 1, 2, 10, -5])).toEqual([-5, 10]);
  });

  it('handles a single element', () => {
    expect(minMaxOf([42])).toEqual([42, 42]);
  });

  it('skips non-finite values', () => {
    expect(minMaxOf([1, NaN, Infinity, 3])).toEqual([1, 3]);
  });

  it('returns [0, 0] for an empty / all-invalid list', () => {
    expect(minMaxOf([])).toEqual([0, 0]);
    expect(minMaxOf([NaN, Infinity])).toEqual([0, 0]);
  });

  it('works with iterables other than arrays', () => {
    function* gen() {
      yield 5;
      yield 2;
      yield 9;
    }
    expect(minMaxOf(gen())).toEqual([2, 9]);
  });

  it('does not overflow the stack on very large arrays (spread-apply regression)', () => {
    // Math.min(...big) throws "Maximum call stack size exceeded" past the
    // browser's argument limit; the helper must scan iteratively instead.
    const big = Array.from({ length: 300_000 }, (_, i) => i);
    const [min, max] = minMaxOf(big);
    expect(min).toBe(0);
    expect(max).toBe(299_999);
  });
});