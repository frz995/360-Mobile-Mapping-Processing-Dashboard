import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase client so CRUD tests never touch a real DB.
vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn()
  }
}));

// Mock RoadAnalysisWorkspace's key helper so we don't pull in that heavy module.
vi.mock('../../components/RoadAnalysisWorkspace', () => ({
  getAuthStorageUserKey: (authSession?: any, isGuestUser?: boolean) =>
    isGuestUser ? 'guest' : (authSession?.user?.id ?? 'anon')
}));

import { supabase } from '../supabase';
import {
  getActiveProjectStorageKey,
  resolveUserStorageKey,
  saveActiveProjectId,
  loadActiveProjectId,
  clearActiveProjectId,
  loadProjectsCache,
  saveProjectsCache,
  applyProjectScope,
  fetchProjects,
  createProject,
  deleteProject,
  archiveProject,
  buildSeedProjectFromSettings,
  createLocalProjectSnapshot,
  hasSeededProject,
  markProjectSeeded,
  computeUserKey,
  setActiveProjectId,
  getActiveProjectId,
  type UserProject
} from '../projects';

const mockProject: UserProject = {
  id: 'proj-1',
  name: 'Selangor Phase 3',
  description: '',
  contractCode: 'MMS-2026-GEO-01',
  clientName: 'Spatial Asset Operations',
  region: 'peninsular_malaysia',
  status: 'active',
  scope: { crs: 'EPSG:4326', region: 'peninsular_malaysia', bbox: [99.6, 1.2, 104.6, 6.8], basemap: 'dark', equipment: 'MMS' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-02T00:00:00.000Z'
};

const mockRow = {
  id: mockProject.id,
  name: mockProject.name,
  description: mockProject.description,
  contract_code: mockProject.contractCode,
  client_name: mockProject.clientName,
  region: mockProject.region,
  status: mockProject.status,
  scope: mockProject.scope,
  created_at: mockProject.createdAt,
  updated_at: mockProject.updatedAt,
  last_opened_at: mockProject.lastOpenedAt
};

function fromStub(chain: any) {
  (supabase.from as any).mockReturnValue(chain);
  return chain;
}

describe('projects service — storage keys', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('builds a per-user active project key', () => {
    expect(getActiveProjectStorageKey('user-1')).toBe('geosphere360_active_project_user-1');
  });

  it('resolves the user storage key following the app convention', () => {
    expect(resolveUserStorageKey({ user: { id: 'abc' } }, false)).toBe('abc');
    expect(resolveUserStorageKey(undefined, true)).toBe('guest');
  });

  it('saves/loads/clears the active project id in localStorage', () => {
    expect(loadActiveProjectId('user-1')).toBeNull();
    saveActiveProjectId('user-1', 'proj-1');
    expect(loadActiveProjectId('user-1')).toBe('proj-1');
    clearActiveProjectId('user-1');
    expect(loadActiveProjectId('user-1')).toBeNull();
  });

  it('round-trips the project list cache', () => {
    saveProjectsCache([mockProject]);
    const loaded = loadProjectsCache();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('proj-1');
    expect(loaded[0].contractCode).toBe('MMS-2026-GEO-01');
  });
});

