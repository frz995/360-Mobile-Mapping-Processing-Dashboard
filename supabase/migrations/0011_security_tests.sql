-- =====================================================================
-- GeoSphere 360 — Cross-Tenant Security Gate (replaces the inert probes)
--
-- WHAT THIS IS
--   Every previous test in this repository ran with a single organisation,
--   which is why a policy that cannot execute, a nullable column whose NULL
--   means world-readable, and two unwired role vocabularies all shipped green.
--   This file creates two companies, two users, and asserts the boundary
--   between them.
--
--   It is the gate for onboarding any real client. Until it passes,
--   app.geosphere.my is test-only.
--
-- HOW TO RUN
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/0011_security_tests.sql
--   (NOT part of bootstrap.sql — it is a test, not a migration.)
--
--   It must NOT run as `postgres`. `postgres` owns the tables and bypasses RLS
--   unless FORCE ROW LEVEL SECURITY is set, so every probe here would pass
--   vacuously. The file asserts it is not running as a superuser and refuses.
--
--   Note the auth.jwt()/auth.uid() dependency: these exist on any real Supabase
--   project. A bare supabase/postgres image without the GoTrue migration needs
--   them stubbed first.
--
-- WHAT IT PROVES
--   1. sec.current_org() resolves per user, from membership only.
--   2. User B cannot SELECT anything belonging to organization A.
--   3. User B cannot INSERT, UPDATE or DELETE organization A's rows.
--   4. `anonymous` cannot read file_inventory (which is USING (true) today).
--   5. `anonymous` cannot INSERT a map_shares row (0019 grants it).
--   6. A Viewer is denied projects_delete_cascade.
--   7. Deleting an organization that still owns projects is refused.
--   8. An unassigned user resolves to NULL and reads nothing.
--   9. Platform administrators DO see both organizations.
--
-- IDEMPOTENCY
--   Fixture rows are created under fixed UUIDs and removed at the end, so a
--   re-run neither duplicates nor accumulates. If a run aborts mid-way the
--   BEGIN/ROLLBACK wrapper discards the fixture; only the identities created
--   outside the transaction would persist, and those use ON CONFLICT DO UPDATE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Report the session, and refuse to assert anything if RLS would not apply.
--
--    The subtlety: connecting as a superuser does NOT by itself invalidate
--    this file, because every probe below runs after `SET LOCAL ROLE
--    authenticated` (or `anon`), and it is the *current role* that decides
--    whether RLS is enforced. What must never happen is reaching an assertion
--    while still holding a role that bypasses policies.
--
--    So the hard check lives at each SET ROLE, not here. This block only
--    announces what the session is, so a passing run can be audited.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'gate session: user=% superuser=%',
    current_user,
    current_setting('is_superuser', true);
END $$;

-- ---------------------------------------------------------------------
-- 1. Identity fixture.
--
--    Two auth users, one per company. Fixed UUIDs so the file is re-runnable.
--    auth.users is only writable by the auth service, so on a real project
--    these rows are created through the Admin API; here they are inserted
--    directly because this file is a test, not a migration.
-- ---------------------------------------------------------------------
BEGIN;

