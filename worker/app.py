# NAS GPU Worker — on-prem production processing service
from __future__ import annotations

import os
import platform
import shutil
import threading
import time
import uuid
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from enhancement import apply_enhancement
from masking import apply_mask_pipeline, derive_mask
from runner import JobRegistry
import sync as syncmod

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("nas-worker")

NAS_BASE_PATH = os.environ.get("NAS_BASE_PATH", "/nas/360_images").rstrip("/\\")
API_TOKEN = os.environ.get("NAS_WORKER_TOKEN", "")  # optional shared secret

# Stable worker identifier surfaced to the dashboard (hostname-based).
_WORKER_ID = os.environ.get("NAS_WORKER_ID") or platform.node() or "nas-gpu-worker"


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


app = FastAPI(title="GeoSphere 360 NAS GPU Worker", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

registry: Optional[JobRegistry] = None
syncer: Optional[syncmod.SupabaseSyncer] = None


@app.on_event("startup")
def _startup() -> None:
    global registry, syncer
    registry = JobRegistry(concurrency=int(os.environ.get("CONCURRENCY", "1")))
    syncer = syncmod.SupabaseSyncer.from_env()
    if syncer is None:
        logger.warning("Supabase sync disabled (SUPABASE_URL / service role missing). Dashboard will poll HTTP.")


class JobSubmit(BaseModel):
    job_id: Optional[str] = None
    job_type: str = "ENHANCE"  # ENHANCE | MASK | STITCH | BLUR | QAQC | REPORT | EXPORT | AI_DETECT (only ENHANCE/MASK/AI_DETECT processed here)
    source_folder: str
    output_folder: str
    subgrid: Optional[str] = None
    total_items: Optional[int] = 0
    settings: dict = {}


# ---------------------------------------------------------------------------
# Path safety: all folders resolve under NAS_BASE_PATH and never escape it.
# ---------------------------------------------------------------------------
def resolve_fs(rel_path: str) -> str:
    rel = (rel_path or "").replace("\\", "/").lstrip("/")
    candidate = os.path.abspath(os.path.join(NAS_BASE_PATH, rel))
    if not candidate.startswith(os.path.abspath(NAS_BASE_PATH) + os.sep) and candidate != os.path.abspath(NAS_BASE_PATH):
        raise HTTPException(status_code=400, detail="Folder path escapes the NAS working base.")
    return candidate


def _guard(auth: Optional[str]) -> None:
    if API_TOKEN and auth != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized.")


@app.post("/api/jobs")
def submit_job(body: JobSubmit, authorization: Optional[str] = None) -> dict:
    _guard(authorization)
    if registry is None:
        raise HTTPException(status_code=503, detail="Worker still initialising.")
    if body.job_type not in ("ENHANCE", "MASK", "AI_DETECT", "QAQC"):
        # Externally-processed job types are tracked via the dashboard only.
        return {"ok": True, "message": f"Job type {body.job_type} is not executed by this worker; tracked dashboard-side."}

    src = resolve_fs(body.source_folder)
    dst = resolve_fs(body.output_folder)
    os.makedirs(dst, exist_ok=True)

    job_id = body.job_id or str(uuid.uuid4())
    registry.start(
        job_id=job_id,
        job_type=body.job_type,
        source_dir=src,
        output_dir=dst,
        source_rel=body.source_folder,
        output_rel=body.output_folder,
        subgrid=body.subgrid,
        total_items=body.total_items or 0,
        settings=body.settings or {},
        syncer=syncer,
    )
    return {"ok": True, "message": f"Job {job_id} accepted into the batch queue."}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    if registry is None:
        raise HTTPException(status_code=503, detail="Worker still initialising.")
    job = registry.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job id.")
    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job["progress"],
        "completed_items": job["completed_items"],
        "total_items": job["total_items"],
        "current_item": job["current_item"],
        "error_count": job["error_count"],
        "failed_items": job.get("failed_items") or [],
        "error_log": job.get("error_log") or [],
        "last_heartbeat": job.get("last_heartbeat") or _now(),
        "worker": _WORKER_ID,
        "message": job["message"],
        "finished": job["status"] in ("COMPLETED", "FAILED", "CANCELLED", "REVIEW_REQUIRED"),
    }


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    _guard(None)  # cancel requires no auth? keep parity with submit; token optional
    if registry is None:
        raise HTTPException(status_code=503, detail="Worker still initialising.")
    registry.cancel(job_id)
    return {"ok": True, "message": "Cancellation requested."}


