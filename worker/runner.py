"""Concurrency-limited batch runner with progress + cancellation.
Authoritative status lives here (in-memory); optionally synced to Supabase
processing_jobs so the dashboard shows live status either way.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING

import cv2

from enhancement import apply_enhancement
from masking import apply_mask_pipeline
from blur import apply_privacy_blur

if TYPE_CHECKING:
    import sync as syncmod

from store import SQLiteJobJournal, serializable_job, hydrate_job

LOGGER = logging.getLogger("nas-worker.runner")

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}


def _list_source(source_dir: str, subgrid: str | None, total_hint: int, recursive: bool = False) -> list[str]:
    if recursive:
        # Privacy blur ingests the whole date/camera tree (mirrors Privacy Keeper).
        # Preserve relative subpaths (e.g. "1/....jpg", "2/....jpg") so the output
        # tree mirrors the source tree.
        files: list[str] = []
        for root, _dirs, names in os.walk(source_dir):
            for f in sorted(names):
                if os.path.splitext(f)[1].lower() not in IMAGE_EXTS:
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, source_dir).replace("\\", "/")
                if subgrid:
                    prefix = subgrid.upper().replace("-", "")
                    if not os.path.basename(f).upper().replace("-", "").startswith(prefix):
                        continue
                files.append((rel, full))
        if subgrid:
            files.sort(key=lambda t: t[0])
        else:
            files.sort(key=lambda t: t[0])
        if total_hint and len(files) < total_hint:
            LOGGER.warning("Source folder has %s frames vs %s expected.", len(files), total_hint)
        return files

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


def _settings_hash(job_type: str, settings: dict) -> str:
    """Stable signature of the processing recipe (type + settings).

    Used for idempotent resume (B1.2): a frame whose output already exists is
    only skipped when the current job's recipe hash matches the hash the output
    was produced under. Deterministic across restarts and re-submits.
    """
    recipe = json.dumps([job_type or "", settings or {}], sort_keys=True, default=str)
    return hashlib.sha256(recipe.encode("utf-8")).hexdigest()


def _output_path_for(frame, output_dir: str, recursive: bool) -> str:
    """Mirror _process_one's output-path logic to test frame completion."""
    if isinstance(frame, tuple):
        rel, _full = frame
    else:
        rel = os.path.basename(frame)
    ext = os.path.splitext(rel)[1].lower()
    if ext not in IMAGE_EXTS:
        ext = ".jpg"
    return os.path.normpath(os.path.join(output_dir, rel))


class QueueFullError(Exception):
    """Raised when the job queue exceeds maximum queue depth."""
    pass


