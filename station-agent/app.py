# GeoSphere 360 Station Agent — per-PC telemetry for the 4-PC Flight Board.
#
# Runs on each workstation (PC 1-4) and answers two probes from the dashboard:
#   GET /health       — same shape as the NAS GPU Worker /health (WorkerMonitorPanel
#                       and ProvidersPanel pings keep working unchanged).
#   GET /api/station  — auto-detection payload consumed by the Flight Board:
#                         task.processes    matched work processes (psutil)
#                         task.started      true while any mapped process runs
#                         output.subgrids   files written by this station per subgrid
#                         points.subgrids   capture-point progress (tile-rig stations)
#
# Detection loop: a daemon thread scans every SCAN_INTERVAL_SEC and refreshes an
# in-memory snapshot; HTTP handlers only read that snapshot. Config comes from
# .env next to this file (see .env.example) or real OS environment variables.
from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import threading
import time
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional
    pass

try:
    import psutil  # type: ignore
except Exception:  # pragma: no cover - keep the agent importable without psutil
    psutil = None  # type: ignore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("station-agent")

DEFAULT_OUT_STAGE: Dict[str, str] = {
    "blur": "02_Blurring",
    "stitch": "03_Stitching",
    "lightroom": "04_Lightroom",
    "photoshop": "05_Final",
}

# Tile-rig stations whose atomic work unit is a capture point (a rig folder of
# camera tiles), not a single stitchable image. Blur consumes raw tiles → the
# honest per-point mirror rule is "blurred tiles >= raw tiles".
IN_STAGE_DEFAULT: Dict[str, str] = {
    "blur": "00_Raw_data",
    "stitch": "02_Blurring",
    "lightroom": "03_Stitching",
    "photoshop": "04_Lightroom",
}

STATION_ID = (os.environ.get("STATION_ID") or "").strip().lower()
WATCH_ROOT = os.environ.get("WATCH_ROOT") or os.environ.get("NAS_BASE_PATH") or ""
OUT_STAGE = os.environ.get("OUT_STAGE") or DEFAULT_OUT_STAGE.get(STATION_ID, "")
IN_STAGE = os.environ.get("IN_STAGE") or IN_STAGE_DEFAULT.get(STATION_ID, "")
POINT_MODE = (os.environ.get("POINT_MODE") or ("1" if STATION_ID == "blur" else "0")) not in ("0", "false", "no", "")
SUBGRID_PATTERN = os.environ.get("SUBGRID_PATTERN") or r"^[A-Za-z]{1,3}[0-9A-Za-z]{2,11}$"
try:
    _SG_RE = re.compile(SUBGRID_PATTERN)
except re.error:
    _SG_RE = re.compile(r"^[A-Za-z]{1,3}[0-9A-Za-z]{2,11}$")
IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".insp"}
PROCESS_NAMES = [
    n.strip().lower()
    for n in (os.environ.get("PROCESS_NAMES") or "").replace(";", ",").split(",")
    if n.strip()
]
SCAN_INTERVAL_SEC = float(os.environ.get("SCAN_INTERVAL_SEC", "5"))
GROWING_WINDOW_SEC = float(os.environ.get("GROWING_WINDOW_SEC", "90"))
MAX_FILES_PER_WALK = 200_000
API_TOKEN = os.environ.get("AGENT_TOKEN", "")
HOST = os.environ.get("AGENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("AGENT_PORT", "8000"))
AGENT_VERSION = "1.0.0"

if not STATION_ID:
    raise SystemExit(
        "STATION_ID is required in station-agent/.env (one of: %s)" % ", ".join(DEFAULT_OUT_STAGE)
    )


def _iso_from_epoch(seconds: Optional[float]) -> Optional[str]:
    if not seconds:
        return None
    try:
        return datetime.fromtimestamp(float(seconds), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Snapshot:
    """Latest detectable state: running processes + output file counts + points."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.generated_at: str = _now_iso()
        self.start_time = time.time()
        self.processes: List[dict] = []
        self.subgrids: Dict[str, dict] = {}
        self.watch_error: Optional[str] = None
        self.points: Dict[str, dict] = {}
        self.points_error: Optional[str] = None
        self.watch_root = WATCH_ROOT
        self.out_stage = OUT_STAGE
        self.in_stage = IN_STAGE

    def as_dict(self) -> dict:
        with self.lock:
            first_started = None
            if self.processes:
                stamps = sorted(p["started_at"] for p in self.processes if p.get("started_at"))
                first_started = stamps[0] if stamps else None
            return {
                "agent_version": AGENT_VERSION,
                "station_id": STATION_ID,
                "hostname": platform.node(),
                "generated_at": self.generated_at,
                "task": {
                    "started": bool(self.processes),
                    "processes": list(self.processes),
                    "first_started_at": first_started,
                },
                "output": {
                    "root": self.watch_root,
                    "stage": self.out_stage,
                    "subgrids": dict(self.subgrids),
                },
                "points": {
                    "stage_in": self.in_stage,
                    "point_mode": bool(POINT_MODE),
                    "subgrids": dict(self.points),
                    "error": self.points_error,
                },
                "watch_error": self.watch_error,
            }


snapshot = Snapshot()


def _subdir_image_count(folder: str) -> int:
    """Count image tiles directly inside one camera folder."""
    count = 0
    try:
        for fn in os.scandir(folder):
            if fn.is_file() and os.path.splitext(fn.name)[1].lower() in IMG_EXTENSIONS:
                count += 1
    except OSError:
        pass
    return count


def detect_processes() -> List[dict]:
    """Match running processes against PROCESS_NAMES (name or exe path substring)."""
    if psutil is None or not PROCESS_NAMES:
        return []
    wanted = PROCESS_NAMES
    matched: List[dict] = []
    for proc in psutil.process_iter():
        try:
            name = (proc.name() or "").lower()
            try:
                exe = (proc.exe() or "").lower()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                exe = ""
            if not any(w in name for w in wanted) and not any(w in exe for w in wanted):
                continue
            matched.append(
                {
                    "name": proc.name(),
                    "pid": proc.pid,
                    "started_at": _iso_from_epoch(proc.create_time()),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        except Exception:
            continue
    return matched


def scan_output_subgrids() -> Tuple[Dict[str, dict], Optional[str]]:
    """Count files per subgrid folder under <WATCH_ROOT>/<OUT_STAGE>.

    Subgrid folders are first-level directories under the station's OUT stage;
    they are walked recursively (workers sometimes mirror raw date/camera
    trees). `growing` means a file landed in the last GROWING_WINDOW_SEC.
    Returns (per-subgrid counts, watch error for UI diagnostics).
    """
    root = os.path.join(WATCH_ROOT, OUT_STAGE) if WATCH_ROOT and OUT_STAGE else ""
    if not root:
        return {}, "WATCH_ROOT/OUT_STAGE not configured"
    if not os.path.isdir(root):
        return {}, f"watch root not listable: {root}"
    results: Dict[str, dict] = {}
    now = time.time()
    for entry in os.scandir(root):
        if not entry.is_dir():
            continue
        if POINT_MODE:
            # Tile rigs mirror the deep raw tree; the first-level folder may be
            # a grid/project wrapper rather than the subgrid, so attribute the
            # walk by matching SUBGRID_PATTERN segments anywhere in the path.
            for subgrid, count, last_iso in _walk_points_attr(entry.path):
                bucket = results.setdefault(
                    subgrid,
                    {"files": 0, "last_write_at": None, "growing": False},
                )
                bucket["files"] += count
                if last_iso and (not bucket["last_write_at"] or last_iso > bucket["last_write_at"]):
                    bucket["last_write_at"] = last_iso
                delta = now - _epoch(last_iso) if last_iso else 0
                if last_iso and 0 <= delta < GROWING_WINDOW_SEC:
                    bucket["growing"] = True
            continue
        files = 0
        last_write = 0.0
        try:
            for dirpath, _dirnames, filenames in os.walk(entry.path):
                for fn in filenames:
                    try:
                        stat = os.stat(os.path.join(dirpath, fn))
                    except OSError:
                        continue
                    files += 1
                    if stat.st_mtime > last_write:
                        last_write = stat.st_mtime
                if files > MAX_FILES_PER_WALK:
                    break
        except OSError:
            continue
        results[entry.name] = {
            "files": files,
            "last_write_at": _iso_from_epoch(last_write),
            "growing": (now - last_write) < GROWING_WINDOW_SEC and files > 0,
        }
    return results, None


def _epoch(iso: Optional[str]) -> float:
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


def _subgrid_of_rel(rel: str) -> Optional[str]:
    for segment in rel.replace(os.sep, "/").split("/"):
        if _SG_RE.match(segment.strip()):
            return segment.strip().upper()
    return None


def _walk_points_attr(folder: str):
    """Yield (subgrid, image_count, last_mtime_iso) per point folder found
    recursively under `folder`. A point = directory whose children are
    camera dirs (digit-named) or a flat leaf holding images directly."""
    total = 0
    for dirpath, dirnames, filenames in os.walk(folder):
        cam_dirs = [d for d in dirnames if d.isdigit() and len(d) <= 2]
        images = [f for f in filenames if os.path.splitext(f)[1].lower() in IMG_EXTENSIONS]
        if not cam_dirs and not images:
            continue
        point_rel = os.path.relpath(dirpath, folder)
        subgrid = _subgrid_of_rel(point_rel) or "_unattributed"
        count = 0
        last_write = 0.0
        if cam_dirs:
            for d in cam_dirs:
                count += _subdir_image_count(os.path.join(dirpath, d))
                try:
                    cam_dir_mtime = os.stat(os.path.join(dirpath, d)).st_mtime
                except OSError:
                    cam_dir_mtime = 0
                if cam_dir_mtime > last_write:
                    last_write = cam_dir_mtime
            dirnames[:] = []  # do not descend into the point again
        if count == 0:
            for fn in images:
                try:
                    stat = os.stat(os.path.join(dirpath, fn))
                except OSError:
                    continue
                count += 1
                if stat.st_mtime > last_write:
                    last_write = stat.st_mtime
        if count == 0:
            continue
        total += count
        if total > MAX_FILES_PER_WALK:
            break
        yield subgrid, count, _iso_from_epoch(last_write)


def scan_capture_points() -> Tuple[Dict[str, dict], Optional[str]]:
    """Tile-rig stations (POINT_MODE): the honest progress unit is the capture
    point, not the stitched image. Points live under IN_STAGE (e.g.
    00_Raw_data/<...>/<point>/1..6 camera tile dirs); the blurred mirror lives
    under OUT_STAGE with the same relative path. A point is done when its
    blurred image count reaches the raw image count.

    Returns per-subgrid {points_total, points_done, tiles_done}. Points whose
    path has no SUBGRID_PATTERN segment land in '_unattributed' and are simply
    excluded from the board (visible via this agent endpoint only)."""
    in_root = os.path.join(WATCH_ROOT, IN_STAGE) if WATCH_ROOT and IN_STAGE else ""
    out_root = os.path.join(WATCH_ROOT, OUT_STAGE) if WATCH_ROOT and OUT_STAGE else ""
    if not in_root:
        return {}, "IN stage not configured (set IN_STAGE)"
    if not os.path.isdir(in_root):
        return {}, f"IN stage not listable: {in_root}"

    raw: Dict[str, int] = {}
    for dirpath, dirnames, _ in os.walk(in_root):
        cam_dirs = [d for d in dirnames if d.isdigit() and len(d) <= 2]
        if not cam_dirs:
            continue
        rel = os.path.relpath(dirpath, in_root)
        count = sum(_subdir_image_count(os.path.join(dirpath, d)) for d in cam_dirs)
        dirnames[:] = []
        if count:
            raw[rel.replace(os.sep, "/")] = count
        if len(raw) > 20_000:
            break

    blurred: Dict[str, int] = {}
    if out_root and os.path.isdir(out_root):
        for dirpath, dirnames, _ in os.walk(out_root):
            cam_dirs = [d for d in dirnames if d.isdigit() and len(d) <= 2]
            if not cam_dirs:
                continue
            rel = os.path.relpath(dirpath, out_root)
            count = sum(_subdir_image_count(os.path.join(dirpath, d)) for d in cam_dirs)
            dirnames[:] = []
            if count:
                blurred[rel.replace(os.sep, "/")] = count
            if len(blurred) > 20_000:
                break

    results: Dict[str, dict] = {}
    for rel, raw_count in raw.items():
        sg_key = _subgrid_of_rel(rel) or "_unattributed"
        bucket = results.setdefault(
            sg_key, {"points_total": 0, "points_done": 0, "tiles_done": 0}
        )
        bucket["points_total"] += 1
        done_count = blurred.get(rel, 0)
        if done_count >= raw_count:
            bucket["points_done"] += 1
        bucket["tiles_done"] += min(done_count, raw_count)
    return results, None


def health_payload() -> dict:
    payload: dict = {
        "status": "ok",
        "agent_version": AGENT_VERSION,
        "station_id": STATION_ID,
        "hostname": platform.node(),
        "uptime_sec": int(time.time() - snapshot.start_time),
        "scan_interval_sec": SCAN_INTERVAL_SEC,
    }
    if psutil is not None:
        try:
            payload["cpu_usage"] = psutil.cpu_percent(interval=None)
            payload["cpu_cores"] = psutil.cpu_count(logical=True) or 0
            per_core = psutil.cpu_percent(interval=None, percpu=True)
            # Compact belt for the dashboard: up to 24 cores as 0-100 ints.
            payload["cpu_percpu"] = [int(c) for c in per_core[:24]]
        except Exception:
            pass
        try:
            vm = psutil.virtual_memory()
            payload["ram_total_gb"] = round(vm.total / (1024**3), 2)
            payload["ram_used_gb"] = round((vm.total - vm.available) / (1024**3), 2)
        except Exception:
            pass
        try:
            root = snapshot.watch_root or None
            du = psutil.disk_usage(root) if (root and os.path.isdir(root)) else psutil.disk_usage(os.path.abspath(os.sep))
            total = du.total or 0
            if total:
                payload["disk_total"] = round(total / (1024**3), 1)
                payload["disk_free_gb"] = round(du.free / (1024**3), 1)
                payload["storage_used_pct"] = round(du.used / total * 100, 1)
        except Exception:
            pass
    _maybe_gpu(payload)
    return payload


def _maybe_gpu(payload: dict) -> None:
    """GPU fields are optional (worker /health contract says the same)."""
    try:
        import pynvml  # type: ignore

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        name = pynvml.nvmlDeviceGetName(handle)
        payload["gpu_name"] = name.decode("utf-8", "ignore") if isinstance(name, bytes) else name
        payload["gpu_usage"] = pynvml.nvmlDeviceGetUtilizationRates(handle).gpu
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        payload["gpu_vram_total_gb"] = round(mem.total / (1024**3), 2)
        payload["gpu_vram_used_gb"] = round(mem.used / (1024**3), 2)
    except Exception:
        pass


def detection_loop() -> None:
    while True:
        started = time.time()
        try:
            procs = detect_processes()
            subs, watch_error = scan_output_subgrids()
            points: Dict[str, dict] = {}
            points_error: Optional[str] = None
            if POINT_MODE:
                points, points_error = scan_capture_points()
            with snapshot.lock:
                snapshot.generated_at = _now_iso()
                snapshot.processes = procs
                snapshot.subgrids = subs
                snapshot.watch_error = watch_error
                snapshot.points = points
                snapshot.points_error = points_error
        except Exception as exc:  # keep the loop alive on transient FS errors
            logger.warning("detection scan failed: %s", exc)
        elapsed = time.time() - started
        time.sleep(max(0.5, SCAN_INTERVAL_SEC - elapsed))


app = FastAPI(title="GeoSphere 360 Station Agent", version=AGENT_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    if not WATCH_ROOT:
        logger.warning(
            "WATCH_ROOT not set — output counts disabled; process detection still works."
        )
    threading.Thread(target=detection_loop, name="station-agent-detect", daemon=True).start()
    logger.info(
        "Station agent up: station=%s watch_root=%s out_stage=%s processes=%s",
        STATION_ID,
        WATCH_ROOT or "-",
        OUT_STAGE or "-",
        PROCESS_NAMES or "-",
    )


def _guard(auth: Optional[str]) -> None:
    if API_TOKEN and auth != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized.")


@app.get("/health")
def health(authorization: Optional[str] = Header(default=None)) -> dict:
    _guard(authorization)
    return health_payload()


@app.get("/api/station")
@app.get("/api/station/{station_id}")
def station(
    authorization: Optional[str] = Header(default=None), station_id: Optional[str] = None
) -> dict:
    _guard(authorization)
    if station_id and station_id.strip().lower() != STATION_ID:
        raise HTTPException(status_code=404, detail=f"This agent is station '{STATION_ID}'.")
    return snapshot.as_dict()


class RenameEntry(BaseModel):
    src: str  # filename inside stage_dir (no path separators)
    dst: str  # target filename inside the same folder


class RenameRequest(BaseModel):
    stage_dir: str  # relative to WATCH_ROOT, e.g. 03_Stitching/.../BP_20220630/panoramas
    renames: List[RenameEntry]


@app.post("/api/rename")
def rename_files(req: RenameRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    """Batch-rename stitched outputs to their metadata names on the NAS.

    Safety: stage_dir must resolve inside WATCH_ROOT; every src/dst is reduced
    to a bare filename inside that folder; existing dst files are skipped
    (idempotent re-runs), missing src files are reported.
    """
    _guard(authorization)
    if not WATCH_ROOT:
        raise HTTPException(status_code=400, detail="WATCH_ROOT is not configured on this agent.")
    rel = (req.stage_dir or "").replace("\\", "/").strip("/")
    base = os.path.abspath(os.path.join(WATCH_ROOT, rel))
    watch_abs = os.path.abspath(WATCH_ROOT)
    if base != watch_abs and not base.startswith(watch_abs + os.sep):
        raise HTTPException(status_code=400, detail="stage_dir escapes WATCH_ROOT.")
    if not os.path.isdir(base):
        raise HTTPException(status_code=400, detail=f"stage_dir not listable: {rel}")

    renamed = 0
    skipped: List[dict] = []
    missing: List[str] = []
    for entry in req.renames:
        src = os.path.join(base, os.path.basename((entry.src or "").replace("\\", "/")))
        dst = os.path.join(base, os.path.basename((entry.dst or "").replace("\\", "/")))
        if not entry.src or not entry.dst:
            skipped.append({"src": entry.src, "reason": "empty name"})
        elif not os.path.exists(src):
            missing.append(entry.src)
        elif os.path.exists(dst):
            skipped.append({"src": entry.src, "reason": "target already exists"})
        else:
            try:
                os.rename(src, dst)
                renamed += 1
            except OSError as exc:
                skipped.append({"src": entry.src, "reason": str(exc)})
    return {
        "ok": True,
        "renamed": renamed,
        "skipped": skipped,
        "missing": missing,
        "total": len(req.renames),
        "stage_dir": rel,
        "agent_version": AGENT_VERSION,
    }


# ---------------------------------------------------------------------------
# One-click bucket sync: runs the SAME provider CLI commands the dashboard's
# sync-script block shows (rclone / aws / gsutil / azcopy / supabase CLI /
# robocopy) against the DELIVERABLES folder. Commands are built from a
# provider whitelist (never free-form shell) and executed as an argument list
# without a shell. Progress is polled via GET /api/sync-bucket/{job_id}.
# ---------------------------------------------------------------------------

class SyncBucketRequest(BaseModel):
    provider: str  # r2 | s3 | wasabi | gcs | azure | supabase_cli | nas_local
    stage_dir: str  # relative to WATCH_ROOT, e.g. DELIVERABLES/N93E70
    subgrid: str
    bucket: str = ""
    region: Optional[str] = None
    account: Optional[str] = None
    endpoint: Optional[str] = None
    include_manifest: bool = True


class SyncJob:
    def __init__(self, job_id: str, command_desc: str) -> None:
        self.id = job_id
        self.status = "RUNNING"
        self.command_desc = command_desc
        self.lines: List[str] = []
        self.started_at = _now_iso()
        self.finished_at: Optional[str] = None
        self.exit_code: Optional[int] = None
        self.error: Optional[str] = None

    def as_dict(self) -> dict:
        with _sync_jobs_lock:
            return {
                "ok": True,
                "job_id": self.id,
                "status": self.status,
                "command_desc": self.command_desc,
                "lines": list(self.lines[-30:]),
                "line_count": len(self.lines),
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "exit_code": self.exit_code,
                "error": self.error,
            }


_sync_jobs: Dict[str, SyncJob] = {}
# RLock: poll handlers hold it while calling SyncJob.as_dict(), which also
# locks — a plain Lock would deadlock the uvicorn threadpool.
_sync_jobs_lock = threading.RLock()

CLI_BUILDERS: Dict[str, callable] = {}


def _build_cli(req: SyncBucketRequest, base: str) -> Tuple[List[str], str]:
    """Return (argv, human description). Raises ValueError for unknown
    providers or missing binaries. Providers map 1:1 to the dashboard's
    sync-script block so the executed command is always inspectable."""
    sg = (req.subgrid or "").strip("/")
    if not sg:
        raise ValueError("subgrid is required")
    src = base
    manifest_src = os.path.join(base, "manifest.json")
    provider = req.provider.strip().lower()

    def which(binary: str) -> str:
        found = shutil.which(binary)
        if not found:
            raise ValueError(f"'{binary}' CLI is not installed or not on PATH on this PC ({platform.node()}).")
        return found

    if provider == "r2":
        argv = [which("rclone"), "copy", src, f"r2:{req.bucket}/{sg}/", "--transfers=16", "--checkers=32", "--fast-list"]
        desc = f"rclone copy → r2:{req.bucket}/{sg}/"
    elif provider == "s3":
        argv = [which("aws"), "s3", "sync", src, f"s3://{req.bucket}/{sg}/", "--region", req.region or "ap-southeast-1", "--acl", "public-read"]
        desc = f"aws s3 sync → s3://{req.bucket}/{sg}/"
    elif provider == "wasabi":
        argv = [which("aws"), "s3", "sync", src, f"s3://{req.bucket}/{sg}/",
                "--endpoint-url", f"https://s3.{req.region or 'us-east-1'}.wasabisys.com", "--acl", "public-read"]
        desc = f"aws s3 sync → wasabi s3://{req.bucket}/{sg}/"
    elif provider == "gcs":
        argv = [which("gsutil"), "-m", "rsync", "-r", src, f"gs://{req.bucket}/{sg}/"]
        desc = f"gsutil rsync → gs://{req.bucket}/{sg}/"
    elif provider == "azure":
        endpoint = (req.endpoint or "").rstrip("/") or f"https://{req.account or ''}.blob.core.windows.net"
        argv = [which("azcopy"), "copy", f"{src}*", f"{endpoint}/{sg}/", "--recursive"]
        desc = f"azcopy copy → {endpoint}/{sg}/"
    elif provider == "supabase_cli":
        argv = [which("supabase"), "storage", "cp", "-r", src, f"ss://{req.bucket}/{sg}/"]
        desc = f"supabase storage cp -r → ss://{req.bucket}/{sg}/"
    elif provider == "nas_local":
        dest_root = (req.endpoint or "").rstrip("\\/") or "\\\\NAS\\360_images"
        # No /MT with redirected stdout: multithreaded robocopy buffers output
        # on a separate thread and can deadlock reading the pipe line-by-line.
        argv = ["robocopy", src, os.path.join(dest_root, sg), "/E", "/NJH", "/NJS"]
        desc = f"robocopy {sg} → {dest_root}\\{sg}"
    else:
        raise ValueError(f"Unsupported provider '{provider}' (whitelist: r2, s3, wasabi, gcs, azure, supabase_cli, nas_local)")

    if req.include_manifest and provider not in ("r2", "nas_local"):
        if provider == "s3":
            argv += ["&&", which("aws"), "s3", "cp", manifest_src, f"s3://{req.bucket}/manifest.json"]
        elif provider == "wasabi":
            argv += ["&&", which("aws"), "s3", "cp", manifest_src, f"s3://{req.bucket}/manifest.json",
                     "--endpoint-url", f"https://s3.{req.region or 'us-east-1'}.wasabisys.com"]
        elif provider == "gcs":
            argv += ["&&", which("gsutil"), "cp", manifest_src, f"gs://{req.bucket}/manifest.json"]
        elif provider == "azure":
            endpoint = (req.endpoint or "").rstrip("/") or f"https://{req.account or ''}.blob.core.windows.net"
            argv += ["&&", which("azcopy"), "copy", manifest_src, f"{endpoint}/manifest.json"]
        elif provider == "supabase_cli":
            argv += ["&&", which("supabase"), "storage", "cp", manifest_src, f"ss://{req.bucket}/manifest.json"]
    return argv, desc


def _run_sync_job(job: SyncJob, argv: List[str]) -> None:
    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            with _sync_jobs_lock:
                job.lines.append(line.rstrip())
        code = proc.wait(timeout=3600)
        with _sync_jobs_lock:
            job.exit_code = code
            # robocopy exit codes 0-7 are success grades; >=8 is failure.
            ok = code == 0 or (job.command_desc.startswith("robocopy") and 0 <= code < 8)
            job.status = "DONE" if ok else "FAILED"
            if not ok:
                job.error = f"CLI exited with code {code}"
            job.finished_at = _now_iso()
    except Exception as exc:
        with _sync_jobs_lock:
            job.status = "FAILED"
            job.error = str(exc)
            job.finished_at = _now_iso()


@app.post("/api/sync-bucket")
def start_sync_bucket(req: SyncBucketRequest, authorization: Optional[str] = Header(default=None)) -> dict:
    _guard(authorization)
    if not WATCH_ROOT:
        raise HTTPException(status_code=400, detail="WATCH_ROOT is not configured on this agent.")
    rel = (req.stage_dir or "").replace("\\", "/").strip("/")
    base = os.path.abspath(os.path.join(WATCH_ROOT, rel))
    watch_abs = os.path.abspath(WATCH_ROOT)
    if base != watch_abs and not base.startswith(watch_abs + os.sep):
        raise HTTPException(status_code=400, detail="stage_dir escapes WATCH_ROOT.")
    if not os.path.isdir(base):
        raise HTTPException(status_code=400, detail=f"stage_dir not listable: {rel}")

    try:
        argv, desc = _build_cli(req, base)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    job_id = uuid.uuid4().hex[:12]
    job = SyncJob(job_id, desc)
    with _sync_jobs_lock:
        _sync_jobs[job_id] = job
    threading.Thread(target=_run_sync_job, args=(job, argv), daemon=True).start()
    return {"ok": True, "job_id": job_id, "command_desc": desc, "status": "RUNNING"}


@app.get("/api/sync-bucket/{job_id}")
def poll_sync_bucket(job_id: str, authorization: Optional[str] = Header(default=None)) -> dict:
    _guard(authorization)
    with _sync_jobs_lock:
        job = _sync_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Sync job not found.")
        return job.as_dict()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
