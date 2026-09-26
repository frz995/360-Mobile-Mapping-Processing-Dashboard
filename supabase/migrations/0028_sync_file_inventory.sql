-- =====================================================================
-- GeoSphere 360 — Keep `file_inventory` in sync with storage (Migration 0028)
--
-- Why this is needed: the dashboard derives frame counts by verifying the
-- filenames recorded on a run against real uploaded files. It resolves those
-- files in this order:
--
--   1. `file_inventory`  (preferred — a plain table read)
--   2. `supabase.storage.list()` bucket enumeration (fallback)
--
-- The fallback silently returns an EMPTY list when the bucket is private and
-- `storage.objects` has no RLS policy granting the caller SELECT — the HTTP
-- call succeeds with `[]`, which is indistinguishable from an empty bucket.
-- `MMS_PIC` is private and had no storage policies, so verification "succeeded"
-- with zero files and every frame count rendered as a confident, verified 0
-- even though the images were present in the bucket.
--
-- This migration makes `file_inventory` authoritative and self-maintaining via
-- a trigger, so counts no longer depend on the client being able to enumerate a
-- private bucket. It also backfills any existing bucket contents.
--
-- Safe to re-run.
-- =====================================================================

BEGIN;

-- De-duplicate before enforcing uniqueness (an earlier backfill or repeated run
-- could have produced repeats for the same object).
DELETE FROM public.file_inventory a
      USING public.file_inventory b
     WHERE a.ctid > b.ctid
       AND a.bucket = b.bucket
       AND a.filename = b.filename;

CREATE UNIQUE INDEX IF NOT EXISTS file_inventory_bucket_filename_key
    ON public.file_inventory (bucket, filename);

-- Derive a subgrid the same way the client does: the leading token of the file
-- name, e.g. "N93E70-0001.jpg" -> "N93E70".
CREATE OR REPLACE FUNCTION public.file_inventory_subgrid_for(p_name TEXT)
RETURNS TEXT AS $$
    SELECT NULLIF(UPPER(SPLIT_PART(SPLIT_PART(SPLIT_PART(COALESCE(p_name, ''), '/', 1), '-', 1), '_', 1)), '');
$$ LANGUAGE sql IMMUTABLE;

-- Backfill every bucket the dashboard knows how to probe.
INSERT INTO public.file_inventory (filename, bucket, path, subgrid, size_bytes, content_type, created_at)
SELECT o.name,
       o.bucket_id,
       '',
       public.file_inventory_subgrid_for(o.name),
       NULLIF(o.metadata ->> 'size', '')::BIGINT,
       o.metadata ->> 'mimetype',
       COALESCE(o.created_at, NOW())
  FROM storage.objects o
 WHERE o.name IS NOT NULL AND o.name <> ''
ON CONFLICT (bucket, filename) DO NOTHING;

-- ---------------------------------------------------------------------
-- Maintain the inventory on upload / delete / rename.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_file_inventory_from_storage()
RETURNS TRIGGER AS $$
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

    INSERT INTO public.file_inventory (filename, bucket, path, subgrid, size_bytes, content_type, created_at, updated_at)
    VALUES (NEW.name,
            NEW.bucket_id,
            '',
            public.file_inventory_subgrid_for(NEW.name),
            NULLIF(NEW.metadata ->> 'size', '')::BIGINT,
            NEW.metadata ->> 'mimetype',
            COALESCE(NEW.created_at, NOW()),
            NOW())
    ON CONFLICT (bucket, filename) DO UPDATE
        SET size_bytes   = EXCLUDED.size_bytes,
            content_type = EXCLUDED.content_type,
            subgrid      = EXCLUDED.subgrid,
            updated_at   = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_file_inventory_storage_insert ON storage.objects;
CREATE TRIGGER trg_file_inventory_storage_insert
    AFTER INSERT ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION public.sync_file_inventory_from_storage();

DROP TRIGGER IF EXISTS trg_file_inventory_storage_update ON storage.objects;
CREATE TRIGGER trg_file_inventory_storage_update
    AFTER UPDATE ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION public.sync_file_inventory_from_storage();

DROP TRIGGER IF EXISTS trg_file_inventory_storage_delete ON storage.objects;
CREATE TRIGGER trg_file_inventory_storage_delete
    AFTER DELETE ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION public.sync_file_inventory_from_storage();

COMMIT;

-- NOTE: this migration only maintains `file_inventory`. Reading the actual
-- image bytes from a private bucket still requires a storage.objects SELECT
-- policy (or a public bucket / signed URLs). That is a separate concern from
-- frame counting, which now reads `file_inventory` instead of listing buckets.
