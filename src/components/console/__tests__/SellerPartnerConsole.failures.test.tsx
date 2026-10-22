import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Regression cover for the defect class v32 §1 and v34 §1 found.
 *
 * Every one of these asserts the same invariant from a different direction: an
 * unmeasured quantity must render as unknown, and an unwritten quantity must not
 * be reported as written. The previous implementation returned `success: true`
 * from a failed insert and seeded a failed read with two hard-coded customers,
 * so both looked like healthy state to the operator.
 */

const fetchAllOrganizations = vi.fn();
const createOrganization = vi.fn();
const updateOrganization = vi.fn();
const deleteOrganization = vi.fn();
const fetchOrganizationMembers = vi.fn();
const fetchSeatSummary = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../../../services/tenantContext', () => ({
  fetchAllOrganizations: (...args: unknown[]) => fetchAllOrganizations(...args),
  createOrganization: (...args: unknown[]) => createOrganization(...args),
  updateOrganization: (...args: unknown[]) => updateOrganization(...args),
  deleteOrganization: (...args: unknown[]) => deleteOrganization(...args),
  setActiveOrganizationId: vi.fn(),
  setActiveOrganizationStorage: vi.fn(),
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

const fetchCompanyStorageBreakdown = vi.fn();
const fetchParentDatabaseStats = vi.fn();

vi.mock('../../../services/consoleStorage', () => ({
  fetchCompanyStorageBreakdown: (...args: unknown[]) => fetchCompanyStorageBreakdown(...args),
  fetchParentDatabaseStats: (...args: unknown[]) => fetchParentDatabaseStats(...args),
  formatBytes: (bytes: number | null | undefined) => (bytes != null ? `${bytes} B` : '—'),
  formatPercent: (val: number | null | undefined) => (val != null ? `${val}%` : '—')
}));

vi.mock('../../common/toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    info: vi.fn(),
    error: (...args: unknown[]) => toastError(...args)
  }
}));

import { SellerPartnerConsole } from '../SellerPartnerConsole';

const TNB = {
  id: 'org-1',
  name: 'Tenaga Nasional Berhad',
  slug: 'tnb',
  clientCode: 'TNB-LV',
  databaseType: 'cloud_shared',
  status: 'active',
  settings: { allowedUserSeats: 15, storageQuotaGb: 500, contactEmail: 'mms@tnb.com.my' },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
};

const ACCESS = { allowed: true, verified: true, error: null, organizationIds: ['org-1'] };

const renderConsole = (props: Record<string, unknown> = {}) =>
  render(<SellerPartnerConsole onBackToApp={vi.fn()} access={ACCESS} {...props} />);

