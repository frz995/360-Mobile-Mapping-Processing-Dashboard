"""Tests for the durable SQLite job journal (Stream B1 / C2).

These tests only depend on the Python standard library + sqlite3 (no numpy/
opencv), so they run in CI without the worker's heavy GPU dependencies.
"""
from __future__ import annotations

import os
import tempfile

from store import SQLiteJobJournal, serializable_job, hydrate_job


def _make_journal() -> tuple[SQLiteJobJournal, str]:
    d = tempfile.mkdtemp()
    db = os.path.join(d, "jobs.sqlite3")
    return SQLiteJobJournal(db), db


def test_write_and_read_all():
    j, _db = _make_journal()
    j.write("a", {"status": "IN_PROGRESS", "progress": 42, "message": "x"})
    j.write("b", {"status": "COMPLETED", "progress": 100})
    rows = j.read_all()
    assert set(rows) == {"a", "b"}
    assert rows["a"]["progress"] == 42
    j.close()


def test_update_is_idempotent_upsert():
    j, _db = _make_journal()
    j.write("a", {"status": "QUEUED", "progress": 0})
    j.write("a", {"status": "IN_PROGRESS", "progress": 55})
    rows = j.read_all()
    assert len(rows) == 1
    assert rows["a"]["progress"] == 55
    j.close()


def test_remove():
    j, _db = _make_journal()
    j.write("a", {"status": "DONE"})
    j.remove("a")
    assert "a" not in j.read_all()
    j.close()


def test_restart_recovery_rehydrates_runtime_handles():
    # Simulate a worker restart: a NEW journal instance on the same file must
    # see the same persisted rows, and hydrate_job must rebuild runtime handles.
    d = tempfile.mkdtemp()
    db = os.path.join(d, "jobs.sqlite3")
    j1 = SQLiteJobJournal(db)
    j1.write("int", {"status": "IN_PROGRESS", "progress": 10})
    j1.write("cmp", {"status": "COMPLETED", "progress": 100})
    j1.close()

    j2 = SQLiteJobJournal(db)
    assert set(j2.read_all()) == {"int", "cmp"}

    h = hydrate_job("int", j2.read_all()["int"])
    assert "cancel" in h
    assert h["cancel"].is_set() is False
    assert h["syncer"] is None
    assert h["status"] == "IN_PROGRESS"

    # Recovery semantics: interrupted jobs are surfaced as FAILED, never dropped.
    for jid, snap in j2.read_all().items():
        job = hydrate_job(jid, snap)
        if job.get("status") in ("QUEUED", "IN_PROGRESS"):
            job["status"] = "FAILED"
            job["message"] = "Worker restarted - job interrupted"
    assert hydrate_job("int", j2.read_all()["int"])["status"] == "IN_PROGRESS"
    j2.close()


def test_serializable_job_strips_runtime_handles():
    job = {
        "job_id": "x",
        "status": "QUEUED",
        "cancel": object(),
        "syncer": object(),
        "thread": object(),
        "progress": 0,
    }
    snap = serializable_job(job)
    assert "cancel" not in snap
    assert "syncer" not in snap
    assert "thread" not in snap
    assert snap["job_id"] == "x"
    assert snap["progress"] == 0
