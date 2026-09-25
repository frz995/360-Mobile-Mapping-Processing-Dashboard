from __future__ import annotations

import json

import pytest

from release import ReleaseError, prepare_release


def _paths(tmp_path):
    base = tmp_path / "nas"
    source = base / "05_Final" / "N93E70"
    release = base / "DELIVERABLES" / "N93E70" / "N93E70-2026-09-25-R001"
    source.mkdir(parents=True)
    return base, source, release


def _args(base, source, release, run_id="run-1", attempt_id="attempt-1"):
    return {
        "source_dir": str(source),
        "release_dir": str(release),
        "subgrid": "N93E70",
        "run_code": "N93E70-2026-09-25-R001",
        "project_id": "project-1",
        "run_id": run_id,
        "attempt_id": attempt_id,
        "capture_date": "2026-09-25",
    }


def test_prepare_release_names_files_and_preserves_sources(tmp_path, monkeypatch):
    base, source, release = _paths(tmp_path)
    monkeypatch.setenv("NAS_BASE_PATH", str(base))
    (source / "camera_2.jpg").write_bytes(b"image-a")
    (source / "camera_1.JPG").write_bytes(b"image-b")
    (source / "metadata.csv").write_text("filename,lat\nN93E70-0001.jpg,1\n", encoding="utf-8")

    result = prepare_release(**_args(base, source, release))

    assert result["ok"] is True
    assert result["copied_count"] == 3
    assert (release / "N93E70-0001.jpg").read_bytes() == b"image-b"
    assert (release / "N93E70-0002.jpg").read_bytes() == b"image-a"
    assert (release / "N93E70.csv").read_text(encoding="utf-8").startswith("filename,lat")
    assert (source / "camera_2.jpg").read_bytes() == b"image-a"
    manifest = json.loads((release / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["subgrid"] == "N93E70"
    assert manifest["fileCount"] == 3
    assert len(manifest["files"]) == 3


def test_prepare_release_is_idempotent(tmp_path, monkeypatch):
    base, source, release = _paths(tmp_path)
    monkeypatch.setenv("NAS_BASE_PATH", str(base))
    (source / "frame.jpg").write_bytes(b"stable")

    first = prepare_release(**_args(base, source, release))
    second = prepare_release(**_args(base, source, release))

    assert first["copied_count"] == 1
    assert second["copied_count"] == 0
    assert second["reused_count"] == 1
    assert (release / "N93E70-0001.jpg").read_bytes() == b"stable"


def test_prepare_release_refuses_to_overwrite_conflicting_output(tmp_path, monkeypatch):
    base, source, release = _paths(tmp_path)
    monkeypatch.setenv("NAS_BASE_PATH", str(base))
    (source / "frame.jpg").write_bytes(b"first")
    prepare_release(**_args(base, source, release))
    (source / "frame.jpg").write_bytes(b"changed")

    with pytest.raises(ReleaseError, match="conflict"):
        prepare_release(**_args(base, source, release))


def test_prepare_release_rejects_nested_release_folder(tmp_path, monkeypatch):
    base, source, release = _paths(tmp_path)
    monkeypatch.setenv("NAS_BASE_PATH", str(base))
    (source / "frame.jpg").write_bytes(b"image")
    nested = source / "release"

    with pytest.raises(ReleaseError, match="must not be inside"):
        prepare_release(**{**_args(base, source, nested)})


def test_release_folder_must_stay_under_nas_base(tmp_path, monkeypatch):
    base, source, _release = _paths(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    monkeypatch.setenv("NAS_BASE_PATH", str(base))

    with pytest.raises(ReleaseError, match="escapes"):
        prepare_release(**_args(base, source, outside))


def test_source_folder_must_stay_under_nas_base(tmp_path, monkeypatch):
    base, _source, release = _paths(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "frame.jpg").write_bytes(b"image")
    monkeypatch.setenv("NAS_BASE_PATH", str(base))

    with pytest.raises(ReleaseError, match="escapes"):
        prepare_release(**_args(base, outside, release))
