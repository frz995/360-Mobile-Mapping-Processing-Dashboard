/**
 * Explorer statistics derived from the mesh cells themselves.
 *
 * The Details card used to read from `calculateBufferAnalytics`, which measures
 * a circle of a user-draggable radius around a dropped pin. That is a different
 * geometry from the subgrid mesh the map actually paints, so the card and the
 * map disagreed: focusing a subgrid patched only three scalars
 * (`roadLengthKm`, `roadDensityKmPerKm2`, `areaKm2`) and left every percentage
 * on the circle. Worse, when the circle held little data the function returned
 * hard-coded percentages — complexity `25 / 45 / 5 / 25`, road corridor
 * `32 / 44 / 18 / 6`, radial rings `15 / 30 / 35 / 20`, panotrack radial
 * `25 / 25 / 25 / 25`, and a three-branch density lookup keyed off a single
 * number. Plausible-looking numbers that meant nothing.
 *
 * Everything here aggregates mesh cells instead, so:
 *   - idle means "all cells in the district grid", which is exactly the scope
 *     the map shows and needs no pin or radius;
 *   - a focused subgrid is the same computation over one cell, which is what
 *     makes the two states consistent;
 *   - a category with no real denominator omits its rows instead of printing a
 *     fabricated split.
 *
 * Three aggregation rules matter and are covered by tests:
 *   1. Density is area-weighted (`sum(planKm) / sum(areaKm2)`), never a mean of
 *      per-cell densities, which would weigh a 0.5 km² cell like a 12 km² one.
 *   2. The density breakdown weights by mesh area, not cell count, so the
 *      answer does not change when the grid resolution does.
 *   3. Coverage sums `coverageKm`, never `coverage`. `coverage` is a percentage;
 *      adding percentages across cells is meaningless.
 */

import {
  METRIC_PROPERTY,
  METRIC_UNIT,
  classColors,
  classIndexFor,
  resolveSetting,
  type ChoroplethSetting,
  type ChoroplethSettingsMap
} from './choroplethSettings';
import {
  type CatchmentTabKey,
  type MeshCellData,
  type MeshCorridorBreakdown,
  type MeshFrameBreakdown,
  type MeshJunctionBreakdown
} from './projectExplorerGeometry';

export type { CatchmentTabKey };

/** Raw totals for a set of mesh cells. Every field is a sum, never a mean. */
export interface MeshCatchmentTotals {
  cellCount: number;
  planKm: number;
  areaKm2: number;
  /** `sum(planKm) / sum(areaKm2)` — the area-weighted network density. */
  densityKmPerKm2: number;
  panotrackFrames: number;
  coverageKm: number;
  coveragePercent: number;
  corridor: MeshCorridorBreakdown;
  junctions: MeshJunctionBreakdown;
  frames: MeshFrameBreakdown;
  /** Sum of the per-cell complexity index weighted by cell area. */
  complexityIndex: number;
  intersectionDensityPerKm2: number;
}

/** One row of a chart. `percentage` is always derived from a real denominator. */
export interface CatchmentRow {
  label: string;
  percentage: number;
  displayValue?: string;
  /** Overrides the chart's positional palette so the row keeps its legend colour. */
  color?: string;
}

export interface CatchmentSection {
  title: string;
  subtitleRight: string;
  rows: CatchmentRow[];
}

export interface CatchmentCategory {
  key: CatchmentTabKey;
  label: string;
  primaryValue: string;
  primaryUnit: string;
  sections: [CatchmentSection, CatchmentSection];
  /** Mesh cells behind these numbers, so the card can state its own scope. */
  cellCount: number;
  /** True when no category had a real denominator, so every row is omitted. */
  isEmpty: boolean;
}

const round = (v: number, dp = 2) => Number(Number(v).toFixed(dp));

const ZERO_CORRIDOR: MeshCorridorBreakdown = { shortKm: 0, mediumKm: 0, arterialKm: 0, trunkKm: 0 };
const ZERO_JUNCTIONS: MeshJunctionBreakdown = { deadEnd: 0, threeWay: 0, fourWay: 0, fivePlus: 0 };
const ZERO_FRAMES: MeshFrameBreakdown = { verified: 0, defect: 0, transit: 0, mismatch: 0 };

/** Percentage of `part` out of `whole`, or null when `whole` is zero. */
function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return round((part / whole) * 100, 1);
}

/**
 * Sums the per-cell measurements for a set of cells. Passing every mesh cell
 * gives the idle "overall" view; passing one cell gives the focused view.
 */
