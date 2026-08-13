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
  /** The hash as a route id, or null if it doesn't name a page. */
  const read = () => {
    const id = window.location.hash.slice(1);
    return validIds.includes(id) ? id : null;
  };

  const [route, setRoute] = useState(() => read() ?? fallback);

  useEffect(() => {
    /*
     * A hash that isn't a route id leaves the current page alone — it does NOT fall back to
     * `fallback`. The hash is also the app's in-page anchor mechanism: `AppShell`'s skip
     * link is `<a href="#main-content">`, so treating "not a route" as "go home" meant
     * pressing the skip link on Devices silently threw you back to Overview — the one
     * control whose entire job is to help a keyboard user get *into* the current page's
     * content. Same trap for any future in-page anchor.
     *
     * `fallback` still applies on first read, where there's no current page to keep.
     */
    const onHashChange = () => {
      const next = read();
      if (next !== null) setRoute(next);
    };
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
