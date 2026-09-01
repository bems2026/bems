/**
 * The Control page's plan, built from what somebody drew — RM-037.
 *
 * WHAT THIS RETIRES. `src/components/control/plans/carePlan.ts` is a hand-surveyed pack: literal
 * coordinates for `co1`..`co7` and three ceiling cells per circuit, measured in one office. It is
 * correct there and wrong everywhere else, while looking equally confident in both — the failure
 * RM-032 refused to accept for the 3D scene. `useControlPlan` now prefers this module and keeps
 * the pack only as a fallback, so the CARE office is not left with a blank card between the
 * deploy and the moment somebody draws its room.
 *
 * ONE ROOM AT A TIME, AND THE INVARIANT BEHIND IT. A position is normalised against ONE space
 * node's frame (`planLayout.ts`). Two rooms' devices drawn in one frame would put half of them
 * somewhere nobody chose, and the result would look exactly as surveyed as the half that was
 * placed. So the plan is per room and the caller picks which.
 *
 * A CIRCUIT IS DRAWN BY ITS LAMPS, NOT BY ITS SWITCH. A switch is on a wall; its luminaires are
 * on the ceiling. A room can therefore have a complete lighting layout and not one placed pin,
 * which is why `drawnRooms` counts fixtures as well as positions.
 *
 * Pure and store-free, so the rule above is testable without rendering anything.
 */
import type { DeviceConfig } from './deviceConfig';
import { planPointOf, type PlanPoint } from './planLayout';
import { parseFixtures } from './lightingGrid';
import { pathLabel, type SpaceNode } from './spaceTree';

export interface DrawnRoom {
  id: string;
  /** The full path, as the space picker shows it — "NBERIC / Lab", not "Lab". Two rooms called
   * "Office" on different floors are otherwise indistinguishable in a one-line picker. */
  label: string;
}

type Saved = Record<string, DeviceConfig | undefined>;

/** Whether this device has anything on a plan at all — a position, or lamps, or both. */
function isDrawn(cfg: DeviceConfig | undefined): boolean {
  if (!cfg) return false;
  return planPointOf(cfg) !== null || parseFixtures(cfg.planFixtures).length > 0;
}

/**
 * The rooms that have something drawn in them, in the order a picker should list them.
 *
 * Rooms with nothing drawn are omitted: offering one would offer an empty frame, which reads as
 * a failed render rather than as a room nobody has got to yet. A device pointing at a node that
 * no longer exists is skipped for the same reason — there is no frame to draw it against.
 */
export function drawnRooms(saved: Saved, nodes: SpaceNode[]): DrawnRoom[] {
  const known = new Set(nodes.map((n) => n.id));
  const ids = new Set<string>();
  for (const cfg of Object.values(saved)) {
    const at = cfg?.spaceNodeId;
    if (at && known.has(at) && isDrawn(cfg)) ids.add(at);
  }
  return [...ids]
    .map((id) => ({ id, label: pathLabel(nodes, id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One room's plan in the shape the Control cards already consume, or null when there is nothing
 * drawn there — null is what lets `useControlPlan` fall through to the build-time pack rather
 * than replacing a drawn plan with an empty one.
 */
export function dataPlanFor(
  saved: Saved,
  nodeId: string | null,
): { OUTLET_POSITIONS: Record<string, PlanPoint>; LIGHT_POSITIONS: Record<string, PlanPoint[]> } | null {
  if (!nodeId) return null;
  const OUTLET_POSITIONS: Record<string, PlanPoint> = {};
  const LIGHT_POSITIONS: Record<string, PlanPoint[]> = {};

  for (const [id, cfg] of Object.entries(saved)) {
    if (!cfg || cfg.spaceNodeId !== nodeId) continue;
    const point = planPointOf(cfg);
    if (point !== null) OUTLET_POSITIONS[id] = point;
    // Tolerant on purpose — `parseFixtures` drops junk rather than throwing, because a corrupt
    // column must not take the Control page down. That is the surface an operator reaches for
    // when something is already wrong.
    const lamps = parseFixtures(cfg.planFixtures);
    if (lamps.length > 0) LIGHT_POSITIONS[id] = lamps;
  }

  if (Object.keys(OUTLET_POSITIONS).length === 0 && Object.keys(LIGHT_POSITIONS).length === 0) return null;
  return { OUTLET_POSITIONS, LIGHT_POSITIONS };
}
