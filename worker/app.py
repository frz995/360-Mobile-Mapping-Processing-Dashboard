# NAS Worker — on-prem NAS survey filesystem + preview service.
#
# This service exposes the NAS tree to the dashboard: folder listings, storage
# capacity, survey/CSV/image scans, and conditional-GET panorama previews.
# Image analysis (QA/QC sharpness, blur, obstruction) runs in the browser via
# WebGL — see src/utils/gpuAnalyzer.ts. There is no server-side batch image
# pipeline and no GPU job queue here.
from __future__ import annotations

import os
import platform
import shutil
import threading
import time
import logging
import hashlib
import mimetypes
from email.utils import formatdate, parsedate_to_datetime
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from nas_scan import scan_nas

from dotenv import load_dotenv
load_dotenv()

if os.environ.get("NAS_LOG_JSON") == "1":
    import json as _json

    class _JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload = {
                "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
                "level": record.levelname,
                "logger": record.name,
                "msg": record.getMessage(),
            }
            if record.exc_info:
                payload["exc"] = self.formatException(record.exc_info)
            return _json.dumps(payload)

    _handler = logging.StreamHandler()
    _handler.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [_handler]
    root.setLevel(logging.INFO)
else:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

NAS_BASE_PATH = os.environ.get("NAS_BASE_PATH", "/nas/360_images").rstrip("/\\")
API_TOKEN = os.environ.get("NAS_WORKER_TOKEN", "")  # optional shared secret

# Stable worker identifier surfaced to the dashboard (hostname-based).
_WORKER_ID = os.environ.get("NAS_WORKER_ID") or platform.node() or "nas-worker"


# The interactive schema UIs are disabled deliberately. This service is reached
# through a Cloudflare Tunnel, and the documented contract is that /health is the
# ONLY unauthenticated route (see worker/README.md) — FastAPI's defaults would
# quietly publish the full route table, including filesystem parameters, to
# anyone who can reach the port.
app = FastAPI(
    title="GeoSphere 360 NAS Worker",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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


def _is_not_modified(request: Request, etag: str, last_modified: str) -> bool:
    """RFC 9110 conditional-request evaluation for GET.

    FileResponse emits an ETag but never compares it, so a revalidating browser
    re-downloaded every panorama. If-None-Match takes precedence over
    If-Modified-Since, and a Range request must still be handled normally.
    """
    if "range" in {k.lower() for k in request.headers}:
        return False
    inm = request.headers.get("if-none-match")
    if inm:
        candidates = {tag.strip() for tag in inm.split(",")}
        return "*" in candidates or etag in candidates
    ims = request.headers.get("if-modified-since")
    if not ims:
        return False
    try:
        since = parsedate_to_datetime(ims)
    except (TypeError, ValueError):
        return False
    if since is None:
        return False
    modified = parsedate_to_datetime(last_modified)
    return modified.tzinfo is not None and since.tzinfo is not None and modified <= since


@app.get("/api/folders")
def list_folders(authorization: Optional[str] = Header(default=None), path: str = "") -> dict:
    _guard(authorization)
    fs = resolve_fs(path)
    if not os.path.isdir(fs):
        raise HTTPException(status_code=404, detail="Not a directory.")
    entries, file_count, size_bytes = [], 0, 0

    def _is_image(name: str) -> bool:
        return os.path.splitext(name)[1].lower() in {".jpg", ".jpeg", ".png"}

    try:
        for name in sorted(os.listdir(fs)):
            full = os.path.join(fs, name)
            if os.path.isdir(full):
                try:
                    n_children = sum(
                        sum(1 for f in files if _is_image(f))
                        for _, _, files in os.walk(full)
                    )
                    entries.append({"name": name, "path": f"{path}/{name}".strip("/"), "isDirectory": True, "fileCount": n_children, "sizeBytes": 0})
                except OSError:
                    entries.append({"name": name, "path": f"{path}/{name}".strip("/"), "isDirectory": True, "fileCount": 0, "sizeBytes": 0})
            elif _is_image(name):
                size = os.path.getsize(full)
                file_count += 1
                size_bytes += size
                entries.append({"name": name, "path": f"{path}/{name}".strip("/"), "isDirectory": False, "fileCount": 1, "sizeBytes": size})
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"path": path, "entries": entries[:1000], "fileCount": file_count, "sizeBytes": size_bytes}


@app.get("/api/nas-scan")
def nas_scan_endpoint(
    authorization: Optional[str] = Header(default=None),
    action: str = "subgrids",
    subgrid: str = "",
    folder: str = "",
    csv: str = "",
) -> dict:
    """Production NAS implementation of the dashboard's survey scan API.

    Always reads NAS_BASE_PATH from the on-prem worker configuration. There is
    no development path, fixture root or fallback root in this code path.
    """
    _guard(authorization)
    try:
        return scan_nas(NAS_BASE_PATH, action, subgrid, folder, csv)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"NAS scan failed: {exc}")


@app.get("/api/images/{rel_path:path}")
def serve_image(rel_path: str, request: Request, authorization: Optional[str] = Header(default=None)) -> Response:
    _guard(authorization)
    fs = resolve_fs(rel_path)
    if not os.path.isfile(fs):
        raise HTTPException(status_code=404, detail="Image not found.")
    stat = os.stat(fs)
    etag = f'"{hashlib.md5(f"{stat.st_mtime}-{stat.st_size}".encode()).hexdigest()}"'
    last_modified = formatdate(stat.st_mtime, usegmt=True)
    validators = {"ETag": etag, "Last-Modified": last_modified}

    if _is_not_modified(request, etag, last_modified):
        return Response(status_code=304, headers=validators)

    return FileResponse(
        fs,
        media_type=mimetypes.guess_type(fs)[0] or "application/octet-stream",
        headers=validators,
    )


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
def storage_info(authorization: Optional[str] = Header(default=None)) -> dict:
    _guard(authorization)
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
    return {
        "status": "ok",
        "nas_base": NAS_BASE_PATH,
        "worker": _WORKER_ID,
    }
