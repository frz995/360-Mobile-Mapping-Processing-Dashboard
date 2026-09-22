-- =====================================================================
-- GeoSphere 360 — Map Shares: Ensure Public Read Access (Migration 0019)
--
-- Confirms public read-only access for shared map links (/share/<token>)
-- so external clients and reviewers can view published maps without a
-- GeoSphere 360 account (with optional password protection if enabled).
--
-- Idempotent: safe to run repeatedly in the Supabase SQL Editor.
-- =====================================================================

grant usage on schema public to anon, authenticated, service_role;
grant select on table public.map_shares to anon, authenticated, service_role;
grant execute on function public.map_share_touch(text) to anon, authenticated, service_role;

drop policy if exists "map_shares_auth_read" on public.map_shares;
drop policy if exists "map_shares_public_read" on public.map_shares;

create policy "map_shares_public_read" on public.map_shares
  for select
  using (
    revoked_at is null
    and (expires_at is null or expires_at > now())
  );