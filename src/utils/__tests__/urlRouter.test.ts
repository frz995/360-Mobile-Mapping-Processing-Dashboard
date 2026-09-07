import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseWorkspace,
  pushWorkspace,
  replaceWorkspace,
  subscribeWorkspace,
  isExplicitRoute,
  DEFAULT_WORKSPACE,
  WORKSPACE_KEYS
} from '../urlRouter';

describe('urlRouter', () => {
  const originalHref = window.location.href;

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.location.hash = '';
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalHref);
  });

  it('falls back to DEFAULT_WORKSPACE for empty or missing paths', () => {
    expect(parseWorkspace('/')).toBe(DEFAULT_WORKSPACE);
    expect(parseWorkspace('')).toBe(DEFAULT_WORKSPACE);
    expect(parseWorkspace('   ')).toBe(DEFAULT_WORKSPACE);
    expect(parseWorkspace('/   ')).toBe(DEFAULT_WORKSPACE);
  });

  it('parses standard lowercase workspaces', () => {
    expect(parseWorkspace('/dashboard')).toBe('dashboard');
    expect(parseWorkspace('/data')).toBe('data');
    expect(parseWorkspace('/settings')).toBe('settings');
    expect(parseWorkspace('/reports')).toBe('reports');
    expect(parseWorkspace('/analytics')).toBe('analytics');
    expect(parseWorkspace('/administration')).toBe('administration');
    expect(parseWorkspace('/landing')).toBe('landing');
    expect(parseWorkspace('/signin')).toBe('signin');
  });

  it('resolves aliases cleanly', () => {
    expect(parseWorkspace('/login')).toBe('signin');
    expect(parseWorkspace('/showcase')).toBe('landing');
  });

  it('resolves camelCase roadAnalysis case-insensitively', () => {
    expect(parseWorkspace('/roadAnalysis')).toBe('roadAnalysis');
    expect(parseWorkspace('/roadanalysis')).toBe('roadAnalysis');
    expect(parseWorkspace('/ROADANALYSIS')).toBe('roadAnalysis');
  });

  it('handles query parameters cleanly', () => {
    expect(parseWorkspace('/roadAnalysis?tab=compare&subgrid=SG01')).toBe('roadAnalysis');
    expect(parseWorkspace('/data?filter=active')).toBe('data');
  });

  it('falls back to DEFAULT_WORKSPACE for unknown routes', () => {
    expect(parseWorkspace('/nonexistent_workspace')).toBe(DEFAULT_WORKSPACE);
    expect(parseWorkspace('/random123')).toBe(DEFAULT_WORKSPACE);
  });

  it('includes all WORKSPACE_KEYS dynamically', () => {
    for (const key of WORKSPACE_KEYS) {
      expect(parseWorkspace(`/${key}`)).toBe(key);
      expect(parseWorkspace(`/${key.toLowerCase()}`)).toBe(key);
    }
  });

  describe('legacy hash fallback', () => {
    it('resolves legacy #/key hashes when the pathname names no route', () => {
      window.location.hash = '#/roadAnalysis';
      expect(parseWorkspace()).toBe('roadAnalysis');
      expect(isExplicitRoute()).toBe(true);
    });

    it('resolves aliased and query-bearing legacy hashes', () => {
      window.location.hash = '#/login';
      expect(parseWorkspace()).toBe('signin');
      window.location.hash = '#/data?subgrid=N93E70';
      expect(parseWorkspace()).toBe('data');
    });

    it('ignores the legacy hash when the pathname names a route (precedence)', () => {
      window.history.pushState({}, '', '/dashboard');
      window.location.hash = '#/roadAnalysis';
      expect(parseWorkspace()).toBe('dashboard');
      expect(isExplicitRoute()).toBe(true);
    });

    it('treats /index.html as non-explicit and falls back to the hash', () => {
      window.history.pushState({}, '', '/index.html');
      window.location.hash = '#/roadAnalysis';
      expect(parseWorkspace()).toBe('roadAnalysis');
      expect(isExplicitRoute()).toBe(true);
    });
  });

  describe('isExplicitRoute', () => {
    it('is false for root and index paths without a route hash', () => {
      expect(isExplicitRoute()).toBe(false);
      window.history.pushState({}, '', '/index.html');
      expect(isExplicitRoute()).toBe(false);
    });

    it('is true for an explicit workspace path', () => {
      window.history.pushState({}, '', '/data');
      expect(isExplicitRoute()).toBe(true);
      expect(parseWorkspace()).toBe('data');
    });
  });

  describe('pushWorkspace / replaceWorkspace / subscribeWorkspace', () => {
    it('pushes a clean path and notifies listeners', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeWorkspace(listener);

      pushWorkspace('roadAnalysis');

      expect(window.location.pathname).toBe('/roadAnalysis');
      expect(window.location.hash).toBe('');
      expect(listener).toHaveBeenCalledWith('roadAnalysis');

      unsubscribe();
    });

    it('serializes query parameters onto the path', () => {
      pushWorkspace('data', { subgrid: 'N93E70' });
      expect(window.location.pathname).toBe('/data');
      expect(window.location.search).toBe('?subgrid=N93E70');
    });

    it('replaces the current entry and notifies listeners', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeWorkspace(listener);

      pushWorkspace('data');
      replaceWorkspace('dashboard');

      expect(window.location.pathname).toBe('/dashboard');
      expect(listener).toHaveBeenLastCalledWith('dashboard');

      unsubscribe();
    });

    it('clears a stale legacy hash when the target path is already current', () => {
      window.location.hash = '#/dashboard';
      expect(window.location.pathname).toBe('/');
      pushWorkspace('dashboard');
      expect(window.location.pathname).toBe('/dashboard');
      expect(window.location.hash).toBe('');
    });

    it('emits the resolved workspace on popstate (back/forward)', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeWorkspace(listener);

      window.history.pushState({}, '', '/reports');
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

      expect(listener).toHaveBeenCalledWith('reports');

      unsubscribe();
    });
  });
});