# 🌐 GeoSphere 360 System Architecture, Design Language & Engineering Rules

## 1. System Mission & Identity
GeoSphere 360 is a production-grade enterprise dashboard for 360° mobile mapping, spatial trajectory validation, QA/QC defect inspection, and GIS analytics.
- **Client & Infrastructure:** Built for high-precision utility and road survey data operations (TNB / National Grid).
- **Core Standard:** Production-first. **NEVER introduce hardcoded mock data, temporary shortcuts, or client-only local storage as the system of record for production features.**

---

## 2. Visual Design System & Theming Integrity
Maintain visual harmony and cohesion across all workspaces.

### 2.1 Preserved Theme Tokens
All views must strictly inherit the 7 built-in themes defined in `src/themes.css` using semantic CSS variables:
- `--bg-app`: Root application canvas (`#0e1117`, `#070b14`, `#f3f4f6`, etc.)
- `--bg-card`: Main panel, workspace canvas, and modal surfaces (`#161920`, `#0c1222`, `#ffffff`, etc.)
- `--bg-inner`: Secondary containers, inputs, list items, and toolbars (`#1f242e`, `#141e33`, `#f8fafc`, etc.)
- `--border-subtle`: Structural boundaries and borders (`#2a303c`, `#1e293b`, `#e2e8f0`, etc.)
- `--divider`: Internal dividers and table separators (`rgba(255,255,255,0.06)`, etc.)
- `--text-primary` / `text-text-base`: High-contrast headings and body text
- `--text-muted`: Secondary captions, metadata, and timestamps
- `--card-shadow`: Depth and elevation shadow

### 2.2 Strict Visual Constraints
- **NO Generic Text Boxes:** Never add generic red/blue/green boxes or ad-hoc background banners.
- **NO Random Gradients or Colorful Fonts:** Avoid saturated novelty gradients, rainbow badges, or unapproved display fonts.
- **NO Invalid Tailwind Slash-Opacity on Hex Variables:** In `tailwind.config.js`, colors like `card` map to `var(--bg-card)`. Writing `bg-card/90` or `bg-inner/80` produces invalid CSS (`rgb(#161920 / 0.9)`). Always use solid classes (`bg-card`, `bg-inner`, `border-subtle`) or direct CSS variable declarations (`var(--bg-card)`).
- **Component Language:** Use pill badges with `<StatusDot />`, subtle borders (`border border-subtle`), rounded corners (`rounded-xl` / `rounded-2xl`), and glassmorphic overlays (`backdrop-blur-md`).

### 2.3 Canonical Workspace Header & Canvas Standard
Every workspace (`RoadAnalysisWorkspace`, `LineageWorkspace`, `AnalyticsWorkspace`, `ReportsWorkspace`, `NASStorageWorkspace`) must adhere to this exact structural hierarchy:

```tsx
<div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
  <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto md:overflow-hidden p-4">
    {/* Standard Header Row */}
    <div className="px-1 flex items-center justify-between gap-3 shrink-0 flex-wrap">
      <div>
        <h2 className="text-base font-bold text-text-base tracking-wide">
          {title}
        </h2>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
          {subtitle}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
      </div>
    </div>

    {/* Standard Main Panel Canvas */}
    <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Tab strip or content */}
    </div>
  </div>
</div>
```
- **Never add standalone icon boxes, uppercase category labels, or decorative tags to the main workspace header.**

---

## 3. Frontend Architecture & GIS Integrations

### 3.1 Hash Navigation & Routing
- Handled via `src/utils/hashRouter.ts`.
- Routing is case-insensitive against `WORKSPACE_KEYS` (`src/types/navigation.ts`).
- When adding or modifying a workspace, ensure its key exists in `WORKSPACE_KEYS` and the definition exists in `WORKSPACE_DEFINITIONS`.

### 3.2 Mapping Engines
- **MapLibre GL (`RoadAnalysisMap.tsx`):**
  - Worker must always be loaded via Vite's bundled worker URL:
    ```ts
    import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
    maplibregl.setWorkerUrl(import.meta.env?.VITE_MAPLIBRE_WORKER_URL || workerUrl);
    ```
  - Always attach a `ResizeObserver` to the map container to prevent blank/white canvases during flex layout recalculations or sidebar animations.
  - Implement `areStylesEqual` to prevent tearing down the map canvas when non-style React state updates.
- **Leaflet & Esri Layers:**
  - Preserve all tile providers, spatial boundaries, and trajectory polyline renderers in `useAppData` and operational center views.
- **PhotoSphereViewer (PSV 5.x):**
  - Integrated in `PhotoSphereViewerComponent.tsx` for 8K equirectangular images with heading compass, QA marker overlays, and keyboard hotkeys (`A`/`D` navigation).

### 3.3 QA/QC Web Worker
- Offload compute-heavy trajectory validation and defect threshold calculations to `src/workers/qaqc.worker.ts` so the UI remains fluid at 60 FPS.

---

## 4. Backend, Supabase & Production Persistence

### 4.1 Production State of Record
- **Supabase is the single source of truth.** Client `localStorage` is ONLY an offline fallback cache.
- User-specific preferences and workspace configurations must be persisted to:
  1. **Supabase Auth User Metadata (`auth.users.raw_user_meta_data`):** via `supabase.auth.updateUser({ data: { ... } })` so configurations follow the authenticated user across devices and browsers.
  2. **`project_settings` PostgreSQL Table:** with `id: 'default'` for shared project settings, with live PostgreSQL realtime sync.
  3. **`audit_logs` PostgreSQL Table:** every state save must be logged via `saveAuditLogToSupabase` (`EDIT` event with user identity, timestamp, and details) for enterprise traceability.

### 4.2 Explicit Save Controls
- Workspace and region configurations must provide clear, user-triggered **Save** buttons with interactive states:
  - **Idle:** `<Save size={13} /> Save State`
  - **In Progress:** `<Loader2 size={13} className="animate-spin" /> Saving to Database…`
  - **Success:** `<Check size={13} /> Saved to Cloud` with timestamp badge (`Saved HH:MM`).

---

## 5. Data Integrity & Frame Counting Rules
Adhere strictly to `.agents/rules/frames_count_logic.md`:
1. **Never Assume POIs Equal Frames:**
   - `poiCount` = Trajectory CSV coordinate points.
   - `availableImagesCount` = Actual `.jpg` files verified to exist in the Supabase `MMS_PIC` storage bucket matching that track's exact filename sequence.
2. If an imported track has 100 POIs but 0 images uploaded to the bucket, its available frame count is strictly `0 frames`.

---

## 6. Verification Protocol Before Shipping
Before committing or presenting code changes:
1. **TypeScript & Production Bundle:**
   ```bash
   npm run build
   ```
   Must complete with **0 type errors** (`tsc -b`) and successful Vite bundling.
2. **Automated Unit Tests:**
   ```bash
   npm run test
   ```
   All test suites (194+ tests) must pass.
3. **No Regressions:** Verify that existing Supabase/PostGIS integrations, Leaflet layers, 360 viewer controls, QA/QC exports, and theme toggling remain fully operational.
