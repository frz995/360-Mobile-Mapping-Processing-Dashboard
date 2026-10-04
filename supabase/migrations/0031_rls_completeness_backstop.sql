-- =====================================================================
-- Migration 0031: RLS completeness backstop
-- =====================================================================
-- WHY
--
-- Proving a from-empty install surfaced two gaps that no earlier migration
-- closes, plus an ordering defect that hides them:
--
-- 1. ORDERING. `0004_rls_application_tables.sql` opens with
--        ALTER TABLE public.panoramas ENABLE ROW LEVEL SECURITY;
--    but `panoramas` is created by `0012_core_tables_and_rls.sql`, eight
--    files later. On an empty database 0004 therefore aborts on its first
--    statement, which cascades:
--        0007  fails -> public.deletion_requests does not exist
--        0010  fails -> public.user_accounts    does not exist
--        0030  fails -> public.user_accounts    does not exist
--    0030 is the migration that makes Disable actually revoke access, so an
--    install that aborts at 0004 silently keeps the old behaviour.
--
-- 2. GAPS. Even when the sequence is run to completion (see §Apply below),
--    two tables end up unprotected:
--        survey_recycle_bin  RLS never enabled. 0007 creates the table but has
--                           no ALTER TABLE for it, and 0004 -- the file that
--                           policies recycle_bin -- predates it.
--        batch_logs          RLS enabled by 0016 but NO policies, which under
--                           Postgres means deny-all. The daily/batch ledger
--                           reads as empty rather than erroring.
--
-- WHAT THIS DOES
--
-- Closes both gaps using the same policy shape 0004 already applies to the
-- older `recycle_bin`: authenticated-only, read and write. It is additive --
-- it never loosens an existing policy and never drops one an operator added
-- by hand on a live install; it only fills in what is absent.
--
-- Every statement is guarded on table existence, so this is safe on an
-- install that predates either table, and idempotent on re-run.
--
-- WHAT THIS DOES NOT DO
--
-- It does not repair the 0004 ordering defect itself. Guarding ~55 statements
-- across three historical migrations is a larger change than this backstop,
-- and is tracked separately. Until then, apply the set in the order given in
-- README.md §How to apply, which does not abort on 0004.
--
-- Idempotent: safe to re-run any number of times.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. survey_recycle_bin -- soft-deleted panorama records.
--    Mirrors the policy 0004 gives `recycle_bin` (authenticated only).
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.survey_recycle_bin') is not null then
    execute 'alter table public.survey_recycle_bin enable row level security';
    execute 'drop policy if exists "Allow authenticated access on survey_recycle_bin"'
            ' on public.survey_recycle_bin';
    execute 'create policy "Allow authenticated access on survey_recycle_bin"'
            ' on public.survey_recycle_bin for all'
            ' using (auth.uid() is not null)'
            ' with check (auth.uid() is not null)';
  else
    raise notice 'survey_recycle_bin absent - 0007 creates it, nothing to do';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. batch_logs -- daily/batch production ledger.
--    0016 enables RLS but creates no policy, so the table denies everything.
--    Same authenticated-only shape as the other operator-owned ledgers.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.batch_logs') is not null then
    execute 'alter table public.batch_logs enable row level security';
    execute 'drop policy if exists "Allow authenticated access on batch_logs"'
            ' on public.batch_logs';
    execute 'create policy "Allow authenticated access on batch_logs"'
            ' on public.batch_logs for all'
            ' using (auth.uid() is not null)'
            ' with check (auth.uid() is not null)';
  else
    raise notice 'batch_logs absent - 0016 creates it, nothing to do';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Sweep: report any PUBLIC table still without RLS, so a future migration
--    that adds a table cannot silently ship it world-readable. Emits a NOTICE
--    rather than raising, so it never blocks an apply -- read it deliberately.
-- ---------------------------------------------------------------------
do $$
declare
  v_unprotected text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
     -- PostGIS installs its own catalogue table in public; not ours to secure.
     and c.relname <> 'spatial_ref_sys';

  if v_unprotected is not null then
    raise notice 'public tables without RLS enabled: %', v_unprotected;
  else
    raise notice 'all public tables have RLS enabled';
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- VERIFICATION (run after applying)
--
--   -- expect: zero rows (spatial_ref_sys is PostGIS's own and is excluded)
--   select c.relname
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relkind = 'r'
--      and not c.relrowsecurity
--      and c.relname <> 'spatial_ref_sys';
--
--   -- expect: zero rows -- RLS enabled but no policy means deny-all
--   select c.relname
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relkind = 'r'
--      and c.relrowsecurity
--      and not exists (select 1 from pg_policies p
--                       where p.schemaname = 'public'
--                         and p.tablename = c.relname)
--    order by 1;
-- =====================================================================