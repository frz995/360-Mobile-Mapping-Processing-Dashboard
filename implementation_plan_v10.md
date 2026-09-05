# Implementation Plan v10 — Road Analysis: Save-State Consistency, Slider Responsiveness & Printable Road-Map Export

> **Scope**: Three deliverables in the **Road Analysis** workspace (`src/components/RoadAnalysisWorkspace.tsx`, `src/components/roadAnalysis/*`):
> 1. **Save State does not reliably save/track the full workspace state.** Several editable dimensions — System Baseline styles, Region/district selections, basemap, road-line visibility, "Select as plan" — are never persisted to the local cache nor flagged as "unsaved edits," so they are silently lost on reload and never drive the Save button / unsaved banner correctly.
> 2. **Stroke & Outline Style sliders "stutter" and the "You have unsaved edits…" banner flickers** on every opacity/width step, because each `<input type="range">` `onChange` tick performs a synchronous `localStorage` write (new `lastLocalEditAt`, `savedToCloud:false`) plus a dirty-state toggle plus full re-renders.
> 3. **New: printable Road Analysis map export.** A dedicated **Print** content tab (right next to the Allocation tab) plus a header **Print** button. The print surface is a full road-analysis map snapshot captured from either the **current live map extent** or a **user-drawn bbox**, composed into an A4 print/save-as-PDF document styled like the existing Executive PDF report.
> **Binding Constraints**:
> - Supabase (PostgreSQL `project_settings.roadAnalysisState`) remains the **authoritative** store; `localStorage` stays a local offline/merge cache only. No storage redesign.
> - No new dependencies (no `mapbox-gl-draw`); bbox drawing uses a custom MapLibre pointer interaction + temporary vector source.
> - Cloud save/restore + merge/timestamp semantics (`preferLocal`, `cloudUpdatedAt`, `lastLocalEditAt`) unchanged.
> - Full quality gate: `npx tsc -b` (0 errors), `npm run lint`, `npm test` (incl. `roadAnalysisState`).

---

## 1. Problem & Root-Cause Overview

### Architecture recap
- `RoadAnalysisWorkspace.tsx` owns all workspace state via `useState`, dual-tracked:
  - **localStorage cache** (`persistRoadAnalysisCache` / `mirrorRoadAnalysisToCache` / `loadRoadAnalysisState`) — instant-reload + merge/timestamp guard. `persistRoadAnalysisCache` is where edits are marked `savedToCloud:false` and bump the monotonic `lastLocalEditAt` clock.
  - **Supabase cloud** (authoritative) — `saveRoadAnalysisStateToSupabase` / `fetchRoadAnalysisStateFromSupabase`.
- `computeRoadAnalysisFingerprint` (`RoadAnalysisWorkspace.tsx:118`) defines what "Saved" means for the header button; cache metadata (`savedToCloud`, `lastLocalEditAt`, `cloudUpdatedAt`) drives the unsaved-edits banner (`hasUnsavedEdits`, effect at line 458).

### Root Cause A — Inconsistent edit tracking (Save State doesn't save everything)
1. `onUpdateSystemStyles={setSystemStyles}` (`RoadAnalysisWorkspace.tsx:1668`) is the **raw setter**. System Baseline style edits (District Boundary opacity/stroke/color, Panotrack Point opacity/radius, Road Plan opacity/stroke/color) never call `persistRoadAnalysisCache` and never set the unsaved-edit flag → they are not locally persisted and reload loses them.
2. Region/district/basemap/road-lines edits bypass tracking entirely:
   - `onStateChange` (686) and `toggleDistrict` (691) → only `setSelectedStateCode`/`setSelectedDistrictIds`.
   - Basemap `<select>` (2126) → raw `setMapBasemap`.
   - "Select as plan" buttons (1540, 1618) → raw `setPlanSource`/`setShowRoadLines`.
3. The dirty-banner effect dependency array (`RoadAnalysisWorkspace.tsx:469`) omits `selectedStateCode`, `selectedDistrictIds`, `mapBasemap`, `showRoadLines`, `activeTab`, so even when those change the banner never re-evaluates.
Net effect: the Save/Saved + banner only reflects a **subset** of the workspace → "the state doesn't get saved."

