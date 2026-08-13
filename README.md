# TNB 360° Mobile Mapping System (MMS) — Processing Dashboard

Executive dashboard for Tenaga Nasional Berhad (TNB) Low Voltage Asset Mapping. Built for 360° StreetView panorama processing, spatial trajectory monitoring, quality control (QA/QC), and database administration.

---

## 📌 Executive Summary

* **Project**: TNB Low Voltage Asset Subgrid Mapping
* **Target Trajectory**: 315.2 km (~50,000 Equirectangular Panoramas)
* **Active Subgrids**: `N93E70`, `N94E70`, `N94E71`, `N90E67`
* **Equipment**: MMS Vehicle Unit / Backpack Unit
* **Database**: PostgreSQL 15 + PostGIS 3.3 (Supabase Cloud + Local PostGIS)

---

## ⚡ Tech Stack

| Component | Technologies & Libraries |
| :--- | :--- |
| **Frontend Framework** | React 18 · TypeScript · Vite |
| **UI Design & Theme** | Tailwind CSS · Executive Dark Slate Theme (`#111827`, `#121824`) · Custom Light Mode Overrides · Lucide Icons |
| **GIS & 360 Viewer** | Leaflet WebGIS · Esri Imagery · PhotoSphereViewer / Three.js 360° Equirectangular Viewer |
| **Backend & Database** | Supabase Cloud (`@supabase/supabase-js`) · PostgreSQL 15 + PostGIS 3.3 · Row Level Security (RLS) |
| **Spatial Formats** | GeoJSON · KML · GPX · Shapefiles (`.shp`) · CSV Trametry Logs |

---

## 🚀 Key Modules & Workflow

### 1. 📊 Interactive Processing Dashboard
* **WebGIS Coverage Map**: Real-time Leaflet viewer with inter-app `postMessage` bridge (`FILTER_SUBGRID`, `UPDATE_POINT_DEFECT`).
* **360° QA Inspector**: Per-frame defect auditing (`Blurry Frame`, `Lens Obstruction`, `Bad GPS`). Red marker sync on defect confirmation.
* **Executive KPI Cards**: Real-time trajectory distance (km), processed frames count, active job status, and pipeline health %.

### 2. 🗄️ Data Management Canvas & CSV Staging Pipeline
* **CSV Staging Pipeline**: Imported CSVs initialize in **Staged Mode** (`0 verified frames`, status `In Process`). Frame counts update to verified totals upon clicking **Publish to Database**.
* **Automatic GPS Sanitization**: Detects missing or zero `(0,0)` coordinate rows and alerts administrators on import.
* **Vector Layer Catalog**: Upload and organize GeoJSON, KML, GPX, SHP, and CSV spatial layers.

### 3. ⚙️ Project & Database Administration Canvas (`/settings`)
* **Supabase & PostGIS Configuration**: Endpoint URL, Anon Key, Auto-Sync frequency, and DB connection diagnostics.
* **Image Fetch Rules**: Storage path (`/MMS_PIC/`), panorama naming pattern (`{subgrid}-{index:04d}.jpg`), and pre-fetch cache.
* **CSV Column Alias Mapping**: Custom alias mapping (`latitude, lat, y`, `longitude, lon, x`, `heading, bearing`) for vendor compatibility.
* **Spatial & GIS Rules**: Selangor/KL bounding box spatial filters, subgrid deduplication, and AI defect thresholding (%).

---

## 🔒 Security & Database RLS

Row Level Security (RLS) policies configured on `public.panoramas` and `public.batch_logs`:
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
