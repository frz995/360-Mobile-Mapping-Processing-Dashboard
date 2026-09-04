# Implementation Plan v6 — Two-Track Model, Display Integrity & Data Hardening

> Replaces the previous v6 (Road Extraction E1–E5, which is complete and recorded in git history). Owner-confirmed scope: production workflow, display content architecture, and data — anchored on the central finding below.

## Central finding (drives this plan)
The system does **not** currently communicate its own two-sided model:
- **WebGIS / Published view** — what TNB sees live on the map.
- **Production Pipeline** — the internal processing that builds it.

It is functionally complete but conceptually unclear to both operators and management. Evidence:
- Shared vocabulary points in **opposite directions** (see 1B glossary).
- No label, category, About, README, landing, or nav copy states a two-track model (`App.tsx:5057` calls it one "unified WebGIS processing platform"; `SystemShowcase.tsx` is a flat 6-module tour; README lists modules without the split).
- The "Dashboard" nav category bundles the published view with production-flavored `data`.

**Guiding rule (unchanged, binding):** no visual redesign, no logic/behavior change, no feature removal. Every change is copy/naming/i18n/Docs/DDL gated by `tsc -b`, `npm run build`, `vitest run`, `npm run lint`.

---

## PHASE 1 — Two-Track Model (communication; the core deliverable)

### 1A. Restructure nav categories to express the two tracks
`src/workspaces.tsx:69-86`, rendered by `WorkspaceSidebarNav.tsx:100-122` via `translate(category.labelKey)` — no structural change needed, only the array + label keys.

| New category label (i18n key) | Members | Meaning |
|---|---|---|
| `workspaceCategoryWebGIS` → **"WebGIS · Published View"** | `dashboard`, `data`, `analytics`, `reports`, `roadAnalysis` | What the WebGIS shows / what's captured & published |
| `workspaceCategoryProduction` → **"Production Pipeline"** | `production`, `processing`, `lineage`, `storage` | Internal processing (private) |
| `workspaceCategoryGovernance` (unchanged) | `administration` | Control |

- Keys/routing untouched; only `labelKey` + `members` order change.
- `roadAnalysis` moves from Insights → WebGIS track (owner-confirmed).
- Update `i18n.ts` category labels in en/ms/zh parity.

### 1B. Disambiguate all terminology collisions (i18n-first, no logic change)

| Term | WebGIS/published sense | Production sense | Fix |
|---|---|---|---|
| **Publish** | "Publish to WebGIS" = live on map | Production "Publish" *stage* = `DELIVERABLE` dataset exists | Production stage label → **"Deliverable pack"** (`pipelineStages.ts` label; `i18n.ts:174-182`). Keep "Publish to WebGIS" only on dashboard/WebGIS action |
| **Staging / STAGED** | Survey runs not yet on WebGIS | Production "Data staging" stage + PostGIS "Staging Gate & Production Sync" | Dashboard non-published → **"Not yet on WebGIS"**; production stage keeps "Data staging" with copy noting it flows `staging_panoramas` → QA → WebGIS |
| **Production** | *Public* live PostGIS tables | *Private* operator pipeline | Category → "Production Pipeline"; internal = "internal production pipeline"; PostGIS table = "live WebGIS tables" |
| **Deliverable** | Final report/PDF | `DELIVERABLE` dataset (processed images) | Qualify: **"Deliverable dataset"** (pipeline) vs **"deliverable report"** (reports) |
| **In process** | Default non-published status | Pipeline job state | Dashboard default status → **"Not published"** |

Targets: `App.tsx:1552` (PDF "VERIFIED & PUBLISHED / STAGED IN PROCESS"), `DataManagementPage.tsx:1065`, `OperationActionCenter.tsx:99`, `pipelineStages.ts`, `i18n.ts` (en/ms/zh).

