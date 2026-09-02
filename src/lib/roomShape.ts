/**
 * The outline of a room — RM-036.
 *
 * WHAT THIS REPLACES. `SpacePlanView` drew a fixed square and said so in its own header: "the
 * frame is square because nothing here has measured a room". That was honest and it is also
 * useless for placing devices — an operator looking at a square cannot tell which corner of
 * their L-shaped office they are pointing at, so nobody placed anything.
 *
 * A DESCRIPTOR, NOT A PATH. The alternative is to store the rendered `d` string, and it is worse
 * in a way that only shows up later: a path cannot be re-parameterised, so reopening the editor
 * on an existing room could offer nothing but "start again". A descriptor round-trips — the
 * editor reads back the same L-shape and moves its notch.
 *
 * STILL NOT A SURVEY. Everything is in the unit square, exactly like `planLayout.ts`'s
 * coordinates, and for the same reason: nothing here has measured a room, and proportions taken
 * from a sketch would assert a fact nobody established. What the shape claims is only what an
 * operator knows by looking — this room has a bite out of that corner.
 *
 * ONE RENDERER. `shapeToPath` handles every kind, so there is a single code path to test and no
 * per-shape branch scattered through the view. Adding a shape is a case here and a preset below.
 *
 * Pure and DOM-free: jsdom reports every SVG element as 0x0, so geometry asserted through the
 * DOM would assert nothing. Same reasoning as `popoverPlacement.ts`.
 */

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type Apex = 'top' | 'bottom' | 'left' | 'right';

export type RoomShape =
  | { kind: 'rect' }
  | { kind: 'l'; notch: Corner; nw: number; nh: number }
  | { kind: 'triangle'; apex: Apex }
  | { kind: 'circle' }
  | { kind: 'cells'; cols: number; rows: number; on: number[] };

export type ShapeKind = RoomShape['kind'];

/** What an unreadable or absent shape renders as. The full frame: the least surprising room, and
 * the one every existing plan already had. */
export const DEFAULT_SHAPE: RoomShape = Object.freeze({ kind: 'rect' });

/** Grid bounds. Below 2 there is nothing to shape; above 24 the cells are smaller than a
 * fingertip on the office screen, which makes the editor unusable rather than more precise. */
export const MIN_GRID = 2;
export const MAX_GRID = 24;

/**
 * Cell index from column and row — **row-major, origin top-left**.
 *
 * Exported and tested rather than inlined because two implementations that disagree about this
 * produce a mirrored room, and neither looks obviously wrong.
 */
export function cellIndex(col: number, row: number, cols: number): number {
  return row * cols + col;
}

const pt = (x: number, y: number) => `${round(x)},${round(y)}`;
/** 4dp, matching `planLayout.PLAN_PRECISION`: far finer than anyone can point, far coarser than
 * float noise — which is the actual job. Without it a path carries `0.30000000000000004`. */
const round = (n: number) => Math.round(n * 10000) / 10000;

function polygon(points: [number, number][]): string {
  return `M${points.map(([x, y]) => pt(x, y)).join('L')}Z`;
}

/** The notch rectangle for an L, as [x0, y0, x1, y1] in the unit square. */
function notchRect(notch: Corner, nw: number, nh: number): [number, number, number, number] {
  const left = notch === 'tl' || notch === 'bl';
  const top = notch === 'tl' || notch === 'tr';
  return [left ? 0 : 1 - nw, top ? 0 : 1 - nh, left ? nw : 1, top ? nh : 1];
}

/**
 * The SVG path for a shape, in the unit square.
 *
 * Returns `''` for a `cells` shape with nothing selected. Deliberately not the full frame: "no
 * cells yet" is a room being drawn, and falling back to a square would silently undo the
 * operator's first click and look like the editor ignoring them.
 */
