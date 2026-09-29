import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectExplorerPanel } from '../ProjectExplorerPanel';
import { calculateBufferAnalytics } from '../../../utils/projectExplorerGeometry';

describe('ProjectExplorerPanel Component (Catchment Demographic Visualizer)', () => {
  const mockAnalytics = calculateBufferAnalytics(
    [101.0, 4.0],
    5000,
    [
      [
        [100.995, 4.0],
        [101.005, 4.0]
      ]
    ],
    [[101.0, 4.0]]
  );

  const defaultProps = {
    active: true,
    onClose: vi.fn(),
    centerA: [101.0, 4.0] as [number, number],
    radius: 5000,
    onRadiusChange: vi.fn(),
    analyticsA: mockAnalytics,
    palette: 'viridis' as const,
    onPaletteChange: vi.fn(),
    onToggleCompareMode: vi.fn(),
    onReset: vi.fn()
  };

  it('renders Details card with categories, subgrid guidance and system charts', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Click any subgrid box to focus & dim')).toBeInTheDocument();
    expect(screen.getByText('Roads')).toBeInTheDocument();
    expect(screen.getByText('Density')).toBeInTheDocument();
    expect(screen.getByText('Complexity')).toBeInTheDocument();
    expect(screen.getByText('Panotrack')).toBeInTheDocument();
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('Road corridor classification')).toBeInTheDocument();
    expect(screen.getAllByText('Dense urban block (<150m)').length).toBeGreaterThan(0);
  });

  it('switches tabs and updates breakdown charts dynamically', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    const complexityTab = screen.getByText('Complexity');
    fireEvent.click(complexityTab);
    expect(screen.getByText('Intersection topology')).toBeInTheDocument();
    expect(screen.getAllByText('4 way multi road grid').length).toBeGreaterThan(0);

    const panotrackTab = screen.getByText('Panotrack');
    fireEvent.click(panotrackTab);
    expect(screen.getByText('Survey capture status')).toBeInTheDocument();

    const coverageTab = screen.getByText('Coverage');
    fireEvent.click(coverageTab);
    expect(screen.getByText('Survey vs Plan Network')).toBeInTheDocument();
  });

  it('renders subgrid focus guidance pill in the bottom control bar', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);
    expect(screen.getByText('Click subgrid to focus & dim')).toBeInTheDocument();
  });

  it('renders bottom-left spectrum bar with 5-category thresholds', () => {
    render(<ProjectExplorerPanel {...defaultProps} colorByMetric="density" />);
    expect(screen.getAllByText('Road network density').length).toBeGreaterThan(0);
    expect(screen.getByText('9.0+')).toBeInTheDocument();
  });

  it('opens custom glassmorphic dropdown and switches analysis metric to update catchment chart', () => {
    const onColorByMetricChange = vi.fn();
    const onPaletteChange = vi.fn();
    render(
      <ProjectExplorerPanel
        {...defaultProps}
        onColorByMetricChange={onColorByMetricChange}
        onPaletteChange={onPaletteChange}
      />
    );

    // Click "Colour by" trigger button to open custom dropdown
    const dropdownTrigger = screen.getByLabelText('Colour by metric selection');
    fireEvent.click(dropdownTrigger);

    // Verify popover menu appears with buffer metric options
    expect(screen.getByText('Choropleth Metric')).toBeInTheDocument();
    const complexityOption = screen.getByText('Urban complexity');
    expect(complexityOption).toBeInTheDocument();

    // Select "Urban complexity" option
    fireEvent.click(complexityOption);

    // Verify callbacks are triggered with matched palette and value
    expect(onColorByMetricChange).toHaveBeenCalledWith('complexity');
    expect(onPaletteChange).toHaveBeenCalledWith('purples');

    // Catchment chart display should immediately update to Complexity data
    expect(screen.getByText('Intersection topology')).toBeInTheDocument();
    expect(screen.getAllByText('4 way multi road grid').length).toBeGreaterThan(0);
  });

  it('supports collapsing and expanding the Details card and renders both breakdowns simultaneously', () => {
    render(<ProjectExplorerPanel {...defaultProps} />);

    // Both breakdowns are displayed cleanly by default
    expect(screen.getByText('Road corridor classification')).toBeInTheDocument();
    expect(screen.getByText('Radial network distribution')).toBeInTheDocument();

    // Click collapse button
    const collapseBtn = screen.getByTitle('Collapse Details');
    fireEvent.click(collapseBtn);

    // Body charts are hidden when collapsed
    expect(screen.queryByText('Road corridor classification')).not.toBeInTheDocument();
    expect(screen.queryByText('Radial network distribution')).not.toBeInTheDocument();

    // Click expand button to restore
    const expandBtn = screen.getByTitle('Expand Details');
    fireEvent.click(expandBtn);
    expect(screen.getByText('Road corridor classification')).toBeInTheDocument();
    expect(screen.getByText('Radial network distribution')).toBeInTheDocument();
  });

  it('renders focused subgrid pill in bottom controls bar when grid is selected', () => {
    const selectedGrid = {
      subgrid: 'N93E70',
      density: 6.85,
      planKm: 18.2,
      areaKm2: 2.65,
      bbox: [102.8, 2.3, 102.85, 2.35] as [number, number, number, number]
    };
    render(<ProjectExplorerPanel {...defaultProps} selectedGrid={selectedGrid} />);
    expect(screen.getByText('Subgrid: N93E70')).toBeInTheDocument();
    expect(screen.getByText('(6.85 km/km²)')).toBeInTheDocument();
  });

  it('renders focused grid details and handles clear focus click', () => {
    const onClearGridSelection = vi.fn();
    const selectedGrid = {
      subgrid: 'N93E70',
      density: 6.85,
      planKm: 18.2,
      areaKm2: 2.65,
      bbox: [102.8, 2.3, 102.85, 2.35] as [number, number, number, number]
    };

    render(
      <ProjectExplorerPanel
        {...defaultProps}
        selectedGrid={selectedGrid}
        onClearGridSelection={onClearGridSelection}
      />
    );

    expect(screen.getByText('Subgrid N93E70 focused')).toBeInTheDocument();
    expect(screen.getByText('Grid N93E70')).toBeInTheDocument();
    expect(screen.getByText('(6.85 km/km² · 18.2 km)')).toBeInTheDocument();

    const clearBtn = screen.getByText('Clear focus');
    fireEvent.click(clearBtn);
    expect(onClearGridSelection).toHaveBeenCalledTimes(1);
  });
});

