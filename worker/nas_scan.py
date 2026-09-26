"""Survey folder, metadata, and image scans rooted at the configured NAS base."""
from __future__ import annotations

import csv
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


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


def _image_names(folder: Path) -> list[str]:
    """List actual panorama images in a run folder or its panoramas child."""
    if not folder.is_dir():
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


def _metadata_run(meta_root: Path, run_name: str) -> tuple[str, int]:
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


def _subgrid_roots(base: str, subgrid: str) -> dict[str, Path]:
    sg = _safe_segment(subgrid, "subgrid")
    return {
        "stitching": _safe_path(base, "03_Stitching", "Project-OUT", "Grid 1", sg),
        "metadata": _safe_path(base, "01_Metadata", "Grid 1", sg),
        "raw": _safe_path(base, "00_Raw_data", "Grid 1", sg),
    }


def scan_nas(
    base_path: str,
    action: str,
    subgrid: str = "",
    folder: str = "",
    csv_name: str = "",
) -> dict[str, Any]:
    """Implement the dashboard's `/api/nas-scan` action contract on the NAS."""
    base = str(Path(base_path).resolve())
    action = (action or "subgrids").strip().lower()

    if action == "subgrids":
        roots = [
            _safe_path(base, "03_Stitching", "Project-OUT", "Grid 1"),
            _safe_path(base, "00_Raw_data", "Grid 1"),
            _safe_path(base, "01_Metadata", "Grid 1"),
        ]
        found: dict[str, str] = {}
        for root in roots:
            if not root.is_dir():
                continue
            try:
                for entry in root.iterdir():
                    if entry.is_dir() and not entry.name.startswith("."):
                        found.setdefault(entry.name.upper().strip(), entry.name)
            except OSError:
                continue
        stitching_root = roots[0]
        items = [
            {
                "code": code,
                "existsInStitching": (stitching_root / actual).is_dir(),
                "label": code,
            }
            for code, actual in sorted(found.items())
        ]
        return {"success": True, "basePath": base, "detectedSubgrids": [x["code"] for x in items], "subgrids": items}

    if action == "survey-folders":
        sg = _safe_segment(subgrid, "subgrid")
        stitch_root = _safe_path(base, "03_Stitching", "Project-OUT", "Grid 1", sg)
        metadata_root = _safe_path(base, "01_Metadata", "Grid 1", sg)
        if not stitch_root.is_dir():
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
                "path": f"/03_Stitching/Project-OUT/Grid 1/{sg}/{run_name}/",
            })
        return {"success": True, "subgrid": sg, "existsOnDisk": True, "folders": folders}

    if action == "read-csv":
        return read_survey_csv(base, subgrid, folder, csv_name)

    if action == "folder-images":
        sg = _safe_segment(subgrid, "subgrid")
        run_name = _safe_segment(folder, "folder")
        root = _safe_path(base, "03_Stitching", "Project-OUT", "Grid 1", sg, run_name)
        images = _image_names(root)
        return {"success": True, "existsOnDisk": root.is_dir(), "count": len(images), "images": images}

    if action == "final-images":
        sg = _safe_segment(subgrid, "subgrid")
        run_name = _safe_segment(folder, "folder")
        root = _safe_path(base, "05_Final", "Project-OUT", "Grid 1", sg, run_name)
        images = _image_names(root)
        return {
            "success": True,
            "existsOnDisk": root.is_dir(),
            "count": len(images),
            "images": images,
            "path": f"/05_Final/Project-OUT/Grid 1/{sg}/{run_name}/",
        }

    if action == "registry":
        roots = {
            "stitching": _safe_path(base, "03_Stitching", "Project-OUT", "Grid 1"),
            "metadata": _safe_path(base, "01_Metadata", "Grid 1"),
            "raw": _safe_path(base, "00_Raw_data", "Grid 1"),
        }
        subgrids: dict[str, str] = {}
        for root in roots.values():
            if not root.is_dir():
                continue
            try:
                for entry in root.iterdir():
                    if entry.is_dir() and not entry.name.startswith("."):
                        subgrids.setdefault(entry.name.upper().strip(), entry.name)
            except OSError:
                continue
        registry = []
        for code, actual in sorted(subgrids.items()):
            stitch_root = roots["stitching"] / actual
            meta_root = roots["metadata"] / actual
            raw_root = roots["raw"] / actual
            run_names: set[str] = set()
            for root in (stitch_root, meta_root, raw_root):
                if root.is_dir():
                    try:
                        run_names.update(p.name for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
                    except OSError:
                        pass
            children = []
            for run_name in sorted(run_names):
                stitch_run = stitch_root / run_name
                images = _image_names(stitch_run) if stitch_run.is_dir() else []
                csv_name, metadata_rows = _metadata_run(meta_root, run_name)
                raw_date, _ = _date_labels(run_name)
                children.append({
                    "name": run_name,
                    "date": raw_date,
                    "stitched": stitch_run.is_dir(),
                    "images": len(images),
                    "metadataRows": metadata_rows,
                    "csvName": csv_name,
                    "hasMetadata": bool(csv_name),
                    "stitchingPath": f"/03_Stitching/Project-OUT/Grid 1/{code}/{run_name}/",
                })
            registry.append({
                "subgrid": code,
                "existsInStitching": stitch_root.is_dir(),
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
