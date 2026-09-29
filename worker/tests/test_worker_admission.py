"""Tests for worker admission control, queue limits, and job type validation."""
from __future__ import annotations

import os
import tempfile
import threading
import pytest

try:
    from runner import JobRegistry, QueueFullError
    HAS_RUNNER = True
except ImportError:
    HAS_RUNNER = False
    JobRegistry = None  # type: ignore
    QueueFullError = Exception  # type: ignore

try:
    from sync import SupabaseSyncer
    HAS_SYNC = True
except ImportError:
    HAS_SYNC = False
    SupabaseSyncer = None  # type: ignore

try:
    from fastapi.testclient import TestClient
    import app as worker_module
    from app import app
    HAS_APP = True
except ImportError:
    HAS_APP = False
    TestClient = None  # type: ignore
    worker_module = None  # type: ignore
    app = None  # type: ignore


@pytest.mark.skipif(not HAS_RUNNER, reason="runner dependencies not available")
def test_queue_depth_rejection():
    # Registry with max_queue_depth=2
    registry = JobRegistry(concurrency=1, max_active_jobs=1, max_queue_depth=2)

    temp_dir = tempfile.mkdtemp()
    out_dir = tempfile.mkdtemp()

    # Job 1
    registry.start(
        job_id="j1",
        job_type="ENHANCE",
        source_dir=temp_dir,
        output_dir=out_dir,
        source_rel="",
        output_rel="",
        subgrid=None,
        total_items=0,
        settings={},
        syncer=None,
    )
    # Job 2
    registry.start(
        job_id="j2",
        job_type="ENHANCE",
        source_dir=temp_dir,
        output_dir=out_dir,
        source_rel="",
        output_rel="",
        subgrid=None,
        total_items=0,
        settings={},
        syncer=None,
    )

    # Job 3 should raise QueueFullError if queued_count >= 2
    with registry._lock:
        registry.jobs["mock1"] = {"status": "QUEUED"}
        registry.jobs["mock2"] = {"status": "QUEUED"}

    with pytest.raises(QueueFullError):
        registry.start(
            job_id="j3",
            job_type="ENHANCE",
            source_dir=temp_dir,
            output_dir=out_dir,
            source_rel="",
            output_rel="",
            subgrid=None,
            total_items=0,
            settings={},
            syncer=None,
        )


@pytest.mark.skipif(not HAS_RUNNER, reason="runner dependencies not available")
def test_job_registry_status_properties():
    registry = JobRegistry(concurrency=1, max_active_jobs=1, max_queue_depth=5)
    with registry._lock:
        registry.jobs["q1"] = {"status": "QUEUED"}
        registry.jobs["r1"] = {"status": "IN_PROGRESS"}
        registry.jobs["c1"] = {"status": "COMPLETED"}
        registry.jobs["f1"] = {"status": "FAILED"}
        registry.jobs["x1"] = {"status": "CANCELLED"}

    assert set(registry.queued.keys()) == {"q1"}
    assert set(registry.running.keys()) == {"r1"}
    assert set(registry.completed.keys()) == {"c1"}
    assert set(registry.failed.keys()) == {"f1", "x1"}
    assert set(registry.active.keys()) == {"q1", "r1"}


def _start_kwargs(source_dir: str, output_dir: str) -> dict:
    return {
        "job_type": "ENHANCE",
        "source_dir": source_dir,
        "output_dir": output_dir,
        "source_rel": "",
        "output_rel": "",
        "subgrid": None,
        "total_items": 0,
        "settings": {},
        "syncer": None,
    }


