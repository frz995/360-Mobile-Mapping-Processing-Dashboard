# Supabase Migrations (migrations-as-code)

All schema migrations are versioned here and applied **in filename order**.
Each file is idempotent (`IF NOT EXISTS` / `DROP ... IF EXISTS` / `CREATE OR
REPLACE`) and safe to re-run from the Supabase SQL Editor or `psql`.

## Files (apply top-to-bottom)

| # | File | Purpose |
|---|------|---------|
| 0001 | `0001_schema_migrations.sql` | Base schema: project_settings, subgrids, audit_logs, notifications, qa tables. |
| 0002 | `0002_foundation_production_migration.sql` | Production foundation: `datasets`, `processing_jobs`, storage hooks. |
| 0003 | `0003_foundation_processing_migration.sql` | Processing foundation on top of 0002. |
| 0004 | `0004_rls_application_tables.sql` | Application tables: `user_accounts`, `deletion_requests` + initial RLS. |
| 0005 | `0005_realtime_qaqc.sql` | Realtime QA/QC publication. |
| 0006 | `0006_file_inventory.sql` | Server-side `file_inventory` (replaces client bucket enumeration). |
| 0007 | `0007_hardening.sql` | Phase 7–10 resilience/hardening, audit helper grants. |
| 0008 | `0008_fix_security_advisor.sql` | Address Security Advisor findings on prior migrations. |
| 0009 | `0009_security_functions.sql` | **A1.1** SECURITY DEFINER helpers (`sec.get_app_role`, `sec.can`, `sec.is_role`). |
| 0010 | `0010_security_rls_apply.sql` | **A1.2** Role-guarded RLS on privileged tables. |
| 0011 | `0011_security_tests.sql` | **A1.3** Security-boundary test script (run, not a schema change). |
| 0012 | `0012_core_tables_and_rls.sql` | **Phase 3** Missing PostGIS DDL (`panoramas`, `staging_panoramas`, `panoramas_view`), `is_fallback_coord`, drop orphaned `recycle_bin`, and role-guarded RLS on core tables. |
| 0013 | `0013_prune_bloated_user_metadata.sql` | Strip `roadAnalysisState` from user metadata (fixes HTTP 431). |
| 0014 | `0014_road_analysis_state_rpc.sql` | `sec.save_road_analysis_state()` — cloud-save without reopening `project_settings` writes. |
| 0015 | `0015_projects.sql` | `projects` registry, `pg_trgm`, RLS. |
| 0016 | `0016_per_project_isolation.sql` | `project_id` across 12 tables, `batch_logs`, `projects_adopt_legacy_rows()`. |
| 0017 | `0017_project_delete_cascade.sql` | `projects_delete_cascade()`. |
| 0018 | `0018_map_shares.sql` | `map_shares` + `map_share_touch()`. |
| 0019 | `0019_map_shares_public_access.sql` | Grants `anon` SELECT and a public read policy. |
| 0020 | `0020_datasets_operator_delete.sql` | Operator DELETE on `datasets`. |
| 0021 | `0021_road_analysis_geometry_storage.sql` | Creates the private `road-analysis-geometry` bucket + policies. |
| 0022 | `0022_production_runs.sql` | `production_runs`, `_attempts`, `production_releases`, `_files`. |
| 0023 | `0023_station_board_items.sql` | `station_board_items` — persisted station snapshots. |
| 0024 | `0024_stage_event_ledger.sql` | `stage_event_ledger` (append-only). |
| 0025 | `0025_station_board_metric_unit.sql` | Capture-point units on the station board. |
| 0026 | `0026_hub_session_state.sql` | `hub_session_state` — Production Hub last activity. |
| 0027 | `0027_reconcile_panorama_columns.sql` | Latitude/longitude/heading columns + backfill. |
| 0028 | `0028_sync_file_inventory.sql` | Storage → `file_inventory` triggers + backfill. |
| 0029 | `0029_csv_file_name.sql` | `csv_file_name` column + backfill. |
| 0030 | `0030_role_precedence.sql` | Makes the `user_accounts` row authoritative for role **and status**, so **Disable revokes access**. Adds `sec.app_metadata_effective_role()` so the role repair and the post-apply verification query cannot drift apart. Reconciles role drift first, so it cannot lock anyone out. |
| 0031 | `0031_rls_completeness_backstop.sql` | Closes two RLS gaps a from-empty install leaves: `survey_recycle_bin` never had RLS enabled, and `batch_logs` had RLS but **no policies** (deny-all). Additive and guarded; never loosens an existing policy. Apply **after** 0030. |
| 0032 | `0032_qa_defects_run_scope.sql` | Adds `qa_defects.run_id` and widens the unique key to `(project_id, subgrid, run_id, point_id)`, so two survey runs of one subgrid can each hold a defect for the same filename. **Required by the app** — `datasets.ts` selects `run_id` and both defect writers upsert on it; without this the select fails (every run reads 0 defects) and every defect write is rejected. No backfill: existing rows keep `run_id` NULL and are treated as subgrid-level. |
| 0033 | `0033_qa_defects_item_key.sql` | Formalises `qa_defects.item_key`, which was NOT NULL on at least one live database while appearing in **no migration** and being **written by no code** — every `qa_defects` write was rejected with a not-null violation. Adds the column where missing, backfills it from `point_id`, then enforces NOT NULL. |

## Ordering rule

- **Must run in ascending numeric order** — later files may rely on earlier
  tables/functions (e.g. 0010 calls `sec.can()` from 0009).
- `0011_security_tests.sql` is a **test**, not a schema migration: run it in CI
  or the SQL Editor to assert the security boundary; it makes no data changes.
- **0030 must be applied before 0031** — 0031 only touches `survey_recycle_bin`
  and `batch_logs`, but keep them in order so the RLS sweep reflects the final
  schema.
