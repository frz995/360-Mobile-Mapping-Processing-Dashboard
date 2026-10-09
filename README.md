# GeoSphere 360 - Mobile Mapping System (MMS) Processing Dashboard

An enterprise-grade WebGIS and spatial intelligence platform for utility low-voltage asset mapping. Built for large-scale 360-degree StreetView panorama ingestion, spatial trajectory processing, operator-guided photogrammetric image enhancement on workstation PCs, quality assurance auditing, vector layer catalog management, and campaign governance.

---

## Setup & Installation

**Client-facing installation documentation:** [`docs/Production Setup/README.md`](<docs/Production Setup/README.md>)

📄 **[Production Setup Guide (PDF, 42 pages)](<docs/Production Setup/GeoSphere-360-Production-Setup-Guide.pdf>)** — the single complete deliverable: architecture diagrams, step-by-step installation, flowcharts and an acceptance sign-off sheet. Print it or issue it as the client installation manual.

Markdown source and per-section detail live alongside it. Covers accounts and prerequisites, the database and storage buckets, the first-administrator bootstrap, Cloudflare Tunnel, the Cloudflare Pages deployment, the NAS layout and on-prem services, first-run configuration, and how to verify the install. Known limitations and troubleshooting are catalogued in [`03-Reference.md`](<docs/Production Setup/03-Reference.md>).

---

## System Overview and Operational Context

* Organization: Electric distribution utility asset mapping operations
* Primary Domain: Electric Utility Asset Mapping, Low Voltage Network Inventory, and Digital Twin Reality Modeling
* Survey Scope: configured per project (target trajectory length and panorama count are project settings, not fixed here)
* Operational Subgrids: named per project (UTM 100 km grid squares, e.g. `N93E70`), configured during project setup
* Data Acquisition Systems: MMS Vehicle Survey Rig (rooftop multi-lens array) and Backpack Mobile Survey Unit (pedestrian and narrow alley surveys)
* Database Engine: PostgreSQL 15 with PostGIS 3.3 geospatial extension hosted on Supabase Cloud
* Storage Infrastructure: Network Attached Storage (NAS) on-premises cluster combined with Supabase Cloud Object Storage (`/MMS_PIC/` imagery bucket and `/vector_layers/` spatial catalog)

---

## End-to-End System Architecture and Data Lifecycle

The GeoSphere 360 ecosystem operates as an end-to-end processing pipeline, transitioning data from raw field telemetry to published GIS layers:

```
+-----------------------------------------------------------------------------------+
|                           1. FIELD DATA ACQUISITION                               |
|  - MMS Vehicle Survey Rig (360 multi-camera array)                                |
|  - MMS Backpack Mobile Survey Unit (GNSS/IMU + 360 camera)                        |
|  - Output: Raw equirectangular imagery + GNSS/IMU telemetry CSVs                  |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+------------------------------------------+----------------------------------------+
|                      2. ON-PREMISES NAS WORKER SERVICE                             |
|  - FastAPI Daemon exposing the NAS survey tree to the dashboard                      |
|  - Survey scans: subgrids, capture folders, CSV telemetry, image inventories           |
|  - Storage telemetry: volume usage and per-folder image counts                         |
|  - Panorama previews: conditional-GET image streaming through the tunnel              |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+------------------------------------------+----------------------------------------+
|                 3. CLOUD DATABASE & GEOSPATIAL STORAGE                            |
|  - PostgreSQL 15 + PostGIS 3.3 (Supabase Cloud)                                   |
|  - Ingestion to `staging_panoramas` (Private Operator Staging)                    |
|  - Spatial validation & GPS sanitization (anti-Null Island centroid fallbacks)    |
|  - Object Storage Sync: High-resolution imagery to `/MMS_PIC/` bucket             |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+------------------------------------------+----------------------------------------+
|                   4. QUALITY ASSURANCE & AUDITING (QA/QC)                         |
|  - PhotoSphereViewer v5 WebGL Panoramic Inspector                                 |
|  - Frame-by-frame visual audit: Blurry Frame, Obstruction, Solar Glare, Bad GPS  |
|  - Approval Gate: Release writes approved frames into `panoramas`          |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+------------------------------------------+----------------------------------------+
|                 5. PUBLISHED WEBGIS & SPATIAL INTELLIGENCE                        |
|  - Public & Executive WebGIS Workspace (Leaflet, MapLibre GL, PostGIS)            |
|  - Spatial Trajectory Visualization, Heading Alignment, Subgrid Coverage          |
|  - Vector Layer Catalog (Shapefile, GeoJSON, KML, GPX overlay ingestion)          |
|  - Road Analysis, Coverage & Analytics, and BBOX GIS Exports                   |
+-----------------------------------------------------------------------------------+
```

