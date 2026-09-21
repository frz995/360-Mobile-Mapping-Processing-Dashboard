# Implementation Plan v20 — Spatial Inspector Drawer Architecture, Monolith Decomposition, & GIS Scalability

## Goal

Modernize the **TNB 360 Mobile Mapping Processing Dashboard** across three foundational pillars without breaking existing production behavior or degrading the test suite (543 passing tests):

1. **Spatial Inspector Drawer Architecture (UI/UX):**  
   Replace intrusive, screen-obscuring modal popups (`fixed inset-0 bg-black/85`) with responsive, docked **Spatial Inspector Drawers**. This enables operators to audit camera defects, adjust QA/QC thresholds, and review historical logs while maintaining unbroken visual contact with the live Map and 360° PhotoSphereViewer.
2. **Monolith Decomposition & Service Decoupling (Architecture):**  
   Deconstruct the repository's 200KB+ "God files" (`App.tsx` [281KB / 5,540 lines], `DataManagementPage.tsx` [264KB], and `supabase.ts` [133KB]) into single-responsibility sub-panels and domain services, backed by backward-compatible facade exports.
3. **Normalized State Synchronization & Big Data GIS Scaling (Data Flow & Performance):**  
   Introduce a unified spatial inspection store (`useInspectionStore`) to eliminate prop-drilling, and add vector point clustering to guarantee smooth 60 FPS performance when visualizing massive (50,000+ photo node) survey datasets.

---

## 1. Phase Breakdown & Execution Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 1: Spatial Inspector Drawer & Context Continuity (UI/UX)          │
│ • Reusable InspectorDrawer (compact, expanded, fullscreen states)      │
│ • DefectsGalleryModal -> DefectsInspectorDrawer (live map & 360 sync)  │
│ • QAQCThresholdStudio & QCAudit contextual sheet migration             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 2: Monolith Decomposition & Clean Architecture                    │
│ • supabase.ts (133KB) -> services/api/{datasets,jobs,qaqc,storage}     │
│ • DataManagementPage.tsx (264KB) -> sub-panels & wizards                │
│ • App.tsx (281KB) -> AppHeader, AppTourGuide, WorkspaceRouter          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 3: Normalized State Synchronization & Caching                    │
│ • useInspectionStore (activePoint, activeSubgrid, activeFilter)        │
│ • IndexedDB geometry cache eviction & TTL hygiene                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ Phase 4: Big Data GIS Scalability & Point Clustering                    │
│ • MapLibre / GeoJSON point clustering (supercluster / MVT)             │
│ • Web Worker pipeline offload for heavy GIS parsing                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Detailed Technical Specifications

### Pillar A: Spatial Inspector Drawer (`Phase 1`)

#### 1. Reusable Inspector Drawer Component
**File:** `src/components/common/InspectorDrawer.tsx`
* **Layout & Docking:** Slides in from the right edge with smooth spring physics (`framer-motion`).
* **Three Width Modes:**
  * `compact`: `w-[420px]` (ideal for quick scanning and side-by-side inspection).
  * `expanded`: `w-[680px]` (ideal for detailed parameter tuning and side-by-side photo comparison).
  * `fullscreen`: `w-full` (for operators who want the legacy full-gallery overview).
* **Non-Blocking Overlay Mode:**  
  Unlike standard modals, the drawer can operate in `mode="docked"`, where it shifts or overlaps the right side of the canvas without darkening the map or disabling map interactions (pan, zoom, click).
* **Keyboard & Gesture Accessibility:**  
  Supports `Escape` to close, `J` / `K` (or `ArrowUp` / `ArrowDown`) for next/previous defect item navigation, and touch drag-to-dismiss on mobile.

#### 2. Refactoring `DefectsGalleryModal.tsx` → `DefectsInspectorDrawer.tsx`
* **Continuous Map & 360° Synchronization:**
  * When an operator selects a defect card in the drawer, the map centers on the defect GPS coordinate (`lat`, `lng`), highlights the marker with an amber halo, and updates the PhotoSphereViewer panorama URL **without closing the drawer**.
  * Resolving or marking a defect as "Reviewed" updates the counter in real time and automatically scrolls to the next active item.
* **Dual-View Support:**  
  Retains an "Expand to Full Gallery" button for users who prefer the traditional large grid view.

#### 3. Contextual Sheets for QA/QC Studio & Audit
* **`QAQCThresholdStudioDrawer.tsx`:**  
  Allows sliders for PDOP limits, camera heading deltas, and Tenengrad sharpness to be adjusted while watching affected markers dynamically re-color on the map in real time.
* **`QCAuditDrawer.tsx`:**  
  Side-by-side audit trail logs with chronological filtering.

---

### Pillar B: Monolith Decomposition (`Phase 2`)

