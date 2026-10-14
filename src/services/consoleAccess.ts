/**
 * Seller Console access, membership lifecycle and tenant selection.
 *
 * WHY THIS EXISTS SEPARATELY FROM `tenantContext.ts`
 *   `tenantContext.ts` owns the company registry: create, edit, delete, and the
 *   dedicated-database credentials. It reads `organizations` directly under RLS.
 *
 *   This module owns the questions that cannot be answered that way:
 *
 *   1. **Is this caller allowed to see the console at all?** `sec.is_platform_admin()`
 *      is unreachable from the browser — the `sec` schema is not exposed by
 *      PostgREST and this app configures no `db-schema` — so the answer has to
 *      come through `public.console_access()` (migration 0044). Without it
 *      `/console` was gated on `authSession` alone and any signed-in Viewer
 *      could open it.
 *
 *   2. **Who is on this company's staff?** `organization_members` carries no
 *      email and `auth.users` is not reachable from PostgREST, so the list the
 *      console renders has to come from `public.console_organization_members()`.
 *
 *   3. **How does an invited person become active?** Only through
 *      `public.activate_pending_memberships()`, which is scoped to `auth.uid()`
 *      and gated on a confirmed email. Nothing else in the client may write a
 *      membership status.
 *
 * THE RULE THIS MODULE ENFORCES
 *   "I could not determine this" is never reported as "no" or as "yes".
 *   `fetchConsoleAccess` returns three states for exactly that reason, and every
 *   write reports what the database actually did.
 */

import { supabase } from './api/client';
import { reportWriteFailure, reportWriteSuccess } from '../lib/writeFailures';

/**
 * Stable operation keys. A retry loop must produce one banner line, not one per
 * attempt, so these are declared rather than written inline at each call site.
 */
export const CONSOLE_WRITE_OPS = {
  invite: 'console.membership.invite',
  status: 'console.membership.status',
  remove: 'console.membership.remove',
  activate: 'console.membership.activate'
} as const;

/**
 * How long the edge invite call may take.
 *
 * It crosses two network hops (Pages Function -> GoTrue) and does real work, so
 * it gets a wider budget than a direct PostgREST read. The point of the bound is
 * that an unbounded fetch leaves the console's Invite button spinning forever,
 * which reads as a hang rather than as a failure.
 */
const EDGE_INVITE_TIMEOUT_MS = 20_000;

export interface ConsoleAccess {
  /** The caller is a platform administrator. Only meaningful when `verified`. */
  allowed: boolean;
  /**
   * The question was answered.
   *
   * `false` means "could not determine". Treating that as `allowed: false`
   * locks out a real administrator during an outage; treating it as
   * `allowed: true` opens the console to everyone during an outage. Both are
   * wrong, which is why it is a third state rather than a nullable boolean.
   */
  verified: boolean;
  /** Human-readable reason when `verified` is false. */
  error: string | null;
  /** The caller's own companies, for the tenant switcher. */
  organizationIds: string[];
}

export type OrganizationMemberStatus = 'invited' | 'active' | 'suspended';

export interface OrganizationMemberSummary {
  userId: string;
  /** null when the auth account was deleted while the membership survived. */
  email: string | null;
  /** null when nobody has measured it — i.e. the account does not exist. */
  emailConfirmedAt: string | null;
  role: string;
  status: OrganizationMemberStatus;
  invitedAt: string | null;
}

export interface InviteOutcome {
  /** The resolved auth user. Pass this to `inviteOrganizationMember`. */
  userId: string;
  /**
   * The auth account was created by this call.
   *
   * `false` means the person already had an account on this install — which is
   * the normal case for someone being added to a second company, not an error.
   */
  created: boolean;
  /**
   * Whether a confirmation email was sent.
   *
   * Reported separately from `created` because GoTrue can create the account
   * and fail to deliver the mail. One boolean for both would report a team
   * member as registered when they have no way in.
   */
  confirmationSent: boolean;
  /** The account already sees every tenant, so a tenant role would be a no-op. */
  alreadyPlatformAdmin: boolean;
}

/** Narrow an unknown thrown value to a message without asserting its type. */
function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/**
 * Ask the database whether the caller may open the console.
 *
 * Fails soft and reports: a console that renders "no access" during a network
 * blip would look identical to a real refusal, and those demand opposite
 * responses from the operator.
 */
