# Implementation Plan v16 — Clean Path-Based URL Routing (History API)

## Objective
Replace the legacy hash scheme (`https://…vercel.app/#/roadAnalysis`) with clean,
server-renderable paths (`https://…vercel.app/roadAnalysis`) using the browser History
API — while preserving deep-link compatibility for existing `#/…` bookmarks and the
Production→Data `?subgrid=` handoff.

## Data impact (confirmed — none)
This is a **pure client-side URL↔workspace mapping change**. It does not touch:

- Supabase database rows/tables, RLS, RPCs, or storage buckets (the router runs zero queries).
- local/session storage keys (auth tokens, active project, theme, read/notification IDs,
  tour flags) — router writes nothing new; `geosphere360_workspace_location` keeps storing
  the same `WorkspaceKey` values, fully compatible.
- Cloud `project_settings.roadAnalysisState` or in-app workspace state — the router only
  decides *which component mounts*, it never reads/writes workspace payloads.

Transient URL state moves source only: the Data handoff filter becomes `/data?subgrid=X`
(parsed from `location.search`) instead of `#data?subgrid=X` (parsed from `location.hash`).
Nothing is persisted differently and no existing `#/…` links break.

## Decisions (confirmed)
- **History-API router, still zero-dependency.** New `src/utils/urlRouter.ts` implements
  `pushState`/`replaceState` navigation, a `popstate`-based subscription, and keeps the
  `WorkspaceKey` union, `WORKSPACE_KEYS`, `DEFAULT_WORKSPACE`, alias handling
  (`login`→`signin`, `showcase`→`landing`) and case-insensitive matching exactly as today.
- **Pathname-precedence rule (critical).** A stale legacy `#/…` hash must never override an
  explicit `/path`. `parseWorkspace()` honors the hash only when the pathname names no route
  (`/`, `/index.html`, or empty). This keeps old bookmarks working on first load while
  navigation can never get "stuck" on an outdated hash.
- **`isExplicitRoute()`** re-implements the old `window.location.hash` check used by App's
  initial-state logic: true when the pathname *or* legacy hash names a route, so the
  stored-workspace restore behaves identically to today.
- **No `vercel.json` / infra change.** Rewrites to `/index.html` already power SPA fallback;
  Vite dev server SPA-fallbacks by default. Direct-load, refresh, back/forward all work.
- **Workspace key values unchanged** (camelCase `roadAnalysis` kept) so navigation targets,
  stored state, and every current link keep their meaning.
- **Sign-out uses `replaceWorkspace`** so the transient landing entry doesn't pollute the
  browser back stack.
- **`APP_VERSION` is NOT bumped** — routing is an infrastructure change and shouldn't
  re-trigger the welcome/onboarding gate.

## Phases

### 1. New router — `src/utils/urlRouter.ts`
- `WorkspaceKey`, `WORKSPACE_KEYS`, `DEFAULT_WORKSPACE` (copied unchanged).
- `parseWorkspace(path?)` — pathname parsing (strips `/`, query, fragment), legacy-hash
  fallback with pathname precedence, alias + case-insensitive matching, unknown → dashboard.
- `isExplicitRoute()` — pathname-or-legacy-hash names a non-default route.
- `pushWorkspace(key, query?)` / `replaceWorkspace(key, query?)` — History-API navigation to
  `/{key}?…`, plus synchronous emit to subscribers (`pushState` fires no native event).
- `subscribeWorkspace(listener)` — `popstate` listener + internal subscriber set; returns
  unsubscribe.

### 2. Tests — `src/utils/__tests__/urlRouter.test.ts`
- Pathname parsing for every `WORKSPACE_KEYS` member (incl. `roadAnalysis` casing).
- Legacy fallback: `#/roadAnalysis`, `#roadAnalysis`, `#/roadAnalysis?tab=compare`.
- Precedence: `/dashboard` + stale `#/roadAnalysis` → `dashboard`.
- Unknown path → `DEFAULT_WORKSPACE`; `isExplicitRoute` true/false cases; `/index.html`
  treated as non-explicit.
- `pushWorkspace` pushState + emit; `replaceWorkspace`; `popstate` emit; query serialization
  (`/data?subgrid=N93E70`).

### 3. `src/App.tsx` call sites
- Initial `currentPage` + `showLanding` state → `parseWorkspace()`/`isExplicitRoute()`.
- `goToWorkspace` (4× `setHashWorkspace`) → `pushWorkspace`.
- Hash subscription effect → `subscribeWorkspace`.
- Sign-out → `replaceWorkspace('landing')`; `triggerGate` → `parseWorkspace()` /
  `pushWorkspace('onboarding')`.

### 4. Subgrid handoff (transient URL state)
- `DatasetRegistryPanel.tsx` + `QAConsultPanel.tsx`: `window.location.hash = '#data?subgrid=…'`
  → `pushWorkspace('data', { subgrid: sg })`.
- `DataManagementPage.tsx`: read filter from `window.location.search` (legacy-hash fallback
  kept), on-mount read preserved.

### 5. Remaining navigation surface
- `ProjectOnboarding.tsx`: `window.location.hash = '#/landing'` → `pushWorkspace('landing')`.
- Remove `src/utils/hashRouter.ts` and its test; update type-only imports in
  `workspaceLocation.ts`, `workspaces.tsx`, `WorkspaceSidebarNav.tsx` (+ its test).

### 6. Docs
- README §Client Routing: describe the path-based router (`/dashboard`, `/data`,
  `/roadAnalysis`, …).

## Verification
- `npm test` (vi, incl. rewritten urlRouter suite) — green.
- `npm run build` (`tsc -b && vite build`) — clean.
- `npm run lint` — 0 errors.
- Manual: direct-load + refresh `/roadAnalysis`; back/forward; legacy `#/roadAnalysis`
  bookmark; signed-out deep-link → Landing; unknown `/nope` → Dashboard;
  Production→Data handoff applies the `subgrid` filter.

## Rollback
`git revert` of the migration — no data effect either way. Routing is purely client-side,
so reverting restores hash URLs with zero database involvement.