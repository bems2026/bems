import { describe, it, expect } from 'vitest';
import { toWorld, nearestWall, LIGHT_FIXTURES, OUTLET_FIXTURES, ROOM, PLAN } from './geometry';

/** The door gap Phase N's glazed partition (officeScene.ts) leaves in the middle of the
 * partition — half-width in world metres. Duplicated here (not imported) deliberately:
 * this is the one test asserting co5/co6 stay clear of it, so it must not silently track
 * a future change to the 3D shell's own constant. */
const DOOR_HALF_M = 0.8;
/** Outlet block half-width along the wall tangent once enlarged + spread (Phase N):
 * BLOCK/2 (0.08) + OFFSET (0.11). */
const OUTLET_HALF_SPREAD_M = 0.19;

describe('toWorld', () => {
  it('maps the room center to the world origin', () => {
    const midX = (PLAN.x0 + PLAN.x1) / 2;
    const midY = (PLAN.y0 + PLAN.y1) / 2;
    expect(toWorld(midX, midY)).toEqual({ x: 0, z: 0 });
  });

  it('scales consistently in both axes', () => {
    const a = toWorld(PLAN.x0, 0);
    const b = toWorld(PLAN.x1, 0);
    expect(b.x - a.x).toBeCloseTo(ROOM.width, 6);
  });
});

describe('nearestWall', () => {
  // The exact real coordinates from OUTLET_FIXTURES / the live Outlet Floor Plan template.
  it.each([
    ['co1', 25, 470, 'left'],
    ['co2', 50, 515, 'bottom'],
    ['co3', 285, 470, 'right'],
    ['co4', 25, 370, 'left'],
    ['co5', 65, 115, 'partition'],
    ['co6', 235, 115, 'partition'],
    ['co7', 285, 190, 'right'],
  ] as const)('%s at (%d,%d) resolves to %s', (_id, px, py, expected) => {
    expect(nearestWall(px, py).wall).toBe(expected);
  });

  it('partition-mounted outlets face away from the partition, into the room they serve', () => {
    // co5/co6 sit just south of the partition (py=115 > partitionY=100), so they must
    // face further south (+z), not back into the partition or north across it.
    const mount = nearestWall(65, 115);
    expect(mount.normal.z).toBe(1);
  });

  it('a point on the north side of the partition would face the opposite way', () => {
    const mount = nearestWall(65, 95);
    expect(mount.wall).toBe('partition');
    expect(mount.normal.z).toBe(-1);
  });
});

describe('LIGHT_FIXTURES', () => {
  it('has exactly 21 fixtures — 7 circuits × 3 each', () => {
    expect(LIGHT_FIXTURES).toHaveLength(21);
  });

  it('every fixture id is unique', () => {
    expect(new Set(LIGHT_FIXTURES.map((f) => f.id)).size).toBe(21);
  });

  it('all 3 fixtures in a row share the same circuit id', () => {
    const row3 = LIGHT_FIXTURES.filter((f) => f.row === 3);
    expect(row3).toHaveLength(3);
    expect(new Set(row3.map((f) => f.circuit))).toEqual(new Set(['l3']));
  });

  it('circuit l7 sits north of the partition — a real detail the flat 2D plan hides', () => {
    const l7 = LIGHT_FIXTURES.filter((f) => f.circuit === 'l7');
    for (const f of l7) expect(f.world.z).toBeLessThan(ROOM.partitionZ);
  });

  it('circuits l1..l6 sit south of the partition', () => {
    for (const f of LIGHT_FIXTURES.filter((f) => f.circuit !== 'l7')) {
      expect(f.world.z).toBeGreaterThan(ROOM.partitionZ);
    }
  });

  it('row 7 is centered in the compartment it alone lights, not jammed against the partition', () => {
    // The compartment spans [minZ, partitionZ]; its own midpoint is the one honest place
    // for its only circuit to sit. Expressed as a derivation, not the literal -4.4, so
    // this stays true if PLAN is ever re-surveyed.
    const expectedZ = (ROOM.minZ + ROOM.partitionZ) / 2;
    for (const f of LIGHT_FIXTURES.filter((f) => f.circuit === 'l7')) {
      expect(f.world.z).toBeCloseTo(expectedZ, 6);
    }
  });

  it('the 3 columns sit at exactly -2.0 / 0.0 / +2.0 — nothing rounds them off-grid', () => {
    // Nothing pinned this before; it's how a stray "+9" (a rect-corner offset masquerading
    // as a center) survived unnoticed. -2.0/0/+2.0 is the *centered* 3-column spread across
    // the room's 6.0m short axis.
    const row1 = LIGHT_FIXTURES.filter((f) => f.row === 1).sort((a, b) => a.col - b.col);
    expect(row1.map((f) => f.world.x)).toEqual([-2, 0, 2]);
  });

  it('every row runs along the short (x) axis at one fixed z — rows parallel to the short walls', () => {
    for (let row = 1; row <= 7; row++) {
      const fixtures = LIGHT_FIXTURES.filter((f) => f.row === row);
      const zs = new Set(fixtures.map((f) => f.world.z));
      expect(zs.size).toBe(1); // one z per row: the row is a line across x, not down z
      const xs = fixtures.map((f) => f.world.x).sort((a, b) => a - b);
      expect(xs[xs.length - 1] - xs[0]).toBeGreaterThan(0); // and it actually spans x
    }
  });
});

describe('OUTLET_FIXTURES', () => {
  it('has exactly 7 outlets, ids co1..co7', () => {
    expect(OUTLET_FIXTURES.map((f) => f.id)).toEqual(['co1', 'co2', 'co3', 'co4', 'co5', 'co6', 'co7']);
  });

  it('every outlet sits within the room bounds', () => {
    for (const f of OUTLET_FIXTURES) {
      expect(f.world.x).toBeGreaterThanOrEqual(ROOM.minX - 0.01);
      expect(f.world.x).toBeLessThanOrEqual(ROOM.maxX + 0.01);
      expect(f.world.z).toBeGreaterThanOrEqual(ROOM.minZ - 0.01);
      expect(f.world.z).toBeLessThanOrEqual(ROOM.maxZ + 0.01);
    }
  });

  it('a left-wall outlet sits exactly on the left wall x-coordinate', () => {
    const co1 = OUTLET_FIXTURES.find((f) => f.id === 'co1')!;
    expect(co1.mount.wall).toBe('left');
    expect(co1.world.x).toBeCloseTo(ROOM.minX, 6);
  });

  it('the partition-mounted outlets (co5/co6) sit clear of the glazed partition\'s door gap', () => {
    // This is the ONLY structural safety net for officeScene.ts's glazed-partition door —
    // the socket spread itself lives there, unreachable by this test file, so what's
    // checked here is the anchor point co5/co6 are built outward from staying safely on a
    // solid glass panel rather than drifting into the 1.6m sliding-door gap.
    const clearance = DOOR_HALF_M + OUTLET_HALF_SPREAD_M;
    for (const id of ['co5', 'co6']) {
      const f = OUTLET_FIXTURES.find((fx) => fx.id === id)!;
      expect(f.mount.wall).toBe('partition');
      expect(Math.abs(f.world.x)).toBeGreaterThan(clearance);
    }
  });
});
