import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { arc, pie, type PieArcDatum } from 'd3-shape';
import { DonutChart, ClassShareColumns } from '../ExplorerCharts';
import type { CatchmentRow } from '../../../utils/catchmentStats';

const rows: CatchmentRow[] = [
  { label: 'Dense urban block (<150m)', percentage: 40 },
  { label: 'Collector street (150–500m)', percentage: 30 },
  { label: 'Arterial corridor (500m–1.2km)', percentage: 20 },
  { label: 'Trunk / highway (>1.2km)', percentage: 10 }
];

const donutProps = {
  rows,
  colors: ['#111111', '#222222', '#333333', '#444444']
};

/** The reveal runs ~1.45s, so every completion wait needs more than the 1s default. */
const SETTLED = { timeout: 5000, interval: 20 } as const;

/**
 * The full-sweep path for each slice, computed here from `d3-shape` rather than
 * read off a reduced-motion render, so the expectation is independent of how
 * the component gets there.
 *
 * No `startAngle`: the pie defaults (`startAngle` 0, `endAngle` 2π) are the full
 * ring. Setting only `startAngle` truncates the sweep instead of rotating it.
 */
const fullSweepPaths = (): (string | null)[] => {
  const layout = pie<CatchmentRow>()
    .sort(null)
    .value((d) => Math.max(0, d.percentage))(rows);
  const arcGen = arc<PieArcDatum<CatchmentRow>>()
    .innerRadius(28)
    .outerRadius(42)
    .cornerRadius(1.5)
    .padAngle(0.012);
  return layout.map((d) => arcGen(d));
};

const FINAL_DONUT_PATHS = fullSweepPaths();

