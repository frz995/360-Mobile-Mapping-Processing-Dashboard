# Implementation Plan v9 — Mobile-First Responsive Fit for Every Panel & App Shell

> **Scope**: Readjust the entire dashboard so every workspace view, content panel, data table, map, panorama viewer, and modal dialog **fits cleanly on mobile viewports** (down to 320px) while leaving the existing desktop/tablet experience pixel-for-pixel untouched. Quick-access navigation becomes a collapsible hamburger drawer on phones instead of the fixed icon rail.
> **Binding Constraints**:
> - 100% preservation of the existing dark-mode GIS slate aesthetic (`bg-card`, `bg-inner`, `border-subtle`, `font-mono`, clean SVG recharts) across every theme.
> - Desktop layout is **gated off** with responsive utilities (`hidden lg:flex`, `lg:block`, etc.) — no class mutations, no visual drift on `≥1024px` viewports.
> - Zero horizontal page overflow / horizontal scrollbars on any device; every panel reaches `min-width: 0` where needed.
> - Touch targets ≥ 40px for all interactive controls on touch devices.
> - Full quality gate compliance: `npx tsc -b` (0 errors), `npm run lint`, and `npm test` (all existing suites, including `WorkspaceSidebarNav`, `chrome`, and `DataManagementPage` tests).

---

## 1. Problem & Architecture Overview

The product ships a **desktop-first** console. Three layers confine it to wide screens:

1. **Fixed Shell**: `App.tsx:2753` renders `min-h-screen md:h-screen md:overflow-hidden`, always mounting `WorkspaceSidebarNav` as a fixed rail (`w-52` expanded / `w-14` collapsed). On a 360px phone the 56px rail + 2×12px main padding leaves ~280px for content — every `min-w-[180px]`/`min-w-[200px]` child then forces horizontal overflow.
2. **Hard-Coded Panel Geometry**: map/canvas containers frequently use inline pixel heights (`DataManagementPage` `style={{ height: 640 }}` at lines 2823/2866, `AdminSettingsView` `min-h-[580px]` at line 2521, `DeletionSelectionMap` `min-h-[260px]`), and grids/reports rely on `lg:`-only column counts with no `grid-cols-1` fallback, so panels reflow incorrectly on narrow screens even though the viewport scrolls.
3. **Unwrapped Data Surfaces**: wide data tables (`DashboardBatchTable`, masterlist ledgers, `LedgerPanel`, road catalog tables) render full-width and shrink/clip their columns; several are not inside an `overflow-x-auto` container.

The shared UI vocabulary is mostly in place: `UnderlineTabStrip` (`production/chrome.tsx:74`) already scrolls horizontally (`overflow-x-auto`), and modals mostly use `fixed inset-0 p-2 sm:p-4`. v9 formalizes these into a consistent, fully-responsive system.

### Target Architecture (even on a 375px phone):

```
┌────────────────────────────────────────────────┐
│  Global Header (compact: title + burger + key   │
│  icons, secondary items hidden <lg)              │
├────────────────────────────────────────────────┤
│  [☰ navbar?] ── drawer slides over content      │
│  Content Canvas: 100% width, natural scroll     │
│   ├─ Tab strip: horizontally scrollable          │
│   ├─ KPI cards: 1-col → 2-col → 4-col            │
│   ├─ Tables: scrollable inside panel, no v-scroll│
│   ├─ Maps/panoramas: responsive vh heights       │
│   └─ Modals: inset-n p-2, edge-to-edge full-view │
└────────────────────────────────────────────────┘
```

---

## 2. Detailed Improvement Breakdown

### A. Mobile App Shell & Navigation Drawer

1. **Hamburger Drawer (<lg)**:
   - Add a `Menu` button in the header, visible only below `lg` (`lg:hidden`).
   - Render `WorkspaceSidebarNav` inside a full-height slide-in drawer: `fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw]` with a dim backdrop (`bg-black/60`), animation-driven via Tailwind `transition-transform` + `-translate-x-full`/`translate-x-0`.
   - Clicking a nav item, Refresh, About, or the backdrop closes the drawer and navigates in one action.
   - State: reuse `isSidebarExpanded`? No — introduce `isMobileNavOpen` in `App.tsx` and keep `isSidebarExpanded` purely the desktop rail's expand toggle.
