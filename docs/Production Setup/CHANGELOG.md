# GeoSphere 360 — Production Release Changelog

## Commercial Distribution & Reseller Readiness Release

This release hardens the GeoSphere 360 Mobile Mapping platform for commercial distribution across reseller channels, ensuring turnkey deployment and multi-cloud compatibility for enterprise customers.

---

### 1. Phase 1: Security & Pipeline Hardening

#### Station Agent Multi-Cloud CLI Execution
- **Issue:** Command-line sync invocations using `"&&"` string concatenation failed when passed to `subprocess.Popen(argv, shell=False)` on non-Windows/Unix workstations, causing sync failures for S3, Wasabi, GCS, Azure, and Supabase.
- **Fix:** Refactored `station-agent/app.py` to execute CLI commands in structured sequential `(argv, desc)` loops with individual step logging and error traps.
- **Verification:** Created unit test suite in `station-agent/tests/test_sync_cli.py` (5/5 passing).

#### Bucket Publication Gate Verification
- **Issue:** Supabase Storage `list()` was restricted to default 100 items per call. Surveys with hundreds or thousands of frames failed the 100% publication gate check.
- **Fix:** Added paginated Supabase Storage listing (`limit: 1000`, `offset` accumulator loop) in `BucketPublicationGate.tsx`, and expanded deliverable verification with multi-cloud candidate detection for Cloudflare R2, AWS S3, and Wasabi.
- **Verification:** Tested in `src/components/production/__tests__/BucketUploadLogic.test.tsx`.

#### Session Inactivity Lockout Bridge
- **Issue:** When operators actively interacted inside WebGIS or PhotoSphereViewer iframes, parent window pointer events were swallowed, triggering unintended 30-minute inactivity logouts mid-task.
- **Fix:** Added `window.blur` iframe focus detection and bidirectional `message` / `geosphere:activity` custom event listeners in `src/App.tsx` to automatically reset the inactivity timer on viewer interaction.

#### Continuous Integration Parity
- **Update:** Updated `.github/workflows/ci.yml` to execute automated pytest test suites for both `station-agent` and `worker` in addition to frontend linting and Vitest checks.

---

### 2. Phase 2: Schema Bootstrap, Turnkey Deployment & Documentation

#### Turnkey First Administrator Seeding CLI
- **Tool:** Added `scripts/seed-admin.mjs` (`npm run admin:seed`).
- **Feature:** Turnkey CLI utilizing `@supabase/supabase-js` Admin API (`service_role` key) to idempotently create or elevate users in both Supabase Auth (`auth.users`) and the internal directory (`public.user_accounts`). Eliminates manual SQL/Dashboard deadlock on fresh installations.

#### Consolidated Database Bootstrap Synchronization
- **File:** Synchronized `supabase/bootstrap.sql` across all 34 migrations (`0001` through `0035`), preserving byte-identical migration history while ensuring turnkey, single-script execution on fresh Supabase / PostgreSQL instances.
- **Verification:** Verified via `src/__tests__/bootstrap-migrations.test.ts` (30/30 unit tests passing).

#### Customer Documentation & Master Setup Guide
- **Update:** Updated `docs/Production Setup/01-Infrastructure.md`, `README.md`, and `docs/Production Setup/guide.html`.
- **Deliverable:** Re-rendered the complete 43-page client-facing setup manual: `docs/Production Setup/GeoSphere-360-Production-Setup-Guide.pdf` (1,375 KB).

---

### 3. Phase 3: Enterprise Privacy & Private Cloud Storage

#### High-Performance Signed URL Caching
- **Module:** Added `src/services/signedPanoramaUrls.ts`.
- **Features:**
  - In-memory TTL token caching (`signedCache`, 50-minute safe validity window with 5-minute pre-expiration eviction buffer).
  - Synchronous 0ms retrieval (`getCachedSignedPanoramaUrl`).
  - Single-frame on-demand signing (`ensureSignedPanoramaUrl`).
  - Multi-frame batch pre-signing (`batchPreloadSignedPanoramaUrls`) for rapid subgrid survey viewing.

#### Seamless Private Storage URL Resolution
- **Module:** Integrated private bucket resolution into `src/services/storageUrls.ts`.
- **Features:**
  - Added `isPrivateBucket?: boolean`, `useSignedUrls?: boolean`, and `signedUrlTtlSeconds?: number` to `StorageResolveSettings`.
  - Exported `sanitizeBucketName`.
  - Automatically routes private requests to `/storage/v1/object/authenticated/` or pre-signed provider URLs without breaking WebGL panorama viewers.
- **Verification:** Added comprehensive unit tests in `src/services/__tests__/signedPanoramaUrls.test.ts` (7 tests) and expanded `src/services/__tests__/storageUrls.test.ts` (16 tests). All 23 tests passing.