export function summarizeMeshCells(cells: MeshCellData[] | null | undefined): MeshCatchmentTotals {
  const list = (cells || []).filter((c) => c && Number.isFinite(c.areaKm2));

  const corridor: MeshCorridorBreakdown = { ...ZERO_CORRIDOR };
  const junctions: MeshJunctionBreakdown = { ...ZERO_JUNCTIONS };
  const frames: MeshFrameBreakdown = { ...ZERO_FRAMES };

  let planKm = 0;
  let areaKm2 = 0;
  let panotrackFrames = 0;
  let coverageKm = 0;
  let weightedComplexity = 0;

  for (const cell of list) {
    planKm += cell.planKm || 0;
    areaKm2 += cell.areaKm2 || 0;
    panotrackFrames += cell.panotrack || 0;
    // Older cells (and any caller still passing pre-coverageKm data) fall back to
    // deriving km from the percentage, which is correct for a single cell and a
    // safe floor for an aggregate.
    coverageKm += Number.isFinite(cell.coverageKm)
      ? cell.coverageKm
      : ((cell.planKm || 0) * (cell.coverage || 0)) / 100;
    weightedComplexity += (cell.complexity || 0) * (cell.areaKm2 || 0);

    if (cell.corridor) {
      corridor.shortKm += cell.corridor.shortKm || 0;
      corridor.mediumKm += cell.corridor.mediumKm || 0;
      corridor.arterialKm += cell.corridor.arterialKm || 0;
      corridor.trunkKm += cell.corridor.trunkKm || 0;
    }
    if (cell.junctions) {
      junctions.deadEnd += cell.junctions.deadEnd || 0;
      junctions.threeWay += cell.junctions.threeWay || 0;
      junctions.fourWay += cell.junctions.fourWay || 0;
      junctions.fivePlus += cell.junctions.fivePlus || 0;
    }
    if (cell.frames) {
      frames.verified += cell.frames.verified || 0;
      frames.defect += cell.frames.defect || 0;
      frames.transit += cell.frames.transit || 0;
      frames.mismatch += cell.frames.mismatch || 0;
    }
  }

  const intersections = junctions.threeWay + junctions.fourWay + junctions.fivePlus;

  return {
    cellCount: list.length,
    planKm: round(planKm),
    areaKm2: round(areaKm2),
    densityKmPerKm2: areaKm2 > 0 ? round(planKm / areaKm2, 1) : 0,
    panotrackFrames,
    coverageKm: round(Math.min(planKm, coverageKm)),
    coveragePercent: planKm > 0 ? round((Math.min(planKm, coverageKm) / planKm) * 100, 1) : 0,
    corridor: {
      shortKm: round(corridor.shortKm),
      mediumKm: round(corridor.mediumKm),
      arterialKm: round(corridor.arterialKm),
      trunkKm: round(corridor.trunkKm)
    },
    junctions,
    frames,
    complexityIndex: areaKm2 > 0 ? round(weightedComplexity / areaKm2, 1) : 0,
    intersectionDensityPerKm2: areaKm2 > 0 ? round(intersections / areaKm2, 1) : 0
  };
}

/** Urban classification from aggregate density and junction density. */
export function classifyUrbanForm(totals: MeshCatchmentTotals): string {
  if (totals.densityKmPerKm2 >= 7 || totals.intersectionDensityPerKm2 >= 12) {
    return 'High Complex Urban';
  }
  if (totals.densityKmPerKm2 >= 3.2 || totals.intersectionDensityPerKm2 >= 5) {
    return 'Moderate Suburban';
  }
  return 'Normal / Arterial Rural';
}

/**
 * Rows for a choropleth class share. The value is read from the same GeoJSON
 * property the map classifies (`METRIC_PROPERTY`), then each cell's `weightOf`
 * is added to the class it falls in. Empty values (`<= 0`) are skipped unless
 * `includeEmptyValues` is set, so the share mirrors the map's transparent case.
 * Each row carries its class colour so the chart can never drift from the
 * legend when a zero-share class is filtered out.
 */
