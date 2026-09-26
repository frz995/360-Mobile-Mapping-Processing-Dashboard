# GeoSphere 360 Station Agent

Small FastAPI service installed **once per workstation PC** so the Production
Hub's `4-PC Multi-Station Flight Board` becomes fully automatic: the board
flips a station to **In Progress** the moment an operator launches the mapped
application, and live frame counts stream in from the station's output folder.

```
PC1..PC4 ──install──► station agent (port 8000)
Dashboard ──poll every 10 s──► GET /health + GET /api/station
Dashboard ──upsert──► Supabase station_board_items (board survives refresh)
```

## What it detects

| Signal | Source | Board effect |
| --- | --- | --- |
| Named work process running | psutil (`PROCESS_NAMES`) | Status `IN_PROGRESS`, `Started` timestamp from the real process start time |
| Output files written | `<WATCH_ROOT>/<OUT_STAGE>/<subgrid>/` | `Done` counter + pipeline % become live |
| Capture points finished (tile rigs) | `POINT_MODE`: raw `<IN_STAGE>/<...>/<point>/1..6` vs blurred mirror `<OUT_STAGE>/...` | Blur station counts `X of Y pts (Z tiles)` — see below |
| Process ended + below target | both | Status `FLAGGED` (early exit) — restart the app to resume |
| Process ended + target reached | both | Status `COMPLETED` automatically |

## Capture-point counting (tile rigs, default on for PC 1)

Raw mobile-mapping rigs are not single images: each capture **point** folder
(e.g. `003485-20220904-144310`) holds camera tile dirs `1..6` with several
tiles each — the stitchable panorama only exists after PC 2 (PTGui). Counting
"images" on PC 1 would therefore be meaningless, so the blur agent defaults
`POINT_MODE=1` and reports per subgrid:

```json
"points": {
  "stage_in": "00_Raw_data",
  "point_mode": true,
  "subgrids": {
    "N93E70": { "points_total": 5, "points_done": 2, "tiles_done": 108 }
  },
  "error": null
}
```

- A **point** is any folder whose children are digit-named camera dirs (`1..6`)
  or a flat folder holding images directly.
- A point is **done** when the mirrored point under `<OUT_STAGE>` has at least
  as many image tiles as the raw point (blur never drops tiles).
- Points are attributed to a subgrid when a path segment matches
  `SUBGRID_PATTERN` (default `^[A-Za-z]{1,3}[0-9A-Za-z]{2,11}$`, e.g.
  `N93E70`). Non-matching trees land in `_unattributed` and are ignored by
  the board instead of being mislabelled.
- The board shows `2 / 5 pts` for these stations and notes the blurred-tile
  count, while PC 2-4 keep counting stitched frames.

## POST /api/rename — batch rename on the NAS

Used by Stitched Intake & Pairing's **Rename Batch** action to rename stitched
outputs (e.g. `003485-20220630-170708-000000001.jpg`) to their metadata names
(`N93E70-0093.jpg`) directly on disk:

```json
{
  "stage_dir": "03_Stitching/Project-OUT/Grid 1/N93E70/BP_20220630/panoramas",
  "renames": [{ "src": "003485-20220630-170708-000000001.jpg", "dst": "N93E70-0093.jpg" }]
}
```

```json
{ "ok": true, "renamed": 196, "skipped": [{"src": "...", "reason": "target already exists"}], "missing": ["..."], "total": 196 }
```

Safety: `stage_dir` must resolve inside `WATCH_ROOT`; `src`/`dst` are reduced
to bare filenames inside that folder; an existing `dst` is skipped so re-runs
are idempotent; missing sources are reported, never guessed. Send
`Authorization: Bearer <AGENT_TOKEN>` when a token is configured.

If the agent is unreachable, the board falls back to the last
`station_board_items` snapshot persisted in Supabase, so the operator in the
field still sees one authoritative state instead of a blank board.

## Install (per PC, Windows)

