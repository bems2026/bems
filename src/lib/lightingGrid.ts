/**
 * Where a lighting circuit's lamps are — RM-037.
 *
 * WHAT THIS REPLACES. `src/components/control/plans/carePlan.ts` gives every circuit exactly
 * three ceiling cells at coordinates surveyed in one office. A second site inherits that geometry
 * and is drawn incorrectly while looking entirely correct — the failure RM-032 refused to accept
 * for the floor plan — and it is simply wrong for any room without three fixtures per circuit.
 *
 * THE GRID IS AN INPUT METHOD, NOT A STORAGE FORMAT. This is the whole design.
 *
 * Painting happens on cells, because a ceiling IS laid out on a grid and twelve taps is a
 * reasonable way to describe twelve luminaires. But what gets written down is where each lamp
 * IS — a normalised point, in the same 0..1 frame as `planLayout`'s coordinates. Storing cell
 * indices instead would mean a resize from 4x3 to 5x3 silently relocated every luminaire in the
 * building while nothing had physically moved.
 *
 * A CIRCUIT HAS A SET OF POSITIONS; A DEVICE HAS ONE. `plan_x`/`plan_y` stay for outlets, meters
 * and sensors. These are separate columns rather than one nullable array because collapsing them
 * would make every consumer ask "is this one thing or many?" before it could render either.
 *
 * Pure and DOM-free — jsdom measures no SVG, so geometry asserted through the DOM would assert
 * nothing. Same reasoning as `roomShape.ts` and `popoverPlacement.ts`.
 */

import type { PlanPoint } from './planLayout';

/**
 * The most lamps one circuit may hold.
 *
 * Not a design limit — no real circuit has 200 luminaires — but a stop on a stuck pointer or a
 * runaway loop writing a row nobody meant. Far above any ceiling, far below anything that would
 * make the plan slow.
 */
export const MAX_FIXTURES = 200;

function assertGrid(cols: number, rows: number): void {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new Error(`a grid must be whole positive numbers, got ${cols}x${rows}`);
  }
}

/** Every cell's centre, row-major from the top-left — the same ordering `roomShape.cellIndex`
 * uses, because two grid conventions in one plan is one too many. */
export function gridCells(cols: number, rows: number): PlanPoint[] {
  assertGrid(cols, rows);
  const out: PlanPoint[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      out.push({ x: (col + 0.5) / cols, y: (row + 0.5) / rows });
    }
  }
  return out;
}

/**
 * The cell a point falls in.
 *
 * `Math.min(cols - 1, …)` because `x === 1` would otherwise index column `cols`, which does not
 * exist — a click on the right-hand wall belongs to the rightmost cell, not to nothing.
 */
export function cellOf(p: PlanPoint, cols: number, rows: number): number {
  assertGrid(cols, rows);
  const col = Math.min(cols - 1, Math.max(0, Math.floor(p.x * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(p.y * rows)));
  return row * cols + col;
}

/**
 * Adds a lamp at the tapped cell's centre, or removes the one already there.
 *
 * SNAPPED TO THE CENTRE, not left where the finger landed — that is what makes a painted ceiling
 * look laid out rather than hand-scattered, and it is why a grid is worth having at all.
 *
 * REMOVAL MATCHES ANYWHERE IN THE CELL, not an exact centre. Lamps painted on a 4x3 grid keep
 * their points when the grid becomes 2x2, so a later tap has to be able to find them; matching
 * on equality would leave ghosts that could be seen and never removed.
 */
export function toggleFixture(existing: PlanPoint[], at: PlanPoint, cols: number, rows: number): PlanPoint[] {
  const target = cellOf(at, cols, rows);
  const remaining = existing.filter((p) => cellOf(p, cols, rows) !== target);
  if (remaining.length !== existing.length) return remaining;
  if (existing.length >= MAX_FIXTURES) return existing;
  const centre = gridCells(cols, rows)[target];
  return [...existing, centre];
}

const isPoint = (v: unknown): v is PlanPoint => {
  if (typeof v !== 'object' || v === null) return false;
  const { x, y } = v as { x?: unknown; y?: unknown };
  return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
};

/**
 * The stored column as lamps, tolerating anything.
 *
 * DROPS BAD POINTS, KEEPS GOOD ONES. One corrupt entry must not discard a ceiling somebody
 * painted, and a layout that threw would take the whole plan down.
 *
 * REFUSES points outside the frame rather than clamping them — the same asymmetry `planLayout`
 * draws and states: writing clamps, because a drag past the edge is a person saying "against that
 * wall"; reading refuses, because a stored value outside 0..1 is a corrupt row and pinning it to
 * a wall would look exactly as deliberate as a position somebody chose.
 */
export function parseFixtures(raw: unknown): PlanPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPoint).slice(0, MAX_FIXTURES).map(({ x, y }) => ({ x, y }));
}

/** Lamps per device, for the editor's summary. Absent is 0 and so is empty — the difference
 * between "not described" and "controls nothing here" matters in the database, but not to
 * somebody reading a count. */
export function fixtureCount(configs: Record<string, { planFixtures?: PlanPoint[] } | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, cfg] of Object.entries(configs)) out[id] = cfg?.planFixtures?.length ?? 0;
  return out;
}

/**
 * Colours a room's lighting circuits can be told apart by.
 *
 * WHY A PALETTE AND NOT A DESIGN TOKEN. `src/index.css` has tokens for states — on, off, stale,
 * warning — and there is no token for "the third circuit in this room", because that is not a
 * state, it is an identity. These are hues chosen to stay distinguishable on both the light and
 * the dark card background, at the size of a lamp dot.
 *
 * SORTED, so a circuit keeps its colour whatever order the room lists them in. A colour that
 * moved when a device was renamed or a fetch returned differently would make the legend a lie.
 *
 * WRAPS rather than running out. Two circuits sharing a colour in a very large room is a minor
 * ambiguity; an unstyled dot reads as a rendering fault, and `undefined` in a style attribute is
 * exactly that.
 */
const PALETTE = ['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#facc15', '#60a5fa', '#f472b6'];

/** How many circuits get a colour of their own before the palette repeats. */
export const PALETTE_SIZE = PALETTE.length;

export function circuitColors(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  [...ids].sort().forEach((id, i) => {
    out[id] = PALETTE[i % PALETTE.length];
  });
  return out;
}
