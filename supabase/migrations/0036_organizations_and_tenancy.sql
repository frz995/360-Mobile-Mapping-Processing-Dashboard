-- =====================================================================
-- GeoSphere 360 — Organizations & Tenant Isolation (Migration 0036)
--
-- Establishes the tenant boundary that Plan v29 promises and Plan v30
-- assumed. This file replaces the first draft of 0036, which created the
-- registry but shipped no boundary behind it.
--
-- WHY THE FIRST DRAFT WAS REPLACED (root cause, with evidence)
-- -----------------------------------------------------------
-- The original 0036 created `organizations` and `organization_members` and
-- enabled RLS on both, but:
--
--   1. Its `org_members_select` policy queried `organization_members` from
--      inside a policy ON `organization_members`:
--          OR organization_id IN (
--              SELECT om.organization_id FROM public.organization_members om ...
--          )
--      RLS is not bypassed inside a policy expression unless it runs in a
--      SECURITY DEFINER function, so PostgreSQL raises SQLSTATE 42P17,
--      "infinite recursion detected in policy for relation
--      organization_members". Every authenticated read of the table failed.
--      `organizations_select` failed with it, because its subquery reads the
--      same table.
--
--   2. It added `projects.organization_id` and wrote no policy referencing
--      it. `projects_select` remains `USING (sec.can('viewAll'))`, and
--      `sec.can('viewAll')` returns true for every role including Viewer
--      (0009_security_functions.sql:118-120). A column no policy reads
--      isolates nothing: 12 operational tables still had no organization
--      column at all.
--
--   3. It declared two role vocabularies and wired neither to the other.
--      `organization_members.role` CHECK allows CompanyAdmin/Operator/
--      Inspector/Viewer; every predicate calls `sec.is_role(...)`, which
--      resolves the *platform* role from `user_accounts` by email
--      (0030_role_precedence.sql:151). The tenant roles were stored and
--      never enforced.
--
--   4. It added `organization_id` as NULLABLE with `ON DELETE SET NULL`.
--      `deleteOrganization()` deletes the organization row, orphaning every
--      project to NULL — which under a role-only policy means visible to
--      every authenticated user, permanently.
--
--   5. It stored `database_config` (a dedicated instance's URL and anon key)
--      in a JSONB column on `organizations`, readable by every member of
--      that organization.
--
-- WHAT THIS FILE DOES
-- -------------------
--   1. `sec` helpers that resolve the caller's tenant from server state:
--      `member_org_ids()`, `current_org()`, `get_org_role()`, `can_org()`,
--      and `is_platform_admin()`. None reads browser-supplied state.
--   2. Splits the platform role (who runs the platform) from the tenant
--      role (who administers a company). See `user_accounts.is_platform_admin`.
--   3. `projects.organization_id` backfilled, NOT NULL, ON DELETE RESTRICT.
--   4. `organization_members.status` so invitation and suspension are states
--      rather than assumptions.
--   5. `database_config` moved to `organization_databases`, restricted to
--      platform administrators.
--
-- Idempotency claim: Safe to re-run. Every object uses IF NOT EXISTS or
-- CREATE OR REPLACE, every policy is dropped before it is created, and the
-- backfills are written to be no-ops on a second pass.
--
-- SCOPE AND HONEST LIMIT
-- ----------------------
-- This migration creates the tenant *boundary*, not the tenant *policies*.
-- `organization_id` is added here to `projects` only. The remaining
-- operational tables — panoramas, subgrids, qa_defects, datasets,
-- production_runs, map_shares and the rest — receive their column and their
-- org-scoped policies in 0037 and 0038+. Until that lands, a tenant member
-- can still read another tenant's operational rows, because those policies
-- are role-only.
--
-- The cross-tenant test in 0011_security_tests.sql is the gate for that, and
-- no real client may be onboarded before it passes.
--
-- Also unresolved here, and deliberately so: this migration grants no
-- entitlement, enforces no seat or quota limit, and provides no tenant
-- export or offboarding deletion. Those are recorded in implementation_plan_v32.md
-- section 11.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Schema grants, and the missing one this migration repairs.
--
--    USAGE on schema `sec` was never granted. 0009 created the schema and
--    granted EXECUTE on individual functions, but a schema with a NULL ACL
--    grants nothing to anyone but its owner, so `authenticated` could not
--    reference the schema at all.
--
--    That stayed invisible for two reasons, and both had to be measured:
--      * An RLS policy expression is resolved with different privileges than a
--        direct call, so `USING (sec.can('viewAll'))` continued to work.
--      * `scripts/bootstrap-migrations.test.ts` and the test suite exercise the
--        application, never the database.
--    The moment a `sec.*` function is called from anywhere that is NOT a policy
--    body it fails outright. The cross-tenant gate in
--    0011_security_tests.sql is exactly that, and it failed with
--    `permission denied for schema sec` until this grant was added.
--
--    anon is included because 0009 already granted it EXECUTE on sec.can; this
--    makes the two grants coherent rather than widening the surface. Every
--    function that can widen anything further (is_platform_admin,
--    current_org, get_org_role, member_org_ids) is EXECUTE-granted to
--    `authenticated` only.
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA sec TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- 0a. Defensive: the `sec` schema is created by 0009, but this file must
--     also stand alone when applied to a partially migrated database.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS sec;

-- ---------------------------------------------------------------------
-- 1. Platform administrator flag and active-tenant pointer.
--
--    `is_platform_admin` exists because "who runs the platform" is a
--    different question from "who is an administrator of company X", and
--    conflating them is exactly what made the original 0036 unsafe: the
--    platform role was resolved globally by email, so a company's
--    administrator was an administrator of every company.
--
--    `active_organization_id` is server state, deliberately. The browser
--    keeps a local hint (tenantContext.ACTIVE_ORGANIZATION_KEY) but the
--    database never reads it — see the recursion class of defect recorded in
--    docs/Deployment-Topology.md:139-142 for `project_id`.
--
--    Backfilled from the existing Administrator rows so the current
--    single-operator install keeps working unchanged.
-- ---------------------------------------------------------------------
ALTER TABLE public.user_accounts
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.user_accounts
    ADD COLUMN IF NOT EXISTS active_organization_id UUID;

CREATE INDEX IF NOT EXISTS idx_user_accounts_platform_admin
    ON public.user_accounts (is_platform_admin) WHERE is_platform_admin;

UPDATE public.user_accounts
   SET is_platform_admin = TRUE
 WHERE lower(coalesce(role, '')) = 'administrator'
   AND is_platform_admin = FALSE;

COMMENT ON COLUMN public.user_accounts.is_platform_admin IS
  'TRUE for Seller/GeoSphere staff who administer the whole platform. This is the ONLY grant that bypasses tenant isolation. It is not granted by role name: a tenant CompanyAdmin must never receive it.';
COMMENT ON COLUMN public.user_accounts.active_organization_id IS
  'Server-side active tenant for callers who belong to more than one organization. Validated against organization_members by sec.current_org(); NULL means no active tenant, not "the first one".';

-- ---------------------------------------------------------------------
-- 2. public.organizations
--
--    `database_config` is NOT a column here — see section 7.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    client_code     TEXT NOT NULL DEFAULT '',
    logo_url        TEXT DEFAULT '',
    database_type   TEXT NOT NULL DEFAULT 'cloud_shared'
                    CHECK (database_type IN ('cloud_shared', 'dedicated_external')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'trial', 'expired')),
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug   ON public.organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations (status);