### Root Cause B — Slider stutter (Stroke & Outline, plus every style slider)
- Native `<input type="range">` fires `onChange` on **every step** during a drag.
- Each step → `onUpdateCatalogLayer` → `handleUpdateCatalogLayer` (`RoadAnalysisWorkspace.tsx:1211`) → **synchronous `persistRoadAnalysisCache`** (localStorage write + new `lastLocalEditAt` + `savedToCloud:false`) **+ `setHasUnsavedEdits(true)` + state update → re-render**. Repeated dozens of times per drag.
- The unsaved banner derives dirty from the cache on every `catalogLayers`/`systemStyles` change, so every tick toggles the "You have unsaved edits…" banner and the header Save button flickers → visual "stutter" plus input lag from blocking writes.

### Root Cause C — No print/export path
- The Executive PDF report (`App.tsx:1123` `generateExecutivePdfReport`) is a text/table-only report. There is no way to produce a printable **road-analysis map** over a chosen extent, and no bbox-draw interaction anywhere in the map surface.

---

## 2. Fix Design

### Fix 1 — Decouple live preview from commit (stutter)
New tiny component **`CommitSlider`** (`src/components/roadAnalysis/CommitSlider.tsx`):
- Props: `value`, `min`, `max`, `step`, `style`, `className`, `disabled`, `onPreview?(next)` (live, fires per tick), `onCommit(next)` (fires once on release).
- Internally tracks a `draft` value while dragging; the visible thumb/value use `draft` during drag and revert to the prop `value` when idle.
- `onChange` → updates `draft` + fires `onPreview` only (cheap: React state, no storage/dirty).
- `onPointerUp` / `onTouchEnd` / `onBlur` / arrow-key `onKeyUp` → fires `onCommit(draft)` exactly once.
- Robust pointer capture via a document-level `pointerup` listener while dragging (so releasing outside the input still commits).

Workspace+panel wiring so preview stays live but commit is one-shot:
- Add `onPreviewSystemStyles?` (state-only preview) and `onLiveUpdateCatalogLayer?` (state-only preview) to `RoadCatalogPanel`.
- Sliders use `CommitSlider`: `onPreview` → preview handler; `onCommit` → the existing (`onUpdateSystemStyles` / `onUpdateCatalogLayer`) handler, which persists + marks dirty.
- `handleUpdateCatalogLayer` keeps `persistRoadAnalysisCache` + `setHasUnsavedEdits(true)` — now invoked **once per drag** instead of per tick.
- New workspace handlers:
  - `handlePreviewSystemStyles(updater)` → `setSystemStyles(updater)` (no persist/dirty).
  - `handleUpdateSystemStyles(updater)` → apply + `persistSnapshot({ systemStyles: next })` + `setHasUnsavedEdits(true)`.
  - `handlePreviewCatalogLayer(layerId, updates)` → state-only.
- All sliders get `CommitSlider`: Stroke Opacity (1150), Stroke Width (1174), both fill sliders, point radius/stroke width/label size/halo width, and the System Baseline sliders (619/646/708/735/816/843), plus any other `<input type="range">` in the panel.

### Fix 2 — Unify edit tracking (Save State completeness)
Introduce a single snapshot helper in the workspace:
```ts
const persistSnapshot = useCallback((partial: RoadAnalysisSavedState) => {
  persistRoadAnalysisCache(userKey, {
    activeTab, selectedStateCode, selectedDistrictIds, planSource,
    mapBasemap, showRoadLines, manualGeoJson, extractedLines,
    catalogLayers, systemStyles, ...partial
  });
}, [ /* all slice state + userKey */ ]);
```
Route every mutation point through it + `setHasUnsavedEdits(true)`:

| Mutation point | Location | Change |
| :--- | :--- | :--- |
| System styles (commit) | `onUpdateSystemStyles` (1668) | Replace raw setter with `handleUpdateSystemStyles` (persist + dirty). |
| Region state select | `onStateChange` (686) | `persistSnapshot({ selectedStateCode: code, selectedDistrictIds: [] })` + dirty. |
| District multi-select | `toggleDistrict` (691) | Compute next array, `persistSnapshot({ selectedDistrictIds: next })` + dirty. |
| Basemap select | `setMapBasemap` (2126) | `handleBasemapChange(value)` → persist + dirty. |
| "Select as plan" | 1540 / 1618 | `handleSelectPlan('extracted'/'manual')` → persist + dirty (planSource + showRoadLines). |
| Dirty-banner effect deps | 469 | Add `selectedStateCode`, `selectedDistrictIds`, `mapBasemap`, `showRoadLines`, `activeTab`. |

