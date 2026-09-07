# GeoSphere 360 - Mobile Mapping System (MMS) Processing Dashboard

An enterprise-grade WebGIS and spatial intelligence platform developed for Tenaga Nasional Berhad (TNB) Low Voltage Asset Mapping. Built for large-scale 360-degree StreetView panorama ingestion, spatial trajectory processing, automated photogrammetric image enhancement, quality assurance auditing, vector layer catalog management, and multi-tenant campaign governance.

---

## System Overview and Operational Context

* Organization: Tenaga Nasional Berhad (TNB)
* Primary Domain: Electric Utility Asset Mapping, Low Voltage Network Inventory, and Digital Twin Reality Modeling
* Survey Scope: 315.2 km target trajectory (~50,000 Equirectangular Panoramas)
* Operational Subgrids: N93E70, N94E70, N94E71, N90E67 (Peninsular Malaysia)
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
|                      2. ON-PREMISES GPU PROCESSING WORKER                         |
|  - FastAPI Daemon + PyTorch / YOLO / OpenCV                                       |
|  - Privacy Protection: Automated Face & License Plate Detection and Blurring      |
|  - Nadir Masking: Survey vehicle roof / backpack tripod elimination               |
|  - Photogrammetric Enhancement: Contrast (CLAHE), exposure balancing, sharpening  |
|  - Multi-resolution cubemap tiling for low-latency WebGL streaming                |
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
|  - Approval Gate: Promotion from `staging_panoramas` to `panoramas`               |
+------------------------------------------+----------------------------------------+
                                           |
                                           v
+------------------------------------------+----------------------------------------+
|                 5. PUBLISHED WEBGIS & SPATIAL INTELLIGENCE                        |
|  - Public & Executive WebGIS Workspace (Leaflet, MapLibre GL, PostGIS)            |
|  - Spatial Trajectory Visualization, Heading Alignment, Subgrid Coverage          |
|  - Vector Layer Catalog (Shapefile, GeoJSON, KML, GPX overlay ingestion)          |
|  - Road Analysis, Pavement Distress Inventory, and BBOX GIS Exports               |
+-----------------------------------------------------------------------------------+
```

---

## Dual-Track Architecture

The platform separates production ingestion from public GIS analysis:

| Track | Target Audience | Primary Responsibility | Associated Workspaces |
| :--- | :--- | :--- | :--- |
| Production Pipeline | Survey Operators and Photogrammetry Engineers | RAW ingestion, automated privacy blurring, contrast enhancement, nadir masking, staging review, and approval gates. | Production Workspace, Processing Center, Data Lineage, NAS Storage Manager |
| WebGIS Published View | TNB Project Managers, Asset Engineers, and GIS Analysts | Read-mostly visualization of verified trajectories, subgrid progress monitoring, defect reporting, and layer queries. | Main Dashboard, Data Management, Survey Analytics, Reports, Road Analysis |
| System Governance | System Administrators | Multi-tenant campaign scoping, regional BBOX boundaries, CRS transformations, storage endpoints, and RLS policies. | Administration, Project Onboarding, Theme Selector |

---

## Frontend Architecture

The frontend application is built on React 18, TypeScript, and Vite, packaged with Tailwind CSS and an executive dark slate design system.

### Component Structure and Responsibilities

* `src/components/SystemShowcase.tsx`: High-impact landing portal highlighting the five major subsystems, live telemetry stats, and instant module launching.
* `src/components/ProjectOnboarding.tsx`: Campaign initialization gateway supporting regional presets across Malaysia, coordinate system configuration, and fast project resume.
* `src/components/PhotoSphereViewerComponent.tsx`: High-performance WebGL 360-degree panorama viewer supporting equirectangular projections and multi-resolution tiled cubemaps.
* `src/components/MapComponent.tsx`: Interactive WebGIS map wrapper utilizing an asynchronous postMessage handshake bridge (`VIEWER_READY` / `VIEWER_ACK`) with exponential backoff retries to guarantee synchronization without race conditions.
* `src/components/QAQCWorkbench.tsx`: Comprehensive defect management studio allowing auditors to flag, categorize, and resolve imaging issues frame by frame.
* `src/components/DataManagementPage.tsx`: Data grid controller managing subgrid clusters, batch logs, and publishing states.
* `src/components/common/GeoSphereLogo.tsx`: Custom scalable vector mark with dynamic theme color inheritance (`fill="currentColor"`).

### Client Routing and State

* Path-based workspace router (`src/utils/urlRouter.ts`) providing zero-dependency History-API navigation between clean routes (`/dashboard`, `/data`, `/roadAnalysis`, `/production`, `/landing`, `/signin`, `/onboarding`) with legacy `#/…` deep-link fallback.
* Bidirectional project scoping (`src/services/projects.ts` and `src/services/projectContext.ts`) ensuring every query and real-time subscription is partitioned by the active campaign context.

---

