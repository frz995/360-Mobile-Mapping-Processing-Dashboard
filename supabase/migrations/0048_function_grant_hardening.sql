-- =====================================================================
-- GeoSphere 360 — Function Grant Hardening (Migration 0048)
--
-- Security definer functions must explicitly revoke execute privileges from
-- PUBLIC, anon, and authenticated unless deliberately intended to be callable
-- by unauthenticated sessions (such as map_share_touch).
--
-- sync_file_inventory_from_storage() is an internal trigger function that
-- synchronizes storage.objects into public.file_inventory. It runs under
-- trigger context with SECURITY DEFINER to bypass tenant isolation on
-- metadata ingestion, but should never be invokable directly via PostgREST.
-- =====================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.sync_file_inventory_from_storage() FROM public;
REVOKE ALL ON FUNCTION public.sync_file_inventory_from_storage() FROM anon;
REVOKE ALL ON FUNCTION public.sync_file_inventory_from_storage() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_file_inventory_from_storage() TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
