import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoadAnalysis3DStudio } from '../RoadAnalysis3DStudio';

describe('RoadAnalysis3DStudio Component', () => {
  const defaultProps = {
    show3D: true,
    onToggle3D: vi.fn(),
    lightingPreset: 'day' as const,
    onSelectLighting: vi.fn(),
    colorTheme: 'default' as const,
    onSelectTheme: vi.fn(),
    heightScale: 1.0,
    onChangeHeightScale: vi.fn(),
    currentPitch: 60,
    onSetPitch: vi.fn(),
    isOrbiting: false,
    onToggleOrbit: vi.fn(),
    onResetBearing: vi.fn(),
    onClose: vi.fn()
  };

  it('renders the 3D Studio title, lighting presets, and color themes', () => {
    render(<RoadAnalysis3DStudio {...defaultProps} />);

    expect(screen.getByText('3D Map Studio')).toBeInTheDocument();

    // Verify lighting buttons
    expect(screen.getByText('Dawn')).toBeInTheDocument();
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('Dusk')).toBeInTheDocument();
    expect(screen.getByText('Night')).toBeInTheDocument();

    // Verify themes
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Warm')).toBeInTheDocument();
    expect(screen.getByText('Ocean')).toBeInTheDocument();
    expect(screen.getByText('Mono')).toBeInTheDocument();
    expect(screen.getByText('Vivid')).toBeInTheDocument();
    expect(screen.getByText('Faded')).toBeInTheDocument();
  });

  it('calls onSelectLighting when a lighting preset is clicked', () => {
    render(<RoadAnalysis3DStudio {...defaultProps} />);
    const duskBtn = screen.getByText('Dusk');
    fireEvent.click(duskBtn);
    expect(defaultProps.onSelectLighting).toHaveBeenCalledWith('dusk');
  });

  it('calls onSelectTheme when a color theme is clicked', () => {
    render(<RoadAnalysis3DStudio {...defaultProps} />);
    const warmBtn = screen.getByText('Warm');
    fireEvent.click(warmBtn);
    expect(defaultProps.onSelectTheme).toHaveBeenCalledWith('warm');
  });

  it('calls onSetPitch when a pitch button is clicked', () => {
    render(<RoadAnalysis3DStudio {...defaultProps} />);
    const skylineBtn = screen.getByText('75° Sky');
    fireEvent.click(skylineBtn);
    expect(defaultProps.onSetPitch).toHaveBeenCalledWith(75);
  });
});