### 1C. Orientation copy: About, landing, dashboard + production subtitle, Docs/README
- **About modal** (`App.tsx:~5051-5057`): replace "unified WebGIS processing platform" with a two-track orientation paragraph explaining WebGIS (published view) vs Production Pipeline (RAW → … → Deliverable → Publish to WebGIS), plus a "how the two tracks fit" note.
- **Dashboard subtitle**: one-line tag "Shows what is published to the WebGIS."
- **Production workspace entry**: one-line tag "Internal processing pipeline (not the public WebGIS view)."
- **SystemShowcase.tsx**: reframe intro as a two-track model rather than a flat module tour.
- **README.md + docs/**: add a "Two Tracks" section (mental model diagram + shared-term glossary).

---

## PHASE 2 — Display Integrity & Dedup (honesty)

- **2A.** `App.tsx:~3075` Pipeline Health: show `—` / "No data" when `totalFramesForHealth === 0` (no more "100% Normal" on empty DB).
- **2B.** Unify `totalImages` (Card 2) and `totalFramesForHealth` (Card 4) onto one `totalFrames` definition computed once.
- **2C.** Replace regex `/（\d+）\s+Defect/` defect parsing with real `qa_defects` row totals; string-parse only as a labeled fallback.
- **2D.** Remove dead `DashboardWorkspace.tsx` (duplicate dashboard) + `WebGISViewerIframe.tsx` (never imported); correct `SystemShowcase` "live MapLibre map" claim if it renders screenshots.
- **2E.** Correct false dual-engine (Three.js/WebGL) claims in README + AdminSettings About → describe PhotoSphereViewer v5 accurately.
- **2F.** Move most-visible hardcoded EN strings (KPI labels, `App.tsx:3564-3792` panel/table headers, QA questionnaire) into i18n (best-effort, no visual churn).

## PHASE 3 — Worker / Data Integrity & RLS

- **3A. Global queue + admission control** (`worker/`): process-wide `MAX_ACTIVE_JOBS` semaphore; extra jobs `QUEUED`; expose `active_jobs`/`max_active_jobs` in `/metrics`; reject full queue (409/429) instead of unbounded executors (prevents GPU OOM).
- **3B. Stop silent no-ops:** remove `STITCH`/`AI_DETECT`/`QAQC` from worker accepted list (return 400 instead of read→write COMPLETED); remove STITCH from HandoffPanel worker dispatch; add worker unit test asserting unsupported types are rejected.
- **3C. Durable job state by default:** default `WORKER_JOB_DB` to a path so the SQLite journal isn't opt-in.
- **3D. Supabase sync retry** (`worker/sync.py`): backoff + dead-letter + structured warn instead of fire-and-forget.
- **3E. Real GPU telemetry** in `/metrics` (nvidia-smi/pynvml) or remove hardcoded fake HandoffPanel values.
- **3F. Missing DDL:** add migrations creating `panoramas`, `staging_panoramas`, `panoramas_view` (currently RLS-only, no CREATE — fresh DB broken).
- **3G. `is_fallback_coord` flag:** mark sanitized centroids so fabricated/approximate GPS is visible, not silent.
- **3H. Atomic publish:** transactional insert-then-delete with safe error path (no delete-then-insert data loss).
- **3I. RLS on core tables** (`panoramas`, `qa_defects`, `qaqc_audit_runs`, `audit_logs`, `notifications`, `staging_panoramas`) — role-guarded like secondary tables; add RLS test row.
- **3J. Migration-order cleanup:** document canonical apply order; drop orphaned `recycle_bin`; add idempotent seeds.

## PHASE 4 — Maintainability (strict refactor, non-visual)
- **4A.** Remove dead `DashboardWorkspace.tsx` (with 2D).
- **4B.** Unbundle district GeoJSON — fetch `malaysia.district.geojson` at runtime, removing 854KB from the ~1MB RoadAnalysis chunk (`malaysiaDistricts.ts` / `RoadAnalysisWorkspace.tsx`).
- **4C.** Begin splitting `App.tsx` (4,944 lines) into extracted sub-components with zero visual/behavior change.

---

## Sequencing & Gates
**P1 (two-track copy) → P2 (display honesty) → P3 (data/RLS/worker) → P4 (refactor).**
P1–P2 are low-risk i18n/copy (no logic); P3 is SQL/worker (isolated, gated); P4 is strict refactor. Each phase keeps all gates green: `tsc -b`, `npm run build`, `vitest run` (incl. CI no-`.env` parity), `npm run lint`, and `pytest` for worker changes.

## Deliverables
- This plan (`implementation_plan_v6.md`, replacing prior v6).
- Supabase migrations `0012`–`0013` + cleanup SQL.
- Worker changes (queue, job-type rejection, durable default, sync retry, metrics/telemetry).
- Copy/naming changes in `src/workspaces.tsx`, `src/lib/i18n.ts`, `src/App.tsx`, `SystemShowcase.tsx`, `DataManagementPage.tsx`, `OperationActionCenter.tsx`, `pipelineStages.ts`, `HandoffPanel.tsx`.
- README + docs "Two Tracks" section.
- Updated tests (frontend vitest + worker pytest + RLS).
