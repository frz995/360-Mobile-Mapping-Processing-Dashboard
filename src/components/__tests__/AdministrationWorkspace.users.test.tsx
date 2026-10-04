import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { AdministrationWorkspace } from '../AdministrationWorkspace';
import { renderWithPermissions } from '../../test/permissions';

/**
 * Authentication is owned by Supabase: Administration no longer creates
 * accounts, it manages the directory row that the database enforces roles from
 * (migration 0030).
 *
 * These tests pin that boundary:
 *   1. there is no user-creation affordance in the workspace;
 *   2. Disable is awaited and a failed write is not reported as success.
 */

const mocks = vi.hoisted(() => ({
  saveUserAccountToSupabase: vi.fn(),
  DIRECTORY: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Fariz Farhan',
      email: 'fariz@example.com',
      role: 'Survey Operator',
      status: 'Active',
      lastLogin: '04 Oct 2026',
      createdAt: '01 Oct 2026',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Siti Aminah',
      email: 'siti@example.com',
      role: 'QA Inspector',
      status: 'Disabled',
      lastLogin: 'Never',
      createdAt: '02 Oct 2026',
    },
  ],
}));

vi.mock('../../services/supabase', () => ({
  saveUserAccountToSupabase: mocks.saveUserAccountToSupabase,
  fetchUserAccountsFromSupabase: vi.fn().mockResolvedValue(mocks.DIRECTORY),
  getCachedUserAccounts: vi.fn().mockReturnValue(mocks.DIRECTORY),
  deleteFromSupabase: vi.fn().mockResolvedValue(true),
  fetchProjectSettingsFromSupabase: vi.fn().mockResolvedValue(null),
  fetchAuditLogsFromSupabase: vi.fn().mockResolvedValue([]),
  fetchDeletionRequestsFromSupabase: vi.fn().mockResolvedValue([]),
  updateDeletionRequestStatusInSupabase: vi.fn().mockResolvedValue(true),
  testDatabaseHealth: vi.fn().mockResolvedValue({}),
  supabase: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } },
}));

vi.mock('../../services/api/permissions', () => ({ saveRolePermissions: vi.fn().mockResolvedValue(true) }));

/** `showToast` delegates to the optional `addNotification` prop, so messages are
 *  asserted through that spy rather than the DOM. */
let notifications: Array<{ message?: string }>;

function renderWorkspace() {
  notifications = [];
  return renderWithPermissions(
    <AdministrationWorkspace
      authSession={{ user: { email: 'admin@example.com' } }}
      addNotification={(n: { message?: string }) => {
        notifications.push(n);
      }}
    />
  );
}

const toastText = () => notifications.map((n) => n.message || '').join(' | ');

/** The row action cell for a given user, located by its name cell. */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name).closest('tr');
  if (!cell) throw new Error(`no row for ${name}`);
  return cell;
}

describe('AdministrationWorkspace — user provisioning boundary', () => {
  let warnSpy: { mockRestore: () => void };

  beforeEach(() => {
    // NOTE: do not use vi.restoreAllMocks() — it strips implementations from the
    // vi.fn()s inside the module mock, breaking every subsequent test.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.saveUserAccountToSupabase.mockReset();
    mocks.saveUserAccountToSupabase.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    warnSpy.mockRestore();
  });

  it('offers no way to create an account', async () => {
    renderWorkspace();
    await screen.findByText('Fariz Farhan');

    expect(screen.queryByRole('button', { name: /add user/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create user account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /provision/i })).toBeNull();
  });

  it('still offers Disable, and states that it revokes permissions', async () => {
    renderWorkspace();
    await screen.findByText('Fariz Farhan');

    const active = within(rowFor('Fariz Farhan')).getByRole('button', { name: /^disable$/i });
    expect(active.getAttribute('title')).toMatch(/revoke all permissions/i);

    // A disabled account offers the inverse.
    const inactive = within(rowFor('Siti Aminah')).getByRole('button', { name: /^grant$/i });
    expect(inactive).toBeTruthy();
  });

  it('persists the new status when disabling, and says access was revoked', async () => {
    renderWorkspace();
    await screen.findByText('Fariz Farhan');

    fireEvent.click(within(rowFor('Fariz Farhan')).getByRole('button', { name: /^disable$/i }));

    await waitFor(() => expect(mocks.saveUserAccountToSupabase).toHaveBeenCalledTimes(1));
    const saved = mocks.saveUserAccountToSupabase.mock.calls[0][0] as Array<{ email: string; status: string }>;
    expect(saved.find((u) => u.email === 'fariz@example.com')?.status).toBe('Disabled');

    await waitFor(() => expect(toastText()).toMatch(/revoked/i));
    expect(toastText()).toMatch(/read-only/i);
  });

  it('does not claim success when the write fails', async () => {
    mocks.saveUserAccountToSupabase.mockResolvedValue(false);
    renderWorkspace();
    await screen.findByText('Fariz Farhan');

    fireEvent.click(within(rowFor('Fariz Farhan')).getByRole('button', { name: /^disable$/i }));

    await waitFor(() => expect(toastText()).toMatch(/could not update/i));
    expect(toastText()).not.toMatch(/revoked/i);
  });
});