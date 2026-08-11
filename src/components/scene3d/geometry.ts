/**
 * Spatial layout for the CARE office 3D scene. Deliberately has zero dependency on
 * `three` — every export here is plain numbers/objects, so it's testable without a WebGL
 * context (which this project's headless browser pane doesn't reliably provide anyway —
 * see `officeScene.ts`'s header comment) and reusable if the render layer ever changes.
 *
 * Source of truth is the same one `FloorPlanView.tsx` uses: the live `ui_template` SVGs
 * (`Lighting Floor Plan` / `Outlet Floor Plan (Status Only)`), viewBox `0 0 320 550`. This
 * is NOT `TEST2.html`'s geometry — that scene models the MMSU office (9 outlets, 21
 * fixtures across 6 columns). CARE's real system is 7 dual-socket outlets and 7 lighting
 * circuits, so the room shell and every fixture position below is rebuilt from the actual
 * CARE plan, reusing only TEST2's *technique* (procedural primitives, id-keyed state).
 */

/** Interior bounds and the partition wall's y, straight off the live SVG. */
export const PLAN = { x0: 10, y0: 10, x1: 310, y1: 540, partitionY: 100 } as const;

/**
 * 1 SVG unit = 2cm → the room is ~6.0m × 10.6m. The flow never recorded CARE's actual
 * dimensions anywhere — this is an explicit assumption, isolated to one constant so it's
 * a one-line fix once someone measures the real room, not a scattered find-and-replace.
 */
export const SCALE = 0.02;
export const CEIL_H = 2.7;
export const OUTLET_HEIGHT = 0.35;

export interface Vec2 {
  x: number;
  z: number;
}

/** SVG px/py → world x/z, centered on the room's own midpoint so the model sits at the origin. */
export function toWorld(px: number, py: number): Vec2 {
  const midX = (PLAN.x0 + PLAN.x1) / 2;
  const midY = (PLAN.y0 + PLAN.y1) / 2;
  return { x: (px - midX) * SCALE, z: (py - midY) * SCALE };
}

/** World-space room bounds, derived from `PLAN` — what `officeScene.ts` builds the shell from. */
export const ROOM = {
  minX: toWorld(PLAN.x0, 0).x,
  maxX: toWorld(PLAN.x1, 0).x,
  minZ: toWorld(0, PLAN.y0).z,
  maxZ: toWorld(0, PLAN.y1).z,
  partitionZ: toWorld(0, PLAN.partitionY).z,
  width: (PLAN.x1 - PLAN.x0) * SCALE,
  depth: (PLAN.y1 - PLAN.y0) * SCALE,
  ceilingHeight: CEIL_H,
};

// ---------------------------------------------------------------------------
// Lighting circuits — 7 rows × 3 fixtures, ported from Lighting Floor Plan's ng-repeat
// (`row in [1..7]`, `col in [1,2,3]`, `x = 50 + (col-1)*100`, `y = 480 - (row-1)*65`).
// All 3 fixtures in a row share one circuit's state — that's the real wiring, not a
// simplification: the 2D plan's Angular original bound all three to the same
// `localState['L'+row]`.
// ---------------------------------------------------------------------------

export interface LightFixture {
  /** Unique per mesh: `l{row}-{col}`. */
  id: string;
  /** Device id in the registry — what `latestReadings` is keyed by. Three fixtures share one. */
  circuit: string;
  row: number;
  col: number;
  world: { x: number; y: number; z: number };
}

export const LIGHT_FIXTURES: LightFixture[] = (() => {
  const fixtures: LightFixture[] = [];
  for (let row = 1; row <= 7; row++) {
    for (let col = 0; col < 3; col++) {
      const px = 50 + col * 100 + 9; // +9 = half the original 18px rect, i.e. its center
      const py = 480 - (row - 1) * 65;
      const { x, z } = toWorld(px, py);
      fixtures.push({ id: `l${row}-${col}`, circuit: `l${row}`, row, col, world: { x, y: CEIL_H - 0.05, z } });
    }
  }
  return fixtures;
})();

// ---------------------------------------------------------------------------
// Outlets — ported from Outlet Floor Plan's fixed `coords` array, index i-1 → `co{i}`.
// ---------------------------------------------------------------------------

