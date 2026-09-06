# Implementation Plan v14 — Project Workspace & Sign-In Onboarding

## Objective
Add a first-class **Project layer** to the dashboard:

1. A **Project panel** (new workspace) where the operator sees the current project list,
   creates new projects, and loads recent projects.
2. A **current-project scope applied per load** — each project carries its own GIS scope
   (crs / region bbox / basemap / targets / contract / client), which overrides the matching
   `projectSettings` fields while the project is active. This gives "different area per
   project" behaviour by reusing the existing `enableBBoxFilter` + GIS-settings machinery —
   **without** repartitioning operational tables this pass.
3. A high-tier **sign-in gate** (Hybrid model):
   - **Welcome animation** — plays on first-ever login per user and on each app version
     change; never replays on plain sign-out → sign-in.
   - **Project picker** — shown on every authenticated sign-in as a one-tap
     "Continue with {last project}" flow (recent list + create project).
   - **Loading sequence** — "Getting ready for your workspace…" staged progress after a
     project is chosen, then the dashboard loads under that project.
   - Guests bypass the gate (read-only preview keeps the global single-project view).

## Decisions (confirmed)
- Projects stored in a new Supabase `projects` table + RLS, with a localStorage cache
  (`geosphere360_projects_v1`) mirroring the `project_settings` pattern.
- Active project persisted per user key (`geosphere360_active_project_<userKey>`, reusing the
  `getAuthStorageUserKey` convention from RoadAnalysis).
- Hard `project_id` partitioning of operational tables is **out of scope** (v15).
- Cosmetic choices delegated to implementer; customer-facing text flows through i18n
  (all 4 language blocks).

## Phases

### 1. Data model — `supabase/migrations/0008_projects.sql`
- `projects` table: `id uuid pk default gen_random_uuid()`, `name text not null`,
  `description text default ''`, `contract_code text default ''`,
  `client_name text default ''`, `region text default ''`,
  `status text default 'planning'` (`planning | active | paused | completed | archived`),
  `scope jsonb default '{}'`, `created_by uuid`, `created_at`, `updated_at`,
  `last_opened_at timestamptz`.
- RLS: authenticated users read all team projects; authenticated users may insert/update;
  deletion is a soft `archived` status (no DELETE policy — avoids hard-delete complexity).
- Mirror the existing migration style (`0001..0007` present, next number used).

### 2. Service — `src/services/projects.ts`
- Types: `UserProject`, `ProjectScope`, `ProjectStatus`.
- `fetchProjects`, `createProject`, `archiveProject`, `touchProjectOpened`,
  `applyProjectScope(baseSettings, project)`.
- localStorage helpers: `loadProjectsCache`/`saveProjectsCache`
  (`geosphere360_projects_v1`), `getActiveProjectKey(userKey)`,
  `loadActiveProject(userKey)`/`saveActiveProject(userKey, id)`/`clearActiveProject(userKey)`.
- Supabase queries guarded so missing env / RLS failures degrade gracefully to cache.

### 3. i18n — `src/lib/i18n.ts`
- Add workspace keys `workspaceProject`, `workspaceProjectDesc` and picker/panel strings
  to all four language blocks (`en`, `ms`, `zh`, `ja`).

### 4. Workspace registration
- `src/utils/hashRouter.ts`: add `'project'` to `WorkspaceKey` + `WORKSPACE_KEYS`; update
  `src/utils/__tests__/hashRouter.test.ts`.
- `src/workspaces.tsx`: `WORKSPACES` entry (`Briefcase` icon, `live` tag) + a leading
  `projects` category in `WORKSPACE_CATEGORIES`.
- `src/App.tsx`: render branch `currentPage === 'project'` → `<ProjectWorkspace …>`.

### 5. `src/components/ProjectWorkspace.tsx`
- `Masthead` chrome: context "PROJECT MANAGEMENT", title, readouts (total / active /
  completed projects).
- `UnderlineTabStrip` (`all | active | archived`) persisted via `workspaceLocation`
  (refresh continuity).
- Left rail: project rows — name, region chip, status dot, contract code, last-opened,
  per-project determinate progress bar (ProcessStrip style), Open + active-project badge.
- Right pane: create-project form (name, contract code, client, region preset → auto-fill
  bbox/crs/targets via `REGION_DEFAULTS`, equipment, basemap, deadline).
- `EmptyState` for empty list, `Skeleton` rows while loading.

### 6. `src/components/ProjectOnboarding.tsx` + gate wiring
- Full-screen overlay on `bg-app` with blurred orb + `backdrop-blur-xl`; three stages
  (`welcome | pick | loading`).
- Welcome: brand mark, "Welcome, {name}" (`waterfallEnter` stagger), shimmer bar ~2.2s.
- Pick: Recent-projects rail with "Continue with {last project}", create form, "Skip for now".
- Loading: staged status lines + `aurora-shimmer` progress ~2.8s, then
  `applyProjectScope` + navigate to dashboard.
- `App.tsx`: `projectGate` state; set to `welcome` on `handleLogin` success (non-guest);
  decides welcome vs straight-to-picker via `geosphere360_welcome_seen_<userKey>` and
  `geosphere360_welcome_version` (vs new `APP_VERSION` in `src/config/defaults.ts`).
- Reset gate on sign-out / auth-null; guests stay `idle`.

### 7. Active project scope + header chip
- App-level `activeProject` state restored from `geosphere360_active_project_<userKey>`.
- Merge effect: `setProjectSettings(prev => ({ …prev, …scope, contractCode, clientName,
  projectName }))` when `activeProject` changes.
- Header chip after title block (`App.tsx` ~:2904): `bg-inner border border-subtle rounded-lg
  px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-muted`; click → Project panel.
- `touchProjectOpened` on load.

### 8. Tests & gates
- `src/services/__tests__/projects.test.ts` (CRUD + cache + active-project round-trip +
  scope merge; supabase mocked like `roadAnalysisState.test.ts`).
- `src/components/__tests__/ProjectWorkspace.smoke.test.tsx` (mirror
  `DataManagementPage.smoke.test.tsx`).
- Update `hashRouter` test if it asserts exact `WORKSPACE_KEYS` shape.
- Gates: `npx tsc -b` clean, `npm run lint` 0 errors + no new warnings, `npm test` green.
- Manual checklist: sign-in welcome→pick→loading→dashboard w/ project scope; welcome not
  replayed on sign-out→sign-in; guest bypass; refresh continuity; mid-session switch;
  version-bump replay resets `geosphere360_welcome_version`.

## Out of scope (v15+)
- Hard `project_id` partitioning of operational tables.
- Per-project map state inside the separate WebGIS app.
- Project analytics / SLA dashboards per project.
- Bulk import / duplicate detection for projects.