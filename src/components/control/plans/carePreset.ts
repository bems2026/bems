/**
 * The CARE office's own layout and room shell — a PACK, not a shared module.
 *
 * WHY IT LIVES HERE AND NOT IN `src/lib/`. This file names `co1`..`co7` and `l1`..`l7`: this
 * building's hardware. `test/device-ids-in-frontend.test.mjs` fails any shared frontend module
 * that does, and exempts exactly two directories — `scene3d/` and this one — because they load
 * only behind `SITE.scene_pack`. A first attempt put this in `src/lib/planPresets.ts` and that
 * guard caught it, correctly: a replicated deployment would have shipped one office's outlets in
 * its bundle and offered them as a starting point for somebody else's room.
 *
 * So: a site that does not name this pack never loads it, and never sees the preset offered.
 *
 * WHAT IS IN IT. The outlet coordinates are the live Node-RED dashboard's own fixed `coords` —
 * a layout a person drew of a room they were standing in. The ceiling positions come from
 * `LIGHT_PLAN`, the single definition the 3D scene renders from too, so the preset and the model
 * cannot disagree. The shell is this room's outline, its two glazed partition panels and the
 * sliding door between them.
 *
 * EVERYTHING IS IN THE ROOM'S FRAME, 0..1 — not the 320x550 viewBox these numbers were written
 * in. `plan_x`/`plan_y` mean "where in this room", the room rectangle is inset 10px on every
 * side, and mixing the two frames puts every device a few percent out while still looking
 * entirely plausible. `toRoomFrame` is that conversion and is tested on the corners.
 */
import { PLAN, LIGHT_PLAN } from '@/components/scene3d/geometry';
import { VB_W, VB_H, DOORWAY_HALF_PX } from '../planGeometry';
import { toRoomFrame, type PlanPreset } from '@/lib/planPresets';

const OUTLETS: [string, number, number][] = [
  ['co1', 25, 470],
  ['co2', 50, 515],
  ['co3', 285, 470],
  ['co4', 25, 370],
  ['co5', 65, 115],
  ['co6', 235, 115],
  ['co7', 285, 190],
];

/** The room's width relative to its height. 300x530 plan units is what the drawing has always
 * used; `geometry.ts` is explicit that nobody ever measured the real room, so this is a shape an
 * operator can correct rather than a survey. */
export const CARE_ASPECT = (PLAN.x1 - PLAN.x0) / (PLAN.y1 - PLAN.y0);

/** Where the glazed partition crosses the room, and how wide the doorway in it is — both in the
 * room's own 0..1 frame rather than the viewBox the originals were written in. */
export const CARE_PARTITION_Y = (PLAN.partitionY - PLAN.y0) / (PLAN.y1 - PLAN.y0);
export const CARE_DOORWAY_HALF = DOORWAY_HALF_PX / (PLAN.x1 - PLAN.x0);

export const carePreset: PlanPreset = {
  id: 'care-office',
  label: 'CARE office (as originally drawn)',
  blurb:
    'The layout the original Node-RED dashboard used: seven outlets where somebody placed them, and three ceiling lamps on each of the seven circuits. Applying it overwrites whatever is currently drawn for these devices.',
  shape: { kind: 'rect', aspect: CARE_ASPECT },
  devices: [
    ...OUTLETS.map(([deviceId, px, py]) => ({
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
