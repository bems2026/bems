import { describe, it, expect } from 'vitest';
import { PLAN_PRESETS, presetFor, toRoomFrame, presetPlacements } from './planPresets';
import { PLAN } from '@/components/scene3d/geometry';
import { VB_W, VB_H } from '@/components/control/planGeometry';

/**
 * RM-044. The hand-surveyed pack becomes something an operator can APPLY, rather than something
 * the build silently is.
 *
 * The trap these exist for is a change of frame. The pack's numbers are normalised against the
 * 320x550 **viewBox**; `plan_x`/`plan_y` mean "where in this ROOM", and the room is inset 10px
 * on every side. Copying one into the other looks right — every value is still a plausible
 * 0..1 — and puts every device a few percent out, consistently, in a way nothing would flag.
 */

describe('toRoomFrame', () => {
  it('re-bases a viewBox coordinate onto the room rectangle', () => {
    // co1 sat at px=25 of 320. Against the room (10..310) that is 15/300, not 25/320.
    expect(toRoomFrame(25 / VB_W, 470 / VB_H)).toEqual({
      x: (25 - PLAN.x0) / (PLAN.x1 - PLAN.x0),
      y: (470 - PLAN.y0) / (PLAN.y1 - PLAN.y0),
    });
  });

  it('puts the room corners exactly on the frame corners', () => {
    expect(toRoomFrame(PLAN.x0 / VB_W, PLAN.y0 / VB_H)).toEqual({ x: 0, y: 0 });
    expect(toRoomFrame(PLAN.x1 / VB_W, PLAN.y1 / VB_H)).toEqual({ x: 1, y: 1 });
  });

  it('is not the identity, which is the whole point', () => {
    // If this ever became a no-op the preset would still apply and still look plausible.
    const p = toRoomFrame(25 / VB_W, 470 / VB_H);
    expect(p.x).not.toBeCloseTo(25 / VB_W, 5);
  });
});

describe('PLAN_PRESETS', () => {
  it('offers the surveyed CARE office layout', () => {
    expect(PLAN_PRESETS.map((p) => p.id)).toContain('care-office');
  });

  it('names the devices it places, so a site without them can be told', () => {
    const care = presetFor('care-office')!;
    expect(care.devices.map((d) => d.deviceId)).toEqual(
      expect.arrayContaining(['co1', 'co7', 'l1', 'l7']),
    );
  });

  it('places every outlet and every lighting circuit the office has', () => {
    const care = presetFor('care-office')!;
    const outlets = care.devices.filter((d) => d.point !== null);
    const circuits = care.devices.filter((d) => d.fixtures.length > 0);
    expect(outlets).toHaveLength(7);
    expect(circuits).toHaveLength(7);
  });

  it('gives every circuit three ceiling fixtures, as the room has', () => {
    const care = presetFor('care-office')!;
    for (const d of care.devices.filter((x) => x.fixtures.length > 0)) {
      expect(d.fixtures).toHaveLength(3);
    }
  });

  it('keeps every coordinate inside the room', () => {
    // A value outside 0..1 would be refused on read (`parseFixtures`, `coercePlanCoord`) and
    // silently vanish, which reads as a preset that half-worked.
    for (const preset of PLAN_PRESETS) {
      for (const d of preset.devices) {
        for (const p of [...(d.point ? [d.point] : []), ...d.fixtures]) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(1);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('carries the room proportions, so the drawing is not a square claiming to be this room', () => {
    const care = presetFor('care-office')!;
    expect(care.shape.aspect).toBeCloseTo((PLAN.x1 - PLAN.x0) / (PLAN.y1 - PLAN.y0), 4);
  });

  it('is unknown for an id nobody defined, rather than throwing', () => {
    expect(presetFor('no-such-preset')).toBeUndefined();
  });
});

describe('presetPlacements', () => {
  const care = presetFor('care-office')!;

  it('places only devices this deployment actually has', () => {
    // The preset names one building's hardware. At another site those ids do not exist, and a
    // write referencing them would fail the foreign key on `device_config.device_id`.
    const { placements, skipped } = presetPlacements(care, ['co1', 'l1', 'zz9'], 'room-a');
    expect(placements.map((p) => p.deviceId)).toEqual(['co1', 'l1']);
    // `zz9` is not in the preset at all, so it is neither placed nor skipped — a preset places
    // what it knows about, and says nothing about hardware it has never heard of.
    expect(skipped).not.toContain('zz9');
  });

  it('reports the devices it could not place, rather than applying a partial layout in silence', () => {
    const { placements, skipped } = presetPlacements(care, ['co1'], 'room-a');
    expect(placements).toHaveLength(1);
    expect(skipped).toContain('co2');
    expect(skipped.length).toBeGreaterThan(10);
  });

  it('puts every placed device into the chosen room', () => {
    const { placements } = presetPlacements(care, ['co1', 'l1'], 'room-a');
    for (const p of placements) expect(p.spaceNodeId).toBe('room-a');
  });

  it('gives an outlet a position and no fixtures, and a circuit fixtures and no position', () => {
    // The two are different claims: an outlet IS somewhere, a circuit's luminaires are.
    const { placements } = presetPlacements(care, ['co1', 'l1'], 'room-a');
    const outlet = placements.find((p) => p.deviceId === 'co1')!;
    const circuit = placements.find((p) => p.deviceId === 'l1')!;
    expect(outlet.planX).not.toBeNull();
    expect(outlet.planFixtures).toEqual([]);
    expect(circuit.planX).toBeNull();
    expect(circuit.planFixtures).toHaveLength(3);
  });
});