export function shapeToPath(shape: RoomShape): string {
  switch (shape.kind) {
    case 'rect':
      return polygon([[0, 0], [1, 0], [1, 1], [0, 1]]);

    case 'l': {
      // Six corners traced clockwise from the top-left, with the notched corner replaced by the
      // two edges that cut into it.
      const [nx0, ny0, nx1, ny1] = notchRect(shape.notch, shape.nw, shape.nh);
      switch (shape.notch) {
        case 'tr':
          return polygon([[0, 0], [nx0, 0], [nx0, ny1], [1, ny1], [1, 1], [0, 1]]);
        case 'tl':
          return polygon([[nx1, 0], [1, 0], [1, 1], [0, 1], [0, ny1], [nx1, ny1]]);
        case 'br':
          return polygon([[0, 0], [1, 0], [1, ny0], [nx0, ny0], [nx0, 1], [0, 1]]);
        case 'bl':
          return polygon([[0, 0], [1, 0], [1, 1], [nx1, 1], [nx1, ny0], [0, ny0]]);
      }
      break;
    }

    case 'triangle':
      switch (shape.apex) {
        case 'top':
          return polygon([[0.5, 0], [1, 1], [0, 1]]);
        case 'bottom':
          return polygon([[0, 0], [1, 0], [0.5, 1]]);
        case 'left':
          return polygon([[0, 0.5], [1, 0], [1, 1]]);
        case 'right':
          return polygon([[0, 0], [1, 0.5], [0, 1]]);
      }
      break;

    case 'circle':
      // Two arcs rather than a many-point polygon. A polygon would look faceted on the office
      // screen and would make the stored shape depend on how many points somebody picked.
      return 'M0,0.5A0.5,0.5 0 1 1 1,0.5A0.5,0.5 0 1 1 0,0.5Z';

    case 'cells': {
      const { cols, rows, on } = shape;
      const w = 1 / cols;
      const h = 1 / rows;
      // One sub-path per cell. Adjacent cells share an edge and SVG merges them visually, so a
      // contiguous selection reads as one room without any polygon union to get wrong.
      return on
        .filter((i) => i >= 0 && i < cols * rows)
        .map((i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          return polygon([
            [col * w, row * h],
            [(col + 1) * w, row * h],
            [(col + 1) * w, (row + 1) * h],
            [col * w, (row + 1) * h],
          ]);
        })
        .join('');
    }
  }
  return shapeToPath(DEFAULT_SHAPE);
}

/** Whether a point in the unit square is inside the shape. Used to rasterise, and by the
 * placement editor to warn — never to block — when a device sits outside the drawn wall. */
export function containsPoint(shape: RoomShape, x: number, y: number): boolean {
  switch (shape.kind) {
    case 'rect':
      return x >= 0 && x <= 1 && y >= 0 && y <= 1;
    case 'l': {
      const [nx0, ny0, nx1, ny1] = notchRect(shape.notch, shape.nw, shape.nh);
      const inNotch = x > nx0 && x < nx1 && y > ny0 && y < ny1;
      return !inNotch;
    }
    case 'triangle': {
      // Each apex gives a single half-plane test against the two sloping edges.
      switch (shape.apex) {
        case 'top':
          return y >= Math.abs(x - 0.5) * 2;
        case 'bottom':
          return y <= 1 - Math.abs(x - 0.5) * 2;
        case 'left':
          return x >= Math.abs(y - 0.5) * 2;
        case 'right':
          return x <= 1 - Math.abs(y - 0.5) * 2;
      }
      return true;
    }
    case 'circle':
      return (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.25;
    case 'cells': {
      const col = Math.min(shape.cols - 1, Math.floor(x * shape.cols));
      const row = Math.min(shape.rows - 1, Math.floor(y * shape.rows));
      return shape.on.includes(cellIndex(col, row, shape.cols));
    }
  }
}

/**
 * Any shape as a `cells` bitmap — "eject to grid", the button that makes a preset nudgeable.
 *
 * ONE-WAY BY DESIGN. A rasterised L cannot become a parametric L again, and the editor says so
 * rather than offering a round-trip it cannot honour. Cells are kept when their CENTRE is inside
 * the shape, which is the rule an operator can predict by looking.
 *
 * Throws on a grid that is not a grid. A zero or fractional dimension would produce a shape
 * nobody can edit and an `on` list nothing can index — better to refuse at the boundary than to
 * store it.
 */
export function shapeToCells(shape: RoomShape, cols: number, rows: number): RoomShape {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < MIN_GRID || rows < MIN_GRID) {
    throw new Error(`a grid must be whole numbers of at least ${MIN_GRID}, got ${cols}x${rows}`);
  }
  const on: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (containsPoint(shape, (col + 0.5) / cols, (row + 0.5) / rows)) on.push(cellIndex(col, row, cols));
    }
  }
  return { kind: 'cells', cols, rows, on };
}

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
const APEXES: Apex[] = ['top', 'bottom', 'left', 'right'];
const isFraction = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1;

