import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placePopover, type Placement } from './popoverPlacement';

/**
 * Keeps an open popover anchored to its trigger AND inside the viewport.
 *
 * WHY IT IS A HOOK RATHER THAN THREE COPIES. Three controls in this app open a panel from a
 * button — the ⓘ hint, the alerts bell, and the account menu — and all three had independently
 * written the same `mousedown`-outside + `Escape` dismissal, with the same CSS-only positioning,
 * and all three were measurably off screen on a narrow viewport (2026-09-01: the ⓘ 26–61px past
 * the right edge at 375px, the alerts popover at `left: -17px`). Three copies of a rule meant
 * three chances to get it wrong, and it was wrong in all three.
 *
 * WHY A PORTAL IS NOT OPTIONAL HERE. `position: fixed` is measured against the nearest ancestor
 * with a `transform`, `filter` or `backdrop-filter` rather than the viewport — and this app's
 * glass surfaces mean that ancestor almost always exists: `.card` blurs its backdrop, and so
 * does `.top-nav`. So a fixed popover inside either is positioned against the card or the nav,
 * which is the bug rather than the fix. Portaling to `<body>` is what makes the viewport the
 * frame of reference, and it also escapes the cards' `overflow` clipping.
 *
 * The caller renders `<div ref={popRef} style={style}>` through `createPortal(…, document.body)`.
 */
export function useAnchoredPopover({
  open,
  onDismiss,
  preferredWidth,
  align = 'start',
  fallbackHeight = 160,
  preferredMaxHeight,
}: {
  open: boolean;
  onDismiss: () => void;
  preferredWidth: number;
  align?: 'start' | 'end';
  /** Used for the first pass only, before the popover has been measured. */
  fallbackHeight?: number;
  /**
   * A design cap on height, applied on top of whatever the viewport allows.
   *
   * Needed because the returned `style` sets `maxHeight` inline, which beats a stylesheet rule —
   * so a panel that had `max-height: 420px` in CSS would silently grow on a tall screen once it
   * was portaled. The viewport limit still wins when it is the smaller of the two.
   */
  preferredMaxHeight?: number;
}) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLElement | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    setPlacement(
      placePopover({
        anchor: anchor.getBoundingClientRect(),
        // `clientWidth`/`clientHeight` of the root, not `innerWidth`/`innerHeight`: those
        // include the scrollbar, which would let the popover sit underneath it.
        viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
        preferredWidth,
        // Its real height once it exists; a conservative estimate on the very first pass, which
        // only affects which side is chosen. Guessing small would bias every popover downward
        // on a short viewport.
        height: popRef.current?.offsetHeight ?? fallbackHeight,
        align,
      }),
    );
  }, [preferredWidth, align, fallbackHeight]);

  // Before paint, so it never renders at a stale position for a frame — which would show as a
  // visible jump on exactly the narrow screens this exists to fix.
  //
  // The last placement is deliberately KEPT on close rather than cleared. Clearing it was a
  // `setState` in an effect body, which `react-hooks/set-state-in-effect` rightly flags — and it
  // was also worse behaviour: every reopen would then flash through the `visibility: hidden`
  // branch below. Keeping it means a reopen renders at the previous position and this effect
  // corrects it before the browser paints, so a stale value is never visible. Only the very
  // first open has no placement to reuse, which is exactly what the hidden branch is for.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      // Both nodes. The popover is portaled to <body>, so the trigger's own subtree no longer
      // contains it and a click inside it would otherwise be read as "outside" and dismiss it.
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || popRef.current?.contains(target)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onDismiss();
      // Focus goes back to the trigger, not to the top of the document — the popover is
      // dismissed from the keyboard and the caret should not be lost.
      anchorRef.current?.focus();
    };
    // Capture phase for scroll: a scroll inside any card must reposition too, and scroll does
    // not bubble. Without it the panel stays put while its button moves away underneath.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onDismiss, reposition]);

  return {
    anchorRef,
    popRef,
    placement,
    /**
     * Inline style for the portaled panel. Hidden until the anchor has been measured: a popover
     * that appears in the wrong place and then corrects itself is worse than one that appears a
     * frame later in the right place.
     */
    style: placement
      ? {
          left: placement.left,
          top: placement.top,
          maxWidth: placement.maxWidth,
          maxHeight: Math.min(placement.maxHeight, preferredMaxHeight ?? Infinity),
        }
      : ({ visibility: 'hidden' } as const),
  };
}
