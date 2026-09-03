# Implementation Plan v6 — Road Extraction (Option A: Client + Cropper)

## ✅ v6 STATUS — IMPLEMENTED (E1–E5 complete)

| Phase | Status |
|---|---|
| **E1** Road service adapter (Overpass default) + env wiring (`src/services/roadExtraction.ts`, `VITE_ROAD_EXTRACTION_*`) | ✅ **Implemented** |
| **E2** Local Leaflet render surface (`src/components/roadAnalysis/RoadAnalysisMap.tsx`) | ✅ **Implemented** |
| **E3** "Extract roads" action per region; dependency-free clip to district | ✅ **Implemented** (`clipLineStringsToDistricts`) |
| **E4** Extracted network as a plan source joined to Captured vs Plan | ✅ **Implemented** |
| **E5** Gates + regression (tsc 0 / build ok / vitest pass / lint 0 errors) + dashboard untouched | ✅ **Green** |

Notes: Leaflet is a real imported dependency; no `@turf/turf` was added — clipping is a
lightweight, dependency-free helper on the district geometry (keeping the bundle unchanged).
Avoided the alias/turf dependency by keeping the clip minimal and honest.

**Map surface decision (owner-confirmed):** the local Leaflet map is the **default** Road
Analysis surface (road lines render natively + extraction/comparison work). The WebGIS
iframe remains only as an optional toggle for panorama/360 context — it cannot render road
lines (no line message type), so it is no longer the primary view.

### Strict Design Preservation Rule (binding)

Same as v4 / v5. **No visual redesign.** Dashboard visually & behaviorally untouched.
Reuse existing components and the house env/config patterns (`VITE_*` + safe defaults).
No fake telemetry / no fabricated geometry. No commit unless the user asks.

### Constraint discovered in v5 (context)

The external WebGIS map (`VITE_MAP_URL`) has **no line/vector message type** — it only
renders point layers (`SET_STAGED_DATA`) and boundary polygons (`SET_PROJECT_BOUNDARY`).
So extracted road lines **cannot be drawn on that map**. Option A therefore renders the
extracted road lines on a **local Leaflet surface** inside the Road Analysis workspace.
**`leaflet ^1.9.4` (+ `esri-leaflet`) is already a repo dependency — no new package
required.** This is the one scope addition vs. the earlier "no local map engine" note, and
the owner has accepted it as necessary for Option A. The external WebGIS iframe remains as
the primary context/panorama surface, unchanged.

### Adapter design (swappable provider)

Road extraction is wrapped in an **adapter interface** so the provider is a one-file swap:

```
src/services/roadExtraction.ts
export interface RoadExtractionResult { lines: LineString[]; source: string; route: string }
export interface RoadExtractionAdapter {
  name: string;
  extract(bbox: [minLng,minLat,maxLng,maxLat]): Promise<GeoJSON.FeatureCollection>;
}
```

**Default provider = OSM / Overpass API** (free, no credentials, real Malaysia road
network). District bbox → `[out:json][timeout:30](...); way[highway](bbox); out geom;`
→ decode `LineString` geometries. Configurable via env:

- `VITE_ROAD_EXTRACTION_ROUTE` — `overpass` (default) | future: `hotosm` | `custom`
- `VITE_ROAD_EXTRACTION_URL` — Overpass endpoint (default `https://overpass-api.de/api/interpreter`)
- `VITE_ROAD_EXTRACTION_KEY` — optional API key for non-default providers (blank = none)

Swapping to a hosted ML service later = new adapter + one env change; the workspace UI is
unchanged.

### Scope (phased)

| Phase | Status |
|---|---|
| **E1** Road service adapter (Overpass default) + env wiring | 🔲 |
| **E2** Local Leaflet render surface in Road Analysis (extracted lines + district + captured points) | 🔲 |
| **E3** "Extract roads" action per region; clip to district (simplify via turf) | 🔲 |
| **E4** Extracted network as a 3rd plan source (`system-volunteered` OSM) joined to Captured vs Plan | 🔲 |
| **E5** Gates + regression (tsc / build / vitest / lint) + dashboard untouched | 🔲 |

Notes / hazards:
- Overpass needs a **bbox**, not arbitrary polygon — query the district bbox, then clip the
  returned ways to the actual district polygon (turf `@turf/boolean-clip` on the multi-select
  union). `turf` is **not yet a dependency** — v6 adds `@turf/turf` (or the few needed
  sub-packages) — a dev-dependency-only addition, no bundle change to the main dashboard route
  if lazy-loaded.
- Network topology: OSM may return many small ways; keep each `LineString` separate and sum
  lengths for the comparison, or optionally merge (turf `lineMerge`).
- Offline/no-credential fallback: if the Overpass call fails or is unreachable, the workspace
  shows a clear error and keeps the existing v5 sources (system-derived + manual) intact.
- i18n: add `roadExtract*` label keys ×4 locales.

### Deliverables

- `src/services/roadExtraction.ts` — adapter interface + Overpass implementation.
- `src/components/roadAnalysis/RoadAnalysisMap.tsx` — local Leaflet surface (tiles via the
  map basemap config; draws district boundary, captured points, extracted road lines).
- `RoadAnalysisWorkspace.tsx` — add "Extract roads" control + source toggle; wire E4.
- `src/lib/i18n.ts`, `src/components/boundary/*` — labels, clipping helpers, tests.
- `implementation_plan_v6.md`.

No changes to `workspaces.tsx` categories, `App.tsx` dashboard JSX, or the P2 production
reorder. Road Analysis remains under the `insights` category; `tag: 'live'` unchanged.
