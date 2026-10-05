-- =====================================================================
-- Migration 0032: run-scoped QA defects
-- =====================================================================
-- WHY
--
-- `qa_defects` was keyed only on (project_id, subgrid, point_id). It has no
-- notion of which survey RUN a defect belongs to, so every aggregate built on
-- it is necessarily subgrid-level:
--
--     src/services/api/datasets.ts
--       qaDefectsPerSubgrid.get(normSubgrid)
--         -> the same count is handed to EVERY run of that subgrid.
--
-- With more than one survey run per subgrid — e.g. N93E70 surveyed on
-- 2022-04-08 (92 frames) and again on 2026-09-27 (196 POI) — a subgrid with
-- 54 flagged defects shows 54 on both runs, including runs that were never
-- audited. That is the same defect-count bleed the audit cache had, one layer
-- down, and it cannot be fixed in the read path because the column that would
-- distinguish the runs does not exist.
--
-- `qaqc_audit_runs` already carries run_id, so a survey run is a first-class
-- concept everywhere else in the schema. This migration brings `qa_defects`
-- into line.
--
-- WHAT THIS DOES
--
--   1. Adds `run_id VARCHAR(100)` to `qa_defects`.
--   2. Widens the unique constraint to include run_id, so two runs of one
--      subgrid can each hold a defect for the same filename without
--      overwriting one another.
--   3. Adds a per-run index for the aggregate read.
--
-- DELIBERATELY NO BACKFILL
--
-- Existing rows keep run_id NULL. Populating it means matching each defect row
-- to the audit run that produced it, and the only available signal is a
-- substring test against the `defects_list` JSONB on `qaqc_audit_runs`. If
-- that JSON does not carry `point_id` values, the match silently returns
-- nothing; if it does, a wrong match writes an incorrect audit trail. Neither
-- failure is worth the risk to data that cannot be reconstructed.
--
-- NULL run_id is treated by the client as "this defect speaks for the whole
-- subgrid" — the pre-existing behaviour. Those rows stop over-reporting once
-- the affected subgrids are re-audited, which has to happen anyway: audit run
-- summaries written before the `onConflict` fix in `src/services/api/qaqc.ts`
-- never persisted at all, so the on-screen counts were React state only.
--
-- Idempotent: safe to re-run any number of times.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. run_id column.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.qa_defects') is not null then
    alter table public.qa_defects add column if not exists run_id varchar(100);
  end if;
end $$;

comment on column public.qa_defects.run_id is
  'Survey run this defect belongs to (qaqc_audit_runs.run_id). NULL = subgrid-level defect, predates run-scoped auditing.';


-- ---------------------------------------------------------------------
-- 2. Widen the unique key to (project_id, subgrid, run_id, point_id).
--
--    The 3-column constraint from 0016 makes every run of a subgrid share one
--    slot per filename, so a defect recorded by a later run overwrites an
--    earlier run's row for the same point. Widening it lets each run own its
--    own defect set.
--
--    The old constraint is dropped only after the new one exists, so there is
--    no window in which the table is left without a unique key.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.qa_defects') is not null then
    if not exists (
      select 1 from pg_constraint
       where conname = 'qa_defects_project_subgrid_run_point_unique'
    ) then
      alter table public.qa_defects
        add constraint qa_defects_project_subgrid_run_point_unique
        unique (project_id, subgrid, run_id, point_id);
    end if;

    -- 0016's narrower key is now redundant and actively harmful: it would
    -- reject the wider key's rows from being used for ON CONFLICT resolution
    -- and still permit the overwrite described above.
    if exists (
      select 1 from pg_constraint
       where conname = 'qa_defects_project_subgrid_point_unique'
    ) then
      alter table public.qa_defects
        drop constraint qa_defects_project_subgrid_point_unique;
    end if;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 3. Indexes for the per-run aggregate.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.qa_defects') is not null then
    create index if not exists idx_qa_defects_subgrid_run
      on public.qa_defects (project_id, subgrid, run_id);

    -- Partial index: the aggregate in datasets.ts only ever counts rows that
    -- carry a run_id. Subgrid-level rows stay out of the index entirely.
    create index if not exists idx_qa_defects_run_scoped_unresolved
      on public.qa_defects (project_id, subgrid, run_id)
      where is_resolved = false;
  end if;
end $$;
