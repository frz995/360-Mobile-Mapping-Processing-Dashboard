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
|  - Frame-by-frame visual audit: Blurry Frame, Obstruction, Camera Tilt, Bad GPS   |
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

* `src/components/SystemShowcase.tsx`: High-impact landing portal highlighting the five major subsystems, live telemetry stats, and instant module launching.
* `src/components/ProjectOnboarding.tsx`: Campaign initialization gateway supporting regional presets across Malaysia, coordinate system configuration, and fast project resume.
* `src/components/PhotoSphereViewerComponent.tsx`: High-performance WebGL 360-degree panorama viewer supporting equirectangular projections and multi-resolution tiled cubemaps.
* `src/components/MapComponent.tsx`: Interactive WebGIS map wrapper utilizing an asynchronous postMessage handshake bridge (`VIEWER_READY` / `VIEWER_ACK`) with exponential backoff retries to guarantee synchronization without race conditions.
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

The database layer runs on PostgreSQL 15 with the PostGIS 3.3 extension. All spatial entities are stored in standard coordinate systems (WGS84 EPSG:4326) with automatic spatial indexing.

### Database Tables

#### 1. `public.panoramas` (Published WebGIS Panoramas)
Contains all verified, published StreetView frames visible to the WebGIS client.

```sql
CREATE TABLE public.panoramas (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    subgrid VARCHAR(50) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    image_url TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION DEFAULT 0,
    pitch DOUBLE PRECISION DEFAULT 0,
    roll DOUBLE PRECISION DEFAULT 0,
    is_fallback_coord BOOLEAN DEFAULT false,
    geom GEOMETRY(Point, 4326),
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'yes',
    qa_status VARCHAR(50) DEFAULT 'published',
    defect_flags JSONB DEFAULT '{}'::jsonb,
    defect_count INT DEFAULT 0,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT panoramas_project_filename_unique UNIQUE (project_id, filename)
);

CREATE INDEX idx_panoramas_geom ON public.panoramas USING GIST (geom);
CREATE INDEX idx_panoramas_subgrid ON public.panoramas (subgrid);
CREATE INDEX idx_panoramas_project_id ON public.panoramas (project_id);
```

#### 2. `public.staging_panoramas` (Operator Staging Pipeline)
Holds newly ingested panoramas undergoing QA inspection prior to publication.

```sql
CREATE TABLE public.staging_panoramas (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    subgrid VARCHAR(50) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    image_url TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    heading DOUBLE PRECISION DEFAULT 0,
    pitch DOUBLE PRECISION DEFAULT 0,
    roll DOUBLE PRECISION DEFAULT 0,
    is_fallback_coord BOOLEAN DEFAULT false,
    geom GEOMETRY(Point, 4326),
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    stage_status VARCHAR(50) DEFAULT 'staged',
    validation_errors JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT staging_project_filename_unique UNIQUE (project_id, filename)
);

CREATE INDEX idx_staging_panoramas_geom ON public.staging_panoramas USING GIST (geom);
CREATE INDEX idx_staging_panoramas_subgrid ON public.staging_panoramas (subgrid);
```

#### 3. `public.batch_logs` (Survey Telemetry and KPIs)
Tracks survey runs, operator performance, and trajectory health.

