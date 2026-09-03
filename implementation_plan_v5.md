# Implementation Plan v5 — Road Analysis Workspace

## ✅ v5 STATUS — IMPLEMENTED (R1–R6 complete)

The v5 effort introduces a **Road Analysis** workspace: a dedicated surface where survey
operators compare **road-captured** (real published panotrack) vs **road-plan** lines,
selectable by region (**state + multi-select district**), under the same Strict Design
Preservation Rule that governed v4. No visual redesign; dashboard untouched.

| Phase | Status |
|---|---|
| R1 — Registry + routing wiring | ✅ **Implemented** (`roadAnalysis` route, nav entry under Insights, i18n labels ×4). |
| R2 — Region selector (state + multi-district) | ✅ **Implemented** (`malaysiaDistricts.ts` module + district multi-select UI). |
| R3 — Plan source (system + manual override) | ✅ **Implemented** (system-derived baseline + GeoJSON LineString upload). |
| R4 — Embedded map + line overlay (best-effort) | ✅ **Implemented** (WebGIS iframe in Road Analysis only; `SET_PROJECT_BOUNDARY` + best-effort `SET_ROAD_PLAN_LINE`). |
| R5 — Captured-vs-plan comparison + refresh | ✅ **Implemented** (real `SUBGRID_COORDINATES` captured set, distance/ratio metrics, refresh from map). |
| R6 — Gates + regression | ✅ **Green** (`tsc` 0, `build` ok, `vitest` 21 files/172 pass, `lint` 0 errors); dashboard untouched. |

Delivered sources: `src/components/RoadAnalysisWorkspace.tsx`,
`src/components/boundary/malaysiaDistricts.ts`, `malaysia.district.geojson` (owner-supplied),
`implementation_plan_v5.md`. No visual redesign; the Main Dashboard JSX was not touched.

---

## 0. Governing rules (all binding)

### Strict Design Preservation Rule
- Preserve the existing GeoSphere 360 **global theme, colours, typography, spacing,
  borders, buttons, icons, component language**. No exceptions.
- No generic coloured text boxes, decorative colour blocks, random gradients, unrelated
  styles. New components **inherit existing styles / semantic status colours**
  (`bg-card`, `border-subtle`, `bg-inner`, `text-sky-400`, existing status chips).
- Preserve all working logic (Supabase/PostGIS, Leaflet/Esri layers, 360 viewer, QA/QC,
  exports). **Main dashboard visually untouched.**
- Do not rebuild the Main Dashboard. Do not move heavy processing into the browser.

### Functional rules
- **No fake telemetry / no fabricated geometry.** Every displayed value traces to a real
  source or is clearly marked as a derived/system baseline or "future capability".
- No feature removal. Reuse existing components (`MapComponent` iframe bridge,
  `MALAYSIA_REGIONS` region helper, hash router, i18n, `WorkspacePlaceholder`).
- Buildable + green after every phase: `npx tsc -b`, `npm run build`,
  `npx vitest run`, `npm run lint` (0 errors).
- **No full rewrite.** The Road Analysis workspace is an *additive* surface; it does not
  alter existing workspaces or the dashboard.

### Locked scope decisions (from the owner, prior session)
- **Plan-line source:** **system-generated + manual override** (no separate owner-built
  road-plan dataset exists; the system baseline derives honestly from real published
  panotrack trajectory / assigned survey subgrids, with a manual **GeoJSON upload** as
  the explicit override).
- **Placement:** a **new dedicated workspace** (`roadAnalysis`), not part of the dashboard.
- **Regions:** any region, e.g. Johor; the plan line draws only inside the selected
  region's area.
- **Rendering:** embedded WebGIS iframe **inside Road Analysis only**. No local map
  engine. The plan line is a **best-effort** overlay sent to the WebGIS via postMessage
  (no existing line/GeoJSON overlay message type exists — see Section 3 hazard).
- **Refresh hook:** re-compute captured-vs-plan differentiation "whenever any new update
  from map dashboard" → i.e. on panotrack publish/map updates.
- **Districts: multi-select** (in addition to state), so drawing happens on small areas.

---

## 1. Current baseline (facts driving the plan)

- **Custom hash router** (`src/utils/hashRouter.ts`): `WorkspaceKey` union +
  `WORKSPACE_KEYS`. The `'roadAnalysis'` key was **already added** to the union and the
  `WORKSPACE_KEYS` array in a prior session step (uncommitted).