export async function fetchConsoleAccess(): Promise<ConsoleAccess> {
  const unverified = (error: string): ConsoleAccess => ({
    allowed: false,
    verified: false,
    error,
    organizationIds: []
  });

  try {
    const { data, error } = await supabase.rpc('console_access');

    // A PostgREST builder resolves with `{ data, error }` rather than throwing,
    // so `error` is the failure signal. A try/catch alone would be dead code.
    if (error) {
      console.warn('Console access read failed:', error.message);
      return unverified(error.message);
    }
    if (!Array.isArray(data) || data.length === 0) {
      return unverified('The console access check returned no result.');
    }

    const row = data[0] as { is_platform_admin?: unknown; organization_ids?: unknown };
    return {
      allowed: row?.is_platform_admin === true,
      verified: true,
      error: null,
      organizationIds: Array.isArray(row?.organization_ids)
        ? (row.organization_ids as unknown[]).filter((v): v is string => typeof v === 'string')
        : []
    };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not reach the console access check.');
    console.warn('Console access read threw:', message);
    return unverified(message);
  }
}

/** The staff of one company. Platform administrators only; RLS refuses others. */
export async function fetchOrganizationMembers(
  organizationId: string
): Promise<{ members: OrganizationMemberSummary[]; error: string | null }> {
  if (!organizationId) {
    return { members: [], error: 'No company selected.' };
  }

  try {
    const { data, error } = await supabase.rpc('console_organization_members', {
      p_organization_id: organizationId
    });

    if (error) {
      console.warn('Organization members read failed:', error.message);
      return { members: [], error: error.message };
    }
    if (!Array.isArray(data)) {
      return { members: [], error: 'The member list returned no payload.' };
    }

    const members: OrganizationMemberSummary[] = data.map((raw: MemberRowShape) => {
      const status = raw?.status;
      // Timestamps arrive as strings over JSON. Anything else — including null
      // and undefined — is "not measured", and must not be coerced to a date.
      const confirmedAt = typeof raw?.email_confirmed_at === 'string' ? raw.email_confirmed_at : null;
      const invitedAt = typeof raw?.invited_at === 'string' ? raw.invited_at : null;
      return {
        userId: String(raw?.user_id ?? ''),
        email: typeof raw?.email === 'string' ? raw.email : null,
        emailConfirmedAt: confirmedAt,
        role: String(raw?.role ?? 'Viewer'),
        // An unrecognised status would render as an empty badge, which reads as
        // "nothing to report" rather than "the database said something I do not
        // understand". Anything other than the two reversible states is reported
        // as the offer it still is.
        status: (status === 'active' || status === 'suspended' ? status : 'invited') as OrganizationMemberStatus,
        invitedAt
      };
    });

    return { members, error: null };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not read the member list.');
    console.warn('Organization members read threw:', message);
    return { members: [], error: message };
  }
}

/**
 * Resolve-or-create the auth account an invite needs.
 *
 * This is the one step that needs `service_role`, so it goes through the Cloudflare
 * edge (`functions/api/console-invite.js`) rather than straight to Supabase.
 *
 * Creating an account is not the same as granting access: the returned
 * `user_id` confers nothing until the caller writes an `invited` membership
 * through {@link inviteOrganizationMember}.
 *
 * The `Authorization` header is not decoration. The Pages middleware verifies
 * the bearer is a real session, and the function separately asks
 * `public.console_access()` whether that session is a platform administrator —
 * creating auth users is not something a tenant member may do.
 */
export async function resolveInviteeAccount(
  email: string
): Promise<{ ok: true; outcome: InviteOutcome } | { ok: false; error: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, error: 'Enter an email address.' };
  }

  let response: Response;
  try {
    response = await fetch('/api/console-invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${(await currentAccessToken()) || ''}`
      },
      body: JSON.stringify({ email: trimmed }),
      signal: AbortSignal.timeout(EDGE_INVITE_TIMEOUT_MS)
    });
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not reach the invite service.');
    reportWriteFailure(CONSOLE_WRITE_OPS.invite, 'Team member invite', message);
    return { ok: false, error: message };
  }

  // Narrowed rather than `any`: only the fields declared on the shape are read
  // back, and a service that grew a new one should not silently widen what this
  // trusts.
  let body: InviteResponseShape | null = null;
  try {
    body = (await response.json()) as InviteResponseShape;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const detail = typeof body?.error === 'string' ? body.error : '';
    const message = detail || `The invite service replied with HTTP ${response.status}.`;
    reportWriteFailure(CONSOLE_WRITE_OPS.invite, 'Team member invite', message);
    return { ok: false, error: message };
  }

  const userId = typeof body?.user_id === 'string' ? body.user_id : '';
  if (!userId) {
    // The service accepted the call and returned nothing usable. Reporting
    // success would leave the seller believing a team member exists.
    const message = 'The invite service accepted the request but returned no user.';
    reportWriteFailure(CONSOLE_WRITE_OPS.invite, 'Team member invite', message);
    return { ok: false, error: message };
  }

  reportWriteSuccess(CONSOLE_WRITE_OPS.invite);
  return {
    ok: true,
    outcome: {
      userId,
      created: body?.created === true,
      confirmationSent: body?.confirmation_sent === true,
      alreadyPlatformAdmin: body?.already_platform_admin === true
    }
  };
}

