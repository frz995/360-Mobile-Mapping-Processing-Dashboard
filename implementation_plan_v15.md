# Implementation Plan v15 — Full Per-Project Data Isolation

## Objective
Turn the v14 project scope-switching model into **true per-project data isolation**: every
operational table gains a `project_id` column, all legacy rows are adopted by the carried-forward
production project, and every client read/write/sync is scoped to the active project. Creating a
new project starts a genuinely empty workspace; switching projects only ever surfaces that
project's data.

## Decisions (confirmed)
- **Design choice — app-layer enforcement (v15 scope).** The active project is a per-user,
  client-side choice, so project scoping is enforced centrally in the Supabase service layer
  (every query filtered `.eq('project_id', id)`; every insert/upsert stamps `project_id`).
  The existing role-based RLS stays unchanged. Hard DB-enforced per-request project scoping
  (via a `current_setting`/JWT claim) is noted as a hardening follow-up — it requires per-user
  session plumbing that conflicts with client-side project switching.
- **Legacy adoption.** Pre-v15 rows (all `project_id IS NULL` rows) are copied onto the
  carried-forward production project when it is first seeded, via a SECURITY DEFINER RPC
  (`projects_adopt_legacy_rows`). Nothing is lost or renamed.
- **Active-project source of truth.** A new tiny module `src/services/projectContext.ts`
  holds the id synchronously (in-memory + falls back to the persisted
  `geosphere360_active_project_<userKey>` key, resolving the userKey from the Supabase auth
  token in localStorage like `getAuthStorageUserKey`). Services call `getActiveProjectId()`;
  call sites are unchanged. No import cycles (projectContext imports no supabase/projects).
- **Null context = unscoped.** When no active project exists (guest, or the brief boot window
  before restore), queries run unscoped — identical to today's RLS visibility. Guests keep their
  read-only global view; v15 isolation applies once a project is active.
- Mixed-content tables (`audit_logs`, `notifications`, `user_accounts`, `project_settings`,
  `deletion_requests`, `file_inventory`) are treated pragmatically: work-data tables
  (panoramas, staging, qa, subgrids, datasets, jobs, recycle, batch_logs) are strictly scoped;
  audit/notification rows are stamped but read globally where they are system-wide logs.
- Security caveat documented: cross-project SELECT is still permitted by RLS today; isolation is
  application-level. Hardening is a follow-up.

## Phases

> **Status: all phases implemented.** Gates green — `npx tsc -b` clean, `npm run lint`
> 0 errors, `npm test` 37 files / 334 tests. Remaining action: apply
> `supabase/migrations/0016_per_project_isolation.sql` to the database (SQL Editor /
> `supabase db push`), then bump `src/config/defaults.ts` `APP_VERSION` on ship.

### 1. Active-project context — `src/services/projectContext.ts`
- `ACTIVE_PROJECT_KEY_PREFIX = 'geosphere360_active_project_'`.
- `computeUserKey()` — extract authenticated user id/email from the persisted
  `sb-*-auth-token` localStorage token (fallback `'guest'`).
- `saveActiveProjectId / loadActiveProjectId / clearActiveProjectId` (memory + storage).
- `setActiveProjectId(id|null)` / `getActiveProjectId()` used by the service layer.
- `src/services/projects.ts` re-exports these (API unchanged for App) and keeps the
  existing per-user helpers synced (they already call the same storage).

### 2. Migration — `supabase/migrations/0016_per_project_isolation.sql`
- Add `project_id uuid REFERENCES public.projects(id)` to: `panoramas`, `staging_panoramas`,
  `qa_defects`, `qaqc_audit_runs`, `subgrids`, `datasets`, `processing_jobs`, `audit_logs`,
  `notifications`, `deletion_requests`, `survey_recycle_bin`, `file_inventory`.
- Create missing baseline `batch_logs` (subgrid overrides: `project_id`, `subgrid`, `status`,
  `pic`, `publish_to_webgis`, `is_synced_with_supabase`, `updated_at`,
  unique `(project_id, subgrid)`).
- Rebuild uniqueness with project as a leading key:
  `qa_defects(project_id,subgrid,point_id)`, `qaqc_audit_runs(project_id,subgrid,run_id)`,
  `panoramas(project_id,filename)`, `file_inventory(project_id,bucket,filename)`,
  `subgrids(project_id, subgrid)` (drop old per-table uniques first).
