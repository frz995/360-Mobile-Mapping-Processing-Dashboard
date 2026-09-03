import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseHashWorkspace,
  setHashWorkspace,
  subscribeHashWorkspace,
  DEFAULT_WORKSPACE,
  WORKSPACE_KEYS
} from '../hashRouter';

describe('hashRouter', () => {
  it('falls back to DEFAULT_WORKSPACE for empty or missing hashes', () => {
    expect(parseHashWorkspace('')).toBe(DEFAULT_WORKSPACE);
    expect(parseHashWorkspace('#')).toBe(DEFAULT_WORKSPACE);
    expect(parseHashWorkspace('#/')).toBe(DEFAULT_WORKSPACE);
    expect(parseHashWorkspace('   ')).toBe(DEFAULT_WORKSPACE);
  });

  it('parses standard lowercase workspaces', () => {
    expect(parseHashWorkspace('#/dashboard')).toBe('dashboard');
    expect(parseHashWorkspace('#/data')).toBe('data');
    expect(parseHashWorkspace('#/settings')).toBe('settings');
    expect(parseHashWorkspace('#/reports')).toBe('reports');
    expect(parseHashWorkspace('#/analytics')).toBe('analytics');
    expect(parseHashWorkspace('#/administration')).toBe('administration');
  });

  it('resolves camelCase roadAnalysis case-insensitively', () => {
    expect(parseHashWorkspace('#/roadAnalysis')).toBe('roadAnalysis');
    expect(parseHashWorkspace('#/roadanalysis')).toBe('roadAnalysis');
    expect(parseHashWorkspace('#/ROADANALYSIS')).toBe('roadAnalysis');
    expect(parseHashWorkspace('#roadAnalysis')).toBe('roadAnalysis');
  });

  it('handles query parameters and hash fragments cleanly', () => {
    expect(parseHashWorkspace('#/roadAnalysis?tab=compare&subgrid=SG01')).toBe('roadAnalysis');
    expect(parseHashWorkspace('#/data?filter=active')).toBe('data');
  });

  it('falls back to DEFAULT_WORKSPACE for unknown routes', () => {
    expect(parseHashWorkspace('#/nonexistent_workspace')).toBe(DEFAULT_WORKSPACE);
    expect(parseHashWorkspace('#/random123')).toBe(DEFAULT_WORKSPACE);
  });

  it('includes all WORKSPACE_KEYS dynamically', () => {
    for (const key of WORKSPACE_KEYS) {
      expect(parseHashWorkspace(`#/${key}`)).toBe(key);
      expect(parseHashWorkspace(`#/${key.toLowerCase()}`)).toBe(key);
    }
  });

  describe('setHashWorkspace and subscribeHashWorkspace', () => {
    const originalHash = window.location.hash;

    afterEach(() => {
      window.location.hash = originalHash;
    });

    it('sets the hash formatted as #/{key}', () => {
      setHashWorkspace('roadAnalysis');
      expect(window.location.hash).toBe('#/roadAnalysis');
    });

    it('subscribes to hash changes and triggers listener', () => {
      const listener = vi.fn();
      const unsubscribe = subscribeHashWorkspace(listener);

      window.location.hash = '#/roadAnalysis';
      window.dispatchEvent(new HashChangeEvent('hashchange'));

      expect(listener).toHaveBeenCalledWith('roadAnalysis');

      unsubscribe();
    });
  });
});