---

## Dual-Track Architecture

The platform separates production ingestion from public GIS analysis:

| Track | Target Audience | Primary Responsibility | Associated Workspaces |
| :--- | :--- | :--- | :--- |
| Production Pipeline | Survey Operators and Photogrammetry Engineers | RAW ingestion, station-guided privacy blurring, contrast enhancement and nadir masking performed in workstation software, staging review, and approval gates. | Production Hub, NAS & Daemon |
| WebGIS Published View | Project Managers, Asset Engineers, and GIS Analysts | Read-mostly visualization of verified trajectories, subgrid progress monitoring, defect reporting, and layer queries. | Main Dashboard, Data Management, Survey Analytics, Reports, Road Analysis |
| System Governance | System Administrators | Per-project campaign scoping (data isolated by `project_id`), regional BBOX boundaries, CRS transformations, storage endpoints, and RLS policies. | Administration, Project Onboarding, Theme Selector |

---

## Frontend Architecture

The frontend application is built on React 18, TypeScript, and Vite, packaged with Tailwind CSS and an executive dark slate design system.

### Component Structure and Responsibilities

* `src/components/SystemShowcase.tsx`: High-impact landing portal highlighting the six major subsystems and instant module launching.
* `src/components/ProjectOnboarding.tsx`: Campaign initialization gateway supporting regional presets across Malaysia, coordinate system configuration, and fast project resume.
* `src/components/PhotoSphereViewerComponent.tsx`: High-performance WebGL 360-degree panorama viewer supporting equirectangular projections and multi-resolution tiled cubemaps.
* `src/components/MapComponent.tsx`: Interactive WebGIS map wrapper using a `postMessage` handshake bridge (`VIEWER_READY`, acknowledged with `MAP_READY`). The remote WebGIS sends no acknowledgement of its own, so dismissal is timer-driven and the retries are fixed delays (350 ms, 1 s), not exponential backoff.
* `src/components/QAQCWorkbench.tsx`: Comprehensive defect management studio allowing auditors to flag and categorize imaging issues frame by frame, and export the audit.
* `src/components/DataManagementPage.tsx`: Data grid controller managing subgrid clusters, batch logs, and publishing states.
* `src/components/common/GeoSphereLogo.tsx`: Custom scalable vector mark with dynamic theme color inheritance (`fill="currentColor"`).

### Client Routing and State

* Path-based workspace router (`src/utils/urlRouter.ts`) providing zero-dependency History-API navigation between clean routes (`/dashboard`, `/data`, `/roadAnalysis`, `/production`, `/landing`, `/signin`, `/onboarding`) with legacy `#/…` deep-link fallback.
* Bidirectional project scoping (`src/services/projects.ts` and `src/services/projectContext.ts`) ensuring every query and real-time subscription is partitioned by the active campaign context.

---

## On-Premises NAS Worker

The on-premises worker (`worker/app.py`) is a FastAPI microservice that exposes the local NAS to the dashboard. It runs on the survey workstation and serves the survey filesystem over a Cloudflare Tunnel.

It does **not** perform image processing. Panorama QA/QC (sharpness, blur, obstruction, glare) runs entirely in the browser on a WebGL/CPU path — see `src/utils/gpuAnalyzer.ts` and `src/workers/qaqc.worker.ts`. There is no server-side batch image pipeline and no GPU job queue.

### Modules

* `worker/app.py`: HTTP surface, path-safety resolution under `NAS_BASE_PATH`, token guard, and RFC 9110 conditional-GET handling for image previews.
* `worker/nas_scan.py`: Survey metadata scans — subgrids, capture folders, CSV telemetry reads, image inventories and the processing registry. Standard library only.

### Worker API Endpoints

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Worker liveness and the configured NAS mount |
| `GET` | `/api/folders` | Filesystem folder enumeration with per-folder image counts |
| `GET` | `/api/storage` | Storage volume usage and per-top-level folder breakdown |
| `GET` | `/api/nas-scan` | Survey scans; `action` is one of `subgrids`, `survey-folders`, `read-csv`, `folder-images`, `final-images`, `registry` |
| `GET` | `/api/images/{path}` | Panorama preview bytes with `ETag`/`Last-Modified` and `304` revalidation |

