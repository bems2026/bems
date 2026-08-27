import { describe, it, expect } from 'vitest';
import {
  PLAN_PRECISION,
  coercePlanCoord,
  planPointOf,
  clampToPlan,
  pointerToPlan,
  groupByPlacement,
} from './planLayout';
import type { SpaceNode } from './spaceTree';

const node = (id: string, name: string, parent_id: string | null = null): SpaceNode => ({
  id,
  site_id: 's',
  parent_id,
  kind: parent_id === null ? 'building' : 'room',
  name,
  sort_order: 0,
  attrs: {},
});

describe('coercePlanCoord', () => {
  it('accepts a coordinate inside the frame', () => {
    expect(coercePlanCoord(0)).toBe(0);
    expect(coercePlanCoord(0.25)).toBe(0.25);
    expect(coercePlanCoord(1)).toBe(1);
  });

  it('accepts the string PostgREST may return for a numeric column', () => {
    // `count(*)` already taught this project that a Postgres number can arrive as a string
    // (see `rowToNodeTotals`). Being tolerant here costs one branch; being wrong costs a plan
    // that silently renders every device as unplaced.
    expect(coercePlanCoord('0.25')).toBe(0.25);
  });

  it('rejects a stored coordinate outside the frame rather than clamping it', () => {
    // A row outside 0..1 is corrupt — phase23's CHECK forbids it. Clamping would pin the device
    // to a wall, which looks exactly as deliberate as a position somebody dragged it to.
    // Rejecting sends it to the "not placed yet" tray, which is the truth.
    expect(coercePlanCoord(1.5)).toBeNull();
    expect(coercePlanCoord(-0.01)).toBeNull();
  });

  it('rejects everything that is not a finite number', () => {
    for (const bad of [null, undefined, '', 'left', NaN, Infinity, -Infinity, {}, [], true]) {
      expect(coercePlanCoord(bad)).toBeNull();
    }
  });
});

describe('planPointOf', () => {
  it('reads a placed device', () => {
    expect(planPointOf({ planX: 0.25, planY: 0.75 })).toEqual({ x: 0.25, y: 0.75 });
  });

  it('treats one axis alone as unplaced', () => {
    // phase23 forbids half a placement in the database. This is the same rule on the read side,
    // because a row written before that migration — or by anything else — can still be half set,
    // and the renderer would have to invent the missing axis.
    expect(planPointOf({ planX: 0.25, planY: null })).toBeNull();
    expect(planPointOf({ planX: null, planY: 0.75 })).toBeNull();
  });

  it('treats a device with no config at all as unplaced', () => {
    expect(planPointOf(undefined)).toBeNull();
    expect(planPointOf(null)).toBeNull();
  });

  it('treats a corrupt axis as unplaced rather than rendering the other one', () => {
    expect(planPointOf({ planX: 2, planY: 0.5 })).toBeNull();
  });
});

describe('clampToPlan', () => {
  it('keeps a point that is already inside', () => {
    expect(clampToPlan({ x: 0.3, y: 0.6 })).toEqual({ x: 0.3, y: 0.6 });
  });

  it('pulls a point dragged past the edge back to the edge', () => {
    // The opposite of the read rule above, and deliberately so: dragging past the edge is a
    // person saying "against that wall", which is a real position. A stored value out of range
    // is a corrupt row, which is not.
    expect(clampToPlan({ x: -0.4, y: 1.4 })).toEqual({ x: 0, y: 1 });
  });

  it('rounds, so a drag does not store seventeen digits of pointer jitter', () => {
    const p = clampToPlan({ x: 0.123456789, y: 0.987654321 });
    expect(p.x).toBe(0.1235);
    expect(p.y).toBe(0.9877);
    expect(PLAN_PRECISION).toBe(4);
  });

  it('rounds to a precision finer than anyone can see and coarser than any float noise', () => {
    // 1e-4 of a 10 m room is a millimetre. The point is not accuracy, it is that two drags to
    // the same visible spot produce the same number instead of a phantom unsaved change.
    expect(clampToPlan({ x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('pointerToPlan', () => {
  const frame = { left: 100, top: 50, width: 200, height: 400 };

  it('converts a pointer inside the frame to its fraction across it', () => {
    expect(pointerToPlan({ x: 150, y: 150 }, frame)).toEqual({ x: 0.25, y: 0.25 });
  });

  it('puts a corner at a corner', () => {
    expect(pointerToPlan({ x: 100, y: 50 }, frame)).toEqual({ x: 0, y: 0 });
    expect(pointerToPlan({ x: 300, y: 450 }, frame)).toEqual({ x: 1, y: 1 });
  });

  it('clamps a pointer released outside the frame', () => {
    expect(pointerToPlan({ x: 40, y: 900 }, frame)).toEqual({ x: 0, y: 1 });
  });

  it('refuses a frame with no size instead of dividing by zero', () => {
    // jsdom reports every rect as zero, and a hidden or unlaid-out element does the same in a
    // real browser. `0/0` is NaN, which would fail phase23's CHECK on write — after the pin had
    // already appeared to move.
    expect(pointerToPlan({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    expect(pointerToPlan({ x: 10, y: 10 }, { left: 0, top: 0, width: 200, height: 0 })).toBeNull();
  });
});

describe('groupByPlacement', () => {
  const nodes = [node('b', 'NBERIC'), node('lab', 'Lab', 'b'), node('hall', 'Hall', 'b')];

  it('groups devices under the full path of the space they are placed in', () => {
    const groups = groupByPlacement(
      [
        { id: 'x', nodeId: 'lab' },
        { id: 'y', nodeId: 'hall' },
        { id: 'z', nodeId: 'lab' },
      ],
      nodes,
    );
    expect(groups.map((g) => g.label)).toEqual(['NBERIC / Hall', 'NBERIC / Lab']);
    expect(groups.map((g) => g.ids)).toEqual([['y'], ['x', 'z']]);
  });

  it('keeps unplaced devices as their own group, last, and named as unplaced', () => {
    // The whole reason this view exists at a fresh site: nothing is placed, and a screen that
    // silently omitted those devices would look like a working plan of an empty building.
    const groups = groupByPlacement([{ id: 'x', nodeId: 'lab' }, { id: 'y', nodeId: null }], nodes);
    expect(groups.at(-1)).toEqual({ nodeId: null, label: 'Not placed', ids: ['y'] });
  });

  it('shows a device whose space this client no longer knows as unplaced, not as missing', () => {
    // A delete racing a render, or a stale draft. Dropping the device would make hardware
    // disappear from a screen whose job is to account for all of it.
    const groups = groupByPlacement([{ id: 'x', nodeId: 'gone' }], nodes);
    expect(groups).toEqual([{ nodeId: null, label: 'Not placed', ids: ['x'] }]);
  });

  it('returns nothing for no devices, rather than an empty group', () => {
    expect(groupByPlacement([], nodes)).toEqual([]);
  });
});