2. **Desktop Rail Unchanged (≥lg)**:
   - Wrap the current inline rail in `hidden lg:flex` so `≥1024px` behavior (icon + expandable rail, tour spotlight, categories) is byte-for-byte identical.
3. **Compact Global Header (`App.tsx:2777`)**:
   - Hide the subtitle line and truncate the title at small widths (already partly done via `sm:hidden`).
   - Keep WebGIS / Briefing / Help icons; allow the audit/notification popovers to anchor with `w-full max-w-[calc(100vw-1rem)]` on their current `w-96 max-w-[90vw]` so they never clip edges.
   - Wrap the top-right control cluster — at `<sm` the avatar/Guest/logout cluster stacks under the header instead of overflowing.

### B. Unified Content & Scroll Model

1. **Scroll ownership**: Keep `md:h-screen md:overflow-hidden` for desktop; on mobile let the `<main>` (`App.tsx:3003`) scroll naturally (`overflow-y-auto` already, change `p-3` → `p-2 sm:p-3`) so sticky panel headers work instead of nested fixed-4096 px canvases.
2. **Kill hard caps** (systematic sweep):
   - Replace `style={{ height: 640 }}` map canvases with `h-[40vh] sm:h-[52vh] lg:h-full` (min `min-h-[320px]`).
   - Replace `min-h-[580px]`/`min-h-[260px]`/`min-h-[300px]` with responsive `min-h` values (`min-h-[260px] sm:min-h-[340px] lg:min-h-[420px]`).
   - Replace panel `min-w-[200px]`/`min-w-[180px]` inner columns with `min-w-0` (flex child) and let the surface scroll instead.
3. **Grid fallbacks**: every `lg:grid-cols-N`/`md:grid-cols-N` layout gains a `grid-cols-1 sm:grid-cols-2` base so single-column flow is the guaranteed mobile outcome (`DashboardKpiSummary` already does this; replicate).

### C. Shared Component Enhancements

1. **`UnderlineTabStrip` (chrome.tsx:74)**: keep `overflow-x-auto`; add a fade-gradient edge hint on touch devices; reduce `px-3.5` → `px-3` and add `min-w-0`. Optionally render icon-only tabs below `sm` when a tab has an icon + label.
2. **`Masthead` (chrome.tsx:26)**: tighten `gap`, allow `readouts` to scroll (`overflow-x-auto` already present) and wrap action clusters on small screens.
3. **New shared helpers** (in `src/components/common/`):
   - `ResponsiveTable` (or `<TblScroll>` wrapper): `overflow-x-auto` + `w-full min-w-full` table, so every ledger gets one consistent fix instead of per-file scrolling container edits.
   - `StackGrid` wrapper for the recurring `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N` KPI/stat pattern.
4. **KPI cards**: `DashboardKpiSummary.tsx:36` already `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` — verify inner content truncates (`min-w-0`, `truncate`) and never wraps badges off-card.

### D. Workspace-by-Workspace Panel Pass

