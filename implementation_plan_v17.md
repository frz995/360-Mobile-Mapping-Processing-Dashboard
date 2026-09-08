# Implementation Plan v17 — Panotrack Points (Available Status) in MapLibre Inspect Area

## Goal

Load the **active project's** panotrack survey points — those whose frame data is
**available on the project** — into the **MapLibre inspect area** (the district boundary
view + the embedded popup map), coloured by their real pipeline status:

- **Published** `#10b981` (emerald)
- **Available** `#38bdf8` (sky blue) — frame imagery exists/available on the project, not yet published
- **Staging / In-Process** `#f59e0b` (amber)
- **Defect / Flagged / Recheck** `#ef4444` (red)

Everything is driven from the selected project's own `dailyData` / `batchLogs` and its
committed boundary — **no per-project hardcoding**.

## 1. Data model (`src/utils/panotrackExtractor.ts`)

1. Add `isAvailable?: boolean` to `PanotrackPoint`.
2. `getPanotrackStatusColor`: recognise an **`available`** state — `isAvailable === true`
   or literal status `'available'` — returning `#38bdf8` (priority after defect and
   published, before staging).
3. In all four emission sites (dailyData panoramas, dailyData points, batchLogs
   panoramas, batchLogs points) derive an `isAvail` flag and emit `status` =
   `'defect' | 'published' | 'available' | 'staging'` plus the matching `color` and
   `isAvailable`. `SUBGRID_COORDINATES` fallback stays published.
4. New helper `filterPanotrackByBBoxes(points, tracks, bboxes)` — pure bbox
   containment (data-driven from `DISTRICT_METADATA.bbox`), no polygon/geojson load
   required. Returns `{ filteredPoints, filteredTracks }`.

## 2. Embedded HUD map (`src/components/common/DistrictProjectPopup.tsx`)

1. Extend `PanotrackPopupData` with `panotrackPoints?: PanotrackPoint[]`.
2. In the display-only MapLibre on-load block, if `panotrackPoints` is provided, build
   one GeoJSON Feature per point carrying `properties.color` (and `status`); render a
   `circle` layer with `'circle-color': ['get', 'color']`. Otherwise fall back to the
   existing uniform-red route dots.
3. Add a compact status legend overlay on the map when `panotrackPoints` is present.

## 3. District inspect map (`src/components/common/ProjectBoundaryMap.tsx`)

1. Add optional `panotrackPoints?: PanotrackPoint[]` prop (default `[]`).
2. On load (post-boundary), if points exist, add `pano-points` GeoJSON source +
   status-coloured `circle` layer (`['get', 'color']`), so the zoomed district inspect
   area shows the project's available panotrack frames.

## 4. Wiring (`src/components/SystemShowcase.tsx`)

1. `panotrackData` memo already extracts the project's points.
2. New memo `districtBBoxes` = `DISTRICT_METADATA.bbox` for every `resolvedDistricts` id.
3. New memo `panotrackInProject` = `filterPanotrackByBBoxes(panotrackData.points, panotrackData.tracks, districtBBoxes).filteredPoints`.
4. `activePopupData`: use `panotrackInProject` for counts / `subgrids` / `trackPoints`
   (replacing the ad-hoc ±0.45° proximity filter) and pass the full point set as
   `panotrackPoints` to the HUD popup.
5. `ProjectBoundaryMap` render: pass points further narrowed to the single active
   district's metadata bbox (`activeDistrictBbox` memo) so the zoomed inspect view is
   still boundary-accurate and dynamic per project.

## 4a. Strict committed boundary in the HUD card

The HUD card map must always draw each **committed district's own polygon** (so e.g.
Tangkak is visible even with zero panotrack POI, and whole-state commits still show the
individual district dividers) — independent of the popup's own district-file fetch.

