import { describe, expect, it } from 'vitest';
import { mergeRoadLinesBySharedNodes, type ExtractedRoadLine } from '../roadExtraction';

const line = (
  coordinates: Array<[number, number]>,
  startNode?: number,
  endNode?: number
): ExtractedRoadLine => ({ coordinates, startNode, endNode });

describe('mergeRoadLinesBySharedNodes', () => {
  it('joins two ways that share a degree-2 node into one run', () => {
    const merged = mergeRoadLinesBySharedNodes([
      line([[100.0, 3.0], [100.01, 3.0]], 1, 2),
      line([[100.01, 3.0], [100.02, 3.0]], 2, 3)
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0].coordinates).toEqual([
      [100.0, 3.0],
      [100.01, 3.0],
      [100.02, 3.0]
    ]);
  });

  it('reverses a way when its node order runs against the chain', () => {
    const merged = mergeRoadLinesBySharedNodes([
      line([[100.0, 3.0], [100.01, 3.0]], 1, 2),
      line([[100.02, 3.0], [100.01, 3.0]], 3, 2)
    ]);

    expect(merged.length).toBe(1);
    expect(merged[0].coordinates).toEqual([
      [100.0, 3.0],
      [100.01, 3.0],
      [100.02, 3.0]
    ]);
  });

  it('keeps ways meeting at a junction node (degree 3) as separate runs', () => {
    const merged = mergeRoadLinesBySharedNodes([
      line([[100.0, 3.0], [100.01, 3.0]], 1, 2),
      line([[100.01, 3.0], [100.02, 3.0]], 2, 3),
      line([[100.01, 3.0], [100.01, 3.01]], 2, 4)
    ]);

    expect(merged.length).toBe(3);
  });

  it('closes a cyclic chain (roundabout) back onto its first vertex', () => {
    const merged = mergeRoadLinesBySharedNodes([
      line([[100.0, 3.0], [100.01, 3.0]], 1, 2),
      line([[100.01, 3.0], [100.01, 3.01]], 2, 3),
      line([[100.01, 3.01], [100.0, 3.0]], 3, 1)
    ]);

    expect(merged.length).toBe(1);
    const coords = merged[0].coordinates;
    expect(coords[0]).toEqual(coords[coords.length - 1]);
    expect(coords.length).toBe(4);
  });

  it('passes lines without node refs through untouched', () => {
    const input = [
      line([[100.0, 3.0], [100.01, 3.0]]),
      line([[100.01, 3.0], [100.02, 3.0]])
    ];
    const merged = mergeRoadLinesBySharedNodes(input);

    expect(merged.length).toBe(2);
    expect(merged[0].coordinates).toEqual(input[0].coordinates);
    expect(merged[1].coordinates).toEqual(input[1].coordinates);
  });
});