This makes the unsaved banner and Save button consistent for **all** editable dimensions, and ensures each dimension survives reload via the cache until the user clicks Save State (which mirrors the authoritative snapshot back through `mirrorRoadAnalysisToCache`).

### Fix 3 — Printable Road Analysis map export (new feature)

**Tab & button placement**
- Add `{ key: 'print', icon: <Printer size={14}/>, label: 'Print' }` to `TABS` (currently `RoadAnalysisWorkspace.tsx:216`) **immediately after `allocation`** so it renders right next to the Allocation tab.
- Add a header **Print** button (Printer icon, "Print") in the action cluster at line 1346, next to Save State / Refresh, that activates the print tab (`setActiveTab('print')`) and briefly focuses the generate control.

**Expose the live map for extent capture**
- `RoadAnalysisMap.tsx`: add optional `mapInstanceRef?: React.MutableRefObject<maplibregl.Map | null>` prop; the component assigns `mapInstanceRef.current = map` in `initMap` (and clears on teardown). The workspace passes a ref for the main live map, and a separate ref for the print-preview map.

**New component `src/components/roadAnalysis/RoadAnalysisPrintPanel.tsx`**
- Own print-preview map surface (reuses `RoadAnalysisMap` for 100% identical overlays) with a local `printMapRef`.
- **Extent sources** (mode selector):
  - **Current Map Extent** — reads `liveMapRef.current.getBounds()` → `[minLng, minLat, maxLng, maxLat]` + also inherits zoom/bearing (via `jumpTo` camera from the live map) so "what you see is what you print."
  - **Draw BBox** — custom pointer interaction: crosshair cursor; `mousedown`/`touchstart` records anchor; `mousemove` updates a temp `print-bbox` GeoJSON source (fill + line layers); `mouseup` finalizes the bbox and stores it in state; the preview map then `fitBounds` to it (via the existing `focusBbox` prop).
  - **Full Region** — derive bounds from `regionGeo.bbox` or the union of points/road runs (same logic the live map uses) for a quick whole-region print.
- **Print preview map** renders exactly the road-analysis layers: `districtGeojson`, `dimmedRegionsGeojson`, `capturedPoints`, `roadRuns=activePlanRuns`, `catalogLayers`, `systemStyles`, `showRoadLines`, `style={mapStyle}`, `focusBbox={printBbox}`, `active` when the print tab is visible.
- **Report chrome** (light, print-safe): title `Road Analysis Map`, state/district names, basemap, plan length (km), captured length (km), coverage %, panotrack point counts, generated-by/time, plus a legend (District Boundary, Road Plan, Panotrack Published/Staging/Defect, catalog layer names) and a scale/north note derived from the bbox center.
- **Generate print** flow:
  1. Ensure the chosen extent is applied to the preview map; wait for map `idle` (tiles + overlays rendered).
  2. Temporarily scale the preview container to A4-landscape pixel ratio (`~ 1100 × 760`), `map.resize()`, wait `idle`, then `map.getCanvas().toDataURL('image/png')`, then restore the original container size and `resize()` back. (The preview is a dedicated surface, so this transient resize is invisible to the rest of the workspace.)
  3. Open a new print window (`window.open('', '_blank', ...)`) and write an HTML document modeled on `generateExecutivePdfReport` (`App.tsx:1123`): `@page A4 landscape`, dark action-bar with a **PRINT / SAVE AS PDF** button, header metadata row, the `<img src={dataUrl}>` map, and the legend/metrics strip. `window.print()` is left to the user (browser print dialog).
  4. Mark the run via `addNotification` (SUCCESS) and `addAuditLog` ('EDIT', 'Road Analysis Map Printed').
- The header button plus the tab both reach this panel; the panel's own **Print / Save as PDF** button does the capture.