const OUTLET_COORDS: { id: string; px: number; py: number }[] = [
  { id: 'co1', px: 25, py: 470 },
  { id: 'co2', px: 50, py: 515 },
  { id: 'co3', px: 285, py: 470 },
  { id: 'co4', px: 25, py: 370 },
  { id: 'co5', px: 65, py: 115 },
  { id: 'co6', px: 235, py: 115 },
  { id: 'co7', px: 285, py: 190 },
];

export type WallId = 'left' | 'right' | 'top' | 'bottom' | 'partition';

export interface WallMount {
  wall: WallId;
  /** World-space outward normal — the direction the fixture faces, away from the wall. */
  normal: Vec2;
  /** World-space tangent along the wall face, for spacing two sockets side by side. */
  tangent: Vec2;
  /** World-space position on the wall face itself, at the fixture's own position along it. */
  point: Vec2;
}

/**
 * Nearest-surface resolution against the room's 4 edges plus the interior partition.
 * This is what makes `co5`/`co6` land on the partition rather than the left/right walls —
 * verified against the real coordinates above: co1→left, co2→bottom, co3→right, co4→left,
 * co5→partition, co6→partition, co7→right (see `geometry.test.ts`).
 */
export function nearestWall(px: number, py: number): WallMount {
  const candidates: { wall: WallId; dist: number; normal: Vec2; tangent: Vec2; point: Vec2 }[] = [
    { wall: 'left', dist: px - PLAN.x0, normal: { x: 1, z: 0 }, tangent: { x: 0, z: 1 }, point: toWorld(PLAN.x0, py) },
    { wall: 'right', dist: PLAN.x1 - px, normal: { x: -1, z: 0 }, tangent: { x: 0, z: 1 }, point: toWorld(PLAN.x1, py) },
    { wall: 'top', dist: py - PLAN.y0, normal: { x: 0, z: 1 }, tangent: { x: 1, z: 0 }, point: toWorld(px, PLAN.y0) },
    { wall: 'bottom', dist: PLAN.y1 - py, normal: { x: 0, z: -1 }, tangent: { x: 1, z: 0 }, point: toWorld(px, PLAN.y1) },
    {
      wall: 'partition',
      dist: Math.abs(py - PLAN.partitionY),
      // Partition is interior/two-sided: face whichever side the outlet is actually on.
      normal: { x: 0, z: py >= PLAN.partitionY ? 1 : -1 },
      tangent: { x: 1, z: 0 },
      point: toWorld(px, PLAN.partitionY),
    },
  ];
  return candidates.reduce((best, c) => (c.dist < best.dist ? c : best));
}

export interface OutletFixture {
  /** Matches the registry device id directly (`co1`..`co7`) — no separate mesh-id scheme needed. */
  id: string;
  world: { x: number; y: number; z: number };
  mount: WallMount;
}

export const OUTLET_FIXTURES: OutletFixture[] = OUTLET_COORDS.map(({ id, px, py }) => {
  const mount = nearestWall(px, py);
  return { id, world: { x: mount.point.x, y: OUTLET_HEIGHT, z: mount.point.z }, mount };
});

