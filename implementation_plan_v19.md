# Implementation Plan v19 — Dynamic Multi-Provider Frame Counting (Manifest-based)

## Goal

Give the dashboard **dynamic, correct frame counts** regardless of which object-storage
provider backs the 360° panoramas — while **preserving the exact counting contract** the
existing Supabase default logic already establishes (`fetchSupabaseData` →
`resolveStorageFiles` → `FileInventoryResult`: `fileSet` + `countsBySubgrid` + `totalFiles`).

The default Supabase path (`file_inventory` table → `storage.list()` bucket enumeration) is
**unchanged**. For every other provider (Cloudflare R2, AWS S3, GCS, Azure Blob, Wasabi,
NAS, custom CDN) the frame count is sourced from a **public `manifest.json`** the upload
pipeline writes next to the images — the same public URL the app already uses to resolve
panorama URLs (`resolvePanoramaUrl`), so **no secrets** and **no S3 ListObjects** are needed.

Multi-res tile pyramids are folded down to **distinct station folders** (1 station = 1
`{pointFolder}` = 1 frame), so tile faces/levels are never miscounted as frames.

## 1. Manifest contract

Written by the upload pipeline to the **bucket root**:

```json
{
  "version": 1,
  "layout": "multires_tiles",                 // or "single_equirectangular"
  "frames": [
    { "subgrid": "N93E70", "pointFolder": "N93E70-0015", "filename": "N93E70-0015.jpg",
      "path": "tiles/N93E70/N93E70-0015/config.json" },
    { "subgrid": "N93E70", "pointFolder": "N93E70-0016", "filename": "N93E70-0016.jpg",
      "path": "tiles/N93E70/N93E70-0016/config.json" }
  ]
}
```

- `layout` wins over settings; when absent, `imageStorageStrategy` decides.
- Default manifest URL: `<provider base URL>/manifest.json` (configurable via `manifestPath`,
  disableable via `manifestEnabled`).

## 2. New pure module `src/services/storageInventory.ts`

Mirrors the `storageUrls.ts` pure-module split (stateless, testable, no client imports).

- `resolveStorageProvider(settings)` — `settings.storageProvider || VITE_STORAGE_PROVIDER ||
  'cloudflare_r2'` (identical default to `resolvePanoramaUrl`).
- `resolveProviderBaseUrl(settings)` — provider-aware object base, replicating
  `resolvePanoramaUrl`'s per-provider base construction:
  - `cloudflare_r2` / `custom_cdn` → `r2Domain → r2PublicUrl → r2PublicDomain →
    customCdnUrl → cloudStorageBaseUrl → VITE_R2_DOMAIN → VITE_IMAGE_CDN_URL`.
  - `aws_s3` → `https://{s3Bucket}.s3.{s3Region}.amazonaws.com`.
  - `gcs` → `https://storage.googleapis.com/{gcsBucket}`.
  - `azure_blob` → `https://{azureAccount}.blob.core.windows.net/{azureContainer}`.
  - `wasabi` → `https://s3.{wasabiRegion}.wasabisys.com/{wasabiBucket}`.
  - `nas_local` → `nasServerUrl`.
  - `supabase` → `''` (manifest is never used for Supabase storage).
- `buildManifestUrl(settings)` — `base + manifestPath (default 'manifest.json')`.
- `fetchFrameManifest(url, timeoutMs=5000)` — fetch/validate; returns `null` on 404, bad JSON,
  network error, or timeout. Never throws.
- `countFramesFromManifest(manifest, settings)` → same shape as `FileInventoryResult`
  (`fileSet` of lowercase full + basename filenames, `countsBySubgrid` per subgrid,
  `totalFiles`):
  - **multires**: collapses repeated `{subgrid}:{pointFolder}` so `totalFiles`/counts =
    **station count** (not tile files).
  - **single**: one entry = one frame.

## 3. `src/services/supabase.ts` (minimal, non-breaking)

- `FileInventoryResult` gains optional `fromManifest?: boolean`.
- `resolveStorageFiles(candidates, storageSettings?)`:
  - Cache key extended with `provider / manifestPath / baseUrl / strategy` for non-Supabase.
  - When `provider !== 'supabase'` and `manifestEnabled !== false`: fetch the manifest first;
    on success return counts (marked `fromManifest`). On any failure **fall through to the
    legacy path unchanged** (`file_inventory` → `storage.list()`), so Supabase-bucket counts
    still work even when a provider is misconfigured.
  - `provider === 'supabase'` → **byte-for-byte existing behaviour**.
- `fetchSupabaseData` passes `settings` into the resolver (supabase.ts:691 call site).

## 4. Settings & UI

- `defaults.ts`: `MANIFEST_PATH_DEFAULT = 'manifest.json'`.
- `types/admin.ts` + `storageUrls.ts` `StorageResolveSettings`: optional `manifestEnabled?`,
  `manifestPath?` (persisted as JSONB in `project_settings.settings`).
- `AdminSettingsView` (SUB-CARD A, shown when provider ≠ supabase): "Frame Manifest (Dynamic
  Frame Count)" block — enable toggle + path input + **Verify Manifest** action that fetches
  `buildManifestUrl` and reports frame count/layout.

## 5. Pipeline tooling

- `scripts/generate_manifest.mjs`: scans a NAS deliverable folder, auto-detects layout
  (`tiles/**/config.json` → multires; root images → single), writes `manifest.json`.
- `dataLifecycle.generateUploadScript` appends the manifest step:
  - `node scripts/generate_manifest.mjs …`
  - `rclone copyto manifest.json r2:<bucket>/manifest.json` (R2),
  - `aws s3 cp …` (S3), or a supabase-storage upload note.
- `WebGISHandoffCard` shows the extended snippet automatically.

## 6. Tests

- `src/services/__tests__/storageInventory.test.ts`: provider/default resolution, per-provider
  base URLs, manifest URL building (settings + env fallback), fetch success/404/invalid/throw,
  multires station collapse vs single per-file counting, subgrid grouping, fileSet basenames.
- `src/utils/__tests__/dataLifecycle.test.ts`: new expect for the manifest generation step.
- Existing suite stays green (Supabase path unchanged).

## 7. Verification

- `npx tsc -b`
- `npx vitest run`
- `node scripts/lint.mjs`

## 8. Out of scope / notes

- No DB migration (settings are JSONB).
- No live S3/R2 `ListObjects` enumeration — public manifest is the source of truth for
  non-Supabase providers; `file_inventory` remains the server-side snapshot fallback.
- Supabase default logic is intentionally untouched.