import { describe, it, expect } from 'vitest';
import { toWorld, nearestWall, LIGHT_FIXTURES, OUTLET_FIXTURES, ROOM, PLAN } from './geometry';

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
});
