# Implementation Plan v4 — Organizational Reorganization (Preservation-First)

## ✅ v4 STATUS — COMPLETE (ended by owner)

The v4 effort is **closed**.

| Phase | Status |
|---|---|
| P1 — De-monolith | ✅ **Implemented** (P1.1 report PDF gen, P1.3 authz guard metadata, P1.4 DashboardWorkspace extraction; P1 spike i18n). P1.2 deferred. |
| P2 — Nav & IA reorganization | 🔲 **Deferred / not implemented** (only a Production-group content re-order was applied: `production → processing → lineage → storage`). |
| P3 — Organizational surfaces | 🔲 **Deferred / not implemented** (nearly all planned features already exist with real data; no duplication). |
| P4 — Spatial synchronization + ingestion visibility | 🔲 **Not pursued** (v4 ended). |
| P5 — Performance, accessibility & final regression | 🔲 **Not pursued** (v4 ended; gates still verified per-phase). |

Net deliverable: **P1 frontend de-monolith** shipped + P2 re-order. No visual redesign; dashboard
untouched; all four gates validated green (`tsc`, `build`, `vitest`, `lint 0 errors`).

---

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

### P1.0 Spike (FIRST unit of work) ✅ Done
- Extracted `TRANSLATIONS` (~1,186 lines in `App.tsx`) into `src/lib/i18n.ts` as
  `export const TRANSLATIONS` + an exported `translate(language, key)` helper. This is a
  **pure relocate** — dictionary bytes are identical to the source block, and `t` uses the
  exact same key-resolution logic (`TRANSLATIONS[lang]?.[key] || TRANSLATIONS['en'][key] || key`).
- **How it was wired (not a provider):** `App.tsx` now imports `translate` and keeps a
  one-line binding `const t = (key) => translate(projectSettings?.language, key)` at the
  same position it already occupied — a minimal, behavior-identical move. A full
  `AppI18nProvider` / `useI18n` hook can be layered later only if a component needs `t`
  outside `App()`; not required for the pure move.
- App.tsx shrank 6,436 → 5,248 lines. `const TRANSLATIONS` fully removed; `t` validated in
  component scope immediately before the render `return`.
- **Verification passed:** `tsc -b` (0), `vitest` (161/161), `build` (0), `lint` (0 errors;
  685 pre-existing warnings, none introduced).
- **Visual-diff gate:** a pixel screenshot baseline needs a live WebGIS iframe + 360 render
  harness (environment-coupled). Strongest feasible automated assurance was used: byte
  identity of the dictionary + identical `t` resolution + all four gates green. A full
  screenshot baseline (Playwright/render harness) remains an optional deferred addition;
  a manual screenshot review of the dashboard is recommended before release, per gate §5.

### P1.1 Extract PDF generator ✅ Done
- `generateExecutivePdfReport` (~600 lines in `App.tsx`) moved into
  `src/components/reports/reportPdf.ts` as a **pure builder** `buildExecutivePdfHtml(input)`
  that returns the HTML string. App.tsx holds a ~16-line thin wrapper that assembles the
  typed input from component state (`batches` = `activeBatchLogs`, `auditLogs`,
  `qaSubgridRecords`, `projectSettings`, `operatorUser`) and does `window.open`/`write`.
- Not a literal "pure move" because the function closed over 5 component-scope values; per
  decision, it became a pure function with an explicit input object. HTML output is
  byte-identical (template line-wise identical to original: 585/585 lines).
- App.tsx 5,248 → 4,646 lines. Added `src/components/reports/__tests__/reportPdf.test.ts`
  (3 tests) proving deterministic rendering (aggregates, contract ref, operator, badges).
- Verification: `tsc -b` (0), `vitest` (20 files / 164 pass), `build` (0), `lint` (0 errors;
  685 warnings, back to baseline — the one `any` was removed via a typed `ProjectSettingsLike`).

