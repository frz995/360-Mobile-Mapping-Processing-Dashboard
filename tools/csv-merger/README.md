# GeoSphere 360 — Panorama CSV Toolkit (tools/csv-merger)

A tiny local web service that replaces the external "2CSV app": it **sorts**
per-tour panorama metadata CSVs into your metadata folder, then **merges** all
same-date tour CSVs into a single file per date (e.g. `20220904.csv`).

- Pure Python + FastAPI. Nothing is uploaded anywhere; it only touches the
  folders you type into the UI.
- Sources are never modified or deleted — sorting copies, merging only writes
  new files into the chosen output folder.
- Merged output keeps the tour/date name (default `YYYYMMDD.csv`) so records
  stay unambiguous; an override field allows `panorama.csv`.
- Re-running a merge is safe: files already named as a pure 8-digit date are
  recognized as previous outputs and skipped.
- CSVs are read as UTF-8 (BOM ok) with a cp1252 fallback, and written as
  `utf-8-sig` so Excel opens merged files cleanly.

## Run

```powershell
py tools\csv-merger\app.py
```

Opens `http://127.0.0.1:8600` in your browser (override port with
`$env:CSV_MERGER_PORT`). Use **Shutdown the service** in the page to stop it.

## Workflow

1. **1 · Sort Panoramas** — input: any tour folder (e.g. the subgrid folder
   `...\Project-IN\Grid 1\N93E70` or a single `20220904` date folder); output:
   the metadata folder (e.g. `...\01_Metadata\GRID_1\N93E70`, created if
   missing). The scan is recursive: a nested export like
   `003485-20220904-144310\7\panoramas.csv` is copied in renamed to its tour
   name `003485-20220904-144310.csv`. Only panorama CSVs are handled —
   `tracks.csv` and log files are skipped.
2. **2 · Merge Metadata** — input: the metadata folder. Files named like
   `003485-20220904-144310.csv` are grouped by the `YYYYMMDD` token and each
   group is merged (header once, rows in capture-time order) into
   `20220904.csv` inside the same folder (or a chosen output folder). If a
   file's header differs from the first file of its group, rows are still
   appended and a warning is listed in the result.
3. **3 · Master Merge** — input: the subgrid folder itself (e.g.
   `...\01_Metadata\GRID_1\N93E70`). Every child merged file from step 2
   (`20220904.csv`, `20220905.csv`, …) is rolled up — dates oldest first —
   into a single master file named after the subgrid folder, e.g.
   `N93E70.csv`, written beside them (or into a chosen output folder). Raw
   tour CSVs and the master file itself are never re-read, so re-running is
   safe and nothing counts twice.

## Browse buttons

Every folder field has a **Browse** button that opens a native Windows folder
picker served by the local process (it only works when the app runs on the
same machine as the browser — which is the normal case).

## Tests

```powershell
py -m pytest tools\csv-merger\tests -q
```