describe('projects service — CRUD', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('fetchProjects falls back to the local cache on supabase error', async () => {
    saveProjectsCache([mockProject]);
    const chain = {
      select: vi.fn(),
      order: vi.fn(),
      order2: vi.fn()
    };
    chain.select.mockReturnValue({ order: chain.order });
    chain.order.mockReturnValue({ order: chain.order2 });
    chain.order2.mockResolvedValue({ data: null, error: { message: 'boom' } });
    fromStub(chain);

    const result = await fetchProjects();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('proj-1');
  });

  it('fetchProjects maps rows from supabase and refreshes cache', async () => {
    const chain = {
      select: vi.fn(),
      order: vi.fn(),
      order2: vi.fn()
    };
    chain.select.mockReturnValue({ order: chain.order });
    chain.order.mockReturnValue({ order: chain.order2 });
    chain.order2.mockResolvedValue({ data: [mockRow], error: null });
    fromStub(chain);

    const result = await fetchProjects();
    expect(result).toHaveLength(1);
    expect(result[0].contractCode).toBe('MMS-2026-GEO-01');
    expect(loadProjectsCache()).toHaveLength(1);
  });

  it('createProject inserts and prepends to cache', async () => {
    const chain = { insert: vi.fn(), select: vi.fn(), single: vi.fn() };
    chain.insert.mockReturnValue({ select: chain.select });
    chain.select.mockReturnValue({ single: chain.single });
    chain.single.mockResolvedValue({ data: mockRow, error: null });
    fromStub(chain);

    const res = await createProject({ name: 'Selangor Phase 3' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.id).toBe('proj-1');
    }
    expect(loadProjectsCache()).toHaveLength(1);
  });

  it('archiveProject sets status to archived', async () => {
    const chain = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() };
    chain.update.mockReturnValue({ eq: chain.eq });
    chain.eq.mockReturnValue({ select: chain.select });
    chain.select.mockReturnValue({ single: chain.single });
    chain.single.mockResolvedValue({ data: { ...mockRow, status: 'archived' }, error: null });
    fromStub(chain);

    const res = await archiveProject('proj-1');
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value.status).toBe('archived');
    }
  });

  it('deleteProject calls the cascade RPC and removes the project from cache', async () => {
    saveProjectsCache([mockProject, { ...mockProject, id: 'proj-2' }]);
    const rpcStub = vi.fn().mockResolvedValue({ data: { ok: true, deleted: { panoramas: 4 } }, error: null });
    (supabase.rpc as any).mockImplementation(rpcStub);

    const res = await deleteProject('proj-1');
    expect(res.success).toBe(true);
    expect(rpcStub).toHaveBeenCalledWith('projects_delete_cascade', { p_project_id: 'proj-1' });
    const cached = loadProjectsCache();
    expect(cached.some((p) => p.id === 'proj-1')).toBe(false);
    expect(cached.some((p) => p.id === 'proj-2')).toBe(true);
  });

  it('deleteProject surfaces a non-ok RPC response as failure', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: { ok: false, reason: 'project not found' }, error: null });

    const res = await deleteProject('proj-1');
    expect(res.success).toBe(false);
  });

  it('deleteProject fails open on supabase error without throwing', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: 'RPC denied' } });

    const res = await deleteProject('proj-1');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.message).toBe('RPC denied');
  });
});

describe('projects service — scope application', () => {
  it('applies project GIS scope over base settings', () => {
    const merged = applyProjectScope(
      { projectName: 'base', selectedCrs: 'EPSG:3857' } as unknown as Parameters<typeof applyProjectScope>[0],
      mockProject
    ) as unknown as Record<string, unknown>;
    expect(merged.projectName).toBe('Selangor Phase 3');
    expect(merged.contractCode).toBe('MMS-2026-GEO-01');
    expect(merged.clientName).toBe('Spatial Asset Operations');
    expect(merged.selectedCrs).toBe('EPSG:4326');
    expect(merged.minLat).toBeCloseTo(1.2);
    expect(merged.maxLon).toBeCloseTo(104.6);
    expect(merged.selectedRegionBBox).toBe('peninsular_malaysia');
    expect(merged.regionZone).toBe('peninsular_malaysia');
    expect(merged.defaultBasemapStyle).toBe('dark');
  });

  it('strips legacy projectBoundary when active project has no boundary in scope', () => {
    const settingsWithLegacyBoundary = {
      projectName: 'base',
      projectBoundary: { regionId: 'johor', geojson: { type: 'Polygon' } }
    } as unknown as Parameters<typeof applyProjectScope>[0];

    const merged = applyProjectScope(settingsWithLegacyBoundary, mockProject);
    expect((merged as any).projectBoundary).toBeUndefined();
    expect('projectBoundary' in merged).toBe(false);
  });

  it('restores projectBoundary when explicitly defined in project scope', () => {
    const projectWithBoundary: UserProject = {
      ...mockProject,
      scope: {
        ...mockProject.scope,
        projectBoundary: { regionId: 'selangor', geojson: { type: 'Polygon' } }
      }
    };
    const merged = applyProjectScope({ projectName: 'base' } as any, projectWithBoundary);
    expect((merged as any).projectBoundary).toEqual({ regionId: 'selangor', geojson: { type: 'Polygon' } });
  });

  it('returns settings unchanged when no project is given', () => {
    const settings = { projectName: 'base' };
    const merged = applyProjectScope(settings, null);
    expect(merged).toEqual(settings);
  });
});

