import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readWorkspaceLocation,
  getStoredWorkspaceKey,
  setStoredWorkspaceKey,
  restoreWorkspaceTab,
  persistWorkspaceTab,
  clearWorkspaceLocation,
  getLastActivityAgeMs,
  hasLastActivity,
  touchLastActivity,
  clearLastActivity
} from '../workspaceLocation';

describe('workspaceLocation persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe('workspace key', () => {
    it('is undefined when nothing was saved', () => {
      expect(getStoredWorkspaceKey()).toBeUndefined();
    });

    it('round-trips a workspace key', () => {
      setStoredWorkspaceKey('production');
      expect(getStoredWorkspaceKey()).toBe('production');
    });

    it('ignores invalid workspace keys stored by older builds', () => {
      window.localStorage.setItem('geosphere360_workspace_location', JSON.stringify({ workspace: 'bogus' }));
      expect(getStoredWorkspaceKey()).toBeUndefined();
    });

    it('clears the whole location store', () => {
      setStoredWorkspaceKey('reports');
      persistWorkspaceTab('reports', 'qa');
      clearWorkspaceLocation();
      expect(getStoredWorkspaceKey()).toBeUndefined();
      expect(readWorkspaceLocation()).toEqual({});
    });
  });

  describe('workspace tab restore', () => {
    const allowed = ['pipeline', 'datasets', 'preview'] as const;

    it('returns null when nothing was saved', () => {
      expect(restoreWorkspaceTab('production', allowed)).toBeNull();
    });

    it('restores a previously persisted tab', () => {
      persistWorkspaceTab('production', 'preview');
      expect(restoreWorkspaceTab('production', allowed)).toBe('preview');
    });

    it('rejects tab values outside the allowed set', () => {
      persistWorkspaceTab('production', 'not-a-real-tab');
      expect(restoreWorkspaceTab('production', allowed)).toBeNull();
    });

    it('keeps tabs isolated per workspace', () => {
      persistWorkspaceTab('production', 'preview');
      persistWorkspaceTab('reports', 'qa');
      expect(restoreWorkspaceTab('production', allowed)).toBe('preview');
    });
  });

  describe('last activity age', () => {
    it('has no marker before any activity is recorded', () => {
      expect(hasLastActivity()).toBe(false);
      expect(getLastActivityAgeMs()).toBe(Number.POSITIVE_INFINITY);
    });

    it('is near zero right after touch', () => {
      touchLastActivity();
      expect(hasLastActivity()).toBe(true);
      expect(getLastActivityAgeMs()).toBeLessThan(1000);
    });

    it('becomes infinite again after clear', () => {
      touchLastActivity();
      clearLastActivity();
      expect(hasLastActivity()).toBe(false);
      expect(getLastActivityAgeMs()).toBe(Number.POSITIVE_INFINITY);
    });

    it('ignores corrupted stored timestamps', () => {
      window.localStorage.setItem('geosphere360_last_activity', 'garbage');
      expect(hasLastActivity()).toBe(false);
      expect(getLastActivityAgeMs()).toBe(Number.POSITIVE_INFINITY);
    });
  });
});