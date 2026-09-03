# Implementation Plan v3 — Production Readiness (Security, Reliability, Ops)

> Follow-on to v1 (feature complete) and v2 (hardening/operability done). All v1/v2
> phases are shipped. This v3 plan removes the **hard blockers** that separate the
> current *pilot-grade* platform from a *production-deployable, auditable* system.
>
> It is organized as three streams, ordered by risk:
>
> - **A. Security** (server-enforced authorization + a thin BFF so the browser is no
>   longer a privileged fat client) — remove the privilege-escalation hole.
> - **B. Reliability** (durable job store + single source of truth) — remove
>   job-loss-on-restart.
> - **C. Ops** (migrations-as-code, secret manager, env validation, Python CI/tests,
>   observability) — remove the deployment/observability gaps.
>
> Each item is additive, non-breaking, and independently shippable. Nothing here
> changes the existing UI/UX, theme, or current happy-path behavior.

**Guiding rules (identical to v1/v2):**
- **No behavior/layout/logic regressions.** Every item is incremental, additive, or
  a safe refactor. Existing on-screen behavior must remain identical unless an item
  explicitly says it changes security enforcement (which is invisible to normal use).
- **Verify each step.** Frontend: `npx tsc -b` + `npm run build` + `npm run test`
  (and `npm run lint`). Python: `python -m pytest` in `worker/` and `uvicorn` boot
  smoke. Production build must stay green throughout.
- **Strike every completed item** with `~~…~~` and `✅` in this file as you go.
- Keep edits surgical; prefer new small files (and new `.py`/`.sql`/`.ts`) over
  touching the large monoliths (`App.tsx`, `supabase.ts`).
- Never commit unless asked. Never commit secrets; keep real keys out of the repo
  (only `.env.example` / CI secrets).

---

# Stream A — Security (do first; highest risk)

## Phase A1 — Server-enforced authorization (remove UI-only security)

**Why:** Today every Supabase RLS policy checks only `auth.uid() IS NOT NULL`, so
*any signed-in user* (even a Viewer) can write `project_settings`, `user_accounts`
(change roles), `datasets`, `processing_jobs`, and approve/reject
`deletion_requests`. The role→capability map in `src/lib/authz.ts` is cosmetic (it
only hides UI controls). This is a privilege-escalation path an auditor would fail.

**Design:** PostgreSQL **SECURITY DEFINER** PL/pgSQL helpers that resolve the
caller's **app role** (from `auth.jwt() ->> 'role'` or a `user_accounts.role`
lookup keyed on `auth.uid()`), plus RLS policies that `GRANT` write only when that
role has the capability. This moves the boundary from the browser to the database.

- [x] **A1.1 Role resolution helper** — added `supabase/security_functions.sql`
  (idempotent, mirrors the other `*.sql` files) with a `sec` schema:
  - `sec.normalize_role()` — canonicalizes raw role strings.
  - `sec.get_app_role()` — resolves the caller's app role from the JWT claim with a
    `user_accounts.role` fallback (via `SECURITY DEFINER` + `search_path = public`).
  - `sec.can(required_capability TEXT)` — capability → role matrix, mirroring
    `src/lib/authz.ts` server-side (`ADMIN=all; Operator=deleteData/runQaqc/viewAll;
    Inspector=runQaqc/reviewQaqc/viewAll; Viewer=viewAll`).
  - `sec.is_role(required_role)` — convenience for policy bodies.
  - ✅ Done; gates green.
- [x] **A1.2 Adopt helper in RLS for privileged tables** — added
  `supabase/security_rls_apply.sql`: replaced the `auth.uid() IS NOT NULL` posture on
  `project_settings`, `user_accounts`, `deletion_requests`, `datasets`,
  `processing_jobs` with role-guarded policy bodies.
  - `project_settings` / `user_accounts` — write **Administrator only**.
  - `deletion_requests` — INSERT any auth; UPDATE status **Administrator**
    (`approveDeletions`); DELETE **Administrator/Operator** (`deleteData`).
  - `datasets` / `processing_jobs` — reads all auth; writes **non-Viewer** ops roles
    (`manageDatasets` OR `runQaqc`); DELETE admin-only.
  - Reads are unchanged for every authorized role → no UI regression.✅ Done.
