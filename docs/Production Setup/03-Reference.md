# GeoSphere 360 — Reference

Part 3 of the Production Setup documentation. Lookup material for operating the
installed system.

- [§1 Known limitations](#1-known-limitations)
- [§2 Troubleshooting](#2-troubleshooting)
- [§3 Environment variables](#3-environment-variables)
- [§4 Schema and API index](#4-schema-and-api-index)

---

## 1. Known limitations

Read this before go-live. Several items below are product defects rather than
configuration mistakes, and some will stop a client from completing setup.

### 1.1 Workstation addresses must be set before the board is useful

**Resolved in the current build.** Station addresses are set in the interface at
**Settings → Project & Map Settings → 4. Production Pipeline & Workstations**,
then saved. No database step is involved. See
[02-Operations.md §4.4](02-Operations.md#44-station-address-configuration).

This entry is retained because the behaviour is still worth knowing: until each
station has an address configured,

- the 4-PC Flight Board reports that station as **Unconfigured**,
- the NAS rename action is unavailable for it,
- bucket upload for non-Supabase providers cannot run for it.

A station without an address does not affect the rest of the board, so PCs can
be brought online one at a time. The settings summary line reads
`N of 4 stations configured`.

> **Upgrading from a build that required SQL:** no migration is needed. Enter the
> addresses in the new screen and save. The `workstationsConfig` settings type
> now declares `ipAddress`, `port`, `agentToken`, `rdpPort`, `vncPort`,
> `remoteUrl` and `remoteChannel`, so exporting and re-importing project
> settings no longer drops them — a defect that affected earlier builds.

### 1.2 Bucket upload only works for two providers

**Impact** — when a bucket upload includes the manifest, the agent's CLI
invocation is built incorrectly for five of the seven providers (a shell
operator is placed inside an argument list executed without a shell). The
upload fails with an operating-system error.

| Provider | Upload works |
| --- | :---: |
| Cloudflare R2 (`r2`) | **Yes** |
| NAS copy (`nas_local`) | **Yes** |
| AWS S3, GCS, Azure, Wasabi, Supabase CLI | No — upload **without** the manifest option |

**Workaround** — use R2 or the NAS copy path, or run the provider CLI yourself
and skip the in-app upload.

### 1.3 Bucket gate verification is Supabase-only

**Impact** — the "verify inventory" step of the Cloud Bucket Gate refuses every
provider except Supabase Storage with *"Object listing is only available for
the Supabase provider."* R2/S3/Azure deployments **cannot pass the bucket gate**.

**Workaround** — use Supabase Storage as the panorama bucket, or accept that the
gate cannot be completed and publish via the release gate only.

### 1.4 In-app tour and help text describe removed features

**Impact** — the first-run interactive tour and the help modal still describe
the pre-refactor interface (a different map library, "Passcode-Protected Admin
Edits", "Publish All to Database", a removed processing centre). They will
mislead operators and new staff.

**Workaround** — dismiss the tour, and train against this documentation instead.

### 1.5 Default session timeout is 30 minutes

**Impact** — users are signed out after 30 minutes of inactivity. Activity
inside embedded map and panorama frames is not visible to the dashboard, so
someone actively working a 360 viewer can be signed out mid-task.

**Workaround** — raise **Settings → session timeout** (minutes) if this is
disruptive.

### 1.6 Deletion approval is a UI-only guard

**Impact** — the *"require administrator approval for delete"* setting gates
the interface, but the `deleteData` capability is granted at the database level
to **both** Administrator and Survey Operator. A Survey Operator can hard-delete
via a direct API call, bypassing the approval queue.

**Workaround** — do not grant the Survey Operator role if your compliance
process requires approval. Rely on the Approvals queue only for GUI-driven work.

### 1.6b Disable revokes permissions, but not the sign-in account

**Impact** — **Disable** in Administration → Users sets the directory row to
`Disabled`. Since migration `0030` that resolves to read-only at the database
level (`sec.get_app_role()` → `Viewer`), so the control genuinely revokes.

It does **not** remove the person's Supabase sign-in account. They can still sign
in; they simply see nothing they are not permitted to see. There is no longer a
delete control in the dashboard — deliberately, because deleting the row would
leave no record of the revocation and role resolution would fall back to the
token claim, restoring the elevated role.

**Workaround** — to stop someone signing in at all, remove or disable the user in
**Supabase → Authentication → Users**.

### 1.7 "No IP configured" wording on the flight board

**Impact** — the flight board reports `no-ip-configured`, `unreachable`, or
`not-reporting` as distinct states. `no-ip-configured` simply means that
station has no address saved yet (§1.1 — set it in Settings ▸ 4. Production
Pipeline & Workstations); `unreachable` is a tunnel or firewall problem;
`not-reporting` means the agent answers but its watch loop has not produced a
snapshot.

### 1.8 Storage bucket privacy must be public

**Impact** — panorama URLs are built as unsigned public object URLs. A private
`MMS_PIC` bucket renders broken imagery everywhere, and there is no signed-URL
code path to fall back to. See `01-Infrastructure.md` §3.1.

### 1.9 Renaming requires a `panoramas` folder

**Impact** — the NAS rename action targets the `panoramas/` subfolder of a
survey run. If that subfolder does not exist, the request is rejected.

**Workaround** — ensure stitched output uses the tiled layout (§1.1 of
`02-Operations.md`), or rename on the filesystem directly.

### 1.10 Fictional and retired configuration names

| Name | Status |
| --- | --- |
| `VITE_NAS_API_ENABLED` | **Never existed in code.** Documented in older notes. Use `VITE_WORKER_API_MODE` |
| `CONCURRENCY`, `MAX_ACTIVE_JOBS`, `MAX_QUEUE_DEPTH`, `WORKER_JOB_DB` | Retired with the job queue. Setting them does nothing |
| `MASK_NEIGHBOR_WARP`, `LAZY_MODEL_DOWNLOAD` | Retired. Not read anywhere |
| Worker `/api/jobs`, `/api/releases/prepare`, `/metrics` | **Removed.** A 404 here is expected, not a fault |
| Worker port `8787` | Was never correct. Use `8000` |
| `0019_map_shares_auth_only.sql` | No such file. The real file is `0019_map_shares_public_access.sql` |

---

## 2. Troubleshooting

The platform prefers to report "unavailable" over throwing an error. Several
failures are therefore **silent** — the table marks those.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Blank iframe where the WebGIS map should be | `VITE_MAP_URL` unset | Set it on Pages, then **rebuild** (`01` §7.3) |
| "Worker proxy is not configured" | `NAS_API_URL` / `NAS_WORKER_TOKEN` absent in dev `.env` | Add both, restart the dev server (`01` §7.6) |
| Pages returns **503** from `/api/*` | Runtime secrets missing | Set `NAS_API_URL` + `NAS_WORKER_TOKEN` (`01` §7.4) |
| Pages returns **401** on a private route | Session missing/expired | Sign in again; confirm `SUPABASE_URL` + `SUPABASE_ANON_KEY` are set |
| Tunnel hostname returns **404** | `config.yml` ingress does not match the requested hostname | Check the ingress rule and that `cloudflared` restarted |
| `curl tunnel/health` returns **401** and nothing else works | Correct — the token is required | Add `-H "Authorization: Bearer …"`; if it works, the tunnel is fine |
| Tunnel hostname changes / stops resolving | A `trycloudflare.com` quick tunnel was used | Create a **named** tunnel with DNS routing (`01` §6) |
| Station cards show **no-ip-configured** | Workstation address not saved for that PC | Set it in Settings ▸ 4. Production Pipeline & Workstations (`02` §4.4) |
| Station cards show **unreachable** | Tunnel, firewall, or agent not running | Check the agent is up, the tunnel ingress matches, port 8000 is allowed |
| Station cards show **not-reporting** | Agent answers but its watch loop is failing | Check `WATCH_ROOT` on that PC — a drive letter valid elsewhere often is not |
| Agent exits immediately at startup | `STATION_ID` missing or invalid | Must be one of the four station ids |
| Panoramas render as broken images | `MMS_PIC` is private, or wrong bucket name | Make the bucket public; check the setting (`01` §3.1) |
| "no resolvable panorama URL" in QA | Storage provider / bucket settings incomplete | Re-check §4.2 |
| NAS scans return **empty** subgrid lists | Folder tree does not match, or `NAS_BASE_PATH` wrong | Re-check `01` §1 and `02` §1.2 |
| GPS coordinates not joined to imagery | Run folder names differ between `03_Stitching` and `01_Metadata` | Make them identical (`02` §1.2) |
| Every map view is blank and images 404 | `VITE_MAP_URL` serves a different origin than the API | Confirm the WebGIS app is reachable from the browser |
| Publish button permanently disabled | Provider bucket not configured | Set the bucket in Settings (`02` §4.2) |
| Can't reach the Administration workspace | Seeded role resolved to Viewer | Verify `select sec.get_app_role();` (`01` §4.2) |
| Migration error mentioning `sec.can` | `0009` not applied before `0010` | Re-apply in order (`01` §2.3) |
| Every survey run reports **0 defects** | **`0032` not applied**, or PostgREST is serving a stale schema | Apply `0032`. If the column exists, `NOTIFY pgrst, 'reload schema';` or restart PostgREST. The select error is caught, so nothing is logged — the count is simply absent, not zero |
| `Could not find the 'run_id' column` | Same as above: missing `0032`, or a stale PostgREST schema cache | Apply `0032`, then `NOTIFY pgrst, 'reload schema';` |
| `item_key … violates not-null constraint` on any QA/QC write | **`0033` not applied** | Apply `0033`; it adds the column and back-fills from `point_id` |
| `panoramas_subgrid_summary` view missing | PostGIS was not enabled before `0001` | Enable PostGIS, re-run the `0001` view block (`01` §2.2) |
| Diagnostics shows WebGIS/Realtime **unknown** | **Expected** — probe not implemented | Ignore (`02` §5.1) |
| Settings changes do not appear after a database edit | Browser cached project settings | Sign out/in or hard refresh |

---

## 3. Environment variables

Precedence is **per-project settings (database) → `VITE_*` env → in-code
default**, so most storage and table names can also be changed at runtime in the
application.

### 3.1 Build-time — browser (`VITE_*`)

Only these three are required. All are compiled into the shipped bundle.

| Variable | Required | Default | Purpose |
| --- | :--- | --- | --- |
| `VITE_SUPABASE_URL` | **Yes** | — | Project REST base. Warns if absent |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | — | Public anon / publishable key |
| `VITE_MAP_URL` | **Yes** | — | WebGIS app base. **No fallback** |
| `VITE_SUPABASE_KEY` | No | falls back to anon key | Legacy alias for the anon key |
| `VITE_WORKER_API_MODE` | No | `proxy` | `proxy` or `direct` — how the browser reaches the worker |
| `VITE_STATION_AGENT_MODE` | No | `proxy` in prod, `direct` in dev | How the browser reaches the agents |
| `VITE_SUPABASE_BUCKET` | No | `MMS_PIC` | Primary panorama bucket |
| `VITE_STORAGE_BUCKET` | No | `MMS_PIC` | Secondary bucket alias |
| `VITE_STORAGE_PROVIDER` | No | varies by call site | `supabase`, `cloudflare_r2`, `s3`, `gcs`, `azure`, `wasabi`, `nas_local` |
| `VITE_R2_BUCKET` / `VITE_R2_DOMAIN` | No | — | R2 bucket and CDN domain |
| `VITE_IMAGE_CDN_URL` | No | derived | Generic image CDN base |
| `VITE_S3_BUCKET` / `VITE_S3_REGION` | No | `ap-southeast-1` | S3 target |
| `VITE_GCS_BUCKET` | No | — | GCS bucket |
| `VITE_AZURE_ACCOUNT` / `VITE_AZURE_CONTAINER` | No | — | Azure target |
| `VITE_WASABI_BUCKET` / `VITE_WASABI_REGION` | No | `us-east-1` | Wasabi target |
| `VITE_NAS_SERVER_URL` | No | — | Direct NAS image origin (proxy-disabled only) |
| `VITE_NAS_WORK_BASE_PATH` | No | — | Default NAS working directory |
| `VITE_PRODUCTION_API_URL` | No | — | Worker base URL — **only when mode is `direct`** |
| `VITE_PRODUCTION_API_KEY` | No | — | Static worker secret — **direct mode only**. Prefer proxying |
| `VITE_ROAD_GEOMETRY_BUCKET` | No | `road-analysis-geometry` | Private layer geometry bucket |
| `VITE_ROAD_EXTRACTION_ROUTE` | No | `overpass` | `overpass` or `custom` |
| `VITE_ROAD_EXTRACTION_URL` | No | overpass-api.de | Overpass endpoint (browser fallback only) |
| `VITE_ROAD_EXTRACTION_PROXY` | No | `/api/road-extraction` | Server-side proxy — preferred |
| `VITE_ROAD_EXTRACTION_DIRECT` | No | off | Bypass the proxy (debugging) |
| `VITE_MAPLIBRE_WORKER_URL` | No | bundled | Self-hosted map worker (CSP) |
| `VITE_SHARE_LIVE_MODE` | No | off | Embed the live map in share pages |
| `VITE_NAS_URL` / `VITE_ONPREM_URL` | No | — | Provider-profile endpoints |
| `VITE_DB_*` (8 vars) | No | sensible defaults | Table/view name overrides |
| `VITE_SENTRY_DSN` | No | absent = disabled | Error reporting. Omit to disable |
| `VITE_DATA_QUIET` | No | off | Suppress non-fatal analysis console noise |
| `VITE_BRAND_NAME` | No | `GeoSphere` | Product wordmark — the logo lockup. Set to your own product name |
| `VITE_BRAND_MARK` | No | `360°` | Trailing accent mark in the logo. **Set to an empty string to omit it** |
| `VITE_BRAND_URL` | No | `https://app.geosphere.my` | Canonical origin for canonical / OG / Twitter / JSON-LD URLs. No trailing slash |
| `VITE_BRAND_PROJECT_NAME` | No | `360 Mobile Mapping — Spatial Operations Division` | Seeded project name on a fresh install |
| `VITE_BRAND_CONTRACT_CODE` | No | `MMS-2026-GEO-01` | Seeded contract code on a fresh install |
| `VITE_BRAND_CLIENT_NAME` | No | `Spatial Asset Operations` | Seeded client name on a fresh install |

#### Branding a deployment under your own identity

These six variables replace the product name, the browser tab title, every
generated report and PDF footer, and the canonical / Open Graph / Twitter /
JSON-LD metadata in `index.html`. `public/branding/` is **not** touched —
overwrite those files at deploy time if you need your own logo artwork.

Two properties worth knowing before you set them:

- **Every default reproduces the shipped build exactly.** With none of the six
  set, the compiled `index.html` is identical to a build produced before the
  branding layer existed. An unset variable can never blank a field.
- **`VITE_BRAND_MARK` is the exception.** For the other five, a blank value means
  "not configured" and falls back to the default. For the mark, an empty string
  is the *instruction* to omit it, because otherwise there would be no way to
  drop the mark at all.

Changing any of them requires a **rebuild** — these are inlined into `dist/` at
build time, not read at runtime. This is the same constraint as
`VITE_SUPABASE_URL` (§4, `01` §7.3): **one `npm run build` per deployment**.

The three seed values are defaults only. Admin Settings ▸ project settings
writes `projectName` / `contractCode` / `clientName` to the database, and the
database wins — so a reseller can correct them on first run without rebuilding.

> ⚠️ **Never** place a service-role key, NAS token, or agent token in a `VITE_`
> variable. Vite inlines them into the bundle and they become public.

### 3.2 Runtime — Cloudflare Pages (server-side, never sent to the browser)

| Variable | Required | Purpose |
| --- | :--- | --- |
| `SUPABASE_URL` | **Yes** | Session validation target |
| `SUPABASE_ANON_KEY` | **Yes** | Session validation key |
| `NAS_API_URL` | **Yes** for NAS features | Worker tunnel origin, no trailing slash |
| `NAS_WORKER_TOKEN` | **Yes** for NAS features | Must match the worker's token |
| `NAS_IMAGE_TOKEN_SECRET` | No | HMAC key for short-lived preview URLs |
| `STATION_AGENT_URLS` | For the 4-PC board | JSON map of station id → HTTPS agent origin |
| `STATION_AGENT_TOKENS` | No | JSON map of station id → that agent's token |
| `STATION_AGENT_TOKEN` | No | Single fallback token |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | No | Cloudflare Access service token |
| `VITE_ROAD_EXTRACTION_URL` | No | Server-side Overpass mirror (note the prefix on a server var) |

### 3.3 NAS Worker (`worker/.env`)

| Variable | Required | Default | Purpose |
| --- | :--- | --- | --- |
| `NAS_BASE_PATH` | **Yes** | `/nas/360_images` | Survey tree root. Traversal outside is rejected |
| `NAS_WORKER_TOKEN` | On any non-loopback bind | — | Bearer secret. Blank = unauthenticated |
| `NAS_WORKER_ID` | No | hostname | Identifier on `/health` |
| `STORAGE_CACHE_TTL` | No | `30` | Storage response cache, seconds |
| `NAS_LOG_JSON` | No | `0` | `1` = structured JSON logs |

### 3.4 Station Agent (`station-agent/.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `STATION_ID` | **Yes** | — | `blur`, `stitch`, `lightroom`, `photoshop`. Missing = hard exit |
| `WATCH_ROOT` | No | `NAS_BASE_PATH`, else blank | Survey root **as mapped on this PC** |
| `OUT_STAGE` | No | per station | Output stage override |
| `IN_STAGE` | No | per station | Input stage override |
| `POINT_MODE` | No | `1` for blur, else `0` | Count capture points, not images |
| `SUBGRID_PATTERN` | No | `^[A-Za-z]{1,3}[0-9A-Za-z]{2,11}$` | Which path segment is the subgrid |
| `PROCESS_NAMES` | No | — | Comma-separated process-name substrings |
| `SCAN_INTERVAL_SEC` | No | `5` | Watch loop period |
| `GROWING_WINDOW_SEC` | No | `90` | Age below which a file counts as growing |
| `AGENT_TOKEN` | No | — | Bearer secret. Blank = unauthenticated |
| `AGENT_HOST` / `AGENT_PORT` | No | `0.0.0.0` / `8000` | Bind address |

### 3.5 Local dev only

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NAS_API_URL`, `NAS_WORKER_TOKEN` | Vite dev server | Registers the local proxy that mirrors production |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `npm run clean-db` | Required by the data-wipe script |

---

## 4. Schema and API index

### 4.1 Migrations

| File | Creates |
| --- | --- |
| `0001` | `subgrids`, `audit_logs`, `notifications`, `qa_defects`, `qaqc_audit_runs`, `project_settings` |
| `0002`–`0003` | `datasets`, `processing_jobs`, handoff + QA columns |
| `0004` | `user_accounts`, `deletion_requests`, `recycle_bin` |
| `0005` | Realtime QA/QC publication, `security_invoker` views |
| `0006` | `file_inventory` |
| `0007`–`0008` | Constraints, indexes, `survey_recycle_bin`, Advisor fixes |
| `0009` | **`sec` schema** — `can`, `get_app_role`, `is_role`, `normalize_role` |
| `0010` | RLS on the five privileged tables |
| `0011` | **Test script — not a migration** |
| `0012` | PostGIS, `panoramas`, `staging_panoramas`, `panoramas_view` |
| `0013` | Strips bloated road-analysis state from user metadata |
| `0014` | `sec.save_road_analysis_state()` RPC |
| `0015`–`0016` | `projects`, `project_id` on 12 tables, `projects_adopt_legacy_rows` |
| `0017` | `projects_delete_cascade()` |
| `0018`–`0019` | `map_shares`, `map_share_touch()`, public read policy |
| `0020` | Operator delete on `datasets` |
| `0021` | **`road-analysis-geometry` bucket** (private) + policies |
| `0022` | `production_runs`, `_attempts`, `production_releases`, `_files` |
| `0023`–`0025` | `station_board_items`, `stage_event_ledger`, metric unit |
| `0026` | `hub_session_state` |
| `0027`–`0029` | Panorama column reconcile, file-inventory sync, CSV filename |
| `0030` | Directory row becomes authoritative for role **and status**, so **Disable revokes access** (back-fills first) |
| `0031` | RLS backstop: `survey_recycle_bin` and `batch_logs` policies, so no table is left with RLS on and no policy |
| `0032` | **`qa_defects.run_id`**, and the unique key widened to `(project_id, subgrid, run_id, point_id)` |
| `0033` | **`qa_defects.item_key`** — added where missing, back-filled from `point_id`, then enforced `NOT NULL` |

> ⚠️ **`0032` and `0033` are required by the application, not schema hygiene.**
> Applying `0001`–`0031` produces a build that starts, reads, and quietly lies:
>
> - **Without `0032`:** `qa_defects` has no `run_id`, so the select in
>   `datasets.ts` fails — and that failure is caught and swallowed, so **every
>   survey run reports 0 defects**. Both defect writers upsert on a unique index
>   that does not exist and are rejected. The board looks healthy because there
>   is nothing on it to inspect.
> - **Without `0033`:** every `qa_defects` write is rejected with
>   `null value in column "item_key" … violates not-null constraint`. QA/QC
>   results save, then vanish on refresh.
>
> Both migrations are idempotent and safe to re-run. Apply them.

### 4.2 Storage buckets

| Bucket | How it is created | Privacy |
| --- | --- | --- |
| `MMS_PIC` | **Manual** | **Public** |
| `road-analysis-geometry` | Migration `0021` | Private |

### 4.3 NAS Worker HTTP surface

Full contract: [`docs/production_worker_api.md`](../production_worker_api.md).

| Method | Route | Auth | Purpose |
| --- | --- | :---: | --- |
| `GET` | `/health` | No | Liveness + configured mount |
| `GET` | `/api/folders?path=` | Yes | Directory listing with image counts |
| `GET` | `/api/storage` | Yes | Volume usage, per top-level folder |
| `GET` | `/api/nas-scan?action=` | Yes | Survey scans |
| `GET` | `/api/images/{path}` | Yes | Panorama preview with ETag/304 |

`nas-scan` actions: `subgrids`, `survey-folders`, `read-csv`, `folder-images`,
`final-images`, `registry`. An unknown action returns **400**.

### 4.4 Station Agent HTTP surface

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + host telemetry |
| `GET` | `/api/station` | Full station snapshot (task, output, points) |
| `GET` | `/api/station/{id}` | Snapshot, only for the agent's own id |
| `POST` | `/api/rename` | Rename files within a stage folder |
| `POST` | `/api/sync-bucket` | Start a bucket upload |
| `GET` | `/api/sync-bucket/{job_id}` | Poll an upload |

### 4.5 Capabilities enforced by the database

`runQaqc`, `reviewQaqc`, `viewAll`, `manageDatasets`, `manageSettings`,
`manageUsers`, `approveDeletions`, `deleteData`.

The other 13 capabilities in the interface matrix are **UI-only** — see
`01-Infrastructure.md` §5.3.

### 4.6 Quality gates in CI

| Job | Runs |
| --- | --- |
| Build | `tsc -b && vite build` |
| Test | `vitest run` |
| Lint | ESLint — **blocking on errors**, warnings tolerated |
| Python | `py_compile` + `pytest` on the worker, on Python 3.10 and 3.11 |

There is **no deploy automation** in the repository — the Cloudflare Pages Git
integration is the deployment mechanism. The station agents and the Pages
Functions are not covered by CI.