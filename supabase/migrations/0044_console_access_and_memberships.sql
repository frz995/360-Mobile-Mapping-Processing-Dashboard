-- =====================================================================
-- GeoSphere 360 — Console access, membership lifecycle, tenant switch
-- (Migration 0044)
--
-- THE DEFECT THIS FIXES
--   The Seller Console can create a company and cannot staff it. Verified by
--   audit on 14 October 2026:
--
--   * `organization_members` (0036:191) has `user_id UUID NOT NULL REFERENCES
--     auth.users(id)`, so a membership cannot exist before an auth user does.
--   * No TypeScript anywhere in this repository writes that table. The only
--     reference outside tests is `src/services/tenantContext.ts:306`, a read.
--   * Even a hand-written insert lands on `status TEXT NOT NULL DEFAULT
--     'invited'` (0036:197), and `sec.current_org()` counts only
--     `status = 'active'` (0036:388).
--
--   So every company created in the console was an empty shell no human could
--   ever join, and every non-bootstrap tenant's data was invisible to
--   everyone. The bootstrap organization 00000000-...-0001 owns all
--   pre-existing projects, so the install worked only for a platform admin.
--
--   `v33` §3 calls this failure mode C: a failure that renders as a healthy
--   value. The console rendered a complete-looking control plane over a
--   registry nothing could join.
--
-- WHAT THIS MIGRATION DOES
--   1. Makes the platform-admin question askable from the browser.
--   2. Makes the membership list renderable — `organization_members` carries no
--      email and `auth.users` is not reachable from PostgREST, so the console
--      could previously show UUIDs and nothing else.
--   3. Writes the `invited -> active` transition, gated on a confirmed email.
--   4. Lets a multi-company caller choose their active tenant, which
--      `sec.current_org()` already honours but nothing could write.
--
-- WHY `activate_pending_memberships()` TAKES NO USER ID PARAMETER
--   This is the design, not an oversight. A function that could activate
--   someone else's invite is the vulnerability; the whole control is that the
--   caller is `auth.uid()` and no argument can widen it. Gate 2.12 in
--   `0011_security_tests.sql` asserts the negative.
--
-- SCOPE AND HONEST LIMIT
--   This migration does NOT create auth users. That needs the GoTrue admin
--   API, i.e. `service_role`, i.e. the Cloudflare edge
--   (`functions/api/console-invite.js`). It also does NOT enforce seat or
--   storage quotas: `allowedUserSeats` stays display-only, because whether an
--   unconfirmed invite consumes a licensed seat is a commercial decision this
--   migration has no business making.
--
--   It does NOT connect `dedicated_external` routing. Those credentials are
--   stored and read by the console; the app still never dials that database.
--
-- Idempotency claim: Safe to re-run. Every function is CREATE OR REPLACE, and
-- every grant is revoked before it is re-granted.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. sec.require_platform_admin(): one place that refuses.
--
--    Raised from inside SECURITY DEFINER functions, where `organization_members`
--    policies do NOT apply — RLS is evaluated against the function owner. The
--    explicit check below is therefore the only gate on those bodies, which is
--    precisely why it lives in one named function rather than being inlined six
--    times where a copy could drift.
--
--    SQLSTATE 42501 (insufficient_privilege) so a caller can distinguish
--    "you may not do this" from "that failed" rather than reading a generic
--    error string.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sec.require_platform_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF NOT sec.is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorised: this operation is restricted to platform administrators.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION sec.require_platform_admin() FROM public;
GRANT EXECUTE ON FUNCTION sec.require_platform_admin() TO authenticated;

COMMENT ON FUNCTION sec.require_platform_admin() IS
  'Raises 42501 unless the caller is a platform administrator. Called at the top of every console_* SECURITY DEFINER body, because RLS does not protect a table from its own definer.';

