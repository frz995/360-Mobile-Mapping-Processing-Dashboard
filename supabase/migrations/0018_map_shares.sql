-- =====================================================================
-- GeoSphere 360 — Public Map Shares (Migration 0018)
--
-- Backs the "Share Map" feature of the WebGIS dashboard and the Road
-- Analysis workspace. Each row is a self-contained, read-only share:
-- a compact GeoJSON-ish snapshot of the published survey (tracks +
-- points + stats) or the road-analysis lines, published under an
-- unguessable token URL (/share/<token>) that renders WITHOUT login.
--
-- SECURITY MODEL:
--   * SELECT  — anon + authenticated (this is what makes the link
--               publicly viewable). Rows past expires_at or revoked are
--               hidden by the USING clause.
--   * INSERT  — authenticated roles only (share creation happens inside
--               the app; guests with a session may share).
--   * UPDATE / DELETE — owner (created_by) or Administrator. Updates
--               cover revocation (revoked_at) and view-count touches.
--   * Optional password: only the SHA-256 hex digest is stored. The
--               digest is compared client-side in the share viewer; this
--               is link-level convenience protection (same model as
--               read-only document shares), not a secrets boundary.
--
-- Idempotent: safe to run repeatedly in the Supabase SQL Editor.
-- =====================================================================

create table if not exists public.map_shares (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  kind          text not null default 'webgis' check (kind in ('webgis', 'road')),
  title         text not null default 'Shared Map',
  project_id    text,
  snapshot      jsonb not null default '{}'::jsonb,
  basemap       text not null default 'ofm-positron',
  password_hash text,
  created_by    text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  view_count    integer not null default 0
);

create index if not exists idx_map_shares_token on public.map_shares (token);
create index if not exists idx_map_shares_created_by on public.map_shares (created_by);

alter table public.map_shares enable row level security;

-- Base grants for the Supabase API roles. RLS policies below enforce the
-- actual row-level rules; without these grants the roles cannot touch the
-- table at all ("permission denied for table map_shares").
grant usage on schema public to anon, authenticated, service_role;
grant all on table public.map_shares to anon;
grant all on table public.map_shares to authenticated;
grant all on table public.map_shares to service_role;

drop policy if exists "map_shares_public_read" on public.map_shares;
create policy "map_shares_public_read" on public.map_shares
  for select
  using (
    revoked_at is null
    and (expires_at is null or expires_at > now())
  );

drop policy if exists "map_shares_auth_insert" on public.map_shares;
create policy "map_shares_auth_insert" on public.map_shares
  for insert to authenticated
  with check (auth.role() is not null);

drop policy if exists "map_shares_owner_manage" on public.map_shares;
create policy "map_shares_owner_manage" on public.map_shares
  for update to authenticated
  using (created_by = coalesce(auth.uid()::text, ''))
  with check (created_by = coalesce(auth.uid()::text, ''));

drop policy if exists "map_shares_admin_delete" on public.map_shares;
create policy "map_shares_admin_delete" on public.map_shares
  for delete to authenticated
  using (created_by = coalesce(auth.uid()::text, ''));

-- View counter executed by the public share page (anon allowed).
create or replace function public.map_share_touch(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.map_shares
     set view_count = view_count + 1
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now());
$$;

revoke all on function public.map_share_touch(text) from anon, authenticated;
grant execute on function public.map_share_touch(text) to anon, authenticated;