---

## 3. Implementation Plan by File

| # | File | Change summary |
| :- | :--- | :--- |
| 1 | `src/components/roadAnalysis/CommitSlider.tsx` (new) | Controlled range: local `draft` during drag, `onPreview` live-only, `onCommit` once on release (pointer/touch/key/blur + document-level capture). |
| 2 | `src/components/roadAnalysis/RoadCatalogPanel.tsx` | Add `onPreviewSystemStyles?`, `onLiveUpdateCatalogLayer?` props; replace every `<input type="range">` with `CommitSlider` (live `onPreview`, commit `onCommit`). |
| 3 | `src/components/RoadAnalysisWorkspace.tsx` | `persistSnapshot` helper; `handleUpdateSystemStyles` / `handlePreviewSystemStyles` / `handlePreviewCatalogLayer` / `handleBasemapChange` / `handleSelectPlan`; route `onStateChange`/`toggleDistrict`/basemap/select-plan through persist+dirty; extend dirty-effect deps; `liveMapRef`; `printMapRef`; add `Print` tab after `allocation`; add header Print button; render `RoadAnalysisPrintPanel` in print tab; persist+restore `activeTab` already handled. |
| 4 | `src/components/roadAnalysis/RoadAnalysisMap.tsx` | Add optional `mapInstanceRef` prop; assign latest map instance in `initMap`; clear on unmount. |
| 5 | `src/components/roadAnalysis/RoadAnalysisPrintPanel.tsx` (new) | Extent modes (current view / draw bbox / full region), print-preview map (reuses `RoadAnalysisMap`), legend + metrics, high-res canvas capture + print-window HTML generation (mirrors `generateExecutivePdfReport` styling). |
| 6 | `src/components/roadAnalysis/__tests__/roadAnalysisState.test.ts` | New cases: system-style commit marks cache `savedToCloud:false` + bumps `lastLocalEditAt`; `persistSnapshot`-style edits set dirty; verify `CommitSlider` commits once and preview does not dirty the cache. (Pure-logic tests only — no MapLibre.) |
| 7 | `implementation_plan_v10.md` | This document. |

---

## 4. Verification & Testing

| Step | Command / Action | Acceptance Criteria |
| :--- | :--- | :--- |
| Typecheck | `npx tsc -b` | 0 errors. |
| Lint | `npm run lint` | Green (no new errors). |
| Unit tests | `npm test` | All pass incl. `roadAnalysisState` and new `CommitSlider` logic. |
| Slider smoke test | Drag Stroke Opacity / Stroke Width + every System Baseline slider in Catalog | Live thumb/readout moves smoothly; map preview updates live; **no** unsaved-banner flicker during drag; banner appears exactly once after release. |
| Save/restore | Change system styles + region + basemap → Save State → hard reload | Every dimension restored; Save button shows "Saved"; banner clears. |
| Dirty coverage | Change only Region or only Basemap | Banner + Save button immediately react; reload keeps the change. |
| Print — current extent | Open Print tab → "Current Map Extent" → Print / Save as PDF | New window shows the exact live map view as PNG + report chrome; beeps printer dialog. |
| Print — draw bbox | "Draw BBox" → drag rectangle on preview map → Print | Printed map matches the drawn rectangle. |
| Print quality | Print on 100% zoom, dark + satellite basemap | No blank tiles; overlays (boundary/points/plan) legible; A4 landscape layout. |
| Cloud authority | Save after print run | `project_settings.roadAnalysisState` intact; print does not mutate saved state. |

---

## 5. Non-Goals & Constraints

- **Supabase stays authoritative**; localStorage remains only a local cache — no storage migration.
- No changes to cloud merge/timestamp semantics (`preferLocal`, `cloudUpdatedAt` gating, `lastLocalEditAt` monotonicity).
- No new dependencies; bbox draw is a custom MapLibre pointer interaction; print capture uses `map.getCanvas().toDataURL` + the existing print-window pattern.
- Printing is a **report generation** feature only — it must not mutate road-analysis state (no persist/dirty during print).
- Desktop/tablet visual behavior unchanged; print document is screen + A4-print rendered HTML (no JS print libs).