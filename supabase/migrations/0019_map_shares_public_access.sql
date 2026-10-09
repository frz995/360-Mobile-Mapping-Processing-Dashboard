-- =====================================================================
-- GeoSphere 360 — Map Shares: Public Read & Shared Access (Migration 0019)
--
-- Ensures map_shares table exists and provides public read-only access
-- for shared map links (/share/<token>), plus permissive insert policy
-- so operators can publish share links reliably.
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

-- Base Grants
grant usage on schema public to anon, authenticated, service_role;
grant all on table public.map_shares to authenticated, service_role;
grant select, insert on table public.map_shares to anon;

-- Public Read Policy (allows external viewers without login)
drop policy if exists "map_shares_auth_read" on public.map_shares;
drop policy if exists "map_shares_public_read" on public.map_shares;
create policy "map_shares_public_read" on public.map_shares
  for select
  using (
    revoked_at is null
    and (expires_at is null or expires_at > now())
  );

-- Insert Policy (allow authenticated users, and anon if public share creation is enabled)
drop policy if exists "map_shares_auth_insert" on public.map_shares;
drop policy if exists "map_shares_insert" on public.map_shares;
create policy "map_shares_insert" on public.map_shares
  for insert to anon, authenticated
  with check (true);

-- View Counter Function
create or replace function public.map_share_touch(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.map_shares
  set view_count = view_count + 1
  where token = p_token;
$$;
grant execute on function public.map_share_touch(text) to anon, authenticated, service_role;