```sql
CREATE TABLE public.batch_logs (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    subgrid VARCHAR(50) NOT NULL,
    survey_date DATE NOT NULL,
    total_panoramas INT NOT NULL DEFAULT 0,
    total_distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
    health_score INT NOT NULL DEFAULT 100,
    operator_name VARCHAR(100),
    vehicle_unit VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 4. `public.qa_defects` (Defect Audit Records)
Maintains defect logs flagged by QA inspectors during 360-degree review.

```sql
CREATE TABLE public.qa_defects (
    id BIGSERIAL PRIMARY KEY,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    panorama_id BIGINT REFERENCES public.panoramas(id) ON DELETE CASCADE,
    defect_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium',
    notes TEXT,
    resolved BOOLEAN DEFAULT false,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 5. `public.vector_layers_meta` (Geospatial Vector Catalog)
Tracks uploaded GeoJSON, Shapefile, KML, and GPX layers.

```sql
CREATE TABLE public.vector_layers_meta (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    layer_name VARCHAR(255) NOT NULL,
    file_format VARCHAR(20) NOT NULL,
    storage_path TEXT NOT NULL,
    feature_count INT DEFAULT 0,
    bounds JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 6. `public.projects` (Multi-Campaign Isolation)
Stores project campaign scopes, regional boundaries, and theme settings.

```sql
CREATE TABLE public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Production Database Queries

### 1. Spatial Trajectory Query (Bounding Box Filtering)
Queries published panorama frames within an active map bounding box for WebGL trajectory reconstruction.

```sql
SELECT 
    id, 
    subgrid, 
    filename, 
    latitude, 
    longitude, 
    heading, 
    qa_status,
    image_url
FROM public.panoramas
WHERE project_id = :active_project_id
  AND geom && ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
ORDER BY captured_at ASC;
```

### 2. Subgrid Coverage and Distance Aggregation
Calculates completed survey distance and frame volume per subgrid.

```sql
SELECT 
    subgrid,
    COUNT(id) AS total_frames,
    ROUND(SUM(calculate_distance_km)::numeric, 2) AS total_km,
    COUNT(CASE WHEN qa_status = 'published' THEN 1 END) AS approved_frames,
    COUNT(CASE WHEN defect_count > 0 THEN 1 END) AS flagged_defects
FROM (
    SELECT 
        id, 
        subgrid, 
        qa_status, 
        defect_count,
        ST_Distance(
            geom::geography, 
            LAG(geom::geography) OVER (PARTITION BY subgrid ORDER BY captured_at)
        ) / 1000.0 AS calculate_distance_km
    FROM public.panoramas
    WHERE project_id = :active_project_id
) AS trajectory_calculations
GROUP BY subgrid
ORDER BY subgrid ASC;
```

### 3. Publishing Verified Panoramas to the WebGIS Layer
The WebGIS release gate (`src/components/production/hub/WebGISPublishGate.tsx`)
writes the approved frames straight into `panoramas` with a chunked upsert. It
does **not** read `staging_panoramas`; that table is populated by the CSV import
in Data Management and is used for operator review, not as a promotion queue.
Each record must carry a target filename and finite coordinates before it is
publishable. The effective write is:

```sql
INSERT INTO public.panoramas (
    project_id, subgrid, filename, image_url, latitude,
    longitude, heading, qa_status, geom
)
VALUES (..., 'published', ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography::geometry)
ON CONFLICT (project_id, filename) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    heading = EXCLUDED.heading,
    geom = EXCLUDED.geom,
    updated_at = NOW();
```

Apply the `panoramas` policies below before enabling the release gate.

---

## Security Governance and Row Level Security (RLS)

Database security is enforced at the PostgreSQL engine level using Row Level Security policies:

```sql
ALTER TABLE public.panoramas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_panoramas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- 1. Public Role: Read-only access to published panoramas
CREATE POLICY "Public Read Published Panoramas"
ON public.panoramas
FOR SELECT
TO anon, authenticated
USING (qa_status = 'published');

-- 2. Authenticated Staff: Full access restricted to active project context
CREATE POLICY "Staff Manage Panoramas"
ON public.panoramas
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' IS NOT NULL)
WITH CHECK (auth.jwt() ->> 'email' IS NOT NULL);

-- 3. Staging Pipeline: Operators only
CREATE POLICY "Operators Manage Staging"
ON public.staging_panoramas
FOR ALL
TO authenticated
USING (auth.jwt() ->> 'email' IS NOT NULL)
WITH CHECK (auth.jwt() ->> 'email' IS NOT NULL);
```

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