- [x] **A1.3 Tests for the security boundary** — added `supabase/security_tests.sql`
  (idempotent, run from the Supabase SQL editor or CI): asserts the helper functions
  exist, role normalization folds, and runs an authenticated-`Viewer` write probe that
  raises unless RLS blocks it. ✅ Done (SQL-level; live RLS run still needs a scratch
  project for the full `authenticated`-role exercise, noted below).
- [x] **A1.4 Client role guard (defense-in-depth)** — updated `src/lib/authz.ts` header
  to state it is now only a UX mirror (the DB is authoritative); added
  `src/lib/__tests__/authz_matches_rls.test.ts` (5 tests) that pins the capability →
  role matrix to match `sec.can()`. ✅ Done; tsc + 161 vitest tests green.

> **Honest note (A1):** The SQL capability matrix was corrected during A1.4 to match
> the refined `authz.ts` map exactly (Survey Operator does **not** get `reviewQaqc`).
> Live `authenticated`-role RLS verification in a scratch Supabase project has not been
> executed in this environment — the SQL is written and self-checked, but the
> "run as a temp low-priv user" gate (A1 Gate) should be confirmed on a real project
> before promoting to production. `audit_logs` DENY (item in the plan's why/spec) was
> not added — confirm current policy is already append-only before production.

**Gate:** run the SQL helper/RLS in a scratch Supabase project; run the security test
script; confirm a temporary low-priv user is rejected on writes. Frontend build/tests
stay green (no TS/UI code changed except comments).

## Phase A2 — Thin FastAPI BFF / API gateway

**Why:** The browser is a fat client talking directly to Supabase (anon key), the
NAS worker (CORS `*`, unauthenticated `/cancel`), and the WebGIS iframe. Enterprise
deployments put a thin gateway in front: it holds the service-role key, enforces
role auth server-side, rate-limits, audits every mutation, and proxies the worker so
the NAS is never reachable from the public internet.

**Design:** New `bff/` FastAPI service (Python, reusing the worker's patterns). The
frontend points its data access through this gateway; Supabase/worker credentials
move out of the browser bundle.

- [x] **A2.1 BFF skeleton** — added `worker/bff/` (FastAPI, reuses worker patterns) with
  `app.py`, `requirements.txt` (no new deps beyond worker), `.env.example`, `README.md`.
  It:
  - holds `SUPABASE_SERVICE_ROLE_KEY` server-side (never sent to the browser),
  - verifies the caller's Supabase JWT server-side via `/auth/v1/user` (no crypto lib),
  - resolves the app role from `user_accounts` via the service-role key,
  - enforces capabilities (mirrors `sec.can()`), and gates CORS by
    `BFF_ALLOWED_ORIGINS`. ✅ Done; compiles + FastAPI app builds on Python 3.10.
- [x] **A2.2 Worker gateway routes** — the BFF exposes the **same** route contract as the
  worker (`/api/jobs`, `/api/jobs/{id}`, `/api/jobs/{id}/cancel`, `/api/folders`,
  `/api/storage`, `/health`) and proxies to the NAS worker server-side, injecting the
  worker token. This fixes the worker's unauth `/cancel` (`_guard(None)` at
  `worker/app.py:144`): every cancel now requires an authorized operator/admin JWT and
  the worker token is injected by the gateway, never the browser. Because the routes
  are identical, the dashboard only repoints its base URL — client code is unchanged.
  ✅ Done (verified route table + build).
- [ ] **A2.3 Env + secrets hygiene** — `worker/bff/.env.example` and README document the
  server-side env/secret handling and CORS. **Not done:** actually moving
  `VITE_SUPABASE_ANON_KEY` *privileged* writes behind the BFF (the dashboard still talks
  Supabase directly today), and there is **no `pytest` suite yet** for the BFF (auth +
  authorization tests). The BFF is a working gateway skeleton, not yet wired as the
  dashboard's default path (`VITE_API_MODE` flip deferred).

**Migration path / no-regression note:** ship the BFF routes behind a config flag
(`VITE_API_MODE=supabase-direct | bff`). Default stays `supabase-direct` until the
BFF is battle-tested; flip to `bff` as the last, explicitly signed-off step.

**Gate:** `python -m pytest` in `bff/`; `uvicorn` boot; run a temp admin + viewer
JWT through the BFF to confirm authorization; frontend build/tests stay green under
both `API_MODE` settings.

---

# Stream B — Reliability (do second)

## Phase B1 — Durable job store + single source of truth

**Why:** `worker/runner.py` keeps the job registry **in-memory** (`JobRegistry` is a
`dict` + threads). Any worker restart loses queued/in-flight jobs and progress.
Status also lives in three places that must agree (worker memory, `processing_jobs`
in Supabase only if sync is enabled, and React state). Enterprise batch compute
needs a durable queue with restart recovery and one authoritative store.

- [x] **B1.1 Durable job persistence** — added `worker/store.py` (an opt-in, thread-safe
  SQLite `SQLiteJobJournal`, WAL mode) and wired it into `JobRegistry` in `worker/runner.py`:
  every mutation (`start` / `update` / `cancel`) persists a serializable snapshot, and a
  new `recover()` reloads persisted jobs on startup (interrupted `QUEUED`/`IN_PROGRESS`
  jobs are surfaced as `FAILED` — never silently dropped). Enabled by setting
  `WORKER_JOB_DB` (documented in `worker/.env.example`). Behavior is unchanged when the
  journal is not configured. `worker/app.py` startup builds the journal and calls
  `recover()` with a log line. ✅ Done; verified with a restart-recovery functional test
  (persist → new instance → reload → interrupted marked FAILED, completed stays).
- [x] **B1.2 Idempotent processing** — Added a stable `_settings_hash(job_type, settings)`
  (sha256) and `_output_path_for(frame, output_dir, recursive)` in `worker/runner.py`;
  `start()` records `settings_hash` + a `_resume` flag (true when that `job_id` is already
  tracked), and `_worker()` **skips frames whose output already exists** when resuming.
  `completed` is initialised as `skipped` so progress stays accurate. ✅ Done; verified
  with a functional test (identical recipe → same hash; changed settings → different hash;
  resume skips existing output, `skipped=1`).
- [x] **B1.3 At-least-once + DLQ semantics** — `worker/runner.py` now routes pool work
  through `_process_with_retry(job_id, src_path, output_dir, job_type, settings,
  retry_limit=...)` (default 3 attempts, configurable via `settings.get("retryLimit", 2)`),
  logging per-attempt failures before a bounded retry. `docs/production_worker_api.md`
  gained a "Retry & recovery (at-least-once)" section documenting the retry policy, the
  `failed_items` DLQ, `REVIEW_REQUIRED`/`FAILED` behaviour, restart recovery via
  `WORKER_JOB_DB`, and idempotent re-submit. ✅ Done; verified (fails twice → succeeds
  on 3rd; persistent failure exhausts after 3 → `FAILED`).
- [x] **B1.4 Dashboard honors authoritative status** — **Complete as-is.** Reviewed the
  frontend merge in `src/services/supabase.ts:2658-2694`; it already treats Supabase
  `processing_jobs` + live worker HTTP state as authoritative (local/worker writes win,
  re-cached; `fetchProcessingJobsFromSupabase` is the load path). Combined with the new
  durable journal (B1.1), a worker restart can no longer silently erase a job — the
  recovered job is returned as `FAILED` over HTTP. A forced restructure of the 2,563-line
  `supabase.ts` here would add regression risk with no remaining gap, so no change was
  made beyond what server-side durability now guarantees.

**Gate:** `python -m pytest` in `worker/` (new tests: restart-recovers-pending-job,
idempotent-resume-skips-completed); kill+restart a worker mid-batch and confirm the
job is not lost; frontend build/tests green.

---

# Stream C — Ops (do third)

## Phase C1 — Migrations as code + env/secret management

- [x] **C1.1 Supabase CLI migrations** — **Migrations-as-code done (files + ordering).** All
  hand-run SQL was moved into a single `supabase/migrations/` directory with ordered
  numeric prefixes `0001`…`0011` (foundation, RLS, security functions, hardening,
  realtime, file inventory) and a `supabase/migrations/README.md` documents the run order
  (ascending), the ordering rule, and apply via the SQL Editor / `psql` with
  `ON_ERROR_STOP=1`. **Gap:** not yet wired to `supabase db push` / `config.toml` /
  a migrations table — a hand-run documented sequence until a runner is adopted (noted in
  the README). ✅ Done (files + ordering + README).
- [ ] **C1.2 Secret manager** — replace committed/`.env`-style secrets with a
  supported secret store (e.g. GitHub Environments / Actions secrets, or a cloud
  secret manager) for `SUPABASE_SERVICE_ROLE_KEY`, `NAS_WORKER_TOKEN`, Sentry DSN.
  `.env.example` keeps placeholders only. **Not done** (server-side secrets remain in
  host env / BFF `.env`; no external secret manager adopted).
- [x] **C1.3 Env validation** — **Documented (partial).** `docs/ENV.md` is the usage-site
  reference (defaults + usage sites) and `worker/.env.example` + `worker/bff/.env.example`
  carry placeholders. **Gap:** no fail-fast startup validator (frontend `VITE_*` check or
  Python `validate_env()`) wired into boot; documented rather than enforced.

## Phase C2 — Python CI + tests + strict lint

- [x] **C2.1 Worker tests** — Added `worker/tests/` with `worker/tests/test_store.py`
  (5 stdlib-only `pytest` tests for the durable SQLite journal: write/read-all, idempotent
  upsert, remove, restart recovery + `hydrate_job`, and `serializable_job` stripping
  runtime handles). These need **no numpy/opencv** so they run in bare CI. **Gap:** no
  pytest yet for `runner.py`'s cv2-dependent lifecycle or `resolve_fs`/`sync.py` — those
  need the GPU stack and remain manual/optional-skippable. ✅ Done (store tests; 5 passed).
- [x] **C2.2 Python CI job** — Added a blocking **`python`** job to
  `.github/workflows/ci.yml` (active on matrix `python-version: ['3.10','3.11']`):
  setup-python, install `pytest`, `py_compile` gate over `worker/*.py` +
  `worker/bff/*.py` + tests, then `pytest` in `worker/`. ✅ Done (YAML valid — jobs:
  build/test/lint/python; compile + tests pass locally). **Gap:** `ruff`/`flake8` +
  `pyproject.toml` lint config not added (kept dependency-light for repo-wide gate).
- [x] **C2.3 Make frontend lint blocking** — Changed the CI `lint` job from
  `name: Lint (non-blocking)` + `continue-on-error: true` to **`name: Lint (blocking)`**
  with no `continue-on-error`, so it gates CI. ✅ Done (safe: `npm run lint` already exits
  `0` — 0 errors / warnings are non-fatal). **Not applied:** ESLint `--max-warnings 0` on
  new files (deferred to avoid a wall of legacy warnings blocking unrelated PRs).

## Phase C3 — Observability (worker + dashboard)

- [x] **C3.1 Structured logging** — `worker/app.py`: when `NAS_LOG_JSON=1` is set, the root
  logger switches to a stdlib JSON formatter (`ts`, `level`, `logger`, `msg`, optional
  `exc`); otherwise it keeps the human format. No new dependency. **Gap:** the BFF
  (`worker/bff/app.py`) and Flask/FastAPI request logging are not yet JSON-structured, so
  this is worker-only. ✅ Done (worker JSON structured logging; compile verified).
- [x] **C3.2 Worker metrics endpoint** — Added `GET /metrics` in `worker/app.py` returning
  Prometheus text (`nas_worker_info{worker=...}`, `nas_worker_uptime_seconds`,
  `nas_jobs_active/completed/failed/total`, `nas_storage_total/free/used_bytes`), derived
  live from the registry + `shutil.disk_usage` — dependency-free. ✅ Done (compile + route
  verified).
- [ ] **C3.3 Request tracing / Sentry** — **Not done.** Sentry SDK was NOT added to
  `worker/` or `bff/` (would add a dependency + DSN wiring; deferred). The frontend
  already guards Sentry via `src/lib/sentry.ts` (no-op when `VITE_SENTRY_DSN` absent).
  Structured worker logs are a stopgap until Sentry/`structlog` is adopted.

## Phase C4 — Deployment & DR posture (documentation + smoke)

- [x] **C4.1 Deployment runbook** — New `docs/DEPLOYMENT_DR.md` (deployment + DR runbook):
  component topology, deployment checklist for Supabase / worker / BFF / dashboard,
  recovery & DR (graceful restart via durable journal, full host rebuild, DB backup,
  worker-only incident), and a troubleshooting quick-reference table (401, `/cancel`
  auth, 503, restart-recovery, capacity, retries). ✅ Done. (Named `DEPLOYMENT_DR.md`
  rather than `DEPLOYMENT.md` to cover DR explicitly.)
- [x] **C4.2 Production smoke checklist** — New `docs/SMOKE_CHECKLIST.md`: versioned
  sequence covering build/static gates, worker+BFF health + `/metrics`, the auth boundary
  (unauth → 401), submit/poll/cancel through the BFF, restart-recovery (durable store),
  retry test, RLS surface (`0011_security_tests.sql` + `authenticated`-role caveat), and a
  final regression sweep. ✅ Done.

---

# Rollout order & waves

1. **Wave 1 (must, block production):** A1 security functions + RLS adopt +
   security tests → A2 BFF (behind flag) → B1 durable job store.
2. **Wave 2 (ops before client deploy):** C1 migrations/secret/env → C2 Python
   CI/tests → C3 observability → C4 runbook + smoke.
3. **Wave 3 (optional, post-deploy):** flip `VITE_API_MODE=bff` default, Prometheus
   scraping, deeper App.tsx/supabase.ts de-monolithing (from v2 phase 9.1) — keeps the
   system shippable without waiting on the structural refactor.

---

# Acceptance summary (definition of "production-ready")

- [ ] No authenticated user can perform a write they are not authorized for at the
      database layer (A1 + A2).
- [ ] Worker restart does not silently lose jobs; jobs recover or are explicitly
      marked failed with a reason (B1).
- [ ] `git push` runs fully blocking CI: frontend build+test+lint **and** Python
      build+test+lint (C2).
- [ ] Migrations are versioned and code-reviewable; secrets live in a secret
      manager, not the repo (C1).
- [ ] Worker + BFF emit structured logs and report to Sentry when configured (C3).
- [ ] A reviewed deployment + DR runbook exists and is exercised via the smoke
      checklist (C4).

---

## Working agreements (this file)
- Update strike status as items land; keep the AI's memory of "what landed" in sync.
- Notes to revisit: `App.tsx` (~6,085 lines) and `supabase.ts` (~2,563 lines) remain
  the structural refactor backlog item (v2 9.1) — intentionally deferred here so
  production-readiness isn't blocked on cosmetic structure.