---

### 4. Phase 4: Commercial "Pre-Flight Doctor" CLI

#### Automated Pre-Flight System Diagnostics
- **Tool:** Added `scripts/doctor.mjs` (`npm run doctor`).
- **Capabilities:**
  1. **Runtime Verification:** Confirms Node.js (>= 18) and Python (>= 3.10) for Station Agent / Worker.
  2. **Environment & Configuration:** Validates `VITE_SUPABASE_URL`, anon public JWT, and optional `SUPABASE_SERVICE_ROLE_KEY`.
  3. **Database Schema & PostGIS:** Validates database connectivity, PostGIS availability, and verifies core tables (`projects`, `subgrids`, `panoramas`, `user_accounts`).
  4. **Administrator Readiness:** Checks that at least one active `Administrator` or `sysadmin` account exists in `user_accounts`.
  5. **Cloud Storage Connectivity:** Validates configuration for active cloud provider (`cloudflare_r2`, `aws_s3`, `wasabi`, `supabase`, `nas_local`).
  6. **Station Agent Status:** Probes local SD-card edge ingestion daemon connectivity (`http://127.0.0.1:8765`).
  7. **Actionable Remediation:** Outputs color-coded diagnostics with exact shell commands to resolve any detected issue.

---

### 5. Phase 5: Spatial Projection Protection & Workstation Tooling

#### Local Projected Grid Coordinate Guard
- **Module:** `src/utils/gisImportParser.ts`.
- **Feature:** Added `isLikelyLocalGrid` detection to guard local meter coordinates (e.g. Malaysian MRSO EPSG:3375, Cassini, or UTM projected coordinates where Easting/Northing are in the 500 to 2,000,000 range).
- **Protection:** Prevents these coordinates from being erroneously treated as Web Mercator (EPSG:3857), which would project them into the Atlantic Ocean. Emits clear advisory guidance instructing the operator to export as WGS84 (EPSG:4326) latitude and longitude.
- **Verification:** Tested in `src/utils/__tests__/gisImportParser.test.ts` (16/16 tests passing).

#### Workstation Cloud CLI Tool Detection
- **Tool:** Enhanced `scripts/doctor.mjs`.
- **Feature:** Probes workstation `PATH` for `rclone` or `aws` CLI binaries when configured for multi-cloud storage (`cloudflare_r2`, `aws_s3`, `wasabi`). Flags an advisory warning if missing so installers can equip ingestion workstations with native multi-cloud sync binaries.

---

### 6. Phase 6: Adaptive Dynamic NAS Stage & Grid Discovery

#### Multi-Grid & Custom Layout Support
- **Module:** `worker/nas_scan.py`.
- **Feature:** Added dynamic stage discovery (`_find_subgrid_containers`, `_find_subgrid_dir`, `_find_run_dir`):
  - **Multi-Grid Detection:** Automatically scans `Grid 1`, `Grid 2`, `Grid 3`, or any `Grid *` / `Zone *` folder.
  - **Flat Layouts:** Supports direct subgrid folders under stage roots (without requiring `Project-OUT` or `Grid 1`).
  - **Custom Stage Names:** Supports aliases for stitching (`03_Stitching`, `Stitched`, `Output`, `Panoramas`), metadata (`01_Metadata`, `Telemetry`, `GPS`), raw captures (`00_Raw_data`, `Raw`), and final deliverables (`05_Final`, `Deliverables`).
  - **Environment Overrides:** Supports optional explicit overrides (`NAS_STITCH_STAGE`, `NAS_METADATA_STAGE`, `NAS_RAW_STAGE`, `NAS_FINAL_STAGE`).
  - **Dynamic URL Paths:** Replaced hardcoded `/03_Stitching/Project-OUT/Grid 1/...` URLs with dynamically computed relative paths (`_rel_path_str`), ensuring `/api/images/...` previews work regardless of disk layout.
- **Verification:** Added 3 new test suites in `worker/tests/test_nas_scan.py` (**15/15 worker tests passing**).

---

### 7. Summary Verification Metrics

| Metric | Measured Value |
| :--- | :--- |
| **Vitest Frontend Test Suite** | **115 / 115 test files passed** (1,425 tests passed, 0 failures) |
| **Python Backend Tests** | **20 / 20 passed** (5 Station Agent + 15 Worker) |
| **ESLint & Quality Ratchets** | **0 errors**, warnings at baseline budget (1,251/1,251), all 33 files within budgets |
| **Production Build** | **Clean production bundle** compiled to `dist/` in ~30s |
| **Master Setup Manual** | **43-page visual setup guide** generated (`GeoSphere-360-Production-Setup-Guide.pdf`, 1,378 KB) |
