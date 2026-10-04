import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `user_accounts.id` is a UUID column (supabase/migrations/0004_rls_application_tables.sql).
 * The provisioning dialog used to mint `usr-<timestamp>` ids, which Postgres rejects
 * with `invalid input syntax for type uuid` — and because the save was fire-and-forget,
 * the row silently never persisted while the UI reported success.
 *
 * These tests pin the write shape that prevents a recurrence.
 */

const upsert = vi.fn();
const select = vi.fn();

vi.mock('../api/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'user_accounts') throw new Error(`unexpected table ${table}`);
      return {
        upsert: (...args: unknown[]) => upsert(...args),
        select: (...args: unknown[]) => select(...args),
      };
    },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
  },
  scoped: (q: unknown) => q,
  getServiceProjectId: () => 'proj-1',
}));

vi.mock('../api/storage', () => ({ getStorageInventoryCacheTotalFiles: () => 0 }));

import { saveUserAccountToSupabase } from '../api/admin';

describe('saveUserAccountToSupabase — id column is UUID', () => {
  beforeEach(() => {
    upsert.mockReset();
    select.mockReset();
    upsert.mockResolvedValue({ error: null });
  });

  it('omits a non-UUID id so the column default applies', async () => {
    const ok = await saveUserAccountToSupabase([
      { id: 'usr-1756731234567', name: 'Fariz', email: 'f@example.com', role: 'Survey Operator', status: 'Active' },
    ]);

    expect(ok).toBe(true);
    const [rows, opts] = upsert.mock.calls[0];
    expect(rows[0]).not.toHaveProperty('id');
    expect(opts).toEqual({ onConflict: 'email' });
  });

  it('keeps a real UUID id so the row round-trips by primary key', async () => {
    // A Supabase auth id — the shape the auto-sync writes on first sign-in.
    const id = '3f1b7c22-0d4e-4a1b-9c33-2b8a5e7d1f04';
    await saveUserAccountToSupabase([
      { id, name: 'Fariz', email: 'f@example.com', role: 'Survey Operator', status: 'Active' },
    ]);

    expect(upsert.mock.calls[0][0][0].id).toBe(id);
  });

  it('matches on the unique email so legacy ids update instead of duplicating', async () => {
    await saveUserAccountToSupabase([
      { id: 'guest-user-001', name: 'Guest', email: 'guest@example.com', role: 'Viewer', status: 'Active' },
    ]);

    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'email' });
  });
});

describe('saveUserAccountToSupabase — column mapping', () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
  });

  it('maps camelCase directory keys onto snake_case columns', async () => {
    await saveUserAccountToSupabase([
      {
        id: '3f1b7c22-0d4e-4a1b-9c33-2b8a5e7d1f04',
        name: 'Fariz',
        email: 'f@example.com',
        role: 'Survey Operator',
        status: 'Active',
        lastLogin: 'Never',
        createdAt: '04 Oct 2026',
      },
    ]);

    const row = upsert.mock.calls[0][0][0];
    expect(row).toMatchObject({
      name: 'Fariz',
      email: 'f@example.com',
      role: 'Survey Operator',
      status: 'Active',
      last_login: 'Never',
      created_at: '04 Oct 2026',
    });
    // camelCase keys must not be sent — they are not columns.
    expect(row).not.toHaveProperty('lastLogin');
    expect(row).not.toHaveProperty('createdAt');
  });

  it('reports failure instead of resolving true', async () => {
    upsert.mockResolvedValue({ error: { message: 'invalid input syntax for type uuid' } });
    const ok = await saveUserAccountToSupabase([{ name: 'X', email: 'x@y.z' }]);
    expect(ok).toBe(false);
  });

  it('treats an empty list as a no-op success', async () => {
    expect(await saveUserAccountToSupabase([])).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });
});
