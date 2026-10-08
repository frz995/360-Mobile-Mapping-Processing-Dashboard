---
name: geosphere-360-dashboard
description: Use when working in the GeoSphere 360 / geosphere-360-dashboard repo (360 mobile-mapping WebGIS dashboard). Covers the "never assert what was not measured" law, frontend design language (theme tokens, component primitives, canonical render patterns), backend and data layer (authz, services/api, migrations, storage providers, the read-only NAS worker, Cloudflare proxy chain), the .mobile-compact responsive and panel-clipping rules, quality gates and ratchets, and known traps.
---

# GeoSphere 360 — Processing Dashboard

Enterprise WebGIS + 360° mobile-mapping (MMS) processing dashboard for low-voltage
utility asset mapping. Stack: React 18 + TypeScript + Vite + Tailwind v3 (semantic
CSS-variable tokens) + Supabase (Postgres/PostGIS, Auth, Storage) + Leaflet / MapLibre GL /
PhotoSphereViewer, with a **read-only Python NAS service**, a sibling `station-agent`
service, and Cloudflare Pages Functions as the same-origin proxy layer.

**Correction to older copies of this skill:** the `worker/` service does **not**
process images and is not a GPU worker. Panorama QA/QC runs in the browser
(`src/utils/gpuAnalyzer.ts`, `src/workers/qaqc.worker.ts`). `worker/README.md:6-10`
states this. Do not reintroduce the old framing.

---

## Rule zero — never assert what was not measured

The single strongest cross-cutting law in this codebase, learned the hard way by
migrations 0032/0033 and the v27 survey-integrity audit:

> **A value that was not measured is `null`, and renders as unknown. It is never `0`.**

`0` means "looked, found nothing". Collapsing the two converts an outage into a
clean bill of health. This applies to frame counts, defect counts, POI counts,
storage reachability, and any "last checked" timestamp.

- `resolveStorageFiles().listingOk`, `verifyCsvImageFilenamesInStorage().verified`,
  `listSubgridFilenamesFromInventory()` returning `null` not `[]`,
  `datasets.ts` writing SQL `NULL` for an unmeasured defect count,
  `fetchSurveyMetadataFilenames()` returning `null` for "pre-0034".
- When you add a derived figure, ask what happens when its input is unavailable.
  If the answer is "it shows a confident number", the figure is wrong.
- A button labelled *Validate* / *Run* / *Refresh* must perform the read. The
  integrity panel shipped a "Run validation" that only rewrote its own timestamp
  and reported success. `onRevalidate` now exists on `SurveyIntegrityPanel` —
  stamp the time only after the promise resolves.

## Non-negotiables

- **Production-first.** No mock data, no placeholder endpoints, `localStorage` is an
  offline cache and never the system of record. Supabase is authoritative.
- **Theme tokens only.** Semantic classes only — see the token table below. No
  ad-hoc red/blue/green boxes, novelty gradients, or display fonts.
- **No slash-opacity on hex-var colours.** `tailwind.config.js` maps `card` to
  `var(--bg-card)`, so `bg-card/90` emits invalid CSS. Use the solid class or
  `style={{ background: 'var(--bg-card)' }}`.
- **Comment the *why*, not the *what*.** This codebase's comments explain reasoning
  and non-obvious invariants (why a catch is safe, why a null is not a zero, why an
  identity holds). Match that register and density. Do not narrate code.
- **Read `README.md`** for domain background before large changes. Design contract:
  `.agents/rules/geosphere_360_architecture_and_design_system.md`. Frame contract:
  `.agents/rules/frames_count_logic.md`. Note those two say "7 themes" and
  "194+ tests"; both are stale — `src/themes.css` and the test run are authoritative.
- When the docs and the code disagree, **the code and the gates win**, then fix the doc.

## Environment

- Windows / PowerShell 5.1. `rg` is **not** installed — use the Grep/Glob/Read tools.
- **Never rewrite source files with `Get-Content`/`Set-Content`.** This has already
  corrupted a test file into mojibake. Always use the Edit/Write tools.
- **Anchor to stable strings, not line numbers.** Every line number cited in older
  copies of this skill had rotted. Grep for a class name, function, or component
  instead (`app-canvas`, `mobile-compact`, `function openIntegrityForDaily`).
- `node scripts/lint.mjs` runs eslint **twice** (once `-f json` for the ratchets,
  once for the human-readable report). Expect a long tail of warnings; only errors
  and file-budget overruns fail.

## Commands and quality gates

