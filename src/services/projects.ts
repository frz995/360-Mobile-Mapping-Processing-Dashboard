import { supabase } from './supabase';
import { getAuthStorageUserKey } from '../components/RoadAnalysisWorkspace';
import type { ExtendedProjectSettings } from '../types/admin';
import {
  ACTIVE_PROJECT_KEY_PREFIX,
  computeUserKey,
  setActiveProjectId,
  getActiveProjectId,
  saveActiveProjectId,
  loadActiveProjectId,
  clearActiveProjectId
} from './projectContext';

/** localStorage cache key for the project list (schema-bumped, persisted across sessions). */
export const PROJECTS_CACHE_KEY = 'geosphere360_projects_v1';

export {
  computeUserKey,
  setActiveProjectId,
  getActiveProjectId,
  saveActiveProjectId,
  loadActiveProjectId,
  clearActiveProjectId
};

/** Per-user localStorage key for the currently active project id. */
export function getActiveProjectStorageKey(userKey: string): string {
  return `${ACTIVE_PROJECT_KEY_PREFIX}${userKey}`;
}

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

export const PROJECT_STATUS_KEYS: ProjectStatus[] = ['planning', 'active', 'paused', 'completed', 'archived'];

export interface ProjectScope {
  crs?: string;
  /** Malaysia region preset id, e.g. 'peninsular_malaysia'. */
  region?: string;
  /** [minLng, minLat, maxLng, maxLat]. */
  bbox?: [number, number, number, number];
  basemap?: string;
  equipment?: string;
  targetKm?: number;
  targetImages?: number;
  targetDeadline?: string;
  enableBBoxFilter?: boolean;
  projectBoundary?: unknown;
}

export interface UserProject {
  id: string;
  name: string;
  description: string;
  contractCode: string;
  clientName: string;
  region: string;
  status: ProjectStatus;
  scope: ProjectScope;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
}

export interface ProjectDraft {
  name: string;
  description?: string;
  contractCode?: string;
  clientName?: string;
  region?: string;
  status?: ProjectStatus;
  scope?: ProjectScope;
}

export type ProjectResult<T> = { success: true; value: T } | { success: false; message: string };

interface ProjectRow {
  id: string;
  name: string;
  description?: string;
  contract_code?: string;
  client_name?: string;
  region?: string;
  status?: ProjectStatus;
  scope?: ProjectScope;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  last_opened_at?: string | null;
}

function toUserProject(row: ProjectRow): UserProject {
  return {
    id: row.id,
    name: row.name || 'Untitled Project',
    description: row.description || '',
    contractCode: row.contract_code || '',
    clientName: row.client_name || '',
    region: row.region || '',
    status: row.status || 'planning',
    scope: typeof row.scope === 'object' && row.scope !== null ? row.scope : {},
    createdBy: row.created_by ?? null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    lastOpenedAt: row.last_opened_at ?? null
  };
}

// ---------------------------------------------------------------------------
// localStorage cache helpers (mirror the project_settings / roadAnalysis pattern)
// ---------------------------------------------------------------------------