-- ---------------------------------------------------------------------
-- 1b. sec.auth_email_confirmed_at(): the confirmation timestamp, whichever
--     schema this installation is running.
--
--     GoTrue renamed this column. A current hosted Supabase project has
--     `auth.users.email_confirmed_at`; the `supabase/postgres` image this
--     repository's own gate boots has `auth.users.confirmed_at`. Both are in
--     the field, and hard-coding either one makes `activate_pending_memberships`
--     fail at runtime on the other -- which is the entire activation gate, so
--     the failure mode is "nobody can ever be activated".
--
--     Found by running `node scripts/run-db-gate.mjs`, which is the point of
--     having it.
--
--     Returns NULL when the column is absent entirely. That is deliberately
--     fail-CLOSED: the caller treats NULL as "not confirmed" and refuses to
--     activate, rather than activating on an unmeasurable fact. A WARNING names
--     the problem so it is visible in the apply log.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sec.auth_email_confirmed_at(p_user_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_col text;
  v_at  TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_confirmed_at'
  ) THEN
    v_col := 'email_confirmed_at';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmed_at'
  ) THEN
    v_col := 'confirmed_at';
  ELSE
    RAISE WARNING
      '0044: auth.users has neither email_confirmed_at nor confirmed_at. No invitation can be activated on this database until one exists.';
    RETURN NULL;
  END IF;

  EXECUTE format('SELECT %I FROM auth.users WHERE id = $1', v_col) INTO v_at USING p_user_id;
  RETURN v_at;
END;
$$;

REVOKE ALL ON FUNCTION sec.auth_email_confirmed_at(UUID) FROM public;
GRANT EXECUTE ON FUNCTION sec.auth_email_confirmed_at(UUID) TO authenticated;

COMMENT ON FUNCTION sec.auth_email_confirmed_at(UUID) IS
  'The email-confirmation timestamp for a user id, reading whichever column this GoTrue schema actually has (email_confirmed_at on current Supabase, confirmed_at on the bundled image). NULL means unconfirmed, absent user, or no such column -- all three must fail closed.';