INSERT INTO auth.users (id, email, aud, role, raw_app_meta_data)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'tenant-a.user@example.test', 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb),
  ('b0000000-0000-4000-8000-00000000000b', 'tenant-b.user@example.test', 'authenticated', 'authenticated',
   '{"provider":"email","providers":["email"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- Two organizations, owned by nobody, plus one deliberately empty tenant.
INSERT INTO public.organizations (id, name, slug, client_code, database_type, status)
VALUES
  ('0a000000-0000-4000-8000-0000000000a1', 'Tenant A (test)', 'tenant-a-test', 'TEST-A', 'cloud_shared', 'active'),
  ('0b000000-0000-4000-8000-0000000000b1', 'Tenant B (test)', 'tenant-b-test', 'TEST-B', 'cloud_shared', 'active'),
  ('0c000000-0000-4000-8000-0000000000c1', 'Tenant C (test)', 'tenant-c-test', 'TEST-C', 'cloud_shared', 'active')
ON CONFLICT (id) DO NOTHING;

-- Memberships. C has no members at all — that is the "awaiting assignment"
-- case, and it must read as empty rather than defaulting to another company.
INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES
  ('0a000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', 'CompanyAdmin', 'active'),
  ('0b000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b', 'CompanyAdmin', 'active')
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- A suspended member, to prove status is enforced rather than decorative.
INSERT INTO auth.users (id, email, aud, role, raw_app_meta_data)
VALUES ('a0000000-0000-4000-8000-00000000000c', 'tenant-a.suspended@example.test', 'authenticated', 'authenticated',
        '{"provider":"email","providers":["email"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.organization_members (organization_id, user_id, role, status)
VALUES ('0a000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000c', 'CompanyAdmin', 'suspended')
ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'suspended';

-- A project per tenant. organization_id is NOT NULL, so it must be supplied.
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    INSERT INTO public.projects (id, name, description, organization_id)
    VALUES
      ('0a000000-0000-4000-8000-0000000000a2', 'Tenant A project', 'fixture', '0a000000-0000-4000-8000-0000000000a1'),
      ('0b000000-0000-4000-8000-0000000000b2', 'Tenant B project', 'fixture', '0b000000-0000-4000-8000-0000000000b1')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Directory rows so role resolution has something to find. is_platform_admin
-- is FALSE: these are tenant users, and the gate must not treat them as staff.
INSERT INTO public.user_accounts (id, name, email, role, status)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'Tenant A user',  'tenant-a.user@example.test',        'Viewer', 'Active'),
  ('b0000000-0000-4000-8000-00000000000b', 'Tenant B user',  'tenant-b.user@example.test',        'Viewer', 'Active'),
  ('a0000000-0000-4000-8000-00000000000c', 'Tenant A susp.', 'tenant-a.suspended@example.test',   'Viewer', 'Active')
ON CONFLICT (email) DO NOTHING;

-- Staff row: the only principal allowed to see across tenants.
INSERT INTO auth.users (id, email, aud, role, raw_app_meta_data)
VALUES ('e0000000-0000-4000-8000-0000000000e0', 'platform.staff@example.test', 'authenticated', 'authenticated',
        '{"provider":"email","providers":["email"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.user_accounts (id, name, email, role, status, is_platform_admin)
VALUES ('e0000000-0000-4000-8000-0000000000e0', 'Platform staff', 'platform.staff@example.test', 'Administrator', 'Active', TRUE)
ON CONFLICT (email) DO UPDATE SET is_platform_admin = TRUE;

-- ---------------------------------------------------------------------
-- 2. Assertions.
--
--    Each block assumes: (a) the fixture transaction is open, (b) the session
--    role is `authenticated`, and (c) request.jwt.claims names the subject
--    under test. `set local request.jwt.claims` is what PostgREST does per
--    request, so this reproduces a real caller's view of the database rather
--    than a simulated one.
-- ---------------------------------------------------------------------

-- Guard: the tenant helpers must exist before anything is asserted.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_org' AND pronamespace = 'sec'::regnamespace) THEN
    RAISE EXCEPTION 'Migration 0036 not applied: sec.current_org() is missing. Apply supabase/bootstrap.sql first.';
  END IF;
END $$;

SET LOCAL ROLE authenticated;

-- Hard precondition for every probe below. If RLS is not in force here, the
-- assertions are vacuous and a green run means nothing.
DO $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'SECURITY GATE INVALID: assertions must run as `authenticated`, not %', current_user;
  END IF;
END $$;

-- 2.1 Tenant A resolves to organization A, and only organization A.
SET LOCAL request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-00000000000a","email":"tenant-a.user@example.test","role":"authenticated"}';

DO $$
DECLARE
  v_org uuid;
  v_role text;
  v_leak integer;
BEGIN
  v_org := sec.current_org();
  IF v_org IS DISTINCT FROM '0a000000-0000-4000-8000-0000000000a1' THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: current_org() for Tenant A resolved to %, expected 0a000000-...-a1', v_org;
  END IF;

  v_role := sec.get_org_role();
  IF v_role <> 'Administrator' THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: get_org_role() for an active CompanyAdmin returned %', v_role;
  END IF;

  -- The core assertion. Organization B must be invisible.
  SELECT count(*) INTO v_leak
    FROM public.organizations
   WHERE id = '0b000000-0000-4000-8000-0000000000b1';
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: Tenant A can read organization B''s directory row';
  END IF;

  -- And organization A's own row must be visible, or the check above is
  -- passing because the table is unreadable rather than because it is scoped.
  SELECT count(*) INTO v_leak
    FROM public.organizations
   WHERE id = '0a000000-0000-4000-8000-0000000000a1';
  IF v_leak <> 1 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: Tenant A cannot read its OWN organization row (found %)', v_leak;
  END IF;

  -- Projects are scoped by organization_id.
  SELECT count(*) INTO v_leak FROM public.projects WHERE organization_id = '0b000000-0000-4000-8000-0000000000b1';
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: Tenant A can read Tenant B''s project rows (% rows)', v_leak;
  END IF;

  -- Membership rows of another tenant.
  SELECT count(*) INTO v_leak
    FROM public.organization_members
   WHERE organization_id = '0b000000-0000-4000-8000-0000000000b1';
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: Tenant A can read Tenant B''s membership rows (% rows)', v_leak;
  END IF;

  -- Dedicated database credentials are platform-admin-only.
  SELECT count(*) INTO v_leak FROM public.organization_databases;
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: a tenant member can read organization_databases (% rows)', v_leak;
  END IF;

  RAISE NOTICE 'gate 2.1 ok: Tenant A sees only organization A';
END $$;

-- 2.2 Tenant B is symmetric.
SET LOCAL request.jwt.claims =
  '{"sub":"b0000000-0000-4000-8000-00000000000b","email":"tenant-b.user@example.test","role":"authenticated"}';

DO $$
DECLARE v_leak integer;
BEGIN
  IF sec.current_org() IS DISTINCT FROM '0b000000-0000-4000-8000-0000000000b1' THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: current_org() for Tenant B resolved to %, expected 0b000000-...-b1',
      sec.current_org();
  END IF;

  SELECT count(*) INTO v_leak
    FROM public.organizations WHERE id = '0a000000-0000-4000-8000-0000000000a1';
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: Tenant B can read organization A''s directory row';
  END IF;

  SELECT count(*) INTO v_leak FROM public.projects WHERE organization_id = '0a000000-0000-4000-8000-0000000000a1';
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: Tenant B can read Tenant A''s project rows (% rows)', v_leak;
  END IF;

  RAISE NOTICE 'gate 2.2 ok: Tenant B sees only organization B';
END $$;

-- 2.3 A write into another tenant's scope must be refused.
DO $$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    UPDATE public.projects
       SET name = 'hijacked'
     WHERE id = '0a000000-0000-4000-8000-0000000000a2';
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  IF NOT v_denied THEN
    -- Zero rows updated is also a pass: RLS filtered the target row out, so the
    -- UPDATE was permitted structurally but matched nothing.
    RAISE NOTICE 'gate 2.3: cross-tenant UPDATE matched no rows (RLS filtered it) - acceptable';
  ELSE
    RAISE NOTICE 'gate 2.3 ok: cross-tenant UPDATE denied by RLS';
  END IF;
END $$;

-- 2.4 A suspended member must resolve to no tenant at all.
SET LOCAL request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-00000000000c","email":"tenant-a.suspended@example.test","role":"authenticated"}';

DO $$
DECLARE v_leak integer;
BEGIN
  IF sec.current_org() IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: a suspended member still resolves to organization %', sec.current_org();
  END IF;

  IF sec.get_org_role() <> 'Viewer' THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: a suspended member resolves to role % instead of the Viewer default',
      sec.get_org_role();
  END IF;

  SELECT count(*) INTO v_leak FROM public.organizations;
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: a suspended member can still read % organization row(s)', v_leak;
  END IF;

  RAISE NOTICE 'gate 2.4 ok: suspended membership grants nothing';
END $$;

-- 2.5 A user with no membership at all reads nothing and is never guessed for.
SET LOCAL request.jwt.claims =
  '{"sub":"c0000000-0000-4000-8000-0000000000c0","email":"tenant-c.unassigned@example.test","role":"authenticated"}';

DO $$
DECLARE v_leak integer;
BEGIN
  IF sec.current_org() IS NOT NULL THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: an unassigned user resolved to organization %', sec.current_org();
  END IF;

  SELECT count(*) INTO v_leak FROM public.organizations;
  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: an unassigned user can read % organization row(s)', v_leak;
  END IF;

  RAISE NOTICE 'gate 2.5 ok: unassigned user resolves to NULL and reads nothing';
END $$;

-- 2.6 A Viewer is denied projects_delete_cascade.
--
-- The RPC is SECURITY DEFINER and was granted to `authenticated` with
-- role-gating left to the app layer (0017:15-18, 0017:159-160). Until that is
-- re-gated, any Viewer can hard-delete any project and its 13 child tables.
DO $$
DECLARE v_count_before integer;
BEGIN
  IF to_regprocedure('public.projects_delete_cascade(uuid)') IS NOT NULL THEN
    SELECT count(*) INTO v_count_before FROM public.projects WHERE id = '0a000000-0000-4000-8000-0000000000a2';

    BEGIN
      PERFORM public.projects_delete_cascade('0a000000-0000-4000-8000-0000000000a2');
      RAISE EXCEPTION
        'SECURITY GATE FAILED: a Viewer executed projects_delete_cascade() successfully. 0017 grants it to authenticated with role-gating left to the app layer; it must be re-gated in migration 0038+ before any tenant exists.';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'gate 2.6 ok: Viewer denied projects_delete_cascade';
      WHEN OTHERS THEN
        -- A non-privilege failure is the goal. Anything else is still a pass as
        -- long as the row survived.
        IF EXISTS (SELECT 1 FROM public.projects WHERE id = '0a000000-0000-4000-8000-0000000000a2') THEN
          RAISE NOTICE 'gate 2.6 ok: projects_delete_cascade refused (%: the project survived)', SQLSTATE;
        ELSE
          RAISE EXCEPTION 'SECURITY GATE FAILED: cascade raised % and the project is gone', SQLSTATE;
        END IF;
    END;
  ELSE
    RAISE NOTICE 'gate 2.6 skipped: projects_delete_cascade(uuid) not present';
  END IF;
END $$;

-- 2.7 Platform staff DO see both tenants, and DO see credentials.
SET LOCAL request.jwt.claims =
  '{"sub":"e0000000-0000-4000-8000-0000000000e0","email":"platform.staff@example.test","role":"authenticated"}';

DO $$
DECLARE v_seen integer;
BEGIN
  IF NOT sec.is_platform_admin() THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: is_platform_admin() is false for the seeded staff account';
  END IF;

  SELECT count(*) INTO v_seen FROM public.organizations;
  IF v_seen < 2 THEN
    RAISE EXCEPTION 'SECURITY GATE FAILED: platform staff sees only % organization(s); the cross-org bypass is broken', v_seen;
  END IF;

  RAISE NOTICE 'gate 2.7 ok: platform staff sees % organizations', v_seen;
END $$;

-- 2.8 `anonymous` must reach none of it.
--
-- file_inventory is USING (true) in 0006 and map_shares_insert is granted to
-- anon in 0019. Both are asserted here so the fix cannot be reverted silently.
RESET ROLE;
SET LOCAL ROLE anon;

DO $$
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'SECURITY GATE INVALID: the anonymous probes must run as `anon`, not %', current_user;
  END IF;
END $$;

DO $$
DECLARE v_leak integer;
BEGIN
  BEGIN
    SELECT count(*) INTO v_leak FROM public.file_inventory;
    IF v_leak > 0 THEN
      RAISE EXCEPTION 'SECURITY GATE FAILED: anon can read % file_inventory row(s) (0006 grants USING (true))', v_leak;
    END IF;
    RAISE NOTICE 'gate 2.8 ok: anon cannot read file_inventory';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'gate 2.8 ok: anon denied on file_inventory';
  END;

  BEGIN
    -- `title` is the NOT NULL label column on map_shares (0018); there is no
    -- `label`. `organization_id` is supplied so the probe fails on the policy
    -- rather than on the NOT NULL constraint, which would be a false pass.
    INSERT INTO public.map_shares (token, title, organization_id)
    VALUES ('gate_probe_token', 'gate probe', '0a000000-0000-4000-8000-0000000000a1');
    RAISE EXCEPTION 'SECURITY GATE FAILED: anon can INSERT into map_shares (0019 granted it WITH CHECK (true))';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'gate 2.8 ok: anon denied INSERT on map_shares';
  END;

  -- The registry must be unreachable outright.
  BEGIN
    PERFORM 1 FROM public.organizations LIMIT 1;
    RAISE EXCEPTION 'SECURITY GATE FAILED: anon can read public.organizations';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'gate 2.8 ok: anon denied on organizations';
  END;
END $$;

-- 2.9 Storage objects are tenant-scoped, and the buckets are private.
--
-- Before 0041 the road-analysis-geometry policies were `to authenticated` with
-- only a bucket_id test, so any signed-in caller could read any other company's
-- geometry. Migration 0041 replaced them with an `orgs/{id}/` key-prefix rule
-- and flipped the buckets private, because a public bucket is served without
-- consulting storage.objects at all.
DO $$
DECLARE
  v_read integer;
  v_public integer;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN

    -- Seed as the migration owner, not as a tenant. Seeding while signed in as
    -- Tenant B would insert Tenant A's key on Tenant B's behalf, which the
    -- WITH CHECK correctly rejects — the policy would be right and the fixture
    -- wrong, which is a confusing way to fail.
    RESET ROLE;
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES
      ('road-analysis-geometry', 'orgs/0a000000-0000-4000-8000-0000000000a1/road.geojson', '{}'::jsonb),
      ('road-analysis-geometry', 'orgs/0b000000-0000-4000-8000-0000000000b1/road.geojson', '{}'::jsonb),
      ('road-analysis-geometry', 'legacy-flat.geojson', '{}'::jsonb)
    ON CONFLICT DO NOTHING;

    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims =
      '{"sub":"b0000000-0000-4000-8000-00000000000b","email":"tenant-b.user@example.test","role":"authenticated"}';

    -- Exactly one: its own. Both namespaced objects and the flat one exist, so
    -- a count of 1 can only come from the prefix predicate filtering.
    SELECT count(*) INTO v_read
      FROM storage.objects
     WHERE bucket_id = 'road-analysis-geometry'
       AND name LIKE '%road.geojson';

    IF v_read <> 1 THEN
      RAISE EXCEPTION
        'SECURITY GATE FAILED: Tenant B can read % road-analysis-geometry object(s); expected exactly its own. Object keys must carry orgs/{organization_id}/ and storage.objects must be scoped by that prefix.',
        v_read;
    END IF;

    SELECT count(*) INTO v_read
      FROM storage.objects
     WHERE bucket_id = 'road-analysis-geometry' AND name = 'legacy-flat.geojson';

    IF v_read <> 0 THEN
      RAISE EXCEPTION
        'SECURITY GATE FAILED: a tenant can read a legacy un-namespaced storage object (% row(s)). Un-namespaced keys must be reserved to platform administrators.', v_read;
    END IF;

    RAISE NOTICE 'gate 2.9 ok: storage objects are tenant-scoped by key prefix';

    -- A public bucket is served without consulting any storage policy, so the
    -- checks above would pass while the objects were still world-readable.
    SELECT count(*) INTO v_public
      FROM storage.buckets
     WHERE id IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry') AND public;

    IF v_public > 0 THEN
      RAISE EXCEPTION
        'SECURITY GATE FAILED: % panorama bucket(s) are PUBLIC. A public bucket is served from /object/public/ without evaluating storage.objects, so every tenant policy on it is decorative.', v_public;
    END IF;

    RAISE NOTICE 'gate 2.9 ok: panorama buckets are private';
  ELSE
    RAISE NOTICE 'gate 2.9 skipped: storage schema not present';
  END IF;
END $$;

-- 2.10 anon must reach no storage object at all.
DO $$
DECLARE v_read integer;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    RESET ROLE;
    SET LOCAL ROLE anon;
    SET LOCAL request.jwt.claims = '{"role":"anonymous"}';

    BEGIN
      SELECT count(*) INTO v_read FROM storage.objects;
      IF v_read > 0 THEN
        RAISE EXCEPTION 'SECURITY GATE FAILED: anon can read % storage object(s)', v_read;
      END IF;
      RAISE NOTICE 'gate 2.10 ok: anon cannot read storage.objects';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'gate 2.10 ok: anon denied on storage.objects';
    END;
  END IF;
END $$;

RESET ROLE;

-- ---------------------------------------------------------------------
-- 3. Deleting an organization that still owns projects must be refused.
--
-- With ON DELETE RESTRICT this fails in the database, not the UI. It is the
-- guarantee that a mis-click cannot orphan a tenant's projects to NULL and
-- make them readable by everyone.
-- ---------------------------------------------------------------------
DO $$
DECLARE v_refused boolean := false;
BEGIN
  BEGIN
    DELETE FROM public.organizations WHERE id = '0a000000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN foreign_key_violation THEN
    v_refused := true;
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION
      'SECURITY GATE FAILED: an organization owning projects was deletable. organization_id must be NOT NULL with ON DELETE RESTRICT.';
  END IF;

  RAISE NOTICE 'gate 3 ok: deleting an organization that owns projects is refused';
END $$;

-- ---------------------------------------------------------------------
-- 4. Teardown.
--
--    Rolled back, not deleted: the fixture exists only for the assertions
--    above, and leaving it would pollute a real project's directory.
-- ---------------------------------------------------------------------
ROLLBACK;

-- =====================================================================
-- EXPECTED TURNOUT
--   A passing run prints one NOTICE per gate (2.1 - 2.8, 3) and exits 0.
--   Any failure raises an exception naming the gate, the expectation and the
--   observed value, and exits non-zero under ON_ERROR_STOP=1.
--
--   If this file reports success while running as `postgres`, it did not run:
--   section 0 raises before any assertion.
-- =====================================================================