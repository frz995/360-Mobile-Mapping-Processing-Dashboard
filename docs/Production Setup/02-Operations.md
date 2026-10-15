# GeoSphere 360 — On-Premises Setup and Operations

Part 2 of the Production Setup documentation. Covers the on-premises half —
the NAS layout, the worker, the station agents — then first-run configuration
in the application and how to verify the install.

- [§1 NAS layout](#1-nas-layout)
- [§2 NAS Worker](#2-nas-worker)
- [§3 Station Agents](#3-station-agents)
- [§4 First-run configuration](#4-first-run-configuration)
- [§5 Verification](#5-verification)

---

## 1. NAS layout

The worker and the agents read the survey filesystem directly. By default, the system follows a standard production stage layout, but the worker now features **adaptive dynamic stage discovery** — it automatically detects alternative grid folders (e.g. `Grid 2`, `Grid 3`), flat stage layouts, and custom folder names, as well as optional environment overrides (`NAS_STITCH_STAGE`, `NAS_METADATA_STAGE`, etc.).

### 1.1 Recommended standard tree

Set `NAS_BASE_PATH` (worker) and `WATCH_ROOT` (agents) to the **root** of this tree:

```
<NAS_BASE_PATH>/
│
├── 00_Raw_data/                          capture points, per station tile
│   └── Grid 1/                           ← literal "Grid 1", WITH the space
│       └── <SUBGRID>/
│           └── <run>/                    e.g. 20220904
│               ├── 1/ 2/ 3/ 4/ 5/ 6/      camera tiles; digits only
│               │     └── *.jpg .jpeg .png .tif .tiff .insp
│               └── <point>.jpg           flat fallback
│
├── 01_Metadata/                          GNSS/IMU telemetry
│   └── Grid 1/                           ← literal "Grid 1"
│       └── <SUBGRID>/
│           └── <run>/                    ← must match the 03_Stitching run name
│               └── *.csv
│
├── 02_Blurring/                          agent only — blur station output
│   └── <SUBGRID>/
│
├── 03_Stitching/                         stitched panoramas  ← primary source
│   └── Project-OUT/                      ← extra level, see note
│       └── Grid 1/
│           └── <SUBGRID>/
│               └── <run>/                e.g. BP_20220630
│                   ├── *.jpg            layout A: single equirectangular
│                   └── panoramas/       layout B: tiled cubemap
│                       └── panorama-tiles/
│
├── 04_Lightroom/                         agent only — Lightroom output
│   └── <SUBGRID>/
│
├── 05_Final/                             final deliverable imagery
│   └── Project-OUT/                      ← extra level
│       └── Grid 1/
│           └── <SUBGRID>/
│               └── <run>/
│                   ├── *.jpg
│                   ├── panoramas/
│                   └── panorama-tiles/
│
└── DELIVERABLES/                         agent only — bucket upload target
    └── <SUBGRID>/
        └── <runCode>/                    e.g. N93E70-2026-09-25-R001
            ├── *.jpg
            └── manifest.json
```

### 1.2 The depth rules — read carefully

Three different conventions are in play, and mixing them up fails quietly:

| Stage folder | Extra `Project-OUT/` level? | `Grid 1` level? |
| --- | :---: | :---: |
| `00_Raw_data` | No | **Yes** |
| `01_Metadata` | No | **Yes** |
| `02_Blurring` | No | **No** |
| `03_Stitching` | **Yes** | **Yes** |
| `04_Lightroom` | No | **No** |
| `05_Final` | **Yes** | **Yes** |
| `DELIVERABLES` | No | **No** |

- **`Grid 1` is a literal folder name containing a space.** On Linux, make sure
  the mount preserves it.
- The **run folder name is the join key** between `03_Stitching/<SG>/<run>` and
  `01_Metadata/Grid 1/<SG>/<run>`. If they differ, GPS metadata is not joined to
  imagery and the intake pairing reports zero coordinates.
- `02_Blurring`, `04_Lightroom` and `DELIVERABLES` have **no** path constraint at
  all — the agent treats their first-level directories as subgrids.

### 1.3 Subgrid naming

Use the **uppercase GIS form**, e.g. `N93E70` or `N01E037`. The codebase applies
three different subgrid patterns for three different purposes, and the uppercase
GIS form is the only shape that satisfies all three. Lowercase works on the
worker but is handled inconsistently by the agents.

### 1.4 Access

The worker and agents need **read** access to everything, and **write** access to
`DELIVERABLES` (bucket upload) and to the `panoramas/` folder when renaming.

Grant the service account read on the tree, and write only where required.

---

## 2. NAS Worker

A single small Python service that runs on the NAS PC and exposes the survey
filesystem. It is **read-only** — it does not process, move, or delete imagery.

### 2.1 Install

**Windows**

```powershell
cd <repo>\worker
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Linux**

```bash
cd <repo>/worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Dependencies are deliberately minimal — FastAPI, uvicorn and python-dotenv. There
are no OpenCV, numpy or torch installs.

### 2.2 Configure

Copy the template and fill it in:

```powershell
copy .env.example .env      # Windows
```

```ini
# Root of the survey tree. Every path the dashboard sends resolves under this,
# and any path escaping it is rejected with HTTP 400.
NAS_BASE_PATH=X:\nas\360_images

# Shared secret. Required on any non-loopback bind. The Pages Functions and the
# Vite dev proxy inject this header server-side; the browser never sees it.
NAS_WORKER_TOKEN=<generate a long random string>

# Seconds a storage response is cached before the volume is re-probed.
STORAGE_CACHE_TTL=30

# 1 = structured JSON logs to stdout.
NAS_LOG_JSON=0

# Identifier reported on /health, so several workers behind one endpoint can be
# told apart. Defaults to the machine hostname.
NAS_WORKER_ID=
```

Generate a token with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

> ⚠️ `NAS_WORKER_TOKEN` is **required**. The worker refuses every guarded route
> with HTTP 503 when it is unset; it no longer treats a blank token as
> "authentication disabled". An unauthenticated survey filesystem is a
> convenience on one trusted LAN and an open door on a shared installation, and
> since migration `0043` each company's worker carries its own token.
>
> Per-company tokens for a shared (Track 1) installation are recorded in the
> `organization_workers` table rather than in the Pages environment — see
> `docs/Deployment-Topology.md` §4.2. The environment variable remains the
> path for a single-tenant install.

### 2.3 Run

```bash
uvicorn app:app --host 127.0.0.1 --port 8000
```

Bind to **loopback only**. The Cloudflare Tunnel on the same machine terminates
TLS and is the sole public entry point. Do not bind `0.0.0.0` unless you also
restrict the port at the firewall.

Run it as a service for autostart (NSSM on Windows, systemd on Linux) using the
same pattern as the agents in §3.6.

### 2.4 Verify

```bash
curl http://127.0.0.1:8000/health
```

```json
{ "status": "ok", "nas_base": "X:\\nas\\360_images", "worker": "NAS-PC-01" }
```

Test an authenticated data route:

```bash
curl -H "Authorization: Bearer <NAS_WORKER_TOKEN>" "http://127.0.0.1:8000/api/nas-scan?action=subgrids"
```

Expected — your subgrid present means the folder tree is correct:

```json
{
  "success": true,
  "basePath": "X:\\nas\\360_images",
  "detectedSubgrids": ["N93E70"],
  "subgrids": [{ "code": "N93E70", "existsInStitching": true, "label": "N93E70" }]
}
```

`detectedSubgrids` empty ⇒ the tree in §1.1 does not match. Walk up from
`NAS_BASE_PATH` and confirm `03_Stitching/Project-OUT/Grid 1/` exists.

Also check storage telemetry:

```bash
curl -H "Authorization: Bearer <NAS_WORKER_TOKEN>" http://127.0.0.1:8000/api/storage
```

### 2.5 Run the worker tests

```bash
cd worker
PYTHONPATH=. python -m pytest tests -q
```

Covers the conditional-GET/304 preview behaviour and the six scan actions.
`python-dotenv` must be installed or the HTTP tests skip silently.

---

## 3. Station Agents

One per workstation. Each reports that PC's progress, supports NAS rename, and
can run the bucket upload CLI locally.

### 3.1 Station roles

| `STATION_ID` | PC | Software | Output stage (default) | Reads |
| --- | :-- | --- | --- | --- |
| `blur` | 1 | Privacy / blur tool | `02_Blurring` | `00_Raw_data` |
| `stitch` | 2 | Stitching software | `03_Stitching` | `02_Blurring` |
| `lightroom` | 3 | Lightroom Classic | `04_Lightroom` | `03_Stitching` |
| `photoshop` | 4 | Photoshop batch | `05_Final` | `04_Lightroom` |

Only these four values are accepted. Any other value yields an empty stage and a
watch error.

### 3.2 Install

On **each** of the four PCs:

```powershell
copy <repo>\station-agent <C:\station-agent> /r /e

cd C:\station-agent
py -3.10 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

Dependencies: FastAPI, uvicorn, **psutil**, python-dotenv.

> `psutil` is optional at runtime but you should install it. Without it the agent
> cannot detect workstation processes, so the Flight Board never leaves
> "awaiting agent" and per-station CPU/RAM/disk telemetry is absent.

### 3.3 Configure

```powershell
copy .env.example .env
```

```ini
# Identity. MUST be one of: blur | stitch | lightroom | photoshop
STATION_ID=stitch

# The NAS root AS MAPPED ON THIS PC (drive letter or UNC path).
WATCH_ROOT=X:\nas\360_images

# Overrides, only if your layout differs from §1.
# OUT_STAGE=03_Stitching
# IN_STAGE=02_Blurring

# 1 = count capture POINTS instead of stitched images.
# Defaults to 1 for blur, 0 for the others.
# POINT_MODE=0

# Substrings matched against running process names/paths, comma separated.
# Match your actual software.
PROCESS_NAMES=ptgui.exe,ptguipro.exe

# Watch loop period, and the "file is still growing" window in seconds.
SCAN_INTERVAL_SEC=5
GROWING_WINDOW_SEC=90

# Shared secret. Required unless the agent is unreachable from anywhere but
# this LAN.
AGENT_TOKEN=<generate a long random string per station>

# Bind address and port. Keep 0.0.0.0 only with a firewall rule.
AGENT_HOST=0.0.0.0
AGENT_PORT=8000
```

Use a **different `AGENT_TOKEN` per station**, and register each one in
`STATION_AGENT_TOKENS`.

> **Optional GPU telemetry.** To show GPU cards on the PC monitoring screen,
> also install `pynvml` — it is not in `requirements.txt`:
> ```powershell
> .\.venv\Scripts\python -m pip install pynvml
> ```
> It needs an NVIDIA driver. Without it the card falls back to a browser-reported
> approximation.

### 3.4 Verify

```powershell
.\.venv\Scripts\python app.py
```

In another shell:

```powershell
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "agent_version": "1.0.0",
  "station_id": "stitch",
  "hostname": "PC2",
  "uptime_sec": 86400,
  "cpu_usage": 12,
  "cpu_cores": 16,
  "ram_total_gb": 32,
  "ram_used_gb": 14.2
}
```

Then check the station payload:

```powershell
curl -H "Authorization: Bearer <AGENT_TOKEN>" http://localhost:8000/api/station
```

Check `watch_error` is `null` (means `WATCH_ROOT` resolved) and that
`output.subgrids` lists your subgrids. If `watch_error` is set, the path is wrong
for this PC — a drive letter that exists on one machine often does not exist on
another.

### 3.5 Firewall

The agent binds port 8000 with no TLS. Restrict it to the LAN:

```powershell
New-NetFirewallRule -DisplayName "GeoSphere Station Agent" `
  -Direction Inbound -LocalPort 8000 -Protocol TCP `
  -Action Allow -Profile Domain
```

The Cloudflare Tunnel is outbound-only and needs no inbound rule.

### 3.6 Autostart

**Windows** — Task Scheduler → Create Task:

- Trigger: **At startup**
- Action: **Start a program** → `C:\station-agent\run_agent.bat`
- "Run only when user is logged on" is fine
- Start in: `C:\station-agent`

**Linux** — systemd unit pointing at the venv's uvicorn.

---

## 4. Onboarding a client company

> **This section is the seller's job**, and it is done in the **Seller Console**
> at `https://app.geosphere.my/console`, not in the application. It replaces the
> old "each client installs their own platform" model.
>
> Before starting, confirm migration `0044` is applied. Without it the console
> refuses to open — see [01-Infrastructure.md §2.3a](01-Infrastructure.md#23a-migrations-0036-0045-are-the-multi-tenancy-layer).

### 4.1 Create the company

**Seller Console -> Companies -> Add Client Company.**

| Field | Notes |
| --- | --- |
| **Company Name** | The client's legal or trading name |
| **Client Code** | Short unique reference, e.g. `TNB-LV-2026`. Must be unique across the platform |
| **Contact Email** | The main point of contact. Shown on the company row |
| **Status** | `active`, `trial`, `suspended` or `expired`. A `suspended` or `expired` company grants **nobody** access, even after invitations are accepted |
| **Licensed Seats** | How many people may hold an active membership. See the limit note below |
| **Storage Quota (GB)** | An allocation figure. **Not enforced** — see §4.7 |
| **Database Routing** | `cloud_shared` isolates the company by Row-Level Security on the shared cluster. `dedicated_external` stores credentials for that company's own instance |

> **Seat limits are reported, not enforced.** The Seat Licenses panel shows
> licensed seats beside confirmed members and highlights any company above its
> limit, but nothing refuses a write. Whether an unconfirmed invitation should
> consume a paid seat is a commercial decision that has not been made; the panel
> counts `active`, `invited` and `suspended` separately so the question stays
> visible rather than buried.

### 4.2 Check the routing

**Seller Console -> Database Hub** shows where each company is routed. For a
`dedicated_external` company, use **Check Reachability** to confirm the stored
credentials answer.

> For a complete walkthrough on provisioning external cloud or physical on-premise
> Supabase instances and HTTPS credentials, see
> [Dedicated Client Database Setup Guide](dedicated_client_db_guide.md).

> A company marked `dedicated_external` currently behaves like a shared one: the
> credentials are stored and readable in the console, but the client application
> does not yet connect to that instance. Route new companies to `cloud_shared`
> unless that has changed on your install.

### 4.3 Invite the staff

**Seller Console -> Team Members -> select the company -> Invite Member.**

Enter one email address and choose a role:

| Role | What they can do in that company |
| --- | --- |
| **Company Admin** | Full control within the company, including managing its members |
| **Operator** | Capture, processing and QA/QC |
| **Inspector** | QA/QC review |
| **Viewer** | Read-only |

The invitee appears in the list **immediately**, with one of four states:

| State | What it means |
| --- | --- |
| **Invited — awaiting confirmation** | An account exists, but the person has not confirmed the address. **Grants no access.** |
| **Confirmed — awaiting first sign-in** | The address is verified. Access begins when they first sign in. |
| **Active** | Signed in and working in the company |
| **Suspended** | Revoked. Their data is not readable by that company any more |

> **An invitation grants nothing on its own.** This is deliberate. Access begins
> only after the person confirms their email address and signs in for the first
> time. If the "Confirm email" setting is off in your Supabase project, that
> confirmation proves nothing — see §4.6.

**Re-inviting** somebody who already has an account works and re-opens their
membership. Inviting a **platform administrator** is a no-op: they already see
every company, and the console warns you rather than reporting a success that
changes nothing.

### 4.4 What to tell the client

Send the client their sign-in address and what to expect:

1. They receive a confirmation email at the address you invited.
2. They click it, then sign in at `https://app.geosphere.my`.
3. On first sign-in their membership activates automatically.

If they sign in **before** confirming, or if the invite was never accepted, they
see an **"Awaiting workspace assignment"** screen explaining that their account
is verified but not yet a member of any company. That screen is the intended
state, not a fault — it tells them to ask you, which is the correct instruction.

### 4.5 Create the company's project

A project is **mandatory** — every query in the platform is scoped to the active
project, and the dashboard forces project selection right after login. The
5-step wizard's only required field is the **campaign name**.

### 4.6 Confirm email delivery before you sell

Invitations depend on real mail delivery. **Verify this once per install**,
before the first client onboarding:

- Supabase's built-in mailer is heavily rate-limited, and on most plans delivers
  only to project team members. A client address will often receive nothing.
- Configure a real SMTP provider (Supabase -> Authentication -> Providers) or the
  invite creates an account that sends no mail.
- Test with a real non-team address, not your own.

If mail cannot be delivered, the console reports **"User created, but the
confirmation email could not be sent"** rather than reporting a successful
invite — check for that message after the first invite.

### 4.7 What this platform does not enforce

Stated here so it is known before a contract quotes it:

| Not enforced | What actually happens |
| --- | --- |
| **Seat limits** | Reported and highlighted; no write is refused |
| **Storage quotas** | An allocation figure. Nothing measures actual object usage, so an over-quota company is not detectable |
| **`dedicated_external` routing** | Credentials stored and readable; the application does not connect to that instance |
| **Tenant export** | Nothing can export a company's data |
| **Offboarding deletion** | Deleting a company that still owns projects is refused by the database. Reassign or archive first |

### 4.8 Required application settings

Open **Settings → Project & Map Settings**. The form is read-only unless you are
an Administrator.

| Setting | Why it is required |
| --- | --- |
| **Supabase REST endpoint URL** | No database client without it |
| **Public anon API key** | No sign-in without it |
| **Database host provider** | Select your provider topology |
| **GIS industry storage provider** | Selects the panorama URL builder |
| **Provider bucket / domain / container** | Without it, publishing is disabled |
| **Default GIS basemap provider** | Map backdrop |

Storage settings vary by provider — a Supabase bucket name, an R2 domain, an S3
bucket + region, a GCS bucket, an Azure container, a Wasabi bucket.

> `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are **build-time** variables
> configured on Cloudflare Pages (see `01` §7.3). The settings screen only
> pre-fills the form; it does not set them. `VITE_MAP_URL` is also build-time, but
> it is optional and each company can override it at runtime from the Seller
> Console without a rebuild.

### 4.9 Two settings that live somewhere unexpected

`nasWorkBasePath` and `productionApiUrl` are **not** on the Admin Settings
screen. Set them in **NAS & Daemon → Capacity & Volumes**:

| Setting | Purpose |
| --- | --- |
| NAS working base path | Root the deliverable paths are resolved against |
| Worker URL | Endpoint used when not proxying |

### 4.10 Station address configuration

> ✅ **No database step required.** Station addresses are set in the interface:
> **Settings → Project & Map Settings → 4. Production Pipeline & Workstations**.
> Enter the address for each of the four processing PCs and press Save.
>
> Earlier revisions had no screen for this and required a `project_settings` SQL
> update. If you are upgrading from one of those, no migration is needed — simply
> fill in the addresses and Save; the platform seeds the four stations from the
> shipped topology and overlays whatever you enter.

| Field | Purpose | Default |
| --- | --- | --- |
| IP address or hostname | Where the dashboard polls the station agent | blank = station reports *unconfigured* |
| Agent port | Station agent listen port | `8000` |
| Live desktop channel | `RDP (mstsc)` or `noVNC (browser)` | `RDP` |
| RDP port | Port for the one-click `mstsc` launch | `3389` |
| noVNC port | websockify port for the in-browser desktop pane | blank |
| noVNC public URL | HTTPS noVNC endpoint; accepts `{ip}` and `{port}` | blank |
| Agent token | Shared secret matching the PC's `AGENT_TOKEN` | blank |
| Enabled | Whether the station is part of the active pipeline | on |

The header shows `N of 4 stations configured`. A station with no address reports
itself as **Unconfigured** and the rest of the board keeps working, so you can
bring PCs online one at a time.

> A mistyped address is flagged **Check address** rather than blocked, so a
> hostname that does not resolve to a dotted IP will not stop you saving.

**Two notes on the live desktop pane.** A browser blocks a private `http://`
VNC iframe as mixed content, so on an HTTPS deployment the pane requires the
public noVNC URL above. Leave it blank and the pane stays hidden for that
station; RDP launch still works from the office LAN.

**Topology is not editable here.** Station order, software labels and the NAS
stage folder templates come from the shipped four-station topology so the
pipeline contract cannot drift per site. Only the address and remote-access
fields above are per-site.

In **proxy** mode (the default) the agents are reached through the Pages
Functions using `STATION_AGENT_URLS`, so the address matters less; set it
anyway so the LAN fallback and the monitoring views work.

> After changing addresses, sign out and back in (or hard-refresh with
> Ctrl+F5). The dashboard caches project settings in browser storage.

### 4.11 Create operators

**Prefer the Seller Console.** For an install that predates the console, the
fallback is: create the auth user, let them sign in once, then set the role in
**Administration -> Users**.

> ⚠️ **This fallback does not put someone in a company.** Setting a role in
> Administration grants *install-wide* capability, not tenant membership. Since
> every operational table requires `sec.in_org()`, a user with no
> `organization_members` row sees nothing at all. Use §4.3.

### 4.12 Roles and capabilities

Grant capabilities per operator in **Administration -> Roles**. Note that only 8
of the 21 capabilities are enforced by the database — see `01` §5.3 before you
rely on any of the others for compliance.

---

## 5. Verification

Verify in two tiers. Tier A proves the cloud install. Tier B proves the
on-premises pipeline.

### 5.1 Tier A — dashboard verified (~30 minutes)

| # | Action | Pass signal |
| :-- | :--- | :--- |
| 1 | Open the deployed URL | Landing page renders with the globe animation |
| 2 | Sign in as the seeded Administrator | No error banner |
| 3 | Project picker appears | Zero projects ⇒ the wizard is forced |
| 4 | Complete the wizard — campaign name is the only required field | Telemetry loader, then the dashboard |
| 5 | Expand the left navigation rail | All workspaces listed; Settings and Administration unlocked |
| 6 | **Settings → Diagnostics** → **Ping** | *Connected*, PostGIS *operational*, storage *operational*, a real latency figure |
| 7 | Expand **Runtime Environment** | `VITE_SUPABASE_URL` shows a value, not "not set". `VITE_MAP_URL` may read "not set" — that is now a valid state and maps fall back to `https://map.geosphere.my` |
| 8 | **Administration → System Health** → **Run Diagnostics** | PostGIS *operational* with a real ms figure |
| 9 | **Administration → Users** | Your row present with role **Administrator** |
| 10 | **Administration → Roles** | The capability matrix renders |
| 11 | Settings → **Test PostGIS connection & latency** | A number replaces "not measured" |
| 12 | Settings → set the provider bucket → **Verify manifest** | *Manifest OK* with a frame count |
| 13 | **Save** settings | Success toast, and an entry in the audit log |
| 14 | **Data Management** → import a 2-row CSV (`filename,latitude,longitude`) | Columns auto-map, duplicate check reports 0 |
| 15 | **Road Analysis → Import Data** → add a small GeoJSON | Feature count renders; transport badge reads *worker* |
| 16 | **Dashboard** | The embedded WebGIS renders a basemap |
| 17 | Header → audit log icon | The step-13 entry appears |

> ⚠️ **Expected cosmetic artefact.** The Diagnostics panel reports
> **WebGIS: unknown** and **Realtime: unknown** even on a perfectly healthy
> install — that probe is not implemented and the fields are hard-coded. Ignore
> them; judge health from PostGIS, storage and latency.

> ⚠️ A **blank WebGIS iframe** on the dashboard means the *resolved* WebGIS host
> is wrong or unreachable. `VITE_MAP_URL` being unset no longer causes this — it
> falls back to `https://map.geosphere.my`. Check the activated company's WebGIS
> host override in the Seller Console first (`01` §7.3).
> There is no code fallback; fix the Pages variable and rebuild.

### 5.2 Tier B — production pipeline verified

Tier A cannot prove the on-prem half. Continue:

| # | Check | Pass signal |
| :-- | :--- | :--- |
| 1 | `nas-scan?action=subgrids` via the tunnel | Your subgrid listed |
| 2 | **NAS & Daemon** workspace | Folder browser lists `03_Stitching`, storage overview shows the volume |
| 3 | **Production Hub** → *4-PC Flight Board* | All four cards show an agent, not "awaiting agent" |
| 4 | **PC Monitoring** | Live CPU/RAM/GPU per station |
| 5 | **Production Hub** → *Stitched Intake & Pairing* | Subgrid detected, survey folders listed, CSV rows paired to imagery |
| 6 | *Acceptance QA* | Frames step through the 360 viewer; a defect flag writes to the ledger |
| 7 | *Cloud Bucket Gate* | Inventory verified, gate approved |
| 8 | *WebGIS Release Gate* → Publish | Rows land in `panoramas` |
| 9 | **Main Dashboard** | Published trajectory renders |

> Steps 3–4 require §4.10 to have been completed. Without it the Flight Board
> cannot reach the agents no matter how the tunnels are configured.

> **Bucket gate limitation.** Inventory verification works only with the
> Supabase storage provider. R2/S3/Azure/Wasabi deployments cannot complete
> that gate today — see `03-Reference.md` §1.3.

### 5.3 Full smoke test

[`docs/Product Dashboard/SMOKE_CHECKLIST.md`](../Product Dashboard/SMOKE_CHECKLIST.md) has the detailed pass/fail
list including the auth-boundary and image-revalidation checks.

---

## Next

Keep [`03-Reference.md`](03-Reference.md) handy during operation: known
limitations, troubleshooting, and every environment variable.