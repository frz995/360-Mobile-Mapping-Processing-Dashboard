# Implementation Plan v8 — Survey Analytics Architecture & Executive Management Redesign

> **Scope**: Modernize and align the **Survey Analytics** workspace so executive management, project directors, and GIS processing engineers can clearly understand project survey progress. This plan eliminates data calculation anomalies (e.g. negative processed frames), bridges the contractual Road Analysis plan with production telemetry, and preserves the strict dark-mode GIS slate aesthetic with zero generic SaaS cards.
> **Binding Constraints**:
> - 100% preservation of existing dark-mode GIS slate aesthetic (`bg-card`, `bg-inner`, `border-subtle`, `font-mono`, clean SVG recharts).
> - Zero generic SaaS templates, bright gradient cards, or rainbow status chips.
> - Full backward compatibility with existing tabs (`Overview`, `Analytics/Ledger`, `Distance`, `Coverage`, `Density`, `Quality`).
> - Full quality gate compliance: `npx tsc -b` (0 errors) and `npm test` (all 29 test suites passing).

---

## 1. Problem & Architecture Overview

Currently, the system operates across three functional pillars:
1. **Production Workspace**: Handles end-to-end technical data processing (**RAW Ingestion $\rightarrow$ Staging $\rightarrow$ Processing Jobs $\rightarrow$ QA/QC $\rightarrow$ Reconciled Masterlist $\rightarrow$ Cloud Publishing**).
2. **Road Analysis Workspace**: Handles spatial analytics, comparing captured survey paths against official 5×5 km subgrid boundaries and OSM/GeoJSON road plans (e.g., Segamat district: **4,868.54 km across 168 subgrids**).
3. **WebGIS Workspace**: Public and client-facing delivery viewer for interactive map navigation, 360° panorama inspection, and street-level defect reviews.

### The Core Disconnect
`Survey Analytics` currently sits isolated from the geospatial context:
- It measures file row counts from database tables (`batch_logs`, `staging_panoramas`).
- It has **no awareness of the Road Analysis contractual baseline** (`targetKm` defaults to an arbitrary or empty number).
- It produces mathematical artifacts that confuse executives, such as **`processed frames: -15`** (when staging raw frames exceed batch log entries).
- Donut chart labels like **`Staged: 1 • Partial: 2`** lack business context, leaving management unsure if they refer to subgrids, files, or web portals.

### Target Architecture:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Survey Analytics Workspace (v8)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Executive Milestone Header: 4,868.54 km Target | 3.37 km Captured (0.07%) │
├─────────────────┬──────────────┬──────────────┬──────────────┬──────────────┤
│  Overview Tab   │ Analytics    │ Distance     │ Coverage     │ Quality      │
│  Executive KPIs │ Reconciliation│ Subgrid Km   │ Spatial Grid │ Pass Rate &  │
│  Pipeline Health│ Ledger       │ Breakdown    │ Saturation   │ Defects      │
└─────────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
         ▲                               ▲                     ▲
         │                               │                     │
