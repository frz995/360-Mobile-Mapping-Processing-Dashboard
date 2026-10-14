import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseConsolePanel,
  parseConsolePanelFromPath,
  consoleHref,
  pushConsolePanel,
  replaceConsolePanel,
  subscribeConsolePanel,
  getConsoleOrgQuery,
  CONSOLE_PANELS,
  DEFAULT_CONSOLE_PANEL
} from '../consoleRouter';
import { parseWorkspace } from '../urlRouter';

/**
 * The console's panels live in the address bar, not in React state.
 *
 * Before this module existed the console had `activeTab` state and no routing at
 * all: five rail buttons, one body. These cases exist so a regression back to
 * "the panel is whatever React last held" fails here rather than in production,
 * where it looks like a nav that highlights but does nothing.
 */
describe('consoleRouter', () => {
  const originalHref = window.location.href;

  beforeEach(() => {
    window.history.replaceState({}, '', '/console/dashboard');
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalHref);
  });

  it('resolves every declared panel from its path', () => {
    for (const panel of CONSOLE_PANELS) {
      expect(parseConsolePanelFromPath(`/console/${panel.key}`)).toBe(panel.key);
    }
  });

  it('treats the bare /console path as the dashboard', () => {
    expect(parseConsolePanelFromPath('/console')).toBe(DEFAULT_CONSOLE_PANEL);
    expect(parseConsolePanelFromPath('/console/')).toBe(DEFAULT_CONSOLE_PANEL);
  });

  it('falls back to the dashboard for a panel this build does not have', () => {
    // Not an error: a stale link should land somewhere useful rather than 404.
    expect(parseConsolePanelFromPath('/console/tenants')).toBe(DEFAULT_CONSOLE_PANEL);
    expect(parseConsolePanelFromPath('/console/nonsense')).toBe(DEFAULT_CONSOLE_PANEL);
  });

  it('is case-insensitive and tolerates query strings', () => {
    expect(parseConsolePanelFromPath('/console/MEMBERS')).toBe('members');
    expect(parseConsolePanelFromPath('/console/companies?org=org-1')).toBe('companies');
  });

  it('returns null for a path that is not a console path at all', () => {
    // Distinguishes "/console/tenants" from a workspace called /companies.
    expect(parseConsolePanelFromPath('/companies')).toBeNull();
    expect(parseConsolePanelFromPath('/dashboard')).toBeNull();
    expect(parseConsolePanelFromPath('')).toBeNull();
  });

  it('routes every console panel to the console workspace', () => {
    // Without this, /console/companies resolved to DEFAULT_WORKSPACE and the
    // console could not be deep-linked at all.
    expect(parseWorkspace('/console/companies')).toBe('console');
    expect(parseWorkspace('/console/members')).toBe('console');
    expect(parseWorkspace('/console/seats')).toBe('console');
    expect(parseWorkspace('/console/settings')).toBe('console');
  });

  it('still resolves /console/login to the login workspace, not the dashboard', () => {
    // Ordering matters: 'login' must be checked before the generic /console/*
    // prefix, or a signed-in admin refreshing the login URL lands in the
    // console itself.
    expect(parseWorkspace('/console/login')).toBe('console-login');
  });

  it('builds canonical hrefs', () => {
    expect(consoleHref('members')).toBe('/console/members');
    expect(consoleHref('seats', { org: 'org-1' })).toBe('/console/seats?org=org-1');
    expect(consoleHref('members', {})).toBe('/console/members');
  });

  it('pushes a history entry and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsolePanel(listener);

    pushConsolePanel('database');

    expect(window.location.pathname).toBe('/console/database');
    expect(listener).toHaveBeenCalledWith('database');

    unsubscribe();
  });

  it('carries the selected company onto the pushed path', () => {
    const unsubscribe = subscribeConsolePanel(() => {});
    pushConsolePanel('members', { org: 'org-1' });

    expect(window.location.search).toBe('?org=org-1');
    expect(getConsoleOrgQuery()).toBe('org-1');

    unsubscribe();
  });

  it('does not push a second entry when the panel is already current', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsolePanel(listener);
    const before = window.history.length;

    pushConsolePanel('dashboard');

    expect(window.history.length).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('replaces rather than pushes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsolePanel(listener);
    const before = window.history.length;

    replaceConsolePanel('settings');

    expect(window.location.pathname).toBe('/console/settings');
    expect(window.history.length).toBe(before);
    expect(listener).toHaveBeenCalledWith('settings');

    unsubscribe();
  });

  it('re-reads the panel on popstate so Back works', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsolePanel(listener);

    window.history.pushState({}, '', '/console/members');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    expect(listener).toHaveBeenLastCalledWith('members');

    unsubscribe();
  });

  it('reads the panel from the live location', () => {
    window.history.replaceState({}, '', '/console/seats');
    expect(parseConsolePanel()).toBe('seats');
  });

  it('reports an absent org query as empty, not as undefined', () => {
    expect(getConsoleOrgQuery('')).toBe('');
    expect(getConsoleOrgQuery('?other=1')).toBe('');
    expect(getConsoleOrgQuery('?org=')).toBe('');
  });

  it('declares a label and description for every panel', () => {
    // A rail entry with no description is how a panel ships with no stated
    // purpose; the shell renders these directly.
    for (const panel of CONSOLE_PANELS) {
      expect(panel.label.length).toBeGreaterThan(0);
      expect(panel.description.length).toBeGreaterThan(0);
    }
  });
});