import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SellerPartnerConsole } from '../SellerPartnerConsole';
import type { Organization } from '../../../services/tenantContext';

/**
 * Console behaviour that was previously untested because it did not exist.
 *
 * The four rail buttons in the pre-v34 shell set React state and rendered one
 * identical body — `activeTab` was read only to pick a highlight colour. The
 * test that existed ("switches navigation tabs properly") clicked all three
 * buttons and then asserted the *dashboard* text was still present, so it passed
 * against a completely inert nav.
 *
 * Each case below fails if two panels render the same content, or if the panel
 * lives only in React state instead of the address bar.
 */

const fetchAllOrganizations = vi.fn();
const fetchOrganizationMembers = vi.fn();
const fetchSeatSummary = vi.fn();
const setActiveOrganizationId = vi.fn();

vi.mock('../../../services/tenantContext', () => ({
  fetchAllOrganizations: (...args: unknown[]) => fetchAllOrganizations(...args),
  createOrganization: vi.fn().mockResolvedValue({ success: true }),
  updateOrganization: vi.fn().mockResolvedValue({ success: true }),
  deleteOrganization: vi.fn().mockResolvedValue({ success: true }),
  setActiveOrganizationId: (...args: unknown[]) => setActiveOrganizationId(...args),
  testDedicatedDatabaseConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' })
}));

vi.mock('../../../services/consoleAccess', async () => {
  const actual = await vi.importActual<typeof import('../../../services/consoleAccess')>(
    '../../../services/consoleAccess'
  );
  return {
    ...actual,
    fetchOrganizationMembers: (...args: unknown[]) => fetchOrganizationMembers(...args),
    fetchSeatSummary: (...args: unknown[]) => fetchSeatSummary(...args),
    resolveInviteeAccount: vi.fn(),
    inviteOrganizationMember: vi.fn(),
    setOrganizationMemberStatus: vi.fn(),
    removeOrganizationMember: vi.fn(),
    activatePendingMemberships: vi.fn().mockResolvedValue({ activated: 0, error: null })
  };
});

