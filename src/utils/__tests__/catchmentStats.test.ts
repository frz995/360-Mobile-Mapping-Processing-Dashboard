import { describe, it, expect } from 'vitest';
import {
  summarizeMeshCells,
  classifyUrbanForm,
  getMeshCategory,
  getAllMeshCategories,
  type CatchmentRow
} from '../catchmentStats';
import { classColors, createDefaultSetting } from '../choroplethSettings';
import type { MeshCellData } from '../projectExplorerGeometry';

function cell(over: Partial<MeshCellData> & { subgrid: string }): MeshCellData {
  return {
    density: 0,
    planKm: 0,
    roads: over.planKm ?? 0,
    areaKm2: 1,
    coverage: 0,
    panotrack: 0,
    complexity: 0,
    bbox: [0, 0, 1, 1],
    corridor: { shortKm: 0, mediumKm: 0, arterialKm: 0, trunkKm: 0 },
    junctions: { deadEnd: 0, threeWay: 0, fourWay: 0, fivePlus: 0 },
    frames: { verified: 0, defect: 0, transit: 0, mismatch: 0 },
    ...over
  } as MeshCellData;
}

/** Four cells spread west→east across the grid. */
function spreadCells(): MeshCellData[] {
  return [
    cell({ subgrid: 'A', bbox: [0, 0, 1, 1], planKm: 10, areaKm2: 4, density: 2.5 }),
    cell({ subgrid: 'B', bbox: [1, 0, 2, 1], planKm: 20, areaKm2: 4, density: 5 }),
    cell({ subgrid: 'C', bbox: [2, 0, 3, 1], planKm: 30, areaKm2: 4, density: 7.5 }),
    cell({ subgrid: 'D', bbox: [3, 0, 4, 1], planKm: 40, areaKm2: 4, density: 10 })
  ];
}

const rowPct = (rows: CatchmentRow[], label: string): number | undefined =>
  rows.find((r) => r.label === label)?.percentage;

describe('summarizeMeshCells', () => {
  it('is area-weighted for density rather than a mean of per-cell densities', () => {
    const totals = summarizeMeshCells([
      cell({ subgrid: 'small', planKm: 5, areaKm2: 0.5, density: 10 }),
      cell({ subgrid: 'large', planKm: 20, areaKm2: 10, density: 2 })
    ]);
    // sum(planKm)/sum(areaKm2) = 25/10.5 = 2.38, not (10+2)/2 = 6.
    expect(totals.planKm).toBe(25);
    expect(totals.areaKm2).toBe(10.5);
    expect(totals.densityKmPerKm2).toBe(2.4);
  });

  it('sums coverageKm rather than averaging coverage percentages', () => {
    const totals = summarizeMeshCells([
      cell({ subgrid: 'A', planKm: 10, coverage: 100, coverageKm: 10 }),
      cell({ subgrid: 'B', planKm: 30, coverage: 10, coverageKm: 3 })
    ]);
    expect(totals.coverageKm).toBe(13);
    expect(totals.coveragePercent).toBe(32.5);
  });

  it('derives coverageKm from the percentage when a cell predates the field', () => {
    const totals = summarizeMeshCells([cell({ subgrid: 'A', planKm: 20, coverage: 25 })]);
    expect(totals.coverageKm).toBe(5);
  });

  it('caps coverageKm at planKm so a bad cell cannot exceed the network', () => {
    const totals = summarizeMeshCells([cell({ subgrid: 'A', planKm: 10, coverageKm: 40 })]);
    expect(totals.coverageKm).toBe(10);
    expect(totals.coveragePercent).toBe(100);
  });

  it('sums per-cell corridor, junction and frame breakdowns', () => {
    const totals = summarizeMeshCells([
      cell({
        subgrid: 'A',
        planKm: 10,
        areaKm2: 2,
        panotrack: 30,
        corridor: { shortKm: 1, mediumKm: 2, arterialKm: 3, trunkKm: 4 },
        junctions: { deadEnd: 5, threeWay: 4, fourWay: 3, fivePlus: 2 },
        frames: { verified: 10, defect: 8, transit: 7, mismatch: 5 }
      }),
      cell({
        subgrid: 'B',
        planKm: 10,
        areaKm2: 2,
        panotrack: 10,
        corridor: { shortKm: 0, mediumKm: 0, arterialKm: 0, trunkKm: 0 },
        junctions: { deadEnd: 1, threeWay: 1, fourWay: 1, fivePlus: 0 },
        frames: { verified: 0, defect: 0, transit: 0, mismatch: 0 }
      })
    ]);

    expect(totals.corridor).toEqual({ shortKm: 1, mediumKm: 2, arterialKm: 3, trunkKm: 4 });
    expect(totals.junctions).toEqual({ deadEnd: 6, threeWay: 5, fourWay: 4, fivePlus: 2 });
    expect(totals.frames).toEqual({ verified: 10, defect: 8, transit: 7, mismatch: 5 });
    expect(totals.panotrackFrames).toBe(40);
  });

  it('reports zero density and zero coverage when there is no area or network', () => {
    const totals = summarizeMeshCells([]);
    expect(totals.cellCount).toBe(0);
    expect(totals.densityKmPerKm2).toBe(0);
    expect(totals.coveragePercent).toBe(0);
  });
});

