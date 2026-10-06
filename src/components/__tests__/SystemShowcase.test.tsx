import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { SystemShowcase } from '../SystemShowcase';

// tsParticles requires OffscreenCanvas (not available in jsdom) — stub the sparkles background.
vi.mock('../common/Sparkles', () => ({
  SparklesCore: () => <div data-testid="sparkles-mock" />,
}));

// WebGL / maplibre-gl is not available in jsdom — stub the satellite globe so the
// showcase renders its own chrome without a GPU context or a tile network.
// The pose constants are plain numbers derived in that module, so mirror the real
// values rather than omitting them: SystemShowcase seeds its shared zoom from
// INTRO_ZOOM and reads SATELLITE_FOCUS_ZOOM when the renderer toggle is used.
vi.mock('../common/MapLibreGlobe', () => ({
  MapLibreGlobe: () => <div data-testid="maplibre-globe-mock" />,
  INTRO_ZOOM: 2.41,
  SATELLITE_FOCUS_ZOOM: 2.69,
  FULL_GLOBE_ZOOM: 1.85,
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('SystemShowcase Component', () => {
  it('renders GeoSphere 360 title, branding, and the first module section', () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Mobile Mapping Data, Manage in One Place' })).toBeInTheDocument();
    expect(screen.getByText('A practical workspace for mobile mapping operations.')).toBeInTheDocument();
    expect(screen.getAllByText(/Mobile Mapping Data Management System/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 2, name: 'Project Management' })).toBeInTheDocument();
    // Every module panel ships its own workflow timeline in the scroll story
    expect(screen.getAllByText(/Workflow/i).length).toBeGreaterThanOrEqual(6);
  });

  it('renders all six module sections inside the scroll story', () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Project Management' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'WebGIS Dashboard & Data Management' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Road Analysis & Project Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Production Hub' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'PC Monitoring & NAS Storage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Analytics, Reports & Administration' })).toBeInTheDocument();
  });

  it('triggers onEnterDashboard with "auth" when Sign In button is clicked', () => {
    const handleEnter = vi.fn();
    render(<SystemShowcase onEnterDashboard={handleEnter} />);

    // First Sign In button lives in the sticky header
    const signInBtn = screen.getAllByRole('button', { name: /Sign In/i })[0];
    fireEvent.click(signInBtn);

    expect(handleEnter).toHaveBeenCalledWith('auth');
  });

  it('triggers onEnterDashboard with the active module when Launch Workspace is clicked', () => {
    const handleEnter = vi.fn();
    render(<SystemShowcase onEnterDashboard={handleEnter} />);

    // Header launch button navigates immediately (no cinematic portal)
    const launchBtn = screen.getAllByRole('button', { name: /Launch Workspace/i })[0];
    fireEvent.click(launchBtn);

    expect(handleEnter).toHaveBeenCalledWith('project');
  });

  it('triggers onEnterDashboard with { isDirectEnter: true } when Enter Module button is clicked', () => {
    vi.useFakeTimers();
    const handleEnter = vi.fn();
    render(<SystemShowcase onEnterDashboard={handleEnter} />);

    // Click "Enter Project" button inside the Project Management section
    const enterProjectBtn = screen.getByRole('button', { name: /Enter Project/i });
    fireEvent.click(enterProjectBtn);

    // Fast-forward cinematic launch portal timer (700ms)
    act(() => {
      vi.advanceTimersByTime(750);
    });

    expect(handleEnter).toHaveBeenCalledWith('project', { isDirectEnter: true });
    vi.useRealTimers();
  });

  it('allows switching modules using module navigation pills', () => {
    vi.useFakeTimers();
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    // Click 'Production Hub' module pill
    const prodPill = screen.getByRole('button', { name: /^Production Hub$/i });
    fireEvent.click(prodPill);

    // Advance timers for the deferred smooth-scroll inside act
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText(/Move every subgrid from stitched intake to WebGIS release through gated stations/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders execution flow steps cleanly without card box wrappers', () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    // Each of the six module timelines numbers its steps 1..3
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText('Create')).toBeInTheDocument();
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
    const earthTab = screen.getAllByRole('button', { name: /3D Earth/i })[0];
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
    expect(within(popupDialog).getByText(/No survey frames or platform POIs/i)).toBeInTheDocument();
    expect(within(popupDialog).getByText(/ingress/i)).toBeInTheDocument();
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

    const earthTab = screen.getAllByRole('button', { name: /3D Earth/i })[0];
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

    const earthTab = screen.getAllByRole('button', { name: /3D Earth/i })[0];
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

    const earthTab = screen.getAllByRole('button', { name: /3D Earth/i })[0];
    fireEvent.click(earthTab);

    const geodeticCard = screen.getByTitle(/Click to rotate globe and center on project location/i);
    fireEvent.click(geodeticCard);

    const popupDialog = screen.getByRole('dialog', { name: /Johor Project Area/i });

    expect(within(popupDialog).getByText('Segamat')).toBeInTheDocument();
    expect(within(popupDialog).getByText('Tangkak')).toBeInTheDocument();
  });

  it('opens expand image popup modal when clicking gallery card and closes on backdrop click', async () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    // Find the first gallery card
    const galleryCard = document.getElementById('module-gallery-card-0');
    expect(galleryCard).toBeInTheDocument();

    // Click gallery card to open expand popup
    fireEvent.click(galleryCard!);

    const popup = screen.getByTestId('gallery-image-popup');
    expect(popup).toBeInTheDocument();
    expect(within(popup).getByText(/Snapshot 1 of/i)).toBeInTheDocument();
    expect(within(popup).getByAltText(/Project Management screenshot 1/i)).toBeInTheDocument();

    // Click background overlay to close popup
    const backdrop = screen.getByTestId('gallery-popup-backdrop');
    act(() => {
      fireEvent.click(backdrop);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('gallery-image-popup')).not.toBeInTheDocument();
    });
  });

  it('navigates next and previous snapshots inside the expanded gallery modal', () => {
    render(<SystemShowcase onEnterDashboard={vi.fn()} />);

    const galleryCard = document.getElementById('module-gallery-card-0');
    fireEvent.click(galleryCard!);

    const popup = screen.getByTestId('gallery-image-popup');
    expect(popup).toBeInTheDocument();
    expect(within(popup).getByText(/Snapshot 1 of/i)).toBeInTheDocument();

    // Click Next button
    const nextBtn = within(popup).getByRole('button', { name: /Next screenshot/i });
    act(() => {
      fireEvent.click(nextBtn);
    });
    expect(within(popup).getByText(/Snapshot 2 of/i)).toBeInTheDocument();
    expect(within(popup).getByAltText(/Project Management screenshot 2/i)).toBeInTheDocument();

    // Click Previous button
    const prevBtn = within(popup).getByRole('button', { name: /Previous screenshot/i });
    act(() => {
      fireEvent.click(prevBtn);
    });
    expect(within(popup).getByText(/Snapshot 1 of/i)).toBeInTheDocument();
    expect(within(popup).getByAltText(/Project Management screenshot 1/i)).toBeInTheDocument();
  });
});

