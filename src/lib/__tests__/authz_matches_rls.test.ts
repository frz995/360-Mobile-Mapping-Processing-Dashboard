import { describe, it, expect } from 'vitest';
import {
  getRoleCapabilities,
  can,
  isAuthzCapability,
  ROLE_ADMINISTRATOR,
  ROLE_OPERATOR,
  ROLE_QA_INSPECTOR,
  ROLE_VIEWER
} from '../authz';

/**
 * Pin the RLS-enforced slice of the UI vocabulary to the SERVER-side boundary.
 *
 * Postgres `sec.can()` (supabase/migrations/0009_security_functions.sql, applied
 * by 0010/0012/0015/0020/0022) and the Python BFF (`worker/bff/app.py`) are the
 * real enforcement boundary. They only know the eight capabilities below.
 *
 * `src/lib/authz.ts` is a superset: it also carries the Production-pipeline and
 * Published-view capabilities that gate the UI but have no SQL counterpart yet
 * (that unification is phase 8.2 of implementation_plan_v22.md). This test
 * therefore pins only the enforced subset — it must NOT be widened to the whole
 * union, or it would assert enforcement that does not exist.
 *
 * If you rename one of these eight, you MUST update sec.can() and the BFF too.
 */
const ENFORCED_CAPABILITIES = [
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
    // Every capability name in the SQL matrix must exist in the UI vocabulary.
    const caps = getRoleCapabilities(ROLE_ADMINISTRATOR);
    for (const cap of ENFORCED_CAPABILITIES) {
      expect(caps, `${cap} must exist in authz.ts`).toContain(cap);
      expect(isAuthzCapability(cap)).toBe(true);
    }
  });

  it('Administrator can perform every write capability (sec.can admin=all)', () => {
    for (const cap of ENFORCED_CAPABILITIES) {
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
    for (const cap of ENFORCED_CAPABILITIES) {
      if (cap === 'viewAll') continue;
      expect(can(ROLE_VIEWER, cap), `viewer should NOT have ${cap}`).toBe(false);
    }
  });
});
