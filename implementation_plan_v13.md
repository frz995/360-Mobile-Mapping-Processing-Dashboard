# Implementation Plan v13 — De-Hardcoding Pass (production readiness)

## Objective
Remove production-unfriendly hardcoded values so that **secrets** and
**environment-specific** values come from env vars only, and **generic
functional defaults** are centralized. Approved decisions:

- PIC fallbacks: auth-derived, neutral `'Operator'` fallback (drop person name).
- Supabase/Map URLs: **no silent production fallback** — missing env surfaces as
  a broken/relative URL plus an explicit startup warning, never the prod project.
- Scope: full pass across source; tests updated; behaviour-tolerant changes only
  where approved (fallback strings / URL defaults).

## Status
**COMPLETE** — committed & pushed. Gates green: `tsc -b --force` clean, lint 0 errors, 284/284 tests.

## Phases
1. ✅ Remove dead stub JWT `'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'`
   (`useAppData.ts:41`, `AdminSettingsView.tsx:912,2775`) — runtime key is
   env-only (`supabase.ts:28`). Public anon-key field now readOnly (env-only).
2. ✅ `'Fariz.farhan95'` / `'Fariz Farhan'` → auth-derived, fallback `'Operator'`
   (`picFormat.ts` default arg, `DataManagementPage.tsx`, `DashboardBatchTable.tsx`,
   `App.tsx`, `DailyHandoverModal.tsx`).
3. ✅ Supabase project URL + WebGIS map URL: remove hardcoded prod/HQ fallbacks,
   keep env-only (`storageUrls.ts`, `useAppData.ts`, `AdminSettingsView.tsx`,
   `DeletionSelectionMap.tsx`, `MapComponent.tsx`, `QAQCWorkbench.tsx`, `App.tsx`).
   ✅ Explicit `Missing VITE_SUPABASE_URL / VITE_MAP_URL` startup warning in App.
   ✅ Ops script `scripts/clear_all_survey_data.cjs` now requires env credentials
   (no committed publishable-key fallback).
4. ✅ Centralize SDK defaults in `src/config/defaults.ts`
   (`STORAGE_BUCKET_DEFAULT`, `DATABASE_TABLE_DEFAULTS`, `REGION_DEFAULTS`,
   `S3_BUCKET_DEFAULT`, `AZURE_CONTAINER_DEFAULT`, `DATABASE_HOST_DEFAULT`,
   `DEFAULT_BASEMAP`); wired into `storageUrls.ts`, `supabaseConfig.ts`,
   `supabase.ts`, `useAppData.ts`, `AdminSettingsView.tsx`, `MapComponent.tsx`
   — identical default values, no output change.
5. ✅ Type all referenced `VITE_*` vars in `vite-env.d.ts`.
6. ✅ Update affected unit tests + defaults coverage
   (`src/config/__tests__/defaults.test.ts`); gates green (see Status).
7. ✅ Commit + push as `refactor(config): remove prod-coupled hardcodes, centralize defaults`.

## Out of scope (this pass)
- UI restyle of project-settings screens (separate pass, after this commit).
- Server-only key handling / Supabase service role (frontend never uses it).
- WebGIS `mobilemapping` app (different repo).