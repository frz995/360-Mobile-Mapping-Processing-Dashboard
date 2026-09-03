# Implementation Plan v4 — Organizational Reorganization (Preservation-First)

Scope: frontend **architecture reorganization** of the GeoSphere 360 dashboard. The
blueprint in `docs/GeoSphere_360_Complete_Dashboard_Improvement_Plan.docx` describes an
enterprise IA. This v4 plan implements only the **organizational/structural** parts of
that blueprint, under a strict design-preservation rule: **no visual redesign, no new
theme/palette, no decorative UI, dashboard untouched.** v3 (backend production-readiness
— RLS/BFF/durable journal) is **largely done** and its remaining unshipped items are
tracked separately, NOT folded into v4.

---

## 0. Governing rules (all binding)

### Strict Design Preservation Rule
- Preserve the existing GeoSphere 360 **global theme, colours, typography, spacing,
  borders, buttons, icons, and component language**. No exceptions.
- **No** generic coloured text boxes, colourful fonts, decorative colour blocks, random
  gradients, or unrelated visual styles.
- New components **inherit existing styles and semantic/status colours** (existing
  Tailwind tokens: `bg-card`, `border-subtle`, `bg-inner`, `text-sky-400`, existing
  status chips, etc.).
- Preserve all working logic: **Supabase/PostGIS, Leaflet/Esri layers, 360 viewer, QA/QC
  logic, exports — do not change.**
- **Do not rebuild the Main Dashboard from scratch** → current inline dashboard stays
  visually untouched.
- Do not replace the global theme, introduce a new palette, add decorative UI, duplicate
  existing logic, create fake processing metrics/simulated worker states, or move heavy
  processing into the browser.

### Functional rules
- No fake telemetry — every displayed value traces to a real source (Supabase table/view,
  live worker HTTP via BFF, storage listing) or is marked **"future capability"** (via
  existing `WorkspacePlaceholder` / `tag: 'planned'`). Never rendered as fact.
- No feature removal — reorganize, don't delete delivered functionality.
- Buildable + green after every phase: `npx tsc -b`, `npm run build`, `npm run test`,
  `npm run lint`.
- No full rewrite in one step — de-monolith incrementally; move code only when touching it.
- Role-aware UI mirroring `src/lib/authz.ts`; DB RLS stays authoritative (`sec.can()`).

### Locked scope decisions
- **Dashboard**: keep the current inline dashboard visually untouched.
- **Nav**: re-group existing workspaces using existing `WorkspaceSidebarNav` +
  `workspaces.tsx` styles only. No new visuals.
- **New surfaces** (Data Registry/Detail, Processing Center, QA/QC Review): *organizational
  views* reusing existing components/styles + real data.
- **Map/360**: keep the iframe bridge; improve postMessage sync; no reimplementation.
- **v4 = frontend architecture only**; v3's unshipped backend items stay a separate list.
- **Real-data gaps**: surface honestly; fix only cheap ones.
- **First unit of work = a P1 spike** with an automated visual-diff gate to prove
  "dashboard renders identically."

---

## 1. Current baseline (facts driving the plan)

- **No React Router.** Custom hash switcher (`src/utils/hashRouter.ts`, `WorkspaceKey`);
  ~1,700-line ternary in `App.tsx:4138–5813`. Workspaces declared in
  `src/workspaces.tsx`; nav in `src/components/WorkspaceSidebarNav.tsx` (10 workspaces in
  4 categories: core / production / insights / governance).
- **Monolith**: `App.tsx` = 6,436 lines (state via `useAppData` + iframe messaging +
  ~1,400-line translation dict + embedded PDF generator + inline dashboard JSX + modals).
- **Already-extracted lazy workspaces**: `production`, `storage`, `processing`, `lineage`,
  `analytics`, `reports`, `administration`. `settings` (`AdminSettingsView`), `data`
  (`DataManagementPage`), `dashboard` remain the heavy/legacy ones.
- **Real data layer**: `datasets`, `processing_jobs`, `qa_defects`, `qaqc_audit_runs`,
  `audit_logs`, `notifications`, `subgrids`, `deletion_requests`, `user_accounts`,
  `staging_panoramas`, `project_settings`, `file_inventory`, `survey_recycle_bin`; views
  `panoramas_subgrid_summary`, `panoramas_view`. `datasets`/`processing_jobs` have clean
  schemas incl. `source_dataset_id`/`output_dataset_id` links + `status`/`progress`/
  `error_count`/`settings`.
- **Map/360 are iframe-bridged** to external WebGIS (`VITE_MAP_URL`) via `postMessage`.
- **Real-data gaps**: no `workers`/`worker_heartbeat` DB table (worker presence = live
  HTTP only); dangling `batch_logs` setting ref; localStorage-merge caching for
  `datasets`/`processing_jobs`.

---

## 2. Phase map

