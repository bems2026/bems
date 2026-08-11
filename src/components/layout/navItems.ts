export interface NavItem {
  id: string;
  label: string;
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