COMMENT ON TABLE public.organizations IS
  'One row per client company. The tenant boundary is this table''s id, carried on operational tables as organization_id (added progressively in 0037+).';
COMMENT ON COLUMN public.organizations.database_type IS
  'cloud_shared = rows live in this database, isolated by organization_id policies. dedicated_external = the tenant''s data lives in its own Supabase project; this database holds only the registry. Dedicated placement is NOT an isolation mechanism — it is a data-residency choice.';
COMMENT ON COLUMN public.organizations.settings IS
  'Non-authoritative configuration (seat allowances, contact email, NAS endpoint). These are NOT entitlements: nothing enforces them yet. See implementation_plan_v32.md section 11.';

-- ---------------------------------------------------------------------
-- 3. public.organization_members
--
--    `status` is what makes invitation and suspension representable. The
--    previous shape could only say "member" or "no row", so "invited but
--    never accepted" and "suspended pending removal" were indistinguishable
--    from absent — and an absent row silently widened access elsewhere.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_members (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role              TEXT NOT NULL DEFAULT 'Operator'
                      CHECK (role IN ('CompanyAdmin', 'Operator', 'Inspector', 'Viewer')),
    status            TEXT NOT NULL DEFAULT 'invited'
                      CHECK (status IN ('invited', 'active', 'suspended')),
    invited_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_at        TIMESTAMPTZ DEFAULT NOW(),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user   ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org    ON public.organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_active ON public.organization_members (user_id, organization_id)
    WHERE status = 'active';

COMMENT ON TABLE public.organization_members IS
  'Maps an auth user to a company with a per-tenant role. UNIQUE (organization_id, user_id) means a user has at most one role per company; being an administrator of two companies is two rows, not one role that applies everywhere.';
COMMENT ON COLUMN public.organization_members.status IS
  'invited = offered but not accepted (grants nothing). active = a member. suspended = revoked; excluded by sec.current_org() so the row becomes unreadable as well as unusable. Absent is NOT the same as suspended — see 0017_project_delete_cascade for why conflating them matters.';
COMMENT ON COLUMN public.organization_members.role IS
  'Tenant-scoped. Normalised into the canonical capability vocabulary by sec.normalize_org_role(); never read directly by a policy.';

-- ---------------------------------------------------------------------
-- 4. Scope projects to an organization, then make it non-nullable.
--
--    The bootstrap organization is a fixed UUID so the backfill is
--    idempotent across re-runs and across databases restored from different
--    points. Rows created before tenant awareness existed belong to
--    whoever operated this install, which is what that fixed row represents.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL
     AND to_regclass('public.organizations') IS NOT NULL THEN

    INSERT INTO public.organizations (id, name, slug, client_code, database_type, status)
    VALUES ('00000000-0000-4000-8000-000000000001',
            'GeoSphere (bootstrap)', 'geosphere-bootstrap', 'BOOTSTRAP', 'cloud_shared', 'active')
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'projects'
         AND column_name = 'organization_id'
    ) THEN
      ALTER TABLE public.projects
        ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
    END IF;

    -- Backfill BEFORE the NOT NULL constraint, and BEFORE changing the FK
    -- action, so there is never a window where a project has no owner.
    UPDATE public.projects
       SET organization_id = '00000000-0000-4000-8000-000000000001'
     WHERE organization_id IS NULL;

    ALTER TABLE public.projects
      ALTER COLUMN organization_id SET NOT NULL;
  END IF;