/**
 * Write the `invited` membership.
 *
 * Separate from {@link resolveInviteeAccount} on purpose: authorization for this
 * lives in the database (migration 0044) where the cross-tenant gate can assert
 * it, rather than in a JavaScript function the tests would mock.
 */
export async function inviteOrganizationMember(
  organizationId: string,
  userId: string,
  role: string
): Promise<{ success: boolean; error?: string }> {
  if (!organizationId || !userId) {
    return { success: false, error: 'A company and a user are both required.' };
  }

  try {
    const { data, error } = await supabase.rpc('console_invite_member', {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_role: role
    });

    // 23505 cannot occur: the function is idempotent on (org, user). A null
    // payload with no error still means nothing was written, and is treated as
    // a failure rather than a success.
    if (error) {
      console.warn('Membership invite failed:', error.message);
      reportWriteFailure(CONSOLE_WRITE_OPS.invite, 'Team member invite', error.message);
      return { success: false, error: error.message };
    }
    if (!data) {
      const message = 'The invite was accepted but no membership was returned.';
      reportWriteFailure(CONSOLE_WRITE_OPS.invite, 'Team member invite', message);
      return { success: false, error: message };
    }

    reportWriteSuccess(CONSOLE_WRITE_OPS.invite);
    return { success: true };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not reach the organization directory.');
    console.warn('Membership invite threw:', message);
    reportWriteFailure(CONSOLE_WRITE_OPS.invite, 'Team member invite', message);
    return { success: false, error: message };
  }
}

export async function setOrganizationMemberStatus(
  organizationId: string,
  userId: string,
  status: OrganizationMemberStatus
): Promise<{ success: boolean; error?: string }> {
  if (!organizationId || !userId) {
    return { success: false, error: 'A company and a user are both required.' };
  }

  try {
    const { error } = await supabase.rpc('console_set_member_status', {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_status: status
    });

    if (error) {
      console.warn('Membership status change failed:', error.message);
      reportWriteFailure(CONSOLE_WRITE_OPS.status, 'Membership status', error.message);
      return { success: false, error: error.message };
    }

    reportWriteSuccess(CONSOLE_WRITE_OPS.status);
    return { success: true };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not reach the organization directory.');
    console.warn('Membership status change threw:', message);
    reportWriteFailure(CONSOLE_WRITE_OPS.status, 'Membership status', message);
    return { success: false, error: message };
  }
}

export async function removeOrganizationMember(
  organizationId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  if (!organizationId || !userId) {
    return { success: false, error: 'A company and a user are both required.' };
  }

  try {
    const { error } = await supabase.rpc('console_remove_member', {
      p_organization_id: organizationId,
      p_user_id: userId
    });

    if (error) {
      console.warn('Membership removal failed:', error.message);
      reportWriteFailure(CONSOLE_WRITE_OPS.remove, 'Member removal', error.message);
      return { success: false, error: error.message };
    }

    reportWriteSuccess(CONSOLE_WRITE_OPS.remove);
    return { success: true };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not reach the organization directory.');
    console.warn('Membership removal threw:', message);
    reportWriteFailure(CONSOLE_WRITE_OPS.remove, 'Member removal', message);
    return { success: false, error: message };
  }
}

/**
 * Activate this caller's own pending invites.
 *
 * Call once per authenticated session, before the first data read. It is
 * idempotent — the SQL only touches rows still at `invited` — so a repeat call
 * costs one cheap statement and cannot double-activate.
 *
 * A failure here is not fatal to the session. The person is still signed in;
 * they simply keep the awaiting-assignment state until it succeeds, which is
 * the honest outcome.
 */
