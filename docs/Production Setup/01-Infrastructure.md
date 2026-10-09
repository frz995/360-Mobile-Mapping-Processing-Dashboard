# GeoSphere 360 — Infrastructure Setup

Part 1 of the Production Setup documentation. Covers everything cloud-side and
edge-side: accounts, database, storage, the first administrator, Cloudflare
Tunnel, and the Cloudflare Pages deployment.

- [§1 Prerequisites](#1-prerequisites)
- [§2 Database](#2-database)
- [§3 Storage buckets](#3-storage-buckets)
- [§4 First administrator](#4-first-administrator)
- [§5 Roles and RLS](#5-roles-and-row-level-security)
- [§6 Cloudflare Tunnel](#6-cloudflare-tunnel)
- [§7 Cloudflare Pages deployment](#7-cloudflare-pages-deployment)

---

## 1. Prerequisites

### 1.1 Accounts and domains

| Need | Why | Notes |
| --- | --- | --- |
| **Cloudflare account** | Hosts Pages, the Tunnels, and optional Access | Free tier is sufficient to start |
| **A domain on Cloudflare DNS** | The tunnel hostnames must be real HTTPS names | See the hostname budget below |
| **Supabase project** | Postgres + PostGIS, Auth, Storage | Cloud or self-hosted Docker |
| **Node.js 18.x or 20.x LTS** | Build the SPA | Only needed on your build machine |
| **Python 3.10+** | Runs the worker and the 4 agents | On the NAS PC and each workstation |

### 1.2 Hostname budget — plan for five

The dashboard reaches the on-prem services through **five** Cloudflare Tunnels.
This is easy to under-provision, so budget for it up front.

| # | Hostname | Points to | Required |
| :-- | :--- | :--- | :--- |
| 1 | `nas-api.<your-domain>` | NAS worker, `http://localhost:8000` | Yes |
| 2 | `pc1-agent.<your-domain>` | PC 1 agent (`blur`) | For the 4-PC board |
| 3 | `pc2-agent.<your-domain>` | PC 2 agent (`stitch`) | ” |
| 4 | `pc3-agent.<your-domain>` | PC 3 agent (`lightroom`) | ” |
| 5 | `pc4-agent.<your-domain>` | PC 4 agent (`photoshop`) | ” |
| — | `pc2-remote.<your-domain>` | noVNC live desktop (optional) | Optional |

**All five must be HTTPS.** The station-agent proxy rejects any `http:` origin
outright. Free `*.trycloudflare.com` hostnames are **not** usable — they change
on every restart, so the dashboard would lose the agents constantly.

The Pages app itself can be deployed and tested on its free `*.pages.dev`
hostname before you attach a domain. The tunnel hostnames cannot.

### 1.3 Hardware

No GPU is required (see [README.md §1.1](README.md#11-there-is-no-server-side-image-processing)).

| Role | Minimum | Recommended |
| --- | --- | --- |
| NAS / worker PC | 4 cores, 8 GB RAM, 100 GB free | 8 cores, 16 GB |
| Each station PC (×4) | 4 cores, 8 GB RAM, SSD | 8 cores, 16 GB, SSD |
| Network | 1 GbE between PCs and NAS | 10 GbE for large surveys |
| Storage | Sized for raw + stitched + final + deliverables | Plan ~3× raw survey volume |

The station PCs also run the photogrammetry desktop software, so size them for
that, not for this platform.

---

## 2. Database

### 2.1 Create the project

**Supabase Cloud** — create a project in your organization.

**Self-hosted** — run the Supabase Docker stack.

Record the project URL and the `anon` / publishable key. You need:

- **Project URL** → `VITE_SUPABASE_URL` (browser) and `SUPABASE_URL` (server)
- **anon / publishable key** → `VITE_SUPABASE_ANON_KEY` (browser) and `SUPABASE_ANON_KEY` (server)

### 2.2 Enable PostGIS *before* the first migration

> **Order matters.** Migration `0001` creates the `panoramas_subgrid_summary`
> view **only if PostGIS already exists** — otherwise it is silently skipped.
> PostGIS is installed later, by migration `0012`. Enable PostGIS first
> (Supabase → Database → Extensions → `postgis` → Enable), or the summary view
> will be missing.

### 2.3 Apply the migrations

This project is **not** wired to a migration runner. There is no
`supabase/config.toml` and no `seed.sql`, so `supabase db push` will not work.
The migrations are applied as a **hand-run, ordered sequence**, or via the consolidated suite.

> 🚀 **Fastest installation path:** run the single consolidated bootstrap bundle:
> - **Supabase SQL Editor:** Paste and run [`supabase/bootstrap.sql`](../../supabase/bootstrap.sql) (generated via `npm run migrations:bootstrap`).
> - **psql:** `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/bootstrap.sql`

If applying individual files, run these **34 files in ascending numeric order**:

```
0001_schema_migrations.sql
0002_foundation_production_migration.sql
0003_foundation_processing_migration.sql
0004_rls_application_tables.sql
0005_realtime_qaqc.sql
0006_file_inventory.sql
0007_hardening.sql
0008_fix_security_advisor.sql
0009_security_functions.sql
0010_security_rls_apply.sql
                        ← SKIP 0011 (a test script, not a schema change)
0012_core_tables_and_rls.sql
0013_prune_bloated_user_metadata.sql
0014_road_analysis_state_rpc.sql
0015_projects.sql
0016_per_project_isolation.sql
0017_project_delete_cascade.sql
0018_map_shares.sql
0019_map_shares_public_access.sql
0020_datasets_operator_delete.sql
0021_road_analysis_geometry_storage.sql
0022_production_runs.sql
0023_station_board_items.sql
0024_stage_event_ledger.sql
0025_station_board_metric_unit.sql
0026_hub_session_state.sql
0027_reconcile_panorama_columns.sql
0028_sync_file_inventory.sql
0029_csv_file_name.sql
0030_role_precedence.sql
0031_rls_completeness_backstop.sql
0032_qa_defects_run_scope.sql
0033_qa_defects_item_key.sql
0034_survey_metadata_filenames.sql
0035_repair_privileges_and_rls.sql
```

> ⚠️ **`0011_security_tests.sql` is a test, not a migration.** It makes no schema
> changes. Run it separately as a verification step — see §5.2. A common mistake
> is a `for f in supabase/migrations/00*.sql` loop, which sweeps `0011` in with
> the schema files.

> ℹ️ **Fresh install compatibility:** In current builds, `0004` safely guards
> `panoramas` and `staging_panoramas` RLS activation with existence checks. `0012`
> creates the core tables and applies authoritative role-guarded RLS. Sequential
> execution from `0001` through `0035` now passes cleanly with 0 errors.

> ⚠️ **`0019` is `map_shares_public_access.sql`**, not
> `map_shares_auth_only.sql`. It grants `anon` SELECT — i.e. public read of
> share rows.

**Dependencies between files** (the ordering above already satisfies them):

| Constraint | Why |
| --- | --- |
| `0009` before `0010`, `0012`, `0014` | `0010` calls `sec.can()`, defined in `0009` |
| `0015` before `0016` | `0016` adds `project_id` and calls `projects_adopt_legacy_rows` |
| `0018` before `0019` | `0019` re-grants and re-creates the policy |
| `0023` before `0025` | `0025` warns and exits if `station_board_items` is missing |
| `0009` before `0030` | `0030` redefines `sec.get_app_role()`, which `0009` introduces |
| `0016` before `0031` | `0031` backstops `batch_logs`, which `0016` creates |
| `0007` before `0031` | `0031` backstops `survey_recycle_bin`, which `0007` creates |
| `0030` before `0031` | keep in order so the RLS sweep sees the final schema |
| `0031` before `0032`, `0033` | `0032` scopes `qa_defects` to `run_id`; `0033` enforces `item_key` |
| `0034` before `0035` | `0034` creates `survey_metadata_filenames`; `0035` grants privileges |

> **`0035` is critical for operator access.** Migrations `0023`, `0026`, and `0034`
> created tables granted only to `postgres`. `0035` grants them to `authenticated`
> and aligns `sec.can('deleteData')` so operators can capture metadata and use
> the flight board without receiving "permission denied" errors.

**How to run them**

*Supabase SQL Editor* — paste and run [`supabase/bootstrap.sql`](../../supabase/bootstrap.sql) in one execution. Alternatively, run individual files in ascending order.

*psql* — execute sequentially:

```bash
export PGHOST=<db-host> PGDATABASE=postgres PGUSER=postgres PGPASSWORD=<pw>
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/bootstrap.sql
```

The migrations are written to be idempotent, so re-running one that partially
applied is safe. After the sequence, run the RLS verification in §2.4.

> `0013`, `0027`, `0028`, `0029` are data-repair/backfill scripts. They are
> harmless on a fresh database but meaningful if you are migrating from an
> older install.

### 2.4 Verify the schema landed

```sql
-- security functions present (expect can, get_app_role, is_role, normalize_role)
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'sec' order by 1;

-- PostGIS enabled
select extname from pg_extension where extname = 'postgis';

-- RLS actually enabled on the privileged tables (expect several rows)
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relrowsecurity
 order by 1;

-- the views the app reads
select table_name from information_schema.views
 where table_schema = 'public'
   and table_name in ('panoramas_view', 'panoramas_subgrid_summary');
```

If `panoramas_subgrid_summary` is missing, PostGIS was not installed when
`0001` ran — see §2.2.

---

## 3. Storage buckets

### 3.1 `MMS_PIC` — Object Storage Bucket Configuration

Create the bucket manually in **Supabase → Storage → New bucket**, or configure your enterprise cloud storage (Cloudflare R2, AWS S3, Wasabi, GCS, Azure Blob).

| Setting | Standard Public Mode | Enterprise Private Mode |
| --- | --- | --- |
| Bucket Name | `MMS_PIC` (or configured custom bucket) | `MMS_PIC` |
| **Public bucket** | **ON** | **OFF (Private)** |
| **URL Strategy** | Direct public CDN / storage URL | In-Memory Signed URL Cache (`signedPanoramaUrls.ts`) |

> **Public Mode (Default):** The dashboard constructs fast public URLs and passes them straight to `<img>` and WebGL cubemap tile loaders. Zero API signing roundtrips, ideal for public or non-sensitive surveys.
>
> **Enterprise Private Mode:** Supported out of the box. In **Admin Settings → Storage** or project configuration, enable `isPrivateBucket` or `useSignedUrls`. The platform automatically batches and caches signed object tokens in memory with a 50-minute safe validity window, routing requests through `/storage/v1/object/authenticated/` or pre-signed provider URLs without breaking the WebGL panorama viewer.

### 3.2 `road-analysis-geometry` — created automatically, private

Migration `0021` creates this bucket with `public = false` and adds
authenticated-only storage policies. **Nothing for you to do.** If it is
missing, Road Analysis geometry saves fall back to browser-local storage.

### 3.3 `vector_layers` — not used

Some older documentation tells you to create a `vector_layers` bucket. The
current code never reads or writes it. Skip it.

---

## 4. First administrator

### 4.1 Automated provisioning (Recommended)

Run the administrator seeding script from the project root:

```bash
# Direct command with parameters
node scripts/seed-admin.mjs --email admin@example.com --password "SecurePass123!" --name "Lead Administrator"

# Or run interactive prompt:
npm run admin:seed
```

This automated script connects via `SUPABASE_SERVICE_ROLE_KEY`, configures `auth.users` with `app_metadata` and `user_metadata` set to `Administrator`, confirms the email, and upserts the directory row into `public.user_accounts` in one step.

### 4.2 Manual four-step setup (Fallback)

If you prefer to configure the account manually in the Supabase Dashboard:

**Step 1 — create the auth user.**
Supabase → Authentication → Users → **Add user**. Enter an email and password
(or send an invite). Note the email address.

**Step 2 — set the role metadata.**
Open the user you just created → edit. Set **App Metadata** (preferred, because
it is what lands in the JWT):

```json
{ "role": "Administrator" }
```

Also set **User Metadata** to the same, because the dashboard reads User
Metadata first and falls back to App Metadata:

```json
{ "role": "Administrator" }
```

> ⚠️ **Why both?** The UI resolves the role from auth metadata; the database
> resolves it from the JWT claim and then the `user_accounts` row. Neither path
> reads the other. Missing metadata silently yields **Viewer** — see §4.3.

**Step 3 — insert the directory row.**

```sql
insert into public.user_accounts (name, email, role, status)
values ('<Full Name>', '<email>', 'Administrator', 'Active')
on conflict (email) do update
  set role = 'Administrator', status = 'Active';
```

**Step 4 — verify before signing in.**

```sql
select sec.get_app_role();   -- must return: Administrator
```

If it returns `Viewer`, one of Steps 2–3 is missing.

> ⚠️ **Seed before the first sign-in.** On first sign-in the application writes
> its own `user_accounts` row with the role it resolved from metadata, defaulting
> to `Viewer`. Doing Step 3 afterwards overwrites it — but doing Step 2 after the
> first sign-in does not, because the cached `Viewer` row is already there.

### 4.3 Why the role can silently be Viewer

The dashboard reads, in order: `user_metadata.role`,
`raw_user_meta_data.role`, `user.role`, `app_metadata.role`,
`raw_app_meta_data.role`. For a real Supabase user `user.role` is the string
`"authenticated"`, which is not an application role, so it normalises to
`Viewer`. If none of the metadata keys is set, you get Viewer with no warning.

### 4.4 Adding the remaining users

Authentication lives entirely in Supabase. Administration → Users does **not**
create accounts — it manages the role and access of people who already exist in
Supabase. The procedure is always the same:

**For each operator:**

1. In the Supabase dashboard go to **Authentication → Users → Add user**, with
   their email address, a password, and **Auto Confirm User** enabled.
2. Set **App Metadata** on that user to the role they need:

   ```json
   { "role": "Survey Operator" }
   ```

   Valid values are `Administrator`, `Survey Operator`, `QA Inspector` and
   `Viewer`.
3. Optionally set **User Metadata** to the same value. The interface reads User
   Metadata first, so setting both avoids the two systems disagreeing.
4. The user appears in **Administration → Users** automatically the first time
   they sign in. Before that there is no directory row for them.

Then, in the dashboard, use **Administration → Users** to adjust their role or to
**Disable** them.

> ⚠️ **Set App Metadata, not only User Metadata.** The database resolves the role
> from the token's role claim, which Supabase sources from App Metadata. User
> Metadata alone makes the interface look correct while the database still sees
> `Viewer` — the user sees controls they cannot actually use.

> ⚠️ **Disable revokes permissions, not the account.** It sets the directory row
> to `Disabled`, which migration `0030` resolves to read-only at the database
> level. The person's Supabase sign-in account still exists and they can still
> sign in — they simply see nothing they are not permitted to see. To stop someone
> signing in at all, remove or disable the user in Supabase.

> Grant individual capabilities in **Administration → Roles**.

### 4.5 Pre-Flight System Diagnostics (`npm run doctor`)

To verify that your infrastructure, environment variables, PostGIS database, and administrator accounts are correctly wired before opening the platform to production staff, execute the automated pre-flight doctor:

```bash
npm run doctor
```

This single command evaluates:
- **Runtime Environment:** Confirms Node.js (>= 18) and Python (>= 3.10) for Station Agent / Worker.
- **Environment & Keys:** Verifies `VITE_SUPABASE_URL`, anon public JWT, and optional `SUPABASE_SERVICE_ROLE_KEY`.
- **Database Schema & PostGIS:** Validates connectivity and verifies all required core tables (`projects`, `subgrids`, `panoramas`, `user_accounts`).
- **Administrator Readiness:** Checks that at least one active `Administrator` or `sysadmin` account exists in `user_accounts`.
- **Cloud Storage:** Validates configuration for the active cloud provider (`cloudflare_r2`, `aws_s3`, `wasabi`, `supabase`, `nas_local`).
- **Station Agent Status:** Probes local SD-card edge ingestion daemon connectivity (`http://127.0.0.1:8765`).

Any misconfigurations will be displayed with actionable remediation commands.

---

## 5. Roles and row-level security

### 5.1 The four roles

| Role | Intended for |
| --- | --- |
| **Administrator** | System owners. Full access, user and settings management |
| **Survey Operator** | Field and production staff. Intake, pipelines, datasets |
| **QA Inspector** | Quality staff. QA inspection and sign-off |
| **Viewer** | Stakeholders. Read-only, plus report export |

### 5.2 Verifying the security boundary

**Tier 1 — always runnable in the SQL Editor.** Confirms the migrations applied
and role resolution is wired:

1. Run the §2.4 queries.
2. Paste and run all of `supabase/migrations/0011_security_tests.sql`. Its
   sections 1, 2 and 6 must complete **without raising an exception**.

> ⚠️ **The Supabase SQL Editor runs as `postgres`, which bypasses RLS.** So this
> tier proves the wiring, not the boundary. It cannot prove a Viewer is denied.

**Tier 2 — a real boundary test.** Requires a Viewer test account and a direct
database connection:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"role":"authenticated","email":"viewer@test.local"}';
  SELECT sec.get_app_role();   -- must print: Viewer
  INSERT INTO public.project_settings (id, settings)
    VALUES ('rls_probe', '{}'::jsonb);
  -- EXPECT: ERROR  new row violates row-level security policy
ROLLBACK;
SQL
```

The insert **must** fail with a row-level-security error. If it succeeds, the
boundary is broken. Repeat with an Administrator JWT and the same insert — that
one **must** succeed.

### 5.3 What is actually enforced

Of the 21 capabilities in the dashboard's permission matrix, **8 are enforced
by Row-Level Security**. The remainder gate the **interface only** — the control
is hidden or disabled, but a direct API call is not blocked.

Enforced (RLS): `runQaqc`, `reviewQaqc`, `viewAll`, `manageDatasets`,
`manageSettings`, `manageUsers`, `approveDeletions`, `deleteData`.

If your compliance requirements depend on server-side enforcement, treat the
other 13 as advisory and restrict roles accordingly.

> **Security note.** `deleteData` is granted to *both* Administrator and Survey
> Operator at the database level, so the "require admin approval for delete"
> setting is a UI-only guard. To enforce approval, keep deletion rights off the
> Survey Operator role.

---

## 6. Cloudflare Tunnel

> This section is written from scratch — no prior documentation in the
> repository covered tunnel setup, and it is the step most likely to be missed.

The dashboard is served over HTTPS from Cloudflare's edge. Your on-prem services
are on a private network. **Cloudflare Tunnel** bridges them: `cloudflared` runs
on each machine and makes **outbound-only** connections to Cloudflare. Nothing
needs to be exposed to the internet.

Because `cloudflared` is outbound-only, **you do not need an inbound firewall
rule for the tunnel itself**. (You may still want one to keep the agents' port
8000 private to the LAN.)

### 6.1 Install `cloudflared`

**Windows**

```powershell
winget install --id Cloudflare.cloudflared
```

**Linux / macOS**

```bash
# see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

Confirm: `cloudflared --version`

### 6.2 Create one tunnel per machine

Create a tunnel **on each machine that hosts a service** — the worker PC gets
one, and each of the four station PCs gets one. Five in total.

On the **worker PC**:

```bash
cloudflared tunnel login
cloudflared tunnel create nas-worker
```

`login` opens a browser to authorise your Cloudflare account. `create` prints a
**tunnel ID** and writes a credentials JSON file under
`~/.cloudflared/<TUNNEL-ID>.json`. **Keep that file** — it is the tunnel's
identity.

Repeat on each station PC with a distinct name, e.g. `pc1-agent` … `pc4-agent`.

### 6.3 Write the ingress configuration

`cloudflared` needs a config file mapping public hostnames to local services.
Create `%USERPROFILE%\.cloudflared\config.yml` (or
`~/.cloudflared/config.yml` on Linux):

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\<USER>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: nas-api.example.com
    service: http://localhost:8000
  - service: http_status:404
```

On a **station PC** the single hostname targets that machine's agent:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\<USER>\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: pc1-agent.example.com
    service: http://localhost:8000
  - service: http_status:404
```

The trailing `http_status:404` rule is required — `cloudflared` rejects a config
whose last rule is not a catch-all.

> If you also want a browser-based remote desktop for a station, add a second
> hostname pointing at your noVNC/websockify service (commonly
> `http://localhost:5901`). See §7.7.

### 6.4 Point DNS at the tunnel

```bash
cloudflared tunnel route dns nas-worker nas-api.example.com
```

Repeat for each station hostname. This creates the DNS records automatically.

### 6.5 Run it as a service (autostart)

**Windows**

```powershell
cloudflared service install
```

This registers a Windows service that starts with the machine. Then set it to
start automatically in **services.msc**.

**Linux (systemd)** — create `/etc/systemd/system/cloudflared.service`:

```ini
[Unit]
Description=cloudflared
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared --no-autoupdate run --token <TUNNEL-TOKEN>
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now cloudflared
```

The one-line **token** form is easiest: in the Cloudflare Zero Trust dashboard,
open the tunnel, copy the install command, and run it. Use whichever suits your
environment.

### 6.6 Verify

```bash
curl https://nas-api.example.com/health
```

Expected — HTTP 401 is the **correct** answer when no token is supplied, and
proves the tunnel is routing:

```json
{"detail":"Unauthorized."}
```

With the token:

```bash
curl -H "Authorization: Bearer <NAS_WORKER_TOKEN>" https://nas-api.example.com/health
```

Expected: `{"status":"ok","nas_base":"...","worker":"..."}`

### 6.7 Optional: Cloudflare Access

For an extra gate at the origin, add a Cloudflare Access service token and
configure the Forward-Access-Client-Id / Forward-Access-Client-Secret headers.
The Pages Functions forward `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` when both are set. This is defence in depth on top of
the Supabase session check, not a replacement for it.

---

## 7. Cloudflare Pages deployment

### 7.1 Hosting is Cloudflare Pages — this is not optional

The private API (`/api/nas-scan`, `/api/nas-image`, `/api/nas-image-token`,
`api/worker/*`, `api/station-agent`, `api/road-extraction`) is implemented in the
`functions/` directory — seven route handlers plus two shared helpers — using the
**Cloudflare Pages Functions** runtime: each file exports an `onRequest` handler
and reads secrets from `context.env`.

That runtime is a hard dependency. **Serving `dist/` from nginx, Caddy, or plain
object storage does not execute `functions/`.** Under a static-only host:

- every private API route returns the SPA's HTML instead of JSON,
- the interface degrades **silently** — it reports "unavailable" rather than
  raising an error,
- and the Supabase session check that guards those routes does not run at all.

So: deploy to **Cloudflare Pages**. A Pages-compatible edge runtime (Cloudflare
Workers with an assets binding) also works. If you must self-host, you need to
write and maintain your own Pages-Functions-compatible server — that shim does
not ship with this product.

### 7.2 Create the Pages project

Connect the repository in the Cloudflare dashboard:

| Setting | Value |
| --- | --- |
| Project name | your choice |
| **Root directory** | **repository root** |
| Build command | `npm run build` |
| Build output directory | `dist` |

> ⚠️ **Root directory must be the repository root.** Cloudflare detects the
> `functions/` directory there and deploys it automatically. If you set the root
> to `dist`, all seven Functions are silently omitted and you get a dashboard
> with no private API and no error message.
> Set the **production branch** to `main` (or whichever branch you deploy from).

`public/_redirects` handles SPA route fallback for you. No nginx `try_files`
equivalent is needed.

### 7.3 Build-time variables (Pages → Settings → Environment variables)

These are **compiled into the browser bundle**. Only three are required.

| Variable | Required | Value | Notes |
| --- | :--- | :--- | --- |
| `VITE_SUPABASE_URL` | **Yes** | `https://<project>.supabase.co` | No fallback; the app warns if absent |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | anon / publishable key | The only credential the browser needs |
| `VITE_MAP_URL` | **Yes** | Your WebGIS app URL | **No code fallback.** Unset ⇒ every embedded map is a blank iframe |
| `VITE_WORKER_API_MODE` | No | `proxy` | Default. Leave unset |
| `VITE_STATION_AGENT_MODE` | No | `proxy` | Default in production |
| `VITE_SUPABASE_BUCKET` | No | `MMS_PIC` | Default is already `MMS_PIC` |
| `VITE_SENTRY_DSN` | No | Sentry DSN | Omit to disable error reporting entirely |

> **Never** put a service-role key, the NAS worker token, or a station-agent
> token in a `VITE_` variable. Vite inlines them into the shipped bundle and
> they would be readable by anyone who opens the page source.

> ⚠️ **`VITE_NAS_API_ENABLED` does not exist.** It appears in some older notes but
> is not read by any code. Proxy behaviour is derived from `VITE_WORKER_API_MODE`
> and whether the runtime secrets below are present.

### 7.4 Runtime variables and secrets (Pages → Settings → Environment variables)

These are read **server-side** by the Pages Functions and never reach the
browser. Mark them **Secret**.

| Variable | Required | Value | Read by |
| --- | :--- | :--- | --- |
| `SUPABASE_URL` | **Yes** | same project URL | session validation |
| `SUPABASE_ANON_KEY` | **Yes** | same anon key | session validation |
| `NAS_API_URL` | **Yes** for NAS features | `https://nas-api.example.com` — **no trailing slash** | worker proxy |
| `NAS_WORKER_TOKEN` | **Yes** for NAS features | must match the worker's token | worker proxy |
| `NAS_IMAGE_TOKEN_SECRET` | No | HMAC secret for short-lived preview URLs; falls back to `NAS_WORKER_TOKEN` | signed image URLs |
| `STATION_AGENT_URLS` | For the 4-PC board | JSON map, e.g. `{"blur":"https://pc1-agent.example.com","stitch":"https://pc2-agent.example.com","lightroom":"https://pc3-agent.example.com","photoshop":"https://pc4-agent.example.com"}` | agent proxy |
| `STATION_AGENT_TOKENS` | No | JSON map of station id → that agent's `AGENT_TOKEN` | agent proxy |
| `STATION_AGENT_TOKEN` | No | single fallback token if a station has no map entry | agent proxy |
| `CF_ACCESS_CLIENT_ID` | No | Cloudflare Access service token id | forwarded upstream |
| `CF_ACCESS_CLIENT_SECRET` | No | matching secret | forwarded upstream |

**Valid station ids are exactly** `blur`, `stitch`, `lightroom`, `photoshop`.
Any other key is rejected.

### 7.5 Deploy

Push to the connected branch. Cloudflare Pages builds automatically — **there
is no deploy automation in this repository**, the Git integration is the whole
mechanism.

> ⚠️ Build-time values are inlined. If you add a `VITE_*` variable **after** a
> build, the existing deployment is unchanged — you must trigger a new build
> (push a commit, or use the Pages dashboard's retry).

### 7.6 Local development

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Set these in `.env` so the dev server proxies the on-prem API exactly as
production does:

```ini
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_MAP_URL=<your WebGIS URL>

NAS_API_URL=https://nas-api.example.com
NAS_WORKER_TOKEN=<same token as the worker>
```

`NAS_API_URL` and `NAS_WORKER_TOKEN` are deliberately **not** `VITE_`-prefixed:
the dev server reads them and injects the header, so the browser never sees the
token. If both are absent, the dev server registers no proxy and the interface
reports "worker proxy is not configured" rather than silently guessing a NAS.

```bash
npm run dev
```

### 7.7 Remote desktop (optional)

To embed a station's live desktop, run noVNC/websockify on that PC, expose it
through a tunnel hostname (e.g. `pc2-remote.example.com`), and set the station's
**remote desktop URL** in the application's provider settings.

A private `http://192.168.x.x` VNC URL will not work: the dashboard is served
over HTTPS and browsers block mixed content. Native `.rdp` download for LAN
operators still works.

---

## Next

Continue with [02-Operations.md](02-Operations.md): build the NAS layout, run the
worker and the four station agents, configure the application, and verify.