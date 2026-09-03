import { describe, it, expect } from 'vitest';
import {
  normalizeRole,
  getRoleCapabilities,
  can,
  isAdminRole,
  roleFromEmail,
  isGuestEmail,
  ROLE_ADMINISTRATOR,
  ROLE_OPERATOR,
  ROLE_QA_INSPECTOR,
  ROLE_VIEWER
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

  it('viewers can only view', () => {
    expect(can('Viewer', 'viewAll')).toBe(true);
    expect(can('Viewer', 'runQaqc')).toBe(false);
    expect(can('Viewer', 'deleteData')).toBe(false);
  });

  it('unknown roles default to Viewer', () => {
    expect(can('nonsense', 'viewAll')).toBe(true);
    expect(can('nonsense', 'manageSettings')).toBe(false);
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
