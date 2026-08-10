export interface NavItem {
  id: string;
  label: string;
  icon: string;
}

/**
 * Nav config lives in its own module rather than beside `NavSidebar` so that file exports
 * only components — react-refresh can't hot-reload a module that mixes the two.
 *
 * Each `id` must match a `<section id="...">` in `App.tsx`: `AppShell`'s scroll-spy
 * observes exactly these ids, so a nav entry with no matching section silently never
 * highlights.
 *
 * Floor Plan is deliberately absent — it became the 2D/3D toggle on the Overview hero, so
 * the spatial view sits with the data it annotates.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: '◲' },
  { id: 'devices', label: 'Devices', icon: '⊞' },
  { id: 'trends', label: 'Trends', icon: '◵' },
];
