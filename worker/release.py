from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
METADATA_EXTENSIONS = {".csv"}
SAFE_NAME = re.compile(r"^[A-Z0-9_-]+$")


class ReleaseError(Exception):
    pass


def _safe_name(value: str, label: str) -> str:
    clean = str(value or "").strip()
    if not SAFE_NAME.fullmatch(clean):
        raise ReleaseError(f"Invalid {label}")
    return clean


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _collect_files(source_dir: Path) -> tuple[list[tuple[Path, str]], list[tuple[Path, str]]]:
    images: list[tuple[Path, str]] = []
    metadata: list[tuple[Path, str]] = []
    for root, dirs, names in os.walk(source_dir, followlinks=False):
        dirs[:] = sorted(directory for directory in dirs if not (Path(root) / directory).is_symlink())
        names.sort()
        root_path = Path(root)
        for name in names:
            path = root_path / name
            if path.is_symlink() or not path.is_file():
                continue
            relative = path.relative_to(source_dir).as_posix()
            extension = path.suffix.lower()
            if extension in IMAGE_EXTENSIONS:
                images.append((path, relative))
            elif extension in METADATA_EXTENSIONS:
                metadata.append((path, relative))
    images.sort(key=lambda item: item[1].lower())
    metadata.sort(key=lambda item: item[1].lower())
    return images, metadata


def _copy_or_reuse(source: Path, target: Path) -> bool:
    source_hash = _file_hash(source)
    if target.exists():
        if not target.is_file() or _file_hash(target) != source_hash:
            raise ReleaseError(f"Release output conflict: {target.name}")
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_nas_path(path: Path, label: str) -> None:
    base = Path(os.environ.get("NAS_BASE_PATH", "/nas/360_images")).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise ReleaseError(f"{label} escapes the NAS working base") from exc


def prepare_release(
    source_dir: str,
    release_dir: str,
    subgrid: str,
    run_code: str,
    project_id: str,
    run_id: str,
    attempt_id: str,
    capture_date: str,
) -> dict[str, Any]:
    safe_subgrid = _safe_name(subgrid, "subgrid")
    safe_run_code = _safe_name(run_code, "run code")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(capture_date or "")):
        raise ReleaseError("Invalid capture date")
    if not project_id or not run_id or not attempt_id:
        raise ReleaseError("Project, run, and attempt are required")

    source = Path(source_dir).resolve()
    target = Path(release_dir).resolve()
    if not source.is_dir():
        raise ReleaseError("Source folder does not exist")
    if source == target or source in target.parents:
        raise ReleaseError("Release folder must not be inside the source folder")
    _require_nas_path(source, "Source folder")
    _require_nas_path(target, "Release folder")

    images, metadata = _collect_files(source)
    if not images:
        raise ReleaseError("Source folder contains no supported image files")
    target.mkdir(parents=True, exist_ok=True)

    files: list[dict[str, Any]] = []
    copied_count = 0
    for index, (source_path, _) in enumerate(images, start=1):
        extension = source_path.suffix.lower() or ".jpg"
        release_name = f"{safe_subgrid}-{index:04d}{extension}"
        target_path = target / release_name
        copied = _copy_or_reuse(source_path, target_path)
        copied_count += int(copied)
        files.append({
            "sourcePath": str(source_path),
            "sourceName": source_path.name,
            "releaseName": release_name,
            "relativePath": release_name,
            "mediaType": "image",
            "sizeBytes": target_path.stat().st_size,
            "sha256": _file_hash(target_path),
            "sortOrder": index - 1,
        })

    csv_files: list[str] = []
    for index, (source_path, _) in enumerate(metadata, start=1):
        release_name = (
            f"{safe_subgrid}.csv"
            if len(metadata) == 1
            else f"{safe_subgrid}-metadata-{index:02d}.csv"
        )
        target_path = target / release_name
        copied = _copy_or_reuse(source_path, target_path)
        copied_count += int(copied)
        csv_files.append(release_name)
        files.append({
            "sourcePath": str(source_path),
            "sourceName": source_path.name,
            "releaseName": release_name,
            "relativePath": release_name,
            "mediaType": "metadata",
            "sizeBytes": target_path.stat().st_size,
            "sha256": _file_hash(target_path),
            "sortOrder": len(images) + index - 1,
        })

    manifest = {
        "schemaVersion": 1,
        "projectId": project_id,
        "runId": run_id,
        "attemptId": attempt_id,
        "subgrid": safe_subgrid,
        "runCode": safe_run_code,
        "captureDate": capture_date,
        "sourceFolder": str(source),
        "releaseFolder": str(target),
        "generatedAt": _now(),
        "files": files,
        "csvFiles": sorted(csv_files),
        "fileCount": len(files),
        "totalSizeBytes": sum(item["sizeBytes"] for item in files),
    }
    manifest_path = target / "manifest.json"
    temporary_path = target / "manifest.json.tmp"
    temporary_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary_path, manifest_path)
    return {
        "ok": True,
        "manifest": manifest,
        "manifest_path": str(manifest_path),
        "copied_count": copied_count,
        "reused_count": len(files) - copied_count,
    }