| Goal | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Build (gate) | `npm run build` (`tsc -b` then `vite build`) |
| Typecheck only (fast) | `npx tsc -b --force` — must exit 0 |
| Lint (blocking in CI) | `node scripts/lint.mjs` |
| Tests | `npm run test` (vitest run) |
| Targeted tests | `npx vitest run <path/glob>` |
| Worker tests | `$env:PYTHONPATH='.'; python -m pytest worker/tests -q` |
| Reset survey data | `npm run clean-db` |

**Verification protocol before claiming done:** `npx tsc -b --force` →
`node scripts/lint.mjs` → targeted `npx vitest run` for touched areas. Add
`npm run build` + full `npm run test` for release-sized changes.

**The ratchet** (`scripts/quality-baseline.json`, enforced by `scripts/lint.mjs`).
Re-measure before quoting numbers; the budget is a floor that may only fall.

| Gate | Mechanism | Fails? |
| --- | --- | --- |
| Lint errors | `severity 2` | **Yes** |
| Lint warnings | compared to `lint.warnings` budget | No (report-only) |
| File-size budgets | 33 files ≥ 800 lines; physical line count | **Yes** |
| Empty catches | `strict` + `consoleOnly` vs baseline | No (report-only) |

Warning budget was **1251**; the tree sat at **1248** with 0 errors as of the
survey-integrity audit. Dominant rules: `no-explicit-any` (~1025),
`no-non-null-assertion` (~147), `react-hooks/exhaustive-deps` (~70).

**The file-size budget is the gate people forget.** `DataManagementPage.tsx`
(5026), `RoadAnalysisWorkspace.tsx` (4558), `App.tsx` (4478) and ~30 others are
capped. Adding ~110 lines to `DataManagementPage.tsx` failed `npm run lint`. The
correct response is to **extract a module** — which is what
`src/utils/integritySubjects.ts` now does — not to raise the budget. Raising a
budget is allowed but must be a deliberate edit to the JSON, with the diff as the
record.

---

## Repo map

### Frontend
- `src/App.tsx` — the shell and page router (very large). Owns the `app-canvas`,
  the workspace switch on `currentPage`, and the mount order below. **Search it
  before assuming a new file exists.**
- `src/workspaces.tsx` — `WORKSPACES` / `WORKSPACE_CATEGORIES` + `WorkspacePlaceholder`.
  Keys also live in `src/utils/hashRouter.ts` and `src/types/navigation.ts`; a new
  workspace needs an entry in all three.
- `src/components/` — `dashboard/`, `production/` (`hub/`, `analytics/`,
  `storage/`), `roadAnalysis/`, `operations/`, `reports/`, `common/`, `modals/`,
  `boundary/`, `showcase/`. Workspace roots: `ProjectWorkspace`,
  `ProductionHubWorkspace` (serves `production`, `processing`, `lineage`),
  `AdministrationWorkspace`, `AdminSettingsView`, `DataManagementPage`,
  `RoadAnalysisWorkspace`, `AnalyticsWorkspace`, `ReportsWorkspace`,
  `NASStorageWorkspace`, `PcMonitoringStation`.
- `src/share/` — `SharedMapPage`, `ShareMapDialog`, `SharePasswordGate`.
- `src/config/` — `branding.ts`, `defaults.ts`, `transport.ts` (worker proxy policy).
- `src/hooks/` — `useAppData`, `useCoverageSegmentation`, `usePanoramaViewer`,
  `usePermission`, `useQAQCWorker`, `useStationAgents`.
- `src/lib/` — `authz`, `i18n` (en/ms/zh), `quiet`, `report`, `retry`, `sentry`,
  `writeFailures`.
- `src/utils/` — pure logic: `panotrackAppearance`, `surveyIntegrity`,
  `integritySubjects`, `dashboardData`, `deletionImpact`, `qaqcAnalyzer`,
  `gpuAnalyzer`, `storageInventory`, `subgrid`, `csvImportMetadata`.
- `src/workers/qaqc.worker.ts` — in-browser trajectory/defect validation.
- `src/index.css` — base + `.mobile-compact`; `src/themes.css` — token themes.
- `functions/` — Cloudflare Pages Functions (see backend section).

### Backend / data
- `src/services/api/` — the data layer. `client.ts` (transport + `scoped` /
  `toQueryResult`), `storage.ts`, `datasets.ts`, `qaqc.ts`, `admin.ts`, `jobs.ts`,
  `roadTrace.ts`, `productionRuns.ts`, `stationBoard.ts`, `stageEventLedger.ts`,
  `hubSession.ts`, `permissions.ts`, `surveyMetadata.ts`. Barrel: `api/index.ts`;
  legacy facade `src/services/supabase.ts` re-exports it, so **both import paths work**.
