-- =====================================================================
-- Migration 0014: Narrow SECURITY DEFINER RPC for Road Analysis state
--
-- Restores cloud-save of the Road Analysis workspace for EVERY authenticated
-- role (Survey Operator / QA Inspector / Viewer / Administrator) WITHOUT
-- reopening row-level writes to the shared `project_settings` row (which also
-- holds admin-only provider credentials). See migration 0010 (RLS hardening)
-- and 0009 (sec.can / get_app_role).
--
-- The RPC runs as the function owner (postgres => bypasses RLS) and performs a
-- read-modify-write that replaces ONLY the top-level `settings.roadAnalysisState`
-- key inside the `id = 'default'` row; every other key is preserved.
--
-- Guests (anon) are intentionally NOT granted EXECUTE -- they stay local-only.
--
-- Idempotent: safe to re-run any number of times in the Supabase SQL Editor.
-- Supported versions: Supabase (Postgres 15), schema 'public'.
-- =====================================================================

create or replace function sec.save_road_analysis_state(p_state jsonb, p_updated_by text)
returns jsonb
language plpgsql
security definer
set search_path = public, sec
as $$
declare
  v_existing jsonb;
  v_settings jsonb;
  v_updated_at timestamptz := now();
begin
  select coalesce(nullif(settings::text, '')::jsonb, '{}'::jsonb)
    into v_existing
    from public.project_settings
   where id = 'default';

  -- Top-level jsonb || : replaces `roadAnalysisState`, keeps every other key.
  v_settings := coalesce(v_existing, '{}'::jsonb)
                || jsonb_build_object('roadAnalysisState', p_state);

  insert into public.project_settings (id, settings, updated_at)
  values ('default', v_settings, v_updated_at)
  on conflict (id) do update
    set settings   = excluded.settings,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'updated_at', to_char(v_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

-- Supabase grants EXECUTE to PUBLIC by default; close that so guests (anon)
-- can never reach the definer-owned function, then open it only to signed-in users.
revoke all on function sec.save_road_analysis_state(jsonb, text) from public;
grant  execute on function sec.save_road_analysis_state(jsonb, text) to authenticated;