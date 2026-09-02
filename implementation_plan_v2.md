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

- [ ] **6.1 Unit test harness (Vitest)**
  - Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`,
    `@vitejs/plugin-react` (present) and a `vitest.config.ts` + `vitest.setup.ts`.
  - Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `package.json`.
  - Verify: `npx vitest run` executes a trivial smoke test; `npx vite build` still green.
- [ ] **6.2 Unit tests for pure utils** (highest value, zero DOM)
  - Cover `geo.ts` (`calculateGeodesicDistanceMeters`, `calculateForwardBearing`,
    `calculatePathDistanceKm`), `qaqcAnalyzer.detectBadGps`,
    `dashboardData.getImagesProcessedCount` / `parseFlexibleDate`,
    `subgrid.extractSubgridName`, `pipelineStages.stageJobsFor`,
    `deletionImpact.computeDeletionImpact`.
  - Thresholds: fixed known inputs vs expected numeric output (assert ± small epsilon
    on geodesic meters), edge cases (null/zero coords, same-point, missing files).
- [ ] **6.3 Component tests for the new common kit**
  - `Toaster` (renders aria-live status region, dismisses after timeout, dismiss
    button closes), `WorkspaceErrorBoundary` (catches a throwing child, shows
    retry card, resets on `resetKey`), `WorkspaceSidebarNav` (active workspace
    gets `aria-current="page"`), `UnderlineTabStrip` roving-tab arrow keys.
- [ ] **6.4 Integration tests for workflows**
  - QA/QC worker message flow using the real `qaqc.worker.ts` via `new Worker`
    in a jsdom Vitest (assert a START yields STATION followed by COMPLETE, and
    ABORT during a run yields ABORTED).
  - `useAppData` reducer/derived-state paths (loading/success/error).
- [ ] **6.5 Single-workspace smoke (vitest + mocked Supabase)**
  - Import `DataManagementPage` / a dashboard KPI block with the supabase client
    module mocked; assert no `alert()`, row render, empty state render.
- [ ] **6.6 CI pipeline (GitHub Actions)**
  - Add `.github/workflows/ci.yml`: on push/PR — `npm ci`, `npm run build`
    (tsc + vite), `npm run test`.
  - Add `branches.mass: production` lint as a non-blocking job only once an
    ESLint flat config exists (see 6.7).
  - Verify: run `npm run build` and `npm run test` locally first so CI is green
    on first push.
- [ ] **6.7 Restore a working ESLint config**
  - Add `eslint.config.mjs` (flat config — ESLint 8.57 supports `--config` with
    `ESLINT_USE_FLAT_CONFIG`). Wire `npm run lint` to it. Fix only the errors it
    introduces in NEW files; scope the old files to warn so the gate is real but
    not blocking yet.
  - (Optional, later) tighten to error and fix the ~170 legacy `as any`/
    `@ts-ignore` occurrences file-by-file — tracked separately from this plan.

---

## Phase 7 — Observability & Reliability (Week 5–6)

- [ ] **7.1 Central Sentry integration (manual, no SDK risk)**
  - Add `@sentry/react`, initialize in `main.tsx`/`src/lib/sentry.ts` guarded by
    a `VITE_SENTRY_DSN` env var (no-op when absent).
  - Attach `WorkspaceErrorBoundary` / root boundary to `captureException`.
  - Verify build + tsc; nothing else changes.
- [ ] **7.2 Error/interaction telemetry log capture**
  - Add a tiny `src/lib/report.ts` that dedupes-and-buffers `window.onerror`,
    `unhandledrejection`, and console.error into a capped ring buffer exposed in
    the Settings → Diagnostics panel (no network export unless Sentry DSN set).
  - Keep `console.*` calls but route them through the logger for the 
    phase-1 button (see 10.3) to inspect live.
- [ ] **7.3 Offline / degraded supabase handling**
  - Audit the 4+ direct `supabase.from(...)` call sites and wrap the top 3
    highest-risk (`loadAllData`, `persistDefectBatch`, staging reads) with a
    shared `withRetry(3, exponential)` helper + a non-blocking toast when
    retries fail. Pure additive.
- [ ] **7.4 Removal of per-run debug logging**
  - Add `data-quiet` mode (dev-only) that suppresses non-fatal `console.warn`
    from workers/legacy analysis once Sentry logging is live; audit the 108
    console statements and delete/route the ones that add no diagnostics value.

---

## Phase 8 — Data Integrity, Auditing & Migration Hygiene (Week 6)

- [ ] **8.1 DB constraint sync (idempotent migration file)**
  - Append new idempotent DDL to the existing SQL migration set (or a new
    `supabase_hardening_migration.sql`): FK/unique/nullability and index checks
    for the tables the app writes (`qa_defects`, `qaqc_audit_runs`,
    `deletion_requests`, `user_accounts`, `processing_jobs`,
    `survey_recycle_bin`, `file_inventory`) *without* locking production rows.
- [ ] **8.2 RLS regression coverage**
  - Stub a `src/lib/authz.ts` that centralizes the RLS edge cases the UI already
    assumes (admin vs operator vs viewer capabilities map) and unit-test it.
    Wire it into the handful of UI toggles that currently inline `role === ...`
    checks. Additive; no UI change.
- [ ] **8.3 Migration up/down safety**
  - Add `down`/rollback notes next to each newly added SQL block and a
    "supported versions" footer to the migration files so future migrations can
    be applied without guessing the current schema.
- [ ] **8.4 Development secrets hygiene**
  - Add `.env.example` completions for every `import.meta.env.VITE_*` that has no
    documented default (Sentry DSN, QA tables, storage provider, worker table),
    and add a `docs/ENV.md` mapping each variable to its TypeScript usage site.
- [ ] **8.5 Data import/audit trace**
  - Log (to audit_logs or a daily summary) each CSV upload + the generated subgrid
    set, so a corrupted import can be traced back to the operator, date, and file.
    Additive, does not touch the upload flow UX.

---

## Phase 9 — Performance & Maintainability (Week 6–7)

- [ ] **9.1 Reduce the 6k-line `App.tsx` monolith**
  - Extract the notification popover, the images-list modal, and the QA/QC
    handoff modal from `App.tsx` into `src/components/` (no logic changes; pure
    move). Target: get App.tsx under ~4k lines.
  - Verify tsc + `vite build` + dev-mode smoke after each extraction.
- [ ] **9.2 Chunk-size / code-splitting review**
  - Confirm the QAQCWorkbench lazy-load already landed; verify the same for
    `AnalyticsWorkspace`. Run `vite build` and inspect the chunk output; adjust
    only if a workspace chunk is unjustifiably large (currently
    `index` ~1.67MB pre-build hint is from the main bundle — add `manualChunks`)
    for the top recharts/three/Supabase vendor split. Mitigates load time without
    changing UI.
- [ ] **9.3 Memoization / render audit**
  - Add `React.memo` / `useCallback`/`useDeferredValue` where the data-management
    tables re-render the whole row set on every keystroke (search across
    `filteredBatchLogs`/`filteredDailyData` recompute). Use `React Profiler` in
    a dev session to pick the top-3 offenders; fix those only.
- [ ] **9.4 Type-safety debt pass**
  - Replace the highest-risk `: any` in `App.tsx` handoff/daily-data filters with
    the existing `DailyTimeSeries`/`BatchLog` types; leave `any` in the 
    supabase-adapter layer (schema is dynamic). Track removal by module.

---

## Phase 10 — UX / Dashboard polish (Week 7) — *additive, no visual regressions*

- [ ] **10.1 Bulk actions in Data Management**
  - Add "select-all / export-selected (/ CSV already exists)" to the batch-log
    and daily-data tables where FK-safe (pure additive "Export selected" button;
    no table/default behavior change).
- [ ] **10.2 "Empty state" coverage audit**
  - Sweep the workspaces for tables that show a bare "No data" with no action
    hint; add a one-line empty-state helper (`<EmptyState title hint action/>`)
    and apply to the top 4 tables that lack it. Additive.
- [ ] **10.3 Settings → Diagnostics panel**
  - Expose the telemetry/error buffer (7.2) + a "Ping Supabase latency + last
    sync time" card + a "View current runtime env" read-only list. Additive to
    Settings; no change to existing settings UX.
- [ ] **10.4 Keyboard shortcuts cheat-sheet**
  - Add a small "Keyboard shortcuts" help modal (roving help, `?` key) listing
    the existing tab / escape / arrow navigation. Additive.
- [ ] **10.5 Onboarding guide tour**
  - Add an optional first-run tour (driver.js or a lightweight hand-rolled
    spotlight) with 3–4 hint bubbles on Dashboard KPI, Data Management, QA/QC,
    Processing Center. Auto-suggests once on first login; dismissible and
    replayable from Help menu. Additive.

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