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
 * the DATA is the source of truth and a preset is only the seed.
 *
 * THIS FILE IS THE MACHINERY, NOT THE LAYOUTS. No preset data lives here, because a preset names
 * one building's device ids and this module ships to every deployment.
 * `test/device-ids-in-frontend.test.mjs` enforces that, and caught a first version that got it
 * wrong: a replicated site would have carried this office's outlets in its bundle and offered
 * them as a starting point for somebody else's room. The layouts live in
 * `src/components/control/plans/`, which loads only behind `SITE.scene_pack`.
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
import { PLAN } from '@/components/scene3d/geometry';
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
