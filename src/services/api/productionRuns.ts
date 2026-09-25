import { getServiceProjectId, supabase } from './client';
import { extractSurveyDate, subgridOf } from '../../utils/datasetLineage';
import {
  buildReleaseFolder,
  formatReleaseCode,
  formatRunCode,
  normalizeReleaseDate,
  normalizeReleaseSubgrid,
  type ReleaseManifest
} from '../../utils/releaseNaming';
import type {
  ProductionAttemptRecord,
  ProductionAttemptStatus,
  ProductionReleaseRecord,
  ProductionReleaseStatus,
  ProductionRunRecord,
  ProductionRunStatus
} from '../../types/production';

export interface ProductionRunFilters {
  subgrid?: string;
  captureDate?: string;
  status?: ProductionRunStatus;
}

export interface ProductionAttemptFilters {
  status?: ProductionAttemptStatus;
}

export interface CreateProductionRunInput {
  subgrid: string;
  captureDate: string;
  sourceFolder?: string;
  cameraModel?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
  sequence?: number;
}

export interface CreateProductionAttemptInput {
  productionRunId: string;
  status?: ProductionAttemptStatus;
  sourceDatasetId?: string;
  outputDatasetId?: string;
  processingJobId?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface SaveProductionReleaseInput {
  productionRunId: string;
  attemptId: string;
  sourceFolder: string;
  releaseFolder: string;
  manifest: ReleaseManifest;
  status?: ProductionReleaseStatus;
  isActive?: boolean;
  createdBy?: string;
  publishedBy?: string;
}

export interface ProductionReleaseHandoffStatus {
  ready: boolean;
  reason: string;
}

export interface ProductionPublicationInput {
  subgrid?: string;
  date?: string;
  productionRunId?: string | null;
  productionAttemptId?: string | null;
  productionReleaseId?: string | null;
}

export interface ProductionPublicationGateResult {
  managed: boolean;
  allowed: boolean;
  reason: string;
  productionRunId?: string;
  productionAttemptId?: string;
  productionReleaseId?: string;
}

function publicationDate(value?: string): string | undefined {
  const raw = (value || '').trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

export async function checkProductionPublicationEligibility(
  input: ProductionPublicationInput
): Promise<ProductionPublicationGateResult> {
  const projectId = getServiceProjectId();
  const hasExplicitIdentity = Boolean(
    input.productionRunId?.trim() || input.productionAttemptId?.trim() || input.productionReleaseId?.trim()
  );
  const rawSubgrid = (input.subgrid || '').trim();
  const captureDate = publicationDate(input.date);

  if (!projectId || !rawSubgrid || !captureDate) {
    if (hasExplicitIdentity) {
      return {
        managed: true,
        allowed: false,
        reason: 'Publication identity is incomplete; select an active project and production run before publishing.'
      };
    }
    return {
      managed: false,
      allowed: true,
      reason: 'No production run identity is associated with this legacy record.'
    };
  }

  let subgrid: string;
  try {
    subgrid = normalizeReleaseSubgrid(rawSubgrid);
  } catch {
    if (hasExplicitIdentity) {
      return {
        managed: true,
        allowed: false,
        reason: 'The publication subgrid is not a valid production subgrid.'
      };
    }
    return {
      managed: false,
      allowed: true,
      reason: 'No production run identity is associated with this legacy record.'
    };
  }

  const requestedRunId = input.productionRunId?.trim() || '';
  const requestedAttemptId = input.productionAttemptId?.trim() || '';
  const requestedReleaseId = input.productionReleaseId?.trim() || '';
  let runQuery = supabase
    .from('production_runs')
    .select('id, active_release_id, subgrid, capture_date')
    .eq('project_id', projectId)
    .eq('subgrid', subgrid)
    .eq('capture_date', captureDate);
  if (requestedRunId) runQuery = runQuery.eq('id', requestedRunId);
  const { data: runRows, error: runError } = await runQuery;
  if (runError) throw new Error(`Unable to verify the production run before publication: ${runError.message}`);

  const runs = (runRows || []) as Array<{
    id: string;
    active_release_id?: string | null;
    subgrid: string;
    capture_date: string;
  }>;
  if (runs.length === 0) {
    if (hasExplicitIdentity) {
      return {
        managed: true,
        allowed: false,
        reason: 'The selected production run is missing from the active project.'
      };
    }
    return {
      managed: false,
      allowed: true,
      reason: 'No production run exists for this legacy record.'
    };
  }

  const activeRuns = requestedReleaseId
    ? runs.filter((run) => run.active_release_id === requestedReleaseId)
    : runs.filter((run) => Boolean(run.active_release_id));
  if (activeRuns.length !== 1) {
    return {
      managed: true,
      allowed: false,
      reason: activeRuns.length === 0
        ? 'This production run has no active release; prepare or select a release before publishing.'
        : 'Multiple active production releases match this record; select one exact release before publishing.'
    };
  }

  const run = activeRuns[0];
  const releaseId = requestedReleaseId || run.active_release_id || '';
  if (!releaseId) {
    return {
      managed: true,
      allowed: false,
      reason: 'This production run has no active release; prepare or select a release before publishing.'
    };
  }

  let attemptId = requestedAttemptId;
  if (!attemptId) {
    const { data: release, error: releaseError } = await supabase
      .from('production_releases')
      .select('id, attempt_id, production_run_id, subgrid, is_active')
      .eq('project_id', projectId)
      .eq('id', releaseId)
      .eq('production_run_id', run.id)
      .maybeSingle();
    if (releaseError) throw new Error(`Unable to verify the production release before publication: ${releaseError.message}`);
    if (!release) {
      return {
        managed: true,
        allowed: false,
        reason: 'The active production release is missing from the active project.'
      };
    }
    if (!release.is_active) {
      return {
        managed: true,
        allowed: false,
        reason: 'The selected production release is no longer active; select the current release before publishing.',
        productionRunId: run.id,
        productionReleaseId: releaseId
      };
    }
    attemptId = release.attempt_id;
  }

  const handoff = await fetchProductionReleaseHandoffStatus(run.id, attemptId, releaseId);
  if (!handoff.ready) {
    return {
      managed: true,
      allowed: false,
      reason: handoff.reason,
      productionRunId: run.id,
      productionAttemptId: attemptId,
      productionReleaseId: releaseId
    };
  }

  return {
    managed: true,
    allowed: true,
    reason: handoff.reason,
    productionRunId: run.id,
    productionAttemptId: attemptId,
    productionReleaseId: releaseId
  };
}

function requireProjectId(): string {
  const projectId = getServiceProjectId();
  if (!projectId) {
    throw new Error('Select a project before managing production runs');
  }
  return projectId;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const random = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${random()}${random()}-${random()}-4${random().slice(1)}-a${random().slice(1)}-${random()}${random()}${random()}`;
}

function normalizeReleasePath(value: unknown): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function validateReleaseManifest(
  input: SaveProductionReleaseInput,
  projectId: string,
  run: { subgrid: string; capture_date: string; run_code: string; source_folder?: string | null },
  expectedReleaseFolder: string,
  sourceFolder: string
): ReleaseManifest {
  const manifest = input.manifest;
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Release manifest is invalid');
  }
  if (
    manifest.projectId !== projectId ||
    manifest.runId !== input.productionRunId ||
    manifest.attemptId !== input.attemptId ||
    normalizeReleaseSubgrid(manifest.subgrid) !== run.subgrid ||
    manifest.runCode !== run.run_code ||
    manifest.captureDate !== run.capture_date
  ) {
    throw new Error('Release manifest identity does not match the production run');
  }
  const manifestSourceFolder = normalizeReleasePath(manifest.sourceFolder);
  if (
    !manifestSourceFolder ||
    (manifestSourceFolder !== sourceFolder && !manifestSourceFolder.endsWith(`/${sourceFolder}`))
  ) {
    throw new Error('Release manifest source folder does not match the request');
  }
  const manifestReleaseFolder = normalizeReleasePath(manifest.releaseFolder);
  if (
    manifestReleaseFolder !== expectedReleaseFolder &&
    !manifestReleaseFolder.endsWith(expectedReleaseFolder)
  ) {
    throw new Error('Release manifest folder does not match the canonical release folder');
  }
  const totalSizeBytes = manifest.files.reduce((total, file) => total + Number(file.sizeBytes || 0), 0);
  if (manifest.fileCount !== manifest.files.length || manifest.totalSizeBytes !== totalSizeBytes) {
    throw new Error('Release manifest file totals are inconsistent');
  }
  return manifest;
}

function releaseFileRow(projectId: string, releaseId: string, file: ReleaseManifest['files'][number]) {
  return {
    project_id: projectId,
    release_id: releaseId,
    source_path: file.sourcePath,
    source_name: file.sourceName,
    release_name: file.releaseName,
    relative_path: file.relativePath,
    media_type: file.mediaType,
    size_bytes: file.sizeBytes,
    sha256: file.sha256,
    sort_order: file.sortOrder,
    metadata: {}
  };
}

export async function fetchProductionRuns(filters: ProductionRunFilters = {}): Promise<ProductionRunRecord[]> {
  const projectId = requireProjectId();
  let query = supabase.from('production_runs').select('*').eq('project_id', projectId);
  if (filters.subgrid) query = query.eq('subgrid', normalizeReleaseSubgrid(filters.subgrid));
  if (filters.captureDate) query = query.eq('capture_date', normalizeReleaseDate(filters.captureDate));
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query.order('capture_date', { ascending: false }).order('sequence', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as ProductionRunRecord[];
}

export async function fetchProductionAttempts(
  productionRunId: string,
  filters: ProductionAttemptFilters = {}
): Promise<ProductionAttemptRecord[]> {
  const projectId = requireProjectId();
  let query = supabase
    .from('production_run_attempts')
    .select('*')
    .eq('project_id', projectId)
    .eq('production_run_id', productionRunId);
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query.order('attempt_number', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as ProductionAttemptRecord[];
}

export async function fetchProductionReleases(
  filters: { productionRunId?: string; subgrid?: string; status?: ProductionReleaseStatus } = {}
): Promise<ProductionReleaseRecord[]> {
  const projectId = requireProjectId();
  let query = supabase.from('production_releases').select('*').eq('project_id', projectId);
  if (filters.productionRunId) query = query.eq('production_run_id', filters.productionRunId);
  if (filters.subgrid) query = query.eq('subgrid', normalizeReleaseSubgrid(filters.subgrid));
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as ProductionReleaseRecord[];
}

export async function fetchProductionReleaseFiles(releaseId: string): Promise<Array<Record<string, unknown>>> {
  const projectId = requireProjectId();
  const { data, error } = await supabase
    .from('production_release_files')
    .select('*')
    .eq('project_id', projectId)
    .eq('release_id', releaseId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as Array<Record<string, unknown>>;
}

export async function createProductionRun(input: CreateProductionRunInput): Promise<{
  run: ProductionRunRecord;
  attempt: ProductionAttemptRecord;
}> {
  const projectId = requireProjectId();
  const subgrid = normalizeReleaseSubgrid(input.subgrid);
  const captureDate = normalizeReleaseDate(input.captureDate);
  const sequence = input.sequence || 1;
  const runCode = formatRunCode(subgrid, captureDate, sequence);
  const runId = newId();
  const attemptId = newId();
  const { data: latest, error: latestError } = await supabase
    .from('production_runs')
    .select('sequence')
    .eq('project_id', projectId)
    .eq('subgrid', subgrid)
    .eq('capture_date', captureDate)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(latestError.message);
  const resolvedSequence = input.sequence || Number((latest as { sequence?: number } | null)?.sequence || 0) + 1;
  const resolvedRunCode = input.sequence ? runCode : formatRunCode(subgrid, captureDate, resolvedSequence);
  const { data: run, error: runError } = await supabase
    .from('production_runs')
    .insert([{
      id: runId,
      project_id: projectId,
      subgrid,
      capture_date: captureDate,
      run_code: resolvedRunCode,
      sequence: resolvedSequence,
      status: 'CAPTURED',
      camera_model: input.cameraModel?.trim() || null,
      source_folder: input.sourceFolder?.trim() || '',
      metadata: input.metadata || {},
      created_by: input.createdBy || 'System'
    }])
    .select('*')
    .single();
  if (runError || !run) throw new Error(runError?.message || 'Unable to create production run');

  const { data: attempt, error: attemptError } = await supabase
    .from('production_run_attempts')
    .insert([{
      id: attemptId,
      project_id: projectId,
      production_run_id: runId,
      attempt_number: 1,
      status: 'ACTIVE',
      source_dataset_id: null,
      output_dataset_id: null,
      processing_job_id: null,
      metadata: {},
      created_by: input.createdBy || 'System'
    }])
    .select('*')
    .single();
  if (attemptError || !attempt) throw new Error(attemptError?.message || 'Unable to create initial production attempt');

  await linkExistingRecordsToRun(runId, attemptId, subgrid, captureDate, projectId);
  return {
    run: run as ProductionRunRecord,
    attempt: attempt as ProductionAttemptRecord
  };
}

export async function createProductionAttempt(input: CreateProductionAttemptInput): Promise<ProductionAttemptRecord> {
  const projectId = requireProjectId();
  const { data: latest, error: latestError } = await supabase
    .from('production_run_attempts')
    .select('attempt_number')
    .eq('project_id', projectId)
    .eq('production_run_id', input.productionRunId)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(latestError.message);
  const attemptNumber = Number((latest as { attempt_number?: number } | null)?.attempt_number || 0) + 1;
  const { data, error } = await supabase
    .from('production_run_attempts')
    .insert([{
      project_id: projectId,
      production_run_id: input.productionRunId,
      attempt_number: attemptNumber,
      status: input.status || 'ACTIVE',
      source_dataset_id: input.sourceDatasetId || null,
      output_dataset_id: input.outputDatasetId || null,
      processing_job_id: input.processingJobId || null,
      metadata: input.metadata || {},
      created_by: input.createdBy || 'System'
    }])
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Unable to create production attempt');
  return data as ProductionAttemptRecord;
}

export async function updateProductionRun(
  productionRunId: string,
  fields: Partial<ProductionRunRecord>
): Promise<ProductionRunRecord> {
  const projectId = requireProjectId();
  const { data, error } = await supabase
    .from('production_runs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('id', productionRunId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Unable to update production run');
  return data as ProductionRunRecord;
}

export async function updateProductionAttempt(
  attemptId: string,
  fields: Partial<ProductionAttemptRecord>
): Promise<ProductionAttemptRecord> {
  const projectId = requireProjectId();
  const { data, error } = await supabase
    .from('production_run_attempts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('id', attemptId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Unable to update production attempt');
  return data as ProductionAttemptRecord;
}

export async function fetchProductionReleaseHandoffStatus(
  productionRunId: string,
  attemptId: string,
  releaseId: string
): Promise<ProductionReleaseHandoffStatus> {
  const projectId = requireProjectId();
  if (!productionRunId || !attemptId || !releaseId) {
    return { ready: false, reason: 'Select a release attempt before opening WebGIS handoff.' };
  }

  const { data: release, error: releaseError } = await supabase
    .from('production_releases')
    .select('id, production_run_id, attempt_id, status, is_active')
    .eq('project_id', projectId)
    .eq('production_run_id', productionRunId)
    .eq('attempt_id', attemptId)
    .eq('id', releaseId)
    .maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release) return { ready: false, reason: 'The selected release no longer exists in the active project.' };
  if (!release.is_active) return { ready: false, reason: 'The selected release is no longer active; select the current release before handoff.' };
  if (release.status !== 'READY' && release.status !== 'PUBLISHED') {
    return { ready: false, reason: `Release status is ${release.status}; only READY or PUBLISHED releases can be handed off.` };
  }

  const { data: attempt, error: attemptError } = await supabase
    .from('production_run_attempts')
    .select('id, status, processing_job_id')
    .eq('project_id', projectId)
    .eq('production_run_id', productionRunId)
    .eq('id', attemptId)
    .maybeSingle();
  if (attemptError) throw new Error(attemptError.message);
  if (!attempt) return { ready: false, reason: 'The production attempt is missing from the active project.' };
  if (attempt.status !== 'APPROVED') {
    return { ready: false, reason: `Attempt status is ${attempt.status}; QA approval is required before handoff.` };
  }
  if (!attempt.processing_job_id) {
    return { ready: false, reason: 'The production attempt is not linked to a QA processing job.' };
  }

  const { data: job, error: jobError } = await supabase
    .from('processing_jobs')
    .select('id, qa_decision')
    .eq('project_id', projectId)
    .eq('id', attempt.processing_job_id)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return { ready: false, reason: 'The linked QA processing job is missing from the active project.' };
  if (job.qa_decision !== 'APPROVED') {
    return { ready: false, reason: 'The linked processing job does not have a confirmed APPROVED QA decision.' };
  }

  return { ready: true, reason: 'Release is approved and ready for the existing WebGIS handoff flow.' };
}

export async function syncProductionAttemptForQaDecision(
  jobId: string,
  decision: 'APPROVED' | 'REJECTED'
): Promise<ProductionAttemptRecord | null> {
  const projectId = requireProjectId();
  const { data: job, error: jobError } = await supabase
    .from('processing_jobs')
    .select('id, production_run_id, production_attempt_id, qa_decision')
    .eq('project_id', projectId)
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job || job.qa_decision !== decision) return null;

  const productionRunId = job.production_run_id;
  if (!productionRunId) return null;

  let attemptQuery = supabase
    .from('production_run_attempts')
    .select('*')
    .eq('project_id', projectId)
    .eq('production_run_id', productionRunId);
  if (job.production_attempt_id) {
    attemptQuery = attemptQuery.eq('id', job.production_attempt_id);
  } else {
    attemptQuery = attemptQuery.order('attempt_number', { ascending: false }).limit(1);
  }
  const { data: attempt, error: attemptError } = await attemptQuery.maybeSingle();
  if (attemptError) throw new Error(attemptError.message);
  if (!attempt) return null;

  const { data: linkedAttempt, error: linkError } = await supabase
    .from('processing_jobs')
    .update({ production_attempt_id: attempt.id, updated_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('id', jobId)
    .select('*')
    .single();
  if (linkError || !linkedAttempt) throw new Error(linkError?.message || 'Unable to link the QA job to its production attempt');

  const { data: updatedAttempt, error: updateError } = await supabase
    .from('production_run_attempts')
    .update({
      status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      processing_job_id: jobId,
      updated_at: new Date().toISOString()
    })
    .eq('project_id', projectId)
    .eq('production_run_id', productionRunId)
    .eq('id', attempt.id)
    .select('*')
    .single();
  if (updateError || !updatedAttempt) throw new Error(updateError?.message || 'Unable to update the production attempt QA status');

  return updatedAttempt as ProductionAttemptRecord;
}

export async function saveProductionRelease(input: SaveProductionReleaseInput): Promise<ProductionReleaseRecord> {
  const projectId = requireProjectId();
  const { data: run, error: runError } = await supabase
    .from('production_runs')
    .select('id, subgrid, capture_date, run_code, source_folder')
    .eq('project_id', projectId)
    .eq('id', input.productionRunId)
    .single();
  if (runError || !run) throw new Error(runError?.message || 'Production run not found');
  const { data: attempt, error: attemptError } = await supabase
    .from('production_run_attempts')
    .select('id, production_run_id')
    .eq('project_id', projectId)
    .eq('id', input.attemptId)
    .eq('production_run_id', input.productionRunId)
    .single();
  if (attemptError || !attempt) throw new Error(attemptError?.message || 'Production attempt not found');

  const runRecord = run as {
    subgrid: string;
    capture_date: string;
    run_code: string;
    source_folder?: string | null;
  };
  const runCode = runRecord.run_code;
  const releaseCode = formatReleaseCode(runCode);
  const releaseFolder = buildReleaseFolder('/DELIVERABLES', runRecord.subgrid, runCode);
  const requestedReleaseFolder = normalizeReleasePath(input.releaseFolder);
  if (requestedReleaseFolder && requestedReleaseFolder !== releaseFolder) {
    throw new Error('Release folder must match the canonical production release path');
  }
  const sourceFolder = normalizeReleasePath(input.sourceFolder);
  if (!sourceFolder || sourceFolder.split('/').includes('..')) {
    throw new Error('Release source folder is invalid');
  }
  const storedSourceFolder = normalizeReleasePath(runRecord.source_folder);
  if (storedSourceFolder && sourceFolder !== storedSourceFolder) {
    throw new Error('Release source folder does not match the production run');
  }
  const manifest = validateReleaseManifest(input, projectId, runRecord, releaseFolder, sourceFolder);
  const { data: existing, error: existingError } = await supabase
    .from('production_releases')
    .select('id')
    .eq('project_id', projectId)
    .eq('production_run_id', input.productionRunId)
    .eq('attempt_id', input.attemptId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const releaseId = (existing as { id?: string } | null)?.id || newId();
  const status = input.status || 'READY';
  const isActive = input.isActive ?? true;
  if (isActive && status !== 'READY' && status !== 'PUBLISHED') {
    throw new Error('Only READY or PUBLISHED releases can be active');
  }

  const activationTimestamp = new Date().toISOString();
  if (isActive) {
    const { error: clearError } = await supabase
      .from('production_releases')
      .update({ is_active: false, updated_at: activationTimestamp })
      .eq('project_id', projectId)
      .eq('subgrid', runRecord.subgrid)
      .neq('id', releaseId);
    if (clearError) throw new Error(clearError.message);

    const { error: clearRunPointersError } = await supabase
      .from('production_runs')
      .update({ active_release_id: null, updated_at: activationTimestamp })
      .eq('project_id', projectId)
      .eq('subgrid', runRecord.subgrid)
      .neq('id', input.productionRunId);
    if (clearRunPointersError) throw new Error(clearRunPointersError.message);
  } else {
    const { error: clearTargetPointerError } = await supabase
      .from('production_runs')
      .update({ active_release_id: null, updated_at: activationTimestamp })
      .eq('project_id', projectId)
      .eq('id', input.productionRunId)
      .eq('active_release_id', releaseId);
    if (clearTargetPointerError) throw new Error(clearTargetPointerError.message);
  }

  const releaseRow = {
    id: releaseId,
    project_id: projectId,
    production_run_id: input.productionRunId,
    attempt_id: input.attemptId,
    release_code: releaseCode,
    subgrid: (run as { subgrid: string }).subgrid,
    status,
    is_active: isActive,
    source_folder: sourceFolder,
    release_folder: releaseFolder,
    manifest_path: `${releaseFolder}/manifest.json`,
    file_count: manifest.files.length,
    total_size_bytes: manifest.totalSizeBytes,
    metadata: manifest,
    generated_at: manifest.generatedAt,
    published_at: status === 'PUBLISHED' ? new Date().toISOString() : null,
    published_by: status === 'PUBLISHED' ? input.publishedBy || input.createdBy || 'System' : null,
    created_by: input.createdBy || 'System',
    updated_at: new Date().toISOString()
  };
  const { data: release, error: releaseError } = await supabase
    .from('production_releases')
    .upsert([releaseRow], { onConflict: 'id' })
    .select('*')
    .single();
  if (releaseError || !release) throw new Error(releaseError?.message || 'Unable to save production release');

  if (isActive) {
    const { error: activeError } = await supabase
      .from('production_runs')
      .update({ active_release_id: releaseId, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('id', input.productionRunId);
    if (activeError) throw new Error(activeError.message);
  }

  const { error: deleteFilesError } = await supabase
    .from('production_release_files')
    .delete()
    .eq('project_id', projectId)
    .eq('release_id', releaseId);
  if (deleteFilesError) throw new Error(deleteFilesError.message);
  if (manifest.files.length > 0) {
    const { error: filesError } = await supabase
      .from('production_release_files')
      .insert(manifest.files.map((file) => releaseFileRow(projectId, releaseId, file)));
    if (filesError) throw new Error(filesError.message);
  }
  return release as ProductionReleaseRecord;
}

export async function markReleasePublished(
  releaseId: string,
  publishedBy: string
): Promise<ProductionReleaseRecord> {
  const projectId = requireProjectId();
  const { data: current, error: currentError } = await supabase
    .from('production_releases')
    .select('id, production_run_id, subgrid')
    .eq('project_id', projectId)
    .eq('id', releaseId)
    .single();
  if (currentError || !current) throw new Error(currentError?.message || 'Production release not found');

  const releaseRecord = current as { id: string; production_run_id: string; subgrid: string };
  const activationTimestamp = new Date().toISOString();
  const { error: deactivateError } = await supabase
    .from('production_releases')
    .update({ is_active: false, updated_at: activationTimestamp })
    .eq('project_id', projectId)
    .eq('subgrid', releaseRecord.subgrid)
    .neq('id', releaseId);
  if (deactivateError) throw new Error(deactivateError.message);

  const { error: clearRunPointersError } = await supabase
    .from('production_runs')
    .update({ active_release_id: null, updated_at: activationTimestamp })
    .eq('project_id', projectId)
    .eq('subgrid', releaseRecord.subgrid)
    .neq('id', releaseRecord.production_run_id);
  if (clearRunPointersError) throw new Error(clearRunPointersError.message);

  const { data, error } = await supabase
    .from('production_releases')
    .update({
      status: 'PUBLISHED',
      is_active: true,
      published_at: activationTimestamp,
      published_by: publishedBy,
      updated_at: activationTimestamp
    })
    .eq('project_id', projectId)
    .eq('id', releaseId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Unable to mark release published');
  const { error: activeError } = await supabase
    .from('production_runs')
    .update({ active_release_id: releaseId, updated_at: activationTimestamp })
    .eq('project_id', projectId)
    .eq('id', data.production_run_id);
  if (activeError) throw new Error(activeError.message);
  return data as ProductionReleaseRecord;
}

async function linkExistingRecordsToRun(
  productionRunId: string,
  attemptId: string,
  subgrid: string,
  captureDate: string,
  projectId: string
): Promise<void> {
  const targetSubgrid = subgridOf(subgrid);
  if (!targetSubgrid) return;
  const [datasetsResult, jobsResult, stagingResult] = await Promise.all([
    supabase.from('datasets').select('id, subgrid, metadata, name, source_folder, output_folder, created_at').eq('project_id', projectId),
    supabase.from('processing_jobs').select('id, subgrid, settings, name, source_folder, output_folder, created_at').eq('project_id', projectId),
    supabase.from('staging_panoramas').select('id, subgrid, filename, created_at').eq('project_id', projectId)
  ]);
  const linkRows = async (table: string, rows: any[] | null, updateFields: Record<string, string>) => {
    for (const row of rows || []) {
      if (subgridOf(row.subgrid || row.filename) !== targetSubgrid) continue;
      const rowDate = extractSurveyDate(row);
      if (rowDate !== captureDate || !row.id) continue;
      const { error } = await supabase
        .from(table)
        .update(updateFields)
        .eq('project_id', projectId)
        .eq('id', row.id);
      if (error) throw new Error(error.message);
    }
  };
  await linkRows('datasets', datasetsResult.data as any[] | null, { production_run_id: productionRunId, production_attempt_id: attemptId });
  await linkRows('processing_jobs', jobsResult.data as any[] | null, { production_run_id: productionRunId, production_attempt_id: attemptId });
  await linkRows('staging_panoramas', stagingResult.data as any[] | null, { production_run_id: productionRunId, production_attempt_id: attemptId });
}
