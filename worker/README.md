# NAS Worker (on-prem)

Exposes the local NAS survey tree to the GeoSphere 360 dashboard. It runs on the
survey workstation beside the NAS and serves the filesystem over a Cloudflare
Tunnel.

This service does **not** process images. Panorama QA/QC — sharpness, privacy
blur, obstruction and glare detection — runs entirely in the browser on a
WebGL/CPU path (`src/utils/gpuAnalyzer.ts`, `src/workers/qaqc.worker.ts`).
There is no server-side batch pipeline, no GPU job queue and no job journal.

## Setup

```powershell
cd worker
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

`requirements.txt` is FastAPI + uvicorn + python-dotenv only; `nas_scan.py` is
standard library, so there is no OpenCV/numpy/torch install on the workstation.

Configure `worker\.env` from `.env.example`, then:

```powershell
uvicorn app:app --host 0.0.0.0 --port 8000
```

Point the dashboard's **Providers** panel at `http://<worker-host>:8000`
(Worker URL, mode `http`). NAS folders entered in the dashboard are resolved
relative to `NAS_BASE_PATH`.

## Endpoints

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Liveness and the configured NAS mount. Unauthenticated. |
| `GET` | `/api/folders` | Folder enumeration with per-folder image counts |
| `GET` | `/api/storage` | Volume usage and per-top-level folder breakdown (cached by `STORAGE_CACHE_TTL`) |
| `GET` | `/api/nas-scan` | Survey scans; `action` is one of `subgrids`, `survey-folders`, `read-csv`, `folder-images`, `final-images`, `registry` |
| `GET` | `/api/images/{path}` | Panorama preview bytes with `ETag`/`Last-Modified` and `304` revalidation |

Every route except `/health` requires `Authorization: Bearer $NAS_WORKER_TOKEN`
when `NAS_WORKER_TOKEN` is set.

## Path safety

Folder paths are resolved with `resolve_fs()` and traversal-guarded: a path that
escapes `NAS_BASE_PATH` is rejected with `400` before any filesystem access.
`/api/images/{path}` is guarded by the same function.

## Dashboard → Worker path resolution

| Dashboard input           | Worker resolves to                          |
| ------------------------- | ------------------------------------------- |
| folder path in the UI   | `<NAS_BASE_PATH>/<path>`                    |

## Tests

```powershell
cd worker
$env:PYTHONPATH='.'
python -m pytest tests -q
```

`tests/test_image_cache.py` covers the conditional-GET/`304` behaviour the
Cloudflare Pages image proxy depends on; `tests/test_nas_scan.py` covers the scan
actions. CI runs both plus `python -m py_compile` over `app.py` and `nas_scan.py`.

> `python-dotenv` must be installed for the HTTP tests to run — without it the
> module-level import of `app.py` fails and the suite skips rather than errors.

## Preview note

The dashboard preview technically loads images from the configured
`nasServerUrl`. For browsers to read NAS images directly the NAS must send
`Access-Control-Allow-Origin` (or `*`) on image GETs. If your NAS can't do
that, set the dashboard previews to go through this worker's
`GET /api/images/{path}` passthrough (set the dashboard's `nasServerUrl` to
`http://<worker-host>:8000/api/images` and prefix folders accordingly).