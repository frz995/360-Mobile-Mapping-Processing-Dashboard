# Issue Backlog: Defect Count & SLA Health Logic Verification

**Status**: Resolved  
**Date Logged**: 2026-09-04  
**Date Resolved**: 2026-09-04  
**Impacted Components**:
- `src/components/dashboard/DashboardBatchTable.tsx` (DEFECTS column for daily and masterlist rows)
- `src/components/dashboard/DashboardKpiSummary.tsx` (Card 4: PIPELINE QUALITY SLA HEALTH)
- `src/services/supabase.ts` (`fetchSupabaseData`, `saveQaAuditRunToSupabase`, `fetchQaAuditRunsFromSupabase`)
- `src/App.tsx` (`pipelineHealthPercent`, `totalDefects`, `handleRefreshMap`, `startQAQCInspection`)
- `src/hooks/useAppData.ts` (Data hydration, defect clamping, and offline `localStorage` fallback)
- `src/utils/__tests__/defectAndSlaHealth.test.ts` (New unit test suite)

---

## 1. Problem Description & User Decisions

The user flagged two specific UI anomalies:
1. **Pipeline Quality SLA Health Card**: Displayed `100.0% Normal` with `0 Defect Frames Flagged`.
2. **Batch Table DEFECTS Column**: Displayed `0`, `0`, `0` for all daily subgrid rows (`N94E70`, `N93E70`, `N94E71`).

### User Decisions (Interactive Clarification):
- **A1 (DEFECTS Column)**: Count defect images detected from **Batch Acquisition QC** (`qaqcWorker` / `startQAQCInspection` runs).
- **A2 (SLA Health %)**: Computed as `((Total POIs - Total Defects/Discrepancies) / Total POIs) * 100%`.

---

## 2. Root Cause Analysis

1. **Aggressive Frame Zero-Clamping**:
   - In `supabase.ts`, `useAppData.ts`, `DashboardBatchTable.tsx`, and `App.tsx`, defect counts were subjected to:
     ```typescript
     const defects = finalImageCount === 0 ? 0 : Math.min(cachedDefectCount, finalImageCount);
     ```
   - For subgrids like `N94E70` where raw image uploads are pending storage sync (`verifiedImagesCount = 0`), this forced `defects = 0` and wiped out the QAQC audit status, even though 100 POI stations were staged in the database and inspected.
   - In `DashboardBatchTable.tsx`, the masterlist loop had `if (fCount === 0) return;` which skipped counting daily defects entirely when storage frames were 0.

2. **SLA Health Denominator Mismatch**:
   - `App.tsx` used `totalFramesForHealth = totalImages;` (108 storage-verified frames) instead of `Total POIs` (273 total staged survey stations).
   - Because `totalDefects` was zeroed out by the clamping bug, the formula gave `(108 - 0) / 108 = 100.0%`.

3. **Silent QAQC Audit Cache Eviction on 431 Network Failures**:
   - When requests failed due to HTTP 431 headers, `saveQaAuditRunToSupabase` failed silently without updating local storage fallback. Page reload resulted in empty in-memory state.

---

## 3. Implementation Resolution

1. **Defect Preservation Without Storage Clamping (`src/services/supabase.ts`)**:
   - Replaced `finalImageCount === 0 ? 0 : Math.min(...)` with:
     ```typescript
     const defects = (poiCount > 0 || finalImageCount > 0)
       ? Math.min(cachedDefectCount, Math.max(poiCount, finalImageCount))
       : cachedDefectCount;
     ```
   - Added immediate local caching fallback (`app_qaqc_audit_cache_v2`) to `saveQaAuditRunToSupabase`, `fetchQaAuditRunsFromSupabase`, and `fetchSupabaseData`.
   - Aggregated `recordDefects` across multiple survey track rows in `publishedGrouped` and `stagingGrouped`.

2. **Table Defect Rendering (`src/components/dashboard/DashboardBatchTable.tsx`)**:
   - Removed `if (fCount === 0) return;` and `batchFrames > 0 ? ... : 0` guards.
   - Capped defects against `poiCount` or `batchFrames` when available, preserving QAQC inspection counts even while storage files are uploading.

3. **POI-Based SLA Health Calculation (`src/App.tsx`)**:
   - Updated `totalPoiForHealth` to sum `getPOICount` across daily rows (`273` total POIs) rather than storage-verified count (`108`).
   - Updated `pipelineHealthPercent = totalPoiForHealth > 0 ? (Math.max(0, ((totalPoiForHealth - totalDefects) / totalPoiForHealth) * 100)).toFixed(1) : null;`.
   - Updated `handleRefreshMap` to preserve defect counts and QAQC status without zeroing them out.
   - Enhanced `startQAQCInspection` completion callback to store audit results into `app_qaqc_audit_cache_v2`.

4. **Data Hydration (`src/hooks/useAppData.ts`)**:
   - Merged `app_qaqc_audit_cache_v2` into `cloudAuditMap` during hydration.
   - Preserved `defectCount` bounded by `poiCount` and `frameCount`.

5. **Test Suite Verification**:
   - Added `src/utils/__tests__/defectAndSlaHealth.test.ts` (7 tests).
   - Added tests in `src/hooks/__tests__/useAppData.test.tsx` for zero-frame defect preservation and local cache hydration.
   - Full Vitest suite passes cleanly: **27 test files, 238 tests passing**.

