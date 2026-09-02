import { describe, it, expect } from 'vitest';
import { shapeToPath, shapeToCells, parseShape, SHAPE_PRESETS, DEFAULT_SHAPE, cellIndex, type RoomShape, parseAspect } from './roomShape';

/**
 * The room outline, as geometry rather than as a picture.
 *
 * Everything here is asserted in the unit square with plain numbers, because jsdom reports every
 * SVG element as 0x0 — a test that measured the rendered path would assert nothing at all. Same
 * reasoning that made `popoverPlacement` a pure module.
 */

/** The numbers in a path, in order. Enough to check a shape's corners without pinning the exact
 * command letters, which are a rendering detail this file should be free to change. */
const nums = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);

describe('shapeToPath', () => {
  it('produces a closed path for every preset, so no shape can render as an open squiggle', () => {
    for (const preset of SHAPE_PRESETS) {
      const d = shapeToPath(preset.make());
      expect(d.length, `${preset.kind} produced nothing`).toBeGreaterThan(0);
      expect(d.trimEnd().toUpperCase().endsWith('Z'), `${preset.kind} is not closed`).toBe(true);
    }
  });

  it('keeps every preset inside the unit square', () => {
    // The frame is 0..1 and devices are placed against it. A shape spilling outside would draw a
    // wall where no device could ever be placed, which reads as a rendering bug rather than a
    // room.
    for (const preset of SHAPE_PRESETS) {
      for (const n of nums(shapeToPath(preset.make()))) {
        expect(n, `${preset.kind} escapes the frame`).toBeGreaterThanOrEqual(0);
        expect(n, `${preset.kind} escapes the frame`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a rectangle is the full frame', () => {
    expect(nums(shapeToPath({ kind: 'rect' }))).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it('an L-shape removes exactly the notched corner', () => {
    // Six corners, not four: the notch is a real cut, not a rounded hint.
    const d = shapeToPath({ kind: 'l', notch: 'tr', nw: 0.4, nh: 0.3 });
    expect(nums(d)).toHaveLength(12);
    // The top-right corner (1,0) must be gone — that is what "notched at tr" means.
    const pairs = nums(d).reduce<number[][]>((acc, n, i) => (i % 2 ? acc : [...acc, [n, nums(d)[i + 1]]]), []);
    expect(pairs).not.toContainEqual([1, 0]);
  });

  it('a triangle has three corners, whichever way it points', () => {
    for (const apex of ['top', 'bottom', 'left', 'right'] as const) {
      expect(nums(shapeToPath({ kind: 'triangle', apex })), apex).toHaveLength(6);
    }
  });

  it('a circle uses arcs rather than a polygon, so it stays smooth at any render size', () => {
    // Approximating with points would look faceted on the office screen and would also make the
    // stored shape depend on how many points somebody chose.
    expect(shapeToPath({ kind: 'circle' })).toMatch(/A/);
  });

  it('draws only the cells that are on', () => {
    const d = shapeToPath({ kind: 'cells', cols: 2, rows: 2, on: [0] });
    expect(d.length).toBeGreaterThan(0);
    // One cell of a 2x2 grid is the top-left quarter, and nothing may extend past its edges.
    for (const n of nums(d)) expect(n).toBeLessThanOrEqual(0.5);
  });

  it('an empty cells shape renders nothing rather than the whole frame', () => {
    // "No cells selected" is a room being drawn, not a full room. Falling back to the frame would
    // silently undo the operator's first click.
    expect(shapeToPath({ kind: 'cells', cols: 3, rows: 3, on: [] })).toBe('');
  });
});

describe('shapeToCells', () => {
  it('rasterises a rectangle into every cell', () => {
    const cells = shapeToCells({ kind: 'rect' }, 4, 3) as Extract<RoomShape, { kind: 'cells' }>;
    expect(cells.kind).toBe('cells');
    expect(cells.on).toHaveLength(12);
  });

  it('rasterises an L-shape into fewer cells than the full grid, in the right corner', () => {
    const cells = shapeToCells({ kind: 'l', notch: 'tr', nw: 0.5, nh: 0.5 }, 4, 4) as Extract<RoomShape, { kind: 'cells' }>;
    expect(cells.on.length).toBeLessThan(16);
    expect(cells.on.length).toBeGreaterThan(0);
    // Top-right cell is inside the notch and must be off; bottom-left is solid and must be on.
    expect(cells.on).not.toContain(cellIndex(3, 0, 4));
    expect(cells.on).toContain(cellIndex(0, 3, 4));
  });

  it('is idempotent — rasterising a cells shape at the same grid changes nothing', () => {
    const once = shapeToCells({ kind: 'l', notch: 'bl', nw: 0.3, nh: 0.3 }, 5, 5);
    expect(shapeToCells(once, 5, 5)).toEqual(once);
  });

  it('rounds a circle to the cells whose centres are inside it', () => {
    const cells = shapeToCells({ kind: 'circle' }, 5, 5) as Extract<RoomShape, { kind: 'cells' }>;
    expect(cells.on).toContain(cellIndex(2, 2, 5)); // the middle is unambiguously in
    expect(cells.on).not.toContain(cellIndex(0, 0, 5)); // a corner is unambiguously out
  });

  it('refuses a grid that is not a grid, rather than producing a shape nobody can edit', () => {
    for (const [cols, rows] of [[0, 4], [4, 0], [-1, 3], [3, 1.5]]) {
      expect(() => shapeToCells({ kind: 'rect' }, cols, rows)).toThrow();
    }
  });
});

describe('parseShape', () => {
  it('falls back to the full frame for anything unreadable', () => {
    // A malformed attrs.plan from a hand-edit must render a square, never throw. A render that
    // throws takes the page down, which is far worse than a wrong-looking room.
    for (const junk of [undefined, null, 'rect', 42, [], {}, { kind: 'hexagon' }, { kind: 'l' }]) {
      expect(parseShape(junk)).toEqual(DEFAULT_SHAPE);
    }
  });

  it('round-trips every preset', () => {
    for (const preset of SHAPE_PRESETS) {
      const shape = preset.make();
      expect(parseShape(JSON.parse(JSON.stringify(shape)))).toEqual(shape);
    }
  });

  it('rejects an L-shape whose notch would consume the whole room', () => {
    // nw or nh at 1 leaves no room at all. Refusing beats rendering an empty outline that looks
    // like a failure to load.
    expect(parseShape({ kind: 'l', notch: 'tr', nw: 1, nh: 0.5 })).toEqual(DEFAULT_SHAPE);
    expect(parseShape({ kind: 'l', notch: 'tr', nw: 0.5, nh: 0 })).toEqual(DEFAULT_SHAPE);
  });

  it('drops cell indices outside the grid rather than rejecting the whole shape', () => {
    // A grid resized smaller leaves stale indices. Losing those cells is recoverable by clicking;
    // losing the whole room is not.
    const parsed = parseShape({ kind: 'cells', cols: 2, rows: 2, on: [0, 3, 99, -1] });
    expect(parsed).toEqual({ kind: 'cells', cols: 2, rows: 2, on: [0, 3] });
  });

  it('de-duplicates cell indices, so a double click cannot double-store one', () => {
    expect(parseShape({ kind: 'cells', cols: 2, rows: 2, on: [1, 1, 2] })).toEqual({ kind: 'cells', cols: 2, rows: 2, on: [1, 2] });
  });
});

describe('cellIndex', () => {
  it('is row-major from the top-left', () => {
    // Stated in the spec because two implementations that disagree here produce a mirrored room
    // and neither looks obviously wrong.
    expect(cellIndex(0, 0, 4)).toBe(0);
    expect(cellIndex(3, 0, 4)).toBe(3);
    expect(cellIndex(0, 1, 4)).toBe(4);
    expect(cellIndex(2, 2, 4)).toBe(10);
  });
});

describe('parseAspect — RM-044', () => {
  it('reads the proportions a preset or an operator stored', () => {
    expect(parseAspect({ kind: 'rect', aspect: 300 / 530 })).toBeCloseTo(300 / 530, 6);
  });

  it('is null when nobody has said, which renders square', () => {
    // Square means "not measured", not "measured as square" — the default every plan had.
    expect(parseAspect({ kind: 'rect' })).toBeNull();
    expect(parseAspect(null)).toBeNull();
    expect(parseAspect('rect')).toBeNull();
  });

  it('refuses a ratio that would push the page off the screen', () => {
    // It becomes a CSS aspect-ratio. A frame forty times taller than it is wide is a corrupt
    // row, and rendering it faithfully would be worse than ignoring it.
    for (const bad of [0, -1, 0.01, 40, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseAspect({ kind: 'rect', aspect: bad })).toBeNull();
    }
  });
});
