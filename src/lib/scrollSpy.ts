export interface SectionRect {
  id: string;
  /** `getBoundingClientRect().top` — viewport-relative. */
  top: number;
  bottom: number;
}

/**
 * Picks which section the reader is currently "in", given viewport-relative rects.
 *
 * Deliberately a pure function rather than an `IntersectionObserver` callback. IO is the
 * conventional choice, but it delivers observations on the rendering lifecycle, so it goes
 * silent in any environment that isn't compositing frames — verified in this project's
 * headless browser pane, where neither IO nor ResizeObserver ever fires even when observing
 * `document.body` with no margin. A scroll-driven pure function behaves identically, works
 * everywhere, and can be tested without a DOM at all.
 *
 * Rule: the last section whose top has passed the focus line (15% down the viewport) wins;
 * before any has, the first section wins. That makes the active item flip when a heading
 * reaches reading position, not when it first peeks into view.
 */
export function pickActiveSection(rects: SectionRect[], viewportHeight: number): string | null {
  if (!rects.length) return null;

  const focusLine = viewportHeight * 0.15;
  let active = rects[0].id;

  for (const r of rects) {
    if (r.top <= focusLine) active = r.id;
  }

  // At the very bottom of the page a short trailing section may never cross the focus
  // line; if the last section is substantially visible, prefer it.
  const last = rects[rects.length - 1];
  if (last.bottom <= viewportHeight && last.top < viewportHeight) active = last.id;

  return active;
}
