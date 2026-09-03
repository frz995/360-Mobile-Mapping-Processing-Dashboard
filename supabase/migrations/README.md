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

## Ordering rule

- **Must run in ascending numeric order** — later files may rely on earlier
  tables/functions (e.g. 0010 calls `sec.can()` from 0009).
- `0011_security_tests.sql` is a **test**, not a schema migration: run it in CI
  or the SQL Editor to assert the security boundary; it makes no data changes.

## How to apply

Via the Supabase SQL Editor (paste in order), or `psql`:

```bash
for f in supabase/migrations/00*.sql; do
  echo "-- applying $f"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

> Best-effort note: this project is not yet wired to a migration runner
> (e.g. `supabase db push` / a local migrations table). Applying is currently
> a documented, hand-run sequence. `psql` with `ON_ERROR_STOP=1` gives the
> closest thing to a failure-fast apply until a runner is adopted (see
> `implementation_plan_v3.md` Stream C — C1).
