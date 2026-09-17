---
name: geosphere-360-dashboard
description: Use when working in the GeoSphere 360 / tnb-gis-dashboard repo (TNB 360 mobile-mapping WebGIS dashboard, React + TypeScript + Vite + Tailwind + Supabase). Covers repo layout, verification commands, the mobile/.mobile-compact responsive and panel-clipping rules, horizontal table-scroll patterns, theme tokens, Supabase persistence, git/CI hygiene, and known traps (mojibake from PowerShell rewrites, untracked junk, baseline lint warnings).
---

# GeoSphere 360 — Processing Dashboard

Enterprise WebGIS + 360° mobile-mapping (MMS) processing dashboard for TNB low-voltage
asset mapping. Package name is `tnb-gis-dashboard`. Stack: React 18 + TypeScript +
Vite + Tailwind v3 (semantic CSS-variable tokens) + Supabase (Postgres/PostGIS,
Auth, Storage) + Leaflet / MapLibre GL / PhotoSphereViewer \+ a Python GPU worker.

## Ground rules

- **Production-first.** Never add mock data, placeholder endpoints, or `localStorage`
  as the system of record. Supabase is the single source of truth; local storage is
  only an offline cache.
- **Theme tokens only.** Style with semantic tokens (`bg-app`, `bg-card`, `bg-inner`,
  `border-subtle`, `text-text-base`, `text-text-muted`, `divider`, `accent`) and the
  7 themes in `src/themes.css`. Do **not** add ad-hoc red/blue/green boxes, novelty
  gradients, or display fonts.
- **No slash-opacity on hex-var colors.** `bg-card/90` emits invalid CSS because
  `card` is `var(--bg-card)`. Use solid classes or inline `style={{ background: 'var(--bg-card)' }}`.
- Follow the design/architecture contract in `.agents/rules/geosphere_360_architecture_and_design_system.md`
  and the frame-count contract in `.agents/rules/frames_count_logic.md`.
- Keep source comment-light — the existing comments are deliberate; do not add noise.
- Read `README.md` for domain/architecture background before large changes.

## Environment

- Windows / PowerShell 5.1. `rg` is **not** installed — use the Grep/Glob/Read tools.
- **Never rewrite source files with `Get-Content`/`Set-Content`.** Doing this previously
  corrupted a test file into mojibake. Always use the Edit/Write tools.

## Commands

| Goal | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Build (gate) | `npm run build` (`tsc -b` then `vite build`) |
| Typecheck only (fast) | `npx tsc -b --force` — must exit 0 |
| Lint (blocking in CI) | `node scripts/lint.mjs` |
| Tests | `npm run test` (vitest run) |
| Targeted tests | `npx vitest run <path/glob>` |
| Reset survey data | `npm run clean-db` |

**Lint baseline: 0 errors / ~1057 warnings.** Legacy app code is warn-only; only
errors fail. Keep the warning count flat when you touch code — do not introduce errors.

**Verification protocol before claiming done:** `npx tsc -b --force` → `node scripts/lint.mjs`
→ targeted `npx vitest run` for touched areas. Run `npm run build` + full `npm run test`
for release-sized changes.

## Repo map

- `src/App.tsx` — the shell and page router (very large). Owns `<main>`, the workspace
  switch on `currentPage`, and the dashboard home. Search it before assuming a new file.
- `src/workspaces.tsx` — `WORKSPACES` / `WORKSPACE_CATEGORIES` metadata + `WorkspacePlaceholder`.
- `src/workspaces.tsx`, `src/utils/*Router*`, `src/types/navigation.ts` — workspace keys/routing.
- `src/components/` — `dashboard/`, `production/` (incl. `production/processing/`),
  `roadAnalysis/`, `operations/`, `reports/`, `common/`, `modals/`, `boundary/`, `showcase/`.
  Workspace roots: `ProjectWorkspace`, `ProcessingCenterWorkspace`, `ImageProductionWorkspace`,
  `AdministrationWorkspace`, `AdminSettingsView`, `DataManagementPage`, `RoadAnalysisWorkspace`.
- `src/services/` — `supabase.ts` (source of truth, storage verification), `projects.ts`,
  `productionApi.ts`, `roadExtraction.ts`, `storageInventory.ts`.
- `src/hooks/`, `src/workers/qaqc.worker.ts`, `src/lib/` (`authz`, `i18n`, `quiet`, `retry`, `sentry`).
- `src/index.css` — base + `.mobile-compact` responsive system; `src/themes.css` — token themes.
- `worker/` — Python GPU worker + BFF (has its own pytest suite; CI runs `py_compile` + `test_store.py`).
- `scripts/lint.mjs` — cross-platform flat-config ESLint launcher. `implementation_plan_v*.md` — history.

