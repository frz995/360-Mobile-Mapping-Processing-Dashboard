"""Durable job journal for the NAS worker (Stream B1).

The worker's job registry used to live only in memory, so a worker restart
silently lost every active job. ``SQLiteJobJournal`` persists a serializable
snapshot of each job on every change so the worker can recover state after a
crash/restart.

Design notes
------------
* Thread-safe: a single guarded connection + ``WAL`` mode. The runner holds
  its own lock when mutating jobs, so writes here are serialized and cheap.
* Stores only *serializable* fields (no ``threading.Event`` / syncer handles).
  Runtime handles are reconstructed by :meth:`JobRegistry.recover`.
* Additive + opt-in: if the worker is started with no journal path it behaves
  exactly as before (in-memory only). See ``app.py``.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from typing import Optional

LOGGER = logging.getLogger("nas-worker.store")

# Fields that carry runtime handles and must never be serialized.
_NON_SERIALIZABLE = {"cancel", "syncer", "thread"}


class SQLiteJobJournal:
    """Persist + reload job state snapshots in a local SQLite file."""

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = path or os.environ.get("WORKER_JOB_DB", "worker_jobs.sqlite3")
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS job_journal (
                job_id     TEXT PRIMARY KEY,
                payload    TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            )
            """
        )
        self._conn.commit()

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.Error:
                pass

    def write(self, job_id: str, data: dict) -> None:
        """Persist a job snapshot. ``data`` must be JSON-serializable."""
        payload = json.dumps(data, default=str)
        with self._lock:
            self._conn.execute(
                "INSERT INTO job_journal (job_id, payload, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) "
                "ON CONFLICT(job_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
                (job_id, payload),
            )
            self._conn.commit()

    def remove(self, job_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM job_journal WHERE job_id = ?", (job_id,))
            self._conn.commit()

    def read_all(self) -> dict[str, dict]:
        """Return ``{job_id: {...}}`` for every persisted job snapshot."""
        out: dict[str, dict] = {}
        with self._lock:
            rows = self._conn.execute("SELECT job_id, payload FROM job_journal").fetchall()
        for job_id, payload in rows:
            try:
                out[job_id] = json.loads(payload)
            except (ValueError, TypeError):
                LOGGER.warning("corrupt journal row for %s; skipping", job_id)
        return out


def serializable_job(job: dict) -> dict:
    """Strip runtime-only handles from a job dict so it can be persisted."""
    return {k: v for k, v in job.items() if k not in _NON_SERIALIZABLE}


def hydrate_job(job_id: str, snapshot: dict) -> dict:
    """Rebuild a runtime job dict from a stored snapshot.

    Rehydrated jobs get a fresh (unset) cancel Event and no syncer; the worker
    must not resume them automatically — they are offered back to the caller
    as failed/interrupted so an operator decides on a re-run.
    """
    import threading as _threading

    job = {k: v for k, v in snapshot.items() if k not in ("job_id",)}
    job["job_id"] = job_id
    job["cancel"] = _threading.Event()
    job["syncer"] = None
    return job
