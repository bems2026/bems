import { describe, it, expect } from 'vitest';
import { gridCells, cellOf, toggleFixture, parseFixtures, fixtureCount, circuitColors, MAX_FIXTURES, PALETTE_SIZE } from './lightingGrid';

/**
 * Lamps on a ceiling grid, stored as points.
 *
 * The property most of these defend: **the grid is an input method, not a storage format**.
 * Painting happens on cells; what is written down is where the lamp is. A grid resize must
 * therefore move nothing, because nothing physically moved.
 */
describe('gridCells', () => {
  it('returns cell centres, row-major from the top-left', () => {
    expect(gridCells(2, 2)).toEqual([
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.25, y: 0.75 },
      { x: 0.75, y: 0.75 },
    ]);
  });

  it('gives every cell a centre strictly inside the frame', () => {
    for (const p of gridCells(5, 4)) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
    }
  });

  it('refuses a grid that is not a grid rather than returning something unusable', () => {
    for (const [c, r] of [[0, 3], [3, 0], [-1, 2], [2.5, 2]]) expect(() => gridCells(c, r)).toThrow();
  });
});

describe('cellOf', () => {
  it('maps a point back to the cell that contains it', () => {
    expect(cellOf({ x: 0.1, y: 0.1 }, 2, 2)).toBe(0);
    expect(cellOf({ x: 0.9, y: 0.1 }, 2, 2)).toBe(1);
    expect(cellOf({ x: 0.9, y: 0.9 }, 2, 2)).toBe(3);
  });

  it('keeps the far edges inside the last cell rather than off the end of the grid', () => {
    // x === 1 would otherwise index column `cols`, which does not exist. A click on the right
    // wall belongs to the rightmost cell.
    expect(cellOf({ x: 1, y: 1 }, 4, 3)).toBe(11);
  });
});

describe('toggleFixture', () => {
  const grid = { cols: 2, rows: 2 };

  it('adds a lamp at the centre of the tapped cell, not at the tap', () => {
    // Snapping is what makes a painted ceiling look laid out rather than hand-scattered.
    const out = toggleFixture([], { x: 0.9, y: 0.1 }, grid.cols, grid.rows);
    expect(out).toEqual([{ x: 0.75, y: 0.25 }]);
  });

  it('removes the lamp already in that cell, so tapping is idempotent per cell', () => {
    const existing = [{ x: 0.75, y: 0.25 }];
    expect(toggleFixture(existing, { x: 0.8, y: 0.2 }, grid.cols, grid.rows)).toEqual([]);
  });

  it('removes a lamp that is anywhere in the cell, not only one exactly at its centre', () => {
    // Lamps painted on a 4x3 grid keep their points after a resize to 2x2, so a later tap must
    // still find them. Matching on exact equality would leave un-removable ghosts.
    const drifted = [{ x: 0.6, y: 0.4 }];
    expect(toggleFixture(drifted, { x: 0.9, y: 0.1 }, grid.cols, grid.rows)).toEqual([]);
  });

  it('leaves lamps in other cells untouched', () => {
    const existing = [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }];
    const out = toggleFixture(existing, { x: 0.9, y: 0.1 }, grid.cols, grid.rows);
    expect(out).toHaveLength(3);
    expect(out).toContainEqual({ x: 0.25, y: 0.25 });
    expect(out).toContainEqual({ x: 0.75, y: 0.75 });
  });

  it('refuses to grow past a sane ceiling', () => {
    // A runaway loop or a stuck pointer should not write a thousand lamps into one row. The cap
    // is far above any real ceiling and far below anything that would hurt.
    //
    // The grid has to be BIGGER than the cap for this to test anything: a first version filled a
    // 200-cell grid and then tapped a cell that was already occupied, so the tap removed a lamp
    // and the cap was never reached. Here cells 0..199 are full and the tap lands on an empty one.
    const many = gridCells(300, 1).slice(0, MAX_FIXTURES);
    const out = toggleFixture(many, { x: 0.9, y: 0.5 }, 300, 1);
    expect(out).toHaveLength(MAX_FIXTURES);
  });

  it('still adds when there is room, so the cap is not silently blocking ordinary use', () => {
    const some = gridCells(300, 1).slice(0, 5);
    expect(toggleFixture(some, { x: 0.9, y: 0.5 }, 300, 1)).toHaveLength(6);
  });
});

describe('parseFixtures', () => {
  it('reads a stored array of points', () => {
    expect(parseFixtures([{ x: 0.25, y: 0.5 }])).toEqual([{ x: 0.25, y: 0.5 }]);
  });

  it('treats anything that is not an array as no lamps', () => {
    // NULL means "no lamps described". So does junk — a lighting layout that throws would take
    // the plan down, which is worse than a room with no lamps drawn on it.
    for (const junk of [undefined, null, 'cells', 7, {}, true]) expect(parseFixtures(junk)).toEqual([]);
  });

  it('drops individual points that are not points, keeping the rest', () => {
    // One corrupt entry must not discard a ceiling somebody painted.
    expect(parseFixtures([{ x: 0.2, y: 0.2 }, 'nope', { x: 'a', y: 1 }, { x: 0.8, y: 0.8 }])).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.8 },
    ]);
  });

  it('drops points outside the frame rather than clamping them to a wall', () => {
    // Same asymmetry planLayout draws: writing clamps, reading refuses. A stored value outside
    // 0..1 is a corrupt row, and pinning it to a wall would look exactly as deliberate as a
    // position somebody chose.
    expect(parseFixtures([{ x: 1.4, y: 0.5 }, { x: 0.5, y: -0.2 }, { x: 0.5, y: 0.5 }])).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('caps a runaway array', () => {
    expect(parseFixtures(Array.from({ length: MAX_FIXTURES + 50 }, () => ({ x: 0.5, y: 0.5 })))).toHaveLength(MAX_FIXTURES);
  });
});

describe('fixtureCount', () => {
  it('counts lamps per device from stored config', () => {
    const counts = fixtureCount({
      l1: { planFixtures: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
      l2: { planFixtures: [] },
      l3: {},
    });
    expect(counts).toEqual({ l1: 2, l2: 0, l3: 0 });
  });
});

describe('circuitColors', () => {
  it('gives each circuit its own colour', () => {
    const colors = circuitColors(['l1', 'l2', 'l3']);
    expect(new Set(Object.values(colors)).size).toBe(3);
  });

  it('gives a circuit the same colour whatever order the room lists them in', () => {
    // A colour that changed when a device was renamed, or when the fetch returned in a different
    // order, would make the legend useless — the whole point is that the dot on the plan and the
    // swatch in the list are the same circuit.
    expect(circuitColors(['l3', 'l1', 'l2'])).toEqual(circuitColors(['l1', 'l2', 'l3']));
  });

  it('still names a colour for a room with more circuits than the palette', () => {
    // Repeating is acceptable and returning undefined is not: an unstyled dot on a plan reads as
    // a rendering fault. The label is the source of truth; colour is an aid.
    const many = Array.from({ length: PALETTE_SIZE + 3 }, (_, i) => `l${i}`);
    const colors = circuitColors(many);
    for (const id of many) expect(typeof colors[id]).toBe('string');
  });
});
