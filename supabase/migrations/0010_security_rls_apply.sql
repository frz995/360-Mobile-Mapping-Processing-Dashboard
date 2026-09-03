-- =====================================================================
-- GeoSphere 360 — Apply role-guarded RLS to privileged tables (Stream A1.2)
--
-- Replaces the "any authenticated user may write" policies on the five
-- privileged tables with role-guarded ones backed by `sec.can()` /
-- `sec.get_app_role()` (see `supabase/security_functions.sql`, A1.1).
--
-- PURPOSE / SECURITY MODEL
--   * Reads: unchanged for all authenticated roles (no UI regression —
--     every role that could read before still can).
--   * Writes: now gated by capability so an authenticated Viewer/guest can
--     NO LONGER write privileged data. Administrator / Survey Operator /
--     QA Inspector keep the writes their real workflows need (no behavior
--     regression for operations roles).
--
-- This specifically closes the privilege-escalation hole where ANY signed
-- in user (even a Viewer) could modify project_settings, user_accounts
-- (change roles), datasets, processing_jobs, and approve/reject deletions.
--
-- Idempotent: drop + recreate policies (safe to re-run).
-- Supported versions: Supabase (Postgres 15), schema 'public'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- project_settings — write only Administrator (manageSettings)
-- ---------------------------------------------------------------------
drop policy if exists "Allow authenticated access on project_settings" on public.project_settings;
drop policy if exists "Allow public read on project_settings" on public.project_settings;

create policy "project_settings_select"
  on public.project_settings for select
  using (sec.can('viewAll'));

create policy "project_settings_write"
  on public.project_settings for all
  using (sec.can('manageSettings'))
  with check (sec.can('manageSettings'));

-- ---------------------------------------------------------------------
-- user_accounts — write only Administrator (manageUsers); reads as today
-- ---------------------------------------------------------------------
drop policy if exists "Allow authenticated read on user_accounts" on public.user_accounts;
drop policy if exists "Allow authenticated write on user_accounts" on public.user_accounts;

create policy "user_accounts_select"
  on public.user_accounts for select
  using (sec.can('viewAll'));

create policy "user_accounts_insert"
  on public.user_accounts for insert
  with check (sec.can('manageUsers'));

create policy "user_accounts_update"
  on public.user_accounts for update
  using (sec.can('manageUsers'))
  with check (sec.can('manageUsers'));

create policy "user_accounts_delete"
  on public.user_accounts for delete
  using (sec.can('manageUsers'));

-- ---------------------------------------------------------------------
-- deletion_requests — anyone may submit (INSERT); only Administrator may
--   approve/reject (UPDATE status). SELECT as today.
-- ---------------------------------------------------------------------
drop policy if exists "Allow authenticated access on deletion_requests" on public.deletion_requests;

create policy "deletion_requests_select"
  on public.deletion_requests for select
  using (sec.can('viewAll'));

create policy "deletion_requests_insert"
  on public.deletion_requests for insert
  with check (sec.can('viewAll'));

create policy "deletion_requests_update"
  on public.deletion_requests for update
  using (sec.can('approveDeletions'))
  with check (sec.can('approveDeletions'));

-- Delete handled only by the dedicated delete-data capability (admin/operator).
create policy "deletion_requests_delete"
  on public.deletion_requests for delete
  using (sec.can('deleteData'));

-- ---------------------------------------------------------------------
-- datasets — reads all auth; writes for operations roles (admin OR
--   operator OR inspector) via the manageDatasets / runQaqc union.
--   A Viewer/guest can no longer write.
-- ---------------------------------------------------------------------
drop policy if exists "Allow authenticated access on datasets" on public.datasets;
drop policy if exists "Allow public read on datasets" on public.datasets;
drop policy if exists "Allow public write on datasets" on public.datasets;

create policy "datasets_select"
  on public.datasets for select
  using (sec.can('viewAll'));

create policy "datasets_insert"
  on public.datasets for insert
  with check (sec.can('manageDatasets') or sec.can('runQaqc'));

create policy "datasets_update"
  on public.datasets for update
  using (sec.can('manageDatasets') or sec.can('runQaqc'))
  with check (sec.can('manageDatasets') or sec.can('runQaqc'));

create policy "datasets_delete"
  on public.datasets for delete
  using (sec.can('manageDatasets'));

-- ---------------------------------------------------------------------
-- processing_jobs — reads all auth; writes for operations roles; a
--   Viewer/guest can no longer write/submit jobs.
-- ---------------------------------------------------------------------
drop policy if exists "Allow authenticated access on processing_jobs" on public.processing_jobs;
drop policy if exists "Allow public read on processing_jobs" on public.processing_jobs;
drop policy if exists "Allow public write on processing_jobs" on public.processing_jobs;

create policy "processing_jobs_select"
  on public.processing_jobs for select
  using (sec.can('viewAll'));

create policy "processing_jobs_insert"
  on public.processing_jobs for insert
  with check (sec.can('manageDatasets') or sec.can('runQaqc'));

create policy "processing_jobs_update"
  on public.processing_jobs for update
  using (sec.can('manageDatasets') or sec.can('runQaqc'))
  with check (sec.can('manageDatasets') or sec.can('runQaqc'));

create policy "processing_jobs_delete"
  on public.processing_jobs for delete
  using (sec.can('manageDatasets'));

-- =====================================================================
-- SUMMARY
--   Viewer / guest : SELECT only on all five tables (can never write).
--   Administrator  : full write; can approve/reject deletions.
--   Operator/QA    : write datasets + jobs; Operator can delete-data.
-- =====================================================================
