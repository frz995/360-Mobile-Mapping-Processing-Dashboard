import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PermissionProvider, usePermission, useCapabilities } from '../usePermission';
import { setCachedRolePermissions } from '../../services/api/permissions';
import {
  resolveMatrix,
  DEFAULT_ROLE_PERMISSIONS,
  type RolePermissionsMatrix
} from '../../lib/authz';

vi.mock('../../services/api/permissions', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/permissions')>(
    '../../services/api/permissions'
  );
  return {
    ...actual,
    // Keep the provider on the matrix it is handed; no Supabase read in tests.
    fetchRolePermissions: vi.fn(async () => actual.getCachedRolePermissions())
  };
});

function Probe({ capability }: { capability: Parameters<typeof usePermission>[0] }) {
  const allowed = usePermission(capability);
  return <span data-testid="probe">{allowed ? 'allowed' : 'denied'}</span>;
}

function renderWithProvider(
  ui: React.ReactNode,
  props: { role?: string; isGuest?: boolean; matrix?: RolePermissionsMatrix } = {}
) {
  return render(
    <PermissionProvider role={props.role ?? 'Survey Operator'} isGuest={props.isGuest} matrix={props.matrix}>
      {ui}
    </PermissionProvider>
  );
}

beforeEach(() => {
  cleanup();
  setCachedRolePermissions(DEFAULT_ROLE_PERMISSIONS);
});

describe('usePermission without a provider', () => {
  it('fails closed', () => {
    render(<Probe capability="deleteData" />);
    expect(screen.getByTestId('probe').textContent).toBe('denied');
  });

  it('useCapabilities still returns a usable object', () => {
    function RoleProbe() {
      const { role } = useCapabilities();
      return <span data-testid="role">{role}</span>;
    }
    render(<RoleProbe />);
    expect(screen.getByTestId('role').textContent).toBe('Viewer');
  });
});

describe('usePermission with the default matrix', () => {
  it('grants the operator pipeline capabilities', () => {
    renderWithProvider(
      <>
        <Probe capability="runIntake" />
        <Probe capability="publishSequences" />
      </>,
      { role: 'Survey Operator' }
    );
    expect(screen.getAllByTestId('probe').map((n) => n.textContent)).toEqual(['allowed', 'allowed']);
  });

  it('denies the operator governance capabilities', () => {
    renderWithProvider(<Probe capability="manageUsers" />, { role: 'Survey Operator' });
    expect(screen.getByTestId('probe').textContent).toBe('denied');
  });

  it('grants the inspector QA sign-off but not the pipeline', () => {
    renderWithProvider(
      <>
        <Probe capability="reviewQaqc" />
        <Probe capability="runPipeline" />
      </>,
      { role: 'QA Inspector' }
    );
    expect(screen.getAllByTestId('probe').map((n) => n.textContent)).toEqual(['allowed', 'denied']);
  });

  it('restricts the Viewer to the read-only baseline', () => {
    renderWithProvider(<Probe capability="deleteData" />, { role: 'Viewer' });
    expect(screen.getByTestId('probe').textContent).toBe('denied');
  });
});

describe('usePermission honours an admin override', () => {
  it('denies a capability the administrator switched off', () => {
    const matrix = resolveMatrix({ 'Survey Operator': { publishToWebGIS: false } });
    renderWithProvider(
      <>
        <Probe capability="publishToWebGIS" />
        <Probe capability="publishSequences" />
      </>,
      { role: 'Survey Operator', matrix }
    );
    // Only the release half is revoked; bucket upload is untouched.
    expect(screen.getAllByTestId('probe').map((n) => n.textContent)).toEqual(['denied', 'allowed']);
  });
});

describe('guest sessions', () => {
  it('denies every capability regardless of the role behind it', () => {
    renderWithProvider(
      <>
        <Probe capability="viewAll" />
        <Probe capability="deleteData" />
      </>,
      { role: 'Administrator', isGuest: true }
    );
    expect(screen.getAllByTestId('probe').map((n) => n.textContent)).toEqual(['denied', 'denied']);
  });
});
