# GeoSphere 360 Processing Dashboard — Enterprise Audit & Upgrade Plan

## Executive Summary

After a deep end-to-end codebase review covering **App.tsx (12,583 lines)**, **supabase.ts (2,824 lines)**, **QAQCWorkbench.tsx (2,897 lines)**, **AdminSettingsView.tsx (2,691 lines)**, the QAQC engine, GPU analyzer, production API, 26+ components, 3 hooks, 15+ utilities, 2 type files, and the companion WebGIS viewer — this dashboard is **impressive in architectural depth** but carries several **critical production blockers** and many **enterprise-grade improvement opportunities**.

> [!CAUTION]
> **NOT production-ready** in its current state. Multiple critical issues must be resolved before real deployment. The technical foundation is excellent — the gaps are fixable with focused work.

---

## ~~Section 1 — CRITICAL Security Issues (Must Fix Before Production)~~ ✅ COMPLETE

### ~~🔴 C1 — Supabase Anon Key Hardcoded in Source Code~~

~~**File**: [`supabase.ts` L9–L10](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/src/services/supabase.ts#L9-L10)~~

~~Hardcoded URL and anon key string literals removed from `createSafeSupabaseClient()`. Now resolves from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env vars only. Dev-time `console.error` added when vars are missing.~~

~~**Fixed** ✅~~

---

### ~~🔴 C2 — postMessage Wildcard Target Origin (`'*'`)~~

~~**File**: [`App.tsx`](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/src/App.tsx) · MapComponent message handler~~

~~Origin guard added to `window.addEventListener('message', handler)`. Only accepts messages from `VITE_MAP_URL` or `window.location.origin`. Permissive when `VITE_MAP_URL` is unset.~~

~~**Fixed** ✅~~

---

### ~~🔴 C3 — `console.log` Debug Statements Removed~~

~~**Files**: [`App.tsx`](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/src/App.tsx), [`supabase.ts`](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/src/services/supabase.ts)~~

~~Removed 3 debug `console.log` statements that were dumping internal data structures, subgrid keys, storage counts, and point breakdowns to the browser console.~~

~~**Fixed** ✅~~

---

### ~~🔴 C4 — Dead Code Removed & Fetch Timeout Added~~

~~**File**: [`productionApi.ts`](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/src/services/productionApi.ts)~~

~~`mockSimulatorRegistry` dead export removed. `AbortSignal.timeout(10_000)` added to all NAS Worker `fetch()` calls — requests now abort after 10 s instead of hanging indefinitely.~~

~~**Fixed** ✅~~

---

### ~~🔴 C5 — Application Table RLS Policies Written~~

~~**File (new)**: [`supabase_rls_application_tables.sql`](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/supabase_rls_application_tables.sql)~~

~~All 13 application tables covered. Open `USING (true)` policies replaced with `auth.uid() IS NOT NULL` guards on all write operations. Public SELECT kept on `panoramas`, `subgrids`, `qa_defects` for WebGIS viewer. Run in Supabase SQL Editor to apply.~~

~~**Script ready** ✅~~

---

## Section 2 — Architecture & Code Quality Issues

### ~~🟠 A1 — App.tsx is a God File (12,583 Lines, 651KB)~~

**File**: [`App.tsx`](file:///d:/Webmap/360 web mapping/processing Dashboard/src/App.tsx)

This is the single most critical structural issue. The main component contains:
- All application state (~80+ useState hooks, ~30 useRef hooks)
- Multiple full page components inlined (`DataManagementPage`, `QCAuditModal`, `CatalogItem`, `MapComponent`, etc.)
- All business logic helpers (~25 exported utility functions)
- All auth handling, Supabase data-fetching effects, notification system
- The entire workspace router

This makes the file **unmaintainable**, causes excessive re-renders from massive shared state, and makes it impossible to write unit tests. It's already 651KB of source.

**Fix (phased)**: Extract `DataManagementPage`, `QCAuditModal`, `MapComponent` into their own files. Move all utility functions to `utils/`. Move all Supabase fetch logic into custom hooks (`useAppData`, `useAuth`, `useNotifications`). Use `React.lazy()` for workspaces.

---

### ~~🟠 A2 — Haversine / Geodesic Distance Calculation Duplicated 4× Times~~

~~Same function body appears in:~~
- ~~[`qaqcAnalyzer.ts` L78](file:///d:/Webmap/360 web mapping/processing Dashboard/src/utils/qaqcAnalyzer.ts#L78)~~
- ~~[`useQAQCWorker.ts` L111](file:///d:/Webmap/360 web mapping/processing Dashboard/src/hooks/useQAQCWorker.ts#L111)~~
- ~~[`supabase.ts` L103](file:///d:/Webmap/360 web mapping/processing Dashboard/src/services/supabase.ts#L103)~~
- ~~[`App.tsx` L534](file:///d:/Webmap/360 web mapping/processing Dashboard/src/App.tsx#L534)~~

~~**Fix**: Single `src/utils/geo.ts` module. Export one `calculateGeodesicDistanceMeters()`.~~

~~**Fixed** ✅ (created `src/utils/geo.ts` with `calculateGeodesicDistanceMeters`, `calculateForwardBearing`, `calculatePathDistanceKm`; all 4 files now import from it)~~

---

### ~~🟠 A3 — `extractSubgridName` Defined Twice With Different Logic~~

[`App.tsx` L259](file:///d:/Webmap/360 web mapping/processing Dashboard/src/App.tsx#L259) and [`supabase.ts` L66](file:///d:/Webmap/360 web mapping/processing Dashboard/src/services/supabase.ts#L66) both export a function by the same name with subtly different regex behavior. This causes inconsistencies in subgrid key normalization downstream.

---

### 🟠 A4 — Storage Enumeration Waterfall (Up to 10,000 Files)

**File**: [`supabase.ts` L200–L235](file:///d:/Webmap/360 web mapping/processing Dashboard/src/services/supabase.ts#L200-L235)

On every `fetchSupabaseData()` call, the code loops through **8 candidate bucket locations** (original + lowercase + uppercase + fallbacks), paginating up to 10,000 files each, sequentially. This is called at startup and on every manual refresh.

```typescript
while (hasMore && totalFetched < 10000) {
  const { data: storageFiles } = await supabase.storage.from(loc.bucket).list(...)
```

For 5,000 images this is 50+ Supabase API requests just to build a filename Set. On production scale (50k+ images), this will time out.

**Fix**: Store `file_count` and verified image list server-side in a Postgres table updated via webhook/trigger when images are uploaded. Query the table, not the bucket list.

---

### 🟠 A5 — `sendStagedData` Called With 3 Cascading Timeouts

**File**: [`App.tsx` L1200–1208](file:///d:/Webmap/360 web mapping/processing Dashboard/src/App.tsx#L1200-L1208)

```typescript
const t1 = setTimeout(() => { syncMapSettings(); sendStagedData(); }, 400);
const t2 = setTimeout(() => { syncMapSettings(); sendStagedData(); }, 1200);
const t3 = setTimeout(() => { syncMapSettings(); sendStagedData(); }, 2500);
```

This is a timing hack to work around iframe load races. It causes 6 redundant `postMessage` calls per navigation and makes the app harder to reason about.

**Fix**: The iframe should signal readiness via `MAP_READY` / `WEBGIS_READY` postMessage (already handled at L1173). Listen for that event exclusively instead of timeout-firing redundant syncs.

---

### 🟠 A6 — QAQC Loop Runs on Main Thread

**File**: [`useQAQCWorker.ts` L419–L706](file:///d:/Webmap/360 web mapping/processing Dashboard/src/hooks/useQAQCWorker.ts#L419-L706)

The entire QAQC inspection loop — including canvas pixel analysis, Laplacian convolution, GPS validation, and Supabase upserts — runs inside an `async` function called from the main React render thread. For a 3000-frame subgrid, this blocks UI updates and prevents the browser from garbage collecting canvas elements.

The hook is called `useQAQCWorker` implying a Web Worker, but there is no actual `Worker` — it's just a loop with `await new Promise(r => setTimeout(r, stepIntervalMs))` pacing.

**Fix**: Move the analysis loop into a real Web Worker (`qaqc.worker.ts`). The React hook becomes a thin bridge that posts tasks to the worker and receives result messages. This unblocks the UI completely and allows true parallel analysis.

---

### 🟡 A7 — `any` Type Used Extensively

The type `any` appears dozens of times: `authSession?: any`, `projectSettings?: any`, `batchLogs?: any[]`, `dailyData?: any[]` in nearly every component prop signature. This defeats TypeScript's value and hides real data contract issues.

**Fix**: Replace all `any`-typed props with the correct typed interfaces that already exist in `types/admin.ts` and `types/production.ts`.

---

### 🟡 A8 — `console.log` Debug Statements in Production Code

**File**: [`App.tsx` L1002–1011](file:///d:/Webmap/360 web mapping/processing Dashboard/src/App.tsx#L1002-L1011)

```typescript
console.log('[sendStagedData debug breakdown]', { ... })
```

Also in `supabase.ts` L237:
```typescript
console.log('Verified Supabase storage file count:', storageFileSet.size, ...)
```

These dump sensitive filenames, storage counts, and data structures to any browser console. Must be removed before production.

---

## Section 3 — Backend & API Assessment

### Production API Layer

**File**: [`productionApi.ts`](file:///d:/Webmap/360 web mapping/processing Dashboard/src/services/productionApi.ts)

The API client design is clean and correctly abstracted behind a `ProductionApiClient` interface. The HTTP client handles errors gracefully.

**Issues**:
- No request timeout (fetch hangs indefinitely if NAS worker is unavailable)
- No authentication header for the NAS GPU Worker — the `/api/jobs` endpoint is completely open
- `mockSimulatorRegistry` is exported and populated nowhere — dead code
- No retry logic with exponential backoff for transient failures

### Supabase Service Layer

**File**: [`supabase.ts`](file:///d:/Webmap/360 web mapping/processing Dashboard/src/services/supabase.ts) (2,824 lines — also too large)

The service has evolved into a monolith containing all DB queries, URL resolvers, export helpers, and data transformation logic. This makes it hard to test or reason about query behavior.

**Issues**:
- All queries use `select('*')` — no column projections. This over-fetches data.
- No query result caching — every workspace navigation re-fetches all panoramas
- No Supabase Realtime subscriptions for production jobs (job status polling would require manual refreshes)
- `qaqcRunsTable` falls back to `'qaqc_audit_runs'` in multiple places — table name should be a single configurable constant, not a runtime decision

---

## Section 4 — Panel Content Assessment (Per Workspace)

| Workspace | Status | Issues |
|-----------|--------|--------|
| **Dashboard** | ✅ Strong | Map iframe comms are solid; KPI cards excellent |
| **Data Management** | ⚠️ Functional | Bulk publish, delete, recycle bin work well; daily table filter is good |
| **QAQC Workbench** | ✅ Impressive | GPU-accelerated analysis is genuinely enterprise-level; threshold studio is unique |
| **Production Pipeline** | ⚠️ Partial | Pipeline stage derivation is correct; job board needs real-time websocket |
| **NAS Storage** | ⚠️ Thin | Browser and storage info depend entirely on NAS worker being online |
| **Processing Center** | ⚠️ Thin | Workstation config UI present; lacks real ping/heartbeat to workstations |
| **Lineage** | ⚠️ Thin | Good structure; graph needs actual rendering (not just text) |
| **Analytics** | 🔴 Stub | `AnalyticsWorkspace.tsx` is 6.7KB — charts exist but no real aggregation |
| **Reports** | ✅ Good | 5 report types with proper print-to-PDF HTML generation |
| **Administration** | ⚠️ Partial | User management functional; health metrics show hardcoded defaults |
| **Settings** | ✅ Good | Most comprehensive settings panel; theme system is excellent |

---

## Section 5 — What Should Be REMOVED or REPLACED

| Item | Location | Why |
|------|----------|-----|
| Hardcoded Supabase key fallback | `supabase.ts` L10 | Security P0 |
| `console.log` debug calls | `App.tsx`, `supabase.ts` | Production leak |
| `alert()` calls for clipboard copy | `App.tsx` ~L1360 | Replace with toast/snackbar |
| `mockSimulatorRegistry` export | `productionApi.ts` L147 | Dead/unused code |
| Triple-timeout `sendStagedData` | `App.tsx` L1200–1208 | Use event-driven approach |
| ~~Inline `DataManagementPage` in App.tsx~~ | ~~`App.tsx` ~L1720~~ | ~~Extract to own file~~ ✅ |
| ~~Inline `QCAuditModal` in App.tsx~~ | ~~`App.tsx` ~L1287~~ | ~~Extract to own file~~ ✅ |
| Storage bucket enumeration waterfall | `supabase.ts` L186–235 | O(n) startup cost |
| ~~Duplicated Haversine functions (×4)~~ | ~~Multiple files~~ | ~~DRY violation~~ ✅ |
| ~~Duplicated `extractSubgridName` (×2)~~ | ~~`App.tsx` + `supabase.ts`~~ | ~~Inconsistent behavior~~ ✅ |

---

## Section 6 — What SHOULD Be Added (Enterprise Features)

### Tier 1 — Must Have (Production Blocker)

1. **Proper Auth Guard**: Route-level auth check that redirects to login if session is expired. Session timeout enforcement.
2. **Row Level Security**: Supabase RLS policies on every table, enforced by user role.
3. **Error Boundary**: React `ErrorBoundary` wrapping each workspace. Currently one error crashes the entire app.
4. **Loading & Skeleton States**: Many data-fetching operations show no loading indicator.
5. **Toast/Notification System**: Replace `alert()` calls with a proper non-blocking toast system.

### Tier 2 — Enterprise Upgrade

6. **Real-Time Job Status via WebSocket**: Subscribe to Supabase Realtime on `processing_jobs` table to auto-update job cards without manual refresh.
7. **True Web Worker for QAQC**: Move all pixel analysis off the main thread.
8. **Global Error Logger**: Catch and surface unhandled promise rejections to the audit log.
9. **API Request Timeout & Retry**: Wrap all `fetch()` calls with a timeout (`AbortSignal.timeout(10000)`) and retry with backoff.
10. **Lazy-Load Workspaces**: Use `React.lazy()` + `Suspense` for each workspace. Currently all 10 workspaces load on startup.

### Tier 3 — Enterprise Polish

11. **Internationalization (i18n) Completion**: The `translate()` function exists everywhere but most labels are still hardcoded English strings.
12. **Keyboard Navigation & Accessibility**: No focus traps in modals, no ARIA labels on icon-only buttons.
13. **Offline/Degraded Mode**: No user-facing indication when Supabase or the NAS worker is unreachable.
14. **Data Export Pagination**: CSV export could attempt to export all records including unfetched pages.
15. **Audit Log Persistence per Action**: Several operations log to console but skip `addAuditLog()`.
16. **Analytics Workspace**: This is currently the weakest workspace — needs real aggregation pipeline (daily KPI trends, team performance, defect rate over time).
17. **Mobile/Tablet Responsive Layout**: The sidebar and dashboard assume wide screens; no responsive breakpoints defined.

---

## Section 7 — What's Actually IMPRESSIVE (Keep & Build On)

- ✅ **GPU-Accelerated QAQC Engine** (`gpuAnalyzer.ts`): WebGL 2.0 Laplacian shader with OffscreenCanvas and CPU fallback — this is genuinely enterprise-grade and rare in a web dashboard
- ✅ **Threshold Studio Modal** (`QAQCThresholdStudioModal.tsx`): Configurable blur/GPS/glare thresholds per deliverable model type — very professional
- ✅ **Dataset Lineage System**: The DAG-based parent/child dataset tracking with version supersession is solid architecture
- ✅ **Deletion Safety System**: Recycle bin, spatial selection map, impact preview before deletion — production-grade data governance
- ✅ **Theme System** (`themes.css`, `ThemeSelector.tsx`): Full CSS variable theming with dark/light modes
- ✅ **Report Generation** (`reportDocuments.ts`): Real A4-print-quality HTML reports with proper CSS
- ✅ **Multi-Storage Provider Support**: R2, S3, GCS, Azure, Wasabi, NAS — well abstracted
- ✅ **Pipeline Stage Derivation** (`pipelineStages.ts`): Dynamic stage computation from real job/dataset state — no hardcoded statuses

---

## Proposed Implementation Phases

### ~~Phase 1 — Security Hardening (Week 1)~~ ✅ COMPLETE
- [x] ~~Remove hardcoded Supabase key fallback~~
- [x] ~~Fix postMessage origin from `'*'` to actual origin~~
- [x] ~~Implement Supabase RLS on all tables~~
- [x] ~~Remove dead code (`mockSimulatorRegistry`) + add fetch timeout~~
- [x] ~~Remove all `console.log` debug calls (3 instances)~~
- [x] ~~RLS SQL script written — run `supabase_rls_application_tables.sql` in Supabase Dashboard~~

### ~~Phase 2 — Architecture Refactoring (Week 2–3)~~ ✅ COMPLETE
- [x] ~~Extract `DataManagementPage` → `src/components/DataManagementPage.tsx`~~ ✅ (also moved `GRIDS`, `CatalogItem`, `DataForm`; shared data utils → `src/utils/dashboardData.ts`, shared types → `src/types/dashboard.ts`; App.tsx re-exports utils so `QAQCWorkbench.tsx` keeps compiling)
- [x] ~~Extract `QCAuditModal` → `src/components/QCAuditModal.tsx`~~ ✅
- [x] ~~Extract `MapComponent` → `src/components/MapComponent.tsx`~~ ✅ (also removed the `[sendStagedData debug breakdown]` console.log during extraction)
- [x] ~~Create `src/utils/geo.ts` with single Haversine implementation~~ ✅
- [x] ~~Consolidate `extractSubgridName` to one canonical version~~ ✅ (canonical version in `src/utils/subgrid.ts`; `App.tsx` imports from it, `supabase.ts` re-exports it; `QAQCWorkbench.tsx` updated to import from `../utils/subgrid` directly)
- [x] ~~Create `src/hooks/useAppData.ts` for all Supabase fetching~~ ✅ (moved the full fetch effect + realtime channel + 30s polling into `src/hooks/useAppData.ts`; hook owns `notifications, auditLogs, dailyData, batchLogs, qaqcAuditRuns, qaSubgridRecords, isDataLoading, supabaseError, projectSettings, liveDefectCount` and their setters; App.tsx destructures them from the hook; default `projectSettings` object moved into hook as `DEFAULT_PROJECT_SETTINGS`)
- [x] ~~Add `React.lazy()` for all workspace components~~ ✅ (10 workspace components wrapped in `React.lazy` — AdminSettingsView, OperationalActionCenter, ImageProductionWorkspace, NASStorageWorkspace, ProcessingCenterWorkspace, LineageWorkspace, AnalyticsWorkspace, ReportsWorkspace, AdministrationWorkspace, QAQCWorkbench — each mapped from named export via `lazy(() => import(...).then(m => ({ default: m.X })))`; `main` workspace conditional wrapped in `<Suspense>` with `ContentLoading` fallback; QAQCWorkbench modal has its own `<Suspense>` fallback)
- [x] ~~Replace triple-timeout hack with `MAP_READY` event-only sync~~ ✅ (removed the `t1/t2/t3` delayed retry effect in `MapComponent.tsx`; sync now relies on the immediate effect + the existing `MAP_READY`/`VIEWER_READY`/`WEBGIS_READY`/`MAP_LOADED` message handler + the iframe `onLoad` handler that all call `syncMapSettings()`/`sendStagedData()`; `refreshKey` reloads the iframe via `&t=` so `onLoad`/`MAP_READY` fire on refresh)

### ~~Phase 3 — Backend & API Improvements (Week 2)~~ ✅ COMPLETE
- [x] ~~Add `AbortSignal.timeout(10_000)` to all fetch calls in `productionApi.ts`~~ ✅ (the shared `api()` helper already applies `signal: init?.signal ?? AbortSignal.timeout(10_000)` to every call)
- [x] ~~Add NAS worker authentication header (API key or JWT)~~ ✅ (added optional `apiKey` to `ProductionApiSettings`; `getProductionApiSettings` resolves it from `projectSettings.productionApiKey` / `VITE_PRODUCTION_API_KEY`; `buildHttpClient` sends `Authorization: Bearer <apiKey>` on every request when set)
- [x] ~~Replace storage bucket enumeration with a server-side `file_inventory` table~~ ✅ (created `resolveStorageFiles()` in `src/services/supabase.ts` that queries `file_inventory` (`select filename, subgrid`) first and only falls back to `.storage.list()` when the table is unavailable/empty; refactored all 4 enumeration sites — `fetchSupabaseData`, `verifyCsvImageFilenamesInStorage`, `getStorageImageCountsFromSupabase`, and the storage-health check — to use it. Provisioning DDL: `supabase_file_inventory_table.sql`)
- [x] ~~Add Supabase Realtime subscription to `processing_jobs` for live job status~~ ✅ (added a realtime channel in `ProcessingCenterWorkspace.tsx` subscribing to `processing_jobs` that calls `refreshJobs()` on any change, alongside the existing polling)
- [x] ~~Replace `select('*')` with projected column selects~~ ✅ (applied verified-safe projections where table schemas are fully confirmed by write paths: `qaqc_audit_runs` reads now select their exact consumed columns; `qa_defects` reads in `fetchQADefectsForSubgrid`; `project_settings` selects `id, settings, updated_at`. Remaining `select('*')` sites intentionally kept where rows are round-tripped back to DB (`user_accounts`, `datasets`, `processing_jobs`, `survey_recycle_bin`) or where snake/camel-case alias fallbacks make projection risk PostgREST errors (`panoramas`, `panoramas_view`, `staging_panoramas`, `audit_logs`, `notifications`, `deletion_requests`, `subgrids`, `qa_defects` in `fetchQaRecordsFromSupabase`)

### ~~Phase 4 — UX & Polish (Week 3–4)~~ ✅ COMPLETE
- [x] ~~Add React `ErrorBoundary` per workspace~~ ✅ (new `WorkspaceErrorBoundary` in `src/components/common/WorkspaceErrorBoundary.tsx` wraps the workspace canvas in `App.tsx` with `resetKey={currentPage}` so a crash in one workspace shows an inline retry card and resets when switching workspaces; app-root error boundary in `main.tsx` retained)
- [x] ~~Add proper toast notification system (replace `alert()`)~~ ✅ (new module-level toast bus `src/components/common/toast.ts` + `<Toaster/>` viewport in `src/components/common/Toaster.tsx`, mounted at the App root. Replaced all 10 `alert()` calls — App.tsx (1), DataManagementPage (7), QCAuditModal (2) — with `toast.success/info/error`. Toaster uses `role="status" aria-live="polite"`, auto-dismisses after 4.2s, and supports manual dismiss)
- [x] ~~Add loading skeleton states for all data panels~~ ✅ (new `Skeleton` primitives `src/components/common/Skeleton.tsx`; replaced the 4 dashboard KPI spinner blocks with skeleton pulses, plus skeleton states in `OperationalActionCenter`, `DefectsGalleryModal`, `RecycleBinModal`, storage `OverviewPanel`, and `CapacityPanel`. The existing `ContentLoading` table/cards skeleton variants already covered `DatasetRegistryPanel`, `RawRegistryPanel`, `DatasetRecoveryPanel`)
- [x] ~~Add keyboard navigation and ARIA labels~~ ✅ (`WorkspaceSidebarNav` now has `nav aria-label`, `aria-current="page"` on the active workspace, `aria-label` on icon-only actions, and `aria-expanded` on the collapse toggle; `UnderlineTabStrip` is now a proper `role="tablist"/tab` with `aria-selected`, roving `tabIndex`, and ArrowLeft/Right + Home/End keyboard navigation; the main dialogs (`QCAuditModal`, `RecycleBinModal`, `DefectsGalleryModal`, `DataSelectionListModal`, images-list modals in App + DataManagement) got `role="dialog" aria-modal="true"` + Escape-to-close via new `useDialogEscape` hook)
- [x] ~~Complete i18n translations (Malay at minimum)~~ ✅ (all 4 language dictionaries now at full 293-key parity with `en`: `ms` had 11 missing workspace descriptions added; `zh` and `ja` were both truncated at 28 keys and were completed to full translations — Chinese and Japanese — matching every English key)
- [x] ~~Build out Analytics Workspace with real KPI charts (daily distance trends, team stats, defect rate time series)~~ ✅ (already fully implemented in prior sessions — verified: `AnalyticsWorkspace` renders 6 tabs via `UnderlineTabStrip`; `OverviewPanel` uses recharts `LineChart` for `analytics.dailySeries` + `PieChart` for publication distribution; `DistancePanel`/`CoveragePanel`/`DensityPanel`/`QualityPanel` render recharts `BarChart`s from `computeSurveyAnalytics`; `LedgerPanel` shows the per-subgrid ledger. recharts ^2.12.7 is a declared dependency)

### ~~Phase 5 — QAQC Performance (Week 4)~~ ✅ COMPLETE
- [x] ~~Move QAQC analysis loop to real `qaqc.worker.ts` Web Worker~~ ✅ (new real module worker `src/workers/qaqc.worker.ts` created with `new Worker(new URL(...), { type: 'module' })` and driven from `useQAQCWorker`. The full per-station loop — GPS jump check, directional multi-quadrant blur/obstruction analysis, defect aggregation, inspection history — now runs off the main thread and streams `STATION`/`COMPLETE`/`ABORTED`/`ERROR` messages back; the hook forwards them to the UI so the live workbench view is unchanged. Image decode in `qaqcAnalyzer.ts` is now worker-safe via a shared OffscreenCanvas-first pixel context (identical 512×256 sampling + identical pixel math; the `new Image()` fallbacks are guarded to the main thread). The WebGL GPU path self-falls back to CPU inside the worker. Point IDs and panorama URLs are pre-resolved on the main thread and handed to the worker as data)
- [x] ~~Remove `stepIntervalMs` artificial pacing (no longer needed off main thread)~~ ✅ (the `setTimeout` pacing loop and the per-station sleep are gone from the analysis loop; `stepIntervalMs` was removed end-to-end — `StartInspectionParams`, the `useQAQCWorker` hook, App.tsx `handleStartInspectionFromWorkbench`, and the QAQCWorkbench "Pacing Rate / Auto / 200ms / 300ms / 500ms" control block plus the FPS badge, with the ETA estimate now pacing-independent)
- [x] ~~Add batch-result persist (QAQC results saved only at end of run, not per-frame upsert)~~ ✅ (removed the per-defect fire-and-forget `qa_defects` upsert inside the loop; defects are now written once at run end by `persistDefectBatch` — a batched, chunked (50/req) `supabase.upsert` on the same `subgrid,point_id` conflict key with the same column mapping and user context; `syncedCount` reflects the number of rows actually written, and the non-fatal `console.warn` fallback is preserved)

---

## Open Questions for You

> [!IMPORTANT]
> Before execution begins, please answer the following:

1. **Auth model**: Are you using Supabase Auth (email/password)? Or a custom auth? The `authSession` type is `any` everywhere — is there a real auth flow in place?
-i use supabase auth
2. **Deployment target**: Is this deployed to Vercel/Netlify, or self-hosted? The `VITE_MAP_URL=http://localhost:5173` suggests the WebGIS map is a separate Vite app — is that also deployed?
-localhost for dev, vercel for production ready. 
3. **NAS Worker**: Is the FastAPI NAS GPU Worker actively running? Should we add health polling to the UI?
-not in the current state, but in production will be. yes.
4. **Phase priority**: Should we start with security (Phase 1) or architecture (Phase 2) first? Phase 1 is mandatory before any real users touch this.
5. **Analytics Workspace**: What metrics matter most for your team — image throughput, defect rates, KM per day, operator performance?
professional looking analytics that related to system.
6. **Mobile support**: Is this only used on desktop workstations, or does it need to work on tablets?
only for desktop.

---

*Audit performed on: 2026-09-02 | Dashboard version: 0.0.0 | Files reviewed: 45+ | Lines analyzed: ~85,000+*
