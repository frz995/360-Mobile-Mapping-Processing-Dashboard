# Production Smoke Checklist

Run this sequence on every release/bring-up of the pipeline to confirm no
regressions across **auth → BFF → worker → durable store**. It mirrors the
Wave 1/Wave 2 production-readiness work (RLS, BFF, durable journal, retry,
idempotent resume).

> Requires the BFF on `http://<bff>` and a valid Supabase JWT
> (`$TOKEN`). Worker routes that carry `authorization: Bearer $TOKEN`.

---

## 1. Build & static gates
```bash
npx tsc -b
npm run build
npm run test
npm run lint          # CI now treats this as a blocking gate
```
Expected: all green.

## 2. Worker / BFF health
```bash
curl -s http://<bff>/health
curl -s http://<bff>/metrics | grep -E "nas_jobs_(active|failed)|nas_worker_(info|uptime)"
```
Expected: `status: ok`, metrics lines present.

## 3. Unauth attempt is rejected (auth boundary)
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://<bff>/api/jobs  # no token
curl -s -o /dev/null -w "%{http_code}\n" http://<bff>/api/storage       # no token
```
Expected: `401` (not `200`). Confirms the BFF is the auth front door.

## 4. Submit + poll a job through the BFF
```bash
curl -s -X POST http://<bff>/api/jobs \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"job_type":"ENHANCE","source_folder":"smoke_src","output_folder":"smoke_dst"}'
curl -s http://<bff>/api/jobs/<job_id> -H "authorization: Bearer $TOKEN"
```
Expected: `ok:true` then 200 with a valid status/progress.
Then cancel it: `POST /api/jobs/<job_id>/cancel` → `ok:true`.

## 5. Restart-recovery (durable store)
1. Submit a long job (or slow frames).
2. Restart the worker process mid-run.
3. `GET /api/jobs/<job_id>` → status surfaces `FAILED` / `Worker restarted - job interrupted`
   (interrupted QUEUED/IN_PROGRESS job), or `COMPLETED` if it finished first.
Expected: no job silently dropped; re-submission is **idempotent** (skips
already-written outputs, `completed` starts ≥ previously-written count).

## 6. Retry test (at-least-once)
Cause a transient frame failure twice, then succeed on the 3rd.
Expected: job completes (`COMPLETED`) and the worker `error_count` reflects the
2 failures; a persistent failure after 3 attempts → `FAILED` with server logged
retries.

## 7. RLS / authorization surface (SQL Editor or psql)
Run `0011_security_tests.sql`. Expected: no RLS-violation failures (fails
loudly if a role can do something it must not). Where possible, verify as the
`authenticated` role (Supabase SQL Editor runs as `postgres`, which bypasses
RLS — use a scratch project / psql for a true boundary check).

## 8. Final regression sweep
- Confirm all job types (`ENHANCE`, `MASK`, `BLUR`, `AI_DETECT`, `QAQC`) still
  submit/report.
- Confirm `/api/folders`, `/api/storage`, `/api/images/...` still respond 200.
- Confirm the dashboard still loads and lists jobs/storage from the BFF.