- `src/services/` — `storageInventory.ts` (pure, provider-agnostic),
  `storageUrls.ts` (canonical provider enum + URL builders), `supabaseConfig.ts`,
  `productionApi.ts` (NAS worker HTTP client), `roadExtraction.ts`,
  `nasImageToken.ts`, `projectContext.ts`.
- `supabase/migrations/` — **34 files, `0001`–`0034`, contiguous**,
  `NNNN_snake_case_description.sql`. Not wired to `supabase db push`; applied by a
  documented hand-run sequence. `migrations/README.md` records a known ordering
  defect (0004 before 0012) and forbids adding `ON_ERROR_STOP=1` to the apply loop.
- `worker/` — read-only NAS filesystem service (`app.py`, `nas_scan.py`).
- `station-agent/` — top-level sibling of `worker/`, one per workstation PC.
- `docs/` — `ENV.md`, `TWO_TRACK_MODEL.md`, `FRAMES_COUNT_AND_STORAGE_LOGIC.md`,
  `production_worker_api.md`, `Deployment-Topology.md`, `SMOKE_CHECKLIST.md`,
  `CLIENT_DEPLOYMENT_GUIDE.md`, `cloudflare_production_setup.md`.
- `implementation_plan_v*.md` — history of the numbered change plans.

---

## Frontend design language

### Tokens and themes

**9 themes** in `src/themes.css`: `graphite`, `monochrome`, `neumorph-dark`,
`geodetic-sage`, `naval-steel`, `industrial-basalt`, `alabaster`, `daylight`,
`neumorph-clay`. Three light themes additionally carry a `data-surface="neumorphism"`
variant, which restyles cards, inputs, toggles, tabs and the sidebar by targeting
class substrings. Any new chrome must survive both a dark and a light theme.

Semantic classes (from `tailwind.config.js` → CSS vars):

| Class | Variable | Use |
| --- | --- | --- |
| `bg-app` | `--bg-app` | Root canvas |
| `bg-card` | `--bg-card` | Panels, workspace canvas, modals |
| `bg-inner` | `--bg-inner` | Nested containers, inputs, rows, toolbars |
| `border-subtle` | `--border-subtle` | Structural borders |
| `divide-subtle`, `border-subtle/60` | — | Legal: opacity on a *border* utility is fine; it is `bg-*`/`text-*` on hex vars that breaks |
| `text-text-base` | `--text-primary` | Headings and body |
| `text-text-muted` | `--text-muted` | Captions, metadata, timestamps |
| `divider` | `--divider` | Internal separators |
| `accent` | `--accent` | Accent surface |

Vars consumed directly rather than through Tailwind: `--modal-overlay`
(`bg-[var(--modal-overlay)]` — the themable backdrop; the older hard-coded
`bg-slate-950/80` is legacy), `--palette-*` (7 chart/annotation colours),
`--card-shadow`, `--card-radius`, `--ui-gap`, `--ui-padding`, `--panel-cols`,
`--map-cols`, `--input-bg`, `--table-*`.

**Canonical workspace frame** (from the design contract — copy this shape):

```tsx
<div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
  <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto md:overflow-hidden p-4">
    {/* header: title + subtitle on the left, actions on the right */}
    <div className="px-1 flex items-center justify-between gap-3 shrink-0 flex-wrap">
      <div>
        <h2 className="text-base font-bold text-text-base tracking-wide">{title}</h2>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">{actions}</div>
    </div>
    {/* main canvas */}
    <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col flex-1 min-h-0" />
  </div>
</div>
```

Never add standalone icon boxes, uppercase category labels, or decorative tags to
that header.

### Shared primitives — `src/components/common/`

| Component | Provides |
| --- | --- |
| `InspectorDrawer` | **The drawer.** `mode: 'docked' \| 'modal'`, `widthMode: 'compact' \| 'expanded' \| 'fullscreen'`, `badge`, `headerActions`, `footer`, J/K + arrow navigation, `ariaLabel`, `bodyClassName`. No portal. |
| `toast.ts` + `Toaster.tsx` | Transient notifications: `toast.success/info/error`, 4.2 s, top-right. |
| `WriteFailureBanner` | Persistent, never auto-dismissing banner for **failed database writes**. Backed by `src/lib/writeFailures.ts`. |
| `WorkspaceErrorBoundary` | Class boundary; reports to Sentry, auto-retries lazy-chunk failures. |
| `ContentLoading` | `variant: 'table' \| 'cards' \| 'spinner' \| 'inline'`; also the `Suspense` fallback. |
| `EmptyState` | `title`, `hint`, `action`, `icon`. |
| `Skeleton` / `SkeletonValue` / `SkeletonTableRows` | `aria-hidden` placeholders. |
| `EmptyState`/`dialog.ts` | `useDialogEscape(onClose)` — window keydown, stops propagation. |
| `MapLibreGlobe`, `EarthGlobe`, `ProjectBoundaryMap`, `DistrictProjectPopup` | Map primitives: globe, 2D boundary map, globe click popover. |
| `ProjectGalleryCard` | Project card for the gallery; exports the shared `STATUS_DOT_TONE` map, `formatRelative`, `resolveProjectPreview`. |
| `ReorderList` | Drag-reorder kit (`ReorderItem`, `ReorderHandle`). |
| `FocusCards`, `HoverBorderGradient`, `Sparkles`, `StarsBackground` | Showcase/decorative. |
| `GeoSphereLogo` | Brand marks from `src/config/branding.ts`. |
| `framerRuntime.ts` | No-op shims so vendored Framer modules load under plain Vite. |