/** Axis: 102 (0%) to 18 (50%), so 1% = 1.68 units. Max bin 35% caps the axis at 50%. */
const EXPECTED_HEIGHTS = [16.8, 50.4, 58.8, 42];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DonutChart', () => {
  it('draws the track and slices around the same centre in a square box', () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const svg = container.querySelector('svg')!;

    // No CSS rotation on the ring: the start angle comes from the pie layout.
    expect(svg.getAttribute('class')).not.toContain('rotate');
    // A viewBox-only svg is a replaced element with a 300x150 default, which
    // pushes the ring off-centre in a flex row.
    expect(svg.getAttribute('width')).toBe(svg.getAttribute('height'));

    // d3.arc draws every slice around (0,0). The group translate is the only
    // thing putting the track and the slices on the same centre; without it the
    // slices rendered in the top-left corner while the ring sat in the middle.
    const group = svg.querySelector('g')!;
    expect(group.getAttribute('transform')).toBe('translate(50 50)');
    const slices = group.querySelectorAll('path.explorer-donut-slice');
    expect(slices).toHaveLength(4);
    // The track is inside the same group, so it shares that centre.
    expect(group.querySelector('circle')).not.toBeNull();
    for (const slice of Array.from(slices)) {
      expect(slice.getAttribute('d')).toMatch(/^M/);
    }
  });

  it('keeps the ring in a fixed square box beside a flexible legend', () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const card = container.firstElementChild as HTMLElement;
    // The row is a plain left-aligned flex pair; the legend flexes to take the
    // slack rather than the whole block being force-centred.
    expect(card.className).not.toContain('justify-center');
    const legend = container.querySelector('.explorer-legend-row')!.parentElement!;
    expect(legend.className).toContain('flex-1');
    const box = container.querySelector('svg')!.parentElement as HTMLElement;
    expect(box.style.width).toBe(box.style.height);
  });

  it('fills the whole ring: the pie spans 360 degrees from 12 oclock', async () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const sliceAt = (i: number) => container.querySelectorAll('path.explorer-donut-slice')[i];
    await waitFor(() => {
      for (let i = 0; i < rows.length; i += 1) {
        expect(sliceAt(i).getAttribute('d')).toBe(FINAL_DONUT_PATHS[i]);
      }
    }, SETTLED);

    const firstPath = sliceAt(0).getAttribute('d')!;
    // SVG omits a separator before the `A` command, so pull the first pair out
    // with a regex rather than splitting on spaces/commas.
    const start = firstPath.match(/^M(-?[\d.]+),(-?[\d.]+)/)!;
    const mx = Number(start[1]);
    const my = Number(start[2]);

    // Setting only `pie.startAngle` truncates the sweep (endAngle stays at 2π),
    // so a `startAngle(Math.PI / 2)` ring was 270° and the grey track showed past
    // the fill. A 360° ring starts the first slice just clockwise of 12 o'clock:
    // top of the box (y negative), not the 3 o'clock edge (y near 0).
    expect(my).toBeLessThan(-30);
    expect(Math.abs(mx)).toBeLessThan(15);
    // Outer edge of every slice sits on the track radius.
    for (let i = 0; i < rows.length; i += 1) {
      expect(sliceAt(i).getAttribute('d')).toMatch(/A42,42/);
    }
  });

  it('leaves the hole empty, since the hero metric is already shown above', () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    // The centre overlay clamped itself to the hole with a `100 - r * 2` inset
    // that never halved the total, so the label box was 10px wide and clipped.
    expect(container.querySelector('svg')!.querySelector('text')).toBeNull();
    expect(container.querySelector('[style*="inset"]')).toBeNull();
  });

  it('animates the sweep in on mount', async () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const first = container.querySelector('path.explorer-donut-slice')!;

    // Starts collapsed, then the rAF loop reveals it.
    expect(first.getAttribute('opacity')).toBe('0');
    await waitFor(() => expect(first.getAttribute('opacity')).toBe('1'), SETTLED);
  });

  it('sweeps each slice across its full angle, not a sliver of it', async () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const sliceAt = (i: number) => container.querySelectorAll('path.explorer-donut-slice')[i];

    for (let i = 0; i < rows.length; i += 1) {
      await waitFor(() => expect(sliceAt(i).getAttribute('d')).toBe(FINAL_DONUT_PATHS[i]), SETTLED);
    }
  });

  it('sweeps continuously instead of stepping through a few coarse frames', async () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const slice = () => container.querySelector('path.explorer-donut-slice')!.getAttribute('d');
    const seen = new Set<string>();

    await waitFor(
      () => {
        seen.add(slice()!);
        expect(slice()).toBe(FINAL_DONUT_PATHS[0]);
      },
      { timeout: 5000, interval: 16 }
    );

    // Quantising progress into a fixed tick count capped a 1s growth at 14
    // repaints, so the ring visibly jumped between frames. One sample per display
    // refresh means far more distinct geometries than steps.
    expect(seen.size).toBeGreaterThan(20);
  });

  it('still animates when the OS asks for reduced motion', async () => {
    // The exact setting that made both charts look frozen: honouring it jumped
    // straight to the final geometry, so a scope change showed nothing at all.
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false
        }) as unknown as MediaQueryList
    );

    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const first = container.querySelector('path.explorer-donut-slice')!;

    expect(first.getAttribute('opacity')).toBe('0');
    await waitFor(() => expect(first.getAttribute('d')).toBe(FINAL_DONUT_PATHS[0]), SETTLED);
  });

  it('starts each slice only after the previous one, one at a time', async () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const sliceAt = (i: number) => container.querySelectorAll('path.explorer-donut-slice')[i];

    // When the first slice is fully drawn the last one is still mid-reveal, which
    // cannot hold if every item starts on the same tick.
    await waitFor(() => expect(sliceAt(0).getAttribute('d')).toBe(FINAL_DONUT_PATHS[0]), SETTLED);
    expect(sliceAt(3).getAttribute('d')).not.toBe(FINAL_DONUT_PATHS[3]);
  });

  it('replays the sweep when the scope changes', async () => {
    const { container, rerender } = render(<DonutChart {...donutProps} animKey="a" />);
    const first = container.querySelector('path.explorer-donut-slice')!;
    await waitFor(() => expect(first.getAttribute('d')).toBe(FINAL_DONUT_PATHS[0]), SETTLED);

    rerender(<DonutChart {...donutProps} animKey="a-SG02" />);
    const replayed = container.querySelector('path.explorer-donut-slice')!;
    expect(replayed.getAttribute('d')).not.toBe(FINAL_DONUT_PATHS[0]);
    await waitFor(() => expect(replayed.getAttribute('d')).toBe(FINAL_DONUT_PATHS[0]), SETTLED);
  });

  it('says so instead of drawing an empty ring when nothing was measured', () => {
    render(<DonutChart {...donutProps} rows={[]} animKey="a" />);
    expect(screen.getByText('No measured breakdown for this scope.')).toBeInTheDocument();
    expect(document.querySelectorAll('path.explorer-donut-slice')).toHaveLength(0);
  });

  it('omits rows without a real percentage', () => {
    render(
      <DonutChart
        {...donutProps}
        rows={[
          { label: 'kept', percentage: 50 },
          { label: 'dropped', percentage: 0 }
        ]}
        animKey="a"
      />
    );
    expect(screen.getByText('kept')).toBeInTheDocument();
    expect(screen.queryByText('dropped')).not.toBeInTheDocument();
  });

  it('dims the other slices while one is hovered', async () => {
    const { container } = render(<DonutChart {...donutProps} animKey="a" />);
    const sliceAt = (i: number) => container.querySelectorAll('path.explorer-donut-slice')[i];
    await waitFor(() => {
      for (let i = 0; i < rows.length; i += 1) {
        expect(sliceAt(i).getAttribute('opacity')).toBe('1');
      }
    }, SETTLED);

    fireEvent.mouseEnter(sliceAt(0));
    expect(Number(sliceAt(1).getAttribute('opacity'))).toBeCloseTo(0.4, 2);
    expect(Number(sliceAt(0).getAttribute('opacity'))).toBe(1);

    fireEvent.mouseLeave(sliceAt(0));
    expect(Number(sliceAt(1).getAttribute('opacity'))).toBe(1);
  });

  it('dims the other slices when a legend row is hovered instead', async () => {
    const onSliceHover = vi.fn();
    const { container } = render(
      <DonutChart {...donutProps} animKey="a" onSliceHover={onSliceHover} />
    );
    const sliceAt = (i: number) => container.querySelectorAll('path.explorer-donut-slice')[i];
    await waitFor(() => {
      for (let i = 0; i < rows.length; i += 1) {
        expect(sliceAt(i).getAttribute('opacity')).toBe('1');
      }
    }, SETTLED);

    const legendRow = screen.getByText(rows[1].label).closest('.explorer-legend-row')!;
    fireEvent.mouseEnter(legendRow);
    expect(onSliceHover).toHaveBeenCalledWith(rows[1].label);
    expect(Number(sliceAt(0).getAttribute('opacity'))).toBeCloseTo(0.4, 2);
    expect(Number(sliceAt(1).getAttribute('opacity'))).toBe(1);

    fireEvent.mouseLeave(legendRow);
    expect(onSliceHover).toHaveBeenLastCalledWith(null);
    expect(Number(sliceAt(0).getAttribute('opacity'))).toBe(1);
  });
});