- **Workspaces** declared in `src/workspaces.tsx` (`WORKSPACES: WorkspaceDefinition[]`,
  each with `labelKey`, `descriptionKey`, `icon`, `tag`; `WORKSPACE_CATEGORIES` groups them
  for `WorkspaceSidebarNav`). `getWorkspaceDefinition()` resolves by key; unknown keys fall
  back to the **placeholder** (`WorkspacePlaceholder`) — which the Road Analysis workspace
  will replace with its real surface.
- **App.tsx** (3,110 lines): lazy-imports each workspace component, then renders them in a
  large ternary (`currentPage === '<key>' ? <Workspace …/> : …`) wrapped in
  `<React.Suspense>` + `<WorkspaceErrorBoundary>`. An unmatched `currentPage` falls through
  to the placeholder.
- **Region geometry today:** only 16 **state** boundaries exist — `Malaysia_Boundary.json`
  (612 KB, simplemaps MY states, `properties: { id: 'MY12', name }`) consumed by
  `src/components/boundary/malaysiaRegions.ts` → `MALAYSIA_REGIONS` (list of
  `{ id, name, bbox, center, zoom, group, geojson }`), plus helpers `regionToGeoJSON`,
  `groupMalaysiaRegions`, `ENtireMalaysiaID`, `MALAYSIA_WIDE_BBOX`.
- **District geometry (NEW source):** `malaysia.district.geojson` added by the owner
  (854.7 KB, **160 features**, all `MultiPolygon`).
  - Feature `properties`: `{ name, state, code_state }`; feature `id` like `kuala-selangor`.
  - `properties.state` = **state code** (`SGR`, `KDH`, `JHR`, `MLK`, `SWK`, `LBN`, `PJY`,
    `KUL`, `PNG`, `PLS`, `PHG`, `NSN`, `PRK`, `TRG`, `SBH`, `KTN` — 16 states, matches
    boundary data).
  - `properties.code_state` is **NOT a unique district id** — it repeats the state's numeric
    code for every district in that state. **Districts must be keyed by `name`** (or feature
    `id`), grouped under `state`.
  - Encoding: UTF-8 **without BOM**, **LF** line endings (repo convention is UTF-8+BOM+CRLF
    — normalize on import to avoid diff/processing surprises; JSON import via a `.ts`
    re-export keeps bytes irrelevant to the bundler).
- **Real data for the two lines:**
  - **Captured (road-captured):** real published panotrack **points** from
    `panoramas_view` / `staging_panoramas` (each a Point with lat/lng; "published" status).
  - **Plan (road-plan):** there is **no real "planned route" dataset**. System plan =
    derived from the real captured trajectory / assigned survey subgrids (honest baseline),
    **or** an uploaded manual GeoJSON (explicit override). Never rendered as an official
    "as-built contract" without labelling.
- **Map architecture:** external WebGIS iframe (`VITE_MAP_URL` or
  `https://mobilemapping-nine.vercel.app`) communicating via `postMessage`. Existing message
  types include `SET_PROJECT_BOUNDARY`, `FILTER_SUBGRID`, `SET_SUBGRID_FILTER`, `FLY_TO`,
  `FOCUS_BOUNDARY`, `DIM_OUTSIDE_BOUNDARY`, `CLEAR_BOUNDARY_FOCUS`, `MAP_POINT_DESELECTED`,
  `FILTER_STATUS_TYPES`. **No line/GeoJSON overlay postMessage type exists.**

---

## 2. Phase map

| Phase | Scope | Primary outcome | Visual risk |
|---|---|---|---|
| **R0** | Plan approval + dataset housekeeping | Owner signs off; district data normalized as a typed module | None |
| **R1** | Registry + routing wiring | `roadAnalysis` appears in nav (proper tag), route resolves to the new workspace | None |
| **R2** | Region selector (state + multi-district) | Operator picks state then **multi-select districts**; geometry + bbox computed for the map | None |
| **R3** | Plan source (system + manual override) | Toggle plan source; system-derived baseline from real captured/subgrid points + GeoJSON upload override | None |
| **R4** | Embedded map + line overlay (best-effort) | WebGIS iframe inside Road Analysis only; boundary + line sent via postMessage | None |
| **R5** | Captured-vs-plan comparison + publish refresh | Differentiation recomputed on panotrack publish/map updates; honest metric panel | None |
| **R6** | Gates + regression | `tsc`, `build`, `vitest`, `lint` green; dashboard unchanged | None |