**Deliberate gaps — do not assume these exist.** There is **no** shared `Button`,
`Badge`/`Pill`, `Modal`, `ConfirmDialog`, `Card`, `Table`, `Tooltip`, or
copy-to-clipboard component. Each feature writes its own. The nearest reusable
atoms are `StatusDot`, `TextAction`, `SectionLabel`, `MetaList`, `Masthead`,
`useDialogEscape` and `toast`. If you find yourself writing a fourth copy of a
button recipe, that is the signal to extract one — but do it as its own change.

### Canonical render patterns

**Modal** — two coexisting conventions:
1. *Inline* (more common): a nullable payload state (`modal: XData | null`),
   `if (!modal) return null`, then
   `fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-sm`
   wrapping `bg-card border border-subtle rounded-xl p-5 max-w-md w-full max-h-[85vh] flex flex-col`.
   Used by `SubgridImagesListModal`, `RecycleBinModal`, `DataSelectionListModal`.
2. *Portalled* (`createPortal(…, document.body)`, `z-[9999]`): `QCAuditModal`,
   `SafeDeleteModal`, `SurveyIntegrityPanel`, showcase galleries.

Escape via `useDialogEscape`. Backdrop click via
`onClick={e => { if (e.target === e.currentTarget) onClose(); }}`.
`DataManagementPage` hand-rolls ~7 inline `role="dialog" aria-modal="true"` overlays.

**Drawer** — always `InspectorDrawer`. Reach for a portal only when an ancestor
traps `position: fixed` (see *Panel clipping*), and say why in a comment.

**Status / pill** — `StatusDot` (`src/components/production/chrome.tsx`) is the only
shared status atom: a `w-1.5 h-1.5 rounded-full` span with a raw Tailwind tone
string and optional `animate-pulse`. Callers keep a local
`Record<Status, string>` map (`STATUS_DOT_TONE`, `STATUS_TONE`). Text pills use one
recipe: `text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border <tone>`.
The newer production-console idiom drops the box entirely — plain text status.

**Stat / metric tile** — no shared tile; per-workspace markup in two live variants:
`bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5` with a
`text-2xl font-extrabold` value (`DashboardKpiSummary`), or the tighter
`p-3 rounded-xl bg-inner border border-subtle` with a
`text-[9px] uppercase tracking-wider font-mono` label / `text-base font-bold font-mono`
value / `text-[10px]` caption (`production/analytics/OverviewPanel`). Shared pieces
instead of a shared tile: `Masthead` (inline `divide-x` stat strip) and `MetaList`.

**Async save button** — tri-state, no shared component (canonical at
`RoadAnalysisWorkspace`):

```tsx
<button disabled={isSaving || isSaved || !mayEdit}
  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold
             transition-all shadow-sm bg-sky-600 hover:bg-sky-500 text-white
             active:scale-95 disabled:cursor-not-allowed">
  {isSaving ? <Loader2 size={13} className="animate-spin" />
   : isSaved  ? <Check size={13} />
   :            <Save  size={13} />}
  <span>{isSaving ? 'Saving…' : isSaved ? 'Saved' : 'Save State'}</span>
</button>
```

Icons are always `lucide-react`, sized 10–22. Semantic roles:
`text-sky-400` interactive/primary, `text-text-muted` secondary,
`text-emerald-400` success, `text-rose-400` danger, `text-amber-400` warning.
Copy buttons use the `{copied ? <Check/> : <Copy/>}` toggle.

**Error handling — a deliberate three-way split** (documented in
`src/lib/writeFailures.ts`):

