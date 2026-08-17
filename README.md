# TNB 360° Mobile Mapping System (MMS) — Processing Dashboard

> Executive WebGIS dashboard for Tenaga Nasional Berhad (TNB) Low Voltage Asset Mapping. Built for 360° StreetView panorama processing, spatial trajectory monitoring, quality control (QA/QC), vector layer management, and database administration.

---

## 📌 Project Overview & Technical Context

* **Project Scope**: TNB Low Voltage Asset Subgrid Mapping
* **Target Trajectory**: 315.2 km (~50,000 Equirectangular Panoramas)
* **Active Subgrids**: `N93E70`, `N94E70`, `N94E71`, `N90E67`
* **Equipment Units**: MMS Vehicle Unit / Backpack Mobile Unit
* **Database & Storage**: PostgreSQL 15 + PostGIS 3.3 (Supabase Cloud) & Supabase Storage (`/MMS_PIC/`, `/vector_layers/`)

---

## 🛠️ Tech Stack & Core Services

| Component | Technologies & Service Modules |
| :--- | :--- |
| **Frontend Framework** | React 18 · TypeScript · Vite |
| **UI Theme & Styling** | Tailwind CSS · Executive Dark Slate Theme (`#111827`, `#121824`) · Custom Light Overrides · Lucide React Icons · Recharts |
| **GIS & Map Engine** | Leaflet WebGIS · Esri Satellite Imagery · MapLibre GL Helpers (`src/services/maplibreHelpers.ts`) |
| **360° Panorama Viewers** | PhotoSphereViewer (`@photo-sphere-viewer/core` v5) · Custom WebGL 360° Sphere Renderer built with Three.js (r185) with 60 FPS damping |
| **Backend & Database** | Supabase Cloud (`@supabase/supabase-js` v2) · PostgreSQL 15 + PostGIS 3.3 (`public.panoramas`, `public.batch_logs`, `public.vector_layers_meta`) · Row Level Security (RLS) |
| **Spatial Data Services** | `@tmcw/togeojson` (KML/GPX) · `shapefile` (`.shp` parser) · Native GeoJSON · `src/services/csvExport.ts` · `src/services/supabase.ts` |

---

## 🚀 Implemented Modules & Features

### 1. 📊 Interactive Processing Dashboard & Trajectory Monitoring
* **Real-time Trajectory KPIs**: Tracks total trajectory distance (km via Haversine calculation), total processed frames, active subgrid counts, and pipeline health %.
* **WebGIS Map Integration**: Embedded WebGIS viewer with cross-app bidirectional iframe sync protocol.

### 2. 🔍 Dual 360° QA Inspector & Defect Auditing
* **Dual Rendering Engine**: Supports both PhotoSphereViewer and Three.js 60 FPS WebGL equirectangular sphere views.
* **Per-Frame QA Auditing**: Enables flagging defects (`Blurry Frame`, `Lens Obstruction`, `Bad GPS`) and syncs status in real-time to Supabase (`qa_status` & `defect_flags`).

### 3. 🔄 Cold-Start Iframe Handshake Bridge
* **`WebGISViewerIframe.tsx`**: Implements a robust event handshake (`VIEWER_READY` / `VIEWER_ACK`) and a pending queue (`pendingPanoramaRef`) with exponential retries (100ms–3000ms) to prevent message drops during cold loads.

### 4. 🛰️ Automatic GPS Sanitization & Staging Pipeline
* **Coordinate Sanitizer (`sanitizeCoordinates` in `supabase.ts`)**: Auto-detects `(0,0)`, `NaN`, `null`, or out-of-bounds coordinates, assigning safe default subgrid centroids (`SUBGRID_COORDINATES`) to eliminate "Null Island" map rendering bugs.
* **CSV Staging Pipeline**: Ingests vendor telemetry CSVs in **Staged Mode** (`0 verified frames`, status `In Process`) until clicking **Publish to Database**.

### 5. 🗂️ Supabase-Persisted Vector Layer Catalog
* **Storage & Metadata Persistence**: Uploaded GeoJSON, KML, GPX, and Shapefile layers are stored in Supabase Storage (`vector_layers` bucket) and tracked in `vector_layers_meta`, restoring layer catalog trees automatically across sessions.

### 6. 🗺️ MapLibre GL Rendering Helpers
* **`src/services/maplibreHelpers.ts`**: Provides `style.load` guards, separates GeoJSON sources into distinct `'line'` (trajectory route) and `'circle'` (point markers) layers, and enforces Z-index layer order.

### 7. 📥 Automated BBOX Spatial CSV Exporter
* **`src/services/csvExport.ts`**: Filters spatial trajectory points within user-defined bounding boxes (`minLon, minLat, maxLon, maxLat`) and triggers instant browser CSV file downloads.

### 8. ⚙️ Advanced Project Settings & Regional BBOX Administration
* **Malaysia Project Region BBOX Selector**: Configure bounding box bounds dynamically across 11 Malaysian regions (`Selangor/KL`, `Johor`, `Negeri Sembilan & Melaka`, `Perak`, `Penang/Kedah/Perlis`, `Pahang`, `Terengganu/Kelantan`, `Sarawak`, `Sabah`, `Entire Malaysia`, `Custom`).
* **Dynamic Storage & Persistence Controls**: Configure image fetch sources (`Local WebServer`, `Supabase Storage MMS_PIC Cloud`, `AWS S3 Proxy`) and GIS vector layer catalog persistence buckets.

---

## 📁 Key Service Modules

```
src/
├── components/
│   ├── PhotoSphereViewerComponent.tsx  # PhotoSphereViewer v5 Equirectangular Inspector
│   ├── ThreePanoramaViewer.tsx         # Custom Three.js r185 WebGL 360° Sphere Viewer
│   └── WebGISViewerIframe.tsx          # Handshake-enabled postMessage WebGIS Bridge
├── services/
│   ├── supabase.ts                     # Supabase Cloud, PostGIS, GPS Sanitizer & Layer Persistence
│   ├── maplibreHelpers.ts              # MapLibre GL style.load guards & layer separation
│   └── csvExport.ts                    # BBOX spatial point filtering & CSV download export
├── App.tsx                             # Monolithic Dashboard application controller
└── main.tsx                            # React root entrypoint
```

---

## 🔒 Security & Database RLS

Row Level Security (RLS) policies configured on `public.panoramas`, `public.batch_logs`, and `public.vector_layers_meta`:
* **Public Role**: Read-Only access (`SELECT`) for map rendering and 360 viewing.
* **Authenticated Role**: Full Write access (`INSERT`, `UPDATE`, `DELETE`) restricted to authenticated administrators.

---

## 🛠️ Quick Start

```bash
# Install dependencies
npm install

# Launch Development Server
npm run dev

# TypeScript Type-Check
npx tsc --noEmit
```
