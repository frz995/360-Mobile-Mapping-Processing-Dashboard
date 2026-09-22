import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SharedMapPage } from '../SharedMapPage';
import * as mapShares from '../../utils/mapShares';

// Mock maplibre-gl to prevent canvas/webgl errors in jsdom
vi.mock('maplibre-gl', () => {
  const MapMock = vi.fn().mockImplementation(() => ({
    addControl: vi.fn(),
    on: vi.fn(),
    remove: vi.fn(),
    getCanvas: vi.fn().mockReturnValue({ style: {} }),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    fitBounds: vi.fn()
  }));

  const NavigationControlMock = vi.fn();
  const PopupMock = vi.fn().mockImplementation(() => ({
    setLngLat: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis()
  }));

  return {
    Map: MapMock,
    NavigationControl: NavigationControlMock,
    Popup: PopupMock,
    setWorkerUrl: vi.fn()
  };
});

describe('SharedMapPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "link no longer available" when no token is present in the URL', async () => {
    delete (window as any).location;
    window.location = new URL('http://localhost:5173/share/') as any;

    render(<SharedMapPage />);

    await waitFor(() => {
      expect(screen.getByText(/This map link is no longer available/i)).toBeInTheDocument();
    });
  });

  it('renders "link no longer available" when fetchShareByToken returns null', async () => {
    delete (window as any).location;
    window.location = new URL('http://localhost:5173/share/nonexistenttoken123') as any;

    vi.spyOn(mapShares, 'fetchShareByToken').mockResolvedValue(null);

    render(<SharedMapPage />);

    await waitFor(() => {
      expect(screen.getByText(/This map link is no longer available/i)).toBeInTheDocument();
    });
  });

  it('renders the password gate when the share has a password', async () => {
    delete (window as any).location;
    window.location = new URL('http://localhost:5173/share/tokenwithpassword123') as any;

    vi.spyOn(mapShares, 'fetchShareByToken').mockResolvedValue({
      id: 's1',
      token: 'tokenwithpassword123',
      kind: 'webgis',
      title: 'Secret Survey Map',
      project_id: null,
      snapshot: {
        center: [3.139, 101.6869],
        zoom: 11,
        stats: { subgrids: 1, km: 5, poi: 10, frames: 10, defects: 0, passRate: 100 }
      },
      basemap: 'ofm-positron',
      password_hash: 'somehash',
      created_by: null,
      created_at: new Date().toISOString(),
      expires_at: null,
      revoked_at: null,
      view_count: 0
    });

    render(<SharedMapPage />);

    await waitFor(() => {
      expect(screen.getByText(/This shared map has a password/i)).toBeInTheDocument();
      expect(screen.getByText(/Secret Survey Map/i)).toBeInTheDocument();
    });
  });

  it('renders the shared map header and legend successfully for a public share without password', async () => {
    delete (window as any).location;
    window.location = new URL('http://localhost:5173/share/validpublictoken123') as any;

    vi.spyOn(mapShares, 'fetchShareByToken').mockResolvedValue({
      id: 's2',
      token: 'validpublictoken123',
      kind: 'webgis',
      title: 'Peninsular Malaysia Survey',
      project_id: null,
      snapshot: {
        center: [3.139, 101.6869], // lat, lng in snapshot
        zoom: 12,
        stats: { subgrids: 2, km: 12.5, poi: 150, frames: 140, defects: 2, passRate: 98.7 }
      },
      basemap: 'ofm-positron',
      password_hash: null,
      created_by: null,
      created_at: new Date().toISOString(),
      expires_at: null,
      revoked_at: null,
      view_count: 5
    });

    render(<SharedMapPage />);

    await waitFor(() => {
      expect(screen.getAllByText(/Peninsular Malaysia Survey/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Read-only share/i)).toBeInTheDocument();
      expect(screen.getByText(/Legend/i)).toBeInTheDocument();
    });
  });

  it('parses tokens from hash URLs e.g. #/share/<token>', async () => {
    delete (window as any).location;
    window.location = new URL('http://localhost:5173/#/share/hashtoken12345678') as any;

    vi.spyOn(mapShares, 'fetchShareByToken').mockResolvedValue({
      id: 's3',
      token: 'hashtoken12345678',
      kind: 'road',
      title: 'Hash Route Shared Road',
      project_id: null,
      snapshot: {
        center: [101.6869, 3.139],
        zoom: 10,
        lines: [],
        stats: { subgrids: 0, km: 8.2, poi: 0, frames: 0, defects: 0, passRate: 100, lines: 4 }
      },
      basemap: 'ofm-positron',
      password_hash: null,
      created_by: null,
      created_at: new Date().toISOString(),
      expires_at: null,
      revoked_at: null,
      view_count: 1
    });

    render(<SharedMapPage />);

    await waitFor(() => {
      expect(screen.getByText('Hash Route Shared Road')).toBeInTheDocument();
      expect(screen.getByText(/Road Analysis/i)).toBeInTheDocument();
    });
  });

  it('renders a road analysis share containing captured survey stations and active subgrids', async () => {
    delete (window as any).location;
    window.location = new URL('http://localhost:5173/share/roadsurveypoints123') as any;

    vi.spyOn(mapShares, 'fetchShareByToken').mockResolvedValue({
      id: 's4',
      token: 'roadsurveypoints123',
      kind: 'road',
      title: 'Mobile Mapping - DevTest_v1 — Road Analysis Map',
      project_id: null,
      snapshot: {
        center: [2.5, 102.8],
        zoom: 11,
        points: [
          { lat: 2.505, lng: 102.81, subgrid: 'SG01', status: 'published' },
          { lat: 2.506, lng: 102.82, subgrid: 'SG01', status: 'staging' }
        ],
        tracks: [
          { subgrid: 'SG01', coords: [[2.505, 102.81], [2.506, 102.82]] }
        ],
        stats: { subgrids: 3, km: 3.37, poi: 273, frames: 0, defects: 0, passRate: 100, lines: 0 },
        planName: 'Region: Segamat, Tangkak'
      },
      basemap: 'ofm-positron',
      password_hash: null,
      created_by: null,
      created_at: new Date().toISOString(),
      expires_at: null,
      revoked_at: null,
      view_count: 2
    });

    render(<SharedMapPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Mobile Mapping - DevTest_v1 — Road Analysis Map').length).toBeGreaterThan(0);
      expect(screen.getByText(/Published survey/i)).toBeInTheDocument();
      expect(screen.getByText(/Staging survey/i)).toBeInTheDocument();
      expect(screen.getByText('273')).toBeInTheDocument();
      expect(screen.getByText(/survey points/i)).toBeInTheDocument();
      expect(screen.getByText(/subgrids/i)).toBeInTheDocument();
      expect(screen.getByText(/Region: Segamat, Tangkak/i)).toBeInTheDocument();
    });
  });
});