| Channel | When |
| --- | --- |
| `reportWriteFailure(WRITE_OPS.x, label, detail)` | A **database write** failed and must not be missed. Persistent banner, deduped by stable op key, cleared by `reportWriteSuccess`. |
| `toast.error(msg)` | Transient user-action failures (clipboard, nothing to audit). |
| Panel-local `useState` error box | Validation errors scoped to one panel. |
| `WorkspaceErrorBoundary` | A render crash. |

Do not report a write failure with only `console.warn`. For a system whose value is
an audit trail that is the worst available default.

**Root mount order** in `App.tsx` — keep this intact:
`PermissionProvider` → `<Toaster />` → `<WriteFailureBanner />` →
`WorkspaceErrorBoundary resetKey={currentPage}` → `Suspense fallback={<ContentLoading variant="spinner" />}`.

### Maps and 360 viewer

- **MapLibre GL** (`RoadAnalysisMap`): load the worker via
  `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'`
  then `maplibregl.setWorkerUrl(import.meta.env?.VITE_MAPLIBRE_WORKER_URL || workerUrl)`.
  Always attach a `ResizeObserver` to the container — without it the canvas goes
  blank during flex recalculation or sidebar animation. Use `areStylesEqual` to
  avoid tearing down the map on non-style state updates.
- **Leaflet + Esri** layers, boundaries and trajectory polylines live in `useAppData`
  and the operational centre views. Preserve all tile providers.
- **PhotoSphereViewer 5.x** in `PhotoSphereViewerComponent.tsx`: 8K equirectangular,
  heading compass, QA marker overlays, `A`/`D` hotkeys.

---

## Backend and data layer

### Authorization — three layers, only one is the boundary

**Roles** (`src/lib/authz.ts`): `Administrator`, `Survey Operator`, `QA Inspector`,
`Viewer`. **20 capabilities** in 3 scopes mirroring `docs/TWO_TRACK_MODEL.md`:
`production` (8: `runIntake`, `runPipeline`, `operateStations`, `manageStorage`,
`runQaqc`, `reviewQaqc`, `publishSequences`, `publishToWebGIS`), `published` (6:
`importDatasets`, `manageDatasets`, `flagDefects`, `manageRoadAnalysis`,
`sharePublishedMaps`, `exportPublishedReports`), `governance` (6: `manageUsers`,
`manageProjects`, `manageSettings`, `approveDeletions`, `deleteData`, `viewAll`).

1. **Postgres RLS is the real boundary.** `sec.can(text)`, `sec.get_app_role()`,
   `sec.is_role()`, `sec.normalize_role()` — all `SECURITY DEFINER` + `stable` +
   `set search_path` (migration `0009`). Policies call `sec.can(...)` in `USING`
   and `WITH CHECK`.
2. **Cloudflare Functions middleware** (`functions/_middleware.js`) validates the
   caller's Supabase bearer against `${SUPABASE_URL}/auth/v1/user` before proxying.
3. **`src/lib/authz.ts` decides what to show or hide.** It is a *superset*: only 8
   capabilities are actually enforced in SQL (`ENFORCED_CAPABILITIES` =
   `manageDatasets`, `manageSettings`, `manageUsers`, `approveDeletions`,
   `deleteData`, `runQaqc`, `reviewQaqc`, `viewAll`), because `sec.can` is a fixed
   `CASE` while the TS side is a runtime-overridable matrix persisted in
   `project_settings.settings.role_permissions`.

**Do not widen `authz_matches_rls.test.ts`** to the whole union — it would assert
enforcement that does not exist. Service modules in `services/api/` do not call
`authz.can()`; they rely on RLS plus the UI gate. `usePermission` **fails closed**
(no provider ⇒ deny all) and pins guests to `viewAll`.

### Query layer

- **`scoped(query)`** appends `project_id = <active>` when a project is active;
  returns the query unscoped in guest/boot. It is a convenience mirror of the DB
  isolation from migration `0016`, never the security boundary.
- **`scopedIncludingUnassigned(query)`** uses `.or('project_id.eq.<id>,project_id.is.null')`
  instead, because a strict `eq` hides rows written before project scoping and
  freshly-imported data would appear then vanish on refresh.
- **`toQueryResult<T>()` / `QueryResult<T>`** is a discriminated union that makes
  reading `data` without checking `ok` a **type error**. PostgREST answers
  `{ data: null, error }` on failure, and `const { data } = await q; data?.length`
  yields a well-typed `undefined` that reads as a plausible number. Use it on write
  paths and wherever an empty result must not be mistaken for a clean one.
- Always `select()` explicit columns in hot paths, never `*`.
- `safeSupabaseFetch` swaps a >1500-byte `Authorization` header for the anon key
  and retries on HTTP 431. The exported `supabase` is a stable `Proxy` so
  `configureSupabaseBackend()` re-points existing callers and `vi.spyOn` still works.

