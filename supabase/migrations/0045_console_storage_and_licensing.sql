-- =====================================================================
-- GeoSphere 360 — Console Storage Metrics, Parent DB Stats & Licensing
-- (Migration 0045)
--
-- PURPOSE
--   1. Adds commercial licensing columns to `public.organizations`:
--      - `license_type`: 'cloud_saas', 'enterprise_dedicated', 'trial', 'perpetual'
--      - `license_expires_at`: TIMESTAMPTZ (NULL = perpetual / unconfigured)
--   2. Introduces `public.console_parent_database_stats()`:
--      Platform-admin RPC returning physical Postgres cluster disk usage
--      (`pg_database_size`), total bucket bytes across `file_inventory`,
--      allocated child quotas, and Supabase Free Plan baseline specs.
--   3. Introduces `public.console_company_storage_breakdown()`:
--      Platform-admin RPC returning exact storage consumption, file counts,
--      and per-bucket breakdown (MMS_PIC, panoramas, road-analysis-geometry)
--      per client company from `file_inventory`. Zero mock data.
--
-- SECURITY
--   Both RPCs are SECURITY DEFINER with `PERFORM sec.require_platform_admin()`.
--   Access is strictly denied to non-platform administrators.
--
-- Idempotency claim: Safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Alter public.organizations for licensing and expiry tracking
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'organizations'
       AND column_name = 'license_type'
  ) THEN
    ALTER TABLE public.organizations
      ADD COLUMN license_type TEXT NOT NULL DEFAULT 'cloud_saas'
      CHECK (license_type IN ('cloud_saas', 'enterprise_dedicated', 'trial', 'perpetual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'organizations'
       AND column_name = 'license_expires_at'
  ) THEN
    ALTER TABLE public.organizations
      ADD COLUMN license_expires_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_organizations_license_expires
    ON public.organizations (license_expires_at);

COMMENT ON COLUMN public.organizations.license_type IS
  'Commercial licensing model: cloud_saas (shared cloud subscription), enterprise_dedicated (self-hosted / isolated), trial (pilot evaluation), or perpetual (permanent license).';
COMMENT ON COLUMN public.organizations.license_expires_at IS
  'Timestamp when the client license expires. NULL represents a perpetual or unconfigured subscription.';

-- ---------------------------------------------------------------------
-- 2. public.console_parent_database_stats()
--
--    Provides platform administrators with real cluster metrics:
--    - Physical Postgres database disk usage via pg_database_size()
--    - Physical file storage consumed across file_inventory
--    - Aggregate child company quotas and seats
--    - Supabase Free Plan baseline specs (500 MB DB / 1 GB Storage)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_parent_database_stats()
RETURNS TABLE (
    database_size_bytes        BIGINT,
    database_size_pretty       TEXT,
    storage_bytes              BIGINT,
    storage_bytes_pretty       TEXT,
    storage_files              BIGINT,
    total_allocated_storage_gb NUMERIC,
    total_allocated_seats      BIGINT,
    total_companies            BIGINT,
    active_companies           BIGINT,
    postgres_version           TEXT,
    postgis_version            TEXT,
    plan_tier                  TEXT,
    plan_db_limit_bytes        BIGINT,
    plan_storage_limit_bytes   BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec, pg_catalog
AS $$
DECLARE
    v_db_size    BIGINT;
    v_files_size BIGINT;
    v_files_cnt  BIGINT;
    v_postgis    TEXT := 'Not Installed';
BEGIN
  PERFORM sec.require_platform_admin();

  -- Physical Postgres disk usage
  v_db_size := pg_database_size(current_database());

  -- Storage usage across file_inventory
  SELECT COALESCE(sum(size_bytes), 0), count(*)
    INTO v_files_size, v_files_cnt
    FROM public.file_inventory;

  -- PostGIS extension detection
  SELECT COALESCE(extversion, 'Not Installed')
    INTO v_postgis
    FROM pg_extension
   WHERE extname = 'postgis';

  RETURN QUERY
    SELECT v_db_size,
           pg_size_pretty(v_db_size),
           v_files_size,
           pg_size_pretty(v_files_size),
           v_files_cnt,
           COALESCE(
             sum(
               CASE
                 WHEN jsonb_typeof(o.settings -> 'storageQuotaGb') = 'number'
                   THEN (o.settings ->> 'storageQuotaGb')::numeric
                 ELSE 0
               END
             ), 0
           )::NUMERIC,
           COALESCE(
             sum(
               CASE
                 WHEN jsonb_typeof(o.settings -> 'allowedUserSeats') = 'number'
                   THEN (o.settings ->> 'allowedUserSeats')::bigint
                 ELSE 0
               END
             ), 0
           )::BIGINT,
           count(*)::BIGINT,
           count(*) FILTER (WHERE o.status = 'active')::BIGINT,
           version(),
           v_postgis,
           'free'::TEXT,
           524288000::BIGINT,   -- 500 MB (Supabase Free Plan DB Disk Limit)
           1073741824::BIGINT  -- 1 GB (Supabase Free Plan Storage Bucket Limit)
      FROM public.organizations o;
END;
$$;

REVOKE ALL ON FUNCTION public.console_parent_database_stats() FROM public;
REVOKE ALL ON FUNCTION public.console_parent_database_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.console_parent_database_stats() TO authenticated;

COMMENT ON FUNCTION public.console_parent_database_stats() IS
  'Platform-administrator only. Real physical PostgreSQL disk size and Supabase Free Plan capacity metrics for parent console view.';

-- ---------------------------------------------------------------------
-- 3. public.console_company_storage_breakdown()
--
--    Provides per-company breakdown of storage consumption, quota,
--    and bucket distribution (MMS_PIC, panoramas, road-analysis-geometry).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.console_company_storage_breakdown()
RETURNS TABLE (
    organization_id        UUID,
    organization_name      TEXT,
    client_code            TEXT,
    database_type          TEXT,
    license_type           TEXT,
    license_expires_at     TIMESTAMPTZ,
    status                 TEXT,
    allocated_storage_gb   NUMERIC,
    consumed_storage_bytes BIGINT,
    consumed_files_count   BIGINT,
    mms_pic_bytes          BIGINT,
    mms_pic_files          BIGINT,
    panoramas_bytes        BIGINT,
    panoramas_files        BIGINT,
    geometry_bytes         BIGINT,
    geometry_files         BIGINT,
    other_bytes            BIGINT,
    other_files            BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sec, pg_catalog
AS $$
BEGIN
  PERFORM sec.require_platform_admin();

  RETURN QUERY
    SELECT o.id,
           o.name,
           COALESCE(o.client_code, ''),
           o.database_type,
           o.license_type,
           o.license_expires_at,
           o.status,
           CASE
             WHEN jsonb_typeof(o.settings -> 'storageQuotaGb') = 'number'
               THEN (o.settings ->> 'storageQuotaGb')::numeric
             ELSE NULL
           END,
           COALESCE(sum(f.size_bytes), 0)::BIGINT,
           count(f.filename)::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket = 'MMS_PIC'), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket = 'MMS_PIC')::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket = 'panoramas'), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket = 'panoramas')::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket = 'road-analysis-geometry'), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket = 'road-analysis-geometry')::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket NOT IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry')), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket NOT IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry'))::BIGINT
      FROM public.organizations o
      LEFT JOIN public.file_inventory f ON f.organization_id = o.id
     GROUP BY o.id, o.name, o.client_code, o.database_type, o.license_type, o.license_expires_at, o.status, o.settings

    UNION ALL

    -- Any unassigned or legacy objects attributed to no organization
    SELECT '00000000-0000-0000-0000-000000000000'::UUID,
           'Unassigned / Legacy Storage'::TEXT,
           'SYSTEM'::TEXT,
           'cloud_shared'::TEXT,
           'perpetual'::TEXT,
           NULL::TIMESTAMPTZ,
           'active'::TEXT,
           NULL::NUMERIC,
           COALESCE(sum(f.size_bytes), 0)::BIGINT,
           count(f.filename)::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket = 'MMS_PIC'), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket = 'MMS_PIC')::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket = 'panoramas'), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket = 'panoramas')::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket = 'road-analysis-geometry'), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket = 'road-analysis-geometry')::BIGINT,
           COALESCE(sum(f.size_bytes) FILTER (WHERE f.bucket NOT IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry')), 0)::BIGINT,
           count(f.filename) FILTER (WHERE f.bucket NOT IN ('MMS_PIC', 'panoramas', 'road-analysis-geometry'))::BIGINT
      FROM public.file_inventory f
     WHERE f.organization_id IS NULL
    HAVING count(f.filename) > 0

     ORDER BY 2;
END;
$$;

REVOKE ALL ON FUNCTION public.console_company_storage_breakdown() FROM public;
REVOKE ALL ON FUNCTION public.console_company_storage_breakdown() FROM anon;
GRANT EXECUTE ON FUNCTION public.console_company_storage_breakdown() TO authenticated;

COMMENT ON FUNCTION public.console_company_storage_breakdown() IS
  'Platform-administrator only. Storage consumed and file count per company by bucket (MMS_PIC, panoramas, road-analysis-geometry) alongside allocated quota.';

COMMIT;