- Indexes on `(project_id, …)` for every scoped table.
- Drop the now-unused old unique constraints (deduped by name).
- Seeded registry stays; **no backfill in DDL** — adoption happens via RPC at seed time.
- `projects_adopt_legacy_rows(p_project_id uuid)` — SECURITY DEFINER; `UPDATE … SET
  project_id = p_project_id WHERE project_id IS NULL` across all operational tables; returns
  per-table adopted counts. Idempotent.

### 3. Service layer scoping — `src/services/supabase.ts`
- Import `getActiveProjectId`; add a tiny `pid()` helper returning the id (undefined when null).
- Fetches (e.g. `fetchSupabaseData`, `fetchQaRecordsFromSupabase`,
  `fetchStagingPanoramasFromSupabase`, `fetchQaAuditRunsFromSupabase`,
  `fetchRecycleBinFromSupabase`, `fetchDatasetsFromSupabase`,
  `fetchProcessingJobsFromSupabase`, `fetchBatchLogOverridesFromSupabase`,
  `fetchAuditLogsFromSupabase`, `fetchNotificationsFromSupabase`, `fetchQADefectsForSubgrid`,
  `fetchDeletionRequestsFromSupabase`): append `.eq('project_id', pid)`.
- Insert/upsert (`publishToSupabase`, `saveToStagingSupabase`, `saveQaAuditRunToSupabase`,
  `saveAuditLogToSupabase`, `saveNotificationToSupabase`, `saveToRecycleBinInSupabase`,
  `saveDatasetToSupabase`, `registerSurveyDataset`, `saveProcessingJobToSupabase`,
  `persistBatchLogToSupabase`, `saveDeletionRequestToSupabase`, `saveUserAccountToSupabase`):
  include `project_id` in payload; update `onConflict` keys to the new unique shapes.
- Update/delete (`updateDefectStatusInSupabase`, `deletePointsFromSupabase`,
  `deleteFromSupabase`, `deleteFromStagingSupabase`, `deleteDatasetFromSupabase`,
  `resolveQADefectInSupabase`, job status/QA/handoff updates, recycle delete,
  `removeAllStagingData`): add `.eq('project_id', pid)` so cross-project rows can never change.
- Realtime: `useAppData` channel adds `filter: project_id=eq.<pid>` per subscribed table;
  `ProcessingCenterWorkspace` processing_jobs channel adds the same.
- `useQAQCWorker.ts` direct `qa_defects` upsert: stamp project_id + onConflict
  `'project_id,subgrid,point_id'`.

### 4. Seed & legacy adoption — `src/App.tsx`
- After `ensureSeedProject` resolves (DB or local), call
  `supabase.rpc('projects_adopt_legacy_rows', { p_project_id: project.id })` best-effort.
- On load/create/restore/sign-out, sync `setActiveProjectId` so the context is current even
  before auth storage settles.

### 5. Worker — `worker/sync.py`
- When PATCHing a `processing_jobs` row, echo `project_id` from the job payload so the
  service-role writer never clears or mismatches it (`bff/app.py` reads global
  `user_accounts` — untouched).

### 6. Types & misc
- Optional `projectId?: string` on `DatasetRecord`/`ProcessingJob`/table-facing types.
- `getDatabaseTableMapping` untouched (table names already dynamic).

### 7. Tests & gates
- `src/services/__tests__/projectContext.test.ts` — computeUserKey, save/load/clear round-trip,
  memory-first get, guest fallback.
- Update `projects.test.ts` for re-exported helpers (imports unchanged).
- Smoke: keep ProjectWorkspace / DataManagementPage suites green (supabase mocked).
- Gates: `npx tsc -b` clean, `npm run lint` 0 errors + no new warnings, `npm test` green.
- Manual: create project B → dashboard is empty; publish/import under B; switch to A → only A's
  rows; realtime only reflects A; bbox/scope already per-project via v14.

## Out of scope / follow-ups
- DB-enforced per-request project scoping (RLS using JWT claim / current_setting).
- Per-project immutable storage namespace (panorama files remain subgrid-keyed; subgrids are now
  project-tagged, so collisions across projects are avoided at the record level).
- Cross-project aggregate/report dashboards.