// ---------------------------------------------------------------------------
// Furniture — Stage L2. Same status as this whole scene's fixture placement always has
// been (see this file's header comment): plausible, not surveyed. Nothing in the live
// flow or the 2D floor plan records where CARE's actual desks, tables, or ACU sit — only
// the 7 dual-socket outlets and 7 lighting circuits above are real, sourced coordinates.
//
// What IS real and used as the anchor for this layout:
//   - ROOM's bounds (6.0m x 10.6m) and the partition at z = -3.5, both derived from the
//     live SVG plan exactly as OUTLET_FIXTURES/LIGHT_FIXTURES are.
//   - The two named zones the partition actually creates: a shallow utility compartment
//     north of it (z in [-5.3, -3.5], the same 1.8m strip circuit l7 alone lights — see
//     LIGHT_FIXTURES' test coverage) versus the main room south of it.
//   - `mtr_lo_yellow`'s own registry description: "Outdoor ACU (separate unit, right side
//     outside the room)" — shared/registry.mjs, not invented for this scene. That's why
//     the indoor ACU sits on the east (right) wall and the outdoor unit sits just outside
//     it, rather than on some other wall picked at random.
//   - Workstations are placed against the two long walls, each anchored so a desk sits at
//     the exact z-coordinate of the outlet that would plausibly feed it (co1/co4 on the
//     west wall, co3/co7 on the east wall) — the other two desks per side fill the
//     remaining wall run at comparable spacing.
//
// TEST2.html's own furniture coordinates are NOT reused here — its room is 9.0m x 6.6m
// (wide, shallow), the opposite proportions of CARE's 6.0m x 10.6m (narrow, deep), so its
// specific placement numbers don't transfer. Its furniture *library* (the factories in
// `furniture.ts`) is what was ported; this table is CARE-specific.
export type FurnitureKind =
  | 'workstation'
  | 'table-oval'
  | 'table-rect'
  | 'workbench'
  | 'cabinet'
  | 'water-dispenser'
  | 'plant-rack'
  | 'acu'
  | 'acu-outdoor';

export interface FurnitureSpec {
  kind: FurnitureKind;
  x: number;
  z: number;
  /** Y-axis rotation, radians. */
  ry: number;
  /** `table-rect` only: overall width/depth and seat count. */
  w?: number;
  d?: number;
  n?: number;
}

export const FURNITURE: FurnitureSpec[] = [
  // West wall workstations — desk backs 0.15m off the wall (x = ROOM.minX + 0.34), chairs
  // facing +x into the room. z = 3.9/1.9 sit exactly on co1/co4; -0.1/-2.2 fill the run at
  // matching ~2m spacing.
  { kind: 'workstation', x: ROOM.minX + 0.34, z: 3.9, ry: Math.PI / 2 },
  { kind: 'workstation', x: ROOM.minX + 0.34, z: 1.9, ry: Math.PI / 2 },
  { kind: 'workstation', x: ROOM.minX + 0.34, z: -0.1, ry: Math.PI / 2 },
  { kind: 'workstation', x: ROOM.minX + 0.34, z: -2.2, ry: Math.PI / 2 },

  // East wall workstations — mirrored. z = 3.9/-1.7 sit on co3/co7; 1.5/-3.0 fill the run.
  { kind: 'workstation', x: ROOM.maxX - 0.34, z: 3.9, ry: -Math.PI / 2 },
  { kind: 'workstation', x: ROOM.maxX - 0.34, z: 1.5, ry: -Math.PI / 2 },
  { kind: 'workstation', x: ROOM.maxX - 0.34, z: -1.7, ry: -Math.PI / 2 },
  { kind: 'workstation', x: ROOM.maxX - 0.34, z: -3.0, ry: -Math.PI / 2 },

  // Oval conference table, centered in the main room's open floor.
  { kind: 'table-oval', x: 0, z: 0.8, ry: 0 },

  // Rect meeting table, toward the south end near co2's side of the room.
  { kind: 'table-rect', x: -0.8, z: 4.2, ry: 0, w: 1.5, d: 0.8, n: 6 },

  // Utility compartment (north of the partition): workbench against the north wall,
  // flanked by two cabinets rotated so their long side runs along the wall instead of
  // eating the compartment's 1.8m depth.
  { kind: 'workbench', x: 0, z: -4.9, ry: 0 },
  { kind: 'cabinet', x: -1.8, z: -5.0, ry: Math.PI / 2 },
  { kind: 'cabinet', x: 1.8, z: -5.0, ry: Math.PI / 2 },

  // Water dispenser just south of the partition, near co5's side.
  { kind: 'water-dispenser', x: -1.9, z: -3.2, ry: 0 },

  // Plant rack along the partition wall, main-room side, clear of both wall runs.
  { kind: 'plant-rack', x: 0.5, z: -3.15, ry: 0, w: 2.0 },

  // Indoor ACU on the east wall — see this block's header comment for why east specifically.
  { kind: 'acu', x: ROOM.maxX - 0.13, z: 0, ry: 0 },
  // Outdoor unit just outside the same wall, on its own pad.
  { kind: 'acu-outdoor', x: ROOM.maxX + 0.7, z: 0, ry: 0 },
];
