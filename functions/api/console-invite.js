// Resolve-or-create a Supabase auth user for a Seller Console invite.
//
// WHY THIS EXISTS AT THE EDGE AND NOT IN A MIGRATION
//   `organization_members.user_id` is `NOT NULL REFERENCES auth.users(id)`
//   (migration 0036:191), so a membership cannot exist before an auth account
//   does, and creating an auth account requires the GoTrue admin API. That API
//   is keyed by `service_role`, which must never reach a browser bundle.
//
//   So this function does the one operation that genuinely needs the service
//   key, and deliberately nothing else. The membership row itself is written by
//   `public.console_invite_member(...)` (migration 0044), which stays in the
//   database where `0011_security_tests.sql` can assert that a non-platform-
//   admin is refused. Splitting it this way keeps the privileged operation as
//   small as it can be and keeps the authorization logic testable.
//
//   `scripts/seed-admin.mjs` is the working precedent for admin.createUser in
//   this repository.
//
// WHAT THIS DOES NOT DO
//   It does not grant access. Returning a `user_id` from here grants nothing:
//   the caller must still write an `invited` membership, and that grants nothing
//   until the invited person signs in with a confirmed email
//   (`public.activate_pending_memberships()`).
//
// `confirmation_sent` IS REPORTED SEPARATELY FROM `created` ON PURPOSE
//   GoTrue can create the account and fail to deliver the mail. Reporting one
//   boolean for both would tell a seller their new team member has been
//   registered when the person has no way in. That is v33 §3 failure mode C,
//   and the fix is to never let an unmeasured outcome render as a healthy one.

const AUTH_REQUEST_TIMEOUT_MS = 10_000;

/** Deliberately permissive. The role column is a CHECK constraint in the
 *  database (0036:196); this only rejects values that could never be a real
 *  address before spending a network round trip on them. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function fail(status, message) {
  return json({ error: message }, status);
}

async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the caller is a platform administrator, read with their OWN bearer.
 *  RLS on `user_accounts` is what proves it — no privileged credential is
 *  involved in the decision about who the caller is. */
async function callerIsPlatformAdmin(env, bearer) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anon) return null;

  const target =
    `${url}/rest/v1/rpc/console_access` +
    `?select=is_platform_admin&limit=1`;

  let res;
  try {
    res = await timedFetch(
      target,
      { headers: { apikey: anon, Authorization: bearer, Accept: 'application/json' }, method: 'POST' },
      AUTH_REQUEST_TIMEOUT_MS
    );
  } catch {
    // Unreachable is not the same as "not an admin". Returning null makes the
    // caller answer 502 rather than opening or closing the door on a guess.
    return null;
  }
  if (!res.ok) return null;

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0]?.is_platform_admin === true;
}

/** Look up an existing auth user by email. Returns `{ userId }` or null. */
async function findUserByEmail(env, email) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) return null;

  // GoTrue returns { users: [...], total: ... } from GET /admin/users
  const target = `${url}/auth/v1/admin/users?per_page=1000`;

  let res;
  try {
    res = await timedFetch(
      target,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' } },
      AUTH_REQUEST_TIMEOUT_MS
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  const usersArray = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
  const normalized = email.toLowerCase().trim();
  const matched = usersArray.find((u) => (u?.email || '').toLowerCase().trim() === normalized);
  return matched?.id ? { userId: String(matched.id) } : null;
}

/**
 * POST /api/console-invite   { "email": "..." }
 * ->  { user_id, created, confirmation_sent, already_platform_admin }
 */
export async function onRequestPost({ request, env }) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    return fail(503, 'Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Cloudflare Pages.');
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return fail(401, 'Sign in to invite team members.');
  }

  // The middleware already validated the bearer; this asks the separate
  // question of whether that bearer is allowed to create accounts at all.
  const isAdmin = await callerIsPlatformAdmin(env, authorization);
  if (isAdmin === null) {
    return fail(502, 'Could not verify your administrator access.');
  }
  if (!isAdmin) {
    return fail(403, 'Only platform administrators can invite team members.');
  }

  let email;
  try {
    const body = await request.json();
    email = String(body?.email || '').trim().toLowerCase();
  } catch {
    return fail(400, 'Send a JSON body with an "email" field.');
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    return fail(400, 'Enter a valid email address.');
  }

  const existing = await findUserByEmail(env, email);

  if (existing) {
    // Not a failure and not a surprise: someone already on this install who
    // is being added to a second company. Reported so the console can say
    // "already has an account" instead of implying a new one was made.
    const alreadyAdmin = await callerEmailIsPlatformAdmin(env, serviceKey, existing.userId);
    return json({
      user_id: existing.userId,
      created: false,
      confirmation_sent: false,
      already_platform_admin: alreadyAdmin === true
    });
  }

  let created;
  try {
    const res = await timedFetch(
      `${url}/auth/v1/admin/users`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        // email_confirm:false is the whole point. The account exists but
        // cannot be used until the person proves they own the address, which is
        // the only thing standing between a shared mailbox and a data breach.
        body: JSON.stringify({
          email,
          email_confirm: false,
          user_metadata: {}
        })
      },
      AUTH_REQUEST_TIMEOUT_MS
    );

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || `HTTP ${res.status}`;
      // Fallback: if user already exists in auth.users, resolve their id rather than aborting
      if (res.status === 422 && /already.*registered/i.test(message)) {
        const retry = await findUserByEmail(env, email);
        if (retry) {
          const alreadyAdmin = await callerEmailIsPlatformAdmin(env, serviceKey, retry.userId);
          return json({
            user_id: retry.userId,
            created: false,
            confirmation_sent: false,
            already_platform_admin: alreadyAdmin === true
          });
        }
      }
      return fail(res.status === 422 ? 409 : 502, `The account could not be created: ${message}`);
    }
    created = payload;
  } catch {
    return fail(502, 'Could not reach the authentication service.');
  }

  const userId = created?.id ? String(created.id) : '';
  if (!userId) {
    // The directory accepted the request but returned nothing usable. Reporting
    // success here would leave the seller believing a team member exists.
    return fail(502, 'The authentication service accepted the request but returned no user.');
  }

  // GoTrue sends the confirmation mail as a side effect and does not always
  // report whether it landed. Absence of a confirmation_sent flag is treated as
  // "not confirmed sent" rather than assumed fine — the console offers a manual
  // resend, which is the honest response to not knowing.
  const confirmationSent = created?.confirmation_sent_at != null;

  return json({
    user_id: userId,
    created: true,
    confirmation_sent: confirmationSent,
    already_platform_admin: false
  });
}

/** Best-effort check so the console can warn before writing a no-op invite. */
async function callerEmailIsPlatformAdmin(env, serviceKey, userId) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  try {
    const res = await timedFetch(
      `${url}/rest/v1/user_accounts?select=is_platform_admin&id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' } },
      AUTH_REQUEST_TIMEOUT_MS
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0]?.is_platform_admin === true : null;
  } catch {
    return null;
  }
}