### P1.2 Extract iframe/messaging bridge 🔲 Deferred (not a pure move)
- **Deferred by decision.** The messaging surface is NOT a contained block: the central
  `handlePanoramaMessage` handler (App.tsx:1495–1586) reads/writes dozens of `App()` values,
  50+ `postMessage` calls are inline in the render JSX, and 7 iframe components each already
  manage their own per-component messaging (`MapComponent`, `WebGISViewerIframe`,
  `DeletionSelectionMap`, `SelectionMapOverlay`, `AdminSettingsView`, `DataManagementPage`,
  `QAQCWorkbench`). A genuine shared `webgisBridge` would mean refactoring all of them —
  a large, behavior-sensitive change violating the Strict Preservation Rule for marginal P1
  value.
- **Revisit later:** P4 (spatial sync) is the natural place to introduce a typed
  `postToWebGIS()` / `onWebGISMessage()` bridge where a shared bridge has concrete value.

### P1.3 Registry-driven routing ✅ Done (narrow scope)
- **Scope decision (user-chosen: "Narrow"):** investigation showed 9/10 workspaces
  (`data settings production storage processing lineage analytics reports administration`)
  ALREADY route to real lazy-loaded components (`React.lazy` at App.tsx:52–61, wrapped in
  `React.Suspense` at 2347). Only `dashboard` is still a ~1,500-line inline JSX block
  (handled by P1.4).
- Because those 9 components take **heterogeneous props** wired from `App()` state, a
  unified `component: LazyExoticComponent` registry column (and the ~30-line
  `<WorkspaceRenderer/>`) would require shoving divergent prop wiring into one shared
  interface — a signature-level refactor the Strict Preservation Rule cautions against, for
  no visual/behavioral gain. So the renderer refactor was **deferred** (not needed for P1's
  de-monolith goal; routing already registry-routed in spirit).
- **Implemented (pure data, zero render change):** added `guard?: AuthzCapability[]` to each
  `WorkspaceDefinition` + a `getWorkspaceGuards(key)` selector in `src/workspaces.tsx`,
  aligned with the existing capability model in `src/lib/authz.ts` (`settings → manageSettings`;
  `administration → manageUsers, approveDeletions`; the rest unrestricted/viewAll). Explicitly
  **metadata only** — enforcement is wired in P2; setting it has no effect on current
  rendering, so visuals are untouched.
- All 10 hash paths stay identical — **no routing change**.
- Gates: tsc 0 / build 0 / vitest 20 files 164 pass / lint 0 errors (685 baseline warnings).
- P1.3 note: `WorkspaceSidebarNav` (which consumes `WorkspaceDefinition`) is unaffected — the
  `guard` field is optional/backward compatible. P2 can now gate nav visibility from the
  same registry.

### P1.4 Relocate inline dashboard JSX
- Move the inline dashboard JSX out of `App.tsx` into `src/components/operations/*`
  **as-is** (byte-for-byte, same classes/layout) so `App.tsx` shrinks; rendered dashboard
  is visually identical.
- **Implemented (✅):** full single-component move. The ~1,500-line dashboard block
  (previously `App.tsx` lines 2349–3885) now lives verbatim in
  `src/components/operations/DashboardWorkspace.tsx` (1,750 lines) as one component that
  receives ~80 `App()`-scope identifiers (state values, setters, refs, handlers) as a typed
  props bag. `App.tsx` shrank 4,646 → **3,110 lines**. **Legacy `useState` kept in `App`**
  (strategy chosen via question, "Full single-component move") so state persists across
  workspace switches — no behavior change. Render/JSX is byte-identical (same classes/layout),
  honoring the Strict Design Preservation Rule.
- Cleanup: removed now-unused imports from `App.tsx` (icons Activity/Camera/Navigation/Edit2/
  FileText/Database/ShieldCheck/Maximize2/Filter/ExternalLink/Play/StopCircle; helpers
  updateDefectStatusInSupabase/formatPIC/saveProcessingJobToSupabase; `Skeleton`;
  `OperationalActionCenter` lazy; `WebGISHUDViewerOverlay`; `PhotoSphereViewerComponent` value
  → kept type `PhotoSphereViewerHandle`). Added `allKnownDefects: any[]` prop (App-scope
  `useMemo<[any]>`).
