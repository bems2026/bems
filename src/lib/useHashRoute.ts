import { useEffect, useState } from 'react';

/**
 * Real page routing off the URL hash, replacing Phase L's scroll-spy
 * (`pickActiveSection` — deleted). Phase L's four sections all rendered at once in one
 * continuous page; Phase M's five pages route one-at-a-time (v4's tab model), so "which
 * section is scrolled into view" isn't a question this app asks anymore — the hash *is*
 * the current page, full stop.
 *
 * Deep links keep working (`#control` lands directly on Control), and every existing
 * in-page `<a href="#analytics">`-style nav button needs no change — clicking one changes
 * `location.hash`, which is exactly what this hook listens for.
 */
export function useHashRoute(validIds: readonly string[], fallback: string): string {
  const read = () => {
    const id = window.location.hash.slice(1);
    return validIds.includes(id) ? id : fallback;
  };

  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onHashChange = () => setRoute(read());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validIds/fallback are static config, not reactive inputs
  }, []);

  return route;
}

/** Navigates to a page by setting the hash — the single write path every nav control (top
 * tabs, in-card "View details ↗"/"Details ↗" links) should use, so a click and a
 * typed/bookmarked URL both go through the same `hashchange` listener above. */
export function navigateTo(id: string): void {
  window.location.hash = id;
}
