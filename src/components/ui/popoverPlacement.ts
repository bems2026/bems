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

/** A region a box may be drawn in, in viewport px — for `placeBeside`, the part of a figure on screen. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A chart value's tooltip is at most this wide, and narrower where the figure is. */
export const BESIDE_WIDTH = 240;

/** The widest a beside-tooltip may be inside `bounds`: its preferred width, less the margins. */
export function besideMaxWidth(bounds: Bounds, preferred = BESIDE_WIDTH, margin = POPOVER_MARGIN): number {
  return Math.max(0, Math.min(preferred, bounds.right - bounds.left - margin * 2));
}

export interface BesideOptions {
  /** The value being read, in viewport px. */
  anchor: AnchorRect;
  bounds: Bounds;
  /** The tooltip's measured size. */
  width: number;
  height: number;
  /** Where along the value it is being read — used when the value is too wide to sit beside. */
  point?: number;
  preferredWidth?: number;
  margin?: number;
  gap?: number;
}

export interface BesidePlacement {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  side: 'before' | 'after';
}

/**
 * BESIDE THE VALUE, NEVER OVER IT — RM-141. `placePopover` puts a box below or above its anchor, which is
 * right for a hint hanging off a button and wrong for a chart's tooltip: below a bar is the axis, and over
 * a line is the line. `ChartFigure` placed its tooltip beside the value with arithmetic of its own, choosing
 * a side from the value's CENTRE and anchoring at its EDGE, with no clamp — so a share-bar segment covering
 * most of the bar put it about 111 px off the left of a 360 px phone and 35–105 px past the right of the
 * 800×480 kiosk (computed from the stylesheet, 2026-09-22). This keeps that rule and this file's one
 * property: the whole box inside `bounds`.
 *
 * Horizontal: after the value if there is room, else before it, else whichever side has more. A value wider
 * than the room on both sides — a long segment — is sat beside at `point`, where it is being read. Clamped
 * like `placePopover`, the left edge winning when there is room for neither.
 *
 * Vertical: level with the value, from its top in the upper half of the bounds and up from its bottom in the
 * lower half, clamped; a box taller than the bounds is capped and scrolls inside itself.
 */
export function placeBeside({
  anchor,
  bounds,
  width,
  height,
  point,
  preferredWidth = BESIDE_WIDTH,
  margin = POPOVER_MARGIN,
  gap = POPOVER_GAP,
}: BesideOptions): BesidePlacement {
  const maxWidth = besideMaxWidth(bounds, preferredWidth, margin);
  const w = Math.min(width, maxWidth);
  const minLeft = bounds.left + margin;
  const maxRight = bounds.right - margin;

  const roomAround = (from: { left: number; right: number }) => ({ after: maxRight - (from.right + gap), before: from.left - gap - minLeft });
  let from = { left: anchor.left, right: anchor.right };
  let room = roomAround(from);
  if (room.after < w && room.before < w && point !== undefined) {
    from = { left: point, right: point };
    room = roomAround(from);
  }
  const side: 'before' | 'after' = room.after >= w || room.after >= room.before ? 'after' : 'before';
  const desiredLeft = side === 'after' ? from.right + gap : from.left - gap - w;
  const left = Math.max(minLeft, Math.min(desiredLeft, maxRight - w));

  const maxHeight = Math.max(0, bounds.bottom - bounds.top - margin * 2);
  const h = Math.min(height, maxHeight);
  const upperHalf = (anchor.top + anchor.bottom) / 2 <= (bounds.top + bounds.bottom) / 2;
  const desiredTop = upperHalf ? anchor.top : anchor.bottom - h;
  const top = Math.max(bounds.top + margin, Math.min(desiredTop, bounds.bottom - margin - h));

  return { left, top, maxWidth, maxHeight, side };
}