---

## Database Schema and PostGIS Integration

The database layer runs on PostgreSQL 15 with PostGIS. Spatial entities are
stored in WGS84 (EPSG:4326) with spatial indexing.

> **This section used to carry hand-written `CREATE TABLE` and `CREATE POLICY`
> blocks. They have been removed deliberately.** Two of the documented policies
> were weaker than the ones the migrations actually install — one granted
> anonymous public read of published panoramas, and one granted every
> signed-in user write access to the staging pipeline — so following them would
> have downgraded the database's security posture.
>
> **The migrations are the schema.** Read `supabase/migrations/` (applied
> top-to-bottom, `0001`-`0035`) and `supabase/migrations/README.md` for the
> authoritative table list, the apply sequence, and the idempotency notes. There
> is no `supabase db push` in this project: migrations are applied by hand in
> the documented order.

### Tables

Grouped by purpose; column-level detail lives in the migrations.

| Group | Tables |
| --- | --- |
| Projects and scope | `projects`, `subgrids`, `project_settings` |
| Published WebGIS data | `panoramas`, `map_shares`, `file_inventory` |
| Field intake and processing | `staging_panoramas`, `datasets`, `processing_jobs` |
| Production pipeline | `production_runs`, `production_releases`, `production_release_files`, `production_run_attempts`, `station_board_items`, `stage_event_ledger`, `hub_session_state` |
| Quality | `qa_defects`, `qaqc_audit_runs`, `survey_metadata_filenames` |
| Deletion and recovery | `recycle_bin`, `survey_recycle_bin`, `deletion_requests` |
| Identity and governance | `user_accounts`, `audit_logs`, `notifications` |

### Row Level Security

RLS is enforced at the PostgreSQL engine level and is **the** security
boundary — the TypeScript permission matrix in `src/lib/authz.ts` decides only
what to show or hide.

Policies call `sec.can('<capability>')`, defined in migration
`0009_security_functions.sql` as `SECURITY DEFINER` + `stable` with a pinned
`search_path`. Eight capabilities are actually enforced in SQL
(`ENFORCED_CAPABILITIES` in `src/lib/authz.ts`); the rest of the matrix is
advisory UI gating. From migration `0030` the `user_accounts` row wins whenever
one exists — the JWT claim is only the no-row bootstrap fallback.

**Do not hand-write policy blocks.** Two of the examples this section used to
carry (`USING (qa_status = 'published')` for `anon`, and
`USING (auth.jwt() ->> 'email' IS NOT NULL)`) are weaker than the installed
policies, and the first is publicly readable. Add capabilities to `sec.can()`
in a migration and to `src/lib/authz.ts`; never relax a policy in the client.

See `supabase/migrations/README.md` and `docs/Production Setup/03-Reference.md`
for the capability matrix and the grant/role catalogue.

---

## Coordinate Reference Systems (CRS) and Malaysia Regional Bounds

The platform natively supports coordinate transformations across official Malaysian surveying datums:

* WGS84 Geographic (EPSG:4326): Global standard for GPS positioning and equirectangular panorama metadata.
* Kertau 1948 / RSO Malaya (EPSG:3168): Rectified Skew Orthomorphic projection standard for Peninsular Malaysia infrastructure and cadastral surveys.
* Timbalai 1948 / RSO Borneo (EPSG:29873): Standard projection for Sabah and Sarawak utility networks.

### Supported Regional Boundaries

The application provides pre-configured spatial bounding envelopes for all Malaysian states:
* Selangor and Federal Territory of Kuala Lumpur / Putrajaya
* Johor Darul Ta'zim
* Perak Darul Ridzuan
* Pahang Darul Makmur
* Penang, Kedah, and Perlis
* Negeri Sembilan and Melaka
* Terengganu and Kelantan
* Sabah and Federal Territory of Labuan
* Sarawak
* Entire Malaysia (Unified National Bounding Box: 0.85°N to 7.35°N, 99.60°E to 119.30°E)
* Custom Geographic Envelope: User-defined BBOX or uploaded GeoJSON boundary polygon

---

## Verification, Testing, and Quality Assurance

The codebase maintains automated unit and integration tests across all critical algorithms:

```bash
# Execute full Vitest automated test suite
npm test -- --run

# Run TypeScript strict type verification
npx tsc -b

# Build production bundle with minification and chunk analysis
npm run build
```

Key test suites:
* `src/utils/__tests__/urlRouter.test.ts`: Path-based workspace navigation and parameter parsing.
* `src/components/__tests__/ProjectOnboarding.test.tsx`: Campaign wizard, boundary selection, and resume workflows.
* `src/components/__tests__/SystemShowcase.test.tsx`: Landing showcase rendering and module navigation guards.
* `src/services/__tests__/projects.test.ts`: Multi-project CRUD operations and local storage fallbacks.
* `src/services/__tests__/projectIsolation.test.ts`: Cross-project query scoping and tenancy boundaries.
* `src/lib/__tests__/authz_matches_rls.test.ts`: Automated validation ensuring frontend permission checks match Supabase RLS policies.

---

## Operational Runbook and Deployment

> **This section is an abbreviated convenience summary.** For a complete,
> current, client-facing installation guide — including the database migration
> sequence, storage buckets, the first-administrator bootstrap, Cloudflare Tunnel
> setup and the Pages deployment — see
> **[`docs/Production Setup/README.md`](<docs/Production Setup/README.md>)**.

### 1. Prerequisites
* Node.js version 18.18 or higher (LTS recommended)
* npm version 9.0 or higher
* Python 3.10+ (for the NAS worker and station agents)
* Supabase Cloud account or self-hosted Supabase instance with PostGIS enabled
* A Cloudflare account and a domain — the platform requires **five** HTTPS
  tunnel hostnames (one NAS worker, four station agents) and deploys to
  Cloudflare Pages

### 2. Environment Configuration

Create a `.env` file in the project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# WebGIS Embedded Map URL (no code fallback — required)
VITE_MAP_URL=https://webgis.domain.com

# Transport profiles (optional; these are the defaults)
# VITE_WORKER_API_MODE=proxy       # proxy | direct
# VITE_STATION_AGENT_MODE=proxy    # proxy | direct

# Direct-mode worker endpoint. ONLY honoured when VITE_WORKER_API_MODE=direct —
# the recommended setup proxies through Cloudflare Pages instead, which keeps the
# worker token server-side and off the client.
# VITE_PRODUCTION_API_URL=http://localhost:8000
# VITE_PRODUCTION_API_KEY=your-worker-secret-token

# Local dev proxy to the on-prem worker (NOT VITE_-prefixed: read by the Vite
# dev server, which injects the bearer token so the browser never sees it).
# Required only for `npm run dev` against a real NAS.
# NAS_API_URL=https://your-tunnel-host
# NAS_WORKER_TOKEN=the-worker-token

# Database Table Overrides (Optional)
VITE_DB_PANORAMAS_TABLE=panoramas
VITE_DB_STAGING_TABLE=staging_panoramas
VITE_DB_BATCH_LOGS_TABLE=batch_logs
VITE_DB_QA_DEFECTS_TABLE=qa_defects
```

A full, current variable reference — including the Cloudflare Pages runtime
secrets and the worker/agent variables — is in
[`docs/Production Setup/03-Reference.md`](<docs/Production Setup/03-Reference.md>) §3.

### 3. Running the Frontend

```bash
# Install NPM dependencies
npm install

# Start development server on localhost:5173
npm run dev

# Compile production distribution to dist/
npm run build
```

### 4. Running the NAS Worker

```bash
# Navigate to worker directory
cd worker

# Install Python requirements
pip install -r requirements.txt

# Start the FastAPI worker. Bind loopback only — a Cloudflare Tunnel on the same
# machine is the sole public entry point.
uvicorn app:app --host 127.0.0.1 --port 8000
```

Verify it serves the survey tree:

```bash
curl -H "Authorization: Bearer $NAS_WORKER_TOKEN" \
  "http://127.0.0.1:8000/api/nas-scan?action=subgrids"
```

### 5. Running the Station Agents

One per workstation PC. See [`docs/Production Setup/02-Operations.md`](<docs/Production Setup/02-Operations.md>) §3
for the `STATION_ID` map, environment variables and autostart setup.

---

## License and Governance

Proprietary software, licensed per the commercial terms accompanying your deployment. Redistribution or resale outside the licensed organisation requires a separate written agreement with the licensor.