┌────────────────────────┐   ┌───────────────────────┐   ┌───────────────────┐
│ Road Analysis Baseline │   │ Reconciled Masterlist │   │ RAW Staging Table │
│ • 4,868.54 km Contract │   │ • 258 Verified Frames │   │ • 273 Ingested    │
│ • 168 Project Subgrids │   │ • 6 Survey Tracks     │   │ • 0 Defects       │
│ • Subgrid Boundaries   │   │ • 2 Active Subgrids   │   │ • 1 Staged Subgrid│
└────────────────────────┘   └───────────────────────┘   └───────────────────┘
```

---

## 2. Detailed Improvement Breakdown

### A. Fix Calculation Bugs & Confusing Terminology
1. **Eliminate Negative Delta (`-15`) in `OverviewPanel.tsx`**:
   - Current buggy logic: `t.frames - t.captureFrames` $\rightarrow$ `258 - 273 = -15`.
   - **New Logic**: Clearly display positive, independent pipeline stages:
     - **RAW Ingested**: `273 frames` (Amber badge)
     - **Masterlist Reconciled**: `258 frames` (Sky blue badge)
     - **QA Approved**: `0 frames` (Emerald badge)
     - **QA Flagged / Defects**: `0 frames` (Rose badge)
2. **Clarify Publication Status Donut Chart**:
   - Change ambiguous labels (`Staged: 1 • Partial: 2`) to explicit subgrid counts:
     - `1 Subgrid in Staging (Review Pending)`
     - `2 Subgrids Partial (Survey Ongoing)`
     - `0 Subgrids Fully Published (Live on WebGIS)`
3. **Explicit Progress Indicators**:
   - Show complete fractions instead of isolated percentages:
     - Distance Captured: **`3.37 km / 4,868.54 km (0.1%)`**
     - Frames Ingested: **`258 / 273 frames reconciled (94.5%)`**

---

### B. Bridge Road Analysis Contract Plan into Survey Analytics
1. **Dynamic Target Sync**:
   - When the operator loads or extracts a road plan in **Road Analysis** (e.g. Segamat's 4,868.54 km), `RoadAnalysisWorkspace` persists `planDistanceKm` into `projectSettings.roadAnalysisState`.
   - `AnalyticsWorkspace.tsx` reads `roadPlanKm = projectSettings?.roadAnalysisState?.planDistanceKm || projectSettings?.targetKm`.
   - `computeSurveyAnalytics` adopts this value as the authoritative project target, unifying the entire dashboard.

---

### C. Executive Management KPI Summary
Introduce a compact, slate-styled **Executive Progress Banner** at the top of the Overview tab:
- **Contract Completion**: `3.37 km / 4,868.54 km (0.07%)`
- **Subgrid Coverage**: `3 active of 168 project subgrids (1.8%)`
- **QA Pass Rate**: `100.0% (0 defects detected)`
- **Delivery Health**: `2 Subgrids Live on WebGIS • 1 Under Review`

---

## 3. Implementation Plan by File

### 1. `src/utils/surveyAnalytics.ts`
- Update `SurveyAnalyticsInput` to accept optional `roadPlanKm?: number` and `totalProjectSubgrids?: number`.
- Add explicit fields to `totals`:
  - `rawFrames`: Ingested staging frames (`t.captureFrames`).
  - `masterlistFrames`: Reconciled batch log frames (`t.frames`).
  - `effectiveTargetKm`: The resolved road plan distance.
  - `totalProjectSubgrids`: Total subgrid count from catalog/project boundaries.
- Ensure no subtraction produces negative numbers.

### 2. `src/components/production/analytics/OverviewPanel.tsx`
- Replace line 124 (`t.frames - t.captureFrames`) with `Masterlist Reconciled Frames`.
- Update progress bar labels to show `current / target` fractions.
- Clarify donut chart legend items with `Subgrid` units and operational statuses.
- Add the sleek dark-GIS **Executive Summary Strip**.

### 3. `src/components/AnalyticsWorkspace.tsx`
- Connect `projectSettings?.roadAnalysisState?.planDistanceKm` to `computeSurveyAnalytics`.
- Ensure seamless reactivity when project settings or saved states update.

### 4. `src/lib/i18n.ts`
- Update translation strings:
  - `analyticsKpiFramesSub`: `"Masterlist Reconciled"` (replacing `"processed frames"`).
  - Add descriptive tooltip text for Staged vs Published.

---

## 4. Verification & Testing

| Step | Command / Action | Acceptance Criteria |
| :--- | :--- | :--- |
| **Typecheck** | `npx tsc -b` | 0 errors |
| **Unit Tests** | `npm test` | All 29 suites pass (258+ tests) |
| **No Negatives** | Manual UI check | `processed frames: -15` is gone; shows positive `258 Reconciled` |
| **Target Fractions** | Manual UI check | `Distance Captured` displays `3.37 km / 4,868.54 km (0.1%)` |
| **Donut Clarity** | Manual UI check | Donut legend clearly indicates `1 Subgrid in Staging`, `2 Partial` |
| **Aesthetic Consistency** | Visual audit | Dark GIS slate styling preserved; zero generic SaaS cards |