| Phase | Scope | Primary outcome | Visual risk |
|---|---|---|---|
| **P1** De-monolith groundwork | Extract translations, PDF generator, iframe bridge; registry-driven routing; relocate dashboard JSX; shrink `App.tsx` | `App.tsx` < ~1200 lines; routes registry-driven | **None** (pure moves; visual-diff gate) |
| **P2** Nav & IA reorganization | Re-group workspaces into target IA using existing nav components; context strip reusing existing styles | New navigation without new visuals | None |
| **P3** Organizational surfaces | Data Registry/Detail, Processing Center, QA/QC Review on real data | Reorganized workspaces (dashboard untouched) | None (reuse) |
| **P4** Spatial + ingestion | Map↔frame↔360↔QA sync via bridge; visible ingest workflow | Unified spatial + visible ingest | None |
| **P5** Performance & regression | Virtualization, lazy-load, reduced subs, accessibility; final regression sweep | Production readiness | None |

The blueprint's heavier "redesign" phases were flattened into structure-only phases here
because visual redesign work is explicitly out of scope.

---

## P1 — De-monolith groundwork (do first; pure structural, zero visual change)

**Goal:** shrink `App.tsx` and give workspaces real routing resolution — no behavior or
visual change. Verified by an **automated screenshot diff** of the dashboard + key
workspaces (before/after = identical), plus the four gates.

### P1.0 Spike (FIRST unit of work)
1. Extract `TRANSLATIONS` (~1,400 lines in `App.tsx`) into `src/lib/i18n.ts` with an
   `AppI18nProvider` / `useI18n` hook. Pure relocate; identical keys/values.
2. Establish the **visual-diff baseline** (see "Visual-diff gate" below) BEFORE the move,
   then re-run it AFTER. If any pixel differs, revert immediately and adjust.
3. Verify: `tsc -b`, `vitest`, `build`, `lint`.

### P1.1 Extract PDF generator
- Move `generateExecutivePdfReport` (~600 lines in `App.tsx`) into
  `src/components/reports/reportPdf.ts`. Pure move.

### P1.2 Extract iframe/messaging bridge
- Move the central `window.addEventListener('message')` block + broadcast helpers
  (`App.tsx:2095–2537`) into `src/services/webgisBridge.ts` with typed
  `postToWebGIS()` + `onWebGISMessage()`. Basis for P4. Pure move.

### P1.3 Registry-driven routing
- Extend `src/workspaces.tsx`: each `WorkspaceDefinition` carries a lazy `component` +
  `guard` (role) + optional tab/route config.
- Replace the 1,700-line ternary with a ~30-line `<WorkspaceRenderer/>` mapping
  `currentPage → component`.
- All 10 hash paths (`dashboard data settings production storage processing lineage
  analytics reports administration`) stay identical — **no routing change**.

### P1.4 Relocate inline dashboard JSX
- Move the inline dashboard JSX out of `App.tsx` into `src/components/operations/*`
  **as-is** (byte-for-byte, same classes/layout) so `App.tsx` shrinks; rendered dashboard
  is visually identical.

**Honest notes:** `supabase.ts` (2,825) and `DataManagementPage.tsx` (5,234) are **not**
split in P1 (touch-only). `useAppData` remains the shared hook; state-slice split deferred.

**Visual-diff gate:** (to be confirmed) automated screenshot baseline (e.g. a
Playwright/`@vitest/browser` capture of the dashboard + a couple of workspaces) compared
before/after each P1 move; if preferred, fall back to manual screenshots reviewed by the
owner. Default recommendation: automated baseline.

**Acceptance:** `App.tsx` < ~1200 lines; routing registry-driven; dashboard screenshot
diff = empty; all four gates green.

---

## P2 — Navigation & IA reorganization (existing nav components only)

**Goal:** re-group the existing 10 workspaces into the target IA
(`Operations / Projects / Processing / QA/QC / Data / Reports / System / Administration`)
using the **existing `WorkspaceSidebarNav` + `workspaces.tsx`** — no new styling, palette,
or decorative elements.

1. Re-map `WORKSPACE_CATEGORIES` in `src/workspaces.tsx` (existing grouping mechanism):
   - **Operations** → `dashboard`, `data`
   - **Projects** → `settings`
   - **Processing** → `production`, `processing`, `storage`
   - **QA/QC** → QA/QC surface (P3) + existing QAQC workbench
   - **Data** → `data` (registry/detail reorg in P3)
   - **Reports** → `reports`, `analytics`
   - **System** → `storage`, diagnostics/health, audit
   - **Administration** → `administration`, `settings` (users/roles/permissions)
2. **Global context strip**: project/survey/active dataset/current user + role, read from
   `useAppData` + `authz.ts`, rendered with **existing style tokens** — slim info row, no
   new visual language.
3. **Role-aware nav**: gate entries by `can(role, capability)` (UX-only; RLS authoritative).
   Use `tag: 'planned'` + existing `WorkspacePlaceholder` for genuinely-future surfaces.
4. **No visual components introduced** — only regrouping + gating.

**Acceptance:** nav reflects the 8-group IA reusing existing nav styling; role items hide
for viewers; all functionality still reachable; no new colours/fonts/blocks/gradients.

---

## P3 — Organizational surfaces (reuse existing components/styles, real data)

