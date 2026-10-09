"""Tests for the worker's unauthenticated surface.

The documented contract is that `/health` is the ONLY route reachable without
the bearer token (worker/README.md), and the worker is bound to a
Cloudflare-Tunnel-exposed interface. FastAPI serves `/openapi.json`, `/docs`
and `/redoc` by default and routes them through no guard, which quietly
published the entire route table — including filesystem path parameters — to
anyone who could reach the port.
"""
from __future__ import annotations

import pytest

try:
    from fastapi.testclient import TestClient
    from app import app
    HAS_APP = True
except ImportError:
    HAS_APP = False
    TestClient = None  # type: ignore
    app = None  # type: ignore

pytestmark = pytest.mark.skipif(not HAS_APP, reason="fastapi/app dependencies not installed")


@pytest.fixture()
def client():
    return TestClient(app)


def test_openapi_schema_routes_are_disabled(client):
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert client.get(path).status_code == 404, f"{path} is still served unauthenticated"


def test_health_is_still_reachable(client):
    """The one documented open route must survive the change — the dashboard's
    Worker Monitor and the doctor script both poll it."""
    res = client.get("/health")
    assert res.status_code == 200
    assert "worker" in res.json()


def test_guarded_routes_still_reject_without_a_token(client, monkeypatch):
    import app as worker_module

    monkeypatch.setattr(worker_module, "API_TOKEN", "s3cret")
    for path in ("/api/storage", "/api/folders?path=", "/api/nas-scan?action=subgrids"):
        res = client.get(path)
        assert res.status_code == 401, f"{path} served without the bearer token"