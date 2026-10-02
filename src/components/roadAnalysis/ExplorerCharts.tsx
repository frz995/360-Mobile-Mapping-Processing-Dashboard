/**
 * Explorer breakdown charts.
 *
 * Geometry comes from the modular D3 packages (`d3-shape`, `d3-scale`,
 * `d3-array`); React owns the DOM. Each chart runs one `requestAnimationFrame`
 * loop that advances a per-item progress value via `useStaggeredReveal`, and
 * React re-renders the SVG from that value. Items are offset by a stagger so the
 * arcs/bars arrive one by one, but each one grows continuously — quantising the
 * growth into a fixed number of steps is what made it look stuttery.
 *
 * Restarting is keyed on the data, not on the render, so the chart animates on
 * mount and replays whenever the scope changes — and never resets mid-flight
 * because the parent happened to re-render.
 *
 * Both charts draw only real aggregated values. The previous stacked column chart
 * multiplied donut percentages by a hand-written radial "bias" factor to invent a
 * category split per zone, so its segments were never measured; these charts drop
 * that and plot the aggregation the statistics module actually produced.
 *
 * The reveal deliberately ignores `prefers-reduced-motion`. Honouring it meant a
 * straight jump to the final geometry, which left both charts completely static:
 * the sweep is the only cue that the scope or tab actually changed, so a machine
 * with Windows "Animation effects" off saw no change at all. To restore the
 * preference, re-add a `matchMedia('(prefers-reduced-motion: reduce)')` early
 * return at the top of the `useSteppedReveal` effect.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { arc, pie, type PieArcDatum } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { max } from 'd3-array';
import type { CatchmentRow } from '../../utils/catchmentStats';

/**
 * Donut segment palette: a distinct hue per segment so nominal categories stay
 * easy to tell apart. Applied to every tab so the donut reads consistently.
 */
