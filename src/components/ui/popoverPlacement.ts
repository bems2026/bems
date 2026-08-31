/**
 * Where a popover may actually be drawn so that all of it stays on screen.
 *
 * WHY THIS IS A FUNCTION AND NOT CSS. `.info-hint__pop` was `position: absolute; left: 0;
 * width: 260px`, anchored to a 24px button with no awareness of the viewport at all. Measured
 * 2026-09-01: on a 1265px desktop the weather hint ran **81px past the right edge**; at 375px
 * **four of the five hints on the Overview page** ran 26–61px off, at a fixed 260px width on a
 * 375px screen. Off-screen text is not a cosmetic problem — the popover exists to be read, and
 * the ⓘ appears 24 times across this app, so the failure is systematic rather than a one-off.
 *
 * Pure, and separated from the component, so every edge can be asserted directly rather than by
 * measuring rendered SVG in jsdom — which reports every rect as 0×0 and would make the tests
 * vacuous. Same reasoning as `bridgeClient`'s resilience math living apart from React.
 *
 * The caller is responsible for rendering into a PORTAL. `position: fixed` is not enough on its
 * own here: `.card` carries `backdrop-filter`, which makes it a containing block for
 * fixed-position descendants, so a popover inside a card would be positioned against the card
 * rather than the viewport. Nearly every ⓘ in this app is inside a card.
 */

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** Cap, not a fixed width — the popover may be narrower if its content is. */
  maxWidth: number;
  /** Cap for the chosen side, so long content scrolls inside the popover rather than off screen. */
  maxHeight: number;
  /**
   * The height the box will actually occupy — `height` capped by `maxHeight`.
   *
   * Returned rather than left for the caller to re-derive, because it is what makes the
   * on-screen property checkable: an above-placement grows upward from a bottom pinned at the
   * anchor, so `top + maxHeight` is NOT its bottom edge and asserting on that would fail a
   * placement that is in fact correct. It did, while this was being written.
   */
  resolvedHeight: number;
  side: 'below' | 'above';
}

export interface PlaceOptions {
  anchor: AnchorRect;
  viewport: Viewport;
  /** What the popover would like to be, if there is room. */
  preferredWidth: number;
  /** Measured height when known; used only to choose a side and to position an above-placement. */
  height: number;
  /** Clearance kept from every viewport edge. */
  margin?: number;
  /** Space between the anchor and the popover. */
  gap?: number;
  /**
   * Which edge to line up with the anchor before clamping.
   *
   * `start` — the popover's left edge to the anchor's left. Right for a tooltip hanging off an
   * inline ⓘ, which reads as belonging to the word it follows.
   * `end` — the popover's right edge to the anchor's right. Right for a menu dropped from a
   * button in a right-hand nav cluster, which would otherwise open away from the screen.
   *
   * Only the preference differs; the clamping afterwards is identical, so neither alignment can
   * put anything off-screen.
   */
  align?: 'start' | 'end';
}

export const POPOVER_MARGIN = 8;
export const POPOVER_GAP = 6;

/**
 * Horizontal rule: align to the anchor's left edge, then clamp both edges inside the viewport.
 * Clamping rather than flipping, because a popover that jumps to right-alignment as the anchor
 * crosses some threshold reads as a glitch; sliding it back into view does not.
 *
 * Vertical rule: below the anchor when it fits, above when it does not and above has more room.
 * If neither side fits, take the roomier one and let `maxHeight` make the content scroll — the
 * one thing never done is letting it run off the edge, which is the bug being fixed.
 */
export function placePopover({
  anchor,
  viewport,
  preferredWidth,
  height,
  margin = POPOVER_MARGIN,
  gap = POPOVER_GAP,
  align = 'start',
}: PlaceOptions): Placement {
  // A viewport narrower than twice the margin has no room for margins at all; giving it a
  // negative width would be worse than touching the edges, so the width floors at zero.
  const maxWidth = Math.max(0, Math.min(preferredWidth, viewport.width - margin * 2));

  // `Math.max(margin, …)` last so it wins when the viewport is too narrow to honour both edges:
  // overflowing right is recoverable by scrolling, overflowing left is not.
  const rightLimit = viewport.width - maxWidth - margin;
  const desiredLeft = align === 'end' ? anchor.right - maxWidth : anchor.left;
  const left = Math.max(margin, Math.min(desiredLeft, rightLimit));

  const spaceBelow = viewport.height - anchor.bottom - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  const side: 'below' | 'above' = height <= spaceBelow || spaceBelow >= spaceAbove ? 'below' : 'above';

  const maxHeight = Math.max(0, side === 'below' ? spaceBelow : spaceAbove);
  const resolvedHeight = Math.min(height, maxHeight);
  // Below grows down from the anchor; above grows UP from a bottom pinned just over it, which
  // is why its `top` depends on the resolved height and its bottom edge never moves.
  const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - resolvedHeight;

  return { left, top, maxWidth, maxHeight, resolvedHeight, side };
}
