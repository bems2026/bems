import { FileText, SlidersHorizontal, type LucideIcon } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  /**
   * Only the account menu draws one — the tab bar reads fine on labels alone (see `NAV_ITEMS`).
   *
   * It lives on the ITEM rather than in the menu because the menu used to hard-code `FileText`
   * for every entry, so Reports and Settings rendered the same glyph and the icon column carried
   * no information at all. Declaring it here means a new entry cannot silently inherit somebody
   * else's icon: it has to say what it is.
   */
  icon?: LucideIcon;
}

/**
 * Phase M's 5 pages, in the v4 design's own tab order (Overview, Analytics, Control,
 * Devices, Automation — the design's file itself reorders Devices/Automation partway
 * through its own history; this is the final v4 order). Each `id` doubles as the route
 * hash `useHashRoute` reads and `App.tsx` switches on.
 *
 * No icons — Phase L's sidebar used lucide icons because a collapsed icon-only rail needed
 * them to stay legible; a horizontal pill tab bar reads fine on text labels alone, and v4's
 * own nav has none.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'control', label: 'Control' },
  { id: 'devices', label: 'Devices' },
  { id: 'automation', label: 'Automation' },
];

/**
 * Pages that are real routes but deliberately NOT in the tab bar — reached from the account
 * menu instead (`AccountMenu.tsx`).
 *
 * Reports lives here rather than as a sixth tab because the tab bar is the building's five
 * operational views, all of which answer "what is happening now". A monthly report looks
 * backwards at finished months and is read occasionally, by whoever is compiling something —
 * a different job, and a sixth tab would have made the primary navigation wider on a nav that
 * already wraps to two rows below 860px.
 */
export const ACCOUNT_ITEMS: NavItem[] = [
  { id: 'reports', label: 'Reports', icon: FileText },
  /**
   * Settings sits here rather than in the tab bar for the same reason Reports does, and for one
   * more that is specific to it: the five tabs answer "what is happening in the building now",
   * and configuration answers "how is this deployment set up". They are read at different times
   * by different people.
   *
   * It exists because the Devices page toolbar had become a junk drawer. Measured 2026-09-01:
   * five buttons plus six filter chips needed **1123px on one line**, so on any laptop the page
   * header wrapped to two rows — and four of those buttons were configuration rather than
   * anything to do with the device list underneath them.
   */
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

/**
 * Every navigable page. `App.tsx` validates the route hash and builds the browser-tab title
 * from THIS list, not from `NAV_ITEMS` — deriving routes from the tab bar alone (as it did
 * before Reports moved out of it) sends `#reports` silently back to Overview, and leaves the
 * browser tab reading "Overview · iBEMS" while the Reports page is on screen.
 */
export const ROUTE_ITEMS: NavItem[] = [...NAV_ITEMS, ...ACCOUNT_ITEMS];
