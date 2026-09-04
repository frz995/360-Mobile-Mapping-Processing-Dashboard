# Implementation Plan v7 — Road Analysis Data Content Catalog & Universal GIS Import

> **Scope**: Implement a Workspace Data Content Catalog for Road Analysis, enabling interactive color/opacity/stroke vector styling inside the map, alongside a dedicated GIS Data Input tab supporting KML, Shapefile ZIP (.zip with .shp, .dbf, .shx, .prj), GeoJSON, GPX, and CSV.
> **Binding Constraints**:
> - 100% preservation of existing system design, themes, color tokens, and responsive layout.
> - Zero modification or disruption to existing Phase 1–4 capabilities (Two-track model, display integrity, PostGIS DDL, worker admission control, bundle optimizations).
> - Strict non-visual regressions: all existing tabs (Region, Plan, Compare), map controls, and WebGIS sync remain fully functional.
> - Full quality gate compliance: `tsc -b`, `npm run build`, `vitest run`, `npm run lint`, and `pytest`.

---

## 1. Problem & Architecture Overview

In the Road Analysis workspace (`RoadAnalysisWorkspace.tsx`), operators currently compare captured survey tracks against either an automated OSM extraction (Option A) or a single uploaded road plan (Option B). However:
1. **Limited Vector Customization**: Operators cannot customize vector colors, opacity, stroke widths, or visibility of individual map layers to distinguish between different survey runs, utilities, or road types.
2. **Restricted File Ingestion**: File upload was strictly limited to road line coordinates (`extractLineCoords`), rejecting polygons, multi-geometries, points, CSV tracks, GPX files, or rich shapefile datasets.
3. **Shapefile Multi-File Friction**: Shapefiles require multiple auxiliary files (`.shp`, `.dbf`, `.shx`, `.prj`). Without explicit user guidance and a streamlined `.zip` ingestion workflow, shapefile imports frequently fail or confuse operators.
4. **Lack of Layer Catalog**: There is no central layer manager to view imported layers, toggle visibility, zoom to extent, inspect feature properties, or choose which imported layer serves as the baseline plan.

### Implementation Architecture:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Road Analysis Workspace (v7)                          │
├─────────────────┬──────────────┬──────────────┬──────────────┬──────────────┤
│  Region Tab     │  Plan Tab    │  Import Tab  │ Catalog Tab  │ Compare Tab  │
│  State/District │  OSM / Baseline│ Universal GIS│ Layer Styling│ Actual vs    │
│  Selection      │  Extraction  │ KML/SHP(ZIP) │ Color/Opacity│ Plan Metrics │
│                 │              │ GeoJSON/CSV  │ Bounds/Delete│              │
└─────────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
                                  │                     │
                                  ▼                     ▼
               ┌──────────────────────┐     ┌────────────────────────┐
               │  gisImportParser.ts  │────▶│ Catalog Layer State    │
               │  • ZipReader (.shp)  │     │ • id, name, geojson    │
               │  • toGeoJSON (KML)   │     │ • color, opacity       │
               │  • CSV/GPX converter │     │ • strokeWidth, visible │
               │  • BBox & Geom stats │     └────────────────────────┘
               └──────────────────────┘                 │
                                                        ▼
                                            ┌────────────────────────┐
                                            │ RoadAnalysisMap.tsx    │
                                            │ • MapLibre GL Render   │
                                            │ • Dynamic line/fill/pt │
                                            │ • Realtime styling     │
                                            │ • Feature popups       │
                                            └────────────────────────┘