@pytest.mark.skipif(not HAS_RUNNER, reason="runner dependencies not available")
def test_duplicate_submit_is_ignored_while_job_is_active():
    """A retry after a client-side timeout must not start a second worker.

    Regression: start() used to overwrite self.jobs[job_id] unconditionally,
    so a retried submit replaced the record *and* its cancel Event while the
    original thread was still running — a concurrent cancel was then silently
    dropped. The record identity assertions are the actual regression guard.
    """
    source_dir = tempfile.mkdtemp()
    output_dir = tempfile.mkdtemp()

    for status in ("QUEUED", "IN_PROGRESS"):
        registry = JobRegistry(concurrency=1, max_active_jobs=1, max_queue_depth=5)
        with registry._lock:
            registry.jobs["dup"] = {
                "job_id": "dup",
                "status": status,
                "settings": {"original": True},
                "cancel": threading.Event(),
            }
        record = registry.get("dup")
        cancel_event = record["cancel"]

        result = registry.start(
            job_id="dup",
            **{**_start_kwargs(source_dir, output_dir), "settings": {"replacement": True}},
        )

        assert result == status, "duplicate submit must report the existing status"
        assert registry.get("dup") is record, "job record was replaced by a duplicate submit"
        assert registry.get("dup")["cancel"] is cancel_event, "cancel event was replaced"
        assert not cancel_event.is_set()
        assert registry.get("dup")["settings"] == {"original": True}, "settings were overwritten"


@pytest.mark.skipif(not HAS_RUNNER, reason="runner dependencies not available")
def test_terminal_job_can_be_resubmitted(monkeypatch):
    """Re-running a finished job is the documented recovery path, so terminal
    states must stay restartable and report a fresh start."""
    source_dir = tempfile.mkdtemp()
    output_dir = tempfile.mkdtemp()
    monkeypatch.setattr(JobRegistry, "_worker", lambda self, job_id: None)

    for status in ("COMPLETED", "FAILED", "CANCELLED", "REVIEW_REQUIRED"):
        registry = JobRegistry(concurrency=1, max_active_jobs=1, max_queue_depth=5)
        with registry._lock:
            registry.jobs["done"] = {
                "job_id": "done",
                "status": status,
                "cancel": threading.Event(),
            }
        result = registry.start(job_id="done", **_start_kwargs(source_dir, output_dir))
        assert result is None, f"{status} must be restartable"


@pytest.mark.skipif(not HAS_RUNNER, reason="runner dependencies not available")
def test_queue_depth_is_not_inflated_by_duplicate_submits():
    """A duplicate submit must not count against the queue-depth limit, or a
    client retrying in a loop could stall the queue with a single real job."""
    source_dir = tempfile.mkdtemp()
    output_dir = tempfile.mkdtemp()
    registry = JobRegistry(concurrency=1, max_active_jobs=1, max_queue_depth=1)

    with registry._lock:
        registry.jobs["dup"] = {"job_id": "dup", "status": "QUEUED", "cancel": threading.Event()}

    for _ in range(3):
        assert registry.start(job_id="dup", **_start_kwargs(source_dir, output_dir)) == "QUEUED"

    # Queue is full, but the duplicate short-circuits before the depth check.
    with pytest.raises(QueueFullError):
        registry.start(job_id="other", **_start_kwargs(source_dir, output_dir))


@pytest.mark.skipif(not (HAS_RUNNER and HAS_APP), reason="fastapi/app dependencies not installed")
def test_duplicate_submit_returns_success(tmp_path, monkeypatch):
    """A retried submit is a success, not a 409: the client only retries
    because it never saw the first response."""
    monkeypatch.setattr(worker_module, "API_TOKEN", "secret")
    # Startup() otherwise points SQLiteJobJournal at worker/jobs_journal.sqlite
    # (or whatever worker/.env says), which would touch the real job journal and
    # leave a stray file in the repo on CI. Isolate it per-test.
    monkeypatch.setenv("WORKER_JOB_DB", str(tmp_path / "jobs_journal.sqlite"))
    # Stub the worker body so the accepted job stays QUEUED. A real thread would
    # race the second submit by driving the status to a terminal state, making
    # the duplicate branch timing-dependent.
    monkeypatch.setattr(JobRegistry, "_worker", lambda self, job_id: None)
    with TestClient(app) as client:
        registry = JobRegistry(concurrency=1, max_active_jobs=1, max_queue_depth=5)
        monkeypatch.setattr(worker_module, "registry", registry)
        # resolve_fs() rejects anything outside NAS_BASE_PATH, so point the
        # worker at tmp_path and submit relative folder names.
        monkeypatch.setattr(worker_module, "NAS_BASE_PATH", str(tmp_path))
        headers = {"Authorization": "Bearer secret"}
        body = {
            "job_id": "retry-me",
            "job_type": "ENHANCE",
            "source_folder": "src",
            "output_folder": "out",
        }

        first = client.post("/api/jobs", headers=headers, json=body)
        assert first.status_code == 200, first.text
        assert "accepted into the batch queue" in first.json()["message"]
        assert registry.get("retry-me")["status"] == "QUEUED"

        second = client.post("/api/jobs", headers=headers, json=body)
        assert second.status_code == 200, second.text
        assert "duplicate submit ignored" in second.json()["message"]