#### 1. Deconstructing `src/services/supabase.ts` (133 KB)
The massive `supabase.ts` file will be decomposed into dedicated domain service modules under `src/services/api/`:
* `src/services/api/client.ts`: Supabase client initialization, auth token listeners, configuration helpers.
* `src/services/api/datasets.ts`: `fetchSupabaseData`, `fetchDatasetRegistry`, `saveDatasetRecord`, `reconcileBatchLogs`.
* `src/services/api/jobs.ts`: `saveProcessingJobToSupabase`, `fetchProcessingJobs`, worker launch commands, queue polling.
* `src/services/api/qaqc.ts`: `fetchQADefectsForSubgrid`, `resolveQADefectInSupabase`, `saveQaAuditRunToSupabase`.
* `src/services/api/roadTrace.ts`: Road topology storage, route network geometry persistence.
* `src/services/api/storage.ts`: Storage provider mapping, NAS folder paths, signed URL builders.
* **Facade Integrity (`src/services/supabase.ts`):**  
  The root `supabase.ts` will re-export all domain functions and types. Any existing component importing from `'../services/supabase'` continues working seamlessly with zero breaking changes.

#### 2. Deconstructing `src/components/DataManagementPage.tsx` (264 KB)
Decompose the 4,000+ line component into modular panels:
* `src/components/dataManagement/DataManagementHeader.tsx`: Subgrid selector, project KPIs, search bar.
* `src/components/dataManagement/StagingCatalogTable.tsx`: Virtualized data table for staging panoramas, status badges, and batch actions.
* `src/components/dataManagement/ProductionDeliverablesPanel.tsx`: Deliverable package listings, export options, zip generation.
* `src/components/dataManagement/GisImportPanel.tsx`: File drag-and-drop intake, worker progress, schema validation.
* `src/components/DataManagementPage.tsx`: Lightweight orchestrator (~250 lines) composing the above panels.

#### 3. Deconstructing `src/App.tsx` (281 KB, 5,540 lines)
Extract distinct sub-systems from `App.tsx`:
* `src/components/navigation/AppHeader.tsx`: Top status bar, language selector, theme toggle, project switcher, notification popover.
* `src/components/onboarding/AppTourGuide.tsx`: Multi-step guided tour engine (`TOUR_STEPS`) and interactive spotlight tooltips.
* `src/components/navigation/WorkspaceRouter.tsx`: Dynamic tab router wrapping each workspace in `React.Suspense` and `WorkspaceErrorBoundary`.

---

### Pillar C: State Synchronization & Big Data GIS (`Phases 3 & 4`)

#### 1. Global Inspection Store (`useInspectionStore`)
**File:** `src/hooks/useInspectionStore.ts`
* Centralizes spatial selection state:
  ```ts
  interface InspectionState {
    activePointId: string | null;
    activeCoordinate: [number, number] | null;
    activeHeading: number | null;
    activeSubgrid: string | null;
    activeDefectCategory: 'all' | 'blur' | 'obstruction' | 'gps';
    setActivePoint: (point: { id: string; lat?: number; lng?: number; heading?: number }) => void;
    clearSelection: () => void;
  }
  ```
* Connects `MapComponent`, `PhotoSphereViewerComponent`, and `DefectsInspectorDrawer` without passing callbacks across 5 layers of props.

#### 2. Vector Point Clustering (MapLibre GL / Leaflet)
* Enable dynamic spatial clustering for survey points:
  * When zoomed out (`zoom < 14`): Points group into cluster bubbles displaying count and defect alerts.
  * When zoomed in (`zoom >= 14`): Expands into individual directional camera nodes with heading arrows.
* Keeps browser DOM node count low, preventing frame drops on low-spec hardware or field tablets.

---

## 3. Backwards Compatibility & Safety Guarantees

1. **100% Existing Test Suite Pass:**  
   Every milestone must execute `vitest run` to verify that all **52 test files and 543 tests** remain completely green.
2. **Zero Breaking Changes to External Contracts:**  
   All Supabase table mappings, NAS folder structures, manifest JSON schemas (v19), and export formats are preserved byte-for-byte.
3. **Clean Fallbacks:**  
   If a user is on a small mobile device, inspector drawers automatically adapt to full-width bottom sheets or cards to prevent horizontal overflow.

---

## 4. Verification Plan

### Automated Tests
* `npm test`: Run full Vitest suite (543 tests).
* `npx tsc -b`: Typecheck entire workspace for zero TypeScript diagnostics.
* `npm run build`: Ensure Vite bundle builds cleanly with exit code 0.

### Manual Verification Matrix
* **Spatial Continuity:** Open defect drawer, click through 5 defects; ensure the 2D map centers on each point and the 360 viewer updates instantly without closing the drawer.
* **Keyboard Hotkeys:** Verify `J` / `K` cycles through defects smoothly.
* **Drawer Resizing:** Test compact (`420px`), expanded (`680px`), and full-width modes on 1920x1080 and 1366x768 resolutions.
* **Mobile Responsiveness:** Test on simulated iPhone/Android viewports to confirm drawer transforms into a touch-friendly bottom sheet.
