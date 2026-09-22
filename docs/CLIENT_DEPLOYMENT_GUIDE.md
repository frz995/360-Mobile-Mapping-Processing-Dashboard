# 🌍 GeoSphere 360 — Client Self-Deployment & Installation Manual

An enterprise Mobile Mapping System (MMS) Data Processing Factory and WebGIS Intelligence Platform. This manual guides your IT and engineering teams through installing, configuring, and operating the system on your own servers and workstations.

---

## 1. System Architecture Overview

The system operates across three coordinated tiers:

```
+─────────────────────────────────────────────────────────────────────────────+
│                       TIER 1: WEB CLIENT (FRONTEND)                         │
│  - React 18, TypeScript, Tailwind CSS, Vite                                 │
│  - WebGL 360° StreetView Panorama Viewer (PhotoSphereViewer v5)             │
│  - WebGIS Spatial Intelligence (MapLibre GL, Leaflet, PostGIS GeoJSON)      │
│  - Multi-threaded Web Workers (GIS Ingestion, Coverage, QA/QC)              │
+──────────────────────────────────────┬──────────────────────────────────────+
                                       │ HTTPS / WSS
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
│                  TIER 2: SPATIAL DATABASE & OBJECT STORAGE                  │
│  - PostgreSQL 15 + PostGIS 3.3 (Spatial geometry indexing & RLS)            │
│  - Supabase Cloud or Self-Hosted Docker Supabase                            │
│  - Object Storage: `/MMS_PIC/` (panoramas) & `/vector_layers/` (GIS files)  │
+──────────────────────────────────────▲──────────────────────────────────────+
                                       │ Internal LAN / Secure API
                                       ▼
+─────────────────────────────────────────────────────────────────────────────+
│                  TIER 3: GPU PROCESSING FACTORY (BACKEND)                   │
│  - Python 3.10+ FastAPI Daemon (`worker/app.py`)                            │
│  - Computer Vision / AI: YOLOv8 Face & License Plate Detection (PDPA/GDPR)  │
│  - Photogrammetric Enhancement: CLAHE, Unsharp Masking, Shadow Lifting      │
│  - Nadir Vehicle / Rig Elimination (Spherical Polygon Projections)          │
│  - High-Durability SQLite Journal (`jobs_journal.sqlite`)                   │
+─────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Hardware & Infrastructure Prerequisites

### 2.1 GPU Processing Workstation (MMS Worker)
* **Operating System**: Windows 10/11 Pro (64-bit) or Ubuntu Linux 22.04 LTS.
* **Processor (CPU)**: Intel Core i7/i9 (12th Gen+) or AMD Ryzen 7/9.
* **Graphics (GPU)**: **NVIDIA RTX 3070 / 3080 / 4070 / 4080 / 4090** (minimum 8 GB VRAM; 12–16 GB recommended for high batch concurrency).
* **CUDA Driver**: NVIDIA CUDA Toolkit 11.8 or 12.x installed.
* **System Memory (RAM)**: 32 GB RAM (64 GB recommended for 8K equirectangular images).
* **Storage**:
  * 1 TB NVMe SSD (High-speed scratch buffer for active processing).
  * Network Attached Storage (NAS) or high-capacity RAID hard drive for long-term raw survey archival.

### 2.2 Database & Hosting Server
* **Database**: PostgreSQL 15 with PostGIS 3.3 extension enabled (Managed Supabase Cloud Pro plan or Self-Hosted Supabase Docker container).
* **Frontend Web Server**: Any static web host (Nginx, Caddy, Vercel, Docker, or AWS S3 + CloudFront).
* **Node.js**: Version 18.x or 20.x LTS.

---

## 3. Step-by-Step Installation Procedure

### Step 1: Database & PostGIS Setup

1. **Provision Database**:
   * If using **Supabase Cloud**: Create a new project in your organization.
   * If using **Self-Hosted Docker**: Run `docker compose up -d` using the Supabase Docker stack.

2. **Execute Database Migrations**:
   Run the SQL migration scripts in chronological order from `supabase/migrations/` using the Supabase SQL Editor, DBeaver, or `psql`:

   ```bash
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
   0012_core_tables_and_rls.sql
   0013_prune_bloated_user_metadata.sql
   0014_road_analysis_state_rpc.sql
   0015_projects.sql
   0016_per_project_isolation.sql
   0017_project_delete_cascade.sql
   0018_map_shares.sql
   ```

3. **Verify Security Policies**:
   * Execute `0011_security_tests.sql` to verify that Row-Level Security (RLS) is active and protecting unauthorized access.

4. **Create Storage Buckets**:
   * In the Supabase Storage dashboard, create two public/authenticated buckets:
     * `MMS_PIC` — for processed 360 equirectangular panoramas and tiles.
     * `vector_layers` — for Shapefiles, GeoJSON, and KML overlays.

---

### Step 2: GPU Processing Worker Setup

1. **Navigate to the Worker Directory**:
   ```bash
   cd worker
   ```

2. **Create and Activate a Python Virtual Environment**:
   ```bash
   # Windows PowerShell
   python -m venv venv
   .\venv\Scripts\Activate.ps1

   # Linux / Ubuntu
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install Dependencies**:
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```
   *(Optional for LaMa inpainting): `pip install simple-lama-inpainting`*

4. **Configure Worker Environment**:
   Copy `.env.example` to `.env` and configure:
   ```ini
   # Root path where raw survey folders are mounted or stored
   NAS_BASE_PATH=D:\MMS_Storage\raw_surveys

   # Number of concurrent GPU workers (1 for 8GB VRAM, 2-4 for 16GB+ VRAM)
   CONCURRENCY=1

   # Connect to database for live job telemetry updates
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

   # SQLite journal to prevent data loss on unexpected power cuts
   WORKER_JOB_DB=jobs_journal.sqlite
   ```

5. **Start the GPU Processing Daemon**:
   ```bash
   uvicorn app:app --host 0.0.0.0 --port 8787 --workers 1
   ```
   Verify the worker is operational by visiting `http://localhost:8787/health` in your browser. You should see GPU status and memory allocation.

