# Environment Variable Classification & Security Contract

> **Authoritative Specification:** Reconciled for v40 Work Package 7 (F5).
> **Security Mandate:** The browser must **never** hold a build-time secret. Any variable prefixed with `VITE_` is statically compiled into client JavaScript assets (`dist/assets/*.js`) and is publicly visible to anyone inspecting web traffic or application bundles.

---

## 1. Security Architecture & Threat Model

Vite inlines all `import.meta.env.VITE_*` expressions into production bundles as string literals. Consequently, static secrets compiled into `VITE_*` variables cannot be kept confidential.

The GeoSphere 360 platform enforces a three-tier taxonomy:
1. **Tier 1 (Public Client Env):** Statically inlined into client bundles. Must be public by design.
2. **Tier 2 (Server-Side Secrets):** Kept strictly in Cloudflare Pages Secrets or untracked local `.env`. Attached to requests only by server-side proxies.
3. **Tier 3 (Server Configuration):** Private infrastructure URLs and server settings. Never read by the browser.

```
┌────────────────────────────────────────────────────────────────────────┐
│ BROWSER CLIENT (Public Bundle)                                          │
│ - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (RLS-guarded)              │
│ - VITE_MAP_URL (WebGIS portal origin)                                  │
│ - VITE_WORKER_API_MODE=proxy (Default transport)                       │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ Same-origin request: /api/worker/...
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SERVER PROXY GATEWAY (Cloudflare Pages Functions / Vite Dev Proxy)     │
│ - Authenticates user session (Supabase access_token)                   │
│ - Injects NAS_WORKER_TOKEN server-side                                 │
│ - Injects CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET                 │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ Forwarded over Cloudflare Tunnel
                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│ ON-PREM NAS GPU WORKER (FastAPI on-prem)                               │
│ - Verifies Authorization: Bearer <NAS_WORKER_TOKEN>                    │
│ - Operates raw survey filesystem and preview generator                │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Complete Classification Matrix

### Tier 1: Client Environment Variables (`VITE_*`) — Public by Design

All variables below are permitted to carry the `VITE_` prefix and be referenced via `import.meta.env`.

| Variable Name | Required | Default / Fallback | Classification & Purpose |
| :--- | :---: | :--- | :--- |
| `VITE_SUPABASE_URL` | **Yes** | — | Public REST & Realtime endpoint URL. |
| `VITE_SUPABASE_ANON_KEY` / `VITE_SUPABASE_KEY` | **Yes** | — | Public anonymous client JWT. Access is restricted at the database layer by Postgres Row-Level Security (RLS). |
| `VITE_MAP_URL` | **Yes** | — | Target origin of the embedded WebGIS map iframe. Used by `createMapOriginMatcher` to validate `postMessage` events. |
| `VITE_WORKER_API_MODE` | No | `proxy` | Transport mode for NAS worker (`proxy` or `direct`). Always `proxy` in production. |
| `VITE_STATION_AGENT_MODE` | No | `proxy` (prod), `direct` (dev) | Transport mode for station agents (`proxy` or `direct`). |
| `VITE_STORAGE_PROVIDER` | No | `cloudflare_r2` | Active storage engine identifier (`supabase`, `cloudflare_r2`, `aws_s3`, `gcs`, `azure_blob`, `wasabi`, `nas_local`). |
| `VITE_SUPABASE_BUCKET` / `VITE_STORAGE_BUCKET` | No | `MMS_PIC` | Default public bucket name for panorama assets. |
| `VITE_R2_BUCKET` / `VITE_R2_DOMAIN` | No | — | Cloudflare R2 bucket name and public CDN domain. |
| `VITE_ROAD_GEOMETRY_BUCKET` | No | `road-analysis-geometry` | Bucket name for serialized road analysis vector layers. |
| `VITE_S3_BUCKET` / `VITE_S3_REGION` | No | `ap-southeast-1` | AWS S3 bucket name and region. |
| `VITE_GCS_BUCKET` | No | — | Google Cloud Storage bucket name. |
| `VITE_AZURE_ACCOUNT` / `VITE_AZURE_CONTAINER` | No | — | Azure Blob Storage account and container name. |
| `VITE_WASABI_BUCKET` / `VITE_WASABI_REGION` | No | `us-east-1` | Wasabi storage bucket and region. |
| `VITE_IMAGE_CDN_URL` | No | — | Generic image CDN origin. |
| `VITE_NAS_SERVER_URL` | No | — | Direct NAS image origin (only when direct image serving is explicitly chosen). |
| `VITE_NAS_WORK_BASE_PATH` | No | — | Default base directory on NAS filesystem for survey folder discovery. |
| `VITE_PRODUCTION_API_URL` | No | — | Direct worker URL (only honoured when `VITE_WORKER_API_MODE=direct`). |
| `VITE_ROAD_EXTRACTION_ROUTE` | No | `overpass` | Road network source (`overpass` or `custom`). |
| `VITE_ROAD_EXTRACTION_PROXY` | No | `/api/road-extraction` | Server proxy path for Overpass queries. |
| `VITE_ROAD_EXTRACTION_DIRECT` | No | off | Direct Overpass fallback flag (debug only). |
| `VITE_ROAD_EXTRACTION_URL` | No | overpass-api.de | Overpass API fallback URL. |
| `VITE_MAPLIBRE_WORKER_URL` | No | bundled | URL for self-hosted MapLibre web worker. |
| `VITE_SHARE_LIVE_MODE` | No | off | Flag to embed interactive WebGIS into share views. |
| `VITE_DB_*` (8 table overrides) | No | standard table names | Database table/view name overrides. |
| `VITE_SENTRY_DSN` | No | — | Sentry error reporting ingest URL (public client ingest key). |
| `VITE_DATA_QUIET` | No | off | Development console warning suppressor. |
| `VITE_BRAND_*` (6 variables) | No | GeoSphere defaults | Reseller white-labeling text, domain, and seed constants. |

---

### Tier 2: Server-Side Secrets (NEVER `VITE_`)

**Strict Rule:** Variables in this tier must **never** be prefixed with `VITE_`. They must **never** appear in `src/` or client code. They are configured exclusively in Cloudflare Pages Secrets or the local untracked `.env`.

| Variable Name | Environment | Purpose & Protection |
| :--- | :--- | :--- |
| `NAS_WORKER_TOKEN` | Cloudflare Pages / Dev `.env` | Secret bearer token guarding the on-prem NAS GPU Worker (`worker/app.py`). Attached to upstream requests by `functions/api/worker/[[path]].js` and `vite.config.ts`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Pages / CLI | Database superuser key that bypasses RLS. Used exclusively in database migration CLI scripts and the server-side member invitation endpoint (`functions/api/console-invite.js`). |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Pages | Cloudflare Access service token ID for authenticating through the Cloudflare Tunnel to the on-prem worker. |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Pages | Cloudflare Access service token secret. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare Pages / Scripts | Private S3-compatible credentials for server-side direct bucket management. |

---

### Tier 3: Server Configuration Variables (NEVER `VITE_`)

Variables in this tier configure local developer proxies and runtime infrastructure. They are never compiled into client code.

| Variable Name | Environment | Purpose |
| :--- | :--- | :--- |
| `NAS_API_URL` | Cloudflare Pages / Dev `.env` | Target tunnel URL to the on-prem worker (e.g. `https://nas-worker.internal.domain` or `http://localhost:8000`). Read by proxy endpoints. |
| `PORT` | Local environment | Local HTTP listening port. |
| `NODE_ENV` | Build / runtime | Runtime environment identifier (`development`, `production`, `test`). |

---

## 3. Automated Enforcements & Audit Ratchets

The repository maintains automated machine enforcement in CI and pre-commit checks:

1. **Static Secret Detection (`scripts/audit/static-scan.mjs`)**:
   - `secretShapedClientEnv: 0`: Asserts that zero client env variables matching `/(?:^|_)(?:API_KEY|SECRET|TOKEN|PASSWORD)$/i` exist, except for explicitly allowlisted public anon keys (`VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_KEY`).
   - `hardcodedSecrets: 0`: Asserts that zero live credential patterns (`sk_live_*`, `AKIA*`, `xox*`, or JWT literals) exist in un-commented source code.
2. **Production Bundle Verification**:
   - Running `npm run build` generates production assets into `dist/`. Grepping `dist/assets/` for `VITE_PRODUCTION_API_KEY` or worker secret tokens yields zero matches.
3. **Documentation Verification (`npm run docs:verify`)**:
   - Cross-checks all reference tables in `docs/Production Setup/` against codebase reality.
