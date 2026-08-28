# NAS GPU Worker (on-prem)

Automated production processing beside your NAS. Replaces Photoshop/Lightroom
batch work for the two core operations:

- **ENHANCE** — deterministic batch image enhancement (brightness, contrast,
  exposure, sharpness, saturation, denoise) applied identically to every frame.
- **MASK** — car-roof / black-mask removal via **generative-fill (LaMa)** when
  `simple-lama-inpainting` is installed (CUDA), otherwise preview-grade
  OpenCV TELEA inpaint so the pipeline still runs end-to-end.

The dashboard (`Image Production Workspace`) is the control plane. This worker
executes batches, reads from NAS source folders, writes to user-set NAS output
folders, and never modifies the source/RAW files.

## Setup (GPU box, beside the NAS)

```powershell
cd worker
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# production generative-fill (CUDA):
pip install simple-lama-inpainting
# model weights in advance:
py scripts\download_models.py
```

Configure `worker\.env` from `.env.example`, then:

```powershell
uvicorn app:app --host 0.0.0.0 --port 8000
```

Point the dashboard's **Providers** panel at `http://<worker-host>:8000`
(Worker URL, mode `http`). NAS folders entered in the dashboard are resolved
relative to `NAS_BASE_PATH`.

## Dashboard → Worker path resolution

| Dashboard input           | Worker resolves to                          |
| ------------------------- | ------------------------------------------- |
| `source_folder`         | `<NAS_BASE_PATH>/<source_folder>`           |
| `output_folder`         | `<NAS_BASE_PATH>/<output_folder>` (created if missing) |

## Status sync

- Worker memory is the authoritative runtime state (`GET /api/jobs/{id}`).
- If `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set, the worker PATCHes
  `processing_jobs` directly so the dashboard table refreshes live. Otherwise
  the dashboard falls back to HTTP polling of the worker.

## First production run (recommended before full survey)

Run a `<=50` frame validation batch against one real NAS folder pair to confirm
quality/timing on your GPU before scaling. The dashboard marks any frame the fill
cannot cleanly handle as `REVIEW_REQUIRED` for manual retouch.

## Safety

- Source/RAW files are never written to.
- Output lands only in the user-set output folder.
- Folder paths cannot escape `NAS_BASE_PATH` (traversal-guarded).

## Preview note

The dashboard preview technically loads images from the configured
`nasServerUrl`. For browsers to read NAS images directly the NAS must send
`Access-Control-Allow-Origin` (or `*`) on image GETs. If your NAS can't do
that, set the dashboard previews to go through this worker's
`GET /api/images/{path}` passthrough (set the dashboard's `nasServerUrl` to
`http://<worker-host>:8000/api/images` and prefix folders accordingly).