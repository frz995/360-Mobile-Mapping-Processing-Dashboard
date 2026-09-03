# Deployment & Disaster-Recovery Runbook

Applies to the **production pipeline**: the on-prem **NAS GPU worker** +
**BFF gateway** + **Supabase** + the Vite dashboard. Auth is handled by the
Supabase project; the dashboard is served as a static bundle pointing at
`VITE_PRODUCTION_API_URL` (the BFF) for NAS operations.

> Reference for every variable below: `docs/ENV.md`, `worker/.env.example`,
> `worker/bff/.env.example`.

---

## 1. Component topology

```text
Browser (dashboard SPA)
    │  Supabase JWT (anon token) for auth + data
    ▼
Supabase (Postgres RLS + storage + realtime)
    ▲
    │  service-role key (server-only)
BFF gateway  ── /api/* on NERD, verifies JWT, resolves app role ──►  NAS GPU Worker
                                                                       │ durable journal (SQLite, WORKER_JOB_DB)
                                                                       ▼
                                                                   NAS file store (NAS_BASE_PATH)
```

- **BFF** (`worker/bff/app.py`) fronts the worker. The dashboard must point at
  the **BFF**, never directly at the worker, so all worker routes get
  auth + role-gating and the unauthenticated `/cancel` gap is closed.
- **Worker** (`worker/app.py`) stays on the internal LAN; only the BFF is
  reachable from the dashboard.

---

## 2. Deployment checklist

### 2.1 Supabase
1. Apply migrations in order (see `supabase/migrations/README.md`), up to
   `0010_security_rls_apply.sql`. `0011_security_tests.sql` is a **test** —
   run it in the SQL Editor to assert the security boundary.
2. Provision project URL + anon key + service-role key; store service role
   on the BFF only (never in the client bundle).
3. Create storage buckets referenced by `VITE_SUPABASE_BUCKET` (+ aliases).

### 2.2 NERD worker host
1. Provision a Python 3.10+ environment, install `worker/requirements.txt`
   (includes the GPU stack: numpy, opencv, etc.).
2. `worker/.env.example`: set `NAS_BASE_PATH`, `NAS_WORKER_TOKEN`,
   `CONCURRENCY`, `WORKER_JOB_DB`, `NAS_WORKER_ID`, `SUPABASE_URL`, service-role
   (server-side), optional `NAS_LOG_JSON=1`.
3. Start worker: `uvicorn app:app --host 127.0.0.1 --port 8000` (LAN-only).
4. Health-check the **worker** directly during bring-up:
   `curl http://127.0.0.1:8000/health`.

### 2.3 BFF gateway
1. `worker/bff/requirements.txt`; set `WORKER_URL`, `NAS_WORKER_TOKEN`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
2. Start BFF: `uvicorn app:app --host 0.0.0.0 --port 8001`.
3. Health-check: `curl http://<bff>/health`.
4. Point dashboard `VITE_PRODUCTION_API_URL` at the BFF and `VITE_FRONTEND` /
   shared-secret toggles accordingly; rebuild the SPA.

### 2.4 Dashboard
1. Set `VITE_*` vars; **rebuild** (they are baked in at build time).
2. Serve the static `dist/` behind TLS.

---

## 3. Recovery / disaster-recovery (DR)

### 3.1 Graceful restart
Single `kill`/restart of the NERD worker is safe:
- The durable **SQLite job journal** (`WORKER_JOB_DB`) records all in-flight
  jobs. On startup `registry.recover()` marks any QUEUED/IN_PROGRESS job as
  `FAILED` with a `"Worker restarted - job interrupted"` message.
- On the dashboard, re-submit interrupted jobs. **B1.2 idempotency** means a
  re-submitted job skips frames whose outputs already exist, so resumes are
  cheap and never double-process.

> Note: the SQLite journal is a recent resilience addition; set `WORKER_JOB_DB`
> so the journal is enabled.

### 3.2 Full host rebuild / replacement
1. New host: repeat §2.2 with the same `NAS_BASE_PATH` (mount/attach the NAS
   filesystem). Do **not** delete existing frame outputs — idempotent resume
   depends on them.
2. Point the BFF’s `WORKER_URL` at the new worker; no dashboard change needed
   (it talks to the BFF).

### 3.3 Database backup
- Back up Supabase Postgres (project-level backups/snapshots) regularly;
  the journal is ephemeral local state, not the source of truth.
- Keep the migrations (under version control) as the schema source of truth.

### 3.4 Worker-only incident (BFF healthy)
- Check `/metrics` + `/health` for `nas_jobs_active`/`nas_jobs_failed` and
  NERD storage (free/used) to triage capacity or a wedged job.
- Jobs stuck in a failed/half state: re-submit from the dashboard (idempotent).

---

## 4. Troubleshooting quick reference

| Symptom | Likely cause | Action |
| --- | --- | --- |
| 401 from dashboard → worker | Shared secret mismatch (`NAS_WORKER_TOKEN`) or expired JWT | Align `worker/.env.example` + BFF token; verify BFF verifies JWT via `/auth/v1/user`. |
| `/cancel` not authorised | Dashboard bypassing BFF → worker directly | Route via BFF (worker `/cancel` is deliberately open for LAN use). |
| Worker `503 Still initialising` | Started recently, journal recover still running | Retry after recover completes (check logs). |
| Interrupted jobs after restart | Expected journal-recovery behaviour | Re-submit; outputs resume idempotently. |
| Storage at capacity | NERD full | `nas_storage_free_bytes` metric; purge archiving; free space before re-submitting. |
| High error_count / failed_items | Frame-level failures | Check `error_log`; retry policy in `worker/runner.py` (`_process_with_retry`) handles transient failures; persistent AFTER 3 attempts → `FAILED`. |

See also: `docs/production_worker_api.md` (retry & recovery semantics, payloads).