1. `SystemShowcase` eagerly awaits `ensureDistrictGeometriesLoaded()`; a
   `districtGeomReady` flag triggers a `committedBoundary` memo that rebuilds the
   boundary from `resolvedDistricts → MALAYSIA_DISTRICTS → districtsToGeoJSON` (real
   MultiPolygons when loaded, metadata bbox rectangles otherwise; falls back to the
   stored `projectBoundary.geojson`).
2. `activePopupData` now passes `committedBoundary.geojson` / `.bbox` as the popup's
   `boundaryGeojson` / `boundaryBbox`, replacing the raw stored geojson.
3. `DistrictProjectPopup` re-syncs its `project-boundary` source to the strict
   per-district features whenever `data.boundaryGeojson` changes (geometry may arrive
   after the map mounts), alongside the existing derived-name fallback.

## 4b. Root cause: the inspect map highlighted only ONE district

**Finding (verified against the live Supabase row):** the saved boundary is complete and
correct — `districtIds: ['segamat','tangkak']`, `districtNames: ['Segamat','Tangkak']`,
and a committed `geojson` with BOTH real polygons. The "only Segamat" symptom was a
**rendering** bug, not a data bug:

- `ProjectBoundaryMap` only ever highlighted the **active district** chip
  (`districtFeature = find(malaysia.district.geojson, districtName)`) in red and
  `fitBounds` to that single polygon — so Tangkak, though committed, never got its own
  visible boundary.
- Fix: pass the committed boundary down as `projectBoundary={{ geojson, bbox }}` and
  draw it as the red **committed-boundary** line layer (every saved district) in addition
  to the amber dashed active-district outline; `fitBounds` to the committed bbox so
  Segamat + Tangkak both appear together, independent of panotrack POI.
- `DistrictProjectPopup`'s merge was extracted into a pure,
  unit-testable `mergeCommittedBoundaryFeatures()` and proven to keep both districts.

## 4c. `inspectableDistricts` must merge, not short-circuit

`SystemShowcase`'s `inspectableDistricts` used to fall through only when a source was
empty — a boundary with a partial `districtIds` (e.g. `['segamat']`) paused at step 1 and
silently dropped the districts listed in `districtNames`/`geojson`. All three saved
signals (ids + names + committed features) are now merged with dedup so nothing the user
saved is ever dropped from the HUD card chips, the boundary, or the panotrack bbox filter.

## 4d. Workspace globe boundary flashing + `removeSource` error (`MapComponent`)

**Symptom (user):** in the workspace globe the committed district line keeps flashing and
`Error: Source "project-boundary" cannot be removed while layer "project-boundary-fill"
is using it` repeats from the WebGIS iframe (`WebGL3DView Map.jsx`).

**Cause:** this dashboard posts `SET_PROJECT_BOUNDARY` up to ~5× in the first second
(iframe `onLoad` dispatches at 0ms / 350ms / 1000ms, plus every `MAP_READY` /
`WEBGIS_READY` message, plus whenever the settings object identity changes). Each
identical push makes the external WebGIS tear down and rebuild its own
`project-boundary` source while its fill/line layers still reference it → Mapbox
`removeSource` error → the boundary layer flickers / never finishes drawing, so Tangkak
doesn't render reliably.

**Fix:** `MapComponent` now fingerprints the boundary payload
(`{ geojson, bbox, focusActive }`) in a ref and only posts `SET_PROJECT_BOUNDARY` /
`FOCUS_BOUNDARY` / `DIM_OUTSIDE_BOUNDARY` / clears when it actually changes. The first
push still carries the full 2-feature Segamat + Tangkak geojson (via
`rehydrateDistrictBoundary`) with the union bbox, so the globe draws both districts once
and stably. Note: the chunked WebGIS itself is an external app (VITE_MAP_URL iframe);
this dashboard fixes the trigger on its side.

## 4e. Inspect "map dashboard" boundary flashing (`ProjectBoundaryMap`)

**Symptom (user):** the globe is fine, but in the full-screen map dashboard the boundary
kept flashing.

