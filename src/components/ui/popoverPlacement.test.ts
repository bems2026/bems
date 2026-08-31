import { describe, it, expect } from 'vitest';
import { placePopover, POPOVER_MARGIN, POPOVER_GAP, type AnchorRect } from './popoverPlacement';

/**
 * The one property that must hold for every input: the popover is inside the viewport.
 *
 * Everything else here is about HOW it stays inside; this asserts THAT it does, which is the
 * actual requirement. Measured before the fix, on the Overview page alone: 81px off the right
 * edge at 1265px wide, and four of five hints 26–61px off at 375px.
 */
const anchorAt = (left: number, top: number, size = 24): AnchorRect => ({
  left,
  top,
  right: left + size,
  bottom: top + size,
});

const fitsInside = (p: ReturnType<typeof placePopover>, viewport: { width: number; height: number }) => ({
  leftEdge: p.left >= POPOVER_MARGIN,
  rightEdge: p.left + p.maxWidth <= viewport.width - POPOVER_MARGIN,
  topEdge: p.top >= 0,
  // The RESOLVED height, not maxHeight: an above-placement grows upward from a bottom pinned at
  // the anchor, so `top + maxHeight` is not its bottom edge.
  bottomEdge: p.top + p.resolvedHeight <= viewport.height,
});

describe('placePopover keeps the popover on screen', () => {
  const cases = [
    { name: 'desktop, anchor near the right edge', viewport: { width: 1265, height: 720 }, anchor: anchorAt(1170, 300) },
    { name: 'desktop, anchor at the very right', viewport: { width: 1265, height: 720 }, anchor: anchorAt(1241, 300) },
    { name: 'mobile, anchor mid-row', viewport: { width: 375, height: 812 }, anchor: anchorAt(200, 400) },
    { name: 'mobile, anchor near the right edge', viewport: { width: 375, height: 812 }, anchor: anchorAt(340, 400) },
    { name: 'mobile, anchor at the left edge', viewport: { width: 375, height: 812 }, anchor: anchorAt(0, 400) },
    { name: 'anchor near the bottom', viewport: { width: 1265, height: 720 }, anchor: anchorAt(600, 690) },
    { name: 'anchor near the top', viewport: { width: 1265, height: 720 }, anchor: anchorAt(600, 4) },
    { name: 'very short viewport', viewport: { width: 1265, height: 200 }, anchor: anchorAt(600, 100) },
    { name: 'very narrow viewport', viewport: { width: 240, height: 812 }, anchor: anchorAt(180, 400) },
  ];

  for (const c of cases) {
    it(`${c.name}`, () => {
      const p = placePopover({ anchor: c.anchor, viewport: c.viewport, preferredWidth: 260, height: 140 });
      expect(fitsInside(p, c.viewport)).toEqual({ leftEdge: true, rightEdge: true, topEdge: true, bottomEdge: true });
    });
  }

  it('the exact case measured on the Overview page — 375px wide, weather hint 43px off', () => {
    const p = placePopover({ anchor: anchorAt(332, 300), viewport: { width: 375, height: 812 }, preferredWidth: 260, height: 120 });
    expect(p.left + p.maxWidth).toBeLessThanOrEqual(375 - POPOVER_MARGIN);
  });
});