/**
 * The stored value as a shape, tolerating anything.
 *
 * Falls back to the full frame rather than throwing. `attrs.plan` is operator-editable jsonb, so
 * every way it can be wrong is a way somebody's plan page can be wrong — and a render that
 * throws takes the page down, which is far worse than a room that looks rectangular.
 *
 * Stale cell indices are DROPPED while the rest of the shape survives: a grid resized smaller
 * leaves indices pointing nowhere, and losing those cells is recoverable with a click while
 * losing the whole room is not.
 */
export function parseShape(raw: unknown): RoomShape {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_SHAPE;
  const v = raw as Record<string, unknown>;
  switch (v.kind) {
    case 'rect':
      return { kind: 'rect' };
    case 'l':
      if (!CORNERS.includes(v.notch as Corner) || !isFraction(v.nw) || !isFraction(v.nh)) return DEFAULT_SHAPE;
      return { kind: 'l', notch: v.notch as Corner, nw: v.nw, nh: v.nh };
    case 'triangle':
      if (!APEXES.includes(v.apex as Apex)) return DEFAULT_SHAPE;
      return { kind: 'triangle', apex: v.apex as Apex };
    case 'circle':
      return { kind: 'circle' };
    case 'cells': {
      const { cols, rows, on } = v;
      if (!Number.isInteger(cols) || !Number.isInteger(rows)) return DEFAULT_SHAPE;
      const c = cols as number;
      const r = rows as number;
      if (c < MIN_GRID || r < MIN_GRID || c > MAX_GRID || r > MAX_GRID) return DEFAULT_SHAPE;
      if (!Array.isArray(on)) return DEFAULT_SHAPE;
      const valid = [...new Set(on.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < c * r))];
      return { kind: 'cells', cols: c, rows: r, on: valid.sort((a, b) => a - b) };
    }
    default:
      return DEFAULT_SHAPE;
  }
}

/** The shapes offered in the editor, and the only place a new one needs adding besides
 * `shapeToPath` and `containsPoint`. */
export const SHAPE_PRESETS: { kind: ShapeKind; label: string; make: () => RoomShape }[] = [
  { kind: 'rect', label: 'Rectangle', make: () => ({ kind: 'rect' }) },
  { kind: 'l', label: 'L-shape', make: () => ({ kind: 'l', notch: 'tr', nw: 0.4, nh: 0.4 }) },
  { kind: 'triangle', label: 'Triangle', make: () => ({ kind: 'triangle', apex: 'top' }) },
  { kind: 'circle', label: 'Round', make: () => ({ kind: 'circle' }) },
];

/**
 * How wide the room is relative to its height, or null when nobody has said — RM-044.
 *
 * SEPARATE FROM `RoomShape` on purpose. The kind (rect / L / triangle …) is what the outline
 * looks like; the aspect is how the frame is proportioned, and every kind can have one. Folding
 * it into the union would mean adding the same optional field to five members and threading it
 * through `shapeToPath`, which draws in a 0..1 box and should keep doing so.
 *
 * NULL MEANS SQUARE, and square means "not measured" rather than "measured as square" — the
 * default every plan had before this existed. The CARE preset carries 300:530 because that is
 * what the original drawing used; `geometry.ts` is explicit that the real room was never
 * measured, so this is a shape somebody can correct, not a survey.
 *
 * Bounded because it becomes a CSS `aspect-ratio`: a frame 40x taller than it is wide is a
 * corrupt row, and rendering it would push everything else off the screen.
 */
export const MIN_ASPECT = 0.2;
export const MAX_ASPECT = 5;

export function parseAspect(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const v = (raw as { aspect?: unknown }).aspect;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < MIN_ASPECT || v > MAX_ASPECT) return null;
  return v;
}