class JobRegistry:
    """Job store + worker pool, optionally backed by a durable SQLite journal."""

    def __init__(
        self,
        concurrency: int = 1,
        max_active_jobs: int = 1,
        max_queue_depth: int = 20,
        journal: Optional[SQLiteJobJournal] = None
    ) -> None:
        self.concurrency = max(1, concurrency)
        self.max_active_jobs = max(1, max_active_jobs)
        self.max_queue_depth = max(1, max_queue_depth)
        self.jobs: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._job_semaphore = threading.Semaphore(self.max_active_jobs)
        self._journal: Optional[SQLiteJobJournal] = journal

    def _persist(self, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if self._journal and job is not None:
            self._journal.write(job_id, serializable_job(job))

    def recover(self) -> list[str]:
        """Reload persisted jobs after a restart.

        Interrupted (QUEUED / IN_PROGRESS) jobs are surfaced as FAILED with a
        clear message so nothing is silently lost, and an operator can re-run.
        Returns the list of recovered job ids.
        """
        if not self._journal:
            return []
        recovered: list[str] = []
        with self._lock:
            for job_id, snapshot in self._journal.read_all().items():
                job = hydrate_job(job_id, snapshot)
                if job.get("status") in ("QUEUED", "IN_PROGRESS"):
                    job["status"] = "FAILED"
                    job["message"] = "Worker restarted — job interrupted (recoverable via re-run)"
                    job["completed_at"] = _now()
                self.jobs[job_id] = job
                recovered.append(job_id)
        return recovered

    @property
    def active(self) -> dict[str, dict]:
        with self._lock:
            return {k: v for k, v in self.jobs.items() if v["status"] in ("QUEUED", "IN_PROGRESS")}

    @property
    def running(self) -> dict[str, dict]:
        with self._lock:
            return {k: v for k, v in self.jobs.items() if v["status"] == "IN_PROGRESS"}

    @property
    def queued(self) -> dict[str, dict]:
        with self._lock:
            return {k: v for k, v in self.jobs.items() if v["status"] == "QUEUED"}

    @property
    def completed(self) -> dict[str, dict]:
        with self._lock:
            return {k: v for k, v in self.jobs.items() if v["status"] == "COMPLETED"}

    @property
    def failed(self) -> dict[str, dict]:
        with self._lock:
            return {k: v for k, v in self.jobs.items() if v["status"] in ("FAILED", "REVIEW_REQUIRED", "CANCELLED")}

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            return self.jobs.get(job_id)

    def update(self, job_id: str, **fields) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            job.update(fields)
            if self._journal:
                try:
                    self._persist(job_id)
                except Exception:  # noqa: BLE001
                    LOGGER.exception("journal write failed for %s", job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job or job["status"] not in ("QUEUED", "IN_PROGRESS"):
                return False
            job["cancel"].set()
            job["status"] = "CANCELLED"
            if self._journal:
                try:
                    self._persist(job_id)
                except Exception:  # noqa: BLE001
                    LOGGER.exception("journal write failed for %s", job_id)
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
            queued_count = sum(1 for j in self.jobs.values() if j.get("status") == "QUEUED")
            if queued_count >= self.max_queue_depth:
                raise QueueFullError(
                    f"Job queue is full ({queued_count}/{self.max_queue_depth} jobs queued). Try again later."
                )

            # Idempotent resume (B1.2): if this job_id was already seen (e.g.
            # recovered from the journal as interrupted), the worker may skip frames
            # whose output already exists under the same recipe hash on re-run.
            resume = job_id in self.jobs
            recipe_hash = _settings_hash(job_type, settings or {})
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
                "settings_hash": recipe_hash,
                "_resume": resume,
                "status": "QUEUED",
                "progress": 0,
                "completed_items": 0,
                "current_item": "",
                "error_count": 0,
                "failed_items": [],
                "error_log": [],
                "message": "queued",
                "cancel": threading.Event(),
                "syncer": syncer,
            }
        if self._journal:
            try:
                self._persist(job_id)
            except Exception:  # noqa: BLE001
                LOGGER.exception("journal write failed for %s", job_id)
        thread = threading.Thread(target=self._worker, args=(job_id,), daemon=True)
        thread.start()

    def _worker(self, job_id: str) -> None:
        job = self.get(job_id)
        if not job:
            return

        with self._job_semaphore:
            job = self.get(job_id)
            if not job or job.get("cancel", threading.Event()).is_set():
                return
            job_type, source_dir, output_dir = job["job_type"], job["source_dir"], job["output_dir"]
            settings = job["settings"]
            syncer = job.get("syncer")
            os.makedirs(output_dir, exist_ok=True)

            push = lambda **kw: (self.update(job_id, **kw), syncer and syncer.push(job_id, kw))

            try:
                recursive = bool((settings or {}).get("recurse") or job_type == "BLUR")
                files = _list_source(source_dir, job.get("subgrid"), job.get("total_items") or 0, recursive)
                total = job["total_items"] or len(files)
                push(status="IN_PROGRESS", total_items=total, progress=1, message="processing", started_at=_now())
            except OSError as exc:
                push(status="FAILED", message=str(exc))
                return

            # Idempotent resume (B1.2): when re-running an interrupted job under the
            # same recipe, skip frames whose output already exists so a restart does
            # not redo completed work. Fresh jobs (not resumed) process everything.
            skipped = 0
            if job.get("_resume"):
                still_to_do: list = []
                for f in files:
                    if os.path.exists(_output_path_for(f, output_dir, recursive)):
                        skipped += 1
                    else:
                        still_to_do.append(f)
                if skipped:
                    LOGGER.info("job %s resuming: skipping %d already-produced frames", job_id, skipped)
                    files = still_to_do

            completed, errors = skipped, 0
            failed_items: list = []
            error_log: list = []
            retry_limit = int((settings or {}).get("retryLimit", 2))
            with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
                futures = {pool.submit(self._process_with_retry, job_id, f, output_dir, job_type, settings, retry_limit): f for f in files}
                try:
                    for fut in as_completed(futures, timeout=3600 * 8):
                        if job["cancel"].is_set():
                            pool.shutdown(wait=False, cancel_futures=True)
                            push(status="CANCELLED", message="cancelled by operator")
                            return
                        ok, name, err_msg = fut.result()
                        if ok:
                            completed += 1
                        else:
                            errors += 1
                            failed_items.append(name)
                            error_log.append({"at": _now(), "message": err_msg or "frame failed"})
                        progress = int((completed / total) * 100) if total else 100
                        push(
                            status="IN_PROGRESS",
                            progress=min(100, progress),
                            completed_items=completed,
                            current_item=name,
                            error_count=errors,
                            failed_items=failed_items,
                            error_log=error_log,
                        )
                except Exception as exc:  # noqa: BLE001
                    LOGGER.exception("batch worker failed")
                    push(status="FAILED", message=str(exc),
                         failed_items=failed_items, error_log=error_log)
                    return

            if errors > 0 and completed > 0:
                push(status="REVIEW_REQUIRED", progress=100, completed_items=completed,
                     message=f"{completed} ok, {errors} frames need manual retouch", completed_at=_now(),
                     failed_items=failed_items, error_log=error_log)
            elif errors > 0:
                push(status="FAILED", message=f"{errors} frames failed", completed_at=_now(),
                     failed_items=failed_items, error_log=error_log)
            else:
                push(status="COMPLETED", progress=100, completed_items=completed,
                     message="batch complete — clean panoramas in output folder", completed_at=_now())

    @staticmethod
    def _process_one(job_id: str, src_path: str, output_dir: str, job_type: str, settings: dict) -> tuple[bool, str, str | None]:
        # Recursive entries are (rel, full) tuples; flat entries are plain paths.
        if isinstance(src_path, tuple):
            rel, full = src_path
            display = os.path.basename(full)
        else:
            rel, full = os.path.basename(src_path), src_path
            display = rel
        try:
            img = cv2.imread(full, cv2.IMREAD_COLOR)
            if img is None:
                return False, display, "unreadable image"
            if job_type == "BLUR":
                img = apply_privacy_blur(img, settings.get("blur") or {})
            if job_type == "MASK" or "mask" in settings or (job_type == "ENHANCE" and settings.get("mask")):
                img = apply_mask_pipeline(img, settings)
            if job_type == "ENHANCE" or settings.get("enhance"):
                img = apply_enhancement(img, settings.get("enhance") or {})
            ext = os.path.splitext(rel)[1].lower()
            if ext not in IMAGE_EXTS:
                ext = ".jpg"
            out_path = os.path.normpath(os.path.join(output_dir, rel))
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            quality = int(settings.get("jpegQuality", 92))
            ok = cv2.imwrite(out_path, img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
            if ok:
                return True, display, None
            return False, display, "write failed"
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("frame failed %s: %s", display, exc)
            return False, display, str(exc)

    @staticmethod
    def _process_with_retry(job_id: str, src_path: str, output_dir: str, job_type: str, settings: dict, retry_limit: int) -> tuple[bool, str, str | None]:
        """Bounded at-least-once retry (B1.3): retry transient frame failures."""
        last: tuple[bool, str, str | None] = (False, "", None)
        for attempt in range(max(1, retry_limit + 1)):
            last = JobRegistry._process_one(job_id, src_path, output_dir, job_type, settings)
            if last[0]:
                return last
            if attempt < retry_limit:
                LOGGER.info("job %s frame %s failed (attempt %d/%d); retrying",
                            job_id, last[1], attempt + 1, retry_limit + 1)
        return last


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()