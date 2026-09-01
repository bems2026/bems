import { describe, it, expect } from 'vitest';
import { drawnRooms, dataPlanFor } from './controlPlanData';
import { emptyDeviceConfig } from './deviceConfig';
import type { SpaceNode } from './spaceTree';

const nodes: SpaceNode[] = [
  { id: 'b', site_id: 's', parent_id: null, kind: 'building', name: 'NBERIC', sort_order: 0, attrs: {} },
  { id: 'lab', site_id: 's', parent_id: 'b', kind: 'room', name: 'Lab', sort_order: 0, attrs: {} },
  { id: 'hall', site_id: 's', parent_id: 'b', kind: 'room', name: 'Hall', sort_order: 1, attrs: {} },
];

const cfg = (id: string, over: Partial<ReturnType<typeof emptyDeviceConfig>>) => ({ ...emptyDeviceConfig(id), ...over });

describe('drawnRooms', () => {
  it('names only the rooms that have something drawn in them', () => {
    // A room somebody created and never drew has nothing to show. Offering it in a picker would
    // be offering an empty frame, which reads as a broken render.
    const saved = {
      co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.5, planY: 0.5 }),
      co2: cfg('co2', { spaceNodeId: 'hall' }),
    };
    expect(drawnRooms(saved, nodes)).toEqual([{ id: 'lab', label: 'NBERIC / Lab' }]);
  });

  it('counts a circuit with lamps as drawn, even though the switch itself has no position', () => {
    // THE CASE A POSITION-ONLY CHECK MISSES. A switch is on a wall and its luminaires are on the
    // ceiling; a room can have a complete lighting layout and not one placed pin.
    const saved = { l1: cfg('l1', { spaceNodeId: 'hall', planFixtures: [{ x: 0.25, y: 0.25 }] }) };
    expect(drawnRooms(saved, nodes).map((r) => r.id)).toEqual(['hall']);
  });

  it('ignores a position on a device that is in no room, because there is no frame it was measured against', () => {
    const saved = { co1: cfg('co1', { spaceNodeId: null, planX: 0.5, planY: 0.5 }) };
    expect(drawnRooms(saved, nodes)).toEqual([]);
  });

  it('sorts by the path shown, so the picker does not reorder itself between loads', () => {
    const saved = {
      co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.5, planY: 0.5 }),
      co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.5, planY: 0.5 }),
    };
    expect(drawnRooms(saved, nodes).map((r) => r.label)).toEqual(['NBERIC / Hall', 'NBERIC / Lab']);
  });

  it('skips a room that was deleted out from under a device still pointing at it', () => {
    const saved = { co1: cfg('co1', { spaceNodeId: 'gone', planX: 0.5, planY: 0.5 }) };
    expect(drawnRooms(saved, nodes)).toEqual([]);
  });
});

describe('dataPlanFor', () => {
  const saved = {
    co1: cfg('co1', { spaceNodeId: 'lab', planX: 0.25, planY: 0.75 }),
    co2: cfg('co2', { spaceNodeId: 'hall', planX: 0.1, planY: 0.1 }),
    l1: cfg('l1', { spaceNodeId: 'lab', planFixtures: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }] }),
    l2: cfg('l2', { spaceNodeId: 'lab' }),
  };

  it('collects the positions and the lamps of one room', () => {
    const plan = dataPlanFor(saved, 'lab');
    expect(plan?.OUTLET_POSITIONS).toEqual({ co1: { x: 0.25, y: 0.75 } });
    expect(plan?.LIGHT_POSITIONS).toEqual({ l1: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }] });
  });

  it('draws no device from another room', () => {
    // THE INVARIANT THE WHOLE PLAN RESTS ON. A position is normalised against ONE node's frame,
    // so drawing another room's device here would put it somewhere nobody chose — and it would
    // look exactly as surveyed as one somebody placed.
    expect(dataPlanFor(saved, 'lab')?.OUTLET_POSITIONS).not.toHaveProperty('co2');
  });

  it('omits a circuit with no lamps rather than drawing it as an empty row', () => {
    expect(dataPlanFor(saved, 'lab')?.LIGHT_POSITIONS).not.toHaveProperty('l2');
  });

  it('is null for a room nobody has drawn, so the caller can fall through to what it had', () => {
    expect(dataPlanFor(saved, 'hall-empty')).toBeNull();
  });

  it('is null for no room at all', () => {
    expect(dataPlanFor(saved, null)).toBeNull();
  });

  it('tolerates a corrupt fixtures column without taking the plan down', () => {
    const junk = { l1: { ...cfg('l1', { spaceNodeId: 'lab' }), planFixtures: 'ceiling' as unknown as [] } };
    expect(dataPlanFor(junk, 'lab')).toBeNull();
  });
});
