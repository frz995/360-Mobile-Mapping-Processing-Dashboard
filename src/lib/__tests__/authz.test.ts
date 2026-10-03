import { describe, it, expect } from 'vitest';
import {
  normalizeRole,
  getRoleCapabilities,
  can,
  canAny,
  isAdminRole,
  roleFromEmail,
  isGuestEmail,
  isAuthzCapability,
  resolveMatrix,
  serializeMatrix,
  ROLE_CAPABILITIES,
  DEFAULT_ROLE_PERMISSIONS,
  ENFORCED_CAPABILITIES,
  USER_ROLES,
  ROLE_ADMINISTRATOR,
  ROLE_OPERATOR,
  ROLE_QA_INSPECTOR,
  ROLE_VIEWER,
  type AuthzCapability
} from '../authz';

describe('normalizeRole', () => {
  it('normalises display and short role values', () => {
    expect(normalizeRole('Administrator')).toBe(ROLE_ADMINISTRATOR);
    expect(normalizeRole('admin')).toBe(ROLE_ADMINISTRATOR);
    expect(normalizeRole('Survey Operator')).toBe(ROLE_OPERATOR);
    expect(normalizeRole('operator')).toBe(ROLE_OPERATOR);
    expect(normalizeRole('QA Inspector')).toBe(ROLE_QA_INSPECTOR);
    expect(normalizeRole('inspector')).toBe(ROLE_QA_INSPECTOR);
    expect(normalizeRole('Viewer')).toBe(ROLE_VIEWER);
    expect(normalizeRole('')).toBe(ROLE_VIEWER);
    expect(normalizeRole(undefined)).toBe(ROLE_VIEWER);
  });

  it('folds the guest pseudo-role into Viewer', () => {
    expect(normalizeRole('guest')).toBe(ROLE_VIEWER);
  });
});

describe('capability map', () => {
  it('admins get every capability', () => {
    const caps = getRoleCapabilities('Administrator');
    expect(caps).toContain('manageSettings');
    expect(caps).toContain('manageUsers');
    expect(caps).toContain('approveDeletions');
    expect(caps).toContain('deleteData');
    expect(caps).toContain('reviewQaqc');
  });

  it('operators delete data + run QAQC but cannot manage settings/users', () => {
    expect(can('Survey Operator', 'deleteData')).toBe(true);
    expect(can('Survey Operator', 'runQaqc')).toBe(true);
    expect(can('Survey Operator', 'manageSettings')).toBe(false);
    expect(can('Survey Operator', 'manageUsers')).toBe(false);
  });

  it('QA inspectors run + review QAQC but cannot delete data', () => {
    expect(can('QA Inspector', 'runQaqc')).toBe(true);
    expect(can('QA Inspector', 'reviewQaqc')).toBe(true);
    expect(can('QA Inspector', 'deleteData')).toBe(false);
  });

  it('viewers can only view and export', () => {
    expect(can('Viewer', 'viewAll')).toBe(true);
    expect(can('Viewer', 'exportPublishedReports')).toBe(true);
    expect(can('Viewer', 'runQaqc')).toBe(false);
    expect(can('Viewer', 'deleteData')).toBe(false);
  });

  it('unknown roles default to Viewer', () => {
    expect(can('nonsense', 'viewAll')).toBe(true);
    expect(can('nonsense', 'manageSettings')).toBe(false);
  });

  it('operators drive the production pipeline but inspectors cannot', () => {
    expect(can('Survey Operator', 'runIntake')).toBe(true);
    expect(can('Survey Operator', 'runPipeline')).toBe(true);
    expect(can('Survey Operator', 'publishSequences')).toBe(true);
    expect(can('QA Inspector', 'runIntake')).toBe(false);
    expect(can('QA Inspector', 'runPipeline')).toBe(false);
    expect(can('QA Inspector', 'publishSequences')).toBe(false);
  });

  it('only the QA track holds publishToWebGIS among non-admins', () => {
    expect(can('Survey Operator', 'publishToWebGIS')).toBe(true);
    expect(can('QA Inspector', 'publishToWebGIS')).toBe(true);
    expect(can('Viewer', 'publishToWebGIS')).toBe(false);
  });
});

