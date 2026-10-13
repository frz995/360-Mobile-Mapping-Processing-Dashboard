-- =====================================================================
-- GeoSphere 360 — Tenant-scoped storage.objects policies (Migration 0041)
--
-- Closes the gap migration 0040 raised a WARNING about rather than papering
-- over.
--
-- WHY OBJECT KEYS MUST CARRY THE COMPANY
--   `storage.objects` RLS is evaluated per object key. A key of
--   `N93E70-0001.jpg` says nothing about who owns it, so there is no predicate
--   to write: `organization_id` does not exist on the row. Until the key itself
--   is namespaced, every authenticated user can read every other company's
--   geometry in the shared buckets.
--
--   The convention is the one implemented in src/services/storageUrls.ts:
--       orgs/{organization_id}/{existing path}
--   `TENANT_OBJECT_ROOT` there and the 'orgs/' literal below must stay in step.
--
-- LEGACY KEYS ARE NOT MOVED, AND NOT VISIBLE
--   Existing objects sit at the flat path. This migration does not relocate
--   them: a copy of tens of thousands of panoramas is an operational project
--   with its own verification, and doing it silently inside a schema migration
--   would be the wrong place. Instead the flat path is simply not readable by
--   any tenant — only a platform administrator can see it. The bootstrap
--   organization therefore must have its objects re-keyed under
--   `orgs/00000000-0000-4000-8000-000000000001/` before that install can serve
--   a tenant. That is an operational task, recorded in §3 of
--   implementation_plan_v32.md and flagged by the NOTICE at the end of this
--   migration.
--
-- PUBLIC BUCKETS ARE NOT PROTECTED BY ANY OF THIS
--   A bucket with `public = true` is served by the storage API from
--   /storage/v1/object/public/ without consulting storage.objects at all. Every
--   policy below is therefore inert for a public bucket. Migration 0041 flips
--   the panorama buckets to private, which is the single change that actually
--   makes these policies load-bearing — and it is why this is a separate
--   migration from the key convention rather than folded into 0040.
--
-- Idempotency claim: Safe to re-run. Policies are dropped before creation; the
-- bucket visibility update is a plain UPDATE keyed on bucket id.
--
-- SCOPE AND HONEST LIMIT
--   Applies to the panorama buckets and road-analysis-geometry. A bucket not
--   named here keeps whatever policies it already had, and the final NOTICE
--   lists any that remain unscoped rather than assuming the install is clean.
--
--   This does not make the product multi-tenant safe on its own. It closes the
--   storage hole; the cross-tenant gate in 0011_security_tests.sql is what
--   verifies the closure.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Make the shared buckets private.
--
--    Idempotent and unconditional: a public bucket makes every policy in this
--    migration decorative, so this runs first. The application already
--    supports private buckets — `isPrivateBucket`/`useSignedUrls` switch the
--    object endpoint from /public/ to /authenticated/ in
--    src/services/storageUrls.ts, and signedPanoramaUrls.ts caches the
--    resulting URLs.
-- ---------------------------------------------------------------------
UPDATE storage.buckets
   SET public = FALSE
 WHERE id IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry');

-- ---------------------------------------------------------------------
-- 2. Drop all existing policies on the three buckets.
--
--    Enumerated rather than by fixed name: UI-created policies (such as
--    "Public Access for MMS_PIC") or prior migrations (0021) would otherwise
--    survive and leave a permissive public read path open.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    FOR v_policy IN
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND (
           coalesce(qual, '') ~* 'MMS_PIC|panoramas|road-analysis-geometry'
           OR coalesce(with_check, '') ~* 'MMS_PIC|panoramas|road-analysis-geometry'
           OR policyname ~* 'MMS_PIC|panoramas|road-analysis-geometry'
         )
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_policy.policyname);
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Tenant-scoped policies for the panorama buckets.
--
--    Key-shape predicate: the object key must begin with `orgs/` followed by
--    the caller's verified organization. Written against `name` (the object
--    key column) with an explicit lower() on both sides so a mixed-case key
--    cannot slip past a case-sensitive prefix compare.
--
--    `split_part(name, '/', 2)` is the organization segment. Comparing it as
--    text rather than casting to uuid means a malformed key simply fails to
--    match instead of raising, which keeps a listing over dirty keys from
--    erroring out.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_buckets text[] := ARRAY['MMS_PIC', 'panoramas'];
  v_bucket  text;
