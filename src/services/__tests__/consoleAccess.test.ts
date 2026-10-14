import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchConsoleAccess,
  fetchOrganizationMembers,
  resolveInviteeAccount,
  inviteOrganizationMember,
  setOrganizationMemberStatus,
  removeOrganizationMember,
  activatePendingMemberships,
  fetchSeatSummary,
  setActiveOrganization,
  CONSOLE_WRITE_OPS
} from '../consoleAccess';
import { supabase } from '../../services/api/client';
import { subscribeWriteFailures } from '../../lib/writeFailures';

/**
 * The tri-state rule, asserted at the layer where it is easiest to get wrong.
 *
 * `fetchConsoleAccess` has three outcomes — allowed, refused, undetermined —
 * and the middle two are what the previous `/console` gate collapsed into one.
 * A refused caller and an unreachable database must not render the same thing:
 * one needs "ask an administrator", the other needs "try again".
 */

vi.mock('../../services/api/client', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } } }) }
  }
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('consoleAccess — access gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a platform administrator as allowed and verified', async () => {
    rpc.mockResolvedValue({ data: [{ is_platform_admin: true, organization_ids: ['a', 'b'] }], error: null });

    const result = await fetchConsoleAccess();

    expect(result).toEqual({ allowed: true, verified: true, error: null, organizationIds: ['a', 'b'] });
  });

  it('reports a tenant member as refused but still verified', async () => {
    // Verified-and-refused is a real answer and must not look like an outage.
    rpc.mockResolvedValue({ data: [{ is_platform_admin: false, organization_ids: ['org-1'] }], error: null });

    const result = await fetchConsoleAccess();

    expect(result.allowed).toBe(false);
    expect(result.verified).toBe(true);
    expect(result.organizationIds).toEqual(['org-1']);
  });

  it('reports an unreachable check as unverified rather than as a refusal', async () => {
    // The defect this prevents: a network blip denying a real administrator,
    // or the inverse, opening the console to everyone.
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });

    const result = await fetchConsoleAccess();

    expect(result.verified).toBe(false);
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('connection reset');
  });

  it('reports an empty response as unverified, not as a refusal', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const result = await fetchConsoleAccess();

    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/no result/i);
  });

  it('reports a thrown read as unverified', async () => {
    rpc.mockRejectedValue(new Error('network down'));

    const result = await fetchConsoleAccess();

    expect(result.verified).toBe(false);
    expect(result.error).toBe('network down');
  });
});

describe('consoleAccess — member list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the four membership states without collapsing them', async () => {
    rpc.mockResolvedValue({
      data: [
        { user_id: 'u1', email: 'a@x.test', email_confirmed_at: '2026-01-01T00:00:00Z', role: 'Operator', status: 'active' },
        { user_id: 'u2', email: 'b@x.test', email_confirmed_at: null, role: 'Viewer', status: 'invited' },
        { user_id: 'u3', email: null, email_confirmed_at: null, role: 'Inspector', status: 'suspended' }
      ],
      error: null
    });

    const { members, error } = await fetchOrganizationMembers('org-1');

    expect(error).toBeNull();
    expect(members).toHaveLength(3);
    expect(members[0].status).toBe('active');
    // An unconfirmed invite is still `invited`; it is not promoted to active by
    // the absence of a confirmation timestamp.
    expect(members[1].status).toBe('invited');
    expect(members[1].emailConfirmedAt).toBeNull();
    // A deleted auth account yields a null email, not an empty string that
    // would render as a blank cell.
    expect(members[2].email).toBeNull();
  });

  it('reports a failed read as an error with an empty list', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const { members, error } = await fetchOrganizationMembers('org-1');

    expect(members).toEqual([]);
    expect(error).toBe('permission denied');
  });

  it('refuses to guess an organisation id', async () => {
    const result = await fetchOrganizationMembers('');
    expect(result.error).toMatch(/no company selected/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('consoleAccess — seat summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves an unconfigured seat limit as null rather than zero', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          organization_id: 'org-1',
          organization_name: 'Acme',
          client_code: 'ACME',
          licensed_seats: null,
          active_seats: 0,
          invited_seats: 0,
          suspended_seats: 0
        }
      ],
      error: null
    });

    const { rows } = await fetchSeatSummary();

    // Never configured and zero sold are different facts.
    expect(rows[0].licensedSeats).toBeNull();
    expect(rows[0].activeSeats).toBe(0);
  });
});