**Goal:** reorganize existing workspaces into the blueprint's organizational views — using
existing components, theme, status chips; only real data; dashboard untouched.

### 3a. Data — Dataset Registry + Detail
- Upgrade `DatasetRegistryPanel` over real `datasets`: search by
  id/project/survey/subgrid/date/status; column visibility; saved filters; **existing**
  status chips mapped to real `datasets.status` (REGISTERED/READY/IN_PROGRESS/COMPLETED/
  FAILED/IMPORTED/ARCHIVED); last-updated + source indicator.
- `DatasetDetail` workspace tabs **Overview | Assets | Processing | QA/QC | Map | Outputs |
  Activity**, bound to real fields (`datasets` + linked `processing_jobs` via
  `source_dataset_id`/`output_dataset_id` + `file_inventory` counts + `qa_defects`/
  `qaqc_audit_runs` + `audit_logs`). Download shown only when artifacts actually exist.
- **Visible ingestion**: promote existing CSV staging → validate → review → publish into an
  explicit guided workflow (Import → Staged → Validate → Review → Publish → Available)
  wired to existing `staging_panoramas`/`panoramas` functions. Explicit publish only;
  validation errors surfaced with counts + specifics.

### 3b. Processing — Control Center
- Queue/Jobs table + Job Inspector (`JobDetailsDrawer`, existing) bound to real
  `processing_jobs` (status/progress/error_count) + live worker telemetry via the v3 BFF
  (`worker/bff` routes). Real progress/worker/ETA only; blank where not reliable.
  Retry/cancel via real BFF endpoints.
- Workers panel from live `/health` + `/api/jobs` only (no simulated workers).

### 3c. QA/QC — Review workspace
- Review Queue + Issue Inspector over `qa_defects`/`qaqc_audit_runs`: filter by
  dataset/severity/defect/reviewer/status; issue → frame → map → 360 evidence path (existing
  `PhotoSphereViewerComponent` + bridge); assign/resolve/reject →
  `resolveQADefectInSupabase` + audit log. Surface existing QAQC workbench here;
  role-gated (`runQaqc`/`reviewQaqc`).

**Honest data fixes (cheap only):** resolve/clarify dangling `batch_logs` setting ref;
either add a minimal `worker_heartbeat` table (if cheap + desired) **or** document worker
lists as live-only; document the localStorage-merge caching for `datasets`/`processing_jobs`.

**Acceptance:** all views show real data; no fake metrics/workers; every component reuses
existing styles/status chips; dashboard untouched.

---

## P4 — Spatial synchronization + ingestion visibility

**Goal:** map↔frame↔360↔QA sync through the existing WebGIS **postMessage bridge** (no new
map), and make ingestion visibly explicit.

1. Centralize all `postMessage` handling in `webgisBridge` (from P1).
2. Frame on map → open correct panorama (`SET_PANORAMA`); QA issue → center map + open
   evidence; 360 selection → highlight trajectory.
3. Use existing viewport/BBOX filtering to keep large datasets usable (no rendering
   hundreds of thousands of DOM frames in this dashboard).
4. Ingestion (from P3a) surfaced as Import → Staged → Validate → Review → Publish →
   Available.

**Acceptance:** selections stay in sync; no duplicate viewer; large datasets usable; no
heavy processing in browser.

---

## P5 — Performance, accessibility & final regression

1. **Performance**: lazy-load routes/360 viewer (already partly done), virtualize large
   tables, minimize Supabase subscriptions to relevant job/QA records, avoid map reinit.
2. **Accessibility**: keyboard nav for tables/filters/tabs/dialogs, focus states, semantic
   headings, readable status labels, reduced-motion, responsive tablet/mobile.
3. **Final regression**: after every phase run build + verify all routes, Supabase
   reads/writes, map, 360, QA/QC, exports, permissions, responsive layout, no feature
   removed, no visual regression. Screenshot diff on dashboard = empty.

**Acceptance:** green on all four gates; dashboard screenshot diff = empty; no fake
telemetry.

---

## Relationship to v3 & honest scope

- **v4 = frontend architecture reorganization only.** v3's unshipped backend items remain
  a **separate tracked list**, not folded in: secret manager (v3 C1.2), Sentry on
  worker/BFF (v3 C3.3), `supabase db push` wiring (v3 C1.1), BFF pytest + `VITE_API_MODE=bff`
  flip (v3 A2.3).
- **Real-data gaps** surfaced; only cheap ones fixed (P3). Every other gap = marked
  "future capability" via `WorkspacePlaceholder`, never rendered as fact.
- **Explicitly NOT doing** (preservation rule + blueprint §24): any visual redesign,
  KPI-card reduction, theme/palette change, decorative UI, dashboard rebuild, duplicate
  engines/logic, client-side heavy processing, or fake metrics.

---

## Per-phase verification checklist (run every phase)
1. `npx tsc -b`
2. `npm run build`
3. `npm run test` / `npx vitest run`
4. `npm run lint`
5. Dashboard + key-workspace **screenshot diff** = empty (preservation gate)

No commits unless explicitly requested.