describe('classifyUrbanForm', () => {
  const base = summarizeMeshCells([]);

  it('labels a dense scope as high complex urban', () => {
    const totals = summarizeMeshCells([
      cell({ subgrid: 'A', planKm: 80, areaKm2: 4, junctions: { deadEnd: 0, threeWay: 40, fourWay: 20, fivePlus: 0 } })
    ]);
    expect(classifyUrbanForm(totals)).toBe('High Complex Urban');
  });

  it('labels an arterial rural scope as normal', () => {
    expect(classifyUrbanForm(base)).toBe('Normal / Arterial Rural');
  });
});

describe('getMeshCategory', () => {
  const cells = spreadCells();
  const totals = summarizeMeshCells(cells);

  it('omits rows instead of printing a fabricated split when the denominator is zero', () => {
    const emptyTotals = summarizeMeshCells([cell({ subgrid: 'A', planKm: 0, areaKm2: 0 })]);
    const category = getMeshCategory(emptyTotals, [cell({ subgrid: 'A' })], 'roads');

    expect(category.sections[0].rows).toHaveLength(0);
    expect(category.isEmpty).toBe(true);
    expect(category.primaryValue).toBe('—');
  });

  it('shows the complexity tab as a classification label, not a fabricated index', () => {
    const withNodes = summarizeMeshCells([
      cell({
        subgrid: 'A',
        planKm: 40,
        areaKm2: 4,
        junctions: { deadEnd: 2, threeWay: 8, fourWay: 6, fivePlus: 4 }
      })
    ]);
    const category = getMeshCategory(withNodes, cells, 'complexity');
    expect(category.primaryUnit).toBe('classification');
    expect(category.primaryValue).toBe(classifyUrbanForm(withNodes));
    expect(rowPct(category.sections[0].rows, '4 way multi road grid')).toBe(30);
  });

  it('weights the density band split by mesh area, not cell count', () => {
    const uneven = [
      cell({ subgrid: 'big', density: 1, areaKm2: 90 }),
      cell({ subgrid: 'small', density: 1, areaKm2: 10 })
    ];
    const t = summarizeMeshCells(uneven);
    const category = getMeshCategory(t, uneven, 'density');
    const rows = category.sections[0].rows;
    const first = rows[0];
    expect(first).toBeDefined();
    // Both cells share one density, so the split is 90/10 by area.
    expect(rows.reduce((a, r) => a + r.percentage, 0)).toBeCloseTo(100, 0);
  });

  it('reports surveyed vs unsurveyed coverage rows from real lengths', () => {
    const covered = summarizeMeshCells([
      cell({ subgrid: 'A', planKm: 40, coverageKm: 30 })
    ]);
    const category = getMeshCategory(covered, cells, 'coverage');
    expect(rowPct(category.sections[0].rows, 'Surveyed road network')).toBe(75);
    expect(rowPct(category.sections[0].rows, 'Unsurveyed gap corridor')).toBe(25);
    expect(category.primaryValue).toBe('75%');
  });

  it('counts panotrack frames as a total, not a percentage hero', () => {
    const surveyed = summarizeMeshCells([cell({ subgrid: 'A', planKm: 5, panotrack: 1234 })]);
    const category = getMeshCategory(surveyed, cells, 'panotrack');
    expect(category.primaryValue).toBe('1,234');
    expect(category.primaryUnit).toBe('survey frames');
  });

  it('labels the second section as a choropleth class share', () => {
    const category = getMeshCategory(totals, cells, 'roads');
    expect(category.sections[1].title).toBe('Choropleth class share');
    expect(category.sections[1].subtitleRight).toBe('% of mesh area');
  });
});