### Write-path contract

1. Do the domain write (usually `upsert` with an explicit `onConflict`).
2. **Inspect the returned `error` explicitly — do not rely on `try/catch`.** A
   PostgREST builder is thenable: `await query` *resolves* with `{ data, error }`
   and does not throw. A `try { await q } catch {}` is dead code.
3. `reportWriteFailure(OP_KEY, label, detail)` on failure, `reportWriteSuccess(OP_KEY)`
   on success. Declare stable op keys per module (`WRITE_OPS` in `qaqc.ts`,
   `DATASET_WRITE_OPS` in `datasets.ts`) so a retry loop produces one banner line.
4. Write an `audit_logs` row via `saveAuditLogToSupabase` when the write is an
   auditable operator decision.
5. Return a value (`boolean` / `{ success, message }`); do not throw at callers.
6. Chunk large writes (50 rows per upsert in `datasets.ts`, 500 in `surveyMetadata.ts`).

### Read-path contract

- `scoped(...)` + explicit columns; wrap in `withRetry(...)` when the read feeds a page.
- **Fail-soft, never fail-hard** — catch and return an empty array/map so data
  loading is never blocked, but `console.warn` *and* return an explicit
  "unverified" flag where the difference matters.
- Keep a per-project `localStorage` mirror for offline/guest
  (`hubSession`, `stationBoard`, `stageEventLedger`). The mirror is a **fallback,
  never an override**.
- Memo caches are short-lived and the key must include every input that can change
  the answer (`storage.ts` uses a 45 s single-slot cache keyed by bucket, provider,
  base URL, manifest path and strategy).

### Migrations

Newest files (0029–0034) follow a tight template. Copy it:

- `BEGIN;` right after the header, `COMMIT;` at the end, then a **trailing PostgREST
  note after `COMMIT`** (`NOTIFY pgrst, 'reload schema';`) — otherwise selects fail
  with `PGRST204` until the cache refreshes.
- Header banner delimited by a 69-char `=` rule, stating the **root cause with
  evidence** (file:line, `git log -S`, error strings), an explicit idempotency claim
  (`Safe to re-run.`), and any **honest limit** in a `SCOPE AND HONEST LIMIT` block.
- Numbered sections separated by a 71-char `-` rule, each with a prose justification.
- Idempotency everywhere: `create table/column/index if not exists`,
  `create or replace function`, `drop trigger if exists`, constraints guarded by a
  `pg_constraint` existence check, and policies guarded inside a
  `do $$ … if not exists (select 1 from pg_policies where …) … $$;` block.
- `alter table … enable row level security` as its own statement before the policies.
  **Never** `force row level security`.
- Grants on functions: `revoke … from public` then `grant execute … to authenticated`
  (Supabase grants EXECUTE to PUBLIC by default). On tables: `revoke all … from anon`.
- `comment on table/column` stating the authoritative source and the **null
  semantics**, not just the type.
- Indexes named `idx_<table>_<columns>`, each preceded by a comment naming the exact
  read path it serves. Prefer partial indexes on the aggregate predicate.
- Wider before narrower: add the new constraint, then drop the old, so there is no
  window without a unique key. Backfill before constraining; never drop rows that
  are audit evidence.

### Storage providers

`StorageProviderType` (`src/services/storageUrls.ts`) covers 8 providers:
`supabase`, `aws_s3`, `gcs`, `azure_blob`, `cloudflare_r2`, `wasabi`, `nas_local`,
`custom_cdn` (plus the `r2` alias). Resolution is settings → env → default
(`cloudflare_r2`; boot-time *project settings* default to `supabase`, which is why
`ensureManifestSettings()` exists and re-reads `project_settings` when the base URL
is empty).

`resolveStorageFiles()` cascade — the order is load-bearing:
1. de-duplicate candidate `{bucket, path}` locations case-insensitively;
2. **public `manifest.json`** (non-Supabase only) — the source of truth for
   providers the browser cannot enumerate, so no secrets or S3 ListObjects exist.
   `fetchFrameManifest` never throws; it returns `null`;
3. **`file_inventory`** table (server-side, avoids bucket enumeration; kept
   self-maintaining by the `0028` trigger);
4. **direct `storage.list()`**, paged to 10 000.

`fileSet` holds both the lowercased path token and the bare basename; counting is
**shared across providers** so switching provider cannot change the number.
Multi-res tile pyramids count distinct *stations*, not tile faces.
`testCloudflareStorageHealth()` requires a real sample filename — an invented name
404s on a healthy bucket, and it reports `reachable` separately from `ok`.

### Worker, agent and proxy chain

