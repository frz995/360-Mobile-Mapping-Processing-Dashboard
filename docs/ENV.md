# Environment Variables — Usage-Site Reference

> Every `VITE_*` variable is **optional**. When absent, the app falls back to
> a safe in-code default (noted inline). Source of truth: `.env.example`.
>
> Values are only baked in at **build time** — you must restart `vite dev` /
> rebuild after editing `.env`.

## Supabase / database

| Variable | Purpose | Default | Usage site |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL | `''` (empty → client warns) | `src/services/supabase.ts:7,15,1682` |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (used by client) | `''` | `src/services/supabase.ts:8,15`; `src/components/AdminSettingsView.tsx:774` |
| `VITE_SUPABASE_KEY` | Legacy alias for the anon key | falls back to `ANON_KEY` | `src/services/supabase.ts:8` |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server/admin ops) | `''` (not used by browser client) | `.env.example` only |
| `VITE_SUPABASE_BUCKET` | Primary image storage bucket | `MMS_PIC` | `src/services/supabase.ts:253,1462,1683` |
| `VITE_STORAGE_BUCKET` | Alias for the storage bucket | `MMS_PIC` | `src/services/supabase.ts:253,1462` |
| `VITE_DB_PANORAMAS_TABLE` | Panoramas table name | `panoramas` | `src/services/supabase.ts:1287,1510` |
| `VITE_DB_SUMMARY_VIEW` | Subgrid summary view name | `panoramas_subgrid_summary` | `src/services/supabase.ts:1511` |
| `VITE_DB_BATCH_LOGS_TABLE` | Batch-logs table name | `batch_logs` | `src/services/supabase.ts:1512` |
| `VITE_DB_QA_DEFECTS_TABLE` | QA defect records table | `qa_defects` | `src/hooks/useQAQCWorker.ts:575`; `src/services/supabase.ts:1288,1347` |
| `VITE_DB_QAQC_RUNS_TABLE` | QA audit-run summaries table | `qaqc_audit_runs` | `src/services/supabase.ts:315,1374,1422` |
| `VITE_DB_AUDIT_LOGS_TABLE` | Audit log table | `audit_logs` | `src/services/supabase.ts:1514` |
| `VITE_DB_STAGING_TABLE` | Staging panoramas table | `staging_panoramas` | `src/services/supabase.ts:1515` |
| `VITE_DB_NOTIFICATIONS_TABLE` | In-app notifications table | `notifications` | `src/services/supabase.ts:1516` |

## WebGIS / map iframe

| Variable | Purpose | Default | Usage site |
| --- | --- | --- | --- |
| `VITE_MAP_URL` | Base URL of the embedded 360 map / WebGIS app | `https://mobilemapping-nine.vercel.app` | `src/components/AdminSettingsView.tsx:2298,2341`; `src/components/MapComponent.tsx:435`; `src/components/DeletionSelectionMap.tsx:152`; `src/components/QAQCWorkbench.tsx:2262` |

## Storage providers & CDN

| Variable | Purpose | Default | Usage site |
| --- | --- | --- | --- |
| `VITE_STORAGE_PROVIDER` | Active provider: `cloudflare_r2 \| s3 \| gcs \| azure \| wasabi \| nas_local \| supabase` | `cloudflare_r2` | `src/services/supabase.ts:1564`; `src/components/AdminSettingsView.tsx:269`; `src/components/MapComponent.tsx:324` |
| `VITE_R2_DOMAIN` | Cloudflare R2 public CDN domain | derived per-call | `src/services/supabase.ts:1585` |
| `VITE_IMAGE_CDN_URL` | Generic image CDN base URL | derived per-call | `src/services/supabase.ts:1586` |
| `VITE_S3_BUCKET` / `VITE_S3_REGION` | S3 bucket + region | region `ap-southeast-1` | `src/services/supabase.ts:1644,1651` |
| `VITE_GCS_BUCKET` | Google Cloud Storage bucket | `''` | `src/services/supabase.ts:1652` |
| `VITE_AZURE_ACCOUNT` / `VITE_AZURE_CONTAINER` | Azure Blob account + container | `''` | `src/services/supabase.ts:1659,1660` |
| `VITE_WASABI_BUCKET` / `VITE_WASABI_REGION` | Wasabi bucket + region | region `us-east-1` | `src/services/supabase.ts:1667,1668` |

## NAS / production pipeline worker

| Variable | Purpose | Default | Usage site |
| --- | --- | --- | --- |
| `VITE_NAS_SERVER_URL` | NAS host / root URL | `''` | `src/services/supabase.ts:1675`; `src/components/production/storage/OverviewPanel.tsx:167`; `.../BrowserPanel.tsx:93` |
| `VITE_NAS_WORK_BASE_PATH` | Default NAS work directory for jobs | `''` | `src/components/production/common.ts:31` |
| `VITE_PRODUCTION_API_URL` | External worker / API base URL | `''` | `src/components/production/common.ts:26,50` |
| `VITE_PRODUCTION_API_KEY` | Shared secret for the worker API | `''` | `src/components/production/common.ts:35` |

## Observability (added Phase 7)

| Variable | Purpose | Default | Usage site |
| --- | --- | --- | --- |
| `VITE_SENTRY_DSN` | Sentry ingest DSN. When **absent**, Sentry is a complete no-op (no network calls) | `''` | `src/lib/sentry.ts:4` |
| `VITE_DATA_QUIET` | `1` = suppress non-fatal GPU/analysis console noise (dev-only) | off | `src/lib/quiet.ts:7,13` |

---
**Security note:** `VITE_*` values are embedded in the shipped client bundle.
Never put real service-role keys or NAS passwords here — those must live
server-side only.
