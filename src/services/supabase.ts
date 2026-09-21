/**
 * Backward-Compatible Facade for Supabase and Database Services.
 *
 * Deconstructed in Implementation Plan v20 (Phase 2):
 * Domain logic is partitioned into `src/services/api/`:
 *   - `client.ts`: Supabase client initialization, proxy, session pruning, and backend reconfiguration
 *   - `storage.ts`: Storage provider resolution, inventory cache, and storage health checks
 *   - `qaqc.ts`: QA/QC defect logs, audit runs, and defect resolution
 *   - `roadTrace.ts`: Road analysis configuration and regional workspace state
 *   - `jobs.ts`: Processing job queue management, QA decisions, and external handoffs
 *   - `admin.ts`: System logs, notifications, health probes, users, and project settings
 *   - `datasets.ts`: Staging, publishing, dataset registry, masterlist overrides, and recycle bin
 *
 * All functions, types, and constants are re-exported here so existing callers
 * continue functioning without breaking changes.
 */

export * from './api';
export { formatPIC } from '../utils/picFormat';
export { getDatabaseTableMapping, type DatabaseTableMapping } from './supabaseConfig';
