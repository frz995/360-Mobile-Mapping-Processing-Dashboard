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

## 3. Active State / Data Flow

- `App.tsx` is the main state hub.
- Saved spatial layers live in global `layerCatalog`; temporary uploads live in `DataManagementPage` as `stagedLayers`.
- `saveStagedLayers()` promotes staged items into `layerCatalog`, which is then passed into `MapComponent` on both Dashboard and Data Management views.
- Business data uses `dailyData` and `batchLogs`, initialized from local storage, then merged with Supabase results on mount.
- `selectedSubgridFilter` is lifted at page level and broadcast to the embedded map via `postMessage`.

## 4. MobileMapping Integration

- **Embedded WebGIS**: The core map functionality is an embedded instance of the `mobilemapping` repository (deployed at `https://mobilemapping-nine.vercel.app`).
- **Shared Backend**: Both the Dashboard and the MobileMapping app share the same Supabase database (`panoramas` and `panoramas_view` tables).
- **Inter-app Communication**: The Dashboard communicates with the embedded MobileMapping iframe via `window.postMessage` (e.g., `FILTER_SUBGRID` and `SET_SUBGRID_FILTER` events).

## 5. Pending Bug / Next Feature

- Main open issue: `layerCatalog` still writes large vector payloads into `localStorage`, and the code already contains quota/error-reset handling. This is the likely weak point for large GeoJSON uploads.
- Exact next feature to build: move saved vector-layer persistence out of `localStorage` into a safer store/backend path while keeping the existing staged-vs-saved workflow and folder tree behavior intact.