function classShareRows(
  cells: MeshCellData[],
  setting: ChoroplethSetting,
  weightOf: (cell: MeshCellData) => number,
  includeEmptyValues = false
): CatchmentRow[] {
  const prop = METRIC_PROPERTY[setting.metric] || setting.metric;
  const colors = classColors(setting);
  const weights = setting.classes.map(() => 0);
  let total = 0;

  for (const cell of cells) {
    const raw = (cell as unknown as Record<string, unknown>)[prop];
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!includeEmptyValues && (!Number.isFinite(value) || value <= 0)) continue;
    const weight = weightOf(cell);
    if (!(weight > 0)) continue;
    total += weight;
    weights[classIndexFor(setting, Number.isFinite(value) ? value : 0)] += weight;
  }

  return setting.classes
    .map((_c, i) => ({
      label: bandLabel(setting, i),
      percentage: total > 0 ? round((weights[i] / total) * 100, 1) : 0,
      color: colors[i]
    }))
    .filter((r) => r.percentage > 0);
}

/**
 * The second section: share of the scope falling in each choropleth class,
 * coloured with the same class colours the map paints so the columns read
 * against the legend.
 *
 * Weighting is mesh area for every metric except density. Density is already
 * area-normalised in section one, so there it is weighted by road length and the
 * two sections show different cuts of the same classes.
 */
function classShareSection(
  cells: MeshCellData[],
  setting: ChoroplethSetting,
  tab: CatchmentTabKey
): CatchmentSection {
  const weightedByRoad = tab === 'density';
  return {
    title: 'Choropleth class share',
    subtitleRight: weightedByRoad ? '% of road length' : '% of mesh area',
    rows: classShareRows(cells, setting, (cell) =>
      weightedByRoad ? cell.planKm || 0 : cell.areaKm2 || 0
    )
  };
}

const NO_DATA_SECTION: CatchmentSection = {
  title: 'No data',
  subtitleRight: '',
  rows: []
};

/**
 * Builds one category from mesh totals. `settings` is the choropleth settings
 * map; the setting for `tab` drives the density band's class split and the
 * class-share section, so the charts agree with the legend and the map.
 */
