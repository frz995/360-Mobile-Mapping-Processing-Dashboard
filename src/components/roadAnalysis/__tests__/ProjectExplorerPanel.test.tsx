import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectExplorerPanel } from '../ProjectExplorerPanel';
import { EXPLORER_DONUT_COLORS } from '../ExplorerCharts';
import { getAllMeshCategories } from '../../../utils/catchmentStats';
import type { ChoroplethSettingsMap } from '../../../utils/choroplethSettings';
import type { MeshCellData } from '../../../utils/projectExplorerGeometry';

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
    frames: { verified: 0, defect: 0, transit: 0, mismatch: 0, missing: 0 },
    ...over
  } as MeshCellData;
}

/** Four populated cells plus one empty, so both populated and empty rows exist. */
const meshCells: MeshCellData[] = [
  cell({
    subgrid: 'SG01',
    bbox: [0, 0, 1, 1],
    planKm: 12,
    areaKm2: 4,
    density: 3,
    coverage: 80,
    coverageKm: 9.6,
    panotrack: 300,
    corridor: { shortKm: 4, mediumKm: 5, arterialKm: 2, trunkKm: 1 },
    junctions: { deadEnd: 6, threeWay: 8, fourWay: 4, fivePlus: 2 },
    frames: { verified: 150, defect: 60, transit: 50, mismatch: 40, missing: 0 }
  }),
  cell({
    subgrid: 'SG02',
    bbox: [1, 0, 2, 1],
    planKm: 8,
    areaKm2: 3,
    density: 2.7,
    coverage: 40,
    coverageKm: 3.2,
    panotrack: 100,
    corridor: { shortKm: 3, mediumKm: 4, arterialKm: 1, trunkKm: 0 },
    junctions: { deadEnd: 4, threeWay: 4, fourWay: 2, fivePlus: 0 },
    frames: { verified: 60, defect: 20, transit: 10, mismatch: 10, missing: 0 }
  }),
  cell({
    subgrid: 'SG03',
    bbox: [2, 0, 3, 1],
    planKm: 20,
    areaKm2: 5,
    density: 4,
    coverage: 100,
    coverageKm: 20,
    panotrack: 0,
    corridor: { shortKm: 6, mediumKm: 8, arterialKm: 4, trunkKm: 2 },
    junctions: { deadEnd: 2, threeWay: 6, fourWay: 6, fivePlus: 3 },
    frames: { verified: 0, defect: 0, transit: 0, mismatch: 0, missing: 0 }
  }),
  cell({ subgrid: 'SG04', bbox: [3, 0, 4, 1] })
];

