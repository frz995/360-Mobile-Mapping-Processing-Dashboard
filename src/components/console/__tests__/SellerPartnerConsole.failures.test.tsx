import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const fetchAllOrganizations = vi.fn();
const createOrganization = vi.fn();
const updateOrganization = vi.fn();
const deleteOrganization = vi.fn();
const toastError = vi.fn();

vi.mock('../../../services/tenantContext', () => ({
  fetchAllOrganizations: (...args: unknown[]) => fetchAllOrganizations(...args),
  createOrganization: (...args: unknown[]) => createOrganization(...args),
  updateOrganization: (...args: unknown[]) => updateOrganization(...args),
  deleteOrganization: (...args: unknown[]) => deleteOrganization(...args),
  setActiveOrganizationId: vi.fn(),
  testDedicatedDatabaseConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' })
}));

vi.mock('../../common/toast', () => ({
  toast: {
    success: vi.fn(),
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

/**
 * Regression cover for the defect class v32 §1 removed.
 *
 * Every one of these asserts the same invariant from a different direction:
 * an unmeasured quantity must render as unknown, and an unwritten quantity
 * must not be reported as written. The previous implementation returned
 * `success: true` from a failed insert and seeded a failed read with two
 * hard-coded customers, so both looked like healthy state to the operator.
 */
describe('SellerPartnerConsole — failure modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAllOrganizations.mockResolvedValue({
      organizations: [TNB],
      error: null,
      unverified: false
    });
  });

  it('does not present a failed directory read as an empty customer list', async () => {
    fetchAllOrganizations.mockResolvedValue({
      organizations: [],
      error: 'connection reset by peer',
      unverified: true
    });

    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/could not be verified/i)).toBeInTheDocument();
    });

    // The distinction the operator must be able to make.
    expect(screen.getByText(/failed query, not an empty directory/i)).toBeInTheDocument();
    expect(screen.queryByText(/No client companies found/i)).not.toBeInTheDocument();

    // The reason is surfaced rather than swallowed.
    expect(screen.getByText('connection reset by peer')).toBeInTheDocument();

    // A fabricated customer must never stand in for the unreadable list.
    expect(screen.queryByText('Apex Geospatial Survey Sdn Bhd')).not.toBeInTheDocument();
    expect(screen.queryByText('Tenaga Nasional Berhad')).not.toBeInTheDocument();
  });

  it('renders an unmeasured seat total as unknown, never as 0', async () => {
    fetchAllOrganizations.mockResolvedValue({
      organizations: [],
      error: 'permission denied for table organizations',
      unverified: true
    });

    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/could not be verified/i)).toBeInTheDocument();
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

    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No client companies found')).toBeInTheDocument();
    });
    expect(screen.queryByText(/could not be verified/i)).not.toBeInTheDocument();
  });

  it('keeps the modal open and reports the error when a create is rejected', async () => {
    createOrganization.mockResolvedValue({
      success: false,
      error: 'The client code or slug "tnb" is already in use by another company.'
    });

    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

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

    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

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
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle(/delete/i)[0]);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'This company still owns projects. Reassign or archive them before deleting the company.'
      );
    });

    confirmSpy.mockRestore();
  });

  it('clears the error banner once a retry succeeds', async () => {
    fetchAllOrganizations.mockResolvedValueOnce({
      organizations: [],
      error: 'temporary network failure',
      unverified: true
    });

    render(<SellerPartnerConsole onBackToApp={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/could not be verified/i)).toBeInTheDocument());

    fetchAllOrganizations.mockResolvedValue({
      organizations: [TNB],
      error: null,
      unverified: false
    });
    fireEvent.click(screen.getByRole('button', { name: /retry query/i }));

    await waitFor(() => expect(screen.queryByText(/could not be verified/i)).not.toBeInTheDocument());
    expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
  });
});