END $$;

-- Re-point the FK at RESTRICT. SET NULL is what let a deleted company
-- dissolve its own isolation: the projects survived with a NULL owner and
-- became visible to everyone under the role-only policies.
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'public.projects'::regclass
                  AND conname = 'projects_organization_id_fkey') THEN
      ALTER TABLE public.projects DROP CONSTRAINT projects_organization_id_fkey;
    END IF;

    ALTER TABLE public.projects
      ADD CONSTRAINT projects_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON public.projects (organization_id);

COMMENT ON COLUMN public.projects.organization_id IS
  'Owning company. NOT NULL and ON DELETE RESTRICT: a company that still owns projects cannot be deleted, so offboarding must be an explicit procedure rather than a UI action that orphans the rows.';

-- ---------------------------------------------------------------------
-- 5. sec helpers.
--
--    Every function here is SECURITY DEFINER owned by the migration role,
--    which is what lets it read organization_members while organization_members
--    has RLS enabled. This is the same mechanism 0009 relies on for
--    sec.get_app_role(); it is also the fix for 42P17 — the recursion exists
--    because a plain subquery inside a policy re-enters the policy.
--
--    Do NOT `force row level security` on organization_members. That would
--    make the table owner subject to the policies and re-break every helper
--    below.
--
--    Language choice is load-bearing, not stylistic. Every helper that calls
--    `auth.uid()` or `auth.jwt()` is declared plpgsql, matching 0009. A
--    `language sql` body is parsed and resolved at CREATE time, so such a
--    function fails to be created on any database where `auth.jwt()` is not
--    yet present — a restored backup, a self-hosted stack mid-init, or the
--    scratch supabase/postgres image, which ships auth.uid/email/role but not
--    auth.jwt. A plpgsql body is only planned when it executes, so it defers
--    that dependency to call time. The first draft of this file declared
--    sec.is_platform_admin() as `language sql` and aborted the whole bundle
--    with `function auth.jwt() does not exist`.
-- ---------------------------------------------------------------------