Order: R0 → R1 → R2 → R3 → R4 → R5 → R6. Steps renumber to R1..R6 once approved.

---

## R1 — Registry + routing wiring

**Goal:** make `roadAnalysis` a first-class, navigable workspace that resolves to the new
surface (not the placeholder).

- `src/utils/hashRouter.ts` — **already has** `'roadAnalysis'` in `WorkspaceKey` +
  `WORKSPACE_KEYS` (verify/keep).
- `src/workspaces.tsx`:
  - Add a `WORKSPACES` entry:
    `{ key: 'roadAnalysis', labelKey: 'workspaceRoadAnalysis', descriptionKey: 'workspaceRoadAnalysisDesc', icon: <Route icon>, tag: 'planned' }`.
    - `tag`: use `'planned'` initially if the surface is still roadmap-flavoured, or
      `'live'` once real comparison data renders. Decision recorded in R6; default `'planned'`
      keeps the existing `WorkspacePlaceholder` "roadmap" note honest until real data flows.
  - Do **NOT** reorder `WORKSPACE_CATEGORIES` (P2 reorder in v4 must be preserved). Add
    `roadAnalysis` to a category only if the owner wants it in the nav grouping; otherwise it
    appears via its own nav entry using existing nav rendering.
- `src/App.tsx`:
  - Lazy-import: `const RoadAnalysisWorkspace = React.lazy(() => import('./components/RoadAnalysisWorkspace').then(m => ({ default: m.RoadAnalysisWorkspace })));`
  - Add a `) : currentPage === 'roadAnalysis' ? (` branch before the final placeholder
    `else`, mirroring the `analytics`/`reports` workspaces (pass `translate`, `onBackToDashboard`,
    and the data/notify props the surface needs).
- i18n `src/lib/i18n.ts` — add `workspaceRoadAnalysis` + `workspaceRoadAnalysisDesc` in all
  four locales (EN/MY/ZH/JA), adjacent to the other `workspace*` keys.

**Verify:** nav shows the workspace; `#/roadAnalysis` resolves to the new surface; unknown
keys still fall back to the placeholder; `tsc`/`build` green.

---

## R2 — Region selector (state + multi-district)

**Goal:** operator selects a **state**, then **multi-selects districts**; computes the
combined geometry/bbox that is sent to the embedded map so drawing happens on small areas.

- Represent the district dataset as a typed module, e.g.
  `src/components/boundary/malaysiaDistricts.ts`:
  - Import `malaysia.district.geojson` and build a `DISTRICTS` list of
    `{ id, name, state, bbox, center, zoom, geojson }`.
  - Keying: use the **feature `id`** for stable identity; display `properties.name`.
  - Grouping: `groupMalaysiaRegions`-style helper groups districts by `properties.state`
    (state code). Map state code → state display name by cross-referencing the existing
    boundary `properties.name` where codes align, or via the boundary features' `id`/name.
  - Reuse `bboxOfGeometry`/`pickZoom` behaviour (extract or duplicate the small helpers from
    `malaysiaRegions.ts` — prefer sharing if straightforward, otherwise a thin local copy to
    avoid coupling; no logic duplication beyond minimal).
- Build a **selector UI** in the Road Analysis workspace reusing existing list/checkbox
  component language (existing status chips / list items / buttons):
  - State list (from `MALAYSIA_REGIONS`), then a **multi-select district** list filtered to
    the chosen state (e.g. Johor → pick Johor Bahru, Kulai, etc.).
- Compute the **union** of the selected district geometries → a `FeatureCollection` + bbox,
  using the same helper shape as `regionToGeoJSON`, so it can be sent as a boundary to the
  map.

**Verify (honesty):** district geometry is real (`malaysia.district.geojson`), never
fabricated; multi-select union geometry + bbox are correct; no changes to dashboard.

---

## R3 — Plan source (system-generated + manual override)

**Goal:** let the operator choose where the **road-plan line** comes from.

