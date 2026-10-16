import { useState, useEffect, useCallback } from 'react';
import {
  getActiveOrganizationId,
  setActiveOrganizationId,
  setActiveOrganizationStorage,
  setActiveOrganizationWebgis,
  setActiveOrganizationClientCode,
  fetchAllOrganizations,
  fetchUserOrganizations,
  type Organization
} from '../services/tenantContext';

export function resetTenantSession(): void {
  setActiveOrganizationId(null);
  setActiveOrganizationStorage(null);
  setActiveOrganizationWebgis(null);
  setActiveOrganizationClientCode(null);
}

export interface UseTenantActiveOrgResult {
  activeOrgId: string | null;
  activeOrg: Organization | null;
  changeActiveOrg: (orgId: string | null) => void;
  refreshOrg: () => Promise<void>;
}

export function useTenantActiveOrg(
  sessionUserId?: string | null,
  isPlatformAdmin?: boolean
): UseTenantActiveOrgResult {
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => getActiveOrganizationId());
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);

  const resolveOrg = useCallback(async (orgId: string | null) => {
    try {
      if (isPlatformAdmin) {
        if (!orgId) {
          setActiveOrg(null);
          setActiveOrganizationClientCode(null);
          setActiveOrganizationStorage(null);
          setActiveOrganizationWebgis(null);
          return;
        }
        const result = await fetchAllOrganizations();
        const found = result.organizations.find((o) => o.id === orgId) || null;
        setActiveOrg(found);
        setActiveOrganizationClientCode(found?.clientCode || null);
        setActiveOrganizationStorage(found?.settings?.storage || null);
        setActiveOrganizationWebgis(found?.settings?.webgisUrl || null);
      } else if (sessionUserId) {
        const result = await fetchUserOrganizations(sessionUserId);
        const orgs = result.organizations || [];
        // If an orgId was previously chosen, match it; otherwise auto-select the user's assigned company
        const found = (orgId ? orgs.find((o) => o.id === orgId) : null) || orgs[0] || null;
        if (found) {
          if (found.id !== orgId) {
            setActiveOrganizationId(found.id);
            setActiveOrgId(found.id);
          }
          setActiveOrg(found);
          setActiveOrganizationClientCode(found.clientCode || null);
          setActiveOrganizationStorage(found.settings?.storage || null);
          setActiveOrganizationWebgis(found.settings?.webgisUrl || null);
        } else {
          setActiveOrg(null);
          setActiveOrganizationClientCode(null);
          setActiveOrganizationStorage(null);
          setActiveOrganizationWebgis(null);
        }
      } else {
        setActiveOrg(null);
        setActiveOrganizationClientCode(null);
        setActiveOrganizationStorage(null);
        setActiveOrganizationWebgis(null);
      }
    } catch (err) {
      console.warn('[useTenantActiveOrg] failed to resolve organization:', err);
    }
  }, [isPlatformAdmin, sessionUserId]);

  useEffect(() => {
    void resolveOrg(activeOrgId);
  }, [activeOrgId, resolveOrg]);

  useEffect(() => {
    const handleOrgChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ organizationId: string | null }>;
      const nextId = customEvent.detail?.organizationId ?? getActiveOrganizationId();
      setActiveOrgId(nextId);
      void resolveOrg(nextId);
    };

    window.addEventListener('geosphere360-active-org-changed', handleOrgChanged);
    return () => {
      window.removeEventListener('geosphere360-active-org-changed', handleOrgChanged);
    };
  }, [resolveOrg]);

  const changeActiveOrg = useCallback((orgId: string | null) => {
    setActiveOrganizationId(orgId);
    setActiveOrgId(orgId);
    void resolveOrg(orgId);
  }, [resolveOrg]);

  const refreshOrg = useCallback(async () => {
    const currentId = getActiveOrganizationId();
    setActiveOrgId(currentId);
    await resolveOrg(currentId);
  }, [resolveOrg]);

  return {
    activeOrgId,
    activeOrg,
    changeActiveOrg,
    refreshOrg
  };
}
