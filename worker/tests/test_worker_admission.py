"""Tests for worker admission control, queue limits, and job type validation."""
from __future__ import annotations

import os
import tempfile
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
    from app import app
    HAS_APP = True
except ImportError:
    HAS_APP = False
    TestClient = None  # type: ignore
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
