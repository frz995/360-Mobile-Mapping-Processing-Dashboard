import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACTIVE_PROJECT_KEY_PREFIX,
  computeUserKey,
  setActiveProjectId,
  getActiveProjectId,
  saveActiveProjectId,
  loadActiveProjectId,
  clearActiveProjectId
} from '../projectContext';

describe('projectContext active-project state', () => {
  beforeEach(() => {
    localStorage.clear();
    // Memory override persists across tests — reset via public API.
    setActiveProjectId(null);
  });

  it('computes guest user key when no auth token is present', () => {
    expect(computeUserKey()).toBe('guest');
  });

  it('resolves the user key from the persisted auth token (id first, then email)', () => {
    localStorage.setItem('sb-xyz-auth-token', JSON.stringify({ user: { id: 'u-9', email: 'A@B.com' } }));
    expect(computeUserKey()).toBe('u-9');
    localStorage.setItem('sb-xyz-auth-token', JSON.stringify({ user: { email: '  A@B.com  ' } }));
    expect(computeUserKey()).toBe('a@b.com');
  });

  it('falls back to guest for malformed tokens without crashing', () => {
    localStorage.setItem('sb-xyz-auth-token', '{not json');
    expect(computeUserKey()).toBe('guest');
  });

  it('set + get round-trips through memory first', () => {
    setActiveProjectId('proj-mem');
    expect(getActiveProjectId()).toBe('proj-mem');
  });

  it('saves per-user storage and loads it back partitioned by user key', () => {
    saveActiveProjectId('alice', 'proj-a');
    saveActiveProjectId('bob', 'proj-b');
    expect(loadActiveProjectId('alice')).toBe('proj-a');
    expect(loadActiveProjectId('bob')).toBe('proj-b');
    expect(getActiveProjectId()).toBe('proj-b');
  });

  it('reads storage when memory is empty', () => {
    saveActiveProjectId(computeUserKey(), 'proj-stored');
    setActiveProjectId(null);
    expect(getActiveProjectId()).toBe('proj-stored');
  });

  it('clears storage and clears memory only for the matching user', () => {
    saveActiveProjectId('alice', 'proj-a');
    saveActiveProjectId('bob', 'proj-b');
    clearActiveProjectId('alice');
    expect(loadActiveProjectId('alice')).toBeNull();
    expect(loadActiveProjectId('bob')).toBe('proj-b');
  });

  it('stores under the documented per-user key prefix', () => {
    saveActiveProjectId('alice', 'proj-a');
    expect(localStorage.getItem(`${ACTIVE_PROJECT_KEY_PREFIX}alice`)).toBe('proj-a');
  });
});