- **`worker/`** is a read-only NAS filesystem service: `GET /health` (the only
  unauthenticated route), `/api/folders`, `/api/nas-scan?action=…`, `/api/images/{path}`
  (ETag + 304), `/api/storage`. FastAPI + uvicorn on **port 8000**. Every path is
  resolved through `resolve_fs()` and rejected with **400** if it escapes
  `NAS_BASE_PATH`. `nas_scan.py` is stdlib-only and importable without FastAPI.
- **`station-agent/`** is a top-level sibling (not inside `worker/`) — one per
  workstation PC, polled every 10 s by `useStationAgents`.
- **The NAS service is always reached through a same-origin proxy.** The policy is a
  pure function in `src/config/transport.ts`: one service, one tunnel, one token.
  `VITE_WORKER_API_MODE` defaults to `proxy`. Dev proxy in `vite.config.ts` injects
  `NAS_WORKER_TOKEN` server-side via `proxyReq`; prod passes through
  `functions/api/worker/[[path]].js`, which slices raw pathnames to defeat `%2e%2e`
  normalization and rejects `.`/`..`/`/`/`\`/`\0` segments. Images additionally get
  HMAC-signed short-lived URLs (`functions/_lib/signing.js`, cached 50 min by
  `src/services/nasImageToken.ts`).
- **Env vars.** On the worker: `NAS_BASE_PATH` (required), `NAS_WORKER_TOKEN`
  (blank ⇒ unauthenticated), `STORAGE_CACHE_TTL`, `NAS_LOG_JSON`, `NAS_WORKER_ID`.
  In Pages runtime: `NAS_API_URL`, `NAS_WORKER_TOKEN`, `NAS_IMAGE_TOKEN_SECRET`,
  optional `CF_ACCESS_CLIENT_{ID,SECRET}`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
  The root `.env` uses the same names deliberately, **not** `VITE_`-prefixed, so
  they never reach the bundle. Browser: `VITE_WORKER_API_MODE`,
  `VITE_STATION_AGENT_MODE`, `VITE_SENTRY_DSN`, `VITE_STORAGE_PROVIDER`,
  `VITE_MAPLIBRE_WORKER_URL`. See `docs/ENV.md`.
- `productionApi.ts` enforces a **10 s client budget**
  (`AbortSignal.timeout(10_000)`) and throws a loud error when the proxy is
  unconfigured, rather than issuing a guaranteed-404 request.

---

## Responsive / mobile playbook

The dashboard must be pixel-identical on desktop unless you are deliberately
changing desktop. All mobile density/scrolling work is scoped under
`@media (max-width: 640px)`.

**Scroll ownership — one scroller per screen on mobile.** Root is
`app-canvas h-[100dvh] md:h-screen … overflow-y-auto md:overflow-hidden`; the mobile
scroll container is the `<main className="flex-1 flex flex-col p-3 gap-3
overflow-y-auto md:overflow-hidden relative …">` in `App.tsx`. Nested panes use
`md:overflow-*` so mobile has a single page scroll.

**`.mobile-compact`** is applied by `App.tsx` to `<main>` when
`currentPage !== 'dashboard'`, and manually on the `AdminSettingsView` root. It
shrinks type, padding, gap, radius and selected icon sizes to a ~10px body / ~8px
micro floor. Rules live in the `.mobile-compact` block in `src/index.css`.
**Additive only — never unscope a rule out of the media query.**

**Panel clipping — the #1 layout bug.** An element with unconditional
`overflow-hidden` inside a height-bounded `flex-1 min-h-0` chain clips its content
and blocks `main` from scrolling to it (symptom: "half the content, can't scroll").
Make the clip mobile-only (`overflow-hidden` → `md:overflow-hidden`) and add
`min-w-0` so flex children shrink instead of forcing overflow. Known converted
cards: `ProductionHubWorkspace`, `AdministrationWorkspace`, `AdminSettingsView`.

**The sibling trap.** `InspectorDrawer` is `position: fixed`, and `.fade-in` in
`src/index.css` carries a real `will-change: opacity` rule — which makes that
element a **containing block** for fixed descendants. `DataManagementPage`'s own
mount point has exactly that class, so a drawer rendered in place resolves against
the ancestor and is clipped away while every unit test passes. `SurveyIntegrityPanel`
therefore portals to `document.body`; that is deliberate and regression-tested.
Reach for a portal when you hit this, and comment why.

