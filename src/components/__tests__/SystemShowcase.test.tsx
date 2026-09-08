import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { SystemShowcase } from '../SystemShowcase';

afterEach(() => {
  vi.useRealTimers();
});

describe('SystemShowcase Component', () => {
  it('renders GeoSphere 360 title, branding, and active module', () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    expect(screen.getByText(/GeoSphere 360° Mobile Mapping Platform/i)).toBeInTheDocument();
    expect(screen.getByText(/Mobile Mapping Data Management System/i)).toBeInTheDocument();
    expect(screen.getByText(/Spatial Trajectory Processing & Quality Assurance Pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Executive Dashboard & Spatial Telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/Workflow/i)).toBeInTheDocument();
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

  it('triggers Panotrack district 3D popup when clicking bottom-left geodetic card in 3D Earth view', async () => {
    render(
      <SystemShowcase
        onEnterDashboard={vi.fn()}
        projectSettings={{
          projectName: 'Johor Mobile Mapping',
          projectBoundary: {
            districtIds: ['segamat', 'tangkak'],
            districtNames: ['Segamat', 'Tangkak'],
            regionId: 'johor',
            regionName: 'Johor',
            bbox: [102.509, 2.29, 103.04, 2.65]
          }
        }}
      />
    );

    // Switch to 3D Earth view mode
    const earthTab = screen.getByRole('button', { name: /3D Earth/i });
    fireEvent.click(earthTab);

    // Click bottom-left geodetic telemetry card
    const geodeticCard = screen.getByTitle(/Click to rotate globe and center on project location/i);
    fireEvent.click(geodeticCard);

    // Verify region-based district popup HUD is displayed (1 region, ALL districts nested inside)
    const popupDialog = screen.getByRole('dialog', { name: /Johor Project Area/i });
    expect(popupDialog).toBeInTheDocument();
    expect(within(popupDialog).getByText(/Project Area/i)).toBeInTheDocument();
    expect(within(popupDialog).getByRole('heading', { name: 'Johor' })).toBeInTheDocument();
    expect(within(popupDialog).getByText('Segamat')).toBeInTheDocument();
    expect(within(popupDialog).getByText('Tangkak')).toBeInTheDocument();
    expect(within(popupDialog).getByText(/mapping frames/i)).toBeInTheDocument();
    expect(within(popupDialog).getByText(/platform POIs/i)).toBeInTheDocument();
    expect(within(popupDialog).getByText(/surveyed route/i)).toBeInTheDocument();
    expect(within(popupDialog).getByText(/pipeline SLA/i)).toBeInTheDocument();
    expect(within(popupDialog).queryByText(/PANOTRACK STREAM/i)).not.toBeInTheDocument();

    // Verify closing popup (animated close, so the dialog unmounts shortly after)
    const closeBtn = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Johor Project Area/i })).not.toBeInTheDocument();
    });
  });

  it('shows every district of the committed region when no districtIds are saved (boundary-driven overview)', async () => {
    render(
      <SystemShowcase
        onEnterDashboard={vi.fn()}
        projectSettings={{
          projectName: 'Johor Region-Wide',
          projectBoundary: {
            districtIds: [],
            regionId: 'johor',
            regionName: 'Johor',
            bbox: [102.509, 2.29, 104.0, 2.65]
          }
        }}
      />
    );

    const earthTab = screen.getByRole('button', { name: /3D Earth/i });
    fireEvent.click(earthTab);

    const geodeticCard = screen.getByTitle(/Click to rotate globe and center on project location/i);
    fireEvent.click(geodeticCard);

    const popupDialog = screen.getByRole('dialog', { name: /Johor Project Area/i });

    // The whole state's districts become the data footprint (nothing hardcoded to one)
    expect(within(popupDialog).getByText('Segamat')).toBeInTheDocument();
    expect(within(popupDialog).getByText('Tangkak')).toBeInTheDocument();
    expect(within(popupDialog).getByText('Johor Bahru')).toBeInTheDocument();
  });

  it('merges all saved boundary signals so Tangkak is never dropped when districtIds are partial', async () => {
    render(
      <SystemShowcase
        onEnterDashboard={vi.fn()}
        projectSettings={{
          projectName: 'Johor Mixed-Save',
          projectBoundary: {
            // districtIds only carry Segamat, but districtNames + geojson still carry Tangkak.
            districtIds: ['segamat'],
            districtNames: ['Segamat', 'Tangkak'],
            regionId: 'johor',
            regionName: 'Johor',
            bbox: [102.509, 2.29, 103.04, 2.65],
            geojson: {
              type: 'FeatureCollection',
              features: [
                { id: 'segamat', type: 'Feature', properties: { name: 'Segamat' }, geometry: { type: 'MultiPolygon', coordinates: [] } },
                { id: 'tangkak', type: 'Feature', properties: { name: 'Tangkak' }, geometry: { type: 'MultiPolygon', coordinates: [] } }
              ]
            }
          }
        }}
      />
    );

    const earthTab = screen.getByRole('button', { name: /3D Earth/i });
    fireEvent.click(earthTab);

    const geodeticCard = screen.getByTitle(/Click to rotate globe and center on project location/i);
    fireEvent.click(geodeticCard);

    const popupDialog = screen.getByRole('dialog', { name: /Johor Project Area/i });

    expect(within(popupDialog).getByText('Segamat')).toBeInTheDocument();
    expect(within(popupDialog).getByText('Tangkak')).toBeInTheDocument();
  });

  it('keeps every district saved in project settings as HUD chips (real saved boundary shape)', async () => {
    render(
      <SystemShowcase
        onEnterDashboard={vi.fn()}
        projectSettings={{
          projectName: 'Mobile Mapping - DevTest_v1',
          projectBoundary: {
            districtIds: ['segamat', 'tangkak'],
            districtNames: ['Segamat', 'Tangkak'],
            regionId: 'state:MY01',
            regionName: 'Johor',
            bbox: [102.4678, 2.04562, 103.38118, 2.83246],
            focusActive: true,
            geojson: {
              type: 'FeatureCollection',
              features: [
                { id: 'segamat', type: 'Feature', properties: { name: 'Segamat' }, geometry: { type: 'MultiPolygon', coordinates: [] } },
                { id: 'tangkak', type: 'Feature', properties: { name: 'Tangkak' }, geometry: { type: 'MultiPolygon', coordinates: [] } }
              ]
            }
          }
        }}
      />
    );

    const earthTab = screen.getByRole('button', { name: /3D Earth/i });
    fireEvent.click(earthTab);

    const geodeticCard = screen.getByTitle(/Click to rotate globe and center on project location/i);
    fireEvent.click(geodeticCard);

    const popupDialog = screen.getByRole('dialog', { name: /Johor Project Area/i });

    expect(within(popupDialog).getByText('Segamat')).toBeInTheDocument();
    expect(within(popupDialog).getByText('Tangkak')).toBeInTheDocument();
  });
});