describe('placePopover placement rules', () => {
  const viewport = { width: 1000, height: 800 };

  it('aligns to the anchor left when there is room, so it reads as attached to its icon', () => {
    const p = placePopover({ anchor: anchorAt(100, 100), viewport, preferredWidth: 260, height: 140 });
    expect(p.left).toBe(100);
    expect(p.side).toBe('below');
    expect(p.top).toBe(124 + POPOVER_GAP);
  });

  it('slides back into view rather than flipping to right-alignment', () => {
    // A popover that jumps alignment as the anchor crosses a threshold reads as a glitch.
    // Sliding is continuous: one pixel of anchor movement moves it one pixel, until it stops.
    const p = placePopover({ anchor: anchorAt(900, 100), viewport, preferredWidth: 260, height: 140 });
    expect(p.left).toBe(1000 - 260 - POPOVER_MARGIN);
  });

  it('narrows to fit a viewport too small for its preferred width', () => {
    const p = placePopover({ anchor: anchorAt(10, 100), viewport: { width: 240, height: 800 }, preferredWidth: 260, height: 140 });
    expect(p.maxWidth).toBe(240 - POPOVER_MARGIN * 2);
    expect(p.left).toBe(POPOVER_MARGIN);
  });

  it('flips above when there is not enough room below and more room above', () => {
    const p = placePopover({ anchor: anchorAt(100, 700), viewport, preferredWidth: 260, height: 200 });
    expect(p.side).toBe('above');
    expect(p.top).toBe(700 - POPOVER_GAP - 200);
  });

  it('stays below when it fits, even with more room above', () => {
    // Below is the default because it is where the reader's eye already is, and flipping a
    // popover that fits would be movement for its own sake.
    const p = placePopover({ anchor: anchorAt(100, 500), viewport, preferredWidth: 260, height: 100 });
    expect(p.side).toBe('below');
  });

  it('caps the height so long content scrolls inside instead of running off the edge', () => {
    const p = placePopover({ anchor: anchorAt(100, 100), viewport: { width: 1000, height: 300 }, preferredWidth: 260, height: 600 });
    expect(p.maxHeight).toBe(300 - 124 - POPOVER_GAP - POPOVER_MARGIN);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(300);
  });

  it('takes the roomier side when neither fits, rather than picking one arbitrarily', () => {
    const p = placePopover({ anchor: anchorAt(100, 260), viewport: { width: 1000, height: 300 }, preferredWidth: 260, height: 900 });
    expect(p.side).toBe('above');
    expect(p.top).toBeGreaterThanOrEqual(0);
  });

  it('never returns a negative width, however small the viewport', () => {
    const p = placePopover({ anchor: anchorAt(0, 0), viewport: { width: 10, height: 10 }, preferredWidth: 260, height: 140 });
    expect(p.maxWidth).toBeGreaterThanOrEqual(0);
    expect(p.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('prefers overflowing right over overflowing left when the viewport cannot fit both margins', () => {
    // Off the right edge is recoverable by scrolling; off the left edge is simply gone.
    const p = placePopover({ anchor: anchorAt(5, 100), viewport: { width: 20, height: 800 }, preferredWidth: 260, height: 140 });
    expect(p.left).toBe(POPOVER_MARGIN);
  });
});

/**
 * Right-aligned dropdowns — the nav's alerts bell and account menu.
 *
 * Measured 2026-09-01 at 375px: the alerts popover rendered at `left: -17px`. It was not too
 * wide for the screen (320px fits 375px); it was anchored `right: 0` inside a 44px wrapper whose
 * own right edge sits at x=303, so a fixed width put its left edge off the screen. Off the LEFT
 * edge is the worse direction, because nothing can scroll to it.
 */
describe('placePopover with end alignment', () => {
  const viewport = { width: 375, height: 812 };

  it('lines the right edges up when there is room, so a nav menu opens inward', () => {
    const p = placePopover({ anchor: anchorAt(300, 40, 44), viewport, preferredWidth: 208, height: 200, align: 'end' });
    expect(p.left + p.maxWidth).toBe(344);
  });

  it('the exact alerts case — a 320px menu anchored at x=303 no longer starts off screen', () => {
    const p = placePopover({ anchor: anchorAt(259, 40, 44), viewport, preferredWidth: 320, height: 400, align: 'end' });
    expect(p.left).toBeGreaterThanOrEqual(POPOVER_MARGIN);
    expect(p.left + p.maxWidth).toBeLessThanOrEqual(375 - POPOVER_MARGIN);
  });

  it('clamps exactly as start alignment does — neither can put anything off screen', () => {
    for (const align of ['start', 'end'] as const) {
      for (const x of [0, 50, 200, 340, 374]) {
        const p = placePopover({ anchor: anchorAt(x, 40, 44), viewport, preferredWidth: 320, height: 300, align });
        expect(p.left).toBeGreaterThanOrEqual(POPOVER_MARGIN);
        expect(p.left + p.maxWidth).toBeLessThanOrEqual(viewport.width - POPOVER_MARGIN);
      }
    }
  });

  it('still narrows to fit a viewport too small for the preferred width', () => {
    const p = placePopover({ anchor: anchorAt(200, 40, 44), viewport: { width: 300, height: 812 }, preferredWidth: 320, height: 200, align: 'end' });
    expect(p.maxWidth).toBe(300 - POPOVER_MARGIN * 2);
  });
});
