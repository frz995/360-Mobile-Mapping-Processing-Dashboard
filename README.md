# GeoSphere 360 - Mobile Mapping System (MMS) Processing Dashboard

Executive WebGIS and spatial intelligence processing dashboard for Tenaga Nasional Berhad (TNB) Low Voltage Asset Mapping. Built for large-scale 360-degree StreetView panorama ingestion, spatial trajectory monitoring, quality assurance auditing, vector layer catalog management, image processing pipeline automation, and multi-user project campaign governance.

---

## Technical Overview and Context

* Organization: Tenaga Nasional Berhad (TNB)
* System Scope: Low Voltage Asset Mapping and Spatial Intelligence Pipeline
* Target Trajectory: 315.2 km (~50,000 Equirectangular Panoramas)
* Operational Subgrids: N93E70, N94E70, N94E71, N90E67
* Mobile Units: MMS Vehicle Survey Rig and Backpack Mobile Survey Unit
* Database and Geospatial Engine: PostgreSQL 15 with PostGIS 3.3 hosted on Supabase Cloud
* Storage Infrastructure: Supabase Storage buckets for MMS photography (/MMS_PIC/) and vector assets (/vector_layers/)

---

## Dual Track System Architecture

The application is architected around two core operational tracks that maintain strict separation between field processing and executive consumption:

| Track | Function | Associated Workspaces |
| :--- | :--- | :--- |
| WebGIS Published View | Public and executive monitoring track displaying live, QA-accepted survey data on interactive maps. Read-mostly interface for asset inspection and project progress reporting. | Main Dashboard, Data Management, Survey Analytics, Reports, Road Analysis |
| Production Pipeline | Operator-facing factory track managing RAW data intake, automated privacy masking, image enhancement, QA acceptance, deliverable packing, and staging before publication. | Production Workspace, Processing Center, Data Lineage, NAS and Raw Storage Manager |
| System Governance | Cross-cutting system administration, regional boundary definitions, storage endpoint controls, and access security. | Administration, Project Onboarding, Theme Selector |

### Staging versus Publishing Lifecycle
* Staging Panoramas: Survey data ingested from vendor telemetry or field cameras is initially stored in a staged state (internal staging_panoramas table) where it undergo automated filtering and manual QA review.
* Publishing to WebGIS: Once audit acceptance criteria are satisfied, panoramas transition to the published state, making them immediately queryable and visible on client WebGIS mapping interfaces.

---

## Core System Modules

### 1. System Showcase and Landing Portal
* Executive landing experience highlighting core system capabilities: WebGIS Trajectory Engine, 360 QA/QC Verification, Vector Asset Management, and Automated Processing Pipeline.
* Dynamic workspace routing enabling direct module launch, secure authentication navigation, and live telemetry metric previews.
* Clean, distraction-free visual layout with customizable backdrop styling and responsive navigation.

### 2. Multi-Project Campaign Onboarding
* Guided project initialization allowing operators to resume existing spatial campaigns or configure new survey initiatives.
* Geographic boundary scoping supporting 11 regional Malaysian presets (Selangor and Kuala Lumpur, Johor, Perak, Pahang, Penang, Kedah, Perlis, Negeri Sembilan, Melaka, Terengganu, Kelantan, Sabah, Sarawak, Entire Malaysia) as well as custom GeoJSON bounding envelopes.
* Coordinate Reference System (CRS) management covering WGS84 (EPSG:4326), Kertau 1948 RSO Malaya (EPSG:3168), and Timbalai 1948 (EPSG:29873).
* Per-project theme persistence and custom branding configuration.

### 3. Interactive WebGIS Trajectory Dashboard
* Real-time spatial KPIs calculating cumulative surveyed distance using Haversine formulas, total processed frames, active subgrid completion percentages, and pipeline health scores.
* Embedded WebGIS map integration using a bidirectional postMessage iframe handshake protocol (VIEWER_READY and VIEWER_ACK) with exponential retry backoff to eliminate cold-start drops.
* Dynamic trajectory point rendering with synchronized heading arrows, active panorama location highlights, and subgrid boundary overlays.

### 4. 360-Degree Panorama Inspector and QA/QC Workbench
* WebGL-accelerated panorama viewer powered by PhotoSphereViewer v5 supporting standard equirectangular panoramas and multi-resolution cubemap tile pyramids.
* Per-frame defect classification enabling auditors to flag issues such as Blurry Frame, Lens Obstruction, Camera Tilt, Bad GPS, and Overexposure.
* Real-time Supabase defect synchronization storing audit run logs, inspector notes, and frame-level resolution states.

### 5. Automated Image Processing Pipeline
* Dedicated backend worker service (Python) handling automated privacy blurring for faces and vehicle license plates.
* Photogrammetric contrast adjustment, color balancing, and shadow recovery routines.
* Batch processing queue with progress telemetry, automated retry policies, and NAS storage synchronization.