---

### Step 3: Frontend WebGIS Application Deployment

1. **Install Node.js Packages**:
   In the project root directory:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in your connection endpoints:
   ```ini
   # Database connection
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key-here

   # Primary storage bucket name
   VITE_SUPABASE_BUCKET=MMS_PIC

   # Backend GPU Worker API endpoint
   VITE_PRODUCTION_API_URL=http://<worker-ip-or-hostname>:8787
   ```

3. **Compile the Production Bundle**:
   ```bash
   npm run build
   ```
   This generates an optimized static production build in the `dist/` directory.

4. **Deploy the Production Build**:
   * **Nginx Example**:
     ```nginx
     server {
         listen 80;
         server_name mms.yourdomain.com;
         root /var/www/geosphere360/dist;
         index index.html;

         location / {
             try_files $uri $uri/ /index.html;
         }
     }
     ```
   * **Vercel / Cloudflare Pages**: Connect your Git repository and set the build command to `npm run build` and publish directory to `dist`.

---

## 4. End-to-End System Smoke Test

To confirm that the entire pipeline is operational:

1. **Open the Dashboard**: Visit your deployed web application URL.
2. **Launch a Project**: Create a new campaign (e.g., `Test Survey 01`) or choose a regional subgrid.
3. **Submit a Processing Job**:
   * Go to **Production Workspace** &rarr; **Processing Center**.
   * Select a folder containing equirectangular test images.
   * Enable **AI Privacy Blur** and **Nadir Masking**.
   * Click **Start Batch Processing**.
4. **Inspect in QA/QC Workbench**:
   * Once processed, open the **QA/QC Workbench**.
   * Navigate through the 360 viewer, rotate 360°, and verify face/license plate blur and vehicle hood removal.
   * Click **Approve & Publish to WebGIS**.
5. **Verify on WebGIS Map**:
   * Switch to the **Main Dashboard** WebGIS view.
   * Verify the trajectory line appears on the map, points match GPS coordinates, and clicking points launches the 360 viewer with orientation sync.

---

## 5. Security & Maintenance Best Practices

* **Network Isolation**: The GPU Worker (`port 8787`) should be kept on an internal LAN or behind a VPN / reverse proxy (BFF gateway). Never expose the raw worker port directly to the public internet.
* **Storage Backup**: Regularly back up the PostgreSQL database and retain raw surveys on secondary offline cold storage.
* **GPU Maintenance**: Monitor GPU temperatures during multi-thousand frame batch runs (`nvidia-smi`).