describe('projects service — v14 carry-forward seed', () => {
  it('builds a seed draft mirroring the current project settings', () => {
    const draft = buildSeedProjectFromSettings({
      projectName: '360 Mobile Mapping - Spatial Operations Division',
      contractCode: 'MMS-2026-GEO-01',
      clientName: 'Spatial Asset Operations',
      regionZone: 'Central Operations Region',
      selectedRegionBBox: 'peninsular_malaysia',
      selectedCrs: 'EPSG:4326',
      minLat: 1.2,
      maxLat: 6.8,
      minLon: 99.6,
      maxLon: 104.6,
      defaultBasemapStyle: 'dark',
      defaultEquipment: 'MMS',
      targetKm: 315.2,
      targetImages: 50000,
      targetDeadline: '2026-12-31',
      enableBBoxFilter: true
    });
    expect(draft).not.toBeNull();
    if (!draft) return;
    expect(draft.name).toBe('360 Mobile Mapping - Spatial Operations Division');
    expect(draft.contractCode).toBe('MMS-2026-GEO-01');
    expect(draft.clientName).toBe('Spatial Asset Operations');
    expect(draft.region).toBe('peninsular_malaysia');
    expect(draft.status).toBe('active');
    expect(draft.scope?.crs).toBe('EPSG:4326');
    expect(draft.scope?.bbox).toEqual([99.6, 1.2, 104.6, 6.8]);
    expect(draft.scope?.basemap).toBe('dark');
    expect(draft.scope?.enableBBoxFilter).toBe(true);
  });

  it('returns null when there is no project name to carry forward', () => {
    expect(buildSeedProjectFromSettings({})).toBeNull();
    expect(buildSeedProjectFromSettings(undefined)).toBeNull();
  });

  it('creates a local snapshot and caches it', () => {
    const draft = buildSeedProjectFromSettings({
      projectName: 'Legacy Workstream',
      selectedRegionBBox: 'sabah'
    });
    expect(draft).not.toBeNull();
    if (!draft) return;
    const snapshot = createLocalProjectSnapshot(draft);
    expect(snapshot.id.startsWith('local-')).toBe(true);
    expect(snapshot.status).toBe('active');
    expect(snapshot.name).toBe('Legacy Workstream');
    const cached = loadProjectsCache();
    expect(cached.some((p) => p.id === snapshot.id)).toBe(true);
  });

  it('round-trips the per-user seed flag', () => {
    expect(hasSeededProject('user-1')).toBe(false);
    markProjectSeeded('user-1');
    expect(hasSeededProject('user-1')).toBe(true);
  });

  it('re-exports the active-project context helpers from projectContext', () => {
    expect(typeof computeUserKey).toBe('function');
    expect(typeof setActiveProjectId).toBe('function');
    expect(typeof getActiveProjectId).toBe('function');
    clearActiveProjectId(computeUserKey());
    expect(getActiveProjectId()).toBeNull();
    setActiveProjectId('proj-re-export');
    expect(getActiveProjectId()).toBe('proj-re-export');
    setActiveProjectId(null);
  });
});