## Responsive / mobile playbook

The dashboard must be pixel-identical on desktop unless you are deliberately changing desktop.
All mobile density/scrolling work is scoped under `@media (max-width: 640px)`.

**Scroll ownership — one scroller per screen on mobile.** Root is
`app-canvas h-[100dvh] md:h-screen overflow-x-hidden overflow-y-auto md:overflow-hidden`
(`App.tsx` ~L3480). The mobile scroll container is
`<main className="flex-1 flex flex-col p-3 gap-3 overflow-y-auto md:overflow-hidden relative ...">`
(~L3770). Pattern: nested panes use `md:overflow-*`, so mobile has a single page scroll.

**`.mobile-compact`** — applied automatically by `App.tsx` to `<main>` when
`currentPage !== 'dashboard'`, and manually on the `AdminSettingsView` root. It shrinks
type, padding, gap, radius, and selected icon sizes to a ~10px body / ~8px micro floor.
Rules live in `src/index.css` (~L1145+). Additive only — never unscope a rule from the media query.

**Panel clipping — the #1 layout bug.** An element with unconditional `overflow-hidden`
sitting inside a height-bounded `flex-1 min-h-0` chain will clip its content and block
`main` from scrolling to it (symptom: "half the content, can't scroll"). Fix by making
the clip mobile-only (`overflow-hidden` → `md:overflow-hidden`), and add `min-w-0` so flex
children can shrink instead of forcing overflow. Known converted cards: `ProcessingCenterWorkspace`,
`ImageProductionWorkspace`, `AdministrationWorkspace`, `AdminSettingsView`.

**Dense tables — don't rely on shrinking.** Wrap the table in `overflow-x-auto` (or
`overflow-auto` + `max-h-[60vh]` for tall multi-row tables) and give the `<table>` a
`min-w-[<px>]` plus `whitespace-nowrap`; for the tall tables add `sticky top-0 z-10` to `<thead>`.
Existing fixed widths (don't lower them): pipeline `960`, datasets `900`, providers `860`/`720`,
users `900`, approvals `880`, worker monitor `900`. `.mobile-compact` deliberately excludes
`table` so these scroll rather than squash.

**Other rules from the fit-to-canvas hardening** (in the `.mobile-compact` block):
`overflow-wrap: anywhere` to drop min-content width; `min-width: 0` on direct flex/grid
children; `[role="tablist"] > * { flex: 0 0 auto }` so tab strips scroll instead of
crushing; media capped at `max-width: 100%`; form controls `min-width: 0; max-width: 100%`.

**Sidebar note.** `WorkspaceSidebarNav` is a sibling of `<main>`, not a descendant — so
`.mobile-compact .flex > *` rules never leak into the nav. Keep it that way.

## Testing

Vitest + Testing Library (jsdom). Tests live in `src/components/__tests__/`,
`src/components/production/__tests__/`, and `src/test/`. Prefer targeted
`npx vitest run <file>`. Note there is **no** coverage for `AdminSettingsView`,
`RoadAnalysisWorkspace`, `DailyHandoverModal`, `PipelinePanel`, `ProvidersPanel`,
`WorkerMonitorPanel`, or `HandoffPanel` — if you change those, exercise them manually
and keep changes structurally minimal.

## Git & CI

- Repo `frz995/360-Mobile-Mapping-Processing-Dashboard`, branch `main`. Commit/push only
  when explicitly asked.
- CI (`.github/workflows/ci.yml`) runs four jobs: **Build** (`npm run build`), **Test**
  (`npm run test`), **Lint** (`npm run lint`, blocking), **Python** (3.10/3.11 worker).
  `gh` is not installed — poll the API:
  `Invoke-RestMethod "https://api.github.com/repos/frz995/360-Mobile-Mapping-Processing-Dashboard/actions/runs?head_sha=<sha>"`
- `LF will be replaced by CRLF` warnings on `src/components/**` are pre-existing and benign.
- Never stage these local-only files: `opencode.json`, `scratch/*`, `git clone supabase.txt`,
  `.env` / `.env.example` secrets. `public/` assets **are** tracked.

## Known traps

- `src/components/AdminSettingsView.tsx` (~L2051) contains a pre-existing mojibake
  `"Resolved 360� URL:"` (should be `360°`). Unrelated to layout work; fix only if asked.
- `npm run build` runs `tsc -b`; incremental cache can mask a change — use
  `npx tsc -b --force` to be sure.
- Fix root causes, not symptoms: a clipped panel is usually an `overflow-hidden` /
  missing `min-w-0` problem in an ancestor, not a missing height on the leaf.
