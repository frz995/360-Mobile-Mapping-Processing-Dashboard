"""GeoSphere 360 — Panorama CSV Toolkit (local web service).

Run:  py tools/csv-merger/app.py   ->  http://127.0.0.1:8600
"""

from __future__ import annotations

import os
import subprocess
import threading
import webbrowser
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

import core

HOST = '127.0.0.1'
PORT = int(os.environ.get('CSV_MERGER_PORT', '8600'))

app = FastAPI(title='GeoSphere 360 Panorama CSV Toolkit')

STATIC_DIR = Path(__file__).resolve().parent / 'static'


def _pick_folder_powershell() -> Optional[str]:
    script = (
        'Add-Type -AssemblyName System.Windows.Forms; '
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog; '
        '$d.Description = "Select folder"; '
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }'
    )
    r = subprocess.run(['powershell', '-NoProfile', '-STA', '-Command', script],
                       capture_output=True, text=True)
    out = r.stdout.strip()
    return out or None


def _pick_folder() -> Optional[str]:
    path = ''
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        path = filedialog.askdirectory(title='Select folder', mustexist=True) or ''
        root.destroy()
    except Exception:
        path = _pick_folder_powershell() or ''
    if not path:
        return None
    return path.replace('/', '\\') if os.name == 'nt' else path


class PathForm(BaseModel):
    input_path: str
    output_path: Optional[str] = None
    output_name: Optional[str] = None


@app.get('/')
def index():
    return FileResponse(STATIC_DIR / 'index.html')


@app.get('/api/validate')
def validate(path: str = ''):
    d = Path(path.strip('"').strip())
    if not path or not d.is_dir():
        return {'exists': False, 'csv_count': 0}
    return {'exists': True, 'csv_count': len(core.collect_csvs(d))}


@app.post('/api/browse')
def browse():
    return {'path': _pick_folder()}


@app.post('/api/sort')
def sort(form: PathForm):
    src = Path(form.input_path.strip('"').strip())
    if not src.is_dir():
        raise HTTPException(status_code=400, detail='Input folder does not exist.')
    if not form.output_path:
        raise HTTPException(status_code=400, detail='Output folder is required for sorting.')
    return core.sort_copy(src, Path(form.output_path.strip('"').strip()))


@app.post('/api/merge')
def merge(form: PathForm):
    src = Path(form.input_path.strip('"').strip())
    if not src.is_dir():
        raise HTTPException(status_code=400, detail='Input folder does not exist.')
    out = Path(form.output_path.strip('"').strip()) if form.output_path else None
    return core.merge_csvs(src, out, form.output_name)


@app.post('/api/master')
def master(form: PathForm):
    src = Path(form.input_path.strip('"').strip())
    if not src.is_dir():
        raise HTTPException(status_code=400, detail='Parent metadata folder does not exist.')
    out = Path(form.output_path.strip('"').strip()) if form.output_path else None
    return core.master_merge(src, out, form.output_name)


@app.post('/api/shutdown')
def shutdown():
    threading.Timer(0.3, os._exit, args=(0,)).start()
    return {'ok': True}


if __name__ == '__main__':
    import uvicorn

    threading.Timer(1.0, lambda: webbrowser.open(f'http://{HOST}:{PORT}')).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level='warning')