/** The directory table lives on the Companies panel, so reach it the way a user would. */
const gotoCompanies = async () => {
  fireEvent.click(screen.getByRole('link', { name: 'Companies' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Client Companies' })).toBeInTheDocument());
};

describe('SellerPartnerConsole — failure modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/console/dashboard');
    fetchAllOrganizations.mockResolvedValue({ organizations: [TNB], error: null, unverified: false });
    fetchOrganizationMembers.mockResolvedValue({ members: [], error: null });
    fetchCompanyStorageBreakdown.mockResolvedValue({ breakdown: [], error: null });
    fetchParentDatabaseStats.mockResolvedValue({
      stats: {
        databaseSizeBytes: 25165824,
        databaseSizePretty: '24 MB',
        storageBytes: 15728640,
        storageBytesPretty: '15 MB',
        storageFiles: 120,
        totalAllocatedStorageGb: 500,
        totalAllocatedSeats: 15,
        totalCompanies: 1,
        activeCompanies: 1,
        postgresVersion: 'PostgreSQL 17.6',
        postgisVersion: '3.4.2',
        planTier: 'free',
        planDbLimitBytes: 524288000,
        planStorageLimitBytes: 1073741824
      },
      error: null
    });
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

  it('does not present a failed directory read as an empty customer list', async () => {
    fetchAllOrganizations.mockResolvedValue({
      organizations: [],
      error: 'connection reset by peer',
      unverified: true
    });

    renderConsole();

    await waitFor(() => {
      expect(screen.getAllByText(/could not be verified/i).length).toBeGreaterThan(0);
    });

    // The distinction the operator must be able to make.
    expect(screen.getAllByText(/failed query, not an empty list/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no companies are registered yet/i)).not.toBeInTheDocument();

    // The reason is surfaced rather than swallowed.
    expect(screen.getAllByText('connection reset by peer').length).toBeGreaterThan(0);

    // A fabricated customer must never stand in for the unreadable list.
    expect(screen.queryByText('Tenaga Nasional Berhad')).not.toBeInTheDocument();
  });

  it('renders an unmeasured seat total as unknown, never as 0', async () => {
    fetchAllOrganizations.mockResolvedValue({
      organizations: [],
      error: 'permission denied for table organizations',
      unverified: true
    });

    renderConsole();

    await waitFor(() => {
      expect(screen.getAllByText(/could not be verified/i).length).toBeGreaterThan(0);
    });

    // "Licensed Seats" exists as a label; the value must not read as a
    // measured zero, which would tell the seller they have sold no seats.
    expect(screen.getByText('Licensed Seats')).toBeInTheDocument();
    const seatCard = screen.getByText('Licensed Seats').closest('div')?.parentElement;
    expect(seatCard?.textContent || '').toContain('—');
    expect(seatCard?.textContent || '').not.toMatch(/>\s*0\s*</);
  });

  it('renders a verified empty directory as empty, not as an error', async () => {
    fetchAllOrganizations.mockResolvedValue({ organizations: [], error: null, unverified: false });

    renderConsole();

    await waitFor(() => {
      expect(screen.getByText(/No companies are registered yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/could not be verified/i)).not.toBeInTheDocument();
  });

  it('keeps the modal open and reports the error when a create is rejected', async () => {
    createOrganization.mockResolvedValue({
      success: false,
      error: 'The client code or slug "tnb" is already in use by another company.'
    });

    renderConsole();
    await gotoCompanies();

    fireEvent.click(screen.getAllByText('Add Client Company')[0]);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Tenaga/i), { target: { value: 'TNB Copy' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. TNB-LV-2026/i), { target: { value: 'TNB-LV' } });
    fireEvent.click(screen.getByRole('button', { name: /create organization/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'The client code or slug "tnb" is already in use by another company.'
      );
    });

    // The dialog stays open: a rejected write must not look like a saved one.
    expect(screen.getByText('Register New Client Company')).toBeInTheDocument();
  });

  it('does not reload the directory as though a rejected create had succeeded', async () => {
    createOrganization.mockResolvedValue({ success: false, error: 'insert failed' });

    renderConsole();
    await gotoCompanies();

    fireEvent.click(screen.getAllByText('Add Client Company')[0]);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Tenaga/i), { target: { value: 'Nope Ltd' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. TNB-LV-2026/i), { target: { value: 'NOPE-01' } });
    fireEvent.click(screen.getByRole('button', { name: /create organization/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());

    // Only the initial load; no refresh implying the row now exists.
    expect(fetchAllOrganizations).toHaveBeenCalledTimes(1);
  });

  it('reports a refused delete instead of silently dropping the company', async () => {
    deleteOrganization.mockResolvedValue({
      success: false,
      error: 'This company still owns projects. Reassign or archive them before deleting the company.'
    });

    renderConsole();
    await gotoCompanies();

    fireEvent.click(screen.getAllByTitle(/delete tenaga/i)[0]);
    // The dialog names the company rather than asking a bare "are you sure?".
    await waitFor(() => expect(screen.getByText(/Delete this company\?/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Delete Company$/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'This company still owns projects. Reassign or archive them before deleting the company.'
      );
    });

    // Still open, because nothing was deleted.
    expect(screen.getByText(/Delete this company\?/i)).toBeInTheDocument();
  });

  it('clears the error banner once a retry succeeds', async () => {
    fetchAllOrganizations.mockResolvedValueOnce({
      organizations: [],
      error: 'temporary network failure',
      unverified: true
    });

    renderConsole();
    await waitFor(() => expect(screen.getAllByText(/could not be verified/i).length).toBeGreaterThan(0));

    fetchAllOrganizations.mockResolvedValue({ organizations: [TNB], error: null, unverified: false });
    fireEvent.click(screen.getAllByRole('button', { name: /retry query/i })[0]);

    await waitFor(() => expect(screen.queryByText(/could not be verified/i)).not.toBeInTheDocument());
    expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
  });

  it('reports a failed member read as a failure, not as nobody on the company', async () => {
    fetchOrganizationMembers.mockResolvedValue({
      members: [],
      error: 'permission denied for table organization_members'
    });

    window.history.replaceState({}, '', '/console/members?org=org-1');
    renderConsole();

    // The empty state invites the seller to invite everyone again, which is how
    // duplicate invites happen. It must not appear on a failed read.
    await waitFor(() => {
      expect(screen.getByText(/member list could not be verified/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Nobody is on this company yet/i)).not.toBeInTheDocument();
  });

  it('does not report a failed directory read as "All systems nominal"', async () => {
    // The Need Action report is derived from the company list. A failed read
    // yields an empty list, so an empty list used to render as a green dot and
    // "All systems nominal" — a Supabase outage wearing a healthy portfolio.
    fetchAllOrganizations.mockResolvedValue({
      organizations: [],
      error: 'connection reset by peer',
      unverified: true
    });

    renderConsole();

    await waitFor(() => {
      expect(screen.getAllByText(/company status unknown/i).length).toBeGreaterThan(0);
    });

    expect(screen.queryByText(/all systems nominal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no company issues detected/i)).not.toBeInTheDocument();
  });

  it('renders storage as unknown when the inventory read fails, never as 0 B', async () => {
    fetchCompanyStorageBreakdown.mockResolvedValue({
      breakdown: [],
      error: 'permission denied for table file_inventory'
    });

    renderConsole();

    await waitFor(() => {
      expect(screen.getAllByText(/could not be verified/i).length).toBeGreaterThan(0);
    });

    // The portfolio KPI.
    const storageCard = screen.getByText('Storage Consumed').closest('div')?.parentElement;
    expect(storageCard?.textContent || '').toContain('—');
    expect(storageCard?.textContent || '').not.toMatch(/0\s*B/);

    // The per-company row. The company is real — the directory read succeeded —
    // so the row must exist; only its storage columns are unknown.
    const row = screen.getAllByText('Tenaga Nasional Berhad')[0].closest('tr');
    const rowText = row?.textContent || '';
    expect(rowText).toContain('—');
    expect(rowText).not.toMatch(/0\s*files/);
    expect(rowText).not.toMatch(/0\s*B/);
  });

  it('says "No limit configured" for a company with no limit on file', async () => {
    fetchAllOrganizations.mockResolvedValue({
      organizations: [{ ...TNB, settings: { contactEmail: 'mms@tnb.com.my' } }],
      error: null,
      unverified: false
    });

    renderConsole();
    await gotoCompanies();

    // The old cell rendered `allowedUserSeats ?? 0` and `storageQuotaGb ?? 0`,
    // so this company read as "0 seats · 0 GB Platform" here while the Seats
    // tab said "No limit configured" — two tabs, one company, two answers.
    const row = screen.getAllByText('Tenaga Nasional Berhad')[0].closest('tr');
    const rowText = row?.textContent || '';
    expect(rowText).toContain('No limit configured');
    expect(rowText).toContain('Unlimited');
    expect(rowText).not.toMatch(/0\s*seats/);
    expect(rowText).not.toMatch(/0\s*GB\s*Platform/);
  });

  it('re-reads the storage inventory when the top bar Refresh is pressed', async () => {
    // A button labelled "Refresh" that re-reads only half the console is
    // worse than no button: the quota on screen and the chart below it come
    // from different moments, and neither the operator nor the seller can
    // reconcile them.
    renderConsole();

    await waitFor(() => expect(fetchCompanyStorageBreakdown).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(fetchCompanyStorageBreakdown).toHaveBeenCalledTimes(2));
  });
});