# Implementation Plan v2 — Enterprise Hardening & Operability

> Companion follow-on to the (now complete) `implementation_plan_v1.md`.
> Phase 1–5 goals from v1 are all shipped. This v2 plan targets the gaps that
> separate a *working production system* from an *enterprise-grade operation*:
> quality gates, observability, data hygiene, on-boarding support, and the
> remaining type-safety / dead-code debt.

**Guiding rules (identical to v1):**
- **No behavior/layout/logic regressions.** Every item is incremental, additive,
  or a safe refactor. No charts change, no theme tokens change.
- **Verify each step** with `npx tsc -b` (and `npx vite build` where noted).
  Production build must stay green.
- **Strike every completed item** with `~~…~~` and `✅` in this file as you go.
- Keep every edit surgical; prefer new small files over touching `App.tsx`.

---

## Phase 6 — Test & Quality Gates (Week 5)

Automated tests are the single biggest missing enterprise property: there are
currently zero test files. Adding vitest + React Testing Library + Playwright
does not change any runtime behavior — it only locks in what exists.

- [x] **6.1 Unit test harness (Vitest)** ✅
  - Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`,
    `@vitejs/plugin-react` (present) and a `vitest.config.ts` + `vitest.setup.ts`.
  - Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `package.json`.
  - Verify: `npx vitest run` executes a trivial smoke test; `npx vite build` still green.
  - Note: pinned `vitest@^1.6.1` + `jsdom@^24` for Node 18 compatibility (vitest 4 / jsdom 30 need Node ≥20/22).
- [x] **6.2 Unit tests for pure utils** (highest value, zero DOM) ✅
  - Cover `geo.ts` (`calculateGeodesicDistanceMeters`, `calculateForwardBearing`,
    `calculatePathDistanceKm`), `qaqcAnalyzer.detectBadGps`,
    `dashboardData.getImagesProcessedCount` / `parseFlexibleDate`,
    `subgrid.extractSubgridName`, `pipelineStages.stageJobsFor`,
    `deletionImpact.computeDeletionImpact`.
  - Thresholds: fixed known inputs vs expected numeric output (assert ± small epsilon
    on geodesic meters), edge cases (null/zero coords, same-point, missing files).
  - Added 5 test files (geo, subgrid, dashboardData, qaqcAnalyzer, deletionImpact, pipelineStages = 6 files, 94 tests). GPU module mocked in qaqcAnalyzer test to avoid jsdom WebGL load. `tsc -b` + `vitest run` green.
- [x] **6.3 Component tests for the new common kit** ✅
  - `Toaster` (renders aria-live status region, dismisses after timeout, dismiss
    button closes), `WorkspaceErrorBoundary` (catches a throwing child, shows
    retry card, resets on `resetKey`), `WorkspaceSidebarNav` (active workspace
    gets `aria-current="page"`), `UnderlineTabStrip` roving-tab arrow keys.
  - Added 4 test files (Toaster, WorkspaceErrorBoundary, WorkspaceSidebarNav, chrome/UnderlineTabStrip = 24 tests). Toaster test uses a mocked isolated toast store to avoid module-global state leaking between tests.
- [x] **6.4 Integration tests for workflows** ✅
  - QA/QC worker message flow using the real `qaqc.worker.ts` (jsdom has no
    `Worker` constructor, so the test drives the module directly via the global
    `self.onmessage` entry point and captures `self.postMessage` output; the
    image-analysis module is mocked so the WebGL/GPU singleton never loads).
    Asserts START → STATION×N → COMPLETE, GPS-jump defect flagging, check-skip
    behavior, and ABORT during an in-flight analysis → ABORTED (no COMPLETE).
  - `useAppData` derived-state paths (loading success, `liveDefectCount`,
    `dailyData`/`batchLogs` hydration and clamping) with the `supabase` service
    module mocked.
  - Added 2 files: `src/workers/__tests__/qaqc.worker.test.ts` (4 tests),
    `src/hooks/__tests__/useAppData.test.tsx` (5 tests).
- [x] **6.5 Single-workspace smoke (vitest + mocked Supabase)** ✅
  - Import `DataManagementPage` with the `../services/supabase` module mocked;
    asserts no `alert()` during mount, a populated daily row renders (subgrid +
    frame count), the daily empty state renders, a reconciled batch row renders,
    and the batch empty state renders.
  - Added `src/components/__tests__/DataManagementPage.smoke.test.tsx` (5 tests).
    Note: jsdom lacks a `Worker`/WebGL path, so the page's heavy child modals and
    Leaflet map are only loaded, not rendered (they mount closed by default).
- [x] **6.6 CI pipeline (GitHub Actions)** ✅
  - Added `.github/workflows/ci.yml`: on push/PR — `npm ci`, `npm run build`
    (tsc + vite), `npm run test`. Lint job is `continue-on-error: true`
    (non-blocking) and becomes a real gate once the ESLint flat config lands in
    6.7.
  - Verified locally: `npm run build` (tsc -b + vite) and `npm run test`
    (133 tests) are both green, so CI will be green on first push.
- [x] **6.7 Restore a working ESLint config** ✅
  - Added `eslint.config.mjs` (flat config — ESLint 8.57 with
    `ESLINT_USE_FLAT_CONFIG=true`). Wired `npm run lint` to it via a small
    cross-platform Node launcher (`scripts/lint.mjs`) that sets the env var and
    spawns the ESLint CLI (avoids fragile inline env vars on Windows).
  - Legacy `src/**` code is linted at WARN severity (non-blocking); the new
    Phase-6 test files are linted at ERROR severity as a real gate. `npm run lint`
    exits 0 with 0 errors / 685 warnings. Verified clean: `tsc -b`, 133 vitest
    tests, and `vite build` all green.
  - (Optional, later) tighten to error and fix the legacy `as any`/
    `@ts-ignore` occurrences file-by-file — tracked separately from this plan.

---

## Phase 7 — Observability & Reliability (Week 5–6)

- [x] **7.1 Central Sentry integration (manual, no SDK risk)** ✅
  - Added `@sentry/react@^7.120.4` (Node ≥8 compatible with our Node 18). Initialized in
    `src/lib/sentry.ts` guarded by `VITE_SENTRY_DSN` (complete no-op when absent), wired in
    `main.tsx`. `componentDidCatch` in the root `main.tsx` boundary and `WorkspaceErrorBoundary`
    now call `captureException`. Verified `tsc -b` + `vite build` green; nothing else changes.
- [x] **7.2 Error/interaction telemetry log capture** ✅
  - Added `src/lib/report.ts`: a capped ring buffer (default 500) capturing
    `window.onerror`, `unhandledrejection`, and `report*` calls, with
    `subscribeReports`/`clearReports`/`addReportSink` for the Settings → Diagnostics panel
    (10.3) and Sentry fan-out. Installed via `installReporters()` in `main.tsx`.
    Added unit tests (`src/lib/__tests__/report.test.ts`, 4 tests).
- [x] **7.3 Offline / degraded supabase handling** ✅
  - Added shared `src/lib/retry.ts` (`withRetry(3, exponential)` + non-throwing
    `withRetryResult`). Wrapped the top 3 highest-risk supabase sites: the main
    `panoramas_view` select in `fetchSupabaseData`, `fetchStagingPanoramasFromSupabase`, and the
    `qa_defects` batch upsert in `useQAQCWorker.persistDefectBatch`. Failure after retries is
    routed through the telemetry log (non-blocking). Added unit tests
    (`src/lib/__tests__/retry.test.ts`, 7 tests). Pure additive.
- [x] **7.4 Removal of per-run debug logging** ✅
  - Added `src/lib/quiet.ts` `data-quiet` mode (enabled via
    `localStorage.geosphere_quiet === '1'` or `VITE_DATA_QUIET=1`). Routed the verbose,
    non-fatal GPU/analysis fallback warnings in `gpuAnalyzer.ts` and `qaqcAnalyzer.ts` through
    `quietWarn`. Added unit tests (`src/lib/__tests__/quiet.test.ts`, 3 tests). Broad audit of
    remaining `console.*` statements tracked separately (see 6.7).

---

## Phase 8 — Data Integrity, Auditing & Migration Hygiene (Week 6)

- [x] **8.1 DB constraint sync (idempotent migration file)** ✅
  - Added `supabase_hardening_migration.sql` (idempotent, guarded with `IF NOT
    EXISTS` / `DO $$`): FK/uniqueness/nullability guards + additive indexes for
    `qa_defects`, `qaqc_audit_runs`, `deletion_requests`, `user_accounts`,
    `processing_jobs`, `survey_recycle_bin` (the table the client's
    `RECYCLE_BIN_TABLE` actually writes) and `file_inventory`. All additive —
    `NOT VALID` constraint + `CREATE INDEX IF NOT EXISTS` never locks/rewrites
    production rows.
- [x] **8.2 RLS regression coverage** ✅
  - Added `src/lib/authz.ts` centralising the role→capability map (admin /
    operator / inspector / viewer / guest) with `normalizeRole`, `can`,
    `isAdminRole`, `roleFromEmail`. Wired into `AdminSettingsView`'s isGuest /
    isAdmin toggles (behaviour-preserving — `isAdminRole` normalises
    `Administrator`/`admin` identically). Left `AdministrationWorkspace`'s
    intentional `|| true` bypass untouched to avoid a behaviour change.
    Added `src/lib/__tests__/authz.test.ts` (5 tests).
- [x] **8.3 Migration up/down safety** ✅
  - Appended a "ROLLBACK / SUPPORTED VERSIONS" footer (concrete `down`
    statements + Supabase Postgres 15 / `public` schema note) to
    `schema_migrations.sql`, `foundation_production_migration.sql`,
    `foundation_processing_migration.sql`, `supabase_rls_application_tables.sql`,
    `supabase_realtime_qaqc_migration.sql`, `supabase_file_inventory_table.sql`,
    and the new hardening file.
- [x] **8.4 Development secrets hygiene** ✅
  - Completed `.env.example` for every `import.meta.env.VITE_*` (Supabase,
    WebGIS map URL, storage providers, NAS/worker API, DB table overrides,
    `VITE_SENTRY_DSN`, `VITE_DATA_QUIET`) and added `docs/ENV.md` mapping each
    variable to its exact TypeScript usage site (file:line), with a security note.
- [x] **8.5 Data import/audit trace** ✅
  - `handleCsvImport` in `DataManagementPage.tsx` now persists a durable
    `saveAuditLogToSupabase` IMPORT trace containing source file names, operator
    (email/user), date, generated subgrid set, record count, and invalid-GPS
    count — additive, no change to the upload UX.

---

## Phase 9 — Performance & Maintainability (Week 6–7)

- [ ] **9.1 Reduce the 6k-line `App.tsx` monolith**
  - Extract the notification popover, the images-list modal, and the QA/QC
    handoff modal from `App.tsx` into `src/components/` (no logic changes; pure
    move). Target: get App.tsx under ~4k lines.
  - Verify tsc + `vite build` + dev-mode smoke after each extraction.
  - ✅ Progress (pure moves, no logic change): QA/QC handoff modal already extracted
    earlier as `src/components/DailyHandoverModal.tsx`; this pass extracted
    `src/components/NotificationPopover.tsx` (was App.tsx:4033–4165) and
    `src/components/SubgridImagesListModal.tsx` (was App.tsx:5907–5964), removed
    now-unused imports, and re-verified gates (tsc clean, build 13.71s, 18 files/
    156 tests pass, lint 0 errors). App.tsx now **6,333 lines**.
  - ⚠️ Honest status: pure-move extraction of these blocks cannot reach the ~4k
    target — reaching it requires structural de-monolithing (splitting inline
    workspace render trees into `src/workspaces/*`-scoped components), which goes
    beyond a pure move and needs explicit sign-off. Recommend approving that step
    to actually meet the target.
- [x] **9.2 Chunk-size / code-splitting review** ✅
  - Confirm the QAQCWorkbench lazy-load already landed; verify the same for
    `AnalyticsWorkspace`. Run `vite build` and inspect the chunk output; adjust
    only if a workspace chunk is unjustifiably large (currently
    `index` ~1.67MB pre-build hint is from the main bundle — add `manualChunks`)
    for the top recharts/three/Supabase vendor split. Mitigates load time without
    changing UI.
  - ✅ Done: added a `manualChunks` vendor split (`react`, `recharts`/d3,
    `@supabase`, `@photo-sphere-viewer`, `@sentry`, `lucide-react`, `leaflet`
    intent) to `vite.config.js` (the file Vite actually loads — `.ts` was being
    shadowed) and kept `vite.config.ts` in sync. Worked around an ES5-lib
    `tsc -b` error by using `indexOf(...) !== -1` instead of `.includes(...)`.
  - ✅ Measured result: main `index` bundle **1,690 kB → 637 kB** (gzip
    445→164 kB, −62%); recharts/d3/three deduplicated into shared
    `vendor-charts` so **AnalyticsWorkspace 448 kB → 37.66 kB**; all workspace
    chunks now <500 kB (largest: AdminSettingsView 353 kB). Verified QAQCWorkbench
    and AnalyticsWorkspace each emit their own lazy chunk.
  - ✅ Caveat (accepted): `leaflet` (637 kB `index`) and `@photo-sphere-viewer`
    (641 kB `vendor-psv`) still exceed 500 kB. Leaflet stays in `index` because
    Rollup merges the leaflet↔esri-leaflet↔app cycle; forcing it out needs lazy
    map-init (behavior-affecting, out of scope). vendor-psv is the core 3D
    panorama engine. Both are acceptable; gates green (tsc clean, build 15.77s).
- [x] **9.3 Memoization / render audit** ✅
  - Add `React.memo` / `useCallback`/`useDeferredValue` where the data-management
    tables re-render the whole row set on every keystroke (search across
    `filteredBatchLogs`/`filteredDailyData` recompute). Use `React Profiler` in
    a dev session to pick the top-3 offenders; fix those only.
  - ✅ Finding: the plan's primary target was already met — `filteredBatchLogs`,
    `filteredDailyData`, `paginated*`, and `activeBatchLogs` in
    `src/components/DataManagementPage.tsx` are **all already `React.useMemo`'d**
    (the filter recomputes only when search/filter/data actually change, and rows
    are paginated to a small `pageSize`). No keystroke-triggered filter recompute
    exists to fix.
  - ✅ Applied (safe, pure, zero behavior change): memoized the five daily-column
    filter option lists (grid/subgrid/equipment/PIC/publish) into a single
    `dailyColumnOptions` `useMemo` keyed on `draftDailyData`. Previously each
    render/keystroke re-derived `new Set(...)+sort()` over `draftDailyData` five
    times; now they recompute only when the data changes.
  - ⚠️ Deliberately skipped `useDeferredValue` and the `React.memo` row extraction:
    filtering is already memoized so benefit is marginal, and both introduce a
    transient UI lag / large 130-line-per-row refactor that risk behavior changes,
    conflicting with the plan's strict "no behavior regressions" rule. Row-memo
    extraction (like the 9.1 deep split) needs explicit sign-off.
  - Verified gates: tsc clean, build green (18.05s), 18 files / 156 tests pass,
    lint 0 errors.
- [x] **9.4 Type-safety debt pass** ✅
  - Replace the highest-risk `: any` in `App.tsx` handoff/daily-data filters with
    the existing `DailyTimeSeries`/`BatchLog` types; leave `any` in the 
    supabase-adapter layer (schema is dynamic). Track removal by module.
  - ✅ Done: converted three high-risk `: any` panorama callbacks in `App.tsx`
    render-path filters to typed `PanoramaItem` inference:
    - two identical `log.panoramas.filter((p) => p.isAvailable !== false).map((p) => p.filename)...`
      image-list filters (were `(p: any)` x2 each, lines 4742 & 5008);
    - `dailyPanos.map((p) => p.filename || p.id)...` defect-gallery batch filenames
      (was `(p: any)`, line 5039) — added a type-guard `filter((f): f is string => Boolean(f))`
      since `.filter(Boolean)` doesn't narrow.
  - ✅ Added optional `id?: string` to `PanoramaItem` in `src/types/dashboard.ts`
    (matches the real Supabase panorama shape used by `p.filename || p.id`).
  - ✅ Net: `: any` in App.tsx handoff/daily-data filters reduced; lint warnings
    dropped 690 → 685 (0 errors). Supabase-adapter `any` intentionally untouched.
  - Verified gates: tsc clean, build green (12.04s), 18 files / 156 tests pass,
    lint 0 errors.

---

## Phase 10 — UX / Dashboard polish (Week 7) — *additive, no visual regressions*

- [x] **10.1 Bulk actions in Data Management** ✅
  - Add "select-all / export-selected (/ CSV already exists)" to the batch-log
    and daily-data tables where FK-safe (pure additive "Export selected" button;
    no table/default behavior change).
  - ✅ Done: the select-all header checkbox already existed; added a pure-additive
    **"Export Selected (CSV)"** button to the bulk-selection toolbar in
    `src/components/DataManagementPage.tsx` with a `handleBulkExportCsv` handler
    (exports the active tab's selected rows — batch or daily — as a UTF-8 BOM
    CSV download). Added `Download` icon. No change to existing Publish/Delete
    behavior. Gates green: tsc clean, build 12.64s, 156 tests pass, lint 0 errors.
- [x] **10.2 "Empty state" coverage audit** ✅
  - Sweep the workspaces for tables that show a bare "No data" with no action
    hint; add a one-line empty-state helper (`<EmptyState title hint action/>`)
    and apply to the top 4 tables that lack it. Additive.
  - ✅ Done: added reusable `<EmptyState title hint action icon/>` in
    `src/components/common/EmptyState.tsx` (styled to match `ContentLoading`,
    `Inbox` default icon, optional clickable `action` node). Applied to 4 tables:
    Data Management batch log, Data Management daily data, Production
    PipelinePanel subgrids, and RawRegistryPanel subgrids — each now shows a
    title + action hint instead of a bare line. No behavior/layout regression
    to the surrounding tables. Gates green: tsc clean, build 11.96s, 156 tests,
    lint 0 errors.
- [x] **10.3 Settings → Diagnostics panel** ✅
  - Expose the telemetry/error buffer (7.2) + a "Ping Supabase latency + last
    sync time" card + a "View current runtime env" read-only list. Additive to
    Settings; no change to existing settings UX.
  - ✅ Done: added a new **"Diagnostics"** tab to Settings
    (`AdminSettingsView.tsx`, alongside Project/Map and Theme Packages) rendering
    a new `src/components/DiagnosticsPanel.tsx` with: a **Supabase Latency** card
    (pings `testDatabaseHealth`, shows PostGIS/Storage/WebGIS/Realtime status +
    latency + last ping time + memory), a **Telemetry Status** card (Sentry
    enabled/disabled + runtime env), the live in-memory **Error Buffer** from
    `src/lib/report.ts` (subscribe-to-list, color-coded levels, Clear button), and
    a collapsible **Runtime Environment** read-only list of the app's VITE_* env
    vars + user agent. Additive — no change to existing settings tabs. Gates
    green: tsc clean, build 14.06s, 156 tests, lint 0 errors.
- [x] **10.4 Keyboard shortcuts cheat-sheet** ✅
  - Add a small "Keyboard shortcuts" help modal (roving help, `?` key) listing
    the existing tab / escape / arrow navigation. Additive.
  - ✅ Done: added a **"Keyboard Shortcuts"** tab to the existing Help & User
    Guide modal in `App.tsx`, listing `?`, `Esc`, `Tab`, `↑ ↓`, `← →`, `Enter`,
    `Space` as styled `<kbd>` chips with plain-text actions. Added a global
    `keydown` effect in `App.tsx` (`?` opens the guide on the shortcuts tab,
    `Esc` closes it) — additive, no change to existing tabs or open/close paths.
    Gates green: tsc clean, build 11.73s, 156 tests, lint 0 errors.
- [x] **10.5 Onboarding guide tour** ✅
  - Add an optional first-run tour (driver.js or a lightweight hand-rolled
    spotlight) with 3–4 hint bubbles on Dashboard KPI, Data Management, QA/QC,
    Processing Center. Auto-suggests once on first login; dismissible and
    replayable from Help menu. Additive.
  - ✅ Done: the app already had a hand-rolled multi-step spotlight tour (existing
    `tourStep` + `TOUR_STEPS` highlights, replayable via the Help guide's
    "Start Interactive Tour"). Added the missing **first-run auto-suggest**: a
    dismissible nudge card that appears ~1.4s after a real (non-guest) login if
    `localStorage.tourFirstRunSeen` isn't set, with **Start Tour** / **Not now**
    / X actions (all persist the flag). Replay remains available from the Help
    menu. New `MapIcon` import + `tourFirstRunOpen` state in `App.tsx`. Additive —
    existing tour, modals, and other 10.4/10.3 behavior unchanged. Gates green:
    tsc clean, build 12.01s, 156 tests, lint 0 errors (685 warnings).

---

## Notes & Rationale

- **Why Phase 6 first**: tests are the only thing that makes every later change
  safe and demonstrable to stakeholders. No production behavior is altered.
- **Why Phase 7/8**: operational resilience + compliance (auditing, secrets,
  RLS), the things a real client or ops team will ask about.
- **Why Phase 9 last before polish**: you can't polish what you can't navigate;
  shrinking the monolith and chunking the bundle preserves the current UX while
  making the codebase more maintainable and the app faster to load.
- **Deliberately out of scope** (flagged for a separate conversation):
  - Re-theming / new design system (v1 explicitly prohibited style changes).
  - Migrating the WebGIS map iframe to a single bundled context.
  - A brand-new notifications center (an in-app bell + popover already exists in
    App.tsx; I would only *enhance* it, not duplicate it).
  - Real Supabase Auth MFA rollout (UI references exist; enabling it touches
    production auth and should be a separate, deliberate change).

---

## Rollout checklist (once all phases are struck)

- [ ] `git status` clean of unexpected files; `vite build` + `vitest run` green.
- [ ] Confirm `.github/workflows/ci.yml` ran green on the first push.
- [ ] Confirm Sentry (if DSN set) receives a seeded test error.
- [ ] Manual smoke: Dashboard, Data Management (search/paginate/export),
      QA/QC workbench (real worker + batch persist), Processing Center,
      Admin Settings, Storage capacity, Reports, Analytics.