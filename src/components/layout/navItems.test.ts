import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, ACCOUNT_ITEMS, ROUTE_ITEMS } from './navItems';

/**
 * The split between "in the tab bar" and "is a valid route" is the thing worth guarding.
 * Reports is reachable at `#reports` but deliberately absent from the tab bar, and the two
 * lists feed different consumers: `TopNav` renders NAV_ITEMS, while `App.tsx` validates
 * routes and sets the document title from ROUTE_ITEMS. Deriving routes from NAV_ITEMS — as
 * it did before Reports moved — would send `#reports` silently back to Overview.
 */
describe('navItems', () => {
  it('keeps the tab bar at the five main pages, in order', () => {
    expect(NAV_ITEMS.map((n) => n.id)).toEqual(['overview', 'analytics', 'control', 'devices', 'automation']);
  });

  it('does not put Reports in the tab bar', () => {
    expect(NAV_ITEMS.some((n) => n.id === 'reports')).toBe(false);
  });

  it('still treats Reports as a real route, reachable from the account menu', () => {
    expect(ACCOUNT_ITEMS.map((n) => n.id)).toEqual(['reports']);
    expect(ROUTE_ITEMS.some((n) => n.id === 'reports')).toBe(true);
  });

  it('ROUTE_ITEMS is every navigable page — the tab bar plus the account menu', () => {
    expect(ROUTE_ITEMS.map((n) => n.id)).toEqual([...NAV_ITEMS.map((n) => n.id), ...ACCOUNT_ITEMS.map((n) => n.id)]);
  });

  it('every route has a label, because App.tsx builds the browser-tab title from it', () => {
    for (const item of ROUTE_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it('no id appears twice — a duplicate would make two pages fight over one hash', () => {
    const ids = ROUTE_ITEMS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
