import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SellerPartnerConsole } from '../SellerPartnerConsole';

// Mock tenantContext
vi.mock('../../../services/tenantContext', () => ({
  fetchAllOrganizations: vi.fn().mockResolvedValue({
    organizations: [
      {
        id: 'org-1',
        name: 'Tenaga Nasional Berhad',
        slug: 'tnb',
        clientCode: 'TNB-LV',
        databaseType: 'cloud_shared',
        status: 'active',
        settings: { allowedUserSeats: 15, storageQuotaGb: 500, contactEmail: 'mms@tnb.com.my' },
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01'
      },
      {
        id: 'org-2',
        name: 'Apex Survey Sdn Bhd',
        slug: 'apex',
        clientCode: 'APEX-01',
        databaseType: 'dedicated_external',
        status: 'trial',
        settings: { allowedUserSeats: 5, storageQuotaGb: 100, contactEmail: 'info@apex.my' },
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01'
      }
    ],
    error: null,
    unverified: false
  }),
  createOrganization: vi.fn().mockResolvedValue({ success: true }),
  updateOrganization: vi.fn().mockResolvedValue({ success: true }),
  deleteOrganization: vi.fn().mockResolvedValue({ success: true }),
  setActiveOrganizationId: vi.fn(),
  testDedicatedDatabaseConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' })
}));

describe('SellerPartnerConsole', () => {
  it('renders the monochrome black and white seller console with KPI metrics and company table', async () => {
    const handleBack = vi.fn();
    render(<SellerPartnerConsole onBackToApp={handleBack} currentUserEmail="seller@geosphere.my" />);

    expect(screen.getByText(/Partner Console/i)).toBeInTheDocument();
    expect(screen.getByText(/Enterprise Multi-Tenant Partner Hub/i)).toBeInTheDocument();
    expect(screen.getByText('seller')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
      expect(screen.getByText('Apex Survey Sdn Bhd')).toBeInTheDocument();
    });

    expect(screen.getByText('TNB-LV')).toBeInTheDocument();
    expect(screen.getByText('APEX-01')).toBeInTheDocument();

    // KPI Metrics
    expect(screen.getByText('Licensed Seats')).toBeInTheDocument();
    expect(screen.getByText('Total Storage')).toBeInTheDocument();
    expect(screen.getByText('Dedicated DBs')).toBeInTheDocument();
  });

  it('filters companies by search query', async () => {
    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search Here.../i);
    fireEvent.change(searchInput, { target: { value: 'Apex' } });

    expect(screen.queryByText('Tenaga Nasional Berhad')).not.toBeInTheDocument();
    expect(screen.getByText('Apex Survey Sdn Bhd')).toBeInTheDocument();
  });

  it('opens the Add Client Company modal when clicking the button', async () => {
    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
    });

    const addBtns = screen.getAllByText('Add Client Company');
    fireEvent.click(addBtns[0]);

    expect(screen.getByText('Register New Client Company')).toBeInTheDocument();
    expect(screen.getByText('Company Name *')).toBeInTheDocument();
    expect(screen.getByText('Database Routing Architecture')).toBeInTheDocument();
  });

  it('triggers onBackToApp when Open Client App button is clicked', async () => {
    const handleBack = vi.fn();
    render(<SellerPartnerConsole onBackToApp={handleBack} />);

    await waitFor(() => {
      expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
    });

    const backBtn = screen.getByText('Open Client App');
    fireEvent.click(backBtn);

    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it('opens client app preview in a new tab when preview button is clicked', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
    });

    const previewButtons = screen.getAllByTitle(/Preview client workspace in a new tab/i);
    fireEvent.click(previewButtons[0]);

    expect(openSpy).toHaveBeenCalledWith(
      '/dashboard?tenant=tnb',
      '_blank',
      'noopener,noreferrer'
    );
    openSpy.mockRestore();
  });

  it('switches navigation tabs properly', async () => {
    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
    });

    const databaseHubBtn = screen.getByRole('button', { name: /Database Hub/i });
    fireEvent.click(databaseHubBtn);

    const seatLicensesBtn = screen.getByRole('button', { name: /Seat Licenses/i });
    fireEvent.click(seatLicensesBtn);

    const dashboardBtn = screen.getByRole('button', { name: /Dashboard/i });
    fireEvent.click(dashboardBtn);

    expect(screen.getByText(/Platform Ingestion Trends/i)).toBeInTheDocument();
  });
});
