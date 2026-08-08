# Project Context Summary

## 1. Current Tech Stack & Core Libraries

- Frontend: React 18 + TypeScript + Vite
- Styling/UI: Tailwind CSS, Lucide React
- Mapping: Leaflet, Esri Leaflet
- Charts: Recharts
- Spatial/vector parsing: GeoJSON, KML/GPX via `@tmcw/togeojson`, SHP via `shapefile`, CSV lat/lon import
- Backend/data: Supabase (`@supabase/supabase-js`) for auth and panorama/daily/batch data fetch + publish/delete flows
- Storage pattern: local app state with selective `localStorage` persistence for `dailyData`, `batchLogs`, and `layerCatalog`

## 2. Implemented And Working

- Dashboard page with KPI cards, charts, processing totals, and subgrid-driven filtering
- Data Management page for batch logs, daily ledger, and vector layer administration
- Supabase auth gate with session restore/sign-in/sign-up/sign-out
- Live Supabase fetch and merge with local draft rows
- CSV import and field mapping for batch logs and daily ledger
- Vector upload pipeline for GeoJSON, KML, GPX, SHP, and CSV point data
- Two-step vector workflow: `Staged` layers -> `Saved to Dashboard`
- Folder-based layer catalog with rename, delete, visibility toggle, and move actions
- Map refresh + subgrid filter broadcast to the embedded WebGIS map
- **OPERATOR QA Panel & Defect Management**:
  - Interactive **QA Defect Flags** (`Blurry Frame`, `Lens Obstruction`, `Bad GPS`) with active color feedback (Red, Amber, Sky Blue)
  - Conditional **Update Status? (YES / NO)** questionnaire box (hidden until flag selection, and hidden after confirmation)
  - Post-confirmation QA summary view with **PIC** (Person in Charge), confirmed status (`DEFECT CONFIRMED` / `PASSED`), selected defect choices, and an **`✏️ Edit QA`** button to unlock and edit choices anytime
  - Per-subgrid persistent session state (`qaSubgridRecords`), restoring saved QA choices automatically when navigating back to reviewed subgrids
  - Real-time Supabase database synchronization (`updateDefectStatusInSupabase`), persisting `defect_count`, `qa_status`, and `defect_flags`
  - Clickable `24 Flagged` button badge on table rows to filter subgrid data on the interactive coverage map

## 3. Active State / Data Flow

- `App.tsx` is the main state hub.
- Saved spatial layers live in global `layerCatalog`; temporary uploads live in `DataManagementPage` as `stagedLayers`.
- `saveStagedLayers()` promotes staged items into `layerCatalog`, which is then passed into `MapComponent` on both Dashboard and Data Management views.
- Business data uses `dailyData` and `batchLogs`, initialized from local storage, then merged with Supabase results on mount.
- `selectedSubgridFilter` is lifted at page level and broadcast to the embedded map via `postMessage`.
- QA defect data uses `qaSubgridRecords` for per-subgrid session persistence and syncs to Supabase PostgREST endpoints.

## 4. MobileMapping Integration

- **Embedded WebGIS**: The core map functionality is an embedded instance of the `mobilemapping` repository (deployed at `https://mobilemapping-nine.vercel.app`).
- **Shared Backend**: Both the Dashboard and the MobileMapping app share the same Supabase database (`panoramas` and `panoramas_view` tables).
- **Inter-app Communication**: The Dashboard communicates with the embedded MobileMapping iframe via `window.postMessage` (e.g., `FILTER_SUBGRID`, `SET_SUBGRID_FILTER`, and `MAP_POINT_SELECTED` events).
- **Defect Panotrack Markers**: Panotrack trajectory markers render in **ORANGE (`#f97316`)** on the WebGIS Leaflet map when marked as a QA defect.

## 5. Completed & Next Roadmap

- **Completed**: OPERATOR QA panel neatening, subgrid fallback defaults, clickable defect count buttons, real-time Supabase sync, per-subgrid session memory, and orange defect panotrack markers.
- **Next Feature**: Move saved vector-layer persistence out of `localStorage` into a backend path while keeping existing staged-vs-saved folder tree behavior.