export function getMeshCategory(
  totals: MeshCatchmentTotals,
  cells: MeshCellData[],
  tab: CatchmentTabKey,
  settings?: ChoroplethSettingsMap | null
): CatchmentCategory {
  const setting = resolveSetting(settings || {}, tab);
  const km =
    totals.planKm >= 1
      ? `${totals.planKm.toFixed(1)} km`
      : `${Math.round(totals.planKm * 1000)} m`;

  switch (tab) {
    case 'roads': {
      const total = totals.planKm;
      const rows: CatchmentRow[] = [
        { label: 'Dense urban block (<150m)', percentage: pct(totals.corridor.shortKm, total) },
        { label: 'Collector street (150–500m)', percentage: pct(totals.corridor.mediumKm, total) },
        { label: 'Arterial corridor (500m–1.2km)', percentage: pct(totals.corridor.arterialKm, total) },
        { label: 'Trunk / highway (>1.2km)', percentage: pct(totals.corridor.trunkKm, total) }
      ].filter((r): r is CatchmentRow => r.percentage !== null);

      return {
        key: 'roads',
        label: 'Roads',
        primaryValue: total > 0 ? km : '—',
        primaryUnit: total > 0 ? 'road network' : 'no road data',
        sections: [
          rows.length
            ? { title: 'Road corridor classification', subtitleRight: '% of network length', rows }
            : NO_DATA_SECTION,
          classShareSection(cells, setting, 'roads')
        ],
        cellCount: totals.cellCount,
        isEmpty: rows.length === 0
      };
    }

    case 'density': {
      // Section one keeps every cell, including zero-density grid cells, so the
      // donut stays an area share of the whole scope; section two is road-length
      // weighted and excludes empties, so the two sections differ.
      const rows: CatchmentRow[] = classShareRows(
        cells,
        setting,
        (cell) => cell.areaKm2 || 0,
        true
      ).map((r) => ({ ...r, label: `Density ${r.label}` }));

      return {
        key: 'density',
        label: 'Density',
        primaryValue: totals.densityKmPerKm2 > 0 ? totals.densityKmPerKm2.toFixed(1) : '—',
        primaryUnit: totals.densityKmPerKm2 > 0 ? 'km/km²' : 'no density data',
        sections: [
          rows.length
            ? { title: 'Road network density', subtitleRight: '% of mesh area', rows }
            : NO_DATA_SECTION,
          classShareSection(cells, setting, 'density')
        ],
        cellCount: totals.cellCount,
        isEmpty: rows.length === 0
      };
    }

    case 'complexity': {
      const nodes =
        totals.junctions.deadEnd +
        totals.junctions.threeWay +
        totals.junctions.fourWay +
        totals.junctions.fivePlus;
      const rows: CatchmentRow[] = [
        { label: '4 way multi road grid', percentage: pct(totals.junctions.fourWay, nodes) },
        { label: '3 way T junction connector', percentage: pct(totals.junctions.threeWay, nodes) },
        { label: 'Complex 5+ way multi junction', percentage: pct(totals.junctions.fivePlus, nodes) },
        { label: 'Dead end / cul de sac', percentage: pct(totals.junctions.deadEnd, nodes) }
      ].filter((r): r is CatchmentRow => r.percentage !== null);

      return {
        key: 'complexity',
        label: 'Complexity',
        primaryValue: nodes > 0 || totals.planKm > 0 ? classifyUrbanForm(totals) : '—',
        primaryUnit: 'classification',
        sections: [
          rows.length
            ? { title: 'Intersection topology', subtitleRight: '% of junction nodes', rows }
            : NO_DATA_SECTION,
          classShareSection(cells, setting, 'complexity')
        ],
        cellCount: totals.cellCount,
        isEmpty: rows.length === 0
      };
    }

    case 'panotrack': {
      const total = totals.panotrackFrames;
      const rows: CatchmentRow[] = [
        { label: 'Verified active frames', percentage: pct(totals.frames.verified, total) },
        { label: 'QC defect / flagged', percentage: pct(totals.frames.defect, total) },
        { label: 'Transit boundary points', percentage: pct(totals.frames.transit, total) },
        { label: 'Data mismatch / review', percentage: pct(totals.frames.mismatch, total) }
      ].filter((r): r is CatchmentRow => r.percentage !== null);

      return {
        key: 'panotrack',
        label: 'Panotrack',
        primaryValue: total > 0 ? total.toLocaleString() : '—',
        primaryUnit: total > 0 ? 'survey frames' : 'no survey data',
        sections: [
          rows.length
            ? { title: 'Survey capture status', subtitleRight: '% of frames', rows }
            : NO_DATA_SECTION,
          classShareSection(cells, setting, 'panotrack')
        ],
        cellCount: totals.cellCount,
        isEmpty: rows.length === 0
      };
    }

    case 'coverage': {
      const gapKm = round(Math.max(0, totals.planKm - totals.coverageKm));
      const rows: CatchmentRow[] = [
        { label: 'Surveyed road network', percentage: pct(totals.coverageKm, totals.planKm) },
        { label: 'Unsurveyed gap corridor', percentage: pct(gapKm, totals.planKm) }
      ].filter((r): r is CatchmentRow => r.percentage !== null);

      return {
        key: 'coverage',
        label: 'Coverage',
        primaryValue: totals.planKm > 0 ? `${totals.coveragePercent}%` : '—',
        primaryUnit: totals.planKm > 0 ? 'network covered' : 'no plan network',
        sections: [
          rows.length
            ? { title: 'Survey vs Plan Network', subtitleRight: '% of plan length', rows }
            : NO_DATA_SECTION,
          classShareSection(cells, setting, 'coverage')
        ],
        cellCount: totals.cellCount,
        isEmpty: rows.length === 0
      };
    }

    default:
      return getMeshCategory(totals, cells, 'roads', settings);
  }
}

function bandLabel(setting: ChoroplethSetting, index: number): string {
  const cls = setting.classes[index];
  const unit = METRIC_UNIT[setting.metric] || '';
  const upper = cls?.upperBound;
  if (upper === null || upper === undefined) return `> ${setting.classes[index - 1]?.upperBound ?? 0}${unit ? ` ${unit}` : ''}`;
  const lower = index === 0 ? null : setting.classes[index - 1]?.upperBound ?? null;
  const suffix = unit ? ` ${unit}` : '';
  if (lower === null) return `≤ ${upper}${suffix}`;
  return `${lower} – ${upper}${suffix}`;
}

/** The full idle view: every category, aggregated over all cells. */
export function getAllMeshCategories(
  cells: MeshCellData[],
  settings?: ChoroplethSettingsMap | null
): Record<CatchmentTabKey, CatchmentCategory> {
  const totals = summarizeMeshCells(cells);
  const build = (tab: CatchmentTabKey) => getMeshCategory(totals, cells, tab, settings);
  return {
    roads: build('roads'),
    density: build('density'),
    complexity: build('complexity'),
    panotrack: build('panotrack'),
    coverage: build('coverage')
  };
}