- **Honest note:** the moved block's pre-existing eslint warnings (`no-explicit-any`,
  `react-hooks/exhaustive-deps`) carried over verbatim; total warnings 685 → 689 (+4, from the
  added `allKnownDefects: any[]` prop and destructure-line shifts). All are cosmetic; the hard
  gate (0 errors) holds.
- **Gates: tsc 0 / build 0 / vitest 20 files 164 pass / lint 0 errors (689 warnings).**

**Honest notes:** `supabase.ts` (2,825) and `DataManagementPage.tsx` (5,234) are **not**
split in P1 (touch-only). `useAppData` remains the shared hook; state-slice split deferred.

**Visual-diff gate:** (to be confirmed) automated screenshot baseline (e.g. a
Playwright/`@vitest/browser` capture of the dashboard + a couple of workspaces) compared
before/after each P1 move; if preferred, fall back to manual screenshots reviewed by the
owner. Default recommendation: automated baseline.

**Acceptance:** `App.tsx` < ~1200 lines; routing registry-driven; dashboard screenshot
diff = empty; all four gates green.

---

## ~~P2 — Navigation & IA reorganization (existing nav components only)~~ 🔲 **Deferred / not implemented**

**Goal (planned, NOT done):** re-group the existing 10 workspaces into the target IA
(`Operations / Projects / Processing / QA/QC / Data / Reports / System / Administration`)
using the **existing `WorkspaceSidebarNav` + `workspaces.tsx`** — no new styling, palette,
or decorative elements.

> **Status: 🔲 Deferred.** Decision per owner: the current navigation already works and every
> function is reachable, so no IA/dedicated-workspace remap is wanted. Only a **content
> re-order** was applied instead:
> - `WORKSPACE_CATEGORIES` **production** group re-ordered in `src/workspaces.tsx` →
>   `['production', 'processing', 'lineage', 'storage']` (**Production Workspace → Processing
>   Center → Data Lineage → NAS/Raw Storage last**). No new categories/groups, no gating, no
>   new workspaces, no i18n changes.
> - The rest of P2 (8-group IA, global context strip, role-aware nav) is **struck from scope**
>   and will not be implemented.

1. ~~Re-map `WORKSPACE_CATEGORIES` in `src/workspaces.tsx` (existing grouping mechanism):~~
   ~~- **Operations** → `dashboard`, `data`~~
   ~~- **Projects** → `settings`~~
   ~~- **Processing** → `production`, `processing`, `storage`~~
   ~~- **QA/QC** → QA/QC surface (P3) + existing QAQC workbench~~
   ~~- **Data** → `data` (registry/detail reorg in P3)~~
   ~~- **Reports** → `reports`, `analytics`~~
   ~~- **System** → `storage`, diagnostics/health, audit~~
   ~~- **Administration** → `administration`, `settings` (users/roles/permissions)~~
2. ~~**Global context strip**: project/survey/active dataset/current user + role, read from~~
   ~~`useAppData` + `authz.ts`, rendered with **existing style tokens** — slim info row, no~~
   ~~new visual language.~~
3. ~~**Role-aware nav**: gate entries by `can(role, capability)` (UX-only; RLS authoritative).~~
   ~~Use `tag: 'planned'` + existing `WorkspacePlaceholder` for genuinely-future surfaces.~~
4. ~~**No visual components introduced** — only regrouping + gating.~~

**Acceptance (original, not being pursued):** nav reflects the 8-group IA reusing existing nav
styling; role items hide for viewers; all functionality still reachable; no new
colours/fonts/blocks/gradients.

---

## ~~P3 — Organizational surfaces (reuse existing components/styles, real data)~~ 🔲 **Deferred / not implemented**

