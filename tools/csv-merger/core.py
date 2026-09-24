"""Pure sort/merge logic for the GeoSphere 360 Panorama CSV Toolkit.

No server imports here — everything is plain filesystem work so the same
functions can be unit-tested directly. Sources are never modified; output
files are only written into the chosen output folder.
"""

from __future__ import annotations

import csv
import io
import re
import shutil
from pathlib import Path

DATE_RE = re.compile(r'(?<!\d)(20\d{6})(?!\d)')
TIME_RE = re.compile(r'(?<!\d)(\d{6})(?!\d)')
MERGED_STEM_RE = re.compile(r'^\d{8}$')


def is_panorama_csv(path: Path) -> bool:
    stem = path.stem.lower()
    return stem.startswith('panorama') or bool(DATE_RE.search(stem))


def _nearest_tour(f: Path) -> str | None:
    for parent in f.parents:
        if DATE_RE.search(parent.name) and not MERGED_STEM_RE.match(parent.name):
            return parent.name
    return None


def target_name(f: Path) -> str:
    """Nested exports like …\\003485-20220904-144310\\7\\panoramas.csv are
    stored under their tour folder name; anything else keeps its own name."""
    if f.stem.lower().startswith('panorama'):
        tour = _nearest_tour(f)
        if tour:
            return f'{tour}.csv'
    return f.name


def collect_csvs(folder) -> list[Path]:
    """Every panorama-relevant CSV under the folder (recursive): files named
    panorama*.csv or carrying a YYYYMMDD token. tracks.csv and other
    non-panorama files are never considered."""
    base = Path(folder)
    if not base.is_dir():
        return []
    return sorted(p for p in base.rglob('*')
                  if p.is_file() and p.suffix.lower() == '.csv' and is_panorama_csv(p))


def date_of(name: str) -> str | None:
    m = DATE_RE.search(Path(name).stem)
    return m.group(1) if m else None


def time_of(stem: str) -> str:
    rest = DATE_RE.sub('', stem, count=1)
    m = TIME_RE.search(rest)
    return m.group(1) if m else ''


def _decode_csv_bytes(data: bytes) -> str:
    for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('latin-1')


def read_csv(path):
    text = _decode_csv_bytes(Path(path).read_bytes())
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if not rows:
        return None, []
    return rows[0], rows[1:]


def write_csv(path, header, rows) -> None:
    buf = io.StringIO()
    writer = csv.writer(buf)
    if header is not None:
        writer.writerow(header)
    writer.writerows(rows)
    Path(path).write_bytes(buf.getvalue().encode('utf-8-sig'))


def sort_copy(input_dir, output_dir) -> dict:
    """Copy every tour CSV (root + one level of date subfolders) into the
    metadata output folder, preserving filenames. Duplicates are renamed."""
    src_files = collect_csvs(input_dir)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    copied: list[dict] = []
    warnings: list[str] = []
    for f in src_files:
        if out in f.parents:
            warnings.append(f"{f.name}: source already sits in the output folder, left untouched")
            continue
        target = out / target_name(f)
        if target.exists():
            i = 1
            while (out / f"{target.stem}_{i}{target.suffix}").exists():
                i += 1
            renamed = f"{target.stem}_{i}{target.suffix}"
            warnings.append(f"{f.name}: name taken in output folder, saved as {renamed}")
            target = out / renamed
        if target.resolve() == f.resolve():
            warnings.append(f"{f.name}: source already sits in the output folder, left untouched")
            continue
        shutil.copy2(f, target)
        copied.append({'source': str(f), 'copied_as': target.name, 'bytes': target.stat().st_size})

    return {'copied': copied, 'warnings': warnings, 'output_folder': str(out)}