1. Copy the `station-agent/` folder from this repo to e.g. `C:\station-agent`.
2. Create the venv once:
   ```powershell
   py -3.10 -m venv .venv
   .venv\Scripts\python -m pip install -r requirements.txt
   ```
3. `copy .env.example .env` and edit it:
   - `STATION_ID` — `blur` | `stitch` | `lightroom` | `photoshop`
   - `WATCH_ROOT` — the NAS base path **as mapped on that PC** (e.g. `P:\\` or `\\NAS\\360_images`)
   - `PROCESS_NAMES` — lower-case exe substrings for the station's app:
     | PC | Station | Suggested value |
     | --- | --- | --- |
     | PC 1 | Privacy Blur | `privacykeeper.exe,blur` (confirm the real exe) |
     | PC 2 | PTGui Stitching | `ptgui.exe,ptguipro.exe` |
     | PC 3 | Lightroom Classic | `lightroom.exe,lightroomclassic` |
     | PC 4 | Photoshop | `photoshop.exe` |
4. Test-run:
   ```powershell
   .venv\Scripts\python app.py
   # then from any machine:
   curl http://<station-ip>:8000/health
   curl http://<station-ip>:8000/api/station
   ```
5. Autostart at logon: Task Scheduler → Create Basic Task → Trigger
   "When the computer starts"/"At log on" → Action "Start a program" →
   `C:\station-agent\run_agent.bat`. Optionally allow inbound TCP 8000 for the
   LAN (`New-NetFirewallRule -DisplayName "Station Agent" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow`).

## Dashboard wiring

- The board reads station IPs/ports from **Providers → Workstations**
  (`project_settings.settings.workstationsConfig`), the same list the Worker
  Monitor already pings. Default port is `8000`.
- Optional shared secret: set `AGENT_TOKEN` in each PC's `.env` and the same
  value in the dashboard's project settings under the station's agent token
  (`stationAgentToken`) — probes then send `Authorization: Bearer <token>`.
- Handles `/health` (worker-compatible shape, consumed by Worker Monitor) and
  `/api/station` (auto-detection payload).

## API

### GET /health

Same contract as the NAS GPU Worker (`docs/production_worker_api.md`); all
resource fields are optional and included when available:

```json
{
  "status": "ok",
  "agent_version": "1.0.0",
  "station_id": "stitch",
  "hostname": "PC2",
  "uptime_sec": 86400,
  "cpu_usage": 34,
  "cpu_cores": 16,
  "cpu_percpu": [12, 44, 8, 91],
  "ram_total_gb": 32,
  "ram_used_gb": 12.5,
  "disk_total": 1024.0,
  "disk_free_gb": 512.1,
  "gpu_name": "NVIDIA GeForce RTX 3080",
  "gpu_usage": 11,
  "storage_used_pct": 42
}
```

`cpu_percpu`, `disk_total` / `disk_free_gb` and the GPU fields are optional
and included when available — the Production Hub's **PC Monitoring & Remote
Desktop** tab renders 4 live cards + a 2×2 embedded remote-desktop quad
(native `.rdp` handoff for the full console) from this payload.

### GET /api/station

```json
{
  "agent_version": "1.0.0",
  "station_id": "stitch",
  "hostname": "PC2",
  "generated_at": "2026-09-26T08:00:00+00:00",
  "task": {
    "started": true,
    "processes": [{ "name": "ptgui.exe", "pid": 4021, "started_at": "2026-09-26T07:58:00+00:00" }],
    "first_started_at": "2026-09-26T07:58:00+00:00"
  },
  "output": {
    "root": "\\\\NAS\\360_images",
    "stage": "03_Stitching",
    "subgrids": {
      "N93E70": { "files": 61, "last_write_at": "2026-09-26T07:59:58+00:00", "growing": true }
    }
  },
  "points": {
    "stage_in": "02_Blurring",
    "point_mode": false,
    "subgrids": {},
    "error": null
  },
  "watch_error": null
}
```

A station `watch_error` (e.g. `WATCH_ROOT/OUT_STAGE not configured`) is surfaced
on the Flight Board so misconfiguration is visible instead of silent.
