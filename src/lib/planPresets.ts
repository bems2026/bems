/**
 * Layouts an operator can APPLY to a room, instead of layouts the build silently is — RM-044.
 *
 * WHAT THIS REPLACES. `src/components/control/plans/carePlan.ts` held the CARE office's surveyed
 * layout as a build-time pack: it rendered wherever `SITE.scene_pack` named it, and nothing
 * outside that one building could ever use it or change it. The knowledge in it is real and
 * worth keeping — the outlet coordinates came from the live Node-RED dashboard's own fixed
 * `coords` array, and the ceiling grid from `LIGHT_PLAN`, which the 3D scene draws from too.
 * Deleting it would have thrown that away; leaving it hard-coded kept the office undrawable.
 *
 * So it becomes a preset: a starting point somebody chooses, writes into `space_nodes.attrs` and
 * `device_config`, and then edits like anything else they drew themselves. After it is applied
 * the DATA is the source of truth and this module is only the seed.
 *
 * THE FRAME CHANGES, AND THAT IS THE TRAP. The pack's numbers are normalised against the
 * **320x550 viewBox**; `plan_x`/`plan_y` mean "where in this ROOM", and the room rectangle is
 * inset 10px on every side (`PLAN`). Copying one straight into the other looks entirely correct —
 * every value is still a plausible 0..1 — and puts every device a few percent out, in the same
 * direction, with nothing to flag it. `toRoomFrame` is that conversion and is tested on the
 * corners.
 *
 * Pure. The writing lives in the store; this only says what to write.
 */
import { PLAN, LIGHT_PLAN } from '@/components/scene3d/geometry';
import { VB_W, VB_H } from '@/components/control/planGeometry';
import type { PlanPoint } from './planLayout';

export interface PresetDevice {
  deviceId: string;
  /** Where the device itself is, or null for something drawn only by its fixtures. */
  point: PlanPoint | null;
  /** The luminaires a lighting circuit reaches. Empty for everything else. */
  fixtures: PlanPoint[];
}

export interface PlanPreset {
  id: string;
  label: string;
  /** Said plainly, because applying one overwrites what is already drawn. */
  blurb: string;
  shape: { kind: 'rect'; aspect: number };
  devices: PresetDevice[];
}

/**
 * A point normalised against the viewBox, re-based onto the room rectangle.
 *
 * The room's own corners land exactly on 0 and 1, which is what `plan_x`/`plan_y` mean and what
 * `shapeToPath` draws against.
 */
export function toRoomFrame(vbX: number, vbY: number): PlanPoint {
  return {
    x: (vbX * VB_W - PLAN.x0) / (PLAN.x1 - PLAN.x0),
    y: (vbY * VB_H - PLAN.y0) / (PLAN.y1 - PLAN.y0),
  };
}

/**
 * The CARE office as the original Node-RED dashboard drew it.
 *
 * The outlet coordinates are that template's own fixed `coords` array — a layout a person drew
 * of a room they were standing in. The ceiling positions come from `LIGHT_PLAN`, the single
 * definition the 3D scene also renders from, so the preset and the model cannot disagree.
 *
 * THE PROPORTIONS ARE AN ASSUMPTION, NOT A SURVEY, and `geometry.ts` says so where it defines
 * `SCALE`: nothing ever recorded this room's real dimensions. 300x530 plan units is what the
 * drawing has always used, so it is what this carries — a shape somebody can correct in the
 * editor once anyone measures the room, rather than a square pretending to be a claim.
 */
const CARE_OUTLETS: [string, number, number][] = [
  ['co1', 25, 470],
  ['co2', 50, 515],
  ['co3', 285, 470],
  ['co4', 25, 370],
  ['co5', 65, 115],
  ['co6', 235, 115],
  ['co7', 285, 190],
];

const careOffice: PlanPreset = {
  id: 'care-office',
  label: 'CARE office (as originally drawn)',
  blurb:
    'The layout the original Node-RED dashboard used: seven outlets where somebody placed them, and three ceiling lamps on each of the seven circuits. Applying it overwrites whatever is currently drawn for these devices.',
  shape: { kind: 'rect', aspect: (PLAN.x1 - PLAN.x0) / (PLAN.y1 - PLAN.y0) },
  devices: [
    ...CARE_OUTLETS.map(([deviceId, px, py]) => ({
      deviceId,
      point: toRoomFrame(px / VB_W, py / VB_H),
      fixtures: [],
    })),
    ...LIGHT_PLAN.ROWS.map((row) => ({
      deviceId: `l${row}`,
      // A switch is on a wall; its luminaires are on the ceiling. Only the second is drawn.
      point: null,
      fixtures: LIGHT_PLAN.COLS.map((col) => {
        const { px, py } = LIGHT_PLAN.center(row, col);
        return toRoomFrame(px / VB_W, py / VB_H);
      }),
    })),
  ],
};

export const PLAN_PRESETS: PlanPreset[] = [careOffice];

export function presetFor(id: string): PlanPreset | undefined {
  return PLAN_PRESETS.find((p) => p.id === id);
}

export interface PresetPlacement {
  deviceId: string;
  spaceNodeId: string;
  planX: number | null;
  planY: number | null;
  planFixtures: PlanPoint[];
}

/**
 * What applying a preset to one room would write, and what it could not.
 *
 * ONLY DEVICES THIS DEPLOYMENT HAS. A preset names one building's hardware; at another site
 * those ids do not exist, and writing them would fail `device_config.device_id`'s foreign key —
 * after the operator had been told it worked. The ones it skips are returned rather than
 * swallowed, because a layout that applied to four of fourteen devices and said nothing is worse
 * than one that refused.
 */
export function presetPlacements(
  preset: PlanPreset,
  presentDeviceIds: string[],
  spaceNodeId: string,
): { placements: PresetPlacement[]; skipped: string[] } {
  const present = new Set(presentDeviceIds);
  const placements: PresetPlacement[] = [];
  const skipped: string[] = [];
  for (const d of preset.devices) {
    if (!present.has(d.deviceId)) {
      skipped.push(d.deviceId);
      continue;
    }
    placements.push({
      deviceId: d.deviceId,
      spaceNodeId,
      planX: d.point?.x ?? null,
      planY: d.point?.y ?? null,
      planFixtures: d.fixtures,
    });
  }
  return { placements, skipped };
}