describe('choropleth class share', () => {
  it('weights the roads class share by mesh area and stamps the class colour', () => {
    const uneven = [
      cell({ subgrid: 'big', bbox: [0, 0, 1, 1], roads: 1, areaKm2: 90 }),
      cell({ subgrid: 'small', bbox: [1, 0, 2, 1], roads: 100, areaKm2: 10 })
    ];
    const t = summarizeMeshCells(uneven);
    const rows = getMeshCategory(t, uneven, 'roads').sections[1].rows;
    // roads 1 -> class 0 (<= 5), roads 100 -> class 4 (> 50); split by area.
    expect(rows.map((r) => r.percentage)).toEqual([90, 10]);
    expect(rows[0].label).toBe('≤ 5 km length');
    const colors = classColors(createDefaultSetting('roads', 'greens'));
    expect(rows.map((r) => r.color)).toEqual([colors[0], colors[4]]);
  });

  it('weights the density class share by road length, not area', () => {
    const uneven = [
      cell({ subgrid: 'big', bbox: [0, 0, 1, 1], density: 1, planKm: 10, areaKm2: 100 }),
      cell({ subgrid: 'small', bbox: [1, 0, 2, 1], density: 5, planKm: 30, areaKm2: 1 })
    ];
    const t = summarizeMeshCells(uneven);
    const section = getMeshCategory(t, uneven, 'density').sections[1];
    expect(section.subtitleRight).toBe('% of road length');
    expect(section.rows.map((r) => r.percentage)).toEqual([25, 75]);
  });

  it('excludes cells with no positive value from the class share', () => {
    const withEmpty = [
      cell({ subgrid: 'A', bbox: [0, 0, 1, 1], roads: 0, areaKm2: 50 }),
      cell({ subgrid: 'B', bbox: [1, 0, 2, 1], roads: 10, areaKm2: 50 })
    ];
    const t = summarizeMeshCells(withEmpty);
    const rows = getMeshCategory(t, withEmpty, 'roads').sections[1].rows;
    // The empty cell is not counted as class 0; all weight is in the roads=10 class.
    expect(rows).toHaveLength(1);
    expect(rows[0].percentage).toBe(100);
  });
});

describe('getAllMeshCategories', () => {
  it('returns every category from one aggregation pass', () => {
    const cells = spreadCells();
    const all = getAllMeshCategories(cells);

    expect(Object.keys(all).sort()).toEqual(
      ['complexity', 'coverage', 'density', 'panotrack', 'roads'].sort()
    );
    expect(all.roads.cellCount).toBe(4);
    expect(all.roads.primaryValue).toBe('100.0 km');
    expect(all.density.primaryValue).toBe('6.3');
  });

  it('gives an empty scope empty categories rather than placeholder numbers', () => {
    const all = getAllMeshCategories([]);
    expect(all.roads.isEmpty).toBe(true);
    expect(all.panotrack.isEmpty).toBe(true);
    expect(all.roads.cellCount).toBe(0);
  });
});