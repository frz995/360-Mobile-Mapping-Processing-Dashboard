import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LicenseExpiredScreen } from '../LicenseExpiredScreen';
import { needsLicenseLockout, type TenantLicenseState } from '../../../hooks/useConsoleAccessGate';
import type { Organization } from '../../../services/tenantContext';

describe('LicenseExpiredScreen Component', () => {
  it('renders expired enterprise license lockout screen with details', () => {
    const onSignOut = vi.fn();
    const onCheckAgain = vi.fn();

    render(
      <LicenseExpiredScreen
        organizationName="Tenaga Nasional Berhad"
        email="operator@tnb.com.my"
        status="expired"
        expiresAt="2026-10-01T00:00:00Z"
        onSignOut={onSignOut}
        onCheckAgain={onCheckAgain}
        checking={false}
      />
    );

    expect(screen.getByText('Enterprise License Expired')).toBeInTheDocument();
    expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
    expect(screen.getByText(/(October 1, 2026|1 October 2026)/i)).toBeInTheDocument();
    expect(screen.getByText(/operator@tnb.com.my/i)).toBeInTheDocument();
    expect(screen.getByText(/Workspace Access Restricted/i)).toBeInTheDocument();
    expect(screen.getByText(/How to Restore Access/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check Status/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();
  });

  it('renders suspended account screen when status is suspended', () => {
    render(
      <LicenseExpiredScreen
        organizationName="Apex Survey Sdn Bhd"
        status="suspended"
        onSignOut={vi.fn()}
      />
    );

    expect(screen.getByText('Organization Account Suspended')).toBeInTheDocument();
    expect(screen.getByText('Apex Survey Sdn Bhd')).toBeInTheDocument();
    expect(screen.getByText(/temporarily suspended by the platform administrator/i)).toBeInTheDocument();
  });

  it('triggers onSignOut callback when sign out button is clicked', () => {
    const onSignOut = vi.fn();
    render(
      <LicenseExpiredScreen
        organizationName="Tenaga Nasional Berhad"
        onSignOut={onSignOut}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('triggers onCheckAgain callback when Check Status button is clicked', () => {
    const onCheckAgain = vi.fn();
    render(
      <LicenseExpiredScreen
        organizationName="Tenaga Nasional Berhad"
        onSignOut={vi.fn()}
        onCheckAgain={onCheckAgain}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Check Status/i }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it('shows loading indicator and disables Check Status button when checking', () => {
    render(
      <LicenseExpiredScreen
        organizationName="Tenaga Nasional Berhad"
        onSignOut={vi.fn()}
        onCheckAgain={vi.fn()}
        checking={true}
      />
    );

    const checkBtn = screen.getByRole('button', { name: /Checking Status…/i });
    expect(checkBtn).toBeInTheDocument();
    expect(checkBtn).toBeDisabled();
  });
});

describe('needsLicenseLockout Guard Logic', () => {
  const mockOrg: Organization = {
    id: 'org-test-1',
    name: 'Test Corporation',
    slug: 'test-corp',
    clientCode: 'TEST-01',
    databaseType: 'cloud_shared',
    databaseConfig: {},
    status: 'active',
    licenseType: 'cloud_saas',
    licenseExpiresAt: '2027-12-31T23:59:59Z',
    settings: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  };

  const createLicenseState = (overrides: Partial<TenantLicenseState> = {}): TenantLicenseState => ({
    organization: mockOrg,
    isExpired: false,
    isSuspended: false,
    licenseExpiresAt: '2027-12-31T23:59:59Z',
    checking: false,
    error: null,
    refresh: vi.fn(),
    ...overrides
  });

  it('allows access when user has no session', () => {
    const result = needsLicenseLockout({
      licenseState: createLicenseState({ isExpired: true }),
      isPlatformAdmin: false,
      isGuest: false,
      hasSession: false,
      route: 'dashboard'
    });
    expect(result).toBe(false);
  });

  it('allows access for guest users without lockout', () => {
    const result = needsLicenseLockout({
      licenseState: createLicenseState({ isExpired: true }),
      isPlatformAdmin: false,
      isGuest: true,
      hasSession: true,
      route: 'dashboard'
    });
    expect(result).toBe(false);
  });

  it('allows access on exempt routes (landing, signin, console, console-login)', () => {
    const routes = ['landing', 'signin', 'console', 'console-login'];
    for (const route of routes) {
      const result = needsLicenseLockout({
        licenseState: createLicenseState({ isExpired: true }),
        isPlatformAdmin: false,
        isGuest: false,
        hasSession: true,
        route
      });
      expect(result).toBe(false);
    }
  });

  it('exempts platform administrators from tenant lockout so sellers can diagnose workspaces', () => {
    const result = needsLicenseLockout({
      licenseState: createLicenseState({ isExpired: true, isSuspended: true }),
      isPlatformAdmin: true,
      isGuest: false,
      hasSession: true,
      route: 'dashboard'
    });
    expect(result).toBe(false);
  });

  it('allows active, non-expired organizations into the workspace', () => {
    const result = needsLicenseLockout({
      licenseState: createLicenseState({ isExpired: false, isSuspended: false }),
      isPlatformAdmin: false,
      isGuest: false,
      hasSession: true,
      route: 'dashboard'
    });
    expect(result).toBe(false);
  });

  it('locks out expired client organizations from the dashboard', () => {
    const result = needsLicenseLockout({
      licenseState: createLicenseState({ isExpired: true }),
      isPlatformAdmin: false,
      isGuest: false,
      hasSession: true,
      route: 'dashboard'
    });
    expect(result).toBe(true);
  });

  it('locks out suspended client organizations from the dashboard', () => {
    const result = needsLicenseLockout({
      licenseState: createLicenseState({ isSuspended: true }),
      isPlatformAdmin: false,
      isGuest: false,
      hasSession: true,
      route: 'dashboard'
    });
    expect(result).toBe(true);
  });

  it('allows unassigned or unverified states to be handled by awaiting assignment', () => {
    const result = needsLicenseLockout({
      licenseState: null,
      isPlatformAdmin: false,
      isGuest: false,
      hasSession: true,
      route: 'dashboard'
    });
    expect(result).toBe(false);
  });
});
