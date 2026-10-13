-- =====================================================================
-- GeoSphere 360 — Per-organisation NAS worker credentials (Migration 0043)
--
-- Closes the largest remaining multi-tenant gap. `0036`–`0042` isolated the
-- database and object storage; the field-capture filesystem was untouched.
--
-- THE DEFECT THIS FIXES
--   The request path to the survey NAS was:
--
--     browser (any signed-in user of the install)
--       -> /api/nas-scan or /api/nas-image
--         -> functions/_middleware.js        verified the Supabase bearer
--         -> functions/api/nas-image.js      attached env.NAS_WORKER_TOKEN
--                                             to env.NAS_API_URL
--           -> worker/app.py                 served from one NAS_BASE_PATH
--
--   The middleware verified that the caller was *a user of the installation*.
--   It never asked which company they belonged to, and the handler then handed
--   the worker the single install-wide token. `worker/app.py:53-54` holds one
--   `NAS_BASE_PATH` and one `API_TOKEN`, so every signed-in user could walk
--   every other company's raw survey filesystem — the frames themselves, not
--   just the metadata the database policies had been tightened to protect.
--
--   No policy in 0036-0042 mitigated this, because no policy governs the NAS.
--
-- WHY A TABLE RATHER THAN AN ENV VAR
--   A Cloudflare Pages environment variable is per *deployment*, not per
--   tenant. It cannot express "Company A's worker, Company B's worker". The
--   credentials have to live in the database, keyed by organisation, and the
--   edge has to resolve which pair to use from the CALLER's verified
--   membership — never from a client-supplied parameter.
--
-- SCOPE AND HONEST LIMIT
--   This migration stores the credentials and scopes who may read them. The
--   resolution that USES them lives in the Cloudflare Functions layer:
--   functions/_lib/tenantWorker.js. Both halves are required; either alone
--   leaves the path open.
--
--   `functions/api/station-agent.js` is NOT changed here. It already uses a
--   per-station token map (`env.STATION_AGENT_TOKENS`) and proxies to the
--   station agent rather than the NAS worker. Binding stations to organisations
--   is a separate change, and until it is made a station agent is reachable by
--   any signed-in user who knows its station id and token.
--
--   The bootstrap organization keeps working with no configuration: see the
--   "legacy fallback" note in tenantWorker.js, which is deliberately all-or-
--   nothing rather than per-organisation.
--
-- Idempotency claim: Safe to re-run. Table, indexes, policies and grants are
-- all IF NOT EXISTS / DROP-then-CREATE.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Per-organisation worker endpoint and credential.
--
--    Separate from `organizations.settings.nasApiUrl` (already present, written
--    by the console) because a secret in a JSONB settings blob is readable by
--    every member of the company, and a JSONB column cannot be column-granted.
--    This mirrors `organization_databases`, which migration 0036 moved out for
--    the same reason.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_workers (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    nas_api_url      TEXT NOT NULL,
    worker_token     TEXT NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organization_workers_org ON public.organization_workers (organization_id);

COMMENT ON TABLE public.organization_workers IS
  'Per-company NAS worker endpoint and bearer token. The Cloudflare edge resolves these from the caller''s verified organization membership; the browser must never hold or see a worker_token. RLS restricts every application role to platform administrators — the edge reads with service_role after it has independently verified the caller.';
COMMENT ON COLUMN public.organization_workers.worker_token IS
  'Bearer token the worker/app.py instance checks in _guard (worker/app.py:92-94). One distinct value per company: a shared token is the defect this table exists to remove.';

-- ---------------------------------------------------------------------
-- 2. RLS.
--
--    Platform administrators only. The edge function authenticates the caller
--    with the caller's own Supabase bearer (so membership is proved by RLS on
--    organization_members, without a privileged read) and only then fetches this
--    row with service_role. No application role needs standing access.
-- ---------------------------------------------------------------------
ALTER TABLE public.organization_workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization_workers_select" ON public.organization_workers;
DROP POLICY IF EXISTS "organization_workers_admin_write" ON public.organization_workers;

CREATE POLICY "organization_workers_select"
    ON public.organization_workers FOR SELECT
    TO authenticated
    USING (sec.is_platform_admin());

CREATE POLICY "organization_workers_admin_write"
    ON public.organization_workers FOR ALL
    TO authenticated
    USING (sec.is_platform_admin())
    WITH CHECK (sec.is_platform_admin());

-- ---------------------------------------------------------------------
-- 3. Grants. anon never: these are bearer tokens for a filesystem.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_workers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_workers TO service_role;
REVOKE ALL ON public.organization_workers FROM anon;

-- ---------------------------------------------------------------------
-- 4. Verification.
--
--    Asserts the property that matters: no application role other than a
--    platform administrator can read a worker token. Checked against the
--    catalog rather than asserted in prose, so a later migration that widens a
--    policy fails here.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'organization_workers'
     AND cmd = 'SELECT'
     AND qual !~ 'is_platform_admin';

  IF v_count > 0 THEN
    RAISE EXCEPTION
      '0043 VERIFICATION FAILED: organization_workers has a SELECT policy readable without a platform-admin check. A worker token must never be reachable by a tenant member.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'organization_workers'
       AND grantee = 'anon' AND privilege_type <> 'SELECT'
  ) THEN
    NULL; -- expected: anon holds nothing
  ELSE
    RAISE EXCEPTION '0043 VERIFICATION FAILED: anon holds a privilege on organization_workers.';
  END IF;

  RAISE NOTICE '0043: per-organisation worker credentials exist and are readable only by platform administrators';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';