- **Plan source selector** (existing segmented-button / select styles):
  - **System-generated:** derive a baseline polyline from **real** data — the assigned
    survey subgrids and/or the published panotrack trajectory (points → a simple ordered
    path/joined baseline) for the selected region. **Label it clearly as a system-derived
    baseline** (honest), computed from real captured points, not a fabricated "official
    plan".
  - **Manual override:** operator uploads a **GeoJSON** file (LineString). This replaces the
    system baseline as the authoritative road-plan line for the session.
  - Show which mode is active (e.g. an existing status chip: "System-derived" /
    "Manual override").
- Persist the chosen-mode + any manual GeoJSON in a local-only/workspace state (like other
  localStorage-merged settings) — no heavy browser processing; no fake metrics.

**Verify:** both modes selectable; manual upload parses & validates GeoJSON; the active mode
is visible; no browser-heavy geometry processing.

---

## R4 — Embedded map + line overlay (best-effort)

**Goal:** render captured vs plan only inside the Road Analysis embedded map.

- Embed the **same WebGIS iframe pattern** as `MapComponent.tsx` / `DeletionSelectionMap.tsx`
  (a local iframe reference + `postMessage` helper), scoped strictly to this workspace.
- On region selection: send `SET_PROJECT_BOUNDARY` with the district union
  `geojson + bbox`, and `DIM_OUTSIDE_BOUNDARY` on/off — reusing the established message
  contract.
- **Plan line rendering (best-effort, documented):** there is **no existing overlay message
  type** (e.g. `SET_LINE` / `SET_GEOJSON_OVERLAY`). The dashboard will send the line
  `GeoJSON` via a **new best-effort postMessage** (e.g. `{ type: 'SET_ROAD_PLAN_LINE', geojson }`)
  that the WebGIS app may or may not implement. Visually confirming the line depends on the
  WebGIS app supporting it (outside this codebase). If unsupported, the plan line area shows
  the system/manual source and geometry in the side panel without a fake on-map rendering.
- Captured points come from the real published panotrack filtered to the region.

**Verify:** iframe renders inside Road Analysis only; boundary focus works; line overlay is
sent best-effort and its support status is surfaced honestly (not claimed as rendered if
unknown).

---

## R5 — Captured-vs-plan comparison + refresh

**Goal:** differentiate captured vs plan and keep it fresh on map-dashboard updates.

- Compute an **honest comparison** for the selected region: captured distance / captured
  point count from real panotrack; plan line length from the active plan source; and a
  **coverage/difference** metric (e.g. % of plan segment near a captured point) — straight
  from real coordinates; no fake telemetry.
- **Refresh hook:** recompute "whenever any new update from map dashboard" (the existing
  panotrack publish / map-update flow, e.g. re-run the captured fetch and re-derive).
- Render in an existing stats/panel style; mark any not-yet-wired metric as handled-by-rules
  (real or explicitly labeled).

**Verify:** capture/plan numbers trace to real data; refresh triggers on publish; dashboard
untouched.

---

## R6 — Gates + regression

- Run: `npx tsc -b`, `npm run build`, `npx vitest run`, `npm run lint` (0 errors; warnings
  baseline only).
- Re-confirm the **Main Dashboard is visually/behaviorally untouched** (no edits to its
  JSX), P2 reorder intact, `roadAnalysis` placeholder → real surface swap.
- Decide `tag: 'live' | 'planned'` once real data renders.

---

## 3. Hazards / open decisions

1. **No WebGIS line-overlay message type** — plan-line on-map rendering is best-effort and
   depends on the external map app. Surface support status honestly.
2. **`properties.code_state` is not a unique district id** — must key districts by `name`/
   `id`, not `code_state`.
3. **District file encoding** (UTF-8, no BOM, LF) differs from repo convention (BOM+CRLF) —
   normalize on import (re-export as a typed `.ts` module; rendering is unaffected).
4. **System plan has no real "planned route" dataset** — the system baseline is derived from
   real captured/subgrid data and must be labelled as such; manual GeoJSON is the only true
   "plan" input.
5. **Nav placement of `roadAnalysis`** — whether to add it to `WORKSPACE_CATEGORIES` (and
   which group) or render it standalone; owner decision. Preserve the v4 P2 reorder.
6. **`tag` initial value** (`'planned'` vs `'live'`) — owner decision; default `'planned'`
   until real data flows.

---

## Next step

Owner review of this plan → on approval, implement in R1 (registry+routing) first, then
R2…R6, running gates at each phase. No commit unless the owner asks.
