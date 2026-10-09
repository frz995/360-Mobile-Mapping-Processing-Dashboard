"""Survey folder, metadata, and image scans rooted at the configured NAS base."""
from __future__ import annotations

import csv
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}

# Known stage aliases (case-insensitive substring matching)
STAGE_ALIASES: dict[str, list[str]] = {
    "stitching": ["03_stitching", "stitching", "stitched", "project-out", "panoramas", "pano"],
    "metadata": ["01_metadata", "metadata", "telemetry", "gps", "csv"],
    "raw": ["00_raw_data", "raw_data", "raw", "capture"],
    "final": ["05_final", "final", "deliverables", "delivered"],
}

# Standard defaults for zero-overhead, backward-compatible matching
STANDARD_PATHS: dict[str, tuple[str, ...]] = {
    "stitching": ("03_Stitching", "Project-OUT", "Grid 1"),
    "metadata": ("01_Metadata", "Grid 1"),
    "raw": ("00_Raw_data", "Grid 1"),
    "final": ("05_Final", "Project-OUT", "Grid 1"),
}

ENV_STAGE_KEYS: dict[str, str] = {
    "stitching": "NAS_STITCH_STAGE",
    "metadata": "NAS_METADATA_STAGE",
    "raw": "NAS_RAW_STAGE",
    "final": "NAS_FINAL_STAGE",
}


def _safe_path(base: str, *parts: str) -> Path:
    root = Path(base).resolve()
    candidate = root.joinpath(*parts).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Path escapes NAS_BASE_PATH.")
    return candidate


def _safe_segment(value: str, label: str) -> str:
    clean = (value or "").strip()
    if not clean or clean in {".", ".."} or "/" in clean or "\\" in clean:
        raise ValueError(f"Invalid {label} path segment.")
    return clean


def _rel_path_str(base_path: str, target: Path, default_fallback: str) -> str:
    try:
        base_res = Path(base_path).resolve()
        target_res = target.resolve()
        rel = str(target_res.relative_to(base_res)).replace("\\", "/")
        return f"/{rel}/"
    except (ValueError, OSError):
        return default_fallback


def _find_subgrid_containers(base: str, stage_type: str) -> list[Path]:
    """Find all directories that directly contain subgrid folders for a given stage."""
    root = Path(base).resolve()
    containers: list[Path] = []
    seen: set[Path] = set()

    def add_if_valid(p: Path) -> None:
        if p not in seen and p.is_dir():
            try:
                resolved = p.resolve()
                if resolved == root or root in resolved.parents:
                    containers.append(resolved)
                    seen.add(resolved)
            except (ValueError, OSError):
                pass

    # 1. Environment variable override
    env_key = ENV_STAGE_KEYS.get(stage_type)
    if env_key and os.environ.get(env_key):
        custom_parts = [part for part in os.environ[env_key].replace("\\", "/").split("/") if part]
        add_if_valid(_safe_path(base, *custom_parts))
        if containers:
            return containers

    # 2. Standard path check (zero-overhead lookup for standard layout)
    std_parts = STANDARD_PATHS.get(stage_type, ())
    if std_parts:
        try:
            std_p = _safe_path(base, *std_parts)
            if std_p.is_dir():
                add_if_valid(std_p)
                return containers
        except (ValueError, OSError):
            pass

    # 3. Adaptive discovery: find candidate stage directories under base
    aliases = STAGE_ALIASES.get(stage_type, [])
    candidate_stages: list[Path] = []
    try:
        for entry in root.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                name_lower = entry.name.lower()
                if any(alias in name_lower for alias in aliases):
                    candidate_stages.append(entry)
    except OSError:
        pass

    for stage in candidate_stages:
        proj_out_candidates = [stage]
        try:
            for child in stage.iterdir():
                if child.is_dir() and not child.name.startswith("."):
                    if "project-out" in child.name.lower():
                        proj_out_candidates.append(child)
        except OSError:
            pass

        for p_cand in proj_out_candidates:
            grid_found = False
            try:
                for child in p_cand.iterdir():
                    if child.is_dir() and not child.name.startswith("."):
                        c_lower = child.name.lower()
                        if "grid" in c_lower or "zone" in c_lower:
                            add_if_valid(child)
                            grid_found = True
            except OSError:
                pass
            if not grid_found and p_cand != root:
                add_if_valid(p_cand)

    return containers