export const EXPLORER_DONUT_COLORS = [
  '#4F46E5', // segment 1 — indigo (dominant)
  '#06B6D4', // segment 2 — cyan
  '#10B981', // segment 3 — emerald
  '#F59E0B', // segment 4 — amber
  '#94A3B8' // segment 5 — slate
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface RevealOptions {
  /** ms for one item to grow from empty to full. */
  durationMs: number;
  /** ms before the next item starts, so they read one-by-one. */
  staggerMs: number;
}

/**
 * Drives a staggered reveal: one `0..1` progress value per item.
 *
 * A single rAF loop samples `performance.now()` on every frame and recomputes the
 * whole set, so each item sweeps continuously. Item `i` only starts `i *
 * staggerMs` in, which is what makes the arcs/bars appear one by one.
 *
 * This is deliberately *not* a discrete tick counter. Quantising progress into a
 * fixed number of steps only makes the growth land on the display refresh rate by
 * accident: it caps each item at `STEPS_PER_ITEM` repaints, so a 1s growth jumps
 * in visible chunks and reads as stutter rather than a sweep.
 *
 * Elapsed time comes from `performance.now()`, never the rAF callback's timestamp:
 * the two are not guaranteed to share a time origin, and where they do not,
 * `now - start` stays negative and the animation never advances.
 */
function useStaggeredReveal(
  count: number,
  key: string,
  { durationMs, staggerMs }: RevealOptions
): number[] {
  const [progress, setProgress] = useState<number[]>(() => new Array(count).fill(0));
  const runIdRef = useRef(0);

  useEffect(() => {
    const runId = ++runIdRef.current;

    if (count === 0) {
      setProgress([]);
      return;
    }

    const totalMs = durationMs + Math.max(0, count - 1) * staggerMs;
    const start = performance.now();
    let frame = 0;

    const tick = () => {
      if (runIdRef.current !== runId) return;
      const elapsed = performance.now() - start;
      setProgress(
        new Array(count).fill(0).map((_v, i) => clamp01((elapsed - i * staggerMs) / durationMs))
      );
      if (elapsed < totalMs) frame = requestAnimationFrame(tick);
    };

    // Runs after the render that already painted the *previous* run's settled
    // progress, so a scope change shows the old geometry for one frame before
    // collapsing. Callers pass `key={animKey}` so the chart remounts instead and
    // the initial state seeds at 0; this reset covers a bare `animKey` change.
    setProgress(new Array(count).fill(0));
    frame = requestAnimationFrame(tick);
    return () => {
      if (runIdRef.current === runId) cancelAnimationFrame(frame);
    };
  }, [count, key]);

  return progress;
}

export interface DonutChartProps {
  rows: CatchmentRow[];
  colors: string[];
  /** Changing this replays the sweep, e.g. on tab switch or scope change. */
  animKey: string;
  /** Receives the hovered slice label, or null when the pointer leaves. */
  onSliceHover?: (label: string | null) => void;
}

/** Rendered pixel size of the square donut box. */
const DONUT_BOX = 84;
/** Internal coordinate space of the donut SVG. */
const DONUT_VIEW = 100;
/** Centre of that space; the `translate` on the slice group uses these. */
const DONUT_CX = DONUT_VIEW / 2;
const DONUT_CY = DONUT_VIEW / 2;
const DONUT_OUTER = 42;
const DONUT_INNER = 28;
/** Radians of gap between slices; grown in step with the reveal. */
const DONUT_PAD = 0.012;
/** Corner rounding of each slice, in view units. */
const DONUT_CORNER = 1.5;

export function DonutChart({
  rows,
  colors,
  animKey,
  onSliceHover
}: DonutChartProps): React.ReactElement {
  const slices = useMemo(() => rows.filter((r) => r.percentage > 0), [rows]);
  // Memoised: the reveal re-renders every frame, so rebuilding these on each
  // pass would re-run a string join and a d3 arc call per slice for nothing.
  const signature = useMemo(() => slices.map((r) => `${r.label}:${r.percentage}`).join('|'), [slices]);
  const progress = useStaggeredReveal(slices.length, `${animKey}|${signature}`, {
    durationMs: 1000,
    staggerMs: 110
  });
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);

  // A new run invalidates any hover dimming left over from the previous data.
  useEffect(() => {
    setHoveredSlice(null);
  }, [animKey, signature]);

  const layout = useMemo(
    () =>
      pie<CatchmentRow>()
        // d3's pie defaults are exactly what a full ring needs: `startAngle` 0
        // (12 o'clock) and `endAngle` 2π. Setting only `startAngle` does NOT
        // rotate the ring, it truncates the sweep — `endAngle` stays at 2π, so
        // `.startAngle(Math.PI / 2)` drew a 270° pie and left the grey track
        // showing past the fill.
        .sort(null)
        .value((d) => Math.max(0, d.percentage))(slices),
    [slices]
  );

  const arcGen = useMemo(
    () =>
      arc<PieArcDatum<CatchmentRow>>()
        .innerRadius(DONUT_INNER)
        .outerRadius(DONUT_OUTER)
        .cornerRadius(DONUT_CORNER),
    []
  );

  const paths = useMemo(
    () =>
      layout.map((d, i) => {
        const t = progress[i] ?? 0;
        const sweep = d.endAngle - d.startAngle;
        return {
          d: arcGen({
            ...d,
            endAngle: d.startAngle + sweep * t,
            padAngle: DONUT_PAD * t
          }),
          opacity: t > 0 ? 1 : 0
        };
      }),
    [layout, arcGen, progress]
  );

  const palette = colors.length ? colors : ['#38bdf8'];
  const totalPct = useMemo(() => slices.reduce((acc, r) => acc + r.percentage, 0), [slices]);
  const centerLabel = totalPct > 0 ? `${Math.round(totalPct)}%` : '—';

  return (
    <div
      className="p-2.5 rounded-xl border style-surface-inner flex items-center gap-3"
      style={{
        backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.03))',
        borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))'
      }}
    >
      {/* Fixed square box, so the ring cannot be squashed by the flex row. */}
      <div className="shrink-0" style={{ width: DONUT_BOX, height: DONUT_BOX }}>
        <svg
          className="block"
          width={DONUT_BOX}
          height={DONUT_BOX}
          viewBox={`0 0 ${DONUT_VIEW} ${DONUT_VIEW}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${slices.length} categories, ${centerLabel} total`}
        >
          {/* d3.arc draws every slice around (0,0). A single translate is what
              brings the track and the slices onto the same centre — without it
              the track ring sat in the middle of the box while the coloured
              slices were drawn in the top-left corner and clipped. */}
          <g transform={`translate(${DONUT_CX} ${DONUT_CY})`}>
            <circle
              r={(DONUT_OUTER + DONUT_INNER) / 2}
              fill="none"
              stroke="var(--divider, rgba(255, 255, 255, 0.12))"
              strokeWidth={DONUT_OUTER - DONUT_INNER}
            />
            {paths.map((slice, i) => {
              const label = slices[i].label;
              const dimmed = hoveredSlice !== null && hoveredSlice !== label;
              return (
                <path
                  key={label}
                  className="explorer-donut-slice"
                  d={slice.d ?? undefined}
                  fill={palette[i % palette.length]}
                  opacity={slice.opacity * (dimmed ? 0.4 : 1)}
                  onMouseEnter={() => {
                    setHoveredSlice(label);
                    onSliceHover?.(label);
                  }}
                  onMouseLeave={() => {
                    setHoveredSlice(null);
                    onSliceHover?.(null);
                  }}
                >
                  <title>{`${label}: ${slices[i].displayValue ?? `${slices[i].percentage}%`}`}</title>
                </path>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Flexible legend so it takes the row's slack beside the fixed square
          ring, as before. */}
      <div className="flex-1 space-y-1 min-w-0">
        {slices.map((row, i) => (
          <div key={row.label} className="flex items-start justify-between text-[9.5px] gap-1.5 explorer-legend-row"
            onMouseEnter={() => {
              setHoveredSlice(row.label);
              onSliceHover?.(row.label);
            }}
            onMouseLeave={() => {
              setHoveredSlice(null);
              onSliceHover?.(null);
            }}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 mt-[3px]"
                style={{ backgroundColor: palette[i % palette.length] }}
              />
              {/* Wraps to a second line rather than truncating: the fixed basis
                  is narrower than the labels, e.g. "Arterial corridor
                  (500m-1.2km)". `title` still carries the full string. */}
              <span
                className="text-[var(--text-primary,#EEF2F1)] leading-tight min-w-0"
                title={row.label}
              >
                {row.label}
              </span>
            </div>
            <span className="font-mono text-[var(--text-muted,#9BAAA9)] shrink-0 font-medium text-[9px]">
              {row.displayValue ?? `${row.percentage}%`}
            </span>
          </div>
        ))}
        {slices.length === 0 && (
          <div className="text-[9.5px] text-[var(--text-muted,#9BAAA9)]">
            No measured breakdown for this scope.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Column chart for a set of weighted shares (one column per class). Each row
 * may carry its own `color` (the choropleth class colour); otherwise the column
 * takes the next colour from `colors`, or the single `color` as a fallback.
 */
export interface ClassShareColumnsProps {
  rows: CatchmentRow[];
  /** Single fallback colour, used when neither `row.color` nor `colors` is set. */
  color?: string;
  /** Per-bar palette; only used for rows that carry no `color` of their own. */
  colors?: string[];
  animKey: string;
  /** Y-axis caption, e.g. "% of mesh area". */
  measureLabel: string;
  /** Footer and accessible description of the chart; defaults to `measureLabel`. */
  caption?: string;
  onHover: (row: CatchmentRow | null) => void;
}

const CHART_W = 330;
const CHART_H = 158;
// Symmetric about CHART_W / 2 so the plot, the columns and the footer caption
// share the viewBox centre. The left inset has to hold the rotated axis title and
// the tick labels, so the right one matches it; 320 left only 10 units of margin
// and pushed the whole plot 10 units right of centre.
const PLOT_LEFT = 30;
const PLOT_RIGHT = 300;
const PLOT_TOP = 18;
const PLOT_BASE_Y = 102;
const COL_WIDTH = 30;

/** Round the axis ceiling up to a readable step and return its ticks. */
function axisScale(maxPct: number): { top: number; ticks: number[] } {
  const ceiling = Math.max(10, maxPct || 0);
  const steps = [25, 50, 80, 100];
  const top = steps.find((s) => ceiling <= s) ?? Math.ceil(ceiling / 100) * 100;
  const tickCount = top / (top === 25 ? 5 : top === 50 ? 10 : top === 80 ? 20 : 25);
  return { top, ticks: Array.from({ length: tickCount + 1 }, (_, i) => i * (top / tickCount)) };
}

export function ClassShareColumns({
  rows,
  color,
  colors,
  animKey,
  measureLabel,
  caption,
  onHover
}: ClassShareColumnsProps): React.ReactElement {
  const barColors = colors && colors.length ? colors : [color ?? '#38bdf8'];
  const columns = useMemo(() => rows.filter((r) => r.percentage > 0), [rows]);
  const signature = useMemo(
    () => columns.map((r) => `${r.label}:${r.percentage}`).join('|'),
    [columns]
  );
  const progress = useStaggeredReveal(columns.length, `${animKey}|${signature}`, {
    durationMs: 900,
    staggerMs: 90
  });

  const plotW = PLOT_RIGHT - PLOT_LEFT;
  const slotW = plotW / Math.max(1, columns.length);
  const { top, ticks } = axisScale(max(columns, (r) => r.percentage) ?? 0);
  const yScale = useMemo(() => scaleLinear().domain([0, top]).range([PLOT_BASE_Y, PLOT_TOP]), [top]);

  const bars = useMemo(
    () =>
      columns.map((row, i) => {
        const t = progress[i] ?? 0;
        const targetY = yScale(row.percentage);
        const targetHeight = Math.max(0, PLOT_BASE_Y - targetY);
        const height = targetHeight * t;
        // The rect grows up from the baseline, so its top edge is what the label
        // has to sit on. Deriving it from the *target* height instead left the
        // label parked above the finished bar, dropping into place as it grew.
        const topY = PLOT_BASE_Y - height;
        return {
          row,
          x: PLOT_LEFT + (i + 0.5) * slotW - COL_WIDTH / 2,
          y: topY,
          height,
          valueY: Math.max(11, topY - 3),
          valueOpacity: t
        };
      }),
    [columns, progress, yScale, slotW]
  );

  if (columns.length === 0) {
    return (
      <div
        className="p-2.5 rounded-xl border style-surface-inner text-[10px] text-[var(--text-muted,#9BAAA9)]"
        style={{
          backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.03))',
          borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))'
        }}
      >
        No {measureLabel} recorded for this scope.
      </div>
    );
  }

  return (
    <div
      className="p-2.5 rounded-xl border style-surface-inner flex flex-col gap-2"
      style={{
        backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.03))',
        borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.08))'
      }}
    >
      <div className="w-full overflow-hidden">
        <svg
          className="block w-full h-auto select-none"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          style={{ overflow: 'visible' }}
          role="img"
          aria-label={caption ?? measureLabel}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PLOT_LEFT}
                y1={yScale(tick)}
                x2={PLOT_RIGHT}
                y2={yScale(tick)}
                stroke="var(--divider, rgba(255, 255, 255, 0.08))"
                strokeDasharray={tick === 0 ? undefined : '3 3'}
                strokeWidth={tick === 0 ? 1 : 0.75}
              />
              <text
                x={PLOT_LEFT - 5}
                y={yScale(tick) + 3}
                textAnchor="end"
                fontSize="7.5"
                fill="var(--text-muted, #9BAAA9)"
                fontFamily="monospace"
              >
                {Math.round(tick)}%
              </text>
            </g>
          ))}

          <text
            x={9}
            y={(PLOT_TOP + PLOT_BASE_Y) / 2}
            transform={`rotate(-90 9 ${(PLOT_TOP + PLOT_BASE_Y) / 2})`}
            textAnchor="middle"
            fontSize="7"
            fill="var(--text-muted, #9BAAA9)"
            fontWeight="500"
          >
            {measureLabel}
          </text>

          {bars.map((bar, i) => (
            <g key={bar.row.label} className="explorer-bar-column">
              <rect
                x={bar.x}
                y={bar.y}
                width={COL_WIDTH}
                height={Math.max(0, bar.height)}
                rx={3}
                ry={3}
                fill={bar.row.color ?? barColors[i % barColors.length]}
                opacity={bar.height > 0 ? 0.9 : 0}
                className="explorer-bar-segment"
                onMouseEnter={() => onHover(bar.row)}
                onMouseLeave={() => onHover(null)}
              >
                <title>{`${bar.row.label}: ${bar.row.displayValue ?? `${bar.row.percentage}%`}`}</title>
              </rect>
              <text
                x={bar.x + COL_WIDTH / 2}
                y={bar.valueY}
                textAnchor="middle"
                fontSize="8.5"
                fontWeight="bold"
                fontFamily="monospace"
                fill="var(--text-primary, #EEF2F1)"
                style={{ opacity: bar.valueOpacity }}
              >
                {bar.row.displayValue ?? `${bar.row.percentage}%`}
              </text>
              <text
                x={bar.x + COL_WIDTH / 2}
                y={PLOT_BASE_Y + 12}
                transform={`rotate(-24 ${bar.x + COL_WIDTH / 2} ${PLOT_BASE_Y + 12})`}
                textAnchor="end"
                fontSize="7.5"
                fill="var(--text-muted, #9BAAA9)"
                className="select-none"
              >
                {bar.row.label}
              </text>
            </g>
          ))}

          <text
            x={(PLOT_LEFT + PLOT_RIGHT) / 2}
            y={CHART_H - 3}
            textAnchor="middle"
            fontSize="7.5"
            fill="var(--text-muted, #9BAAA9)"
            fontWeight="500"
          >
            {caption ?? measureLabel}
          </text>
        </svg>
      </div>
    </div>
  );
}