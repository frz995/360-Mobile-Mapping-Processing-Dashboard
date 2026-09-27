import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoverageSegmentation } from '../useCoverageSegmentation';
import type { LonLat } from '../../utils/roadNetworkTrace';

// Regression cover for the red overlay vanishing seconds after segmentation:
// the hook used to treat any new `capturedTracks` array identity as "the survey
// data changed" and wiped the result, and every data reload (Supabase sync,
// Refresh) hands over a brand new array.

const TOLERANCE_M = 12;
const PLAN: LonLat[][] = [[[101.5, 3.1], [101.502, 3.1]]];

/** Covers only the western end of PLAN, so a gap survives to the east. */
const TRACKS_WEST: LonLat[][] = [[[101.5001, 3.1], [101.5002, 3.1]]];
/** Also surveys the eastern half, so the remaining gap can only be a middle one. */
const TRACKS_WEST_AND_EAST: LonLat[][] = [
  [[101.5001, 3.1], [101.5002, 3.1]],
  [[101.501, 3.1], [101.502, 3.1]]
];

const gapStartLng = (coverage: { uncoveredRuns: LonLat[][] } | null) =>
  coverage?.uncoveredRuns[0]?.[0]?.[0];

const gapEndLng = (coverage: { uncoveredRuns: LonLat[][] } | null) => {
  const runs = coverage?.uncoveredRuns ?? [];
  return runs[runs.length - 1]?.[runs[runs.length - 1].length - 1]?.[0];
};

function setup(tracks: LonLat[][]) {
  return renderHook(
    (props: { capturedTracks: LonLat[][]; toleranceM: number }) => useCoverageSegmentation(props),
    { initialProps: { capturedTracks: tracks, toleranceM: TOLERANCE_M } }
  );
}

/** A re-fetch that returns identical data, down to a new array identity. */
const cloneTracks = (tracks: LonLat[][]): LonLat[][] =>
  tracks.map((t) => t.map((c) => [c[0], c[1]] as LonLat));

describe('useCoverageSegmentation input invalidation', () => {
  it('keeps the coverage when an equal track array is re-supplied with a new identity', () => {
    const { result, rerender } = setup(TRACKS_WEST);
    act(() => {
      result.current.segmentSubgrid('N93E70', PLAN);
    });
    expect(gapStartLng(result.current.coverage)).toBeGreaterThan(101.5);
    const revision = result.current.inputRevision;

    rerender({ capturedTracks: cloneTracks(TRACKS_WEST), toleranceM: TOLERANCE_M });

    expect(gapStartLng(result.current.coverage)).toBeGreaterThan(101.5);
    expect(result.current.activeScope).toBe('subgrid');
    expect(Object.keys(result.current.subgridResults)).toEqual(['N93E70']);
    expect(result.current.inputRevision).toBe(revision);
  });

  it('keeps the overlay on screen but drops the stale cache when the tracks really change', () => {
    const { result, rerender } = setup(TRACKS_WEST);
    act(() => {
      result.current.segmentSubgrid('N93E70', PLAN);
    });
    const revision = result.current.inputRevision;

    rerender({ capturedTracks: TRACKS_WEST_AND_EAST, toleranceM: TOLERANCE_M });

    expect(gapStartLng(result.current.coverage)).toBeGreaterThan(101.5);
    expect(result.current.subgridResults).toEqual({});
    expect(result.current.inputRevision).toBe(revision + 1);
  });

  it('bumps the revision when the tolerance changes', () => {
    const { result, rerender } = setup(TRACKS_WEST);
    act(() => {
      result.current.segmentSubgrid('N93E70', PLAN);
    });
    const revision = result.current.inputRevision;

    rerender({ capturedTracks: TRACKS_WEST, toleranceM: TOLERANCE_M + 5 });

    expect(result.current.inputRevision).toBe(revision + 1);
    expect(result.current.subgridResults).toEqual({});
  });

  it('recomputes the same subgrid against the new tracks instead of serving the cache', () => {
    const { result, rerender } = setup(TRACKS_WEST);
    act(() => {
      result.current.segmentSubgrid('N93E70', PLAN);
    });
    // Only the western end is surveyed: the gap runs all the way east.
    expect(gapEndLng(result.current.coverage)).toBeCloseTo(101.502, 5);

    rerender({ capturedTracks: TRACKS_WEST_AND_EAST, toleranceM: TOLERANCE_M });
    // Mirrors the workspace effect: watch inputRevision and re-segment the
    // active scope against the fresh plan runs.
    act(() => {
      result.current.segmentSubgrid('N93E70', PLAN);
    });

    expect(gapEndLng(result.current.coverage)).toBeLessThan(101.501);
    expect(result.current.activeScope).toBe('subgrid');
    expect(result.current.phase).toBe('done');
  });

  it('stores an empty coverage when the subgrid has no plan runs left after a reload', () => {
    const { result, rerender } = setup(TRACKS_WEST);
    act(() => {
      result.current.segmentSubgrid('N93E70', PLAN);
    });

    rerender({ capturedTracks: TRACKS_WEST_AND_EAST, toleranceM: TOLERANCE_M });
    act(() => {
      result.current.segmentSubgrid('N93E70', []);
    });

    expect(result.current.coverage?.uncoveredRuns).toEqual([]);
    expect(result.current.phase).toBe('done');
  });

  it('still wipes everything on an explicit clear', () => {
    const { result, rerender } = setup(TRACKS_WEST);
    act(() => {
      result.current.segmentSubgrid('N93E70', PLAN);
    });
    rerender({ capturedTracks: TRACKS_WEST_AND_EAST, toleranceM: TOLERANCE_M });
    act(() => {
      result.current.clear();
    });

    expect(result.current.coverage).toBeNull();
    expect(result.current.activeScope).toBe('none');
    expect(result.current.subgridResults).toEqual({});
  });
});