describe('ProjectExplorerPanel', () => {
  const defaultProps = {
    active: true,
    onClose: vi.fn(),
    categories: getAllMeshCategories(meshCells),
    scopeLabel: 'all subgrids',
    palette: 'greens' as const,
    onPaletteChange: vi.fn(),
    onReset: vi.fn()
  };

  it('renders the Details card with all five category pills and mesh-derived rows', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);

    expect(screen.getByText('Details')).toBeInTheDocument();
    for (const label of ['Roads', 'Density', 'Complexity', 'Panotrack', 'Coverage']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Road corridor classification')).toBeInTheDocument();
    expect(screen.getAllByText('Dense urban block (<150m)').length).toBeGreaterThan(0);
  });

  it('colours the donut with the shared segment palette on every tab', () => {
    const { container } = render(<ProjectExplorerPanel {...defaultProps} />);
    const firstSliceFill = () =>
      container.querySelector('path.explorer-donut-slice')?.getAttribute('fill');

    expect(firstSliceFill()).toBe(EXPLORER_DONUT_COLORS[0]);

    fireEvent.click(screen.getByText('Density'));
    expect(firstSliceFill()).toBe(EXPLORER_DONUT_COLORS[0]);
  });

  it('colours the class-share columns with the active choropleth class colours', () => {
    const settings: ChoroplethSettingsMap = {
      roads: {
        metric: 'roads',
        method: 'manual',
        alpha: 0.85,
        reverse: false,
        classes: [
          { upperBound: 15, color: '#111111' },
          { upperBound: null, color: '#222222' }
        ]
      }
    };
    const categories = getAllMeshCategories(meshCells, settings);
    const { container } = render(
      <ProjectExplorerPanel
        {...defaultProps}
        categories={categories}
        colorByMetric="roads"
        choroplethSettings={settings}
      />
    );
    const fills = Array.from(
      container.querySelectorAll('rect.explorer-bar-segment')
    ).map((bar) => bar.getAttribute('fill'));

    // SG01 (12) and SG02 (8) fall in <= 15; SG03 (20) in > 15; SG04 has no roads.
    expect(fills).toEqual(['#111111', '#222222']);
  });

  it('states the aggregation scope instead of duplicating the focus banner', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    expect(screen.getByText('Scope: all subgrids')).toBeInTheDocument();
    expect(screen.queryByText('Subgrid SG01 focused')).not.toBeInTheDocument();
    expect(screen.queryByText('Click any subgrid box to focus & dim')).not.toBeInTheDocument();
  });

  describe('grid provenance', () => {
    it('states the grid the density and complexity values were measured over', () => {
      render(
        <ProjectExplorerPanel
          {...defaultProps}
          gridInfo={{ source: 'imported', cellCount: 25, cellKm: 5, areaFloored: false, declared: false, cellKmSource: 'measured' }}
        />
      );

      expect(
        screen.getByText('Imported grid · ~5 km · 25 cells')
      ).toBeInTheDocument();
    });

    it('distinguishes a derived grid so the resolution is never ambiguous', () => {
      render(
        <ProjectExplorerPanel
          {...defaultProps}
          gridInfo={{ source: 'derived', cellCount: 225, cellKm: 3.9, areaFloored: false, declared: false, cellKmSource: 'auto' }}
        />
      );

      expect(
        screen.getByText('Derived grid · ~3.9 km · 225 cells')
      ).toBeInTheDocument();
    });

    it('warns when the area floor makes density read low, and stays quiet otherwise', () => {
      const { rerender } = render(
        <ProjectExplorerPanel
          {...defaultProps}
          gridInfo={{ source: 'derived', cellCount: 12, cellKm: 1, areaFloored: true, declared: false, cellKmSource: 'auto' }}
        />
      );
      expect(screen.getByText(/under 0.5 km²/i)).toBeInTheDocument();

      rerender(
        <ProjectExplorerPanel
          {...defaultProps}
          gridInfo={{ source: 'derived', cellCount: 12, cellKm: 1, areaFloored: false, declared: false, cellKmSource: 'auto' }}
        />
      );
      expect(screen.queryByText(/under 0.5 km²/i)).not.toBeInTheDocument();
    });

    it('omits the provenance line when no grid has been measured yet', () => {
      render(<ProjectExplorerPanel {...defaultProps} gridInfo={null} />);
      expect(screen.queryByText(/grid ·/)).not.toBeInTheDocument();
    });

    describe('grid size control', () => {
      const derived = {
        source: 'derived' as const,
        cellCount: 225,
        cellKm: 3.9,
        areaFloored: false,
        declared: false,
        cellKmSource: 'auto' as const
      };
      const imported = {
        source: 'imported' as const,
        cellCount: 25,
        cellKm: 5,
        areaFloored: false,
        declared: false,
        cellKmSource: 'measured' as const
      };

      it('offers the presets and hides the control when no handler is given', () => {
        const { unmount } = render(<ProjectExplorerPanel {...defaultProps} gridInfo={derived} />);
        expect(screen.queryByLabelText('Grid cell size')).not.toBeInTheDocument();
        unmount();

        render(<ProjectExplorerPanel {...defaultProps} gridInfo={derived} onGridSpecChange={vi.fn()} />);
        const select = screen.getByLabelText('Grid cell size') as HTMLSelectElement;
        expect(Array.from(select.options).map((o) => o.value)).toEqual([
          'auto',
          '2',
          '3.9',
          '5',
          '10',
          'custom'
        ]);
        expect(screen.getByText('Grid size')).toBeInTheDocument();
      });

      it('relabels itself for an imported grid, where the value means cell area', () => {
        render(<ProjectExplorerPanel {...defaultProps} gridInfo={imported} onGridSpecChange={vi.fn()} />);
        expect(screen.getByText('Declared cell size')).toBeInTheDocument();
        expect(screen.queryByText('Grid size')).not.toBeInTheDocument();
      });

      it('sends the declared size to the matching field for the active grid', () => {
        const onChange = vi.fn();
        const { rerender } = render(
          <ProjectExplorerPanel
            {...defaultProps}
            gridInfo={derived}
            gridSpec={{ derivedCellKm: null, importedCellKm: null }}
            onGridSpecChange={onChange}
          />
        );

        fireEvent.change(screen.getByLabelText('Grid cell size'), { target: { value: '10' } });
        expect(onChange).toHaveBeenCalledWith({ derivedCellKm: 10, importedCellKm: null });

        onChange.mockClear();
        rerender(
          <ProjectExplorerPanel
            {...defaultProps}
            gridInfo={imported}
            gridSpec={{ derivedCellKm: null, importedCellKm: null }}
            onGridSpecChange={onChange}
          />
        );
        fireEvent.change(screen.getByLabelText('Grid cell size'), { target: { value: '10' } });
        expect(onChange).toHaveBeenCalledWith({ derivedCellKm: null, importedCellKm: 10 });
      });

      it('resets to auto, clearing both fields', () => {
        const onChange = vi.fn();
        render(
          <ProjectExplorerPanel
            {...defaultProps}
            gridInfo={derived}
            gridSpec={{ derivedCellKm: 5, importedCellKm: null }}
            onGridSpecChange={onChange}
          />
        );

        // The declared value is reflected in the select, not 'auto'.
        expect((screen.getByLabelText('Grid cell size') as HTMLSelectElement).value).toBe('5');

        fireEvent.change(screen.getByLabelText('Grid cell size'), { target: { value: 'auto' } });
        expect(onChange).toHaveBeenCalledWith({ derivedCellKm: null, importedCellKm: null });
      });

      it('accepts a custom size and rejects one outside the range', () => {
        const onChange = vi.fn();
        render(
          <ProjectExplorerPanel
            {...defaultProps}
            gridInfo={derived}
            gridSpec={{ derivedCellKm: null, importedCellKm: null }}
            onGridSpecChange={onChange}
          />
        );

        fireEvent.change(screen.getByLabelText('Grid cell size'), { target: { value: 'custom' } });
        const input = screen.getByLabelText('Custom grid size in kilometres');
        fireEvent.change(input, { target: { value: '7.5' } });
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledWith({ derivedCellKm: 7.5, importedCellKm: null });

        onChange.mockClear();
        fireEvent.change(screen.getByLabelText('Grid cell size'), { target: { value: 'custom' } });
        const bad = screen.getByLabelText('Custom grid size in kilometres');
        fireEvent.change(bad, { target: { value: '900' } });
        fireEvent.blur(bad);
        // An unusable value is dropped rather than applied.
        expect(onChange).not.toHaveBeenCalled();
      });

      it('shows a declared size in the provenance chip', () => {
        render(
          <ProjectExplorerPanel
            {...defaultProps}
            gridInfo={{ ...derived, declared: true, cellKmSource: 'declared', cellKm: 5 }}
            gridSpec={{ derivedCellKm: 5, importedCellKm: null }}
            onGridSpecChange={vi.fn()}
          />
        );

        expect(screen.getByText(/Declared 5 × 5 km/)).toBeInTheDocument();
      });
    });
  });

  it('switches categories and reads each category from the aggregated mesh data', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);

    fireEvent.click(screen.getByText('Complexity'));
    expect(screen.getByText('Intersection topology')).toBeInTheDocument();
    expect(screen.getAllByText('4 way multi road grid').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Panotrack'));
    expect(screen.getByText('Survey capture status')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Coverage'));
    expect(screen.getByText('Survey vs Plan Network')).toBeInTheDocument();
  });

  it('shows the second section as a choropleth class share, never radial buffer zones', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    expect(screen.getByText('Choropleth class share')).toBeInTheDocument();
    expect(screen.queryByText('Distance from mesh centre')).not.toBeInTheDocument();
    expect(screen.queryByText('Radial network distribution')).not.toBeInTheDocument();
    expect(screen.queryByText('Radial Buffer Zones')).not.toBeInTheDocument();
  });

  it('reports the number of mesh cells behind the numbers', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    expect(screen.getByText(/Aggregated over all 4 mesh cells in all subgrids/)).toBeInTheDocument();
  });

  it('shows the focused subgrid pill in the bottom bar and a single-cell scope line', () => {
    const selectedGrid = {
      subgrid: 'SG01',
      density: 3,
      planKm: 12,
      areaKm2: 4,
      bbox: [0, 0, 1, 1] as [number, number, number, number]
    };
    render(<ProjectExplorerPanel {...defaultProps} selectedGrid={selectedGrid} scopeLabel="SG01" />);

    expect(screen.getByText('Subgrid: SG01')).toBeInTheDocument();
    expect(screen.getByText('Scope: SG01')).toBeInTheDocument();
    expect(screen.queryByText('Grid SG01')).not.toBeInTheDocument();
  });

  it('clears focus from the bottom pill', () => {
    const onClearGridSelection = vi.fn();
    const selectedGrid = {
      subgrid: 'SG01',
      density: 3,
      planKm: 12,
      areaKm2: 4,
      bbox: [0, 0, 1, 1] as [number, number, number, number]
    };
    render(
      <ProjectExplorerPanel
        {...defaultProps}
        selectedGrid={selectedGrid}
        onClearGridSelection={onClearGridSelection}
      />
    );

    fireEvent.click(screen.getByLabelText('Clear focus'));
    expect(onClearGridSelection).toHaveBeenCalledTimes(1);
  });

  it('omits rows for a category with no real denominator instead of showing a fake split', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    fireEvent.click(screen.getByText('Panotrack'));
    // SG03 has plan length but zero frames, and SG04 is empty; the whole scope
    // still has 400 frames, so rows exist from the cells that do have them.
    expect(screen.getByText('Verified active frames')).toBeInTheDocument();
  });

  it('renders an empty scope without fabricated rows or values', () => {
    const empty = getAllMeshCategories([]);
    render(
      <ProjectExplorerPanel {...defaultProps} categories={empty} scopeLabel="no mesh yet" />
    );

    expect(screen.getAllByText('No data').length).toBeGreaterThan(0);
    expect(screen.getByText(/Aggregated over all 0 mesh cells in no mesh yet/)).toBeInTheDocument();
    expect(screen.queryByText('25%')).not.toBeInTheDocument();
  });

  it('collapses and expands the card, hiding both sections', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    expect(screen.getByText('Road corridor classification')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Collapse Details'));
    expect(screen.queryByText('Road corridor classification')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Expand Details'));
    expect(screen.getByText('Road corridor classification')).toBeInTheDocument();
  });

  it('renders the class legend from the active choropleth setting', () => {
    render(<ProjectExplorerPanel {...defaultProps} colorByMetric="density" />);
    expect(screen.getAllByText('Road network density').length).toBeGreaterThan(0);
    expect(screen.getByText('1.5')).toBeInTheDocument();
    expect(screen.getByText('9+')).toBeInTheDocument();
    expect(screen.getByText('Class 1–5')).toBeInTheDocument();
  });

  it('renders legend breaks from a saved choropleth setting', () => {
    const settings: ChoroplethSettingsMap = {
      coverage: {
        metric: 'coverage',
        method: 'manual',
        alpha: 0.85,
        reverse: false,
        classes: [
          { upperBound: 30, color: '#111111' },
          { upperBound: 60, color: '#222222' },
          { upperBound: null, color: '#333333' }
        ]
      }
    };
    const { container } = render(
      <ProjectExplorerPanel
        {...defaultProps}
        categories={getAllMeshCategories(meshCells, settings)}
        colorByMetric="coverage"
        choroplethSettings={settings}
      />
    );
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('60+')).toBeInTheDocument();
    expect(screen.queryByText('20')).not.toBeInTheDocument();
    expect(screen.getByText('Class 1–3')).toBeInTheDocument();

    // The same saved colours reach the class-share bars: SG02 (40) and SG03
    // (100) land in class 2 and class 3 respectively.
    const fills = Array.from(
      container.querySelectorAll('rect.explorer-bar-segment')
    ).map((bar) => bar.getAttribute('fill'));
    expect(fills).toEqual(['#222222', '#333333']);
  });

  it('switches the analysed metric from the Colour by dropdown', () => {
    const onColorByMetricChange = vi.fn();
    const onPaletteChange = vi.fn();
    render(
      <ProjectExplorerPanel
        {...defaultProps}
        onColorByMetricChange={onColorByMetricChange}
        onPaletteChange={onPaletteChange}
      />
    );

    fireEvent.click(screen.getByLabelText('Colour by metric selection'));
    expect(screen.getByText('Choropleth Metric')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Urban complexity'));
    expect(onColorByMetricChange).toHaveBeenCalledWith('complexity');
    expect(onPaletteChange).toHaveBeenCalledWith('purples');
    expect(screen.getByText('Intersection topology')).toBeInTheDocument();
  });

  it('resets without touching a buffer radius', () => {
    const onReset = vi.fn();
    render(<ProjectExplorerPanel {...defaultProps} onReset={onReset} />);
    fireEvent.click(screen.getByTitle('Reset Explorer focus'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while inactive', () => {
    render(<ProjectExplorerPanel {...defaultProps} active={false} />);
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });
});