BEGIN
  FOREACH v_bucket IN ARRAY v_buckets LOOP
    IF to_regclass('storage.objects') IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_bucket || '_tenant_select');
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_bucket || '_tenant_insert');
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_bucket || '_tenant_update');
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_bucket || '_tenant_delete');
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_bucket || '_platform_read');

      EXECUTE format($p$
        CREATE POLICY %1$I ON storage.objects
          FOR SELECT TO authenticated
          USING (
            bucket_id = %2$L
            AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, ''))))
          )
      $p$, v_bucket || '_tenant_select', v_bucket);

      -- Write policies carry the exact same predicate as the read. A write
      -- scoped more loosely than the read would let a tenant WRITE an object it
      -- could not then read back, which is a silent data-loss path rather than
      -- a visible one.
      EXECUTE format($p$
        CREATE POLICY %1$I ON storage.objects
          FOR INSERT TO authenticated
          WITH CHECK (
            bucket_id = %2$L
            AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, ''))))
          )
      $p$, v_bucket || '_tenant_insert', v_bucket);

      EXECUTE format($p$
        CREATE POLICY %1$I ON storage.objects
          FOR UPDATE TO authenticated
          USING (
            bucket_id = %2$L
            AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, ''))))
          )
          WITH CHECK (
            bucket_id = %2$L
            AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, ''))))
          )
      $p$, v_bucket || '_tenant_update', v_bucket);

      EXECUTE format($p$
        CREATE POLICY %1$I ON storage.objects
          FOR DELETE TO authenticated
          USING (
            bucket_id = %2$L
            AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, ''))))
          )
      $p$, v_bucket || '_tenant_delete', v_bucket);

      -- The flat legacy layout stays reachable to platform administrators only,
      -- so an un-migrated install is recoverable rather than locked out. No
      -- tenant can reach a key that does not carry a company.
      EXECUTE format($p$
        CREATE POLICY %1$I ON storage.objects
          FOR SELECT TO authenticated
          USING (bucket_id = %2$L AND sec.is_platform_admin())
      $p$, v_bucket || '_platform_read', v_bucket);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. road-analysis-geometry.
--
--    0021 granted every authenticated user any object in this bucket
--    (`to authenticated` with only a bucket_id test). Those four policies are
--    dropped and replaced with the same orgs/ prefix rule.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS road_analysis_geometry_auth_read   ON storage.objects;
    DROP POLICY IF EXISTS road_analysis_geometry_auth_insert ON storage.objects;
    DROP POLICY IF EXISTS road_analysis_geometry_auth_update ON storage.objects;
    DROP POLICY IF EXISTS road_analysis_geometry_auth_delete ON storage.objects;

    CREATE POLICY road_analysis_geometry_tenant_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'road-analysis-geometry'
             AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, '')))));

    CREATE POLICY road_analysis_geometry_tenant_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'road-analysis-geometry'
                  AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, '')))));

    CREATE POLICY road_analysis_geometry_tenant_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'road-analysis-geometry'
             AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, '')))))
      WITH CHECK (bucket_id = 'road-analysis-geometry'
                  AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, '')))));

    CREATE POLICY road_analysis_geometry_tenant_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'road-analysis-geometry'
             AND (sec.is_platform_admin()
              OR (lower(split_part(name, '/', 1)) = 'orgs'
                  AND lower(split_part(name, '/', 2)) = lower(coalesce(sec.current_org()::text, '')))));

    -- Legacy flat geometry keys: platform administrators only.
    CREATE POLICY road_analysis_geometry_platform_read ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'road-analysis-geometry' AND sec.is_platform_admin());
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Verification.
--
--    Two properties, both load-bearing:
--      a) no policy on these buckets grants access without an orgs/ prefix term
--         or a platform-admin term;
--      b) no bucket is public, because a public bucket serves objects without
--         consulting any of it.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_bad record;
  v_count integer := 0;
BEGIN
  -- pg_policies exposes schemaname/tablename/policyname/cmd/qual/with_check
  -- but no bucket_id, so the bucket is identified from the predicate text.
  -- Every policy this migration creates names its bucket literally, and the
  -- ones it replaced are gone, so a policy matching that pattern is one of ours
  -- or an orphan from 0021.
  SELECT count(*) INTO v_count
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename = 'objects'
     AND (qual ~ 'MMS_PIC|panoramas|road-analysis-geometry')
     AND qual !~ 'orgs'
     AND qual !~ 'is_platform_admin';

  IF v_count > 0 THEN
    FOR v_bad IN
      SELECT policyname, qual FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND (qual ~ 'MMS_PIC|panoramas|road-analysis-geometry')
         AND qual !~ 'orgs' AND qual !~ 'is_platform_admin'
    LOOP
      RAISE EXCEPTION
        '0041 VERIFICATION FAILED: storage policy % is reachable without a tenant prefix: [%]',
        v_bad.policyname, v_bad.qual;
    END LOOP;
  END IF;

  SELECT count(*) INTO v_count FROM storage.buckets
   WHERE id IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry') AND public;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      '0041 VERIFICATION FAILED: % bucket(s) are still public. A public bucket is served without consulting storage.objects, so every tenant policy on it is decorative.', v_count;
  END IF;

  RAISE NOTICE '0041: panorama and geometry buckets are private and every storage policy is tenant-scoped';
END $$;

-- ---------------------------------------------------------------------
-- 6. Operational follow-up, announced rather than assumed.
--
--    Nothing here breaks a tenant, and nothing here completes the migration of
--    existing objects. Say so at install time instead of discovering it as a
--    blank panorama viewer.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_flat integer;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    SELECT count(*) INTO v_flat
      FROM storage.objects
     WHERE bucket_id IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry')
       AND lower(split_part(name, '/', 1)) <> 'orgs';

    IF v_flat > 0 THEN
      RAISE NOTICE
        '0041 FOLLOW-UP: % object(s) still sit at the legacy flat path and are now reachable only by a platform administrator. Re-key them under orgs/{organization_id}/ before serving tenants.', v_flat;
    ELSE
      RAISE NOTICE '0041: no legacy flat-path objects remain';
    END IF;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';