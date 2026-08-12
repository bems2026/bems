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
//
// `LIGHT_PLAN` is the SINGLE definition of this row/col math — both the 3D scene
// (`LIGHT_FIXTURES` below, via `toWorld`) and the 2D `FloorPlanView.tsx` derive from it,
// so the two views cannot drift the way they did when each carried its own copy of the
// formula (that drift is exactly how row 7 ended up at py=90, 10px from the partition at
// py=100, instead of centered in the small compartment it's the only circuit for).
// ---------------------------------------------------------------------------

export const LIGHT_PLAN = {
  ROWS: [1, 2, 3, 4, 5, 6, 7] as const,
  COLS: [0, 1, 2] as const,
  /** Side of the 2D plan's square marker, plan units (20px = 0.40m at SCALE). */
  MARKER: 20,

  /**
   * Rows 1-6 keep the live template's `480 - (row-1)*65` ladder verbatim. Row 7 is a
   * deliberate exception: that ladder lands it at py=90 (world z=-3.7) — jammed against
   * the partition at py=100/z=-3.5, the wall of the very compartment it's the only
   * circuit for. `(PLAN.y0 + PLAN.partitionY) / 2` = 55 is that compartment's own
   * midpoint (compartment spans y0..partitionY), world z = -4.4.
   */
  rowPy(row: number): number {
    return row === 7 ? (PLAN.y0 + PLAN.partitionY) / 2 : 480 - (row - 1) * 65;
  },

  /** `+ MARKER/2` = the marker's centre, so 60/160/260 -> world x of exactly -2.0/0.0/+2.0
   * while the 2D rect's left edge (`colPx - MARKER/2`) stays at 50/150/250 — unchanged
   * from the old `50 + col*100` corner. */
  colPx(col: number): number {
    return 50 + col * 100 + this.MARKER / 2;
  },

  center(row: number, col: number): { px: number; py: number } {
    return { px: this.colPx(col), py: this.rowPy(row) };
  },
} as const;

/** One anchor per circuit, at the row's own centre (x=0, since col 1 is the room's
 * midline) — where `officeScene.ts`'s single per-circuit PointLight hangs. A dedicated
 * export rather than averaging `LIGHT_FIXTURES` by circuit, so a future column change
 * can't silently move the lamp out from under the fixtures it's meant to light. */