-- ---------------------------------------------------------------------
-- 2. public.console_access(): the UI gate question.
--
--    `sec.is_platform_admin()` is unreachable from the browser — the `sec`
--    schema is not exposed by PostgREST and this app configures no
--    `db-schema`. Without this RPC the console literally cannot ask whether
--    the signed-in person is allowed to see it, which is why `/console` was
--    gated on `authSession` alone (App.tsx:2928) and any Viewer could open it.
--
--    SECURITY INVOKER, deliberately: it composes `sec.is_platform_admin()`,
--    which is already `SECURITY DEFINER`, and grants nothing new. Matches the
--    reasoning in 0038 §1 for `sec.in_org` — keep the elevated surface small
--    and confined to the two functions that need it.
--
--    `organization_ids` is the caller's own memberships, so the same read
--    serves both the console gate and the tenant switcher.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_access()
RETURNS TABLE (
    is_platform_admin BOOLEAN,
    organization_ids  UUID[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, sec
AS $$
  -- `sec.member_org_ids()` is SETOF UUID, so it has to be aggregated into an
  -- array before it can be coalesced against an empty one. Coalescing the bare
  -- set against `ARRAY[]::UUID[]` raises
  -- "COALESCE types uuid and uuid[] cannot be matched" -- which is how the
  -- cross-tenant gate found this the first time.
  SELECT sec.is_platform_admin(),
         COALESCE(ARRAY(SELECT sec.member_org_ids()), ARRAY[]::UUID[]);
$$;

REVOKE ALL ON FUNCTION public.console_access() FROM public;
REVOKE ALL ON FUNCTION public.console_access() FROM anon;
GRANT EXECUTE ON FUNCTION public.console_access() TO authenticated;

COMMENT ON FUNCTION public.console_access() IS
  'Reports whether the caller is a platform administrator, and which companies they belong to. The only browser-reachable route to sec.is_platform_admin(). A failed read must surface as unverified in the UI, never as a false.';

-- ---------------------------------------------------------------------
-- 3. public.console_organization_members(): the list the console renders.
--
--    `organization_members` has no email column (0036:191-203) and PostgREST
--    cannot read `auth.users`. Without this join the Members panel could
--    display a list of UUIDs, which is not a list of staff.
--
--    SECURITY DEFINER for the auth.users read only; authorisation is the
--    explicit check, not RLS.
--
--    `email_confirmed_at` is returned separately from `status` on purpose.
--    The two are independent facts — `invited` + confirmed means "clicked the
--    link, has not signed in yet" — and collapsing them into one badge is how
--    an invite queue starts reporting people as registered when no account
--    exists.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_organization_members(p_organization_id UUID)
RETURNS TABLE (
    user_id            UUID,
    email              TEXT,
    email_confirmed_at TIMESTAMPTZ,
    role               TEXT,
    status             TEXT,
    invited_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec, auth
AS $$
BEGIN
  PERFORM sec.require_platform_admin();

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'An organization id is required.'
      USING ERRCODE = '22004';
  END IF;

  RETURN QUERY
    SELECT m.user_id,
           u.email,
           sec.auth_email_confirmed_at(m.user_id),
           m.role,
           m.status,
           m.invited_at,
           m.created_at
      FROM public.organization_members m
      LEFT JOIN auth.users u ON u.id = m.user_id
     WHERE m.organization_id = p_organization_id
     ORDER BY lower(COALESCE(u.email, '')), m.invited_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.console_organization_members(UUID) FROM public;
REVOKE ALL ON FUNCTION public.console_organization_members(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.console_organization_members(UUID) TO authenticated;

COMMENT ON FUNCTION public.console_organization_members(UUID) IS
  'Platform-administrator view of one company''s staff, joined to auth.users for the email address. email_confirmed_at is deliberately separate from status: invited+confirmed and invited+unconfirmed are different states with different operator responses.';

-- ---------------------------------------------------------------------
-- 4. public.console_invite_member(): write the `invited` row.
--
--    Idempotent on (organization_id, user_id) per 0036:202, so re-inviting an
--    existing member returns them rather than raising a unique violation the
--    seller has to interpret. A suspended member being re-invited moves back
--    to `invited` deliberately: that is how you restore someone.
--
--    `p_user_id` rather than an email, because the caller resolves the email
--    to a user first (`functions/api/console-invite.js`). An invite cannot
--    create the auth account itself.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_invite_member(
    p_organization_id UUID,
    p_user_id         UUID,
    p_role            TEXT
)
RETURNS public.organization_members
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, sec
AS $$
DECLARE
    v_role   TEXT;
    v_result public.organization_members;
BEGIN
  PERFORM sec.require_platform_admin();

  IF p_organization_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Both an organization id and a user id are required.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id) THEN
    RAISE EXCEPTION 'No such company (%).', p_organization_id
      USING ERRCODE = '23503';
  END IF;

  -- `sec.normalize_org_role` maps the tenant vocabulary onto the canonical
  -- one and falls back to 'Viewer'. The column CHECK accepts the tenant
  -- spelling, so re-map the result back rather than storing a capability name
  -- the CHECK would reject.
  v_role := CASE sec.normalize_org_role(p_role)
              WHEN 'Administrator' THEN 'CompanyAdmin'
              WHEN 'Survey Operator' THEN 'Operator'
              WHEN 'QA Inspector'    THEN 'Inspector'
              ELSE 'Viewer'
            END;

  INSERT INTO public.organization_members AS m (organization_id, user_id, role, status, invited_by)
  VALUES (p_organization_id, p_user_id, v_role, 'invited', auth.uid())
  ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role       = EXCLUDED.role,
          status     = 'invited',
          invited_by = EXCLUDED.invited_by,
          invited_at = NOW()
    RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.console_invite_member(UUID, UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.console_invite_member(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.console_invite_member(UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.console_invite_member(UUID, UUID, TEXT) IS
  'Platform-administrator only. Creates or re-opens an organization_members row at status=''invited'', which grants nothing until the invited person signs in with a confirmed email. Idempotent on (organization_id, user_id).';

-- ---------------------------------------------------------------------
-- 5. public.console_set_member_status(): suspend and restore.
--
--    Refuses to demote or suspend the caller themselves. An administrator
--    who removes their own last admin row locks the company out of its
--    console with no route back except SQL, and that is a support incident
--    every time it happens.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_set_member_status(
    p_organization_id UUID,
    p_user_id         UUID,
    p_status          TEXT
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, sec
AS $$
DECLARE
    v_normalised TEXT := lower(btrim(coalesce(p_status, '')));
BEGIN
  PERFORM sec.require_platform_admin();

  IF v_normalised NOT IN ('invited', 'active', 'suspended') THEN
    RAISE EXCEPTION 'Unknown membership status %. Expected invited, active or suspended.', p_status
      USING ERRCODE = '22023';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own membership status. Ask another administrator.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.organization_members
     SET status = v_normalised
   WHERE organization_id = p_organization_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not a member of this company.'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.console_set_member_status(UUID, UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.console_set_member_status(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.console_set_member_status(UUID, UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.console_set_member_status(UUID, UUID, TEXT) IS
  'Platform-administrator only. Sets organization_members.status. Refuses a self-edit, because removing your own admin row locks the company out of its own console with no route back but SQL.';

-- ---------------------------------------------------------------------
-- 6. public.console_remove_member().
--
--    ON DELETE CASCADE from auth.users means the row also disappears if the
--    person deletes their own account, so a console-managed removal is the
--    auditable path and this is where the audit belongs.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_remove_member(
    p_organization_id UUID,
    p_user_id         UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, sec
AS $$
BEGIN
  PERFORM sec.require_platform_admin();

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove your own membership. Ask another administrator.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.organization_members
   WHERE organization_id = p_organization_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That person is not a member of this company.'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.console_remove_member(UUID, UUID) FROM public;
REVOKE ALL ON FUNCTION public.console_remove_member(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.console_remove_member(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.console_remove_member(UUID, UUID) IS
  'Platform-administrator only. Deletes one membership row. Does not delete the auth account or any tenant data; that is a separate, deliberate procedure.';

-- ---------------------------------------------------------------------
-- 7. public.activate_pending_memberships(): the transition that makes a
--    console-created company usable.
--
--    THE WHOLE POINT IS THE CONFIRMED-EMAIL PREDICATE. With Supabase's
--    "Confirm email" setting disabled, signUp returns a session immediately
--    with an unverified address; any membership grant keyed on email alone
--    would then let anyone who registers a company's address walk into that
--    tenant. This function refuses to do that, through
--    `sec.auth_email_confirmed_at`, which resolves whichever column this GoTrue
--    schema actually has.
--
--    No user-id parameter exists. auth.uid() is the entire scope. Gate 2.12
--    asserts a caller cannot activate somebody else's invite, and gate 2.13
--    asserts an unconfirmed account cannot activate at all.
--
--    SECURITY INVOKER would be enough for the membership UPDATE (the caller
--    owns their own rows) but NOT for the auth.users read, hence DEFINER.
--    Reads only `email_confirmed_at`; touches no other column of auth.users.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_pending_memberships()
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, sec, auth
AS $$
DECLARE
    v_uid    UUID := auth.uid();
    v_affected INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  -- `sec.auth_email_confirmed_at` resolves `email_confirmed_at` or
  -- `confirmed_at` depending on the GoTrue schema, and returns NULL for an
  -- absent column, so this fails closed either way.
  IF sec.auth_email_confirmed_at(v_uid) IS NULL THEN
    RETURN 0;
  END IF;

  WITH activated AS (
    UPDATE public.organization_members m
       SET status = 'active'
     WHERE m.user_id = v_uid
       AND m.status = 'invited'
    RETURNING m.id
  )
  SELECT count(*) INTO v_affected FROM activated;

  RETURN v_affected;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_pending_memberships() FROM public;
REVOKE ALL ON FUNCTION public.activate_pending_memberships() FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_pending_memberships() TO authenticated;

COMMENT ON FUNCTION public.activate_pending_memberships() IS
  'Activates the CALLER''S OWN invited memberships, and only when the caller''s email address is confirmed (see sec.auth_email_confirmed_at for the column-name variance). Called on first authenticated sign-in. Takes no user id on purpose: the caller is auth.uid() and no argument can widen it.';

-- ---------------------------------------------------------------------
-- 7b. public.console_organization_seat_summary(): licensed vs actual, in one call.
--
--    Schedule A sells named user seats and the Vendor currently cannot detect a
--    breach of them. This makes the number detectable; it does NOT enforce it
--    (see the header's SCOPE AND HONEST LIMIT — whether an unconfirmed invite
--    consumes a licensed seat is a commercial decision, not a SQL default).
--
--    One aggregate for the whole install rather than N calls into
--    console_organization_members(): a seller with 40 companies should not fire
--    40 round trips to open one panel.
--
--    `licensed_seats` is NULL when `organizations.settings` carries no
--    `allowedUserSeats`. That is "not configured", which is a different fact
--    from zero seats, and the console renders it as unknown. Coalescing it to 0
--    here would report that a company has sold no seats when in fact nobody has
--    ever said.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_organization_seat_summary()
RETURNS TABLE (
    organization_id  UUID,
    organization_name TEXT,
    client_code      TEXT,
    licensed_seats   INTEGER,
    active_seats     BIGINT,
    invited_seats    BIGINT,
    suspended_seats  BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec
AS $$
BEGIN
  PERFORM sec.require_platform_admin();

  RETURN QUERY
    SELECT o.id,
           o.name,
           COALESCE(o.client_code, ''),
           CASE
             WHEN jsonb_typeof(o.settings -> 'allowedUserSeats') = 'number'
               THEN (o.settings ->> 'allowedUserSeats')::INTEGER
             ELSE NULL
           END,
           count(*) FILTER (WHERE m.status = 'active'),
           count(*) FILTER (WHERE m.status = 'invited'),
           count(*) FILTER (WHERE m.status = 'suspended')
      FROM public.organizations o
      LEFT JOIN public.organization_members m ON m.organization_id = o.id
     GROUP BY o.id, o.name, o.client_code, o.settings
     ORDER BY lower(o.name);
END;
$$;

REVOKE ALL ON FUNCTION public.console_organization_seat_summary() FROM public;
REVOKE ALL ON FUNCTION public.console_organization_seat_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.console_organization_seat_summary() TO authenticated;

COMMENT ON FUNCTION public.console_organization_seat_summary() IS
  'Platform-administrator only. Licensed seats (from organizations.settings) beside actual active/invited/suspended member counts, for every company, in one round trip. licensed_seats is NULL when never configured, which is NOT zero.';

-- ---------------------------------------------------------------------
-- 8. Tenant selection for people who belong to more than one company.
--
--    `sec.current_org()` (0036:403) already honours
--    `user_accounts.active_organization_id` when there are several
--    memberships — but nothing ever wrote it, so such a caller resolved NULL
--    and saw nothing at all. Fails closed, so safe, but a dead end.
--
--    The membership re-check inside the body is not decoration: it is what
--    stops a forged value from selecting a company the caller does not
--    belong to. It is the same reasoning as 0036 §3.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_active_organization(p_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, sec
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'An organization id is required.'
      USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_members m
     WHERE m.user_id = auth.uid()
       AND m.organization_id = p_organization_id
       AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'You are not an active member of that company.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_accounts
     SET active_organization_id = p_organization_id,
         updated_at = NOW()
   WHERE lower(email) = lower(COALESCE(sec.caller_email(), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_organization(UUID) FROM public;
REVOKE ALL ON FUNCTION public.set_active_organization(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_active_organization(UUID) TO authenticated;

COMMENT ON FUNCTION public.set_active_organization(UUID) IS
  'Sets user_accounts.active_organization_id for the CALLER, after re-checking membership inside the body. Only active memberships qualify. Closes the multi-company dead end where sec.current_org() resolved NULL because nothing wrote this column.';

-- ---------------------------------------------------------------------
-- 9. Verification.
--
--    Asserted against the catalog rather than in prose, so a later migration
--    that widens a grant or drops an ownership fails here rather than in
--    production.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_leak integer;
    v_fn   text;
BEGIN
  -- anon must hold nothing on any console_* function.
  SELECT count(*) INTO v_leak
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname LIKE 'console\_%' OR p.proname = 'activate_pending_memberships'
          OR p.proname = 'set_active_organization')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_leak > 0 THEN
    RAISE EXCEPTION
      '0044 VERIFICATION FAILED: anon holds EXECUTE on % console function(s). These operate on the tenant registry and auth.users.',
      v_leak;
  END IF;

  -- PUBLIC must hold nothing either: revoke-from-public plus grant-to-authenticated
  -- means PUBLIC has no path in.
  SELECT count(*) INTO v_leak
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname LIKE 'console\_%' OR p.proname = 'activate_pending_memberships'
          OR p.proname = 'set_active_organization')
     AND has_function_privilege('public', p.oid, 'EXECUTE');
  IF v_leak > 0 THEN
    RAISE EXCEPTION
      '0044 VERIFICATION FAILED: PUBLIC holds EXECUTE on % console function(s). Supabase grants EXECUTE to PUBLIC by default; the explicit revoke is what prevents that.',
      v_leak;
  END IF;

  -- The self-scope guarantee. Read the source and refuse if a user-id
  -- parameter ever appears on the activation function: that single token is
  -- the difference between "activates the caller" and "activates anyone".
  SELECT pg_get_functiondef(p.oid) INTO v_fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'activate_pending_memberships';
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '0044 VERIFICATION FAILED: public.activate_pending_memberships() is missing.';
  END IF;
  IF v_fn ~* 'p_user_id|user_uuid|target_user' THEN
    RAISE EXCEPTION
      '0044 VERIFICATION FAILED: activate_pending_memberships() has gained a user-id parameter. It must act on auth.uid() only — see the header note on why.';
  END IF;

  -- Same for the confirmation gate. `auth_email_confirmed_at` is the
  -- schema-agnostic resolver; a literal column name here would mean one of the
  -- two GoTrue schemas silently stops activating anybody.
  IF v_fn !~* 'auth_email_confirmed_at' THEN
    RAISE EXCEPTION
      '0044 VERIFICATION FAILED: activate_pending_memberships() no longer checks a confirmed email address. Without that predicate an unverified sign-up can claim a company.';
  END IF;

  RAISE NOTICE
    '0044: console access, membership lifecycle and tenant selection exist; anon and PUBLIC hold no EXECUTE; activation is self-scoped.';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';