def master_merge(input_dir, output_dir=None, output_name=None) -> dict:
    """Roll the child merger outputs (YYYYMMDD.csv files written by step 2) of
    one subgrid folder into a single master file named after the subgrid
    (e.g. N93E70.csv). Raw tour CSVs and the master file itself are ignored,
    so re-running is safe."""
    base = Path(input_dir)
    out = Path(output_dir) if output_dir else base
    out.mkdir(parents=True, exist_ok=True)

    master_stem = (output_name or base.name).strip()
    if master_stem.lower().endswith('.csv'):
        master_stem = master_stem[:-4]
    master_name = f'{master_stem}.csv'

    csvs = [p for p in sorted(base.iterdir()) if p.is_file() and p.suffix.lower() == '.csv']
    children = [p for p in csvs if MERGED_STEM_RE.match(p.stem)]
    ignored = len([p for p in csvs if not MERGED_STEM_RE.match(p.stem)])

    warnings: list[str] = []
    if master_stem in {c.stem for c in children}:
        warnings.append(f'Master name "{master_stem}" matches an existing child file — choose a different name')
        return {'outputs': [], 'warnings': warnings, 'skipped': [], 'ignored': ignored, 'output_folder': str(out)}
    if not children:
        warnings.append('No child merged files (YYYYMMDD.csv) found in this folder — run Merge Metadata first')

    header = None
    rows: list[list[str]] = []
    merged_from: list[str] = []
    for c in children:  # sorted by date stem
        h, r = read_csv(c)
        if h is None:
            warnings.append(f"{c.name}: empty file, skipped")
            continue
        if header is None:
            header = h
        elif h != header:
            warnings.append(f"{c.name}: header differs ({len(h)} cols vs {len(header)}), rows appended as-is")
        rows.extend(r)
        merged_from.append(c.name)

    outputs: list[dict] = []
    if merged_from:
        write_csv(out / master_name, header, rows)
        outputs.append({'file': master_name, 'merged_from': merged_from, 'rows': len(rows), 'bytes': (out / master_name).stat().st_size})

    return {'outputs': outputs, 'warnings': warnings, 'skipped': [], 'ignored': ignored, 'output_folder': str(out)}


def merge_csvs(input_dir, output_dir=None, output_name=None) -> dict:
    """Merge tour CSVs into one file per YYYYMMDD date group. Files already
    named as a pure 8-digit date (previous merged outputs) are skipped, so
    re-running a merge is idempotent."""
    files = collect_csvs(input_dir)
    out = Path(output_dir) if output_dir else Path(input_dir)
    out.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    skipped: list[dict] = []
    groups: dict[str, list[tuple[str, Path]]] = {}

    for f in files:
        if MERGED_STEM_RE.match(f.stem):
            skipped.append({'file': f.name, 'reason': 'existing merged output'})
            continue
        d = date_of(f.name) or date_of(f.parent.name)
        if not d:
            skipped.append({'file': f.name, 'reason': 'no YYYYMMDD date token in file or parent folder name'})
            continue
        groups.setdefault(d, []).append((time_of(f.stem), f))

    outputs: list[dict] = []
    for date_key in sorted(groups):
        header = None
        rows: list[list[str]] = []
        merged_from: list[str] = []
        for _, f in sorted(groups[date_key], key=lambda t: (t[0], t[1].name.lower())):
            h, r = read_csv(f)
            if h is None:
                warnings.append(f"{f.name}: empty file, skipped")
                continue
            if header is None:
                header = h
            elif h != header:
                warnings.append(f"{f.name}: header differs ({len(h)} cols vs {len(header)}), rows appended as-is")
            rows.extend(r)
            merged_from.append(f.name)
        if not merged_from:
            continue

        if output_name and len(groups) == 1:
            fname = output_name.strip()
            if not fname.lower().endswith('.csv'):
                fname += '.csv'
        else:
            fname = f"{date_key}.csv"

        write_csv(out / fname, header, rows)
        outputs.append({'file': fname, 'merged_from': merged_from, 'rows': len(rows), 'bytes': (out / fname).stat().st_size})

    return {'outputs': outputs, 'warnings': warnings, 'skipped': skipped, 'output_folder': str(out)}