@pytest.mark.skipif(not HAS_SYNC, reason="sync module not available")
def test_supabase_syncer_dead_letter():
    syncer = SupabaseSyncer(
        url="http://127.0.0.1:9999",  # Unreachable port
        service_role_key="mock-key",
        max_retries=2,
        dead_letter_max=10,
    )
    success = syncer.push("test-job", {"progress": 50})
    assert success is False
    assert len(syncer.dead_letter_queue) == 1
    assert syncer.dead_letter_queue[0]["job_id"] == "test-job"


@pytest.mark.skipif(not HAS_APP, reason="fastapi/app dependencies not installed")
def test_submit_job_rejects_unsupported_types():
    with TestClient(app) as client:
        # Unsupported types must return HTTP 400
        for unsupported_type in ("STITCH", "AI_DETECT", "QAQC", "UNKNOWN_TYPE"):
            resp = client.post(
                "/api/jobs",
                json={
                    "job_type": unsupported_type,
                    "source_folder": "test_src",
                    "output_folder": "test_out",
                }
            )
            assert resp.status_code == 400, f"Expected 400 for {unsupported_type}, got {resp.status_code}"
            assert "not executable by this worker" in resp.json()["detail"]


@pytest.mark.skipif(not HAS_APP, reason="fastapi/app dependencies not installed")
def test_worker_accepts_authorization_header(monkeypatch):
    monkeypatch.setattr(worker_module, "API_TOKEN", "secret")
    with TestClient(app) as client:
        response = client.post(
            "/api/jobs",
            headers={"Authorization": "Bearer secret"},
            json={
                "job_type": "STITCH",
                "source_folder": "test_src",
                "output_folder": "test_out",
            },
        )
        assert response.status_code == 400

        unauthorized = client.post(
            "/api/jobs",
            json={
                "job_type": "STITCH",
                "source_folder": "test_src",
                "output_folder": "test_out",
            },
        )
        assert unauthorized.status_code == 401


@pytest.mark.skipif(not HAS_APP, reason="fastapi/app dependencies not installed")
def test_worker_cancel_uses_authorization_header(monkeypatch):
    monkeypatch.setattr(worker_module, "API_TOKEN", "secret")
    with TestClient(app) as client:
        unauthorized = client.post("/api/jobs/unknown/cancel")
        assert unauthorized.status_code == 401

        authorized = client.post(
            "/api/jobs/unknown/cancel",
            headers={"Authorization": "Bearer secret"},
        )
        assert authorized.status_code == 200


@pytest.mark.skipif(not HAS_APP, reason="fastapi/app dependencies not installed")
def test_worker_protects_data_routes_when_token_is_configured(monkeypatch):
    monkeypatch.setattr(worker_module, "API_TOKEN", "secret")
    with TestClient(app) as client:
        assert client.get("/api/jobs/unknown").status_code == 401
        assert client.get("/api/folders").status_code == 401
        assert client.get("/api/storage").status_code == 401


@pytest.mark.skipif(not HAS_APP, reason="fastapi/app dependencies not installed")
def test_health_and_metrics_endpoints():
    with TestClient(app) as client:
        health_resp = client.get("/health")
        assert health_resp.status_code == 200
        health_data = health_resp.json()
        assert health_data["status"] == "ok"
        assert "jobs_active" in health_data
        assert "jobs_queued" in health_data

        metrics_resp = client.get("/metrics")
        assert metrics_resp.status_code == 200
        metrics_text = metrics_resp.json()["metrics_text"]
        assert "nas_jobs_active" in metrics_text
        assert "nas_jobs_queued" in metrics_text
        assert "nas_jobs_max_active" in metrics_text
        assert "nas_gpu_available" in metrics_text
