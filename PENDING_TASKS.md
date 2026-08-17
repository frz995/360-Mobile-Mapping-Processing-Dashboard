# 📋 Pending Tasks — 360° Mobile Mapping Processing Dashboard

> Tasks identified for future improvement. To be done in order of priority.

---

## 🗺️ Map Engine & GIS Rendering (Future Implementation)

- `[x]` **Migrate WebGIS Map to MapLibre GL (Mapcn) Only**:
  * Consolidate map engine from Leaflet wrapper to MapLibre GL for GPU-accelerated rendering of 50,000+ panorama points and 3D terrain pitch.
  * `maplibreHelpers.ts` implemented with `style.load` guards, distinct `LineString` vs `Point` layer separation, and Z-index layer order enforcement.

---

## 🚀 Advanced Features

- `[x]` **Supabase Storage Persistence for Vector Layers**: Uploaded KML, GPX, GeoJSON, and Shapefile vector catalogs saved to Supabase Storage bucket (`vector_layers`) and metadata table (`vector_layers_meta`).
- `[x]` **Automated CSV Export for Filtered BBOX Points**: `csvExport.ts` implemented with bounding box spatial filtering (`minLon, minLat, maxLon, maxLat`) and instant browser CSV download triggering.

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
