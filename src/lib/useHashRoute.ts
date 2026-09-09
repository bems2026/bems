import { useCallback, useEffect, useState } from 'react';

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
 *
 * SINCE RM-059 the hash may carry a second segment: `#automation/time` names a page AND a tab
 * inside it. This hook still returns the page; `useHashSubRoute` below owns the rest. Splitting
 * on `/` here rather than matching the whole hash is what makes a tab deep-linkable and
 * survive a reload, and it does not weaken the skip-link rule documented below — `#main-content`
 * still has no matching first segment.
 */

/** The page id from a hash, ignoring any `/sub` segment. */
const routeSegment = () => window.location.hash.slice(1).split('/')[0];

export function useHashRoute(validIds: readonly string[], fallback: string): string {
  /** The hash as a route id, or null if it doesn't name a page. */
  const read = () => {
    const id = routeSegment();
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

/**
 * The tab within a page, from the hash's second segment.
 *
 * Returns `[sub, setSub]`. `setSub` writes the URL with `history.replaceState` rather than by
 * assigning `location.hash`, for one reason worth stating: assigning the hash pushes a history
 * entry, and with a tablist that switches on arrow keys, walking four tabs would bury the page
 * the reader arrived from under four back presses. A tab is a view of one page, not a
 * destination, so replacing is the honest history semantic.
 *
 * The consequence is that `replaceState` fires no `hashchange`, so this hook's own state is the
 * source of truth while the page is mounted; the listener exists for the other direction —
 * browser back/forward, or a link someone pasted.
 *
 * @param routeId    the page this tab belongs to, so the written hash stays a valid page link
 * @param validSubs  known tab ids; anything else in the URL falls back rather than blanking the page
 */
export function useHashSubRoute(routeId: string, validSubs: readonly string[], fallback: string): [string, (id: string) => void] {
  const read = () => {
    const [route, sub] = window.location.hash.slice(1).split('/');
    if (route !== routeId) return null;
    return sub && validSubs.includes(sub) ? sub : null;
  };

  const [sub, setSubState] = useState(() => read() ?? fallback);

  const setSub = useCallback(
    (id: string) => {
      setSubState(id);
      window.history.replaceState(null, '', `#${routeId}/${id}`);
    },
    [routeId],
  );

  useEffect(() => {
    const onHashChange = () => {
      const next = read();
      if (next !== null) setSubState(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeId/validSubs/fallback are static config, not reactive inputs
  }, []);

  return [sub, setSub];
}

/** Navigates to a page by setting the hash — the single write path every nav control (top
 * tabs, in-card "View details ↗"/"Details ↗" links) should use, so a click and a
 * typed/bookmarked URL both go through the same `hashchange` listener above. An optional
 * `sub` deep-links straight to a tab within that page. */
export function navigateTo(id: string, sub?: string): void {
  window.location.hash = sub ? `${id}/${sub}` : id;
}
