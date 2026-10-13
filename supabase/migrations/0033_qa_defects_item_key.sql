-- =====================================================================
-- Migration 0033: formalise qa_defects.item_key
-- =====================================================================
-- WHY
--
-- Installs that carry `item_key` on `qa_defects` have it as NOT NULL, yet:
--
--   * NO migration ever created it. `grep item_key supabase/migrations/*`
--     returns nothing, and `git log -S item_key -- supabase/` is empty.
--   * NO code ever WROTE it. Before 0033 it appeared only in four SELECT
--     lists (datasets.ts, qaqc.ts x2, panotrackExtractor.ts) as a legacy
--     fallback alongside point_id.
--   * All three readers treat it as a plain synonym for point_id:
--         (d.point_id || d.filename || d.item_key || ...)
--     so a row with item_key set and point_id NULL is treated as identical to
--     a row with only point_id.
--
-- It therefore exists only as schema drift: someone added it by hand to a live
-- database outside the migration history. The consequence was that EVERY
-- qa_defects write was rejected with
--
--     null value in column "item_key" of relation "qa_defects"
--     violates not-null constraint
--
-- and because the failing path only console.warn'd, QA/QC results appeared to
-- save and then vanished on refresh. `qaqc.ts` now checks the returned error
-- and `WriteFailureBanner` surfaces it, which is how this was finally found.
--
-- WHAT THIS DOES
--
--   1. Adds `item_key` where it is missing, so a from-migrations install
--      matches an install that already carries it.
--   2. Backfills it from point_id for any existing row, then enforces NOT NULL.
--   3. Aligns the in-app DDL at AdminSettingsView.tsx with the real table.
--
-- The backfill runs BEFORE the NOT NULL is enforced, and is a no-op where every
-- row already carries a value. Rows with neither column cannot be attributed to
-- a frame at all, so they are backfilled from id rather than dropped.
--
-- Idempotent: safe to re-run any number of times.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Column.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.qa_defects') is not null then
    alter table public.qa_defects add column if not exists item_key varchar(100);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 2. Backfill, then enforce NOT NULL.
--
--    Ordered deliberately: a not-null constraint cannot be added while nulls
--    remain, and dropping rows would destroy audit evidence.
--
--    Corrected: this block previously read a `filename` column as a middle
--    fallback. `public.qa_defects` has no such column — the table carries
--    `point_id`, `image_url`, `run_id` and `item_key`, and nothing named
--    `filename`. Because the statement sat inside a plpgsql DO block it parsed
--    lazily and only threw when the block executed, so `bootstrap.sql` aborted
--    here and migrations 0034+ never applied. Found by applying the bundle to
--    a scratch supabase/postgres:17.6 instance rather than by reading it.
--
--    The fallback chain is now `point_id` -> the row's own id, which is
--    total for every row and preserves the "never null" guarantee without
--    inventing a second identity for a defect.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.qa_defects') is not null then
    update public.qa_defects
       set item_key = coalesce(
             nullif(btrim(point_id), ''),
             'qa-defect-' || id::text
           )
     where item_key is null or btrim(item_key) = '';

    -- Keep item_key aligned with point_id where both exist, so the two cannot
    -- drift into disagreeing about which frame a row refers to.
    update public.qa_defects
       set item_key = point_id
     where point_id is not null
       and btrim(point_id) <> ''
       and item_key is distinct from point_id;

    alter table public.qa_defects alter column item_key set not null;
  end if;
end $$;

comment on column public.qa_defects.item_key is
  'Legacy synonym for point_id, retained for compatibility with older readers. Writers set it equal to point_id.';


-- ---------------------------------------------------------------------
-- 3. Index.
--
--    Only useful once the column is the lookup key on a legacy install; the
--    application's own queries resolve on point_id.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.qa_defects') is not null then
    create index if not exists idx_qa_defects_item_key
      on public.qa_defects (item_key);
  end if;
end $$;