-- The caller's organization ids. Reads the table RLS is enabled on, which is
-- only legal from a SECURITY DEFINER body.
CREATE OR REPLACE FUNCTION sec.member_org_ids()
RETURNS SETOF UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec
AS $$
BEGIN
  RETURN QUERY
    SELECT m.organization_id
      FROM public.organization_members m
     WHERE m.user_id = auth.uid()
       AND m.status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION sec.member_org_ids() FROM public;
GRANT EXECUTE ON FUNCTION sec.member_org_ids() TO authenticated;

-- Platform staff only. This is the single grant that bypasses tenant
-- isolation, and it is deliberately not derived from the role name.
CREATE OR REPLACE FUNCTION sec.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec
AS $$
DECLARE
  v_email TEXT := nullif(auth.jwt() ->> 'email', '');
  v_flag  BOOLEAN;
BEGIN
  SELECT u.is_platform_admin INTO v_flag
    FROM public.user_accounts u
   WHERE v_email IS NOT NULL
     AND lower(u.email) = lower(v_email)
   LIMIT 1;

  RETURN COALESCE(v_flag, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION sec.is_platform_admin() FROM public;
GRANT EXECUTE ON FUNCTION sec.is_platform_admin() TO authenticated;

-- The caller's active tenant.
--
-- Resolution order, and the reasoning:
--   * no memberships            -> NULL. Caller sees nothing.
--   * exactly one membership    -> that one. Nothing to disambiguate.
--   * several memberships       -> honour user_accounts.active_organization_id,
--                                  but ONLY after re-checking it against
--                                  organization_members inside this body. The
--                                  check cannot be skipped by supplying a
--                                  forged value, because the read is here and
--                                  nowhere the browser can reach.
--   * several, no valid choice   -> NULL. Refusing to guess is the point:
--                                  silently picking the first row would show a
--                                  contractor another company's data, which is
--                                  the exact class of defect this migration exists
--                                  to remove.
CREATE OR REPLACE FUNCTION sec.current_org()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec
AS $$
DECLARE
  v_uid    UUID  := auth.uid();
  v_email  TEXT  := nullif(auth.jwt() ->> 'email', '');
  v_count  INTEGER;
  v_single UUID;
  v_choice UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_count
    FROM public.organization_members m
   WHERE m.user_id = v_uid
     AND m.status = 'active';

  IF v_count = 0 THEN
    RETURN NULL;
  END IF;

  IF v_count = 1 THEN
    SELECT m.organization_id INTO v_single
      FROM public.organization_members m
     WHERE m.user_id = v_uid
       AND m.status = 'active'
     LIMIT 1;
    RETURN v_single;
  END IF;

  SELECT u.active_organization_id INTO v_choice
    FROM public.user_accounts u
   WHERE v_email IS NOT NULL
     AND lower(u.email) = lower(v_email)
     LIMIT 1;

  IF v_choice IS NOT NULL
     AND EXISTS (SELECT 1
                   FROM public.organization_members m
                  WHERE m.user_id = v_uid
                    AND m.organization_id = v_choice
                    AND m.status = 'active') THEN
    RETURN v_choice;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION sec.current_org() FROM public;
GRANT EXECUTE ON FUNCTION sec.current_org() TO authenticated;

-- Tenant role vocabulary -> canonical capability vocabulary. One mapping, so
-- a policy never has to know the tenant spelling.
CREATE OR REPLACE FUNCTION sec.normalize_org_role(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(btrim(raw), ''))
    WHEN 'companyadmin'      THEN 'Administrator'
    WHEN 'company admin'     THEN 'Administrator'
    WHEN 'operator'          THEN 'Survey Operator'
    WHEN 'inspector'         THEN 'QA Inspector'
    WHEN 'viewer'            THEN 'Viewer'
    ELSE 'Viewer'
  END;
$$;

-- The caller's email, or NULL.
--
-- Exists because a policy expression is parsed when the policy is created, so
-- writing `auth.jwt() ->> 'email'` directly in a USING clause aborts the
-- migration on any database where auth.jwt() is not yet present. Routing every
-- auth-facing reference through a plpgsql helper defers resolution to call
-- time, which is the same reason section 5 keeps these functions plpgsql.
CREATE OR REPLACE FUNCTION sec.caller_email()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN nullif(auth.jwt() ->> 'email', '');
END;
$$;

REVOKE ALL ON FUNCTION sec.caller_email() FROM public;
GRANT EXECUTE ON FUNCTION sec.caller_email() TO authenticated;

-- The single capability matrix. `sec.can()` is redefined below to delegate
-- here so the platform and tenant paths cannot drift apart.
CREATE OR REPLACE FUNCTION sec.role_has_capability(app_role TEXT, required TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT CASE app_role
    -- Administrator: everything.
    WHEN 'Administrator' THEN TRUE
    -- Survey Operator: data deletion, run QA/QC, read everything.
    WHEN 'Survey Operator' THEN required IN ('deleteData', 'runQaqc', 'viewAll')
    -- QA Inspector: run + review QA/QC, read everything.
    WHEN 'QA Inspector' THEN required IN ('runQaqc', 'reviewQaqc', 'viewAll')
    -- Viewer / guest: read-only.
    ELSE required = 'viewAll'
  END;
$$;

-- The caller's role in their active tenant. Defaults to Viewer — including
-- when there is no active tenant at all, so "unassigned" is the narrowest
-- grant rather than a permissive one.
CREATE OR REPLACE FUNCTION sec.get_org_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec
AS $$
DECLARE
  v_org  UUID  := sec.current_org();
  v_role TEXT;
BEGIN
  IF v_org IS NULL THEN
    RETURN 'Viewer';
  END IF;

  SELECT sec.normalize_org_role(m.role) INTO v_role
    FROM public.organization_members m
   WHERE m.user_id = auth.uid()
     AND m.organization_id = v_org
     AND m.status = 'active'
   LIMIT 1;

  RETURN COALESCE(v_role, 'Viewer');
END;
$$;

REVOKE ALL ON FUNCTION sec.get_org_role() FROM public;
GRANT EXECUTE ON FUNCTION sec.get_org_role() TO authenticated;

-- Tenant-scoped capability check. Same matrix as sec.can(), different role
-- source: the membership row rather than the install-wide directory.
CREATE OR REPLACE FUNCTION sec.can_org(required TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT sec.role_has_capability(sec.get_org_role(), required);
$$;

REVOKE ALL ON FUNCTION sec.can_org(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION sec.can_org(TEXT) TO authenticated;

-- Redefine sec.can() to delegate to the shared matrix. Behaviour is
-- identical to the 0009 implementation; this removes the duplicated CASE
-- that would otherwise let the platform and tenant matrices diverge.
-- Kept plpgsql to match 0009's declaration and for the CREATE-time reason
-- given in section 5.
CREATE OR REPLACE FUNCTION sec.can(required TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec
AS $$
BEGIN
  RETURN sec.role_has_capability(sec.get_app_role(), required);
END;
$$;

REVOKE ALL ON FUNCTION sec.can(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION sec.can(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sec.can(TEXT) TO anon;

-- ---------------------------------------------------------------------
-- 6. RLS on the registry tables.
--
--    Every policy below routes its membership test through
--    sec.member_org_ids(). That indirection is the entire fix: a bare
--    subquery against organization_members re-enters its own policy and
--    raises 42P17.
--
--    The predicate shape is uniform:
--        sec.is_platform_admin() OR organization_id IN (sec.member_org_ids())
--    Platform staff administer the platform; everyone else sees one company.
-- ---------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organizations_select"            ON public.organizations;
DROP POLICY IF EXISTS "organizations_admin_insert"      ON public.organizations;
DROP POLICY IF EXISTS "organizations_admin_update"      ON public.organizations;
DROP POLICY IF EXISTS "organizations_admin_delete"      ON public.organizations;

DROP POLICY IF EXISTS "org_members_select"              ON public.organization_members;
DROP POLICY IF EXISTS "org_members_admin_insert"        ON public.organization_members;
DROP POLICY IF EXISTS "org_members_admin_update"        ON public.organization_members;
DROP POLICY IF EXISTS "org_members_admin_delete"        ON public.organization_members;

CREATE POLICY "organizations_select"
    ON public.organizations FOR SELECT
    TO authenticated
    USING (
        sec.is_platform_admin()
        OR id IN (SELECT sec.member_org_ids())
    );

CREATE POLICY "organizations_admin_insert"
    ON public.organizations FOR INSERT
    TO authenticated
    WITH CHECK (sec.is_platform_admin());

CREATE POLICY "organizations_admin_update"
    ON public.organizations FOR UPDATE
    TO authenticated
    USING (sec.is_platform_admin())
    WITH CHECK (sec.is_platform_admin());

CREATE POLICY "organizations_admin_delete"
    ON public.organizations FOR DELETE
    TO authenticated
    USING (sec.is_platform_admin());

CREATE POLICY "org_members_select"
    ON public.organization_members FOR SELECT
    TO authenticated
    USING (
        sec.is_platform_admin()
        OR organization_id IN (SELECT sec.member_org_ids())
    );

-- No UPDATE policy scoped by organization: changing someone's role is a
-- platform act. A tenant administrator who could self-promote to CompanyAdmin
-- would inherit that company's manageUsers, so role changes stay here.
CREATE POLICY "org_members_admin_insert"
    ON public.organization_members FOR INSERT
    TO authenticated
    WITH CHECK (sec.is_platform_admin());

CREATE POLICY "org_members_admin_update"
    ON public.organization_members FOR UPDATE
    TO authenticated
    USING (sec.is_platform_admin())
    WITH CHECK (sec.is_platform_admin());

CREATE POLICY "org_members_admin_delete"
    ON public.organization_members FOR DELETE
    TO authenticated
    USING (sec.is_platform_admin());

-- ---------------------------------------------------------------------
-- 7. organization_databases
--
--    The dedicated-instance credentials move out of `organizations`.
--    `organizations_select` lets every member of a company read its own
--    organization row, and a JSONB column cannot be column-granted, so the
--    URL and anon key were reachable by any member. They belong where only
--    platform staff can read them.
--
--    Severity, stated honestly: an anon key is public by design — it ships in
--    the browser bundle. What this actually protects is not the key but the
--    blast radius of a mis-scoped dedicated project: handing one company's
--    members the coordinates of a project that may host another's rows. The
--    isolation there is the external project's own RLS, which this database
--    cannot enforce.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_databases (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    anon_key        TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.organization_databases IS
  'Dedicated external Supabase coordinates for organizations whose database_type is ''dedicated_external''. Readable only by platform administrators. The isolation guarantee for that database is its own RLS, which GeoSphere cannot enforce and should not be relied upon.';

ALTER TABLE public.organization_databases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_databases_select" ON public.organization_databases;
DROP POLICY IF EXISTS "org_databases_admin_write" ON public.organization_databases;

CREATE POLICY "org_databases_select"
    ON public.organization_databases FOR SELECT
    TO authenticated
    USING (sec.is_platform_admin());

CREATE POLICY "org_databases_admin_write"
    ON public.organization_databases FOR ALL
    TO authenticated
    USING (sec.is_platform_admin())
    WITH CHECK (sec.is_platform_admin());

-- Drop the credential column now that the table exists. Guarded so a re-run
-- on an already-migrated database is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'organizations'
                AND column_name = 'database_config') THEN
    -- Carry anything already stored across before dropping it.
    INSERT INTO public.organization_databases (organization_id, url, anon_key)
    SELECT o.id, COALESCE(o.database_config ->> 'url', ''),
           COALESCE(o.database_config ->> 'anonKey', '')
      FROM public.organizations o
     WHERE COALESCE(o.database_config ->> 'url', '') <> ''
    ON CONFLICT (organization_id) DO NOTHING;

    ALTER TABLE public.organizations DROP COLUMN database_config;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 8. Grants. anon is revoked from everything: the registry has no
--    anonymous reader, and file_inventory's `USING (true)` in 0006 is the
--    reason a credential-free caller can currently enumerate an install.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations          TO service_role;
REVOKE ALL ON public.organizations FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members    TO service_role;
REVOKE ALL ON public.organization_members FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_databases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_databases TO service_role;
REVOKE ALL ON public.organization_databases FROM anon;

COMMIT;

-- PostgREST caches the schema; without this, the new tables and policies
-- 404 with PGRST204 until the next cache refresh.
NOTIFY pgrst, 'reload schema';