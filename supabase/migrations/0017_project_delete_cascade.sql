-- =====================================================================
-- GeoSphere 360 — Project Delete Cascade (Migration 0017)
--
-- Hard-deletes a project AND every operational row stamped with its
-- project_id, then removes the `projects` row itself.
--
-- WHY AN RPC: the `projects` table deliberately has NO DELETE policy
-- (soft archive only, see 0015) and every scoped table carries a plain
-- FK (project_id REFERENCES projects(id)) with no ON DELETE CASCADE,
-- so a client-side `supabase.from('projects').delete()` would either be
-- denied by RLS or abort on the FK when child rows exist. This SECURITY
-- DEFINER RPC deletes children first (mirroring projects_adopt_legacy_rows),
-- then the project row, in one transaction.
--
-- SECURITY: revoke from public, execute only for authenticated roles
-- (same grants as the adoption RPC). Role-gating of *who may delete* is
-- deliberately left to the app layer (the UI only exposes the button for
-- non-guest staff); the RPC itself just performs the cascade safely.
--
-- Idempotent + guarded per table: safe to run repeatedly, and on a
-- partial schema missing tables are skipped (reported count 0).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.projects_delete_cascade(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted bigint;
    v_result  jsonb;
    v_exists  boolean;
BEGIN
    IF p_project_id IS NULL THEN
        RAISE EXCEPTION 'p_project_id is required';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id) INTO v_exists;
    IF NOT v_exists THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'project not found');
    END IF;

    v_result := '{}'::jsonb;

    -- Children first: every scoped table (guarded, mirrors 0016's table list).
    IF to_regclass('public.panoramas') IS NOT NULL THEN
        DELETE FROM public.panoramas WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('panoramas', v_deleted);

    IF to_regclass('public.staging_panoramas') IS NOT NULL THEN
        DELETE FROM public.staging_panoramas WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('staging_panoramas', v_deleted);

    IF to_regclass('public.qa_defects') IS NOT NULL THEN
        DELETE FROM public.qa_defects WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('qa_defects', v_deleted);

    IF to_regclass('public.qaqc_audit_runs') IS NOT NULL THEN
        DELETE FROM public.qaqc_audit_runs WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('qaqc_audit_runs', v_deleted);

    IF to_regclass('public.subgrids') IS NOT NULL THEN
        DELETE FROM public.subgrids WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('subgrids', v_deleted);

    IF to_regclass('public.datasets') IS NOT NULL THEN
        DELETE FROM public.datasets WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('datasets', v_deleted);

    IF to_regclass('public.processing_jobs') IS NOT NULL THEN
        DELETE FROM public.processing_jobs WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('processing_jobs', v_deleted);

    IF to_regclass('public.audit_logs') IS NOT NULL THEN
        DELETE FROM public.audit_logs WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('audit_logs', v_deleted);

    IF to_regclass('public.notifications') IS NOT NULL THEN
        DELETE FROM public.notifications WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('notifications', v_deleted);

    IF to_regclass('public.deletion_requests') IS NOT NULL THEN
        DELETE FROM public.deletion_requests WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('deletion_requests', v_deleted);

    IF to_regclass('public.survey_recycle_bin') IS NOT NULL THEN
        DELETE FROM public.survey_recycle_bin WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('survey_recycle_bin', v_deleted);

    IF to_regclass('public.file_inventory') IS NOT NULL THEN
        DELETE FROM public.file_inventory WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('file_inventory', v_deleted);

    IF to_regclass('public.batch_logs') IS NOT NULL THEN
        DELETE FROM public.batch_logs WHERE project_id = p_project_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
        v_deleted := 0;
    END IF;
    v_result := v_result || jsonb_build_object('batch_logs', v_deleted);

    -- Last: the project row itself.
    DELETE FROM public.projects WHERE id = p_project_id;

    RETURN jsonb_build_object('ok', true, 'deleted', v_result);
END;
$$;

-- Authenticated roles may run the cascade; everyone else is denied.
REVOKE ALL ON FUNCTION public.projects_delete_cascade(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.projects_delete_cascade(uuid) TO authenticated;

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION public.projects_delete_cascade(uuid);
-- =====================================================================