export async function activatePendingMemberships(): Promise<{ activated: number | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('activate_pending_memberships');

    if (error) {
      console.warn('Membership activation failed:', error.message);
      return { activated: null, error: error.message };
    }

    const count = typeof data === 'number' ? data : null;
    if (count === null) {
      return { activated: null, error: 'Activation returned no count.' };
    }
    reportWriteSuccess(CONSOLE_WRITE_OPS.activate);
    return { activated: count, error: null };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not reach the organization directory.');
    console.warn('Membership activation threw:', message);
    return { activated: null, error: message };
  }
}

/**
 * Choose which company a multi-company caller is working in.
 *
 * `sec.current_org()` already honours this column when there are several
 * memberships; nothing wrote it, so such a caller resolved NULL and saw
 * nothing. The SQL re-checks membership inside its own body.
 */
export async function setActiveOrganization(organizationId: string): Promise<{ success: boolean; error?: string }> {
  if (!organizationId) {
    return { success: false, error: 'No company selected.' };
  }

  try {
    const { error } = await supabase.rpc('set_active_organization', {
      p_organization_id: organizationId
    });

    if (error) {
      console.warn('Active organization change failed:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not reach the organization directory.');
    console.warn('Active organization change threw:', message);
    return { success: false, error: message };
  }
}

/**
 * Untyped PostgREST / edge-function rows, narrowed explicitly.
 *
 * Declared field-by-field rather than typed as `any`, so a renamed column
 * fails to compile instead of arriving at the UI as `undefined`. Every field is
 * `unknown` because PostgREST returns `any` and the mapper is the place that
 * decides what a missing value means.
 */
interface MemberRowShape {
  user_id?: unknown;
  email?: unknown;
  email_confirmed_at?: unknown;
  role?: unknown;
  status?: unknown;
  invited_at?: unknown;
}

interface SeatSummaryRowShape {
  organization_id?: unknown;
  organization_name?: unknown;
  client_code?: unknown;
  licensed_seats?: unknown;
  active_seats?: unknown;
  invited_seats?: unknown;
  suspended_seats?: unknown;
}

interface InviteResponseShape {
  user_id?: unknown;
  created?: unknown;
  confirmation_sent?: unknown;
  already_platform_admin?: unknown;
  error?: unknown;
}

export interface SeatSummaryRow {
  organizationId: string;
  organizationName: string;
  clientCode: string;
  /**
   * null when `organizations.settings` carries no `allowedUserSeats`.
   *
   * "Never configured" is a different fact from "zero seats sold", and the two
   * demand opposite responses from a seller, so they must not share a value.
   */
  licensedSeats: number | null;
  activeSeats: number;
  invitedSeats: number;
  suspendedSeats: number;
}

/**
 * Licensed seats beside actual members, for every company, in one round trip.
 *
 * Not N calls into `console_organization_members()`: a seller with 40 companies
 * should not fire 40 requests to open one panel.
 */
export async function fetchSeatSummary(): Promise<{
  rows: SeatSummaryRow[];
  error: string | null;
}> {
  try {
    const { data, error } = await supabase.rpc('console_organization_seat_summary');

    if (error) {
      console.warn('Seat summary read failed:', error.message);
      return { rows: [], error: error.message };
    }
    if (!Array.isArray(data)) {
      return { rows: [], error: 'The seat summary returned no payload.' };
    }

    return {
      rows: data.map((raw: SeatSummaryRowShape) => ({
        organizationId: String(raw?.organization_id ?? ''),
        organizationName: String(raw?.organization_name ?? ''),
        clientCode: String(raw?.client_code ?? ''),
        licensedSeats: typeof raw?.licensed_seats === 'number' ? raw.licensed_seats : null,
        activeSeats: Number(raw?.active_seats ?? 0),
        invitedSeats: Number(raw?.invited_seats ?? 0),
        suspendedSeats: Number(raw?.suspended_seats ?? 0)
      })),
      error: null
    };
  } catch (err: unknown) {
    const message = messageOf(err, 'Could not read the seat summary.');
    console.warn('Seat summary read threw:', message);
    return { rows: [], error: message };
  }
}

/** The current Supabase access token, for the edge call's Authorization header. */
async function currentAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}