- **Known ordering defect: `0004` before `0012`.** `0004` opens with
  `ALTER TABLE public.panoramas ENABLE ROW LEVEL SECURITY`, but `panoramas` is
  created by `0012`. On an empty database `0004` therefore fails on its first
  statement, and the failure cascades to `0007` (needs `deletion_requests`),
  `0010` and `0030` (need `user_accounts`). **`0030` is the one that matters** —
  an install that aborts at `0004` silently keeps the old behaviour where
  **Disable does not revoke**. 0031 repairs the resulting RLS gaps but not the
  abort itself.
  **Consequence: do not fail fast at `0004`.** Use the loop below, which keeps
  going and lets `0012` create the tables `0004` wanted. Fixing this properly
  means guarding ~55 statements across `0004`/`0007`/`0010`; tracked separately.

## How to apply

**Preferred — Supabase SQL Editor:** paste each file in ascending order. The
Editor runs statements independently, so `0004`'s early failure does not stop
`0012` from creating `panoramas`.

**Via `psql`** — note the two deliberate departures from a strict loop:

```bash
for f in supabase/migrations/00*.sql; do
  # 0011 is a test script, not a schema migration
  case "$f" in *0011_security_tests.sql) continue ;; esac
  echo "-- applying $f"
  # No ON_ERROR_STOP: 0004 references tables that 0012 creates, so it fails on
  # a fresh database. Stopping there would leave 0007/0010/0030 unapplied.
  psql "$SUPABASE_DB_URL" -q -f "$f" || echo "   (continued past an error in $f)"
done
```

Then **verify** — see `0031` §VERIFICATION:

```bash
# expect zero rows: public tables with RLS enabled but no policy
psql "$SUPABASE_DB_URL" -t -A -c "
select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity
   and not exists (select 1 from pg_policies p
                    where p.schemaname='public' and p.tablename=c.relname);"

# expect 'NEW': the directory-authoritative role resolver is in place
psql "$SUPABASE_DB_URL" -t -A -c "
select case when prosrc like '%not Active%' then 'NEW' else 'OLD' end
  from pg_proc where proname='get_app_role';"
```

> Best-effort note: this project is not yet wired to a migration runner
> (e.g. `supabase db push` / a local migrations table). Applying is currently
> a documented, hand-run sequence. Do **not** add `ON_ERROR_STOP=1` to the loop
> above: `0004` cannot succeed until `0012` has run, so failing fast there
> leaves `0030` unapplied and Disable stops revoking. A real migration runner
> would track applied files and could enforce order properly; see
> `implementation_plan_v3.md` Stream C — C1.

### First-time apply of 0030 (read this before running it)

`0030_role_precedence.sql` is the only migration that **changes who is
authoritative for a user's role**, so it deserves a deliberate sequence rather
than a blind paste. It is idempotent and re-runnable, but do the checks anyway.

1. **Back up first.** It rewrites roles on existing rows. In Supabase:
   Database → Backups → take an immediate restore point, or
   `pg_dump "$SUPABASE_DB_URL" > pre-0030.sql`.
2. **Record the "before" state**, so you can prove afterwards that nothing
   changed unexpectedly:
   ```sql
   select u.email, u.role, u.status,
          coalesce(a.raw_app_meta_data ->> 'role', '(none)') as metadata_role
     from public.user_accounts u
     left join auth.users a on lower(a.email) = lower(u.email)
    order by u.email;
   ```
3. **Apply `0030`.** It repairs any row whose role disagreed with an effective
   App Metadata role *before* switching the authority, so it cannot silently
   downgrade anyone. Rows whose claim was Viewer/guest/absent are left alone:
   those claims conferred nothing under `0009`, so they place no expectation.
4. **Verify — expect zero rows.** This reuses the same
   `sec.app_metadata_effective_role()` the repair used, so it cannot report
   drift the repair did not fix:
   ```sql
   select u.email, u.role, u.status,
          a.raw_app_meta_data ->> 'role'                       as metadata_role,
          sec.app_metadata_effective_role(a.raw_app_meta_data) as effective_role
     from public.user_accounts u
     join auth.users a on lower(a.email) = lower(u.email)
    where sec.app_metadata_effective_role(a.raw_app_meta_data) is not null
      and u.role is distinct from sec.app_metadata_effective_role(a.raw_app_meta_data);
   ```
5. **Review the full picture**, including the accounts step 4 deliberately
   ignores. `resolved` is what `sec.get_app_role()` will now return:
   ```sql
   select u.email, u.status, u.role as directory_role,
          coalesce(a.raw_app_meta_data ->> 'role', '(none)') as metadata_role,
          case when lower(coalesce(u.status, '')) = 'active'
               then sec.normalize_role(u.role) else 'Viewer' end as resolved
     from public.user_accounts u
     left join auth.users a on lower(a.email) = lower(u.email)
    order by resolved, u.email;
   ```
6. **Prove revocation actually works.** Sign in as a user with
   `status = 'Disabled'` and run `select sec.get_app_role();`. It must return
   `Viewer` even if their App Metadata still says `Administrator`. Under `0009`
   it returned the claim instead, which is why the Disable control used to be
   a no-op.

**If step 4 returns any rows**, the repair and the check disagree, which should
be impossible. Capture the output and stop rather than editing roles by hand.

> ⚠️ **These queries read `auth.users.raw_app_meta_data`, not `app_metadata`.**
> `app_metadata` is a *generated* column that Supabase added later; the raw
> column is the one GoTrue has always written, so it is present on every
> layout. Querying `app_metadata` on a project without that generated column
> fails with `ERROR 42703: column ... app_metadata does not exist` — which is
> exactly how a broken 0030 apply presents.
