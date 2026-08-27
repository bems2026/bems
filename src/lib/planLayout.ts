/**
 * Where a device sits inside its space — RM-031. Pure, and deliberately so.
 *
 * `supabase/phase23_plan_coords.sql` owns the columns and the invariants; this file owns the
 * shape the UI thinks in, the same split `spaceTree.ts` has from `supabaseSpaceTree.ts`. Every
 * rule below is testable with plain numbers and no DOM.
 *
 * COORDINATES ARE NORMALISED 0..1 WITHIN ONE SPACE NODE — not pixels, not metres. Pixels would
 * bind a placement to one viewBox; metres would claim a survey nobody has done. 0..1 asserts
 * only what an operator knows by looking: a quarter of the way along and three quarters of the
 * way down THIS room.
 *
 * THEY ARE MEANINGLESS OUTSIDE THAT NODE, which is the constraint that shapes the renderer. A
 * room's plan may draw the devices placed IN that room and no others: a device in a child room
 * carries coordinates measured against the child's frame, and drawing them in the parent's
 * frame would put it somewhere nobody chose. Descendants get their own plans; that is what
 * `groupByPlacement` is for.
 *
 * READING CLAMPS NOTHING; WRITING CLAMPS EVERYTHING. The asymmetry is the point. A pointer
 * dragged past the edge of the frame is a person saying "against that wall" — a real position,
 * so it is clamped and stored. A stored value outside 0..1 is a corrupt row, so it is refused
 * and the device reports as unplaced. Clamping THAT would pin a device to a wall and look
 * exactly as deliberate as a position somebody chose.
 */

import { pathLabel, type SpaceNode } from './spaceTree';

export interface PlanPoint {
  /** Across the node's frame, 0 at the left edge, 1 at the right. */
  x: number;
  /** Down the node's frame, 0 at the top, 1 at the bottom. */
  y: number;
}

/**
 * Decimals kept when a position is stored. 1e-4 of a 10-metre room is a millimetre, so this is
 * far finer than anyone can point and far coarser than float noise — which is the actual job.
 * Without it, two drags to the same visible spot store different numbers and the editor reports
 * an unsaved change that cannot be cleared.
 */
export const PLAN_PRECISION = 4;

const FACTOR = 10 ** PLAN_PRECISION;

function round(n: number): number {
  return Math.round(n * FACTOR) / FACTOR;
}

/**
 * One stored axis, or null if it is not a position.
 *
 * Strings are accepted, and the measurement is worth recording rather than leaving the reader
 * to guess. On 2026-08-28, against the live project, PostgREST returned `plan_x` as a JSON
 * NUMBER (`0.25`), so the string branch is not load-bearing today. It stays because `count(*)`
 * reached this codebase as a string and `rowToNodeTotals` carries that scar — the encoding of a
 * number is a decision made somewhere else, and the cost of being wrong about it is a plan that
 * renders every device as unplaced and looks like a feature nobody finished.
 *
 * `Number('')` is 0 and `Number([])` is 0 and `Number(true)` is 1, so the type is checked
 * before the value is — coercing first would accept three things that are not coordinates.
 */
export function coercePlanCoord(value: unknown): number | null {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  else return null;
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

/**
 * The position of a device, or null if it does not have one.
 *
 * BOTH AXES OR NEITHER, enforced here as well as in the database. phase23's CHECK stops a half
 * placement being written from now on; this stops one written before that migration, or by
 * anything that is not this app, from being rendered — because the renderer would have to
 * invent the missing axis, and whatever it invented would look surveyed.
 */
export function planPointOf(config: { planX: unknown; planY: unknown } | null | undefined): PlanPoint | null {
  if (!config) return null;
  const x = coercePlanCoord(config.planX);
  const y = coercePlanCoord(config.planY);
  if (x === null || y === null) return null;
  return { x, y };
}

/** Where a dragged point lands: inside the frame, at the stored precision. */
export function clampToPlan(point: PlanPoint): PlanPoint {
  return {
    x: round(Math.min(1, Math.max(0, point.x))),
    y: round(Math.min(1, Math.max(0, point.y))),
  };
}

/**
 * A pointer position converted into the frame it was released over.
 *
 * `frame` is a `DOMRect`'s shape, passed as plain numbers so this stays testable without a DOM.
 *
 * A FRAME WITH NO SIZE RETURNS NULL rather than dividing by zero. jsdom reports every rect as
 * zeroes, and a real browser does the same for an element that is hidden or not yet laid out.
 * `0/0` is NaN, which would fail phase23's range CHECK on write — after the pin had already
 * appeared to move, which is the worst order for that to happen in.
 */
export function pointerToPlan(
  pointer: { x: number; y: number },
  frame: { left: number; top: number; width: number; height: number },
): PlanPoint | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  return clampToPlan({
    x: (pointer.x - frame.left) / frame.width,
    y: (pointer.y - frame.top) / frame.height,
  });
}

export interface PlacementGroup {
  /** Null for the unplaced group — the one group that is not a node. */
  nodeId: string | null;
  label: string;
  /** Input order preserved, so a caller that sorted its devices keeps that sort. */
  ids: string[];
}

/** What the unplaced group is called. Named rather than left blank: an unlabelled group reads
 * as a rendering fault, and "not placed" is an answer. */
export const UNPLACED_LABEL = 'Not placed';

/**
 * Devices grouped by the space they are placed in, deepest label sorted alphabetically, with
 * the unplaced group last.
 *
 * THIS IS THE VIEW A SITE SEES BEFORE ANYONE DRAWS A PLAN, and it is the reason RM-031 is not
 * just a renderer. A blank frame at a fresh site is indistinguishable from a broken one. A list
 * of every device under the space it is in is honest, immediately useful, and needs nothing
 * drawn.
 *
 * A device whose node this client does not know — a delete racing a render, a stale draft —
 * joins the unplaced group rather than being dropped. Dropping it would make hardware vanish
 * from the one screen whose job is to account for all of it.
 */
export function groupByPlacement(
  items: readonly { id: string; nodeId: string | null }[],
  nodes: readonly SpaceNode[],
): PlacementGroup[] {
  const byNode = new Map<string, PlacementGroup>();
  const unplaced: string[] = [];

  for (const item of items) {
    const label = pathLabel(nodes, item.nodeId);
    if (!label || item.nodeId === null) {
      unplaced.push(item.id);
      continue;
    }
    const existing = byNode.get(item.nodeId);
    if (existing) existing.ids.push(item.id);
    else byNode.set(item.nodeId, { nodeId: item.nodeId, label, ids: [item.id] });
  }

  const groups = [...byNode.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (unplaced.length > 0) groups.push({ nodeId: null, label: UNPLACED_LABEL, ids: unplaced });
  return groups;
}
