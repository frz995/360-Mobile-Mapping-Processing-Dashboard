import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTenantActiveOrg, resetTenantSession } from '../useTenantActiveOrg';
import { setActiveOrganizationId, getActiveOrganizationId } from '../../services/tenantStorage';

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn()
}));

vi.mock('../../services/supabase', () => ({
  supabase: {
    from: fromMock
  }
}));

describe('useTenantActiveOrg hook', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActiveOrganizationId(null);
    vi.clearAllMocks();
  });

  it('initializes with null when no organization is active', () => {
    const { result } = renderHook(() => useTenantActiveOrg('user-1', false));
    expect(result.current.activeOrgId).toBeNull();
    expect(result.current.activeOrg).toBeNull();
  });

  it('updates activeOrgId and fetches org details when organization changes', async () => {
    const orgData = {
      id: 'org-test-2',
      name: 'Geosphere -Test2',
      slug: 'geosphere-test2',
      status: 'active'
    };

    fromMock.mockImplementation((table: string) => {
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [orgData], error: null })
          })
        };
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      };
    });

    const { result } = renderHook(() => useTenantActiveOrg('user-1', true));

    await act(async () => {
      setActiveOrganizationId('org-test-2');
    });

    expect(result.current.activeOrgId).toBe('org-test-2');
    expect(getActiveOrganizationId()).toBe('org-test-2');
    expect(result.current.activeOrg?.name).toBe('Geosphere -Test2');
  });

  it('auto-selects assigned organization for company user when no prior activeOrgId exists', async () => {
    const orgData = {
      id: 'org-client-1',
      name: 'GeoSphere - DevTest',
      client_code: 'DevTest',
      slug: 'geosphere-devtest',
      status: 'active',
      settings: {
        storage: {
          provider: 'cloudflare_r2',
          bucketName: 'geosphere-panorama',
          cdnUrl: 'https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev'
        }
      }
    };

    fromMock.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [{ organization_id: 'org-client-1' }], error: null })
          })
        };
      }
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [orgData], error: null })
          })
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const { result } = renderHook(() => useTenantActiveOrg('user-company-1', false));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.activeOrgId).toBe('org-client-1');
    expect(result.current.activeOrg?.name).toBe('GeoSphere - DevTest');
    expect(result.current.activeOrg?.settings?.storage?.provider).toBe('cloudflare_r2');
  });

  it('resetTenantSession clears all tenant session state', () => {
    setActiveOrganizationId('org-dev');
    expect(getActiveOrganizationId()).toBe('org-dev');

    resetTenantSession();
    expect(getActiveOrganizationId()).toBeNull();
  });
});