**Cause:** two-layer. (1) `SystemShowcase` passed `projectBoundary={{ geojson, bbox }}`
as an **inline literal** — a new object identity on every render, which re-ran
`ProjectBoundaryMap.applyDistrictLayers`. (2) That function's active-district block
**removed and re-added** its source + fill + line layers on every run → a visible
black/white flash per re-render.

**Fix:** memoize the committed-boundary prop object in `SystemShowcase`
(`activeProjectBoundary`), and convert `ProjectBoundaryMap`'s active-district block to
**add-once + `setData`** (mirroring the committed-boundary layer), so layer identity
churn can never tear down the map's boundary rendering.

## 4f. First-open / guest HUD shows only Segamat (Tangkak missing until sign in/out)

**Symptom (user):** on the very first web open (guest, not signed in), the globe HUD
card shows only Segamat. After signing in and out, Tangkak appears.

**Cause:** the HUD district list derives entirely from
`projectSettings.projectBoundary` (`SystemShowcase.inspectableDistricts`). The default
guest `projectSettings` carried **no boundary**, so there was nothing to derive Tangkak
from — the fallback (`findDistrictAt` on the surveyed GPS point) resolved to a single
district, Segamat, until a real project's scope was applied on sign-in.

**Fix:** ship a **default committed production boundary** — Johor (Segamat + Tangkak) —
built from the real district metadata via the new `buildDefaultProjectBoundary()`
(`malaysiaDistricts.ts`) and seeded into `DEFAULT_PROJECT_SETTINGS.projectBoundary`
(`useAppData.ts`). The guest/ first-open HUD now exposes exactly Segamat + Tangkak like
the signed-in project; `applyProjectScope` still fully overrides (or strips, when a real
project has no committed boundary) so per-project isolation is untouched.

## 4g. Project boundary missing in the WebGIS map dashboard after the de-dupe fix

**Symptom (user):** the globe HUD card shows the boundary, but the map dashboard's
embedded WebGIS map has no project boundary.

**Cause:** regression from the §4d de-dupe. The mount effect runs `syncMapSettings()`
**before** the iframe has loaded — the `SET_PROJECT_BOUNDARY` message is dropped, but
`boundaryPushRef` was already set to that fingerprint. Every later, effective push
(`onLoad` at 0/350/1000 ms, `MAP_READY`) compared equal to the fingerprint → skipped →
the boundary never arrived on cold open.

**Fix:** on every fresh iframe `onLoad`, clear `boundaryPushRef` before dispatching so
the boundary is (re)sent exactly once now that the WebGIS listener is mounted. Steady
-state duplicate suppression is unchanged (only one boundary push per load; `MAP_READY`
re-triggers remain de-duped), so the §4d flashing fix stays intact.

## 4h. WebGIS "always blinking" boundary — external app (repo: `D:\Webmap\360 web mapping\360 web mapping`)

**Symptom (user):** the boundary now loads in the map dashboard but blinks continuously.

**Cause:** the WebGIS own boundary renderer (`src/components/Map.jsx` `applyBoundary`) was
destructive: on every boundary-effect re-run it removed source + layers and re-added
them, and its cleanup list **omitted `project-boundary-fill`** — so `removeSource`
threw while fill still referenced it, the next `addSource` threw "already exists", and
the boundary flickered/lost on each pass. Its `ensureBoundary` self-heal also rebuilt
on every map `idle` because `applyBoundary` never created the `project-boundary-dim`
layer the check required (with our `DIM_OUTSIDE_BOUNDARY` active, `dimMissing` was
always true).

**Fix:** rewritten `applyBoundary` to be **add-once + setData** (the same pattern as our
own `ProjectBoundaryMap`), recolors the live line on basemap/theme changes, always
creates the dim-mask placeholder layer so `ensureBoundary` cannot force rebuilds, binds
hover listeners once per map instance, and includes `project-boundary-fill` in the
cleanup removal list.

## 5. Tests

- `src/utils/__tests__/panotrackExtractor.test.ts`: `available` status/colour mapping +
  `filterPanotrackByBBoxes` containment (inside/outside) + row-level `isAvailable` flagging.
