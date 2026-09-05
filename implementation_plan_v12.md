# Implementation Plan v12 — Monolith Split (Phase 1: URL Resolver Refresh)

## Objective
Reduce the maintainability risk of the ~64k-line `src` monolith WITHOUT changing any
behavior, runtime logic, function signature, or output. **This phase moves pure,
stateless helpers out of `src/services/supabase.ts` (3264 lines) into a dedicated,
typed module** and re-exports them unchanged, so every existing import site and test
keeps working byte-for-byte.

This is a *pure refactor*: no user-visible change, no environment change, no new
dependencies. The existing 263-test suite must stay green, `tsc` clean, lint at 0 errors.

## Why this module first
`resolvePanoramaUrl` / `resolvePanoramaConfigUrl` / `formatCloudflareUrl` are:
- pure (no Supabase client, no storage, no module state),
- the source of the R2 `…/fallback/` path contract (weeks ago this produced confusing
  `//fallback/f` 404s until the contract was verified),
- exercised by real unit tests already,
- imported by 10+ files via the barrel `supabase.ts` — the perfect place to prove the
  safe extraction pattern (`module + barrel re-export`) before tackling larger slices.

## Scope — Phases (all completed as pure refactors)
### Phase 1 (done) — moved to `src/services/storageUrls.ts`
- `StorageProviderType` (type)
- `ResolveUrlOptions` (interface)
- `StorageResolveSettings` (NEW typed settings interface — optional fields only, so it
  is structurally compatible with every existing caller; appends safety without changing behavior)
- `formatCloudflareUrl()`
- `resolvePanoramaUrl()`  — body copied verbatim, one type-only cast added for the
  provider union at the `const provider: StorageProviderType` line
- `resolvePanoramaConfigUrl()` — body copied verbatim

### Phase 2 (done) — moved to `src/utils/picFormat.ts` and `src/services/supabaseConfig.ts`
- `formatPIC()` → `src/utils/picFormat.ts` (pure, used internally + via barrel)
- `getDatabaseTableMapping()` + `DatabaseTableMapping` → `src/services/supabaseConfig.ts`
  (pure; zero internal callers in `supabase.ts`)

### Barrel `src/services/supabase.ts`
- All moved definitions removed from `supabase.ts` (~524 lines total across Phases 1-2).
- The moved symbols are imported from their new homes **and re-exported** with identical
  names (`export { … }` / `export type { … }`), preserving the exact public surface so
  all importers and all tests are untouched.

### Deliberately NOT moved (stateful / behavior-bearing — out of scope for a pure refactor)
- `formatPIC`'s sibling helpers below `SUBGRID_COORDINATES` remain internal.
- `SUBGRID_COORDINATES` — mutable shared runtime state (written by `supabase.ts` and
  read by 6+ modules); moving it adds risk with zero benefit.
- `extractSubgrid` (internal helper), the Supabase client + auth/session layer
  (`pruneLocalStorageSession` runs at module load), storage/batch-sync, audit, RPCs,
  health probes.

## Verification matrix (must all pass before commit)
| Gate | Command | Expected |
|---|---|---|
| Typecheck | `npx tsc -b --force` | 0 errors |
| Lint | `npm run lint` | 0 errors (warning count may stay ~898; no new warnings in changed files) |
| Unit tests | `npx vitest run` | 30+ files / 263+ tests passed |
| Diff review | `git diff` | Changes confined to `supabase.ts` (imports + deletions), new modules under `src/services/` + `src/utils/`, new test files, plan doc |

## New tests (additive, never modify existing tests)
`src/services/__tests__/storageUrls.test.ts`:
- `formatCloudflareUrl` normalizes (no scheme → https, no trailing slash, empty → '')
- `resolvePanoramaUrl` flat R2 URL
- `resolvePanoramaUrl` multires fallback with subgrid + default pattern → `…/fallback/f.jpg`
- `resolvePanoramaUrl` custom `multiResFallbackPattern` template substitution
- `resolvePanoramaConfigUrl` R2 pattern + Supabase-provider storage URL
- typed `StorageResolveSettings` accepted from a plain object literal (documented contract)

`src/utils/__tests__/picFormat.test.ts`:
- capitalization, fallback for empty/placeholder names, unchanged non-placeholder names

`src/services/__tests__/supabaseConfig.test.ts`:
- smart defaults + explicit settings overrides for `getDatabaseTableMapping`

## Out of scope / explicitly NOT done
- No logic changes, no runtime behavior changes, no error-message changes.
- No `pruneBloatedUserMetadata()` invocation, no env-gate, no hardcoded-URL removal
  (those are Phase 2+ candidates and would alter behavior).
- No changes to the WebGIS `mobilemapping` app.