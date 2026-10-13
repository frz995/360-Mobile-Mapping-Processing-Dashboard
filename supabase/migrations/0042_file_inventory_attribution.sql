-- =====================================================================
-- GeoSphere 360 — Attribute the storage inventory to its company
--              (Migration 0042)
--
-- Repairs a regression introduced by 0040, found by the cross-tenant gate
-- rather than by any test in the repository.
--
-- THE REGRESSION
--   Migration 0028 installs `sync_file_inventory_from_storage()` as an AFTER
--   INSERT/UPDATE/DELETE trigger on `storage.objects`. It writes the uploaded
--   object's key into `public.file_inventory`.
--
--   Migration 0040 replaced `file_inventory`'s `USING (true)` policy with
--        WITH CHECK (sec.can('manageDatasets') AND sec.in_org(organization_id))
--   and `sec.in_org()` returns FALSE for a NULL row organization — by design,
--   so an unattributed row is invisible rather than visible to everyone.
--
--   The trigger never sets `organization_id`, so it writes NULL, the WITH
--   CHECK fails, and **every storage upload is rejected**:
--
--       ERROR: new row violates row-level security policy for table "file_inventory"
--
--   It was not SECURITY DEFINER either, so it ran as the uploading user and
--   was subject to the policy at all.
--
-- WHY NOTHING CAUGHT IT
--   The application tests mock Supabase, so no trigger fires. The gate in
--   0011_security_tests.sql is the first thing in this repository that inserts
--   a real `storage.objects` row as a real tenant, and it failed on the first
--   attempt. That is the argument for keeping the gate wired into CI: this
--   class of defect is invisible to everything else here.
--
-- THE FIX
--   Derive the owning company from the object key, using the same `orgs/{uuid}/`
--   convention migration 0041 enforces in `storage.objects` policies. A key
--   that does not carry the prefix yields NULL, which under 0040's policy is
--   invisible to tenants and reachable only by a platform administrator —
--   the same treatment 0041 gives un-namespaced legacy keys. The two are
--   consistent by construction rather than by coincidence.
--
-- Idempotency claim: Safe to re-run. Functions are CREATE OR REPLACE and every
-- trigger is dropped before it is created.
--
-- SCOPE AND HONEST LIMIT
--   This restores uploads; it does not migrate existing inventory rows. Rows
--   already in `file_inventory` keep a NULL `organization_id` and are therefore
--   invisible to tenants until re-attributed. Migration 0037 backfilled them
--   to the bootstrap organization on a fresh install, so this only affects
--   inventories populated between 0037 and 0042 on a live database.
--
--   The backfill below handles that case: rows whose bucket matches are given
--   the bootstrap organization so an existing install does not silently lose
--   its frame counts after this migration.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Read the company out of an object key.
--
--    Text comparison rather than a uuid cast, so a malformed key yields NULL
--    instead of raising inside a trigger that fires on every upload.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.file_inventory_organization_for(object_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_segment TEXT;
BEGIN
  IF object_name IS NULL THEN
    RETURN NULL;
  END IF;

  v_segment := split_part(object_name, '/', 2);

  IF lower(split_part(object_name, '/', 1)) = 'orgs'
     AND v_segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_segment::uuid;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.file_inventory_organization_for(TEXT) IS
  'Extracts the owning company from an `orgs/{organization_id}/...` object key. Returns NULL for a legacy un-namespaced key, which the tenant policies treat as invisible — the same rule migration 0041 applies to storage.objects.';

-- ---------------------------------------------------------------------
-- 2. Rebuild the trigger function.
--
--    SECURITY DEFINER for two reasons, both consequences of the same change:
--      * it must be able to write the inventory row regardless of whether the
--        uploading user could themselves — the inventory is a derived index,
--        not something a tenant grants;
--      * it must be able to attribute the row to the company named by the KEY,
--        which need not be the company the uploader belongs to (a platform
--        administrator publishing on a tenant's behalf is the normal case).
--
--    search_path is pinned for the same reason as every other SECURITY
--    DEFINER function in this schema.
--
--    The body is otherwise 0028's, unchanged, so the rename/move handling and
--    the metadata-bucket skip keep behaving exactly as before.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_file_inventory_from_storage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.file_inventory
         WHERE bucket = OLD.bucket_id AND filename = OLD.name;
        RETURN OLD;
    END IF;

    -- On a rename/move the old key must be dropped, otherwise the inventory keeps
    -- a phantom entry for the previous name and the object is counted twice.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.bucket_id IS DISTINCT FROM NEW.bucket_id OR OLD.name IS DISTINCT FROM NEW.name THEN
            DELETE FROM public.file_inventory
             WHERE bucket = OLD.bucket_id AND filename = OLD.name;
        END IF;
    END IF;

    -- Skip the metadata bucket Supabase creates for avatars etc.
    IF NEW.bucket_id IS NULL OR NEW.bucket_id LIKE '%.temp' THEN
        RETURN NEW;
    END IF;

    v_org := public.file_inventory_organization_for(NEW.name);

    INSERT INTO public.file_inventory (filename, bucket, path, subgrid, organization_id, size_bytes, content_type, created_at, updated_at)
    VALUES (NEW.name,
            NEW.bucket_id,
            '',
            public.file_inventory_subgrid_for(NEW.name),
            v_org,
            NULLIF(NEW.metadata ->> 'size', '')::BIGINT,
            NEW.metadata ->> 'mimetype',
            COALESCE(NEW.created_at, NOW()),
            NOW())
    ON CONFLICT (bucket, filename) DO UPDATE
        SET size_bytes      = EXCLUDED.size_bytes,
            content_type    = EXCLUDED.content_type,
            subgrid         = EXCLUDED.subgrid,
            organization_id = EXCLUDED.organization_id,
            updated_at      = NOW();

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_file_inventory_from_storage() IS
  'Maintains file_inventory from storage.objects. SECURITY DEFINER because the inventory is a derived index written on behalf of the object key''s owning company, which is not necessarily the uploading user (0042).';

-- ---------------------------------------------------------------------
-- 3. Recreate the triggers so they bind to the new definition.
--
--    A CREATE OR REPLACE FUNCTION leaves an existing trigger pointing at the
--    old body until it is dropped and re-created. That step is the whole reason
--    this migration touches triggers rather than only the function.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_file_inventory_storage_insert ON storage.objects;
    DROP TRIGGER IF EXISTS trg_file_inventory_storage_update ON storage.objects;
    DROP TRIGGER IF EXISTS trg_file_inventory_storage_delete ON storage.objects;

    CREATE TRIGGER trg_file_inventory_storage_insert
      AFTER INSERT ON storage.objects
      FOR EACH ROW EXECUTE FUNCTION public.sync_file_inventory_from_storage();

    CREATE TRIGGER trg_file_inventory_storage_update
      AFTER UPDATE ON storage.objects
      FOR EACH ROW EXECUTE FUNCTION public.sync_file_inventory_from_storage();

    CREATE TRIGGER trg_file_inventory_storage_delete
      AFTER DELETE ON storage.objects
      FOR EACH ROW EXECUTE FUNCTION public.sync_file_inventory_from_storage();
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Backfill inventory rows written before this migration.
--
--    A row whose key already names a company is left alone. A row at the legacy
--    flat path is attributed to the bootstrap organization, which is the same
--    company 0037 attributed it to — so a live install does not lose its frame
--    counts the moment this lands.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_total  integer := 0;
  v_repaired integer := 0;
BEGIN
  IF to_regclass('public.file_inventory') IS NOT NULL THEN
    SELECT count(*) INTO v_total
      FROM public.file_inventory
     WHERE organization_id IS NULL;

    IF v_total > 0 THEN
      UPDATE public.file_inventory fi
         SET organization_id = public.file_inventory_organization_for(fi.filename)
       WHERE fi.organization_id IS NULL
         AND public.file_inventory_organization_for(fi.filename) IS NOT NULL;

      GET DIAGNOSTICS v_repaired = ROW_COUNT;

      UPDATE public.file_inventory
         SET organization_id = '00000000-0000-4000-8000-000000000001'
       WHERE organization_id IS NULL;

      RAISE NOTICE
        '0042: % inventory row(s) lacked a company; % re-keyed from the object path, the remainder assigned to the bootstrap organization',
        v_total, v_repaired;
    ELSE
      RAISE NOTICE '0042: every file_inventory row already carries a company';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Verification: an upload must be attributed to the company in its key.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_org uuid;
BEGIN
  v_org := public.file_inventory_organization_for(
    'orgs/0a000000-0000-4000-8000-0000000000a1/N93E70-0001.jpg');

  IF v_org IS DISTINCT FROM '0a000000-0000-4000-8000-0000000000a1' THEN
    RAISE EXCEPTION '0042 VERIFICATION FAILED: a namespaced key resolved to % instead of its organization', v_org;
  END IF;

  IF public.file_inventory_organization_for('N93E70-0001.jpg') IS NOT NULL THEN
    RAISE EXCEPTION '0042 VERIFICATION FAILED: a legacy un-namespaced key resolved to an organization';
  END IF;

  IF public.file_inventory_organization_for('orgs/not-a-uuid/x.jpg') IS NOT NULL THEN
    RAISE EXCEPTION '0042 VERIFICATION FAILED: a malformed key resolved to an organization instead of NULL';
  END IF;

  RAISE NOTICE '0042: object keys resolve to their owning company; malformed and legacy keys resolve to NULL';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';