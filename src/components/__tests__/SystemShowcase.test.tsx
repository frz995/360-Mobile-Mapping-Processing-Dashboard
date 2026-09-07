import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SystemShowcase } from '../SystemShowcase';

describe('SystemShowcase Component', () => {
  it('renders GeoSphere 360 title, branding, and active module', () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    expect(screen.getByText(/GeoSphere 360° Mobile Mapping Platform/i)).toBeInTheDocument();
    expect(screen.getByText(/Mobile Mapping Data Management System/i)).toBeInTheDocument();
    expect(screen.getByText(/Spatial Trajectory Processing & Quality Assurance Pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Executive Dashboard & Spatial Telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/Execution Flow/i)).toBeInTheDocument();
    expect(screen.getByText(/Architecture & System Specs/i)).toBeInTheDocument();
  });

  it('triggers onEnterDashboard with "auth" when Sign In button is clicked', () => {
    const handleEnter = vi.fn();
    render(<SystemShowcase onEnterDashboard={handleEnter} />);

    const signInBtn = screen.getByRole('button', { name: /Sign In/i });
    fireEvent.click(signInBtn);

    expect(handleEnter).toHaveBeenCalledWith('auth');
  });

  it('triggers onEnterDashboard with the active module when Launch Workspace is clicked', () => {
    const handleEnter = vi.fn();
    render(<SystemShowcase onEnterDashboard={handleEnter} />);

    const launchBtn = screen.getByRole('button', { name: /Launch Workspace/i });
    fireEvent.click(launchBtn);

    expect(handleEnter).toHaveBeenCalledWith('webgis');
  });

  it('allows switching modules using module navigation pills', () => {
    vi.useFakeTimers();
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    // Click 'Data Management' module pill
    const dataPill = screen.getByRole('button', { name: /^Data Management$/i });
    fireEvent.click(dataPill);

    // Advance timers for 220ms animation delay inside act
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText(/Subgrid Masterlist, Daily Collections & Folder Verification/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders execution flow steps cleanly without card box wrappers', () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    expect(screen.getByText('01. Ingest')).toBeInTheDocument();
    expect(screen.getByText(/Parse GPS\/GNSS trajectory coordinates/i)).toBeInTheDocument();
  });
});