| Workspace | Primary fix |
| :--- | :--- |
| **Dashboard** (`App.tsx` inline + `DashboardKpiSummary`, `DashboardBatchTable`, `OperationalActionCenter`) | KPI grid already responsive; wrap batch table in horizontal-scroll surface; action-center buttons wrap under `md` (partially done at `OperationalActionCenter.tsx:171`). |
| **Data / PostGIS** (`DataManagementPage.tsx`) | Tables + ledgers → `ResponsiveTable`; map canvases → responsive vh heights (lines 2823/2866); toolbar filters stack vertically under `sm`. |
| **Settings** (`AdminSettingsView.tsx`) | Grids already `sm:/lg:` — sweep remaining `min-w-[200px]` (line 2953), `min-h-[580px]` (2521), and `sm:col-span-*` forms to stack below `sm`. |
| **Production** (`ImageProductionWorkspace` + `production/*`) | Tab strip scrolls; `ProcessStrip` segments stack (`grid grid-cols-1 sm:grid-cols-4`) instead of 4-across on phones; `ProvidersPanel`/`DatasetsPanel` grids get `grid-cols-1` fallback. |
| **Processing** (`ProcessingCenterWorkspace` + `processing/*`) | `JobBoardPanel`, `HandoffPanel`, `JobDetailsDrawer` — drawer becomes `inset-0 max-w-none` edge panel on mobile; `CapacityPanel` chart grid stacks. |
| **Lineage** (`LineageWorkspace` + `lineage/*`) | `GraphPanel` canvas fills `w-full`, min-height responsive; `TracePanel`/`SurveyPanel`/`RegistryPanel` tables → `ResponsiveTable`. |
| **Storage / NAS** (`NASStorageWorkspace` + `storage/*`) | `BrowserPanel` grid becomes single column; `OverviewPanel` charts `w-full`; `RawRegistryPanel`/`Validation` tables scroll. |
| **Analytics** (`AnalyticsWorkspace` + `analytics/*`) | Donut/summary panels (`OverviewPanel`, `DistancePanel`, `CoveragePanel`, `DensityPanel`, `QualityPanel`) → all recharts get `w-full h-48 sm:h-56`, grid wraps to 1-col. |
| **Reports** (`ReportsWorkspace`) | Report card grid → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`; PDF preview iframe height responsive. |
| **Administration** (`AdministrationWorkspace`) | User table scroll; `min-w-[200px]` filters (457/929) released; role/audit/health grids 1-col base. |
| **Road Analysis** (`RoadAnalysisWorkspace` + `roadAnalysis/*`) | `RoadCatalogPanel` massive table → `ResponsiveTable`; `RoadAnalysisMap` height `min-h-[260px] sm:min-h-[380px]`; import panel forms stack. |

### E. Modal & Overlay Pass

| Modal | Fix |
| :--- | :--- |
| `DailyHandoverModal.tsx` (129) | Already `max-w-3xl max-h-[90vh] p-3 sm:p-6` — verify rows wrap below `sm` (mostly done). |
| `DefectsGalleryModal.tsx` (214-215) | `h-[94vh] sm:h-[88vh]` — decrease to `h-[100dvh] sm:h-auto sm:max-h-[88vh]` and ensure full-screen viewer is edge-to-edge with safe padding. |
| `QAQCRunnerModal.tsx` (61-62) | Already `max-w-3xl max-h-[92vh] sm:max-h-[85vh]` — run check on stat grid (`grid-cols-2 sm:grid-cols-4`), ok. |
| `QCAuditModal`, `DataSelectionListModal`, `RecycleBinModal`, `SubgridImagesListModal` | Standardize to `p-2 sm:p-4`, `max-w-[min(calc(100vw-1rem),<lg>) ]`; ensure list content scrolls. |
| `QAQCThresholdStudioModal`, `AboutPlatformModal`, `ThemeSelector` | Grids → 1-col base; `AboutPlatformModal` spec grid already `grid-cols-1 sm:grid-cols-2`. |
| `PhotoSphereViewerComponent` (full 360) | Add safe-area padding on phones, allow full-viewport portrait height (`h-[80dvh]`), controls remain touch-friendly. |
| `WebGISHUDViewerOverlay`, `SelectionMapOverlay`, `DeletionSelectionMap`, `DiagnosticsPanel`, `NotificationPopover` | Ensure any overlay panel `w-96`-style is capped to `calc(100vw-1rem)` and anchored inside viewport. |

---

## 3. Implementation Plan by File

| # | File | Change summary |
| :- | :--- | :--- |
| 1 | `src/App.tsx` | Add `isMobileNavOpen` state; add `Menu`/`X` header button (`lg:hidden`); render drawer wrapper around `WorkspaceSidebarNav`; gate rail with `hidden lg:flex`; make popovers `w-full max-w-[calc(100vw-1rem)] md:w-96`; header cluster wrap at `<sm`; `main` padding `p-2 sm:p-3`. |
| 2 | `src/components/WorkspaceSidebarNav.tsx` | Accept `mobile` variant (always expanded labels, close-on-click); otherwise untouched for `≥lg` rail. |
| 3 | `src/components/production/chrome.tsx` | `UnderlineTabStrip` sizing + edge fade; `Masthead` wrap; `ProcessStrip` responsive stack option. |
| 4 | `src/components/common/ResponsiveTable.tsx` (new) | Horizontal-scroll table surface. |
| 5 | `src/components/common/StackGrid.tsx` (new) | Responsive stat grid snippet. |
| 6 | `src/components/dashboard/DashboardBatchTable.tsx` | Wrap in `ResponsiveTable`; row truncation; `min-w-0`. |
| 7 | `src/components/dashboard/DashboardKpiSummary.tsx` | Confirm/tune `truncate` + touch targets only. |
| 8 | `src/components/OperationalActionCenter.tsx` | Stack/wrap actions under `md`, icon-only on tiny screens. |
| 9 | `src/components/DataManagementPage.tsx` | Map heights (2823/2866), ledgers → `ResponsiveTable`, filter stacking, `min-w` release. |
| 10 | `src/components/AdminSettingsView.tsx` | Replace hard heights (2521), `min-w` (2953), form stack under `sm`. |
| 11 | `src/components/ImageProductionWorkspace.tsx` | Grid fallbacks on inner panels. |
| 12 | `src/components/ProcessingCenterWorkspace.tsx` | Mobile drawer sizing for `JobDetailsDrawer`; panel grids stack. |
| 13 | `src/components/LineageWorkspace.tsx` | Graph canvas responsive height; tables → `ResponsiveTable`. |
| 14 | `src/components/NASStorageWorkspace.tsx` | Storage sub-tab grids 1-col base; charts `w-full`. |
| 15 | `src/components/AnalyticsWorkspace.tsx` | Panel padding `p-3 sm:p-5`; tab strip ok. |
| 16 | `src/components/production/analytics/*.tsx` | Recharts `w-full h-48 sm:h-56`; grid 1-col base. |
| 17 | `src/components/ReportsWorkspace.tsx` | Card grid + preview height responsive. |
| 18 | `src/components/AdministrationWorkspace.tsx` | Table scroll, `min-w` release, grid bases (1007). |
| 19 | `src/components/RoadAnalysisWorkspace.tsx` + `roadAnalysis/*` | `RoadCatalogPanel` → `ResponsiveTable`; map heights; importer forms stack. |
| 20 | `src/components/PhotoSphereViewerComponent.tsx` | Mobile portrait viewer + safe-area + touch controls. |
| 21 | Modal/overlay files listed in §2.E | Standardized padding/width/edge-to-edge `100dvh` full viewers. |
| 22 | `src/index.css` | Optional utilities: `@media (max-width: 639px)` body `overscroll-behavior`, `.safe-b { padding-bottom: env(safe-area-inset-bottom) }`. |

---

## 4. Verification & Testing

| Step | Command / Action | Acceptance Criteria |
| :--- | :--- | :--- |
| **Typecheck** | `npx tsc -b` | 0 errors. |
| **Unit Tests** | `npm test` | All existing suites pass (incl. `WorkspaceSidebarNav`, `chrome`, `DataManagementPage`). |
| **Lint** | `npm run lint` | Green (legacy warnings tolerated, no new errors). |
| **No Horizontal Overflow** | DevTools responsive mode at 320/375/414/768px on every workspace | `document.documentElement.scrollWidth === innerWidth`; no `overflow-x` scrollbar anywhere. |
| **Drawer Nav** | Phone viewport, click hamburger | Drawer slides in ≤300ms, dims backdrop, navigates + auto-closes; desktop rail identical at ≥1024px. |
| **Touch Targets** | Phone audit | All buttons ≥40px; no adjacent-icon mis-taps in header/nav. |
| **Modals** | Phone audit of all modals | Edge-to-edge whitespace ok, content scrolls, full-screen viewers fill viewport. |
| **Charts/Maps** | Phone audit of Analytics/Road  | Recharts/Leaflet render without clipping; map height ≥ 320px. |
| **Aesthetic Consistency** | Visual audit at 375px + 1440px | Dark GIS slate preserved on every device; zero generic SaaS cards; desktop identical. |

---

## 5. Non-Goals & Constraints

- **No layout redesign**: this is a fit-and-reflow pass, not a new UX paradigm; the elapsed desktop information density is preserved.
- **No new dependencies**: pure Tailwind utilities + existing components; no additional responsive libraries.
- **No behavior changes**: routing, auth guards, RBAC, QA/QC worker logic, and PDF generation stay untouched.
- **Preserve theming**: all CSS tokens (`var(--bg-card)` etc.) and `.light-mode` overrides remain intact; safe-area utilities are additive.