describe('consoleAccess — invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: { access_token: 'token' } }
    });
  });

  it('reports a created account separately from whether mail was sent', async () => {
    // GoTrue can create the account and fail the mail. One boolean for both
    // would tell a seller their staff member is registered when they have no
    // way in.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user_id: 'u9', created: true, confirmation_sent: false })
      })
    );

    const result = await resolveInviteeAccount('New@Client.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.userId).toBe('u9');
      expect(result.outcome.created).toBe(true);
      expect(result.outcome.confirmationSent).toBe(false);
    }

    vi.unstubAllGlobals();
  });

  it('reports an existing account as not created', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          user_id: 'u1',
          created: false,
          confirmation_sent: false,
          already_platform_admin: true
        })
      })
    );

    const result = await resolveInviteeAccount('existing@client.com');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.created).toBe(false);
      // A platform admin already sees every tenant, so the console must be able
      // to warn that the invite would be a no-op.
      expect(result.outcome.alreadyPlatformAdmin).toBe(true);
    }

    vi.unstubAllGlobals();
  });

  it('refuses a service response with no user id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ created: true }) })
    );

    const result = await resolveInviteeAccount('nobody@client.com');

    expect(result.ok).toBe(false);

    vi.unstubAllGlobals();
  });

  it('reports a rejected invite as a failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Not authorised' } });

    const result = await inviteOrganizationMember('org-1', 'u1', 'Operator');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not authorised');
  });

  it('reports a null membership payload as a failure, not a success', async () => {
    // PostgREST resolving with neither data nor error must not read as a
    // successful write.
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await inviteOrganizationMember('org-1', 'u1', 'Operator');

    expect(result.success).toBe(false);
  });

  it('surfaces a rejected membership write on the persistent banner', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'insert failed' } });
    const seen: string[] = [];
    const unsubscribe = subscribeWriteFailures((list) => {
      seen.length = 0;
      list.forEach((f) => seen.push(f.op));
    });

    await inviteOrganizationMember('org-1', 'u1', 'Operator');

    expect(seen).toContain(CONSOLE_WRITE_OPS.invite);
    unsubscribe();
  });

  it('clears the banner once a later write succeeds', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'insert failed' } });
    await inviteOrganizationMember('org-1', 'u1', 'Operator');

    rpc.mockResolvedValueOnce({ data: { id: 'm1' }, error: null });
    await inviteOrganizationMember('org-1', 'u1', 'Operator');

    const seen: string[] = [];
    const unsubscribe = subscribeWriteFailures((list) => {
      seen.length = 0;
      list.forEach((f) => seen.push(f.op));
    });
    expect(seen).not.toContain(CONSOLE_WRITE_OPS.invite);
    unsubscribe();
  });
});

describe('consoleAccess — activation and tenant selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports how many invitations were activated', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await expect(activatePendingMemberships()).resolves.toEqual({ activated: 2, error: null });
  });

  it('reports a failed activation as unknown rather than zero', async () => {
    // `activated: 0` would assert that nobody was waiting, which is a different
    // claim from "the query did not run".
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    const result = await activatePendingMemberships();

    expect(result.activated).toBeNull();
    expect(result.error).toBe('timeout');
  });

  it('reports an activation that returns no count as unknown', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await activatePendingMemberships();
    expect(result.activated).toBeNull();
  });

  it('reports a refused tenant switch', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'You are not an active member of that company.' } });

    const result = await setActiveOrganization('org-other');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not an active member/i);
  });
});

describe('consoleAccess — status changes and removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a refused status change rather than assuming it applied', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'You cannot change your own membership status.' } });

    const result = await setOrganizationMemberStatus('org-1', 'u1', 'suspended');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/your own membership/i);
  });

  it('confirms a status change that the database accepted', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(setOrganizationMemberStatus('org-1', 'u1', 'active')).resolves.toEqual({ success: true });
  });

  it('reports a refused removal', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'That person is not a member of this company.' } });

    const result = await removeOrganizationMember('org-1', 'u-ghost');

    expect(result.success).toBe(false);
  });

  it('confirms a removal that the database accepted', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(removeOrganizationMember('org-1', 'u1')).resolves.toEqual({ success: true });
  });

  it('refuses to call either without both ids', async () => {
    await expect(setOrganizationMemberStatus('', 'u1', 'active')).resolves.toMatchObject({ success: false });
    await expect(removeOrganizationMember('org-1', '')).resolves.toMatchObject({ success: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});