### 6. Vector Layer Catalog and Spatial Data Services
* Ingestion engine for external vector datasets in GeoJSON, Shapefile (.shp/.dbf/.prj packaged in ZIP), KML, and GPX formats.
* Layer tree persistence saving uploaded files to Supabase Storage and recording metadata in public.vector_layers_meta for cross-session restoration.
* Bounding Box (BBOX) spatial filtering service generating structured trajectory CSV exports for external GIS tools (QGIS, ArcGIS).

### 7. GPS Sanitization and Quality Gate
* Coordinate validation routine (sanitizeCoordinates) that catches out-of-bounds, (0,0), null, or NaN coordinates and applies default subgrid centroid coordinates to prevent Null Island map rendering anomalies.
* Staging validation checks preventing unverified coordinates from being promoted to the published WebGIS layer.

---

## Technology Stack

| Layer | Technologies and Libraries |
| :--- | :--- |
| Frontend Core | React 18, TypeScript, Vite |
| Styling and Design | Vanilla CSS, Tailwind CSS, Custom Light and Dark Theme System |
| 360 Panorama Viewers | PhotoSphereViewer v5 (@photo-sphere-viewer/core, equirectangular and cubemap adapters) |
| Mapping and GIS | Leaflet, Esri World Imagery, MapLibre GL helpers, Turf.js |
| Spatial File Parsers | @tmcw/togeojson (KML/GPX), shapefile (.shp parser), GeoJSON |
| Backend and Database | Supabase Cloud, PostgreSQL 15, PostGIS 3.3, Row Level Security (RLS) |
| Python Worker Services | Python 3.10+, OpenCV, FastAPI, Torch/YOLO image processing pipelines |
| Charts and Metrics | Recharts, Lucide Icons |

---

## Repository Structure

```
.
├── public/
│   ├── branding/               # Vector SVG and transparent brand logo assets
│   └── screenshots/            # System backdrops and media assets
├── src/
│   ├── components/
│   │   ├── boundary/           # Malaysia regional boundaries and district GeoJSON
│   │   ├── common/             # Shared UI components (Toaster, Loading, Brand Logo)
│   │   ├── dashboard/          # Summary metrics, charts, and operational widgets
│   │   ├── production/         # Production pipeline components and staging cards
│   │   ├── DataManagementPage.tsx   # Subgrid records and dataset management
│   │   ├── MapComponent.tsx         # Embedded WebGIS viewer and handshake bridge
│   │   ├── PhotoSphereViewerComponent.tsx # 360 panoramic WebGL inspector
│   │   ├── ProjectOnboarding.tsx    # Multi-project gate, campaign wizard, and resume
│   │   ├── QAQCWorkbench.tsx        # Defect auditing and frame-by-frame QA tools
│   │   ├── SystemShowcase.tsx       # Landing showcase and module overview portal
│   │   └── ThemeSelector.tsx        # System theme customization controls
│   ├── lib/
│   │   └── i18n.ts             # Multilingual dictionary (English and Bahasa Malaysia)
│   ├── services/
│   │   ├── csvExport.ts        # BBOX spatial trajectory point exporter
│   │   ├── maplibreHelpers.ts  # MapLibre GL layer management and source guards
│   │   ├── projects.ts         # User project persistence and campaign management
│   │   └── supabase.ts         # Database operations, PostGIS queries, GPS sanitization
│   ├── utils/
│   │   └── hashRouter.ts       # Hash-based zero-dependency workspace router
│   ├── App.tsx                 # Root application controller and workspace coordinator
│   ├── main.tsx                # Application mounting entry point
│   ├── index.css               # Base Tailwind CSS rules
│   └── themes.css              # Dark/light theme color tokens and CSS variables
├── worker/                     # Python-based automated image processing pipeline
│   ├── app.py                  # Processing service API
│   ├── blur.py                 # Privacy blurring implementation
│   ├── enhancement.py          # Contrast and color correction
│   └── runner.py               # Job queue runner and task dispatcher
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Security and Access Governance

Database security is enforced at the database engine level via PostgreSQL Row Level Security (RLS) on all spatial and telemetry tables:
* Public Role: Read-only access (SELECT) restricted to published panoramas and approved vector metadata for public map consumption.
* Authenticated Role: Full read-write access (INSERT, UPDATE, DELETE) restricted to authorized survey administrators and production operators.
* Supabase Access Authentication: Email/password authentication gate with session persistence and guest access exploration mode.

---

## Quick Start and Local Development

### Prerequisites
* Node.js 18.x or higher
* npm 9.x or higher
* Python 3.10+ (for background image processing worker)

### Installation

```bash
# Clone the repository
git clone https://github.com/frz995/360-Mobile-Mapping-Processing-Dashboard.git
cd "360-Mobile-Mapping-Processing-Dashboard"

# Install frontend dependencies
npm install
```

### Environment Configuration

Create a `.env` file in the project root with the following variables:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_MAP_URL=https://your-webgis-instance.domain
```

### Running Locally

```bash
# Start Vite development server
npm run dev

# Run TypeScript type verification
npx tsc --noEmit

# Create production build
npm run build
```

The application will be accessible at http://localhost:5173.