export const LIGHT_ROWS: { circuit: string; row: number; world: { x: number; y: number; z: number } }[] = LIGHT_PLAN.ROWS.map((row) => ({
  circuit: `l${row}`,
  row,
  world: { x: 0, y: CEIL_H - 0.35, z: toWorld(0, LIGHT_PLAN.rowPy(row)).z },
}));

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
  for (const row of LIGHT_PLAN.ROWS) {
    for (const col of LIGHT_PLAN.COLS) {
      const { px, py } = LIGHT_PLAN.center(row, col);
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
// Furniture — Stage L2, re-laid out in Phase O against a reference office blueprint the
// user supplied. Same status as this whole scene's fixture placement always has been (see
// this file's header comment): plausible, not surveyed. Nothing in the live flow or the 2D
// floor plan records where CARE's actual desks, tables, or ACU sit — only the 7 dual-socket
// outlets and 7 lighting circuits above are real, sourced coordinates.
//
// What IS real and used as the anchor for this layout:
//   - ROOM's bounds (6.0m x 10.6m) and the partition at z = -3.5, both derived from the
//     live SVG plan exactly as OUTLET_FIXTURES/LIGHT_FIXTURES are.
//   - The two named zones the partition actually creates: a shallow utility compartment
//     north of it (z in [-5.3, -3.5], the same 1.8m strip circuit l7 alone lights — see
//     LIGHT_FIXTURES' test coverage) versus the main room south of it. Phase O's explicit
//     rule is that this compartment stays EMPTY — it's a lobby, not storage — so nothing
//     below places any piece at z < -3.5.
//
// Blueprint -> room mapping (the blueprint is a 9.0 x 6.6m *wide* room; ours is 6.0 x 10.6m
// *narrow*, so this is a 90-degree adaptation, not a transcription):
//   blueprint's entrance short wall      -> our partition, z = -3.5 (both are the entrance)
//   blueprint's window/AC short wall     -> our far short wall, z = +5.3 (farthest from the
//                                            entrance, per the user's explicit rule)
//   blueprint's plant-rack long wall     -> our west long wall, x = -3.0
//   blueprint's reception/L-desk wall    -> our east long wall, x = +3.0
//
// Rotation convention (`rotation.y`), verified numerically against `makeWorkstation`'s own
// local geometry (desktop/monitor at local z ~ -0.2, chair at local z = +0.5, so the
// occupant faces local -Z): for a local point (x, z), world = (x*cos(t) + z*sin(t),
// -x*sin(t) + z*cos(t)) where t = ry.
//   ry = 0      -> faces world -z, footprint x [cx-0.5, cx+0.5],  z [cz-0.31, cz+0.8]
//   ry = +PI/2  -> faces world -x, footprint x [cx-0.31, cx+0.8], z [cz-0.5,  cz+0.5]
//   ry = -PI/2  -> faces world +x, footprint x [cx-0.8,  cx+0.31],z [cz-0.5,  cz+0.5]
//   ry = PI     -> faces world +z, footprint x [cx-0.5,  cx+0.5], z [cz-0.8,  cz+0.31]
// Every position below was checked against this table (and the ACU's own body/vent
// geometry in `furniture.ts`, which is authored with its long axis on local Z and its
// vents at local -X) with a script that computes every piece's world-space bounding box and
// asserts zero pairwise overlap, zero excursion outside x in [-3,3] / z in [-3.5, 5.3], and
// a clear doorway (x in [-0.8, 0.8] at z = -3.5) — not hand-eyeballed.
//
// TEST2.html's own furniture coordinates are NOT reused here — its room is 9.0m x 6.6m
// (wide, shallow), the opposite proportions of CARE's 6.0m x 10.6m (narrow, deep), so its
// specific placement numbers don't transfer. Its furniture *library* (the factories in
// `furniture.ts`) is what was ported; this table is CARE-specific.
//
// `table-rect` and `workbench` are unused by this table (the blueprint has no rect meeting
// table, and the lobby that once held `workbench` must now stay empty) — the factories stay
// for reuse, they're simply not instantiated below.
export type FurnitureKind =
  | 'workstation'
  | 'table-oval'
  | 'table-rect'
  | 'workbench'
  | 'cabinet'
  | 'water-dispenser'
  | 'plant-rack'
  | 'bench'
  | 'desk-l'
  | 'reception-desk'
  | 'acu'
  | 'acu-outdoor';

export interface FurnitureSpec {
  kind: FurnitureKind;
  x: number;
  /** Group origin height. Defaults to 0 (floor-standing) — see `buildFurniturePiece` in
   * `furniture.ts`. Only the wall-mounted indoor ACU sets it: `makeACU()` builds its body
   * centred on the group origin, so a wall unit is positioned by lifting the whole group,
   * not by re-centring the factory (which would silently break the outdoor variant's own
   * `acu.position.y = 0.4`). */
  y?: number;
  z: number;
  /** Y-axis rotation, radians. */
  ry: number;
  /** `table-rect` only: overall width/depth and seat count. */
  w?: number;
  d?: number;
  n?: number;
}

export const FURNITURE: FurnitureSpec[] = [
  // --- West wall (blueprint's plant-rack wall): rack + 4 desks facing it ---------------
  // Rack runs almost the full usable west wall (4.4m of the room's 8.8m south-of-lobby
  // span). Desks sit 0.14m clear of the rack's front edge, 1.10m pitch, facing -x (west,
  // into the rack) — ry = +PI/2 per the rotation table above.
  { kind: 'plant-rack', x: -2.65, z: 2.8, ry: Math.PI / 2, w: 4.4 },
  { kind: 'workstation', x: -1.9, z: 4.4, ry: Math.PI / 2 },
  { kind: 'workstation', x: -1.9, z: 3.3, ry: Math.PI / 2 },
  { kind: 'workstation', x: -1.9, z: 2.2, ry: Math.PI / 2 },
  { kind: 'workstation', x: -1.9, z: 1.1, ry: Math.PI / 2 },

  // --- Centre: oval conference table, clear of both wall runs' z-bands -----------------
  { kind: 'table-oval', x: 0.1, z: -0.8, ry: 0 },

  // --- East wall (blueprint's reception/manager wall), entrance end to far end ---------
  // 3-desk interconnected bank, facing -x (into the room) — chairs sit near the wall,
  // desktops toward the room centre, ry = +PI/2 (same facing as the west row: everyone
  // looks toward the room's midline, not at a screen with their back to open floor).
  { kind: 'workstation', x: 2.15, z: -2.95, ry: Math.PI / 2 },
  { kind: 'workstation', x: 2.15, z: -1.85, ry: Math.PI / 2 },
  { kind: 'workstation', x: 2.15, z: -0.7, ry: Math.PI / 2 },
  // Single desk, same wall, same facing, 0.4m clear of the bank.
  { kind: 'workstation', x: 2.15, z: 0.55, ry: Math.PI / 2 },
  // L-shaped manager desk, same wall/facing, 0.4m clear of the single desk.
  { kind: 'desk-l', x: 2.15, z: 1.75, ry: Math.PI / 2 },
  // Storage behind the manager desk, flush to the wall (one cabinet unit — its 6 shelves
  // already read as "filing storage"; a second unit wouldn't fit this wall run without
  // crowding the reception zone beyond it).
  { kind: 'cabinet', x: 2.75, z: 3.85, ry: 0 },

  // --- Far end (blueprint's window/AC wall, z = +5.3): reception + waiting -------------
  // Reception counter faces into the room (-z, ry = 0) between the west desks' wall run and
  // the east cabinet's wall run — clear of both. Benches face the counter (+z, ry = PI).
  { kind: 'reception-desk', x: 0.3, z: 4.5, ry: 0 },
  { kind: 'bench', x: 0.3, z: 3.75, ry: Math.PI },
  { kind: 'bench', x: 0.3, z: 3.1, ry: Math.PI },
  { kind: 'water-dispenser', x: 1.45, z: 4.5, ry: 0 },

  // Indoor ACU on the far short wall (z = maxZ), between the two windows added there in
  // `officeScene.ts` — moved off the east wall per Phase O's explicit rule (windows + ACU
  // must sit on the short wall farthest from the glass entrance/partition). `makeACU`'s
  // body is authored with its long axis on local Z and its vents at local -X, so ry = -PI/2
  // turns the long axis to run along world X (along this wall) with vents facing world -z
  // (into the room) — see this block's header comment for the verified rotation table.
  // y = ceilingHeight - 0.22 wall-mounts it high, like a real split-unit indoor head;
  // without a y it defaults to 0 and sits centred on the floor, half-buried (Phase N fix).
  { kind: 'acu', x: 0, y: ROOM.ceilingHeight - 0.22, z: ROOM.maxZ - 0.13, ry: -Math.PI / 2 },
  // Outdoor unit just outside the same wall, on its own pad (`mtr_lo_yellow`'s registry
  // description — "Outdoor ACU (separate unit, right side outside the room)" — described
  // the old east-wall placement; the unit itself just follows the indoor head wherever it
  // moves, so it stays paired here rather than anchored to a compass direction).
  { kind: 'acu-outdoor', x: 0, z: ROOM.maxZ + 0.7, ry: -Math.PI / 2 },
];