def _find_subgrid_dir(base: str, stage_type: str, subgrid: str) -> Path | None:
    """Find the specific subgrid directory under any valid container for this stage."""
    sg = _safe_segment(subgrid, "subgrid")
    containers = _find_subgrid_containers(base, stage_type)
    for container in containers:
        exact = container / sg
        if exact.is_dir():
            return exact
        try:
            for child in container.iterdir():
                if child.is_dir() and child.name.upper() == sg.upper():
                    return child
        except OSError:
            continue
    return None


def _find_run_dir(base: str, stage_type: str, subgrid: str, folder: str) -> Path | None:
    """Find the specific run directory for a subgrid and folder name."""
    run_name = _safe_segment(folder, "folder")
    sg_dir = _find_subgrid_dir(base, stage_type, subgrid)
    if not sg_dir:
        return None
    exact = sg_dir / run_name
    if exact.is_dir():
        return exact
    try:
        for child in sg_dir.iterdir():
            if child.is_dir() and child.name.upper() == run_name.upper():
                return child
    except OSError:
        pass
    return None


def _image_names(folder: Path | None) -> list[str]:
    """List actual panorama images in a run folder or its panoramas child."""
    if not folder or not folder.is_dir():
        return []
    try:
        direct = sorted(p.name for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS)
        if direct:
            return direct
        pano_dir = folder / "panoramas"
        if pano_dir.is_dir():
            return sorted(p.name for p in pano_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS)
    except OSError:
        return []
    return []


def _metadata_run(meta_root: Path | None, run_name: str) -> tuple[str, int]:
    if not meta_root:
        return "", 0
    folder = meta_root / run_name
    if not folder.is_dir():
        return "", 0
    try:
        names = sorted(p.name for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".csv")
    except OSError:
        return "", 0
    csv_name = next((n for n in names if not n.startswith("003485-")), names[0] if names else "")
    if not csv_name:
        return "", 0
    try:
        with (folder / csv_name).open("r", encoding="utf-8-sig", newline="") as handle:
            return csv_name, sum(1 for _ in csv.DictReader(handle))
    except (OSError, csv.Error, UnicodeError):
        return csv_name, 0


def _date_labels(run_name: str) -> tuple[str, str]:
    match = re.search(r"(\d{4})(\d{2})(\d{2})", run_name)
    if not match:
        return "", run_name
    raw = f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d")
        display = f"{parsed.day:02d} {parsed.strftime('%b %Y')}"
    except ValueError:
        display = run_name
    return raw, display