describe('capability catalogue', () => {
  it('uses the three two-track scopes and no legacy scope names', () => {
    const scopes = new Set(ROLE_CAPABILITIES.map((c) => c.scope));
    expect([...scopes].sort()).toEqual(['governance', 'production', 'published']);
    for (const cap of ROLE_CAPABILITIES) {
      expect(cap.scope).not.toBe('workspace');
      expect(cap.scope).not.toBe('webgis');
    }
  });

  it('has no duplicate capability ids', () => {
    const ids = ROLE_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops the webgisCameraCalibration capability that never existed here', () => {
    expect(isAuthzCapability('webgisCameraCalibration')).toBe(false);
    expect(isAuthzCapability('webgisUpload')).toBe(false);
  });

  it('marks only the structurally required rows as locked', () => {
    const locked = ROLE_CAPABILITIES.filter((c) => c.locked).map((c) => c.id);
    expect(locked.sort()).toEqual(['manageSettings', 'manageUsers', 'viewAll']);
    // Only the read-only baseline is unconditional across roles.
    const alwaysOn = ROLE_CAPABILITIES.filter((c) => c.alwaysOn).map((c) => c.id);
    expect(alwaysOn).toEqual(['viewAll']);
  });

  it('grants the alwaysOn baseline to every role', () => {
    for (const role of USER_ROLES) {
      expect(can(role, 'viewAll'), `${role} must keep viewAll`).toBe(true);
    }
  });

  it('locks the Administrator governance rights but still denies them to other roles', () => {
    for (const cap of ['manageUsers', 'manageSettings'] as const) {
      expect(can(ROLE_ADMINISTRATOR, cap), `admin must keep ${cap}`).toBe(true);
      expect(can(ROLE_OPERATOR, cap), `operator must NOT have ${cap}`).toBe(false);
      expect(can(ROLE_QA_INSPECTOR, cap), `inspector must NOT have ${cap}`).toBe(false);
      expect(can(ROLE_VIEWER, cap), `viewer must NOT have ${cap}`).toBe(false);
    }
  });

  it('flags exactly the RLS-enforced rows', () => {
    const flagged = ROLE_CAPABILITIES.filter((c) => c.enforced).map((c) => c.id);
    expect(flagged.sort()).toEqual([...ENFORCED_CAPABILITIES].sort());
  });
});

describe('canAny', () => {
  it('passes when any listed capability is held', () => {
    expect(canAny('QA Inspector', ['manageUsers', 'reviewQaqc'])).toBe(true);
    expect(canAny('Viewer', ['manageUsers', 'reviewQaqc'])).toBe(false);
  });

  it('treats an empty guard list as unrestricted', () => {
    expect(canAny('Viewer', [])).toBe(true);
  });
});

describe('resolveMatrix', () => {
  it('returns the shipped defaults for missing or junk input', () => {
    expect(resolveMatrix(null)).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveMatrix(undefined)).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveMatrix('nonsense')).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  it('applies a stored override on top of the defaults', () => {
    const matrix = resolveMatrix({ Viewer: { exportPublishedReports: false } });
    expect(can('Viewer', 'exportPublishedReports', matrix)).toBe(false);
    // Untouched capabilities keep their default.
    expect(can('Viewer', 'viewAll', matrix)).toBe(true);
    expect(can('Survey Operator', 'exportPublishedReports', matrix)).toBe(true);
  });

  it('cannot switch a structural row off', () => {
    const matrix = resolveMatrix({
      Viewer: { viewAll: false },
      'Survey Operator': { manageUsers: true }
    });
    // viewAll is alwaysOn -> granted to everyone regardless.
    expect(can('Viewer', 'viewAll', matrix)).toBe(true);
    // manageUsers is locked for the Administrator only, so an operator grant sticks.
    expect(can('Survey Operator', 'manageUsers', matrix)).toBe(true);
    expect(can('QA Inspector', 'manageUsers', matrix)).toBe(false);
  });

  it('ignores non-boolean values', () => {
    const matrix = resolveMatrix({ Viewer: { exportPublishedReports: 'yes' } });
    expect(can('Viewer', 'exportPublishedReports', matrix)).toBe(true);
  });

  it('drops the unreachable guest row', () => {
    const matrix = resolveMatrix({ guest: { exportPublishedReports: false } });
    expect(Object.keys(matrix).sort()).toEqual([...USER_ROLES].sort());
    expect('guest' in matrix).toBe(false);
  });
});

describe('serializeMatrix', () => {
  it('strips ids outside the current vocabulary', () => {
    const clean = serializeMatrix(resolveMatrix({ Viewer: { webgisUpload: true } as any }));
    expect(Object.keys(clean.Viewer).every((id) => isAuthzCapability(id))).toBe(true);
  });

  it('round-trips a resolved matrix unchanged', () => {
    const resolved = resolveMatrix({ Viewer: { runQaqc: true, viewAll: true } });
    expect(serializeMatrix(resolved)).toEqual(resolved);
  });

  it('normalises truthy values to real booleans', () => {
    const clean = serializeMatrix({
      Administrator: { runIntake: true },
      'Survey Operator': { runIntake: true },
      'QA Inspector': { runIntake: false },
      Viewer: {}
    });
    expect(clean.Administrator.runIntake).toBe(true);
    expect(clean['QA Inspector'].runIntake).toBe(false);
  });
});

describe('isAdminRole', () => {
  it('accepts administrator spellings only', () => {
    expect(isAdminRole('Administrator')).toBe(true);
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('Survey Operator')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });
});

describe('email-derived role helpers', () => {
  it('flags guest emails', () => {
    expect(isGuestEmail('guest@x.com')).toBe(true);
    expect(isGuestEmail(' admin@x.com ')).toBe(false);
  });

  it('derives admin from emails containing admin', () => {
    expect(roleFromEmail('admin@x.com')).toBe(ROLE_ADMINISTRATOR);
    expect(roleFromEmail('fariz@x.com')).toBe(ROLE_OPERATOR);
    expect(roleFromEmail('')).toBe(ROLE_VIEWER);
  });
});

describe('type guard', () => {
  it('narrows only known capability ids', () => {
    const id: AuthzCapability = 'publishToWebGIS';
    expect(isAuthzCapability(id)).toBe(true);
    expect(isAuthzCapability('publishSequences ')).toBe(false);
    expect(isAuthzCapability(42)).toBe(false);
  });
});
