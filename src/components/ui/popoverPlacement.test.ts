import { describe, it, expect } from 'vitest';
import { besideMaxWidth, placeBeside, placePopover, POPOVER_MARGIN, POPOVER_GAP, type AnchorRect, type Bounds } from './popoverPlacement';

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

/**
 * RM-141 — a chart value's tooltip, which placed itself with its own arithmetic and ran off small screens.
 * It chose its side from the value's CENTRE but anchored at the value's EDGE, with no clamp: a share-bar
 * segment spanning most of the bar put it about 111 px off the left of a 360 px phone and 35–105 px past
 * the right of the 800×480 kiosk. `placeBeside` keeps ChartFigure's own rule — beside the value, never over
 * it — and the one property this file asserts for every popover: the whole box stays inside.
 */
describe('placeBeside keeps a chart value’s tooltip beside the value and on screen — RM-141', () => {
  const M = POPOVER_MARGIN;
  const within = (p: ReturnType<typeof placeBeside>, b: Bounds, w: number, h: number) => ({
    left: p.left >= b.left + M,
    right: p.left + Math.min(w, p.maxWidth) <= b.right - M,
    top: p.top >= b.top + M,
    bottom: p.top + Math.min(h, p.maxHeight) <= b.bottom - M,
  });
  const ALL_IN = { left: true, right: true, top: true, bottom: true };
  const rect = (left: number, top: number, width: number, height: number): AnchorRect => ({ left, top, right: left + width, bottom: top + height });

  // A figure's visible span on each screen the brief names: 28 px of page padding each side.
  const PHONE: Bounds = { left: 28, top: 0, right: 332, bottom: 640 };
  const TABLET: Bounds = { left: 28, top: 0, right: 740, bottom: 1024 };
  const KIOSK: Bounds = { left: 28, top: 0, right: 772, bottom: 480 };

  it('sits after a narrow value, a gap away, when there is room', () => {
    const p = placeBeside({ anchor: rect(200, 100, 20, 150), bounds: TABLET, width: 180, height: 60 });
    expect(p.side).toBe('after');
    expect(p.left).toBe(220 + POPOVER_GAP);
    expect(within(p, TABLET, 180, 60)).toEqual(ALL_IN);
  });

  it('sits before a value near the right edge, its right edge a gap from the value', () => {
    const p = placeBeside({ anchor: rect(680, 100, 20, 150), bounds: TABLET, width: 180, height: 60 });
    expect(p.side).toBe('before');
    expect(p.left + 180).toBe(680 - POPOVER_GAP);
    expect(within(p, TABLET, 180, 60)).toEqual(ALL_IN);
  });

  it('stays beside the reading point of a value too wide to sit beside — the share bar on the kiosk', () => {
    // A segment covering 5–86% of the bar, read at x = 400: no room either side of the segment itself.
    const anchor = rect(80, 200, 575, 22);
    const p = placeBeside({ anchor, bounds: KIOSK, width: 180, height: 70, point: 400 });
    expect(within(p, KIOSK, 180, 70)).toEqual(ALL_IN);
    expect(p.side === 'after' ? p.left - 400 : 400 - (p.left + 180)).toBe(POPOVER_GAP);
  });

  it('never lands off the left of a 360 px phone — the case computed at 111 px off', () => {
    // The plot keeps its 460 px drawing and scrolls: the segment runs off the right of the figure.
    const p = placeBeside({ anchor: rect(40, 300, 360, 22), bounds: PHONE, width: 180, height: 60, point: 226 });
    expect(within(p, PHONE, 180, 60)).toEqual(ALL_IN);
  });

  it('caps a tall tooltip to the height there is, and keeps its top on screen — 800×480', () => {
    const p = placeBeside({ anchor: rect(300, 40, 20, 400), bounds: KIOSK, width: 200, height: 900 });
    expect(p.maxHeight).toBe(480 - 2 * M);
    expect(within(p, KIOSK, 200, 900)).toEqual(ALL_IN);
  });

  it('narrows to the room there is, never below it', () => {
    expect(besideMaxWidth(PHONE)).toBe(Math.min(240, 332 - 28 - 2 * M));
    expect(besideMaxWidth({ left: 0, top: 0, right: 0, bottom: 0 })).toBe(0);
  });

  it('keeps the whole box inside at every size, wherever the value is', () => {
    for (const bounds of [PHONE, TABLET, KIOSK]) {
      const w = Math.min(220, besideMaxWidth(bounds));
      for (let x = bounds.left - 60; x <= bounds.right + 60; x += 23) {
        for (let y = bounds.top; y <= bounds.bottom; y += 37) {
          for (const width of [4, 60, 400]) {
            const p = placeBeside({ anchor: rect(x, y, width, 30), bounds, width: w, height: 90, point: x + width / 2 });
            expect(within(p, bounds, w, 90), `${JSON.stringify(bounds)} at ${x},${y} width ${width}`).toEqual(ALL_IN);
          }
        }
      }
    }
  });
});
