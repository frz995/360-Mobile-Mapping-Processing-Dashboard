# Implementation Plan v11

## Objective
Three issues to resolve on top of v10 (Road-Analysis fixes already shipped):

1. **RLS write failure** — "new row violates row-level security policy for table `project_settings`"
   shown as a Database Notice when a non-Administrator clicks Save State.
2. **Tab-switch map flash/stutter** — switching between the Allocation and Print tabs
   unmounts/remounts the whole map (full teardown + basemap tile reload + camera reset).
3. **Refresh always lands on the Login page** — persisted sessions are being destroyed on
   module load, so `getSession()` returns null after every refresh.

## Root Causes & Decisions

### 1. RLS block (admin-only writes)
- Migration `0010_security_rls_apply.sql` gates `project_settings` writes to
  `sec.can('manageSettings')`, which is **Administrator-only** (`0009_security_functions.sql`).
- All signed-in roles need to save Road-Analysis workspace state, but the shared
  `project_settings` row also holds admin-only provider credentials, so we must NOT open
  row-level writes to everyone.
- **Decision (v11): narrow SECURITY DEFINER RPC** `sec.save_road_analysis_state(jsonb, text)`
  that updates **only** the `settings.roadAnalysisState` key (preserves all other keys).
  `EXECUTE` granted to `authenticated` only — guests stay local-cache-only.

### 2. Allocation ↔ Print map flash
- The main area ternary unmounts the live `<RoadAnalysisMap>` when `activeTab === 'print'`
  and mounts the print map — and vice-versa. Each switch destroys + rebuilds a MapLibre map.
- **Decision (v11): dual-mount with visibility toggling.** The live map stays permanently
  mounted; the print preview map is lazily mounted on first print visit and kept alive.
  Switching tabs toggles `visibility`/`pointer-events` (map instances + tiles preserved)
  plus a `map.resize()` after switching to guarantee a clean canvas.

### 3. Refresh → Login page
- `pruneLocalStorageSession()` (runs at module load, `supabase.ts:108`) **deletes** any
  persisted `sb-*-auth-token` whose access token exceeds 1500 chars or whose raw blob is
  > 2000 bytes. A real Supabase session is normally > 2000 bytes raw, and any user with
  legacy/large metadata trips the 1500-char JWT check — so the session is wiped on every
  refresh → `getSession()` returns null → Login page.
- **Decision (v11): stop destroying sessions.**
  - Only purge the **one known bloat source** (legacy `roadAnalysisState` embedded in JWT
    user_metadata that the migration `0013` + `pruneBloatedUserMetadata()` are already
    removing server-side).
  - Extend `safeSupabaseFetch` header-swap (bloated Authorization → anon key) to **all**
    Supabase endpoints (currently `/auth/v1/*` is excluded, so oversized JWTs cause 431 on
    token refresh — killing the session). This keeps oversized sessions functional while
    the metadata slims permanently.
  - Verify migration `0013` is applied in the live DB (prunes `auth.users` metadata).

## File-by-File Changes

| File | Change |
| --- | --- |
| `supabase/migrations/0014_road_analysis_state_rpc.sql` (NEW) | `sec.save_road_analysis_state` SECURITY DEFINER function + `revoke public` / `grant authenticated` |
| `src/services/supabase.ts` | 1) `saveRoadAnalysisStateToSupabase` → RPC-first with legacy upsert fallback for missing function; 2) `pruneLocalStorageSession` only prunes legacy `roadAnalysisState` bloat; 3) `safeSupabaseFetch` swaps bloated Authorization on all endpoints |
| `src/components/RoadAnalysisWorkspace.tsx` | `printPanelMounted` state; keep live map always mounted; lazy-mount print panel; visibility toggle + `resize()` on tab switch |
| `src/components/roadAnalysis/__tests__/roadAnalysisState.test.ts` | (no code change expected — existing Supabase test still asserts boolean; may re-assert `success === false` for anon) |

## Verification Matrix
| Check | Method |
| --- | --- |
| Typecheck | `npx tsc -b --force` → 0 errors |
| Lint | `npm run lint` → 0 errors |
| Tests | `npm test` → all pass (incl. `roadAnalysisState` cloud test) |
| Print tab no-flash | Switch Allocation ↔ Print repeatedly; live map must not blank/reload after first print visit |
| First print still works | `RoadAnalysisPrintPanel` mounts on demand and prints on first use |
| Save State (operator role) | Sign in as Survey Operator / QA Inspector / Viewer → Save State → SUCCESS banner |
| Settings preserved | Verify other `settings` keys (providers/basemap) untouched after RPC save |
| Admin save regression | Administrator Save State still succeeds via RPC |
| Guest local-only | Guest session Save State does not write cloud (local cache only) |
| Refresh persistence | Sign in → hard refresh → still on Dashboard (session kept) |
| DB deployment | Apply `0014` to live project (SQL editor / `supabase db push`) |

## Non-Goals
- No change to per-user row semantics — shared `id='default'` row stays last-writer-wins.
- No new dependencies; no migration of existing stored data (v11 is additive).
- Audit-log writes (`audit_logs`) remain best-effort (unchanged).