export function loadProjectsCache(): UserProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(p => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveProjectsCache(projects: UserProject[]): void {
  try {
    localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
  } catch {
    // storage unavailable (private mode / quota) — non-fatal
  }
}

/** Resolve the per-user storage key following the app's userKey convention. */
export function resolveUserStorageKey(authSession?: unknown, isGuestUser?: boolean): string {
  return getAuthStorageUserKey(authSession, isGuestUser);
}

// ---------------------------------------------------------------------------
// v14 carry-forward — register the pre-v14 "current production project" (derived
// from projectSettings) into the projects registry exactly once per user, so the
// onboarding picker shows an existing recent project instead of an empty list.
// ---------------------------------------------------------------------------

/** Per-user localStorage flag marking that the seed has been attempted. */
export function seededProjectStorageKey(userKey: string): string {
  return `geosphere360_project_seeded_${userKey}`;
}

export function hasSeededProject(userKey: string): boolean {
  try {
    return localStorage.getItem(seededProjectStorageKey(userKey)) === '1';
  } catch {
    return false;
  }
}

export function markProjectSeeded(userKey: string): void {
  try {
    localStorage.setItem(seededProjectStorageKey(userKey), '1');
  } catch {
    // ignore
  }
}

/**
 * Build a ProjectDraft from the current projectSettings, mirroring the existing
 * dashboard project identity (name / contract / region / GIS scope). Returns
 * null when there is no projectName to carry forward.
 */
export function buildSeedProjectFromSettings(
  settings?: Record<string, unknown> | null
): ProjectDraft | null {
  const name = typeof settings?.projectName === 'string' ? settings.projectName.trim() : '';
  if (!name) return null;

  const region =
    (typeof settings?.selectedRegionBBox === 'string' && settings.selectedRegionBBox) ||
    (typeof settings?.regionZone === 'string' && settings.regionZone) ||
    'peninsular_malaysia';

  const minLon = Number(settings?.minLon);
  const minLat = Number(settings?.minLat);
  const maxLon = Number(settings?.maxLon);
  const maxLat = Number(settings?.maxLat);
  const hasBbox = [minLon, minLat, maxLon, maxLat].every(Number.isFinite);

  const scope: ProjectScope = {
    crs: (typeof settings?.selectedCrs === 'string' && settings.selectedCrs) || 'EPSG:4326',
    region,
    basemap: (typeof settings?.defaultBasemapStyle === 'string' && settings.defaultBasemapStyle) || 'dark',
    equipment: (typeof settings?.defaultEquipment === 'string' && settings.defaultEquipment) || '',
    enableBBoxFilter:
      typeof settings?.enableBBoxFilter === 'boolean' ? settings.enableBBoxFilter : true
  };
  if (hasBbox) scope.bbox = [minLon, minLat, maxLon, maxLat];
  if (typeof settings?.targetKm === 'number') scope.targetKm = settings.targetKm;
  if (typeof settings?.targetImages === 'number') scope.targetImages = settings.targetImages;
  if (typeof settings?.targetDeadline === 'string') scope.targetDeadline = settings.targetDeadline;

  return {
    name,
    contractCode: (typeof settings?.contractCode === 'string' && settings.contractCode) || '',
    clientName: (typeof settings?.clientName === 'string' && settings.clientName) || '',
    region,
    description: '',
    status: 'active',
    scope
  };
}

/**
 * Fallback used when the DB insert is denied/offline: hydrate a local-only
 * snapshot into the cache so the picker/panel still show the carried-forward
 * project. It becomes active via the usual active-project id localStorage.
 */
export function createLocalProjectSnapshot(draft: ProjectDraft): UserProject {
  const now = new Date().toISOString();
  const project: UserProject = {
    id: `local-${Date.now().toString(36)}`,
    name: draft.name,
    description: draft.description || '',
    contractCode: draft.contractCode || '',
    clientName: draft.clientName || '',
    region: draft.region || '',
    status: draft.status || 'active',
    scope: draft.scope || {},
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  };
  saveProjectsCache([project, ...loadProjectsCache().filter((p) => p.id !== project.id)]);
  return project;
}

// ---------------------------------------------------------------------------
// Supabase-backed CRUD (guarded: any failure falls back to the local cache)
// ---------------------------------------------------------------------------

export async function fetchProjects(): Promise<UserProject[]> {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('last_opened_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }
    const projects = Array.isArray(data) ? data.map(toUserProject) : [];
    if (projects.length > 0 || data) {
      saveProjectsCache(projects);
    }
    return projects;
  } catch (err) {
    console.warn('[projects] fetchProjects fell back to local cache:', err);
    return loadProjectsCache();
  }
}

export async function createProject(draft: ProjectDraft): Promise<ProjectResult<UserProject>> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('projects')
      .insert({
        name: draft.name,
        description: draft.description || '',
        contract_code: draft.contractCode || '',
        client_name: draft.clientName || '',
        region: draft.region || '',
        status: draft.status || 'planning',
        scope: draft.scope || {},
        last_opened_at: now,
        updated_at: now
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }
    const project = toUserProject(data as ProjectRow);
    saveProjectsCache([project, ...loadProjectsCache().filter(p => p.id !== project.id)]);
    return { success: true, value: project };
  } catch (err) {
    return { success: false, message: (err as Error).message || 'Failed to create project' };
  }
}