def scan_nas(
    base_path: str,
    action: str,
    subgrid: str = "",
    folder: str = "",
    csv_name: str = "",
) -> dict[str, Any]:
    """Implement the dashboard's `/api/nas-scan` action contract on the NAS with adaptive discovery."""
    base = str(Path(base_path).resolve())
    action = (action or "subgrids").strip().lower()

    if action == "subgrids":
        stitching_containers = _find_subgrid_containers(base, "stitching")
        raw_containers = _find_subgrid_containers(base, "raw")
        metadata_containers = _find_subgrid_containers(base, "metadata")
        all_containers = stitching_containers + raw_containers + metadata_containers

        found: dict[str, str] = {}
        for root in all_containers:
            if not root.is_dir():
                continue
            try:
                for entry in root.iterdir():
                    if entry.is_dir() and not entry.name.startswith("."):
                        if entry.name.lower() in {"project-out", "panoramas", "panorama-tiles"}:
                            continue
                        found.setdefault(entry.name.upper().strip(), entry.name)
            except OSError:
                continue

        items = [
            {
                "code": code,
                "existsInStitching": any((c / actual).is_dir() for c in stitching_containers),
                "label": code,
            }
            for code, actual in sorted(found.items())
        ]
        return {"success": True, "basePath": base, "detectedSubgrids": [x["code"] for x in items], "subgrids": items}

    if action == "survey-folders":
        sg = _safe_segment(subgrid, "subgrid")
        stitch_root = _find_subgrid_dir(base, "stitching", sg)
        metadata_root = _find_subgrid_dir(base, "metadata", sg)
        if not stitch_root or not stitch_root.is_dir():
            return {"success": True, "subgrid": sg, "existsOnDisk": False, "folders": []}
        try:
            run_names = sorted(p.name for p in stitch_root.iterdir() if p.is_dir() and not p.name.startswith("."))
        except OSError:
            run_names = []
        folders = []
        for run_name in run_names:
            run_dir = stitch_root / run_name
            images = _image_names(run_dir)
            csv_name, metadata_rows = _metadata_run(metadata_root, run_name)
            raw_date, display_date = _date_labels(run_name)
            dirs = {p.name for p in run_dir.iterdir() if p.is_dir()} if run_dir.is_dir() else set()
            is_tiled = "panoramas" in dirs or "panorama-tiles" in dirs
            sample = f"{images[0]} .. {images[-1]}" if images else "panoramas/ & panorama-tiles/" if is_tiled else ""
            default_path = f"/03_Stitching/Project-OUT/Grid 1/{sg}/{run_name}/"
            folders.append({
                "id": run_name,
                "name": run_name,
                "displayDate": display_date,
                "rawDate": raw_date,
                "panoramasCount": len(images),
                "samplePano": sample,
                "csvName": csv_name or f"{run_name}.csv",
                "gpsCount": metadata_rows if csv_name else len(images),
                "formatType": "Tiled Cubic (Deep Zoom)" if is_tiled else "Equirectangular 360°",
                "formatDesc": "Multi-resolution tiles + backups" if is_tiled else "Stitched single JPG + manifest.json",
                "path": _rel_path_str(base, run_dir, default_path),
            })
        return {"success": True, "subgrid": sg, "existsOnDisk": True, "folders": folders}

    if action == "read-csv":
        return read_survey_csv(base, subgrid, folder, csv_name)

    if action == "folder-images":
        sg = _safe_segment(subgrid, "subgrid")
        run_name = _safe_segment(folder, "folder")
        root = _find_run_dir(base, "stitching", sg, run_name)
        images = _image_names(root)
        return {"success": True, "existsOnDisk": bool(root and root.is_dir()), "count": len(images), "images": images}

    if action == "final-images":
        sg = _safe_segment(subgrid, "subgrid")
        run_name = _safe_segment(folder, "folder")
        root = _find_run_dir(base, "final", sg, run_name)
        images = _image_names(root)
        default_final = f"/05_Final/Project-OUT/Grid 1/{sg}/{run_name}/"
        final_path = _rel_path_str(base, root, default_final) if root else default_final
        return {
            "success": True,
            "existsOnDisk": bool(root and root.is_dir()),
            "count": len(images),
            "images": images,
            "path": final_path,
        }

    if action == "registry":
        stitching_containers = _find_subgrid_containers(base, "stitching")
        metadata_containers = _find_subgrid_containers(base, "metadata")
        raw_containers = _find_subgrid_containers(base, "raw")

        subgrids: dict[str, str] = {}
        for container in stitching_containers + metadata_containers + raw_containers:
            if not container.is_dir():
                continue
            try:
                for entry in container.iterdir():
                    if entry.is_dir() and not entry.name.startswith("."):
                        if entry.name.lower() in {"project-out", "panoramas", "panorama-tiles"}:
                            continue
                        subgrids.setdefault(entry.name.upper().strip(), entry.name)
            except OSError:
                continue

        registry = []
        for code, actual in sorted(subgrids.items()):
            stitch_root = _find_subgrid_dir(base, "stitching", actual)
            meta_root = _find_subgrid_dir(base, "metadata", actual)
            raw_root = _find_subgrid_dir(base, "raw", actual)

            run_names: set[str] = set()
            for root_dir in (stitch_root, meta_root, raw_root):
                if root_dir and root_dir.is_dir():
                    try:
                        run_names.update(p.name for p in root_dir.iterdir() if p.is_dir() and not p.name.startswith("."))
                    except OSError:
                        pass

            children = []
            for run_name in sorted(run_names):
                stitch_run = (stitch_root / run_name) if stitch_root else None
                is_stitched = bool(stitch_run and stitch_run.is_dir())
                images = _image_names(stitch_run) if is_stitched else []
                csv_name, metadata_rows = _metadata_run(meta_root, run_name)
                raw_date, _ = _date_labels(run_name)
                default_stitch = f"/03_Stitching/Project-OUT/Grid 1/{code}/{run_name}/"
                stitching_path = _rel_path_str(base, stitch_run, default_stitch) if stitch_run else default_stitch

                children.append({
                    "name": run_name,
                    "date": raw_date,
                    "stitched": is_stitched,
                    "images": len(images),
                    "metadataRows": metadata_rows,
                    "csvName": csv_name,
                    "hasMetadata": bool(csv_name),
                    "stitchingPath": stitching_path,
                })

            registry.append({
                "subgrid": code,
                "existsInStitching": bool(stitch_root and stitch_root.is_dir()),
                "totals": {
                    "surveys": len(children),
                    "stitchedRuns": sum(1 for c in children if c["stitched"]),
                    "metadataTotal": sum(c["metadataRows"] for c in children),
                    "imagesTotal": sum(c["images"] for c in children),
                },
                "children": children,
            })
        return {"success": True, "registry": registry}

    raise ValueError(f"Unknown NAS scan action: {action}")


