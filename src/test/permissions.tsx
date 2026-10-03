import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { PermissionProvider } from '../hooks/usePermission';
import { DEFAULT_ROLE_PERMISSIONS, type UserRole } from '../lib/authz';

/**
 * `usePermission` fails closed when no provider is mounted, which is the right
 * production behaviour but means a component under test has every write control
 * disabled. These helpers mount the provider with the shipped default matrix so
 * a test exercises the real (non-guest) permission path.
 *
 * Pass an explicit matrix to assert a denied capability.
 */
export function renderWithPermissions(
  ui: ReactElement,
  options: { role?: UserRole; matrix?: typeof DEFAULT_ROLE_PERMISSIONS } = {}
) {
  return render(
    <PermissionProvider role={options.role ?? 'Administrator'} matrix={options.matrix ?? DEFAULT_ROLE_PERMISSIONS}>
      {ui}
    </PermissionProvider>
  );
}

/** Wrap an already-built element for `render`/`rerender` call sites. */
export function withPermissions(
  ui: ReactElement,
  options: { role?: UserRole; matrix?: typeof DEFAULT_ROLE_PERMISSIONS } = {}
): ReactElement {
  return (
    <PermissionProvider role={options.role ?? 'Administrator'} matrix={options.matrix ?? DEFAULT_ROLE_PERMISSIONS}>
      {ui}
    </PermissionProvider>
  );
}