@app.get("/api/folders")
def list_folders(path: str = "") -> dict:
    fs = resolve_fs(path)
    if not os.path.isdir(fs):
        raise HTTPException(status_code=404, detail="Not a directory.")
    entries, file_count, size_bytes = [], 0, 0
    try:
        for name in sorted(os.listdir(fs)):
            full = os.path.join(fs, name)
            if os.path.isdir(full):
                try:
                    n_children = sum(len(fs_) for _, _, fs_ in os.walk(full))
                    entries.append({"name": name, "path": f"{path}/{name}".strip("/"), "isDirectory": True, "fileCount": n_children, "sizeBytes": 0})
                except OSError:
                    entries.append({"name": name, "path": f"{path}/{name}".strip("/"), "isDirectory": True, "fileCount": 0, "sizeBytes": 0})
            else:
                size = os.path.getsize(full)
                file_count += 1
                size_bytes += size
                entries.append({"name": name, "path": f"{path}/{name}".strip("/"), "isDirectory": False, "fileCount": 1, "sizeBytes": size})
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"path": path, "entries": entries[:1000], "fileCount": file_count, "sizeBytes": size_bytes}


@app.get("/api/images/{rel_path:path}")
def serve_image(rel_path: str) -> FileResponse:
    fs = resolve_fs(rel_path)
    if not os.path.isfile(fs):
        raise HTTPException(status_code=404, detail="Image not found.")
    return FileResponse(fs, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Storage / capacity — cached recursive walk of the NAS working base.
# ---------------------------------------------------------------------------
STORAGE_TTL_SECONDS = float(os.environ.get("STORAGE_CACHE_TTL", "30"))
_storage_cache: dict = {"at": 0.0, "data": None}
_storage_lock = threading.Lock()


def _scan_top_level(base: str) -> list[dict]:
    """One entry per immediate child dir: recursive file/folder counts + bytes."""
    out: list[dict] = []
    try:
        with os.scandir(base) as it:
            for entry in it:
                if not entry.is_dir():
                    continue
                n_files = 0
                n_bytes = 0
                n_folders = 0
                for root, dirs, files in os.walk(entry.path):
                    n_folders += len(dirs)
                    n_files += len(files)
                    n_bytes += sum(
                        os.path.getsize(os.path.join(root, f))
                        for f in files
                    )
                out.append({"name": entry.name, "files": n_files, "bytes": n_bytes, "folders": n_folders})
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return sorted(out, key=lambda x: x["name"])


@app.get("/api/storage")
def storage_info() -> dict:
    now = time.time()
    if _storage_cache["data"] is not None and now - _storage_cache["at"] < STORAGE_TTL_SECONDS:
        return _storage_cache["data"]
    fs = resolve_fs("")
    du = shutil.disk_usage(fs)
    per = _scan_top_level(fs)
    data = {
        "base_path": NAS_BASE_PATH,
        "total": du.total,
        "used": du.used,
        "free": du.free,
        "files": sum(x["files"] for x in per),
        "folders": sum(x["folders"] for x in per),
        "per_top_level": per,
        "source": "worker",
    }
    with _storage_lock:
        _storage_cache["at"] = now
        _storage_cache["data"] = data
    return data


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "jobs_active": len(registry.active) if registry else 0, "nas_base": NAS_BASE_PATH}