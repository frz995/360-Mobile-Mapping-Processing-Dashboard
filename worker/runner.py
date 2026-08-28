"""Concurrency-limited batch runner with progress + cancellation.
Authoritative status lives here (in-memory); optionally synced to Supabase
processing_jobs so the dashboard shows live status either way.
"""
from __future__ import annotations

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING

import cv2

from enhancement import apply_enhancement
from masking import apply_mask_pipeline

if TYPE_CHECKING:
    import sync as syncmod

LOGGER = logging.getLogger("nas-worker.runner")

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def _list_source(source_dir: str, subgrid: str | None, total_hint: int) -> list[str]:
    files = [
        os.path.join(source_dir, f)
        for f in sorted(os.listdir(source_dir))
        if os.path.splitext(f)[1].lower() in IMAGE_EXTS
    ]
    if subgrid:
        prefix = subgrid.upper().replace("-", "")
        files = [f for f in files if os.path.basename(f).upper().replace("-", "").startswith(prefix)]
    if total_hint and len(files) < total_hint:
        LOGGER.warning("Source folder has %s frames vs %s expected.", len(files), total_hint)
    return files


class JobRegistry:
    """In-memory job store + worker pool."""

    def __init__(self, concurrency: int = 1) -> None:
        self.concurrency = max(1, concurrency)
        self.jobs: dict[str, dict] = {}
        self._lock = threading.Lock()

    @property
    def active(self) -> dict[str, dict]:
        with self._lock:
            return {k: v for k, v in self.jobs.items() if v["status"] in ("QUEUED", "IN_PROGRESS")}

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            return self.jobs.get(job_id)

    def update(self, job_id: str, **fields) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            job.update(fields)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job or job["status"] not in ("QUEUED", "IN_PROGRESS"):
                return False
            job["cancel"].set()
            job["status"] = "CANCELLED"
            return True

    def start(
        self,
        job_id: str,
        job_type: str,
        source_dir: str,
        output_dir: str,
        source_rel: str,
        output_rel: str,
        subgrid: str | None,
        total_items: int,
        settings: dict,
        syncer: "Optional[syncmod.SupabaseSyncer]",
    ) -> None:
        with self._lock:
            self.jobs[job_id] = {
                "job_id": job_id,
                "job_type": job_type,
                "source_dir": source_dir,
                "output_dir": output_dir,
                "source_rel": source_rel,
                "output_rel": output_rel,
                "subgrid": subgrid,
                "total_items": total_items,
                "settings": settings,
                "status": "QUEUED",
                "progress": 0,
                "completed_items": 0,
                "current_item": "",
                "error_count": 0,
                "message": "queued",
                "cancel": threading.Event(),
                "syncer": syncer,
            }
        thread = threading.Thread(target=self._worker, args=(job_id,), daemon=True)
        thread.start()

    def _worker(self, job_id: str) -> None:
        job = self.get(job_id)
        if not job:
            return
        job_type, source_dir, output_dir = job["job_type"], job["source_dir"], job["output_dir"]
        settings = job["settings"]
        syncer = job.get("syncer")
        os.makedirs(output_dir, exist_ok=True)

        push = lambda **kw: (self.update(job_id, **kw), syncer and syncer.push(job_id, kw))

        try:
            files = _list_source(source_dir, job.get("subgrid"), job.get("total_items") or 0)
            total = job["total_items"] or len(files)
            push(status="IN_PROGRESS", total_items=total, progress=1, message="processing", started_at=_now())
        except OSError as exc:
            push(status="FAILED", message=str(exc))
            return

        completed, errors = 0, 0
        with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
            futures = {pool.submit(self._process_one, job_id, f, output_dir, job_type, settings): f for f in files}
            try:
                for fut in as_completed(futures, timeout=3600 * 8):
                    if job["cancel"].is_set():
                        pool.shutdown(wait=False, cancel_futures=True)
                        push(status="CANCELLED", message="cancelled by operator")
                        return
                    ok, name = fut.result()
                    if ok:
                        completed += 1
                    else:
                        errors += 1
                    progress = int((completed / total) * 100) if total else 100
                    push(
                        status="IN_PROGRESS",
                        progress=min(100, progress),
                        completed_items=completed,
                        current_item=name,
                        error_count=errors,
                    )
            except Exception as exc:  # noqa: BLE001
                LOGGER.exception("batch worker failed")
                push(status="FAILED", message=str(exc))
                return

        if errors > 0 and completed > 0:
            push(status="REVIEW_REQUIRED", progress=100, completed_items=completed,
                 message=f"{completed} ok, {errors} frames need manual retouch", completed_at=_now())
        elif errors > 0:
            push(status="FAILED", message=f"{errors} frames failed", completed_at=_now())
        else:
            push(status="COMPLETED", progress=100, completed_items=completed,
                 message="batch complete — clean panoramas in output folder", completed_at=_now())

    @staticmethod
    def _process_one(job_id: str, src_path: str, output_dir: str, job_type: str, settings: dict) -> tuple[bool, str]:
        name = os.path.basename(src_path)
        try:
            img = cv2.imread(src_path, cv2.IMREAD_COLOR)
            if img is None:
                return False, name
            if job_type == "MASK" or "mask" in settings or (job_type == "ENHANCE" and settings.get("mask")):
                img = apply_mask_pipeline(img, settings)
            if job_type == "ENHANCE" or settings.get("enhance"):
                img = apply_enhancement(img, settings.get("enhance") or {})
            ext = os.path.splitext(name)[1].lower()
            if ext not in IMAGE_EXTS:
                ext = ".jpg"
            quality = int(settings.get("jpegQuality", 92))
            ok = cv2.imwrite(os.path.join(output_dir, name), img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
            return bool(ok), name
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("frame failed %s: %s", name, exc)
            return False, name


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()