- `src/components/__tests__/DistrictProjectPopup.test.ts`: new
  `mergeCommittedBoundaryFeatures` unit tests (keeps partial geojson + derived districts,
  dedupes, empty-set).
- `src/components/__tests__/SystemShowcase.test.tsx`: HUD chips show both Segamat +
  Tangkak for (a) partial `districtIds` + full names/geojson and (b) the real saved
  boundary shape from Supabase.
- Existing suite must stay green (fixtures never set `isAvailable` / `'available'`, so
  current expectations are unchanged).

## 6. Verification

- `npx tsc -b`
- `npx vitest run`
- `node scripts/lint.mjs`

## 7. Out of scope

- No WebGIS iframe (MapComponent) changes; only the two in-repo MapLibre surfaces.
- No dashboard visual redesign; popup/map gains status colouring + a small legend only.

## 8. Implementation v18 — ProjectWorkspace gallery cards

**Scope (confirmed with user):** ONLY the in-app `ProjectWorkspace` project list becomes a
gallery card style with live project previews. The sign-in picker (`ProjectOnboarding`) is
explicitly **discarded** — no changes there.

**Goal:** replace the row-based project list with responsive gallery cards that each render a
mini live basemap of the project's extent (`ProjectGalleryCard`), while preserving the global
style/content design and every existing label/value (so the `ProjectWorkspace.smoke` test
suite stays untouched and green).

### 8a. New component `src/components/common/ProjectGalleryCard.tsx`

- `resolveProjectPreview(project)` (pure, exported for tests): extent + content resolution
  order = committed boundary (`rehydrateDistrictBoundary` → geojson/bbox/districtNames) →
  `scope.bbox` → peninsular fallback `[99.6, 1.2, 104.6, 6.8]`. Basemap key:
  `scope.basemap`/`scope.theme` containing "dark" → dark, otherwise light.
- `ProjectPreviewMap`: one non-interactive MapLibre instance per card (OFM dark/positron
  styles, `attributionControl:false`, `renderWorldCopies:false`), boundary drawn once via
  `addSource`/`addLayer` (+ `.setData` on change), `fitBounds` to the resolved bbox on
  style load (extent view). Disposed on unmount. `supportsWebGL()` guard (skips in test env
  via `import.meta.env.MODE === 'test'`) renders a matte placeholder — keeps jsdom tests
  silent and risk-free.
- Card body is intentionally **minimal** (user feedback on `Mobile Mapping - DevTest_v1`):
  name + status line with a **green dot at the active text** (no boxed status pill, no boxed
  "Current" badge), one compact `contract · client · region` line, single-line description,
  and a progress %/bar/km footer. A `border-t` **divider** separates the map preview from the
  content below. Load/Edit/Delete actions sit as compact overlay buttons on the map's top-right.
- Basemap follows the **user's global basemap setting first** (matched to the live WebGIS
  `SET_BASEMAP`: `projectSettings.defaultBasemap` e.g. `ofm-positron`/`ofm-dark`/`ofm-bright`,
  legacy fallback `defaultBasemapStyle`), then the project scope `basemap`/`theme`, final
  fallback `dark`. `resolveUserBasemapKey` maps dark/fiord → dark, everything else → light.
- Boundary rendering is basemap-aware and neutral (no red): light basemap → black
  `#0a0a0a` stroke with a white casing line + faint dark fill; dark basemap → white
  `#f1f5f9` stroke with a dark casing so it stays visible.
