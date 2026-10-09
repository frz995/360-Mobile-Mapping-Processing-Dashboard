import os
import sys

import pytest
from fastapi.testclient import TestClient

# Ensure STATION_ID is set for import
os.environ.setdefault("STATION_ID", "stitch")
os.environ.setdefault("WATCH_ROOT", os.path.join(os.getcwd(), "_test_watch_root"))

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402

client = TestClient(app)


def _auth() -> dict:
    """The agent's _guard only enforces a bearer when AGENT_TOKEN is set. When it
    is not configured every request is already open, so an empty header is fine
    and the assertions below are about the path handling, not the auth."""
    token = os.environ.get("AGENT_TOKEN", "")
    return {"Authorization": f"Bearer {token}"} if token else {}


def _write(path: str, name: str, content: str = "x") -> str:
    full = os.path.join(path, name)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(content)
    return full


def test_rename_rejects_parent_traversal(tmp_path, monkeypatch):
    """`src: ".."` reduces to ".." under os.path.basename, which would otherwise
    re-point the join at the PARENT of WATCH_ROOT. The worker already rejects this
    in nas_scan._safe_segment; the agent must reject it too."""
    root = tmp_path / "watch"
    stage = root / "03_Stitching" / "N93E70"
    stage.mkdir(parents=True)
    secret = root / "secret.txt"
    _write(str(root), "secret.txt", "top secret")

    monkeypatch.setattr("app.WATCH_ROOT", str(root))
    monkeypatch.setattr("app.API_TOKEN", "")

    res = client.post(
        "/api/rename",
        headers=_auth(),
        json={
            "stage_dir": "03_Stitching/N93E70",
            "renames": [{"src": "..", "dst": "stolen.txt"}],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    # Rejected, not renamed — and the file outside the stage folder is untouched.
    assert body["renamed"] == 0
    assert any(s.get("reason") == "invalid name" for s in body["skipped"])
    assert secret.read_text(encoding="utf-8") == "top secret"
    assert not os.path.exists(os.path.join(str(stage), "stolen.txt"))


def test_rename_rejects_current_dir(tmp_path, monkeypatch):
    """`src: "."` is the sibling case: joining base with "." is a no-op that would
    make os.rename operate on the stage directory itself."""
    root = tmp_path / "watch"
    stage = root / "03_Stitching" / "N93E70"
    stage.mkdir(parents=True)
    keep = stage / "keep.txt"
    keep.write_text("keep", encoding="utf-8")

    monkeypatch.setattr("app.WATCH_ROOT", str(root))
    monkeypatch.setattr("app.API_TOKEN", "")

    res = client.post(
        "/api/rename",
        headers=_auth(),
        json={"stage_dir": "03_Stitching/N93E70", "renames": [{"src": ".", "dst": "gone.txt"}]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["renamed"] == 0
    assert any(s.get("reason") == "invalid name" for s in body["skipped"])
    # The stage folder and its contents survived.
    assert keep.exists()
    assert stage.is_dir()


def test_rename_still_works_for_a_normal_name(tmp_path, monkeypatch):
    """The traversal guard must not break the ordinary path: a bare filename is
    still renamed inside the stage folder."""
    root = tmp_path / "watch"
    stage = root / "03_Stitching" / "N93E70"
    stage.mkdir(parents=True)
    (stage / "old.jpg").write_text("a", encoding="utf-8")

    monkeypatch.setattr("app.WATCH_ROOT", str(root))
    monkeypatch.setattr("app.API_TOKEN", "")

    res = client.post(
        "/api/rename",
        headers=_auth(),
        json={"stage_dir": "03_Stitching/N93E70", "renames": [{"src": "old.jpg", "dst": "new.jpg"}]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["renamed"] == 1
    assert not (stage / "old.jpg").exists()
    assert (stage / "new.jpg").read_text(encoding="utf-8") == "a"


def test_openapi_schema_routes_are_disabled():
    """The agent is reachable on the LAN/tunnel, so FastAPI's default schema UIs
    would publish the whole route table without a bearer."""
    for path in ("/openapi.json", "/docs", "/redoc"):
        assert client.get(path).status_code == 404, f"{path} is still served unauthenticated"