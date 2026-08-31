/**
 * The CARE office's Control-page plan — FI-016.
 *
 * WHY THIS DIRECTORY EXISTS. `OutletPlanCard` pinned `co1..co7` to coordinates surveyed in one
 * room, `LightingMatrixCard` positioned its rows from that room's ceiling grid, and both drew a
 * room shell taken from the 3D pack's geometry. None of it was gated: it rendered at every
 * deployment, so another building's Control page would have shown this building's room with this
 * building's outlets in it — and looked entirely correct doing so, which is the failure mode
 * RM-032 refused for the 3D scene and RM-031 refused for the 2D plan.
 *
 * It is a PACK, on the same terms as `scene3d/`: it loads only when `SITE.scene_pack` names it,
 * and a site that declares no pack gets the same controls in a plain list. A pack is allowed to
 * know its own building; nothing outside one is.
 *
 * DATA ONLY, no component. `PlanShell` is imported separately by `useControlPlan` — a module
 * that exports both a component and constants breaks fast refresh, and eslint says so.
 *
 * POSITIONS ARE NORMALISED 0..1, matching `planLayout.ts`'s convention rather than the raw
 * 320x550 viewBox they were written in. Same pixels on screen — `pct(25, 320)` and `0.078125`
 * render identically — but the numbers now mean the same thing they mean everywhere else in this
 * codebase, so moving them into `device_config.plan_x/plan_y` later is a copy rather than a
 * conversion.
 */
import { VB_W, VB_H } from '../planGeometry';
import { LIGHT_PLAN } from '@/components/scene3d/geometry';

/** Where each outlet sits in the room, 0..1 across and down.
 *
 * Ported from the live `Outlet Floor Plan (Status Only)` `ui_template`'s fixed `coords` array —
 * index i-1 was device `co{i}` there, which is exactly the positional binding that breaks the
 * moment a device list changes order. Keyed by id here, as it has been since the React port. */
export const OUTLET_POSITIONS: Record<string, { x: number; y: number }> = Object.fromEntries(
  (
    [
      ['co1', 25, 470],
      ['co2', 50, 515],
      ['co3', 285, 470],
      ['co4', 25, 370],
      ['co5', 65, 115],
      ['co6', 235, 115],
      ['co7', 285, 190],
    ] as const
  ).map(([id, x, y]) => [id, { x: x / VB_W, y: y / VB_H }]),
);

/** The three ceiling fixtures of each lighting circuit, 0..1. Derived from `LIGHT_PLAN` rather
 * than copied, so the Control matrix cannot drift from the 3D scene's own grid — the reason
 * `LIGHT_PLAN` was made the single definition in the first place. */
export const LIGHT_POSITIONS: Record<string, { x: number; y: number }[]> = Object.fromEntries(
  LIGHT_PLAN.ROWS.map((row) => [
    `l${row}`,
    LIGHT_PLAN.COLS.map((col) => {
      const { px, py } = LIGHT_PLAN.center(row, col);
      return { x: px / VB_W, y: py / VB_H };
    }),
  ]),
);