- Card layout sized for a clear basemap preview: taller map area (`h-40 sm:h-44`) and a
  narrower card via a 4-column max gallery
  (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4`).

### 8b. `ProjectWorkspace.tsx` rewiring

- "Recent projects rail" (right `340px` create/edit column kept as-is) becomes a gallery
  grid `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start`.
- Each card receives the resolved actualKm/targetKm/progressPct (active-project live
  `totalKm`/`projectSettings.targetKm` syncing preserved), plus `handleOpenEdit` /
  `setConfirmDelete` behind the same `onUpdateProject`/`onDeleteProject` gates and the
  `canWrite` (guest) gate.
- Removed from workspace: local `STATUS_TONE`/`STATUS_KEY`/`formatRelative` and unused
  `Trash2`/`StatusDot` imports.

### 8c. Tests & verification

- `src/components/__tests__/ProjectGalleryCard.test.ts`: resolver unit tests (boundary
  geojson/bbox/districtNames, scope-bbox fallback, light/dark basemap derivation) +
  `resolveUserBasemapKey` (dark/ofm-dark/positron/missing).
- `ProjectWorkspace.smoke.test.tsx` **unchanged and green** (names, contract/client,
  description, `projectCurrent`, `projectLoad`, `42.5%`, `42.5 / 100.0 km`, edit/delete
  flows still all present in the cards).
- `npx tsc -b`, `npx vitest run` (45 files / 412 tests incl. new file), `node scripts/lint.mjs`
  → 0 errors, only the codebase-wide pre-existing `no-explicit-any` warnings.

### 8e. Map preparing loading state

- `MapComponent` shows a "Preparing GeoSphere map…" overlay (spinner + `Applying project
  basemap & boundary`) over the iframe while the WebGIS applies project config.
- WebGIS sends **no ready handshake**, so dismissal is timer-driven: cold boot = 2200 ms after
  iframe `load`; project (re)load = 1600 ms via a new `prepareKey` prop bumped in App's
  `handleLoadProject`. Any future `MAP_READY`/`VIEWER_READY`/`WEBGIS_READY`/`MAP_LOADED`
  message dismisses it immediately.
- Overlay is `z-10` (`pointer-events-none`, below the z-20 badges), so it can never trap the UI.

### 8f. Project switch freshness (no stale-session bleed)

- Root cause: `handleLoadProject` only persisted `saveActiveProjectId` (localStorage) but never
  updated the module-level `projectContext.activeProjectId`, and in-memory `dailyData` /
  `batchLogs` / QA maps were never cleared or refetched on switch. Result: the new (empty)
  project still showed the previous session project's data until a hard refresh (which re-runs
  the resume effect → `setActiveProjectId` → scoped refetch).
- Fix (`App.tsx` `handleLoadProject`): call `setActiveProjectId(project.id)` immediately,
  clear `dailyData`/`batchLogs`/`qaqcAuditRuns`/`qaSubgridRecords` + subgrid/run filters, bump
  `mapPrepareKey`, then `refreshData()`.
- `refreshData` is a new `useAppData` export wired through `refreshDataRef` so it can re-run the
  scoped `initLiveSupabaseData(true)` reload from outside the mount-only effect.
- `setSelectedSubgridFilter` etc. intentionally stay OUT of the callback deps (declared later in
  App body; including them would throw a TDZ ReferenceError).

### 8g. Card/settings km isolation + status labels

- The legacy global `project_settings` row's `targetKm`/`targetImages` was clobbering the active
  project's scope values on every sync (leak: new project showed previous project's 4886.3 km).
  `useAppData`'s per-project merge now also preserves `prev.targetKm`/`targetImages`/`targetDeadline`
  (mirroring the projectBoundary isolation).
- `ProjectWorkspace` card `targetKm` now always reads `p.scope.targetKm` (scope = source of
  truth); a brand-new project correctly shows `0.0 km` / 0%.
- Card status (ProjectGalleryCard): the loaded project shows `projectStatusActive` ("Active")
  with a green dot and no pulse/blink; a non-loaded card whose lifecycle status is also `active`
  renders no status label at all (only currently-loaded projects may claim Active).
- Tests: smoke updated (`projectStatusActive`, non-loaded-not-labeled, 0-km-new-project).

### 8h. What is NOT included

- Sign-in picker stays untouched (user discarded this scope).
- No per-project point fetching in card previews; preview = boundary + metadata + description
  + extent basemap only.