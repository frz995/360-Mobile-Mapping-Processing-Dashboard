import { supabase, scoped, getServiceProjectId } from './client';
import type { ProcessingJobRecord } from '../../types/production';

const PROCESSING_JOBS_TABLE = 'processing_jobs';

/** Statuses that mean a job is still actively processing. */
const RUNNING_JOB_STATUSES = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'PAUSED']);

export interface DatasetScopeForJobCheck {
  id?: string | null;
  source_folder?: string | null;
  output_folder?: string | null;
  subgrid?: string | null;
}

export interface RunningJobInfo {
  id: string;
  job_type: string;
  status: string;
  name: string;
}

/** Find processing jobs still running that relate to a dataset row —
 * linked by `source_dataset_id` / `output_dataset_id`, the exact source or
 * output folder, or a shared subgrid. Used to block dataset deletion while
 * a related batch is in flight. */
export async function findRunningJobsForDataset(
  scope: DatasetScopeForJobCheck
): Promise<RunningJobInfo[]> {
  const jobs = await fetchProcessingJobsFromSupabase();
  const src = (scope.source_folder || '').replace(/\/+$/, '');
  const out = (scope.output_folder || '').replace(/\/+$/, '');
  const sg = scope.subgrid || '';
  return jobs
    .filter((j) => {
      const status = (j.status || '').toUpperCase();
      if (!RUNNING_JOB_STATUSES.has(status)) return false;
      const jSrc = (j.source_folder || '').replace(/\/+$/, '');
      const jOut = (j.output_folder || '').replace(/\/+$/, '');
      return (
        (!!scope.id && (j.source_dataset_id === scope.id || j.output_dataset_id === scope.id)) ||
        (!!src && (jSrc === src || jOut === src)) ||
        (!!out && (jSrc === out || jOut === out)) ||
        (!!sg && !!j.subgrid && j.subgrid === sg)
      );
    })
    .map((j) => ({
      id: j.id || '',
      job_type: j.job_type || 'PROCESSING',
      status: j.status || 'IN_PROGRESS',
      name: j.name || j.job_type || 'batch'
    }));
}

function getJobStorageKey(): string {
  const pid = getServiceProjectId();
  return pid ? `geosphere_processing_jobs_${pid}` : 'geosphere_processing_jobs';
}

function getLocalJobs(): ProcessingJobRecord[] {
  try {
    const raw = localStorage.getItem(getJobStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function setLocalJobs(jobs: ProcessingJobRecord[]): void {
  try {
    localStorage.setItem(getJobStorageKey(), JSON.stringify(jobs));
  } catch (_) { }
}

function getDeletedJobStorageKey(): string {
  const pid = getServiceProjectId();
  return pid ? `geosphere_deleted_job_ids_${pid}` : 'geosphere_deleted_job_ids';
}

function getDeletedJobIds(): Set<string> {
  try {
    const raw = localStorage.getItem(getDeletedJobStorageKey());
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (_) {
    return new Set();
  }
}

function saveDeletedJobIds(ids: Set<string>): void {
  try {
    localStorage.setItem(getDeletedJobStorageKey(), JSON.stringify(Array.from(ids)));
  } catch (_) { }
}

export async function fetchProcessingJobsFromSupabase(): Promise<ProcessingJobRecord[]> {
  const local = getLocalJobs();
  const deleted = getDeletedJobIds();
  try {
    const query = scoped(supabase
      .from(PROCESSING_JOBS_TABLE)
      .select('*'));
    const { data, error } = await query
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      const map = new Map<string, ProcessingJobRecord>();
      data.forEach((j) => {
        if (j.id && !deleted.has(j.id)) map.set(j.id, j as ProcessingJobRecord);
      });
      local.forEach((loc) => {
        if (!loc.id || deleted.has(loc.id)) return;
        const remote = map.get(loc.id);
        if (!remote) {
          map.set(loc.id, loc);
        } else {
          const locTime = new Date(loc.updated_at || loc.created_at || 0).getTime();
          const remTime = new Date(remote.updated_at || remote.created_at || 0).getTime();
          if (locTime > remTime) {
            map.set(loc.id, { ...remote, ...loc });
          }
        }
      });
      const merged = Array.from(map.values())
        .filter((j) => !j.id?.startsWith('mock-'))
        .sort(
          (a, b) => (b.created_at || '').localeCompare(a.created_at || '')
        );
      setLocalJobs(merged);
      return merged;
    }
  } catch (err) {
    console.warn('fetchProcessingJobsFromSupabase catch:', err);
  }
  return local.filter((j) => !deleted.has(j.id || '') && !j.id?.startsWith('mock-'));
}

export async function saveProcessingJobToSupabase(job: ProcessingJobRecord): Promise<ProcessingJobRecord | null> {
  const now = new Date().toISOString();
  const pid = getServiceProjectId();
  const target: ProcessingJobRecord = {
    ...job,
    id: job.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `job_${Date.now()}`),
    created_at: job.created_at || now,
    updated_at: now,
    ...(pid ? { project_id: pid } : {})
  };

  // Remove from deleted tracker if re-saved
  const deleted = getDeletedJobIds();
  if (deleted.has(target.id!)) {
    deleted.delete(target.id!);
    saveDeletedJobIds(deleted);
  }

  // 1. Immediately cache locally
  const current = getLocalJobs();
  const idx = current.findIndex((j) => j.id === target.id);
  if (idx >= 0) current[idx] = target;
  else current.unshift(target);
  setLocalJobs(current);

  // 2. Try Supabase
  try {
    if (job.id) {
      let query = supabase
        .from(PROCESSING_JOBS_TABLE)
        .update({ ...target })
        .eq('id', target.id);
      if (pid) query = query.eq('project_id', pid);
      const { data, error } = await query
        .select('*')
        .single();
      if (!error && data) return data as ProcessingJobRecord;
    } else {
      const { data, error } = await supabase
        .from(PROCESSING_JOBS_TABLE)
        .insert([{ ...target }])
        .select('*')
        .single();
      if (!error && data) return data as ProcessingJobRecord;
    }
  } catch (err) {
    console.warn('saveProcessingJobToSupabase catch:', err);
  }

  return target;
}

