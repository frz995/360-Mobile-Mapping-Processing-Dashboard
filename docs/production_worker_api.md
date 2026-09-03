# Production Worker API Contract

Shared contract between the dashboard's `src/services/productionApi.ts`
(client; `mock` | `http` modes) and the on-prem NAS GPU Worker (`worker/app.py`).

All endpoints are JSON. Non-mocked responses follow the shapes below. The mock
client returns the same shapes so the dashboard behaviour is identical in both
modes.

## Base URL

Configured via dashboard Project Settings → **Providers** → Worker URL
(`productionApiUrl`) or `VITE_PRODUCTION_API_URL`. Examples:
`http://192.168.1.110:8000`, `https://prod-worker.example.com`.

## Endpoints

### POST /api/jobs

Create + start a batch job.

Request:

```json
{
  "job_id": "uuid-here (optional; server generates if absent)",
  "job_type": "ENHANCE",              // ENHANCE | MASK | STITCH | BLUR | QAQC | REPORT | EXPORT | AI_DETECT
  "source_folder": "stitchblur/N93E70", // relative to NAS_BASE_PATH
  "output_folder": "cleaned/N93E70",    // relative to NAS_BASE_PATH (created if missing)
  "subgrid": "N93E70",
  "total_items": 500,
    "settings": {
      "apiMode": "http",
      "concurrency": 1,
      "enhance": { "brightness": 0, "contrast": 0, "exposure": 0, "sharpness": 0, "saturation": 0, "denoise": 0 },
      "mask": {
        "detectAutomatically": true,
        "bottomBandHeight": 0.18,
        "fillModel": "lama",
        "maskB64": "optional-client-annotated-mask"
      },
      "blur": {
        "detectFaces": true,
        "detectPlates": false,
        "blurStrength": 8,
        "boxMargin": 6,
        "fullFrameBlur": 0,
        "recurse": true
      },
      "exportFormat": "jpeg",
      "jpegQuality": 92
    }
}
```

Response 2xx:

```json
{ "ok": true, "message": "Job <id> accepted into the batch queue." }
```

### GET /api/jobs/{job_id}

Live status for one job.

Response:

```json
{
  "job_id": "uuid-here",
  "status": "QUEUED",          // QUEUED | IN_PROGRESS | COMPLETED | FAILED | REVIEW_REQUIRED | CANCELLED
  "progress": 42,              // 0..100
  "completed_items": 210,
  "total_items": 500,
  "current_item": "N93E70-00211.jpg",
  "error_count": 2,
  "message": "processing",
  "finished": false
}
```

### POST /api/jobs/{job_id}/cancel

Request cancellation of an active job.

```json
{ "ok": true, "message": "Cancellation requested." }
```

### GET /api/folders?path=<rel>

List a NAS directory (used by the dashboard's folder picker + preview + output
import). `path` is relative to `NAS_BASE_PATH`. Folders are recursive-counted
for children; files include individual sizes.

```json
{
  "path": "stitchblur/N93E70",
  "entries": [
    { "name": "N93E70-00001.jpg", "path": "stitchblur/N93E70/N93E70-00001.jpg", "isDirectory": false, "fileCount": 1, "sizeBytes": 1840000 },
    { "name": "sub", "path": "stitchblur/N93E70/sub", "isDirectory": true, "fileCount": 12, "sizeBytes": 0 }
  ],
  "fileCount": 500,
  "sizeBytes": 920000000
}
```

### GET /api/images/{rel_path}

Static passthrough of an image under `NAS_BASE_PATH` for preview when the NAS is
not otherwise web-served. `Content-Type: image/jpeg`.

### GET /api/storage

Capacity + recursive inventory of the NAS working base. Cached for
`STORAGE_CACHE_TTL` seconds (default 30).

```json
{
  "base_path": "/nas/360_images",
  "total": 8000000000000,
  "used": 402000000000,
  "free": 7598000000000,
  "files": 1740230,
  "folders": 4822,
  "per_top_level": [
    { "name": "RAW", "files": 1311200, "bytes": 328000000000, "folders": 2401 },
    { "name": "stitchblur", "files": 391410, "bytes": 61000000000, "folders": 1130 }
  ],
  "source": "worker"
}
```

### GET /health

```json
{ "status": "ok", "jobs_active": 1, "nas_base": "/nas/360_images" }
```

## Execution scope

`ENHANCE`, `MASK` and `BLUR` execute on this worker:
- **ENHANCE** — deterministic enhancement (brightness/contrast/etc.).
- **MASK** — LaMa generative-fill car-hood removal (OpenCV TELEA fallback).
- **BLUR** — privacy blur: OpenCV Haar face (+ optional plate) detection with
  Gaussian blur per detection, full-frame Gaussian fallback. `BLUR` jobs scan the
  source tree **recursively** (raw date/camera folders) and mirror the tree to the
  output folder — unlike ENHANCE/MASK which read flat files.

Submitting `STITCH` / `QAQC` / `REPORT` / `EXPORT` returns a "tracked dashboard-side"
acknowledgement — such jobs are orchestrated by the Processing Center's external-PC
handoff workflow (operator assignment → submit → validate output folder → import as
dataset). `AI_DETECT` is reserved and not implemented on the worker yet.

## Status lifecycle (dashboard mirror)

```
PENDING → QUEUED → IN_PROGRESS → COMPLETED → (Import) → IMPORTED → QA_PENDING → APPROVED / REJECTED
                                  └── FAILED ──┐
                                  └── REVIEW_REQUIRED (auto-flag for manual retouch)
CANCELLED ← operator cancel
```

`COMPLETED` also carries `output_dataset_id` after the dashboard registers the
processed output as a `datasets` row. Everything is metadata; the dashboard never
receives image bytes.

## Error handling

- Non-2xx → body `{ "detail": "human readable message" }` (FastAPI convention).
- Job-scoped failures surface as `status: FAILED` / `REVIEW_REQUIRED` with
  `error_count` and `message`, not as HTTP errors.
- Folder paths escaping `NAS_BASE_PATH` are rejected with HTTP 400.

## Retry & recovery (at-least-once)

Each frame is processed at-least-once. A frame that fails is retried up to
`retryLimit` times before it is recorded as failed (the default is 2 retries,
i.e. 3 total attempts; set `"retryLimit": N` in `settings` to override).

- **Transient failures** (e.g. read/write I/O hiccups) are retried automatically
  with a short per-attempt gap; if a retry succeeds the frame is marked complete.
- **Persistent failures** (unreadable/corrupt image, mask model error, write
  failure) return `FAILED` for that frame after the limit and are pushed into the
  job's `failed_items` list — this list is the **dead-letter queue (DLQ)** the
  dashboard surfaces under `error_count` / `error_log` for operator retouch.
- If the job had some successes and some permanent failures it ends as
  `REVIEW_REQUIRED` (auto-flag for manual retouch); if all frames permanently fail
  it ends as `FAILED`.
- **Restart recovery:** the worker can persist job state to a local SQLite journal
  (set `WORKER_JOB_DB`; see `worker/.env.example`). On restart, interrupted
  (`QUEUED`/`IN_PROGRESS`) jobs are surfaced as `FAILED` with a recoverable message,
  never silently dropped. Re-submitting the same `job_id` resumes idempotently:
  frames whose output already exists under the same settings hash are skipped
  (see `retryPolicy`/`settings_hash` notes in `worker/runner.py`).

## Auth (optional)

Set `NAS_WORKER_TOKEN` on the worker and send `Authorization: Bearer <token>`
on `POST`/`GET` requests. Status PATCH to Supabase uses the service-role key
server-side only.