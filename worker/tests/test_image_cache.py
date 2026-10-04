"""Tests for conditional GET / ETag handling on the image route.

FileResponse emits an ETag but never compares it, so every revalidation used to
re-download the whole file. These lock in the 304 behaviour and the RFC 9110
precedence rules that the Pages Function proxy relies on.
"""
from __future__ import annotations

import time

import pytest

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

pytestmark = pytest.mark.skipif(not HAS_APP, reason="fastapi/app dependencies not installed")

JPEG = b"\xff\xd8\xff\xe0" + b"payload" * 8


@pytest.fixture()
def image_client(tmp_path, monkeypatch):
    """A client pinned to an isolated NAS base.

    NAS_BASE_PATH must be redirected or the test would resolve image paths
    against the developer's real NAS mount and require NAS_WORKER_TOKEN to match.
    """
    (tmp_path / "shot.jpg").write_bytes(JPEG)
    (tmp_path / "other.jpg").write_bytes(JPEG)
    monkeypatch.setattr(worker_module, "API_TOKEN", "secret")
    monkeypatch.setattr(worker_module, "NAS_BASE_PATH", str(tmp_path))
    with TestClient(app) as client:
        yield client


def auth(**extra):
    return {"Authorization": "Bearer secret", **extra}


def test_fresh_request_returns_validators(image_client):
    res = image_client.get("/api/images/shot.jpg", headers=auth())
    assert res.status_code == 200
    assert res.content == JPEG
    assert res.headers["etag"]
    assert res.headers["last-modified"]
    assert res.headers["content-type"] == "image/jpeg"


def test_matching_etag_returns_304_with_empty_body(image_client):
    first = image_client.get("/api/images/shot.jpg", headers=auth())
    etag = first.headers["etag"]

    second = image_client.get("/api/images/shot.jpg", headers=auth(**{"If-None-Match": etag}))

    assert second.status_code == 304
    assert second.content == b"", "304 must not resend the image"
    assert second.headers["etag"] == etag


def test_wildcard_and_etag_list_are_honoured(image_client):
    etag = image_client.get("/api/images/shot.jpg", headers=auth()).headers["etag"]

    assert image_client.get("/api/images/shot.jpg", headers=auth(**{"If-None-Match": "*"})).status_code == 304
    listed = image_client.get("/api/images/shot.jpg", headers=auth(**{"If-None-Match": f'"other", {etag}'}))
    assert listed.status_code == 304


def test_stale_etag_returns_full_body(image_client):
    image_client.get("/api/images/shot.jpg", headers=auth())
    res = image_client.get("/api/images/shot.jpg", headers=auth(**{"If-None-Match": '"stale"'}))
    assert res.status_code == 200
    assert res.content == JPEG


def test_if_none_match_takes_precedence_over_if_modified_since(image_client):
    """RFC 9110: a present If-None-Match must decide the outcome on its own.

    Answering 304 here would pin a client to a file it explicitly said it does
    not have.
    """
    first = image_client.get("/api/images/shot.jpg", headers=auth())
    res = image_client.get(
        "/api/images/shot.jpg",
        headers=auth(**{"If-None-Match": '"stale"', "If-Modified-Since": first.headers["last-modified"]}),
    )
    assert res.status_code == 200


def test_if_modified_since_matches_or_is_older(image_client):
    last_modified = image_client.get("/api/images/shot.jpg", headers=auth()).headers["last-modified"]

    same = image_client.get("/api/images/shot.jpg", headers=auth(**{"If-Modified-Since": last_modified}))
    assert same.status_code == 304

    older = image_client.get(
        "/api/images/shot.jpg", headers=auth(**{"If-Modified-Since": "Mon, 01 Jan 2001 00:00:00 GMT"})
    )
    assert older.status_code == 200


def test_unparseable_if_modified_since_falls_back_to_200(image_client):
    res = image_client.get("/api/images/shot.jpg", headers=auth(**{"If-Modified-Since": "not-a-date"}))
    assert res.status_code == 200
    assert res.content == JPEG


def test_range_request_is_not_short_circuited_by_304(image_client):
    """Range requests must keep producing 206; answering 304 would break
    tiled panorama loading."""
    etag = image_client.get("/api/images/shot.jpg", headers=auth()).headers["etag"]
    res = image_client.get("/api/images/shot.jpg", headers=auth(Range="bytes=0-3", **{"If-None-Match": etag}))
    assert res.status_code == 206
    assert res.content == JPEG[:4]


def test_changed_file_invalidates_the_etag(tmp_path, monkeypatch, image_client):
    etag_before = image_client.get("/api/images/shot.jpg", headers=auth()).headers["etag"]

    time.sleep(1.1)  # keep the mtime distinct even on coarse filesystems
    (tmp_path / "shot.jpg").write_bytes(JPEG + b"changed")

    after = image_client.get("/api/images/shot.jpg", headers=auth())
    assert after.headers["etag"] != etag_before
    assert after.status_code == 200

    revalidated = image_client.get("/api/images/shot.jpg", headers=auth(**{"If-None-Match": etag_before}))
    assert revalidated.status_code == 200
    assert revalidated.content == JPEG + b"changed"


def test_guards_still_apply_to_the_image_route(image_client):
    assert image_client.get("/api/images/shot.jpg").status_code == 401
    assert image_client.get("/api/images/missing.jpg", headers=auth()).status_code == 404