```

---

## 2. Proposed Changes & Component Breakdown

### Component 1: Universal GIS Data Importer (`src/utils/gisImportParser.ts`)
Creates a fault-tolerant spatial parser for all standard GIS formats:
- **Shapefile in ZIP (`.zip`)**:
  - Leverages browser `extractZipFiles` via `DecompressionStream`.
  - Automatically identifies `.shp`, `.dbf`, and `.shx` inside the archive (regardless of folder depth or casing).
  - Uses `shapefile.open(shpBuffer, dbfBuffer)` to construct a complete GeoJSON `FeatureCollection` with all attribute properties.
  - Detects coordinate projection; alerts if coordinates fall outside WGS84 range.
- **KML (`.kml`)**:
  - In-browser XML parsing via `DOMParser`.
  - Converts placemarks, tracks, and polygons to GeoJSON via `@tmcw/togeojson.kml`.
- **GeoJSON / JSON (`.geojson`, `.json`)**:
  - Parses `FeatureCollection`, single `Feature`, or raw `Geometry`.
- **GPX (`.gpx`)**:
  - Converts waypoints and routes via `@tmcw/togeojson.gpx`.
- **CSV (`.csv`)**:
  - Automatically detects latitude (`lat`, `latitude`, `y`) and longitude (`lon`, `lng`, `long`, `x`) columns.
  - Emits valid Point `FeatureCollection`.
- **Metadata Output**:
  - Computes layer bounding box `[minLng, minLat, maxLng, maxLat]`.
  - Determines primary geometry type (`LineString`, `Polygon`, `Point`, or `Mixed`).
  - Total feature count and road-line run extraction for plan comparison.

### Component 2: Dedicated GIS Import Tab (`src/components/roadAnalysis/RoadImportPanel.tsx`)
- Sleek drag-and-drop file upload zone adhering to the dark glassmorphic design system.
- Prominent **Shapefile ZIP Guide**:
  - Clear visual badge: *"Shapefiles must be uploaded as a .ZIP archive containing .shp, .dbf, and .shx companion files."*
- Supported format tags: `.kml`, `.zip (shp)`, `.geojson`, `.json`, `.gpx`, `.csv`.
- Instant file inspection feedback (filename, format badge, size, feature count, geometry type).
- Built-in sample datasets ("Sample Highway Corridor", "Sample District Boundary") for one-click testing.
- Automatic handoff: on successful import, adds the layer to the catalog and switches to the Data Catalog tab.

### Component 3: Workspace Data Content Catalog (`src/components/roadAnalysis/RoadCatalogPanel.tsx`)
- **System Layers Section**:
  - District Boundary (outer perimeter line): color picker, opacity slider (0–100%), stroke width.
  - Captured Survey Points (Panotrack): point opacity slider, point radius, visibility toggle.
  - Road Plan Baseline (Extracted or Manual): line color picker, line opacity, stroke width.
- **Imported GIS Layers Section**:
  - Card for each imported layer with:
    - Layer name (inline editable).
    - Format badge (`KML`, `SHP`, `GeoJSON`, `CSV`, `GPX`) and geometry type badge (`Line`, `Polygon`, `Point`).
    - Feature count & spatial bounds.
    - **Color Picker**: Color swatches (Emerald, Sky, Amber, Violet, Rose, Indigo, Teal, Slate) + native hex input.
    - **Opacity Slider**: Smooth 0% to 100% slider updating map vector opacity in real time.
    - **Stroke Width / Radius**: Adjust line thickness (1px–8px) or point circle radius.
    - **Visibility Toggle**: Instant eye icon toggle to show/hide the layer on the map.
    - **Zoom to Layer**: Fits map viewport to layer bounding box.
    - **Use as Road Plan**: If the layer has LineStrings, allows 1-click promotion to active road plan for comparison.
    - **Delete / Remove**: Removes layer from catalog and map canvas.

### Component 4: Dynamic MapLibre Vector Rendering (`src/components/roadAnalysis/RoadAnalysisMap.tsx`)
- Extends `RoadAnalysisMapProps` to accept `catalogLayers`, plus custom system layer styles.
- Dynamically provisions MapLibre sources and layers:
  - `ra-catalog-${id}` source for GeoJSON data.
  - For Polygons: adds `fill` layer (`fill-color`, `fill-opacity`) and `line` outline layer.
  - For Lines: adds `line` layer (`line-color`, `line-opacity`, `line-width`).
  - For Points: adds `circle` layer (`circle-color`, `circle-opacity`, `circle-radius`, `circle-stroke`).
- Uses direct `setPaintProperty` and reactive overlay updates so dragging sliders gives 60fps instant visual feedback without flashing or rebuilding the basemap.
- Interactive popups on imported features: clicking an imported feature opens a formatted popup displaying its attributes and coordinates.

### Component 5: State Persistence & Integration (`src/components/RoadAnalysisWorkspace.tsx`)
- Adds `import` and `catalog` to `RoadTab` (`region | plan | import | catalog | compare`).
- Integrates `catalogLayers` into `RoadAnalysisSavedState` with schema versioning.
- Persists to `localStorage` via `persistRoadAnalysisCache` and synchronizes to Supabase `road_analysis_state` on "Save State".
- Unsaved local edits indicator accurately tracks catalog changes.

---

## 3. Verification & Quality Gates

1. **Unit Tests**:
   - `src/utils/__tests__/gisImportParser.test.ts`:
     - Test KML parsing to GeoJSON.
     - Test Shapefile ZIP buffer parsing (with mock .shp and .dbf entries).
     - Test GeoJSON FeatureCollection parsing.
     - Test CSV with latitude/longitude parsing.
     - Test invalid files, missing .shp in ZIP, and malformed files return clean error messages.
2. **Type Checking & Build**:
   - `npx tsc -b`: 0 errors.
   - `npm run build`: cleanly builds Vite production bundle.
   - `npm test -- --run`: 100% tests passing across all test suites.
   - `npm run lint`: 0 lint errors.
3. **Manual / Interactive Verification**:
   - Verify uploading a KML file displays in catalog and renders vectors on MapLibre.
   - Verify uploading a Shapefile ZIP displays features and attributes.
   - Verify adjusting color swatch and opacity slider updates the map vectors in real time.
   - Verify toggling visibility hides/shows the layer.
   - Verify clicking "Zoom to Layer" fits map bounds to the layer.
   - Verify clicking "Use as Road Plan" links lines to the Plan/Compare metrics.
   - Verify state persists across page refresh and "Save State" pushes to Supabase.