describe('ClassShareColumns', () => {
  const binRows: CatchmentRow[] = [
    { label: 'Core (0–25% of extent)', percentage: 10 },
    { label: 'Inner (25–50%)', percentage: 30 },
    { label: 'Mid (50–75%)', percentage: 35 },
    { label: 'Outer (75–100%)', percentage: 25 }
  ];

  const columnProps = {
    rows: binRows,
    color: '#31a354',
    measureLabel: '% of road length',
    onHover: vi.fn()
  };

  it('renders one column per class with a real axis', () => {
    const { container } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    const bars = container.querySelectorAll('rect.explorer-bar-segment');
    expect(bars).toHaveLength(4);
    // Max bin is 35%, so the axis tops out at 50% in 10% steps: a 0%..50% axis.
    const ticks = Array.from(container.querySelectorAll('line')).map((l) =>
      Number(l.getAttribute('y1'))
    );
    expect(ticks).toHaveLength(6);
    // y runs from the baseline (102) up to the axis top (18).
    expect(Math.max(...ticks)).toBe(102);
    expect(Math.min(...ticks)).toBe(18);
  });

  it('grows the columns from zero on mount', async () => {
    const { container } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    const bar = container.querySelector('rect.explorer-bar-segment')!;
    expect(Number(bar.getAttribute('height'))).toBe(0);

    await waitFor(() => expect(Number(bar.getAttribute('height'))).toBeGreaterThan(0), SETTLED);
  });

  it('rides the value label on the rising column instead of dropping it from the top', async () => {
    const { container } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    const bar = () => container.querySelector('rect.explorer-bar-segment')!;
    const label = () => container.querySelector('g.explorer-bar-column text')!;

    // Catch the first column mid-rise: short, so its top edge is still near the
    // baseline. The label must sit just above that edge. Deriving it from the
    // *finished* height instead parked it at the top and let it drop into place.
    await waitFor(() => {
      const h = Number(bar().getAttribute('height'));
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThan(EXPECTED_HEIGHTS[0] * 0.5);
    }, SETTLED);

    const topY = Number(bar().getAttribute('y'));
    expect(Number(label().getAttribute('y'))).toBeCloseTo(topY - 3, 0);
  });

  it('raises each column to the height the axis implies, not a fraction of it', async () => {
    const { container } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    const bars = Array.from(container.querySelectorAll('rect.explorer-bar-segment'));

    for (let i = 0; i < binRows.length; i += 1) {
      await waitFor(
        () => expect(Number(bars[i].getAttribute('height'))).toBeCloseTo(EXPECTED_HEIGHTS[i], 1),
        SETTLED
      );
    }
  });

  it('still animates when the OS asks for reduced motion', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false
        }) as unknown as MediaQueryList
    );

    const { container } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    const bar = container.querySelector('rect.explorer-bar-segment')!;
    expect(Number(bar.getAttribute('height'))).toBe(0);

    await waitFor(
      () => expect(Number(bar.getAttribute('height'))).toBeCloseTo(EXPECTED_HEIGHTS[0], 1),
      SETTLED
    );
  });

  it('starts each column only after the previous one, one at a time', async () => {
    const { container } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    const barAt = (i: number) => container.querySelectorAll('rect.explorer-bar-segment')[i];

    await waitFor(
      () => expect(Number(barAt(0).getAttribute('height'))).toBeCloseTo(EXPECTED_HEIGHTS[0], 1),
      SETTLED
    );
    expect(Number(barAt(3).getAttribute('height'))).toBeLessThan(EXPECTED_HEIGHTS[3]);
  });

  it('replays when the scope changes', async () => {
    const { container, rerender } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    const bar = container.querySelector('rect.explorer-bar-segment')!;
    await waitFor(
      () => expect(Number(bar.getAttribute('height'))).toBeCloseTo(EXPECTED_HEIGHTS[0], 1),
      SETTLED
    );

    rerender(<ClassShareColumns {...columnProps} animKey="a-SG02" />);
    const replayed = container.querySelector('rect.explorer-bar-segment')!;
    expect(Number(replayed.getAttribute('height'))).toBeLessThan(EXPECTED_HEIGHTS[0]);
    await waitFor(
      () => expect(Number(replayed.getAttribute('height'))).toBeCloseTo(EXPECTED_HEIGHTS[0], 1),
      SETTLED
    );
  });

  it('reports the hovered bin to the caller', async () => {
    const onHover = vi.fn();
    const { container } = render(
      <ClassShareColumns {...columnProps} onHover={onHover} animKey="a" />
    );
    const barAt = () => container.querySelector('rect.explorer-bar-segment')!;
    await waitFor(() => expect(Number(barAt().getAttribute('height'))).toBeGreaterThan(0), SETTLED);

    fireEvent.mouseEnter(barAt());
    expect(onHover).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Core (0–25% of extent)' })
    );

    fireEvent.mouseLeave(barAt());
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('says so instead of an empty plot when a bin has no share', () => {
    render(<ClassShareColumns {...columnProps} rows={[]} animKey="a" />);
    expect(screen.getByText('No % of road length recorded for this scope.')).toBeInTheDocument();
  });

  it('colours each column from the supplied palette and falls back to the single colour', () => {
    const { container } = render(
      <ClassShareColumns
        {...columnProps}
        colors={['#aa0000', '#bb0000', '#cc0000', '#dd0000']}
        animKey="a"
      />
    );
    const fills = Array.from(container.querySelectorAll('rect.explorer-bar-segment')).map((bar) =>
      bar.getAttribute('fill')
    );
    expect(fills).toEqual(['#aa0000', '#bb0000', '#cc0000', '#dd0000']);

    const { container: fallback } = render(<ClassShareColumns {...columnProps} animKey="a" />);
    expect(fallback.querySelector('rect.explorer-bar-segment')?.getAttribute('fill')).toBe('#31a354');
  });

  it('prefers a row colour over the supplied palette so a filtered class cannot shift the ramp', () => {
    const { container } = render(
      <ClassShareColumns
        {...columnProps}
        rows={[
          { label: 'Class 1', percentage: 60, color: '#abc123' },
          { label: 'Class 2', percentage: 40 }
        ]}
        colors={['#aa0000', '#bb0000']}
        animKey="a"
      />
    );
    const fills = Array.from(container.querySelectorAll('rect.explorer-bar-segment')).map((bar) =>
      bar.getAttribute('fill')
    );
    expect(fills).toEqual(['#abc123', '#bb0000']);
  });
});