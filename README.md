# TNB LV Asset Mapping — 360° Mobile Mapping Processing Dashboard

> **Project**: Tenaga Nasional Berhad (TNB) Low Voltage Asset Mapping using 360° Mobile Mapping System (MMS)
> **Stack**: React 18 + TypeScript + Vite · Tailwind CSS · Leaflet · Supabase · Recharts

---

## Overview

A dual-app system for field capture, QA inspection, and executive reporting of 360° panoramic street-level imagery across TNB subgrid coverage zones.

| Item | Details |
|---|---|
| Total Panoramas | 265 frames (live from Supabase) |
| Coverage | ~1.6 km active / ~4.8 km project total |
| Subgrids | N93E70, N94E70, N94E71, N90E67 |
| Equipment | MMS (Backpack / Vehicle) |
| PICs | Fariz, Hafiz, Amirul |
| Backend | Supabase (`panoramas_view`, `qa_defects`, `daily_logs`, `batch_logs`) |

---

## Tech Stack

| Layer | Library |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + Lucide React icons |
| Map | Leaflet + Esri Leaflet (embedded WebGIS iframe) |
| Charts | Recharts |
| Spatial | GeoJSON · KML/GPX (`@tmcw/togeojson`) · SHP (`shapefile`) · CSV lat/lon |
| Backend | Supabase (`@supabase/supabase-js`) — auth, panoramas, QA defects, batch/daily data |
| Storage | `localStorage` persistence for `dailyData`, `batchLogs`, `layerCatalog` |

---

## Implemented Features

### 🗺️ Interactive Coverage Map (Dashboard)
- Embedded WebGIS iframe (`mobilemapping-nine.vercel.app`) with live Supabase panorama point markers
- `postMessage` bridge for inter-app communication (`FILTER_SUBGRID`, `FILTER_STATUS_TYPES`, `TOGGLE_BBOX_DRAW`, `UPDATE_POINT_DEFECT`)
- **Trajectory Status Filter** — togglable popup (Published · Defect/Flags · In Progress) with per-type show/hide
- **Spatial BBOX Filter** — 2-click corner bounding box to spatially filter visible map points
- Panotrack markers coloured: 🟢 Published · 🔴 Defect/Flagged · 🟡 Stitching/In Progress

### 📊 Executive KPI Summary (4 Cards)
- **Total Distance Mapped** — computed from `dailyData.kmProcessed` with last-update date
- **Processed Panoramas** — live frame count from `panoramas_view` with last-update date
- **Active Processing Jobs** — batch run count / average progress %
- **Pipeline Health** — dynamically computed `(total frames − defects) / total frames × 100%` with live amber defect frame count from `qa_defects`

### 🔍 Operator QA Panel
- Per-frame defect flag selection: `Blurry Frame`, `Lens Obstruction`, `Bad GPS`
- Conditional YES/NO status confirmation flow
- Post-confirmation summary with PIC, status (`DEFECT CONFIRMED` / `PASSED`), and `✏️ Edit QA` unlock
- Real-time sync to `qa_defects` Supabase table (`defect_count`, `qa_status`, `defect_flags`)
- `postMessage → UPDATE_POINT_DEFECT` turns map marker red immediately on flag confirmation
- Per-subgrid session memory via `qaSubgridRecords` (restored on navigation return)
- Clickable `N flagged` badge on table rows filters the coverage map to that subgrid

### 📁 Data Management Page
- Batch log table (subgrid, images, km, status, PIC, equipment) with inline edit/delete/add
- Daily ledger table with same CRUD and CSV import with field mapping
- Vector layer upload: GeoJSON · KML · GPX · SHP · CSV — staged → saved to folder catalog
- Folder-based layer catalog with rename, delete, visibility toggle, move

### 📄 Executive PDF Report
- Opens a print-ready HTML summary with KPI metrics, subgrid breakdown table, and system status
- Auto-launches browser print/save-to-PDF dialog

### 🔐 Auth
- Supabase auth gate (sign-in / sign-up / sign-out) with session restore on reload

---

## Data Flow

```
Supabase DB
  ├── panoramas_view       → useSupabasePoints (WebGIS map) + liveTotalFrames count
  ├── qa_defects           → liveDefectCount + pipelineHealthPercent + map marker color
  ├── daily_logs           → dailyData state (totalImages, totalKm, totalDefects fallback)
  └── batch_logs           → batchLogs state (subgrid cards, active jobs card)

App.tsx (state hub)
  ├── dailyData / batchLogs  ← localStorage init → merged with Supabase on mount
  ├── layerCatalog           ← localStorage, promoted from stagedLayers via saveStagedLayers()
  ├── qaSubgridRecords       ← per-subgrid QA memory, synced to Supabase
  ├── liveDefectCount        ← direct qa_defects query on mount
  ├── liveTotalFrames        ← direct panoramas_view COUNT query on mount
  └── selectedSubgridFilter  → postMessage → embedded WebGIS iframe
```

---

## Inter-App postMessage Events

| Event | Direction | Purpose |
|---|---|---|
| `FILTER_SUBGRID` | Dashboard → Map | Filter map points to subgrid |
| `FILTER_STATUS_TYPES` | Dashboard → Map | Toggle Published / Defect / Stitching layers |
| `TOGGLE_BBOX_DRAW` | Dashboard → Map | Activate / deactivate spatial BBOX filter |
| `UPDATE_POINT_DEFECT` | Dashboard → Map | Turn single frame marker red on QA flag |
| `MAP_POINT_SELECTED` | Map → Dashboard | Open panorama viewer for clicked point |
| `VIEWER_READY` | Map → Dashboard | Map iframe fully loaded signal |

---

## Embedded WebGIS App (`/360 web mapping`)

- Separate Vite/React app at `d:\Webmap\360 web mapping\360 web mapping`
- Fetches points from `panoramas_view` + joins `qa_defects` on mount
- Renders Leaflet `CircleMarker` per panorama with colour-coded status
- `BBoxDrawLayer` — 2-click spatial rectangle selection with live point filtering
- Responds to all `postMessage` events from the Dashboard iframe parent

---

## Roadmap

- [ ] Move vector layer catalog persistence from `localStorage` to Supabase storage
- [ ] Add per-subgrid completion % progress bar on Coverage Map
- [ ] Export BBOX-filtered point list to CSV
- [ ] Role-based access (Operator vs Supervisor views)
