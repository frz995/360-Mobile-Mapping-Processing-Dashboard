import { describe, it, expect } from 'vitest';
import {
  getRoleCapabilities,
  can,
  ROLE_ADMINISTRATOR,
  ROLE_OPERATOR,
  ROLE_QA_INSPECTOR,
  ROLE_VIEWER
} from '../authz';

/**
 * A1.4 — Pin the UI capability matrix to the SERVER-side boundary.
 *
 * The authoritative authorization boundary now lives in PostgreSQL
 * (supabase/security_functions.sql -> sec.can(), applied by
 * supabase/security_rls_apply.sql). This test documents the exact matrix the
 * SQL helper enforces so that src/lib/authz.ts (a UX-only mirror) cannot
 * silently drift from what the database actually allows.
 *
 * If you change a capability name or role assignment here, you MUST also
 * update sec.can() in supabase/security_functions.sql to match.
 */
const CAPABILITIES = [
  'manageDatasets',
  'manageSettings',
  'manageUsers',
  'approveDeletions',
  'deleteData',
  'runQaqc',
  'reviewQaqc',
  'viewAll'
] as const;

describe('A1.4 authz mirrors server-side RLS (sec.can)', () => {
  it('exposes a stable capability set that matches security_functions.sql', () => {
    // Every capability name in the SQL matrix must exist here. If a
    // capability was added to sec.can() but not authz.ts, add it to BOTH.
    const caps = getRoleCapabilities(ROLE_ADMINISTRATOR);
    for (const cap of CAPABILITIES) {
      expect(caps).toContain(cap);
    }
  });

  it('Administrator can perform every write capability (sec.can admin=all)', () => {
    for (const cap of CAPABILITIES) {
      expect(can(ROLE_ADMINISTRATOR, cap), `admin should have ${cap}`).toBe(true);
    }
  });

  it('Survey Operator matches sec.can operator grants', () => {
    expect(can(ROLE_OPERATOR, 'deleteData')).toBe(true);
    expect(can(ROLE_OPERATOR, 'runQaqc')).toBe(true);
    expect(can(ROLE_OPERATOR, 'viewAll')).toBe(true);
    // Operator must NOT manage settings/users or approve/review.
    expect(can(ROLE_OPERATOR, 'manageSettings')).toBe(false);
    expect(can(ROLE_OPERATOR, 'manageUsers')).toBe(false);
    expect(can(ROLE_OPERATOR, 'approveDeletions')).toBe(false);
    expect(can(ROLE_OPERATOR, 'reviewQaqc')).toBe(false);
  });

  it('QA Inspector matches sec.can inspector grants', () => {
    expect(can(ROLE_QA_INSPECTOR, 'runQaqc')).toBe(true);
    expect(can(ROLE_QA_INSPECTOR, 'reviewQaqc')).toBe(true);
    expect(can(ROLE_QA_INSPECTOR, 'viewAll')).toBe(true);
    // Inspector cannot delete data, manage settings/users, or approve.
    expect(can(ROLE_QA_INSPECTOR, 'deleteData')).toBe(false);
    expect(can(ROLE_QA_INSPECTOR, 'manageSettings')).toBe(false);
    expect(can(ROLE_QA_INSPECTOR, 'manageUsers')).toBe(false);
    expect(can(ROLE_QA_INSPECTOR, 'approveDeletions')).toBe(false);
  });

  it('Viewer is read-only (viewAll only) exactly as sec.can Viewer branch', () => {
    expect(can(ROLE_VIEWER, 'viewAll')).toBe(true);
    for (const cap of CAPABILITIES) {
      if (cap === 'viewAll') continue;
      expect(can(ROLE_VIEWER, cap), `viewer should NOT have ${cap}`).toBe(false);
    }
  });
});
