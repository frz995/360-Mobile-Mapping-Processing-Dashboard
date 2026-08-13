# 📋 Pending Tasks — 360° Mobile Mapping Processing Dashboard

> Tasks identified for future improvement. To be done in order of priority.

---

## 🗺️ Map Engine & GIS Rendering (Future Implementation)

- `[ ]` **Migrate WebGIS Map to MapLibre GL (Mapcn) Only**:
  * Consolidate map engine from Leaflet wrapper to MapLibre GL for GPU-accelerated rendering of 50,000+ panorama points and 3D terrain pitch.
  * ⚠️ **Known Technical Issue & Solution**:
    1. Wait for `map.on('style.load')` event before adding vector line sources to prevent silent tile load drops.
    2. Separate GeoJSON sources into distinct `'line'` (`LineString` trajectory) and `'circle'` (`Point` markers) layers.
    3. Enforce layer z-index order so line layers render below symbol markers (`paint: { 'line-color': '#38bdf8', 'line-width': 4 }`).

---

## 🚀 Advanced Features

- `[ ]` **Supabase Storage Persistence for Vector Layers**: Move uploaded KML, GPX, GeoJSON, and Shapefile vector catalogs from local storage to Supabase Storage bucket.
- `[ ]` **Automated CSV Export for Filtered BBOX Points**: Allow exporting spatially-selected subgrid points to CSV from the map viewer.

---

## 🎨 UI / UX Polish

- `[x]` **Mobile Responsiveness** — Dense grid layout adapts to stack panels vertically on tablet/mobile viewports.
- `[x]` **Executive Dark Slate Theme** — Executive dark palette (`#111827`, `#121824`) with sky blue accents and light mode overrides.
- `[x]` **Project & Database Settings Administration Canvas Page** — Dedicated `/settings` canvas for Supabase credentials, CSV header aliases, image storage paths, and spatial rules.
- `[x]` **CSV Staging Pipeline** — Staged initial mode (`0 verified frames`, `In Process`) updating to verified frame counts upon `Publish to Database`.
- `[x]` **Zero (0,0) GPS Coordinate Detection** — Auto-detects missing or zero coordinate rows on CSV import with admin alert banners.

---

## 🛡️ Reliability & Security

- `[x]` **Supabase Row Level Security (RLS)** — Row Level Security policies configured on `panoramas` and `batch_logs` tables.
- `[x]` **Error Boundaries & Fallbacks** — Graceful UI fallbacks when database connections or physical image files are missing.