**Goal (planned, NOT done):** reorganize existing workspaces into the blueprint's
organizational views — using existing components, theme, status chips; only real data;
dashboard untouched.

> **Status: 🔲 Deferred.** Decision per owner. Research found that **nearly all of P3's planned
> features already exist with real data** in the codebase: `DatasetRegistryPanel`
> (real `datasets`/`processing_jobs`, search, type filter, status chips, orphan alert,
> registration modal), `ProcessingCenterWorkspace` + `JobDetailsDrawer` (real job inspector,
> progress, timeline, lineage, retry/pause), `QAQCWorkbench` (full QA/QC runner over real
> frames/defects/audit), and `DiagnosticsPanel`/`AdministrationWorkspace` (real Supabase/storage/
> WebGIS health pings). Building new panels would **duplicate existing logic**, which the
> Strict Design Preservation Rule prohibits. So P3 is **struck from scope** and will not be
> implemented.
>
> Remaining possible P3 gaps (documented only, no build): a dedicated `DatasetDetail` tabbed
> workspace, a lighter filterable "QA/QC Review Queue + Issue Inspector" list, and **live**
> BFF worker telemetry (`/health`/`/api/jobs` — currently only on-demand pings via
> `testDatabaseHealth()`). These are noted as future candidates, not built.

### ~~3a. Data — Dataset Registry + Detail~~ (already exists; not rebuilt)
- ~~Upgrade `DatasetRegistryPanel` over real `datasets`~~ — already exists.
- ~~`DatasetDetail` workspace tabs~~ **not built** (would duplicate registry; deferred).
- ~~**Visible ingestion** guided workflow~~ **not built** (existing CSV staging remains; deferred).

### ~~3b. Processing — Control Center~~ (job inspector already exists)
- ~~Queue/Jobs table + Job Inspector (`JobDetailsDrawer`)~~ — already exists over real jobs.
- ~~Workers panel from live `/health` + `/api/jobs`~~ **not built** — live BFF worker telemetry
  deferred (currently on-demand health pings only, no simulated workers).

### ~~3c. QA/QC — Review workspace~~ (QAQCWorkbench already exists)
- ~~Review Queue + Issue Inspector~~ **not built** (would duplicate `QAQCWorkbench`; deferred).
- Role-gating (`runQaqc`/`reviewQaqc`) remains **not enforced** (P2 gating also deferred).

**~~Honest data fixes~~ (no build):** the `batch_logs` dangling setting ref,
`worker_heartbeat`/live-only worker lists, and the localStorage-merge caching for
`datasets`/`processing_jobs` are **documented only**, not changed.

**Acceptance (original, not being pursued):** all views show real data; no fake
metrics/workers; every component reuses existing styles/status chips; dashboard untouched.

---

## ~~P4 — Spatial synchronization + ingestion visibility~~ 🔲 **Not pursued (v4 ended)**

**Goal (planned, NOT done):** map↔frame↔360↔QA sync through the existing WebGIS **postMessage
bridge** (no new map), and make ingestion visibly explicit.

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

## ~~P5 — Performance, accessibility & final regression~~ 🔲 **Not pursued (v4 ended)**

**Acceptance (lines 1-4, not pursued):** green on all four gates; dashboard screenshot diff
= empty; no fake telemetry. Replaced by the per-phase gates actually run during P1.

---

## Relationship to v3 & honest scope

- **v4 = frontend architecture reorganization only.** v3's unshipped backend items remain
  a **separate tracked list**, not folded in: secret manager (v3 C1.2), Sentry on
  worker/BFF (v3 C3.3), `supabase db push` wiring (v3 C1.1), BFF pytest + `VITE_API_MODE=bff`
  flip (v3 A2.3).
- **Real-data gaps** surfaced during research; the planned fixes (P3) were **deferred/not
  built** (features already exist with real data). No gap is rendered as fact; anything not
  live is left untouched.
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