**Dense tables — don't rely on shrinking.** Wrap in `overflow-x-auto` (or
`overflow-auto` + `max-h-[60vh]` for tall tables), give the `<table>` a
`min-w-[<px>]` plus `whitespace-nowrap`, and add `sticky top-0 z-10` to `<thead>`
for tall ones. Existing fixed widths (do not lower): pipeline `960`, datasets `900`,
providers `860`/`720`, users `900`, approvals `880`, worker monitor `900`.
`.mobile-compact` deliberately excludes `table` so these scroll rather than squash.

Also in the `.mobile-compact` block: `overflow-wrap: anywhere` to drop min-content
width; `min-width: 0` on direct flex/grid children;
`[role="tablist"] > * { flex: 0 0 auto }` so tab strips scroll instead of crushing;
media capped at `max-width: 100%`; form controls `min-width: 0; max-width: 100%`.

**Sidebar note.** `WorkspaceSidebarNav` is a sibling of `<main>`, not a descendant,
so `.mobile-compact .flex > *` rules never leak into the nav. Keep it that way.

---

## Testing

Vitest + Testing Library (jsdom), `vitest.config.ts`, setup `src/test/setup.ts`.

Tests live in a `__tests__/` folder **immediately beside** the source folder they
cover, named `<Subject>.test.tsx` (components) / `.test.ts` (logic, hooks, lib,
utils) — never co-located with the source file. A dot-separated qualifier marks a
second suite: `.smoke` (render-only), `.surface` (DOM contract),
`authz_matches_rls` (invariant pin). 112 files / ~1374 tests at the time of
writing; `quality-baseline.json` records 101 / 1179, so the baseline is a floor.

Helpers: `src/test/permissions.tsx` renders inside `PermissionProvider` with a
supplied matrix, so authz-gated UI is testable; `src/test/smoke.test.ts`.

**Test the claim, not the layout.** Assertions belong on what the operator is told,
on the row's `textContent`, and on the accessible label. Prefer `getByRole` /
`getByLabelText` over brittle class selectors, but do assert a token class when the
token *is* the contract (e.g. `border-emerald-500` for a clean run).

Two patterns worth copying:
- **Reachability regression.** `SurveyIntegrityPanel.test.tsx` mounts the panel inside
  a deliberately clipping ancestor and asserts the content lands in `document.body`.
  Layout bugs that unit tests cannot see get a test like this.
- **jsdom gotchas.** `Object.assign(navigator, { clipboard })` is silently ignored on
  accessors — use `Object.defineProperty`. And install it *after* `userEvent.setup()`,
  which installs its own clipboard stub.

No coverage for `AdminSettingsView`, `RoadAnalysisWorkspace`, `DailyHandoverModal`,
`PipelinePanel`, `ProvidersPanel`, `WorkerMonitorPanel`, `HandoffPanel` — if you
change those, exercise them manually and keep changes structurally minimal.

---

## Git and CI

- Repo `frz995/360-Mobile-Mapping-Processing-Dashboard`, branch `main`. **Commit or
  push only when explicitly asked.**
- CI (`.github/workflows/ci.yml`) runs four jobs: **Build** (`npm run build`),
  **Test** (`npm run test`), **Lint** (`npm run lint`, blocking), **Python**
  (3.10/3.11 worker). `gh` is not installed — poll the API:
  `Invoke-RestMethod "https://api.github.com/repos/frz995/360-Mobile-Mapping-Processing-Dashboard/actions/runs?head_sha=<sha>"`.
- `LF will be replaced by CRLF` warnings on `src/components/**` are pre-existing
  and benign.
- Never stage these local-only files: `opencode.json`, `scratch/*`,
  `git clone supabase.txt`, `.env` / `.env.example` secrets. `public/` assets **are**
  tracked.

## Known traps

- **File-size budgets fail `npm run lint`.** Extract a module; do not silently raise
  the number in `quality-baseline.json`.
- **`npm run build` runs `tsc -b`**, and the incremental cache masks changes. Use
  `npx tsc -b --force` to be sure.
- **PowerShell rewrites corrupt files.** Never `Get-Content` → `Set-Content` a source
  file.
- **Pre-existing mojibake**: `AdminSettingsView.tsx` contains
  `"Resolved 360° URL:"` with a corrupt degree sign. Unrelated to layout work; fix
  only if asked.
- **`resolveStorageFiles` memoizes for 45 s.** Unit tests that expect different
  inventory results must vary the bucket name, or the second test is served the
  first one's cache.
- **A PostgREST builder does not throw.** `try { await query } catch {}` is dead code
  on every write path.
- **Fix root causes, not symptoms.** A clipped panel is an `overflow-hidden` /
  missing `min-w-0` problem in an *ancestor*, not a missing height on the leaf.
- **`.agents/rules/` is partly stale** ("7 themes", "194+ tests"). The code and the
  gates are authoritative.