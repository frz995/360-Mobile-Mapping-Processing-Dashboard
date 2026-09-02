-- =====================================================================
-- GeoSphere 360 — Server-side `file_inventory` table
-- Replaces client-side storage bucket enumeration with a queryable,
-- server-side record of every uploaded 360 image file.
--
-- IMPORTANT: If you rely on this table, the client will prefer it over
-- direct `.storage.list()` calls (no client bucket enumeration). The
-- client falls back to bucket listing automatically if this table is
-- missing or empty, so this migration is safe to apply at any time.
-- =====================================================================

create table if not exists public.file_inventory (
  id bigint generated always as identity primary key,
  filename text not null,
  bucket text not null default 'MMS_PIC',
  path text not null default '',
  subgrid text,
  size_bytes bigint,
  content_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Speed up the exact query the client issues:
--   select filename, subgrid from file_inventory where bucket = $1 limit 10000
create index if not exists file_inventory_bucket_idx
  on public.file_inventory (bucket, filename);

create index if not exists file_inventory_subgrid_idx
  on public.file_inventory (subgrid);

-- Enable RLS and allow authenticated/anon reads of the inventory.
alter table public.file_inventory enable row level security;

drop policy if exists "file_inventory_select" on public.file_inventory;
create policy "file_inventory_select"
  on public.file_inventory
  for select
  using (true);

-- Optional: allow writes only for a service role / worker. Leave commented
-- unless you have a service-role key configured in-app.
-- drop policy if exists "file_inventory_insert" on public.file_inventory;
-- create policy "file_inventory_insert"
--   on public.file_inventory
--   for insert
--   with check (true);