export async function updateProject(
  id: string,
  patch: Partial<ProjectDraft>
): Promise<ProjectResult<UserProject>> {
  try {
    const { data, error } = await supabase
      .from('projects')
      .update({
        name: patch.name,
        description: patch.description,
        contract_code: patch.contractCode,
        client_name: patch.clientName,
        region: patch.region,
        scope: patch.scope,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }
    const project = toUserProject(data as ProjectRow);
    saveProjectsCache(loadProjectsCache().map(p => (p.id === id ? project : p)));
    return { success: true, value: project };
  } catch (err) {
    return { success: false, message: (err as Error).message || 'Failed to update project' };
  }
}

/** Soft-archive a project (no DELETE policy exists for projects). */
export async function archiveProject(id: string): Promise<ProjectResult<UserProject>> {
  try {
    const { data, error } = await supabase
      .from('projects')
      .update({
        status: 'archived',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }
    const project = toUserProject(data as ProjectRow);
    saveProjectsCache(loadProjectsCache().map(p => (p.id === id ? project : p)));
    return { success: true, value: project };
  } catch (err) {
    return { success: false, message: (err as Error).message || 'Failed to archive project' };
  }
}

/** Bump last_opened_at when a project is loaded into the dashboard. */
export async function touchProjectOpened(id: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('projects')
      .update({ last_opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (!error && data) {
      const project = toUserProject(data as ProjectRow);
      saveProjectsCache(loadProjectsCache().map(p => (p.id === id ? project : p)));
    } else if (error) {
      console.warn('[projects] touchProjectOpened notice:', error.message);
    }
  } catch (err) {
    console.warn('[projects] touchProjectOpened notice:', err);
  }
}

/**
 * Permanently delete a project and every operational row stamped with its
 * project_id. Delegates to the SECURITY DEFINER RPC `projects_delete_cascade`
 * (children first, then the project row — the `projects` table has no DELETE
 * RLS policy, so a plain client delete would be denied or abort on the FK).
 * Fail-open: returns { success:false } rather than throwing, mirroring CRUD.
 */
export async function deleteProject(id: string): Promise<ProjectResult<void>> {
  try {
    const { data, error } = await supabase.rpc('projects_delete_cascade', { p_project_id: id });
    if (error) {
      throw new Error(error.message);
    }
    const result = (data ?? {}) as { ok?: boolean; reason?: string };
    if (result.ok !== true) {
      throw new Error(result.reason || 'Delete rejected');
    }
    saveProjectsCache(loadProjectsCache().filter(p => p.id !== id));
    return { success: true, value: undefined };
  } catch (err) {
    return { success: false, message: (err as Error).message || 'Failed to delete project' };
  }
}

/**
 * Persist a project boundary into the currently active project's scope in the
 * projects table, so that `applyProjectScope` restores the correct boundary
 * when that project is re-loaded (fully per-project isolation without relying
 * on the global `project_settings` blob).
 */
export async function persistProjectBoundary(boundary: unknown): Promise<void> {
  const pid = getActiveProjectId();
  if (!pid) return;
  const current = loadProjectsCache().find((p) => p.id === pid);
  if (!current) return;
  const scope = { ...(current.scope || {}) };
  if (boundary === undefined) {
    delete scope.projectBoundary;
  } else {
    scope.projectBoundary = boundary;
  }
  await updateProject(pid, { scope });
}

// ---------------------------------------------------------------------------
// Scope application — merges a project's GIS scope into projectSettings
// while the project is active. Operational tables stay global (v15 will add
// hard project_id partitioning).
// ---------------------------------------------------------------------------

export interface ProjectSettingsPatch {
  projectName?: string;
  contractCode?: string;
  clientName?: string;
  regionZone?: string;
  selectedCrs?: string;
  selectedRegionBBox?: string;
  minLat?: number;
  maxLat?: number;
  minLon?: number;
  maxLon?: number;
  defaultBasemapStyle?: string;
  defaultEquipment?: string;
  targetKm?: number;
  targetImages?: number;
  targetDeadline?: string;
  enableBBoxFilter?: boolean;
  projectBoundary?: unknown;
}

export function applyProjectScope(
  settings: ExtendedProjectSettings | undefined,
  project: Pick<UserProject, 'name' | 'contractCode' | 'clientName' | 'region' | 'scope'> | null | undefined
): ExtendedProjectSettings {
  // settings carries additional runtime keys (clientName, regionZone, …) that
  // are not part of the ExtendedProjectSettings interface; spread loosely.
  const base: Record<string, unknown> = settings ? { ...settings } : {};
  if (!project) return base as ExtendedProjectSettings;

  // Per-project boundary: restore from the project's own scope so each
  // project carries its own boundary independently; fall back to undefined
  // when no scope boundary has been committed for this project.
  const patch: ProjectSettingsPatch = {
    projectName: project.name || (base.projectName as string) || '',
    contractCode: project.contractCode || (base.contractCode as string) || '',
    clientName: project.clientName || (base.clientName as string) || '',
    regionZone: project.region || (base.regionZone as string) || ''
  };

  const s = project.scope || {};
  if (s.crs) patch.selectedCrs = s.crs;
  if (s.region) patch.selectedRegionBBox = s.region;
  if (Array.isArray(s.bbox) && s.bbox.length === 4) {
    patch.minLon = Number(s.bbox[0]);
    patch.minLat = Number(s.bbox[1]);
    patch.maxLon = Number(s.bbox[2]);
    patch.maxLat = Number(s.bbox[3]);
  }
  if (s.basemap) patch.defaultBasemapStyle = s.basemap;
  if (s.equipment) patch.defaultEquipment = s.equipment;
  if (typeof s.targetKm === 'number') patch.targetKm = s.targetKm;
  if (typeof s.targetImages === 'number') patch.targetImages = s.targetImages;
  if (s.targetDeadline) patch.targetDeadline = s.targetDeadline;
  if (typeof s.enableBBoxFilter === 'boolean') patch.enableBBoxFilter = s.enableBBoxFilter;

  // Restore projectBoundary from the project's own scope when present.
  // This ensures each project carries its own boundary and switching projects
  // does not inherit another project's boundary.
  patch.projectBoundary = s.projectBoundary !== undefined ? s.projectBoundary : undefined;

  return { ...base, ...patch } as ExtendedProjectSettings;
}