def read_survey_csv(base_path: str, subgrid: str, folder: str, csv_name: str = "") -> dict[str, Any]:
    """Read and normalize a survey metadata CSV into dashboard pairing rows."""
    sg = _safe_segment(subgrid, "subgrid")
    run_name = _safe_segment(folder, "folder")
    meta_root = _find_subgrid_dir(base_path, "metadata", sg)
    if not meta_root or not meta_root.is_dir():
        meta_root = _safe_path(base_path, "01_Metadata", "Grid 1", sg)
    run_dir = meta_root / run_name
    if not run_dir.is_dir():
        raise FileNotFoundError("Metadata survey folder not found.")
    names = sorted(p.name for p in run_dir.iterdir() if p.is_file() and p.suffix.lower() == ".csv")
    chosen = csv_name if csv_name and csv_name in names else next((n for n in names if not n.startswith("003485-")), names[0] if names else "")
    if not chosen:
        raise FileNotFoundError("Survey CSV not found.")
    csv_path = run_dir / chosen
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(2048)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(handle, dialect=dialect)
        headers = {str(h or "").strip().lower(): h for h in (reader.fieldnames or [])}

        def find_header(*needles: str):
            for normalized, original in headers.items():
                if any(n in normalized for n in needles):
                    return original
            return None

        lat_key = find_header("lat")
        lon_key = find_header("lon", "lng")
        filename_key = find_header("file", "name", "img")
        heading_key = find_header("head", "yaw", "azimuth")
        time_key = find_header("time", "date")
        distance_key = find_header("distance")
        records = []
        row_total = 0
        skipped = 0
        for index, row in enumerate(reader, start=1):
            if not any(str(v or "").strip() for v in row.values()):
                continue
            row_total += 1
            try:
                lat = float(row.get(lat_key, "")) if lat_key else float("nan")
                lon = float(row.get(lon_key, "")) if lon_key else float("nan")
            except (TypeError, ValueError):
                lat, lon = float("nan"), float("nan")
            if lat != lat or lon != lon:
                skipped += 1
                continue
            src_name = str(row.get(filename_key, "") or "").strip() if filename_key else ""
            try:
                heading = float(row.get(heading_key, "") or 0) if heading_key else 0.0
            except (TypeError, ValueError):
                heading = 0.0
            try:
                distance = float(row.get(distance_key, "")) if distance_key and str(row.get(distance_key, "")).strip() else None
            except (TypeError, ValueError):
                distance = None
            timestamp = str(row.get(time_key, "") or "").strip() if time_key else ""
            seq = f"{index:04d}"
            target = src_name or f"{sg}-{seq}.jpg"
            records.append({
                "index": index,
                "sourceFilename": src_name,
                "targetFilename": target,
                "timestamp": timestamp,
                "latitude": round(lat, 6),
                "longitude": round(lon, 6),
                "heading": round(heading, 1),
                "distanceToPrevious": distance,
                "isMatched": False,
            })
    return {"success": True, "csvPath": chosen, "rowTotal": row_total, "skippedNoCoords": skipped, "records": records}