const TNB: Organization = {
  id: 'org-1',
  name: 'Tenaga Nasional Berhad',
  slug: 'tnb',
  clientCode: 'TNB-LV',
  databaseType: 'cloud_shared',
  databaseConfig: {},
  status: 'active',
  settings: { allowedUserSeats: 15, storageQuotaGb: 500, contactEmail: 'mms@tnb.com.my' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
};

const ACCESS = { allowed: true, verified: true, error: null, organizationIds: ['org-1'] };

const renderConsole = (props: Record<string, unknown> = {}) =>
  render(<SellerPartnerConsole onBackToApp={vi.fn()} access={ACCESS} {...props} />);

describe('SellerPartnerConsole — panel navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/console/dashboard');
    fetchAllOrganizations.mockResolvedValue({ organizations: [TNB], error: null, unverified: false });
    fetchOrganizationMembers.mockResolvedValue({ members: [], error: null });
    fetchSeatSummary.mockResolvedValue({
      rows: [
        {
          organizationId: 'org-1',
          organizationName: 'Tenaga Nasional Berhad',
          clientCode: 'TNB-LV',
          licensedSeats: 15,
          activeSeats: 3,
          invitedSeats: 1,
          suspendedSeats: 0
        }
      ],
      error: null
    });
  });

  it('lands on the panel named in the URL, not always on the dashboard', async () => {
    window.history.replaceState({}, '', '/console/seats');
    renderConsole();

    await waitFor(() => {
      // level 2, not any heading: the top bar renders the panel name as an h1
      // and the panel itself renders it again as its own heading.
      expect(screen.getByRole('heading', { name: 'Seat Licenses', level: 2 })).toBeInTheDocument();
    });
    // The dashboard's own content must be absent, which is what the old
    // one-body-for-every-tab shell rendered regardless of navigation.
    expect(screen.queryByText('Portfolio')).not.toBeInTheDocument();
  });

  it('renders a distinct panel for every rail destination', async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

    const destinations: Array<{ rail: string; heading: string; path: string }> = [
      { rail: 'Companies', heading: 'Client Companies', path: '/console/companies' },
      { rail: 'Team Members', heading: 'Team Members', path: '/console/members' },
      { rail: 'Database Hub', heading: 'Database Routing', path: '/console/database' },
      { rail: 'Seat Licenses', heading: 'Seat Licenses', path: '/console/seats' },
      { rail: 'Settings', heading: 'This Console', path: '/console/settings' }
    ];

    for (const { rail, heading, path } of destinations) {
      fireEvent.click(screen.getByRole('link', { name: rail }));
      await waitFor(() => {
        // level 2 disambiguates from the top bar's h1, which carries the same
        // panel name.
        expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
      });
      // Each destination must have its own URL, or Back cannot work.
      expect(window.location.pathname).toBe(path);
    }
  });

  it('carries the selected company between panels in the query string', async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: 'Team Members' }));
    await waitFor(() => expect(screen.getByLabelText('Company')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'org-1' } });

    await waitFor(() => {
      expect(window.location.search).toBe('?org=org-1');
    });
  });

  it('follows browser Back to the previous panel', async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: 'Database Hub' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Database Routing' })).toBeInTheDocument();
    });

    window.history.back();
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Portfolio' })).toBeInTheDocument();
    });
  });

  it('normalises a stale panel path that this build does not have', async () => {
    window.history.replaceState({}, '', '/console/tenants');
    renderConsole();

    // `/console/tenants` resolved to the dashboard before; the address bar must
    // not keep advertising a panel that does not exist.
    await waitFor(() => {
      expect(window.location.pathname).toBe('/console/dashboard');
    });
    expect(screen.getByRole('heading', { name: 'Portfolio' })).toBeInTheDocument();
  });

  it('opens the client application with the tenant explicitly selected', async () => {
    const onBackToApp = vi.fn();
    renderConsole({ onBackToApp });
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('link', { name: 'Companies' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Client Companies' })).toBeInTheDocument());

    fireEvent.click(screen.getByTitle(/open the client application as/i));

    // The old implementation opened `/dashboard?tenant=<slug>`, a parameter
    // nothing read. The tenant now reaches the app through the documented key.
    expect(setActiveOrganizationId).toHaveBeenCalledWith('org-1');
    expect(onBackToApp).toHaveBeenCalled();
  });

  it('shows the seat table as licensed against actual, not an allocation total', async () => {
    window.history.replaceState({}, '', '/console/seats');
    renderConsole();

    await waitFor(() => expect(screen.getByText('Per Company')).toBeInTheDocument());
    const row = screen.getByText('Tenaga Nasional Berhad').closest('tr');
    expect(row?.textContent).toContain('15'); // licensed
    expect(row?.textContent).toContain('3'); // active
  });

  it('renders an unconfigured seat limit as unknown rather than zero', async () => {
    fetchSeatSummary.mockResolvedValue({
      rows: [
        {
          organizationId: 'org-1',
          organizationName: 'Tenaga Nasional Berhad',
          clientCode: 'TNB-LV',
          licensedSeats: null,
          activeSeats: 3,
          invitedSeats: 0,
          suspendedSeats: 0
        }
      ],
      error: null
    });

    window.history.replaceState({}, '', '/console/seats');
    renderConsole();

    await waitFor(() => expect(screen.getByText('Per Company')).toBeInTheDocument());
    expect(screen.getByText('No limit configured')).toBeInTheDocument();
  });

  it('does not print infrastructure health claims that nothing measures', async () => {
    renderConsole();

    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

    // Every one of these was a literal in the pre-v34 shell.
    expect(screen.queryByText(/99\.98%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gateway SLA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/RLS Isolation Verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Partner Verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText('639')).not.toBeInTheDocument();
    expect(screen.queryByText('120,370')).not.toBeInTheDocument();
    expect(screen.queryByText(/1,922,340/)).not.toBeInTheDocument();
  });

  it('states the unenforced capabilities rather than implying they are enforced', async () => {
    window.history.replaceState({}, '', '/console/settings');
    renderConsole();

    await waitFor(() => expect(screen.getByText('Not Yet Enforced')).toBeInTheDocument());
    expect(screen.getByText('Seat limits are not enforced')).toBeInTheDocument();
    expect(screen.getByText('Storage quotas are not enforced')).toBeInTheDocument();
  });

  it('reports the access answer it was handed rather than asserting one', async () => {
    renderConsole({
      access: { allowed: false, verified: false, error: 'network down', organizationIds: [] }
    });

    // The shell must echo the tri-state it was given. It is not its job to
    // decide whether the person is an administrator.
    await waitFor(() => expect(screen.getByText(/Access unverified/i)).toBeInTheDocument());
  });

  it('marks the allocation figures LIVE only when the directory read verified', async () => {
    renderConsole();
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());
    // The directory read succeeded, so the allocation figures are real.
    expect(screen.getByText('LIVE')).toBeInTheDocument();

    fetchAllOrganizations.mockResolvedValue({ organizations: [], error: 'connection reset', unverified: true });
    renderConsole({});
    await waitFor(() => expect(screen.getAllByText('UNVERIFIED').length).toBeGreaterThan(0));
  });
});