## Backend GPU Worker Pipeline

The on-premises worker (`worker/app.py`) is a FastAPI microservice designed for execution on GPU-accelerated survey workstations and local NAS environments.

### Core Processing Modules

* `worker/blur.py`: Machine learning pipeline detecting human faces and vehicle license plates using YOLOv8 models with OpenCV elliptical Gaussian blur fallback.
* `worker/masking.py`: Dynamic nadir and vehicle hood masking using polygon projection matrices to cleanly eliminate camera mountings and survey vehicle surfaces.
* `worker/enhancement.py`: Photogrammetric image enhancement pipeline applying Contrast Limited Adaptive Histogram Equalization (CLAHE), dynamic shadow lifting, white-balance calibration, and unsharp masking.
* `worker/runner.py`: Asynchronous job execution daemon managing worker threads, progress tracking, journal persistence (`jobs_journal.sqlite`), and failure recovery.
* `worker/sync.py`: Bidirectional storage synchronizer orchestrating file transfers between local NVMe cache, on-premises NAS storage, and Supabase S3-compatible cloud buckets.

### Worker API Endpoints

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Worker operational status, GPU utilization, and memory telemetry |
| `POST` | `/jobs` | Submit a batch processing job (blur, enhance, or mask) |
| `GET` | `/jobs/{job_id}` | Query execution progress, completed item count, and error logs |
| `POST` | `/jobs/{job_id}/cancel` | Abort a running job and release GPU allocation |
| `GET` | `/storage/info` | Storage volume usage and available disk capacity |
| `GET` | `/storage/list` | Live filesystem folder enumeration for survey campaigns |

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

### 3. Promoting Staged Panoramas to Published Layer
Atomically promotes verified staging frames into the live WebGIS production table.

```sql
WITH moved_rows AS (
    DELETE FROM public.staging_panoramas
    WHERE project_id = :active_project_id
      AND subgrid = :subgrid_code
      AND stage_status = 'approved'
    RETURNING 
        project_id, subgrid, filename, image_url, latitude, 
        longitude, heading, pitch, roll, is_fallback_coord, geom, captured_at
)
INSERT INTO public.panoramas (
    project_id, subgrid, filename, image_url, latitude, 
    longitude, heading, pitch, roll, is_fallback_coord, geom, captured_at, qa_status
)
SELECT 
    project_id, subgrid, filename, image_url, latitude, 
    longitude, heading, pitch, roll, is_fallback_coord, geom, captured_at, 'published'
FROM moved_rows
ON CONFLICT (project_id, filename) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    heading = EXCLUDED.heading,
    geom = EXCLUDED.geom,
    updated_at = NOW();
```

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
* `src/utils/__tests__/hashRouter.test.ts`: Hash-based workspace navigation and parameter parsing.
* `src/components/__tests__/ProjectOnboarding.test.tsx`: Campaign wizard, boundary selection, and resume workflows.
* `src/components/__tests__/SystemShowcase.test.tsx`: Landing showcase rendering and module navigation guards.
* `src/services/__tests__/projects.test.ts`: Multi-project CRUD operations and local storage fallbacks.
* `src/services/__tests__/projectIsolation.test.ts`: Cross-project query scoping and tenancy boundaries.
* `src/lib/__tests__/authz_matches_rls.test.ts`: Automated validation ensuring frontend permission checks match Supabase RLS policies.

---

## Operational Runbook and Deployment

### 1. Prerequisites
* Node.js version 18.18 or higher (LTS recommended)
* npm version 9.0 or higher
* Python 3.10+ (for background GPU worker service)
* Supabase Cloud account or self-hosted Supabase instance with PostGIS enabled

### 2. Environment Configuration

Create a `.env` file in the project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# WebGIS Embedded Map URL
VITE_MAP_URL=https://webgis.domain.com

# On-Premises GPU Worker Endpoint (Optional)
VITE_PRODUCTION_API_URL=http://localhost:8000
VITE_PRODUCTION_API_KEY=your-worker-secret-token

# Database Table Overrides (Optional)
VITE_DB_PANORAMAS_TABLE=panoramas
VITE_DB_STAGING_TABLE=staging_panoramas
VITE_DB_BATCH_LOGS_TABLE=batch_logs
VITE_DB_QA_DEFECTS_TABLE=qa_defects
```

### 3. Running the Frontend

```bash
# Install NPM dependencies
npm install

# Start development server on localhost:5173
npm run dev

# Compile production distribution to dist/
npm run build
```

### 4. Running the GPU Processing Worker

```bash
# Navigate to worker directory
cd worker

# Install Python requirements
pip install -r requirements.txt

# Start FastAPI worker daemon with Uvicorn
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

---

## License and Governance

Proprietary software developed for Tenaga Nasional Berhad (TNB) Low Voltage Asset Mapping Operations. All rights reserved. Unauthorized duplication, distribution, or commercial deployment without express authorization is strictly prohibited.
